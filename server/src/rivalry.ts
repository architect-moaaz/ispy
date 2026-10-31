import type { FactionId } from "@ispy/shared";
import { all, get, run, now, uid, json, parse, logEvent, db, worldGet, worldSet } from "./db.ts";
import { FACTIONS, factionById } from "./content.ts";
import { distanceM } from "./geo.ts";
import { award } from "./rewards.ts";

/**
 * The winning layer: face-offs (two rivals racing the same site, 90 seconds, named stamp), head-to-head
 * records that make a nemesis, the weekly sector ladder, titles people can read, and the chief's
 * operative of the week. None of it changes what counts as verified; it decides who gets to gloat.
 */
db.exec(`CREATE TABLE IF NOT EXISTS faceoffs (
  id TEXT PRIMARY KEY, target_id TEXT NOT NULL, area_id TEXT NOT NULL, a_player TEXT NOT NULL, b_player TEXT NOT NULL,
  a_faction TEXT NOT NULL, b_faction TEXT NOT NULL, started_at TEXT NOT NULL, ends_at TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'live', winner TEXT, resolved_at TEXT
)`);
db.exec(`CREATE TABLE IF NOT EXISTS rivalries (
  a_player TEXT NOT NULL, b_player TEXT NOT NULL, a_wins INTEGER NOT NULL DEFAULT 0, b_wins INTEGER NOT NULL DEFAULT 0, last_at TEXT NOT NULL,
  PRIMARY KEY(a_player, b_player)
)`);
db.exec(`CREATE TABLE IF NOT EXISTS titles (
  player_id TEXT NOT NULL, title TEXT NOT NULL, area_id TEXT, week TEXT NOT NULL, at TEXT NOT NULL,
  PRIMARY KEY(player_id, title, week)
)`);

export const FACEOFF_RADIUS_M = 300;
export const FACEOFF_MS = 90_000;

