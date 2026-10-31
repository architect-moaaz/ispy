// API contract shared by the server and the mobile app.
// Every response is JSON. Auth: `Authorization: Bearer <token>` from /v1/auth/register.

export type FactionId = "raven" | "phantom" | "cipher";
export type ChiefId = "oracle" | "ghost" | "nexus";
export type Rank =
  | "civilian"
  | "recruit"
  | "field_agent"
  | "senior_agent"
  | "handler"
  | "commander";
export type Mode = "field" | "desk";

export type SkillKey = "observation" | "reasoning" | "cipher" | "cooperation";
export type Skills = Record<SkillKey, number>; // 0..1

export interface Faction {
  id: FactionId;
  name: string;
  chief: ChiefId;
  chiefName: string;
  tagline: string;
  specialty: string;
  color: string;
}

export interface Player {
  id: string;
  codename: string;
  factionId: FactionId | null;
  rank: Rank;
  xp: number;
  trust: number; // 0..100
  skills: Skills;
  walkRadiusM: number;
  dailyFieldCap: number;
  fieldToday: number;
  credits: number;
}

export interface Area {
  id: string;
  name: string;
  city: string;
  lat: number;
  lng: number;
  radiusM: number;
}

// ---- Onboarding ----
export interface AssessmentQuestion {
  id: string;
  skill: SkillKey;
  kind: "choice" | "text";
  prompt: string;
  options?: string[];
}
export interface AssessmentSubmit {
  answers: Record<string, string>;
}
export interface Offer {
  factionId: FactionId;
  chief: ChiefId;
  fit: number; // 0..1
  pitch: string;
  role: Mode;
}
export interface AssessmentResult {
  skills: Skills;
  offers: Offer[];
}

// ---- Presence ----
export interface CheckInRequest {
  mode: Mode;
  lat?: number;
  lng?: number;
  accuracyM?: number;
  mock?: boolean; // device reported a mock-location provider
  sim?: boolean; // dev only: simulated position
}
export interface Presence {
  mode: Mode;
  areaId: string | null;
  areaName: string | null;
  expiresAt: string;
}

/** A coarse, anonymised sighting of another on-duty field agent in your area. */
export interface Contact {
  id: string; // rotates daily; never a player id
  lat: number; // snapped to a 100 m grid
  lng: number;
  distanceM: number; // from the caller's last fix, rounded to 10 m
  faction: FactionId | "unknown"; // own faction is named; rivals stay unknown until investigated
}
export interface ContactsResponse { contacts: Contact[] }

// ---- Missions ----
export type MissionState =
  | "pool"
  | "offered"
  | "accepted"
  | "active"
  | "submitted"
  | "completed"
  | "failed"
  | "expired"
  | "cancelled";

export type TemplateId =
  | "DEAD_DROP"
  | "RECON"
  | "EXTRACTION"
  | "CIPHER"
  | "ANALYSIS";

export interface MissionSummary {
  id: string;
  templateId: TemplateId;
  mode: Mode;
  title: string;
  brief: string; // chief-voiced text
  rewardXp: number;
  expiresAt: string;
  state: MissionState;
  contested: boolean;
  areaName: string;
  targetName?: string; // field: destination name (not coordinates)
  walkM?: number; // field: straight-line distance at offer time
  deskLink?: { state: DeskLinkState; fallbackAt: string } | null;
  chain?: { name: string; step: number; of: number } | null; // link of an operation composed by the Director
  crisis?: { name: string; stance: "intercept" | "sabotage" | "mitigate"; joint: string | null } | null; // crisis mission; joint = allied agency it belongs to
  heldBy?: FactionId | null; // agency currently holding the site (first finished keeps it for two hours)
}

// ---- Chaos: crises brewed by the Director ----
export type CrisisStance = "intercept" | "sabotage" | "mitigate";
export interface CrisisView {
  id: string; name: string; kind: string; premise: string; areaName: string; state: string; endsAt: string;
  yourStance: CrisisStance | null; stances: { factionId: FactionId; label: string; stance: CrisisStance }[]; pacts: string[]; allies: string[];
  sites: { name: string; claimedBy: string | null; claimedByFaction: FactionId | null; stance: CrisisStance | null }[];
  outcome: { verdict: string; epilogue: string; leaders: string[] } | null; chaos: number;
}

export interface OffersResponse {
  offers: OfferCard[];
  notice?: string | null; // why the board is empty (closed hours, cap, paused)
}
export interface OfferCard {
  offerId: string;
  mission: MissionSummary;
  acceptBy: string;
}

export type DeskLinkState = "open" | "fulfilled" | "fallback" | "closed";

