import { get, run, logEvent } from "./db.ts";
import { RANKS } from "./content.ts";

export function rankFor(xp: number) {
  let r: (typeof RANKS)[number] = RANKS[1];
  for (const x of RANKS) if (x.rank !== "civilian" && xp >= x.at) r = x;
  return r;
}
export const rankIndex = (rank: string) => Math.max(0, RANKS.findIndex((r) => r.rank === rank));

/** The only place XP, trust and credits change. Logs the reward and any promotion. */
export function award(playerId: string, xp: number, trust: number, why: string, credits = 0) {
  const before = get<{ xp: number }>("SELECT xp FROM players WHERE id=?", playerId)!;
  run("UPDATE players SET xp = xp + ?, trust = MIN(100, MAX(0, trust + ?)), credits = MAX(0, credits + ?) WHERE id=?", xp, trust, credits, playerId);
  const after = get<{ xp: number }>("SELECT xp FROM players WHERE id=?", playerId)!;
  logEvent("reward", "authority", { xp, trust, credits, why }, playerId);
  const b = rankFor(before.xp).rank, a = rankFor(after.xp).rank;
  if (a !== b) logEvent("rank_up", "authority", { from: b, to: a }, playerId);
}
