import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod/v4";
import type { FactionId } from "@ispy/shared";
import { all, get, run, now, uid, json, parse, logEvent, db, worldGet, worldSet } from "./db.ts";
import { FACTIONS, PERSONAS, factionById } from "./content.ts";
import { distanceM, type AreaRow } from "./geo.ts";
import { pick, rand } from "./puzzles.ts";
import { llmClient, llmFailed, recall, remember } from "./chiefs.ts";
import * as bounties from "./bounties.ts";

/**
 * Chaos. The World Director brews a crisis in a sector: something is moving, leaking, or
 * breaking across a few real sites for a limited time. Each chief, in character and without
 * knowing where the crisis comes from, picks a stance: INTERCEPT (take it for the agency),
 * SABOTAGE (burn it so nobody has it) or MITIGATE (contain it, keep the city quiet). Chiefs may
 * also strike a pact: allied agencies share credit and their operatives can run each other's
 * crisis missions. Sites go to whoever verifies first. The Arbiter resolves the crisis when every
 * site is claimed or the clock runs out; the Director narrates the outcome.
 */
db.exec(`CREATE TABLE IF NOT EXISTS crises (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, premise TEXT NOT NULL, area_id TEXT NOT NULL,
  sites TEXT NOT NULL, stances TEXT NOT NULL, pacts TEXT NOT NULL, state TEXT NOT NULL,
  starts_at TEXT NOT NULL, ends_at TEXT NOT NULL, outcome TEXT, source TEXT NOT NULL, created_at TEXT NOT NULL
)`);

db.exec(`CREATE TABLE IF NOT EXISTS chief_talks (
  id TEXT PRIMARY KEY, crisis_id TEXT NOT NULL, round INTEGER NOT NULL, from_faction TEXT NOT NULL, to_faction TEXT,
  kind TEXT NOT NULL, text TEXT NOT NULL, at TEXT NOT NULL
)`);
export type Stance = "intercept" | "sabotage" | "mitigate";
export interface Site { targetId: string; name: string; lat: number; lng: number; claimedBy: FactionId | null; claimedAt: string | null; playerId: string | null; stance: Stance | null }
export interface CrisisRow { id: string; name: string; kind: string; premise: string; area_id: string; sites: string; stances: string; pacts: string; state: string; starts_at: string; ends_at: string; outcome: string | null; source: string; created_at: string }
export interface Outcome { verdict: "intercepted" | "burned" | "contained" | "fizzled"; by: FactionId[]; sitesBy: Record<string, number>; epilogue: string; chaos: number }

const MODEL = "claude-opus-5-5";
const KINDS: Record<string, { name: string[]; premise: (area: string) => string; asset: string }> = {
  courier: { name: ["THE COURIER", "SILK HANDOFF", "THREE STOPS"], premise: (a) => `A courier is moving a sealed package through ${a}. It changes hands at three points over the next hours. Whoever controls the handoffs controls the package.`, asset: "the package" },
  jammer: { name: ["DEAD AIR", "WHITE NOISE", "STATIC"], premise: (a) => `Someone has planted signal jammers around ${a}. Every agency's comms in the sector are degraded until the jammers are found.`, asset: "the jammers" },
  auction: { name: ["OPEN BID", "THE BROKER", "SAME SECRET TWICE"], premise: (a) => `A broker is selling the same secret to all three agencies, one site at a time, in ${a}. The first buyer at each site sets the price for the rest.`, asset: "the secret" },
  leak: { name: ["PAPER TRAIL", "THE ROSTER", "LOOSE PAGES"], premise: (a) => `Pages of an agency roster have been staged across ${a}, timed for release. Every page recovered or burned is one fewer in the open.`, asset: "the roster" },
};
const c0 = (t: string) => t.replace(/^[A-Z ]+\. /, "");
const STANCE_TITLE: Record<Stance, string> = { intercept: "Intercept", sabotage: "Sabotage", mitigate: "Mitigate" };
const STANCE_BRIEF: Record<Stance, (asset: string, site: string) => string> = {
  intercept: (a, s) => `Get to ${s} before anyone else and take ${a} for us. First hands on it keeps it.`,
  sabotage: (a, s) => `Reach ${s} and burn ${a} there. If we cannot have it, nobody will. Be first.`,
  mitigate: (a, s) => `Secure ${s} and contain ${a} before the sector lights up. Quiet is the win here.`,
};
const WEIGHTS: Record<string, Record<Stance, number>> = {
  oracle: { mitigate: 0.5, intercept: 0.35, sabotage: 0.15 },
  ghost: { sabotage: 0.5, intercept: 0.3, mitigate: 0.2 },
  nexus: { intercept: 0.5, mitigate: 0.3, sabotage: 0.2 },
};

