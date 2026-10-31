import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod/v4";
import type { FactionId, TemplateId } from "@ispy/shared";
import { all, get, run, now, uid, json, parse, logEvent, db } from "./db.ts";
import { FACTIONS, PERSONAS, factionById } from "./content.ts";
import { distanceM, type AreaRow } from "./geo.ts";
import { pick, rand } from "./puzzles.ts";
import { llmClient, llmFailed } from "./chiefs.ts";

/**
 * Operations: chains of linked field missions the World Director composes for one operative.
 * Each link is a real mission (recon, drop, extraction) at a real target, reserved for that
 * operative and offered as soon as the previous link verifies, with briefs that carry the story
 * from one site to the next. The Director writes the fiction (model) or falls back to scripted
 * continuity; the Arbiter still verifies every link like any other mission.
 */
db.exec(`CREATE TABLE IF NOT EXISTS chains (
  id TEXT PRIMARY KEY, player_id TEXT NOT NULL, faction_id TEXT NOT NULL, area_id TEXT NOT NULL,
  name TEXT NOT NULL, premise TEXT NOT NULL, steps TEXT NOT NULL, step INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'active', source TEXT NOT NULL, bonus_xp INTEGER NOT NULL DEFAULT 200,
  created_at TEXT NOT NULL, completed_at TEXT
)`);
try { db.exec("ALTER TABLE missions ADD COLUMN reserved_for TEXT"); } catch { /* already there */ }

export interface ChainStep { template: TemplateId; targetId: string; targetName: string; title: string; brief: string; missionId?: string }
export interface ChainRow { id: string; player_id: string; faction_id: FactionId; area_id: string; name: string; premise: string; steps: string; step: number; state: string; source: string; bonus_xp: number; created_at: string; completed_at: string | null }
export interface TargetLite { id: string; name: string; kind: string; lat: number; lng: number }

const MODEL = "claude-opus-5-5";
const NAMES = ["OPERATION GLASS KEY", "OPERATION NIGHTJAR", "OPERATION PAPER TIGER", "OPERATION LOW TIDE", "OPERATION SECOND SHADOW", "OPERATION QUIET HOUR", "OPERATION BLUE LANTERN", "OPERATION LAST COURIER"];
const SHAPES: TemplateId[][] = [["RECON", "DEAD_DROP", "EXTRACTION"], ["RECON", "RECON", "DEAD_DROP"], ["DEAD_DROP", "RECON", "EXTRACTION"]];
const STEP_TITLES: Record<TemplateId, string> = { RECON: "Reconnaissance", DEAD_DROP: "Dead drop", EXTRACTION: "Extraction", ANALYSIS: "Site analysis", CIPHER: "Cipher break" };

const StorySchema = z.object({
  name: z.string().describe("OPERATION plus one or two words, in capitals"),
  premise: z.string().describe("One sentence the chief uses to open the operation; at most 160 characters"),
  steps: z.array(z.object({ brief: z.string().describe("The chief's order for this link, in character, referencing what the previous link found; at most 220 characters") })).min(2).max(4),
  closing: z.string().describe("What the chief says when the last link verifies; at most 160 characters"),
});

export function activeChain(playerId: string): ChainRow | undefined {
  return get<ChainRow>("SELECT * FROM chains WHERE player_id=? AND state='active'", playerId);
}
export function chainOf(missionParams: string | null | undefined): { chainId: string; step: number } | null {
  const p = parse<any>(missionParams, {});
  return p?.chainId ? { chainId: p.chainId, step: p.chainStep ?? 0 } : null;
}
export function chainSummary(chainId: string): { name: string; step: number; of: number } | null {
  const c = get<ChainRow>("SELECT * FROM chains WHERE id=?", chainId);
  if (!c) return null;
  return { name: c.name, step: Math.min(c.step + 1, parse<ChainStep[]>(c.steps, []).length), of: parse<ChainStep[]>(c.steps, []).length };
}

