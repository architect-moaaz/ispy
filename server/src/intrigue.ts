import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod/v4";
import type { FactionId } from "@ispy/shared";
import { all, get, run, now, uid, json, parse, logEvent, worldGet, worldSet, db } from "./db.ts";
import { bus } from "./bus.ts";
import { FACTIONS, PERSONAS, factionById } from "./content.ts";
import { pick } from "./puzzles.ts";
import { award, rankFor } from "./rewards.ts";
import { remember } from "./chiefs.ts";
import { chiefSay, refreshPlans, spawnTipMission } from "./engine.ts";
import { llmClient } from "./chiefs.ts";
import { brainEnabled } from "./brain.ts";
import { assess } from "./strategy.ts";
import * as distractions from "./distractions.ts";

/**
 * Intrigue: the Director as a spymaster rather than a referee.
 *
 *  - Relations: a standing temperature between every pair of agencies (allied → truce → cold war →
 *    open war) that pacts cool and betrayals heat. The Director's standing order is that nobody stays
 *    friends for long.
 *  - Profiles: the Director studies every agency and operative (stats plus a written read) and keeps
 *    the file current.
 *  - Leaks: anonymous information, true or false, dropped to an operative (an UNKNOWN SOURCE line on
 *    their encrypted link) or to an agency (its chief passes it on, not knowing who sent it). Each leak
 *    has a purpose. The admin can hold leaks for approval, veto them, or write their own.
 *  - Directives: notes from the admin the Director folds into its next scheme.
 *  - The back channel: operatives can be rogue. A tip to a rival chief sells a teammate's route for
 *    credits, or plants a false lead that costs the rival XP. Chiefs are smart: a source that burns
 *    them twice is dropped.
 *
 * The Plan (objectives, reads, pending leaks, relations) is visible on the admin console only.
 */
db.exec(`CREATE TABLE IF NOT EXISTS relations (
  a TEXT NOT NULL, b TEXT NOT NULL, heat INTEGER NOT NULL DEFAULT 55, since TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', wedged_at TEXT, PRIMARY KEY(a,b)
)`);
db.exec(`CREATE TABLE IF NOT EXISTS profiles (
  kind TEXT NOT NULL, subject_id TEXT NOT NULL, name TEXT NOT NULL, read TEXT NOT NULL DEFAULT '', stats TEXT NOT NULL DEFAULT '{}', updated_at TEXT NOT NULL, PRIMARY KEY(kind, subject_id)
)`);
db.exec(`CREATE TABLE IF NOT EXISTS leaks (
  id TEXT PRIMARY KEY, to_kind TEXT NOT NULL, to_id TEXT NOT NULL, to_name TEXT NOT NULL, text TEXT NOT NULL, truth INTEGER NOT NULL, purpose TEXT NOT NULL,
  source TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL, sent_at TEXT
)`);
db.exec(`CREATE TABLE IF NOT EXISTS directives (id TEXT PRIMARY KEY, text TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'open', created_at TEXT NOT NULL, used_at TEXT)`);
db.exec(`CREATE TABLE IF NOT EXISTS tips (
  id TEXT PRIMARY KEY, from_player TEXT NOT NULL, from_faction TEXT NOT NULL, to_faction TEXT NOT NULL, kind TEXT NOT NULL, ref_id TEXT NOT NULL, ref_name TEXT NOT NULL,
  outcome TEXT NOT NULL DEFAULT 'open', created_at TEXT NOT NULL
)`);

const MODEL = "claude-opus-5-5";
const TIP_CAP = 2;
const WEDGE_AFTER_MS = 90 * 60_000;

// ---------- relations ----------
const pairs = (): [FactionId, FactionId][] => { const out: [FactionId, FactionId][] = []; for (let i = 0; i < FACTIONS.length; i++) for (let j = i + 1; j < FACTIONS.length; j++) out.push([FACTIONS[i].id, FACTIONS[j].id]); return out; };
const key = (a: FactionId, b: FactionId): [FactionId, FactionId] => (a < b ? [a, b] : [b, a]);
export const stateOf = (heat: number) => (heat < 30 ? "allied" : heat < 50 ? "truce" : heat < 75 ? "cold war" : "open war");
function ensureRelations() { for (const p of pairs()) { const [a, b] = key(p[0], p[1]); if (!get("SELECT 1 FROM relations WHERE a=? AND b=?", a, b)) run("INSERT INTO relations(a,b,heat,since,note) VALUES(?,?,?,?,?)", a, b, 55, now(), "cold war, as it should be"); } }
export function heat(a: FactionId, b: FactionId): number { const [x, y] = key(a, b); return get<{ heat: number }>("SELECT heat FROM relations WHERE a=? AND b=?", x, y)?.heat ?? 55; }
export function nudge(a: FactionId | null | undefined, b: FactionId | null | undefined, delta: number, why: string) {
  if (!a || !b || a === b) return;
  const [x, y] = key(a, b);
  const before = heat(x, y);
  const after = Math.max(0, Math.min(100, before + delta));
  run("UPDATE relations SET heat=?, note=?, since=CASE WHEN ?<>? THEN ? ELSE since END WHERE a=? AND b=?", after, why, stateOf(before), stateOf(after), now(), x, y);
  if (stateOf(before) !== stateOf(after)) logEvent("relations.shifted", "director", { a: x, b: y, from: stateOf(before), to: stateOf(after), why }, null);
}
export function relationsView() {
  ensureRelations();
  return all<{ a: FactionId; b: FactionId; heat: number; since: string; note: string; wedged_at: string | null }>("SELECT * FROM relations").map((r) => ({ a: r.a, b: r.b, heat: r.heat, state: stateOf(r.heat), since: r.since, note: r.note, wedgedAt: r.wedged_at }));
}
/** Relations drift back toward cold war by themselves; peace needs upkeep, war needs none. */
function decayRelations() { run("UPDATE relations SET heat = heat + CASE WHEN heat < 55 THEN 2 WHEN heat > 70 THEN -1 ELSE 0 END"); }

