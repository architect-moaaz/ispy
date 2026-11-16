import type { ChiefId, FactionId } from "@ispy/shared";
import { all, db, get, logEvent, now, run, uid, worldGet, worldSet } from "./db.ts";
import { FACTIONS, factionById } from "./content.ts";
import { award } from "./rewards.ts";
import { distanceM } from "./geo.ts";
import { pick } from "./puzzles.ts";
import { dayKey, hhmm, localHour, prevDayKey } from "./clock.ts";
import { H } from "./hooks.ts";
import * as fixes from "./fixes.ts";

/**
 * The Morning Wire. Every morning the chief sends each operative one personal order near their
 * routine: a site a few hundred metres from where they are usually seen before work, a short window,
 * a small reward, and a word in character either way. Done, the streak grows. Missed, the chief says
 * so. Missed three mornings running, the chief goes cold and a rival chief slips a note onto the
 * channel. The order is a reserved recon: nobody else sees it, locks do not make it late.
 */
db.exec(`CREATE TABLE IF NOT EXISTS wires (
  id TEXT PRIMARY KEY, player_id TEXT NOT NULL, mission_id TEXT NOT NULL, day TEXT NOT NULL, state TEXT NOT NULL,
  target_id TEXT NOT NULL, sent_at TEXT NOT NULL, deadline TEXT NOT NULL, done_at TEXT, boosted INTEGER NOT NULL DEFAULT 0,
  UNIQUE(player_id, day)
)`);
try { db.exec("ALTER TABLE players ADD COLUMN wire_boost_day TEXT"); } catch { /* exists */ }

export interface WireRow { id: string; player_id: string; mission_id: string; day: string; state: "sent" | "done" | "missed"; target_id: string; sent_at: string; deadline: string; done_at: string | null; boosted: number }

const SEND_FROM = 7, SEND_UNTIL = 11; // local hours: wires go out in the morning only
const WINDOW_MS = 150 * 60_000; // two and a half hours to walk past it
const BONUS_XP = 60;
const NEAR_M = 600, FAR_M = 1400;

const LINES: Record<ChiefId, { send: string[]; done: string[]; missed: string[]; cold: string[]; boosted: string }> = {
  oracle: {
    send: ["Morning. {target}, before {by}. Blue chalk on the kerb. Confirm it and go about your day.", "{target}. Something was left there overnight. Walk past before {by}; note what you see."],
    done: ["Confirmed. You are reliable, and reliability is the whole job. {streak}", "Noted at {time}. The pattern holds. {streak}"],
    missed: ["The window at {target} closed at {by}. I will not ask why.", "Nothing from you at {target}. The morning is gone."],
    cold: ["Three mornings. I have stopped expecting you."],
    boosted: " Last night's desk work paid: this one counts half again.",
  },
  ghost: {
    send: ["Good morning, darling. {target}, before {by}. Don't look like you're looking.", "Something small at {target}. Be past it by {by}. Pretend it's a coincidence."],
    done: ["There you are. Nobody saw a thing. {streak}", "Lovely. In and out by {time}. {streak}"],
    missed: ["{target} came and went without you. Tragic, really.", "I waited at {target}. Figuratively. You did not come, literally."],
    cold: ["Three mornings. I shall stop sending flowers."],
    boosted: " You were up late with the ciphers; this one pays half again.",
  },
  nexus: {
    send: ["07:30 protocol. Node: {target}. Window closes {by}. Confirm presence.", "Daily sync: {target} before {by}. Minimal footprint."],
    done: ["Presence confirmed {time}. Sequence intact. {streak}", "Node cleared. The system runs because you do. {streak}"],
    missed: ["Window at {target} expired {by}. Sequence broken.", "No confirmation from {target}. Logged."],
    cold: ["Three consecutive misses. Heartbeat timeout."],
    boosted: " Desk night complete: reward multiplier 1.5 applied.",
  },
};
const COURT: Record<ChiefId, string> = {
  oracle: "This is ORACLE of RAVEN. Your chief has stopped calling. I noticed. We would not have.",
  ghost: "GHOST here. PHANTOM. Three quiet mornings, and nobody came looking for you. I would have.",
  nexus: "NEXUS, CIPHER. Your channel has gone silent on their side. Ours is open.",
};

/** Consecutive done days ending today or yesterday. */
export function streak(playerId: string): number {
  const rows = all<{ day: string; state: string }>("SELECT day, state FROM wires WHERE player_id=? ORDER BY day DESC LIMIT 60", playerId);
  let n = 0, day = dayKey();
  for (const r of rows) {
    if (r.day === day && r.state === "sent") { day = prevDayKey(day); continue; } // today still open: count back from yesterday
    if (r.day !== day) break;
    if (r.state !== "done") break;
    n++; day = prevDayKey(day);
  }
  return n;
}
const missedInRow = (playerId: string) => {
  let n = 0;
  for (const r of all<{ state: string }>("SELECT state FROM wires WHERE player_id=? AND state<>'sent' ORDER BY day DESC LIMIT 10", playerId)) { if (r.state === "missed") n++; else break; }
  return n;
};

