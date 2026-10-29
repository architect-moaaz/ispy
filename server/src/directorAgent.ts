import type { FactionId } from "@ispy/shared";
import { all, get, run, now, uid, parse, logEvent, worldGet } from "./db.ts";
import { bus, type Signal } from "./bus.ts";
import { FACTIONS, PERSONAS, factionById } from "./content.ts";
import { pick } from "./puzzles.ts";
import { chiefSay, refreshPlans, refreshPool, startOperation } from "./engine.ts";
import * as chains from "./chains.ts";
import * as bounties from "./bounties.ts";
import * as director from "./director.ts";
import * as auditor from "./auditor.ts";
import { param, setParam, PARAM_SPEC } from "./params.ts";
import * as strategy from "./strategy.ts";
import * as brain from "./brain.ts";
import { llmFailed } from "./chiefs.ts";

/**
 * The World Director as a resident agent. It does not wait for a clock: every ledger
 * event wakes it, and between events it watches on a heartbeat that quickens when
 * operatives are deployed. It keeps a working model of each operative and chief and
 * intervenes through the chiefs. It proposes and nudges; the Arbiter still commits.
 */
interface OperativeModel {
  playerId: string; codename: string; factionId: FactionId; areaId: string | null; mode: string;
  deployedAt: number; lastActivity: number; lastNudge: number; offersSeen: number; declines: number; accepted: number; verified: number; failedScans: number;
}
interface ChiefModel { factionId: FactionId; lastReplan: number; idleAgents: number; emptyPoolSince: number | null }

const FAST_MS = 20_000, SLOW_MS = 5 * 60_000;
/** Events worth waking the brain for; the rest it sees on the next periodic review. */
const THINK_ON = new Set(["presence.check_in", "sector.opened", "sector.settled", "mission.expired", "mission.abandoned", "contest.formed", "case.confirmed", "case.rejected", "world_event.fragment", "world_event.resolved", "bounty.completed", "location.flagged", "presence.check_out"]);
const IDLE_NUDGE_MS = 4 * 60_000, STALE_PLAN_MS = 60 * 60_000;

class DirectorAgent {
  private operatives = new Map<string, OperativeModel>();
  private chiefs = new Map<FactionId, ChiefModel>();
  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  private lastAudit = 0;
  private lastHousekeeping = 0;
  private lastTuning = 0;
  private lastStrategy = 0;
  private lastAssessment: strategy.Assessment | null = null;
  // Brain: signals queue up and the model thinks once, shortly after, instead of once per event.
  private pending: Signal[] = [];
  private thinkTimer: NodeJS.Timeout | null = null;
  private thinking = false;
  private lastThought = 0;
  private lastThoughtText: string | null = null;
  private log: { at: string; what: string; detail?: unknown }[] = [];

  start() {
    for (const f of FACTIONS) this.chiefs.set(f.id, { factionId: f.id, lastReplan: 0, idleAgents: 0, emptyPoolSince: null });
    bus.onSignal((s) => {
      this.react(s).catch((e) => console.warn("[director] reaction failed:", (e as Error).message));
      if (brain.brainEnabled() && THINK_ON.has(s.type)) { this.pending.push(s); this.scheduleThink(`event ${s.type}`); }
    });
    this.note("awake");
    void this.heartbeat();
  }

  /** Decisions the Director has made recently, for the owner console. */
  recent(limit = 40) { return this.log.slice(-limit).reverse(); }
  private note(what: string, detail?: unknown) {
    this.log.push({ at: now(), what, detail });
    if (this.log.length > 400) this.log.shift();
  }