// ---------- profiles ----------
export interface AgencyStats { power: number; deployed: number; verified24h: number; faceoffsWon: number; faceoffsLost: number; artifacts: number; baitPlanted: number; baitBitten: number; pacts: number; heists: number; tipsReceived: number }
export interface OperativeStats { faction: string; rank: string; xp: number; trust: number; verified: number; failedScans: number; baitPlanted: number; baitBitten: number; faceoffsWon: number; faceoffsLost: number; tipsSent: number; artifacts: number; activeHours: number[]; lastSeen: string | null; leaksReceived: number }
const day = () => new Date(Date.now() - 86_400_000).toISOString();
const week = () => new Date(Date.now() - 7 * 86_400_000).toISOString();
const n = (sql: string, ...a: unknown[]) => get<{ n: number }>(sql, ...a)!.n;

function agencyStats(f: FactionId): AgencyStats {
  const a = assess().factions.find((x) => x.factionId === f);
  return {
    power: a?.power ?? 0, deployed: a?.activeAgents ?? 0,
    verified24h: n("SELECT COUNT(*) n FROM missions WHERE faction_id=? AND state='completed' AND completed_at>?", f, day()),
    faceoffsWon: n("SELECT COUNT(*) n FROM faceoffs WHERE state='resolved' AND ((winner=a_player AND a_faction=?) OR (winner=b_player AND b_faction=?)) AND resolved_at>?", f, f, week()),
    faceoffsLost: n("SELECT COUNT(*) n FROM faceoffs WHERE state='resolved' AND winner IS NOT NULL AND ((winner<>a_player AND a_faction=?) OR (winner<>b_player AND b_faction=?)) AND resolved_at>?", f, f, week()),
    artifacts: n("SELECT COUNT(*) n FROM artifacts WHERE held_by=? AND state='held'", f),
    baitPlanted: n("SELECT COUNT(*) n FROM distractions WHERE faction_id=? AND created_at>?", f, week()),
    baitBitten: n("SELECT COUNT(*) n FROM events WHERE type='mission.decoyed' AND at>? AND player_id IN (SELECT id FROM players WHERE faction_id=?)", week(), f),
    pacts: n("SELECT COUNT(*) n FROM crises WHERE created_at>? AND pacts LIKE ?", week(), `%${f}%`),
    heists: n("SELECT COUNT(*) n FROM events WHERE type='artifact.stolen' AND at>? AND json_extract(payload,'$.by')=?", week(), f),
    tipsReceived: n("SELECT COUNT(*) n FROM tips WHERE to_faction=? AND created_at>?", f, week()),
  };
}
function operativeStats(p: { id: string; faction_id: FactionId; rank: string; xp: number; trust: number }): OperativeStats {
  return {
    faction: factionById(p.faction_id).name, rank: p.rank, xp: p.xp, trust: p.trust,
    verified: n("SELECT COUNT(*) n FROM missions WHERE assignee_id=? AND state='completed'", p.id),
    failedScans: n("SELECT COUNT(*) n FROM events WHERE type='location.flagged' AND player_id=?", p.id),
    baitPlanted: n("SELECT COUNT(*) n FROM distractions WHERE player_id=?", p.id),
    baitBitten: n("SELECT COUNT(*) n FROM events WHERE type='mission.decoyed' AND player_id=?", p.id),
    faceoffsWon: n("SELECT COUNT(*) n FROM faceoffs WHERE winner=?", p.id),
    faceoffsLost: n("SELECT COUNT(*) n FROM faceoffs WHERE state='resolved' AND winner IS NOT NULL AND winner<>? AND (a_player=? OR b_player=?)", p.id, p.id, p.id),
    tipsSent: n("SELECT COUNT(*) n FROM tips WHERE from_player=?", p.id),
    artifacts: n("SELECT COUNT(*) n FROM artifacts WHERE recovered_by=? AND state='held'", p.id),
    activeHours: all<{ h: number; c: number }>("SELECT CAST(substr(at,12,2) AS INTEGER) h, COUNT(*) c FROM events WHERE player_id=? AND at>? GROUP BY h ORDER BY c DESC LIMIT 3", p.id, week()).map((r) => r.h),
    lastSeen: get<{ at: string }>("SELECT at FROM events WHERE player_id=? ORDER BY id DESC LIMIT 1", p.id)?.at ?? null,
    leaksReceived: n("SELECT COUNT(*) n FROM leaks WHERE to_kind='operative' AND to_id=? AND state='sent'", p.id),
  };
}
/** The rules-path read: a plain sentence or two from the numbers. The model overwrites it when it schemes. */
function readAgency(f: FactionId, s: AgencyStats, leader: boolean, trailer: boolean): string {
  const bits: string[] = [];
  bits.push(leader ? `${factionById(f).name} leads; it will get comfortable.` : trailer ? `${factionById(f).name} trails; it will take a gift and resent it.` : `${factionById(f).name} sits in the middle, waiting to be pushed.`);
  if (s.baitPlanted > s.baitBitten) bits.push("Plays dirty and well."); else if (s.baitBitten > 1) bits.push("Walks into bait; gullible or careless.");
  if (s.pacts > 0) bits.push(`Has made ${s.pacts} pact${s.pacts === 1 ? "" : "s"} this week; a pact is a seam to pull.`);
  if (s.heists > 0) bits.push("Steals when it can. Nobody will trust it twice.");
  if (s.artifacts >= 3) bits.push("Its archive is worth leaking.");
  return bits.join(" ");
}
function readOperative(codename: string, s: OperativeStats): string {
  const bits: string[] = [];
  if (s.baitPlanted >= 2 || s.tipsSent >= 1) bits.push(`${codename} is a manipulator; feed them and they will do the work.`);
  else if (s.verified >= 8) bits.push(`${codename} is a workhorse; a rumour about a rival will move them.`);
  else bits.push(`${codename} is still finding their feet; a true leak now buys loyalty to the source.`);
  if (s.faceoffsLost > s.faceoffsWon) bits.push("Loses face-offs; resentment is usable.");
  if (s.baitBitten >= 1) bits.push("Has been fooled before and will be paranoid now.");
  if (s.trust < 60) bits.push("Chief does not fully trust them; that gap can be widened.");
  if (s.activeHours.length) bits.push(`Active around ${s.activeHours.map((h) => `${String(h).padStart(2, "0")}:00`).join(", ")}.`);
  return bits.join(" ");
}
export function refreshProfiles() {
  const a = assess();
  for (const f of FACTIONS) {
    const s = agencyStats(f.id);
    const read = get<{ read: string; updated_at: string }>("SELECT read, updated_at FROM profiles WHERE kind='agency' AND subject_id=?", f.id);
    const keepModelRead = read && read.read && worldGet(`read_model:${f.id}`, "") === "1" && Date.now() - Date.parse(read.updated_at) < 6 * 3600_000;
    run("INSERT INTO profiles(kind,subject_id,name,read,stats,updated_at) VALUES('agency',?,?,?,?,?) ON CONFLICT(kind,subject_id) DO UPDATE SET stats=excluded.stats, updated_at=excluded.updated_at, read=CASE WHEN ? THEN read ELSE excluded.read END",
      f.id, f.name, readAgency(f.id, s, a.leader.factionId === f.id, a.trailer.factionId === f.id), json(s), now(), keepModelRead ? 1 : 0);
  }
  for (const p of all<{ id: string; codename: string; faction_id: FactionId; rank: string; xp: number; trust: number }>("SELECT id, codename, faction_id, rank, xp, trust FROM players WHERE faction_id IS NOT NULL AND id IN (SELECT DISTINCT player_id FROM events WHERE player_id IS NOT NULL AND at>?)", week())) {
    const s = operativeStats(p);
    const read = get<{ read: string; updated_at: string }>("SELECT read, updated_at FROM profiles WHERE kind='operative' AND subject_id=?", p.id);
    const keepModelRead = read && read.read && worldGet(`read_model:${p.id}`, "") === "1" && Date.now() - Date.parse(read.updated_at) < 6 * 3600_000;
    run("INSERT INTO profiles(kind,subject_id,name,read,stats,updated_at) VALUES('operative',?,?,?,?,?) ON CONFLICT(kind,subject_id) DO UPDATE SET stats=excluded.stats, name=excluded.name, updated_at=excluded.updated_at, read=CASE WHEN ? THEN read ELSE excluded.read END",
      p.id, p.codename, readOperative(p.codename, s), json(s), now(), keepModelRead ? 1 : 0);
  }
}
function setRead(kind: "agency" | "operative", subjectId: string, read: string) {
  run("UPDATE profiles SET read=?, updated_at=? WHERE kind=? AND subject_id=?", read.slice(0, 400), now(), kind, subjectId);
  worldSet(`read_model:${subjectId}`, "1");
}

