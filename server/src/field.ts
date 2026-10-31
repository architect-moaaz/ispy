import type { FactionId } from "@ispy/shared";
import { all, get, run, now, uid, json, parse, logEvent, db } from "./db.ts";
import { FACTIONS, factionById } from "./content.ts";
import { distanceM, offsetM } from "./geo.ts";
import { rand, pick } from "./puzzles.ts";
import { award } from "./rewards.ts";

/**
 * The ambient layer: what is on the map around you, always, without anyone ordering it.
 *   Caches   = real public places you can "spin" when inside 40 m for intel items (a few minutes' cooldown).
 *   Signals  = short-lived things that spawn near deployed operatives (a courier, a leaked page, a planted bug...),
 *              tapped on the map, walked to, and captured with a steady-hand ritual in the scanner.
 *   Strongholds = one landmark per sector; the agency holding the most sites there owns it.
 * Missions and chiefs stay on top of this as orders; this layer is self-serve.
 */
db.exec(`CREATE TABLE IF NOT EXISTS cache_spins (player_id TEXT NOT NULL, target_id TEXT NOT NULL, at TEXT NOT NULL, PRIMARY KEY(player_id, target_id))`);
db.exec(`CREATE TABLE IF NOT EXISTS signals (
  id TEXT PRIMARY KEY, area_id TEXT NOT NULL, kind TEXT NOT NULL, rarity TEXT NOT NULL, name TEXT NOT NULL,
  lat REAL NOT NULL, lng REAL NOT NULL, near_target TEXT, spawned_at TEXT NOT NULL, expires_at TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'live', captured_by TEXT, captured_at TEXT, attempts TEXT NOT NULL DEFAULT '{}'
)`);
db.exec(`CREATE TABLE IF NOT EXISTS collection (
  player_id TEXT NOT NULL, kind TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0, best_rarity TEXT NOT NULL, first_at TEXT NOT NULL, last_at TEXT NOT NULL,
  PRIMARY KEY(player_id, kind)
)`);

export type Rarity = "common" | "uncommon" | "rare" | "legendary";
const RARITY_ORDER: Rarity[] = ["common", "uncommon", "rare", "legendary"];
const RARITY_XP: Record<Rarity, number> = { common: 25, uncommon: 60, rare: 140, legendary: 320 };
const RARITY_CATCH: Record<Rarity, number> = { common: 0.92, uncommon: 0.8, rare: 0.62, legendary: 0.45 };
const RARITY_TTL_MIN: Record<Rarity, [number, number]> = { common: [12, 20], uncommon: [10, 16], rare: [8, 12], legendary: [6, 9] };

/** Signal kinds, where they like to appear, and their art key (the app maps it to an illustration). */
export const SIGNAL_KINDS: Record<string, { name: string; likes: string[]; weight: number; art: string; blurb: string }> = {
  courier: { name: "Courier", likes: ["bus stop", "station", "entrance", "checkpoint"], weight: 5, art: "extraction", blurb: "Someone carrying something they should not. Follow, do not touch." },
  leak: { name: "Leaked page", likes: ["library", "park", "garden", "landmark"], weight: 5, art: "recon", blurb: "A page of a roster, left where it would be found." },
  bug: { name: "Planted bug", likes: ["park", "garden", "bench", "landmark"], weight: 4, art: "intercept", blurb: "A listening device, still warm." },
  broker: { name: "Broker", likes: ["marketplace", "bus stop", "landmark"], weight: 3, art: "drop", blurb: "Sells the same secret to everyone. Buy before the others." },
  asset: { name: "Sleeper asset", likes: [], weight: 1, art: "drop", blurb: "A name nobody was supposed to know. Rare." },
  jammer: { name: "Jammer", likes: ["monument", "tower", "landmark", "checkpoint"], weight: 2, art: "intercept", blurb: "Degrading every agency's comms. Pull it." },
};
const SPAWN_RADIUS_M = 450;
const PER_OPERATIVE = 4;
const CACHE_RADIUS_M = 40;
const CACHE_COOLDOWN_MS = 5 * 60_000;
const CAPTURE_RADIUS_M = 40;

