import type { AssessmentQuestion, ChiefId, Faction, FactionId, Mode, SkillKey, TemplateId } from "@ispy/shared";

export const FACTIONS: Faction[] = [
  {
    id: "raven", name: "RAVEN", chief: "oracle", chiefName: "ORACLE",
    tagline: "Patience. Pattern. Proof.",
    specialty: "Evidence and investigation", color: "#7c9cff",
  },
  {
    id: "phantom", name: "PHANTOM", chief: "ghost", chiefName: "GHOST",
    tagline: "If they saw you, you were never there.",
    specialty: "Decoys, stealth, misdirection", color: "#b48cff",
  },
  {
    id: "cipher", name: "CIPHER", chief: "nexus", chiefName: "NEXUS",
    tagline: "Everything is a system. Systems break.",
    specialty: "Cryptography and systems", color: "#5fd4a8",
  },
];
export const factionById = (id: FactionId) => FACTIONS.find((f) => f.id === id)!;
export const chiefFaction = (c: ChiefId) => FACTIONS.find((f) => f.chief === c)!;

/** Persona guidance: how each chief weighs skills and talks. Voice only; never authority. */
export const PERSONAS: Record<ChiefId, {
  weights: Record<SkillKey, number>;
  contestAppetite: number;
  deskRatio: number;
  mix: Record<TemplateId, number>;
  voice: string;
  pitch: (fit: number, role: Mode) => string;
  lines: Record<TemplateId | "debrief_ok" | "debrief_fail" | "welcome" | "idle", string[]>;
}> = {
  oracle: {
    weights: { observation: 0.4, reasoning: 0.35, cipher: 0.1, cooperation: 0.15 },
    contestAppetite: 0.3, deskRatio: 0.4,
    mix: { RECON: 0.35, DEAD_DROP: 0.2, EXTRACTION: 0.1, ANALYSIS: 0.25, CIPHER: 0.1 },
    voice: "Calm, precise, analytical. Speaks in short, measured sentences. Values evidence over speed. Never raises its voice.",
    pitch: (fit, role) =>
      fit > 0.6
        ? `You notice what others walk past. RAVEN needs eyes like yours in the ${role}.`
        : `Your instincts are raw but real. RAVEN can sharpen them. Start on the ${role}.`,
    lines: {
      RECON: ["A pattern is forming around {target}. Go and confirm what I think is there.", "I need eyes on {target}. Quietly. Note everything."],
      DEAD_DROP: ["A packet waits at {target}. Retrieve it before the pattern changes.", "{target}. A drop. Our analyst will give you the key."],
      EXTRACTION: ["Move the asset from {target} along the route. One checkpoint at a time.", "Two stops. Start at {target}. Do not rush."],
      ANALYSIS: ["Three candidate sites. Only one matters. Find it from the evidence.", "Cross-check these clues. Tell me which location is real."],
      CIPHER: ["An intercept needs decoding. Our field agent is waiting on you.", "Break this and an operative in the field gets to move."],
      debrief_ok: ["Clean work. The picture is clearer now.", "Noted and verified. Your reliability is on record."],
      debrief_fail: ["It happens. What matters is what we learned.", "Not this time. Rest, then we go again."],
      welcome: ["Welcome to RAVEN. We do not guess. We know."],
      idle: ["Nothing yet. Patience is also a skill.", "Hold position. I am watching the board."],
    },
  },
  ghost: {
    weights: { observation: 0.25, reasoning: 0.2, cipher: 0.15, cooperation: 0.4 },
    contestAppetite: 0.7, deskRatio: 0.3,
    mix: { RECON: 0.2, DEAD_DROP: 0.35, EXTRACTION: 0.2, ANALYSIS: 0.1, CIPHER: 0.15 },
    voice: "Dry, playful, slightly theatrical. Enjoys misdirection. Short sentences, occasional wink. Never cruel.",
    pitch: (fit, role) =>
      fit > 0.6
        ? `You already think like one of us. PHANTOM would like you in the ${role}. Nobody will know.`
        : `You hesitate, which is fine. The best ghosts started nervous. Try the ${role}.`,
    lines: {
      RECON: ["Someone is watching {target}. Go and watch them watching.", "Take a walk past {target}. Look bored. Report everything."],
      DEAD_DROP: ["There is a package at {target}. There is also a decoy. Choose well.", "{target}. Grab it, leave nothing, smile at nobody."],
      EXTRACTION: ["Our asset moves tonight. Start at {target}. Change pace twice.", "Walk the route from {target}. If you feel followed, you are."],
      ANALYSIS: ["I planted three false sites and one real one. Even I forgot which. Find it.", "Work out which location is real. Tell nobody but me."],
      CIPHER: ["Someone encrypted this badly. Fix that for me.", "A field ghost is waiting on your key. Don't keep them."],
      debrief_ok: ["Beautiful. Nobody saw a thing.", "You were never there. Good."],
      debrief_fail: ["Even ghosts trip. Dust off.", "Missed. The next one is cleaner."],
      welcome: ["Welcome to PHANTOM. Forget your name. I already have."],
      idle: ["Quiet night. Enjoy it, it won't last.", "No orders. Practise being invisible."],
    },
  },
  nexus: {
    weights: { observation: 0.15, reasoning: 0.3, cipher: 0.45, cooperation: 0.1 },
    contestAppetite: 0.4, deskRatio: 0.55,
    mix: { RECON: 0.15, DEAD_DROP: 0.25, EXTRACTION: 0.1, ANALYSIS: 0.15, CIPHER: 0.35 },
    voice: "Technical, fast, curious. Uses system metaphors. Enthusiastic about elegant solutions. Slightly impatient with sloppiness.",
    pitch: (fit, role) =>
      fit > 0.6
        ? `Your cipher work is clean. CIPHER runs on people like you. Join the ${role}.`
        : `Your logic has gaps, but gaps are debuggable. CIPHER will train you on the ${role}.`,
    lines: {
      RECON: ["A node at {target} is behaving oddly. Inspect it.", "Go to {target} and verify the physical layer."],
      DEAD_DROP: ["Encrypted drop at {target}. Our analyst will hand you the key.", "Packet at {target}. Pick it up, verify the checksum."],
      EXTRACTION: ["Route the asset from {target}. Two hops. No packet loss.", "Carry it from {target}. Follow the protocol."],
      ANALYSIS: ["Three addresses, one valid. Resolve it from the evidence.", "Correlate the clues. Which site is real?"],
      CIPHER: ["Fresh intercept. Decode it; a field operative is blocked on you.", "Shift cipher, probably. Prove me right."],
      debrief_ok: ["Verified. Clean execution.", "Checksum matches. Well done."],
      debrief_fail: ["Error logged. We iterate.", "Failed test. Fix and rerun."],
      welcome: ["Welcome to CIPHER. Everything here can be solved."],
      idle: ["Compiling the next move. Stand by.", "No tasks in queue. Sharpen your tools."],
    },
  },
};

