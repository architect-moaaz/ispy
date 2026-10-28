import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod/v4";
import type { FactionId } from "@ispy/shared";
import { all, get, run, now, uid, json, parse, logEvent } from "./db.ts";
import { FACTIONS, factionById } from "./content.ts";
import { pick, rand } from "./puzzles.ts";
import { llmClient } from "./chiefs.ts";

/**
 * The Narrator room of the World Director. It writes: the next campaign's fiction,
 * periodic dispatches (world news), and the epilogue when a campaign resolves.
 * Everything it writes is grounded on facts the Arbiter already committed; it never
 * decides an outcome, never names a player, and never leaks hidden faction intel.
 * Without a model it falls back to scripted text so the world keeps turning.
 */
const MODEL = "claude-opus-5-5";
const CONSTITUTION = [
  "You are the neutral World Director of the fictional mobile spy game iSpy a Spy, set in Bengaluru.",
  "You have no loyalty to any agency (RAVEN, PHANTOM, CIPHER) or player. You create circumstances, never victors.",
  "You only narrate facts you are given; you never invent outcomes, scores or events that did not happen.",
  "Never name a player, never describe a real place as unsafe to be in, never ask anyone to watch, follow or photograph a real person.",
  "Tone: terse intelligence prose, a little dry, no exclamation marks, no emoji. English.",
].join("\n");

const CampaignSchema = z.object({
  name: z.string().max(32).describe("Operation name in capitals, two words, e.g. OPERATION ECLIPSE"),
  brief: z.string().max(360).describe("Two or three sentences of fiction for the campaign banner"),
  fragments: z.number().int().min(3).max(7).describe("How many fragments an agency must recover to win"),
  counts: z.array(z.enum(["DEAD_DROP", "EXTRACTION", "RECON"])).min(1).max(3).describe("Which mission types recover a fragment"),
  hours: z.number().int().min(12).max(48).describe("Campaign length in hours"),
});
export type CampaignSpec = z.infer<typeof CampaignSchema>;

const DispatchSchema = z.object({
  dispatches: z.array(z.object({
    headline: z.string().max(60),
    body: z.string().max(240),
    faction: z.enum(["raven", "phantom", "cipher", "all"]).describe("Who this is about; 'all' for the whole sector"),
  })).min(1).max(3),
});

const NAMES = ["ECLIPSE", "LANTERN", "MERIDIAN", "HOLLOW TIDE", "PAPER MOON", "COLD IRON", "SILK ROUTE", "LAST ORCHARD"];
const PLOTS = [
  "fragments of one encrypted dossier are loose across the sector",
  "a courier network has gone dark and left its caches behind",
  "someone is selling the same secret to all three agencies",
  "a defector's route out of the city runs through the park",
];

/** Facts from the ledger for the narrator to work with. Aggregates only; no player identities. */
function recentFacts(hours: number) {
  const since = new Date(Date.now() - hours * 3600_000).toISOString();
  const ev = get<{ name: string; progress: string; state: string }>("SELECT name, progress, state FROM world_events ORDER BY starts_at DESC LIMIT 1");
  const progress = ev ? parse<Record<string, number>>(ev.progress, {}) : {};
  const count = (type: string, extra = "") => get<{ n: number }>(`SELECT COUNT(*) n FROM events WHERE type=? AND at>? ${extra}`, type, since)!.n;
  const perFaction = FACTIONS.map((f) => ({
    faction: f.name,
    missionsVerified: get<{ n: number }>("SELECT COUNT(*) n FROM missions WHERE faction_id=? AND state='completed' AND completed_at>?", f.id, since)!.n,
    contestsWon: get<{ n: number }>("SELECT COUNT(*) n FROM missions WHERE faction_id=? AND outcome='won' AND completed_at>?", f.id, since)!.n,
    fragments: progress[f.id] ?? 0,
    agentsOnDuty: get<{ n: number }>("SELECT COUNT(*) n FROM presence p JOIN players pl ON pl.id=p.player_id WHERE pl.faction_id=? AND p.expires_at>?", f.id, now())!.n,
  }));
  return {
    campaign: ev ? { name: ev.name, state: ev.state } : null,
    hours,
    perFaction,
    contestsFormed: count("contest.formed"),
    accusationsConfirmed: count("case.confirmed"),
    accusationsRejected: count("case.rejected"),
    bountiesCompleted: count("bounty.completed"),
    decoysExposed: count("evidence.decoy_detected"),
    scansFlagged: count("location.flagged"),
  };
}

