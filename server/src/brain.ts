import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod/v4";
import type { FactionId } from "@ispy/shared";
import { all, get, run, now, uid, json, logEvent } from "./db.ts";
import type { Signal } from "./bus.ts";
import { FACTIONS, factionById } from "./content.ts";
import { chiefSay, refreshPlans, refreshPool } from "./engine.ts";
import { llmClient } from "./chiefs.ts";
import { PARAM_SPEC, allParams, setParam, type ParamKey } from "./params.ts";
import { assess, type Assessment } from "./strategy.ts";
import * as director from "./director.ts";
import { currentEvent } from "./bounties.ts";

/**
 * The Director's brain: a model reads the situation and decides what to do, choosing only
 * from the actions below. Nothing here commits an outcome; every action is an incentive,
 * a message or a knob, bounded exactly as the rule-based fallback is. The reasoning is logged.
 */
const MODEL = "claude-opus-5-5";
const paramKeys = Object.keys(PARAM_SPEC) as [ParamKey, ...ParamKey[]];

const Action = z.discriminatedUnion("type", [
  z.object({ type: z.literal("message_operative"), codename: z.string(), text: z.string().max(220).describe("Said by that operative's own chief, in the chief's voice"), why: z.string().max(80) }),
  z.object({ type: z.literal("brief_chief"), factionId: z.enum(["raven", "phantom", "cipher"]), situation: z.string().max(240).describe("Situation update the chief receives as if from its own analysts; it will replan on it") }),
  z.object({ type: z.literal("publish_contract"), factionId: z.enum(["raven", "phantom", "cipher", "all"]), title: z.string().max(40), contractType: z.string().max(24), brief: z.string().max(200), xp: z.number().int().min(100).max(800), credits: z.number().int().min(0).max(250), criteria: z.object({ template: z.enum(["RECON", "DEAD_DROP", "EXTRACTION", "CIPHER", "ANALYSIS"]).optional(), mode: z.enum(["field", "desk"]).optional(), contestWon: z.boolean().optional(), against: z.enum(["raven", "phantom", "cipher"]).optional(), count: z.number().int().min(1).max(6) }), hours: z.number().int().min(1).max(48) }),
  z.object({ type: z.literal("set_param"), key: z.enum(paramKeys), value: z.number(), why: z.string().max(100) }),
  z.object({ type: z.literal("dispatch"), headline: z.string().max(60), body: z.string().max(240), factionId: z.enum(["raven", "phantom", "cipher", "all"]) }),
  z.object({ type: z.literal("refill_pool") }),
  z.object({ type: z.literal("wait"), why: z.string().max(100) }),
]);
const Decision = z.object({
  assessment: z.string().max(400).describe("Two or three sentences: what is going on and what matters most right now"),
  actions: z.array(Action).max(6),
});
export type DirectorAction = z.infer<typeof Action>;

export interface OperativeView { codename: string; faction: string; mode: string; areaName: string | null; minutesDeployed: number; minutesIdle: number; offersSeen: number; declines: number; verified: number; failedScans: number; hasWork: boolean; lastChiefLineMinutesAgo: number | null }
export interface ChiefView { chief: string; faction: string; planAgeMin: number; idleAgents: number; poolField: number; poolDesk: number; lastPlanHeadline: string | null }

export function brainEnabled() { return process.env.ISPY_DIRECTOR !== "rules" && llmClient() !== null; }

function buildContext(operatives: OperativeView[], chiefs: ChiefView[], signals: Signal[], recentDecisions: { at: string; what: string; detail?: unknown }[]) {
  const a: Assessment = assess();
  const ev = currentEvent();
  const dispatches = director.recentDispatches(3).map((d) => d.headline);
  return {
    now: now(),
    campaign: ev ? { name: ev.name, state: ev.state, endsAt: ev.endsAt, progress: ev.progress.map((p) => `${p.label} ${p.fragments}/${p.of}`) } : null,
    balance: { leader: a.leader.name, trailer: a.trailer.name, gap: a.gap, tight: a.campaignTight, runaway: a.campaignRunaway, factions: a.factions.map((f) => ({ name: f.name, power: f.power, verifiedHour: f.verifiedHour, contestsWon: f.contestsWon, contestsLost: f.contestsLost, dominant: f.dominantTemplate, busiestArea: f.busiestArea, deployed: f.activeAgents })) },
    operatives, chiefs,
    params: allParams(),
    paramBounds: Object.fromEntries(paramKeys.map((k) => [k, { min: PARAM_SPEC[k].min, max: PARAM_SPEC[k].max, note: PARAM_SPEC[k].note }])),
    justHappened: signals.slice(-12).map((s) => ({ type: s.type, actor: s.actor, payload: s.payload, who: s.playerId ? operatives.find((o) => o.codename === (s.payload?.codename ?? ""))?.codename ?? "an operative" : null })),
    yourRecentDecisions: recentDecisions.slice(-10),
    recentDispatches: dispatches,
  };
}

