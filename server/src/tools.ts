import type { FactionId } from "@ispy/shared";
import { all, get, run, now, uid, json, parse, logEvent, db } from "./db.ts";
import { award } from "./rewards.ts";

/**
 * The operative's toolkit. Tools are intelligence aids, not answer machines: a cipher kit of reference
 * tables, a key that names the system's secret, a lens that gives a foothold on a site's question, a
 * jammer that hides you from rivals, a tracker that extends your scope, a decoy that spoils a rival's
 * scan, a burner that re-deals your orders. Consumables come from caches (fragments, decoys, jammers,
 * lenses) and from crafting with fragments. The human decides when a tool is worth spending.
 */
db.exec(`CREATE TABLE IF NOT EXISTS effects (
  player_id TEXT NOT NULL, kind TEXT NOT NULL, until TEXT NOT NULL, at TEXT NOT NULL, PRIMARY KEY(player_id, kind)
)`);
db.exec(`CREATE TABLE IF NOT EXISTS decoys (
  id TEXT PRIMARY KEY, target_id TEXT NOT NULL, player_id TEXT NOT NULL, faction_id TEXT NOT NULL, until TEXT NOT NULL, at TEXT NOT NULL, sprung_by TEXT
)`);

export type ToolId = "cipher_kit" | "key" | "lens" | "jammer" | "tracker" | "decoy" | "burner" | "fragment";
export interface ToolDef { id: ToolId; name: string; permanent: boolean; craft: number | null; blurb: string; use: string }
export const TOOLS: ToolDef[] = [
  { id: "cipher_kit", name: "Cipher kit", permanent: true, craft: null, blurb: "Reference tables an analyst keeps in their head: Morse, Polybius, letter indices, the mirror alphabet.", use: "Open it on the intel desk while you work an intercept." },
  { id: "fragment", name: "Cipher fragment", permanent: false, craft: null, blurb: "Pieces of other people's keys. Spin caches to collect them; spend them to craft.", use: "Craft a key (3), a tracker (2) or a burner (1)." },
  { id: "key", name: "Key", permanent: false, craft: 3, blurb: "Names the secret of the intercept in front of you: the shift, the keyword, the rails.", use: "On the intel desk, with an intercept open. You still do the decoding." },
  { id: "lens", name: "Lens", permanent: false, craft: null, blurb: "A foothold on a site's observation question: the shape of the answer, not the answer.", use: "On site, with a recon that asks a question." },
  { id: "jammer", name: "Jammer", permanent: false, craft: null, blurb: "Drops you off every rival's scope for an hour. They cannot see your blip; face-offs still happen if they stumble on you.", use: "Anywhere in the field." },
  { id: "tracker", name: "Tracker", permanent: false, craft: 2, blurb: "Widens your scope to 1.5 km for fifteen minutes: every signal in range, with its fade time.", use: "Anywhere in the field." },
  { id: "decoy", name: "Decoy", permanent: false, craft: null, blurb: "Planted at a site you have finished, it spoils the next rival scan there for thirty minutes and pays you when it springs.", use: "On site, right after you verify." },
  { id: "burner", name: "Burner", permanent: false, craft: 1, blurb: "Re-deals your orders: the chief hands you a fresh pair now.", use: "On the map, when the board is not worth walking." },
];
const CRAFT_COST = Object.fromEntries(TOOLS.filter((t) => t.craft).map((t) => [t.id, t.craft!])) as Record<string, number>;
const JAMMER_MS = 60 * 60_000, TRACKER_MS = 15 * 60_000, DECOY_MS = 30 * 60_000;

export const inventoryOf = (playerId: string) => parse<Record<string, number>>(get<{ items: string }>("SELECT items FROM players WHERE id=?", playerId)?.items, {});
const saveInventory = (playerId: string, inv: Record<string, number>) => run("UPDATE players SET items=? WHERE id=?", json(inv), playerId);
const spend = (playerId: string, id: string, n = 1): boolean => { const inv = inventoryOf(playerId); if ((inv[id] ?? 0) < n) return false; inv[id] -= n; saveInventory(playerId, inv); return true; };