interface TargetLite { id: string; area_id: string; name: string; lat: number; lng: number }

/** Where this morning's wire goes: near the routine, not somewhere they did this week. */
function pickSite(playerId: string, day: string): TargetLite | null {
  const anchor = fixes.routineAnchor(playerId) ?? (() => {
    const s = get<{ lat: number; lng: number }>("SELECT lat,lng FROM scans WHERE player_id=? ORDER BY id DESC LIMIT 1", playerId);
    return s ? { ...s, mornings: false } : null;
  })();
  if (!anchor) return null;
  const recent = new Set(all<{ target_id: string }>("SELECT target_id FROM missions WHERE assignee_id=? AND state='completed' AND completed_at>?", playerId, new Date(Date.now() - 7 * 86_400_000).toISOString()).map((r) => r.target_id));
  const cands = all<TargetLite>("SELECT id, area_id, name, lat, lng FROM targets WHERE state='ACTIVE' AND kind NOT IN ('test')")
    .map((t) => ({ t, d: distanceM(anchor.lat, anchor.lng, t.lat, t.lng) }))
    .filter((x) => x.d <= FAR_M && !recent.has(x.t.id))
    .sort((a, b) => a.d - b.d);
  if (!cands.length) return null;
  const near = cands.filter((x) => x.d <= NEAR_M);
  const from = (near.length ? near : cands.slice(0, 3)).map((x) => x.t);
  return pick(from, `${playerId}:${day}`);
}

/** Once a minute from the Director: send the morning's wires, close the ones that lapsed. */
export function sweep() {
  const day = dayKey();
  const h = localHour();
  if (h >= SEND_FROM && h < SEND_UNTIL && worldGet("wire_day", "") !== day) {
    // Everyone recruited who has been seen in the field in the last fortnight gets one.
    const players = all<{ id: string; faction_id: FactionId; codename: string; wire_boost_day: string | null }>(
      "SELECT id, faction_id, codename, wire_boost_day FROM players WHERE faction_id IS NOT NULL AND (id IN (SELECT DISTINCT player_id FROM player_fixes) OR id IN (SELECT DISTINCT player_id FROM scans))");
    let sent = 0;
    for (const p of players) {
      if (get("SELECT 1 FROM wires WHERE player_id=? AND day=?", p.id, day)) continue;
      const site = pickSite(p.id, day);
      if (!site) continue;
      const f = factionById(p.faction_id);
      const deadline = new Date(Date.now() + WINDOW_MS).toISOString();
      const boosted = p.wire_boost_day === day;
      const id = uid();
      const line = pick(LINES[f.chief].send, id).replace("{target}", site.name).replace("{by}", hhmm(deadline)) + (boosted ? LINES[f.chief].boosted : "");
      const missionId = H.spawnOrder({ factionId: f.id, areaId: site.area_id, template: "RECON", targetId: site.id, params: { wireId: id, needsObservation: false, crisisId: null }, title: "Morning wire", brief: line, reservedFor: p.id, ttlMs: WINDOW_MS, rewardXp: boosted ? 180 : 120 });
      if (!missionId) continue;
      run("INSERT INTO wires(id,player_id,mission_id,day,state,target_id,sent_at,deadline,boosted) VALUES(?,?,?,?,?,?,?,?,?)", id, p.id, missionId, day, "sent", site.id, now(), deadline, boosted ? 1 : 0);
      logEvent("wire.sent", `chief:${f.chief}`, { wireId: id, target: site.name, deadline, boosted }, p.id);
      H.chiefSay(p.id, line, "morning wire", true);
      sent++;
    }
    worldSet("wire_day", day);
    if (sent) console.log(`[wire] ${sent} morning wire(s) sent for ${day}`);
  }
  // Lapsed wires: the chief notices.
  for (const w of all<WireRow>("SELECT * FROM wires WHERE state='sent' AND deadline<?", now())) {
    run("UPDATE wires SET state='missed' WHERE id=?", w.id);
    run("UPDATE missions SET state='expired', outcome='expired' WHERE id=? AND state IN ('pool','offered','accepted','active')", w.mission_id);
    run("UPDATE offers SET state='expired' WHERE mission_id=? AND state='open'", w.mission_id);
    const p = get<{ faction_id: FactionId }>("SELECT faction_id FROM players WHERE id=?", w.player_id);
    if (!p?.faction_id) continue;
    const f = factionById(p.faction_id);
    const target = get<{ name: string }>("SELECT name FROM targets WHERE id=?", w.target_id)?.name ?? "the site";
    const misses = missedInRow(w.player_id);
    logEvent("wire.missed", `chief:${f.chief}`, { wireId: w.id, target, misses }, w.player_id);
    if (misses >= 3 && misses % 3 === 0) {
      H.chiefSay(w.player_id, LINES[f.chief].cold[0], "wire gone cold", true);
      // A rival chief notices the silence.
      const rival = pick(FACTIONS.filter((x) => x.id !== f.id), w.id);
      run("INSERT INTO chat(id,player_id,role,text,at) VALUES(?,?,?,?,?)", uid(), w.player_id, "leak", COURT[rival.chief], now());
      logEvent("leak.delivered", `chief:${rival.chief}`, { kind: "courting", from: rival.id }, w.player_id);
    } else {
      H.chiefSay(w.player_id, pick(LINES[f.chief].missed, w.id).replace("{target}", target).replace("{by}", hhmm(w.deadline)), "wire missed", true);
    }
  }
}

