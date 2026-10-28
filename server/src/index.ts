import Fastify from "fastify";
import cors from "@fastify/cors";
import { z } from "zod";
import type { AssessmentResult, ChatMessage, FactionId, Mode, Offer, Skills } from "@ispy/shared";
import { all, get, run, now, uid, json, parse, logEvent, worldSet } from "./db.ts";
import { seed } from "./seed.ts";
import { ASSESSMENT, FACTIONS, PERSONAS, factionById } from "./content.ts";
import { norm } from "./puzzles.ts";
import { chiefReply, llmEnabled } from "./chiefs.ts";
import {
  ApiError, DEV_SIM, abandon, boardNotice, acceptOffer, activeMission, briefing, checkIn, checkOut, declineOffer, deskActive,
  deskSubmit, getPresence, heartbeat, history, navigate, offersFor, playerFaction, playerView, refreshPlans, refreshPool,
  scan, worldStatus,
} from "./engine.ts";

const PORT = Number(process.env.PORT ?? 4000);
seed();

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });
await app.register(cors, { origin: true });

app.setErrorHandler((err, _req, reply) => {
  if (err instanceof ApiError) return reply.status(err.status).send({ error: err.message });
  if (err instanceof z.ZodError) return reply.status(400).send({ error: err.issues.map((i) => i.message).join("; ") });
  app.log.error(err);
  return reply.status(500).send({ error: "internal error" });
});

// ---- auth ----
app.decorateRequest("player", null);
declare module "fastify" { interface FastifyRequest { player: ReturnType<typeof playerView> | null } }
app.addHook("preHandler", async (req) => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return;
  const s = get<{ player_id: string }>("SELECT player_id FROM sessions WHERE token=?", auth.slice(7));
  if (s) req.player = playerView(s.player_id);
});
const need = (req: { player: ReturnType<typeof playerView> | null }) => {
  if (!req.player) throw new ApiError(401, "sign in first");
  return req.player;
};

// ---- public ----
app.get("/v1/world", async () => ({ ...worldStatus(), devSim: DEV_SIM, llm: llmEnabled() }));

app.post("/v1/auth/register", async (req) => {
  const { codename } = z.object({ codename: z.string().trim().min(2).max(24).regex(/^[\w .-]+$/, "letters, digits, space, . _ - only") }).parse(req.body);
  if (get("SELECT 1 FROM players WHERE lower(codename)=lower(?)", codename)) throw new ApiError(409, "codename taken");
  const id = uid();
  run("INSERT INTO players(id,codename,created_at) VALUES(?,?,?)", id, codename, now());
  const token = uid() + uid().replace(/-/g, "");
  run("INSERT INTO sessions(token,player_id) VALUES(?,?)", token, id);
  logEvent("player.registered", "player", { codename }, id);
  return { token, player: playerView(id) };
});

app.get("/v1/me", async (req) => {
  const p = need(req);
  return { player: p, faction: playerFaction(p), presence: getPresence(p.id) };
});

// ---- onboarding ----
app.get("/v1/assessment", async (req) => {
  need(req);
  return { questions: ASSESSMENT.map(({ answer: _a, ...q }) => q) };
});

