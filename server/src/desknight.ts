import type { FactionId } from "@ispy/shared";
import { all, db, get, json, logEvent, now, parse, run } from "./db.ts";
import { factionById } from "./content.ts";
import { award } from "./rewards.ts";
import { makeAnalysis, makeCipher, norm, pick, rand } from "./puzzles.ts";
import { dayKey, dayStartIso, hhmm, nextDayKey } from "./clock.ts";
import { H } from "./hooks.ts";

/**
 * Desk Nights. Three minutes of desk work on the days you cannot walk: one intercept, one site
 * analysis, and a trace built from what really happened in your sector today ("an agent moved through
 * these sites at these times; which one was never visited?"). Each pays a little. All three, and
 * tomorrow's morning wire counts half again. No streak to lose.
 */
db.exec(`CREATE TABLE IF NOT EXISTS desk_nights (player_id TEXT NOT NULL, day TEXT NOT NULL, solved TEXT NOT NULL DEFAULT '[]', PRIMARY KEY(player_id, day))`);

const XP_EACH = 40;
export interface NightPuzzle { n: number; kind: "cipher" | "analysis" | "trace"; title: string; prompt: string; options?: string[]; system?: string; xp: number }

interface Built { puzzles: NightPuzzle[]; answers: string[] }

function homeArea(playerId: string): string | null {
  return get<{ area_id: string | null }>("SELECT area_id FROM presence WHERE player_id=?", playerId)?.area_id
    ?? get<{ area_id: string }>("SELECT area_id FROM missions WHERE assignee_id=? AND state='completed' ORDER BY completed_at DESC LIMIT 1", playerId)?.area_id
    ?? get<{ id: string }>("SELECT id FROM areas ORDER BY id LIMIT 1")?.id ?? null;
}

/** Tonight's three, deterministic for the day, the agency and the sector. */
function build(playerId: string, factionId: FactionId, day: string): Built {
  const areaId = homeArea(playerId);
  const seed = `night:${day}:${factionId}:${areaId ?? "-"}`;
  const targets = areaId ? all<{ id: string; name: string }>("SELECT id, name FROM targets WHERE area_id=? AND state='ACTIVE' AND kind<>'test' ORDER BY name", areaId) : [];
  const names = targets.map((t) => t.name);
  // 1. The intercept of the day.
  const c = makeCipher(seed + ":c");
  // 2. The analysis: three real sites of the sector, one of them the one that matters.
  const shuffled = [...names].sort((a, b) => rand(seed + a) - rand(seed + b));
  const real = shuffled[0] ?? "the bandstand", decoys = shuffled.slice(1, 3);
  const a = makeAnalysis(seed + ":a", real, decoys);
  // 3. The trace: today's held sites in the sector, in order, and one that nobody touched.
  const held = areaId ? all<{ target: string; at: string }>(
    "SELECT json_extract(e.payload,'$.target') target, e.at FROM events e WHERE e.type='site.held' AND e.at>? AND json_extract(e.payload,'$.targetId') IN (SELECT id FROM targets WHERE area_id=?) ORDER BY e.id", dayStartIso(), areaId) : [];
  const seen: { target: string; at: string }[] = [];
  for (const h of held) if (h.target && !seen.some((s) => s.target === h.target)) seen.push(h);
  let log = seen.slice(-3);
  let fromToday = log.length >= 3;
  if (!fromToday) {
    // A quiet day: a plausible log from the sector's own sites, seeded, so it still reads as this place.
    const pool = shuffled.slice(0, 6);
    const base = Date.parse(dayStartIso()) + 9 * 3_600_000;
    log = pool.slice(0, 3).map((t, i) => ({ target: t, at: new Date(base + i * (35 + Math.floor(rand(seed + ":t" + i) * 50)) * 60_000).toISOString() }));
  }
  const visited = new Set(log.map((l) => l.target));
  const unvisited = shuffled.find((n) => !visited.has(n)) ?? "the north gate";
  const options = [...log.map((l) => l.target), unvisited].sort((x, y) => rand(seed + ":o" + x) - rand(seed + ":o" + y));
  const trace: NightPuzzle = {
    n: 3, kind: "trace", title: fromToday ? "Today's trace" : "The overnight log", xp: XP_EACH,
    prompt: `${fromToday ? "An operative moved through your sector today" : "A watcher logged movement through your sector"}: ${log.map((l) => `${l.target} at ${hhmm(l.at)}`).join(", ")}. One of these four sites was never visited. Which?`,
    options,
  };
  return {
    puzzles: [
      { n: 1, kind: "cipher", title: "Intercept of the day", prompt: c.prompt, system: c.system, xp: XP_EACH },
      { n: 2, kind: "analysis", title: "Three sites, one that matters", prompt: a.prompt, options: a.options, xp: XP_EACH },
      trace,
    ],
    answers: [c.answer, a.answer, unvisited],
  };
}

export function view(playerId: string, factionId: FactionId) {
  const day = dayKey();
  const b = build(playerId, factionId, day);
  const solved = parse<number[]>(get<{ solved: string }>("SELECT solved FROM desk_nights WHERE player_id=? AND day=?", playerId, day)?.solved, []);
  const boost = get<{ wire_boost_day: string | null }>("SELECT wire_boost_day FROM players WHERE id=?", playerId)?.wire_boost_day;
  return { day, puzzles: b.puzzles, solved, allDone: solved.length >= 3, boostTomorrow: boost === nextDayKey(day), xpEach: XP_EACH };
}

export function submit(playerId: string, factionId: FactionId, n: number, answer: string): { correct: boolean; xp?: number; allDone?: boolean; debrief: string } {
  const day = dayKey();
  const b = build(playerId, factionId, day);
  if (n < 1 || n > 3) throw Object.assign(new Error("no such puzzle"), { status: 404 });
  const row = get<{ solved: string }>("SELECT solved FROM desk_nights WHERE player_id=? AND day=?", playerId, day);
  const solved = parse<number[]>(row?.solved, []);
  if (solved.includes(n)) return { correct: true, debrief: "Already solved tonight." };
  if (norm(answer) !== norm(b.answers[n - 1])) { logEvent("desk_night.wrong", "verifier", { n }, playerId); return { correct: false, debrief: pick(["Not it. Look again.", "No. Slow down.", "Wrong. Work it on paper."], `${playerId}:${n}:${Date.now()}`) }; }
  solved.push(n);
  run("INSERT INTO desk_nights(player_id,day,solved) VALUES(?,?,?) ON CONFLICT(player_id,day) DO UPDATE SET solved=excluded.solved", playerId, day, json(solved));
  const allDone = solved.length >= 3;
  award(playerId, XP_EACH, allDone ? 1 : 0, allDone ? "desk night complete" : "desk night");
  if (allDone) {
    run("UPDATE players SET wire_boost_day=? WHERE id=?", nextDayKey(day), playerId);
    const f = factionById(factionId);
    H.chiefSay(playerId, pick({
      oracle: ["Three for three. Tomorrow's wire will be worth more; I have seen to it."],
      ghost: ["All three, in the dark, in your pyjamas presumably. Tomorrow morning pays extra."],
      nexus: ["Desk night complete. Tomorrow's wire: multiplier 1.5. Sleep."],
    }[f.chief], `${playerId}:${day}`), "desk night complete", true);
  }
  logEvent("desk_night.solved", "verifier", { n, allDone }, playerId);
  return { correct: true, xp: XP_EACH, allDone, debrief: allDone ? "That is the set. Tomorrow's wire counts half again." : pick(["Cracked.", "Clean.", "Yes."], `${playerId}:${n}`) };
}
