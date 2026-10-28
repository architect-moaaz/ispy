import React, { useEffect, useRef, useState } from "react";
import { Animated, Easing, Dimensions, StyleSheet, Text, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import Svg, { Circle, Line, Path, Rect } from "react-native-svg";
import { C, F, factionColor } from "../theme";
import { Button, Input } from "../ui";
import { FactionEmblem } from "../graphics";

/**
 * Opt-in augmented HUD over the live camera. Shown once a field operative is on site:
 * the virtual cache floats in view and the on-site check (cipher / code) is resolved here.
 * The camera is a backdrop only: nothing is recorded, uploaded or recognised.
 */
export function ARScan({
  codename, factionId, rank, targetName, prompt, bearing, distanceM, onSubmit, busy, error, onDisengage,
}: {
  codename: string; factionId: string | null; rank: string; targetName: string; prompt: string | null;
  bearing: number | null; distanceM: number | null; onSubmit: (code: string) => void; busy: boolean; error: string | null; onDisengage: () => void;
}) {
  const [perm, requestPerm] = useCameraPermissions();
  const [code, setCode] = useState("");
  const { width, height } = Dimensions.get("window");
  const spin = useRef(new Animated.Value(0)).current;
  const bob = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (perm && !perm.granted && perm.canAskAgain) requestPerm();
  }, [perm?.granted]);
  useEffect(() => {
    const a = Animated.loop(Animated.timing(spin, { toValue: 1, duration: 6000, easing: Easing.linear, useNativeDriver: true }));
    const b = Animated.loop(Animated.sequence([
      Animated.timing(bob, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(bob, { toValue: 0, duration: 1400, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]));
    a.start(); b.start();
    return () => { a.stop(); b.stop(); };
  }, []);
  const rotateY = spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
  const translateY = bob.interpolate({ inputRange: [0, 1], outputRange: [0, -10] });
  const color = factionColor(factionId);

  return (
    <View style={{ flex: 1, backgroundColor: C.ink }}>
      {perm?.granted ? <CameraView style={StyleSheet.absoluteFill} facing="back" /> : <View style={[StyleSheet.absoluteFill, { backgroundColor: "#0b1218" }]} />}
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(10,14,20,0.42)" }]} />
      <Svg pointerEvents="none" style={StyleSheet.absoluteFill} width={width} height={height}>
        {Array.from({ length: Math.ceil(width / 44) + 1 }, (_, i) => <Line key={`v${i}`} x1={i * 44} y1={0} x2={i * 44} y2={height} stroke={C.cyan} strokeOpacity={0.06} />)}
        {Array.from({ length: Math.ceil(height / 44) + 1 }, (_, i) => <Line key={`h${i}`} x1={0} y1={i * 44} x2={width} y2={i * 44} stroke={C.cyan} strokeOpacity={0.06} />)}
        {/* frame corners */}
        <Path d={`M16 60 V36 H40 M${width - 40} 36 H${width - 16} V60 M16 ${height - 150} V${height - 126} H40 M${width - 40} ${height - 126} H${width - 16} V${height - 150}`} stroke={C.cyan} strokeWidth={1.5} fill="none" />
      </Svg>

      {/* badge */}
      <View style={[s.badge, { top: 48 }]}>
        <FactionEmblem id={factionId} size={46} />
        <View>
          <Text style={s.eyebrow}>Intelligence badge</Text>
          <Text style={s.mono}>[{codename.toUpperCase()}]</Text>
          <Text style={s.eyebrow}>Rank {rank.replace("_", " ")}</Text>
        </View>
      </View>
      {/* mini-map radar */}
      <View style={[s.radar, { top: 44 }]}>
        <Svg width={96} height={96}>
          <Circle cx={48} cy={48} r={44} fill={C.glass} stroke={C.cyan} strokeOpacity={0.8} />
          {[0.33, 0.66].map((k) => <Circle key={k} cx={48} cy={48} r={44 * k} fill="none" stroke={C.cyan} strokeOpacity={0.35} />)}
          <Line x1={48} y1={4} x2={48} y2={92} stroke={C.cyan} strokeOpacity={0.3} /><Line x1={4} y1={48} x2={92} y2={48} stroke={C.cyan} strokeOpacity={0.3} />
          {bearing != null && <Path d={`M48 48 L${48 + 40 * Math.sin((bearing * Math.PI) / 180)} ${48 - 40 * Math.cos((bearing * Math.PI) / 180)}`} stroke={C.cyan} strokeWidth={2} />}
          <Circle cx={48} cy={48} r={3} fill={C.cyan} />
        </Svg>
        <Text style={[s.eyebrow, { textAlign: "center" }]}>Tactical mini-map</Text>
      </View>
      <Text style={[s.side, { left: 6, top: height * 0.3 }]}>SIGNAL: SECURE</Text>
      <Text style={[s.side, { left: 6, top: height * 0.55 }]}>ENCRYPTION ACTIVE</Text>
      <Text style={[s.side, { right: 6, top: height * 0.5 }]}>DATA-TELEMETRY</Text>
      <Text style={[s.hud, { left: 16, top: 190 }]}>🔒 CAMERA VIEW · NOT RECORDED</Text>

      {/* the virtual cache */}
      <View pointerEvents="none" style={{ position: "absolute", left: width / 2 - 70, top: height * 0.33, width: 140, alignItems: "center" }}>
        <Text style={[s.hud, { marginBottom: 6 }]}>CYBER VIRTUAL CACHE</Text>
        <Animated.View style={{ transform: [{ perspective: 600 }, { rotateY }, { translateY }] }}>
          <Svg width={120} height={110} viewBox="0 0 120 110">
            <Path d="M20 40 L60 20 L100 40 L60 60 Z" fill={C.cyan} fillOpacity={0.18} stroke={C.cyan} strokeWidth={1.5} />
            <Path d="M20 40 V80 L60 100 V60 Z" fill={C.cyan} fillOpacity={0.1} stroke={C.cyan} strokeWidth={1.5} />
            <Path d="M100 40 V80 L60 100 V60 Z" fill={C.cyan} fillOpacity={0.14} stroke={C.cyan} strokeWidth={1.5} />
            <Rect x={14} y={14} width={92} height={92} fill="none" stroke={C.cyan} strokeOpacity={0.5} strokeDasharray="6 10" />
          </Svg>
        </Animated.View>
        <Text style={s.mono}>LOCATING CACHE… {distanceM == null ? "--" : `${Math.max(0, Math.round(100 - Math.min(100, distanceM)))}%`}</Text>
        <Text style={[s.eyebrow, { textAlign: "center" }]}>{targetName.toUpperCase()}</Text>
      </View>

      {/* cipher panel + actions */}
      <View style={s.sheet}>
        <Text style={s.hud}>AR ANCHOR STATUS: {distanceM != null && distanceM <= 45 ? "LOCKED" : "ENCRYPTED"}</Text>
        {prompt ? (
          <>
            <Text style={[s.mono, { marginTop: 6 }]}>{prompt}</Text>
            <Input value={code} onChangeText={setCode} placeholder="ANSWER" autoCapitalize="characters" autoCorrect={false} onSubmitEditing={() => onSubmit(code)} style={{ marginTop: 8 }} />
            {error && <Text style={[s.mono, { color: C.red }]}>{error}</Text>}
            <Button title="Resolve cipher" onPress={() => onSubmit(code)} loading={busy} style={s.pill} />
          </>
        ) : (
          <Button title="Extract data" onPress={() => onSubmit("")} loading={busy} style={s.pill} />
        )}
        <View style={{ flexDirection: "row", gap: 8, marginTop: 6 }}>
          <Button title="Scan region" kind="ghost" onPress={() => onSubmit("")} disabled={busy} style={{ flex: 1, marginTop: 0, paddingVertical: 9 }} />
          <Button title="Disengage" kind="ghost" onPress={onDisengage} style={{ flex: 1, marginTop: 0, paddingVertical: 9 }} />
        </View>
      </View>
      <View pointerEvents="none" style={[s.badgeRing, { borderColor: color }]} />
    </View>
  );
}

const s = StyleSheet.create({
  badge: { position: "absolute", left: 16, flexDirection: "row", gap: 10, alignItems: "center" },
  radar: { position: "absolute", right: 14, alignItems: "center" },
  eyebrow: { color: C.dim, fontFamily: F.displayMed, fontSize: 10.5, letterSpacing: 1.3, textTransform: "uppercase" },
  mono: { color: C.text, fontFamily: F.typed, fontSize: 12.5 },
  hud: { color: C.cyan, fontFamily: F.displayMed, fontSize: 12, letterSpacing: 1.4, backgroundColor: C.glass, paddingHorizontal: 6, paddingVertical: 2, alignSelf: "flex-start" },
  side: { position: "absolute", color: C.cyan, fontFamily: F.displayMed, fontSize: 11, letterSpacing: 1.6, transform: [{ rotate: "-90deg" }], width: 150, textAlign: "center", marginLeft: -62 },
  sheet: { position: "absolute", left: 14, right: 14, bottom: 22, backgroundColor: C.glass, borderWidth: 1, borderColor: C.cyan + "88", padding: 12 },
  pill: { borderRadius: 30, paddingVertical: 14 },
  badgeRing: { position: "absolute", left: 10, top: 42, width: 58, height: 58, borderRadius: 29, borderWidth: 1, opacity: 0.5 },
});
