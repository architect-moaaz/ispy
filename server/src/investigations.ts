import { createHash } from "node:crypto";
import type { AccuseResponse, CaseDetail, CaseSummary, EvidenceItem, FactionId } from "@ispy/shared";
import { all, get, run, tx, now, uid, logEvent } from "./db.ts";
import { FACTIONS, factionById } from "./content.ts";
import { pick, rand } from "./puzzles.ts";
import { award } from "./rewards.ts";

/**
 * Investigations: Detect -> Observe -> Investigate -> Accuse -> Confirm.
 * Evidence is game-generated and points at a faction. Most of it is true; some is a decoy
 * that points the wrong way until an analyst exposes it. Only the Arbiter (accuse()) ever
 * reveals a rival's real codename and faction, and only after a correct accusation.
 */
export const ACCUSE_THRESHOLD = 0.8;
export const CLUES_PER_DAY = 3;
export const WIRE_COST = 10;
const DECOY_RATE = 0.22;
const COOLDOWN_MS = 60 * 60_000;

interface CaseRow { id: string; investigator_id: string; target_id: string; subject: string; state: string; verdict: string | null; cooldown_until: string | null; created_at: string; updated_at: string }
interface EvidenceRow { id: string; case_id: string; file: string; kind: string; weight: number; hints_faction: FactionId; decoy: number; detected: number; source: string; at: string }

class ApiError extends Error { constructor(public status: number, msg: string) { super(msg); } }

const ADJ = ["APEX", "SILENT", "COLD", "PALE", "NORTH", "IRON", "VELVET", "LAST", "GREY", "HOLLOW"];
const NOUN = ["SHADOW", "HERON", "SIGNAL", "ORCHID", "LANTERN", "TIDE", "ANVIL", "CINDER", "MERIDIAN", "WIRE"];
/** Subject code is stable per investigator+target pair but never derivable from the codename. */
function subjectCode(investigatorId: string, targetId: string) {
  const h = createHash("sha256").update(`${investigatorId}:${targetId}`).digest();
  return `${ADJ[h[0] % ADJ.length]}_${NOUN[h[1] % NOUN.length]}`;
}

function openCase(investigatorId: string, targetId: string): CaseRow {
  const existing = get<CaseRow>("SELECT * FROM cases WHERE investigator_id=? AND target_id=?", investigatorId, targetId);
  if (existing) return existing;
  const id = uid();
  const t = now();
  run("INSERT INTO cases(id,investigator_id,target_id,subject,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
    id, investigatorId, targetId, subjectCode(investigatorId, targetId), "open", t, t);
  logEvent("case.opened", "director", { caseId: id }, investigatorId);
  return get<CaseRow>("SELECT * FROM cases WHERE id=?", id)!;
}

const FILES: Record<string, string[]> = {
  intercept: ["CHIP_TRANS_{n}.LOG", "BURST_{n}.CAP", "RELAY_{n}.TXT"],
  geo: ["GEOCON_{n}.DAT", "TRACK_{n}.GPX", "CELL_{n}.MAP"],
  cipher: ["ENCR_PACKET_{n}", "KEYFRAG_{n}.BIN", "SHIFT_{n}.KEY"],
  sighting: ["SIGHT_{n}.NOTE", "CONTACT_{n}.OBS", "SILHOUETTE_{n}.IMG"],
};

/** Create one evidence item for a case. Decoys hint at a wrong faction. */
export function addEvidence(caseId: string, kind: keyof typeof FILES, source: string, seed: string): EvidenceRow {
  const c = get<CaseRow>("SELECT * FROM cases WHERE id=?", caseId)!;
  const target = get<{ faction_id: FactionId }>("SELECT faction_id FROM players WHERE id=?", c.target_id)!;
  const decoy = rand(seed + ":decoy") < DECOY_RATE;
  const hint = decoy ? pick(FACTIONS.filter((f) => f.id !== target.faction_id), seed + ":wrong").id : target.faction_id;
  const weight = Math.round((0.45 + rand(seed + ":w") * 0.5) * 100) / 100;
  const n = String(10 + Math.floor(rand(seed + ":n") * 89));
  const id = uid();
  run("INSERT INTO evidence(id,case_id,file,kind,weight,hints_faction,decoy,detected,source,at) VALUES(?,?,?,?,?,?,?,?,?,?)",
    id, caseId, pick(FILES[kind], seed + ":f").replace("{n}", n), kind, weight, hint, decoy ? 1 : 0, 0, source, now());
  run("UPDATE cases SET updated_at=? WHERE id=?", now(), caseId);
  return get<EvidenceRow>("SELECT * FROM evidence WHERE id=?", id)!;
}

