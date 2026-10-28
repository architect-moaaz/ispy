import { all, get, run, now, logEvent } from "./db.ts";
import { bus, type Signal } from "./bus.ts";

/**
 * Push notifications through the Expo push service, for the few things worth a phone buzz when the
 * app is closed. Quiet outside the sector's playable hours; at most a few an hour per operative.
 */
const EXPO_PUSH = "https://exp.host/--/api/v2/push/send";
const QUIET_FROM = 21, QUIET_TO = 7; // local hours of the server, which is the sector's for the pilot
const MAX_PER_HOUR = 6;

const WORTH_A_BUZZ: Record<string, (p: any) => { title: string; body: string } | null> = {
  "chief.message": () => ({ title: "Your chief", body: "New message on the secure channel." }),
  "mission.offered": (p) => ({ title: "New orders", body: `${String(p.template ?? "A mission").replace("_", " ").toLowerCase()} is on your board. Accept within 90 seconds.` }),
  "desk_link.fulfilled": (p) => ({ title: "Site unlocked", body: `${p.by ?? "Your analyst"} cracked your code. Scan when you arrive.` }),
  "bounty.completed": (p) => ({ title: "Contract closed", body: `${p.title ?? "Your contract"} paid out.` }),
  "case.exposed": () => ({ title: "Cover burned", body: "A rival investigator identified you. Your chief has instructions." }),
  "rank_up": (p) => ({ title: "Promoted", body: `You are now ${String(p.to ?? "").replace("_", " ")}.` }),
};
const PUBLIC_BUZZ: Record<string, (p: any) => { title: string; body: string } | null> = {
  "world_event.published": (p) => ({ title: "New campaign", body: `${p.name} has begun in your sector.` }),
  "world_event.resolved": (p) => ({ title: "Campaign over", body: p.winner ? `${String(p.winner).toUpperCase()} took ${p.name}.` : `${p.name} ended with no winner.` }),
};

export function registerPushToken(playerId: string, token: string) {
  if (!/^Expo(nent)?PushToken\[.+\]$/.test(token)) throw Object.assign(new Error("not an Expo push token"), { status: 400 });
  run("UPDATE players SET push_token=? WHERE id=?", token, playerId);
}
export function unregisterPushToken(playerId: string) { run("UPDATE players SET push_token=NULL WHERE id=?", playerId); }

function quiet() { const h = new Date().getHours(); return h >= QUIET_FROM || h < QUIET_TO; }

async function send(playerId: string, token: string, msg: { title: string; body: string }, type: string) {
  const since = new Date(Date.now() - 3600_000).toISOString();
  const n = get<{ n: number }>("SELECT COUNT(*) n FROM events WHERE type='push.sent' AND player_id=? AND at>?", playerId, since)!.n;
  if (n >= MAX_PER_HOUR) return;
  try {
    const res = await fetch(EXPO_PUSH, {
      method: "POST", headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ to: token, title: msg.title, body: msg.body, sound: "default", data: { type }, priority: "high" }),
    });
    const out: any = await res.json().catch(() => ({}));
    const ticket = out?.data?.[0] ?? out?.data;
    if (ticket?.status === "error" && ticket?.details?.error === "DeviceNotRegistered") unregisterPushToken(playerId);
    logEvent("push.sent", "notifier", { type, status: ticket?.status ?? res.status }, playerId);
  } catch (e) {
    console.warn("[push] send failed:", (e as Error).message);
  }
}

export function startPush() {
  bus.onSignal((s: Signal) => {
    if (quiet()) return;
    const mine = WORTH_A_BUZZ[s.type];
    if (mine && s.playerId) {
      const p = get<{ push_token: string | null }>("SELECT push_token FROM players WHERE id=?", s.playerId);
      const msg = mine(s.payload ?? {});
      if (p?.push_token && msg) void send(s.playerId, p.push_token, msg, s.type);
      return;
    }
    const pub = PUBLIC_BUZZ[s.type];
    if (pub) {
      const msg = pub(s.payload ?? {});
      if (!msg) return;
      for (const r of all<{ id: string; push_token: string }>("SELECT id, push_token FROM players WHERE push_token IS NOT NULL AND faction_id IS NOT NULL")) void send(r.id, r.push_token, msg, s.type);
    }
  });
}

export const pushStats = () => ({ registered: get<{ n: number }>("SELECT COUNT(*) n FROM players WHERE push_token IS NOT NULL")!.n, sentLastHour: get<{ n: number }>("SELECT COUNT(*) n FROM events WHERE type='push.sent' AND at>?", new Date(Date.now() - 3600_000).toISOString())!.n, quietNow: quiet(), at: now() });