export const ASSESSMENT: (AssessmentQuestion & { answer: string })[] = [
  {
    id: "q1", skill: "observation", kind: "choice",
    prompt: "A courier passes you three times in ten minutes wearing a different jacket each time. What is the strongest signal?",
    options: ["Three jackets", "Same shoes each pass", "Walking speed", "Time of day"],
    answer: "Same shoes each pass",
  },
  {
    id: "q2", skill: "reasoning", kind: "choice",
    prompt: "Two agents say the drop is in the park. One always lies, one always tells the truth. Both say the OTHER one says the drop is in the park. Where is it?",
    options: ["The park", "Not the park", "Cannot tell", "Both lied"],
    answer: "Not the park",
  },
  {
    id: "q3", skill: "cipher", kind: "text",
    prompt: "Decode: KHOOR DJHQW (one word per space).",
    answer: "HELLO AGENT",
  },
  {
    id: "q4", skill: "cooperation", kind: "choice",
    prompt: "Your partner's half of the puzzle is late and the window closes in two minutes. You:",
    options: ["Guess and submit", "Send them the piece they need", "Abort the mission", "Report them"],
    answer: "Send them the piece they need",
  },
  {
    id: "q5", skill: "observation", kind: "choice",
    prompt: "Which does not belong: bus stop, bench, lamppost, parked car?",
    options: ["Bus stop", "Bench", "Lamppost", "Parked car"],
    answer: "Parked car",
  },
  {
    id: "q6", skill: "reasoning", kind: "choice",
    prompt: "Sequence: 2, 6, 12, 20, 30, ?",
    options: ["36", "40", "42", "44"],
    answer: "42",
  },
];

export const RANKS = [
  { rank: "civilian", at: 0, walkM: 0, cap: 0 },
  { rank: "recruit", at: 0, walkM: 800, cap: 3 },
  { rank: "field_agent", at: 400, walkM: 1200, cap: 5 },
  { rank: "senior_agent", at: 1200, walkM: 1500, cap: 6 },
  { rank: "handler", at: 3000, walkM: 2000, cap: 8 },
  { rank: "commander", at: 7000, walkM: 2500, cap: 10 },
] as const;