/** Called by the authority when a mission verifies. Field work yields evidence on a rival; desk work exposes decoys. */
export function onMissionVerified(playerId: string, mission: { id: string; title: string; mode: string; template_id: string; area_id: string; contested_group_id: string | null; faction_id: FactionId }) {
  if (mission.mode === "desk") {
    // Analyst work exposes one undetected decoy across the player's open cases.
    const d = get<EvidenceRow>(
      "SELECT e.* FROM evidence e JOIN cases c ON c.id=e.case_id WHERE c.investigator_id=? AND c.state='open' AND e.decoy=1 AND e.detected=0 ORDER BY e.at LIMIT 1", playerId);
    if (d) { run("UPDATE evidence SET detected=1 WHERE id=?", d.id); logEvent("evidence.decoy_detected", "analyst", { caseId: d.case_id, file: d.file }, playerId); }
    return;
  }
  // Which rival did this brush against? The contested rival if any, else a rival field agent in the area.
  let targetId: string | undefined;
  if (mission.contested_group_id) {
    targetId = get<{ assignee_id: string }>("SELECT assignee_id FROM missions WHERE contested_group_id=? AND id<>? AND assignee_id IS NOT NULL", mission.contested_group_id, mission.id)?.assignee_id;
  }
  if (!targetId) {
    const rivals = all<{ player_id: string }>(
      "SELECT p.player_id FROM presence p JOIN players pl ON pl.id=p.player_id WHERE p.area_id=? AND p.mode='field' AND p.expires_at>? AND pl.faction_id<>? AND p.player_id<>?",
      mission.area_id, now(), mission.faction_id, playerId);
    if (rivals.length) targetId = pick(rivals, mission.id + ":rival").player_id;
  }
  if (!targetId) return;
  const c = openCase(playerId, targetId);
  if (c.state !== "open") return;
  const kind = mission.template_id === "RECON" ? "sighting" : mission.template_id === "DEAD_DROP" ? "intercept" : "geo";
  const e = addEvidence(c.id, kind, mission.title, mission.id + ":ev");
  logEvent("evidence.found", "director", { caseId: c.id, file: e.file, subject: c.subject }, playerId);
}

function alignmentFor(rows: EvidenceRow[]) {
  const live = rows.filter((r) => !r.detected);
  const total = live.reduce((s, r) => s + r.weight, 0) || 1;
  return FACTIONS.map((f) => ({
    factionId: f.id, label: f.name, chief: f.chiefName,
    value: Math.round((live.filter((r) => r.hints_faction === f.id).reduce((s, r) => s + r.weight, 0) / total) * 100) / 100,
  }));
}
function confidenceFor(rows: EvidenceRow[]) {
  const live = rows.filter((r) => !r.detected);
  if (!live.length) return 0;
  const al = alignmentFor(rows);
  const top = Math.max(...al.map((a) => a.value));
  // Breadth matters: one strong clue is not a case. Three or more live items unlock full confidence.
  return Math.round(top * Math.min(1, live.length / 3) * 100) / 100;
}

function toItem(r: EvidenceRow): EvidenceItem {
  return { id: r.id, file: r.file, kind: r.kind as EvidenceItem["kind"], weight: r.weight, hintsFaction: r.hints_faction, decoyDetected: !!r.detected, at: r.at, source: r.source };
}

export function listCases(playerId: string): CaseSummary[] {
  sweepCooldowns();
  return all<CaseRow>("SELECT * FROM cases WHERE investigator_id=? ORDER BY updated_at DESC", playerId).map((c) => {
    const rows = all<EvidenceRow>("SELECT * FROM evidence WHERE case_id=?", c.id);
    return { id: c.id, subject: c.subject, state: c.state as CaseSummary["state"], confidence: confidenceFor(rows), evidenceCount: rows.length, updatedAt: c.updated_at };
  });
}

function sweepCooldowns() {
  run("UPDATE cases SET state='open', cooldown_until=NULL WHERE state='cooldown' AND cooldown_until<=?", now());
}

export function caseDetail(playerId: string, caseId: string): CaseDetail {
  sweepCooldowns();
  const c = get<CaseRow>("SELECT * FROM cases WHERE id=? AND investigator_id=?", caseId, playerId);
  if (!c) throw new ApiError(404, "no such case");
  const rows = all<EvidenceRow>("SELECT * FROM evidence WHERE case_id=? ORDER BY at DESC", c.id);
  const today = now().slice(0, 10);
  const cluesToday = get<{ n: number }>("SELECT COUNT(*) n FROM events WHERE player_id=? AND type='case.clue' AND at>=?", playerId, today)!.n;
  const reveal = c.state === "confirmed"
    ? (() => { const t = get<{ codename: string; faction_id: FactionId }>("SELECT codename, faction_id FROM players WHERE id=?", c.target_id)!; return { codename: t.codename, factionId: t.faction_id }; })()
    : null;
  return {
    id: c.id, subject: c.subject, state: c.state as CaseDetail["state"], confidence: confidenceFor(rows), evidenceCount: rows.length, updatedAt: c.updated_at,
    alignment: alignmentFor(rows), evidence: rows.map(toItem), accuseThreshold: ACCUSE_THRESHOLD,
    decoyDetected: rows.some((r) => r.detected), cluesLeftToday: Math.max(0, CLUES_PER_DAY - cluesToday), wireCostCredits: WIRE_COST,
    reveal, cooldownUntil: c.cooldown_until,
  };
}