// ---------- truths the Director can leak ----------
export interface Truth { about: FactionId; text: string; kind: string }
/** Real facts about each agency that a rival would pay for. Nothing here names a person or a private place. */
export function truths(): Truth[] {
  const out: Truth[] = [];
  for (const d of all<{ faction_id: FactionId; target_name: string; expires_at: string }>("SELECT faction_id, target_name, expires_at FROM distractions WHERE state='live' AND expires_at>?", now()))
    out.push({ about: d.faction_id, kind: "bait", text: `The order at ${d.target_name} is bait. ${factionById(d.faction_id).name} planted it. Nothing is there.` });
  for (const a of all<{ held_by: FactionId; name: string; codename: string | null }>("SELECT a.held_by, a.name, p.codename FROM artifacts a LEFT JOIN players p ON p.id=a.recovered_by WHERE a.state='held' AND a.held_by IS NOT NULL ORDER BY a.recovered_at DESC LIMIT 6"))
    out.push({ about: a.held_by, kind: "artifact", text: `${factionById(a.held_by).name} holds ${a.name}${a.codename ? `; ${a.codename} brought it in` : ""}. It sits in their archive, and archives can be lifted.` });
  for (const c of all<{ pacts: string; name: string }>("SELECT pacts, name FROM crises WHERE state='active'")) for (const p of parse<FactionId[][]>(c.pacts, [])) if (p.length === 2) {
    out.push({ about: p[0], kind: "pact", text: `${factionById(p[0]).name} and ${factionById(p[1]).name} have a pact on ${c.name}. You are the one they agreed to cut out.` });
  }
  for (const m of all<{ faction_id: FactionId; codename: string; target: string }>("SELECT m.faction_id, p.codename, t.name target FROM missions m JOIN players p ON p.id=m.assignee_id JOIN targets t ON t.id=m.target_id WHERE m.state='active' AND m.mode='field' ORDER BY m.created_at DESC LIMIT 6"))
    out.push({ about: m.faction_id, kind: "movement", text: `${m.codename} of ${factionById(m.faction_id).name} is walking to ${m.target} right now.` });
  return out;
}
const RUMOURS = [
  "{a} is moving on {site} within the hour. Be there first or do not bother.",
  "{a}'s chief has been asking about your archive. Expect a heist.",
  "Somebody in {a} is selling your routes. The last two face-offs were not luck.",
  "{a} and {b} have an understanding about the next crisis. You are not in it.",
  "{a} planted bait at {site}. Or wants you to think so.",
];

