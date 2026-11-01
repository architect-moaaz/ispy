import React, { useEffect } from "react";
import { Dimensions, StyleSheet, Text, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import Svg, { Path } from "react-native-svg";
import { C, F } from "../theme";
import { Button } from "../ui";
import type { Fix } from "../location";
import { fmtM, guide, type WalkingRoute } from "../route";
import type { Beacon } from "./Street";

/**
 * Guidance over the live camera. The arrow turns to the next manoeuvre relative to where the phone
 * is pointing; sites and caches hang in the view at their compass bearing, with distance, and slide
 * to the edge when they are out of frame. Anchored by compass and GPS, not by the scenery, so a
 * marker can drift a few degrees near metal and buildings. Nothing is recorded.
 */
const FOV = 32; // half the horizontal field the camera roughly shows
type LL = { lat: number; lng: number };

export function ARGuide({ fix, heading, route, target, beacons, onMap, on3D }: {
  fix: Fix; heading: number | null; route: WalkingRoute | null; target: (LL & { name: string; radiusM: number }) | null; beacons: Beacon[]; onMap: () => void; on3D: () => void;
}) {
  const [perm, requestPerm] = useCameraPermissions();
  useEffect(() => { if (perm && !perm.granted && perm.canAskAgain) requestPerm(); }, [perm?.granted]);
  const { width, height } = Dimensions.get("window");
  const g = route ? guide(route, fix) : null;
  const aim = g?.next ?? target;
  const hd = heading ?? 0;
  const rel = (p: LL) => ((bearing(fix, p) - hd + 540) % 360) - 180;
  const marks = [...(target ? [{ ...target, kind: "target" as const }] : []), ...beacons.filter((b) => dist(fix, b) < 600)];
  return (
    <View style={{ flex: 1, backgroundColor: C.ink }}>
      {perm?.granted ? <CameraView style={StyleSheet.absoluteFill} facing="back" /> : <View style={[StyleSheet.absoluteFill, { backgroundColor: "#0b1218" }]} />}
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(10,14,20,0.25)" }]} />
      {/* horizon markers */}
      {marks.map((m, i) => {
        const r = rel(m);
        const inView = Math.abs(r) <= FOV;
        const x = inView ? width / 2 + (r / FOV) * (width / 2 - 40) : r < 0 ? 10 : width - 150;
        const col = m.kind === "target" ? C.cyan : m.kind === "cache" ? C.amber : m.kind === "signal" ? "#ff5dcb" : C.text;
        return (
          <View key={i} style={[s.mark, { left: Math.max(6, Math.min(x - 70, width - 146)), top: height * (m.kind === "target" ? 0.3 : 0.38) + (i % 3) * 34, borderColor: col, opacity: inView ? 1 : 0.6 }]}>
            <Text style={[s.markTitle, { color: col }]}>{inView ? "" : r < 0 ? "◀ " : ""}{m.name.toUpperCase()}{inView ? "" : r > 0 ? " ▶" : ""}</Text>
            <Text style={s.markSub}>{fmtM(dist(fix, m))}{m.kind === "target" ? " · OBJECTIVE" : ""}</Text>
          </View>
        );
      })}
      {/* the arrow */}
      {aim && (
        <View pointerEvents="none" style={{ position: "absolute", left: width / 2 - 70, top: height * 0.55, width: 140, height: 140, alignItems: "center", justifyContent: "center" }}>
          <Svg width={120} height={120} viewBox="0 0 54 54" style={{ transform: [{ rotate: `${rel(aim)}deg` }] }}>
            <Path d="M27 4 L44 30 L32 30 L32 50 L22 50 L22 30 L10 30 Z" fill={C.cyan} fillOpacity={0.9} stroke={C.ink} strokeWidth={1.2} />
          </Svg>
        </View>
      )}
      <View style={s.top} pointerEvents="none">
        <Text style={s.eyebrow}>AR GUIDE · COMPASS {heading == null ? "SEARCHING" : `${Math.round(heading)}°`} · NOT RECORDED</Text>
        <Text style={s.title}>{target ? target.name : "No objective"}</Text>
        {g && target && <Text style={s.line}>{g.remainingM <= target.radiusM + 15 ? "On the ring. Scan it." : g.next ? `${g.next.text} · in ${fmtM(g.toNextM)}` : `${fmtM(g.remainingM)} along the line`}</Text>}
        {!route && target && <Text style={s.line}>{fmtM(dist(fix, target))} straight line</Text>}
      </View>
      <View style={s.bottom}>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Button title="Map" kind="ghost" onPress={onMap} style={{ flex: 1, marginTop: 0, paddingVertical: 9 }} />
          <Button title="3D street" kind="ghost" onPress={on3D} style={{ flex: 1, marginTop: 0, paddingVertical: 9 }} />
        </View>
      </View>
    </View>
  );
}

function bearing(a: LL, b: LL) {
  const r = Math.PI / 180, dLng = (b.lng - a.lng) * r;
  const y = Math.sin(dLng) * Math.cos(b.lat * r), x = Math.cos(a.lat * r) * Math.sin(b.lat * r) - Math.sin(a.lat * r) * Math.cos(b.lat * r) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}
function dist(a: LL, b: LL) {
  const R = 6371000, r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const s = StyleSheet.create({
  top: { position: "absolute", left: 14, right: 14, top: 14, backgroundColor: "rgba(7,11,16,0.72)", borderWidth: 1, borderColor: "rgba(0,229,242,0.35)", borderRadius: 10, padding: 10 },
  bottom: { position: "absolute", left: 14, right: 14, bottom: 18, backgroundColor: "rgba(7,11,16,0.72)", borderWidth: 1, borderColor: "rgba(141,178,189,0.25)", borderRadius: 10, padding: 10 },
  eyebrow: { color: C.dim, fontFamily: F.displayMed, fontSize: 10.5, letterSpacing: 1.6 },
  title: { color: C.text, fontFamily: F.displayMed, fontSize: 22, marginTop: 2 },
  line: { color: C.cyan, fontFamily: F.typed, fontSize: 13.5, marginTop: 3 },
  mark: { position: "absolute", width: 140, borderLeftWidth: 2, backgroundColor: "rgba(7,11,16,0.7)", paddingHorizontal: 8, paddingVertical: 4 },
  markTitle: { fontFamily: F.displayMed, fontSize: 11.5, letterSpacing: 1.2 },
  markSub: { color: C.text, fontFamily: F.typed, fontSize: 11 },
});