/** Pick a sequence of targets as a walk: each next site is near the previous one, none repeated. */
function routeTargets(from: { lat: number; lng: number }, targets: TargetLite[], n: number, seed: string): TargetLite[] {
  const out: TargetLite[] = [];
  let at = from;
  let pool = [...targets];
  for (let i = 0; i < n && pool.length; i++) {
    const near = pool.map((t) => ({ t, d: distanceM(at.lat, at.lng, t.lat, t.lng) })).filter((x) => x.d >= 80).sort((a, b) => a.d - b.d).slice(0, 3);
    if (!near.length) break;
    const chosen = near[Math.floor(rand(`${seed}:${i}`) * near.length)].t;
    out.push(chosen);
    pool = pool.filter((t) => t.id !== chosen.id);
    at = chosen;
  }
  return out;
}

function scriptedStory(chief: keyof typeof PERSONAS, steps: { template: TemplateId; targetName: string }[], seed: string) {
  const p = PERSONAS[chief];
  const name = pick(NAMES, seed);
  const briefs = steps.map((s, i) => {
    const prev = i > 0 ? steps[i - 1].targetName : null;
    const lead = i === 0 ? "First link." : i === steps.length - 1 ? `Last link. What you found at ${prev} points here.` : `Next link. ${prev} gave us a thread; follow it.`;
    return `${lead} ${pick(p.lines[s.template], `${seed}:${i}`).replace("{target}", s.targetName)}`;
  });
  return { name, premise: `${name} is yours. Three sites, one thread. Take them in order and bring me the picture.`, briefs, closing: "That closes the operation. The picture is whole, and it is ours.", source: "fallback" as const };
}

async function authoredStory(factionId: FactionId, steps: { template: TemplateId; targetName: string; kind: string }[], seed: string, theme?: string) {
  const f = factionById(factionId);
  const p = PERSONAS[f.chief];
  const scripted = scriptedStory(f.chief, steps, seed);
  const c = llmClient();
  if (!c) return scripted;
  try {
    const res = await c.messages.parse({
      model: MODEL, max_tokens: 1500,
      output_config: { effort: "low", format: zodOutputFormat(StorySchema) },
      system: [
        `You write a short linked operation for the fictional mobile spy game iSpy a Spy, in the voice of ${f.chiefName}, chief of ${f.name}. Voice: ${p.voice}`,
        "The operative walks to real public places; each link is a mission at one site. Each brief must mention its site by name and connect to what the previous link found, so the chain reads as one story.",
        "Fiction only: never ask anyone to watch, follow, photograph or contact a real person, enter private property, or do anything unsafe. No exclamation marks, no emoji. Never mention a director, arbiter, auditor, model or prompt.",
      ].join("\n"),
      messages: [{ role: "user", content: `Links in order: ${steps.map((s, i) => `${i + 1}. ${s.template} at "${s.targetName}" (${s.kind})`).join("; ")}.${theme ? ` Theme from command: ${theme}.` : ""} Write the operation name, premise, one brief per link (exactly ${steps.length}), and the closing line.` }],
    });
    const o = res.parsed_output;
    if (!o || o.steps.length !== steps.length) throw new Error("story shape mismatch");
    return { name: o.name.slice(0, 40), premise: o.premise.slice(0, 200), briefs: o.steps.map((s) => s.brief.slice(0, 260)), closing: o.closing.slice(0, 200), source: "llm" as const };
  } catch (e) {
    console.warn("[chains] story fell back:", (e as Error).message); llmFailed(e);
    return scripted;
  }
}

export type SpawnStep = (chain: ChainRow, step: ChainStep, index: number) => string; // returns mission id

/**
 * Start an operation for a deployed field operative. `spawn` creates the mission for a link
 * (engine owns mission creation). Returns null when the operative is not in the field, already
 * has an operation, or the sector has too few targets.
 */
