import type { FactionId } from "@ispy/shared";
import { all, get, run, now, uid, json, logEvent } from "./db.ts";
import { FACTIONS, factionById } from "./content.ts";
import { rand } from "./puzzles.ts";
import { param, setParam } from "./params.ts";
import { refreshPlans } from "./engine.ts";
import { currentEvent } from "./bounties.ts";

/**
 * The strategy room of the World Director: operational intelligence and game theory.
 *
 * It reads the board as a three-player game and keeps it interesting:
 *  - power is measured, and a runaway leader attracts counter-pressure (contracts against them,
 *    intelligence on their habits handed to rivals), so dominance is costly and comebacks are possible;
 *  - a tight campaign gets more encounters, not fewer, so the decisive moments happen face to face;
 *  - each chief's observable pattern (what they concentrate on, where) is turned into a coarse
 *    assessment for the other chiefs, so exploiting a predictable rival is always an option;
 *  - moves are randomised (mixed strategy) so no chief can learn the Director's rule and farm it.
 * It never touches outcomes: it changes incentives and information, within the same bounds as everything else.
 */
export interface FactionAssessment {
  factionId: FactionId; name: string; power: number; activeAgents: number; verifiedHour: number;
  contestsWon: number; contestsLost: number; fragments: number; dominantTemplate: string | null; dominantShare: number; busiestArea: string | null;
}
export interface Assessment { factions: FactionAssessment[]; leader: FactionAssessment; trailer: FactionAssessment; gap: number; campaignTight: boolean; campaignRunaway: boolean }

export function assess(): Assessment {
  const since1h = new Date(Date.now() - 3600_000).toISOString();
  const since2h = new Date(Date.now() - 2 * 3600_000).toISOString();
  const ev = currentEvent();
  const factions = FACTIONS.map<FactionAssessment>((f) => {
    const activeAgents = get<{ n: number }>("SELECT COUNT(*) n FROM presence p JOIN players pl ON pl.id=p.player_id WHERE pl.faction_id=? AND p.expires_at>?", f.id, now())!.n;
    const verifiedHour = get<{ n: number }>("SELECT COUNT(*) n FROM missions WHERE faction_id=? AND state='completed' AND completed_at>?", f.id, since1h)!.n;
    const contestsWon = get<{ n: number }>("SELECT COUNT(*) n FROM missions WHERE faction_id=? AND outcome='won' AND completed_at>?", f.id, since2h)!.n;
    const contestsLost = get<{ n: number }>("SELECT COUNT(*) n FROM missions WHERE faction_id=? AND outcome='lost' AND completed_at>?", f.id, since2h)!.n;
    const fragments = ev?.progress.find((p) => p.factionId === f.id)?.fragments ?? 0;
    const mix = all<{ t: string; n: number }>("SELECT template_id t, COUNT(*) n FROM missions WHERE faction_id=? AND state='completed' AND completed_at>? GROUP BY template_id ORDER BY n DESC", f.id, since2h);
    const total = mix.reduce((s, m) => s + m.n, 0);
    const area = get<{ name: string }>("SELECT a.name FROM missions m JOIN areas a ON a.id=m.area_id WHERE m.faction_id=? AND m.completed_at>? GROUP BY a.id ORDER BY COUNT(*) DESC LIMIT 1", f.id, since2h);
    return {
      factionId: f.id, name: f.name, activeAgents, verifiedHour, contestsWon, contestsLost, fragments,
      dominantTemplate: total >= 3 ? mix[0].t : null, dominantShare: total ? mix[0]?.n / total : 0, busiestArea: area?.name ?? null,
      power: 0,
    };
  });
  // Power: a blend of tempo, campaign standing and contest record, normalised so the sum is 1.
  const raw = factions.map((f) => 1 + f.verifiedHour * 1.0 + f.fragments * 1.5 + (f.contestsWon - f.contestsLost) * 1.2 + f.activeAgents * 0.3);
  const sum = raw.reduce((a, b) => a + b, 0);
  factions.forEach((f, i) => { f.power = Math.round((raw[i] / sum) * 100) / 100; });
  const sorted = [...factions].sort((a, b) => b.power - a.power);
  const leader = sorted[0], trailer = sorted[sorted.length - 1];
  const frags = factions.map((f) => f.fragments).sort((a, b) => b - a);
  const of = ev?.progress[0]?.of ?? 5;
  return {
    factions, leader, trailer, gap: Math.round((leader.power - trailer.power) * 100) / 100,
    campaignTight: !!ev && ev.state === "active" && frags[0] > 0 && frags[0] - frags[1] <= 1 && frags[0] >= of - 2,
    campaignRunaway: !!ev && ev.state === "active" && frags[0] - frags[1] >= 2 && frags[0] < of,
  };
}

