import React, { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";
import { C } from "../theme";

/**
 * The package coming apart: it was bait. Flecks lift off the object from random points inside its
 * circle, drift up and outward like ash, flicker, and fade; a dull amber haze hangs for a moment and
 * goes. Pure Animated. Drive it by changing `playKey`; the parent dissolves the image itself.
 */
const FLECKS = 46;

export function Disintegrate({ playKey, size = 180, onDone }: { playKey: number; size?: number; onDone?: () => void }) {
  const flecks = useRef(Array.from({ length: FLECKS }, () => new Animated.Value(0))).current;
  const haze = useRef(new Animated.Value(0)).current;
  const seeds = useRef(Array.from({ length: FLECKS }, (_, i) => {
    const a = Math.random() * Math.PI * 2; const r = Math.sqrt(Math.random()) * size * 0.42;
    return { x: Math.cos(a) * r, y: Math.sin(a) * r, dx: (Math.random() - 0.5) * 90, dy: -40 - Math.random() * 120, w: 2 + (i % 3) * 1.5, grey: i % 4 === 0 };
  })).current;
  useEffect(() => {
    if (!playKey) return;
    haze.setValue(0); flecks.forEach((f) => f.setValue(0));
    Animated.parallel([
      Animated.stagger(22, flecks.map((f) => Animated.timing(f, { toValue: 1, duration: 1100 + Math.random() * 500, easing: Easing.out(Easing.quad), useNativeDriver: true }))),
      Animated.sequence([Animated.timing(haze, { toValue: 1, duration: 500, useNativeDriver: true }), Animated.timing(haze, { toValue: 0, duration: 1500, easing: Easing.in(Easing.quad), useNativeDriver: true })]),
    ]).start(() => onDone?.());
  }, [playKey]);
  if (!playKey) return null;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { alignItems: "center", justifyContent: "center" }]}>
      <Animated.View style={{ position: "absolute", width: size, height: size, borderRadius: size / 2, backgroundColor: C.amber, opacity: haze.interpolate({ inputRange: [0, 1], outputRange: [0, 0.16] }), transform: [{ scale: haze.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1.25] }) }] }} />
      {flecks.map((f, i) => {
        const sd = seeds[i];
        return (
          <Animated.View key={i} style={{ position: "absolute", width: sd.w, height: sd.w, borderRadius: 1, backgroundColor: sd.grey ? C.dim : C.amber,
            opacity: f.interpolate({ inputRange: [0, 0.12, 0.3, 0.5, 0.7, 1], outputRange: [0, 1, 0.5, 0.9, 0.4, 0] }),
            transform: [{ translateX: f.interpolate({ inputRange: [0, 1], outputRange: [sd.x, sd.x + sd.dx] }) }, { translateY: f.interpolate({ inputRange: [0, 1], outputRange: [sd.y, sd.y + sd.dy] }) }, { rotate: f.interpolate({ inputRange: [0, 1], outputRange: ["0deg", `${sd.dx * 4}deg`] }) }] }} />
        );
      })}
    </View>
  );
}