export function activeEffect(playerId: string, kind: string): string | null {
  return get<{ until: string }>("SELECT until FROM effects WHERE player_id=? AND kind=? AND until>?", playerId, kind, now())?.until ?? null;
}
export const jammed = (playerId: string) => !!activeEffect(playerId, "jammer");
export const trackerRangeM = (playerId: string) => (activeEffect(playerId, "tracker") ? 1500 : 700);

export interface ToolkitView { tools: (ToolDef & { qty: number })[]; effects: { kind: string; until: string }[]; fragments: number }
export function toolkitOf(playerId: string): ToolkitView {
  const inv = inventoryOf(playerId);
  return {
    tools: TOOLS.map((t) => ({ ...t, qty: t.permanent ? 1 : inv[t.id] ?? 0 })),
    effects: all<{ kind: string; until: string }>("SELECT kind, until FROM effects WHERE player_id=? AND until>?", playerId, now()),
    fragments: inv.fragment ?? 0,
  };
}

export function craft(playerId: string, tool: string): { ok: boolean; reason?: string; qty?: number } {
  const cost = CRAFT_COST[tool];
  if (!cost) return { ok: false, reason: "That is not something you craft." };
  const inv = inventoryOf(playerId);
  if ((inv.fragment ?? 0) < cost) return { ok: false, reason: `Needs ${cost} cipher fragments; you have ${inv.fragment ?? 0}. Spin caches.` };
  inv.fragment -= cost; inv[tool] = (inv[tool] ?? 0) + 1; saveInventory(playerId, inv);
  logEvent("tool.crafted", "player", { tool, cost }, playerId);
  return { ok: true, qty: inv[tool] };
}

export interface UseResult { ok: boolean; reason?: string; hint?: string; until?: string; detail?: string }

/** The key: names the system's secret for the desk intercept in front of you. The decoding stays yours. */
export function useKey(playerId: string, missionId: string): UseResult {
  const m = get<{ params: string }>("SELECT params FROM missions WHERE id=? AND assignee_id=? AND mode='desk' AND state='active'", missionId, playerId);
  if (!m) return { ok: false, reason: "No intercept open." };
  const pz = parse<any>(m.params, {}).puzzle;
  if (!pz) return { ok: false, reason: "Nothing to key." };
  if (!spend(playerId, "key")) return { ok: false, reason: "No key. Craft one from three fragments." };
  const sys: string = pz.system ?? "";
  const prompt: string = pz.prompt ?? "";
  let hint: string;
  if (/Caesar/i.test(sys)) { const a = (pz.answer as string).replace(/[^A-Z]/g, "")[0]; const c = prompt.split("\n\n")[1]?.replace(/[^A-Z]/g, "")[0]; hint = a && c ? `Shift ${(c.charCodeAt(0) - a.charCodeAt(0) + 26) % 26}: move every letter back that far.` : "A single shift; count back from the first letter."; }
  else if (/Vigen/i.test(sys)) hint = `The key is in the prompt; the message has ${(pz.answer as string).split(" ").length} words and starts with ${(pz.answer as string).slice(0, 3)}.`;
  else if (/rail/i.test(sys)) hint = `Three rails, ${(pz.answer as string).length} letters; the first rail holds ${Math.ceil((pz.answer as string).length / 4)} of them.`;
  else if (/keyword/i.test(sys)) hint = `The plaintext is ${(pz.answer as string).length} characters; its last word begins with ${(pz.answer as string).split(" ").slice(-1)[0][0]}.`;
  else if (/analysis/i.test(pz.kind)) hint = `It is not ${(pz.options as string[]).find((o) => o !== pz.answer)}.`;
  else hint = `${(pz.answer as string).length} characters, first letter ${(pz.answer as string)[0]}.`;
  logEvent("tool.used", "player", { tool: "key", missionId }, playerId);
  return { ok: true, hint };
}

