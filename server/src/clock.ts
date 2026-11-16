/**
 * The players' clock. The server may run anywhere (Fly runs UTC); the operatives are in one city.
 * ISPY_TZ_OFFSET_MIN (minutes east of UTC, e.g. 330 for India) says where the day starts and ends
 * for the daily wire, desk nights, the weekly territory count and the monthly burn notice. Unset,
 * it is the server's own zone, which is right for a laptop in the city.
 */
const OFFSET_MIN = process.env.ISPY_TZ_OFFSET_MIN != null ? Number(process.env.ISPY_TZ_OFFSET_MIN) : -new Date().getTimezoneOffset();

/** The local wall clock as a Date whose UTC fields are the local ones (getUTCHours() is the local hour). */
export const local = (d = new Date()) => new Date(d.getTime() + OFFSET_MIN * 60_000);
export const localHour = (d = new Date()) => local(d).getUTCHours() + local(d).getUTCMinutes() / 60;
/** YYYY-MM-DD in the players' zone. */
export const dayKey = (d = new Date()) => local(d).toISOString().slice(0, 10);
export const monthKey = (d = new Date()) => dayKey(d).slice(0, 7);
export const nextDayKey = (key: string) => { const t = new Date(key + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + 1); return t.toISOString().slice(0, 10); };
export const prevDayKey = (key: string) => { const t = new Date(key + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() - 1); return t.toISOString().slice(0, 10); };
/** ISO week key in the players' zone, e.g. 2026-W47. */
export function weekKey(d = new Date()): string {
  const t = local(d); t.setUTCHours(0, 0, 0, 0);
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const w = Math.ceil((((t.getTime() - y0.getTime()) / 86_400_000) + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(w).padStart(2, "0")}`;
}
/** The instant (ISO, UTC) the players' week began: Monday 00:00 local. */
export function weekStartIso(d = new Date()): string {
  const t = local(d); t.setUTCHours(0, 0, 0, 0);
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() - day + 1);
  return new Date(t.getTime() - OFFSET_MIN * 60_000).toISOString();
}
/** The instant the players' day began. */
export function dayStartIso(d = new Date()): string {
  const t = local(d); t.setUTCHours(0, 0, 0, 0);
  return new Date(t.getTime() - OFFSET_MIN * 60_000).toISOString();
}
/** "09:00" for an instant, on the players' clock. */
export const hhmm = (iso: string) => { const t = local(new Date(iso)); return `${String(t.getUTCHours()).padStart(2, "0")}:${String(t.getUTCMinutes()).padStart(2, "0")}`; };