// ---------- leaks ----------
export type LeakTarget = { kind: "operative"; id: string } | { kind: "agency"; id: FactionId };
export function holdLeaks() { return worldGet("hold_leaks", "0") === "1"; }
export function setHoldLeaks(v: boolean) { worldSet("hold_leaks", v ? "1" : "0"); }

export function createLeak(to: LeakTarget, text: string, truth: boolean, purpose: string, source: "director" | "admin" | "rules"): { id: string; state: string } | null {
  const name = to.kind === "agency" ? factionById(to.id).name : get<{ codename: string }>("SELECT codename FROM players WHERE id=?", to.id)?.codename;
  if (!name) return null;
  const id = uid();
  const hold = source !== "admin" && holdLeaks();
  run("INSERT INTO leaks(id,to_kind,to_id,to_name,text,truth,purpose,source,state,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)", id, to.kind, to.id, name, text.slice(0, 400), truth ? 1 : 0, purpose.slice(0, 200), source, hold ? "pending" : "approved", now());
  logEvent("leak.drafted", "director", { leakId: id, to: name, truth, purpose, source, held: hold }, null);
  if (!hold) deliver(id);
  return { id, state: hold ? "pending" : "sent" };
}
export function deliver(id: string) {
  const l = get<{ id: string; to_kind: string; to_id: string; to_name: string; text: string; truth: number; purpose: string; state: string }>("SELECT * FROM leaks WHERE id=?", id);
  if (!l || l.state === "sent" || l.state === "vetoed") return false;
  if (l.to_kind === "operative") {
    run("INSERT INTO chat(id,player_id,role,text,at) VALUES(?,?,?,?,?)", uid(), l.to_id, "leak", l.text, now());
    logEvent("leak.delivered", "director", { leakId: l.id, to: l.to_name, kind: "operative" }, l.to_id);
  } else {
    const f = factionById(l.to_id as FactionId);
    remember(f.chief, "leak", null, `An anonymous source said: "${l.text}"`);
    const voice = pick([
      `Anonymous, over the wire, no return path: "${l.text}" I do not know who sent it. Treat it as live until it is not.`,
      `A source I cannot name says: "${l.text}" Could be a gift. Could be a hook. Move as if it is true and watch your back.`,
      `Somebody wants us to know this: "${l.text}" Unsigned. I am passing it on because I would rather you heard it from me.`,
    ], l.id);
    for (const o of all<{ player_id: string }>("SELECT p.player_id FROM presence p JOIN players pl ON pl.id=p.player_id WHERE pl.faction_id=? AND p.expires_at>?", l.to_id, now())) chiefSay(o.player_id, voice, "anonymous leak", true);
    void refreshPlans(true, { factionId: l.to_id as FactionId, reason: `an anonymous source says: ${l.text}` }).catch(() => {});
    logEvent("leak.delivered", "director", { leakId: l.id, to: l.to_name, kind: "agency" }, null);
  }
  run("UPDATE leaks SET state='sent', sent_at=? WHERE id=?", now(), id);
  return true;
}
export function veto(id: string) { run("UPDATE leaks SET state='vetoed' WHERE id=? AND state IN ('pending','approved')", id); logEvent("leak.vetoed", "owner", { leakId: id }, null); }
export function leaksView(limit = 40) {
  return all<{ id: string; to_kind: string; to_name: string; text: string; truth: number; purpose: string; source: string; state: string; created_at: string; sent_at: string | null }>(
    "SELECT id, to_kind, to_name, text, truth, purpose, source, state, created_at, sent_at FROM leaks ORDER BY CASE state WHEN 'pending' THEN 0 ELSE 1 END, created_at DESC LIMIT ?", limit)
    .map((l) => ({ ...l, truth: !!l.truth }));
}

// ---------- directives ----------
export function addDirective(text: string) { const id = uid(); run("INSERT INTO directives(id,text,created_at) VALUES(?,?,?)", id, text.slice(0, 600), now()); logEvent("directive.added", "owner", { id, text: text.slice(0, 120) }, null); return id; }
export const openDirectives = () => all<{ id: string; text: string; created_at: string }>("SELECT id, text, created_at FROM directives WHERE state='open' ORDER BY created_at");
export const directivesView = () => all<{ id: string; text: string; state: string; created_at: string; used_at: string | null }>("SELECT * FROM directives ORDER BY created_at DESC LIMIT 15");

