import type { FactionId } from "@ispy/shared";
import { all, db, get, logEvent, now, run, uid } from "./db.ts";
import { factionById } from "./content.ts";
import { award } from "./rewards.ts";
import { distanceM } from "./geo.ts";
import { pick } from "./puzzles.ts";
import { hhmm } from "./clock.ts";
import { H } from "./hooks.ts";

/**
 * The Handoff. A parcel that needs two operatives of one agency who never meet. A walks to a site,
 * leaves it, and writes one line about where ("under the bench with the broken slat"). B then has
 * forty minutes to reach the same site and pick it up. Both are paid only if it lands. Afterwards each
 * sees the other's codename and can leave one line in the other's file. Pairs that land are paired
 * again. Pairs that fail are not, for a while.
 */
db.exec(`CREATE TABLE IF NOT EXISTS handoffs (
  id TEXT PRIMARY KEY, area_id TEXT NOT NULL, target_id TEXT NOT NULL, faction_id TEXT NOT NULL, a_player TEXT NOT NULL, b_player TEXT NOT NULL,
  state TEXT NOT NULL, drop_mission_id TEXT, pick_mission_id TEXT, mark TEXT, created_at TEXT NOT NULL, dropped_at TEXT, deadline TEXT, resolved_at TEXT,
  a_note TEXT, b_note TEXT
)`);
db.exec(`CREATE TABLE IF NOT EXISTS handoff_pairs (a TEXT NOT NULL, b TEXT NOT NULL, landed INTEGER NOT NULL DEFAULT 0, failed INTEGER NOT NULL DEFAULT 0, last_at TEXT NOT NULL, PRIMARY KEY(a, b))`);

export interface HandoffRow { id: string; area_id: string; target_id: string; faction_id: FactionId; a_player: string; b_player: string; state: "open" | "dropped" | "landed" | "failed" | "expired"; drop_mission_id: string | null; pick_mission_id: string | null; mark: string | null; created_at: string; dropped_at: string | null; deadline: string | null; resolved_at: string | null; a_note: string | null; b_note: string | null }

const DROP_TTL_MS = 60 * 60_000, PICK_MS = 40 * 60_000;
const PAYOUT_XP = 200, PAYOUT_CREDITS = 15, CONSOLATION_XP = 40;
const PER_PLAYER_GAP_MS = 3 * 60 * 60_000;
const DEFAULT_MARK = "Left where you would have left it.";
const DROP_BRIEFS = ["A parcel for {target}. Leave it and walk on; your partner is already moving and you will not meet.", "Carry it to {target}. Set it down, say where in one line, and do not wait."];
const PICK_BRIEFS = ["{a} left a parcel at {target} at {time}. Their words: \"{mark}\". Forty minutes.", "Pickup. {target}, where {a} put it down at {time}: \"{mark}\". The clock is running."];

const key = (x: string, y: string) => (x < y ? [x, y] : [y, x]) as [string, string];
const liveFor = (playerId: string) => get<HandoffRow>("SELECT * FROM handoffs WHERE (a_player=? OR b_player=?) AND state IN ('open','dropped')", playerId, playerId);