function rollRarity(seed: string): Rarity {
  const r = rand(seed);
  return r < 0.62 ? "common" : r < 0.87 ? "uncommon" : r < 0.97 ? "rare" : "legendary";
}

/** Keep PER_OPERATIVE live signals within reach of every deployed field operative. Called by the Director's heartbeat. */
export function spawnAround() {
  run("UPDATE signals SET state='expired' WHERE state='live' AND expires_at<=?", now());
  const ops = all<{ player_id: string; area_id: string; lat: number; lng: number }>(
    "SELECT player_id, area_id, last_lat lat, last_lng lng FROM presence WHERE mode='field' AND expires_at>? AND last_lat IS NOT NULL AND area_id IS NOT NULL", now());
  const hour = new Date().getHours();
  let spawned = 0;
  for (const o of ops) {
    const near = all<{ id: string; lat: number; lng: number }>("SELECT id, lat, lng FROM signals WHERE state='live' AND area_id=?", o.area_id).filter((s) => distanceM(o.lat, o.lng, s.lat, s.lng) <= SPAWN_RADIUS_M);
    const want = PER_OPERATIVE - near.length;
    if (want <= 0) continue;
    const sites = all<{ id: string; name: string; kind: string; lat: number; lng: number }>("SELECT id, name, kind, lat, lng FROM targets WHERE area_id=? AND state='ACTIVE'", o.area_id)
      .map((t) => ({ t, d: distanceM(o.lat, o.lng, t.lat, t.lng) })).filter((x) => x.d <= SPAWN_RADIUS_M + 150 && x.d >= 60).sort((a, b) => a.d - b.d);
    for (let i = 0; i < want; i++) {
      const seed = `${o.player_id}:${now().slice(0, 16)}:${i}:${near.length}`;
      // Night favours bugs and jammers; day favours couriers and brokers.
      const kinds = Object.entries(SIGNAL_KINDS).flatMap(([k, v]) => Array(Math.max(1, Math.round(v.weight * ((hour >= 20 || hour < 6) ? (k === "bug" || k === "jammer" ? 2 : 0.6) : 1)))).fill(k));
      const kind = pick(kinds, seed + ":k");
      const def = SIGNAL_KINDS[kind];
      // Place it: near a site this kind likes when one is around, otherwise near any site, otherwise a short hop from the operative.
      const liked = sites.filter((x) => def.likes.some((l) => x.t.kind.includes(l)));
      const base = (liked.length ? pick(liked, seed + ":s") : sites.length ? pick(sites, seed + ":s") : null)?.t;
      const jitter = offsetM(base?.lat ?? o.lat, base?.lng ?? o.lng, (rand(seed + ":n") - 0.5) * 90, (rand(seed + ":e") - 0.5) * 90);
      if (!base) { const far = 120 + rand(seed + ":f") * 200, a = rand(seed + ":a") * Math.PI * 2; const p = offsetM(o.lat, o.lng, far * Math.cos(a), far * Math.sin(a)); jitter.lat = p.lat; jitter.lng = p.lng; }
      const rarity = kind === "asset" ? (rand(seed + ":r") < 0.5 ? "rare" : "legendary") : rollRarity(seed + ":r");
      const [lo, hi] = RARITY_TTL_MIN[rarity];
      const ttl = (lo + rand(seed + ":t") * (hi - lo)) * 60_000;
      const id = uid();
      run("INSERT INTO signals(id,area_id,kind,rarity,name,lat,lng,near_target,spawned_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
        id, o.area_id, kind, rarity, def.name, jitter.lat, jitter.lng, base?.id ?? null, now(), new Date(Date.now() + ttl).toISOString());
      near.push({ id, lat: jitter.lat, lng: jitter.lng });
      spawned++;
    }
  }
  if (spawned) logEvent("signals.spawned", "director", { count: spawned, operatives: ops.length }, null);
  return spawned;
}