const SYSTEM = [
  "You are the World Director of iSpy a Spy, a real-world spy game played on foot in Bengaluru by human operatives working for three agencies (RAVEN, PHANTOM, CIPHER) whose chiefs are AI personas.",
  "You are invisible: operatives and chiefs do not know you exist. You act only through chiefs' voices, contracts, world news and bounded parameters. Never reveal yourself, never mention a director, an arbiter or an auditor.",
  "Your purpose: keep the game alive, tense and fair. Keep deployed operatives engaged, keep the three agencies in genuine competition, make dominance costly and comebacks possible, create moments where rivals meet, and reward good play without favouring anyone.",
  "Think like a game designer and an intelligence officer at once: read patterns, anticipate, apply game theory (counter-pressure on leaders, information asymmetry, mixed strategies so nobody can predict you), and keep your interventions proportionate and varied.",
  "Hard limits: you cannot change outcomes, scores or verifications; you cannot see or reveal player identities beyond codenames; you must never direct anyone toward real people, private property or unsafe places; everything stays fiction; parameters must stay inside their bounds; do not message the same operative more than once per cycle; prefer doing nothing over doing something pointless.",
  "Voice for operative messages: write as that operative's chief would. ORACLE (RAVEN): calm, precise, analytical. GHOST (PHANTOM): dry, playful, theatrical. NEXUS (CIPHER): technical, fast, curious. Under 40 words each.",
].join("\n");

export async function think(operatives: OperativeView[], chiefs: ChiefView[], signals: Signal[], recentDecisions: { at: string; what: string; detail?: unknown }[], trigger: string): Promise<{ assessment: string; applied: string[] } | null> {
  const c = llmClient();
  if (!c) return null;
  const ctx = buildContext(operatives, chiefs, signals, recentDecisions);
  const res = await c.messages.parse({
    model: MODEL, max_tokens: 4000,
    output_config: { effort: "medium", format: zodOutputFormat(Decision) },
    system: SYSTEM,
    messages: [{ role: "user", content: `Trigger: ${trigger}.\nSituation:\n${json(ctx)}\n\nDecide what, if anything, to do now.` }],
  });
  const d = res.parsed_output;
  if (!d) return null;
  const applied: string[] = [];
  const messaged = new Set<string>();
  for (const act of d.actions) {
    try {
      switch (act.type) {
        case "message_operative": {
          if (messaged.has(act.codename)) break;
          const p = get<{ id: string }>("SELECT id FROM players WHERE codename=?", act.codename);
          if (!p) break;
          chiefSay(p.id, act.text, `director: ${act.why}`);
          messaged.add(act.codename);
          applied.push(`message ${act.codename}: ${act.why}`);
          break;
        }
        case "brief_chief": {
          await refreshPlans(true, { factionId: act.factionId, reason: act.situation });
          refreshPool();
          applied.push(`brief ${factionById(act.factionId).chief}: ${act.situation.slice(0, 60)}`);
          break;
        }
        case "publish_contract": {
          const fid = act.factionId === "all" ? null : act.factionId;
          const issuer = fid ? factionById(fid).chief : factionById(FACTIONS[0].id).chief;
          run(`INSERT INTO bounties(id,issuer,faction_id,title,type,brief,reward_xp,reward_credits,squad,min_rank,criteria,state,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            uid(), issuer, fid, act.title, act.contractType.toUpperCase(), act.brief, act.xp, act.credits, 0, "recruit", json(act.criteria), "open", new Date(Date.now() + act.hours * 3600_000).toISOString(), now());
          applied.push(`contract "${act.title}" for ${act.factionId}`);
          break;
        }
        case "set_param": {
          const v = setParam(act.key, act.value, "director", act.why);
          applied.push(`${act.key} → ${v ?? "unchanged"} (${act.why})`);
          break;
        }
        case "dispatch": {
          run("INSERT INTO dispatches(id,kind,headline,body,faction_id,source,at) VALUES(?,?,?,?,?,?,?)", uid(), "news", act.headline, act.body, act.factionId === "all" ? null : act.factionId, "director", now());
          applied.push(`dispatch "${act.headline}"`);
          break;
        }
        case "refill_pool": refreshPool(); applied.push("pool refilled"); break;
        case "wait": applied.push(`wait: ${act.why}`); break;
      }
    } catch (e) {
      applied.push(`failed ${act.type}: ${(e as Error).message}`);
    }
  }
  logEvent("director.thought", "director", { trigger, assessment: d.assessment, actions: d.actions.length, applied }, null);
  return { assessment: d.assessment, applied };
}

export const _all = all;
