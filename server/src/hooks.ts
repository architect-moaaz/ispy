import type { FactionId, TemplateId } from "@ispy/shared";

/**
 * What the engine lends to the feature modules (wire, hunt, territory, handoff, desk nights) without
 * an import cycle: the engine fills this at load, the modules call it at run time. Same idea as the
 * spawner callbacks that chains and distractions register, in one place.
 */
export interface EngineHooks {
  /** A field order at a known site, reserved for one operative, with a chief-voiced brief. Returns the mission id. */
  spawnOrder(o: { factionId: FactionId; areaId: string; template: TemplateId; targetId: string; params: Record<string, unknown>; title: string; brief: string; reservedFor: string; ttlMs: number; rewardXp?: number }): string | null;
  /** Put a pool mission at the top of one operative's board. */
  offerDirect(playerId: string, missionId: string): string | null;
  /** Hand an operative a mission outright (no 90 s offer window): it becomes their active field order. */
  assignDirect(playerId: string, missionId: string): boolean;
  /** A line from the operative's chief on the secure channel (pushes). */
  chiefSay(playerId: string, text: string, why: string, force?: boolean): void;
  walkRadiusM(playerId: string): number;
}

export const H: EngineHooks = {
  spawnOrder: () => null,
  offerDirect: () => null,
  assignDirect: () => false,
  chiefSay: () => {},
  walkRadiusM: () => 1200,
};
