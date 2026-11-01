import { api } from "./api";

/**
 * Failures in the 3D street are reported on screen and to the bureau, so a blank view on a phone
 * can be read back from the server log instead of guessed at.
 */
export function report(where: string, err: unknown): string {
  const e = err as any;
  const message = String(e?.message ?? e ?? "unknown");
  const stack = typeof e?.stack === "string" ? e.stack.split("\n").slice(0, 6).join("\n") : "";
  console.warn(`[${where}]`, message);
  api.clientLog({ where, message, stack }).catch(() => {});
  return message;
}
