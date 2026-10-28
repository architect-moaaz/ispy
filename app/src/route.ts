import { Linking, Platform } from "react-native";
import { distanceM } from "./location";

/**
 * Walking routes from the public OSRM demo server (foot profile). Good enough for a playtest;
 * swap the base URL for a hosted router before scale. Routes are cached per target and refreshed
 * only when the operative has drifted well off the route's start.
 */
const OSRM = "https://router.project-osrm.org/route/v1/foot";
export type LatLng = { lat: number; lng: number };
export interface WalkingRoute { coords: LatLng[]; distanceM: number; durationS: number; from: LatLng; to: LatLng }

const cache = new Map<string, WalkingRoute>();

export async function walkingRoute(from: LatLng, to: LatLng): Promise<WalkingRoute | null> {
  const key = `${to.lat.toFixed(5)},${to.lng.toFixed(5)}`;
  const cached = cache.get(key);
  if (cached && distanceM(cached.from, from) < 60) return cached;
  try {
    const url = `${OSRM}/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson&steps=false`;
    const res = await fetch(url);
    if (!res.ok) return cached ?? null;
    const j: any = await res.json();
    const r = j?.routes?.[0];
    if (!r?.geometry?.coordinates) return cached ?? null;
    const route: WalkingRoute = {
      coords: r.geometry.coordinates.map(([lng, lat]: [number, number]) => ({ lat, lng })),
      distanceM: r.distance, durationS: r.duration, from, to,
    };
    cache.set(key, route);
    return route;
  } catch {
    return cached ?? null;
  }
}

/** Hand off to the phone's maps app for turn-by-turn walking directions. */
export function openTurnByTurn(to: LatLng, label: string) {
  const q = `${to.lat},${to.lng}`;
  const url = Platform.OS === "ios"
    ? `maps://?daddr=${q}&dirflg=w`
    : Platform.OS === "android"
      ? `google.navigation:q=${q}&mode=w`
      : `https://www.google.com/maps/dir/?api=1&destination=${q}&travelmode=walking`;
  const fallback = `https://www.google.com/maps/dir/?api=1&destination=${q}&travelmode=walking`;
  Linking.openURL(url).catch(() => Linking.openURL(fallback));
  void label;
}

export const fmtWalk = (m: number, s: number) =>
  `${m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`} · about ${Math.max(1, Math.round(s / 60))} min walk`;
