// Spy Vision HUD: cyan instrumentation over dark glass and real satellite imagery.
export const C = {
  ink: "#070B10", // the night: base of every screen
  ink2: "#0F161E", // slate: a surface resting on the night
  slate2: "#16202B", // raised slate: a surface on a surface
  hair: "rgba(141, 178, 189, 0.14)", // hairline between rows
  glass: "rgba(15, 22, 30, 0.86)", // panels over the map and camera
  line: "#1C5A66",
  cyan: "#00E5F2", // the one signal colour: the primary action and whatever is live
  cyanDim: "#139CA8",
  cyanGlow: "rgba(0, 229, 242, 0.18)",
  purple: "#9D00FF",
  indigo: "#7A5CFF",
  amber: "#FFAA00",
  emerald: "#19E3B1",
  ruby: "#FF2A5F",
  text: "#E8F1F3",
  dim: "#8AA3AC",
  red: "#FF2A5F",
  ok: "#3DF2A6",
  // Aliases kept so panel-based screens read the same.
  paper: "rgba(18, 24, 32, 0.84)",
  paper2: "#16202B",
  onPaper: "#E8F1F3",
  onPaperDim: "#8AA3AC",
  stamp: "#FF2A5F",
};

/** All 5 Factions from PRD + World Director */
export const factionColor = (id?: string | null) => {
  switch (id) {
    case "raven": return C.purple;       // Chief ORACLE: Evidence & Investigation (#9D00FF)
    case "phantom": return C.indigo;     // Chief GHOST: Decoys & Stealth (#7A5CFF)
    case "sentinel": return C.amber;     // Chief ATLAS: Defense & Protection (#FFAA00)
    case "cipher": return C.emerald;     // Chief NEXUS: Cryptography & Systems (#19E3B1)
    case "viper": return C.ruby;         // Chief VEX: Negotiation & Alliances (#FF2A5F)
    case "director": return C.cyan;      // Neutral World Director (#00F0FF)
    default: return C.cyan;
  }
};

export const factionGlow = (id?: string | null, opacity = 0.25) => {
  const color = factionColor(id);
  // Convert hex to rgba
  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
};

export const FACTION_INFO: Record<string, { name: string; chief: string; tagline: string; specialty: string; color: string }> = {
  raven: { name: "RAVEN", chief: "ORACLE", tagline: "Patience. Pattern. Proof.", specialty: "Evidence and investigation", color: C.purple },
  phantom: { name: "PHANTOM", chief: "GHOST", tagline: "If they saw you, you were never there.", specialty: "Decoys, stealth, misdirection", color: C.indigo },
  sentinel: { name: "SENTINEL", chief: "ATLAS", tagline: "Hold the line. Shield the network.", specialty: "Defense, group coordination, protection", color: C.amber },
  cipher: { name: "CIPHER", chief: "NEXUS", tagline: "Everything is a system. Systems break.", specialty: "Cryptography, systems puzzles, simulations", color: C.emerald },
  viper: { name: "VIPER", chief: "VEX", tagline: "Every alliance has an expiration date.", specialty: "Negotiation, alliances, social strategy", color: C.ruby },
  director: { name: "WORLD DIRECTOR", chief: "ARBITER", tagline: "One shared world. Invariant truth. Zero bias.", specialty: "Canonical state, deterministic verification", color: C.cyan },
};

export const F = {
  display: "BarlowCondensed_800ExtraBold",
  displayMed: "BarlowCondensed_600SemiBold",
  typed: "CourierPrime_400Regular",
  typedBold: "CourierPrime_700Bold",
};