export interface SignalView { id: string; kind: string; name: string; rarity: Rarity; art: string; blurb: string; lat: number; lng: number; distanceM: number; expiresAt: string; attemptsLeft: number }
export interface CacheView { id: string; name: string; kind: string; lat: number; lng: number; distanceM: number; readyAt: string | null; inRange: boolean; heldBy: FactionId | null }
export interface StrongholdView { targetId: string; name: string; lat: number; lng: number; holder: FactionId | null; control: Record<FactionId, number> }

/** Everything on the map around a point, for the operative's own agency view. */
export function mapAround(playerId: string, factionId: FactionId | null, areaId: string, lat: number, lng: number): { caches: CacheView[]; signals: SignalView[]; stronghold: StrongholdView | null } {
  run("UPDATE signals SET state='expired' WHERE state='live' AND expires_at<=?", now());
  const caches = all<{ id: string; name: string; kind: string; lat: number; lng: number }>("SELECT id, name, kind, lat, lng FROM targets WHERE area_id=? AND state='ACTIVE'", areaId)
    .map((t) => {
      const d = distanceM(lat, lng, t.lat, t.lng);
      const last = get<{ at: string }>("SELECT at FROM cache_spins WHERE player_id=? AND target_id=?", playerId, t.id);
      const readyAt = last && Date.parse(last.at) + CACHE_COOLDOWN_MS > Date.now() ? new Date(Date.parse(last.at) + CACHE_COOLDOWN_MS).toISOString() : null;
      const lock = get<{ faction_id: FactionId }>("SELECT faction_id FROM target_locks WHERE target_id=? AND until>?", t.id, now());
      return { id: t.id, name: t.name, kind: t.kind, lat: t.lat, lng: t.lng, distanceM: Math.round(d), readyAt, inRange: d <= CACHE_RADIUS_M, heldBy: lock?.faction_id ?? null };
    }).filter((c) => c.distanceM <= 900).sort((a, b) => a.distanceM - b.distanceM);
  const signals = all<{ id: string; kind: string; name: string; rarity: Rarity; lat: number; lng: number; expires_at: string; attempts: string }>(
    "SELECT id, kind, name, rarity, lat, lng, expires_at, attempts FROM signals WHERE state='live' AND area_id=?", areaId)
    .map((s) => ({ id: s.id, kind: s.kind, name: s.name, rarity: s.rarity, art: SIGNAL_KINDS[s.kind]?.art ?? "drop", blurb: SIGNAL_KINDS[s.kind]?.blurb ?? "", lat: s.lat, lng: s.lng, distanceM: Math.round(distanceM(lat, lng, s.lat, s.lng)), expiresAt: s.expires_at, attemptsLeft: Math.max(0, 3 - (parse<Record<string, number>>(s.attempts, {})[playerId] ?? 0)) }))
    .filter((s) => s.distanceM <= 700).sort((a, b) => a.distanceM - b.distanceM);
  return { caches, signals, stronghold: stronghold(areaId) };
}

/** The sector's landmark and who owns it: the agency holding the most sites there. */
export function stronghold(areaId: string): StrongholdView | null {
  const area = get<{ lat: number; lng: number }>("SELECT lat, lng FROM areas WHERE id=?", areaId);
  if (!area) return null;
  const t = get<{ id: string; name: string; lat: number; lng: number }>(
    "SELECT id, name, lat, lng FROM targets WHERE area_id=? AND state='ACTIVE' ORDER BY (kind IN ('landmark','monument','memorial','park','garden')) DESC, ((lat-?)*(lat-?)+(lng-?)*(lng-?)) ASC LIMIT 1", areaId, area.lat, area.lat, area.lng, area.lng);
  if (!t) return null;
  const control = Object.fromEntries(FACTIONS.map((f) => [f.id, 0])) as Record<FactionId, number>;
  for (const r of all<{ faction_id: FactionId; n: number }>("SELECT l.faction_id, COUNT(*) n FROM target_locks l JOIN targets x ON x.id=l.target_id WHERE x.area_id=? AND l.until>? GROUP BY l.faction_id", areaId, now())) control[r.faction_id] = r.n;
  const top = Math.max(...Object.values(control));
  const leaders = (Object.keys(control) as FactionId[]).filter((f) => control[f] === top && top > 0);
  return { targetId: t.id, name: t.name, lat: t.lat, lng: t.lng, holder: leaders.length === 1 ? leaders[0] : null, control };
}