/** Once a minute from the Director: pair up field operatives of one agency in one sector; close the ones that ran out. */
export function sweep() {
  // Expiries first.
  for (const h of all<HandoffRow>("SELECT * FROM handoffs WHERE state='dropped' AND deadline<?", now())) fail(h, "expired");
  for (const h of all<HandoffRow>("SELECT * FROM handoffs WHERE state='open' AND created_at<?", new Date(Date.now() - DROP_TTL_MS).toISOString())) {
    run("UPDATE handoffs SET state='expired', resolved_at=? WHERE id=?", now(), h.id);
    if (h.drop_mission_id) { run("UPDATE missions SET state='expired', outcome='expired' WHERE id=? AND state IN ('pool','offered')", h.drop_mission_id); run("UPDATE offers SET state='expired' WHERE mission_id=? AND state='open'", h.drop_mission_id); }
  }
  // Candidates: deployed in the field, same agency and sector, no live handoff, none in the last three hours.
  const rows = all<{ player_id: string; area_id: string; faction_id: FactionId; last_lat: number; last_lng: number }>(
    "SELECT p.player_id, p.area_id, pl.faction_id, p.last_lat, p.last_lng FROM presence p JOIN players pl ON pl.id=p.player_id WHERE p.mode='field' AND p.expires_at>? AND p.area_id IS NOT NULL AND p.last_lat IS NOT NULL AND pl.faction_id IS NOT NULL", now());
  const groups = new Map<string, typeof rows>();
  for (const r of rows) { const k = `${r.area_id}:${r.faction_id}`; (groups.get(k) ?? groups.set(k, []).get(k)!).push(r); }
  for (const [, g] of groups) {
    const free = g.filter((r) => !liveFor(r.player_id) && !get("SELECT 1 FROM handoffs WHERE (a_player=? OR b_player=?) AND created_at>?", r.player_id, r.player_id, new Date(Date.now() - PER_PLAYER_GAP_MS).toISOString()));
    if (free.length < 2) continue;
    // Prefer a pair that has landed one before.
    let best: [typeof free[0], typeof free[0]] | null = null, bestScore = -1;
    for (let i = 0; i < free.length; i++) for (let j = i + 1; j < free.length; j++) {
      const [x, y] = key(free[i].player_id, free[j].player_id);
      const pr = get<{ landed: number; failed: number }>("SELECT landed, failed FROM handoff_pairs WHERE a=? AND b=?", x, y);
      const score = (pr?.landed ?? 0) * 2 - (pr?.failed ?? 0) + Math.random() * 0.5;
      if (score > bestScore) { bestScore = score; best = [free[i], free[j]]; }
    }
    if (best) create(best[0].player_id, best[1].player_id, best[0].area_id, best[0].faction_id);
  }
}

function create(aId: string, bId: string, areaId: string, factionId: FactionId): HandoffRow | null {
  // The site: within both operatives' reach, nearest to the midpoint, not held by a rival.
  const a = get<{ last_lat: number; last_lng: number }>("SELECT last_lat, last_lng FROM presence WHERE player_id=?", aId);
  const b = get<{ last_lat: number; last_lng: number }>("SELECT last_lat, last_lng FROM presence WHERE player_id=?", bId);
  if (!a?.last_lat || !b?.last_lat) return null;
  const ra = H.walkRadiusM(aId), rb = H.walkRadiusM(bId);
  const mid = { lat: (a.last_lat + b.last_lat) / 2, lng: (a.last_lng + b.last_lng) / 2 };
  const t = all<{ id: string; name: string; lat: number; lng: number }>("SELECT id, name, lat, lng FROM targets WHERE area_id=? AND state='ACTIVE' AND kind<>'test'", areaId)
    .filter((x) => distanceM(a.last_lat, a.last_lng, x.lat, x.lng) <= ra && distanceM(b.last_lat, b.last_lng, x.lat, x.lng) <= rb)
    .filter((x) => !get("SELECT 1 FROM target_locks WHERE target_id=? AND until>? AND faction_id<>?", x.id, now(), factionId))
    .sort((x, y) => distanceM(mid.lat, mid.lng, x.lat, x.lng) - distanceM(mid.lat, mid.lng, y.lat, y.lng))[0];
  if (!t) return null;
  const id = uid();
  const brief = pick(DROP_BRIEFS, id).replace("{target}", t.name);
  const missionId = H.spawnOrder({ factionId, areaId, template: "RECON", targetId: t.id, params: { handoffId: id, handoffRole: "drop", needsObservation: false, crisisId: null }, title: "Handoff · the drop", brief, reservedFor: aId, ttlMs: DROP_TTL_MS, rewardXp: 60 });
  if (!missionId) return null;
  run("INSERT INTO handoffs(id,area_id,target_id,faction_id,a_player,b_player,state,drop_mission_id,created_at) VALUES(?,?,?,?,?,?,?,?,?)", id, areaId, t.id, factionId, aId, bId, "open", missionId, now());
  H.offerDirect(aId, missionId);
  logEvent("handoff.offered", "director", { handoffId: id, target: t.name, role: "drop" }, aId);
  H.chiefSay(aId, `A handoff. ${t.name}: leave the parcel, write one line about where, keep walking. Someone of ours picks it up after you. You are paid when it lands.`, "handoff offered", true);
  logEvent("handoff.pending", "director", { handoffId: id, target: t.name }, bId);
  H.chiefSay(bId, `Stay close. One of ours is carrying a parcel toward ${t.name}. When it is down you get forty minutes.`, "handoff pending", true);
  return get<HandoffRow>("SELECT * FROM handoffs WHERE id=?", id)!;
}

