import type { FactionId } from "@ispy/shared";
import { all, db, get, logEvent, now, run, uid } from "./db.ts";

/**
 * Sign in with Google or Meta. A player is still a codename; an identity is a provider's subject
 * bound to that codename, so the same player comes back on a new phone and a guest can attach an
 * account later. The app sends the provider's token; the server verifies it with the provider,
 * never trusting the client's claim of who they are.
 *
 *   google    an ID token (JWT) from the native SDK or Sign In with Google on the web; checked
 *             with Google's tokeninfo endpoint against GOOGLE_CLIENT_IDS (comma-separated).
 *   facebook  a user access token from the Facebook SDK; checked with Graph's debug_token using
 *             FACEBOOK_APP_ID|FACEBOOK_APP_SECRET, then /me for the name and email.
 *   dev       a made-up subject, accepted only when DEV_SIM=1, so the flow can be walked locally.
 */
db.exec(`CREATE TABLE IF NOT EXISTS identities (
  provider TEXT NOT NULL, subject TEXT NOT NULL, player_id TEXT NOT NULL, email TEXT, name TEXT, avatar TEXT,
  created_at TEXT NOT NULL, last_login_at TEXT NOT NULL, PRIMARY KEY(provider, subject)
)`);
db.exec("CREATE INDEX IF NOT EXISTS identities_player ON identities(player_id)");

export type Provider = "google" | "facebook" | "dev";
export interface Verified { provider: Provider; subject: string; email: string | null; name: string | null; avatar: string | null }
interface IdentityRow { provider: Provider; subject: string; player_id: string; email: string | null; name: string | null; avatar: string | null; created_at: string; last_login_at: string }

const GOOGLE_CLIENT_IDS = (process.env.GOOGLE_CLIENT_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const FB_APP_ID = process.env.FACEBOOK_APP_ID ?? "", FB_APP_SECRET = process.env.FACEBOOK_APP_SECRET ?? "";
const DEV = process.env.DEV_SIM === "1";

/** Which providers this server can verify: the app shows buttons for these only. */
export const providers = () => ({ google: GOOGLE_CLIENT_IDS.length > 0, facebook: !!(FB_APP_ID && FB_APP_SECRET), dev: DEV });

const fail = (status: number, msg: string) => Object.assign(new Error(msg), { status });

export async function verify(provider: Provider, token: string, dev?: { subject: string; email?: string; name?: string }): Promise<Verified> {
  if (provider === "google") {
    if (!GOOGLE_CLIENT_IDS.length) throw fail(400, "Google sign-in is not configured on this server");
    const r = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(token)}`);
    if (!r.ok) throw fail(401, "Google did not accept that sign-in");
    const c = await r.json() as { aud?: string; iss?: string; sub?: string; exp?: string; email?: string; email_verified?: string; name?: string; picture?: string };
    if (!c.sub || !c.aud || !GOOGLE_CLIENT_IDS.includes(c.aud)) throw fail(401, "that Google sign-in was not meant for this app");
    if (c.iss !== "accounts.google.com" && c.iss !== "https://accounts.google.com") throw fail(401, "bad issuer");
    if (c.exp && Number(c.exp) * 1000 < Date.now()) throw fail(401, "that Google sign-in has expired");
    return { provider, subject: c.sub, email: c.email_verified === "true" ? c.email ?? null : null, name: c.name ?? null, avatar: c.picture ?? null };
  }
  if (provider === "facebook") {
    if (!FB_APP_ID || !FB_APP_SECRET) throw fail(400, "Meta sign-in is not configured on this server");
    const d = await fetch(`https://graph.facebook.com/debug_token?input_token=${encodeURIComponent(token)}&access_token=${encodeURIComponent(`${FB_APP_ID}|${FB_APP_SECRET}`)}`);
    const dj = await d.json() as { data?: { is_valid?: boolean; app_id?: string; user_id?: string } };
    if (!d.ok || !dj.data?.is_valid || dj.data.app_id !== FB_APP_ID || !dj.data.user_id) throw fail(401, "Meta did not accept that sign-in");
    const m = await fetch(`https://graph.facebook.com/v19.0/me?fields=id,name,email,picture.type(normal)&access_token=${encodeURIComponent(token)}`);
    const mj = m.ok ? await m.json() as { id: string; name?: string; email?: string; picture?: { data?: { url?: string } } } : { id: dj.data.user_id };
    return { provider, subject: dj.data.user_id, email: mj.email ?? null, name: mj.name ?? null, avatar: mj.picture?.data?.url ?? null };
  }
  if (provider === "dev") {
    if (!DEV) throw fail(403, "dev sign-in is off");
    if (!dev?.subject) throw fail(400, "dev sign-in needs a subject");
    return { provider, subject: dev.subject, email: dev.email ?? null, name: dev.name ?? null, avatar: null };
  }
  throw fail(400, "unknown provider");
}