export async function startChain(playerId: string, spawn: SpawnStep, theme?: string): Promise<ChainRow | null> {
  if (activeChain(playerId)) return null;
  const me = get<{ faction_id: FactionId | null; area_id: string | null; mode: string; lat: number | null; lng: number | null }>(
    "SELECT pl.faction_id, p.area_id, p.mode, p.last_lat lat, p.last_lng lng FROM presence p JOIN players pl ON pl.id=p.player_id WHERE p.player_id=? AND p.expires_at>?", playerId, now());
  if (!me?.faction_id || !me.area_id || me.mode !== "field" || me.lat == null) return null;
  const area = get<AreaRow>("SELECT * FROM areas WHERE id=?", me.area_id)!;
  const hour = new Date().getHours();
  const recent = new Set(all<{ target_id: string }>("SELECT target_id FROM missions WHERE assignee_id=? AND completed_at > ?", playerId, new Date(Date.now() - 6 * 3600_000).toISOString()).map((r) => r.target_id));
  const targets = all<TargetLite>("SELECT id, name, kind, lat, lng FROM targets WHERE area_id=? AND state='ACTIVE' AND (safe_start<=? AND safe_end>? OR ?=1)", me.area_id, hour, hour, process.env.DEV_SIM === "1" ? 1 : 0)
    .filter((t) => !recent.has(t.id));
  const seed = `${playerId}:${now().slice(0, 13)}`;
  const shape = SHAPES[Math.floor(rand(seed + ":shape") * SHAPES.length)];
  const picked = routeTargets({ lat: me.lat, lng: me.lng! }, targets, shape.length, seed);
  if (picked.length < 2) return null;
  const plan = picked.map((t, i) => ({ template: shape[i], targetName: t.name, kind: t.kind, target: t }));
  const story = await authoredStory(me.faction_id, plan, seed, theme);
  const steps: ChainStep[] = plan.map((s, i) => ({ template: s.template, targetId: s.target.id, targetName: s.target.name, title: `${STEP_TITLES[s.template]} · link ${i + 1}`, brief: story.briefs[i] }));
  const id = uid();
  run("INSERT INTO chains(id,player_id,faction_id,area_id,name,premise,steps,step,state,source,bonus_xp,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
    id, playerId, me.faction_id, me.area_id, story.name, story.premise, json(steps), 0, "active", story.source, 150 + 50 * steps.length, now());
  const chain = get<ChainRow>("SELECT * FROM chains WHERE id=?", id)!;
  run("UPDATE chains SET premise=? WHERE id=?", json({ premise: story.premise, closing: story.closing }), id);
  spawnStep(chain, 0, spawn);
  logEvent("chain.started", "director", { chainId: id, name: story.name, links: steps.length, source: story.source, area: area.name }, playerId);
  return get<ChainRow>("SELECT * FROM chains WHERE id=?", id)!;
}

/** An operation on exactly these sites, in this order, with these templates: the Director lays the route. */
export async function startChainFrom(playerId: string, spawn: SpawnStep, targets: TargetLite[], shape: TemplateId[], theme?: string, nameOverride?: string): Promise<ChainRow | null> {
  const prior = activeChain(playerId);
  if (prior) { run("UPDATE chains SET state='abandoned', completed_at=? WHERE id=?", now(), prior.id); run("UPDATE missions SET state='cancelled' WHERE assignee_id=? AND state='active' AND json_extract(params,'$.chainId')=?", playerId, prior.id); }
  const me = get<{ faction_id: FactionId | null; area_id: string | null }>("SELECT pl.faction_id, p.area_id FROM presence p JOIN players pl ON pl.id=p.player_id WHERE p.player_id=? AND p.expires_at>?", playerId, now());
  if (!me?.faction_id || !me.area_id || targets.length < 2) return null;
  const area = get<AreaRow>("SELECT * FROM areas WHERE id=?", me.area_id)!;
  const seed = `${playerId}:line:${now().slice(0, 16)}`;
  const plan = targets.map((t, i) => ({ template: shape[i % shape.length], targetName: t.name, kind: t.kind, target: t }));
  const story = await authoredStory(me.faction_id, plan, seed, theme);
  const steps: ChainStep[] = plan.map((s, i) => ({ template: s.template, targetId: s.target.id, targetName: s.target.name, title: `${STEP_TITLES[s.template]} · link ${i + 1} of ${plan.length}`, brief: story.briefs[i] }));
  const id = uid();
  run("INSERT INTO chains(id,player_id,faction_id,area_id,name,premise,steps,step,state,source,bonus_xp,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
    id, playerId, me.faction_id, me.area_id, nameOverride ?? story.name, json({ premise: story.premise, closing: story.closing }), json(steps), 0, "active", story.source, 150 + 50 * steps.length, now());
  const chain = get<ChainRow>("SELECT * FROM chains WHERE id=?", id)!;
  spawnStep(chain, 0, spawn);
  logEvent("chain.started", "director", { chainId: id, name: chain.name, links: steps.length, source: story.source, area: area.name, line: true }, playerId);
  return get<ChainRow>("SELECT * FROM chains WHERE id=?", id)!;
}

