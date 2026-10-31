import type { TemplateId } from "@ispy/shared";
import { all, get, run, now, logEvent } from "./db.ts";
import { snapToPath } from "./sectors.ts";
import { distanceM } from "./geo.ts";
import { startOperationOn, brewCrisis } from "./engine.ts";
import * as crises from "./crises.ts";

/**
 * A line operation: the Director lays chaos along one corridor so a single operative can walk it out
 * and back. Six sites snapped to footpaths along a bearing from the operative's position (three out to
 * the far end, three on the way home), a six-link operation on them in order, and a crisis brewed on the
 * outbound sites so the other agencies converge on the same ground. Admin-only; a playtest tool.
 */
const OUT = [0.32, 0.66, 1.0];
const BACK = [0.78, 0.5, 0.14];

function dest(lat: number, lng: number, bearingDeg: number, metres: number) {
  const R = 6371000, br = (bearingDeg * Math.PI) / 180, la1 = (lat * Math.PI) / 180, lo1 = (lng * Math.PI) / 180, d = metres / R;
  const la2 = Math.asin(Math.sin(la1) * Math.cos(d) + Math.cos(la1) * Math.sin(d) * Math.cos(br));
  const lo2 = lo1 + Math.atan2(Math.sin(br) * Math.sin(d) * Math.cos(la1), Math.cos(d) - Math.sin(la1) * Math.sin(la2));
  return { lat: (la2 * 180) / Math.PI, lng: (lo2 * 180) / Math.PI };
}

export interface LineOpResult { ok: boolean; reason?: string; bearing?: number; sites?: { name: string; metres: number; lat: number; lng: number }[]; operation?: string | null; crisis?: string | null }

export async function layLine(opts: { codename: string; km?: number; bearing?: number; minutes?: number; kind?: string; lat?: number; lng?: number; theme?: string }): Promise<LineOpResult> {
  const p = get<{ id: string; codename: string; faction_id: string | null }>("SELECT id, codename, faction_id FROM players WHERE codename=?", opts.codename);
  if (!p?.faction_id) return { ok: false, reason: "No such operative, or no agency." };
  const pres = get<{ area_id: string | null; mode: string; last_lat: number | null; last_lng: number | null }>("SELECT area_id, mode, last_lat, last_lng FROM presence WHERE player_id=? AND expires_at>?", p.id, now());
  if (!pres?.area_id || pres.mode !== "field") return { ok: false, reason: `${p.codename} is not deployed to the field.` };
  const lat = opts.lat ?? pres.last_lat, lng = opts.lng ?? pres.last_lng;
  if (lat == null || lng == null) return { ok: false, reason: "No position fix yet. Open the map first." };
  const half = Math.max(300, Math.min(5000, ((opts.km ?? 2.5) * 1000) / 2));
  // Bearing: given, or the first of eight where both the far end and the midpoint sit on a footpath.
  let bearing = opts.bearing;
  if (bearing == null) {
    for (const b of [0, 45, 90, 135, 180, 225, 270, 315]) {
      const far = dest(lat, lng, b, half), mid = dest(lat, lng, b, half / 2);
      if ((await snapToPath(far.lat, far.lng)) && (await snapToPath(mid.lat, mid.lng))) { bearing = b; break; }
    }
    if (bearing == null) return { ok: false, reason: "No footpath reaches 1.25 km in any direction from here. Give a bearing." };
  }
  const stamp = now().slice(11, 16).replace(":", "");
  const sites: { id: string; name: string; kind: string; lat: number; lng: number; metres: number }[] = [];
  const fractions = [...OUT.map((f) => ({ f, leg: "out" })), ...BACK.map((f) => ({ f, leg: "back" }))];
  for (let i = 0; i < fractions.length; i++) {
    const { f, leg } = fractions[i];
    const pt = dest(lat, lng, bearing, half * f);
    const snapped = (await snapToPath(pt.lat, pt.lng)) ?? pt;
    const metres = Math.round(distanceM(lat, lng, snapped.lat, snapped.lng));
    const id = `${pres.area_id}-line-${stamp}-${i}`;
    const name = `${(snapped as any).name || "Footpath"} · ${metres} m ${leg === "out" ? "out" : "back"}`;
    run(`INSERT OR REPLACE INTO targets(id,area_id,name,kind,lat,lng,approach_radius_m,safe_start,safe_end,capacity,state,observation,observation_answer) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id, pres.area_id, name, "waypoint", snapped.lat, snapped.lng, 45, 0, 24, 4, "ACTIVE", "", "");
    sites.push({ id, name, kind: "waypoint", lat: snapped.lat, lng: snapped.lng, metres });
  }
  // Clear the operative's desk: open offers go, so the line is the only thing on the board.
  run("UPDATE offers SET state='expired' WHERE player_id=? AND state='open'", p.id);
  const shape: TemplateId[] = ["RECON", "DEAD_DROP", "EXTRACTION", "RECON", "DEAD_DROP", "EXTRACTION"];
  const theme = opts.theme ?? `A single corridor of ${(opts.km ?? 2.5).toFixed(1)} km: the operative walks it out and back, and everything that matters tonight sits on it.`;
  const chain = await startOperationOn(p.id, sites, shape, theme, `The ${bearing}° line`);
  // The chaos: a crisis on the three outbound sites, long enough to walk, so every agency moves on the corridor.
  const live = crises.activeCrisis(pres.area_id);
  if (live) await crises.resolve(live.id);
  const c = await brewCrisis(pres.area_id, { kind: opts.kind, minutes: Math.max(60, Math.min(240, opts.minutes ?? 150)), siteIds: sites.slice(0, 3).map((s) => s.id), theme: "It runs along one line tonight; nobody holds the far end without walking it." });
  logEvent("director.line_op", "owner", { codename: p.codename, bearing, km: opts.km ?? 2.5, sites: sites.map((s) => s.name), operation: chain?.name ?? null, crisis: c?.name ?? null }, p.id);
  return { ok: true, bearing, sites: sites.map((s) => ({ name: s.name, metres: s.metres, lat: s.lat, lng: s.lng })), operation: chain?.name ?? null, crisis: c?.name ?? null };
}
export const _all = all;