const newSession = (playerId: string) => { const t = uid() + uid().replace(/-/g, ""); run("INSERT INTO sessions(token,player_id) VALUES(?,?)", t, playerId); return t; };
const codenameTaken = (c: string) => !!get("SELECT 1 FROM players WHERE lower(codename)=lower(?)", c);
export const CODENAME_RE = /^[\w .-]+$/;

/** A codename the provider's name suggests, free of collisions. */
export function suggestCodename(v: Verified): string {
  const base = (v.name ?? v.email?.split("@")[0] ?? "AGENT").toUpperCase().replace(/[^A-Z0-9 ]/g, "").trim().split(/\s+/)[0].slice(0, 12) || "AGENT";
  if (!codenameTaken(base) && base.length >= 3) return base;
  for (let i = 0; i < 50; i++) { const c = `${base}-${Math.floor(10 + Math.random() * 90)}`; if (!codenameTaken(c)) return c; }
  return `${base}-${uid().slice(0, 4).toUpperCase()}`;
}

export type OAuthResult =
  | { token: string; playerId: string; created: boolean; linked: boolean }
  | { needsCodename: true; suggestion: string; provider: Provider; name: string | null; email: string | null };

/**
 * The one entry point. A known identity signs its player in. An unknown one, with a session on the
 * request, is linked to that session's player (a guest attaching an account). Otherwise a new
 * player is created, which needs a codename; without one the caller gets a suggestion back.
 */
export function signIn(v: Verified, currentPlayerId: string | null, codename: string | null): OAuthResult {
  const known = get<IdentityRow>("SELECT * FROM identities WHERE provider=? AND subject=?", v.provider, v.subject);
  if (known) {
    run("UPDATE identities SET last_login_at=?, email=COALESCE(?, email), name=COALESCE(?, name), avatar=COALESCE(?, avatar) WHERE provider=? AND subject=?", now(), v.email, v.name, v.avatar, v.provider, v.subject);
    logEvent("auth.signed_in", "player", { provider: v.provider }, known.player_id);
    return { token: newSession(known.player_id), playerId: known.player_id, created: false, linked: false };
  }
  if (currentPlayerId) {
    if (get("SELECT 1 FROM identities WHERE player_id=? AND provider=?", currentPlayerId, v.provider)) throw fail(409, `this codename already has a ${v.provider === "facebook" ? "Meta" : v.provider} account`);
    run("INSERT INTO identities(provider,subject,player_id,email,name,avatar,created_at,last_login_at) VALUES(?,?,?,?,?,?,?,?)", v.provider, v.subject, currentPlayerId, v.email, v.name, v.avatar, now(), now());
    logEvent("auth.linked", "player", { provider: v.provider }, currentPlayerId);
    return { token: newSession(currentPlayerId), playerId: currentPlayerId, created: false, linked: true };
  }
  if (!codename) return { needsCodename: true, suggestion: suggestCodename(v), provider: v.provider, name: v.name, email: v.email };
  const c = codename.trim();
  if (c.length < 2 || c.length > 24 || !CODENAME_RE.test(c)) throw fail(400, "codename: 2 to 24 letters, digits, space, . _ - only");
  if (codenameTaken(c)) throw fail(409, "codename taken");
  const id = uid();
  run("INSERT INTO players(id,codename,created_at) VALUES(?,?,?)", id, c, now());
  run("INSERT INTO identities(provider,subject,player_id,email,name,avatar,created_at,last_login_at) VALUES(?,?,?,?,?,?,?,?)", v.provider, v.subject, id, v.email, v.name, v.avatar, now(), now());
  logEvent("player.registered", "player", { codename: c, provider: v.provider }, id);
  return { token: newSession(id), playerId: id, created: true, linked: false };
}

export const identitiesOf = (playerId: string) => all<IdentityRow>("SELECT * FROM identities WHERE player_id=? ORDER BY created_at", playerId).map((i) => ({ provider: i.provider, email: i.email, name: i.name, since: i.created_at }));

export function unlink(playerId: string, provider: Provider) {
  const r = run("DELETE FROM identities WHERE player_id=? AND provider=?", playerId, provider);
  if (!r.changes) throw fail(404, "no such linked account");
  logEvent("auth.unlinked", "player", { provider }, playerId);
}

export function signOut(token: string) { run("DELETE FROM sessions WHERE token=?", token); }
