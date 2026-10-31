import type { ChiefId, FactionId } from "@ispy/shared";
import { all, get, now, parse, worldGet, run, uid } from "./db.ts";
import { bus, type Signal } from "./bus.ts";
import { FACTIONS, PERSONAS, factionById } from "./content.ts";
import { pick } from "./puzzles.ts";
import { chiefSay, refreshPool, offerDirect } from "./engine.ts";
import { distanceM } from "./geo.ts";
import * as crises from "./crises.ts";
import { chiefLine, remember } from "./chiefs.ts";

/**
 * A chief as a resident agent. It is notified of everything its own operatives do, responds in its
 * own voice, and keeps a journal it later plans and chats from. It sees only its faction's side of
 * the world. The Director briefs it and tilts its incentives; it does not know the Director exists.
 */
class ChiefAgent {
  private lastIdleCheck = 0;
  constructor(readonly chief: ChiefId, readonly factionId: FactionId) {}

  get faction() { return factionById(this.factionId); }
  private mine(playerId: string | null) {
    if (!playerId) return null;
    return get<{ id: string; codename: string }>("SELECT id, codename FROM players WHERE id=? AND faction_id=?", playerId, this.factionId) ?? null;
  }
  private async say(playerId: string, codename: string, situation: string, fallback: string, why: string, force = false) {
    const text = await chiefLine(this.chief, this.faction, codename, situation, fallback);
    chiefSay(playerId, text, why, force);
  }

