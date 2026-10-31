import { createHash } from "node:crypto";
import type {
  Area, Briefing, Contact, DeskMissionDetail, DeskSubmitResponse, Faction, FactionId, MissionSummary, Mode,
  NavigateResponse, OfferCard, Player, Presence, Rank, ScanRequest, ScanResponse, Skills, TemplateId,
} from "@ispy/shared";
import { all, get, run, tx, now, uid, json, parse, logEvent, worldGet, db } from "./db.ts";
import { areaForPoint, bearingDeg, distanceM, offsetM, type AreaRow } from "./geo.ts";
import { openSector, settleSector, layWaypoints } from "./sectors.ts";
import { FACTIONS, PERSONAS, RANKS, factionById } from "./content.ts";
import { makeAnalysis, makeCipher, norm, pick, rand } from "./puzzles.ts";
import { planArea, fallbackPlan, type AreaPlan } from "./chiefs.ts";
import { award, rankFor } from "./rewards.ts";
import { param } from "./params.ts";
import * as investigations from "./investigations.ts";
import * as bounties from "./bounties.ts";
import * as chains from "./chains.ts";
import * as crises from "./crises.ts";
import * as rivalry from "./rivalry.ts";

export const DEV_SIM = process.env.DEV_SIM === "1";
/** Once an operative finishes a site, it is theirs (their agency's) for this long: nobody else can run it. */
export const TARGET_LOCK_MS = 120 * 60_000;
db.exec(`CREATE TABLE IF NOT EXISTS target_locks (
  target_id TEXT PRIMARY KEY, faction_id TEXT NOT NULL, player_id TEXT NOT NULL, mission_id TEXT NOT NULL, until TEXT NOT NULL, at TEXT NOT NULL
)`);
interface LockRow { target_id: string; faction_id: FactionId; player_id: string; mission_id: string; until: string; at: string }
export const lockOn = (targetId: string | null) => targetId ? get<LockRow>("SELECT * FROM target_locks WHERE target_id=? AND until>?", targetId, now()) : undefined;
/** Collaborative work and intel extraction are open to everyone regardless of locks. */
const exemptFromLocks = (m: { template_id: string; params: string }) => {
  const pr = parse<any>(m.params, {});
  return m.template_id === "EXTRACTION" || !!pr?.crisisId || (Array.isArray(pr?.jointWith) && pr.jointWith.length > 0);
};
/** Who holds how many sites in a sector right now. */
export function sectorControl(areaId: string): Record<FactionId, number> {
  const out = Object.fromEntries(FACTIONS.map((f) => [f.id, 0])) as Record<FactionId, number>;
  for (const r of all<{ faction_id: FactionId; n: number }>("SELECT l.faction_id, COUNT(*) n FROM target_locks l JOIN targets t ON t.id=l.target_id WHERE t.area_id=? AND l.until>? GROUP BY l.faction_id", areaId, now())) out[r.faction_id] = r.n;
  return out;
}
const PRESENCE_TTL_MS = 15 * 60_000;
const OFFER_TTL_MS = () => param("offerTtlSec") * 1000;
const MISSION_TTL_MS = 90 * 60_000;
const PLAN_TTL_MS = 60 * 60_000;

const CONTEST_WINDOW_MS = 30 * 60_000;
const WALK_SPEED_MAX_MPS = 25_000 / 3600;

// ---------- rows ----------
interface PlayerRow { id: string; codename: string; faction_id: FactionId | null; rank: Rank; xp: number; trust: number; skills: string; credits: number }
interface PresenceRow { player_id: string; area_id: string | null; mode: Mode; checked_in_at: string; expires_at: string; last_lat: number | null; last_lng: number | null; last_fix_at: string | null }
interface TargetRow { id: string; area_id: string; name: string; kind: string; lat: number; lng: number; approach_radius_m: number; safe_start: number; safe_end: number; capacity: number; state: string; observation: string; observation_answer: string }
interface MissionRow {
  id: string; faction_id: FactionId; area_id: string; template_id: TemplateId; mode: Mode; target_id: string | null;
  assignee_id: string | null; state: string; title: string; brief: string; params: string; reward_xp: number;
  contested_group_id: string | null; desk_link_id: string | null; version: number; expires_at: string; created_at: string;
  accepted_at: string | null; completed_at: string | null; outcome: string | null; reserved_for: string | null;
}
interface DeskLinkRow { id: string; desk_mission_id: string; field_mission_id: string; state: string; fallback_after_s: number; started_at: string | null; fulfilled_at: string | null }
interface OfferRow { id: string; mission_id: string; player_id: string; state: string; expires_at: string; created_at: string }

export class ApiError extends Error { constructor(public status: number, msg: string) { super(msg); } }
export const paused = () => worldGet("paused", "0") === "1";

// ---------- players ----------
export { rankFor };
export function playerView(id: string): Player {
  const p = get<PlayerRow>("SELECT * FROM players WHERE id=?", id);
  if (!p) throw new ApiError(401, "unknown player");
  const r = p.faction_id ? rankFor(p.xp) : RANKS[0];
  const today = now().slice(0, 10);
  const fieldToday = get<{ n: number }>(
    "SELECT COUNT(*) n FROM missions WHERE assignee_id=? AND mode='field' AND state='completed' AND completed_at >= ?", id, today,
  )!.n;
  return {
    id: p.id, codename: p.codename, factionId: p.faction_id, rank: r.rank, xp: p.xp, trust: p.trust,
    skills: { observation: 0.5, reasoning: 0.5, cipher: 0.5, cooperation: 0.5, ...parse<Partial<Skills>>(p.skills, {}) },
    walkRadiusM: Math.round(r.walkM * param("walkScale")), dailyFieldCap: r.cap, fieldToday, credits: p.credits ?? 0,
  };
}
export const playerFaction = (p: Player): Faction | null => (p.factionId ? factionById(p.factionId) : null);


// ---------- presence ----------
export function getPresence(playerId: string): Presence | null {
  const r = get<PresenceRow>("SELECT * FROM presence WHERE player_id=? AND expires_at > ?", playerId, now());
  if (!r) return null;
  const area = r.area_id ? get<AreaRow>("SELECT * FROM areas WHERE id=?", r.area_id) : undefined;
  return { mode: r.mode, areaId: r.area_id, areaName: area?.name ?? null, expiresAt: r.expires_at };
}

export function checkIn(player: Player, body: { mode: Mode; lat?: number; lng?: number; mock?: boolean; sim?: boolean }): Presence {
  if (!player.factionId) throw new ApiError(400, "join a faction first");
  if (paused()) throw new ApiError(503, "the world is paused");
  let areaId: string | null = null;
  let lat: number | null = null, lng: number | null = null;
  let opened: string | null = null;
  if (body.mode === "field") {
    if (body.lat == null || body.lng == null) throw new ApiError(400, "field deployment needs a location fix");
    if (body.sim && !DEV_SIM) throw new ApiError(400, "simulated location is not allowed");
    if (body.mock && !body.sim) throw new ApiError(400, "mock location provider detected");
    let area = areaForPoint(body.lat, body.lng);
    if (!area) {
      // Nobody is turned away: the World Director opens a sector around the operative, then names it
      // and furnishes it with real public places in the background.
      area = openSector(body.lat, body.lng, player.id);
      opened = area.id;
    }
    areaId = area.id; lat = body.lat; lng = body.lng;
  } else {
    // Desk agents are tied to their home area: the area with the most activity for the alpha.
    areaId = get<AreaRow>("SELECT * FROM areas ORDER BY id LIMIT 1")?.id ?? null;
  }
  const t = now();
  const exp = new Date(Date.now() + PRESENCE_TTL_MS).toISOString();
  run(`INSERT INTO presence(player_id,area_id,mode,checked_in_at,expires_at,last_lat,last_lng,last_fix_at) VALUES(?,?,?,?,?,?,?,?)
       ON CONFLICT(player_id) DO UPDATE SET area_id=excluded.area_id, mode=excluded.mode, checked_in_at=excluded.checked_in_at,
       expires_at=excluded.expires_at, last_lat=excluded.last_lat, last_lng=excluded.last_lng, last_fix_at=excluded.last_fix_at`,
    player.id, areaId, body.mode, t, exp, lat, lng, lat != null ? t : null);
  logEvent("presence.check_in", "player", { mode: body.mode, areaId, openedSector: opened }, player.id);
  if (opened) void furnishSector(opened);
  return getPresence(player.id)!;
}