app.post("/v1/assessment", async (req): Promise<AssessmentResult> => {
  const p = need(req);
  const { answers } = z.object({ answers: z.record(z.string()) }).parse(req.body);
  const perSkill: Record<string, number[]> = {};
  for (const q of ASSESSMENT) {
    const ok = norm(answers[q.id] ?? "") === norm(q.answer) ? 1 : 0;
    (perSkill[q.skill] ??= []).push(ok);
  }
  const skills: Skills = { observation: 0.5, reasoning: 0.5, cipher: 0.5, cooperation: 0.5 };
  for (const k of Object.keys(skills) as (keyof Skills)[]) {
    const v = perSkill[k] ?? [];
    // Shrink toward 0.5 for small samples so one question never defines a player.
    skills[k] = v.length ? (v.reduce((a, b) => a + b, 0) + 1) / (v.length + 2) : 0.5;
  }
  // Each chief scores fit independently with its own weights; at least one offer is guaranteed.
  const offers: Offer[] = FACTIONS.map((f) => {
    const w = PERSONAS[f.chief].weights;
    const fit = (Object.keys(w) as (keyof Skills)[]).reduce((s, k) => s + w[k] * skills[k], 0);
    const role: Mode = skills.cipher + skills.reasoning > skills.observation + skills.cooperation ? "desk" : "field";
    return { factionId: f.id, chief: f.chief, fit: Math.round(fit * 100) / 100, pitch: PERSONAS[f.chief].pitch(fit, role), role };
  }).sort((a, b) => b.fit - a.fit);
  const kept = offers.filter((o, i) => i === 0 || o.fit >= 0.45);
  run("INSERT OR REPLACE INTO assessments(player_id,answers,skills,offers,at) VALUES(?,?,?,?,?)", p.id, json(answers), json(skills), json(kept), now());
  run("UPDATE players SET skills=? WHERE id=?", json(skills), p.id);
  logEvent("assessment.scored", "authority", { skills, offers: kept.map((o) => o.factionId) }, p.id);
  return { skills, offers: kept };
});

app.post("/v1/recruitment/accept", async (req) => {
  const p = need(req);
  const { factionId } = z.object({ factionId: z.enum(["raven", "phantom", "cipher"]) }).parse(req.body);
  if (p.factionId) throw new ApiError(409, "already recruited");
  const a = get<{ offers: string }>("SELECT offers FROM assessments WHERE player_id=?", p.id);
  const offers = parse<Offer[]>(a?.offers, []);
  if (!offers.some((o) => o.factionId === factionId)) throw new ApiError(400, "no offer from that agency");
  const f = factionById(factionId as FactionId);
  run("UPDATE players SET faction_id=?, rank='recruit' WHERE id=?", factionId, p.id);
  logEvent("recruited", `chief:${f.chief}`, { faction: f.name }, p.id);
  run("INSERT INTO chat(id,player_id,role,text,at) VALUES(?,?,?,?,?)", uid(), p.id, "chief", PERSONAS[f.chief].lines.welcome[0], now());
  return { player: playerView(p.id) };
});

// ---- presence ----
const fix = { lat: z.number().min(-90).max(90).optional(), lng: z.number().min(-180).max(180).optional(), accuracyM: z.number().optional(), mock: z.boolean().optional(), sim: z.boolean().optional() };
app.post("/v1/presence/check-in", async (req) => checkIn(need(req), z.object({ mode: z.enum(["field", "desk"]), ...fix }).parse(req.body)));
app.post("/v1/presence/heartbeat", async (req) => heartbeat(need(req), z.object(fix).parse(req.body ?? {})));
app.post("/v1/presence/check-out", async (req) => { checkOut(need(req)); return { ok: true }; });

// ---- offers & missions ----
app.get("/v1/offers", async (req) => {
  const p = need(req);
  return { offers: offersFor(p), notice: boardNotice(p, getPresence(p.id)) };
});
app.post<{ Params: { id: string } }>("/v1/offers/:id/accept", async (req) => ({ mission: acceptOffer(need(req), req.params.id) }));
app.post<{ Params: { id: string } }>("/v1/offers/:id/decline", async (req) => { declineOffer(need(req), req.params.id); return { ok: true }; });
app.get("/v1/missions/active", async (req) => ({ mission: activeMission(need(req), "field") }));
app.get<{ Params: { id: string } }>("/v1/missions/:id/navigate", async (req) => navigate(need(req), req.params.id));
app.post<{ Params: { id: string } }>("/v1/missions/:id/scan", async (req) =>
  scan(need(req), req.params.id, z.object({ lat: z.number(), lng: z.number(), accuracyM: z.number().optional(), mock: z.boolean().optional(), sim: z.boolean().optional(), onSiteCode: z.string().max(64).optional() }).parse(req.body)));