/** The dropper describes the spot. Before or after the drop; the pickup brief carries it. */
export function mark(playerId: string, handoffId: string, text: string) {
  const h = get<HandoffRow>("SELECT * FROM handoffs WHERE id=? AND a_player=? AND state IN ('open','dropped')", handoffId, playerId);
  if (!h) throw Object.assign(new Error("not your drop"), { status: 404 });
  const clean = text.trim().slice(0, 140);
  run("UPDATE handoffs SET mark=? WHERE id=?", clean, h.id);
  if (h.state === "dropped" && h.pick_mission_id) {
    const a = get<{ codename: string }>("SELECT codename FROM players WHERE id=?", h.a_player)!.codename;
    const t = get<{ name: string }>("SELECT name FROM targets WHERE id=?", h.target_id)!.name;
    run("UPDATE missions SET brief=? WHERE id=?", pick(PICK_BRIEFS, h.id).replace("{a}", a.toUpperCase()).replace("{target}", t).replace("{time}", hhmm(h.dropped_at!)).replace("{mark}", clean), h.pick_mission_id);
  }
  return { ok: true, mark: clean };
}

/** A handoff order was verified on site. Drop: the pickup goes out. Pickup: it landed. Called from the engine's complete(). */
export function onVerified(params: { handoffId: string; handoffRole: "drop" | "pick" }, playerId: string): { say: string; xp: number } | null {
  const h = get<HandoffRow>("SELECT * FROM handoffs WHERE id=?", params.handoffId);
  if (!h) return null;
  const t = get<{ name: string }>("SELECT name FROM targets WHERE id=?", h.target_id)!.name;
  const codename = (id: string) => get<{ codename: string }>("SELECT codename FROM players WHERE id=?", id)!.codename.toUpperCase();
  if (params.handoffRole === "drop" && h.state === "open" && playerId === h.a_player) {
    const deadline = new Date(Date.now() + PICK_MS).toISOString();
    const brief = pick(PICK_BRIEFS, h.id).replace("{a}", codename(h.a_player)).replace("{target}", t).replace("{time}", hhmm(now())).replace("{mark}", h.mark ?? DEFAULT_MARK);
    const pickId = H.spawnOrder({ factionId: h.faction_id, areaId: h.area_id, template: "RECON", targetId: h.target_id, params: { handoffId: h.id, handoffRole: "pick", needsObservation: false, crisisId: null }, title: "Handoff · the pickup", brief, reservedFor: h.b_player, ttlMs: PICK_MS, rewardXp: 60 });
    run("UPDATE handoffs SET state='dropped', dropped_at=?, deadline=?, pick_mission_id=? WHERE id=?", now(), deadline, pickId, h.id);
    if (pickId) H.offerDirect(h.b_player, pickId);
    logEvent("handoff.ready", "director", { handoffId: h.id, target: t, deadline }, h.b_player);
    H.chiefSay(h.b_player, `It is down at ${t}. "${h.mark ?? DEFAULT_MARK}" Forty minutes from ${hhmm(now())}. Go.`, "handoff ready", true);
    logEvent("handoff.dropped", "authority", { handoffId: h.id, target: t }, h.a_player);
    return { say: `Dropped. The rest is ${codename(h.b_player)}'s walk. You are paid when it lands.`, xp: 0 };
  }
  if (params.handoffRole === "pick" && h.state === "dropped" && playerId === h.b_player) {
    run("UPDATE handoffs SET state='landed', resolved_at=? WHERE id=?", now(), h.id);
    const [x, y] = key(h.a_player, h.b_player);
    run("INSERT INTO handoff_pairs(a,b,landed,failed,last_at) VALUES(?,?,1,0,?) ON CONFLICT(a,b) DO UPDATE SET landed=landed+1, last_at=excluded.last_at", x, y, now());
    award(h.a_player, PAYOUT_XP, 2, `handoff landed with ${codename(h.b_player)}`, PAYOUT_CREDITS);
    award(h.b_player, PAYOUT_XP, 2, `handoff landed with ${codename(h.a_player)}`, PAYOUT_CREDITS);
    logEvent("handoff.landed", "authority", { handoffId: h.id, partner: codename(h.b_player), target: t }, h.a_player);
    logEvent("handoff.landed", "authority", { handoffId: h.id, partner: codename(h.a_player), target: t }, h.b_player);
    H.chiefSay(h.a_player, `It landed. ${codename(h.b_player)} picked it up at ${hhmm(now())}. You two work. Leave them a line in the file if you like.`, "handoff landed", true);
    return { say: `Landed. ${codename(h.a_player)} left it, you carried it home. Leave them a line in the file if you like.`, xp: PAYOUT_XP };
  }
  return null;
}

