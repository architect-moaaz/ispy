import type { FastifyReply } from "fastify";
import { bus, type Signal } from "./bus.ts";

/**
 * Server-sent events: one connection per open app. An operative receives their own events and the
 * world's public ones; never another operative's. Payloads are kept small; the app refetches what changed.
 */
const MINE = new Set(["chief.message", "mission.offered", "mission.accepted", "mission.verified", "mission.expired", "mission.abandoned",
  "desk_link.fulfilled", "desk_link.fallback", "reward", "rank_up", "signals.spawned", "signal.captured", "cache.spun", "evidence.found", "evidence.decoy_detected", "case.opened", "case.confirmed",
  "case.rejected", "case.exposed", "bounty.completed", "bounty.claimed", "world_event.fragment", "presence.check_in", "presence.check_out", "location.flagged"]);
const PUBLIC = new Set(["world_event.published", "world_event.resolved", "director.dispatch", "admin.paused", "admin.resumed", "bounty.published", "contest.formed"]);

/** What the app is allowed to learn from an event: the type and a few safe fields. */
function publicPayload(s: Signal) {
  const p = s.payload ?? {};
  switch (s.type) {
    case "mission.offered": return { template: p.template };
    case "mission.verified": return { title: p.title, contestOutcome: p.contestOutcome ?? null };
    case "reward": return { xp: p.xp, trust: p.trust, credits: p.credits ?? 0, why: p.why };
    case "rank_up": return { to: p.to };
    case "desk_link.fulfilled": return { by: p.by };
    case "evidence.found": return { subject: p.subject, file: p.file };
    case "case.confirmed": return { subject: p.subject };
    case "bounty.completed": return { title: p.title, credits: p.credits };
    case "world_event.fragment": return { fragments: p.fragments, faction: p.faction };
    case "world_event.published": case "world_event.resolved": return { name: p.name, winner: p.winner ?? null };
    default: return {};
  }
}

let clients = 0;
export const streamClients = () => clients;

export function openStream(playerId: string, reply: FastifyReply) {
  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
    "X-Accel-Buffering": "no",
  });
  reply.raw.write(`retry: 3000\nevent: hello\ndata: {"ok":true}\n\n`);
  clients++;
  const send = (s: Signal) => {
    if (!(s.playerId === playerId && MINE.has(s.type)) && !PUBLIC.has(s.type)) return;
    reply.raw.write(`event: ${s.type}\ndata: ${JSON.stringify({ at: s.at, ...publicPayload(s) })}\n\n`);
  };
  const off = bus.onSignal(send);
  const ping = setInterval(() => reply.raw.write(`: ping\n\n`), 25_000);
  const close = () => { clearInterval(ping); off(); clients--; };
  reply.raw.on("close", close);
  reply.raw.on("error", close);
}
