import type { BoardResponse, BountyCard, FactionId, GlobalEvent, InventoryItem, Rank } from "@ispy/shared";
import { all, get, run, tx, now, uid, json, parse, logEvent } from "./db.ts";
import { FACTIONS, RANKS, factionById } from "./content.ts";
import { pick, rand } from "./puzzles.ts";
import { award, rankFor, rankIndex } from "./rewards.ts";

/**
 * Bounties are chief-issued contracts with non-cash rewards (XP + intel credits).
 * The global event is seeded by the Director and resolved by the Arbiter on a fixed rule.
 */
interface BountyRow { id: string; issuer: string; faction_id: FactionId | null; title: string; type: string; brief: string; reward_xp: number; reward_credits: number; squad: number; min_rank: Rank; criteria: string; state: string; expires_at: string; created_at: string }
interface ClaimRow { id: string; bounty_id: string; player_id: string; progress: number; state: string; claimed_at: string; completed_at: string | null }
interface EventRow { id: string; name: string; brief: string; state: string; starts_at: string; ends_at: string; ruleset: string; progress: string; resolved: string | null }
type Criteria = { template?: string; mode?: string; contestWon?: boolean; count: number };

class ApiError extends Error { constructor(public status: number, msg: string) { super(msg); } }

const TEMPLATES: { type: string; title: string; brief: string; criteria: Criteria; xp: number; credits: number; squad?: boolean; minRank: Rank; hours: number }[] = [
  { type: "INFILTRATE SECTOR", title: "Walk the rival blocks", brief: "Complete two field missions inside the sector without a rejected scan.", criteria: { mode: "field", count: 2 }, xp: 260, credits: 60, minRank: "recruit", hours: 8 },
  { type: "DECRYPT COMMS", title: "Break three keys", brief: "Analyst work: resolve three cipher intercepts. Field operatives are standing by on them.", criteria: { template: "CIPHER", count: 3 }, xp: 240, credits: 70, minRank: "recruit", hours: 12 },
  { type: "DEAD DROP CHAIN", title: "Clear the drops", brief: "Collect two dead drops before the chain goes cold.", criteria: { template: "DEAD_DROP", count: 2 }, xp: 320, credits: 90, minRank: "recruit", hours: 10 },
  { type: "COUNTERINTEL", title: "Beat them to it", brief: "Win one contested target. Somebody else wants it; get there first.", criteria: { contestWon: true, count: 1 }, xp: 400, credits: 120, minRank: "field_agent", hours: 24 },
  { type: "SQUAD OPERATION", title: "Three legs, three hands", brief: "Squad: between you, complete three extractions. Nobody meets anybody.", criteria: { template: "EXTRACTION", count: 3 }, xp: 650, credits: 200, squad: true, minRank: "field_agent", hours: 26 },
  { type: "RECON SWEEP", title: "Eyes on five sites", brief: "Five reconnaissance missions. Note everything.", criteria: { template: "RECON", count: 5 }, xp: 380, credits: 100, minRank: "recruit", hours: 24 },
];