  async on(s: Signal) {
    if (worldGet("paused", "0") === "1") return;
    const op = this.mine(s.playerId);
    const lines = PERSONAS[this.chief].lines;
    switch (s.type) {
      case "recruited": {
        if (!op) return;
        remember(this.chief, "recruit", op.codename, `${op.codename} joined ${this.faction.name}`);
        return;
      }
      case "presence.check_in": {
        if (!op) return;
        remember(this.chief, "deploy", op.codename, `${op.codename} deployed (${s.payload?.mode})`);
        // The chief makes sure there is work the moment someone reports in.
        if (!get("SELECT 1 FROM missions WHERE faction_id=? AND mode=? AND state='pool'", this.factionId, s.payload?.mode)) refreshPool();
        await this.say(op.id, op.codename, `${op.codename} just deployed to the ${s.payload?.mode === "desk" ? "intel desk" : "field"}.`,
          pick(lines.welcome, op.id) + (s.payload?.mode === "field" ? " Orders are on the board. Walk." : " The intercepts are yours."), "deployment");
        const live = s.payload?.areaId ? crises.activeCrisis(s.payload.areaId) : undefined;
        if (live && s.payload?.mode === "field") await this.dispatchCrisis(live.id, `${op.codename} just deployed during ${live.name}`);
        return;
      }
      case "mission.verified": {
        if (!op) return;
        const p = s.payload ?? {};
        const outcome = p.contestOutcome === "won" ? "won a contested target" : p.contestOutcome === "lost" ? "arrived second at a contested target" : "completed it";
        remember(this.chief, "verified", op.codename, `${op.codename} completed ${p.title ?? "a mission"} (${p.template}); ${outcome}${p.unlockedFor ? `; unlocked ${p.unlockedFor}` : ""}`);
        const fallback = p.contestOutcome === "won" ? "First in. Somebody else is explaining themselves to their chief right now."
          : p.contestOutcome === "lost" ? "A rival got there first. I want to know who. Keep an eye on the dossier."
          : pick(lines.debrief_ok, s.at);
        await this.say(op.id, op.codename, `${op.codename} just completed ${p.title ?? "a mission"} (${p.template}) and ${outcome}${p.unlockedFor ? `, which unlocked ${p.unlockedFor}'s drop` : ""}. Debrief them in one line.`, fallback, "debrief", true);
        return;
      }
      case "crisis.brewed": {
        // The chief tells every deployed operative where the agency stands, in its own words.
        const line: string = s.payload?.lines?.[this.factionId] ?? `${s.payload?.name}. Orders are on the board.`;
        const allies: string[] = (s.payload?.pacts ?? []).filter((p: string[]) => p.includes(this.factionId)).flat().filter((x: string) => x !== this.factionId);
        const text = allies.length ? `${line} We are working this one with ${allies.map((a) => factionById(a as FactionId).name).join(" and ")}; their sites are yours to take as well.` : line;
        for (const o of all<{ player_id: string }>("SELECT p.player_id FROM presence p JOIN players pl ON pl.id=p.player_id WHERE pl.faction_id=? AND p.expires_at>?", this.factionId, now())) chiefSay(o.player_id, text, "crisis", true);
        remember(this.chief, "crisis", null, `${s.payload?.name}: told the operatives to ${s.payload?.stances?.[this.factionId]}`);
        await this.dispatchCrisis(s.payload?.crisisId, `${s.payload?.name} just started`);
        return;
      }
      case "crisis.site_claimed": {
        const mine = s.payload?.faction === this.factionId;
        await this.dispatchCrisis(s.payload?.crisisId, `${s.payload?.site} just fell to ${factionById(s.payload?.faction).name}`);
        for (const o of all<{ player_id: string }>("SELECT p.player_id FROM presence p JOIN players pl ON pl.id=p.player_id WHERE pl.faction_id=? AND p.expires_at>? AND p.player_id<>?", this.factionId, now(), s.playerId ?? "")) {
          chiefSay(o.player_id, mine ? `${s.payload?.site} is ours. ${s.payload?.claimed} of ${s.payload?.of} sites decided. Keep moving.` : `${factionById(s.payload?.faction).name} took ${s.payload?.site}. ${s.payload?.of - s.payload?.claimed} site${s.payload?.of - s.payload?.claimed === 1 ? "" : "s"} left. Move.`, "crisis update");
        }
        return;
      }
      case "crisis.resolved": {
        const held = s.payload?.sitesBy?.[this.factionId] ?? 0;
        const won = (s.payload?.leaders ?? []).includes(this.factionId);
        const text = `${s.payload?.name} is ${s.payload?.verdict}. We held ${held} of 3 sites.${won ? " That is a result." : held ? " Not enough." : " We were not in it."}`;
        for (const o of all<{ player_id: string }>("SELECT p.player_id FROM presence p JOIN players pl ON pl.id=p.player_id WHERE pl.faction_id=? AND p.expires_at>?", this.factionId, now())) chiefSay(o.player_id, text, "crisis outcome", true);
        return;
      }
      case "faceoff.started": {
        if (!op) return;
        remember(this.chief, "faceoff", op.codename, `${op.codename} in a face-off with ${s.payload?.rival} (${factionById(s.payload?.rivalFaction).name}) at ${s.payload?.target}`);
        chiefSay(op.id, `${s.payload?.rival} of ${factionById(s.payload?.rivalFaction).name} is on ${s.payload?.target} too. Ninety seconds. First clean scan keeps it. Move.`, "face-off", true);
        return;
      }
      case "faceoff.resolved": {
        if (!op) return;
        const won = s.payload?.outcome === "won";
        remember(this.chief, "faceoff", op.codename, `${op.codename} ${won ? "won" : "lost"} a face-off vs ${s.payload?.rival} at ${s.payload?.target}`);
        await this.say(op.id, op.codename, `${op.codename} just ${won ? "won" : "lost"} a ninety-second face-off against ${s.payload?.rival} of ${factionById(s.payload?.rivalFaction).name} at ${s.payload?.target}. One line, in character.`,
          won ? `First in. ${s.payload?.rival} is explaining ${s.payload?.target} to their chief right now. Remember the name.` : `${s.payload?.rival} beat you to ${s.payload?.target}. I do not forget names; neither should you. Next time, be faster.`, "face-off result", true);
        return;
      }
      case "distraction.planted": {
        if (!op) return;
        remember(this.chief, "bait", op.codename, `${op.codename} planted bait at ${s.payload?.target}`);
        chiefSay(op.id, `Bait at ${s.payload?.target}, logged. Our people know it is nothing. Let us see who walks.`, "distraction", true);
        return;
      }
      case "distraction.sprung": {
        if (!op) return;
        remember(this.chief, "bait", op.codename, `${op.codename}'s bait at ${s.payload?.target} caught ${s.payload?.by} (${factionById(s.payload?.byFaction).name})`);
        chiefSay(op.id, `${s.payload?.by} of ${factionById(s.payload?.byFaction).name} walked all the way to ${s.payload?.target} for nothing. Your bait. Their afternoon.`, "distraction sprung", true);
        return;
      }
      case "mission.decoyed": {
        if (!op || !s.payload?.distraction) return;
        remember(this.chief, "decoyed", op.codename, `${op.codename} walked into ${factionById(s.payload?.by).name}'s bait`);
        chiefSay(op.id, `That was bait, and ${factionById(s.payload?.by).name} laid it. I do not like being walked. Neither should you. Next time, read the pattern first.`, "walked into bait", true);
        return;
      }
      case "artifact.recovered": {
        if (!op) return;
        remember(this.chief, "artifact", op.codename, `${op.codename} recovered ${s.payload?.name} at ${s.payload?.site}`);
        await this.say(op.id, op.codename, `${op.codename} just recovered an artifact, "${s.payload?.name}", at ${s.payload?.site}${s.payload?.dossier ? `, part of dossier ${s.payload.dossier}` : ""}. It is unique; the rivals have lost it. One line.`,
          `${s.payload?.name} is ours now, and nobody else's. Get it examined; a dud tells us as much as the real thing.`, "artifact", true);
        return;
      }
      case "artifact.lost": {
        if (s.payload?.faction !== this.factionId) return;
        remember(this.chief, "artifact", null, `lost whatever lay at ${s.payload?.site} to ${factionById(s.payload?.takenBy).name}`);
        return;
      }
      case "artifact.stolen": {
        if (s.payload?.victim === this.factionId) {
          remember(this.chief, "artifact", null, `${factionById(s.payload?.by).name} stole ${s.payload?.name} from our archive`);
          for (const o of all<{ player_id: string }>("SELECT p.player_id FROM presence p JOIN players pl ON pl.id=p.player_id WHERE pl.faction_id=? AND p.expires_at>?", this.factionId, now())) chiefSay(o.player_id, `${factionById(s.payload?.by).name} lifted ${s.payload?.name} out of our archive at ${s.payload?.site}. I want it back, and I want the name of whoever let it happen.`, "artifact stolen", true);
        }
        return;
      }
      case "dossier.assembled": {
        if (s.payload?.faction !== this.factionId) return;
        remember(this.chief, "dossier", null, `assembled ${s.payload?.name}: ${String(s.payload?.reveal).slice(0, 80)}`);
        for (const o of all<{ player_id: string }>("SELECT p.player_id FROM presence p JOIN players pl ON pl.id=p.player_id WHERE pl.faction_id=?", this.factionId)) chiefSay(o.player_id, `${s.payload?.name} is assembled. ${s.payload?.reveal}`, "dossier", true);
        return;
      }
      case "decoy.sprung": {
        if (!op) return;
        remember(this.chief, "decoy", op.codename, `${op.codename}'s decoy caught ${s.payload?.by}`);
        chiefSay(op.id, `Your decoy caught ${s.payload?.by}. They walked away with nothing and a story. Well placed.`, "decoy sprung", true);
        return;
      }
      case "otw.named": {
        if (!op) return;
        for (const o of all<{ player_id: string }>("SELECT p.player_id FROM presence p JOIN players pl ON pl.id=p.player_id WHERE pl.faction_id=?", this.factionId)) chiefSay(o.player_id, `Operative of the week: ${op.codename}. ${o.player_id === op.id ? "That is you. Keep it." : "Study how they work. Then beat it."}`, "operative of the week", true);
        run("INSERT INTO dispatches(id,kind,headline,body,faction_id,source,at) VALUES(?,?,?,?,?,?,?)", uid(), "news", `${this.faction.name}: operative of the week`, `${this.faction.chiefName} names ${op.codename} operative of the week.`, this.factionId, "chief", now());
        return;
      }
      case "signal.captured": {
        if (!op) return;
        const r = s.payload?.rarity;
        remember(this.chief, "capture", op.codename, `${op.codename} captured a ${r} ${s.payload?.name}`);
        if (r === "rare" || r === "legendary") await this.say(op.id, op.codename, `${op.codename} just captured a ${r} ${s.payload?.name} in the field.`, r === "legendary" ? `A ${String(s.payload?.name).toLowerCase()}. Those do not come twice. Bring it in quietly.` : `Good catch. ${s.payload?.name}s are useful; keep it off the wire.`, "capture", true);
        return;
      }
      case "mission.late": {
        if (!op) return;
        remember(this.chief, "late", op.codename, `${op.codename} arrived late at ${s.payload?.title}; ${factionById(s.payload?.heldBy).name} held the site`);
        return;
      }
      case "site.held": {
        if (!op) return;
        remember(this.chief, "held", op.codename, `${op.codename} took ${s.payload?.target}; we hold ${s.payload?.control?.[this.factionId] ?? "?"} sites there`);
        return;
      }
      case "mission.expired": case "mission.abandoned": {
        if (!op) return;
        remember(this.chief, "dropped", op.codename, `${op.codename} ${s.type === "mission.abandoned" ? "abandoned" : "let expire"} ${s.payload?.title ?? "a mission"}`);
        const drops = get<{ n: number }>("SELECT COUNT(*) n FROM chief_memory WHERE chief_id=? AND subject=? AND kind='dropped' AND at>?", this.chief, op.codename, new Date(Date.now() - 3600_000).toISOString())!.n;
        if (drops >= 2) await this.say(op.id, op.codename, `${op.codename} has dropped ${drops} missions in the last hour.`, pick(["Not your kind of work? Tell me what you want and I will find it.", "Two passes. Fine. Something closer is coming."], s.at), "repeated drops");
        return;
      }
      case "location.flagged": {
        if (!op) return;
        remember(this.chief, "flag", op.codename, `${op.codename}'s position failed to verify`);
        await this.say(op.id, op.codename, `${op.codename}'s scan could not be verified.`, "Your position is not verifying. Stand still, let the signal settle, scan again.", "scan help");
        return;
      }
      case "world_event.fragment": {
        if (!op) return;
        remember(this.chief, "campaign", null, `fragment ${s.payload?.fragments} recovered by ${op.codename}`);
        await this.say(op.id, op.codename, `${op.codename} recovered campaign fragment ${s.payload?.fragments} for the agency.`, `Fragment ${s.payload?.fragments} is ours. Keep moving.`, "fragment");
        return;
      }
      case "bounty.completed": {
        if (!op) return;
        remember(this.chief, "contract", op.codename, `${op.codename} closed contract ${s.payload?.title}`);
        await this.say(op.id, op.codename, `${op.codename} completed the contract "${s.payload?.title}".`, "Contract closed. Credits are in your account. Spend them on a wire if you are hunting someone.", "bounty", true);
        return;
      }
      case "case.exposed": {
        if (!op) return;
        remember(this.chief, "exposed", op.codename, `${op.codename}'s cover was burned`);
        await this.say(op.id, op.codename, `${op.codename}'s cover has just been burned by a rival investigator.`, "Your cover is burned in this sector. Rotate, keep your head down, and let the desk do the next move.", "cover burned", true);
        return;
      }
      case "case.confirmed": {
        if (!op) return;
        remember(this.chief, "investigation", op.codename, `${op.codename} exposed a rival (${s.payload?.subject} of ${s.payload?.faction})`);
        return;
      }
      case "contest.formed": {
        remember(this.chief, "rival", null, "a rival agency is moving on one of our targets");
        return;
      }
    }
  }

  /** Every minute: operatives of mine who are deployed with nothing to do. */
  /**
   * Read the pattern in the Director's chaos: what each rival tends to do with each kind of crisis,
   * which sites fall first, how fast. The chief never knows who brews the chaos; it only sees the sequence.
   */
  readPattern(kind: string): { text: string; rivalRace: boolean; firstSites: string[] } {
    const past = all<crises.CrisisRow>("SELECT * FROM crises WHERE state='resolved' ORDER BY ends_at DESC LIMIT 12");
    const byRival: Record<string, Record<string, number>> = {};
    const firstSites: Record<string, number> = {};
    let firstClaimMin: number[] = [];
    for (const c of past) {
      const st = crises.stancesOf(c);
      for (const f of FACTIONS) if (f.id !== this.factionId && st[f.id]) { byRival[f.id] ??= {}; byRival[f.id][`${c.kind}:${st[f.id]}`] = (byRival[f.id][`${c.kind}:${st[f.id]}`] ?? 0) + 1; }
      const claimed = crises.sitesOf(c).filter((x) => x.claimedAt).sort((a, b) => a.claimedAt!.localeCompare(b.claimedAt!));
      if (claimed[0]) { firstSites[claimed[0].name] = (firstSites[claimed[0].name] ?? 0) + 1; firstClaimMin.push((Date.parse(claimed[0].claimedAt!) - Date.parse(c.starts_at)) / 60_000); }
    }
    const reads: string[] = [];
    let rivalRace = false;
    for (const f of FACTIONS) {
      if (f.id === this.factionId) continue;
      const rows = Object.entries(byRival[f.id] ?? {}).filter(([k]) => k.startsWith(kind + ":")).sort((a, b) => b[1] - a[1]);
      if (rows[0]) {
        const stance = rows[0][0].split(":")[1];
        reads.push(`${f.name} usually ${stance}s a ${kind}`);
        if (stance !== "mitigate") rivalRace = true;
      }
    }
    const hot = Object.entries(firstSites).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([n]) => n);
    const avg = firstClaimMin.length ? Math.round(firstClaimMin.reduce((a, b) => a + b, 0) / firstClaimMin.length) : null;
    const text = [
      past.length ? `${past.length} past crises on file.` : "No pattern yet; first crisis on file.",
      ...reads,
      hot.length ? `Sites that fall first: ${hot.join(", ")}.` : "",
      avg != null ? `First site usually goes within ${avg} min.` : "",
    ].filter(Boolean).join(" ");
    return { text, rivalRace, firstSites: hot };
  }

