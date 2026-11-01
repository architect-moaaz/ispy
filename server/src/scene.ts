import { z } from "zod/v4";
import { VectorTile } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import { db, get, run, now } from "./db.ts";

/**
 * The street scene around an operative: building footprints with heights, roads and green or wet
 * areas from OpenStreetMap, fetched once per ~110 m grid cell and kept for a week, so a walk pulls
 * each cell once and the public Overpass mirrors see a handful of requests per playtest, not per fix.
 */
db.exec(`CREATE TABLE IF NOT EXISTS scene_cells (key TEXT PRIMARY KEY, json TEXT NOT NULL, at TEXT NOT NULL)`);

/**
 * Primary source: OpenFreeMap vector tiles (OpenMapTiles schema, no key, zoom 14 at most). One
 * tile is about 2.4 km wide, so a cell needs one tile, two at an edge. Decoded tiles are kept in
 * memory for the process; Overpass is the fallback when the tile host is unreachable.
 */
const TILEJSON = "https://tiles.openfreemap.org/planet";
const TILE_Z = 14;
let tileTemplate: string | null = null;
const tileCache = new Map<string, { buildings: ScenePoly[]; roads: ScenePoly[]; areas: ScenePoly[] }>();

const OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter", "https://overpass.osm.jp/api/interpreter", "https://overpass.private.coffee/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter"];
const UA = "ispy-a-spy/1.0 (playtest; street scene)";
const RETRY_MS = 90_000; // after every mirror refuses, leave the cell alone for a while
const missing = new Map<string, number>();
const inflight = new Map<string, Promise<void>>();
const RADIUS_M = 360;
const KEEP_MS = 7 * 24 * 3600_000;
const MAX_BUILDINGS = 450;

export interface ScenePoly { pts: [number, number][]; h?: number; kind?: string; name?: string }
export interface Scene { center: { lat: number; lng: number }; radiusM: number; buildings: ScenePoly[]; roads: ScenePoly[]; areas: ScenePoly[]; fetchedAt: string; pending?: boolean }

export const SceneQuery = z.object({ lat: z.coerce.number().min(-90).max(90), lng: z.coerce.number().min(-180).max(180) });

const cellKey = (lat: number, lng: number) => `${lat.toFixed(3)},${lng.toFixed(3)}`;

function heightOf(t: Record<string, string>): number {
  const h = parseFloat(t.height ?? t["building:height"] ?? "");
  if (Number.isFinite(h) && h > 0) return Math.min(h, 120);
  const lv = parseFloat(t["building:levels"] ?? "");
  if (Number.isFinite(lv) && lv > 0) return Math.min(lv * 3.2, 120);
  // Unmarked: a low house in residential lanes, taller for anything that calls itself more.
  return /apartments|commercial|office|hotel|hospital|school|industrial|retail/.test(t.building ?? "") ? 14 : 7;
}

async function overpass(lat: number, lng: number): Promise<Omit<Scene, "center" | "radiusM" | "fetchedAt"> | null> {
  const q = `[out:json][timeout:15];(way["building"](around:${RADIUS_M},${lat},${lng});way["highway"](around:${RADIUS_M},${lat},${lng});way["leisure"~"^(park|garden|pitch|playground)$"](around:${RADIUS_M},${lat},${lng});way["natural"~"^(water|wood)$"](around:${RADIUS_M},${lat},${lng});way["landuse"~"^(grass|forest|cemetery)$"](around:${RADIUS_M},${lat},${lng}););out geom;`;
  for (const host of OVERPASS) {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 12_000);
      const res = await fetch(host, { method: "POST", body: `data=${encodeURIComponent(q)}`, headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA, Accept: "application/json" }, signal: ctl.signal });
      clearTimeout(t);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j: any = await res.json();
      const buildings: ScenePoly[] = [], roads: ScenePoly[] = [], areas: ScenePoly[] = [];
      for (const el of j?.elements ?? []) {
        if (el.type !== "way" || !Array.isArray(el.geometry) || el.geometry.length < 2) continue;
        const t: Record<string, string> = el.tags ?? {};
        const pts = el.geometry.map((g: any) => [round(g.lat), round(g.lon)] as [number, number]);
        if (t.building) buildings.push({ pts, h: heightOf(t) });
        else if (t.highway) roads.push({ pts, kind: t.highway, name: t.name });
        else areas.push({ pts, kind: t.natural === "water" ? "water" : "green" });
      }
      buildings.sort((a, b) => (b.h ?? 0) - (a.h ?? 0));
      return { buildings: buildings.slice(0, MAX_BUILDINGS), roads, areas };
    } catch (e) {
      console.warn(`[scene] overpass ${new URL(host).host} failed:`, (e as Error).message);
    }
  }
  return null;
}
const round = (n: number) => Math.round(n * 1e6) / 1e6;