export interface NavigateResponse {
  targetName: string;
  lat: number;
  lng: number;
  approachRadiusM: number;
  hint: string;
  unlocked: boolean; // false while a desk link is still open
  steps: string[];
  heldBy?: FactionId | null;
}

export interface ScanRequest {
  lat: number;
  lng: number;
  accuracyM?: number;
  mock?: boolean;
  sim?: boolean;
  onSiteCode?: string; // answer to the on-site puzzle, when asked
}
export interface ScanResponse {
  result: "verified" | "rejected" | "needs_code" | "too_far" | "flagged";
  distanceM?: number;
  trustScore?: number;
  reason?: string;
  puzzle?: { prompt: string }; // when result = needs_code
  reward?: { xp: number; trust: number; contestOutcome?: "won" | "lost" | null };
  debrief?: string;
}

export interface DeskMissionDetail {
  mission: MissionSummary;
  puzzle: { kind: "cipher" | "analysis"; prompt: string; options?: string[]; system?: string };
  linkedFieldAgent?: string; // codename
}
export interface DeskSubmitRequest {
  answer: string;
}
export interface DeskSubmitResponse {
  correct: boolean;
  reward?: { xp: number; trust: number };
  debrief?: string;
  unlockedFor?: string;
}

// ---- Chief ----
export interface ChatMessage {
  id: string;
  role: "player" | "chief";
  text: string;
  at: string;
}
export interface Briefing {
  chief: ChiefId;
  chiefName: string;
  factionName: string;
  headline: string;
  standing: { rank: Rank; xp: number; trust: number; nextRankAt: number };
  recent: string[];
  today?: {
    sector: string | null; control: Record<FactionId, number>;
    crisis: { name: string; endsAt: string; stance: CrisisStance | null; allies: string[] } | null;
    operation: { name: string; step: number; of: number } | null;
    hotWindow: string | null; firstTimer: boolean;
  };
}

// ---- World / admin ----
export interface WorldStatus {
  paused: boolean;
  factions: Faction[];
  areas: Area[];
  presenceByArea: Record<string, number>;
  activeMissions: number;
  control?: Record<string, Record<FactionId, number>>; // areaId -> sites held per agency
}
export interface WorldEvent {
  id: number;
  type: string;
  actor: string;
  payload: unknown;
  at: string;
}

// ---- Investigations ----
export type CaseState = "open" | "accused" | "confirmed" | "rejected" | "cooldown";
export interface EvidenceItem {
  id: string;
  file: string; // e.g. CHIP_TRANS_09.LOG
  kind: "intercept" | "geo" | "cipher" | "sighting";
  weight: number; // 0..1
  hintsFaction: FactionId;
  decoyDetected: boolean; // true once an analyst has exposed it
  at: string;
  source: string; // where it came from (mission title, wire, clue)
}
export interface CaseSummary {
  id: string;
  subject: string; // anonymised subject code, e.g. APEX_SHADOW
  state: CaseState;
  confidence: number;
  evidenceCount: number;
  updatedAt: string;
}
export interface CaseDetail extends CaseSummary {
  alignment: { factionId: FactionId; label: string; chief: string; value: number }[];
  evidence: EvidenceItem[];
  accuseThreshold: number;
  decoyDetected: boolean;
  cluesLeftToday: number;
  wireCostCredits: number;
  reveal?: { codename: string; factionId: FactionId } | null; // after a confirmed accusation
  cooldownUntil?: string | null;
}
export interface AccuseResponse {
  correct: boolean;
  reveal?: { codename: string; factionId: FactionId };
  reward: { xp: number; trust: number };
  debrief: string;
}

// ---- Bounties and global events ----
export type BountyStatus = "ELIGIBLE" | "ACTIVE" | "COMPLETED" | "LOCKED" | "EXPIRED";
export interface BountyCard {
  id: string;
  issuer: ChiefId;
  factionId: FactionId | null; // null = open to every agency
  title: string;
  type: string; // e.g. INFILTRATE SECTOR
  brief: string;
  reward: { xp: number; credits: number };
  squad: boolean;
  minRank: Rank;
  status: BountyStatus;
  progress: { done: number; of: number };
  expiresAt: string;
}
export interface GlobalEvent {
  id: string;
  name: string;
  brief: string;
  state: "active" | "resolved";
  endsAt: string;
  progress: { factionId: FactionId; label: string; value: number; fragments: number; of: number }[];
  epilogue?: string | null;
  winner?: FactionId | null;
}
export interface InventoryItem { id: string; name: string; qty: number; note: string }
export interface BoardResponse {
  event: GlobalEvent | null;
  bounties: BountyCard[];
  credits: number;
  inventory: InventoryItem[];
}

// ---- Director dispatches (world news) ----
export interface Dispatch { id: string; kind: string; headline: string; body: string; factionId: FactionId | null; at: string }
