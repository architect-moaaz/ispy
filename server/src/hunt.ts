import type { FactionId } from "@ispy/shared";
import { all, db, get, logEvent, now, run, uid, worldGet, worldSet } from "./db.ts";
import { FACTIONS, factionById } from "./content.ts";
import { award } from "./rewards.ts";
import { distanceM } from "./geo.ts";
import { pick } from "./puzzles.ts";
import { hhmm, localHour, monthKey, weekKey } from "./clock.ts";
import { H } from "./hooks.ts";
import * as fixes from "./fixes.ts";

/**
 * The Burn Notice Week. Once a month one operative is burned: their codename and agency are leaked
 * to everyone for seven days, and their cold trail (where they were an hour or more ago, to a hundred
 * metres) is on every rival's board. Rivals who get close feel it warm up; the burned operative gets
 * a push each time someone comes within a hundred metres ("You were made"). Within fifty metres of
 * them, a rival can call it: caught. Survive the week: a Ghost, with the mark to prove it.
 *
 * Nobody's live position is ever shown. The hunter only learns "close" or "not close", and only when
 * they are already within a hundred metres; the trail is an hour stale and gridded.
 */
db.exec(`CREATE TABLE IF NOT EXISTS hunts (
  id TEXT PRIMARY KEY, month TEXT NOT NULL, player_id TEXT NOT NULL, faction_id TEXT NOT NULL, starts_at TEXT NOT NULL, ends_at TEXT NOT NULL,
  state TEXT NOT NULL, caught_by TEXT, caught_at TEXT, resolved_at TEXT
)`);
db.exec(`CREATE TABLE IF NOT EXISTS hunt_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT, hunt_id TEXT NOT NULL, hunter_id TEXT NOT NULL, distance_m INTEGER NOT NULL, kind TEXT NOT NULL, at TEXT NOT NULL
)`);
try { db.exec("ALTER TABLE players ADD COLUMN ghost INTEGER NOT NULL DEFAULT 0"); } catch { /* exists */ }

export interface HuntRow { id: string; month: string; player_id: string; faction_id: FactionId; starts_at: string; ends_at: string; state: "live" | "survived" | "caught"; caught_by: string | null; caught_at: string | null; resolved_at: string | null }

const DAYS = 7;
const WARM_M = 100, CATCH_M = 50;
const FRESH_MS = 10 * 60_000; // a fix this old still counts as "where they are"
const CALL_GAP_MS = 30 * 60_000; // one close call per hunter per half hour
const EXPOSE_GAP_MS = 10 * 60_000; // one call per hunter per ten minutes, so the button is not a radar
const TRAIL_LAG_MS = 60 * 60_000, TRAIL_SPAN_MS = 6 * 60 * 60_000;

export const live = () => get<HuntRow>("SELECT * FROM hunts WHERE state='live' AND ends_at>? ORDER BY starts_at DESC LIMIT 1", now());

/** Once a minute from the Director: start the month's hunt, end the one that ran its week. */
export function sweep() {
  const month = monthKey();
  if (localHour() >= 9 && worldGet("hunt_month", "") !== month && !live()) {
    // Anyone recruited and seen in the field this month or last; prefer someone with a record.
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const cands = all<{ id: string; faction_id: FactionId; codename: string; xp: number }>(
      "SELECT id, faction_id, codename, xp FROM players WHERE faction_id IS NOT NULL AND id IN (SELECT DISTINCT player_id FROM player_fixes WHERE at>?) AND id NOT IN (SELECT player_id FROM hunts WHERE starts_at>?)",
      since, new Date(Date.now() - 90 * 86_400_000).toISOString());
    // A hunt needs hunters: at least two others in the field lately.
    const others = get<{ n: number }>("SELECT COUNT(DISTINCT player_id) n FROM player_fixes WHERE at>?", since)!.n;
    if (cands.length && others >= 3) {
      const pool = cands.filter((c) => c.xp >= 400).length ? cands.filter((c) => c.xp >= 400) : cands;
      const who = pick(pool, month);
      start(who.id, who.faction_id, who.codename, month);
      worldSet("hunt_month", month);
    }
  }
  const h = get<HuntRow>("SELECT * FROM hunts WHERE state='live' AND ends_at<=?", now());
  if (h) resolve(h, "survived", null);
}

