import type { FactionId } from "@ispy/shared";
import { all, get, now, parse, logEvent, worldGet } from "./db.ts";
import { bus, type Signal } from "./bus.ts";
import { FACTIONS, PERSONAS, factionById } from "./content.ts";
import { pick } from "./puzzles.ts";
import { chiefSay, refreshPlans, refreshPool } from "./engine.ts";
import * as bounties from "./bounties.ts";
import * as director from "./director.ts";
import * as auditor from "./auditor.ts";
import { param, setParam, PARAM_SPEC } from "./params.ts";
import * as strategy from "./strategy.ts";

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
  private log: { at: string; what: string; detail?: unknown }[] = [];

  start() {
    for (const f of FACTIONS) this.chiefs.set(f.id, { factionId: f.id, lastReplan: 0, idleAgents: 0, emptyPoolSince: null });
    bus.onSignal((s) => this.react(s).catch((e) => console.warn("[director] reaction failed:", (e as Error).message)));
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
        if (m.verified === 0 && m.offersSeen === 0) {
          const f = factionById(m.factionId);
          chiefSay(m.playerId, pick(PERSONAS[f.chief].lines.welcome, m.playerId) + (m.mode === "field" ? " Orders are on the board. Walk." : " The intercepts are yours."), "deployment");
        }
        return;
      }
      case "mission.offered": if (o) { o.offersSeen++; o.lastActivity = Date.now(); } return;
      case "mission.accepted": if (o) { o.accepted++; o.lastActivity = Date.now(); } return;
      case "mission.verified": {
        if (o) { o.verified++; o.lastActivity = Date.now(); }
        if (s.payload?.contestOutcome === "won" && o) chiefSay(o.playerId, pick(["Beat them to it. They will remember that.", "First in. Somebody else is explaining themselves to their chief right now."], s.at), "contest won");
        if (s.payload?.contestOutcome === "lost" && o) chiefSay(o.playerId, "A rival got there first. I want to know who. Keep an eye on the dossier.", "contest lost");
        return;
      }
      case "mission.expired": case "mission.abandoned": {
        if (o) { o.declines++; o.lastActivity = Date.now(); }
        if (o && o.declines >= 2 && Date.now() - o.lastNudge > 10 * 60_000) {
          o.lastNudge = Date.now();
          chiefSay(o.playerId, pick(["Not your kind of work? Tell me what you want and I will find it.", "Two passes. Fine. Something closer is coming."], s.at), "repeated declines");
          await refreshPlans(true, { factionId: o.factionId, areaId: o.areaId ?? undefined, reason: `operative ${o.codename} declined or dropped two missions; vary the mix and keep walks short` });
          refreshPool();
          this.note("replan after declines", { for: o.codename });
        }
        return;
      }
      case "location.flagged": {
        if (o) { o.failedScans++; if (o.failedScans === 2) chiefSay(o.playerId, "Your position is not verifying. Stand still, let the signal settle, scan again.", "scan help"); }
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
        const exposedId = get<{ target_id: string }>("SELECT target_id FROM cases WHERE id=?", s.payload?.caseId)?.target_id;
        if (exposedId) chiefSay(exposedId, "Your cover is burned in this sector. Rotate, keep your head down, and let the desk do the next move.", "cover burned");
        await director.publishDispatches(true);
        return;
      }
      case "world_event.fragment": {
        if (o) chiefSay(o.playerId, `Fragment ${s.payload?.fragments} is ours. Keep moving.`, "fragment");
        return;
      }
      case "world_event.resolved": {
        await director.publishDispatches(true);
        this.note("campaign resolved; dispatch published", s.payload);
        return;
      }
      case "bounty.completed": {
        if (o) chiefSay(o.playerId, "Contract closed. Credits are in your account. Spend them on a wire if you are hunting someone.", "bounty");
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
        // Operatives deployed with nothing to do.
        for (const o of this.operatives.values()) {
          const idle = t - o.lastActivity;
          if (o.mode === "field" && idle > IDLE_NUDGE_MS && t - o.lastNudge > IDLE_NUDGE_MS) {
            const hasWork = get("SELECT 1 FROM missions WHERE assignee_id=? AND state='active'", o.playerId) || get("SELECT 1 FROM offers WHERE player_id=? AND state='open'", o.playerId);
            if (!hasWork) {
              refreshPool();
              const target = get<{ name: string }>("SELECT t.name FROM missions m JOIN targets t ON t.id=m.target_id WHERE m.faction_id=? AND m.state='pool' AND m.mode='field' ORDER BY m.created_at DESC LIMIT 1", o.factionId);
              chiefSay(o.playerId, target ? `You have gone quiet. There is work near ${target.name}. Open the board.` : "You have gone quiet. Stay deployed; something is coming.", "idle");
              o.lastNudge = t;
              this.note("nudged idle operative", { who: o.codename });
            }
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
        if (t - this.lastTuning > 10 * 60_000) { this.tune(); this.lastTuning = t; }
        if (t - this.lastStrategy > 10 * 60_000) {
          const { assessment, moves } = await strategy.play(now().slice(0, 15));
          this.lastAssessment = assessment;
          for (const m of moves) this.note(`strategic move: ${m.kind}`, m.detail);
          this.lastStrategy = t;
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

  status() {
    return {
      operativesWatched: this.operatives.size,
      chiefs: [...this.chiefs.values()].map((c) => ({ chief: factionById(c.factionId).chief, idleAgents: c.idleAgents, emptyPool: !!c.emptyPoolSince })),
      cadenceMs: this.operatives.size > 0 ? FAST_MS : SLOW_MS,
      balance: this.lastAssessment ? { leader: this.lastAssessment.leader.name, gap: this.lastAssessment.gap, factions: this.lastAssessment.factions.map((f) => ({ name: f.name, power: f.power, fragments: f.fragments, verifiedHour: f.verifiedHour, dominant: f.dominantTemplate })), campaignTight: this.lastAssessment.campaignTight, campaignRunaway: this.lastAssessment.campaignRunaway } : null,
      recent: this.recent(20),
    };
  }
}

export const directorAgent = new DirectorAgent();
export const _parse = parse;
export const _logEvent = logEvent;