function fail(h: HandoffRow, why: "expired") {
  run("UPDATE handoffs SET state='failed', resolved_at=? WHERE id=?", now(), h.id);
  if (h.pick_mission_id) { run("UPDATE missions SET state='expired', outcome='expired' WHERE id=? AND state IN ('pool','offered','accepted','active')", h.pick_mission_id); run("UPDATE offers SET state='expired' WHERE mission_id=? AND state='open'", h.pick_mission_id); }
  const [x, y] = key(h.a_player, h.b_player);
  run("INSERT INTO handoff_pairs(a,b,landed,failed,last_at) VALUES(?,?,0,1,?) ON CONFLICT(a,b) DO UPDATE SET failed=failed+1, last_at=excluded.last_at", x, y, now());
  award(h.a_player, CONSOLATION_XP, 0, "handoff · the walk");
  const t = get<{ name: string }>("SELECT name FROM targets WHERE id=?", h.target_id)?.name ?? "the site";
  for (const p of [h.a_player, h.b_player]) logEvent("handoff.failed", "authority", { handoffId: h.id, target: t, why }, p);
  H.chiefSay(h.b_player, `The parcel at ${t} is gone. Forty minutes was the whole window.`, "handoff failed", true);
  H.chiefSay(h.a_player, `Nobody came for it at ${t}. Something for the walk; nothing for the parcel.`, "handoff failed", true);
}

/** One line in the partner's file, after it landed. */
export function note(playerId: string, handoffId: string, text: string) {
  const h = get<HandoffRow>("SELECT * FROM handoffs WHERE id=? AND state='landed' AND (a_player=? OR b_player=?)", handoffId, playerId, playerId);
  if (!h) throw Object.assign(new Error("no landed handoff by that id"), { status: 404 });
  const col = h.a_player === playerId ? "a_note" : "b_note";
  if ((h as any)[col]) throw Object.assign(new Error("you already left your line"), { status: 409 });
  const clean = text.trim().slice(0, 120);
  run(`UPDATE handoffs SET ${col}=? WHERE id=?`, clean, h.id);
  const other = h.a_player === playerId ? h.b_player : h.a_player;
  logEvent("handoff.note", "player", { handoffId: h.id, from: get<{ codename: string }>("SELECT codename FROM players WHERE id=?", playerId)!.codename, text: clean }, other);
  return { ok: true };
}