function tileXY(lat: number, lng: number, z: number) {
  const n = 2 ** z;
  const x = Math.floor(((lng + 180) / 360) * n);
  const y = Math.floor(((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * n);
  return { x, y };
}
const metres = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const r = Math.PI / 180, R = 6371000, dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
const ROAD_CLASS: Record<string, string> = { motorway: "motorway", trunk: "trunk", primary: "primary", secondary: "secondary", tertiary: "tertiary", minor: "residential", service: "service", track: "track", path: "footway", raceway: "service", busway: "service" };

async function tileFeatures(z: number, x: number, y: number) {
  const key = `${z}/${x}/${y}`;
  const hit = tileCache.get(key);
  if (hit) return hit;
  if (!tileTemplate) {
    const j: any = await (await fetch(TILEJSON, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(10_000) })).json();
    tileTemplate = j?.tiles?.[0];
    if (!tileTemplate) throw new Error("no tile template");
  }
  const url = tileTemplate.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y));
  const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new Error(`tile HTTP ${res.status}`);
  const tile = new VectorTile(new PbfReader(new Uint8Array(await res.arrayBuffer())) as any);
  const out = { buildings: [] as ScenePoly[], roads: [] as ScenePoly[], areas: [] as ScenePoly[] };
  const rings = (geom: any): [number, number][][] => {
    if (geom.type === "Polygon") return [geom.coordinates[0]];
    if (geom.type === "MultiPolygon") return geom.coordinates.map((p: any) => p[0]);
    if (geom.type === "LineString") return [geom.coordinates];
    if (geom.type === "MultiLineString") return geom.coordinates;
    return [];
  };
  const pts = (ring: [number, number][]) => ring.map(([lng, lat]) => [round(lat), round(lng)] as [number, number]);
  const layer = (name: string, fn: (props: any, geom: any) => void) => { const l = tile.layers[name]; if (!l) return; for (let i = 0; i < l.length; i++) { const f = l.feature(i); fn(f.properties, f.toGeoJSON(x, y, z).geometry); } };
  layer("building", (p, g) => { const raw = Number(p.render_height); const h = !raw || raw <= 5 ? 8 : raw; /* 5 is the schema default for unknown: call it two floors */ for (const r of rings(g)) if (r.length >= 3) out.buildings.push({ pts: pts(r), h: Math.min(h, 120) }); });
  layer("transportation", (p, g) => { const kind = p.class === "path" ? String(p.subclass ?? "footway") : ROAD_CLASS[String(p.class)]; if (!kind || p.brunnel === "tunnel") return; for (const r of rings(g)) if (r.length >= 2) out.roads.push({ pts: pts(r), kind }); });
  layer("park", (_p, g) => { for (const r of rings(g)) if (r.length >= 3) out.areas.push({ pts: pts(r), kind: "green" }); });
  layer("landuse", (p, g) => { if (!/grass|cemetery|forest|wood|pitch|garden|playground/.test(String(p.class))) return; for (const r of rings(g)) if (r.length >= 3) out.areas.push({ pts: pts(r), kind: "green" }); });
  layer("landcover", (p, g) => { if (!/grass|wood|farmland/.test(String(p.class))) return; for (const r of rings(g)) if (r.length >= 3) out.areas.push({ pts: pts(r), kind: "green" }); });
  layer("water", (_p, g) => { for (const r of rings(g)) if (r.length >= 3) out.areas.push({ pts: pts(r), kind: "water" }); });
  tileCache.set(key, out);
  if (tileCache.size > 64) tileCache.delete(tileCache.keys().next().value!);
  return out;
}

