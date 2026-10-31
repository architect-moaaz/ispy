import React, { useEffect, useRef, useState } from "react";
import { Animated, Easing, Dimensions, Image, StyleSheet, Text, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import Svg, { Circle, Line, Path, Rect } from "react-native-svg";
import { C, F, factionColor } from "../theme";
import { Button, Input, Stamp } from "../ui";
import { ToolDial, type DialTool } from "./ToolDial";
import type { LockKind, ToolId } from "@ispy/shared";
import { FactionEmblem } from "../graphics";
import { ART } from "../art";
import { OpenBurst } from "../effects/OpenBurst";
import { Disintegrate } from "../effects/Disintegrate";
import { RadarSweep } from "../effects/RadarSweep";

/**
 * Opt-in augmented HUD over the live camera. Shown once a field operative is on site:
 * the virtual cache floats in view and the on-site check (cipher / code) is resolved here.
 * The camera is a backdrop only: nothing is recorded, uploaded or recognised.
 */
export function ARScan({
  codename, factionId, rank, targetName, prompt, bearing, distanceM, onSubmit, busy, error, onDisengage, lock, lockOpen, tools, onUnlock, unlockMsg, templateId, crisis, opened, decoyed,
}: {
  codename: string; factionId: string | null; rank: string; targetName: string; prompt: string | null;
  bearing: number | null; distanceM: number | null; onSubmit: (code: string) => void; busy: boolean; error: string | null; onDisengage: () => void;
  lock?: { kind: LockKind; tool: ToolId; label: string } | null; lockOpen?: boolean; tools?: DialTool[]; onUnlock?: (tool: DialTool) => void; unlockMsg?: string | null;
  templateId?: string; crisis?: boolean; opened?: boolean; decoyed?: boolean;
}) {
  // The opening: shake, burst, stamp. Plays when a lock opens and again when the package is extracted.
  const [burst, setBurst] = useState(0);
  const [stamp, setStamp] = useState<string | null>(null);
  const shake = useRef(new Animated.Value(0)).current;
  const pop = useRef(new Animated.Value(1)).current;
  const wasLocked = useRef(!!lock && !lockOpen);
  const play = (label: string) => {
    shake.setValue(0); pop.setValue(1);
    Animated.sequence([
      Animated.timing(shake, { toValue: 1, duration: 420, easing: Easing.linear, useNativeDriver: true }),
      Animated.parallel([
        Animated.sequence([Animated.timing(pop, { toValue: 1.25, duration: 160, easing: Easing.out(Easing.back(2)), useNativeDriver: true }), Animated.timing(pop, { toValue: 1, duration: 500, easing: Easing.out(Easing.quad), useNativeDriver: true })]),
      ]),
    ]).start();
    setTimeout(() => { setBurst((b) => b + 1); setStamp(label); }, 400);
    setTimeout(() => setStamp(null), 2600);
  };
  useEffect(() => { if (wasLocked.current && lockOpen) play("Unlocked"); wasLocked.current = !!lock && !lockOpen; }, [lockOpen]);
  const wasOpened = useRef(!!opened);
  useEffect(() => { if (!wasOpened.current && opened) play("Extracted"); wasOpened.current = !!opened; }, [opened]);
  // The bait: shake, then the object crumbles to ash while the flecks lift off, and a DECOY stamp lands.
  const [dust, setDust] = useState(0);
  const dissolve = useRef(new Animated.Value(0)).current;
  const wasDecoyed = useRef(!!decoyed);
  useEffect(() => {
    if (!wasDecoyed.current && decoyed) {
      shake.setValue(0); dissolve.setValue(0);
      Animated.sequence([
        Animated.timing(shake, { toValue: 1, duration: 420, easing: Easing.linear, useNativeDriver: true }),
        Animated.timing(dissolve, { toValue: 1, duration: 1300, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]).start();
      setTimeout(() => setDust((d) => d + 1), 380);
      setTimeout(() => setStamp("Decoy"), 1200);
      setTimeout(() => setStamp(null), 3600);
    }
    wasDecoyed.current = !!decoyed;
  }, [decoyed]);
  const shakeX = shake.interpolate({ inputRange: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1], outputRange: [0, -6, 6, -8, 8, -6, 6, -4, 4, -2, 0] });
  const locked = !!lock && !lockOpen;
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
        <RadarSweep size={96} color={C.cyan} bearing={bearing} />
        <Text style={[s.eyebrow, { textAlign: "center", marginTop: 2 }]}>Tactical Radar</Text>
      </View>
      <Text style={[s.side, { left: 6, top: height * 0.3 }]}>SIGNAL: SECURE</Text>
      <Text style={[s.side, { left: 6, top: height * 0.55 }]}>ENCRYPTION ACTIVE</Text>
      <Text style={[s.side, { right: 6, top: height * 0.5 }]}>DATA-TELEMETRY</Text>
      <Text style={[s.hud, { left: 16, top: 190 }]}>🔒 CAMERA VIEW · NOT RECORDED</Text>

      {/* The package itself: a painted object floating in the camera view, dim and red-ringed while locked. */}
      <View pointerEvents="none" style={{ position: "absolute", left: width / 2 - 90, top: height * 0.26, width: 180, alignItems: "center" }}>
        {(() => {
          const far = distanceM == null || distanceM > 45;
          const ringColor = decoyed ? C.amber : far ? C.dim : locked ? C.red : C.ok;
          const art = crisis ? ART.pkg.CRISIS : ART.pkg[templateId ?? "DEAD_DROP"] ?? ART.pkg.DEAD_DROP;
          return (
            <>
              <Text style={[s.eyebrow, { color: ringColor, marginBottom: 4 }]}>CONTAINMENT: {decoyed ? "EMPTY · BAIT" : far ? "OUT OF RANGE" : locked ? "LOCKED" : "OPEN"}</Text>
              <Animated.View style={{ opacity: dissolve.interpolate({ inputRange: [0, 0.35, 1], outputRange: [1, 0.75, 0] }), transform: [{ translateY }, { translateX: shakeX }, { scale: Animated.multiply(pop, dissolve.interpolate({ inputRange: [0, 1], outputRange: [1, 0.82] })) }, { translateY: dissolve.interpolate({ inputRange: [0, 1], outputRange: [0, 18] }) }, { rotate: spin.interpolate({ inputRange: [0, 0.25, 0.5, 0.75, 1], outputRange: ["-4deg", "3deg", "-2deg", "4deg", "-4deg"] }) }] }}>
                <View style={[s.pkgRing, { borderColor: ringColor, shadowColor: ringColor }]}>
                  <Image source={art} style={[s.pkgImg, (far || locked) && { opacity: 0.55 }]} />
                  {locked && !far && <View style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(255,93,108,0.18)", borderRadius: 80 }]} />}
                </View>
              </Animated.View>
              <Text style={[s.mono, { marginTop: 6, fontFamily: F.displayMed, fontSize: 15, letterSpacing: 1 }]}>{targetName}</Text>
              <Text style={s.eyebrow}>DISTANCE: {distanceM == null ? "--" : `${distanceM.toFixed(1)}M`}</Text>
            </>
          );
        })()}
        {lock && (
          <View style={[s.lockTag, { borderColor: locked ? C.red : C.ok }]}>
            <Text style={[s.hud, { backgroundColor: "transparent", color: locked ? C.red : C.ok }]}>{locked ? `${lock.label.toUpperCase()} · NEEDS ${lock.tool.toUpperCase()}` : `OPENED WITH ${lock.tool.toUpperCase()}`}</Text>
          </View>
        )}
      </View>
      <View pointerEvents="none" style={{ position: "absolute", left: width / 2 - 170, top: height * 0.26 - 80, width: 340, height: 340 }}>
        <OpenBurst playKey={burst} color={stamp === "Extracted" ? C.ok : C.cyan} size={340} />
        <Disintegrate playKey={dust} size={180} />
      </View>
      {stamp && <View pointerEvents="none" style={[s.stampWrap, { left: width / 2 - 170, width: 340, top: height * 0.26 + 40 }]}><Stamp text={stamp} size={46} color={stamp === "Decoy" ? C.amber : C.red} /></View>}

      {/* cipher panel + actions */}
      <View style={s.sheet}>
        <Text style={s.hud}>AR ANCHOR STATUS: {distanceM != null && distanceM <= 45 ? (locked ? `${lock!.label.toUpperCase()} PACKAGE` : "LOCKED ON") : "ENCRYPTED"}</Text>
        {locked && tools && onUnlock ? (
          <>
            <Text style={[s.mono, { marginTop: 4 }]}>{distanceM != null && distanceM <= 45 ? `Spin the dial to the right tool and use it on the package.` : `Get inside the ring, then open it with a ${lock!.tool}.`}</Text>
            <ToolDial tools={tools} busy={busy} hint={unlockMsg ?? null} onUse={onUnlock} />
            <Button title="Disengage" kind="ghost" onPress={onDisengage} style={{ marginTop: 0, paddingVertical: 9 }} />
          </>
        ) : prompt ? (
          <>
            <Text style={[s.mono, { marginTop: 6 }]}>{prompt}</Text>
            <Input value={code} onChangeText={setCode} placeholder="ANSWER" autoCapitalize="characters" autoCorrect={false} onSubmitEditing={() => onSubmit(code)} style={{ marginTop: 8 }} />
            {error && <Text style={[s.mono, { color: C.red }]}>{error}</Text>}
            <Button title="Resolve cipher" onPress={() => onSubmit(code)} loading={busy} style={s.pill} />
          </>
        ) : (
          <Button title="Extract data" onPress={() => onSubmit("")} loading={busy} style={s.pill} />
        )}
        {!(locked && tools && onUnlock) && (
          <View style={{ flexDirection: "row", gap: 8, marginTop: 6 }}>
            <Button title="Scan region" kind="ghost" onPress={() => onSubmit("")} disabled={busy} style={{ flex: 1, marginTop: 0, paddingVertical: 9 }} />
            <Button title="Disengage" kind="ghost" onPress={onDisengage} style={{ flex: 1, marginTop: 0, paddingVertical: 9 }} />
          </View>
        )}
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
  pkgRing: { width: 160, height: 160, borderRadius: 80, borderWidth: 2, overflow: "hidden", backgroundColor: "#000", shadowOpacity: 0.9, shadowRadius: 22 },
  pkgImg: { width: 160, height: 160, borderRadius: 80 },
  lockTag: { marginTop: 6, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3, backgroundColor: C.glass },
  stampWrap: { position: "absolute", alignItems: "center", justifyContent: "center" },
  badgeRing: { position: "absolute", left: 10, top: 42, width: 58, height: 58, borderRadius: 29, borderWidth: 1, opacity: 0.5 },
});
