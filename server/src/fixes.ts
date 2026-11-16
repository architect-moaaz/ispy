import { all, db, get, now, run } from "./db.ts";
import { local } from "./clock.ts";

/**
 * Where operatives have been: every field fix the server sees (check-in, heartbeat, scan), kept for
 * two weeks. Presence only remembers the last one. From this come the morning wire's idea of your
 * routine and the burn notice's cold trail.
 */
db.exec(`CREATE TABLE IF NOT EXISTS player_fixes (
  id INTEGER PRIMARY KEY AUTOINCREMENT, player_id TEXT NOT NULL, lat REAL NOT NULL, lng REAL NOT NULL, at TEXT NOT NULL
)`);
db.exec("CREATE INDEX IF NOT EXISTS player_fixes_pa ON player_fixes(player_id, at)");

export interface Fix { lat: number; lng: number; at: string }
const KEEP_MS = 14 * 86_400_000;
let lastPrune = 0;

export function log(playerId: string, lat: number, lng: number) {
  // One a minute per operative is plenty for a routine; heartbeats come faster with a mission live.
  const last = get<{ at: string }>("SELECT at FROM player_fixes WHERE player_id=? ORDER BY id DESC LIMIT 1", playerId);
  if (last && Date.now() - Date.parse(last.at) < 45_000) return;
  run("INSERT INTO player_fixes(player_id,lat,lng,at) VALUES(?,?,?,?)", playerId, lat, lng, now());
  if (Date.now() - lastPrune > 3_600_000) { run("DELETE FROM player_fixes WHERE at<?", new Date(Date.now() - KEEP_MS).toISOString()); lastPrune = Date.now(); }
}

export const recent = (playerId: string, sinceMs: number): Fix[] =>
  all<Fix>("SELECT lat,lng,at FROM player_fixes WHERE player_id=? AND at>? ORDER BY id", playerId, new Date(Date.now() - sinceMs).toISOString());

export const latest = (playerId: string): Fix | undefined => get<Fix>("SELECT lat,lng,at FROM player_fixes WHERE player_id=? ORDER BY id DESC LIMIT 1", playerId);

/**
 * The operative's morning ground: the 100 m cell they are seen in most between 06:00 and 11:00 over
 * the last two weeks, else the cell they are seen in most at any hour, else nothing. The centre is
 * the mean of that cell's fixes.
 */
export function routineAnchor(playerId: string): { lat: number; lng: number; mornings: boolean } | null {
  const fixes = recent(playerId, KEEP_MS);
  if (!fixes.length) return null;
  const morning = fixes.filter((f) => { const h = local(new Date(f.at)).getUTCHours(); return h >= 6 && h < 11; });
  const pool = morning.length >= 3 ? morning : fixes;
  const cells = new Map<string, Fix[]>();
  for (const f of pool) { const k = `${Math.round(f.lat / 0.0009)}:${Math.round(f.lng / 0.0009)}`; (cells.get(k) ?? cells.set(k, []).get(k)!).push(f); }
  const best = [...cells.values()].sort((a, b) => b.length - a.length)[0];
  return { lat: best.reduce((s, f) => s + f.lat, 0) / best.length, lng: best.reduce((s, f) => s + f.lng, 0) / best.length, mornings: pool === morning };
}