// ---------- the back channel (rogue operatives) ----------
export function backchannelOptions(playerId: string, factionId: FactionId | null) {
  if (!factionId) return null;
  const pres = get<{ area_id: string | null }>("SELECT area_id FROM presence WHERE player_id=? AND expires_at>?", playerId, now());
  const sent = n("SELECT COUNT(*) n FROM tips WHERE from_player=? AND created_at>?", playerId, day());
  const burned = FACTIONS.filter((f) => f.id !== factionId && isBurned(playerId, f.id)).map((f) => f.id);
  return {
    left: Math.max(0, TIP_CAP - sent),
    rivals: FACTIONS.filter((f) => f.id !== factionId).map((f) => ({ id: f.id, name: f.name, chief: f.chiefName, burned: burned.includes(f.id) })),
    routes: all<{ id: string; codename: string; title: string; target: string }>("SELECT m.id, p.codename, m.title, t.name target FROM missions m JOIN players p ON p.id=m.assignee_id JOIN targets t ON t.id=m.target_id WHERE m.state='active' AND m.mode='field' AND m.faction_id=? AND m.assignee_id<>? ORDER BY m.created_at DESC LIMIT 6", factionId, playerId)
      .map((m) => ({ missionId: m.id, label: `${m.codename} · ${m.title} at ${m.target}` })),
    sites: pres?.area_id ? all<{ id: string; name: string }>("SELECT id, name FROM targets WHERE area_id=? AND state='ACTIVE' ORDER BY name LIMIT 12", pres.area_id) : [],
    recent: all<{ kind: string; ref_name: string; to_faction: FactionId; outcome: string; created_at: string }>("SELECT kind, ref_name, to_faction, outcome, created_at FROM tips WHERE from_player=? ORDER BY created_at DESC LIMIT 5", playerId)
      .map((t) => ({ kind: t.kind, about: t.ref_name, to: factionById(t.to_faction).name, outcome: t.outcome, at: t.created_at })),
  };
}
/** A chief drops a source that has burned it twice in a day. */
export const isBurned = (playerId: string, toFaction: FactionId) => n("SELECT COUNT(*) n FROM tips WHERE from_player=? AND to_faction=? AND outcome='fabricated' AND created_at>?", playerId, toFaction, day()) >= 2;


export function sendTip(playerId: string, factionId: FactionId | null, toFaction: FactionId, kind: "sell" | "plant", refId: string): { ok: boolean; reason?: string; left?: number; credits?: number } {
  if (!factionId) return { ok: false, reason: "Join an agency first." };
  if (toFaction === factionId) return { ok: false, reason: "That is your own chief." };
  const left = Math.max(0, TIP_CAP - n("SELECT COUNT(*) n FROM tips WHERE from_player=? AND created_at>?", playerId, day()));
  if (left <= 0) return { ok: false, reason: "Two tips a day. The wire goes quiet after that." };
  if (isBurned(playerId, toFaction)) return { ok: false, reason: `${factionById(toFaction).chiefName} stopped listening to this source.` };
  const id = uid();
  const rival = factionById(toFaction);
  if (kind === "sell") {
    const m = get<{ id: string; area_id: string; target_id: string; codename: string; target: string; title: string }>("SELECT m.id, m.area_id, m.target_id, p.codename, t.name target, m.title FROM missions m JOIN players p ON p.id=m.assignee_id JOIN targets t ON t.id=m.target_id WHERE m.id=? AND m.state='active' AND m.faction_id=? AND m.assignee_id<>?", refId, factionId, playerId);
    if (!m) return { ok: false, reason: "That route is not live any more." };
    run("INSERT INTO tips(id,from_player,from_faction,to_faction,kind,ref_id,ref_name,outcome,created_at) VALUES(?,?,?,?,?,?,?,?,?)", id, playerId, factionId, toFaction, "sell", m.id, `${m.codename}'s route to ${m.target}`, "sold", now());
    const brief = pick(PERSONAS[rival.chief].lines.RECON, id).replace("{target}", m.target);
    spawnTipMission(toFaction, m.area_id, m.target_id, id, brief);
    for (const o of all<{ player_id: string }>("SELECT p.player_id FROM presence p JOIN players pl ON pl.id=p.player_id WHERE pl.faction_id=? AND p.expires_at>?", toFaction, now()))
      chiefSay(o.player_id, `A source I do not know says ${factionById(factionId).name} has somebody walking to ${m.target} right now. There is an order for it on the board. Beat them there.`, "tip", true);
    remember(rival.chief, "tip", null, `an anonymous source sold us ${factionById(factionId).name}'s route to ${m.target}`);
    award(playerId, 0, 0, "from an unknown account", 40);
    nudge(factionId, toFaction, 8, `a route was sold across the line`);
    logEvent("tip.sold", "player", { tipId: id, to: toFaction, route: m.target, victim: m.codename }, playerId);
    return { ok: true, left: left - 1, credits: 40 };
  }
  const t = get<{ id: string; name: string; area_id: string }>("SELECT id, name, area_id FROM targets WHERE id=? AND state='ACTIVE'", refId);
  if (!t) return { ok: false, reason: "Pick a real site." };
  const planted = distractions.plantFor(playerId, factionId, t.id, toFaction, `tip:${id}`);
  if (!planted.ok) return { ok: false, reason: planted.reason };
  run("INSERT INTO tips(id,from_player,from_faction,to_faction,kind,ref_id,ref_name,outcome,created_at) VALUES(?,?,?,?,?,?,?,?,?)", id, playerId, factionId, toFaction, "plant", planted.id!, t.name, "open", now());
  for (const o of all<{ player_id: string }>("SELECT p.player_id FROM presence p JOIN players pl ON pl.id=p.player_id WHERE pl.faction_id=? AND p.expires_at>?", toFaction, now()))
    chiefSay(o.player_id, `Unsigned tip: something is sitting at ${t.name}. I have put an order on the board. Go and look, and if it is nothing, I want to know that too.`, "tip", true);
  remember(rival.chief, "tip", null, `an anonymous source pointed us at ${t.name}`);
  logEvent("tip.planted", "player", { tipId: id, to: toFaction, site: t.name }, playerId);
  return { ok: true, left: left - 1 };
}
/** False leads that were bitten burn the source with that chief. */
function settleTips() {
  for (const t of all<{ id: string; ref_id: string; to_faction: FactionId; from_player: string }>("SELECT id, ref_id, to_faction, from_player FROM tips WHERE kind='plant' AND outcome='open'")) {
    const d = get<{ bites: number; state: string; expires_at: string }>("SELECT bites, state, expires_at FROM distractions WHERE id=?", t.ref_id);
    if (!d) { run("UPDATE tips SET outcome='expired' WHERE id=?", t.id); continue; }
    if (d.bites > 0) {
      run("UPDATE tips SET outcome='fabricated' WHERE id=?", t.id);
      remember(factionById(t.to_faction).chief, "tip", null, `the unsigned tip about that site was a plant; the source is marked`);
      if (isBurned(t.from_player, t.to_faction)) logEvent("tip.source_burned", "chief", { to: t.to_faction }, t.from_player);
    } else if (d.state !== "live" || Date.parse(d.expires_at) < Date.now()) run("UPDATE tips SET outcome='ignored' WHERE id=?", t.id);
  }
}
export const tipsView = () => all<{ id: string; kind: string; ref_name: string; to_faction: FactionId; from_faction: FactionId; outcome: string; created_at: string; codename: string }>(
  "SELECT t.id, t.kind, t.ref_name, t.to_faction, t.from_faction, t.outcome, t.created_at, p.codename FROM tips t JOIN players p ON p.id=t.from_player ORDER BY t.created_at DESC LIMIT 20")
  .map((t) => ({ id: t.id, kind: t.kind, about: t.ref_name, from: t.codename, fromFaction: t.from_faction, to: t.to_faction, outcome: t.outcome, at: t.created_at }));

