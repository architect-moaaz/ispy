import type { TemplateId, TrustTier, TrustTierId } from "@ispy/shared";
import { all, get, run, logEvent, now, worldGet, worldSet } from "./db.ts";
import { dayKey } from "./clock.ts";
import { H } from "./hooks.ts";

/**
 * The chief's trust, 0 to 100, and what it buys. Trust was a gauge; now it is standing. Every clean
 * verification earns it, every lapse spends it, and the tier you sit in decides how much of the
 * agency's work you see:
 *
 *   inner circle  85+  three orders on the board, +20% XP, two extra walks a day, operations first
 *   trusted       70+  +10% XP, one extra walk a day
 *   cleared       50+  the ordinary agent: two orders, full cap, parcels and operations
 *   watched       35+  one order at a time, no parcels: the chief is counting
 *   suspect       15+  recon only, half the cap, no operations; clean walks count double on the way out
 *   burned        <15  your own chief stops sending orders: the morning wire and the desk until you earn it back
 *
 * Trust above 70 is tied to showing up: three quiet days cost a point. Nothing below 50 drifts back
 * on its own; the way up is the work.
 */
const ALL: TemplateId[] = ["RECON", "DEAD_DROP", "EXTRACTION", "ANALYSIS", "CIPHER"];
interface Tier { id: TrustTierId; min: number; name: string; blurb: string; openOffers: number; xpMult: number; capMult: number; capBonus: number; templates: TemplateId[]; handoffs: boolean; operations: boolean; perks: string[]; limits: string[] }
export const TIERS: Tier[] = [
  { id: "burned", min: 0, name: "Burned", blurb: "Your own chief has stopped sending orders. The morning wire and the desk are all you get until you earn the rest back.", openOffers: 0, xpMult: 0.8, capMult: 0.5, capBonus: 0, templates: [], handoffs: false, operations: false, perks: [], limits: ["No field orders except the morning wire", "XP −20%", "Half the daily cap", "Clean work counts double toward trust"] },
  { id: "suspect", min: 15, name: "Suspect", blurb: "Recon only, half the daily cap, no operations. Every clean walk counts double toward getting out of here.", openOffers: 1, xpMult: 0.9, capMult: 0.5, capBonus: 0, templates: ["RECON", "ANALYSIS", "CIPHER"], handoffs: false, operations: false, perks: ["Clean work counts double toward trust"], limits: ["Recon only in the field", "One order at a time", "No parcels, no operations", "XP −10%", "Half the daily cap"] },
  { id: "watched", min: 35, name: "Watched", blurb: "One order at a time and no parcels. The chief is counting.", openOffers: 1, xpMult: 1, capMult: 1, capBonus: 0, templates: ALL, handoffs: false, operations: true, perks: [], limits: ["One order at a time", "No parcels"] },
  { id: "cleared", min: 50, name: "Cleared", blurb: "An agent in good standing: two orders on the board, the full cap, parcels and operations.", openOffers: 2, xpMult: 1, capMult: 1, capBonus: 0, templates: ALL, handoffs: true, operations: true, perks: ["Parcels and operations"], limits: [] },
  { id: "trusted", min: 70, name: "Trusted", blurb: "The chief leans on you: +10% XP and an extra walk a day. Three quiet days cost a point.", openOffers: 2, xpMult: 1.1, capMult: 1, capBonus: 1, templates: ALL, handoffs: true, operations: true, perks: ["XP +10%", "One extra walk a day"], limits: ["Three quiet days cost a point"] },
  { id: "inner", min: 85, name: "Inner circle", blurb: "Three orders on the board, +20% XP, two extra walks a day, and the chief's operations come to you first.", openOffers: 3, xpMult: 1.2, capMult: 1, capBonus: 2, templates: ALL, handoffs: true, operations: true, perks: ["Three orders on the board", "XP +20%", "Two extra walks a day", "Operations first"], limits: ["Three quiet days cost a point"] },
];
export function tierFor(trust: number): Tier { let t = TIERS[0]; for (const x of TIERS) if (trust >= x.min) t = x; return t; }
export function tierView(trust: number): TrustTier {
  const t = tierFor(trust);
  const next = TIERS[TIERS.indexOf(t) + 1];
  const below = TIERS[TIERS.indexOf(t) - 1];
  return { id: t.id, name: t.name, blurb: t.blurb, min: t.min, nextAt: next?.min ?? null, nextName: next?.name ?? null, dropAt: below ? t.min : null, perks: t.perks, limits: t.limits, openOffers: t.openOffers, xpMult: t.xpMult };
}

/** Clean work counts double on the way out of the bottom two tiers. */
export const recoveryBonus = (trustBefore: number, delta: number) => (delta > 0 && trustBefore < TIERS[2].min ? delta * 2 : delta);

const LINES: Record<"up" | "down", Partial<Record<TrustTierId, string>>> = {
  up: {
    suspect: "You are off the bottom. Recon only, and I am watching every scan, but you are walking again.",
    watched: "Better. One order at a time until I stop counting.",
    cleared: "You are cleared. The board is yours again: two orders, parcels, operations.",
    trusted: "I trust you now, which costs me something to say. Ten percent more on everything, and one more walk a day. Keep showing up.",
    inner: "Inner circle. Three orders on the board, my operations come to you first. Few get here. Fewer stay.",
  },
  down: {
    trusted: "You slipped out of the circle. Two orders, not three. Earn the third back.",
    cleared: "Back to ordinary. I had you higher.",
    watched: "I am watching you now. One order at a time, and no parcels until I stop.",
    suspect: "Recon only. Half the cap. You know why.",
    burned: "I have stopped sending orders. You get the morning wire and the desk, and you will walk every one of them before I believe you again.",
  },
};

/** Called by award() after every trust change: a word from the chief and an event when the tier moves. */
export function onChange(playerId: string, before: number, after: number) {
  const a = tierFor(before), b = tierFor(after);
  if (a.id === b.id) return;
  const dir: "up" | "down" = TIERS.indexOf(b) > TIERS.indexOf(a) ? "up" : "down";
  logEvent("trust.tier", "authority", { from: a.id, to: b.id, trust: after, dir }, playerId);
  const line = LINES[dir][b.id];
  if (line) H.chiefSay(playerId, line, `trust ${dir} to ${b.id}`, true);
}

/** Once a day: trust above 70 is tied to showing up. Three days without a verification cost a point. */
export function sweep() {
  const day = dayKey();
  if (worldGet("trust_decay_day", "") === day) return;
  worldSet("trust_decay_day", day);
  const since = new Date(Date.now() - 3 * 86_400_000).toISOString();
  const quiet = all<{ id: string; trust: number }>(
    "SELECT id, trust FROM players WHERE faction_id IS NOT NULL AND trust>? AND id NOT IN (SELECT assignee_id FROM missions WHERE state='completed' AND completed_at>? AND assignee_id IS NOT NULL) AND id NOT IN (SELECT player_id FROM wires WHERE state='done' AND done_at>?)",
    TIERS[4].min, since, since);
  for (const p of quiet) {
    run("UPDATE players SET trust=trust-1 WHERE id=?", p.id);
    logEvent("reward", "authority", { xp: 0, trust: -1, credits: 0, why: "three quiet days" }, p.id);
    onChange(p.id, p.trust, p.trust - 1);
  }
  if (quiet.length) console.log(`[trust] ${quiet.length} quiet operative(s) lost a point`);
}

export const trustOf = (playerId: string) => get<{ trust: number }>("SELECT trust FROM players WHERE id=?", playerId)?.trust ?? 50;
