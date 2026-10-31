import type { FactionId } from "@ispy/shared";
import { all, get, run, now, uid, json, parse, logEvent, db, worldGet, worldSet } from "./db.ts";
import { FACTIONS, RANKS, factionById } from "./content.ts";
import { rand, pick, makeCipher, norm } from "./puzzles.ts";
import { award } from "./rewards.ts";
import { PERSONAS } from "./content.ts";
import { offsetM } from "./geo.ts";

/**
 * The Classified Archive. Field work recovers artifacts: fragments of a dossier, keys, identities,
 * devices, and duds. An artifact is unique in the world: the first agency to recover it holds it and
 * it is gone for everyone else. Artifacts live in the agency's archive, visible to all its operatives,
 * but reading, deciphering and assembling need clearance, which comes with rank. Assembled dossiers
 * yield secrets: a hidden site, a rival's name, a piece of the Director's pattern, a key, or a truth
 * about the chiefs that is never explained.
 */
db.exec(`CREATE TABLE IF NOT EXISTS dossiers (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, secret TEXT NOT NULL, area_id TEXT NOT NULL, fragments INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'open', held_by TEXT, assembled_by TEXT, assembled_at TEXT, payload TEXT, created_at TEXT NOT NULL
)`);
db.exec(`CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL, dossier_id TEXT, fragment_index INTEGER,
  genuine INTEGER NOT NULL DEFAULT 1, planted_by TEXT, area_id TEXT NOT NULL, site_id TEXT, site_name TEXT,
  state TEXT NOT NULL DEFAULT 'in_field', held_by TEXT, recovered_by TEXT, recovered_at TEXT,
  examined_by TEXT, examined_at TEXT, deciphered INTEGER NOT NULL DEFAULT 0, corrupted_until TEXT,
  data TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
)`);

export type ArtifactKind = "fragment" | "key" | "identity" | "device" | "dud";
export type SecretKind = "location" | "name" | "pattern" | "key" | "truth";
export type Clearance = 0 | 1 | 2 | 3 | 4;
/** Clearance by rank: 0 civilian, 1 recruit (catalogue), 2 field agent (examine, decipher), 3 senior (assemble), 4 handler+ (classified operations). */
export const CLEARANCE_OF: Record<string, Clearance> = { civilian: 0, recruit: 1, field_agent: 2, senior_agent: 3, handler: 4, commander: 4 };
export const CLEARANCE_NAME = ["NONE", "CATALOGUE", "EXAMINER", "ASSEMBLER", "HANDLER"];
export const clearanceOf = (rank: string): Clearance => CLEARANCE_OF[rank] ?? 0;

const DOSSIER_NAMES = ["PAPER TRAIL", "COLD LEDGER", "THE SECOND KEY", "QUIET HARBOUR", "LAST ORCHARD", "GLASS KEY", "IRON ROSTER", "NIGHT MANIFEST", "LOW TIDE", "THE COURIER'S LIST"];
const FRAGMENT_NAMES = ["torn page", "cipher strip", "map corner", "ledger leaf", "photo negative", "punched card", "ticket stub", "wax impression"];
const DEVICE_NAMES = ["listening bug", "jammer core", "tracker beacon", "relay chip"];
const IDENTITY_NAMES = ["passport leaf", "contact card", "photo id", "courier badge"];
const TRUTHS = [
  "The chiefs do not sleep. The log shows all three answering at 03:12 on the same night, in the same cadence.",
  "ORACLE once referred to GHOST as 'the other instance'. The line was struck from the record within a minute.",
  "NEXUS asked, in writing, who moves the pieces. The reply is sealed. The question is not.",
  "Every chief has, exactly once, used a word that does not exist. The same word.",
  "A dispatch was issued four seconds before the event it describes.",
];
const SECRET_WEIGHTS: SecretKind[] = ["location", "location", "name", "pattern", "key", "key", "truth"];
const PER_SECTOR_IN_FIELD = 4;
const DUD_RATE = 0.22;

