import type { ChiefId, FactionId } from "@ispy/shared";
import { all, get, now, worldGet } from "./db.ts";
import { bus, type Signal } from "./bus.ts";
import { FACTIONS, PERSONAS, factionById } from "./content.ts";
import { pick } from "./puzzles.ts";
import { chiefSay, refreshPool } from "./engine.ts";
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
