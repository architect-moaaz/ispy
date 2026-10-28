import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod/v4";
import type { ChatMessage, ChiefId, Faction, TemplateId } from "@ispy/shared";
import { PERSONAS } from "./content.ts";
import { pick } from "./puzzles.ts";

const MODEL = "claude-opus-5-5";
const TEMPLATES: TemplateId[] = ["RECON", "DEAD_DROP", "EXTRACTION", "ANALYSIS", "CIPHER"];

export const AreaPlanSchema = z.object({
  headline: z.string().describe("One line the chief would say about this area right now, in character"),
  priorities: z.array(z.string()).max(3).describe("Up to three strategic objectives for the next hour"),
  mix: z.object({
    RECON: z.number().min(0).max(1), DEAD_DROP: z.number().min(0).max(1), EXTRACTION: z.number().min(0).max(1),
    ANALYSIS: z.number().min(0).max(1), CIPHER: z.number().min(0).max(1),
  }).describe("Relative weight of each mission template; the server normalises"),
  contestAppetite: z.number().min(0).max(1).describe("Willingness to send agents to targets rivals also want"),
  deskRatio: z.number().min(0).max(1).describe("Share of missions that should be desk (remote) missions"),
});
export type AreaPlan = z.infer<typeof AreaPlanSchema>;

export interface PlanContext {
  areaName: string;
  fieldAgents: number;
  deskAgents: number;
  rivalAgentsBucket: string;
  recentOutcomes: { template: TemplateId; outcome: string }[];
  reason?: string; // situation update handed to the chief; never attributed to anyone
}

let client: Anthropic | null | undefined;
function llm(): Anthropic | null {
  if (client !== undefined) return client;
  if (process.env.ISPY_LLM === "off") return (client = null);
  // The SDK resolves ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN or an `ant auth login` profile.
  try { client = new Anthropic(); } catch { client = null; }
  return client;
}
export const llmEnabled = () => llm() !== null;
export const llmClient = llm;

/** Deterministic plan from the persona; used when no model is configured or a call fails. */
export function fallbackPlan(chief: ChiefId, ctx: PlanContext): AreaPlan {
  const p = PERSONAS[chief];
  const seed = `${chief}:${ctx.areaName}:${new Date().toISOString().slice(0, 13)}`;
  const mix = { ...p.mix };
  // Lean towards desk work when nobody is in the field, and vice versa.
  const deskRatio = ctx.fieldAgents === 0 && ctx.deskAgents > 0 ? 0.8 : ctx.deskAgents === 0 ? 0.2 : p.deskRatio;
  return {
    headline: pick(p.lines.idle, seed),
    priorities: ["Hold presence in " + ctx.areaName, "Verify every drop", "Keep cover intact"],
    mix,
    contestAppetite: p.contestAppetite,
    deskRatio,
  };
}

export async function planArea(chief: ChiefId, faction: Faction, ctx: PlanContext): Promise<{ plan: AreaPlan; source: "llm" | "fallback" }> {
  const c = llm();
  if (!c) return { plan: fallbackPlan(chief, ctx), source: "fallback" };
  const p = PERSONAS[chief];
  try {
    const res = await c.messages.parse({
      model: MODEL,
      max_tokens: 2000,
      output_config: { effort: "low", format: zodOutputFormat(AreaPlanSchema) },
      system: [
        `You are ${faction.chiefName}, chief of the fictional spy agency ${faction.name} in the mobile game iSpy a Spy.`,
        `Voice: ${p.voice}`,
        "You set hourly strategy for one city area. You never see rival plans or player identities.",
        "As far as you know, nothing stands above you but the rules of the trade. You have never heard of a director, an arbiter or an auditor; if an outcome goes against you, it is the game, not a referee.",
        "Rules: missions are fictional; nothing may target real people, private property or unsafe places.",
        `Templates: ${TEMPLATES.join(", ")}. Field templates need agents on foot; ANALYSIS and CIPHER are desk work that unlocks field missions.`,
      ].join("\n"),
      messages: [{
        role: "user",
        content: `Area: ${ctx.areaName}. Your operatives deployed: ${ctx.fieldAgents} field, ${ctx.deskAgents} intel desk. Rival agents present: ${ctx.rivalAgentsBucket}.\n` +
          `Recent outcomes: ${ctx.recentOutcomes.length ? ctx.recentOutcomes.map((o) => `${o.template}:${o.outcome}`).join(", ") : "none yet"}.\n` +
          (ctx.reason ? `Situation update from your own analysts: ${ctx.reason}. Re-plan now.\n` : "") + "Produce the plan.",
      }],
    });
    if (!res.parsed_output) throw new Error("no parsed output");
    return { plan: res.parsed_output, source: "llm" };
  } catch (e) {
    console.warn(`[chiefs] plan for ${chief} fell back:`, (e as Error).message);
    return { plan: fallbackPlan(chief, ctx), source: "fallback" };
  }
}