  // ---------- observation ----------
  private observe() {
    const t = Date.now();
    const seen = new Set<string>();
    for (const r of all<{ player_id: string; codename: string; faction_id: FactionId; area_id: string | null; mode: string; checked_in_at: string }>(
      "SELECT p.player_id, pl.codename, pl.faction_id, p.area_id, p.mode, p.checked_in_at FROM presence p JOIN players pl ON pl.id=p.player_id WHERE p.expires_at>?", now())) {
      seen.add(r.player_id);
      const m = this.operatives.get(r.player_id) ?? {
        playerId: r.player_id, codename: r.codename, factionId: r.faction_id, areaId: r.area_id, mode: r.mode,
        deployedAt: Date.parse(r.checked_in_at), lastActivity: Date.parse(r.checked_in_at), lastNudge: 0,
        offersSeen: 0, declines: 0, accepted: 0, verified: 0, failedScans: 0,
      };
      m.areaId = r.area_id; m.mode = r.mode;
      this.operatives.set(r.player_id, m);
    }
    for (const id of [...this.operatives.keys()]) if (!seen.has(id)) this.operatives.delete(id);
    for (const c of this.chiefs.values()) {
      const agents = [...this.operatives.values()].filter((o) => o.factionId === c.factionId);
      c.idleAgents = agents.filter((o) => o.mode === "field" && !get("SELECT 1 FROM missions WHERE assignee_id=? AND state='active'", o.playerId) && !get("SELECT 1 FROM offers WHERE player_id=? AND state='open'", o.playerId)).length;
      const pool = get<{ n: number }>("SELECT COUNT(*) n FROM missions WHERE faction_id=? AND state='pool'", c.factionId)!.n;
      c.emptyPoolSince = pool === 0 ? (c.emptyPoolSince ?? t) : null;
    }
  }

  // ---------- immediate reactions ----------
  private async react(s: Signal) {
    if (worldGet("paused", "0") === "1") return;
    const o = s.playerId ? this.operatives.get(s.playerId) : undefined;
    switch (s.type) {
      case "presence.check_in": {
        this.observe();
        const m = this.operatives.get(s.playerId!);
        if (!m) return;
        m.deployedAt = m.lastActivity = Date.now();
        // Make sure there is something to hand this operative within seconds.
        const pool = get<{ n: number }>("SELECT COUNT(*) n FROM missions WHERE faction_id=? AND mode=? AND state='pool'", m.factionId, m.mode)!.n;
        if (pool === 0) { refreshPool(); this.note("pool refilled on deployment", { for: m.codename }); }
        return;
      }
      case "sector.settled": {
        // The survey is in: tell the chiefs about the real ground and let the world know a sector exists.
        const { areaId, name, realTargets } = s.payload as { areaId: string; name: string; realTargets: number };
        if (realTargets > 0) { await refreshPlans(true, { areaId, reason: `real public places are now mapped in ${name}` }); refreshPool(); }
        if (!get("SELECT 1 FROM dispatches WHERE headline=?", `New sector: ${name}`)) {
          run("INSERT INTO dispatches(id,kind,headline,body,faction_id,source,at) VALUES(?,?,?,?,?,?,?)", uid(), "news", `New sector: ${name}`,
            realTargets > 0 ? `All three agencies have moved into ${name}. ${realTargets} sites are in play.` : `All three agencies have moved into ${name}. Checkpoints are being surveyed.`, null, "director", now());
        }
        this.note("sector settled", { name, realTargets });
        return;
      }
      case "mission.offered": if (o) { o.offersSeen++; o.lastActivity = Date.now(); } return;
      case "mission.accepted": if (o) { o.accepted++; o.lastActivity = Date.now(); } return;
      case "mission.verified": {
        if (o) { o.verified++; o.lastActivity = Date.now(); }
        // Rules path: once an operative has proven themselves, hand them a chain of linked missions.
        if (o && o.mode === "field" && !s.payload?.chainId && !chains.activeChain(o.playerId) && o.verified >= 1) {
          const chain = await startOperation(o.playerId);
          if (chain) this.note("operation started", { for: o.codename, name: chain.name, source: chain.source });
        }
        return;
      }
      case "mission.expired": case "mission.abandoned": {
        if (o) { o.declines++; o.lastActivity = Date.now(); }
        if (o && o.declines >= 2 && Date.now() - o.lastNudge > 10 * 60_000) {
          o.lastNudge = Date.now();
          await refreshPlans(true, { factionId: o.factionId, areaId: o.areaId ?? undefined, reason: `operative ${o.codename} declined or dropped two missions; vary the mix and keep walks short` });
          refreshPool();
          this.note("replan after declines", { for: o.codename });
        }
        return;
      }
      case "location.flagged": {
        if (o) o.failedScans++;
        return;
      }
      case "contest.formed": {
        // A shock for both chiefs: replan with the news.
        for (const mid of s.payload?.missions ?? []) {
          const m = get<{ faction_id: FactionId; area_id: string }>("SELECT faction_id, area_id FROM missions WHERE id=?", mid);
          if (m) await refreshPlans(true, { factionId: m.faction_id, areaId: m.area_id, reason: "a rival agency is moving on one of your targets" });
        }
        this.note("chiefs replanned after a contest formed");
        return;
      }
      case "case.confirmed": {
        // The exposed operative's chief warns them; the world hears about it.
        await director.publishDispatches(true);
        return;
      }
      case "world_event.fragment": {
        return;
      }
      case "world_event.resolved": {
        await director.publishDispatches(true);
        this.note("campaign resolved; dispatch published", s.payload);
        return;
      }
      case "bounty.completed": {
        return;
      }
    }
  }

