import React, { useEffect, useRef } from "react";
import {
  ActivityIndicator,
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
} from "react-native";
import { C, F } from "./theme";

export function Screen({ children, scroll = true }: { children: React.ReactNode; scroll?: boolean }) {
  if (!scroll) return <View style={s.screen}>{children}</View>;
  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  );
}

/** Big condensed headline. The type is the poster. */
export function Display({ children, size = 44, color = C.text, style }: { children: React.ReactNode; size?: number; color?: string; style?: any }) {
  return <Text style={[s.display, { fontSize: size, lineHeight: size * 0.94, color }, style]}>{children}</Text>;
}
export function Title({ children, color = C.text, style }: { children: React.ReactNode; color?: string; style?: any }) {
  return <Text style={[s.title, { color }, style]}>{children}</Text>;
}
/** One quiet line above a headline: where you are, what this is. Sentence case, never tracked caps. */
export function Kicker({ children, color = C.dim }: { children: React.ReactNode; color?: string }) {
  return <Text style={[s.kicker, { color }]}>{children}</Text>;
}
export function Body({ children, dim, onPaper, style }: { children: React.ReactNode; dim?: boolean; onPaper?: boolean; style?: any }) {
  const color = onPaper ? (dim ? C.onPaperDim : C.onPaper) : dim ? C.dim : C.text;
  return <Text style={[s.body, { color }, style]}>{children}</Text>;
}
/** Typewriter text for the words of a dossier: briefs, intercepts, codes. */
export function Typed({ children, onPaper = true, bold, style }: { children: React.ReactNode; onPaper?: boolean; bold?: boolean; style?: any }) {
  return <Text style={[s.typed, { color: onPaper ? C.onPaper : C.text, fontFamily: bold ? F.typedBold : F.typed }, style]}>{children}</Text>;
}

/** A paper document with a coloured ink tab on its left edge. Mission briefs and offers live here. */
export function Dossier({ children, tab = C.amber, style }: { children: React.ReactNode; tab?: string; style?: ViewStyle }) {
  return (
    <View style={[s.dossier, style]}>
      <View style={[s.dossierTab, { backgroundColor: tab }]} />
      <View style={s.dossierBody}>{children}</View>
    </View>
  );
}
/** Dark raised surface for app chrome (stats, chat, settings). */
export function Panel({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[s.panel, style]}>{children}</View>;
}

export function Button({
  title, onPress, kind = "primary", disabled, loading, style,
}: {
  title: string; onPress: () => void; kind?: "primary" | "ghost" | "danger" | "ink" | "paperGhost";
  disabled?: boolean; loading?: boolean; style?: ViewStyle;
}) {
  const bg = { primary: C.amber, danger: C.stamp, ink: C.onPaper, ghost: "transparent", paperGhost: "transparent" }[kind];
  const fg = { primary: C.ink, danger: C.paper, ink: C.paper, ghost: C.text, paperGhost: C.onPaper }[kind];
  const border = kind === "ghost" ? C.line : kind === "paperGhost" ? C.onPaper : bg;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      style={({ pressed }) => [s.btn, { backgroundColor: bg, borderColor: border, opacity: disabled ? 0.45 : pressed ? 0.75 : 1 }, style]}
    >
      {loading ? <ActivityIndicator color={fg} /> : <Text style={[s.btnText, { color: fg }]}>{title}</Text>}
    </Pressable>
  );
}

export function Input(props: TextInputProps & { onPaper?: boolean }) {
  const { onPaper, style, ...rest } = props;
  return (
    <TextInput
      placeholderTextColor={onPaper ? C.onPaperDim : C.dim}
      {...rest}
      style={[s.input, onPaper && { backgroundColor: C.paper2, color: C.onPaper, borderColor: C.paper2, fontFamily: F.typed }, style]}
    />
  );
}

