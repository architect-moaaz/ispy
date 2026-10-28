import { all } from "./db.ts";

const R = 6371000;
const rad = (d: number) => (d * Math.PI) / 180;

export function distanceM(aLat: number, aLng: number, bLat: number, bLng: number) {
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export function bearingDeg(aLat: number, aLng: number, bLat: number, bLng: number) {
  const y = Math.sin(rad(bLng - aLng)) * Math.cos(rad(bLat));
  const x =
    Math.cos(rad(aLat)) * Math.sin(rad(bLat)) -
    Math.sin(rad(aLat)) * Math.cos(rad(bLat)) * Math.cos(rad(bLng - aLng));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Offset a point by metres north/east (good enough for sub-kilometre moves). */
export function offsetM(lat: number, lng: number, northM: number, eastM: number) {
  return {
    lat: lat + (northM / R) * (180 / Math.PI),
    lng: lng + ((eastM / R) * (180 / Math.PI)) / Math.cos(rad(lat)),
  };
}

export interface AreaRow {
  id: string; name: string; city: string; lat: number; lng: number; radius_m: number; merge_group: string | null;
}

/** Areas are circles in the alpha; the nearest containing area wins. */
export function areaForPoint(lat: number, lng: number): AreaRow | null {
  let best: AreaRow | null = null;
  let bestD = Infinity;
  for (const a of all<AreaRow>("SELECT * FROM areas")) {
    const d = distanceM(lat, lng, a.lat, a.lng);
    if (d <= a.radius_m && d < bestD) { best = a; bestD = d; }
  }
  return best;
}
