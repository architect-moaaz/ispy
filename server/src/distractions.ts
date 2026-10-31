import type { FactionId } from "@ispy/shared";
import { all, get, run, now, uid, json, parse, logEvent, db } from "./db.ts";
import { FACTIONS, PERSONAS, factionById } from "./content.ts";
import { pick } from "./puzzles.ts";
import { award } from "./rewards.ts";

/**
 * Distractions: an operative plants a fake mission at a public site in their sector. Their own
 * agency, their chief and the Director know it is bait; every rival agency sees an ordinary order
 * there and, if they take it, walks for almost nothing while the planter gets paid. Three per
 * operative per day (a hook for later monetisation).
 */
db.exec(`CREATE TABLE IF NOT EXISTS distractions (
  id TEXT PRIMARY KEY, player_id TEXT NOT NULL, faction_id TEXT NOT NULL, area_id TEXT NOT NULL, target_id TEXT NOT NULL, target_name TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'live', created_at TEXT NOT NULL, expires_at TEXT NOT NULL, sprung_by TEXT, sprung_at TEXT, bites INTEGER NOT NULL DEFAULT 0
)`);

export const DAILY_CAP = 3;
const TTL_MS = 2 * 60 * 60_000;

export type Spawner = (factionId: FactionId, areaId: string, targetId: string, distractionId: string, brief: string) => void;
let spawner: Spawner | null = null;
export const registerSpawner = (fn: Spawner) => { spawner = fn; };

export const leftToday = (playerId: string) => Math.max(0, DAILY_CAP - get<{ n: number }>("SELECT COUNT(*) n FROM distractions WHERE player_id=? AND created_at>?", playerId, new Date(Date.now() - 86_400_000).toISOString())!.n);

export function plant(playerId: string, factionId: FactionId | null, targetId: string): { ok: boolean; reason?: string; id?: string; left?: number; expiresAt?: string } {
  if (!factionId) return { ok: false, reason: "Join an agency first." };
  const pres = get<{ area_id: string | null; mode: string }>("SELECT area_id, mode FROM presence WHERE player_id=? AND expires_at>?", playerId, now());
  if (!pres?.area_id || pres.mode !== "field") return { ok: false, reason: "Plant it from the field." };
  const t = get<{ id: string; name: string; area_id: string }>("SELECT id, name, area_id FROM targets WHERE id=? AND state='ACTIVE'", targetId);
  if (!t || t.area_id !== pres.area_id) return { ok: false, reason: "Pick a site in your sector." };
  if (get("SELECT 1 FROM distractions WHERE target_id=? AND state='live' AND expires_at>?", targetId, now())) return { ok: false, reason: "There is already bait at that site." };
  const left = leftToday(playerId);
  if (left <= 0) return { ok: false, reason: "Three distractions a day. Tomorrow." };
  const id = uid();
  const expiresAt = new Date(Date.now() + TTL_MS).toISOString();
  run("INSERT INTO distractions(id,player_id,faction_id,area_id,target_id,target_name,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?)", id, playerId, factionId, t.area_id, t.id, t.name, now(), expiresAt);
  // Every rival agency gets an ordinary-looking order at that site, in their own chief's voice.
  for (const f of FACTIONS) {
    if (f.id === factionId) continue;
    const brief = pick(PERSONAS[f.chief].lines.RECON, `${id}:${f.id}`).replace("{target}", t.name);
    spawner?.(f.id, t.area_id, t.id, id, brief);
  }
  logEvent("distraction.planted", "player", { distractionId: id, target: t.name, targetId: t.id, faction: factionId, expiresAt }, playerId);
  return { ok: true, id, left: left - 1, expiresAt };
}

/** A rival verified the bait: they get crumbs, the planter gets paid, both chiefs hear. */
export function onBite(distractionId: string, victimId: string, victimFaction: FactionId | null, cost = 0): { planter: string; planterFaction: FactionId; target: string } | null {
  const d = get<{ id: string; player_id: string; faction_id: FactionId; target_name: string; state: string; expires_at: string }>("SELECT * FROM distractions WHERE id=?", distractionId);
  if (!d || d.faction_id === victimFaction) return null;
  run("UPDATE distractions SET bites=bites+1, sprung_by=COALESCE(sprung_by, ?), sprung_at=COALESCE(sprung_at, ?) WHERE id=?", victimId, now(), d.id);
  award(d.player_id, 60, 1, `distraction at ${d.target_name} took a bite`, 10);
  logEvent("distraction.sprung", "arbiter", { distractionId: d.id, target: d.target_name, by: get<{ codename: string }>("SELECT codename FROM players WHERE id=?", victimId)?.codename, byFaction: victimFaction, planterFaction: d.faction_id, cost }, d.player_id);
  return { planter: d.player_id, planterFaction: d.faction_id, target: d.target_name };
}

export function sweep() {
  for (const d of all<{ id: string }>("SELECT id FROM distractions WHERE state='live' AND expires_at<=?", now())) {
    run("UPDATE distractions SET state='expired' WHERE id=?", d.id);
    run("UPDATE missions SET state='expired', outcome='lost' WHERE state IN ('pool','offered') AND json_extract(params,'$.distractionId')=?", d.id);
  }
}

export interface DistractionView { id: string; targetId: string; targetName: string; by: string; mine: boolean; expiresAt: string; bites: number }
/** Live bait in a sector, for an operative's own agency (rivals never see this list). */
export function mineInArea(playerId: string, factionId: FactionId | null, areaId: string): DistractionView[] {
  if (!factionId) return [];
  return all<{ id: string; target_id: string; target_name: string; player_id: string; expires_at: string; bites: number }>(
    "SELECT id, target_id, target_name, player_id, expires_at, bites FROM distractions WHERE faction_id=? AND area_id=? AND state='live' AND expires_at>?", factionId, areaId, now())
    .map((d) => ({ id: d.id, targetId: d.target_id, targetName: d.target_name, by: get<{ codename: string }>("SELECT codename FROM players WHERE id=?", d.player_id)?.codename ?? "?", mine: d.player_id === playerId, expiresAt: d.expires_at, bites: d.bites }));
}
export function overview() {
  return all<{ id: string; faction_id: FactionId; target_name: string; player_id: string; state: string; bites: number; expires_at: string }>("SELECT * FROM distractions ORDER BY created_at DESC LIMIT 12")
    .map((d) => ({ faction: factionById(d.faction_id).name, target: d.target_name, by: get<{ codename: string }>("SELECT codename FROM players WHERE id=?", d.player_id)?.codename, state: d.state, bites: d.bites, expiresAt: d.expires_at }));
}
export const _json = json; export const _parse = parse;