/** The order was verified on site: bonus, streak, a word from the chief. Called from the engine's complete(). */
export function onVerified(wireId: string, playerId: string): { xp: number; say: string } | null {
  const w = get<WireRow>("SELECT * FROM wires WHERE id=? AND player_id=? AND state='sent'", wireId, playerId);
  if (!w) return null;
  run("UPDATE wires SET state='done', done_at=? WHERE id=?", now(), w.id);
  const p = get<{ faction_id: FactionId }>("SELECT faction_id FROM players WHERE id=?", playerId)!;
  const f = factionById(p.faction_id);
  const n = streak(playerId);
  const xp = Math.round(BONUS_XP * (w.boosted ? 1.5 : 1)) + (n >= 7 ? 40 : 0);
  award(playerId, xp, 1, n >= 7 ? `morning wire · ${n}-day streak` : "morning wire");
  const say = pick(LINES[f.chief].done, w.id).replace("{time}", hhmm(now())).replace("{streak}", n >= 2 ? `${n} mornings running.` : "");
  logEvent("wire.done", `chief:${f.chief}`, { wireId: w.id, streak: n, xp }, playerId);
  return { xp, say: say.trim() };
}

/** Today's wire for the app. */
export function view(playerId: string) {
  const w = get<WireRow>("SELECT * FROM wires WHERE player_id=? AND day=?", playerId, dayKey());
  const n = streak(playerId);
  if (!w) return { wire: null, streak: n, missedInRow: missedInRow(playerId) };
  const t = get<{ name: string; lat: number; lng: number }>("SELECT name, lat, lng FROM targets WHERE id=?", w.target_id);
  const m = get<{ state: string; assignee_id: string | null; brief: string }>("SELECT state, assignee_id, brief FROM missions WHERE id=?", w.mission_id);
  return {
    wire: { id: w.id, missionId: w.mission_id, state: w.state, target: t?.name ?? "the site", lat: t?.lat ?? null, lng: t?.lng ?? null, deadline: w.deadline, sentAt: w.sent_at, doneAt: w.done_at, boosted: !!w.boosted, brief: m?.brief ?? "", accepted: m?.state === "active" && m.assignee_id === playerId },
    streak: n, missedInRow: missedInRow(playerId),
  };
}

/** Take today's wire: it becomes the active field order at once. */
export function accept(playerId: string): { missionId: string } {
  const w = get<WireRow>("SELECT * FROM wires WHERE player_id=? AND day=? AND state='sent'", playerId, dayKey());
  if (!w) throw Object.assign(new Error("no wire open this morning"), { status: 404 });
  if (!H.assignDirect(playerId, w.mission_id)) throw Object.assign(new Error("the wire could not be taken; finish or abandon your current order first"), { status: 409 });
  return { missionId: w.mission_id };
}

/** Admin: send one now, to one operative, for testing. */
export function sendNow(codename: string): { ok: boolean; reason?: string } {
  const p = get<{ id: string; faction_id: FactionId; wire_boost_day: string | null }>("SELECT id, faction_id, wire_boost_day FROM players WHERE codename=?", codename);
  if (!p?.faction_id) return { ok: false, reason: "no such recruited player" };
  const day = dayKey();
  run("DELETE FROM wires WHERE player_id=? AND day=?", p.id, day);
  const site = pickSite(p.id, day);
  if (!site) return { ok: false, reason: "no routine yet: deploy to the field once first" };
  const f = factionById(p.faction_id);
  const deadline = new Date(Date.now() + WINDOW_MS).toISOString();
  const id = uid();
  const line = pick(LINES[f.chief].send, id).replace("{target}", site.name).replace("{by}", hhmm(deadline));
  const missionId = H.spawnOrder({ factionId: f.id, areaId: site.area_id, template: "RECON", targetId: site.id, params: { wireId: id, needsObservation: false, crisisId: null }, title: "Morning wire", brief: line, reservedFor: p.id, ttlMs: WINDOW_MS });
  if (!missionId) return { ok: false, reason: "could not spawn" };
  run("INSERT INTO wires(id,player_id,mission_id,day,state,target_id,sent_at,deadline,boosted) VALUES(?,?,?,?,?,?,?,?,0)", id, p.id, missionId, day, "sent", site.id, now(), deadline);
  logEvent("wire.sent", `chief:${f.chief}`, { wireId: id, target: site.name, deadline, boosted: false }, p.id);
  H.chiefSay(p.id, line, "morning wire", true);
  return { ok: true };
}