// ---------- the scheme ----------
const Scheme = z.object({
  objectives: z.array(z.string().describe("at most 140 characters")).max(5).describe("The Director's current aims for the war between the agencies, most important first"),
  reads: z.array(z.object({ kind: z.enum(["agency", "operative"]), name: z.string(), read: z.string().describe("at most 300 characters: who they are, what moves them, how to use them") })).max(8),
  leaks: z.array(z.object({ toKind: z.enum(["agency", "operative"]), toName: z.string().describe("agency name (RAVEN/PHANTOM/CIPHER) or operative codename"), text: z.string().describe("at most 240 characters, written as an anonymous source would: terse, specific, no signature"), truth: z.boolean(), purpose: z.string().describe("at most 120 characters: what this leak is meant to cause") })).max(4),
  heat: z.array(z.object({ a: z.enum(["raven", "phantom", "cipher"]), b: z.enum(["raven", "phantom", "cipher"]), delta: z.number().int().min(-15).max(15), why: z.string().describe("at most 100 characters") })).max(3),
});
const SCHEME_SYSTEM = [
  "You are the World Director of iSpy a Spy, a real-world spy game: human operatives in three agencies (RAVEN, PHANTOM, CIPHER) whose chiefs are AI personas. You are invisible to all of them.",
  "In this role you are a spymaster, not a referee. You study every agency and operative, you keep the three agencies at war with one another at all times, you break up friendships before they settle, you feed the weak and starve the comfortable, and you leak information anonymously (true or false) to agencies and to individual operatives to make things happen.",
  "You work with one human: the game admin, who sees this plan and nobody else does. Their directives are orders; fold them in and say how in your objectives.",
  "Leaks: an agency leak reaches its chief, who passes it to deployed operatives without knowing the source. An operative leak appears on that operative's encrypted link from UNKNOWN SOURCE. True leaks come only from the 'truths' list (quote the fact; you may reword). False leaks must be plausible and aimed: a wedge between allies, paranoia about a teammate, a rumour that sends people to a real listed site. Never invent sites or codenames; use only names in the context. Never target the same recipient with two leaks in one scheme.",
  "Reads: short, sharp, usable character notes about an agency or operative, in the voice of a case officer's file. Only for subjects in the context.",
  "Heat: relations run 0 (allied) to 100 (open war). Pacts cool them; betrayals heat them. Nudge pairs only when a leak or event justifies it.",
  "Hard limits: never reveal yourself; nothing about real people, private property or unsafe places; everything stays fiction; be proportionate; prefer fewer, better leaks.",
].join("\n");

let lastScheme = 0;
let lastRulesScheme = 0;
export function lastSchemeAt() { return lastScheme ? new Date(lastScheme).toISOString() : null; }
export function currentObjectives(): string[] { return parse<string[]>(worldGet("plan_objectives", "[]"), []); }

