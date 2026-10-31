import React, { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";
import { C } from "../theme";

/**
 * The package opening: a flash, three expanding rings, sparks thrown outward, and a slow afterglow.
 * Pure Animated, no native deps, so it plays the same on web, Android and iOS. Drive it by changing
 * `playKey`; the parent handles the object's own shake and the stamp.
 */
const SPARKS = 18;

export function OpenBurst({ playKey, color = C.cyan, size = 320, onDone }: { playKey: number; color?: string; size?: number; onDone?: () => void }) {
  const flash = useRef(new Animated.Value(0)).current;
  const rings = useRef([0, 1, 2].map(() => new Animated.Value(0))).current;
  const sparks = useRef(Array.from({ length: SPARKS }, () => new Animated.Value(0))).current;
  const glow = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!playKey) return;
    flash.setValue(0); glow.setValue(0); rings.forEach((r) => r.setValue(0)); sparks.forEach((s) => s.setValue(0));
    Animated.parallel([
      Animated.sequence([Animated.timing(flash, { toValue: 1, duration: 90, useNativeDriver: true }), Animated.timing(flash, { toValue: 0, duration: 420, easing: Easing.out(Easing.quad), useNativeDriver: true })]),
      Animated.stagger(140, rings.map((r) => Animated.timing(r, { toValue: 1, duration: 900, easing: Easing.out(Easing.cubic), useNativeDriver: true }))),
      Animated.stagger(18, sparks.map((s) => Animated.timing(s, { toValue: 1, duration: 760 + Math.random() * 300, easing: Easing.out(Easing.quad), useNativeDriver: true }))),
      Animated.sequence([Animated.delay(200), Animated.timing(glow, { toValue: 1, duration: 500, useNativeDriver: true }), Animated.timing(glow, { toValue: 0, duration: 1200, easing: Easing.in(Easing.quad), useNativeDriver: true })]),
    ]).start(() => onDone?.());
  }, [playKey]);
  if (!playKey) return null;
  const half = size / 2;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { alignItems: "center", justifyContent: "center" }]}>
      {/* afterglow */}
      <Animated.View style={{ position: "absolute", width: size, height: size, borderRadius: half, backgroundColor: color, opacity: glow.interpolate({ inputRange: [0, 1], outputRange: [0, 0.22] }), transform: [{ scale: glow.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1.1] }) }] }} />
      {/* rings */}
      {rings.map((r, i) => (
        <Animated.View key={i} style={{ position: "absolute", width: size * 0.5, height: size * 0.5, borderRadius: size * 0.25, borderWidth: 2 - i * 0.4, borderColor: color, opacity: r.interpolate({ inputRange: [0, 0.1, 1], outputRange: [0, 0.9, 0] }), transform: [{ scale: r.interpolate({ inputRange: [0, 1], outputRange: [0.5, 2.4 + i * 0.3] }) }] }} />
      ))}
      {/* sparks */}
      {sparks.map((s, i) => {
        const a = (i / SPARKS) * Math.PI * 2 + (i % 2 ? 0.17 : 0);
        const dist = half * (0.9 + (i % 3) * 0.25);
        return (
          <Animated.View key={i} style={{ position: "absolute", width: i % 3 === 0 ? 6 : 4, height: i % 3 === 0 ? 6 : 4, borderRadius: 3, backgroundColor: i % 4 === 0 ? C.text : color,
            opacity: s.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 1, 0] }),
            transform: [{ translateX: s.interpolate({ inputRange: [0, 1], outputRange: [0, Math.cos(a) * dist] }) }, { translateY: s.interpolate({ inputRange: [0, 1], outputRange: [0, Math.sin(a) * dist] }) }, { scale: s.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0.4, 1.4, 0.2] }) }] }} />
        );
      })}
      {/* flash */}
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: color, opacity: flash.interpolate({ inputRange: [0, 1], outputRange: [0, 0.55] }) }]} />
    </View>
  );
}
