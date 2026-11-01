import React, { useEffect, useRef, useState } from "react";
import { Animated, Dimensions, Easing, Image, Pressable, StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { ART } from "../art";
import { C, F } from "../theme";

/**
 * The opening. Not a splash: a short, wordless-until-it-isn't title sequence in the manner of a
 * console game's cold open. Five beats, each a painted frame drifting under a slow camera, a line
 * of the story typed over it, a letterboxed frame with a running timecode, then the title lands in
 * a glitch and holds for a tap. Skippable from the first second; nobody is made to sit through it twice.
 */
const BEATS: { art: any; line: string; sub?: string; from: { x: number; y: number; s: number }; to: { x: number; y: number; s: number } }[] = [
  { art: ART.mission.RECON, line: "A city that never looks up.", from: { x: 0, y: 0, s: 1.08 }, to: { x: -30, y: -14, s: 1.22 } },
  { art: ART.mission.DEAD_DROP, line: "Every bus stop is a dead drop.", sub: "Every stranger carries something.", from: { x: 20, y: 10, s: 1.25 }, to: { x: -10, y: -6, s: 1.1 } },
  { art: ART.portrait.raven, line: "Three agencies. Three chiefs.", sub: "None of them tell you everything.", from: { x: -24, y: 0, s: 1.18 }, to: { x: 16, y: -10, s: 1.3 } },
  { art: ART.mission.INTERCEPT ?? ART.mission.EXTRACTION, line: "Somebody is leaking.", sub: "Somebody wants them at war.", from: { x: 0, y: 20, s: 1.3 }, to: { x: 0, y: -16, s: 1.12 } },
];
const BEAT_MS = 4200;

export function Intro({ onDone }: { onDone: () => void }) {
  const { width, height } = Dimensions.get("window");
  const [beat, setBeat] = useState(0); // BEATS.length = title card
  const [tc, setTc] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTc((x) => x + 1), 40);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (beat >= BEATS.length) return;
    const t = setTimeout(() => setBeat((b) => b + 1), BEAT_MS);
    return () => clearTimeout(t);
  }, [beat]);
  const frames = Math.floor(tc % 25), secs = Math.floor(tc / 25);
  const timecode = `00:${String(Math.floor(secs / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}:${String(frames).padStart(2, "0")}`;
  const done = beat >= BEATS.length;
  return (
    <Pressable style={{ flex: 1, backgroundColor: "#000" }} onPress={() => { if (done) onDone(); }}>
      {!done && <Frame key={beat} beat={BEATS[beat]} width={width} height={height} />}
      {done && <TitleCard width={width} height={height} />}
      {/* letterbox and frame */}
      <View pointerEvents="none" style={[s.bar, { top: 0, height: height * 0.09 }]} />
      <View pointerEvents="none" style={[s.bar, { bottom: 0, height: height * 0.11 }]} />
      <View pointerEvents="none" style={[s.corner, { left: 16, top: height * 0.09 + 14, borderLeftWidth: 1, borderTopWidth: 1 }]} />
      <View pointerEvents="none" style={[s.corner, { right: 16, top: height * 0.09 + 14, borderRightWidth: 1, borderTopWidth: 1 }]} />
      <View pointerEvents="none" style={[s.corner, { left: 16, bottom: height * 0.11 + 14, borderLeftWidth: 1, borderBottomWidth: 1 }]} />
      <View pointerEvents="none" style={[s.corner, { right: 16, bottom: height * 0.11 + 14, borderRightWidth: 1, borderBottomWidth: 1 }]} />
      <Text pointerEvents="none" style={[s.tc, { bottom: height * 0.11 + 18, left: 24 }]}>{timecode}</Text>
      <Text pointerEvents="none" style={[s.tc, { bottom: height * 0.11 + 18, right: 24, color: C.red }]}>● ARCHIVE</Text>
      <Pressable onPress={onDone} style={[s.skip, { top: height * 0.09 + 10 }]} hitSlop={12}>
        <Text style={s.skipText}>{done ? "Tap anywhere to enter" : "Skip"}</Text>
      </Pressable>
    </Pressable>
  );
}

