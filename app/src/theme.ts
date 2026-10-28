// "Night Bureau": classified paper read under sodium streetlight.
export const C = {
  ink: "#0F1726", // app background, deep navy
  ink2: "#172238", // raised dark surfaces
  line: "#2B3B58",
  paper: "#F2EBDC", // dossier cards
  paper2: "#E4D9C0", // paper edges, inputs on paper
  onPaper: "#1A1D27",
  onPaperDim: "#625E54",
  amber: "#FFB347", // radar, primary action
  stamp: "#D7263D", // decisions, contests, errors
  ok: "#5BD0A1",
  text: "#EFE8D8",
  dim: "#8E99B0",
};

export const factionColor = (id?: string | null) =>
  id === "raven" ? "#3A6BFF" : id === "phantom" ? "#9B6BFF" : id === "cipher" ? "#19C6B0" : C.amber;

export const F = {
  display: "BarlowCondensed_800ExtraBold",
  displayMed: "BarlowCondensed_600SemiBold",
  typed: "CourierPrime_400Regular",
  typedBold: "CourierPrime_700Bold",
};
