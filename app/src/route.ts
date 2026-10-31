import { distanceM } from "./location";

/**
 * Walking routes from the public OSRM demo server (foot profile), with turn-by-turn steps, so the
 * operative never has to leave the app. Good enough for a playtest; swap the base URL for a hosted
 * router before scale. Routes are cached per target and re-plotted when the operative drifts off them.
 */
const OSRM = "https://router.project-osrm.org/route/v1/foot";
export type LatLng = { lat: number; lng: number };
export interface RouteStep { text: string; name: string; distanceM: number; lat: number; lng: number; idx: number; type: string; modifier?: string; bearing: number }
export interface WalkingRoute { coords: LatLng[]; cum: number[]; steps: RouteStep[]; distanceM: number; durationS: number; from: LatLng; to: LatLng }

const cache = new Map<string, WalkingRoute>();
const OFF_ROUTE_M = 40;

const COMPASS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];
const compass = (b: number) => COMPASS[Math.round((((b % 360) + 360) % 360) / 45) % 8];
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

function phrase(type: string, modifier: string | undefined, name: string, bearing: number): string {
  const onto = name ? ` onto ${name}` : "";
  const dir = (modifier ?? "").replace("slight ", "slightly ").replace("sharp ", "sharply ");
  switch (type) {
    case "depart": return `Head ${compass(bearing)}${name ? ` along ${name}` : ""}`;
    case "arrive": return "You are there";
    case "turn": return `Turn ${dir || "ahead"}${onto}`;
    case "end of road": return `At the end of the road, turn ${dir || "ahead"}${onto}`;
    case "fork": return `Keep ${dir || "ahead"}${onto}`;
    case "continue": case "new name": case "merge": case "on ramp": case "off ramp": return `Continue${dir && dir !== "straight" ? ` ${dir}` : ""}${onto}`;
    case "roundabout": case "rotary": case "roundabout turn": return `At the roundabout, leave${onto}`;
    default: return `${cap(dir || "continue")}${onto}`;
  }
}

function nearestIdx(coords: LatLng[], p: LatLng): { idx: number; d: number } {
  let idx = 0, d = Infinity;
  for (let i = 0; i < coords.length; i++) { const x = distanceM(coords[i], p); if (x < d) { d = x; idx = i; } }
  return { idx, d };
}

export async function walkingRoute(from: LatLng, to: LatLng): Promise<WalkingRoute | null> {
  const key = `${to.lat.toFixed(5)},${to.lng.toFixed(5)}`;
  const cached = cache.get(key);
  if (cached && nearestIdx(cached.coords, from).d < OFF_ROUTE_M) return cached;
  try {
    const url = `${OSRM}/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson&steps=true`;
    const res = await fetch(url);
    if (!res.ok) return cached ?? null;
    const j: any = await res.json();
    const r = j?.routes?.[0];
    if (!r?.geometry?.coordinates) return cached ?? null;
    const coords: LatLng[] = r.geometry.coordinates.map(([lng, lat]: [number, number]) => ({ lat, lng }));
    const cum = [0];
    for (let i = 1; i < coords.length; i++) cum[i] = cum[i - 1] + distanceM(coords[i - 1], coords[i]);
    const steps: RouteStep[] = [];
    for (const leg of r.legs ?? []) for (const st of leg.steps ?? []) {
      const [lng, lat] = st.maneuver?.location ?? [to.lng, to.lat];
      const type = st.maneuver?.type ?? "continue", modifier = st.maneuver?.modifier, bearing = st.maneuver?.bearing_after ?? 0;
      const name = (st.name ?? "").trim();
      steps.push({ text: phrase(type, modifier, name, bearing), name, distanceM: st.distance ?? 0, lat, lng, idx: nearestIdx(coords, { lat, lng }).idx, type, modifier, bearing });
    }
    const route: WalkingRoute = { coords, cum, steps, distanceM: r.distance, durationS: r.duration, from, to };
    cache.set(key, route);
    return route;
  } catch {
    return cached ?? null;
  }
}

export interface Guidance { next: RouteStep | null; after: RouteStep | null; toNextM: number; remainingM: number; offRouteM: number; idx: number }

/** Where the operative is on the route, what the next manoeuvre is and how far off. */
export function guide(route: WalkingRoute, at: LatLng): Guidance {
  const { idx, d } = nearestIdx(route.coords, at);
  const here = route.cum[idx];
  const end = route.cum[route.cum.length - 1];
  const upcoming = route.steps.filter((s) => s.type !== "depart" && (s.idx > idx || (s.idx === idx && route.cum[s.idx] - here > -1 && s.type === "arrive")));
  const next = upcoming[0] ?? null;
  const after = upcoming[1] ?? null;
  return { next, after, toNextM: next ? Math.max(0, route.cum[next.idx] - here) : Math.max(0, end - here), remainingM: Math.max(0, end - here), offRouteM: d, idx };
}

// The public router times its routes for cars whatever profile is asked for; walking is timed here, at 1.3 m/s.
export const walkMin = (m: number) => Math.max(1, Math.round(m / 1.3 / 60));
export const fmtWalk = (m: number, _s: number) =>
  `${m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`} · about ${walkMin(m)} min walk`;
export const fmtM = (m: number) => (m < 1000 ? `${Math.round(m / 5) * 5} m` : `${(m / 1000).toFixed(1)} km`);
