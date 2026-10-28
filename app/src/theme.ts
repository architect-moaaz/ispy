// Spy Vision HUD: cyan instrumentation over dark glass and real satellite imagery.
export const C = {
  ink: "#0A0E14", // primary obsidian
  ink2: "#121820", // secondary dark glass
  glass: "rgba(18, 24, 32, 0.84)", // panels over the map and camera
  line: "#1C5A66",
  cyan: "#00F0FF",
  cyanDim: "#139CA8",
  cyanGlow: "rgba(0, 240, 255, 0.22)",
  purple: "#9D00FF",
  text: "#DDF6F8",
  dim: "#7FA6AE",
  red: "#FF2A5F",
  amber: "#FFB347",
  ok: "#3DF2A6",
  // Aliases kept so panel-based screens read the same.
  paper: "rgba(18, 24, 32, 0.84)",
  paper2: "#0F1A24",
  onPaper: "#DDF6F8",
  onPaperDim: "#7FA6AE",
  stamp: "#FF2A5F",
};

export const factionColor = (id?: string | null) =>
  id === "raven" ? "#9D00FF" : id === "phantom" ? "#7A5CFF" : id === "cipher" ? "#19E3B1" : C.cyan;

export const F = {
  display: "BarlowCondensed_800ExtraBold",
  displayMed: "BarlowCondensed_600SemiBold",
  typed: "CourierPrime_400Regular",
  typedBold: "CourierPrime_700Bold",
};