function start(playerId: string, factionId: FactionId, codename: string, month: string) {
  const id = uid();
  const ends = new Date(Date.now() + DAYS * 86_400_000).toISOString();
  run("INSERT INTO hunts(id,month,player_id,faction_id,starts_at,ends_at,state) VALUES(?,?,?,?,?,?,?)", id, month, playerId, factionId, now(), ends, "live");
  // Their agency is known to every rival for the week: the map's contacts show the colour.
  for (const f of FACTIONS) if (f.id !== factionId) run("INSERT INTO effects(player_id,kind,until,at) VALUES(?,?,?,?) ON CONFLICT(player_id,kind) DO UPDATE SET until=excluded.until, at=excluded.at", playerId, `exposed:${f.id}`, ends, now());
  const f = factionById(factionId);
  run("INSERT INTO dispatches(id,kind,headline,body,faction_id,source,at) VALUES(?,?,?,?,?,?,?)", uid(), "news", `Burn notice: ${codename.toUpperCase()} of ${f.name}`, `A file leaked overnight. ${codename.toUpperCase()}'s codename and agency are known to all three services for seven days, and their trail is on every board. Rivals: get within fifty metres and call it. ${codename.toUpperCase()}: survive the week and nobody will ever touch you again.`, null, "director", now());
  logEvent("hunt.started", "director", { huntId: id, codename, factionId, endsAt: ends }, null);
  logEvent("hunt.burned", "director", { huntId: id, endsAt: ends }, playerId);
  H.chiefSay(playerId, pick([
    "Your file is out. Every service has your name for seven days. Change your mornings, keep moving, trust nobody in the street. Survive it and you are a Ghost.",
    "Burn notice. Someone leaked you. For a week your trail is public and rivals are paid to find you. Do not go where you usually go.",
  ], id), "burn notice", true);
}

function resolve(h: HuntRow, state: "survived" | "caught", hunterId: string | null) {
  run("UPDATE hunts SET state=?, caught_by=?, caught_at=?, resolved_at=? WHERE id=?", state, hunterId, hunterId ? now() : null, now(), h.id);
  for (const f of FACTIONS) run("DELETE FROM effects WHERE player_id=? AND kind=?", h.player_id, `exposed:${f.id}`);
  const codename = get<{ codename: string }>("SELECT codename FROM players WHERE id=?", h.player_id)?.codename ?? "the operative";
  if (state === "survived") {
    run("UPDATE players SET ghost=1 WHERE id=?", h.player_id);
    run("INSERT OR IGNORE INTO titles(player_id,title,area_id,week,at) VALUES(?,?,?,?,?)", h.player_id, "Ghost", null, weekKey(), now());
    award(h.player_id, 300, 3, "survived the burn notice", 30);
    run("INSERT INTO dispatches(id,kind,headline,body,faction_id,source,at) VALUES(?,?,?,?,?,?,?)", uid(), "news", `${codename.toUpperCase()} is a Ghost`, `Seven days with a name on every board, and nobody got within fifty metres. ${codename.toUpperCase()} of ${factionById(h.faction_id).name} walks out of the burn notice untouched.`, null, "director", now());
    H.chiefSay(h.player_id, "Seven days. Nobody laid a hand on you. You are a Ghost now; it shows on you, and it always will.", "burn notice survived", true);
  } else {
    const hunter = get<{ codename: string; faction_id: FactionId }>("SELECT codename, faction_id FROM players WHERE id=?", hunterId!)!;
    award(hunterId!, 400, 2, `caught ${codename}`, 25);
    award(h.player_id, 0, -3, "caught in the burn notice");
    run("INSERT INTO dispatches(id,kind,headline,body,faction_id,source,at) VALUES(?,?,?,?,?,?,?)", uid(), "news", `${codename.toUpperCase()} was made`, `${hunter.codename.toUpperCase()} of ${factionById(hunter.faction_id).name} closed to fifty metres and called it. The burn notice is over; so is ${codename.toUpperCase()}'s quiet week.`, null, "director", now());
    H.chiefSay(h.player_id, `${hunter.codename.toUpperCase()} made you at ${hhmm(now())}. It is over, and it cost you. Learn their face.`, "caught", true);
    H.chiefSay(hunterId!, `Clean. ${codename.toUpperCase()} is burned for good and the services know it was you.`, "caught the burned", true);
  }
  logEvent("hunt.resolved", "director", { huntId: h.id, codename, state, by: hunterId ? get<{ codename: string }>("SELECT codename FROM players WHERE id=?", hunterId)?.codename : null }, null);
}

/** A hunter's own fix landed: are they close to the burned operative? Called from the fix log. */
export function onFix(playerId: string, lat: number, lng: number) {
  const h = live();
  if (!h || h.player_id === playerId) return;
  const mine = get<{ faction_id: FactionId }>("SELECT faction_id FROM players WHERE id=?", playerId);
  if (!mine?.faction_id || mine.faction_id === h.faction_id) return; // own agency does not hunt its own
  const them = fixes.latest(h.player_id);
  if (!them || Date.now() - Date.parse(them.at) > FRESH_MS) return;
  const d = distanceM(lat, lng, them.lat, them.lng);
  if (d > WARM_M) return;
  const last = get<{ at: string }>("SELECT at FROM hunt_calls WHERE hunt_id=? AND hunter_id=? AND kind='close' ORDER BY id DESC LIMIT 1", h.id, playerId);
  if (last && Date.now() - Date.parse(last.at) < CALL_GAP_MS) return;
  run("INSERT INTO hunt_calls(hunt_id,hunter_id,distance_m,kind,at) VALUES(?,?,?,?,?)", h.id, playerId, Math.round(d), "close", now());
  logEvent("hunt.close_call", "verifier", { huntId: h.id, at: hhmm(now()) }, h.player_id);
  logEvent("hunt.warm", "verifier", { huntId: h.id }, playerId);
}