/** The lens: a foothold on the site's observation question, for a recon you are on. */
export function useLens(playerId: string, missionId: string): UseResult {
  const m = get<{ target_id: string | null; template_id: string }>("SELECT target_id, template_id FROM missions WHERE id=? AND assignee_id=? AND state='active'", missionId, playerId);
  if (!m?.target_id) return { ok: false, reason: "No site to look at." };
  const t = get<{ observation: string; observation_answer: string }>("SELECT observation, observation_answer FROM targets WHERE id=?", m.target_id)!;
  if (!t.observation_answer) return { ok: false, reason: "This site asks nothing; presence is enough." };
  if (!spend(playerId, "lens")) return { ok: false, reason: "No lens. Caches sometimes hold one." };
  const a = t.observation_answer;
  const shape = a.replace(/[A-Za-z]/g, "·").replace(/\d/g, "#");
  logEvent("tool.used", "player", { tool: "lens", missionId }, playerId);
  return { ok: true, hint: a.length <= 2 ? `${a.length} character${a.length === 1 ? "" : "s"}, pattern ${shape}.` : `${a.length} characters, pattern ${shape}, begins with ${a[0]}.` };
}

export function useJammer(playerId: string): UseResult {
  if (activeEffect(playerId, "jammer")) return { ok: false, reason: "Already jamming." };
  if (!spend(playerId, "jammer")) return { ok: false, reason: "No jammer." };
  const until = new Date(Date.now() + JAMMER_MS).toISOString();
  run("INSERT INTO effects(player_id,kind,until,at) VALUES(?,?,?,?) ON CONFLICT(player_id,kind) DO UPDATE SET until=excluded.until, at=excluded.at", playerId, "jammer", until, now());
  logEvent("tool.used", "player", { tool: "jammer", until }, playerId);
  return { ok: true, until, detail: "Off every rival's scope for an hour." };
}
export function useTracker(playerId: string): UseResult {
  if (activeEffect(playerId, "tracker")) return { ok: false, reason: "Tracker already running." };
  if (!spend(playerId, "tracker")) return { ok: false, reason: "No tracker. Craft one from two fragments." };
  const until = new Date(Date.now() + TRACKER_MS).toISOString();
  run("INSERT INTO effects(player_id,kind,until,at) VALUES(?,?,?,?) ON CONFLICT(player_id,kind) DO UPDATE SET until=excluded.until, at=excluded.at", playerId, "tracker", until, now());
  logEvent("tool.used", "player", { tool: "tracker", until }, playerId);
  return { ok: true, until, detail: "Scope widened to 1.5 km for fifteen minutes." };
}

/** The decoy: planted at a site you hold, it spoils the next rival scan there. */
export function plantDecoy(playerId: string, factionId: FactionId | null, targetId: string, lat: number, lng: number, distanceM: (a: number, b: number, c: number, d: number) => number): UseResult {
  if (!factionId) return { ok: false, reason: "Join an agency first." };
  const t = get<{ lat: number; lng: number; name: string }>("SELECT lat, lng, name FROM targets WHERE id=? AND state='ACTIVE'", targetId);
  if (!t) return { ok: false, reason: "No such site." };
  if (distanceM(lat, lng, t.lat, t.lng) > 45) return { ok: false, reason: "Plant it on site, inside the ring." };
  if (get("SELECT 1 FROM decoys WHERE target_id=? AND until>? AND sprung_by IS NULL", targetId, now())) return { ok: false, reason: "A decoy is already set here." };
  if (!spend(playerId, "decoy")) return { ok: false, reason: "No decoy." };
  const until = new Date(Date.now() + DECOY_MS).toISOString();
  run("INSERT INTO decoys(id,target_id,player_id,faction_id,until,at) VALUES(?,?,?,?,?,?)", uid(), targetId, playerId, factionId, until, now());
  logEvent("tool.used", "player", { tool: "decoy", targetId, target: t.name, until }, playerId);
  return { ok: true, until, detail: `Decoy set at ${t.name} for thirty minutes.` };
}
/** A rival scans a decoyed site: the decoy springs. Returns the planter when it does. */
export function springDecoy(targetId: string, scannerId: string, scannerFaction: FactionId | null): { planter: string; planterFaction: FactionId } | null {
  const d = get<{ id: string; player_id: string; faction_id: FactionId }>("SELECT id, player_id, faction_id FROM decoys WHERE target_id=? AND until>? AND sprung_by IS NULL", targetId, now());
  if (!d || d.player_id === scannerId || d.faction_id === scannerFaction) return null;
  run("UPDATE decoys SET sprung_by=? WHERE id=?", scannerId, d.id);
  award(d.player_id, 40, 1, "decoy sprung", 5);
  logEvent("decoy.sprung", "arbiter", { targetId, by: get<{ codename: string }>("SELECT codename FROM players WHERE id=?", scannerId)?.codename }, d.player_id);
  return { planter: d.player_id, planterFaction: d.faction_id };
}