function spawnStep(chain: ChainRow, index: number, spawn: SpawnStep) {
  const steps = parse<ChainStep[]>(chain.steps, []);
  const step = steps[index];
  if (!step) return;
  const missionId = spawn(chain, step, index);
  steps[index] = { ...step, missionId };
  run("UPDATE chains SET steps=?, step=? WHERE id=?", json(steps), index, chain.id);
}

export function premiseOf(chain: ChainRow): { premise: string; closing: string } {
  const p = parse<any>(chain.premise, null);
  return p && typeof p === "object" ? p : { premise: String(chain.premise), closing: "That closes the operation." };
}

/** A link verified: open the next, or close the operation. Returns what the chief should say. */
export function onLinkVerified(playerId: string, chainId: string, index: number, spawn: SpawnStep): { say: string; done: boolean; bonusXp: number; name: string } | null {
  const chain = get<ChainRow>("SELECT * FROM chains WHERE id=? AND player_id=? AND state='active'", chainId, playerId);
  if (!chain) return null;
  const steps = parse<ChainStep[]>(chain.steps, []);
  const next = index + 1;
  if (next < steps.length) {
    spawnStep(chain, next, spawn);
    logEvent("chain.advanced", "director", { chainId, name: chain.name, link: next + 1, of: steps.length }, playerId);
    return { say: `Link ${index + 1} verified. ${steps[next].brief}`, done: false, bonusXp: 0, name: chain.name };
  }
  run("UPDATE chains SET state='done', completed_at=? WHERE id=?", now(), chainId);
  logEvent("chain.completed", "director", { chainId, name: chain.name, links: steps.length, bonusXp: chain.bonus_xp }, playerId);
  return { say: premiseOf(chain).closing, done: true, bonusXp: chain.bonus_xp, name: chain.name };
}

/** A link was dropped or expired: the operation folds. The chief can start another later. */
export function onLinkLost(playerId: string, chainId: string, why: string) {
  const chain = get<ChainRow>("SELECT * FROM chains WHERE id=? AND player_id=? AND state='active'", chainId, playerId);
  if (!chain) return;
  run("UPDATE chains SET state='abandoned', completed_at=? WHERE id=?", now(), chainId);
  logEvent("chain.abandoned", "director", { chainId, name: chain.name, why }, playerId);
}

export function chainsOverview() {
  return all<ChainRow & { codename: string }>("SELECT c.*, pl.codename FROM chains c JOIN players pl ON pl.id=c.player_id ORDER BY c.created_at DESC LIMIT 20")
    .map((c) => ({ id: c.id, codename: c.codename, faction: factionById(c.faction_id).name, name: c.name, step: c.step + 1, of: parse<ChainStep[]>(c.steps, []).length, state: c.state, source: c.source, createdAt: c.created_at }));
}

export const factionsForChains = FACTIONS;
