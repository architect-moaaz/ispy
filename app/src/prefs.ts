import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Small on-device preferences that are the operative's own, not the bureau's: which operative walks
 * the 3D street. Kept here rather than on the server so a change shows the moment it is made.
 *
 * Ten operatives, five of each build. Each is a Meshy-generated, rigged body under
 * `assets/art/operatives/<id>.glb`; the build is what the Quaternius fallback and the idle stances
 * key on when a rigged body cannot be loaded.
 */
export type Build = "m" | "f";
export type OperativeId = "m1" | "m2" | "m3" | "m4" | "m5" | "f1" | "f2" | "f3" | "f4" | "f5";
export const OPERATIVE_IDS: OperativeId[] = ["f1", "f2", "f3", "f4", "f5", "m1", "m2", "m3", "m4", "m5"];
export function buildOf(id: OperativeId): Build { return id[0] as Build; }
export function isOperativeId(v: unknown): v is OperativeId { return typeof v === "string" && (OPERATIVE_IDS as string[]).includes(v); }

const KEY = "ispy.operative";
const LEGACY_BUILD_KEY = "ispy.build"; // before 2026-11: "m" | "f"
let operative: OperativeId = "m1";
let loaded = false;
const listeners = new Set<(id: OperativeId) => void>();

export async function loadOperative(): Promise<OperativeId> {
  if (loaded) return operative;
  try {
    const v = await AsyncStorage.getItem(KEY);
    if (isOperativeId(v)) operative = v;
    else { const b = await AsyncStorage.getItem(LEGACY_BUILD_KEY); if (b === "f") operative = "f1"; }
  } catch { /* default */ }
  loaded = true;
  return operative;
}
export function getOperative(): OperativeId { return operative; }
export async function setOperative(id: OperativeId) {
  operative = id; loaded = true;
  listeners.forEach((l) => l(id));
  try { await AsyncStorage.setItem(KEY, id); } catch { /* memory only */ }
}
export function onOperative(l: (id: OperativeId) => void) { listeners.add(l); return () => { listeners.delete(l); }; }
