import React, { useMemo } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import Svg, { Line, Rect } from "react-native-svg";
import { C, F } from "./theme";

/**
 * Real satellite imagery without a native map module: Web Mercator tiles laid out
 * around a centre, with a dark cyan wash and a grid on top. Works on iOS, Android and web.
 * Tiles: Esri World Imagery (attribution required and shown).
 */
const TILE = 256;
const TILE_URL = (z: number, x: number, y: number) =>
  `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;

export type LatLng = { lat: number; lng: number };

function worldPx(p: LatLng, z: number) {
  const n = 2 ** z * TILE;
  const x = ((p.lng + 180) / 360) * n;
  const s = Math.sin((p.lat * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n;
  return { x, y };
}

export interface Projector { (p: LatLng): { x: number; y: number }; metersPerPx: number }

export function SatMap({
  center, zoom = 17, width, height, children,
}: { center: LatLng; zoom?: number; width: number; height: number; children?: (project: Projector) => React.ReactNode }) {
  const { tiles, project } = useMemo(() => {
    const c = worldPx(center, zoom);
    const originX = c.x - width / 2;
    const originY = c.y - height / 2;
    const x0 = Math.floor(originX / TILE), x1 = Math.floor((originX + width) / TILE);
    const y0 = Math.floor(originY / TILE), y1 = Math.floor((originY + height) / TILE);
    const max = 2 ** zoom;
    const tiles: { key: string; url: string; left: number; top: number }[] = [];
    for (let tx = x0; tx <= x1; tx++) for (let ty = y0; ty <= y1; ty++) {
      if (ty < 0 || ty >= max) continue;
      const wx = ((tx % max) + max) % max;
      tiles.push({ key: `${tx}:${ty}`, url: TILE_URL(zoom, wx, ty), left: tx * TILE - originX, top: ty * TILE - originY });
    }
    const metersPerPx = (156543.03 * Math.cos((center.lat * Math.PI) / 180)) / 2 ** zoom;
    const project = Object.assign((p: LatLng) => { const w = worldPx(p, zoom); return { x: w.x - originX, y: w.y - originY }; }, { metersPerPx });
    return { tiles, project };
  }, [center.lat, center.lng, zoom, width, height]);

  return (
    <View style={{ width, height, overflow: "hidden", backgroundColor: "#0a1a24" }}>
      {tiles.map((t) => <Image key={t.key} source={{ uri: t.url }} style={{ position: "absolute", left: t.left, top: t.top, width: TILE, height: TILE }} />)}
      {/* Dark cyan wash so the HUD reads over daylight imagery. */}
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(6, 20, 30, 0.52)" }]} />
      <Svg pointerEvents="none" style={StyleSheet.absoluteFill} width={width} height={height}>
        {Array.from({ length: Math.ceil(width / 40) + 1 }, (_, i) => <Line key={`v${i}`} x1={i * 40} y1={0} x2={i * 40} y2={height} stroke={C.cyan} strokeOpacity={0.07} />)}
        {Array.from({ length: Math.ceil(height / 40) + 1 }, (_, i) => <Line key={`h${i}`} x1={0} y1={i * 40} x2={width} y2={i * 40} stroke={C.cyan} strokeOpacity={0.07} />)}
        <Rect x={0.5} y={0.5} width={width - 1} height={height - 1} fill="none" stroke={C.cyan} strokeOpacity={0.5} />
      </Svg>
      {children?.(project)}
      <Text style={{ position: "absolute", right: 6, bottom: 3, color: C.dim, fontSize: 9, fontFamily: F.typed }}>Imagery: Esri, Maxar, Earthstar Geographics</Text>
    </View>
  );
}