function Frame({ beat, width, height }: { beat: (typeof BEATS)[number]; width: number; height: number }) {
  const k = useRef(new Animated.Value(0)).current; // the camera drift
  const fade = useRef(new Animated.Value(0)).current;
  const line = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(k, { toValue: 1, duration: BEAT_MS + 400, easing: Easing.linear, useNativeDriver: true }).start();
    Animated.sequence([
      Animated.timing(fade, { toValue: 1, duration: 700, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.delay(BEAT_MS - 1500),
      Animated.timing(fade, { toValue: 0, duration: 700, easing: Easing.in(Easing.quad), useNativeDriver: true }),
    ]).start();
    Animated.timing(line, { toValue: 1, duration: 1400, delay: 700, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, []);
  const tx = k.interpolate({ inputRange: [0, 1], outputRange: [beat.from.x, beat.to.x] });
  const ty = k.interpolate({ inputRange: [0, 1], outputRange: [beat.from.y, beat.to.y] });
  const sc = k.interpolate({ inputRange: [0, 1], outputRange: [beat.from.s, beat.to.s] });
  return (
    <Animated.View style={[StyleSheet.absoluteFill, { opacity: fade }]}>
      <Animated.Image source={beat.art} resizeMode="cover" style={{ width, height, transform: [{ translateX: tx }, { translateY: ty }, { scale: sc }] }} />
      <LinearGradient colors={["rgba(0,0,0,0.55)", "rgba(0,0,0,0.1)", "rgba(0,0,0,0.75)"]} locations={[0, 0.45, 1]} style={StyleSheet.absoluteFill} />
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(0,229,242,0.05)" }]} />
      <Animated.View style={{ position: "absolute", left: 28, right: 28, bottom: height * 0.11 + 64, opacity: line, transform: [{ translateY: line.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }] }}>
        <Text style={s.line}>{beat.line}</Text>
        {beat.sub && <Text style={s.sub}>{beat.sub}</Text>}
      </Animated.View>
    </Animated.View>
  );
}

function TitleCard({ width, height }: { width: number; height: number }) {
  const glitch = useRef(new Animated.Value(0)).current;
  const fade = useRef(new Animated.Value(0)).current;
  const tag = useRef(new Animated.Value(0)).current;
  const scan = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.sequence([
      Animated.timing(fade, { toValue: 1, duration: 120, useNativeDriver: true }),
      Animated.timing(glitch, { toValue: 1, duration: 900, easing: Easing.linear, useNativeDriver: true }),
    ]).start();
    Animated.timing(tag, { toValue: 1, duration: 900, delay: 1100, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    Animated.loop(Animated.timing(scan, { toValue: 1, duration: 2600, easing: Easing.linear, useNativeDriver: true })).start();
  }, []);
  const jitter = glitch.interpolate({ inputRange: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 1], outputRange: [-18, 12, -8, 16, -5, 7, -3, 2, -1, 0] });
  const flicker = glitch.interpolate({ inputRange: [0, 0.15, 0.3, 0.45, 0.6, 0.75, 1], outputRange: [1, 0.2, 1, 0.4, 1, 0.7, 1] });
  const scanY = scan.interpolate({ inputRange: [0, 1], outputRange: [0, height] });
  return (
    <Animated.View style={[StyleSheet.absoluteFill, { opacity: fade, backgroundColor: C.ink, alignItems: "center", justifyContent: "center" }]}>
      <Image source={ART.splash} resizeMode="cover" style={[StyleSheet.absoluteFill, { width, height, opacity: 0.35 }]} />
      <LinearGradient colors={["rgba(7,11,16,0.2)", "rgba(7,11,16,0.85)"]} style={StyleSheet.absoluteFill} />
      <Animated.View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, height: 2, backgroundColor: C.cyan, opacity: 0.25, transform: [{ translateY: scanY }] }} />
      <Animated.View style={{ alignItems: "center", opacity: flicker, transform: [{ translateX: jitter }] }}>
        <Text style={s.kicker}>THE BUREAU PRESENTS</Text>
        <Text style={[s.title, { fontSize: Math.min(96, width * 0.22) }]}>iSPY A SPY</Text>
        <Animated.View style={{ position: "absolute", top: 36, left: 0, right: 0, alignItems: "center", opacity: glitch.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.7, 0.3, 0] }), transform: [{ translateX: -6 }] }}>
          <Text style={[s.title, { fontSize: Math.min(96, width * 0.22), color: C.red }]}>iSPY A SPY</Text>
        </Animated.View>
      </Animated.View>
      <Animated.View style={{ alignItems: "center", opacity: tag, transform: [{ translateY: tag.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] }}>
        <Text style={s.tagline}>Walk the city. Verify the site. Trust nobody.</Text>
      </Animated.View>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  bar: { position: "absolute", left: 0, right: 0, backgroundColor: "#000" },
  corner: { position: "absolute", width: 22, height: 22, borderColor: "rgba(0,229,242,0.7)" },
  tc: { position: "absolute", color: C.dim, fontFamily: F.typed, fontSize: 11, letterSpacing: 1.5 },
  skip: { position: "absolute", right: 20, paddingVertical: 6, paddingHorizontal: 10 },
  skipText: { color: C.dim, fontFamily: F.displayMed, fontSize: 12, letterSpacing: 1.8, textTransform: "uppercase" },
  line: { color: C.text, fontFamily: F.display, fontSize: 36, lineHeight: 40, letterSpacing: 0.3 },
  sub: { color: C.cyan, fontFamily: F.typed, fontSize: 15, marginTop: 8 },
  kicker: { color: C.dim, fontFamily: F.displayMed, fontSize: 12, letterSpacing: 4, marginBottom: 6 },
  title: { color: C.text, fontFamily: F.display, letterSpacing: 2, lineHeight: 100 },
  tagline: { color: C.dim, fontFamily: F.typed, fontSize: 14, marginTop: 10, letterSpacing: 0.5 },
});
