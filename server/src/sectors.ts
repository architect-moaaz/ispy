import { all, get, run, now, uid, logEvent } from "./db.ts";
import { distanceM, offsetM, type AreaRow } from "./geo.ts";
import { rand } from "./puzzles.ts";

/**
 * Sectors the World Director opens on its own, wherever an operative deploys outside every
 * existing play area. The sector exists the moment the operative checks in (with virtual
 * checkpoints on a ring around them, so there is something to walk to within seconds); then,
 * in the background, the Director names it after the real neighbourhood and swaps in real
 * public places from OpenStreetMap as targets. Nothing here is a vetted location: the targets
 * are public-tagged POIs (parks, monuments, fountains, bus stops...) and the safe-hours window
 * is daylight only.
 */
export const SECTOR_RADIUS_M = 1200;
const POI_RADIUS_M = 800;
const CODEWORDS = ["AMBER", "COBALT", "SABLE", "IVORY", "OCHRE", "VIRIDIAN", "SLATE", "CRIMSON", "UMBER", "INDIGO", "SAFFRON", "ONYX", "PEWTER", "CORAL", "JADE", "RUST"];
const UA = "ispy-a-spy/0.1 (world director; contact: moaazabir@gmail.com)";

export function sectorIdFor(lat: number, lng: number) {
  return `sec-${lat.toFixed(2)}-${lng.toFixed(2)}`.replace(/[^a-z0-9-]/gi, "").replace(/-+/g, "-");
}

/** Synchronous: the area exists when this returns. Objectives arrive from the survey (public places) and footpath waypoints. */
export function openSector(lat: number, lng: number, openedFor: string | null): AreaRow {
  const id = sectorIdFor(lat, lng);
  const existing = get<AreaRow>("SELECT * FROM areas WHERE id=?", id);
  if (existing) return existing;
  const code = CODEWORDS[Math.floor(rand(id) * CODEWORDS.length)];
  const name = `Sector ${code}`;
  run("INSERT INTO areas(id,name,city,lat,lng,radius_m,merge_group) VALUES(?,?,?,?,?,?,?)", id, name, "Field", lat, lng, SECTOR_RADIUS_M, null);
  logEvent("sector.opened", "director", { areaId: id, name, lat, lng, radiusM: SECTOR_RADIUS_M, openedFor }, openedFor);
  return get<AreaRow>("SELECT * FROM areas WHERE id=?", id)!;
}

const OSRM_NEAREST = "https://router.project-osrm.org/nearest/v1/foot";
/** Snap a point to the nearest public footpath or street (OSRM foot profile). null when unreachable or nothing within 120 m. */
export async function snapToPath(lat: number, lng: number): Promise<{ lat: number; lng: number; name: string | null } | null> {
  try {
    const j = await fetchJson(`${OSRM_NEAREST}/${lng},${lat}?number=1`, {}, 6000);
    const w = j?.waypoints?.[0];
    if (!w || w.distance > 120) return null;
    return { lat: w.location[1], lng: w.location[0], name: w.name || null };
  } catch { return null; }
}
const COMPASS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];
/**
 * Waypoints: eight points on a ring, each snapped onto a public footpath or street, so there is always
 * something to walk to that is on public ground. Nothing is created where no path can be found.
 */
