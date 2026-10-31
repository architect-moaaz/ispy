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
  lock?: { kind: LockKind; tool: ToolId; label: string } | null; // the package's lock, opened with the right tool on site
  unlocked?: boolean; // lock opened (or no lock)
}
export type LockKind = "sealed" | "cipher" | "jammed" | "shadowed";

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
  targetId?: string;
  targetName: string;
  lat: number;
  lng: number;
  approachRadiusM: number;
  hint: string;
  unlocked: boolean; // false while a desk link is still open
  steps: string[];
  heldBy?: FactionId | null;
  heldByCodename?: string | null;
  faceoff?: { id: string; rivalCodename: string; rivalFaction: FactionId; endsAt: string } | null;
  lock?: { kind: LockKind; tool: ToolId; label: string } | null;
  lockOpen?: boolean;
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
  result: "verified" | "rejected" | "needs_code" | "too_far" | "flagged" | "locked";
  lock?: { kind: LockKind; tool: ToolId; label: string } | null; // when result = locked
  distanceM?: number;
  trustScore?: number;
  reason?: string;
  puzzle?: { prompt: string }; // when result = needs_code
  reward?: { xp: number; trust: number; contestOutcome?: "won" | "lost" | null };
  debrief?: string;
  faceoff?: { won: boolean; rival: string; rivalFaction: FactionId; bonusXp: number } | null;
  artifact?: { id: string; kind: string; name: string; dossier: string | null } | null; // recovered at this site; unique in the world
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
    nemesis: { codename: string; factionId: FactionId; faction: string; wins: number; losses: number } | null;
    titles: string[];
    operativeOfTheWeek: string | null;
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

// ---- Ambient field layer: caches, signals, strongholds ----
export type Rarity = "common" | "uncommon" | "rare" | "legendary";
export interface SignalView { id: string; kind: string; name: string; rarity: Rarity; art: string; blurb: string; lat: number; lng: number; distanceM: number; expiresAt: string; attemptsLeft: number }
export interface CacheView { id: string; name: string; kind: string; lat: number; lng: number; distanceM: number; readyAt: string | null; inRange: boolean; heldBy: FactionId | null; heldByCodename: string | null }
export interface StrongholdView { targetId: string; name: string; lat: number; lng: number; holder: FactionId | null; control: Record<FactionId, number> }
export interface OfferPin { offerId: string; missionId: string; lat: number; lng: number; title: string; templateId: TemplateId; targetName: string; walkM: number; rewardXp: number; acceptBy: string; chain?: { name: string; step: number; of: number } | null; crisis?: { name: string; stance: string; joint: string | null } | null; lock?: { kind: LockKind; tool: ToolId; label: string } | null }
export interface MapResponse { caches: CacheView[]; signals: SignalView[]; stronghold: StrongholdView | null; pins: OfferPin[] }
export interface SpinResult { ok: boolean; reason?: string; items?: { id: string; name: string; qty: number }[]; xp?: number; credits?: number; readyAt?: string }
export interface CaptureResult { result: "captured" | "escaped" | "fled" | "too_far" | "gone"; distanceM?: number; xp?: number; rarity?: Rarity; name?: string; kind?: string; attemptsLeft?: number; collection?: { kind: string; count: number; best: Rarity } }
export interface CollectionEntry { kind: string; name: string; art: string; blurb: string; count: number; best: Rarity | null; firstAt: string | null }

// ---- Ladder and titles ----
export interface LadderRow { codename: string; factionId: FactionId; faction: string; score: number; held: number; captures: number; wins: number; title: string | null; you: boolean }
export interface LadderResponse { week: string; sector: string | null; rows: LadderRow[]; yourRank: number | null }
export interface TitleEntry { title: string; week: string; area: string | null }

// ---- Toolkit ----
export type ToolId = "cipher_kit" | "key" | "lens" | "jammer" | "tracker" | "decoy" | "burner" | "fragment";
export interface ToolView { id: ToolId; name: string; permanent: boolean; craft: number | null; blurb: string; use: string; qty: number }
export interface ToolkitResponse { tools: ToolView[]; effects: { kind: string; until: string }[]; fragments: number }
export interface ToolUseResult { ok: boolean; reason?: string; hint?: string; until?: string; detail?: string; qty?: number }

export interface UnlockResult { ok: boolean; reason?: string; wrong?: boolean; detail?: string }

// ---- Classified Archive ----
export type ArtifactKind = "fragment" | "key" | "identity" | "device" | "dud";
export type SecretKind = "location" | "name" | "pattern" | "key" | "truth";
export interface ArchiveView {
  clearance: number; clearanceName: string; nextClearance: { name: string; atXp: number } | null;
  dossiers: { id: string; name: string; secret: SecretKind | "sealed"; fragments: number; held: number; deciphered: number; rivalHeld: number; state: string; reveal: string | null; assembledBy: string | null }[];
  artifacts: { id: string; kind: ArtifactKind; name: string; site: string | null; recoveredBy: string | null; recoveredAt: string | null; examined: boolean; genuine: boolean | null; plantedBy: string | null; deciphered: boolean; corruptedUntil: string | null; prompt: string | null; system: string | null; dossier: string | null; art: string; contents: string; note: string | null; classification: string }[];
  lost: { site: string | null; takenBy: string; at: string }[];
  talks?: { from: string; to: string | null; kind: string; text: string; at: string }[];
}
export interface ArchiveActionResult { ok: boolean; reason?: string; genuine?: boolean; plantedBy?: string | null; note?: string; correct?: boolean; corruptedUntil?: string; secret?: SecretKind; reveal?: string }