export function summaryFor(params: any, viewerId: string | null) {
  if (!params?.handoffId) return null;
  const h = get<HandoffRow>("SELECT * FROM handoffs WHERE id=?", params.handoffId);
  if (!h) return null;
  const other = viewerId === h.a_player ? h.b_player : h.a_player;
  return { id: h.id, role: params.handoffRole as "drop" | "pick", partner: h.state === "landed" || params.handoffRole === "pick" ? get<{ codename: string }>("SELECT codename FROM players WHERE id=?", other)?.codename ?? null : null, deadline: h.deadline, mark: h.mark, state: h.state };
}

/** The board's view: the live handoff and the file of partners. */
export function view(playerId: string) {
  const liveRow = liveFor(playerId);
  const codename = (id: string) => get<{ codename: string; faction_id: FactionId }>("SELECT codename, faction_id FROM players WHERE id=?", id);
  const tname = (id: string) => get<{ name: string }>("SELECT name FROM targets WHERE id=?", id)?.name ?? "the site";
  const past = all<HandoffRow>("SELECT * FROM handoffs WHERE (a_player=? OR b_player=?) AND state IN ('landed','failed') ORDER BY resolved_at DESC LIMIT 12", playerId, playerId).map((h) => {
    const me = h.a_player === playerId;
    const other = codename(me ? h.b_player : h.a_player);
    return { id: h.id, role: me ? "drop" : "pick", partner: other?.codename ?? "?", partnerFaction: other?.faction_id ?? null, outcome: h.state, target: tname(h.target_id), at: h.resolved_at, yourNote: me ? h.a_note : h.b_note, theirNote: me ? h.b_note : h.a_note };
  });
  const pairs = all<{ a: string; b: string; landed: number; failed: number }>("SELECT * FROM handoff_pairs WHERE a=? OR b=?", playerId, playerId).map((p) => ({ partner: codename(p.a === playerId ? p.b : p.a)?.codename ?? "?", landed: p.landed, failed: p.failed }));
  return {
    live: liveRow ? { id: liveRow.id, role: liveRow.a_player === playerId ? "drop" : "pick", state: liveRow.state, target: tname(liveRow.target_id), deadline: liveRow.deadline, mark: liveRow.mark, partner: liveRow.state === "dropped" && liveRow.b_player === playerId ? codename(liveRow.a_player)?.codename ?? null : null } : null,
    past, pairs,
  };
}

/** Admin: force a handoff between two codenames (both deployed in the field in one sector). */
export function forcePair(aCodename: string, bCodename: string): { ok: boolean; reason?: string; id?: string } {
  const a = get<{ id: string; faction_id: FactionId }>("SELECT id, faction_id FROM players WHERE codename=?", aCodename);
  const b = get<{ id: string; faction_id: FactionId }>("SELECT id, faction_id FROM players WHERE codename=?", bCodename);
  if (!a || !b) return { ok: false, reason: "unknown codename" };
  if (a.faction_id !== b.faction_id) return { ok: false, reason: "different agencies" };
  const pa = get<{ area_id: string | null }>("SELECT area_id FROM presence WHERE player_id=? AND mode='field' AND expires_at>?", a.id, now());
  const pb = get<{ area_id: string | null }>("SELECT area_id FROM presence WHERE player_id=? AND mode='field' AND expires_at>?", b.id, now());
  if (!pa?.area_id || !pb?.area_id) return { ok: false, reason: "both must be deployed in the field" };
  if (liveFor(a.id) || liveFor(b.id)) return { ok: false, reason: "one of them already has a handoff live" };
  const h = create(a.id, b.id, pa.area_id, a.faction_id!);
  return h ? { ok: true, id: h.id } : { ok: false, reason: "no site within both walk radii" };
}