export async function layWaypoints(areaId: string): Promise<number> {
  const a = get<AreaRow>("SELECT * FROM areas WHERE id=?", areaId);
  if (!a) return 0;
  if (get("SELECT 1 FROM targets WHERE area_id=? AND state='ACTIVE'", areaId)) return 0;
  const placed: { lat: number; lng: number }[] = [];
  let n = 0;
  for (let i = 0; i < 8; i++) {
    const r = 180 + (i % 4) * 90;
    const ang = (i * 45 * Math.PI) / 180;
    const p = offsetM(a.lat, a.lng, r * Math.cos(ang), r * Math.sin(ang));
    const snapped = await snapToPath(p.lat, p.lng);
    if (!snapped) continue;
    if (placed.some((q) => distanceM(q.lat, q.lng, snapped.lat, snapped.lng) < 60)) continue;
    placed.push(snapped);
    const name = `${snapped.name ? snapped.name : "Footpath"} · ${COMPASS[i]}`;
    run(`INSERT INTO targets(id,area_id,name,kind,lat,lng,approach_radius_m,safe_start,safe_end,capacity,state,observation,observation_answer) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      `${areaId}-wp-${i}`, areaId, name, "waypoint", snapped.lat, snapped.lng, 45, 6, 21, 4, "ACTIVE", "", "");
    n++;
  }
  logEvent("sector.waypoints", "director", { areaId, placed: n }, null);
  return n;
}

/** Legacy: arbitrary ring checkpoints from before the public-ground rule. Retire them and lay snapped waypoints instead. */
export async function retireCheckpoints() {
  const areas = all<{ area_id: string }>("SELECT DISTINCT area_id FROM targets WHERE kind='checkpoint' AND state='ACTIVE'");
  for (const { area_id } of areas) {
    run("UPDATE targets SET state='RETIRED' WHERE area_id=? AND kind='checkpoint' AND id NOT IN (SELECT target_id FROM missions WHERE target_id IS NOT NULL AND state IN ('accepted','active'))", area_id);
    run("UPDATE missions SET state='expired', outcome='lost' WHERE area_id=? AND state IN ('pool','offered') AND target_id IN (SELECT id FROM targets WHERE kind='checkpoint')", area_id);
    if (!get("SELECT 1 FROM targets WHERE area_id=? AND state='ACTIVE'", area_id)) await layWaypoints(area_id);
    if (!get("SELECT 1 FROM targets WHERE area_id=? AND state='ACTIVE' AND kind NOT IN ('waypoint','checkpoint')", area_id)) settleSector(area_id).catch(() => {});
  }
  // Signals that were placed around retired points go with them.
  run("UPDATE signals SET state='expired' WHERE state='live' AND near_target IN (SELECT id FROM targets WHERE state='RETIRED')");
  if (areas.length) logEvent("sector.checkpoints_retired", "director", { areas: areas.map((a) => a.area_id) }, null);
}

interface Poi { name: string; kind: string; lat: number; lng: number }

const POI_FILTER = [
  '["leisure"~"^(park|garden|nature_reserve)$"]',
  '["tourism"~"^(artwork|viewpoint|attraction|museum)$"]',
  '["historic"~"^(monument|memorial|archaeological_site|castle|fort|ruins)$"]',
  '["amenity"~"^(fountain|marketplace|library|clock|townhall|community_centre)$"]',
  '["man_made"~"^(tower|lighthouse|obelisk|clock)$"]',
  '["place"="square"]',
  '["highway"="bus_stop"]',
  '["railway"~"^(station|halt)$"]',
];

async function fetchJson(url: string, init: RequestInit = {}, timeoutMs = 12_000): Promise<any> {
  const res = await fetch(url, { ...init, headers: { "User-Agent": UA, Accept: "application/json", ...(init.headers ?? {}) }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`${res.status} from ${new URL(url).host}`);
  return res.json();
}

/** Neighbourhood and city from Nominatim; null when unknown or unreachable. */
export async function placeName(lat: number, lng: number): Promise<{ name: string; city: string } | null> {
  try {
    const j = await fetchJson(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=15&lat=${lat}&lon=${lng}`);
    const a = j?.address ?? {};
    const name = a.neighbourhood || a.suburb || a.quarter || a.city_district || a.village || a.town || a.hamlet || a.residential || null;
    const city = a.city || a.town || a.county || a.state_district || a.state || null;
    return name || city ? { name: name ?? city, city: city ?? "" } : null;
  } catch (e) {
    console.warn("[sectors] reverse geocode failed:", (e as Error).message);
    return null;
  }
}

const OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
const NOMINATIM_KINDS: [string, string][] = [["[park]", "park"], ["[garden]", "garden"], ["[monument]", "monument"], ["[fountain]", "fountain"], ["[artwork]", "artwork"], ["[library]", "library"], ["[bus_stop]", "bus stop"]];

function dedupe(lat: number, lng: number, raw: Poi[]): Poi[] {
  const out: Poi[] = [];
  const seen = new Set<string>();
  for (const p of raw) {
    const key = p.name.toLowerCase();
    if (seen.has(key)) continue;
    // Give operatives a walk: nothing closer than 120 m to the centre or to another pick.
    if (distanceM(lat, lng, p.lat, p.lng) < 120 || out.some((o) => distanceM(o.lat, o.lng, p.lat, p.lng) < 120)) continue;
    seen.add(key);
    out.push(p);
  }
  // Interesting places first, bus stops as filler.
  const rank = (p: Poi) => (/bus stop|station|halt/.test(p.kind) ? 1 : 0);
  return out.sort((a, b) => rank(a) - rank(b)).slice(0, 14);
}

async function overpassPlaces(lat: number, lng: number, radiusM: number): Promise<Poi[] | null> {
  const body = `[out:json][timeout:8];(${POI_FILTER.map((f) => `nwr(around:${radiusM},${lat},${lng})${f};`).join("")});out center 60;`;
  for (const host of OVERPASS) {
    try {
      const j = await fetchJson(host, { method: "POST", body: `data=${encodeURIComponent(body)}`, headers: { "Content-Type": "application/x-www-form-urlencoded" } }, 10_000);
      const raw: Poi[] = [];
      for (const el of j?.elements ?? []) {
        const t = el.tags ?? {};
        const name: string | undefined = t.name || t["name:en"];
        const plat = el.lat ?? el.center?.lat, plng = el.lon ?? el.center?.lon;
        if (!name || plat == null || plng == null) continue;
        const kind = t.leisure || t.tourism || t.historic || t.amenity || t.man_made || t.place || (t.highway === "bus_stop" ? "bus stop" : t.railway) || "place";
        raw.push({ name, kind: String(kind).replace(/_/g, " "), lat: plat, lng: plng });
      }
      return raw;
    } catch (e) {
      console.warn(`[sectors] overpass ${new URL(host).host} failed:`, (e as Error).message);
    }
  }
  return null;
}