async function tilesScene(lat: number, lng: number): Promise<Omit<Scene, "center" | "radiusM" | "fetchedAt"> | null> {
  try {
    const dLat = RADIUS_M / 111_000, dLng = RADIUS_M / (111_000 * Math.cos((lat * Math.PI) / 180));
    const corners = [[lat - dLat, lng - dLng], [lat - dLat, lng + dLng], [lat + dLat, lng - dLng], [lat + dLat, lng + dLng]];
    const keys = new Set(corners.map(([a, b]) => { const t = tileXY(a, b, TILE_Z); return `${t.x},${t.y}`; }));
    const parts = await Promise.all([...keys].map((k) => { const [x, y] = k.split(",").map(Number); return tileFeatures(TILE_Z, x, y); }));
    const c = { lat, lng };
    const near = (poly: ScenePoly) => poly.pts.some(([a, b]) => metres(c, { lat: a, lng: b }) <= RADIUS_M);
    const seen = new Set<string>();
    const uniq = (list: ScenePoly[]) => list.filter((p) => { const k = p.pts[0].join(",") + p.pts.length; if (seen.has(k)) return false; seen.add(k); return true; });
    const buildings = uniq(parts.flatMap((p) => p.buildings).filter(near)).sort((a, b) => (b.h ?? 0) - (a.h ?? 0)).slice(0, MAX_BUILDINGS);
    const roads = uniq(parts.flatMap((p) => p.roads).filter(near));
    const areas = uniq(parts.flatMap((p) => p.areas).filter(near));
    return { buildings, roads, areas };
  } catch (e) {
    console.warn("[scene] tiles failed:", (e as Error).message);
    return null;
  }
}

/**
 * Answers at once with the cell as known (cached, or empty and `pending`) and fills it in the
 * background; the app asks again while pending. Mirrors at capacity put the cell on a short
 * retry hold rather than queueing requests behind each other.
 */
export function sceneAround(lat: number, lng: number): Scene {
  const key = cellKey(lat, lng);
  const cached = get<{ json: string; at: string }>("SELECT json, at FROM scene_cells WHERE key=?", key);
  if (cached && Date.now() - Date.parse(cached.at) < KEEP_MS) return JSON.parse(cached.json);
  const cLat = Number(key.split(",")[0]), cLng = Number(key.split(",")[1]);
  const stale = cached ? (JSON.parse(cached.json) as Scene) : null;
  const held = (missing.get(key) ?? 0) > Date.now();
  if (!held && !inflight.has(key)) {
    inflight.set(key, tilesScene(cLat, cLng).then((t) => t ?? overpass(cLat, cLng)).then((got) => {
      if (!got) { missing.set(key, Date.now() + RETRY_MS); return; }
      const scene: Scene = { center: { lat: cLat, lng: cLng }, radiusM: RADIUS_M, ...got, fetchedAt: now() };
      run("INSERT OR REPLACE INTO scene_cells(key,json,at) VALUES(?,?,?)", key, JSON.stringify(scene), now());
    }).finally(() => inflight.delete(key)));
  }
  return stale ? { ...stale, pending: inflight.has(key) } : { center: { lat: cLat, lng: cLng }, radiusM: RADIUS_M, buildings: [], roads: [], areas: [], fetchedAt: now(), pending: !held || inflight.has(key) };
}
