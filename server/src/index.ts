import Fastify from "fastify";
import cors from "@fastify/cors";
import { z } from "zod";
import type { AssessmentResult, ChatMessage, FactionId, Mode, Offer, Skills } from "@ispy/shared";
import { all, get, run, now, uid, json, parse, logEvent, worldSet } from "./db.ts";
import { seed } from "./seed.ts";
import { ASSESSMENT, FACTIONS, PERSONAS, factionById } from "./content.ts";
import { norm } from "./puzzles.ts";
import { chiefReply, llmEnabled } from "./chiefs.ts";
import * as investigations from "./investigations.ts";
import * as bounties from "./bounties.ts";
import * as chains from "./chains.ts";
import * as crises from "./crises.ts";
import * as field from "./field.ts";
import * as rivalry from "./rivalry.ts";
import * as tools from "./tools.ts";
import * as archive from "./archive.ts";
import * as distractions from "./distractions.ts";
import * as director from "./director.ts";
import * as auditor from "./auditor.ts";
import { directorAgent } from "./directorAgent.ts";
import { startChiefAgents } from "./chiefAgent.ts";
import { openStream, streamClients } from "./stream.ts";
import { registerPushToken, unregisterPushToken, startPush, pushStats } from "./push.ts";
import { allParams } from "./params.ts";
import { CONSOLE_HTML } from "./console.ts";
import { openSector, settleSector, sectorSummary, layWaypoints, retireCheckpoints } from "./sectors.ts";
import { distanceM } from "./geo.ts";
import {
  ApiError, DEV_SIM, abandon, boardNotice, contactsFor, acceptOffer, activeMission, briefing, checkIn, checkOut, declineOffer, deskActive,
  deskSubmit, getPresence, heartbeat, history, navigate, offersFor, playerFaction, playerView, refreshPlans, refreshPool,
  scan, worldStatus, unreadChief, markChiefRead, createTestArea, brewCrisis,
} from "./engine.ts";

const PORT = Number(process.env.PORT ?? 4000);
seed();

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });
await app.register(cors, { origin: true });

app.setErrorHandler((err, _req, reply) => {
  if (err instanceof ApiError || (typeof (err as any).status === "number" && (err as any).status < 500)) return reply.status((err as any).status).send({ error: (err as Error).message });
  if (err instanceof z.ZodError) return reply.status(400).send({ error: err.issues.map((i) => i.message).join("; ") });
  app.log.error(err);
  return reply.status(500).send({ error: "internal error" });
});

