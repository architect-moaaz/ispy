import { get, run, now, logEvent } from "./db.ts";

/**
 * World parameters: the knobs the Director may turn to shape the game. Each has a default
 * and hard bounds the Director cannot exceed; the Owner can widen bounds only by editing
 * this file. Every change is logged for the Auditor. Chiefs and operatives never see them.
 */
export const PARAM_SPEC = {
  rewardMultiplier: { def: 1.0, min: 0.7, max: 1.6, note: "scales mission XP" },
  walkScale: { def: 1.0, min: 0.6, max: 1.3, note: "scales every rank's walk radius" },
  contestsPerHour: { def: 3, min: 0, max: 8, note: "cap on contested targets formed per area per hour" },
  contestAppetiteBoost: { def: 0, min: -0.3, max: 0.3, note: "added to every chief's contest appetite" },
  poolPerMode: { def: 3, min: 2, max: 8, note: "ready missions kept per faction, area and mode" },
  offerTtlSec: { def: 90, min: 45, max: 240, note: "seconds an offer stays open" },
  decoyRate: { def: 0.22, min: 0.05, max: 0.4, note: "share of evidence that is a decoy" },
  deskLinkFallbackMin: { def: 15, min: 5, max: 30, note: "minutes before a locked drop opens solo" },
} as const;
export type ParamKey = keyof typeof PARAM_SPEC;

export function param(key: ParamKey): number {
  const v = get<{ value: string }>("SELECT value FROM world WHERE key=?", `param:${key}`)?.value;
  return v == null ? PARAM_SPEC[key].def : Number(v);
}
export function allParams(): Record<ParamKey, number> {
  return Object.fromEntries((Object.keys(PARAM_SPEC) as ParamKey[]).map((k) => [k, param(k)])) as Record<ParamKey, number>;
}
/** Set a parameter inside its bounds. Returns the value actually applied, or null if unchanged. */
export function setParam(key: ParamKey, value: number, actor: string, reason: string): number | null {
  const spec = PARAM_SPEC[key];
  const next = Math.round(Math.max(spec.min, Math.min(spec.max, value)) * 1000) / 1000;
  const prev = param(key);
  if (next === prev) return null;
  run("INSERT INTO world(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", `param:${key}`, String(next));
  logEvent("world_param.changed", actor, { key, from: prev, to: next, reason, at: now() }, null);
  return next;
}