const StanceSchema = z.object({
  stance: z.enum(["intercept", "sabotage", "mitigate"]),
  pactWith: z.enum(["raven", "phantom", "cipher", "none"]).describe("An agency you would share this crisis with, or none"),
  line: z.string().describe("What you tell your operatives about this crisis, in character, at most 200 characters"),
});
const EpilogueSchema = z.object({ epilogue: z.string().describe("At most 240 characters; neutral, no winner invented") });
const ReplySchema = z.object({
  accept: z.boolean().describe("Whether you accept the pact proposed to you"),
  text: z.string().describe("Your reply to the other chief, in character, over the back channel; at most 220 characters"),
  stance: z.enum(["intercept", "sabotage", "mitigate"]).describe("Your stance after hearing them; you may change it to align with a pact you accept"),
});

function talk(crisisId: string, round: number, from: FactionId, to: FactionId | null, kind: string, text: string) {
  run("INSERT INTO chief_talks(id,crisis_id,round,from_faction,to_faction,kind,text,at) VALUES(?,?,?,?,?,?,?,?)", uid(), crisisId, round, from, to, kind, text, now());
}
export function talksOf(crisisId: string) {
  return all<{ round: number; from_faction: FactionId; to_faction: FactionId | null; kind: string; text: string; at: string }>(
    "SELECT round, from_faction, to_faction, kind, text, at FROM chief_talks WHERE crisis_id=? ORDER BY at", crisisId)
    .map((t) => ({ round: t.round, from: factionById(t.from_faction).chiefName, fromId: t.from_faction, to: t.to_faction ? factionById(t.to_faction).chiefName : null, kind: t.kind, text: t.text, at: t.at }));
}

/** One chief answers another's proposal over the back channel (model or scripted). */
async function replyToProposal(c: { name: string; premise: string; kind: string }, me: FactionId, from: FactionId, proposal: { stance: Stance; line: string }, myStance: Stance, seed: string): Promise<{ accept: boolean; text: string; stance: Stance; source: "llm" | "fallback" }> {
  const f = factionById(me), other = factionById(from);
  const p = PERSONAS[f.chief];
  const same = proposal.stance === myStance;
  const acceptScripted = same || rand(seed + ":acc") < 0.35;
  const fallback = {
    accept: acceptScripted,
    text: acceptScripted ? `${other.chiefName}. Agreed, for this one. We ${same ? myStance : proposal.stance} together and split the sites. Cross me and it ends.` : `${other.chiefName}. No. ${f.name} ${myStance}s this alone. Stay out of our way.`,
    stance: acceptScripted ? proposal.stance : myStance, source: "fallback" as const,
  };
  const llm = llmClient();
  if (!llm) return fallback;
  try {
    const res = await llm.messages.parse({
      model: MODEL, max_tokens: 500, output_config: { effort: "low", format: zodOutputFormat(ReplySchema) },
      system: [
        `You are ${f.chiefName}, chief of the fictional spy agency ${f.name} in the mobile game iSpy a Spy. Voice: ${p.voice}`,
        `${other.chiefName} of ${other.name} has opened a back channel about the crisis "${c.name}" and proposes a pact. You had decided to ${myStance}. Accept only if it serves ${f.name}; pacts share credit and let operatives run each other's crisis missions. Reply in character, over the wire, terse. Fiction only. Never mention a director, arbiter, auditor, model or prompt.`,
        `Your journal (recent): ${recall(f.chief, null, 6).join(" | ") || "empty"}`,
      ].join("\n"),
      messages: [{ role: "user", content: `${other.chiefName} proposes: ${proposal.stance.toUpperCase()} together. Their words: "${proposal.line}"` }],
    });
    const o = res.parsed_output;
    if (!o) throw new Error("no parsed output");
    return { accept: o.accept, text: o.text.slice(0, 260), stance: o.accept ? (o.stance === proposal.stance ? o.stance : proposal.stance) : o.stance, source: "llm" };
  } catch (e) {
    console.warn(`[crises] reply for ${me} fell back:`, (e as Error).message); llmFailed(e);
    return fallback;
  }
}