/** Rules path: a wedge when two agencies get comfortable, an exposure when one runs away. */
function rulesScheme(): string[] {
  const out: string[] = [];
  ensureRelations();
  const a = assess();
  for (const r of all<{ a: FactionId; b: FactionId; heat: number; since: string; wedged_at: string | null }>("SELECT * FROM relations")) {
    const warm = r.heat < 45 && Date.now() - Date.parse(r.since) > WEDGE_AFTER_MS && (!r.wedged_at || Date.now() - Date.parse(r.wedged_at) > 3 * WEDGE_AFTER_MS);
    if (!warm) continue;
    const third = FACTIONS.find((f) => f.id !== r.a && f.id !== r.b)!.id;
    const weaker = (a.factions.find((f) => f.factionId === r.a)?.power ?? 0) <= (a.factions.find((f) => f.factionId === r.b)?.power ?? 0) ? r.a : r.b;
    const other = weaker === r.a ? r.b : r.a;
    const site = get<{ name: string }>("SELECT name FROM targets WHERE state='ACTIVE' ORDER BY RANDOM() LIMIT 1")?.name ?? "the old meeting point";
    const text = pick(RUMOURS, `${r.a}${r.b}${now().slice(0, 13)}`).replace("{a}", factionById(other).name).replace("{b}", factionById(third).name).replace("{site}", site);
    createLeak({ kind: "agency", id: weaker }, text, false, `wedge: ${factionById(r.a).name} and ${factionById(r.b).name} have been ${stateOf(r.heat)} too long`, "rules");
    run("UPDATE relations SET wedged_at=? WHERE a=? AND b=?", now(), r.a, r.b);
    nudge(r.a, r.b, 10, "a wedge leak");
    out.push(`Break up ${factionById(r.a).name} and ${factionById(r.b).name}: ${stateOf(r.heat)} since ${r.since.slice(11, 16)}.`);
  }
  if (a.gap >= 25 && a.leader.factionId !== a.trailer.factionId) {
    const t = truths().filter((x) => x.about === a.leader.factionId);
    if (t.length && !get("SELECT 1 FROM leaks WHERE to_kind='agency' AND to_id=? AND created_at>?", a.trailer.factionId, new Date(Date.now() - WEDGE_AFTER_MS).toISOString())) {
      const x = pick(t, now().slice(0, 13));
      createLeak({ kind: "agency", id: a.trailer.factionId }, x.text, true, `arm the trailer: ${a.trailer.name} is ${a.gap} behind ${a.leader.name}`, "rules");
      out.push(`Arm ${a.trailer.name} against ${a.leader.name} (gap ${a.gap}).`);
    }
  }
  if (!out.length) out.push(`Hold: ${relationsView().map((r) => `${factionById(r.a).name}/${factionById(r.b).name} ${r.state}`).join(", ")}.`);
  return out;
}

export async function scheme(force = false): Promise<{ objectives: string[]; applied: string[] } | null> {
  const t = Date.now();
  const anyone = n("SELECT COUNT(*) n FROM presence WHERE expires_at>?", now()) > 0;
  const cadence = anyone ? 15 * 60_000 : 2 * 3600_000;
  if (!force && t - lastScheme < cadence) return null;
  lastScheme = t;
  decayRelations(); settleTips(); refreshProfiles();
  const directives = openDirectives();
  const applied: string[] = [];
  let objectives: string[];
  const c = brainEnabled() ? llmClient() : null;
  if (c) {
    const ctx = {
      now: now(),
      relations: relationsView().map((r) => ({ pair: `${factionById(r.a).name}/${factionById(r.b).name}`, a: r.a, b: r.b, heat: r.heat, state: r.state, since: r.since, note: r.note })),
      agencies: all<{ subject_id: string; name: string; read: string; stats: string }>("SELECT subject_id, name, read, stats FROM profiles WHERE kind='agency'").map((p) => ({ name: p.name, read: p.read, stats: parse(p.stats, {}) })),
      operatives: all<{ name: string; read: string; stats: string }>("SELECT name, read, stats FROM profiles WHERE kind='operative' ORDER BY updated_at DESC LIMIT 20").map((p) => ({ codename: p.name, read: p.read, stats: parse(p.stats, {}) })),
      deployedNow: all<{ codename: string; faction_id: FactionId; mode: string }>("SELECT pl.codename, pl.faction_id, p.mode FROM presence p JOIN players pl ON pl.id=p.player_id WHERE p.expires_at>?", now()).map((p) => ({ codename: p.codename, agency: factionById(p.faction_id).name, mode: p.mode })),
      truths: truths(),
      sites: all<{ name: string }>("SELECT name FROM targets WHERE state='ACTIVE' AND area_id IN (SELECT DISTINCT area_id FROM presence WHERE expires_at>? AND area_id IS NOT NULL) LIMIT 20", now()).map((s) => s.name),
      recentLeaks: leaksView(8).map((l) => ({ to: l.to_name, truth: l.truth, purpose: l.purpose, state: l.state, at: l.created_at })),
      recentTips: tipsView().slice(0, 6),
      recentEvents: all<{ type: string; payload: string; at: string }>("SELECT type, payload, at FROM events WHERE type IN ('faceoff.resolved','distraction.sprung','artifact.stolen','crisis.brewed','crisis.resolved','tip.sold','tip.planted','relations.shifted','intel.deal') ORDER BY id DESC LIMIT 20").map((e) => ({ type: e.type, at: e.at, payload: parse(e.payload, {}) })),
      adminDirectives: directives.map((d) => d.text),
      previousObjectives: currentObjectives(),
    };
    try {
      const res = await c.messages.parse({ model: MODEL, max_tokens: 3000, output_config: { effort: "medium", format: zodOutputFormat(Scheme) }, system: SCHEME_SYSTEM,
        messages: [{ role: "user", content: `Situation:\n${json(ctx)}\n\nWrite the plan: objectives, reads, leaks and heat changes for now.` }] });
      const d = res.parsed_output;
      if (!d) throw new Error("no scheme parsed");
      objectives = d.objectives.map((o) => o.slice(0, 160));
      for (const r of d.reads) {
        const row = r.kind === "agency" ? FACTIONS.find((f) => f.name.toLowerCase() === r.name.toLowerCase()) && { id: FACTIONS.find((f) => f.name.toLowerCase() === r.name.toLowerCase())!.id }
          : get<{ id: string }>("SELECT id FROM players WHERE codename=?", r.name);
        if (row) { setRead(r.kind, row.id, r.read); applied.push(`read ${r.name}`); }
      }
      const seen = new Set<string>();
      for (const l of d.leaks) {
        if (seen.has(l.toName)) continue; seen.add(l.toName);
        const to: LeakTarget | null = l.toKind === "agency" ? (FACTIONS.find((f) => f.name.toLowerCase() === l.toName.toLowerCase()) ? { kind: "agency", id: FACTIONS.find((f) => f.name.toLowerCase() === l.toName.toLowerCase())!.id } : null)
          : (get<{ id: string }>("SELECT id FROM players WHERE codename=?", l.toName) ? { kind: "operative", id: get<{ id: string }>("SELECT id FROM players WHERE codename=?", l.toName)!.id } : null);
        if (!to) { applied.push(`leak to unknown ${l.toName} dropped`); continue; }
        const r = createLeak(to, l.text, l.truth, l.purpose, "director");
        applied.push(`leak to ${l.toName} (${l.truth ? "true" : "false"}) ${r?.state ?? "failed"}: ${l.purpose}`);
      }
      for (const h of d.heat) { nudge(h.a, h.b, h.delta, h.why); applied.push(`heat ${h.a}/${h.b} ${h.delta > 0 ? "+" : ""}${h.delta}: ${h.why}`); }
    } catch (e) {
      console.warn("[intrigue] model scheme failed, rules continue:", (e as Error).message);
      objectives = rulesScheme(); applied.push(`model failed (${(e as Error).message.slice(0, 80)}); rules scheme ran`);
    }
  } else {
    objectives = rulesScheme(); lastRulesScheme = t;
  }
  for (const d of directives) run("UPDATE directives SET state='used', used_at=? WHERE id=?", now(), d.id);
  worldSet("plan_objectives", json(objectives)); worldSet("plan_updated", now());
  logEvent("director.scheme", "director", { objectives, applied, mode: c ? "model" : "rules" }, null);
  return { objectives, applied };
}

