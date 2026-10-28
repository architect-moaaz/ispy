// Spy Vision HUD: cyan instrumentation over dark glass and real satellite imagery.
export const C = {
  ink: "#07111A", // app background
  ink2: "#0C1C27", // raised panels
  glass: "rgba(8, 22, 32, 0.84)", // panels over the map
  line: "#145A66",
  cyan: "#2EE6F0",
  cyanDim: "#1797A3",
  cyanGlow: "rgba(46, 230, 240, 0.22)",
  text: "#DDF6F8",
  dim: "#7FA6AE",
  red: "#FF3B4A",
  amber: "#FFB347",
  ok: "#3DF2A6",
  // Aliases kept so panel-based screens read the same.
  paper: "rgba(8, 22, 32, 0.84)",
  paper2: "#0F2531",
  onPaper: "#DDF6F8",
  onPaperDim: "#7FA6AE",
  stamp: "#FF3B4A",
};

export const factionColor = (id?: string | null) =>
  id === "raven" ? "#4D8DFF" : id === "phantom" ? "#B48CFF" : id === "cipher" ? "#2EE6F0" : C.cyan;

export const F = {
  display: "BarlowCondensed_800ExtraBold",
  displayMed: "BarlowCondensed_600SemiBold",
  typed: "CourierPrime_400Regular",
  typedBold: "CourierPrime_700Bold",
};
