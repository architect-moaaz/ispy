// Mock state for screens the server does not drive yet (investigations, bounties, global events).
// Shapes mirror the PRD's Investigation, Evidence, Bounty and WorldEvent entities.

export const MOCK_CASE = {
  caseId: "84729",
  subject: "APEX_SHADOW",
  status: "ACTIVE" as const,
  // Alignment weight toward each of the five PRD agencies, 0..1.
  alignment: [
    { key: "raven", label: "RAVEN", chief: "ORACLE", note: "investigation focus", value: 0.86 },
    { key: "ghost", label: "PHANTOM", chief: "GHOST", note: "stealth / decoys", value: 0.62 },
    { key: "atlas", label: "SENTINEL", chief: "ATLAS", note: "defense / protection", value: 0.44 },
    { key: "nexus", label: "CIPHER", chief: "NEXUS", note: "cryptography / tech", value: 0.58 },
    { key: "viper", label: "VIPER", chief: "VEX", note: "negotiation / diplomacy", value: 0.31 },
  ],
  evidence: [
    { id: "e1", file: "CHIP_TRANS_09.LOG", kind: "intercept", weight: 0.84, label: "Evidence weight" },
    { id: "e2", file: "GEOCON_44.DAT", kind: "geo", weight: 0.91, label: "Confidence" },
    { id: "e3", file: "ENCR_PACKET_03", kind: "cipher", weight: 0.74, label: "Match" },
  ],
  decoyDetected: true,
  confidence: 0.82,
  accuseThreshold: 0.8,
};

export const MOCK_EVENT = {
  id: "op-eclipse",
  name: "OPERATION ECLIPSE",
  brief: "Five fragments of one encrypted dossier are in play across the sector. The first agency to reassemble it owns the epilogue.",
  endsAt: new Date(Date.now() + 14 * 3600_000 + 22 * 60_000).toISOString(),
  progress: [
    { faction: "raven", label: "RAVEN", value: 0.42 },
    { faction: "phantom", label: "PHANTOM", value: 0.31 },
    { faction: "cipher", label: "CIPHER", value: 0.27 },
  ],
};

export type Bounty = {
  id: string; issuer: string; title: string; type: string; reward: { xp: number; credits: number };
  status: "ELIGIBLE" | "ACTIVE" | "LOCKED"; squad: boolean; expiresAt: string; brief: string;
};
export const MOCK_BOUNTIES: Bounty[] = [
  { id: "b1", issuer: "ORACLE", title: "Infiltrate sector B-4", type: "INFILTRATE SECTOR", reward: { xp: 400, credits: 120 }, status: "ELIGIBLE", squad: false, expiresAt: new Date(Date.now() + 5 * 3600_000).toISOString(), brief: "Reach two checkpoints inside the rival-held sector without tripping a contact." },
  { id: "b2", issuer: "NEXUS", title: "Decrypt the eclipse comms", type: "DECRYPT COMMS", reward: { xp: 260, credits: 80 }, status: "ACTIVE", squad: false, expiresAt: new Date(Date.now() + 90 * 60_000).toISOString(), brief: "Three intercepts, one key. Analyst work; a field operative is standing by on the result." },
  { id: "b3", issuer: "GHOST", title: "Squad: shadow the courier", type: "SQUAD OPERATION", reward: { xp: 650, credits: 200 }, status: "ELIGIBLE", squad: true, expiresAt: new Date(Date.now() + 26 * 3600_000).toISOString(), brief: "Three operatives, three legs of a route. Each leg unlocks the next. Nobody meets anybody." },
  { id: "b4", issuer: "ORACLE", title: "Identify the decoy source", type: "COUNTERINTEL", reward: { xp: 320, credits: 0 }, status: "LOCKED", squad: false, expiresAt: new Date(Date.now() + 48 * 3600_000).toISOString(), brief: "Unlocks at Senior agent. Somebody has been seeding false drops; find the pattern." },
];

export const MOCK_INVENTORY = [
  { id: "i1", name: "Intel credits", qty: 340, note: "Non-cash. Spend on cosmetics and HQ themes." },
  { id: "i2", name: "Decoy artifact", qty: 2, note: "Plant one on a drop to mislead a rival." },
  { id: "i3", name: "Cover reset", qty: 1, note: "Rotate your contact id early." },
];