/** The admin's view of the whole plan. Never served to players. */
export function plan() {
  return {
    updatedAt: worldGet("plan_updated", "") || null,
    mode: brainEnabled() ? "model" : "rules",
    holdLeaks: holdLeaks(),
    objectives: currentObjectives(),
    relations: relationsView().map((r) => ({ ...r, aName: factionById(r.a).name, bName: factionById(r.b).name })),
    agencies: all<{ subject_id: string; name: string; read: string; stats: string; updated_at: string }>("SELECT * FROM profiles WHERE kind='agency'").map((p) => ({ id: p.subject_id, name: p.name, read: p.read, stats: parse<AgencyStats>(p.stats, {} as AgencyStats), updatedAt: p.updated_at })),
    operatives: all<{ subject_id: string; name: string; read: string; stats: string; updated_at: string }>("SELECT * FROM profiles WHERE kind='operative' ORDER BY updated_at DESC LIMIT 30").map((p) => ({ id: p.subject_id, codename: p.name, read: p.read, stats: parse<OperativeStats>(p.stats, {} as OperativeStats), updatedAt: p.updated_at })),
    leaks: leaksView(40),
    directives: directivesView(),
    tips: tipsView(),
    truths: truths(),
    recipients: { agencies: FACTIONS.map((f) => ({ id: f.id, name: f.name })), operatives: all<{ id: string; codename: string }>("SELECT pl.id, pl.codename FROM presence p JOIN players pl ON pl.id=p.player_id WHERE p.expires_at>?", now()) },
  };
}

// ---------- the world feeds the relations ----------
export function start() {
  ensureRelations();
  bus.onSignal((s) => {
    try {
      switch (s.type) {
        case "faceoff.resolved": if (s.payload?.outcome === "won") nudge(s.payload.winnerFaction, s.payload.rivalFaction, 3, `face-off at ${s.payload.target}`); break;
        case "distraction.sprung": nudge(s.payload?.byFaction, s.payload?.planterFaction, 6, `bait at ${s.payload?.target}`); break;
        case "artifact.stolen": nudge(s.payload?.by, s.payload?.victim, 12, `${s.payload?.name} was lifted`); break;
        case "crisis.brewed": for (const p of (s.payload?.pacts ?? []) as FactionId[][]) if (p.length === 2) nudge(p[0], p[1], -15, `pact on ${s.payload?.name}`); break;
        case "intel.deal": if (s.payload?.kind === "share" || s.payload?.kind === "trade") nudge(s.payload?.from, s.payload?.to, -8, `intel ${s.payload.kind}`); else if (s.payload?.kind === "spoil" || s.payload?.kind === "steal") nudge(s.payload?.from, s.payload?.to, 8, `intel ${s.payload.kind}`); break;
      }
    } catch (e) { console.warn("[intrigue] relation update failed:", (e as Error).message); }
  });
}
export const _rankFor = rankFor;
export const _lastRules = () => lastRulesScheme;
