import { createHash } from "node:crypto";
import type {
  Area, Briefing, Contact, DeskMissionDetail, DeskSubmitResponse, Faction, FactionId, MissionSummary, Mode,
  NavigateResponse, OfferCard, Player, Presence, Rank, ScanRequest, ScanResponse, Skills, TemplateId,
} from "@ispy/shared";
import { all, get, run, tx, now, uid, json, parse, logEvent, worldGet } from "./db.ts";
import { areaForPoint, bearingDeg, distanceM, type AreaRow } from "./geo.ts";
import { FACTIONS, PERSONAS, RANKS, factionById } from "./content.ts";
import { makeAnalysis, makeCipher, norm, pick, rand } from "./puzzles.ts";
import { planArea, type AreaPlan } from "./chiefs.ts";
import { award, rankFor } from "./rewards.ts";
import * as investigations from "./investigations.ts";
import * as bounties from "./bounties.ts";

export const DEV_SIM = process.env.DEV_SIM === "1";
const PRESENCE_TTL_MS = 15 * 60_000;
const OFFER_TTL_MS = 90_000;
const MISSION_TTL_MS = 90 * 60_000;
const PLAN_TTL_MS = 60 * 60_000;
const POOL_PER_MODE = 3;
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
  accepted_at: string | null; completed_at: string | null; outcome: string | null;
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
    walkRadiusM: r.walkM, dailyFieldCap: r.cap, fieldToday, credits: p.credits ?? 0,
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
  if (body.mode === "field") {
    if (body.lat == null || body.lng == null) throw new ApiError(400, "field deployment needs a location fix");
    if (body.sim && !DEV_SIM) throw new ApiError(400, "simulated location is not allowed");
    if (body.mock && !body.sim) throw new ApiError(400, "mock location provider detected");
    const area = areaForPoint(body.lat, body.lng);
    if (!area) throw new ApiError(400, "you are not inside a play area");
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
  logEvent("presence.check_in", "player", { mode: body.mode, areaId }, player.id);
  return getPresence(player.id)!;
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
      const { plan, source } = await planArea(f.chief, f, { areaName: area.name, fieldAgents, deskAgents, rivalAgentsBucket, recentOutcomes, reason: only?.reason });
      run("INSERT INTO area_plans(id,faction_id,area_id,plan,source,created_at) VALUES(?,?,?,?,?,?)", uid(), f.id, area.id, json(plan), source, now());
      logEvent("area_plan.published", `chief:${f.chief}`, { areaId: area.id, source, headline: plan.headline, contestAppetite: plan.contestAppetite }, null);
    }
  }
}

