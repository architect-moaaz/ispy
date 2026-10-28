import * as Location from "expo-location";

export type Fix = { lat: number; lng: number; accuracyM?: number; mock?: boolean; sim?: boolean };

// A simulated position (dev only) overrides the device GPS for every server call.
let simFix: Fix | null = null;
const listeners = new Set<(f: Fix | null) => void>();

export function setSimFix(f: { lat: number; lng: number } | null) {
  simFix = f ? { ...f, accuracyM: 5, sim: true } : null;
  listeners.forEach((l) => l(simFix));
}
export function getSimFix() {
  return simFix;
}
export function onSimChange(l: (f: Fix | null) => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

function fromObject(o: Location.LocationObject): Fix {
  return {
    lat: o.coords.latitude,
    lng: o.coords.longitude,
    accuracyM: o.coords.accuracy ?? undefined,
    mock: o.mocked ?? false,
  };
}

export async function ensurePermission(): Promise<boolean> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  return status === "granted";
}

export async function currentFix(): Promise<Fix> {
  if (simFix) return simFix;
  const ok = await ensurePermission();
  if (!ok) throw new Error("Location permission denied");
  const o = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
  return fromObject(o);
}

// Streams fixes to `cb`; honours a simulated position when one is set. Returns a stop function.
export function watchFix(cb: (f: Fix) => void, onError?: (e: Error) => void): () => void {
  let sub: Location.LocationSubscription | null = null;
  let stopped = false;
  const offSim = onSimChange((f) => {
    if (f) cb(f);
  });
  if (simFix) cb(simFix);
  (async () => {
    try {
      const ok = await ensurePermission();
      if (!ok) throw new Error("Location permission denied");
      if (stopped) return;
      sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: 3000, distanceInterval: 2 },
        (o) => {
          if (!simFix) cb(fromObject(o));
        },
      );
    } catch (e) {
      if (!simFix) onError?.(e as Error);
    }
  })();
  return () => {
    stopped = true;
    offSim();
    sub?.remove();
  };
}

// Geodesy helpers for the radar.
const R = 6371000;
const rad = (d: number) => (d * Math.PI) / 180;
export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
export function bearingDeg(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}
// Point `m` metres from `p` along `bearing` (used by the dev "300 m away" teleport).
export function offsetM(p: { lat: number; lng: number }, m: number, bearing: number) {
  const br = rad(bearing);
  const lat1 = rad(p.lat);
  const lng1 = rad(p.lng);
  const d = m / R;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(br));
  const lng2 = lng1 + Math.atan2(Math.sin(br) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: (lat2 * 180) / Math.PI, lng: (lng2 * 180) / Math.PI };
}