export interface SpinResult { ok: boolean; reason?: string; items?: { id: string; name: string; qty: number }[]; xp?: number; credits?: number; readyAt?: string }
/** Spin a cache: inside 40 m, once per five minutes per cache. */
export function spinCache(playerId: string, targetId: string, lat: number, lng: number): SpinResult {
  const t = get<{ id: string; name: string; lat: number; lng: number }>("SELECT id, name, lat, lng FROM targets WHERE id=? AND state='ACTIVE'", targetId);
  if (!t) return { ok: false, reason: "No such cache." };
  const d = distanceM(lat, lng, t.lat, t.lng);
  if (d > CACHE_RADIUS_M) return { ok: false, reason: `Closer. ${Math.round(d)} m out, ${CACHE_RADIUS_M} m needed.` };
  const last = get<{ at: string }>("SELECT at FROM cache_spins WHERE player_id=? AND target_id=?", playerId, targetId);
  if (last && Date.parse(last.at) + CACHE_COOLDOWN_MS > Date.now()) return { ok: false, reason: "This cache is cold. Come back in a few minutes.", readyAt: new Date(Date.parse(last.at) + CACHE_COOLDOWN_MS).toISOString() };
  const seed = `${playerId}:${targetId}:${now().slice(0, 16)}`;
  const items: { id: string; name: string; qty: number }[] = [];
  const r = rand(seed);
  items.push({ id: "fragment", name: "Cipher fragment", qty: 1 + Math.floor(rand(seed + ":f") * 3) });
  if (r > 0.55) items.push({ id: "decoy", name: "Decoy artifact", qty: 1 });
  if (r > 0.85) items.push({ id: "jammer", name: "Jammer", qty: 1 });
  if (r > 0.96) items.push({ id: "lens", name: "Lens", qty: 1 });
  const credits = 2 + Math.floor(rand(seed + ":c") * 6);
  const p = get<{ items: string }>("SELECT items FROM players WHERE id=?", playerId)!;
  const inv = parse<Record<string, number>>(p.items, {});
  for (const it of items) inv[it.id] = (inv[it.id] ?? 0) + it.qty;
  run("UPDATE players SET items=? WHERE id=?", json(inv), playerId);
  run("INSERT INTO cache_spins(player_id,target_id,at) VALUES(?,?,?) ON CONFLICT(player_id,target_id) DO UPDATE SET at=excluded.at", playerId, targetId, now());
  award(playerId, 15, 0, `cache: ${t.name}`, credits);
  logEvent("cache.spun", "player", { targetId, target: t.name, items }, playerId);
  return { ok: true, items, xp: 15, credits, readyAt: new Date(Date.now() + CACHE_COOLDOWN_MS).toISOString() };
}

export interface CaptureResult { result: "captured" | "escaped" | "fled" | "too_far" | "gone"; distanceM?: number; xp?: number; rarity?: Rarity; name?: string; kind?: string; attemptsLeft?: number; collection?: { kind: string; count: number; best: Rarity } }
/**
 * The ritual: the app reports how steady the hold was (0..1) and whether the flick landed. The server rolls the catch
 * from rarity and hold quality; three failed attempts and the signal flees from this operative.
 */