/** Keep two open bounties per faction plus one open to all. Called from the tick. */
export function refreshBounties() {
  run("UPDATE bounties SET state='expired' WHERE state='open' AND expires_at<=?", now());
  for (const f of [...FACTIONS, null]) {
    const want = f ? 2 : 1;
    const have = get<{ n: number }>("SELECT COUNT(*) n FROM bounties WHERE state='open' AND faction_id IS ?", f?.id ?? null)!.n;
    for (let i = have; i < want; i++) {
      const seed = `${f?.id ?? "all"}:${now()}:${i}`;
      const openTypes = new Set(all<{ type: string }>("SELECT type FROM bounties WHERE state='open' AND faction_id IS ?", f?.id ?? null).map((r) => r.type));
      const t = pick(TEMPLATES.filter((x) => !openTypes.has(x.type)), seed) ?? pick(TEMPLATES, seed);
      const issuer = f ? f.chief : pick(FACTIONS, seed + ":c").chief;
      run(`INSERT INTO bounties(id,issuer,faction_id,title,type,brief,reward_xp,reward_credits,squad,min_rank,criteria,state,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        uid(), issuer, f?.id ?? null, t.title, t.type, t.brief, t.xp, t.credits, t.squad ? 1 : 0, t.minRank, json(t.criteria), "open",
        new Date(Date.now() + t.hours * 3600_000).toISOString(), now());
      logEvent("bounty.published", `chief:${issuer}`, { type: t.type, faction: f?.id ?? "all" }, null);
    }
  }
}

function status(b: BountyRow, claim: ClaimRow | undefined, player: { factionId: FactionId | null; rank: Rank }): BountyCard["status"] {
  if (claim?.state === "completed") return "COMPLETED";
  if (claim) return "ACTIVE";
  if (b.state !== "open" || b.expires_at <= now()) return "EXPIRED";
  if (b.faction_id && b.faction_id !== player.factionId) return "LOCKED";
  if (rankIndex(player.rank) < rankIndex(b.min_rank)) return "LOCKED";
  return "ELIGIBLE";
}

export function board(playerId: string): BoardResponse {
  const p = get<{ faction_id: FactionId | null; xp: number; credits: number; items: string }>("SELECT faction_id, xp, credits, items FROM players WHERE id=?", playerId)!;
  const player = { factionId: p.faction_id, rank: rankFor(p.xp).rank as Rank };
  const rows = all<BountyRow>("SELECT * FROM bounties WHERE (state='open' OR id IN (SELECT bounty_id FROM bounty_claims WHERE player_id=?)) AND (faction_id IS NULL OR faction_id=?) ORDER BY created_at DESC", playerId, p.faction_id);
  const bounties = rows.map<BountyCard>((b) => {
    const claim = get<ClaimRow>("SELECT * FROM bounty_claims WHERE bounty_id=? AND player_id=?", b.id, playerId);
    const crit = parse<Criteria>(b.criteria, { count: 1 });
    return {
      id: b.id, issuer: b.issuer as BountyCard["issuer"], factionId: b.faction_id, title: b.title, type: b.type, brief: b.brief,
      reward: { xp: b.reward_xp, credits: b.reward_credits }, squad: !!b.squad, minRank: b.min_rank,
      status: status(b, claim, player), progress: { done: claim?.progress ?? 0, of: crit.count }, expiresAt: b.expires_at,
    };
  }).filter((b) => b.status !== "EXPIRED" || b.progress.done > 0);
  const items = parse<Record<string, number>>(p.items, {});
  const inventory: InventoryItem[] = [
    { id: "credits", name: "Intel credits", qty: p.credits, note: "Non-cash. Spend on wires, cosmetics and HQ themes." },
    { id: "decoy", name: "Decoy artifact", qty: items.decoy ?? 0, note: "Plant one on a drop to mislead a rival. Earned from bounties." },
    { id: "cover", name: "Cover reset", qty: items.cover ?? 0, note: "Rotate your contact id early." },
  ];
  return { event: currentEvent(), bounties, credits: p.credits, inventory };
}

export function claimBounty(playerId: string, bountyId: string) {
  const b = get<BountyRow>("SELECT * FROM bounties WHERE id=?", bountyId);
  if (!b) throw new ApiError(404, "no such bounty");
  const p = get<{ faction_id: FactionId | null; xp: number }>("SELECT faction_id, xp FROM players WHERE id=?", playerId)!;
  const st = status(b, get<ClaimRow>("SELECT * FROM bounty_claims WHERE bounty_id=? AND player_id=?", b.id, playerId), { factionId: p.faction_id, rank: rankFor(p.xp).rank as Rank });
  if (st !== "ELIGIBLE") throw new ApiError(409, `bounty is ${st.toLowerCase()}`);
  const active = get<{ n: number }>("SELECT COUNT(*) n FROM bounty_claims WHERE player_id=? AND state='active'", playerId)!.n;
  if (active >= 3) throw new ApiError(429, "three contracts at a time");
  run("INSERT INTO bounty_claims(id,bounty_id,player_id,progress,state,claimed_at) VALUES(?,?,?,?,?,?)", uid(), b.id, playerId, 0, "active", now());
  logEvent("bounty.claimed", "player", { bountyId: b.id, title: b.title }, playerId);
}

/** Progress every active claim this mission satisfies; pay out on completion. */
export function onMissionVerified(playerId: string, m: { template_id: string; mode: string; outcome: string | null }) {
  const claims = all<ClaimRow & { criteria: string; title: string; reward_xp: number; reward_credits: number }>(
    "SELECT c.*, b.criteria, b.title, b.reward_xp, b.reward_credits FROM bounty_claims c JOIN bounties b ON b.id=c.bounty_id WHERE c.player_id=? AND c.state='active' AND b.expires_at>?", playerId, now());
  for (const c of claims) {
    const crit = parse<Criteria>(c.criteria, { count: 1 });
    const hit = (crit.template ? crit.template === m.template_id : true) && (crit.mode ? crit.mode === m.mode : true) && (crit.contestWon ? m.outcome === "won" : true);
    if (!hit) continue;
    const progress = c.progress + 1;
    if (progress >= crit.count) {
      run("UPDATE bounty_claims SET progress=?, state='completed', completed_at=? WHERE id=?", progress, now(), c.id);
      award(playerId, c.reward_xp, 2, `Bounty: ${c.title}`, c.reward_credits);
      logEvent("bounty.completed", "authority", { bountyId: c.bounty_id, title: c.title, credits: c.reward_credits }, playerId);
    } else {
      run("UPDATE bounty_claims SET progress=? WHERE id=?", progress, c.id);
    }
  }
  eventProgress(playerId, m);
}

// ---------- global event ----------
const FRAGMENTS = 5;

export function refreshEvent() {
  const active = get<EventRow>("SELECT * FROM world_events WHERE state='active'");
  if (active) { if (active.ends_at <= now()) resolveEvent(active); return; }
  const recent = get<EventRow>("SELECT * FROM world_events WHERE state='resolved' AND ends_at > ?", new Date(Date.now() - 6 * 3600_000).toISOString());
  if (recent) return; // breathing room between campaigns
  const progress = Object.fromEntries(FACTIONS.map((f) => [f.id, 0]));
  run("INSERT INTO world_events(id,name,brief,state,starts_at,ends_at,ruleset,progress) VALUES(?,?,?,?,?,?,?,?)",
    uid(), "OPERATION ECLIPSE", "Five fragments of one encrypted dossier are in play across the sector. Every verified drop or extraction recovers a fragment for your agency. The first to five owns the epilogue.",
    "active", now(), new Date(Date.now() + 24 * 3600_000).toISOString(), json({ fragments: FRAGMENTS, counts: ["DEAD_DROP", "EXTRACTION"] }), json(progress));
  logEvent("world_event.published", "director", { name: "OPERATION ECLIPSE" }, null);
}

function eventProgress(playerId: string, m: { template_id: string }) {
  const ev = get<EventRow>("SELECT * FROM world_events WHERE state='active' AND ends_at>?", now());
  if (!ev) return;
  const rules = parse<{ fragments: number; counts: string[] }>(ev.ruleset, { fragments: FRAGMENTS, counts: [] });
  if (!rules.counts.includes(m.template_id)) return;
  const f = get<{ faction_id: FactionId }>("SELECT faction_id FROM players WHERE id=?", playerId)!.faction_id;
  const progress = parse<Record<string, number>>(ev.progress, {});
  progress[f] = Math.min(rules.fragments, (progress[f] ?? 0) + 1);
  run("UPDATE world_events SET progress=? WHERE id=?", json(progress), ev.id);
  logEvent("world_event.fragment", "authority", { event: ev.name, faction: f, fragments: progress[f] }, playerId);
  if (progress[f] >= rules.fragments) resolveEvent(get<EventRow>("SELECT * FROM world_events WHERE id=?", ev.id)!);
}

/** Fixed rule: most fragments wins; ties go to whoever got there first (lower updated order = earlier). */
function resolveEvent(ev: EventRow) {
  const progress = parse<Record<string, number>>(ev.progress, {});
  const ranked = FACTIONS.map((f) => ({ f, n: progress[f.id] ?? 0 })).sort((a, b) => b.n - a.n);
  const winner = ranked[0].n > 0 ? ranked[0].f : null;
  const epilogue = winner
    ? `${winner.name} reassembled the dossier with ${ranked[0].n} fragment${ranked[0].n === 1 ? "" : "s"}. ${winner.chiefName} sends regards to the other chiefs.`
    : "Nobody recovered a single fragment. The dossier stays encrypted, and the chiefs say nothing.";
  tx(() => {
    run("UPDATE world_events SET state='resolved', resolved=? WHERE id=?", json({ winner: winner?.id ?? null, epilogue }), ev.id);
    if (winner) for (const p of all<{ id: string }>("SELECT id FROM players WHERE faction_id=?", winner.id)) award(p.id, 150, 1, `Campaign won: ${ev.name}`, 40);
    logEvent("world_event.resolved", "arbiter", { name: ev.name, winner: winner?.id ?? null }, null);
  });
}

export function currentEvent(): GlobalEvent | null {
  const ev = get<EventRow>("SELECT * FROM world_events WHERE state='active' ORDER BY starts_at DESC LIMIT 1")
    ?? get<EventRow>("SELECT * FROM world_events WHERE state='resolved' ORDER BY ends_at DESC LIMIT 1");
  if (!ev) return null;
  const rules = parse<{ fragments: number }>(ev.ruleset, { fragments: FRAGMENTS });
  const progress = parse<Record<string, number>>(ev.progress, {});
  const resolved = parse<{ winner: FactionId | null; epilogue: string } | null>(ev.resolved, null);
  return {
    id: ev.id, name: ev.name, brief: ev.brief, state: ev.state as GlobalEvent["state"], endsAt: ev.ends_at,
    progress: FACTIONS.map((f) => ({ factionId: f.id, label: f.name, value: (progress[f.id] ?? 0) / rules.fragments, fragments: progress[f.id] ?? 0, of: rules.fragments })),
    epilogue: resolved?.epilogue ?? null, winner: resolved?.winner ?? null,
  };
}
