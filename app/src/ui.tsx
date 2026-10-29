import React, { useEffect, useRef } from "react";
import {
  ActivityIndicator, Animated, Pressable, ScrollView, StyleSheet, Text, TextInput, TextInputProps, View, ViewStyle,
} from "react-native";
import { C, F } from "./theme";

export function Screen({ children, scroll = true, pad = true, scrollEnabled = true }: { children: React.ReactNode; scroll?: boolean; pad?: boolean; scrollEnabled?: boolean }) {
  if (!scroll) return <View style={s.screen}>{children}</View>;
  return (
    <ScrollView style={s.screen} contentContainerStyle={[s.content, !pad && { padding: 0 }]} keyboardShouldPersistTaps="handled" scrollEnabled={scrollEnabled}>
      {children}
    </ScrollView>
  );
}

/** Screen title in the HUD voice: condensed caps, cyan, bracketed. */
export function Display({ children, size = 34, color = C.cyan, style }: { children: React.ReactNode; size?: number; color?: string; style?: any }) {
  return <Text style={[s.display, { fontSize: size, lineHeight: size * 1.05, color }, style]}>{children}</Text>;
}
export function Title({ children, color = C.text, style }: { children: React.ReactNode; color?: string; style?: any }) {
  return <Text style={[s.title, { color }, style]}>{children}</Text>;
}
/** Small instrument label. */
export function Kicker({ children, color = C.cyanDim }: { children: React.ReactNode; color?: string }) {
  return <Text style={[s.kicker, { color }]}>{children}</Text>;
}
export function Body({ children, dim, onPaper, style }: { children: React.ReactNode; dim?: boolean; onPaper?: boolean; style?: any }) {
  return <Text style={[s.body, { color: dim ? C.dim : C.text }, style]}>{children}</Text>;
}
/** Monospace readout: coordinates, intercepts, codes. */
export function Typed({ children, onPaper, bold, style }: { children: React.ReactNode; onPaper?: boolean; bold?: boolean; style?: any }) {
  return <Text style={[s.typed, { fontFamily: bold ? F.typedBold : F.typed }, style]}>{children}</Text>;
}

/** Glass panel with a coloured edge and HUD corner brackets. */
export function Dossier({ children, tab = C.cyan, style }: { children: React.ReactNode; tab?: string; style?: ViewStyle }) {
  return (
    <View style={[s.panel, { borderColor: tab + "88" }, style]}>
      <View style={[s.edge, { backgroundColor: tab }]} />
      <Corner color={tab} pos="tl" /><Corner color={tab} pos="tr" /><Corner color={tab} pos="bl" /><Corner color={tab} pos="br" />
      <View style={s.panelBody}>{children}</View>
    </View>
  );
}
export const Panel = Dossier;

function Corner({ color, pos }: { color: string; pos: "tl" | "tr" | "bl" | "br" }) {
  const v: ViewStyle = { position: "absolute", width: 10, height: 10, borderColor: color };
  const side: ViewStyle =
    pos === "tl" ? { top: -1, left: -1, borderTopWidth: 2, borderLeftWidth: 2 }
    : pos === "tr" ? { top: -1, right: -1, borderTopWidth: 2, borderRightWidth: 2 }
    : pos === "bl" ? { bottom: -1, left: -1, borderBottomWidth: 2, borderLeftWidth: 2 }
    : { bottom: -1, right: -1, borderBottomWidth: 2, borderRightWidth: 2 };
  return <View pointerEvents="none" style={[v, side]} />;
}

export function Button({
  title, onPress, kind = "primary", disabled, loading, style,
}: {
  title: string; onPress: () => void; kind?: "primary" | "ghost" | "danger" | "ink" | "paperGhost";
  disabled?: boolean; loading?: boolean; style?: ViewStyle;
}) {
  const primary = kind === "primary" || kind === "ink";
  const bg = primary ? C.cyan : kind === "danger" ? C.red : "transparent";
  const fg = primary ? C.ink : kind === "danger" ? C.text : C.cyan;
  const border = kind === "danger" ? C.red : C.cyan;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      style={({ pressed }) => [s.btn, { backgroundColor: bg, borderColor: border, opacity: disabled ? 0.4 : pressed ? 0.75 : 1 }, primary && s.btnGlow, style]}
    >
      {loading ? <ActivityIndicator color={fg} /> : <Text style={[s.btnText, { color: fg }]}>{title}</Text>}
    </Pressable>
  );
}

export function Input(props: TextInputProps & { onPaper?: boolean }) {
  const { onPaper: _p, style, ...rest } = props;
  return <TextInput placeholderTextColor={C.dim} {...rest} style={[s.input, style]} />;
}