app.post<{ Params: { id: string } }>("/v1/missions/:id/abandon", async (req) => { abandon(need(req), req.params.id); return { ok: true }; });

// ---- desk ----
app.get("/v1/desk/active", async (req) => {
  const p = need(req);
  let d = deskActive(p);
  if (!d && getPresence(p.id)?.mode === "desk") {
    // Desk agents take the first offer automatically: there is nothing to walk to.
    const o = offersFor(p)[0];
    if (o) { acceptOffer(p, o.offerId); d = deskActive(p); }
  }
  return d ?? { mission: null };
});
app.post<{ Params: { id: string } }>("/v1/desk/:id/submit", async (req) =>
  deskSubmit(need(req), req.params.id, z.object({ answer: z.string().max(64) }).parse(req.body).answer));

// ---- chief ----
app.get("/v1/chief/briefing", async (req) => briefing(need(req)));
app.get("/v1/chief/messages", async (req) => ({ messages: chatHistory(need(req).id) }));
app.post("/v1/chief/messages", async (req) => {
  const p = need(req);
  const f = playerFaction(p);
  if (!f) throw new ApiError(400, "join a faction first");
  const { text } = z.object({ text: z.string().trim().min(1).max(500) }).parse(req.body);
  const dayCount = get<{ n: number }>("SELECT COUNT(*) n FROM chat WHERE player_id=? AND role='player' AND at>?", p.id, new Date(Date.now() - 86_400_000).toISOString())!.n;
  if (dayCount >= 60) throw new ApiError(429, "your chief has heard enough for today");
  run("INSERT INTO chat(id,player_id,role,text,at) VALUES(?,?,?,?,?)", uid(), p.id, "player", text, now());
  const b = briefing(p);
  const reply = await chiefReply(f.chief, f, {
    codename: p.codename, rank: p.rank, trust: p.trust, recent: b.recent,
    standing: `${p.xp} XP, next rank at ${b.standing.nextRankAt}`,
  }, chatHistory(p.id), text);
  const msg: ChatMessage = { id: uid(), role: "chief", text: reply, at: now() };
  run("INSERT INTO chat(id,player_id,role,text,at) VALUES(?,?,?,?,?)", msg.id, p.id, "chief", msg.text, msg.at);
  return { reply: msg };
});
const chatHistory = (playerId: string): ChatMessage[] =>
  all<ChatMessage>("SELECT id, role, text, at FROM chat WHERE player_id=? ORDER BY at DESC LIMIT 40", playerId).reverse();

app.get("/v1/profile/history", async (req) => ({ events: history(need(req).id) }));

// ---- dev & admin ----
app.get("/v1/dev/targets", async () => {
  if (!DEV_SIM) throw new ApiError(404, "not found");
  return { targets: all("SELECT id, name, lat, lng FROM targets WHERE state='ACTIVE'") };
});
app.get("/v1/admin/events", async () => ({
  events: all<{ id: number; type: string; actor: string; payload: string; at: string }>("SELECT * FROM events ORDER BY id DESC LIMIT 200")
    .map((e) => ({ id: e.id, type: e.type, actor: e.actor, payload: parse(e.payload, {}), at: e.at })),
}));
app.post("/v1/admin/pause", async (req) => {
  const { paused } = z.object({ paused: z.boolean() }).parse(req.body);
  worldSet("paused", paused ? "1" : "0");
  logEvent(paused ? "admin.paused" : "admin.resumed", "owner", {}, null);
  return { paused };
});
app.post("/v1/admin/tick", async () => { await tick(true); return { ok: true }; });

// ---- loops: hourly strategy, 5-minute pool ----
async function tick(force = false) {
  try { await refreshPlans(force); refreshPool(); } catch (e) { app.log.error(e, "tick failed"); }
}
await tick();
setInterval(() => void tick(), 5 * 60_000);

await app.listen({ port: PORT, host: "0.0.0.0" });
app.log.info(`iSpy server on :${PORT} devSim=${DEV_SIM} llm=${llmEnabled()}`);