  // ---------- watching between events ----------
  private async heartbeat() {
    if (this.busy) return;
    this.busy = true;
    try {
      if (worldGet("paused", "0") !== "1") {
        this.observe();
        const t = Date.now();
        // Operatives deployed with nothing to do: make sure their chief has something to hand out.
        for (const o of this.operatives.values()) {
          if (o.mode === "field" && t - o.lastActivity > IDLE_NUDGE_MS && t - o.lastNudge > IDLE_NUDGE_MS) {
            const hasWork = get("SELECT 1 FROM missions WHERE assignee_id=? AND state='active'", o.playerId) || get("SELECT 1 FROM offers WHERE player_id=? AND state='open'", o.playerId);
            if (!hasWork) { refreshPool(); o.lastNudge = t; this.note("refilled pool for idle operative", { who: o.codename }); }
          }
        }
        // Chiefs: stale plans while agents wait, or empty pools.
        for (const c of this.chiefs.values()) {
          const plan = get<{ created_at: string }>("SELECT created_at FROM area_plans WHERE faction_id=? ORDER BY created_at DESC LIMIT 1", c.factionId);
          const age = plan ? t - Date.parse(plan.created_at) : Infinity;
          if ((c.idleAgents > 0 && age > STALE_PLAN_MS) || (c.emptyPoolSince && t - c.emptyPoolSince > 30_000)) {
            await refreshPlans(true, { factionId: c.factionId, reason: c.idleAgents ? `${c.idleAgents} of your operatives are deployed with nothing to do` : "your mission pool is empty" });
            refreshPool();
            c.lastReplan = t;
            this.note("chief replanned", { chief: factionById(c.factionId).chief, idle: c.idleAgents });
          }
        }
        // Routine upkeep the world needs regardless of who is online.
        if (t - this.lastHousekeeping > 60_000) {
          await refreshPlans(false);
          refreshPool();
          bounties.refreshBounties();
          await bounties.refreshEvent();
          await director.publishDispatches(false);
          this.lastHousekeeping = t;
        }
        if (brain.brainEnabled()) {
          const cadence = this.operatives.size > 0 ? 2 * 60_000 : 15 * 60_000;
          if (t - this.lastThought > cadence && !this.thinkTimer) this.scheduleThink("periodic review");
        } else {
        if (t - this.lastTuning > 10 * 60_000) { this.tune(); this.lastTuning = t; }
        if (t - this.lastStrategy > 10 * 60_000) {
          const { assessment, moves } = await strategy.play(now().slice(0, 15));
          this.lastAssessment = assessment;
          for (const m of moves) this.note(`strategic move: ${m.kind}`, m.detail);
          this.lastStrategy = t;
        }
        }
        if (t - this.lastAudit > 3600_000) { const a = auditor.runAudit(1); this.lastAudit = t; if (a.flags.some((f) => f.severity === "critical")) this.note("audit raised critical flags", a.flags); }
      }
    } catch (e) {
      console.warn("[director] heartbeat failed:", (e as Error).message);
    } finally {
      this.busy = false;
      const anyone = this.operatives.size > 0;
      this.timer = setTimeout(() => void this.heartbeat(), anyone ? FAST_MS : SLOW_MS);
    }
  }