/** A choice in a list of answers. */
export function Choice({ label, on, onPress, onPaper }: { label: string; on: boolean; onPress: () => void; onPaper?: boolean }) {
  const border = on ? C.stamp : onPaper ? "#CFC4A8" : C.line;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={[s.choice, { borderColor: border, backgroundColor: onPaper ? (on ? "#F9E3E0" : C.paper2) : on ? "#2A1A22" : C.ink2 }]}>
      <View style={[s.choiceDot, { borderColor: border, backgroundColor: on ? C.stamp : "transparent" }]} />
      <Text style={[s.body, { color: onPaper ? C.onPaper : C.text, flex: 1, marginBottom: 0 }]}>{label}</Text>
    </Pressable>
  );
}

/** A rubber stamp that slams in when it appears. */
export function Stamp({ text, color = C.stamp, angle = -8, size = 34, style }: { text: string; color?: string; angle?: number; size?: number; style?: ViewStyle }) {
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

export function Meter({ value, color = C.amber, onPaper }: { value: number; color?: string; onPaper?: boolean }) {
  return (
    <View style={[s.meterBg, onPaper && { backgroundColor: C.paper2 }]}>
      <View style={[s.meterFill, { width: `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`, backgroundColor: color }]} />
    </View>
  );
}

export function Spinner() {
  return (
    <View style={{ padding: 24, alignItems: "center" }}>
      <ActivityIndicator color={C.amber} />
    </View>
  );
}

export function fmtCountdown(iso: string, now: number) {
  const ms = new Date(iso).getTime() - now;
  if (ms <= 0) return "expired";
  const sec = Math.floor(ms / 1000);
  if (sec < 90) return `${sec}s`;
  const m = Math.floor(sec / 60);
  return `${m}m ${(sec % 60).toString().padStart(2, "0")}s`;
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.ink },
  content: { padding: 18, paddingBottom: 48, maxWidth: 520, width: "100%", alignSelf: "center" },
  display: { fontFamily: F.display, letterSpacing: -0.5, marginBottom: 10 },
  title: { fontFamily: F.display, fontSize: 26, lineHeight: 26, marginBottom: 6 },
  kicker: { fontFamily: F.displayMed, fontSize: 16, marginBottom: 4 },
  body: { fontSize: 15, lineHeight: 21, marginBottom: 8 },
  typed: { fontSize: 14.5, lineHeight: 21, marginBottom: 8 },
  dossier: { flexDirection: "row", backgroundColor: C.paper, borderRadius: 3, marginBottom: 14, overflow: "hidden",
    shadowColor: "#000", shadowOpacity: 0.5, shadowRadius: 10, shadowOffset: { width: 0, height: 6 }, elevation: 6 },
  dossierTab: { width: 8 },
  dossierBody: { flex: 1, padding: 14, paddingLeft: 14 },
  panel: { backgroundColor: C.ink2, borderRadius: 6, padding: 14, marginBottom: 14, borderWidth: 1, borderColor: C.line },
  btn: { paddingVertical: 13, paddingHorizontal: 16, borderRadius: 4, borderWidth: 1.5, alignItems: "center", marginTop: 8 },
  btnText: { fontFamily: F.display, fontSize: 19, letterSpacing: 0.3 },
  input: { backgroundColor: C.ink2, color: C.text, borderColor: C.line, borderWidth: 1, borderRadius: 4, padding: 12, fontSize: 16, marginBottom: 8 },
  choice: { flexDirection: "row", alignItems: "center", gap: 10, padding: 11, borderRadius: 4, borderWidth: 1.5, marginBottom: 6 },
  choiceDot: { width: 14, height: 14, borderRadius: 7, borderWidth: 1.5 },
  stamp: { alignSelf: "flex-start", borderWidth: 3, borderRadius: 4, paddingHorizontal: 10, paddingVertical: 2 },
  stampText: { fontFamily: F.display, letterSpacing: 2, textTransform: "uppercase" },
  banner: { padding: 10, alignItems: "center" },
  bannerText: { color: C.ink, fontFamily: F.displayMed, fontSize: 16 },
  meterBg: { height: 7, backgroundColor: C.ink, borderRadius: 2, overflow: "hidden", marginBottom: 10 },
  meterFill: { height: 7 },
});