/** A free clue from the chief: limited per day, may be a decoy. */
export function requestClue(playerId: string, caseId: string): EvidenceItem {
  const d = caseDetail(playerId, caseId);
  if (d.state !== "open") throw new ApiError(409, "this case is not open");
  if (d.cluesLeftToday <= 0) throw new ApiError(429, "no clues left today");
  const e = addEvidence(caseId, pick(["intercept", "geo", "sighting"] as const, uid()), "Chief's clue", uid());
  logEvent("case.clue", "chief", { caseId, file: e.file }, playerId);
  return toItem(e);
}

/** A paid wire: costs intel credits, never a decoy, always a cipher fragment. */
export function requestWire(playerId: string, caseId: string): { evidence: EvidenceItem; credits: number } {
  const d = caseDetail(playerId, caseId);
  if (d.state !== "open") throw new ApiError(409, "this case is not open");
  const p = get<{ credits: number }>("SELECT credits FROM players WHERE id=?", playerId)!;
  if (p.credits < WIRE_COST) throw new ApiError(402, `a wire costs ${WIRE_COST} intel credits`);
  return tx(() => {
    run("UPDATE players SET credits = credits - ? WHERE id=?", WIRE_COST, playerId);
    const c = get<CaseRow>("SELECT * FROM cases WHERE id=?", caseId)!;
    const target = get<{ faction_id: FactionId }>("SELECT faction_id FROM players WHERE id=?", c.target_id)!;
    const id = uid();
    run("INSERT INTO evidence(id,case_id,file,kind,weight,hints_faction,decoy,detected,source,at) VALUES(?,?,?,?,?,?,?,?,?,?)",
      id, caseId, `WIRE_${String(10 + Math.floor(rand(id) * 89))}.KEY`, "cipher", 0.7, target.faction_id, 0, 0, "Paid wire", now());
    run("UPDATE cases SET updated_at=? WHERE id=?", now(), caseId);
    logEvent("case.wire", "chief", { caseId, credits: WIRE_COST }, playerId);
    return { evidence: toItem(get<EvidenceRow>("SELECT * FROM evidence WHERE id=?", id)!), credits: p.credits - WIRE_COST };
  });
}

/** The Arbiter rules on an accusation. Correct: reveal and reward. Wrong: trust penalty and a cooldown. */
export function accuse(playerId: string, caseId: string, factionId: FactionId): AccuseResponse {
  const d = caseDetail(playerId, caseId);
  if (d.state !== "open") throw new ApiError(409, "this case is not open");
  if (d.confidence < ACCUSE_THRESHOLD) throw new ApiError(400, `confidence ${Math.round(d.confidence * 100)}% is below the ${Math.round(ACCUSE_THRESHOLD * 100)}% threshold`);
  return tx(() => {
    const c = get<CaseRow>("SELECT * FROM cases WHERE id=?", caseId)!;
    const target = get<{ codename: string; faction_id: FactionId }>("SELECT codename, faction_id FROM players WHERE id=?", c.target_id)!;
    const correct = target.faction_id === factionId;
    if (correct) {
      run("UPDATE cases SET state='confirmed', verdict=?, updated_at=? WHERE id=?", factionId, now(), caseId);
      award(playerId, 300, 3, "Accusation confirmed", 25);
      logEvent("case.confirmed", "arbiter", { caseId, subject: c.subject, faction: factionId }, playerId);
      logEvent("case.exposed", "arbiter", { by: c.subject }, c.target_id);
      return { correct: true, reveal: { codename: target.codename, factionId: target.faction_id }, reward: { xp: 300, trust: 3 },
        debrief: `${c.subject} is ${target.codename} of ${factionById(target.faction_id).name}. Their cover is burned; yours holds.` };
    }
    run("UPDATE cases SET state='cooldown', cooldown_until=?, updated_at=? WHERE id=?", new Date(Date.now() + COOLDOWN_MS).toISOString(), now(), caseId);
    award(playerId, 0, -5, "Accusation rejected");
    logEvent("case.rejected", "arbiter", { caseId, subject: c.subject, accused: factionId }, playerId);
    return { correct: false, reward: { xp: 0, trust: -5 }, debrief: "The Arbiter found no match. The subject goes quiet for an hour, and your trust takes the hit." };
  });
}
