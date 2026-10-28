import React from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
} from "react-native";
import { C, mono } from "./theme";

export function Screen({ children, scroll = true }: { children: React.ReactNode; scroll?: boolean }) {
  if (!scroll) return <View style={s.screen}>{children}</View>;
  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  );
}

export function H1({ children }: { children: React.ReactNode }) {
  return <Text style={s.h1}>{children}</Text>;
}
export function H2({ children }: { children: React.ReactNode }) {
  return <Text style={s.h2}>{children}</Text>;
}
export function P({ children, dim, style }: { children: React.ReactNode; dim?: boolean; style?: any }) {
  return <Text style={[s.p, dim && { color: C.dim }, style]}>{children}</Text>;
}
export function Label({ children }: { children: React.ReactNode }) {
  return <Text style={s.label}>{children}</Text>;
}

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[s.card, style]}>{children}</View>;
}

export function Button({
  title,
  onPress,
  kind = "primary",
  disabled,
  loading,
  style,
}: {
  title: string;
  onPress: () => void;
  kind?: "primary" | "ghost" | "danger";
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
}) {
  const bg = kind === "primary" ? C.accent : kind === "danger" ? C.danger : "transparent";
  const fg = kind === "ghost" ? C.text : "#06110c";
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        s.btn,
        { backgroundColor: bg, borderColor: kind === "ghost" ? C.line : bg, opacity: disabled ? 0.5 : pressed ? 0.8 : 1 },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={fg} /> : <Text style={[s.btnText, { color: fg }]}>{title}</Text>}
    </Pressable>
  );
}

export function Input(props: TextInputProps) {
  return <TextInput placeholderTextColor={C.dim} {...props} style={[s.input, props.style]} />;
}

export function Banner({ text, color = C.warn }: { text: string; color?: string }) {
  return (
    <View style={[s.banner, { borderColor: color }]}>
      <Text style={[s.bannerText, { color }]}>{text}</Text>
    </View>
  );
}

export function Bar({ value, color = C.accent }: { value: number; color?: string }) {
  return (
    <View style={s.barBg}>
      <View style={[s.barFill, { width: `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`, backgroundColor: color }]} />
    </View>
  );
}

export function Spinner() {
  return (
    <View style={{ padding: 24, alignItems: "center" }}>
      <ActivityIndicator color={C.accent} />
    </View>
  );
}

export function fmtCountdown(iso: string, now: number) {
  const ms = new Date(iso).getTime() - now;
  if (ms <= 0) return "expired";
  const sec = Math.floor(ms / 1000);
  if (sec < 90) return `${sec}s`;
  const m = Math.floor(sec / 60);
  return `${m}m ${sec % 60}s`;
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  content: { padding: 16, paddingBottom: 40, maxWidth: 520, width: "100%", alignSelf: "center" },
  h1: { color: C.text, fontSize: 26, fontWeight: "700", marginBottom: 8, ...mono },
  h2: { color: C.text, fontSize: 17, fontWeight: "700", marginTop: 16, marginBottom: 8, ...mono },
  p: { color: C.text, fontSize: 15, lineHeight: 21, marginBottom: 8 },
  label: { color: C.dim, fontSize: 12, letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 4, ...mono },
  card: { backgroundColor: C.panel, borderColor: C.line, borderWidth: 1, borderRadius: 10, padding: 14, marginBottom: 12 },
  btn: { paddingVertical: 12, paddingHorizontal: 16, borderRadius: 8, borderWidth: 1, alignItems: "center", marginTop: 8 },
  btnText: { fontWeight: "700", fontSize: 15, ...mono },
  input: {
    backgroundColor: C.panel2,
    color: C.text,
    borderColor: C.line,
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    fontSize: 15,
    marginBottom: 8,
  },
  banner: { borderWidth: 1, borderRadius: 8, padding: 10, marginBottom: 12, backgroundColor: C.panel },
  bannerText: { fontWeight: "700", ...mono },
  barBg: { height: 8, backgroundColor: C.panel2, borderRadius: 4, overflow: "hidden", marginBottom: 10 },
  barFill: { height: 8, borderRadius: 4 },
});
