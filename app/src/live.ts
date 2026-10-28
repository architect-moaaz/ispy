import EventSource from "react-native-sse";
import { API_URL, getToken } from "./api";

/**
 * Live events from the server (SSE). One connection while the app is open; screens subscribe to
 * the event types they care about and refetch. Polling stays as a slow backstop.
 */
type Listener = (type: string, data: any) => void;
const listeners = new Set<Listener>();
let es: EventSource | null = null;
let connected = false;
const TYPES = [
  "chief.message", "mission.offered", "mission.accepted", "mission.verified", "mission.expired", "mission.abandoned",
  "desk_link.fulfilled", "desk_link.fallback", "reward", "rank_up", "evidence.found", "evidence.decoy_detected", "case.opened",
  "case.confirmed", "case.rejected", "case.exposed", "bounty.completed", "bounty.claimed", "bounty.published", "world_event.fragment",
  "world_event.published", "world_event.resolved", "director.dispatch", "admin.paused", "admin.resumed", "contest.formed",
  "presence.check_in", "presence.check_out", "location.flagged",
];

export function onLive(fn: Listener) { listeners.add(fn); return () => { listeners.delete(fn); }; }
export const liveConnected = () => connected;

export function connectLive() {
  const token = getToken();
  if (!token || es) return;
  const src = new EventSource(`${API_URL}/v1/stream?token=${encodeURIComponent(token)}`, { pollingInterval: 0 });
  es = src;
  src.addEventListener("open", () => { connected = true; emit("live.open", {}); });
  src.addEventListener("error", () => { connected = false; emit("live.error", {}); });
  src.addEventListener("hello" as any, () => { connected = true; });
  for (const t of TYPES) {
    src.addEventListener(t as any, (e: any) => {
      let data = {};
      try { data = e?.data ? JSON.parse(e.data) : {}; } catch { /* keep empty */ }
      emit(t, data);
    });
  }
}
export function disconnectLive() {
  es?.close();
  es = null;
  connected = false;
}
function emit(type: string, data: any) { for (const l of listeners) { try { l(type, data); } catch { /* listener error must not kill the stream */ } } }