  /**
   * Shape the game from what the last hour shows. Small, bounded, reversible moves; each one logged.
   * The signals: declines vs accepts (walks too long?), idle deployed operatives (not enough work?),
   * contests formed vs field agents (too few or too many encounters?), rejected accusations (decoys too thick?).
   */
  private tune() {
    const since = new Date(Date.now() - 3600_000).toISOString();
    const n = (sql: string, ...a: any[]) => get<{ n: number }>(sql, ...a)!.n;
    const offered = n("SELECT COUNT(*) n FROM events WHERE type='mission.offered' AND at>?", since);
    const accepted = n("SELECT COUNT(*) n FROM events WHERE type='mission.accepted' AND at>?", since);
    const dropped = n("SELECT COUNT(*) n FROM events WHERE type IN ('mission.expired','mission.abandoned') AND at>?", since);
    const verified = n("SELECT COUNT(*) n FROM missions WHERE mode='field' AND state='completed' AND completed_at>?", since);
    const contests = n("SELECT COUNT(*) n FROM events WHERE type='contest.formed' AND at>?", since);
    const fieldAgents = [...this.operatives.values()].filter((o) => o.mode === "field").length;
    const idle = [...this.chiefs.values()].reduce((s, c) => s + c.idleAgents, 0);
    const rejected = n("SELECT COUNT(*) n FROM events WHERE type='case.rejected' AND at>?", since);
    const confirmed = n("SELECT COUNT(*) n FROM events WHERE type='case.confirmed' AND at>?", since);
    const step = (key: keyof typeof PARAM_SPEC, delta: number, reason: string) => {
      const v = setParam(key, param(key) + delta, "director", reason);
      if (v != null) this.note("tuned world", { key, to: v, reason });
    };
    // Walks: many offers, few accepts, drops piling up → shorter walks and a sweeter reward; the reverse eases back.
    if (offered >= 6 && accepted / offered < 0.4) { step("walkScale", -0.1, `only ${accepted}/${offered} offers accepted`); step("rewardMultiplier", +0.1, "low acceptance"); }
    else if (offered >= 6 && accepted / offered > 0.8 && param("walkScale") < 1) step("walkScale", +0.1, "offers are being accepted again");
    if (dropped >= 4 && dropped > verified) step("deskLinkFallbackMin", -3, `${dropped} missions dropped against ${verified} verified`);
    // Work supply: idle deployed operatives → deeper pools; nobody idle for a long stretch → ease back.
    if (idle >= 2) step("poolPerMode", +1, `${idle} deployed operatives idle`);
    else if (idle === 0 && fieldAgents > 0 && param("poolPerMode") > PARAM_SPEC.poolPerMode.def) step("poolPerMode", -1, "nobody idle");
    // Encounters: plenty of field agents but no contests → raise appetite; contests every few minutes → lower it.
    if (fieldAgents >= 4 && contests === 0) step("contestAppetiteBoost", +0.1, `${fieldAgents} field agents and no contests in an hour`);
    else if (contests >= 8) step("contestAppetiteBoost", -0.1, `${contests} contests in an hour`);
    // Investigations: rejections outnumbering confirmations → thin the decoys; nobody failing → thicken them.
    if (rejected >= 3 && rejected > confirmed * 2) step("decoyRate", -0.05, `${rejected} rejected accusations vs ${confirmed} confirmed`);
    else if (confirmed >= 3 && rejected === 0) step("decoyRate", +0.05, `${confirmed} confirmed accusations with no failures`);
    // Drift home: anything that no signal touched creeps back toward default.
    for (const key of Object.keys(PARAM_SPEC) as (keyof typeof PARAM_SPEC)[]) {
      const def = PARAM_SPEC[key].def, cur = param(key);
      const recently = get("SELECT 1 FROM events WHERE type='world_param.changed' AND at>? AND json_extract(payload,'$.key')=?", since, key);
      if (!recently && Math.abs(cur - def) > 1e-6) setParam(key, cur + (def - cur) * 0.5, "director", "drifting back toward default");
    }
  }