/** The hunter calls it. Within fifty metres of a fresh fix: caught. Otherwise "cold", and a ten-minute wait. */
export function expose(playerId: string, lat: number, lng: number): { ok: boolean; reason?: string; warm?: boolean; caught?: boolean } {
  const h = live();
  if (!h) return { ok: false, reason: "No burn notice is live." };
  if (h.player_id === playerId) return { ok: false, reason: "You are the one they are looking for." };
  const mine = get<{ faction_id: FactionId }>("SELECT faction_id FROM players WHERE id=?", playerId);
  if (mine?.faction_id === h.faction_id) return { ok: false, reason: "Your own agency. Leave it." };
  const last = get<{ at: string }>("SELECT at FROM hunt_calls WHERE hunt_id=? AND hunter_id=? AND kind='call' ORDER BY id DESC LIMIT 1", h.id, playerId);
  if (last && Date.now() - Date.parse(last.at) < EXPOSE_GAP_MS) return { ok: false, reason: `You called it ${Math.round((Date.now() - Date.parse(last.at)) / 60_000)} min ago. Ten minutes between calls.` };
  const them = fixes.latest(h.player_id);
  const fresh = !!them && Date.now() - Date.parse(them.at) <= 5 * 60_000;
  const d = them ? distanceM(lat, lng, them.lat, them.lng) : Infinity;
  run("INSERT INTO hunt_calls(hunt_id,hunter_id,distance_m,kind,at) VALUES(?,?,?,?,?)", h.id, playerId, Number.isFinite(d) ? Math.round(d) : 99_999, "call", now());
  if (fresh && d <= CATCH_M) { resolve(h, "caught", playerId); return { ok: true, caught: true }; }
  logEvent("hunt.close_call", "verifier", { huntId: h.id, at: hhmm(now()), called: true }, h.player_id);
  return { ok: true, caught: false, warm: fresh && d <= WARM_M, reason: fresh && d <= WARM_M ? "Close. Not close enough." : "Nothing here. They were not where you thought." };
}

/** The board's view: the trail for hunters, the close calls for the burned. */
export function view(playerId: string | null) {
  const h = live();
  if (!h) {
    const lastDone = get<HuntRow>("SELECT * FROM hunts WHERE state<>'live' ORDER BY resolved_at DESC LIMIT 1");
    return { hunt: null, last: lastDone ? { codename: get<{ codename: string }>("SELECT codename FROM players WHERE id=?", lastDone.player_id)?.codename ?? "", state: lastDone.state, at: lastDone.resolved_at } : null };
  }
  const p = get<{ codename: string }>("SELECT codename FROM players WHERE id=?", h.player_id)!;
  const youAreIt = playerId === h.player_id;
  const calls = all<{ at: string; kind: string; distance_m: number }>("SELECT at, kind, distance_m FROM hunt_calls WHERE hunt_id=? ORDER BY id DESC LIMIT 12", h.id);
  const trail = youAreIt ? [] : (() => {
    const to = Date.now() - TRAIL_LAG_MS, from = to - TRAIL_SPAN_MS;
    const pts = all<{ lat: number; lng: number; at: string }>("SELECT lat,lng,at FROM player_fixes WHERE player_id=? AND at>? AND at<? ORDER BY id", h.player_id, new Date(from).toISOString(), new Date(to).toISOString());
    const out: { lat: number; lng: number; at: string }[] = [];
    let lastAt = 0;
    for (const f of pts) { const t = Date.parse(f.at); if (t - lastAt < 15 * 60_000) continue; lastAt = t; out.push({ lat: Math.round(f.lat / 0.0009) * 0.0009, lng: Math.round(f.lng / 0.0009) * 0.0009, at: f.at }); }
    return out.slice(-12);
  })();
  const seen = fixes.latest(h.player_id);
  return {
    hunt: {
      id: h.id, codename: p.codename, factionId: h.faction_id, endsAt: h.ends_at, youAreIt,
      yourAgency: playerId ? get<{ faction_id: FactionId }>("SELECT faction_id FROM players WHERE id=?", playerId)?.faction_id === h.faction_id : false,
      closeCalls: calls.filter((c) => c.kind === "close" || c.kind === "call").map((c) => ({ at: c.at, called: c.kind === "call" })),
      trail, lastSeenAt: seen && Date.now() - Date.parse(seen.at) > TRAIL_LAG_MS ? seen.at : trail.at(-1)?.at ?? null,
    },
    last: null,
  };
}

/** Admin: burn a named operative now, for testing. */
export function burnNow(codename: string, days = DAYS): { ok: boolean; reason?: string } {
  const p = get<{ id: string; faction_id: FactionId }>("SELECT id, faction_id FROM players WHERE codename=?", codename);
  if (!p?.faction_id) return { ok: false, reason: "no such recruited player" };
  if (live()) return { ok: false, reason: "a hunt is already live" };
  start(p.id, p.faction_id, codename, monthKey());
  if (days !== DAYS) run("UPDATE hunts SET ends_at=? WHERE player_id=? AND state='live'", new Date(Date.now() + days * 86_400_000).toISOString(), p.id);
  return { ok: true };
}