/** After a sector opens: chiefs plan it right away so the pool fills; the survey of real places runs behind. The Director reacts to `sector.settled`. */
async function furnishSector(areaId: string) {
  try {
    // Public ground only: footpath waypoints first (seconds), then the survey of real public places.
    await layWaypoints(areaId);
    await refreshPlans(true, { areaId, reason: "a new sector just opened with an operative already on the ground; keep the first walks short" });
    refreshPool();
    await settleSector(areaId);
  } catch (e) { console.warn("[sectors] furnishing failed:", (e as Error).message); }
}

export function heartbeat(player: Player, body: { lat?: number; lng?: number; sim?: boolean }): Presence {
  const r = get<PresenceRow>("SELECT * FROM presence WHERE player_id=?", player.id);
  if (!r || r.expires_at <= now()) throw new ApiError(409, "not deployed");
  if (body.sim && !DEV_SIM) throw new ApiError(400, "simulated location is not allowed");
  const exp = new Date(Date.now() + PRESENCE_TTL_MS).toISOString();
  if (r.mode === "field" && body.lat != null && body.lng != null) {
    const area = areaForPoint(body.lat, body.lng);
    run("UPDATE presence SET expires_at=?, area_id=?, last_lat=?, last_lng=?, last_fix_at=? WHERE player_id=?",
      exp, area?.id ?? null, body.lat, body.lng, now(), player.id);
  } else {
    run("UPDATE presence SET expires_at=? WHERE player_id=?", exp, player.id);
  }
  return getPresence(player.id)!;
}

export function checkOut(player: Player) {
  run("DELETE FROM presence WHERE player_id=?", player.id);
  run("UPDATE offers SET state='expired' WHERE player_id=? AND state='open'", player.id);
  logEvent("presence.check_out", "player", {}, player.id);
}

// ---------- chief strategy ----------
function latestPlan(factionId: FactionId, areaId: string): { plan: AreaPlan; created_at: string } | null {
  const r = get<{ plan: string; created_at: string }>(
    "SELECT plan, created_at FROM area_plans WHERE faction_id=? AND area_id=? ORDER BY created_at DESC LIMIT 1", factionId, areaId);
  return r ? { plan: parse<AreaPlan>(r.plan, null as any), created_at: r.created_at } : null;
}

export async function refreshPlans(force = false, only?: { factionId?: FactionId; areaId?: string; reason?: string }) {
  const areas = all<AreaRow>("SELECT * FROM areas").filter((a) => !only?.areaId || a.id === only.areaId);
  for (const area of areas) {
    for (const f of FACTIONS.filter((x) => !only?.factionId || x.id === only.factionId)) {
      const cur = latestPlan(f.id, area.id);
      if (!force && cur && Date.parse(cur.created_at) > Date.now() - PLAN_TTL_MS) continue;
      const fieldAgents = get<{ n: number }>(
        "SELECT COUNT(*) n FROM presence p JOIN players pl ON pl.id=p.player_id WHERE p.area_id=? AND pl.faction_id=? AND p.mode='field' AND p.expires_at>?",
        area.id, f.id, now())!.n;
      const deskAgents = get<{ n: number }>(
        "SELECT COUNT(*) n FROM presence p JOIN players pl ON pl.id=p.player_id WHERE p.area_id=? AND pl.faction_id=? AND p.mode='desk' AND p.expires_at>?",
        area.id, f.id, now())!.n;
      const rivals = get<{ n: number }>(
        "SELECT COUNT(*) n FROM presence p JOIN players pl ON pl.id=p.player_id WHERE p.area_id=? AND pl.faction_id<>? AND p.mode='field' AND p.expires_at>?",
        area.id, f.id, now())!.n;
      const rivalAgentsBucket = rivals === 0 ? "0" : rivals <= 3 ? "1-3" : rivals <= 10 ? "4-10" : "10+";
      const recentOutcomes = all<{ template: TemplateId; outcome: string }>(
        "SELECT template_id template, outcome FROM missions WHERE faction_id=? AND area_id=? AND outcome IS NOT NULL ORDER BY completed_at DESC LIMIT 10", f.id, area.id);
      const ctl = sectorControl(area.id);
      const held = `${ctl[f.id]} held by us, ${Object.entries(ctl).filter(([k]) => k !== f.id).map(([k, v]) => `${factionById(k as FactionId).name} ${v}`).join(", ")}`;
      const { plan, source } = await planArea(f.chief, f, { areaName: area.name, fieldAgents, deskAgents, rivalAgentsBucket, recentOutcomes, reason: only?.reason, held });
      run("INSERT INTO area_plans(id,faction_id,area_id,plan,source,created_at) VALUES(?,?,?,?,?,?)", uid(), f.id, area.id, json(plan), source, now());
      logEvent("area_plan.published", `chief:${f.chief}`, { areaId: area.id, source, headline: plan.headline, contestAppetite: plan.contestAppetite }, null);
    }
  }
}

// ---------- mission pool ----------
function openTargets(areaId: string): TargetRow[] {
  const hour = new Date().getHours();
  // Held sites are off the board for everyone else until the lock lapses.
  const held = "id NOT IN (SELECT target_id FROM target_locks WHERE until>?)";
  // Dev simulation ignores safe hours so the loop can be tested at night.
  if (DEV_SIM) return all<TargetRow>(`SELECT * FROM targets WHERE area_id=? AND state='ACTIVE' AND ${held}`, areaId, now());
  return all<TargetRow>(`SELECT * FROM targets WHERE area_id=? AND state='ACTIVE' AND safe_start<=? AND safe_end>? AND ${held}`, areaId, hour, hour, now());
}
/** Why the board is empty, for the app to show. */
export function boardNotice(player: Player, pres: Presence | null): string | null {
  if (paused()) return "The world is paused by the owner.";
  if (!pres) return null;
  if (!pres.areaId) return "You are outside a play area.";
  if (!get("SELECT 1 FROM targets WHERE area_id=? AND state='ACTIVE'", pres.areaId)) return "Surveying this sector for public ground. Orders follow in a moment.";
  if (pres.mode === "field" && player.fieldToday >= player.dailyFieldCap) return "Daily field cap reached. Rest, or switch to the intel desk.";
  if (!openTargets(pres.areaId).length) return "Targets are closed for the night. Field play resumes at 06:00.";
  return null;
}
function weightedTemplate(mix: AreaPlan["mix"], mode: Mode, seed: string): TemplateId {
  const pool: TemplateId[] = mode === "field" ? ["RECON", "DEAD_DROP", "EXTRACTION"] : ["ANALYSIS", "CIPHER"];
  const total = pool.reduce((s, t) => s + (mix[t] ?? 0), 0) || 1;
  let r = rand(seed) * total;
  for (const t of pool) { r -= mix[t] ?? 0; if (r <= 0) return t; }
  return pool[pool.length - 1];
}
const flavour = (f: Faction, t: TemplateId, targetName: string, seed: string) =>
  pick(PERSONAS[f.chief].lines[t], seed).replace("{target}", targetName);

const TITLES: Record<TemplateId, string> = {
  RECON: "Reconnaissance", DEAD_DROP: "Dead drop", EXTRACTION: "Extraction", ANALYSIS: "Site analysis", CIPHER: "Cipher break",
};
const XP: Record<TemplateId, number> = { RECON: 120, DEAD_DROP: 180, EXTRACTION: 240, ANALYSIS: 100, CIPHER: 110 };