/** Slower but steadier: one bounded Nominatim category search per kind, a second apart (usage policy). */
async function nominatimPlaces(lat: number, lng: number, radiusM: number): Promise<Poi[] | null> {
  const dLat = radiusM / 111_000, dLng = radiusM / (111_000 * Math.cos((lat * Math.PI) / 180));
  const viewbox = `${lng - dLng},${lat + dLat},${lng + dLng},${lat - dLat}`;
  const raw: Poi[] = [];
  let ok = false;
  for (const [q, kind] of NOMINATIM_KINDS) {
    try {
      const j = await fetchJson(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=10&bounded=1&viewbox=${viewbox}&q=${encodeURIComponent(q)}`);
      ok = true;
      for (const x of j ?? []) if (x.name) raw.push({ name: x.name, kind, lat: Number(x.lat), lng: Number(x.lon) });
    } catch (e) {
      console.warn("[sectors] nominatim search failed:", (e as Error).message);
    }
    await new Promise((r) => setTimeout(r, 1100));
  }
  return ok ? raw : null;
}

/** Public places near a point. null means every source was unreachable (retry later); [] means none mapped. */
export async function publicPlaces(lat: number, lng: number, radiusM = POI_RADIUS_M): Promise<Poi[] | null> {
  const raw = (await overpassPlaces(lat, lng, radiusM)) ?? (await nominatimPlaces(lat, lng, radiusM));
  return raw ? dedupe(lat, lng, raw) : null;
}

const RETRY_MS = [2 * 60_000, 10 * 60_000, 30 * 60_000];
/**
 * Background: name the sector after the real place and replace ring checkpoints with real public
 * places when enough are found. When the map sources are down it retries a few times; the final
 * outcome is announced on the bus as `sector.settled`, which the Director reacts to.
 */
export async function settleSector(areaId: string, attempt = 0): Promise<{ name: string; realTargets: number; final: boolean }> {
  const a = get<AreaRow>("SELECT * FROM areas WHERE id=?", areaId);
  if (!a) throw new Error("no such sector");
  const [place, pois] = await Promise.all([a.city === "Field" ? placeName(a.lat, a.lng) : Promise.resolve(null), publicPlaces(a.lat, a.lng)]);
  let name = a.name;
  if (place && a.city === "Field") {
    name = place.name.length > 28 ? place.name.slice(0, 28) : place.name;
    run("UPDATE areas SET name=?, city=? WHERE id=?", name, place.city || "Field", areaId);
  }
  if (pois === null && attempt < RETRY_MS.length) {
    logEvent("sector.survey_retry", "director", { areaId, attempt: attempt + 1, inMin: RETRY_MS[attempt] / 60_000 }, null);
    setTimeout(() => { settleSector(areaId, attempt + 1).catch((e) => console.warn("[sectors] retry failed:", (e as Error).message)); }, RETRY_MS[attempt]);
    return { name, realTargets: 0, final: false };
  }
  let realTargets = 0;
  if (pois && pois.length >= 3 && !get("SELECT 1 FROM targets WHERE area_id=? AND kind NOT IN ('checkpoint','waypoint')", areaId)) {
    for (const p of pois) {
      run(`INSERT OR IGNORE INTO targets(id,area_id,name,kind,lat,lng,approach_radius_m,safe_start,safe_end,capacity,state,observation,observation_answer) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        `${areaId}-${uid().slice(0, 8)}`, areaId, p.name, p.kind, p.lat, p.lng, 45, 6, 21, 4, "ACTIVE", "", "");
      realTargets++;
    }
    // Retire waypoints that are not already in play; real places are better fiction.
    run("UPDATE targets SET state='RETIRED' WHERE area_id=? AND kind IN ('checkpoint','waypoint') AND id NOT IN (SELECT target_id FROM missions WHERE target_id IS NOT NULL AND state IN ('pool','offered','accepted','active'))", areaId);
  }
  if (!get("SELECT 1 FROM targets WHERE area_id=? AND state='ACTIVE'", areaId)) await layWaypoints(areaId);
  logEvent("sector.settled", "director", { areaId, name, realTargets, poisFound: pois?.length ?? null, attempt }, null);
  return { name, realTargets, final: true };
}

export function sectorSummary() {
  return all<AreaRow & { targets: number; operatives: number }>(
    `SELECT a.*, (SELECT COUNT(*) FROM targets t WHERE t.area_id=a.id AND t.state='ACTIVE') targets,
            (SELECT COUNT(*) FROM presence p WHERE p.area_id=a.id AND p.expires_at>?) operatives FROM areas a`, now());
}
