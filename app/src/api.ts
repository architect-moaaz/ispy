import AsyncStorage from "@react-native-async-storage/async-storage";
import type {
  AssessmentQuestion,
  AssessmentResult,
  AssessmentSubmit,
  Briefing,
  ChatMessage,
  CheckInRequest,
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
  WorldStatus,
} from "@ispy/shared";

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
export type Me = { player: Player; faction: Faction | null; presence: Presence | null };
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
  history: () => get<{ events: { at: string; text: string }[] }>("/v1/profile/history"),
  devTargets: () => get<{ targets: DevTarget[] }>("/v1/dev/targets"),
};