export interface Move { kind: string; detail: string; targets?: FactionId[] }

/** Decide and apply this cycle's strategic moves. Returns what was done, for the Director's log. */
export async function play(seedKey: string): Promise<{ assessment: Assessment; moves: Move[] }> {
  const a = assess();
  const moves: Move[] = [];
  const roll = (k: string) => rand(seedKey + ":" + k);
  const rivalsOf = (id: FactionId) => FACTIONS.filter((f) => f.id !== id).map((f) => f.id);

  // 1. Counter-pressure on a runaway leader: contracts against them, offered to the others. Mixed strategy: 70%.
  if (a.gap >= 0.3 && a.leader.verifiedHour >= 2 && roll("counter") < 0.7) {
    const open = get("SELECT 1 FROM bounties WHERE state='open' AND type='COUNTERINTEL' AND json_extract(criteria,'$.against')=?", a.leader.factionId);
    if (!open) {
      for (const fid of rivalsOf(a.leader.factionId)) {
        run(`INSERT INTO bounties(id,issuer,faction_id,title,type,brief,reward_xp,reward_credits,squad,min_rank,criteria,state,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          uid(), factionById(fid).chief, fid, `Check ${a.leader.name}`, "COUNTERINTEL",
          `${a.leader.name} is running the sector${a.leader.busiestArea ? ` from ${a.leader.busiestArea}` : ""}. Beat them to one contested target and the balance shifts.`,
          360, 110, 0, "recruit", json({ contestWon: true, count: 1, against: a.leader.factionId }), "open", new Date(Date.now() + 6 * 3600_000).toISOString(), now());
      }
      moves.push({ kind: "counter-pressure", detail: `contracts against ${a.leader.name} offered to the other agencies`, targets: rivalsOf(a.leader.factionId) });
    }
  }

  // 2. Operational intelligence: a predictable leader gets read out to the rivals' chiefs.
  if (a.leader.dominantTemplate && a.leader.dominantShare >= 0.5 && roll("intel") < 0.8) {
    const what = a.leader.dominantTemplate.toLowerCase().replace("_", " ");
    for (const fid of rivalsOf(a.leader.factionId)) {
      await refreshPlans(true, { factionId: fid, reason: `${a.leader.name} is concentrating on ${what} missions${a.leader.busiestArea ? ` around ${a.leader.busiestArea}` : ""} and winning; position to intercept, and do not mirror their mix` });
    }
    moves.push({ kind: "intelligence briefing", detail: `rival chiefs told that ${a.leader.name} concentrates on ${what}`, targets: rivalsOf(a.leader.factionId) });
  }

  // 3. Tension: a tight campaign gets more encounters; a runaway one gets the underdogs a cheaper path.
  if (a.campaignTight) {
    const v = setParam("contestAppetiteBoost", param("contestAppetiteBoost") + 0.15, "director", "campaign is tight; make the last fragments contested");
    if (v != null) moves.push({ kind: "raise encounters", detail: `contest appetite boost → ${v}` });
  } else if (a.campaignRunaway) {
    const v = setParam("rewardMultiplier", Math.max(param("rewardMultiplier"), 1.2), "director", "campaign runaway; sweeten the chase for everyone still in it");
    if (v != null) moves.push({ kind: "sweeten the chase", detail: `reward multiplier → ${v}` });
  }

  // 4. Keep the trailer in the game: if they have agents deployed and nothing to show, their chief is told exactly where the gap is.
  if (a.trailer.activeAgents > 0 && a.trailer.verifiedHour === 0 && a.leader.verifiedHour >= 2 && roll("trailer") < 0.6) {
    await refreshPlans(true, { factionId: a.trailer.factionId, reason: `your agency has verified nothing this hour while ${a.leader.name} verified ${a.leader.verifiedHour}; pick short, certain missions and one contested target` });
    moves.push({ kind: "rally the trailer", detail: `${a.trailer.name}'s chief replanned for quick wins`, targets: [a.trailer.factionId] });
  }

  if (moves.length) logEvent("director.strategy", "director", { leader: a.leader.factionId, gap: a.gap, moves }, null);
  return { assessment: a, moves };
}