export function toolsOverview() {
  return {
    usedToday: get<{ n: number }>("SELECT COUNT(*) n FROM events WHERE type='tool.used' AND at>=?", now().slice(0, 10))!.n,
    craftedToday: get<{ n: number }>("SELECT COUNT(*) n FROM events WHERE type='tool.crafted' AND at>=?", now().slice(0, 10))!.n,
    activeJammers: get<{ n: number }>("SELECT COUNT(*) n FROM effects WHERE kind='jammer' AND until>?", now())!.n,
    liveDecoys: get<{ n: number }>("SELECT COUNT(*) n FROM decoys WHERE until>? AND sprung_by IS NULL", now())!.n,
  };
}

/** Package locks: which tool opens what. A lock is chosen at mission creation; the right tool on site opens it. */
export type LockKind = "sealed" | "cipher" | "jammed" | "shadowed";
export const LOCKS: Record<LockKind, { tool: ToolId; label: string; blurb: string }> = {
  sealed: { tool: "lens", label: "Sealed", blurb: "A seal you cannot read by eye. A lens breaks it." },
  cipher: { tool: "key", label: "Cipher-locked", blurb: "A combination in someone else's alphabet. A key opens it." },
  jammed: { tool: "jammer", label: "Jammed", blurb: "Interference on the cache's beacon. A jammer of your own clears it." },
  shadowed: { tool: "tracker", label: "Shadowed", blurb: "The package is not quite where it should be. A tracker finds it." },
};
export function rollLock(seed: number): LockKind | null {
  if (seed < 0.6) return null;
  return seed < 0.72 ? "sealed" : seed < 0.84 ? "cipher" : seed < 0.93 ? "jammed" : "shadowed";
}
export const lockView = (kind: LockKind | null | undefined) => kind ? { kind, tool: LOCKS[kind].tool, label: LOCKS[kind].label } : null;
export const holdsTool = (playerId: string, tool: ToolId) => tool === "cipher_kit" || (inventoryOf(playerId)[tool] ?? 0) > 0;

/** Use a tool on a locked package, on site. The right tool is consumed and the lock opens; the wrong one costs nothing but tells you. */
export function unlockPackage(playerId: string, missionId: string, tool: string, lat: number, lng: number, distanceM: (a: number, b: number, c: number, d: number) => number): { ok: boolean; reason?: string; wrong?: boolean; detail?: string } {
  const m = get<{ id: string; params: string; target_id: string | null; template_id: string }>("SELECT id, params, target_id, template_id FROM missions WHERE id=? AND assignee_id=? AND state='active'", missionId, playerId);
  if (!m) return { ok: false, reason: "No active mission." };
  const params = parse<any>(m.params, {});
  const kind: LockKind | null = params.lock ?? null;
  if (!kind) return { ok: true, detail: "Nothing to open." };
  if (params.unlockedWith) return { ok: true, detail: "Already open." };
  const target = m.template_id === "EXTRACTION" ? params.route?.[params.leg] : m.target_id;
  const t = get<{ lat: number; lng: number; approach_radius_m: number }>("SELECT lat, lng, approach_radius_m FROM targets WHERE id=?", target);
  if (!t) return { ok: false, reason: "No site." };
  if (distanceM(lat, lng, t.lat, t.lng) > t.approach_radius_m) return { ok: false, reason: "Get inside the ring first." };
  const need = LOCKS[kind].tool;
  if (tool !== need) { logEvent("package.wrong_tool", "player", { missionId, lock: kind, tool }, playerId); return { ok: false, wrong: true, reason: `${LOCKS[kind].label}. That is not the tool for it.` }; }
  if (!spend(playerId, need)) return { ok: false, reason: `You need a ${need} for this one.` };
  params.unlockedWith = need;
  run("UPDATE missions SET params=? WHERE id=?", json(params), m.id);
  logEvent("package.unlocked", "player", { missionId, lock: kind, tool: need }, playerId);
  return { ok: true, detail: `${LOCKS[kind].label} package opened with your ${need}.` };
}