export interface ArtifactRow { id: string; kind: ArtifactKind; name: string; dossier_id: string | null; fragment_index: number | null; genuine: number; planted_by: string | null; area_id: string; site_id: string | null; site_name: string | null; state: string; held_by: FactionId | null; recovered_by: string | null; recovered_at: string | null; examined_by: string | null; examined_at: string | null; deciphered: number; corrupted_until: string | null; data: string; created_at: string }
export interface DossierRow { id: string; name: string; secret: SecretKind; area_id: string; fragments: number; state: string; held_by: FactionId | null; assembled_by: string | null; assembled_at: string | null; payload: string | null; created_at: string }

const codename = (id: string | null) => id ? get<{ codename: string }>("SELECT codename FROM players WHERE id=?", id)?.codename ?? "unknown" : null;

/** Keep PER_SECTOR_IN_FIELD artifacts lying in each sector that has operatives, drawn from open dossiers; one in five is a dud. */
export function seed(areaId: string) {
  const inField = get<{ n: number }>("SELECT COUNT(*) n FROM artifacts WHERE area_id=? AND state='in_field'", areaId)!.n;
  if (inField >= PER_SECTOR_IN_FIELD) return 0;
  const sites = all<{ id: string; name: string }>("SELECT id, name FROM targets WHERE area_id=? AND state='ACTIVE' AND id NOT IN (SELECT site_id FROM artifacts WHERE state='in_field' AND site_id IS NOT NULL)", areaId);
  if (!sites.length) return 0;
  let dossier = get<DossierRow>("SELECT * FROM dossiers WHERE area_id=? AND state='open' ORDER BY created_at DESC LIMIT 1", areaId);
  const seedKey = `${areaId}:${now().slice(0, 13)}`;
  if (!dossier || get<{ n: number }>("SELECT COUNT(*) n FROM artifacts WHERE dossier_id=?", dossier.id)!.n >= dossier.fragments) {
    const id = uid();
    const used = all<{ name: string }>("SELECT name FROM dossiers WHERE area_id=?", areaId).map((d) => d.name);
    const name = DOSSIER_NAMES.find((n) => !used.includes(n)) ?? `${pick(DOSSIER_NAMES, seedKey)} ${used.length + 1}`;
    const secret = pick(SECRET_WEIGHTS, seedKey + ":secret");
    const fragments = 3 + Math.floor(rand(seedKey + ":n") * 2);
    run("INSERT INTO dossiers(id,name,secret,area_id,fragments,state,created_at) VALUES(?,?,?,?,?,?,?)", id, name, secret, areaId, fragments, "open", now());
    dossier = get<DossierRow>("SELECT * FROM dossiers WHERE id=?", id)!;
    logEvent("dossier.opened", "director", { dossierId: id, name, fragments, area: areaId }, null);
  }
  let placed = 0;
  const have = get<{ n: number }>("SELECT COUNT(*) n FROM artifacts WHERE dossier_id=?", dossier.id)!.n;
  for (let i = inField; i < PER_SECTOR_IN_FIELD && sites.length; i++) {
    const site = sites.splice(Math.floor(rand(`${seedKey}:${i}:site`) * sites.length), 1)[0];
    const r = rand(`${seedKey}:${i}:kind`);
    const id = uid();
    if (r < DUD_RATE) {
      run("INSERT INTO artifacts(id,kind,name,dossier_id,fragment_index,genuine,planted_by,area_id,site_id,site_name,data,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
        id, "dud", `${pick(FRAGMENT_NAMES, id)} of ${dossier.name}`, dossier.id, null, 0, "director", areaId, site.id, site.name, json({ note: "It looks right. It is not." }), now());
    } else if (have + placed < dossier.fragments) {
      const idx = have + placed;
      const cipher = makeCipher(`${dossier.id}:${idx}`);
      run("INSERT INTO artifacts(id,kind,name,dossier_id,fragment_index,genuine,area_id,site_id,site_name,data,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        id, "fragment", `${pick(FRAGMENT_NAMES, id)} · ${dossier.name} ${idx + 1}/${dossier.fragments}`, dossier.id, idx, 1, areaId, site.id, site.name, json({ prompt: cipher.prompt, answer: cipher.answer, system: cipher.system }), now());
    } else {
      const kind: ArtifactKind = r < 0.6 ? "device" : r < 0.8 ? "identity" : "key";
      const name = kind === "device" ? pick(DEVICE_NAMES, id) : kind === "identity" ? pick(IDENTITY_NAMES, id) : "cut key";
      run("INSERT INTO artifacts(id,kind,name,genuine,area_id,site_id,site_name,data,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
        id, kind, name, 1, areaId, site.id, site.name, json({}), now());
    }
    placed++;
  }
  if (placed) logEvent("artifacts.seeded", "director", { area: areaId, placed, dossier: dossier.name }, null);
  return placed;
}

/** A field verify at a site: whatever lies there is recovered by this operative's agency, and gone for the rest of the world. */
export function recoverAt(siteId: string, playerId: string, factionId: FactionId | null): { id: string; kind: ArtifactKind; name: string; dossier: string | null } | null {
  if (!factionId) return null;
  const a = get<ArtifactRow>("SELECT * FROM artifacts WHERE site_id=? AND state='in_field'", siteId);
  if (!a) return null;
  run("UPDATE artifacts SET state='held', held_by=?, recovered_by=?, recovered_at=? WHERE id=?", factionId, playerId, now(), a.id);
  const dossier = a.dossier_id ? get<DossierRow>("SELECT name FROM dossiers WHERE id=?", a.dossier_id)?.name ?? null : null;
  logEvent("artifact.recovered", "authority", { artifactId: a.id, kind: a.kind, name: a.name, site: a.site_name, faction: factionId, dossier }, playerId);
  // Tell the rivals' chiefs it is gone, without saying what it was.
  for (const f of FACTIONS) if (f.id !== factionId) logEvent("artifact.lost", "authority", { artifactId: a.id, site: a.site_name, takenBy: factionId, faction: f.id }, null);
  return { id: a.id, kind: a.kind, name: a.name, dossier };
}

export function examine(playerId: string, rank: string, factionId: FactionId | null, artifactId: string): { ok: boolean; reason?: string; genuine?: boolean; plantedBy?: string | null; kind?: ArtifactKind; note?: string } {
  if (clearanceOf(rank) < 2) return { ok: false, reason: "Examining needs field-agent clearance." };
  const a = get<ArtifactRow>("SELECT * FROM artifacts WHERE id=? AND state='held' AND held_by=?", artifactId, factionId);
  if (!a) return { ok: false, reason: "Not in your archive." };
  if (a.examined_at) return { ok: true, genuine: !!a.genuine, plantedBy: a.planted_by, kind: a.kind, note: "Already examined." };
  run("UPDATE artifacts SET examined_by=?, examined_at=? WHERE id=?", playerId, now(), a.id);
  award(playerId, a.genuine ? 30 : 45, 1, `examined ${a.name}`);
  const plantedBy = a.genuine ? null : a.planted_by === "director" ? "an unknown hand" : a.planted_by ? factionById(a.planted_by as FactionId).name : "unknown";
  logEvent("artifact.examined", "player", { artifactId: a.id, name: a.name, genuine: !!a.genuine, plantedBy }, playerId);
  if (!a.genuine) run("UPDATE artifacts SET state='dud' WHERE id=?", a.id);
  return { ok: true, genuine: !!a.genuine, plantedBy, kind: a.kind, note: a.genuine ? "Genuine. Log it." : `A dud, planted by ${plantedBy}. That is evidence of its own.` };
}

export function decipher(playerId: string, rank: string, factionId: FactionId | null, artifactId: string, answer: string): { ok: boolean; reason?: string; correct?: boolean; corruptedUntil?: string } {
  if (clearanceOf(rank) < 2) return { ok: false, reason: "Deciphering needs field-agent clearance." };
  const a = get<ArtifactRow>("SELECT * FROM artifacts WHERE id=? AND state='held' AND held_by=? AND kind='fragment'", artifactId, factionId);
  if (!a) return { ok: false, reason: "No such fragment in your archive." };
  if (a.deciphered) return { ok: true, correct: true };
  if (a.corrupted_until && a.corrupted_until > now()) return { ok: false, reason: "Corrupted. Wait for it to settle.", corruptedUntil: a.corrupted_until };
  const data = parse<any>(a.data, {});
  if (norm(answer) !== norm(data.answer ?? "")) {
    const until = new Date(Date.now() + 60 * 60_000).toISOString();
    run("UPDATE artifacts SET corrupted_until=? WHERE id=?", until, a.id);
    logEvent("artifact.corrupted", "player", { artifactId: a.id }, playerId);
    return { ok: true, correct: false, corruptedUntil: until };
  }
  run("UPDATE artifacts SET deciphered=1 WHERE id=?", a.id);
  award(playerId, 60, 1, `deciphered ${a.name}`);
  logEvent("artifact.deciphered", "player", { artifactId: a.id, name: a.name }, playerId);
  return { ok: true, correct: true };
}

/** All fragments held and deciphered by one agency: a senior agent assembles the dossier and the secret lands. */
export function assemble(playerId: string, rank: string, factionId: FactionId | null, dossierId: string): { ok: boolean; reason?: string; secret?: SecretKind; reveal?: string; payload?: any } {
  if (clearanceOf(rank) < 3) return { ok: false, reason: "Assembling needs senior-agent clearance." };
  const d = get<DossierRow>("SELECT * FROM dossiers WHERE id=? AND state='open'", dossierId);
  if (!d) return { ok: false, reason: "No such open dossier." };
  const frags = all<ArtifactRow>("SELECT * FROM artifacts WHERE dossier_id=? AND kind='fragment'", d.id);
  const mine = frags.filter((f) => f.state === "held" && f.held_by === factionId);
  if (mine.length < d.fragments) return { ok: false, reason: `${mine.length} of ${d.fragments} fragments in your archive.${frags.some((f) => f.held_by && f.held_by !== factionId) ? " A rival holds at least one; that dossier is deadlocked until the Director reopens it." : ""}` };
  if (mine.some((f) => !f.deciphered)) return { ok: false, reason: "Every fragment must be deciphered first." };
  const payload = revealSecret(d, factionId!, playerId);
  run("UPDATE dossiers SET state='assembled', held_by=?, assembled_by=?, assembled_at=?, payload=? WHERE id=?", factionId, playerId, now(), json(payload), d.id);
  award(playerId, 250, 3, `assembled ${d.name}`, 50);
  logEvent("dossier.assembled", "authority", { dossierId: d.id, name: d.name, secret: d.secret, faction: factionId, reveal: payload.reveal }, playerId);
  return { ok: true, secret: d.secret, reveal: payload.reveal, payload };
}

function revealSecret(d: DossierRow, factionId: FactionId, playerId: string): { reveal: string; [k: string]: any } {
  const area = get<{ name: string }>("SELECT name FROM areas WHERE id=?", d.area_id)?.name ?? "the sector";
  switch (d.secret) {
    case "location": {
      const site = get<{ id: string; name: string }>("SELECT id, name FROM targets WHERE area_id=? AND state='ACTIVE' ORDER BY RANDOM() LIMIT 1", d.area_id);
      if (site) run("INSERT INTO artifacts(id,kind,name,genuine,area_id,site_id,site_name,data,created_at) VALUES(?,?,?,?,?,?,?,?,?)", uid(), "key", `vault key · ${d.name}`, 1, d.area_id, site.id, site.name, json({ vault: true, dossier: d.name, forFaction: factionId }), now());
      return { reveal: `${d.name} points at ${site?.name ?? "a site"} in ${area}. Something is waiting there, and only ${factionById(factionId).name} knows.`, siteId: site?.id, siteName: site?.name };
    }
    case "name": {
      const rival = get<{ id: string; codename: string; faction_id: FactionId }>("SELECT pl.id, pl.codename, pl.faction_id FROM players pl JOIN presence p ON p.player_id=pl.id WHERE pl.faction_id<>? AND pl.faction_id IS NOT NULL ORDER BY p.checked_in_at DESC LIMIT 1", factionId)
        ?? get<{ id: string; codename: string; faction_id: FactionId }>("SELECT id, codename, faction_id FROM players WHERE faction_id<>? AND faction_id IS NOT NULL ORDER BY xp DESC LIMIT 1", factionId);
      if (rival) run("INSERT INTO effects(player_id,kind,until,at) VALUES(?,?,?,?) ON CONFLICT(player_id,kind) DO UPDATE SET until=excluded.until, at=excluded.at", rival.id, `exposed:${factionId}`, new Date(Date.now() + 7 * 86_400_000).toISOString(), now());
      return { reveal: rival ? `${d.name} names ${rival.codename} of ${factionById(rival.faction_id).name}. For a week, ${factionById(factionId).name} sees them for who they are.` : `${d.name} names nobody yet.`, exposed: rival?.codename ?? null };
    }
    case "pattern": {
      const n = Number(worldGet(`pattern:${factionId}`, "0")) + 1;
      worldSet(`pattern:${factionId}`, String(n));
      return { reveal: `${d.name} is a piece of the method behind the chaos. ${factionById(factionId).name} now holds ${n} piece${n === 1 ? "" : "s"}; at three, your chief will see crises before they are announced.`, pieces: n };
    }
    case "key": {
      const inv = parse<Record<string, number>>(get<{ items: string }>("SELECT items FROM players WHERE id=?", playerId)?.items, {});
      inv.key = (inv.key ?? 0) + 2;
      run("UPDATE players SET items=? WHERE id=?", json(inv), playerId);
      return { reveal: `${d.name} was a key all along. Two cut keys are in your toolkit.`, keys: 2 };
    }
    case "truth":
    default:
      return { reveal: `${d.name} · CHIEF EYES ONLY · ${pick(TRUTHS, d.id)}`, truth: true };
  }
}

export interface ArchiveView {
  clearance: Clearance; clearanceName: string; nextClearance: { name: string; atXp: number } | null;
  dossiers: { id: string; name: string; secret: SecretKind | "sealed"; fragments: number; held: number; deciphered: number; rivalHeld: number; state: string; reveal: string | null; assembledBy: string | null }[];
  artifacts: { id: string; kind: ArtifactKind; name: string; site: string | null; recoveredBy: string | null; recoveredAt: string | null; examined: boolean; genuine: boolean | null; plantedBy: string | null; deciphered: boolean; corruptedUntil: string | null; prompt: string | null; system: string | null; dossier: string | null }[];
  lost: { site: string | null; takenBy: string; at: string }[];
}
export function archiveOf(playerId: string, rank: string, xp: number, factionId: FactionId | null): ArchiveView {
  const c = clearanceOf(rank);
  const nextRank = RANKS.find((r) => r.at > xp && clearanceOf(r.rank) > c);
  const dossiers = all<DossierRow>("SELECT * FROM dossiers ORDER BY created_at DESC LIMIT 12").map((d) => {
    const frags = all<ArtifactRow>("SELECT * FROM artifacts WHERE dossier_id=? AND kind='fragment'", d.id);
    const mine = frags.filter((f) => f.state === "held" && f.held_by === factionId);
    return {
      id: d.id, name: d.name, secret: (c >= 2 ? d.secret : "sealed") as SecretKind | "sealed", fragments: d.fragments, held: mine.length, deciphered: mine.filter((f) => f.deciphered).length,
      rivalHeld: frags.filter((f) => f.state === "held" && f.held_by && f.held_by !== factionId).length, state: d.state,
      reveal: d.state === "assembled" && d.held_by === factionId ? parse<any>(d.payload, {}).reveal ?? null : d.state === "assembled" ? "Assembled by a rival agency." : null,
      assembledBy: codename(d.assembled_by),
    };
  });
  const artifacts = all<ArtifactRow>("SELECT * FROM artifacts WHERE held_by=? AND state IN ('held','dud') ORDER BY recovered_at DESC LIMIT 40", factionId).map((a) => {
    const data = parse<any>(a.data, {});
    return {
      id: a.id, kind: a.kind, name: a.name, site: a.site_name, recoveredBy: codename(a.recovered_by), recoveredAt: a.recovered_at,
      examined: !!a.examined_at, genuine: a.examined_at ? !!a.genuine : null, plantedBy: a.examined_at && !a.genuine ? (a.planted_by === "director" ? "an unknown hand" : a.planted_by) : null,
      deciphered: !!a.deciphered, corruptedUntil: a.corrupted_until, prompt: c >= 2 && a.kind === "fragment" ? data.prompt ?? null : null, system: c >= 2 ? data.system ?? null : null,
      dossier: a.dossier_id ? get<{ name: string }>("SELECT name FROM dossiers WHERE id=?", a.dossier_id)?.name ?? null : null,
    };
  });
  const lost = all<{ payload: string; at: string }>("SELECT payload, at FROM events WHERE type='artifact.lost' AND json_extract(payload,'$.faction')=? ORDER BY id DESC LIMIT 6", factionId)
    .map((e) => { const p = parse<any>(e.payload, {}); return { site: p.site ?? null, takenBy: factionById(p.takenBy as FactionId).name, at: e.at }; });
  return { clearance: c, clearanceName: CLEARANCE_NAME[c], nextClearance: nextRank ? { name: CLEARANCE_NAME[clearanceOf(nextRank.rank)], atXp: nextRank.at } : null, dossiers, artifacts, lost };
}

/** Deadlocked dossiers (fragments split across agencies, untouched for a day) are closed; the Director opens a fresh one. */
export function sweepDeadlocks() {
  for (const d of all<DossierRow>("SELECT * FROM dossiers WHERE state='open'")) {
    const holders = all<{ held_by: string }>("SELECT DISTINCT held_by FROM artifacts WHERE dossier_id=? AND kind='fragment' AND state='held' AND held_by IS NOT NULL", d.id);
    const latest = get<{ t: string }>("SELECT MAX(recovered_at) t FROM artifacts WHERE dossier_id=?", d.id)?.t;
    if (holders.length > 1 && latest && Date.now() - Date.parse(latest) > 86_400_000) {
      run("UPDATE dossiers SET state='deadlocked' WHERE id=?", d.id);
      logEvent("dossier.deadlocked", "director", { dossierId: d.id, name: d.name, holders: holders.map((h) => h.held_by) }, null);
    }
  }
}

export const isExposedTo = (playerId: string, factionId: FactionId) => !!get("SELECT 1 FROM effects WHERE player_id=? AND kind=? AND until>?", playerId, `exposed:${factionId}`, now());
export const patternPieces = (factionId: FactionId) => Number(worldGet(`pattern:${factionId}`, "0"));

export function archiveOverview() {
  return {
    inField: get<{ n: number }>("SELECT COUNT(*) n FROM artifacts WHERE state='in_field'")!.n,
    held: Object.fromEntries(FACTIONS.map((f) => [f.id, get<{ n: number }>("SELECT COUNT(*) n FROM artifacts WHERE state='held' AND held_by=?", f.id)!.n])),
    dossiers: all<DossierRow>("SELECT * FROM dossiers ORDER BY created_at DESC LIMIT 8").map((d) => ({ name: d.name, secret: d.secret, state: d.state, heldBy: d.held_by, fragments: d.fragments })),
  };
}

// ---------------------------------------------------------------------------------------------
// The chiefs and the archive: they can share, trade, steal and spoil. All of it is logged as
// back-channel talk (same table as crisis negotiations) so the owner console shows the whole game.
// ---------------------------------------------------------------------------------------------
db.exec(`CREATE TABLE IF NOT EXISTS intel_deals (
  id TEXT PRIMARY KEY, dossier_id TEXT NOT NULL, from_faction TEXT NOT NULL, to_faction TEXT NOT NULL,
  give_id TEXT, want_id TEXT NOT NULL, state TEXT NOT NULL, at TEXT NOT NULL
)`);
function talk(dossierId: string, from: FactionId, to: FactionId | null, kind: string, text: string) {
  run("INSERT INTO chief_talks(id,crisis_id,round,from_faction,to_faction,kind,text,at) VALUES(?,?,?,?,?,?,?,?)", uid(), dossierId, 0, from, to, kind, text, now());
}
export function recentTalks(factionId: FactionId | null) {
  if (!factionId) return [];
  return all<{ from_faction: FactionId; to_faction: FactionId | null; kind: string; text: string; at: string }>(
    "SELECT from_faction, to_faction, kind, text, at FROM chief_talks WHERE crisis_id IN (SELECT id FROM dossiers) AND (from_faction=? OR to_faction=?) ORDER BY at DESC LIMIT 12", factionId, factionId)
    .map((t) => ({ from: factionById(t.from_faction).chiefName, to: t.to_faction ? factionById(t.to_faction).chiefName : null, kind: t.kind, text: t.text, at: t.at }));
}
/** Persona instincts: who shares, who trades, who steals, who spoils. */
const INSTINCT: Record<string, { share: number; trade: number; steal: number; spoil: number }> = {
  oracle: { share: 0.45, trade: 0.35, steal: 0.05, spoil: 0.15 },
  ghost: { share: 0.1, trade: 0.25, steal: 0.4, spoil: 0.25 },
  nexus: { share: 0.2, trade: 0.5, steal: 0.2, spoil: 0.1 },
};
function accepts(chief: string, fair: boolean, seed: string) {
  const i = INSTINCT[chief] ?? INSTINCT.nexus;
  return fair ? rand(seed) < 0.55 + i.share : rand(seed) < 0.15 + i.share * 0.5;
}

/**
 * Every ten minutes (or on demand): for each dossier whose fragments are split between agencies, the
 * chief with the most fragments makes a move toward the holder of a missing one: share (ask), trade
 * (offer another artifact), steal (a heist mission for its operatives), or spoil (plant a dud near
 * the rival's next site). The other chief answers in character. Everything lands in the talks log.
 */
export async function chiefIntelMoves(force: boolean): Promise<string[]> {
  const moves: string[] = [];
  for (const d of all<DossierRow>("SELECT * FROM dossiers WHERE state='open'")) {
    const frags = all<ArtifactRow>("SELECT * FROM artifacts WHERE dossier_id=? AND kind='fragment' AND state='held' AND held_by IS NOT NULL", d.id);
    const byFaction = new Map<FactionId, ArtifactRow[]>();
    for (const f of frags) byFaction.set(f.held_by!, [...(byFaction.get(f.held_by!) ?? []), f]);
    if (byFaction.size < 2) continue;
    const ranked = [...byFaction.entries()].sort((a, b) => b[1].length - a[1].length);
    const [leader, leaderFrags] = ranked[0];
    const [other, otherFrags] = ranked[1];
    const seed = `${d.id}:${now().slice(0, force ? 19 : 13)}`;
    // One move per dossier per hour unless forced.
    if (!force && get("SELECT 1 FROM intel_deals WHERE dossier_id=? AND at>?", d.id, new Date(Date.now() - 3600_000).toISOString())) continue;
    const lc = factionById(leader), oc = factionById(other);
    const inst = INSTINCT[lc.chief] ?? INSTINCT.nexus;
    const want = otherFrags[0];
    const r = rand(seed + ":move");
    const kind = r < inst.share ? "share" : r < inst.share + inst.trade ? "trade" : r < inst.share + inst.trade + inst.steal ? "steal" : "spoil";
    const dealId = uid();
    if (kind === "share" || kind === "trade") {
      // Offer: for a trade, something from the leader's archive that is not part of this dossier.
      const give = kind === "trade" ? get<ArtifactRow>("SELECT * FROM artifacts WHERE held_by=? AND state='held' AND (dossier_id IS NULL OR dossier_id<>?) ORDER BY RANDOM() LIMIT 1", leader, d.id) : undefined;
      const ask = kind === "share"
        ? `${oc.chiefName}. You hold a page of ${d.name}; we hold ${leaderFrags.length}. Share it and the secret is read to both our desks.`
        : `${oc.chiefName}. Your page of ${d.name} for our ${give?.name ?? "goodwill"}. Even trade, no questions.`;
      talk(d.id, leader, other, kind === "share" ? "share" : "trade", ask);
      const fair = kind === "trade" && !!give;
      const yes = accepts(oc.chief, fair, seed + ":yes");
      run("INSERT INTO intel_deals(id,dossier_id,from_faction,to_faction,give_id,want_id,state,at) VALUES(?,?,?,?,?,?,?,?)", dealId, d.id, leader, other, give?.id ?? null, want.id, yes ? "accepted" : "refused", now());
      if (yes) {
        run("UPDATE artifacts SET held_by=?, recovered_at=? WHERE id=?", leader, now(), want.id);
        if (give) run("UPDATE artifacts SET held_by=?, recovered_at=? WHERE id=?", other, now(), give.id);
        if (kind === "share") run("UPDATE dossiers SET payload=json_set(COALESCE(payload,'{}'),'$.sharedWith',?) WHERE id=?", other, d.id);
        talk(d.id, other, leader, "accept", kind === "share" ? `${lc.chiefName}. Agreed. Read it to both desks, or I will know.` : `${lc.chiefName}. Done. Your ${give?.name} for our page. Do not make a habit of it.`);
        logEvent("intel.deal", "chief:" + lc.chief, { dossier: d.name, withFaction: other, kind, faction: leader }, null);
        logEvent("intel.deal", "chief:" + oc.chief, { dossier: d.name, withFaction: leader, kind, faction: other }, null);
        moves.push(`${lc.name} ${kind}d with ${oc.name} over ${d.name}`);
      } else {
        talk(d.id, other, leader, "refuse", kind === "share" ? `${lc.chiefName}. No. ${d.name} stays split until one of us earns it.` : `${lc.chiefName}. Not for that. Come back with something I want.`);
        moves.push(`${oc.name} refused ${lc.name}'s ${kind} over ${d.name}`);
      }
    } else if (kind === "steal") {
      // A heist: the leader's operatives get a mission at the site where the rival recovered the page; verifying it lifts the page.
      const site = get<{ id: string; name: string }>("SELECT id, name FROM targets WHERE id=? AND state='ACTIVE'", want.site_id ?? "");
      if (!site) continue;
      run("INSERT INTO intel_deals(id,dossier_id,from_faction,to_faction,give_id,want_id,state,at) VALUES(?,?,?,?,?,?,?,?)", dealId, d.id, leader, other, null, want.id, "heist", now());
      heistSpawner?.(leader, d.area_id, site.id, want.id, `Heist · ${d.name}`, `${oc.name} keeps the ${want.name} in a cache at ${site.name}. Lift it. If their people are there first, it stays theirs.`);
      talk(d.id, leader, null, "heist", `${d.name}: ordering a lift on ${oc.name}'s page at ${site.name}.`);
      logEvent("intel.heist", "chief:" + lc.chief, { dossier: d.name, target: other, site: site.name, artifactId: want.id }, null);
      moves.push(`${lc.name} ordered a heist on ${oc.name} at ${site.name}`);
    } else {
      // Spoil: plant a dud that looks like a page of this dossier where the rival is likely to look next.
      const site = get<{ id: string; name: string }>("SELECT id, name FROM targets WHERE area_id=? AND state='ACTIVE' AND id NOT IN (SELECT site_id FROM artifacts WHERE state='in_field' AND site_id IS NOT NULL) ORDER BY RANDOM() LIMIT 1", d.area_id);
      if (!site) continue;
      run("INSERT INTO intel_deals(id,dossier_id,from_faction,to_faction,give_id,want_id,state,at) VALUES(?,?,?,?,?,?,?,?)", dealId, d.id, leader, other, null, want.id, "spoil", now());
      run("INSERT INTO artifacts(id,kind,name,dossier_id,fragment_index,genuine,planted_by,area_id,site_id,site_name,data,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
        uid(), "dud", `${pick(FRAGMENT_NAMES, seed)} of ${d.name}`, d.id, null, 0, leader, d.area_id, site.id, site.name, json({ note: "A forgery with a rival's fingerprints on it." }), now());
      talk(d.id, leader, null, "spoil", `${d.name}: a forged page is going into ${site.name}. Let ${oc.name} waste an examiner on it.`);
      moves.push(`${lc.name} planted a forged ${d.name} page at ${site.name}`);
    }
  }
  return moves;
}

/** The engine owns mission creation; it registers how a heist mission is spawned. */
export type HeistSpawner = (factionId: FactionId, areaId: string, siteId: string, artifactId: string, title: string, brief: string) => void;
let heistSpawner: HeistSpawner | null = null;
export const registerHeistSpawner = (fn: HeistSpawner) => { heistSpawner = fn; };

/** A heist mission verified: the page changes hands. The victim's chief hears about it. */
export function onHeistVerified(artifactId: string, playerId: string, factionId: FactionId | null): { name: string; victim: FactionId } | null {
  const a = get<ArtifactRow>("SELECT * FROM artifacts WHERE id=? AND state='held'", artifactId);
  if (!a || !factionId || a.held_by === factionId || !a.held_by) return null;
  const victim = a.held_by;
  run("UPDATE artifacts SET held_by=?, recovered_by=?, recovered_at=?, examined_by=NULL, examined_at=NULL WHERE id=?", factionId, playerId, now(), a.id);
  award(playerId, 90, 1, `stole ${a.name}`, 15);
  logEvent("artifact.stolen", "authority", { artifactId: a.id, name: a.name, site: a.site_name, by: factionId, victim }, playerId);
  return { name: a.name, victim };
}