// ---------- mission pool ----------
function openTargets(areaId: string): TargetRow[] {
  const hour = new Date().getHours();
  // Dev simulation ignores safe hours so the loop can be tested at night.
  if (DEV_SIM) return all<TargetRow>("SELECT * FROM targets WHERE area_id=? AND state='ACTIVE'", areaId);
  return all<TargetRow>("SELECT * FROM targets WHERE area_id=? AND state='ACTIVE' AND safe_start<=? AND safe_end>?", areaId, hour, hour);
}
/** Why the board is empty, for the app to show. */
export function boardNotice(player: Player, pres: Presence | null): string | null {
  if (paused()) return "The world is paused by the owner.";
  if (!pres) return null;
  if (!pres.areaId) return "You are outside a play area.";
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

function createMission(f: Faction, areaId: string, template: TemplateId, mode: Mode, target: TargetRow | null, params: Record<string, unknown>, seed: string) {
  const id = uid();
  const brief = flavour(f, template, target?.name ?? "the area", seed);
  run(`INSERT INTO missions(id,faction_id,area_id,template_id,mode,target_id,state,title,brief,params,reward_xp,expires_at,created_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    id, f.id, areaId, template, mode, target?.id ?? null, "pool", TITLES[template], brief, json(params), XP[template],
    new Date(Date.now() + MISSION_TTL_MS).toISOString(), now());
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
  const p = Math.min(appetite, rivalPlan?.contestAppetite ?? 0.3);
  if (rand(missionId + rival.id) > p) return;
  const perHour = get<{ n: number }>("SELECT COUNT(DISTINCT contested_group_id) n FROM missions WHERE contested_group_id IS NOT NULL AND created_at>?",
    new Date(Date.now() - 3_600_000).toISOString())!.n;
  if (perHour >= 3) return;
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
        for (let i = have; i < POOL_PER_MODE; i++) {
          const seed = `${f.id}:${area.id}:${mode}:${now()}:${i}`;
          const template = weightedTemplate(plan.mix, mode, seed);
          tx(() => buildMission(f, area, template, mode, targets, plan, seed));
        }
      }
    }
  }
}

function buildMission(f: Faction, area: AreaRow, template: TemplateId, mode: Mode, targets: TargetRow[], plan: AreaPlan, seed: string) {
  const target = pick(targets, seed + ":t");
  if (mode === "field") {
    if (template === "EXTRACTION") {
      const second = pick(targets.filter((t) => t.id !== target.id), seed + ":t2") ?? target;
      const id = createMission(f, area.id, template, mode, target, { route: [target.id, second.id], leg: 0 }, seed);
      maybeContest(id, f.id, target.id, plan.contestAppetite);
      return;
    }
    const id = createMission(f, area.id, template, mode, target, { needsObservation: template === "RECON" }, seed);
    maybeContest(id, f.id, target.id, plan.contestAppetite);
    if (template === "DEAD_DROP") {
      // Pair with a desk cipher whose answer is the pickup code.
      const cipher = makeCipher(seed + ":c");
      const deskId = createMission(f, area.id, "CIPHER", "desk", null, { puzzle: cipher, forField: id }, seed + ":d");
      const linkId = uid();
      run("INSERT INTO desk_links(id,desk_mission_id,field_mission_id,state,fallback_after_s) VALUES(?,?,?,?,?)", linkId, deskId, id, "open", 15 * 60);
      run("UPDATE missions SET desk_link_id=?, params=? WHERE id=?", linkId, json({ pickupCode: cipher.answer }), id);
      run("UPDATE missions SET desk_link_id=? WHERE id=?", linkId, deskId);
    }
    return;
  }
  // desk
  if (template === "ANALYSIS") {
    const decoys = targets.filter((t) => t.id !== target.id).slice(0, 2).map((t) => t.name);
    const puzzle = makeAnalysis(seed, target.name, decoys);
    createMission(f, area.id, template, mode, null, { puzzle }, seed);
  } else {
    createMission(f, area.id, "CIPHER", mode, null, { puzzle: makeCipher(seed + ":c") }, seed);
  }
}

function sweepExpiry() {
  const t = now();
  run("UPDATE offers SET state='expired' WHERE state='open' AND expires_at<=?", t);
  for (const m of all<MissionRow>("SELECT * FROM missions WHERE state IN ('pool','offered','accepted','active') AND expires_at<=?", t)) {
    run("UPDATE missions SET state='expired', outcome='expired' WHERE id=?", m.id);
    if (m.assignee_id) logEvent("mission.expired", "authority", { missionId: m.id, title: m.title }, m.assignee_id);
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
    const poolQuery = () => all<MissionRow>("SELECT * FROM missions WHERE faction_id=? AND area_id=? AND mode=? AND state='pool'", player.factionId, pres.area_id, pres.mode)
      .filter((m) => !offeredIds.has(m.id));
    let pool = poolQuery();
    if (!pool.length) { refreshPool(); pool = poolQuery(); }
    const scored = pool.map((m) => {
      const s = summary(m, player, pres);
      if (pres.mode === "field") {
        if (s.walkM == null || s.walkM > player.walkRadiusM) return null;
        if (m.target_id && recentTargets.has(m.target_id)) return null;
      }
      const dist = pres.mode === "field" ? 1 - Math.min(1, (s.walkM ?? 0) / player.walkRadiusM) : 0.5;
      // A desk mission with a field agent already waiting on it outranks everything else.
      const waiting = pres.mode === "desk" && m.desk_link_id && get(
        "SELECT 1 FROM desk_links l JOIN missions f ON f.id=l.field_mission_id WHERE l.id=? AND l.state='open' AND f.state='active'", m.desk_link_id) ? 1 : 0;
      const score = waiting + 0.45 * skillFit(player.skills, m.template_id) + 0.35 * dist + 0.2 * rand(m.id + player.id);
      return { m, score };
    }).filter((x): x is { m: MissionRow; score: number } => !!x).sort((a, b) => b.score - a.score);
    for (const { m } of scored.slice(0, 2 - open.length)) {
      const id = uid();
      run("INSERT INTO offers(id,mission_id,player_id,state,expires_at,created_at) VALUES(?,?,?,?,?,?)",
        id, m.id, player.id, "open", new Date(Date.now() + OFFER_TTL_MS).toISOString(), now());
      run("UPDATE missions SET state='offered' WHERE id=?", m.id);
      logEvent("mission.offered", "matcher", { missionId: m.id, template: m.template_id }, player.id);
    }
  }
  return all<OfferRow>("SELECT * FROM offers WHERE player_id=? AND state='open'", player.id).map((o) => ({
    offerId: o.id, acceptBy: o.expires_at, mission: summary(get<MissionRow>("SELECT * FROM missions WHERE id=?", o.mission_id)!, player, pres),
  }));
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
    targetName: t.name, lat: t.lat, lng: t.lng, approachRadiusM: t.approach_radius_m,
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
  let xp = m.reward_xp;
  if (m.contested_group_id) {
    const rivalDone = get<MissionRow>("SELECT * FROM missions WHERE contested_group_id=? AND id<>? AND state='completed'", m.contested_group_id, m.id);
    contestOutcome = rivalDone ? "lost" : "won";
    xp = contestOutcome === "won" ? Math.round(xp * 1.5) : Math.round(xp * 0.5);
  }
  const flagged = trust < 0.7;
  run("UPDATE missions SET state='completed', completed_at=?, outcome=? WHERE id=?", now(), contestOutcome ?? "ok", m.id);
  if (m.desk_link_id) run("UPDATE desk_links SET state='closed' WHERE id=? AND state<>'fulfilled'", m.desk_link_id);
  logEvent("mission.verified", "authority", { missionId: m.id, title: m.title, template: m.template_id, trust, distance, contestOutcome, flagged }, player.id);
  award(player.id, xp, flagged ? 0 : 2, m.title);
  investigations.onMissionVerified(player.id, m);
  bounties.onMissionVerified(player.id, { template_id: m.template_id, mode: m.mode, outcome: contestOutcome ?? "ok" });
  const seed = m.id + ":debrief";
  const debrief = contestOutcome === "lost"
    ? "A rival got there first. You brought back a decoy, and the knowledge that they were here."
    : pick(PERSONAS[f.chief].lines.debrief_ok, seed) + (contestOutcome === "won" ? " And you beat a rival to it." : "");
  return { result: "verified", distanceM: distance, trustScore: trust, reward: { xp, trust: flagged ? 0 : 2, contestOutcome }, debrief };
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
    puzzle: { kind: params.puzzle.kind, prompt: params.puzzle.prompt, options: params.puzzle.options },
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
export function chiefSay(playerId: string, text: string, why: string) {
  const p = get<{ faction_id: FactionId | null }>("SELECT faction_id FROM players WHERE id=?", playerId);
  if (!p?.faction_id) return;
  // Never pile up: at most one unprompted line every 3 minutes per operative.
  const last = get<{ at: string }>("SELECT at FROM chat WHERE player_id=? AND role='chief' ORDER BY at DESC LIMIT 1", playerId);
  if (last && Date.parse(last.at) > Date.now() - 3 * 60_000) return;
  run("INSERT INTO chat(id,player_id,role,text,at) VALUES(?,?,?,?,?)", uid(), playerId, "chief", text, now());
  logEvent("chief.message", `chief:${factionById(p.faction_id).chief}`, { why }, playerId);
}
export function unreadChief(playerId: string): number {
  const p = get<{ chief_read_at: string | null }>("SELECT chief_read_at FROM players WHERE id=?", playerId);
  return get<{ n: number }>("SELECT COUNT(*) n FROM chat WHERE player_id=? AND role='chief' AND at>?", playerId, p?.chief_read_at ?? "")!.n;
}
export function markChiefRead(playerId: string) { run("UPDATE players SET chief_read_at=? WHERE id=?", now(), playerId); }

export function worldStatus() {
  const areas = all<AreaRow>("SELECT * FROM areas").map<Area>((a) => ({ id: a.id, name: a.name, city: a.city, lat: a.lat, lng: a.lng, radiusM: a.radius_m }));
  const presenceByArea: Record<string, number> = {};
  for (const r of all<{ area_id: string; n: number }>("SELECT area_id, COUNT(*) n FROM presence WHERE expires_at>? GROUP BY area_id", now())) presenceByArea[r.area_id] = r.n;
  return {
    paused: paused(), factions: FACTIONS, areas, presenceByArea,
    activeMissions: get<{ n: number }>("SELECT COUNT(*) n FROM missions WHERE state='active'")!.n,
  };
}

export const bearing = bearingDeg;
