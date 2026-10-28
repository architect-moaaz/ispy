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
  puzzle: { kind: "cipher" | "analysis"; prompt: string; options?: string[] };
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
}

// ---- World / admin ----
export interface WorldStatus {
  paused: boolean;
  factions: Faction[];
  areas: Area[];
  presenceByArea: Record<string, number>;
  activeMissions: number;
}
export interface WorldEvent {
  id: number;
  type: string;
  actor: string;
  payload: unknown;
  at: string;
}
