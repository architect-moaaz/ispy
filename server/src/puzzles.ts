import { createHash } from "node:crypto";

const WORDS = ["MERIDIAN", "LANTERN", "QUIET HARBOUR", "SILVER FOX", "NIGHT TRAIN", "BLUE HERON", "PAPER TIGER", "COLD IRON", "LAST ORCHARD", "OPEN WINDOW"];

/** Deterministic pseudo-random in [0,1) from a seed string. */
export function rand(seed: string) {
  const h = createHash("sha256").update(seed).digest();
  return h.readUInt32BE(0) / 0xffffffff;
}
export const pick = <T>(arr: readonly T[], seed: string) => arr[Math.floor(rand(seed) * arr.length)];

export function caesar(text: string, shift: number) {
  return text.replace(/[A-Z]/g, (c) => String.fromCharCode(((c.charCodeAt(0) - 65 + shift) % 26) + 65));
}

export interface CipherPuzzle { kind: "cipher"; prompt: string; answer: string }
export function makeCipher(seed: string): CipherPuzzle {
  const plain = pick(WORDS, seed + ":w");
  const shift = 1 + Math.floor(rand(seed + ":s") * 24);
  return {
    kind: "cipher",
    prompt: `Intercepted key, shift cipher: ${caesar(plain, shift)}\nDecode it. Answer in capitals.`,
    answer: plain,
  };
}

export interface AnalysisPuzzle { kind: "analysis"; prompt: string; options: string[]; answer: string }
export function makeAnalysis(seed: string, real: string, decoys: string[]): AnalysisPuzzle {
  const options = [real, ...decoys].sort((a, b) => rand(seed + a) - rand(seed + b));
  const clue1 = `Clue 1: the courier was seen heading away from ${decoys[0]}.`;
  const clue2 = decoys[1] ? `Clue 2: ${decoys[1]} was closed at the time of the drop.` : "Clue 2: the site has open sky above it.";
  return {
    kind: "analysis",
    prompt: `Three candidate sites. One is real.\n${clue1}\n${clue2}\nWhich site is the drop?`,
    options,
    answer: real,
  };
}

export const norm = (s: string) => s.trim().toUpperCase().replace(/\s+/g, " ");
