import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Small on-device preferences that are the operative's own, not the bureau's: which build walks
 * the 3D street. Kept here rather than on the server so a change shows the moment it is made.
 */
export type Build = "m" | "f";
const BUILD_KEY = "ispy.build";
let build: Build = "m";
let loaded = false;
const listeners = new Set<(b: Build) => void>();

export async function loadBuild(): Promise<Build> {
  if (loaded) return build;
  try { const v = await AsyncStorage.getItem(BUILD_KEY); if (v === "m" || v === "f") build = v; } catch { /* default */ }
  loaded = true;
  return build;
}
export function getBuild(): Build { return build; }
export async function setBuild(b: Build) {
  build = b; loaded = true;
  listeners.forEach((l) => l(b));
  try { await AsyncStorage.setItem(BUILD_KEY, b); } catch { /* memory only */ }
}
export function onBuild(l: (b: Build) => void) { listeners.add(l); return () => { listeners.delete(l); }; }