  /** Put operatives on sites: nearest open site each, racing the hot ones first when rivals tend to grab. */
  async dispatchCrisis(crisisId: string, why: string) {
    const c = get<crises.CrisisRow>("SELECT * FROM crises WHERE id=? AND state='active'", crisisId);
    if (!c) return;
    const pattern = this.readPattern(c.kind);
    const stance = crises.stancesOf(c)[this.factionId];
    const open = crises.sitesOf(c).filter((x) => !x.claimedBy);
    if (!open.length) return;
    const rivals = all<{ lat: number; lng: number }>("SELECT p.last_lat lat, p.last_lng lng FROM presence p JOIN players pl ON pl.id=p.player_id WHERE pl.faction_id<>? AND p.area_id=? AND p.mode='field' AND p.expires_at>? AND p.last_lat IS NOT NULL", this.factionId, c.area_id, now());
    const ops = all<{ player_id: string; codename: string; lat: number | null; lng: number | null }>(
      "SELECT p.player_id, pl.codename, p.last_lat lat, p.last_lng lng FROM presence p JOIN players pl ON pl.id=p.player_id WHERE pl.faction_id=? AND p.area_id=? AND p.mode='field' AND p.expires_at>?", this.factionId, c.area_id, now());
    // Pact allies coordinate: sites an ally's operative is already on, or has been sent to, are theirs.
    const taken = new Set<string>();
    const allies = crises.alliesOf(c, this.factionId);
    if (allies.length) {
      for (const r of all<{ site: string }>(
        `SELECT DISTINCT json_extract(m.params,'$.siteId') site FROM missions m WHERE json_extract(m.params,'$.crisisId')=? AND m.faction_id IN (${allies.map(() => "?").join(",")}) AND (m.state='active' OR m.id IN (SELECT mission_id FROM offers WHERE state='open'))`,
        c.id, ...allies)) if (r.site) taken.add(r.site);
    }
    let sent = 0;
    for (const o of ops) {
      if (get("SELECT 1 FROM missions WHERE assignee_id=? AND state='active'", o.player_id)) continue;
      if (get("SELECT 1 FROM offers o JOIN missions m ON m.id=o.mission_id WHERE o.player_id=? AND o.state='open' AND json_extract(m.params,'$.crisisId')=?", o.player_id, c.id)) continue;
      // Score: close to me, far from rivals; sites that historically fall first get a push when rivals race.
      const best = open.filter((x) => !taken.has(x.targetId)).map((x) => {
        const mine = o.lat != null ? distanceM(o.lat, o.lng!, x.lat, x.lng) : 500;
        const rival = rivals.length ? Math.min(...rivals.map((r) => distanceM(r.lat, r.lng, x.lat, x.lng))) : 2000;
        const hot = pattern.rivalRace && pattern.firstSites.includes(x.name) ? 300 : 0;
        return { x, score: -mine + 0.5 * rival + hot };
      }).sort((a, b) => b.score - a.score)[0];
      if (!best) { taken.clear(); continue; }
      const mission = get<{ id: string }>("SELECT id FROM missions WHERE faction_id=? AND state='pool' AND json_extract(params,'$.crisisId')=? AND json_extract(params,'$.siteId')=?", this.factionId, c.id, best.x.targetId);
      if (!mission) continue;
      if (!offerDirect(o.player_id, mission.id)) continue;
      taken.add(best.x.targetId); sent++;
      const fallback = `${c.name}: ${stance} at ${best.x.name}. ${pattern.rivalRace ? "Rivals will race this one; move now." : "Quiet so far; take it before it stops being quiet."} It is on your board.`;
      await this.say(o.player_id, o.codename, `${why}. You read the pattern: ${pattern.text} You are sending ${o.codename} to ${best.x.name} to ${stance}. Give the order in one line with the reason.`, fallback, "crisis dispatch", true);
    }
    if (sent) remember(this.chief, "dispatch", null, `${c.name}: dispatched ${sent} operative${sent === 1 ? "" : "s"}; read: ${pattern.text.slice(0, 120)}`);
  }