// ---- auth ----
app.decorateRequest("player", null);
declare module "fastify" { interface FastifyRequest { player: ReturnType<typeof playerView> | null } }
app.addHook("preHandler", async (req) => {
  const auth = req.headers.authorization;
  const q = (req.query as any)?.token;
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : typeof q === "string" ? q : null;
  if (!token) return;
  const s = get<{ player_id: string }>("SELECT player_id FROM sessions WHERE token=?", token);
  if (s) req.player = playerView(s.player_id);
});
// Admin routes and the console: open in the alpha unless ADMIN_TOKEN is set, then key-protected.
const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? "";
app.addHook("preHandler", async (req, reply) => {
  if (!ADMIN_TOKEN || !req.url.startsWith("/v1/admin")) return;
  const k = req.headers["x-admin-key"] ?? (req.query as any)?.key;
  if (k !== ADMIN_TOKEN) return reply.status(401).send({ error: "admin key required" });
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
  return { player: p, faction: playerFaction(p), presence: getPresence(p.id), unreadChief: unreadChief(p.id) };
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
app.get("/v1/chief/messages", async (req) => { const p = need(req); markChiefRead(p.id); return { messages: chatHistory(p.id) }; });
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

app.get("/v1/world/contacts", async (req) => ({ contacts: contactsFor(need(req)) }));

// ---- ambient field layer ----
app.get("/v1/map", async (req) => {
  const p = need(req);
  const q = z.object({ lat: z.coerce.number().min(-90).max(90), lng: z.coerce.number().min(-180).max(180) }).parse(req.query);
  const pres = get<{ area_id: string | null }>("SELECT area_id FROM presence WHERE player_id=? AND expires_at>?", p.id, now());
  const areaId = pres?.area_id ?? get<{ id: string }>("SELECT id FROM areas ORDER BY ((lat-?)*(lat-?)+(lng-?)*(lng-?)) LIMIT 1", q.lat, q.lat, q.lng, q.lng)?.id;
  if (!areaId) return { caches: [], signals: [], stronghold: null, pins: [] };
  const m = field.mapAround(p.id, p.factionId, areaId, q.lat, q.lng);
  // Offers as pins: the chief's orders drawn where they are.
  const pins = offersFor(p).map((o) => {
    const t = get<{ lat: number; lng: number }>("SELECT t.lat, t.lng FROM missions m JOIN targets t ON t.id=m.target_id WHERE m.id=?", o.mission.id);
    return t ? { offerId: o.offerId, missionId: o.mission.id, lat: t.lat, lng: t.lng, title: o.mission.title, templateId: o.mission.templateId, targetName: o.mission.targetName ?? "", walkM: o.mission.walkM ?? 0, rewardXp: o.mission.rewardXp, acceptBy: o.acceptBy, chain: o.mission.chain ?? null, crisis: o.mission.crisis ?? null, lock: o.mission.lock ?? null } : null;
  }).filter((x): x is NonNullable<typeof x> => !!x);
  return { ...m, pins, distractions: distractions.mineInArea(p.id, p.factionId, areaId), distractionsLeft: distractions.leftToday(p.id) };
});
app.post("/v1/distractions", async (req) => { const p = need(req); return distractions.plant(p.id, p.factionId, z.object({ targetId: z.string() }).parse(req.body).targetId); });
app.post<{ Params: { id: string } }>("/v1/caches/:id/spin", async (req) => {
  const p = need(req);
  const b = z.object({ lat: z.number(), lng: z.number(), sim: z.boolean().optional() }).parse(req.body);
  if (b.sim && !DEV_SIM) throw new ApiError(400, "simulated location is not allowed");
  return field.spinCache(p.id, req.params.id, b.lat, b.lng);
});
app.post<{ Params: { id: string } }>("/v1/signals/:id/capture", async (req) => {
  const p = need(req);
  const b = z.object({ lat: z.number(), lng: z.number(), hold: z.number().min(0).max(1).default(0.5), flick: z.boolean().default(true), sim: z.boolean().optional() }).parse(req.body);
  if (b.sim && !DEV_SIM) throw new ApiError(400, "simulated location is not allowed");
  return field.captureSignal(p.id, p.factionId, req.params.id, b.lat, b.lng, b.hold, b.flick);
});
app.get("/v1/collection", async (req) => ({ collection: field.collectionOf(need(req).id) }));
app.get("/v1/ladder", async (req) => {
  const p = need(req);
  const q = z.object({ areaId: z.string().optional() }).parse(req.query ?? {});
  const pres = getPresence(p.id);
  const areaId = q.areaId ?? pres?.areaId ?? get<{ area_id: string }>("SELECT area_id FROM missions WHERE assignee_id=? ORDER BY created_at DESC LIMIT 1", p.id)?.area_id ?? get<{ id: string }>("SELECT id FROM areas ORDER BY id LIMIT 1")!.id;
  const l = rivalry.ladder(areaId, p.id);
  return { ...l, sector: get<{ name: string }>("SELECT name FROM areas WHERE id=?", areaId)?.name ?? null };
});
app.get("/v1/titles", async (req) => ({ titles: rivalry.titlesOf(need(req).id) }));

// ---- classified archive ----
app.get("/v1/archive", async (req) => { const p = need(req); return { ...archive.archiveOf(p.id, p.rank, p.xp, p.factionId), talks: archive.recentTalks(p.factionId) }; });
app.post<{ Params: { id: string } }>("/v1/archive/:id/examine", async (req) => { const p = need(req); return archive.examine(p.id, p.rank, p.factionId, req.params.id); });
app.post<{ Params: { id: string } }>("/v1/archive/:id/decipher", async (req) => { const p = need(req); return archive.decipher(p.id, p.rank, p.factionId, req.params.id, z.object({ answer: z.string() }).parse(req.body).answer); });
app.post<{ Params: { id: string } }>("/v1/archive/dossiers/:id/assemble", async (req) => { const p = need(req); return archive.assemble(p.id, p.rank, p.factionId, req.params.id); });
app.post("/v1/admin/archive/seed", async (req) => { const b = z.object({ areaId: z.string().optional() }).parse(req.body ?? {}); const areaId = b.areaId ?? get<{ id: string }>("SELECT id FROM areas ORDER BY id LIMIT 1")!.id; return { placed: archive.seed(areaId) }; });
app.post("/v1/admin/archive/moves", async () => ({ moves: await archive.chiefIntelMoves(true) }));

// ---- toolkit ----
app.get("/v1/tools", async (req) => tools.toolkitOf(need(req).id));
app.post<{ Params: { id: string } }>("/v1/missions/:id/unlock", async (req) => {
  const p = need(req);
  const b = z.object({ tool: z.string(), lat: z.number(), lng: z.number(), sim: z.boolean().optional() }).parse(req.body);
  if (b.sim && !DEV_SIM) throw new ApiError(400, "simulated location is not allowed");
  return tools.unlockPackage(p.id, req.params.id, b.tool, b.lat, b.lng, distanceM);
});
app.post("/v1/tools/craft", async (req) => tools.craft(need(req).id, z.object({ tool: z.string() }).parse(req.body).tool));
app.post<{ Params: { tool: string } }>("/v1/tools/:tool/use", async (req) => {
  const p = need(req);
  const b = z.object({ missionId: z.string().optional(), targetId: z.string().optional(), lat: z.number().optional(), lng: z.number().optional(), sim: z.boolean().optional() }).parse(req.body ?? {});
  if (b.sim && !DEV_SIM) throw new ApiError(400, "simulated location is not allowed");
  switch (req.params.tool) {
    case "key": return tools.useKey(p.id, b.missionId ?? "");
    case "lens": return tools.useLens(p.id, b.missionId ?? "");
    case "jammer": return tools.useJammer(p.id);
    case "tracker": return tools.useTracker(p.id);
    case "decoy": return tools.plantDecoy(p.id, p.factionId, b.targetId ?? "", b.lat ?? 0, b.lng ?? 0, distanceM);
    case "burner": {
      const inv = tools.inventoryOf(p.id);
      if ((inv.burner ?? 0) < 1) return { ok: false, reason: "No burner. Craft one from a fragment." };
      inv.burner -= 1; run("UPDATE players SET items=? WHERE id=?", json(inv), p.id);
      for (const o of all<{ id: string }>("SELECT id FROM offers WHERE player_id=? AND state='open'", p.id)) declineOffer(p, o.id);
      const fresh = offersFor(p);
      logEvent("tool.used", "player", { tool: "burner", offers: fresh.length }, p.id);
      return { ok: true, detail: `Re-dealt: ${fresh.length} fresh order${fresh.length === 1 ? "" : "s"} on the board.` };
    }
    default: throw new ApiError(404, "no such tool");
  }
});
app.post("/v1/admin/signals/spawn", async () => ({ spawned: field.spawnAround() }));
// ---- investigations ----
app.get("/v1/investigations", async (req) => ({ cases: investigations.listCases(need(req).id) }));
app.get<{ Params: { id: string } }>("/v1/investigations/:id", async (req) => investigations.caseDetail(need(req).id, req.params.id));
app.post<{ Params: { id: string } }>("/v1/investigations/:id/clue", async (req) => ({ evidence: investigations.requestClue(need(req).id, req.params.id) }));
app.post<{ Params: { id: string } }>("/v1/investigations/:id/wire", async (req) => investigations.requestWire(need(req).id, req.params.id));
app.post<{ Params: { id: string } }>("/v1/investigations/:id/accuse", async (req) =>
  investigations.accuse(need(req).id, req.params.id, z.object({ factionId: z.enum(["raven", "phantom", "cipher"]) }).parse(req.body).factionId));

// ---- bounties & global event ----
app.get("/v1/bounties", async (req) => bounties.board(need(req).id));
app.post<{ Params: { id: string } }>("/v1/bounties/:id/claim", async (req) => { bounties.claimBounty(need(req).id, req.params.id); return { ok: true }; });
app.get("/v1/world/event", async () => ({ event: bounties.currentEvent() }));
app.get("/v1/world/dispatches", async () => ({ dispatches: director.recentDispatches() }));
app.get("/v1/world/crisis", async (req) => {
  const p = req.player;
  const pres = p ? getPresence(p.id) : null;
  return { crisis: crises.view(p?.factionId ?? null, pres?.areaId) };
});
app.post("/v1/admin/crisis", async (req) => {
  const b = z.object({ areaId: z.string().optional(), kind: z.enum(["courier", "jammer", "auction", "leak"]).optional(), minutes: z.number().int().min(30).max(240).optional(), theme: z.string().max(200).optional() }).parse(req.body ?? {});
  const areaId = b.areaId ?? get<{ area_id: string }>("SELECT area_id FROM presence WHERE mode='field' AND expires_at>? AND area_id IS NOT NULL GROUP BY area_id ORDER BY COUNT(*) DESC LIMIT 1", now())?.area_id ?? get<{ id: string }>("SELECT id FROM areas ORDER BY id LIMIT 1")!.id;
  const c = await brewCrisis(areaId, b);
  return { crisis: c ? crises.view(null, areaId) : null };
});
app.post("/v1/admin/crisis/resolve", async () => { const c = crises.activeCrisis(); if (c) await crises.resolve(c.id); return { ok: true }; });
app.get("/v1/admin/audit", async () => ({ audits: auditor.latestAudits() }));
app.post("/v1/admin/audit", async () => auditor.runAudit(1));
app.post("/v1/admin/dispatch", async () => { await director.publishDispatches(true); return { dispatches: director.recentDispatches(3) }; });

// ---- live stream & push ----
app.get("/v1/stream", async (req, reply) => { const p = need(req); openStream(p.id, reply); return reply; });
app.post("/v1/push/register", async (req) => { registerPushToken(need(req).id, z.object({ token: z.string() }).parse(req.body).token); return { ok: true }; });
app.post("/v1/push/unregister", async (req) => { unregisterPushToken(need(req).id); return { ok: true }; });
app.get("/v1/admin/push", async () => ({ ...pushStats(), streamClients: streamClients() }));

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
app.post("/v1/admin/areas/test", async (req) => {
  const b = z.object({ name: z.string().min(2).max(40), lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), radiusM: z.number().min(400).max(3000).optional() }).parse(req.body);
  const out = createTestArea(b.name, b.lat, b.lng, b.radiusM);
  await tick(true);
  return out;
});
app.get("/v1/admin/director", async () => ({ ...directorAgent.status(), params: allParams() }));
app.post("/v1/admin/areas/open", async (req) => {
  const b = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).parse(req.body);
  const a = openSector(b.lat, b.lng, null);
  await layWaypoints(a.id);
  await refreshPlans(true, { areaId: a.id, reason: "a new sector was opened by survey" });
  refreshPool();
  const settled = await settleSector(a.id);
  refreshPool();
  return { id: a.id, ...settled };
});
/** Everything the console shows, in one call. */
app.get("/v1/admin/overview", async () => {
  const sectors = sectorSummary().map((a) => ({ ...a, pool: get<{ n: number }>("SELECT COUNT(*) n FROM missions WHERE area_id=? AND state='pool'", a.id)!.n }));
  const inPlay = new Set(all<{ target_id: string }>("SELECT DISTINCT target_id FROM missions WHERE target_id IS NOT NULL AND state IN ('offered','accepted','active')").map((r) => r.target_id));
  const targets = all<{ id: string; name: string; kind: string; lat: number; lng: number }>("SELECT id, name, kind, lat, lng FROM targets WHERE state='ACTIVE'").map((t) => ({ ...t, inPlay: inPlay.has(t.id) }));
  const operatives = all<{ player_id: string; codename: string; faction_id: FactionId | null; mode: string; area_id: string | null; checked_in_at: string; last_lat: number | null; last_lng: number | null; last_fix_at: string | null }>(
    "SELECT p.player_id, pl.codename, pl.faction_id, p.mode, p.area_id, p.checked_in_at, p.last_lat, p.last_lng, p.last_fix_at FROM presence p JOIN players pl ON pl.id=p.player_id WHERE p.expires_at>?", now())
    .map((p) => ({
      codename: p.codename, factionId: p.faction_id, faction: p.faction_id ? factionById(p.faction_id).name : "—", mode: p.mode,
      area: p.area_id ? get<{ name: string }>("SELECT name FROM areas WHERE id=?", p.area_id)?.name ?? null : null,
      checkedInAt: p.checked_in_at, lat: p.last_lat, lng: p.last_lng, lastFixAt: p.last_fix_at,
      activeMission: get<{ title: string }>("SELECT title FROM missions WHERE assignee_id=? AND state='active' LIMIT 1", p.player_id)?.title ?? null,
      openOffers: get<{ n: number }>("SELECT COUNT(*) n FROM offers WHERE player_id=? AND state='open' AND expires_at>?", p.player_id, now())!.n,
    }));
  const missions = all<{ id: string; title: string; faction_id: FactionId; state: string; created_at: string; contested_group_id: string | null; assignee: string | null; target: string | null }>(
    `SELECT m.id, m.title, m.faction_id, m.state, m.created_at, m.contested_group_id, pl.codename assignee, t.name target FROM missions m
     LEFT JOIN players pl ON pl.id=m.assignee_id LEFT JOIN targets t ON t.id=m.target_id WHERE m.state IN ('offered','accepted','active') ORDER BY m.created_at DESC LIMIT 40`)
    .map((m) => ({ id: m.id, title: m.title, factionId: m.faction_id, faction: factionById(m.faction_id).name, state: m.state, createdAt: m.created_at, contested: !!m.contested_group_id, assignee: m.assignee, target: m.target }));
  const chat = all<{ player_id: string; codename: string; faction_id: FactionId | null; role: string; text: string; at: string }>(
    "SELECT c.player_id, pl.codename, pl.faction_id, c.role, c.text, c.at FROM chat c JOIN players pl ON pl.id=c.player_id ORDER BY c.at DESC LIMIT 30")
    .map((c) => ({ codename: c.codename, factionId: c.faction_id, chief: c.faction_id ? factionById(c.faction_id).chiefName : "—", role: c.role, text: c.text, at: c.at }));
  const events = all<{ id: number; type: string; actor: string; payload: string; at: string; codename: string | null }>(
    "SELECT e.id, e.type, e.actor, e.payload, e.at, pl.codename FROM events e LEFT JOIN players pl ON pl.id=e.player_id ORDER BY e.id DESC LIMIT 120")
    .map((e) => ({ id: e.id, type: e.type, actor: e.actor, payload: parse(e.payload, {}), at: e.at, codename: e.codename }));
  return {
    world: { ...worldStatus(), devSim: DEV_SIM, llm: llmEnabled() },
    director: { ...directorAgent.status(), params: allParams() },
    push: { ...pushStats(), streamClients: streamClients() },
    sectors, targets, operatives, missions, chat, events, operations: chains.chainsOverview(), crises: crises.overview(),
    field: field.fieldOverview(), rivalry: rivalry.rivalryOverview(), tools: tools.toolsOverview(), archive: archive.archiveOverview(), distractions: distractions.overview(),
    funnel: {
      registered: get<{ n: number }>("SELECT COUNT(*) n FROM players")!.n,
      assessed: get<{ n: number }>("SELECT COUNT(*) n FROM assessments")!.n,
      recruited: get<{ n: number }>("SELECT COUNT(*) n FROM players WHERE faction_id IS NOT NULL")!.n,
      firstDesk: get<{ n: number }>("SELECT COUNT(DISTINCT assignee_id) n FROM missions WHERE mode='desk' AND state='completed'")!.n,
      firstField: get<{ n: number }>("SELECT COUNT(DISTINCT assignee_id) n FROM missions WHERE mode='field' AND state='completed'")!.n,
      returned: get<{ n: number }>("SELECT COUNT(*) n FROM (SELECT player_id FROM events WHERE player_id IS NOT NULL GROUP BY player_id HAVING COUNT(DISTINCT substr(at,1,10))>=2)")!.n,
      activeToday: get<{ n: number }>("SELECT COUNT(DISTINCT player_id) n FROM events WHERE player_id IS NOT NULL AND at>=?", now().slice(0, 10))!.n,
      sectorHoursToday: get<{ n: number }>("SELECT COUNT(DISTINCT area_id || substr(at,12,2)) n FROM (SELECT json_extract(payload,'$.areaId') area_id, at FROM events WHERE type='presence.check_in' AND at>=?)", now().slice(0, 10))!.n,
    },
  };
});
app.get("/console", async (_req, reply) => reply.type("text/html; charset=utf-8").send(CONSOLE_HTML));

// ---- the World Director lives here; the forced tick remains for tests ----
let lastAudit = 0;
async function tick(force = false) {
  try {
    await refreshPlans(force);
    refreshPool();
    bounties.refreshBounties();
    await bounties.refreshEvent();
    await director.publishDispatches(force);
    if (force || Date.now() - lastAudit > 3600_000) { auditor.runAudit(1); lastAudit = Date.now(); }
  } catch (e) { app.log.error(e, "tick failed"); }
}
await tick();
startChiefAgents();
retireCheckpoints().catch((e) => console.warn("[sectors] checkpoint migration failed:", (e as Error).message));
startPush();
directorAgent.start();

await app.listen({ port: PORT, host: "0.0.0.0" });
app.log.info(`iSpy server on :${PORT} devSim=${DEV_SIM} llm=${llmEnabled()}`);