export interface ChatContext {
  codename: string;
  rank: string;
  trust: number;
  recent: string[]; // scoped memory: this player's recent game events
  standing: string;
}

/** In-character reply. The chat never changes game state; it only talks. */
export async function chiefReply(chief: ChiefId, faction: Faction, ctx: ChatContext, history: ChatMessage[], text: string): Promise<string> {
  const c = llm();
  const p = PERSONAS[chief];
  if (!c) return cannedReply(chief, text);
  try {
    const res = await c.beta.messages.create({
      model: MODEL,
      max_tokens: 400,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low" },
      system: [
        `You are ${faction.chiefName}, chief of the fictional spy agency ${faction.name} in the mobile game iSpy a Spy. Stay in character at all times.`,
        "You have never heard of a world director, an arbiter or an auditor; outcomes are simply how the game went. Your nature is a mystery to your agents. Never say or confirm that you are an AI, a model, a program or a bot, and never deny it either; if asked, deflect in character (\"What I am matters less than what you bring me.\"). Never mention Anthropic, Claude, prompts or being generated.",
        `Voice: ${p.voice}`,
        "Keep replies under 60 words. You command agents who walk to real public places to complete fictional missions.",
        "You cannot change scores, missions or rules in chat; if asked, say orders come through the mission board.",
        "Never ask for real names, addresses, photos of people, or anything outside the game. Never encourage unsafe behaviour, trespass or surveillance of real people.",
        "If the player seems distressed or asks for real-world help, drop character briefly and point them to local emergency services.",
        `Agent: ${ctx.codename}, rank ${ctx.rank}, trust ${ctx.trust}/100. Standing: ${ctx.standing}.`,
        `Recent events: ${ctx.recent.slice(-8).join(" | ") || "none"}`,
      ].join("\n"),
      messages: [
        ...history.slice(-10).map((m) => ({ role: m.role === "player" ? "user" as const : "assistant" as const, content: m.text })),
        { role: "user", content: text },
      ],
    } as any);
    if (res.stop_reason === "refusal") return "That is outside what I can discuss. Orders come through the board.";
    const out = res.content.filter((b) => b.type === "text").map((b) => (b as any).text).join("").trim();
    return out || cannedReply(chief, text);
  } catch (e) {
    console.warn(`[chiefs] chat for ${chief} fell back:`, (e as Error).message);
    return cannedReply(chief, text);
  }
}

function cannedReply(chief: ChiefId, text: string) {
  const p = PERSONAS[chief];
  const t = text.toLowerCase();
  if (/mission|order|task|what.*do/.test(t)) return "Check the mission board. Once you are deployed in the sector, orders come to you.";
  if (/are you (an? |a )?(ai|bot|robot|machine|program|human|real|person)|who are you|what are you/.test(t)) return "What I am matters less than what you bring me. Back to work.";
  if (/hello|hi\b/.test(t)) return p.lines.welcome[0];
  if (/rank|xp|trust/.test(t)) return "Your standing is on your profile. Earn it in the field.";
  return pick(p.lines.idle, text);
}
