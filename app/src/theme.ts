export const C = {
  bg: "#0b0f14",
  panel: "#131a22",
  panel2: "#1a232e",
  line: "#243040",
  text: "#e6edf3",
  dim: "#8b9bb0",
  accent: "#3ddc97",
  warn: "#f5b74f",
  danger: "#ff5c5c",
  info: "#5aa9ff",
};

export const factionColor = (id?: string | null) =>
  id === "raven" ? "#5aa9ff" : id === "phantom" ? "#b48cff" : id === "cipher" ? "#3ddc97" : C.dim;

export const mono = { fontFamily: "Menlo, Courier, monospace" } as const;
