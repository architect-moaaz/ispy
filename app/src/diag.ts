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

/**
 * An uncaught error in a release build closes the app before anything is logged. The global handler
 * reports it first and only then hands over to React Native's own handler, so the server log shows
 * the last error before an exit. Installed once at startup.
 */
export function installGlobalErrorReporting() {
  const utils = (globalThis as any).ErrorUtils;
  if (!utils?.setGlobalHandler || utils.__ispyInstalled) return;
  const previous = utils.getGlobalHandler?.();
  utils.__ispyInstalled = true;
  utils.setGlobalHandler((err: unknown, isFatal?: boolean) => {
    report(isFatal ? "global.fatal" : "global", err);
    // Give the report a moment to leave the device before the default handler exits the app.
    setTimeout(() => previous?.(err, isFatal), isFatal ? 1500 : 0);
  });
}