  async idleCheck() {
    const t = Date.now();
    if (t - this.lastIdleCheck < 60_000 || worldGet("paused", "0") === "1") return;
    this.lastIdleCheck = t;
    for (const o of all<{ player_id: string; codename: string; checked_in_at: string }>(
      "SELECT p.player_id, pl.codename, p.checked_in_at FROM presence p JOIN players pl ON pl.id=p.player_id WHERE pl.faction_id=? AND p.mode='field' AND p.expires_at>?", this.factionId, now())) {
      const hasWork = get("SELECT 1 FROM missions WHERE assignee_id=? AND state='active'", o.player_id) || get("SELECT 1 FROM offers WHERE player_id=? AND state='open'", o.player_id);
      if (hasWork) continue;
      const lastAct = get<{ at: string }>("SELECT at FROM events WHERE player_id=? ORDER BY id DESC LIMIT 1", o.player_id);
      if (lastAct && t - Date.parse(lastAct.at) < 4 * 60_000) continue;
      refreshPool();
      const target = get<{ name: string }>("SELECT t.name FROM missions m JOIN targets t ON t.id=m.target_id WHERE m.faction_id=? AND m.state='pool' AND m.mode='field' ORDER BY m.created_at DESC LIMIT 1", this.factionId);
      await this.say(o.player_id, o.codename, `${o.codename} has been deployed with nothing to do for a few minutes${target ? `; there is work near ${target.name}` : ""}.`,
        target ? `You have gone quiet. There is work near ${target.name}. Open the board.` : "You have gone quiet. Stay deployed; something is coming.", "idle");
    }
  }
}

export const chiefAgents = new Map<FactionId, ChiefAgent>();
export function startChiefAgents() {
  for (const f of FACTIONS) chiefAgents.set(f.id, new ChiefAgent(f.chief, f.id));
  bus.onSignal((s) => { for (const a of chiefAgents.values()) a.on(s).catch((e) => console.warn(`[chief ${a.chief}]`, (e as Error).message)); });
  setInterval(() => { for (const a of chiefAgents.values()) void a.idleCheck(); }, 30_000);
}