export function Choice({ label, on, onPress }: { label: string; on: boolean; onPress: () => void; onPaper?: boolean }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={[s.choice, { borderColor: on ? C.cyan : C.line, backgroundColor: on ? C.cyanGlow : C.paper2 }]}>
      <View style={[s.choiceDot, { borderColor: on ? C.cyan : C.line, backgroundColor: on ? C.cyan : "transparent" }]} />
      <Text style={[s.body, { color: C.text, flex: 1, marginBottom: 0 }]}>{label}</Text>
    </Pressable>
  );
}

/** A stamp that slams in when it appears. */
export function Stamp({ text, color = C.red, angle = -8, size = 34, style }: { text: string; color?: string; angle?: number; size?: number; style?: ViewStyle }) {
  const scale = useRef(new Animated.Value(2.4)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, friction: 5, tension: 120, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 1, duration: 120, useNativeDriver: true }),
    ]).start();
  }, []);
  return (
    <Animated.View style={[s.stamp, { borderColor: color, transform: [{ rotate: `${angle}deg` }, { scale }], opacity }, style]}>
      <Text style={[s.stampText, { color, fontSize: size }]}>{text}</Text>
    </Animated.View>
  );
}

export function Banner({ text, color = C.amber }: { text: string; color?: string }) {
  return (
    <View style={[s.banner, { backgroundColor: color }]}>
      <Text style={s.bannerText}>{text}</Text>
    </View>
  );
}

export function Meter({ value, color = C.cyan }: { value: number; color?: string; onPaper?: boolean }) {
  return (
    <View style={s.meterBg}>
      <View style={[s.meterFill, { width: `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`, backgroundColor: color }]} />
    </View>
  );
}

export function Spinner() {
  return <View style={{ padding: 24, alignItems: "center" }}><ActivityIndicator color={C.cyan} /></View>;
}

export function fmtCountdown(iso: string, now: number) {
  const ms = new Date(iso).getTime() - now;
  if (ms <= 0) return "EXPIRED";
  const sec = Math.floor(ms / 1000);
  if (sec < 90) return `${sec}S`;
  const m = Math.floor(sec / 60) % 60;
  const h = Math.floor(sec / 3600);
  if (h >= 1) return `${h}H ${m.toString().padStart(2, "0")}M`;
  return `${m}M ${(sec % 60).toString().padStart(2, "0")}S`;
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.ink },
  content: { padding: 14, paddingBottom: 40, maxWidth: 560, width: "100%", alignSelf: "center" },
  display: { fontFamily: F.displayMed, letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 2, textAlign: "center" },
  title: { fontFamily: F.displayMed, fontSize: 22, lineHeight: 24, letterSpacing: 1, textTransform: "uppercase", marginBottom: 4 },
  kicker: { fontFamily: F.displayMed, fontSize: 13, letterSpacing: 1.6, textTransform: "uppercase", marginBottom: 6 },
  body: { fontSize: 15, lineHeight: 21, marginBottom: 8 },
  typed: { fontSize: 13.5, lineHeight: 19, marginBottom: 6, color: C.text },
  panel: { backgroundColor: C.glass, borderWidth: 1, marginBottom: 12, flexDirection: "row" },
  edge: { width: 4 },
  panelBody: { flex: 1, padding: 12 },
  btn: { paddingVertical: 13, paddingHorizontal: 16, borderWidth: 1.5, alignItems: "center", marginTop: 8 },
  btnGlow: { shadowColor: C.cyan, shadowOpacity: 0.55, shadowRadius: 14, shadowOffset: { width: 0, height: 0 } },
  btnText: { fontFamily: F.displayMed, fontSize: 19, letterSpacing: 2, textTransform: "uppercase" },
  input: { backgroundColor: C.paper2, color: C.text, borderColor: C.line, borderWidth: 1, padding: 12, fontSize: 16, marginBottom: 8, fontFamily: F.typed },
  choice: { flexDirection: "row", alignItems: "center", gap: 10, padding: 11, borderWidth: 1, marginBottom: 6 },
  choiceDot: { width: 12, height: 12, borderWidth: 1.5 },
  stamp: { alignSelf: "flex-start", borderWidth: 3, paddingHorizontal: 10, paddingVertical: 2 },
  stampText: { fontFamily: F.display, letterSpacing: 2, textTransform: "uppercase" },
  banner: { padding: 10, alignItems: "center" },
  bannerText: { color: C.ink, fontFamily: F.displayMed, fontSize: 15, letterSpacing: 1.5, textTransform: "uppercase" },
  meterBg: { height: 6, backgroundColor: C.ink, overflow: "hidden", marginBottom: 10, borderWidth: 1, borderColor: C.line },
  meterFill: { height: 6 },
});