  private scheduleThink(trigger: string) {
    if (this.thinkTimer) return;
    this.thinkTimer = setTimeout(() => { this.thinkTimer = null; void this.think(trigger); }, 4000);
  }

  /** Hand the whole situation to the model and apply what it decides. */
  private async think(trigger: string) {
    if (this.thinking || worldGet("paused", "0") === "1") return;
    this.thinking = true;
    const signals = this.pending.splice(0);
    try {
      this.observe();
      const t = Date.now();
      const ops: brain.OperativeView[] = [...this.operatives.values()].map((o) => {
        const area = o.areaId ? get<{ name: string }>("SELECT name FROM areas WHERE id=?", o.areaId)?.name ?? null : null;
        const lastLine = get<{ at: string }>("SELECT at FROM chat WHERE player_id=? AND role='chief' ORDER BY at DESC LIMIT 1", o.playerId);
        return {
          codename: o.codename, faction: factionById(o.factionId).name, mode: o.mode, areaName: area,
          minutesDeployed: Math.round((t - o.deployedAt) / 60_000), minutesIdle: Math.round((t - o.lastActivity) / 60_000),
          offersSeen: o.offersSeen, declines: o.declines, verified: o.verified, failedScans: o.failedScans,
          hasWork: !!(get("SELECT 1 FROM missions WHERE assignee_id=? AND state='active'", o.playerId) || get("SELECT 1 FROM offers WHERE player_id=? AND state='open'", o.playerId)),
          lastChiefLineMinutesAgo: lastLine ? Math.round((t - Date.parse(lastLine.at)) / 60_000) : null,
        };
      });
      const chiefs: brain.ChiefView[] = [...this.chiefs.values()].map((c) => {
        const plan = get<{ created_at: string; plan: string }>("SELECT created_at, plan FROM area_plans WHERE faction_id=? ORDER BY created_at DESC LIMIT 1", c.factionId);
        return {
          chief: factionById(c.factionId).chiefName, faction: factionById(c.factionId).name,
          planAgeMin: plan ? Math.round((t - Date.parse(plan.created_at)) / 60_000) : 999, idleAgents: c.idleAgents,
          poolField: get<{ n: number }>("SELECT COUNT(*) n FROM missions WHERE faction_id=? AND mode='field' AND state='pool'", c.factionId)!.n,
          poolDesk: get<{ n: number }>("SELECT COUNT(*) n FROM missions WHERE faction_id=? AND mode='desk' AND state='pool'", c.factionId)!.n,
          lastPlanHeadline: plan ? parse<{ headline?: string }>(plan.plan, {}).headline ?? null : null,
        };
      });
      const out = await brain.think(ops, chiefs, signals, this.recent(10).reverse(), trigger);
      this.lastThought = Date.now();
      if (out) { this.lastThoughtText = out.assessment; this.note(`thought (${trigger})`, { assessment: out.assessment, applied: out.applied }); }
    } catch (e) {
      console.warn("[director] thinking failed, rules continue:", (e as Error).message); llmFailed(e);
      this.note("thinking failed; rules continue", (e as Error).message);
    } finally {
      this.thinking = false;
    }
  }

  status() {
    return {
      operativesWatched: this.operatives.size,
      chiefs: [...this.chiefs.values()].map((c) => ({ chief: factionById(c.factionId).chief, idleAgents: c.idleAgents, emptyPool: !!c.emptyPoolSince })),
      cadenceMs: this.operatives.size > 0 ? FAST_MS : SLOW_MS,
      brain: brain.brainEnabled() ? { mode: "model", lastThought: this.lastThoughtText } : { mode: "rules" },
      balance: this.lastAssessment ? { leader: this.lastAssessment.leader.name, gap: this.lastAssessment.gap, factions: this.lastAssessment.factions.map((f) => ({ name: f.name, power: f.power, fragments: f.fragments, verifiedHour: f.verifiedHour, dominant: f.dominantTemplate })), campaignTight: this.lastAssessment.campaignTight, campaignRunaway: this.lastAssessment.campaignRunaway } : null,
      recent: this.recent(20),
    };
  }
}

export const directorAgent = new DirectorAgent();
export const _parse = parse;
export const _logEvent = logEvent;
