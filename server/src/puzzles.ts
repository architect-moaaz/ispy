import { createHash } from "node:crypto";

/**
 * Real puzzles for the intel desk. Ciphers are classical systems an analyst can actually break with
 * pen and paper (each prompt names the system and gives one honest foothold); analysis puzzles are
 * small deductions with a unique solution, generated and solved here so the answer is always sound.
 * Everything is deterministic from a seed so a mission always shows the same puzzle.
 */
const WORDS = ["MERIDIAN", "LANTERN", "QUIET HARBOUR", "SILVER FOX", "NIGHT TRAIN", "BLUE HERON", "PAPER TIGER", "COLD IRON", "LAST ORCHARD", "OPEN WINDOW", "GLASS KEY", "SECOND SHADOW", "LOW TIDE", "IRON CURTAIN", "RED LEDGER"];
const PHRASES = ["THE COURIER WAITS AT DAWN", "BURN THE SECOND PAGE", "TRUST THE OLD GATE", "MEET BY THE FOUNTAIN", "THE PACKAGE IS A DECOY", "LEAVE NOTHING ON THE BENCH", "SIGNAL TWICE THEN WALK", "THE ANALYST IS COMPROMISED"];
const KEYS = ["RAVEN", "GHOST", "NEXUS", "ORCHID", "SABLE", "COBALT"];

/** Deterministic pseudo-random in [0,1) from a seed string. */
export function rand(seed: string) {
  const h = createHash("sha256").update(seed).digest();
  return h.readUInt32BE(0) / 0xffffffff;
}
export const pick = <T>(arr: readonly T[], seed: string) => arr[Math.floor(rand(seed) * arr.length)];
export const norm = (s: string) => s.trim().toUpperCase().replace(/\s+/g, " ");

const A = 65;
export function caesar(text: string, shift: number) {
  return text.replace(/[A-Z]/g, (c) => String.fromCharCode(((c.charCodeAt(0) - A + shift) % 26) + A));
}
const atbash = (t: string) => t.replace(/[A-Z]/g, (c) => String.fromCharCode(A + 25 - (c.charCodeAt(0) - A)));
function vigenere(t: string, key: string) {
  let i = 0;
  return t.replace(/[A-Z]/g, (c) => { const k = key.charCodeAt(i++ % key.length) - A; return String.fromCharCode(((c.charCodeAt(0) - A + k) % 26) + A); });
}
const MORSE: Record<string, string> = { A: ".-", B: "-...", C: "-.-.", D: "-..", E: ".", F: "..-.", G: "--.", H: "....", I: "..", J: ".---", K: "-.-", L: ".-..", M: "--", N: "-.", O: "---", P: ".--.", Q: "--.-", R: ".-.", S: "...", T: "-", U: "..-", V: "...-", W: ".--", X: "-..-", Y: "-.--", Z: "--.." };
const morse = (t: string) => t.split(" ").map((w) => w.split("").map((c) => MORSE[c] ?? "").join(" ")).join(" / ");
/** Polybius square, I and J share a cell; letters become row-column pairs. */
const POLY = "ABCDEFGHIKLMNOPQRSTUVWXYZ";
const polybius = (t: string) => t.split(" ").map((w) => w.replace(/J/g, "I").split("").map((c) => { const i = POLY.indexOf(c); return `${Math.floor(i / 5) + 1}${(i % 5) + 1}`; }).join(" ")).join(" / ");
/** Rail fence with 3 rails, spaces removed. */
function railFence(t: string) {
  const s = t.replace(/ /g, "");
  const rails: string[] = ["", "", ""];
  let r = 0, dir = 1;
  for (const c of s) { rails[r] += c; if (r === 0) dir = 1; else if (r === 2) dir = -1; r += dir; }
  return rails.join("");
}
/** Keyword substitution alphabet: keyword then the remaining letters. */
function keywordAlphabet(key: string) {
  const seen = new Set<string>();
  let out = "";
  for (const c of key + "ABCDEFGHIJKLMNOPQRSTUVWXYZ") if (!seen.has(c)) { seen.add(c); out += c; }
  return out;
}
const keywordSub = (t: string, key: string) => { const alpha = keywordAlphabet(key); return t.replace(/[A-Z]/g, (c) => alpha[c.charCodeAt(0) - A]); };

