import { all, get, run, now, uid, json, parse, logEvent } from "./db.ts";
import { FACTIONS } from "./content.ts";

/**
 * The Auditor room of the World Director. It reads the ledger and raises flags; it never
 * changes a score, a mission or a player. A human reads the flags (or the Owner pauses).
 */
export interface AuditFlag { severity: "info" | "warn" | "critical"; code: string; detail: string; subject?: string }

export function runAudit(hours = 1): { metrics: Record<string, unknown>; flags: AuditFlag[] } {
  const start = new Date(Date.now() - hours * 3600_000).toISOString();
  const end = now();
  const flags: AuditFlag[] = [];

  // --- Fairness: compare per-faction access and outcomes, normalised by active players.
  const perFaction = FACTIONS.map((f) => {
    const active = get<{ n: number }>("SELECT COUNT(DISTINCT player_id) n FROM events WHERE at>? AND player_id IN (SELECT id FROM players WHERE faction_id=?)", start, f.id)!.n;
    const offered = get<{ n: number }>("SELECT COUNT(*) n FROM events e WHERE e.type='mission.offered' AND e.at>? AND e.player_id IN (SELECT id FROM players WHERE faction_id=?)", start, f.id)!.n;
    const completed = get<{ n: number }>("SELECT COUNT(*) n FROM missions WHERE faction_id=? AND state='completed' AND completed_at>?", f.id, start)!.n;
    const contested = get<{ n: number }>("SELECT COUNT(*) n FROM missions WHERE faction_id=? AND contested_group_id IS NOT NULL AND created_at>?", f.id, start)!.n;
    const won = get<{ n: number }>("SELECT COUNT(*) n FROM missions WHERE faction_id=? AND outcome='won' AND completed_at>?", f.id, start)!.n;
    const xp = get<{ s: number }>("SELECT COALESCE(SUM(json_extract(payload,'$.xp')),0) s FROM events WHERE type='reward' AND at>? AND player_id IN (SELECT id FROM players WHERE faction_id=?)", start, f.id)!.s;
    return { faction: f.id, active, offered, completed, contested, won, xp, offersPerActive: active ? offered / active : 0, xpPerActive: active ? xp / active : 0 };
  });
  const withPlayers = perFaction.filter((p) => p.active >= 2);
  if (withPlayers.length >= 2) {
    const ratio = (k: "offersPerActive" | "xpPerActive") => {
      const vals = withPlayers.map((p) => p[k]);
      const min = Math.min(...vals), max = Math.max(...vals);
      return min > 0 ? max / min : max > 0 ? Infinity : 1;
    };
    if (ratio("offersPerActive") > 2) flags.push({ severity: "warn", code: "OFFER_SKEW", detail: `Offers per active player differ more than 2x between agencies: ${withPlayers.map((p) => `${p.faction} ${p.offersPerActive.toFixed(1)}`).join(", ")}` });
    if (ratio("xpPerActive") > 2.5) flags.push({ severity: "warn", code: "XP_SKEW", detail: `XP per active player differs more than 2.5x between agencies: ${withPlayers.map((p) => `${p.faction} ${p.xpPerActive.toFixed(0)}`).join(", ")}` });
    const totalContested = perFaction.reduce((s, p) => s + p.contested, 0);
    const maxShare = Math.max(...perFaction.map((p) => p.contested)) / Math.max(1, totalContested);
    if (totalContested >= 6 && maxShare > 0.6) flags.push({ severity: "warn", code: "CONTEST_SKEW", detail: `One agency holds ${Math.round(maxShare * 100)}% of contested targets` });
  }

  // --- Anomalies: individual behaviour the Arbiter accepted but a human should see.
  for (const r of all<{ player_id: string; n: number }>("SELECT player_id, COUNT(*) n FROM scans WHERE at>? AND trust<0.7 GROUP BY player_id HAVING n>=3", start))
    flags.push({ severity: "warn", code: "LOW_TRUST_SCANS", detail: `${r.n} low-trust scans in ${hours}h`, subject: r.player_id });
  for (const r of all<{ player_id: string; n: number }>("SELECT player_id, COUNT(*) n FROM scans WHERE at>? AND reasons LIKE '%implausible_speed%' GROUP BY player_id HAVING n>=2", start))
    flags.push({ severity: "critical", code: "IMPLAUSIBLE_SPEED", detail: `${r.n} scans with implausible movement`, subject: r.player_id });
  for (const r of all<{ assignee_id: string; n: number }>("SELECT assignee_id, COUNT(*) n FROM missions WHERE mode='field' AND state='completed' AND completed_at>? GROUP BY assignee_id HAVING n>=6", start))
    flags.push({ severity: "warn", code: "RAPID_COMPLETIONS", detail: `${r.n} field missions verified in ${hours}h`, subject: r.assignee_id });
  for (const r of all<{ player_id: string; n: number }>("SELECT player_id, COUNT(*) n FROM events WHERE type='case.rejected' AND at>? GROUP BY player_id HAVING n>=3", start))
    flags.push({ severity: "info", code: "SERIAL_ACCUSER", detail: `${r.n} rejected accusations in ${hours}h`, subject: r.player_id });
  const plansFallback = get<{ n: number }>("SELECT COUNT(*) n FROM area_plans WHERE created_at>? AND source='fallback'", start)!.n;
  const plansTotal = get<{ n: number }>("SELECT COUNT(*) n FROM area_plans WHERE created_at>?", start)!.n;
  if (plansTotal && plansFallback === plansTotal) flags.push({ severity: "info", code: "CHIEFS_SCRIPTED", detail: "All chief plans this window came from the scripted fallback (no model configured or every call failed)" });

  // --- Policy: owner interventions are expected to be rare and visible.
  const overrides = get<{ n: number }>("SELECT COUNT(*) n FROM events WHERE actor='owner' AND at>?", start)!.n;
  if (overrides) flags.push({ severity: "info", code: "OWNER_INTERVENTIONS", detail: `${overrides} owner action${overrides === 1 ? "" : "s"} in the window` });

  const metrics = { windowHours: hours, perFaction, overrides, plansFallback, plansTotal };
  run("INSERT INTO audits(id,window_start,window_end,metrics,flags,at) VALUES(?,?,?,?,?,?)", uid(), start, end, json(metrics), json(flags), end);
  logEvent("audit.completed", "auditor", { flags: flags.length, critical: flags.filter((f) => f.severity === "critical").length }, null);
  return { metrics, flags };
}

export function latestAudits(limit = 5) {
  return all<{ id: string; window_start: string; window_end: string; metrics: string; flags: string; at: string }>(
    "SELECT * FROM audits ORDER BY at DESC LIMIT ?", limit,
  ).map((a) => ({ id: a.id, windowStart: a.window_start, windowEnd: a.window_end, metrics: parse(a.metrics, {}), flags: parse<AuditFlag[]>(a.flags, []), at: a.at }));
}