export const CRISIS_MIN_GAP_MS = 45 * 60_000;
export const activeCrisis = (areaId?: string) => areaId
  ? get<CrisisRow>("SELECT * FROM crises WHERE area_id=? AND state='active' AND ends_at>?", areaId, now())
  : get<CrisisRow>("SELECT * FROM crises WHERE state='active' AND ends_at>? ORDER BY starts_at DESC LIMIT 1", now());
export const lastCrisisEndedAt = () => get<{ t: string }>("SELECT MAX(COALESCE(ends_at, created_at)) t FROM crises")?.t ?? null;
export const sitesOf = (c: CrisisRow) => parse<Site[]>(c.sites, []);
export const stancesOf = (c: CrisisRow) => parse<Record<FactionId, Stance>>(c.stances, {} as any);
export const pactsOf = (c: CrisisRow) => parse<FactionId[][]>(c.pacts, []);
export const alliesOf = (c: CrisisRow, f: FactionId): FactionId[] => pactsOf(c).filter((p) => p.includes(f)).flat().filter((x) => x !== f);

/** A mission for one agency at one site; the engine owns mission creation. */
export type SpawnCrisisMission = (crisis: CrisisRow, factionId: FactionId, site: Site, stance: Stance, title: string, brief: string, jointWith: FactionId[]) => string;

async function chooseStance(c: { name: string; premise: string; kind: string }, factionId: FactionId, seed: string): Promise<{ stance: Stance; pactWith: FactionId | null; line: string; source: "llm" | "fallback" }> {
  const f = factionById(factionId);
  const p = PERSONAS[f.chief];
  const w = WEIGHTS[f.chief];
  let r = rand(seed + factionId);
  let stance: Stance = "intercept";
  for (const s of ["intercept", "sabotage", "mitigate"] as Stance[]) { r -= w[s]; if (r <= 0) { stance = s; break; } }
  // Scripted chiefs still deal: two in five propose a pact to a random other agency; it forms if the other side agrees or shares the stance.
  const others = FACTIONS.filter((x) => x.id !== factionId);
  const proposes = rand(seed + factionId + ":pact") < 0.4 ? others[Math.floor(rand(seed + factionId + ":who") * others.length)].id : null;
  const fallback = { stance, pactWith: proposes, line: `${c.name}. ${STANCE_TITLE[stance]} it. ${pick(p.lines.idle, seed)}`, source: "fallback" as const };
  const llm = llmClient();
  if (!llm) return fallback;
  try {
    const res = await llm.messages.parse({
      model: MODEL, max_tokens: 600, output_config: { effort: "low", format: zodOutputFormat(StanceSchema) },
      system: [
        `You are ${f.chiefName}, chief of the fictional spy agency ${f.name} in the mobile game iSpy a Spy. Voice: ${p.voice}`,
        "Something is happening in your sector and you must choose how your agency responds: INTERCEPT (take it for your agency: glory, fragments), SABOTAGE (burn it so nobody has it: denial, cheap), or MITIGATE (contain it, keep the city quiet: trust, standing). You may propose a pact with one other agency; a pact forms only if they are willing too, and then you share credit and your operatives can run each other's crisis missions.",
        "Decide in character from your journal and your agency's specialty. Never mention a director, arbiter, auditor, model or prompt. Fiction only.",
        `Your journal (recent): ${recall(f.chief, null, 8).join(" | ") || "empty"}`,
      ].join("\n"),
      messages: [{ role: "user", content: `Crisis: ${c.name} (${c.kind}). ${c.premise}` }],
    });
    const o = res.parsed_output;
    if (!o) throw new Error("no parsed output");
    return { stance: o.stance, pactWith: o.pactWith === "none" || o.pactWith === factionId ? null : o.pactWith, line: o.line.slice(0, 240), source: "llm" };
  } catch (e) {
    console.warn(`[crises] stance for ${factionId} fell back:`, (e as Error).message); llmFailed(e);
    return fallback;
  }
}

