import type { FactionId } from "@ispy/shared";
import { all, db, get, logEvent, now, run, uid, worldGet, worldSet } from "./db.ts";
import { FACTIONS, factionById } from "./content.ts";
import { distanceM } from "./geo.ts";
import { weekKey, weekStartIso } from "./clock.ts";

/**
 * Your street, your agency. Every sector (a named neighbourhood, once the survey has run) belongs to
 * the agency that held the most sites there last week. Holding a site this week scores a point
 * toward next week's count. Sunday night the map redraws: owners change hands, the Director files a
 * report ("Bandra West fell to CIPHER by 3 drops"), and everyone hears. Owned ground shows in the
 * owner's colour on the satellite map and lights the 3D street's lamps.
 */
db.exec(`CREATE TABLE IF NOT EXISTS territory_points (week TEXT NOT NULL, area_id TEXT NOT NULL, faction_id TEXT NOT NULL, points INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(week, area_id, faction_id))`);
db.exec(`CREATE TABLE IF NOT EXISTS territory_owners (area_id TEXT NOT NULL, week TEXT NOT NULL, faction_id TEXT, points INTEGER NOT NULL, margin INTEGER NOT NULL, flipped INTEGER NOT NULL, at TEXT NOT NULL, PRIMARY KEY(area_id, week))`);

/** A site held in a sector: a point toward this week's count. Called from the engine when a lock lands. */
export function onHeld(areaId: string, factionId: FactionId, points = 1) {
  run("INSERT INTO territory_points(week,area_id,faction_id,points) VALUES(?,?,?,?) ON CONFLICT(week,area_id,faction_id) DO UPDATE SET points=points+excluded.points", weekKey(), areaId, factionId, points);
}

export function standings(areaId: string, week = weekKey()): Record<FactionId, number> {
  const out = Object.fromEntries(FACTIONS.map((f) => [f.id, 0])) as Record<FactionId, number>;
  for (const r of all<{ faction_id: FactionId; points: number }>("SELECT faction_id, points FROM territory_points WHERE week=? AND area_id=?", week, areaId)) out[r.faction_id] = r.points;
  return out;
}
/** Who owns the sector now: the last finalized week's owner. */
export function owner(areaId: string): { factionId: FactionId | null; since: string | null; margin: number } {
  const r = get<{ faction_id: FactionId | null; at: string; margin: number }>("SELECT faction_id, at, margin FROM territory_owners WHERE area_id=? ORDER BY week DESC LIMIT 1", areaId);
  if (!r?.faction_id) return { factionId: null, since: null, margin: 0 };
  // Since when: walk back while the owner is the same.
  const runRows = all<{ faction_id: FactionId | null; at: string }>("SELECT faction_id, at FROM territory_owners WHERE area_id=? ORDER BY week DESC", areaId);
  let since = r.at;
  for (const x of runRows) { if (x.faction_id === r.faction_id) since = x.at; else break; }
  return { factionId: r.faction_id, since, margin: r.margin };
}

/** Once a minute from the Director: when the players' week has turned, settle last week's count. */
export function sweep(): string[] {
  const week = weekKey();
  const last = worldGet("territory_week", "");
  if (last === week) return [];
  worldSet("territory_week", week);
  if (!last) return []; // first run: nothing to settle
  const lines: string[] = [];
  for (const a of all<{ id: string; name: string }>("SELECT id, name FROM areas")) {
    const s = standings(a.id, last);
    const ranked = (Object.entries(s) as [FactionId, number][]).sort((x, y) => y[1] - x[1]);
    const prev = owner(a.id).factionId;
    const [top, pts] = ranked[0];
    const margin = pts - (ranked[1]?.[1] ?? 0);
    // Nobody scored, or a dead heat: the holder keeps it.
    const next: FactionId | null = pts === 0 || margin === 0 ? prev : top;
    const flipped = !!next && next !== prev;
    run("INSERT OR REPLACE INTO territory_owners(area_id,week,faction_id,points,margin,flipped,at) VALUES(?,?,?,?,?,?,?)", a.id, last, next, pts, margin, flipped ? 1 : 0, now());
    if (!next) continue;
    const f = factionById(next);
    if (flipped) lines.push(prev ? `${a.name} fell to ${f.name} by ${margin} drop${margin === 1 ? "" : "s"}.` : `${f.name} took ${a.name} with ${pts} drop${pts === 1 ? "" : "s"}.`);
    else if (pts > 0) lines.push(`${f.name} held ${a.name}${margin ? ` by ${margin}` : ""}.`);
  }
  if (lines.length) {
    run("INSERT INTO dispatches(id,kind,headline,body,faction_id,source,at) VALUES(?,?,?,?,?,?,?)", uid(), "news", `The map redrew · week ${last.slice(-3)}`, lines.join(" "), null, "director", now());
    logEvent("territory.report", "director", { week: last, lines }, null);
  }
  return lines;
}

export interface TerritoryArea { id: string; name: string; lat: number; lng: number; radiusM: number; distanceM: number; owner: FactionId | null; ownerSince: string | null; standings: Record<FactionId, number>; leader: FactionId | null; yours: boolean }

/** The sectors around a point, with owners and this week's count. */
export function view(lat: number | null, lng: number | null, factionId: FactionId | null): { week: string; resetsAt: string; areas: TerritoryArea[]; report: string[] } {
  const areas = all<{ id: string; name: string; lat: number; lng: number; radius_m: number }>("SELECT id, name, lat, lng, radius_m FROM areas")
    .map((a) => {
      const s = standings(a.id);
      const ranked = (Object.entries(s) as [FactionId, number][]).sort((x, y) => y[1] - x[1]);
      const o = owner(a.id);
      return { id: a.id, name: a.name, lat: a.lat, lng: a.lng, radiusM: a.radius_m, distanceM: lat != null && lng != null ? Math.round(distanceM(lat, lng, a.lat, a.lng)) : 0, owner: o.factionId, ownerSince: o.since, standings: s, leader: ranked[0][1] > 0 && ranked[0][1] > (ranked[1]?.[1] ?? 0) ? ranked[0][0] : null, yours: !!factionId && o.factionId === factionId };
    })
    .sort((a, b) => a.distanceM - b.distanceM)
    .slice(0, 8);
  const report = get<{ payload: string }>("SELECT payload FROM events WHERE type='territory.report' ORDER BY id DESC LIMIT 1");
  // Next Monday 00:00 on the players' clock.
  const next = new Date(Date.parse(weekStartIso()) + 7 * 86_400_000);
  return { week: weekKey(), resetsAt: next.toISOString(), areas, report: report ? (JSON.parse(report.payload).lines ?? []) : [] };
}