export interface CipherPuzzle { kind: "cipher"; prompt: string; answer: string; system: string }
export function makeCipher(seed: string): CipherPuzzle {
  const r = rand(seed + ":sys");
  const word = pick(WORDS, seed + ":w");
  const phrase = pick(PHRASES, seed + ":p");
  if (r < 0.18) {
    const shift = 1 + Math.floor(rand(seed + ":s") * 24);
    return { kind: "cipher", system: "Caesar shift", answer: word, prompt: `INTERCEPT · shift cipher (every letter moved the same distance along the alphabet)\n\n${caesar(word, shift)}\n\nRecover the codeword. Answer in capitals.` };
  }
  if (r < 0.32) {
    return { kind: "cipher", system: "Atbash", answer: word, prompt: `INTERCEPT · mirror alphabet (A↔Z, B↔Y, C↔X ...)\n\n${atbash(word)}\n\nRecover the codeword. Answer in capitals.` };
  }
  if (r < 0.5) {
    const key = pick(KEYS, seed + ":k");
    return { kind: "cipher", system: "Vigenère", answer: phrase, prompt: `INTERCEPT · Vigenère, key ${key} (each letter shifted by the matching key letter, A=0 ... Z=25, key repeating; spaces kept)\n\n${vigenere(phrase, key)}\n\nRecover the message. Answer in capitals with spaces.` };
  }
  if (r < 0.64) {
    return { kind: "cipher", system: "Morse", answer: word, prompt: `INTERCEPT · Morse, letters separated by spaces, words by /\n\n${morse(word)}\n\nRecover the codeword. Answer in capitals.` };
  }
  if (r < 0.78) {
    return { kind: "cipher", system: "Polybius square", answer: word.replace(/J/g, "I"), prompt: `INTERCEPT · Polybius square (5×5 grid, A-E first row, I and J share a cell; each letter is row then column)\n\n${polybius(word)}\n\nRecover the codeword. Answer in capitals.` };
  }
  if (r < 0.9) {
    const key = pick(KEYS, seed + ":k2");
    const crib = word.split(" ")[0].slice(0, 3);
    return { kind: "cipher", system: "keyword substitution", answer: word, prompt: `INTERCEPT · substitution alphabet built from the keyword ${key} (keyword first, then the unused letters in order)\n\n${keywordSub(word, key)}\n\nFoothold: the plaintext begins ${crib}. Recover the codeword. Answer in capitals.` };
  }
  return { kind: "cipher", system: "rail fence", answer: phrase.replace(/ /g, ""), prompt: `INTERCEPT · rail fence, three rails (letters written in a zigzag down and up three lines, then read line by line; spaces dropped)\n\n${railFence(phrase)}\n\nRecover the message. Answer in capitals, no spaces.` };
}

export interface AnalysisPuzzle { kind: "analysis"; prompt: string; options: string[]; answer: string }
/**
 * A three-site deduction with a unique answer: three suspects, three sites, three facts. The solver
 * enumerates every assignment so the clues are guaranteed to pin exactly one site for the courier.
 */
export function makeAnalysis(seed: string, real: string, decoys: string[]): AnalysisPuzzle {
  const sites = [real, ...decoys.slice(0, 2)];
  while (sites.length < 3) sites.push(`the ${["kiosk", "bandstand", "north gate"][sites.length]}`);
  const options = [...sites].sort((a, b) => rand(seed + a) - rand(seed + b));
  const people = ["the courier", "the watcher", "the broker"];
  // The truth: courier at the real site; the other two assigned by seed.
  const others = sites.filter((x) => x !== real);
  const swap = rand(seed + ":sw") < 0.5;
  const truth: Record<string, string> = { "the courier": real, "the watcher": swap ? others[0] : others[1], "the broker": swap ? others[1] : others[0] };
  const perms = (xs: string[]): string[][] => xs.length <= 1 ? [xs] : xs.flatMap((x, i) => perms([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p]));
  const assignments = perms(sites).map((p) => Object.fromEntries(people.map((who, i) => [who, p[i]])) as Record<string, string>);
  // Candidate clues, each a predicate; keep adding the clue that cuts the most until one assignment remains.
  const pool: { text: string; ok: (a: Record<string, string>) => boolean }[] = [];
  for (const who of people) for (const site of sites) pool.push({ text: `${cap(who)} was not at ${site}.`, ok: (a) => a[who] !== site });
  for (const who of people) for (const other of people) if (who !== other) for (const site of sites) pool.push({ text: `If ${who} was at ${site}, ${other} was not.`, ok: (a) => a[who] !== site || a[other] !== site });
  for (const site of sites) for (const who of ["the watcher", "the broker"]) pool.push({ text: `${cap(who)} was seen at ${site}.`, ok: (a) => a[who] === site });
  const clues: string[] = [];
  let remaining = assignments.filter((a) => people.every((w) => true) && a);
  let guard = 0;
  while (remaining.length > 1 && guard++ < 6) {
    const valid = pool.filter((c) => c.ok(truth));
    const scored = valid.map((c) => ({ c, left: remaining.filter(c.ok).length })).filter((x) => x.left < remaining.length).sort((x, y) => x.left - y.left || rand(seed + x.c.text) - rand(seed + y.c.text));
    // Prefer a clue that leaves at least two options for the first cut so it reads like a puzzle, not a giveaway.
    const choice = (clues.length === 0 ? scored.find((x) => x.left >= 2) : undefined) ?? scored[0];
    if (!choice) break;
    clues.push(choice.c.text);
    remaining = remaining.filter(choice.c.ok);
  }
  if (remaining.length !== 1 || remaining[0]["the courier"] !== real) {
    // Should not happen; fall back to a direct, still-sound pair of clues.
    clues.length = 0;
    clues.push(`The courier was not at ${others[0]}.`, `The courier was not at ${others[1]}.`);
  }
  return {
    kind: "analysis",
    prompt: `SITE ANALYSIS · three people, three sites, one each.\n${clues.map((c, i) => `Fact ${i + 1}: ${c}`).join("\n")}\n\nWhere is the courier?`,
    options,
    answer: real,
  };
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