function createMission(f: Faction, areaId: string, template: TemplateId, mode: Mode, target: TargetRow | null, params: Record<string, unknown>, seed: string, over?: { title?: string; brief?: string; reservedFor?: string }) {
  const id = uid();
  const brief = over?.brief ?? flavour(f, template, target?.name ?? "the area", seed);
  run(`INSERT INTO missions(id,faction_id,area_id,template_id,mode,target_id,state,title,brief,params,reward_xp,expires_at,created_at,reserved_for)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    id, f.id, areaId, template, mode, target?.id ?? null, "pool", over?.title ?? TITLES[template], brief, json(params), XP[template],
    new Date(Date.now() + MISSION_TTL_MS).toISOString(), now(), over?.reservedFor ?? null);
  return id;
}

/** Neutral allocator: a field mission on a target another faction also wants within the window may become contested. */
function maybeContest(missionId: string, factionId: FactionId, targetId: string, appetite: number) {
  const since = new Date(Date.now() - CONTEST_WINDOW_MS).toISOString();
  const rival = get<MissionRow>(
    "SELECT * FROM missions WHERE target_id=? AND faction_id<>? AND mode='field' AND state IN ('pool','offered','accepted','active') AND contested_group_id IS NULL AND created_at>? LIMIT 1",
    targetId, factionId, since);
  if (!rival) return;
  const rivalPlan = latestPlan(rival.faction_id, rival.area_id)?.plan;
  const p = Math.min(1, Math.max(0, Math.min(appetite, rivalPlan?.contestAppetite ?? 0.3) + param("contestAppetiteBoost")));
  if (rand(missionId + rival.id) > p) return;
  const perHour = get<{ n: number }>("SELECT COUNT(DISTINCT contested_group_id) n FROM missions WHERE contested_group_id IS NOT NULL AND created_at>?",
    new Date(Date.now() - 3_600_000).toISOString())!.n;
  if (perHour >= param("contestsPerHour")) return;
  const g = uid();
  run("UPDATE missions SET contested_group_id=? WHERE id IN (?,?)", g, missionId, rival.id);
  logEvent("contest.formed", "allocator", { group: g, missions: [missionId, rival.id], targetId }, null);
}

export function refreshPool() {
  if (paused()) return;
  sweepExpiry();
  const areas = all<AreaRow>("SELECT * FROM areas");
  for (const area of areas) {
    const targets = openTargets(area.id);
    if (!targets.length) continue;
    for (const f of FACTIONS) {
      const plan = latestPlan(f.id, area.id)?.plan;
      if (!plan) continue;
      for (const mode of ["field", "desk"] as Mode[]) {
        const have = get<{ n: number }>("SELECT COUNT(*) n FROM missions WHERE faction_id=? AND area_id=? AND mode=? AND state='pool'", f.id, area.id, mode)!.n;
        for (let i = have; i < param("poolPerMode"); i++) {
          const seed = `${f.id}:${area.id}:${mode}:${now()}:${i}`;
          const template = weightedTemplate(plan.mix, mode, seed);
          tx(() => buildMission(f, area, template, mode, targets, plan, seed));
        }
      }
    }
  }
}

/** Pick a target near this faction's deployed field agents: closest ones most likely, with some spread. */
function nearbyTarget(f: Faction, areaId: string, targets: TargetRow[], seed: string): TargetRow {
  const agents = all<{ lat: number; lng: number }>(
    "SELECT p.last_lat lat, p.last_lng lng FROM presence p JOIN players pl ON pl.id=p.player_id WHERE pl.faction_id=? AND p.area_id=? AND p.mode='field' AND p.expires_at>? AND p.last_lat IS NOT NULL",
    f.id, areaId, now());
  if (!agents.length) return pick(targets, seed + ":t");
  const inPool = new Set(all<{ target_id: string }>("SELECT target_id FROM missions WHERE faction_id=? AND state IN ('pool','offered') AND target_id IS NOT NULL", f.id).map((r) => r.target_id));
  const scored = targets.map((t) => {
    const d = Math.min(...agents.map((a) => distanceM(a.lat, a.lng, t.lat, t.lng)));
    // Nearer is better, but never the same target twice in the pool; keep a little randomness so routes vary.
    return { t, w: (inPool.has(t.id) ? 0.15 : 1) / (120 + d) * (0.7 + 0.6 * rand(seed + t.id)) };
  });
  const total = scored.reduce((s, x) => s + x.w, 0);
  let r = rand(seed + ":pick") * total;
  for (const x of scored) { r -= x.w; if (r <= 0) return x.t; }
  return scored[scored.length - 1].t;
}

/** A link of an operation: a real field mission at the chosen site, reserved for one operative, with the Director's brief. */
const spawnLink: chains.SpawnStep = (chain, step, index) => {
  const f = factionById(chain.faction_id);
  const area = get<AreaRow>("SELECT * FROM areas WHERE id=?", chain.area_id)!;
  const target = get<TargetRow>("SELECT * FROM targets WHERE id=?", step.targetId)!;
  const targets = all<TargetRow>("SELECT * FROM targets WHERE area_id=? AND state='ACTIVE'", chain.area_id);
  const plan = latestPlan(f.id, area.id)?.plan ?? fallbackPlan(f.chief, { areaName: area.name, fieldAgents: 1, deskAgents: 0, rivalAgentsBucket: "0", recentOutcomes: [] });
  const id = buildMission(f, area, step.template, "field", targets, plan, `${chain.id}:${index}`, { target, over: { title: step.title, brief: step.brief, reservedFor: chain.player_id }, extraParams: { chainId: chain.id, chainStep: index } })!;
  return id;
};
export const startOperation = (playerId: string, theme?: string) => chains.startChain(playerId, spawnLink, theme);

/** A crisis mission: presence-verified at the site, in the agency's chosen stance, open to pact allies. */
const spawnCrisisMission: crises.SpawnCrisisMission = (crisis, factionId, site, stance, title, brief, jointWith) => {
  const f = factionById(factionId);
  const target = get<TargetRow>("SELECT * FROM targets WHERE id=?", site.targetId)!;
  const id = createMission(f, crisis.area_id, "RECON", "field", target, { crisisId: crisis.id, siteId: site.targetId, stance, jointWith, needsObservation: false }, `${crisis.id}:${factionId}:${site.targetId}`, { title, brief });
  run("UPDATE missions SET expires_at=? WHERE id=?", crisis.ends_at, id);
  return id;
};
export const brewCrisis = (areaId: string, opts?: { kind?: string; theme?: string; minutes?: number }) => crises.brew(areaId, spawnCrisisMission, opts);

function buildMission(f: Faction, area: AreaRow, template: TemplateId, mode: Mode, targets: TargetRow[], plan: AreaPlan, seed: string,
  fixed?: { target: TargetRow; over: { title?: string; brief?: string; reservedFor?: string }; extraParams: Record<string, unknown> }): string | undefined {
  const target = fixed?.target ?? (mode === "field" ? nearbyTarget(f, area.id, targets, seed) : pick(targets, seed + ":t"));
  const over = fixed?.over; const extra = fixed?.extraParams ?? {};
  if (mode === "field") {
    if (template === "EXTRACTION") {
      // Second leg: the nearest other target to the first, so an extraction is a walk, not a trek.
      const second = targets.filter((t) => t.id !== target.id).sort((a, b) => distanceM(target.lat, target.lng, a.lat, a.lng) - distanceM(target.lat, target.lng, b.lat, b.lng))[0] ?? target;
      const id = createMission(f, area.id, template, mode, target, { ...extra, route: [target.id, second.id], leg: 0 }, seed, over);
      if (!fixed) maybeContest(id, f.id, target.id, plan.contestAppetite);
      return id;
    }
    const id = createMission(f, area.id, template, mode, target, { ...extra, needsObservation: template === "RECON" }, seed, over);
    if (!fixed) maybeContest(id, f.id, target.id, plan.contestAppetite);
    if (template === "DEAD_DROP") {
      // Pair with a desk cipher whose answer is the pickup code.
      const cipher = makeCipher(seed + ":c");
      const deskId = createMission(f, area.id, "CIPHER", "desk", null, { puzzle: cipher, forField: id }, seed + ":d");
      const linkId = uid();
      run("INSERT INTO desk_links(id,desk_mission_id,field_mission_id,state,fallback_after_s) VALUES(?,?,?,?,?)", linkId, deskId, id, "open", Math.round(param("deskLinkFallbackMin") * 60));
      run("UPDATE missions SET desk_link_id=?, params=? WHERE id=?", linkId, json({ ...extra, pickupCode: cipher.answer }), id);
      run("UPDATE missions SET desk_link_id=? WHERE id=?", linkId, deskId);
    }
    return id;
  }
  // desk
  if (template === "ANALYSIS") {
    const decoys = targets.filter((t) => t.id !== target.id).slice(0, 2).map((t) => t.name);
    const puzzle = makeAnalysis(seed, target.name, decoys);
    return createMission(f, area.id, template, mode, null, { puzzle }, seed);
  } else {
    return createMission(f, area.id, "CIPHER", mode, null, { puzzle: makeCipher(seed + ":c") }, seed);
  }
}

function sweepExpiry() {
  const t = now();
  run("UPDATE offers SET state='expired' WHERE state='open' AND expires_at<=?", t);
  for (const m of all<MissionRow>("SELECT * FROM missions WHERE state IN ('pool','offered','accepted','active') AND expires_at<=?", t)) {
    run("UPDATE missions SET state='expired', outcome='expired' WHERE id=?", m.id);
    if (m.assignee_id) logEvent("mission.expired", "authority", { missionId: m.id, title: m.title }, m.assignee_id);
    const link = chains.chainOf(m.params);
    if (link && m.reserved_for) chains.onLinkLost(m.reserved_for, link.chainId, "link expired");
  }
  run("UPDATE missions SET state='pool', assignee_id=NULL WHERE state='offered' AND id NOT IN (SELECT mission_id FROM offers WHERE state='open')");
  // Desk-link fallbacks: field agent gets a solo puzzle once the window passes.
  for (const l of all<DeskLinkRow>("SELECT * FROM desk_links WHERE state='open' AND started_at IS NOT NULL")) {
    if (Date.parse(l.started_at!) + l.fallback_after_s * 1000 <= Date.now()) {
      run("UPDATE desk_links SET state='fallback' WHERE id=?", l.id);
      logEvent("desk_link.fallback", "authority", { link: l.id }, null);
    }
  }
}

// ---------- matcher & offers ----------
function summary(m: MissionRow, p?: Player, pres?: PresenceRow | null): MissionSummary {
  const area = get<AreaRow>("SELECT * FROM areas WHERE id=?", m.area_id)!;
  const target = m.target_id ? get<TargetRow>("SELECT * FROM targets WHERE id=?", m.target_id) : undefined;
  const link = m.desk_link_id ? get<DeskLinkRow>("SELECT * FROM desk_links WHERE id=?", m.desk_link_id) : undefined;
  const walkM = target && pres?.last_lat != null ? Math.round(distanceM(pres.last_lat, pres.last_lng!, target.lat, target.lng)) : undefined;
  return {
    id: m.id, templateId: m.template_id, mode: m.mode, title: m.title, brief: m.brief, rewardXp: m.reward_xp,
    expiresAt: m.expires_at, state: m.state as MissionSummary["state"], contested: !!m.contested_group_id,
    areaName: area.name, targetName: target?.name, walkM,
    deskLink: link ? { state: link.state as any, fallbackAt: link.started_at ? new Date(Date.parse(link.started_at) + link.fallback_after_s * 1000).toISOString() : "" } : null,
    chain: (() => { const c = chains.chainOf(m.params); return c ? chains.chainSummary(c.chainId) : null; })(),
    heldBy: m.target_id ? lockOn(m.target_id)?.faction_id ?? null : null,
    crisis: (() => {
      const pr = parse<any>(m.params, {});
      if (!pr?.crisisId) return null;
      const c = get<{ name: string }>("SELECT name FROM crises WHERE id=?", pr.crisisId);
      return c ? { name: c.name, stance: pr.stance, joint: p?.factionId && p.factionId !== m.faction_id ? factionById(m.faction_id).name : null } : null;
    })(),
  };
}

const skillFit = (s: Skills, t: TemplateId) =>
  ({ RECON: s.observation, DEAD_DROP: (s.observation + s.cooperation) / 2, EXTRACTION: (s.reasoning + s.observation) / 2, ANALYSIS: s.reasoning, CIPHER: s.cipher })[t];

export function offersFor(player: Player): OfferCard[] {
  sweepExpiry();
  const pres = get<PresenceRow>("SELECT * FROM presence WHERE player_id=? AND expires_at>?", player.id, now());
  if (!pres || !pres.area_id || !player.factionId || paused()) return [];
  if (activeMission(player, pres.mode)) return [];
  const open = all<OfferRow>("SELECT * FROM offers WHERE player_id=? AND state='open'", player.id);
  if (open.length < 2) {
    if (pres.mode === "field" && player.fieldToday >= player.dailyFieldCap) return [];
    const recentTargets = new Set(all<{ target_id: string }>(
      "SELECT target_id FROM missions WHERE assignee_id=? AND completed_at > ?", player.id, new Date(Date.now() - 86_400_000).toISOString()).map((r) => r.target_id));
    const offeredIds = new Set(open.map((o) => o.mission_id));
    const poolQuery = () => [
      ...all<MissionRow>("SELECT * FROM missions WHERE faction_id=? AND area_id=? AND mode=? AND state='pool' AND (reserved_for IS NULL OR reserved_for=?)", player.factionId, pres.area_id, pres.mode, player.id),
      // Joint operations: an allied agency's crisis missions in this sector, when a pact names us.
      ...(pres.mode === "field" ? all<MissionRow>("SELECT * FROM missions WHERE faction_id<>? AND area_id=? AND mode='field' AND state='pool' AND json_extract(params,'$.crisisId') IS NOT NULL AND EXISTS (SELECT 1 FROM json_each(json_extract(params,'$.jointWith')) WHERE value=?)", player.factionId, pres.area_id, player.factionId) : []),
    ].filter((m) => !offeredIds.has(m.id));
    let pool = poolQuery();
    if (!pool.length) { refreshPool(); pool = poolQuery(); }
    const scored = pool.map((m) => {
      const s = summary(m, player, pres);
      if (pres.mode === "field") {
        if (s.walkM == null || (s.walkM > player.walkRadiusM && m.reserved_for !== player.id)) return null;
        if (m.target_id && recentTargets.has(m.target_id) && m.reserved_for !== player.id) return null;
        if (m.target_id && !exemptFromLocks(m) && lockOn(m.target_id)) return null;
      }
      // Proximity first: a 150 m walk scores near 1, the edge of the radius near 0.
      const dist = pres.mode === "field" ? 1 - Math.min(1, Math.max(0, (s.walkM ?? 0) - 100) / Math.max(1, player.walkRadiusM - 100)) : 0.5;
      // A desk mission with a field agent already waiting on it outranks everything else.
      const waiting = pres.mode === "desk" && m.desk_link_id && get(
        "SELECT 1 FROM desk_links l JOIN missions f ON f.id=l.field_mission_id WHERE l.id=? AND l.state='open' AND f.state='active'", m.desk_link_id) ? 1 : 0;
      // The next link of the operative's own operation goes to the front of the line.
      const link = m.reserved_for === player.id ? 2 : 0;
      const urgent = parse<any>(m.params, {})?.crisisId ? 1 : 0;
      const score = link + urgent + waiting + 0.6 * dist + 0.3 * skillFit(player.skills, m.template_id) + 0.1 * rand(m.id + player.id);
      return { m, score };
    }).filter((x): x is { m: MissionRow; score: number } => !!x).sort((a, b) => b.score - a.score);
    // Rookie rule: until the first field verification, the board is one recon at the nearest site, so the
    // first real-world win comes within minutes and verifies by presence wherever that is possible.
    const rookie = pres.mode === "field" && !get("SELECT 1 FROM missions WHERE assignee_id=? AND mode='field' AND state='completed'", player.id);
    if (rookie && scored.length) {
      const byWalk = [...scored].filter(({ m }) => m.template_id === "RECON").sort((a, b) => (summary(a.m, player, pres).walkM ?? 1e9) - (summary(b.m, player, pres).walkM ?? 1e9));
      const presenceOnly = byWalk.find(({ m }) => !get<{ o: string }>("SELECT observation o FROM targets WHERE id=?", m.target_id)?.o);
      const first = presenceOnly ?? byWalk[0];
      if (first) { scored.length = 0; scored.push(first); }
    }
    // Two offers to the same site are one choice, not two: keep the best per target.
    const seenTarget = new Set<string>(open.map((o) => get<{ target_id: string | null }>("SELECT target_id FROM missions WHERE id=?", o.mission_id)?.target_id ?? "").filter(Boolean));
    const distinct = scored.filter(({ m }) => { if (!m.target_id) return true; if (seenTarget.has(m.target_id)) return false; seenTarget.add(m.target_id); return true; });
    for (const { m } of distinct.slice(0, 2 - open.length)) {
      const id = uid();
      run("INSERT INTO offers(id,mission_id,player_id,state,expires_at,created_at) VALUES(?,?,?,?,?,?)",
        id, m.id, player.id, "open", new Date(Date.now() + OFFER_TTL_MS()).toISOString(), now());
      run("UPDATE missions SET state='offered' WHERE id=?", m.id);
      logEvent("mission.offered", "matcher", { missionId: m.id, template: m.template_id }, player.id);
    }
  }
  return all<OfferRow>("SELECT * FROM offers WHERE player_id=? AND state='open'", player.id).map((o) => ({
    offerId: o.id, acceptBy: o.expires_at, mission: summary(get<MissionRow>("SELECT * FROM missions WHERE id=?", o.mission_id)!, player, pres),
  }));
}

/** A chief hands a specific operative a specific mission: it appears at the top of their board at once. */
export function offerDirect(playerId: string, missionId: string): string | null {
  const m = get<MissionRow>("SELECT * FROM missions WHERE id=? AND state='pool'", missionId);
  if (!m) return null;
  if (get("SELECT 1 FROM offers WHERE player_id=? AND mission_id=? AND state='open'", playerId, missionId)) return null;
  const id = uid();
  run("INSERT INTO offers(id,mission_id,player_id,state,expires_at,created_at) VALUES(?,?,?,?,?,?)", id, missionId, playerId, "open", new Date(Date.now() + OFFER_TTL_MS()).toISOString(), now());
  run("UPDATE missions SET state='offered' WHERE id=?", missionId);
  logEvent("mission.offered", "chief", { missionId, template: m.template_id, direct: true }, playerId);
  return id;
}

export function acceptOffer(player: Player, offerId: string): MissionSummary {
  return tx(() => {
    const o = get<OfferRow>("SELECT * FROM offers WHERE id=? AND player_id=? AND state='open'", offerId, player.id);
    if (!o || o.expires_at <= now()) throw new ApiError(410, "offer expired");
    const m = get<MissionRow>("SELECT * FROM missions WHERE id=? AND state='offered'", o.mission_id);
    if (!m) throw new ApiError(409, "mission no longer available");
    run("UPDATE offers SET state='accepted' WHERE id=?", o.id);
    run("UPDATE offers SET state='declined' WHERE player_id=? AND state='open'", player.id);
    run("UPDATE missions SET state='active', assignee_id=?, accepted_at=?, version=version+1 WHERE id=? AND version=?", player.id, now(), m.id, m.version);
    if (m.desk_link_id) run("UPDATE desk_links SET started_at=COALESCE(started_at, ?) WHERE id=?", now(), m.desk_link_id);
    logEvent("mission.accepted", "player", { missionId: m.id, title: m.title, contested: !!m.contested_group_id }, player.id);
    return summary(get<MissionRow>("SELECT * FROM missions WHERE id=?", m.id)!, player, get<PresenceRow>("SELECT * FROM presence WHERE player_id=?", player.id));
  });
}
export function declineOffer(player: Player, offerId: string) {
  const o = get<OfferRow>("SELECT * FROM offers WHERE id=? AND player_id=? AND state='open'", offerId, player.id);
  if (!o) return;
  run("UPDATE offers SET state='declined' WHERE id=?", o.id);
  run("UPDATE missions SET state='pool' WHERE id=? AND state='offered'", o.mission_id);
}

export function activeMission(player: Player, mode: Mode): MissionSummary | null {
  const m = get<MissionRow>("SELECT * FROM missions WHERE assignee_id=? AND mode=? AND state='active'", player.id, mode);
  return m ? summary(m, player, get<PresenceRow>("SELECT * FROM presence WHERE player_id=?", player.id)) : null;
}
export function abandon(player: Player, missionId: string) {
  const m = get<MissionRow>("SELECT * FROM missions WHERE id=? AND assignee_id=? AND state='active'", missionId, player.id);
  if (!m) throw new ApiError(404, "no such active mission");
  run("UPDATE missions SET state='cancelled', outcome='abandoned' WHERE id=?", m.id);
  logEvent("mission.abandoned", "player", { missionId: m.id, title: m.title }, player.id);
  const link = chains.chainOf(m.params);
  if (link) chains.onLinkLost(player.id, link.chainId, "link abandoned");
}

// ---------- navigation & verification ----------
function currentTarget(m: MissionRow): TargetRow {
  const params = parse<any>(m.params, {});
  const id = m.template_id === "EXTRACTION" ? params.route[params.leg] : m.target_id;
  return get<TargetRow>("SELECT * FROM targets WHERE id=?", id)!;
}

export function navigate(player: Player, missionId: string): NavigateResponse {
  const m = get<MissionRow>("SELECT * FROM missions WHERE id=? AND assignee_id=? AND state='active'", missionId, player.id);
  if (!m) throw new ApiError(404, "no such active mission");
  const t = currentTarget(m);
  const link = m.desk_link_id ? get<DeskLinkRow>("SELECT * FROM desk_links WHERE id=?", m.desk_link_id) : undefined;
  const unlocked = !link || link.state !== "open";
  const params = parse<any>(m.params, {});
  const steps = m.template_id === "EXTRACTION"
    ? [`Leg ${params.leg + 1} of 2: reach ${t.name}`, "Scan on arrival", "Continue to the next checkpoint"]
    : m.template_id === "DEAD_DROP"
      ? ["Walk to the drop", unlocked ? "Scan and enter the pickup code" : "Wait for your analyst to crack the code", "Leave quietly"]
      : ["Walk to the site", "Scan on arrival", "Answer the observation question"];
  return {
    targetName: t.name, lat: t.lat, lng: t.lng, approachRadiusM: t.approach_radius_m, heldBy: lockOn(t.id)?.faction_id ?? null,
    heldByCodename: (() => { const l = lockOn(t.id); return l ? get<{ codename: string }>("SELECT codename FROM players WHERE id=?", l.player_id)?.codename ?? null : null; })(),
    faceoff: (() => { const f = rivalry.liveFaceoffFor(player.id, t.id); return f ? { id: f.id, rivalCodename: f.rivalCodename, rivalFaction: f.rivalFaction, endsAt: f.endsAt } : null; })(),
    hint: `${t.kind}: ${t.name}`, unlocked, steps,
  };
}

function verifyFix(player: Player, m: MissionRow, body: ScanRequest, t: TargetRow): { trust: number; reasons: string[]; distance: number } {
  const reasons: string[] = [];
  let trust = 1;
  if (body.sim) { if (!DEV_SIM) throw new ApiError(400, "simulated location is not allowed"); reasons.push("sim"); }
  if (body.mock && !body.sim) { trust -= 0.7; reasons.push("mock_provider"); }
  if (body.accuracyM != null && body.accuracyM > t.approach_radius_m * 2) { trust -= 0.3; reasons.push("poor_accuracy"); }
  const pres = get<PresenceRow>("SELECT * FROM presence WHERE player_id=?", player.id);
  if (pres?.last_lat != null && pres.last_fix_at) {
    const dt = (Date.now() - Date.parse(pres.last_fix_at)) / 1000;
    const d = distanceM(pres.last_lat, pres.last_lng!, body.lat, body.lng);
    if (dt > 0 && d / dt > WALK_SPEED_MAX_MPS && !body.sim) { trust -= 0.5; reasons.push("implausible_speed"); }
  }
  const last = get<{ lat: number; lng: number }>("SELECT lat,lng FROM scans WHERE player_id=? ORDER BY id DESC LIMIT 1", player.id);
  if (last && last.lat === body.lat && last.lng === body.lng && !body.sim) { trust -= 0.2; reasons.push("identical_fix"); }
  const distance = distanceM(body.lat, body.lng, t.lat, t.lng);
  run("INSERT INTO scans(player_id,mission_id,lat,lng,trust,reasons,at) VALUES(?,?,?,?,?,?,?)", player.id, m.id, body.lat, body.lng, trust, json(reasons), now());
  run("UPDATE presence SET last_lat=?, last_lng=?, last_fix_at=? WHERE player_id=?", body.lat, body.lng, now(), player.id);
  return { trust, reasons, distance };
}

export function scan(player: Player, missionId: string, body: ScanRequest): ScanResponse {
  const m = get<MissionRow>("SELECT * FROM missions WHERE id=? AND assignee_id=? AND state='active'", missionId, player.id);
  if (!m) throw new ApiError(404, "no such active mission");
  if (paused()) throw new ApiError(503, "the world is paused");
  const t = currentTarget(m);
  const { trust, reasons, distance } = verifyFix(player, m, body, t);
  if (trust < 0.4) {
    logEvent("location.flagged", "verifier", { missionId: m.id, reasons }, player.id);
    return { result: "rejected", trustScore: trust, reason: "Location could not be verified." };
  }
  if (distance > t.approach_radius_m) return { result: "too_far", distanceM: Math.round(distance) };
  const params = parse<any>(m.params, {});
  const link = m.desk_link_id ? get<DeskLinkRow>("SELECT * FROM desk_links WHERE id=?", m.desk_link_id) : undefined;

  // On-site code: pickup code (from the desk, or solo fallback) or the observation question.
  let prompt: string | null = null;
  let expected: string | null = null;
  if (m.template_id === "DEAD_DROP") {
    if (link?.state === "open") return { result: "needs_code", puzzle: { prompt: "The drop is locked. Your analyst is still cracking the code. Wait, or enter it if they send it." } };
    const solo = link?.state === "fallback";
    prompt = solo ? `No word from the desk. Solo decode: ${makeCipherPrompt(params.pickupCode, m.id)}` : "Enter the pickup code from your analyst.";
    expected = params.pickupCode;
  } else if (m.template_id === "RECON") {
    prompt = t.observation; expected = t.observation_answer;
  }
  if (prompt && expected) {
    if (!body.onSiteCode) return { result: "needs_code", distanceM: Math.round(distance), puzzle: { prompt } };
    if (norm(body.onSiteCode) !== norm(expected)) {
      logEvent("scan.wrong_code", "verifier", { missionId: m.id }, player.id);
      return { result: "needs_code", distanceM: Math.round(distance), puzzle: { prompt }, reason: "That is not it. Look again." };
    }
  }
  if (m.template_id === "EXTRACTION" && params.leg === 0) {
    run("UPDATE missions SET params=? WHERE id=?", json({ ...params, leg: 1 }), m.id);
    logEvent("mission.leg_complete", "authority", { missionId: m.id, leg: 1 }, player.id);
    return { result: "verified", distanceM: Math.round(distance), trustScore: trust, debrief: "Checkpoint confirmed. Move to the next one." };
  }
  return tx(() => complete(player, m, trust, Math.round(distance)));
}

function makeCipherPrompt(answer: string, seed: string) {
  const shift = 1 + Math.floor(rand(seed) * 24);
  return answer.replace(/[A-Z]/g, (c) => String.fromCharCode(((c.charCodeAt(0) - 65 + shift) % 26) + 65)) + " (shift cipher)";
}

function complete(player: Player, m: MissionRow, trust: number, distance: number): ScanResponse {
  const f = factionById(m.faction_id);
  let contestOutcome: "won" | "lost" | null = null;
  let xp = Math.round(m.reward_xp * param("rewardMultiplier"));
  if (m.contested_group_id) {
    const rivalDone = get<MissionRow>("SELECT * FROM missions WHERE contested_group_id=? AND id<>? AND state='completed'", m.contested_group_id, m.id);
    contestOutcome = rivalDone ? "lost" : "won";
    xp = contestOutcome === "won" ? Math.round(xp * 1.5) : Math.round(xp * 0.5);
  }
  const flagged = trust < 0.7;
  // First done wins the site. Anyone else still walking to it arrives late, unless the work is collaborative or an extraction.
  const lock = m.target_id ? lockOn(m.target_id) : undefined;
  const late = !!lock && lock.player_id !== player.id && !exemptFromLocks(m);
  if (late) {
    xp = Math.round(xp * 0.4);
    run("UPDATE missions SET state='completed', completed_at=?, outcome='late' WHERE id=?", now(), m.id);
    logEvent("mission.late", "authority", { missionId: m.id, title: m.title, template: m.template_id, heldBy: lock!.faction_id }, player.id);
    award(player.id, xp, -1, `${m.title} (late)`);
    const holder = factionById(lock!.faction_id);
    return { result: "verified", distanceM: distance, trustScore: trust, reward: { xp, trust: -1, contestOutcome: "lost" }, debrief: `${holder.id === player.factionId ? "One of ours" : holder.name} finished this site before you. It is closed for now. Partial credit for the walk; pick faster next time.` };
  }
  run("UPDATE missions SET state='completed', completed_at=?, outcome=? WHERE id=?", now(), contestOutcome ?? "ok", m.id);
  const faceoff = m.target_id ? rivalry.onVerified(player.id, player.factionId, m.target_id) : null;
  if (faceoff) xp += faceoff.bonusXp;
  if (m.target_id && !exemptFromLocks(m)) {
    const until = new Date(Date.now() + TARGET_LOCK_MS).toISOString();
    run("INSERT INTO target_locks(target_id,faction_id,player_id,mission_id,until,at) VALUES(?,?,?,?,?,?) ON CONFLICT(target_id) DO UPDATE SET faction_id=excluded.faction_id, player_id=excluded.player_id, mission_id=excluded.mission_id, until=excluded.until, at=excluded.at",
      m.target_id, m.faction_id, player.id, m.id, until, now());
    // Pending work at this site evaporates from every board; the holder's agency keeps the site.
    run("UPDATE missions SET state='expired', outcome='lost' WHERE id<>? AND target_id=? AND state IN ('pool','offered') AND template_id<>'EXTRACTION' AND json_extract(params,'$.crisisId') IS NULL", m.id, m.target_id);
    run("UPDATE offers SET state='expired' WHERE state='open' AND mission_id IN (SELECT id FROM missions WHERE target_id=? AND state='expired')", m.target_id);
    const control = sectorControl(m.area_id);
    logEvent("site.held", "authority", { targetId: m.target_id, target: get<{ name: string }>("SELECT name FROM targets WHERE id=?", m.target_id)?.name, faction: m.faction_id, until, control }, player.id);
  }
  if (m.desk_link_id) run("UPDATE desk_links SET state='closed' WHERE id=? AND state<>'fulfilled'", m.desk_link_id);
  logEvent("mission.verified", "authority", { missionId: m.id, title: m.title, template: m.template_id, trust, distance, contestOutcome, flagged }, player.id);
  award(player.id, xp, flagged ? 0 : 2, m.title);
  investigations.onMissionVerified(player.id, m);
  bounties.onMissionVerified(player.id, { template_id: m.template_id, mode: m.mode, outcome: contestOutcome ?? "ok", contested_group_id: m.contested_group_id, id: m.id });
  const seed = m.id + ":debrief";
  let debrief = contestOutcome === "lost"
    ? "A rival got there first. You brought back a decoy, and the knowledge that they were here."
    : pick(PERSONAS[f.chief].lines.debrief_ok, seed) + (contestOutcome === "won" ? " And you beat a rival to it." : "");
  // Chaos: first verified at a crisis site claims it for the mission's agency (and its pact).
  const pr = parse<any>(m.params, {});
  if (pr?.crisisId) {
    const r = crises.onSiteVerified(pr.crisisId, pr.siteId, m.faction_id, player.id);
    if (r.late) { xp = Math.round(xp * 0.4); debrief = "Too late. Somebody was here before you; the site is gone. Still, you were seen to try."; }
    else debrief = `Site secured. ${pr.stance === "intercept" ? "It is ours." : pr.stance === "sabotage" ? "Nobody gets it now." : "The sector stays quiet."} ${get<{ n: number }>("SELECT COUNT(*) n FROM json_each((SELECT sites FROM crises WHERE id=?)) WHERE json_extract(value,'$.claimedBy') IS NOT NULL", pr.crisisId)?.n ?? 1} of 3 sites claimed.`;
    if (m.faction_id !== player.factionId) debrief += ` Joint operation credit to ${f.name}.`;
  }
  // Operations: a verified link opens the next one, or closes the chain with a bonus.
  const link = chains.chainOf(m.params);
  if (link) {
    const r = chains.onLinkVerified(player.id, link.chainId, link.step, spawnLink);
    if (r) {
      if (r.done) { award(player.id, r.bonusXp, 1, `${r.name} complete`); xp += r.bonusXp; }
      debrief = r.say;
      chiefSay(player.id, r.say, r.done ? `operation ${r.name} complete` : `operation ${r.name}: next link`, true);
    }
  }
  if (faceoff) debrief = `First in. ${faceoff.rival} of ${factionById(faceoff.rivalFaction).name} watched you take it. ${debrief}`;
  return { result: "verified", distanceM: distance, trustScore: trust, reward: { xp, trust: flagged ? 0 : 2, contestOutcome: faceoff ? "won" : contestOutcome }, debrief, faceoff };
}

// ---------- desk ----------
export function deskActive(player: Player): DeskMissionDetail | null {
  const m = get<MissionRow>("SELECT * FROM missions WHERE assignee_id=? AND mode='desk' AND state='active'", player.id);
  if (!m) return null;
  const params = parse<any>(m.params, {});
  const link = m.desk_link_id ? get<DeskLinkRow>("SELECT * FROM desk_links WHERE id=?", m.desk_link_id) : undefined;
  const fieldAgent = link ? get<{ codename: string }>("SELECT codename FROM players WHERE id=(SELECT assignee_id FROM missions WHERE id=?)", link.field_mission_id) : undefined;
  return {
    mission: summary(m, player),
    puzzle: { kind: params.puzzle.kind, prompt: params.puzzle.prompt, options: params.puzzle.options, system: params.puzzle.system },
    linkedFieldAgent: fieldAgent?.codename,
  };
}

export function deskSubmit(player: Player, missionId: string, answer: string): DeskSubmitResponse {
  const m = get<MissionRow>("SELECT * FROM missions WHERE id=? AND assignee_id=? AND mode='desk' AND state='active'", missionId, player.id);
  if (!m) throw new ApiError(404, "no such active desk mission");
  const params = parse<any>(m.params, {});
  if (norm(answer) !== norm(params.puzzle.answer)) {
    logEvent("desk.wrong", "verifier", { missionId: m.id }, player.id);
    return { correct: false, debrief: "Not quite. Check your working." };
  }
  return tx(() => {
    const f = factionById(m.faction_id);
    run("UPDATE missions SET state='completed', completed_at=?, outcome='ok' WHERE id=?", now(), m.id);
    let unlockedFor: string | undefined;
    if (m.desk_link_id) {
      const link = get<DeskLinkRow>("SELECT * FROM desk_links WHERE id=?", m.desk_link_id)!;
      if (link.state === "open" || link.state === "fallback") {
        run("UPDATE desk_links SET state='fulfilled', fulfilled_at=? WHERE id=?", now(), link.id);
        const fm = get<MissionRow>("SELECT * FROM missions WHERE id=?", link.field_mission_id);
        if (fm?.assignee_id) {
          unlockedFor = get<{ codename: string }>("SELECT codename FROM players WHERE id=?", fm.assignee_id)?.codename;
          logEvent("desk_link.fulfilled", "authority", { link: link.id, by: player.codename }, fm.assignee_id);
        }
      }
    }
    logEvent("mission.verified", "authority", { missionId: m.id, title: m.title, template: m.template_id, unlockedFor }, player.id);
    award(player.id, m.reward_xp, 1, m.title);
    investigations.onMissionVerified(player.id, m);
    bounties.onMissionVerified(player.id, { template_id: m.template_id, mode: m.mode, outcome: "ok" });
    return { correct: true, reward: { xp: m.reward_xp, trust: 1 }, debrief: pick(PERSONAS[f.chief].lines.debrief_ok, m.id), unlockedFor };
  });
}

// ---------- briefing / history ----------
export function history(playerId: string, limit = 30): { at: string; text: string }[] {
  return all<{ type: string; payload: string; at: string }>(
    "SELECT type, payload, at FROM events WHERE player_id=? ORDER BY id DESC LIMIT ?", playerId, limit,
  ).map((e) => ({ at: e.at, text: describe(e.type, parse<any>(e.payload, {})) }));
}
function describe(type: string, p: any): string {
  switch (type) {
    case "mission.offered": return `Offered: ${p.template}`;
    case "mission.accepted": return `Accepted ${p.title}${p.contested ? " (contested)" : ""}`;
    case "mission.verified": return `Completed ${p.title}${p.contestOutcome ? ` — contest ${p.contestOutcome}` : ""}${p.unlockedFor ? ` — unlocked ${p.unlockedFor}` : ""}`;
    case "mission.expired": return `Expired: ${p.title}`;
    case "mission.abandoned": return `Abandoned ${p.title}`;
    case "mission.leg_complete": return `Checkpoint ${p.leg} confirmed`;
    case "reward": return `+${p.xp} XP, ${p.trust >= 0 ? "+" : ""}${p.trust} trust${p.credits ? `, +${p.credits} credits` : ""} (${p.why})`;
    case "rank_up": return `Promoted to ${p.to}`;
    case "presence.check_in": return p.mode === "desk" ? "Deployed to the intel desk" : "Deployed to the field";
    case "presence.check_out": return "Stood down";
    case "desk_link.fulfilled": return `Analyst ${p.by} cracked your code`;
    case "location.flagged": return "A scan could not be verified";
    case "recruited": return `Joined ${p.faction}`;
    case "evidence.found": return `Evidence on ${p.subject}: ${p.file}`;
    case "evidence.decoy_detected": return `Decoy exposed: ${p.file}`;
    case "case.opened": return "New investigation opened";
    case "case.clue": return `Clue from your chief: ${p.file}`;
    case "case.wire": return `Paid wire (${p.credits} credits)`;
    case "case.confirmed": return `Accusation confirmed: ${p.subject} is ${p.faction.toUpperCase()}`;
    case "case.rejected": return `Accusation rejected (${p.subject})`;
    case "case.exposed": return `Your cover was burned by ${p.by}`;
    case "bounty.claimed": return `Contract claimed: ${p.title}`;
    case "bounty.completed": return `Contract complete: ${p.title} (+${p.credits} credits)`;
    case "world_event.fragment": return `Fragment ${p.fragments} recovered for ${p.faction.toUpperCase()}`;
    case "assessment.scored": return "Assessment scored";
    case "player.registered": return "Clearance granted";
    default: return type;
  }
}

export function briefing(player: Player): Briefing {
  const f = playerFaction(player);
  if (!f) throw new ApiError(400, "join a faction first");
  const pres = getPresence(player.id);
  const plan = pres?.areaId ? latestPlan(f.id, pres.areaId)?.plan : latestPlan(f.id, get<AreaRow>("SELECT * FROM areas LIMIT 1")!.id)?.plan;
  const next = RANKS.find((r) => r.at > player.xp);
  return {
    chief: f.chief, chiefName: f.chiefName, factionName: f.name,
    headline: plan?.headline ?? pick(PERSONAS[f.chief].lines.idle, player.id),
    standing: { rank: player.rank, xp: player.xp, trust: player.trust, nextRankAt: next?.at ?? player.xp },
    recent: history(player.id, 6).map((h) => h.text),
    today: (() => {
      const areaId = pres?.areaId ?? get<{ area_id: string }>("SELECT area_id FROM missions WHERE assignee_id=? ORDER BY created_at DESC LIMIT 1", player.id)?.area_id ?? get<AreaRow>("SELECT * FROM areas LIMIT 1")!.id;
      const area = get<AreaRow>("SELECT * FROM areas WHERE id=?", areaId);
      const crisis = crises.view(f.id, areaId);
      const op = chains.activeChain(player.id);
      const ctl = sectorControl(areaId);
      const hot = worldGet("hot_window", "");
      return {
        sector: area?.name ?? null,
        control: ctl,
        crisis: crisis && crisis.state === "active" ? { name: crisis.name, endsAt: crisis.endsAt, stance: crisis.yourStance, allies: crisis.allies } : null,
        operation: op ? chains.chainSummary(op.id) : null,
        hotWindow: hot || null,
        firstTimer: !get("SELECT 1 FROM missions WHERE assignee_id=? AND state='completed'", player.id),
        nemesis: (() => { const n = rivalry.nemesisOf(player.id); return n ? { codename: n.codename, factionId: n.factionId, faction: n.faction, wins: n.wins, losses: n.losses } : null; })(),
        titles: rivalry.titlesOf(player.id).map((t) => t.title),
        operativeOfTheWeek: rivalry.currentOtw(f.id),
      };
    })(),
  };
}

/** Other on-duty field agents in the same area, snapped to a 100 m grid. Rivals are "unknown". */
export function contactsFor(player: Player): Contact[] {
  const me = get<PresenceRow>("SELECT * FROM presence WHERE player_id=? AND expires_at>?", player.id, now());
  if (!me?.area_id || me.last_lat == null) return [];
  const day = now().slice(0, 10);
  const rows = all<PresenceRow & { faction_id: FactionId }>(
    "SELECT p.*, pl.faction_id FROM presence p JOIN players pl ON pl.id=p.player_id WHERE p.area_id=? AND p.mode='field' AND p.expires_at>? AND p.player_id<>? AND p.last_lat IS NOT NULL",
    me.area_id, now(), player.id);
  const cell = 0.0009; // about 100 m
  return rows.map((r) => {
    const lat = Math.round(r.last_lat! / cell) * cell;
    const lng = Math.round(r.last_lng! / cell) * cell;
    return {
      id: createHash("sha256").update(r.player_id + day).digest("hex").slice(0, 8),
      lat, lng,
      distanceM: Math.round(distanceM(me.last_lat!, me.last_lng!, lat, lng) / 10) * 10,
      faction: r.faction_id === player.factionId ? r.faction_id : "unknown",
    };
  });
}

/** A chief speaks to one operative, unprompted. The Director's main engagement channel. */
export function chiefSay(playerId: string, text: string, why: string, force = false) {
  const p = get<{ faction_id: FactionId | null }>("SELECT faction_id FROM players WHERE id=?", playerId);
  if (!p?.faction_id) return;
  // Never pile up: at most one unprompted line every 3 minutes per operative. A direct response to the
  // operative's own action (a debrief) is not unprompted and goes through.
  const last = get<{ at: string }>("SELECT at FROM chat WHERE player_id=? AND role='chief' ORDER BY at DESC LIMIT 1", playerId);
  if (!force && last && Date.parse(last.at) > Date.now() - 3 * 60_000) return;
  run("INSERT INTO chat(id,player_id,role,text,at) VALUES(?,?,?,?,?)", uid(), playerId, "chief", text, now());
  logEvent("chief.message", `chief:${factionById(p.faction_id).chief}`, { why }, playerId);
}
export function unreadChief(playerId: string): number {
  const p = get<{ chief_read_at: string | null }>("SELECT chief_read_at FROM players WHERE id=?", playerId);
  return get<{ n: number }>("SELECT COUNT(*) n FROM chat WHERE player_id=? AND role='chief' AND at>?", playerId, p?.chief_read_at ?? "")!.n;
}
export function markChiefRead(playerId: string) { run("UPDATE players SET chief_read_at=? WHERE id=?", now(), playerId); }

/**
 * Owner action: a test sector around a point, with virtual checkpoints on a ring 150–450 m out.
 * These targets are NOT vetted public places; they are for the team's own walking tests.
 */
export function createTestArea(name: string, lat: number, lng: number, radiusM = 1200) {
  const id = "test-" + name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  run("INSERT OR REPLACE INTO areas(id,name,city,lat,lng,radius_m,merge_group) VALUES(?,?,?,?,?,?,?)", id, name, "Test", lat, lng, radiusM, null);
  run("DELETE FROM targets WHERE area_id=?", id);
  const spots = ["North point", "East point", "South point", "West point", "Near corner", "Far corner", "Mid ring", "Outer ring"];
  spots.forEach((spot, i) => {
    const r = 150 + (i % 4) * 100;
    const a = (i * 45 * Math.PI) / 180;
    const p = offsetM(lat, lng, r * Math.cos(a), r * Math.sin(a));
    const code = String(1000 + Math.floor(rand(id + spot) * 9000));
    run(`INSERT INTO targets(id,area_id,name,kind,lat,lng,approach_radius_m,safe_start,safe_end,capacity,state,observation,observation_answer) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      `${id}-${i}`, id, `${name} ${spot}`, "test", p.lat, p.lng, 45, 0, 24, 4, "ACTIVE", `Test checkpoint. Enter the code ${code}.`, code);
  });
  logEvent("admin.test_area", "owner", { id, name, lat, lng, radiusM }, null);
  return { id, name, targets: spots.length };
}

export function worldStatus() {
  const areas = all<AreaRow>("SELECT * FROM areas").map<Area>((a) => ({ id: a.id, name: a.name, city: a.city, lat: a.lat, lng: a.lng, radiusM: a.radius_m }));
  const presenceByArea: Record<string, number> = {};
  for (const r of all<{ area_id: string; n: number }>("SELECT area_id, COUNT(*) n FROM presence WHERE expires_at>? GROUP BY area_id", now())) presenceByArea[r.area_id] = r.n;
  const control: Record<string, Record<FactionId, number>> = {};
  for (const a of areas) control[a.id] = sectorControl(a.id);
  return {
    paused: paused(), factions: FACTIONS, areas, presenceByArea, control,
    activeMissions: get<{ n: number }>("SELECT COUNT(*) n FROM missions WHERE state='active'")!.n,
  };
}

export const bearing = bearingDeg;