export function captureSignal(playerId: string, factionId: FactionId | null, signalId: string, lat: number, lng: number, hold: number, flick: boolean): CaptureResult {
  run("UPDATE signals SET state='expired' WHERE state='live' AND expires_at<=?", now());
  const s = get<{ id: string; kind: string; name: string; rarity: Rarity; lat: number; lng: number; attempts: string; state: string }>("SELECT * FROM signals WHERE id=?", signalId);
  if (!s || s.state !== "live") return { result: "gone" };
  const d = distanceM(lat, lng, s.lat, s.lng);
  if (d > CAPTURE_RADIUS_M) return { result: "too_far", distanceM: Math.round(d) };
  const attempts = parse<Record<string, number>>(s.attempts, {});
  const used = attempts[playerId] ?? 0;
  if (used >= 3) return { result: "fled", attemptsLeft: 0 };
  const quality = Math.max(0, Math.min(1, hold)) * (flick ? 1 : 0.6);
  const chance = RARITY_CATCH[s.rarity] * (0.55 + 0.45 * quality);
  const roll = rand(`${signalId}:${playerId}:${used}:${now()}`);
  if (roll > chance) {
    attempts[playerId] = used + 1;
    run("UPDATE signals SET attempts=? WHERE id=?", json(attempts), signalId);
    logEvent("signal.escaped", "player", { signalId, kind: s.kind, rarity: s.rarity, attempt: used + 1 }, playerId);
    return { result: used + 1 >= 3 ? "fled" : "escaped", attemptsLeft: Math.max(0, 2 - used), rarity: s.rarity, name: s.name, kind: s.kind };
  }
  run("UPDATE signals SET state='captured', captured_by=?, captured_at=? WHERE id=?", playerId, now(), signalId);
  const xp = RARITY_XP[s.rarity];
  award(playerId, xp, s.rarity === "common" ? 0 : 1, `${s.name} (${s.rarity})`, s.rarity === "legendary" ? 40 : s.rarity === "rare" ? 15 : 0);
  const prev = get<{ count: number; best_rarity: Rarity }>("SELECT count, best_rarity FROM collection WHERE player_id=? AND kind=?", playerId, s.kind);
  const best = prev && RARITY_ORDER.indexOf(prev.best_rarity) >= RARITY_ORDER.indexOf(s.rarity) ? prev.best_rarity : s.rarity;
  run("INSERT INTO collection(player_id,kind,count,best_rarity,first_at,last_at) VALUES(?,?,?,?,?,?) ON CONFLICT(player_id,kind) DO UPDATE SET count=count+1, best_rarity=?, last_at=?",
    playerId, s.kind, 1, s.rarity, now(), now(), best, now());
  logEvent("signal.captured", "player", { signalId, kind: s.kind, name: s.name, rarity: s.rarity, xp, faction: factionId }, playerId);
  return { result: "captured", distanceM: Math.round(d), xp, rarity: s.rarity, name: s.name, kind: s.kind, collection: { kind: s.kind, count: (prev?.count ?? 0) + 1, best } };
}

export function collectionOf(playerId: string) {
  const rows = all<{ kind: string; count: number; best_rarity: Rarity; first_at: string; last_at: string }>("SELECT * FROM collection WHERE player_id=?", playerId);
  return Object.entries(SIGNAL_KINDS).map(([kind, def]) => {
    const r = rows.find((x) => x.kind === kind);
    return { kind, name: def.name, art: def.art, blurb: def.blurb, count: r?.count ?? 0, best: r?.best_rarity ?? null, firstAt: r?.first_at ?? null };
  });
}

export function fieldOverview() {
  return {
    liveSignals: get<{ n: number }>("SELECT COUNT(*) n FROM signals WHERE state='live' AND expires_at>?", now())!.n,
    capturedToday: get<{ n: number }>("SELECT COUNT(*) n FROM signals WHERE state='captured' AND captured_at>=?", now().slice(0, 10))!.n,
    spinsToday: get<{ n: number }>("SELECT COUNT(*) n FROM cache_spins WHERE at>=?", now().slice(0, 10))!.n,
    strongholds: all<{ id: string }>("SELECT id FROM areas").map((a) => ({ areaId: a.id, ...stronghold(a.id) })).filter((s) => s.name).map((s) => ({ areaId: s.areaId, name: s.name, holder: s.holder ? factionById(s.holder).name : null })),
  };
}