export async function proposeCampaign(): Promise<{ spec: CampaignSpec; source: "llm" | "fallback" }> {
  const seed = now().slice(0, 13);
  const fallback: CampaignSpec = {
    name: `OPERATION ${pick(NAMES, seed)}`,
    brief: `Word is that ${pick(PLOTS, seed + ":p")}. Every verified drop or extraction recovers a fragment for your agency. The first to five owns the epilogue.`,
    fragments: 5, counts: ["DEAD_DROP", "EXTRACTION"], hours: 24,
  };
  const c = llmClient();
  if (!c) return { spec: fallback, source: "fallback" };
  try {
    const previous = all<{ name: string }>("SELECT name FROM world_events ORDER BY starts_at DESC LIMIT 5").map((r) => r.name);
    const res = await c.messages.parse({
      model: MODEL, max_tokens: 1500,
      output_config: { effort: "low", format: zodOutputFormat(CampaignSchema) },
      system: CONSTITUTION,
      messages: [{ role: "user", content: `Design the next 24-hour-ish campaign for the sector. Previous campaign names, do not reuse: ${previous.join(", ") || "none"}. Recent facts: ${json(recentFacts(24))}. The win rule is fixed by the Arbiter: agencies recover fragments by completing the mission types you choose; most fragments at the deadline wins, first to the target wins early.` }],
    });
    if (!res.parsed_output) throw new Error("no parsed output");
    return { spec: res.parsed_output, source: "llm" };
  } catch (e) {
    console.warn("[director] campaign fell back:", (e as Error).message);
    return { spec: fallback, source: "fallback" };
  }
}

export async function writeEpilogue(eventName: string, winner: FactionId | null, fragments: number): Promise<string> {
  const fallback = winner
    ? `${factionById(winner).name} reassembled the dossier with ${fragments} fragment${fragments === 1 ? "" : "s"}. ${factionById(winner).chiefName} sends regards to the other chiefs.`
    : "Nobody recovered a single fragment. The dossier stays encrypted, and the chiefs say nothing.";
  const c = llmClient();
  if (!c) return fallback;
  try {
    const res = await c.messages.create({
      model: MODEL, max_tokens: 300, output_config: { effort: "low" },
      system: CONSTITUTION,
      messages: [{ role: "user", content: `Write the epilogue for ${eventName} in at most 60 words. Outcome, decided by the Arbiter: ${winner ? `${factionById(winner).name} won with ${fragments} fragments` : "no agency recovered any fragment; no winner"}. Facts: ${json(recentFacts(24))}. Plain prose, no title.` }],
    });
    const text = res.content.filter((b) => b.type === "text").map((b) => (b as any).text).join("").trim();
    return text || fallback;
  } catch (e) {
    console.warn("[director] epilogue fell back:", (e as Error).message);
    return fallback;
  }
}

/** Every six hours: up to three dispatches about what actually happened. */
export async function publishDispatches(force = false) {
  const last = get<{ at: string }>("SELECT at FROM dispatches ORDER BY at DESC LIMIT 1");
  if (!force && last && Date.parse(last.at) > Date.now() - 6 * 3600_000) return;
  const facts = recentFacts(6);
  let items: { headline: string; body: string; faction: string }[] = [];
  let source: "llm" | "fallback" = "fallback";
  const c = llmClient();
  if (c) {
    try {
      const res = await c.messages.parse({
        model: MODEL, max_tokens: 1200,
        output_config: { effort: "low", format: zodOutputFormat(DispatchSchema) },
        system: CONSTITUTION,
        messages: [{ role: "user", content: `Write up to three short world dispatches for the operatives' news feed, based only on these facts from the last six hours: ${json(facts)}. If little happened, say so in one dispatch. Do not favour any agency.` }],
      });
      if (res.parsed_output) { items = res.parsed_output.dispatches; source = "llm"; }
    } catch (e) {
      console.warn("[director] dispatches fell back:", (e as Error).message);
    }
  }
  if (!items.length) {
    const busiest = [...facts.perFaction].sort((a, b) => b.missionsVerified - a.missionsVerified)[0];
    const total = facts.perFaction.reduce((s, f) => s + f.missionsVerified, 0);
    items = total === 0
      ? [{ headline: "Quiet sector", body: "No verified movement in the last six hours. The caches are still where they were left.", faction: "all" }]
      : [
        { headline: `${busiest.faction} most active`, body: `${busiest.faction} verified ${busiest.missionsVerified} mission${busiest.missionsVerified === 1 ? "" : "s"} in six hours${facts.contestsFormed ? `, with ${facts.contestsFormed} contested target${facts.contestsFormed === 1 ? "" : "s"} formed` : ""}.`, faction: "all" },
        ...(facts.accusationsConfirmed + facts.accusationsRejected ? [{ headline: "Covers under pressure", body: `${facts.accusationsConfirmed} accusation${facts.accusationsConfirmed === 1 ? "" : "s"} confirmed, ${facts.accusationsRejected} rejected. Somebody is keeping a dossier on somebody.`, faction: "all" }] : []),
      ];
  }
  for (const d of items) {
    run("INSERT INTO dispatches(id,kind,headline,body,faction_id,source,at) VALUES(?,?,?,?,?,?,?)", uid(), "news", d.headline, d.body, d.faction === "all" ? null : d.faction, source, now());
  }
  logEvent("director.dispatch", "director", { count: items.length, source }, null);
}

export function recentDispatches(limit = 6) {
  return all<{ id: string; kind: string; headline: string; body: string; faction_id: string | null; at: string }>(
    "SELECT id, kind, headline, body, faction_id, at FROM dispatches ORDER BY at DESC LIMIT ?", limit,
  ).map((d) => ({ id: d.id, kind: d.kind, headline: d.headline, body: d.body, factionId: d.faction_id, at: d.at }));
}

export const narratorSeed = rand;