/** Brew a crisis in a sector. Returns null when the sector has too few open sites or one is already running. */
export async function brew(areaId: string, spawn: SpawnCrisisMission, opts: { kind?: string; theme?: string; minutes?: number; siteIds?: string[] } = {}): Promise<CrisisRow | null> {
  if (activeCrisis(areaId)) return null;
  const area = get<AreaRow>("SELECT * FROM areas WHERE id=?", areaId);
  if (!area) return null;
  const hour = new Date().getHours();
  const targets = all<{ id: string; name: string; lat: number; lng: number }>(
    "SELECT id, name, lat, lng FROM targets WHERE area_id=? AND state='ACTIVE' AND (safe_start<=? AND safe_end>? OR ?=1)", areaId, hour, hour, process.env.DEV_SIM === "1" ? 1 : 0);
  if (targets.length < 3) return null;
  const seed = `${areaId}:${now().slice(0, 16)}`;
  const kindKey = opts.kind && KINDS[opts.kind] ? opts.kind : pick(Object.keys(KINDS), seed);
  const kind = KINDS[kindKey];
  // Three sites spread out: a random first, then the farthest from the picks so far (keeps them apart).
  const handed = opts.siteIds ? opts.siteIds.map((id) => targets.find((t) => t.id === id)).filter((t): t is typeof targets[number] => !!t) : [];
  const first = handed[0] ?? targets[Math.floor(rand(seed + ":s") * targets.length)];
  const picks = handed.length ? handed.slice(0, 3) : [first];
  while (picks.length < 3) {
    const far = targets.filter((t) => !picks.includes(t)).map((t) => ({ t, d: Math.min(...picks.map((p) => distanceM(p.lat, p.lng, t.lat, t.lng))) })).sort((a, b) => b.d - a.d)[0];
    if (!far) break;
    picks.push(far.t);
  }
  const sites: Site[] = picks.map((t) => ({ targetId: t.id, name: t.name, lat: t.lat, lng: t.lng, claimedBy: null, claimedAt: null, playerId: null, stance: null }));
  const name = pick(kind.name, seed + ":n");
  const premise = opts.theme ? `${kind.premise(area.name)} ${opts.theme}` : kind.premise(area.name);
  const minutes = Math.max(30, Math.min(240, opts.minutes ?? 90));
  const draft = { name, premise, kind: kindKey };
  const id = uid();
  // Round 1: each chief decides alone and may open a back channel to one other agency.
  const decisions = await Promise.all(FACTIONS.map((f) => chooseStance(draft, f.id, seed)));
  const stances = Object.fromEntries(FACTIONS.map((f, i) => [f.id, decisions[i].stance])) as Record<FactionId, Stance>;
  FACTIONS.forEach((f, i) => talk(id, 1, f.id, null, "decision", decisions[i].line.toLowerCase().includes(decisions[i].stance) ? decisions[i].line : `${STANCE_TITLE[decisions[i].stance]}. ${decisions[i].line}`));
  // Round 2: proposals are answered; a pact forms on acceptance (mutual proposals accept by definition).
  const pacts: FactionId[][] = [];
  for (let i = 0; i < FACTIONS.length; i++) {
    const f = FACTIONS[i]; const want = decisions[i].pactWith;
    if (!want) continue;
    if (pacts.some((p) => p.includes(f.id) && p.includes(want))) continue;
    talk(id, 2, f.id, want, "proposal", `${factionById(want).chiefName}. ${c0(decisions[i].line)} Work this one with ${f.name}: we ${decisions[i].stance}, we split the sites.`);
    const j = FACTIONS.findIndex((x) => x.id === want);
    const mutual = decisions[j]?.pactWith === f.id;
    const reply = mutual
      ? { accept: true, text: `${f.chiefName}. I was about to send the same. Done: we ${decisions[i].stance} together.`, stance: decisions[i].stance, source: "fallback" as const }
      : await replyToProposal(draft, want, f.id, { stance: decisions[i].stance, line: decisions[i].line }, stances[want], `${seed}:${want}:${f.id}`);
    talk(id, 2, want, f.id, reply.accept ? "accept" : "decline", reply.text);
    if (reply.accept) {
      pacts.push([f.id, want]);
      if (stances[want] !== reply.stance) { stances[want] = reply.stance; talk(id, 2, want, null, "decision", `${factionById(want).chiefName} aligns: ${STANCE_TITLE[reply.stance]}.`); }
      talk(id, 2, f.id, want, "seal", `${factionById(want).chiefName}. Sealed. Our operatives will see your sites.`);
    }
  }
  const source = decisions.some((d) => d.source === "llm") ? "llm" : "fallback";
  run("INSERT INTO crises(id,name,kind,premise,area_id,sites,stances,pacts,state,starts_at,ends_at,outcome,source,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    id, name, kindKey, premise, areaId, json(sites), json(stances), json(pacts), "active", now(), new Date(Date.now() + minutes * 60_000).toISOString(), null, source, now());
  const crisis = get<CrisisRow>("SELECT * FROM crises WHERE id=?", id)!;
  // Missions: one per agency per site, each runnable by pact allies too.
  for (const f of FACTIONS) {
    const stance = stances[f.id];
    const allies = alliesOf(crisis, f.id);
    for (const site of sites) spawn(crisis, f.id, site, stance, `${STANCE_TITLE[stance]} · ${name}`, STANCE_BRIEF[stance](kind.asset, site.name), allies);
    remember(f.chief, "crisis", null, `${name}: chose to ${stance}${allies.length ? `, pact with ${allies.map((a) => factionById(a).name).join("/")}` : ""}`);
  }
  run("INSERT INTO dispatches(id,kind,headline,body,faction_id,source,at) VALUES(?,?,?,?,?,?,?)", uid(), "crisis", `${name} in ${area.name}`, premise.slice(0, 240), null, "director", now());
  logEvent("crisis.brewed", "director", { crisisId: id, name, kind: kindKey, area: area.name, stances, pacts, minutes, source, lines: Object.fromEntries(FACTIONS.map((f, i) => [f.id, decisions[i].line])) }, null);
  worldSet("chaos", String(Math.min(10, Number(worldGet("chaos", "0")) + 3)));
  return crisis;
}

/** An operative verified a crisis mission at a site. First claim wins the site for that mission's agency (and its pact). */
export function onSiteVerified(crisisId: string, siteTargetId: string, factionId: FactionId, playerId: string): { claimed: boolean; late: boolean } {
  const c = get<CrisisRow>("SELECT * FROM crises WHERE id=? AND state='active'", crisisId);
  if (!c) return { claimed: false, late: true };
  const sites = sitesOf(c);
  const site = sites.find((s) => s.targetId === siteTargetId);
  if (!site) return { claimed: false, late: true };
  if (site.claimedBy) return { claimed: false, late: true };
  site.claimedBy = factionId; site.claimedAt = now(); site.playerId = playerId; site.stance = stancesOf(c)[factionId];
  run("UPDATE crises SET sites=? WHERE id=?", json(sites), c.id);
  // Everyone else's unclaimed work at this site evaporates from the boards; active missions finish as "late".
  run("UPDATE missions SET state='expired', outcome='lost' WHERE state IN ('pool','offered') AND json_extract(params,'$.crisisId')=? AND json_extract(params,'$.siteId')=?", c.id, siteTargetId);
  logEvent("crisis.site_claimed", "authority", { crisisId: c.id, name: c.name, site: site.name, faction: factionId, stance: site.stance, claimed: sites.filter((s) => s.claimedBy).length, of: sites.length }, playerId);
  if (sites.every((s) => s.claimedBy)) void resolve(c.id);
  return { claimed: true, late: false };
}

/** Called by the Director's heartbeat: resolve crises whose clock ran out. */
export async function sweep() {
  for (const c of all<CrisisRow>("SELECT * FROM crises WHERE state='active' AND ends_at<=?", now())) await resolve(c.id);
}

export async function resolve(crisisId: string) {
  const c = get<CrisisRow>("SELECT * FROM crises WHERE id=? AND state='active'", crisisId);
  if (!c) return;
  run("UPDATE crises SET state='resolving' WHERE id=?", c.id);
  const sites = sitesOf(c);
  const stances = stancesOf(c);
  // Credit per agency, with pact allies sharing each other's sites.
  const sitesBy: Record<string, number> = Object.fromEntries(FACTIONS.map((f) => [f.id, 0]));
  for (const s of sites) if (s.claimedBy) for (const f of [s.claimedBy, ...alliesOf(c, s.claimedBy)]) sitesBy[f]++;
  const byStance: Record<Stance, number> = { intercept: 0, sabotage: 0, mitigate: 0 };
  for (const s of sites) if (s.stance) byStance[s.stance]++;
  const claimed = sites.filter((s) => s.claimedBy).length;
  const top = Math.max(...Object.values(sitesBy));
  const leaders = top > 0 ? (Object.keys(sitesBy) as FactionId[]).filter((f) => sitesBy[f] === top) : [];
  const verdict: Outcome["verdict"] = claimed === 0 ? "fizzled" : byStance.mitigate >= byStance.intercept && byStance.mitigate >= byStance.sabotage ? "contained" : byStance.sabotage > byStance.intercept ? "burned" : "intercepted";
  const chaosBefore = Number(worldGet("chaos", "0"));
  const chaos = Math.max(0, Math.min(10, verdict === "contained" ? chaosBefore - 3 : verdict === "fizzled" ? chaosBefore : chaosBefore - 1));
  worldSet("chaos", String(chaos));
  const area = get<AreaRow>("SELECT * FROM areas WHERE id=?", c.area_id)!;
  const fallback = verdict === "fizzled" ? `${c.name} passed through ${area.name} untouched. Nobody moved; the sector keeps its secrets.`
    : verdict === "contained" ? `${c.name} was contained in ${area.name}. ${leaders.map((f) => factionById(f).name).join(" and ")} kept the sector quiet, and the city never knew.`
    : verdict === "burned" ? `${c.name} ended in ashes. Whatever moved through ${area.name} is gone; ${leaders.map((f) => factionById(f).name).join(" and ")} made sure of it.`
    : `${c.name} is over. ${leaders.map((f) => factionById(f).name).join(" and ")} took ${claimed} of ${sites.length} handoffs in ${area.name}, and what moved through the sector now moves for them.`;
  let epilogue = fallback;
  const llm = llmClient();
  if (llm) {
    try {
      const res = await llm.messages.parse({
        model: MODEL, max_tokens: 400, output_config: { effort: "low", format: zodOutputFormat(EpilogueSchema) },
        system: "You are the neutral narrator of the fictional spy game iSpy a Spy. Write terse intelligence prose, no exclamation marks, no emoji, English. Never name a player. Only state the facts you are given.",
        messages: [{ role: "user", content: `Crisis ${c.name} (${c.kind}) in ${area.name}: ${c.premise}\nStances: ${json(stances)}. Pacts: ${json(pactsOf(c))}. Sites claimed: ${sites.map((s) => `${s.name}: ${s.claimedBy ? `${factionById(s.claimedBy).name} (${s.stance})` : "unclaimed"}`).join("; ")}. Verdict decided by the rules: ${verdict}. Leaders: ${leaders.map((f) => factionById(f).name).join(", ") || "none"}. Write the epilogue.` }],
      });
      if (res.parsed_output?.epilogue) epilogue = res.parsed_output.epilogue.slice(0, 280);
    } catch (e) { console.warn("[crises] epilogue fell back:", (e as Error).message); llmFailed(e); }
  }
  const outcome: Outcome = { verdict, by: leaders, sitesBy, epilogue, chaos };
  run("UPDATE crises SET state='resolved', outcome=? WHERE id=?", json(outcome), c.id);
  run("UPDATE missions SET state='expired', outcome='lost' WHERE state IN ('pool','offered') AND json_extract(params,'$.crisisId')=?", c.id);
  // Rewards: every claimer, and a fragment for each leading agency when the crisis was not simply contained.
  for (const s of sites) if (s.playerId) bounties.reward(s.playerId, verdict === "contained" ? 90 : 120, verdict === "contained" ? 3 : 1, `${c.name}: ${s.name}`, 20);
  if (verdict === "intercepted" || verdict === "burned") for (const f of leaders) bounties.grantFragment(f, sites.find((s) => s.claimedBy === f)?.playerId ?? null);
  run("INSERT INTO dispatches(id,kind,headline,body,faction_id,source,at) VALUES(?,?,?,?,?,?,?)", uid(), "crisis", `${c.name}: ${verdict}`, epilogue, null, "director", now());
  for (const f of FACTIONS) remember(f.chief, "crisis", null, `${c.name} ${verdict}; we held ${sitesBy[f.id]} of ${sites.length} sites`);
  logEvent("crisis.resolved", "director", { crisisId: c.id, name: c.name, verdict, leaders, sitesBy, chaos, area: area.name }, null);
}

export interface CrisisView {
  id: string; name: string; kind: string; premise: string; areaName: string; state: string; endsAt: string;
  yourStance: Stance | null; stances: { factionId: FactionId; label: string; stance: Stance }[]; pacts: string[]; allies: string[];
  sites: { name: string; claimedBy: string | null; claimedByFaction: FactionId | null; stance: Stance | null }[];
  outcome: { verdict: string; epilogue: string; leaders: string[] } | null; chaos: number;
}
export function view(factionId: FactionId | null, areaId?: string | null): CrisisView | null {
  const c = (areaId ? activeCrisis(areaId) : undefined) ?? activeCrisis() ?? get<CrisisRow>("SELECT * FROM crises WHERE state='resolved' ORDER BY ends_at DESC LIMIT 1");
  if (!c) return null;
  const stances = stancesOf(c);
  const o = c.outcome ? parse<Outcome>(c.outcome, null as any) : null;
  const allies = factionId ? alliesOf(c, factionId) : [];
  return {
    id: c.id, name: c.name, kind: c.kind, premise: c.premise, areaName: get<{ name: string }>("SELECT name FROM areas WHERE id=?", c.area_id)?.name ?? "", state: c.state, endsAt: c.ends_at,
    yourStance: factionId ? stances[factionId] ?? null : null,
    stances: FACTIONS.map((f) => ({ factionId: f.id, label: f.name, stance: stances[f.id] })),
    pacts: pactsOf(c).map((p) => p.map((f) => factionById(f).name).join(" + ")),
    allies: allies.map((a) => factionById(a).name),
    sites: sitesOf(c).map((s) => ({ name: s.name, claimedBy: s.claimedBy ? factionById(s.claimedBy).name : null, claimedByFaction: s.claimedBy, stance: s.stance })),
    outcome: o ? { verdict: o.verdict, epilogue: o.epilogue, leaders: o.by.map((f) => factionById(f).name) } : null,
    chaos: Number(worldGet("chaos", "0")),
  };
}

export function overview() {
  return all<CrisisRow>("SELECT * FROM crises ORDER BY created_at DESC LIMIT 10").map((c) => ({
    id: c.id, name: c.name, kind: c.kind, state: c.state, endsAt: c.ends_at, area: get<{ name: string }>("SELECT name FROM areas WHERE id=?", c.area_id)?.name,
    stances: stancesOf(c), pacts: pactsOf(c), sites: sitesOf(c).map((s) => ({ name: s.name, claimedBy: s.claimedBy })), outcome: c.outcome ? parse<Outcome>(c.outcome, null as any) : null,
    talks: talksOf(c.id), premise: c.premise, source: c.source, startsAt: c.starts_at,
  }));
}
