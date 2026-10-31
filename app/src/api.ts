import AsyncStorage from "@react-native-async-storage/async-storage";
import type {
  AccuseResponse,
  AssessmentQuestion,
  BoardResponse,
  CaseDetail,
  CaseSummary,
  Dispatch,
  EvidenceItem,
  FactionId as FactionIdT,
  AssessmentResult,
  AssessmentSubmit,
  Briefing,
  ChatMessage,
  CheckInRequest,
  ContactsResponse,
  DeskMissionDetail,
  DeskSubmitResponse,
  Faction,
  FactionId,
  MissionSummary,
  NavigateResponse,
  OfferCard,
  OffersResponse,
  Player,
  Presence,
  ScanRequest,
  ScanResponse,
  WorldStatus, CrisisView, MapResponse, SpinResult, CaptureResult, CollectionEntry, LadderResponse, TitleEntry, ToolkitResponse, ToolUseResult, UnlockResult, ArchiveView, ArchiveActionResult, PlantResult, BackChannelOptions, TipResult } from "@ispy/shared";

export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000";
const TOKEN_KEY = "ispy.token";

let token: string | null = null;
let onUnauthorized: (() => void) | null = null;

export async function loadToken() {
  try {
    token = await AsyncStorage.getItem(TOKEN_KEY);
  } catch {
    token = null;
  }
  return token;
}
export const getToken = () => token;
export async function setToken(t: string | null) {
  token = t;
  try {
    if (t) await AsyncStorage.setItem(TOKEN_KEY, t);
    else await AsyncStorage.removeItem(TOKEN_KEY);
  } catch {
    // storage unavailable: keep in memory only
  }
}
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401) {
    await setToken(null);
    onUnauthorized?.();
    throw new ApiError(401, "Session expired");
  }
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `HTTP ${res.status}`);
  return data as T;
}
const get = <T,>(p: string) => request<T>("GET", p);
const post = <T,>(p: string, b?: unknown) => request<T>("POST", p, b ?? {});

export type World = WorldStatus & { devSim: boolean };
export type Me = { player: Player; faction: Faction | null; presence: Presence | null; unreadChief?: number };
export type DevTarget = { id: string; name: string; lat: number; lng: number };

export const api = {
  world: () => get<World>("/v1/world"),
  register: (codename: string) => post<{ token: string; player: Player }>("/v1/auth/register", { codename }),
  me: () => get<Me>("/v1/me"),
  assessment: () => get<{ questions: AssessmentQuestion[] }>("/v1/assessment"),
  submitAssessment: (b: AssessmentSubmit) => post<AssessmentResult>("/v1/assessment", b),
  acceptOffer: (factionId: FactionId) => post<{ player: Player }>("/v1/recruitment/accept", { factionId }),
  checkIn: (b: CheckInRequest) => post<Presence>("/v1/presence/check-in", b),
  heartbeat: (b: { lat?: number; lng?: number; sim?: boolean }) => post<Presence>("/v1/presence/heartbeat", b),
  checkOut: () => post<{ ok: true }>("/v1/presence/check-out"),
  offers: () => get<OffersResponse>("/v1/offers"),
  acceptMission: (offerId: string) => post<{ mission: MissionSummary }>(`/v1/offers/${offerId}/accept`),
  declineMission: (offerId: string) => post<{ ok: true }>(`/v1/offers/${offerId}/decline`),
  activeMission: () => get<{ mission: MissionSummary | null }>("/v1/missions/active"),
  navigate: (id: string) => get<NavigateResponse>(`/v1/missions/${id}/navigate`),
  scan: (id: string, b: ScanRequest) => post<ScanResponse>(`/v1/missions/${id}/scan`, b),
  abandon: (id: string) => post<{ ok: true }>(`/v1/missions/${id}/abandon`),
  deskActive: () => get<DeskMissionDetail | { mission: null }>("/v1/desk/active"),
  deskSubmit: (id: string, answer: string) => post<DeskSubmitResponse>(`/v1/desk/${id}/submit`, { answer }),
  briefing: () => get<Briefing>("/v1/chief/briefing"),
  messages: () => get<{ messages: ChatMessage[] }>("/v1/chief/messages"),
  sendMessage: (text: string) => post<{ reply: ChatMessage }>("/v1/chief/messages", { text }),
  cases: () => get<{ cases: CaseSummary[] }>("/v1/investigations"),
  caseDetail: (id: string) => get<CaseDetail>(`/v1/investigations/${id}`),
  clue: (id: string) => post<{ evidence: EvidenceItem }>(`/v1/investigations/${id}/clue`),
  wire: (id: string) => post<{ evidence: EvidenceItem; credits: number }>(`/v1/investigations/${id}/wire`),
  accuse: (id: string, factionId: FactionIdT) => post<AccuseResponse>(`/v1/investigations/${id}/accuse`, { factionId }),
  registerPush: (token: string) => post<{ ok: true }>("/v1/push/register", { token }),
  dispatches: () => get<{ dispatches: Dispatch[] }>("/v1/world/dispatches"),
  crisis: () => get<{ crisis: CrisisView | null }>("/v1/world/crisis"),
  board: () => get<BoardResponse>("/v1/bounties"),
  claimBounty: (id: string) => post<{ ok: true }>(`/v1/bounties/${id}/claim`),
  contacts: () => get<ContactsResponse>("/v1/world/contacts"),
  map: (lat: number, lng: number) => get<MapResponse>(`/v1/map?lat=${lat}&lng=${lng}`),
  spinCache: (id: string, fix: { lat: number; lng: number; sim?: boolean }) => post<SpinResult>(`/v1/caches/${id}/spin`, fix),
  captureSignal: (id: string, body: { lat: number; lng: number; hold: number; flick: boolean; sim?: boolean }) => post<CaptureResult>(`/v1/signals/${id}/capture`, body),
  collection: () => get<{ collection: CollectionEntry[] }>("/v1/collection"),
  ladder: () => get<LadderResponse>("/v1/ladder"),
  tools: () => get<ToolkitResponse>("/v1/tools"),
  archive: () => get<ArchiveView>("/v1/archive"),
  plantDistraction: (targetId: string) => post<PlantResult>("/v1/distractions", { targetId }),
  backchannel: () => get<BackChannelOptions>("/v1/backchannel"),
  sendTip: (toFaction: string, kind: "sell" | "plant", refId: string) => post<TipResult>("/v1/backchannel", { toFaction, kind, refId }),
  examine: (id: string) => post<ArchiveActionResult>(`/v1/archive/${id}/examine`),
  decipherArtifact: (id: string, answer: string) => post<ArchiveActionResult>(`/v1/archive/${id}/decipher`, { answer }),
  assemble: (dossierId: string) => post<ArchiveActionResult>(`/v1/archive/dossiers/${dossierId}/assemble`),
  unlock: (missionId: string, body: { tool: string; lat: number; lng: number; sim?: boolean }) => post<UnlockResult>(`/v1/missions/${missionId}/unlock`, body),
  craft: (tool: string) => post<ToolUseResult>("/v1/tools/craft", { tool }),
  useTool: (tool: string, body: { missionId?: string; targetId?: string; lat?: number; lng?: number; sim?: boolean } = {}) => post<ToolUseResult>(`/v1/tools/${tool}/use`, body),
  titles: () => get<{ titles: TitleEntry[] }>("/v1/titles"),
  history: () => get<{ events: { at: string; text: string }[] }>("/v1/profile/history"),
  devTargets: () => get<{ targets: DevTarget[] }>("/v1/dev/targets"),
};