/** ISO week key, e.g. 2026-W44, in local time. */
export function weekKey(d = new Date()): string {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const w = Math.ceil((((t.getTime() - y0.getTime()) / 86_400_000) + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(w).padStart(2, "0")}`;
}
export function weekStartIso(d = new Date()): string {
  const x = new Date(d); const day = x.getDay() || 7; x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - day + 1); return x.toISOString();
}

export interface FaceoffView { id: string; targetId: string; targetName: string; rivalCodename: string; rivalFaction: FactionId; endsAt: string }

/**
 * Called from the Director's heartbeat. Two operatives of different agencies, both with an active field
 * mission on the same site, both inside 300 m of it: the clock starts for both.
 */
export function detectFaceoffs(): number {
  run("UPDATE faceoffs SET state='expired', resolved_at=? WHERE state='live' AND ends_at<=?", now(), now());
  const rows = all<{ target_id: string; area_id: string; player_id: string; faction_id: FactionId; lat: number | null; lng: number | null; tlat: number; tlng: number }>(
    `SELECT m.target_id, m.area_id, m.assignee_id player_id, m.faction_id, p.last_lat lat, p.last_lng lng, t.lat tlat, t.lng tlng
     FROM missions m JOIN presence p ON p.player_id=m.assignee_id AND p.expires_at>? JOIN targets t ON t.id=m.target_id
     WHERE m.state='active' AND m.mode='field' AND m.target_id IS NOT NULL AND p.last_lat IS NOT NULL`, now());
  const byTarget = new Map<string, typeof rows>();
  for (const r of rows) { if (distanceM(r.lat!, r.lng!, r.tlat, r.tlng) <= FACEOFF_RADIUS_M) byTarget.set(r.target_id, [...(byTarget.get(r.target_id) ?? []), r]); }
  let started = 0;
  for (const [targetId, near] of byTarget) {
    for (let i = 0; i < near.length; i++) for (let j = i + 1; j < near.length; j++) {
      const a = near[i], b = near[j];
      if (a.faction_id === b.faction_id) continue;
      if (get("SELECT 1 FROM faceoffs WHERE target_id=? AND state='live' AND ((a_player=? AND b_player=?) OR (a_player=? AND b_player=?))", targetId, a.player_id, b.player_id, b.player_id, a.player_id)) continue;
      // One face-off per pair per site per hour: no re-triggering while they circle each other.
      if (get("SELECT 1 FROM faceoffs WHERE target_id=? AND resolved_at>? AND ((a_player=? AND b_player=?) OR (a_player=? AND b_player=?))", targetId, new Date(Date.now() - 3600_000).toISOString(), a.player_id, b.player_id, b.player_id, a.player_id)) continue;
      const id = uid();
      const endsAt = new Date(Date.now() + FACEOFF_MS).toISOString();
      run("INSERT INTO faceoffs(id,target_id,area_id,a_player,b_player,a_faction,b_faction,started_at,ends_at) VALUES(?,?,?,?,?,?,?,?,?)", id, targetId, a.area_id, a.player_id, b.player_id, a.faction_id, b.faction_id, now(), endsAt);
      const tname = get<{ name: string }>("SELECT name FROM targets WHERE id=?", targetId)?.name ?? "the site";
      const ca = codename(a.player_id), cb = codename(b.player_id);
      logEvent("faceoff.started", "arbiter", { faceoffId: id, target: tname, targetId, rival: cb, rivalFaction: b.faction_id, endsAt }, a.player_id);
      logEvent("faceoff.started", "arbiter", { faceoffId: id, target: tname, targetId, rival: ca, rivalFaction: a.faction_id, endsAt }, b.player_id);
      started++;
    }
  }
  return started;
}

const codename = (id: string) => get<{ codename: string }>("SELECT codename FROM players WHERE id=?", id)?.codename ?? "unknown";

/** The live face-off this operative is in at this site, for the navigate response. */
export function liveFaceoffFor(playerId: string, targetId: string): FaceoffView | null {
  const f = get<{ id: string; target_id: string; a_player: string; b_player: string; a_faction: FactionId; b_faction: FactionId; ends_at: string }>(
    "SELECT * FROM faceoffs WHERE state='live' AND target_id=? AND (a_player=? OR b_player=?) AND ends_at>?", targetId, playerId, playerId, now());
  if (!f) return null;
  const rival = f.a_player === playerId ? f.b_player : f.a_player;
  return { id: f.id, targetId, targetName: get<{ name: string }>("SELECT name FROM targets WHERE id=?", targetId)?.name ?? "", rivalCodename: codename(rival), rivalFaction: f.a_player === playerId ? f.b_faction : f.a_faction, endsAt: f.ends_at };
}

/** A verification at a site: if a face-off is live there with this operative in it, they win it. Returns what to say. */
export function onVerified(playerId: string, factionId: FactionId | null, targetId: string): { won: boolean; rival: string; rivalFaction: FactionId; bonusXp: number } | null {
  const f = get<{ id: string; a_player: string; b_player: string; a_faction: FactionId; b_faction: FactionId; target_id: string }>(
    "SELECT * FROM faceoffs WHERE state='live' AND target_id=? AND (a_player=? OR b_player=?) AND ends_at>?", targetId, playerId, playerId, now());
  if (!f) return null;
  const rival = f.a_player === playerId ? f.b_player : f.a_player;
  const rivalFaction = f.a_player === playerId ? f.b_faction : f.a_faction;
  run("UPDATE faceoffs SET state='won', winner=?, resolved_at=? WHERE id=?", playerId, now(), f.id);
  recordRivalry(playerId, rival);
  const bonusXp = 80;
  award(playerId, bonusXp, 1, `face-off won vs ${codename(rival)}`, 10);
  const tname = get<{ name: string }>("SELECT name FROM targets WHERE id=?", targetId)?.name ?? "the site";
  logEvent("faceoff.resolved", "arbiter", { faceoffId: f.id, target: tname, outcome: "won", rival: codename(rival), rivalFaction, winner: codename(playerId), winnerFaction: factionId }, playerId);
  logEvent("faceoff.resolved", "arbiter", { faceoffId: f.id, target: tname, outcome: "lost", rival: codename(playerId), rivalFaction: factionId, winner: codename(playerId), winnerFaction: factionId }, rival);
  return { won: true, rival: codename(rival), rivalFaction, bonusXp };
}

function recordRivalry(winner: string, loser: string) {
  const [a, b] = [winner, loser].sort();
  const row = get<{ a_wins: number; b_wins: number }>("SELECT a_wins, b_wins FROM rivalries WHERE a_player=? AND b_player=?", a, b);
  const aw = (row?.a_wins ?? 0) + (winner === a ? 1 : 0), bw = (row?.b_wins ?? 0) + (winner === b ? 1 : 0);
  run("INSERT INTO rivalries(a_player,b_player,a_wins,b_wins,last_at) VALUES(?,?,?,?,?) ON CONFLICT(a_player,b_player) DO UPDATE SET a_wins=?, b_wins=?, last_at=?", a, b, aw, bw, now(), aw, bw, now());
}

export interface NemesisView { codename: string; factionId: FactionId; faction: string; wins: number; losses: number; lastAt: string }
/** The rival you have met most: face-offs first, then sites they took from you and you from them. */
export function nemesisOf(playerId: string): NemesisView | null {
  const rows = all<{ a_player: string; b_player: string; a_wins: number; b_wins: number; last_at: string }>("SELECT * FROM rivalries WHERE a_player=? OR b_player=? ORDER BY (a_wins+b_wins) DESC, last_at DESC LIMIT 1", playerId, playerId);
  const r = rows[0];
  if (!r) return null;
  const other = r.a_player === playerId ? r.b_player : r.a_player;
  const p = get<{ codename: string; faction_id: FactionId | null }>("SELECT codename, faction_id FROM players WHERE id=?", other);
  if (!p?.faction_id) return null;
  return { codename: p.codename, factionId: p.faction_id, faction: factionById(p.faction_id).name, wins: r.a_player === playerId ? r.a_wins : r.b_wins, losses: r.a_player === playerId ? r.b_wins : r.a_wins, lastAt: r.last_at };
}

export interface LadderRow { codename: string; factionId: FactionId; faction: string; score: number; held: number; captures: number; wins: number; title: string | null; you: boolean }
/** This week's ladder for a sector: sites held 5, face-off and contest wins 8, captures by rarity 1/2/4/8. */
export function ladder(areaId: string, playerId: string | null): { week: string; rows: LadderRow[]; yourRank: number | null } {
  const since = weekStartIso();
  const score = new Map<string, { held: number; captures: number; wins: number; score: number }>();
  const bump = (pid: string, k: "held" | "captures" | "wins", pts: number) => { const s = score.get(pid) ?? { held: 0, captures: 0, wins: 0, score: 0 }; s[k]++; s.score += pts; score.set(pid, s); };
  for (const r of all<{ player_id: string }>("SELECT l.player_id FROM target_locks l JOIN targets t ON t.id=l.target_id WHERE t.area_id=? AND l.at>=?", areaId, since)) bump(r.player_id, "held", 5);
  for (const r of all<{ winner: string }>("SELECT winner FROM faceoffs WHERE area_id=? AND state='won' AND resolved_at>=?", areaId, since)) bump(r.winner, "wins", 8);
  for (const r of all<{ assignee_id: string }>("SELECT assignee_id FROM missions WHERE area_id=? AND outcome='won' AND completed_at>=? AND assignee_id IS NOT NULL", areaId, since)) bump(r.assignee_id, "wins", 8);
  for (const r of all<{ captured_by: string; rarity: string }>("SELECT captured_by, rarity FROM signals WHERE area_id=? AND state='captured' AND captured_at>=?", areaId, since)) bump(r.captured_by, "captures", { common: 1, uncommon: 2, rare: 4, legendary: 8 }[r.rarity] ?? 1);
  const week = weekKey();
  const rows = [...score.entries()].map(([pid, s]) => {
    const p = get<{ codename: string; faction_id: FactionId | null }>("SELECT codename, faction_id FROM players WHERE id=?", pid);
    const title = get<{ title: string }>("SELECT title FROM titles WHERE player_id=? AND week=? ORDER BY at DESC LIMIT 1", pid, week)?.title ?? null;
    return p?.faction_id ? { codename: p.codename, factionId: p.faction_id, faction: factionById(p.faction_id).name, ...s, title, you: pid === playerId } : null;
  }).filter((x): x is LadderRow => !!x).sort((a, b) => b.score - a.score);
  const yourRank = playerId ? rows.findIndex((r) => r.you) + 1 || null : null;
  return { week, rows: rows.slice(0, 10), yourRank };
}

/** Titles for the week, recomputed on the Director's housekeeping; a title names the leader of one thing in one sector. */
export function awardTitles() {
  const week = weekKey();
  const since = weekStartIso();
  for (const a of all<{ id: string; name: string }>("SELECT id, name FROM areas")) {
    const give = (pid: string | undefined, title: string) => { if (pid) run("INSERT OR IGNORE INTO titles(player_id,title,area_id,week,at) VALUES(?,?,?,?,?)", pid, title, a.id, week, now()); };
    give(get<{ p: string }>("SELECT winner p FROM faceoffs WHERE area_id=? AND state='won' AND resolved_at>=? ORDER BY resolved_at ASC LIMIT 1", a.id, since)?.p, "First Blood");
    give(get<{ p: string }>("SELECT l.player_id p FROM target_locks l JOIN targets t ON t.id=l.target_id WHERE t.area_id=? AND l.at>=? GROUP BY l.player_id ORDER BY COUNT(*) DESC LIMIT 1", a.id, since)?.p, "Landlord");
    give(get<{ p: string }>("SELECT assignee_id p FROM missions WHERE area_id=? AND template_id='RECON' AND state='completed' AND completed_at>=? AND assignee_id IS NOT NULL GROUP BY assignee_id HAVING COUNT(*)>=3 ORDER BY COUNT(*) DESC LIMIT 1", a.id, since)?.p, `Ghost of ${a.name.split(" ")[0]}`);
    give(get<{ p: string }>("SELECT captured_by p FROM signals WHERE area_id=? AND state='captured' AND captured_at>=? AND (CAST(substr(captured_at,12,2) AS INTEGER) >= 14 OR CAST(substr(captured_at,12,2) AS INTEGER) < 1) GROUP BY captured_by HAVING COUNT(*)>=5 ORDER BY COUNT(*) DESC LIMIT 1", a.id, since)?.p, "Night Shift");
    give(get<{ p: string }>("SELECT winner p FROM faceoffs WHERE area_id=? AND state='won' AND resolved_at>=? GROUP BY winner HAVING COUNT(*)>=3 ORDER BY COUNT(*) DESC LIMIT 1", a.id, since)?.p, "Duellist");
  }
  const desk = get<{ p: string }>("SELECT assignee_id p FROM missions WHERE mode='desk' AND template_id='CIPHER' AND state='completed' AND completed_at>=? AND assignee_id IS NOT NULL GROUP BY assignee_id HAVING COUNT(*)>=5 ORDER BY COUNT(*) DESC LIMIT 1", since)?.p;
  if (desk) run("INSERT OR IGNORE INTO titles(player_id,title,area_id,week,at) VALUES(?,?,?,?,?)", desk, "Keyholder", null, week, now());
}

export function titlesOf(playerId: string): { title: string; week: string; area: string | null }[] {
  return all<{ title: string; week: string; area_id: string | null }>("SELECT title, week, area_id FROM titles WHERE player_id=? ORDER BY at DESC LIMIT 12", playerId)
    .map((t) => ({ title: t.title, week: t.week, area: t.area_id ? get<{ name: string }>("SELECT name FROM areas WHERE id=?", t.area_id)?.name ?? null : null }));
}

/**
 * Operative of the week, per agency: the top of last week's ladders among that agency's people.
 * Runs once per week on the Director's housekeeping; stored as a title and announced by the chief.
 */
export function operativeOfTheWeek(): { factionId: FactionId; playerId: string; codename: string; score: number }[] {
  const week = weekKey();
  if (worldGet("otw_week", "") === week) return [];
  worldSet("otw_week", week);
  const lastWeekStart = new Date(Date.parse(weekStartIso()) - 7 * 86_400_000).toISOString();
  const lastWeekEnd = weekStartIso();
  const totals = new Map<string, number>();
  const bump = (pid: string, pts: number) => totals.set(pid, (totals.get(pid) ?? 0) + pts);
  for (const r of all<{ player_id: string }>("SELECT player_id FROM target_locks WHERE at>=? AND at<?", lastWeekStart, lastWeekEnd)) bump(r.player_id, 5);
  for (const r of all<{ winner: string }>("SELECT winner FROM faceoffs WHERE state='won' AND resolved_at>=? AND resolved_at<?", lastWeekStart, lastWeekEnd)) bump(r.winner, 8);
  for (const r of all<{ captured_by: string; rarity: string }>("SELECT captured_by, rarity FROM signals WHERE state='captured' AND captured_at>=? AND captured_at<?", lastWeekStart, lastWeekEnd)) bump(r.captured_by, { common: 1, uncommon: 2, rare: 4, legendary: 8 }[r.rarity] ?? 1);
  for (const r of all<{ assignee_id: string }>("SELECT assignee_id FROM missions WHERE state='completed' AND completed_at>=? AND completed_at<? AND assignee_id IS NOT NULL", lastWeekStart, lastWeekEnd)) bump(r.assignee_id, 3);
  const out: { factionId: FactionId; playerId: string; codename: string; score: number }[] = [];
  for (const f of FACTIONS) {
    const best = [...totals.entries()].map(([pid, score]) => ({ pid, score, p: get<{ codename: string; faction_id: FactionId | null }>("SELECT codename, faction_id FROM players WHERE id=?", pid) }))
      .filter((x) => x.p?.faction_id === f.id).sort((a, b) => b.score - a.score)[0];
    if (!best || best.score <= 0) continue;
    run("INSERT OR IGNORE INTO titles(player_id,title,area_id,week,at) VALUES(?,?,?,?,?)", best.pid, "Operative of the Week", null, week, now());
    out.push({ factionId: f.id, playerId: best.pid, codename: best.p!.codename, score: best.score });
    logEvent("otw.named", "chief:" + f.chief, { codename: best.p!.codename, score: best.score, week }, best.pid);
  }
  return out;
}
export const currentOtw = (factionId: FactionId) => get<{ codename: string }>(
  "SELECT pl.codename FROM titles t JOIN players pl ON pl.id=t.player_id WHERE t.title='Operative of the Week' AND t.week=? AND pl.faction_id=? ORDER BY t.at DESC LIMIT 1", weekKey(), factionId)?.codename ?? null;

export function rivalryOverview() {
  return {
    liveFaceoffs: all<{ id: string; target_id: string; a_player: string; b_player: string; ends_at: string }>("SELECT id, target_id, a_player, b_player, ends_at FROM faceoffs WHERE state='live' AND ends_at>?", now())
      .map((f) => ({ id: f.id, target: get<{ name: string }>("SELECT name FROM targets WHERE id=?", f.target_id)?.name, a: codename(f.a_player), b: codename(f.b_player), endsAt: f.ends_at })),
    faceoffsToday: get<{ n: number }>("SELECT COUNT(*) n FROM faceoffs WHERE started_at>=?", now().slice(0, 10))!.n,
    titlesThisWeek: all<{ codename: string; title: string }>("SELECT pl.codename, t.title FROM titles t JOIN players pl ON pl.id=t.player_id WHERE t.week=? ORDER BY t.at DESC LIMIT 12", weekKey()),
  };
}
export const _json = json;
export const _parse = parse;
