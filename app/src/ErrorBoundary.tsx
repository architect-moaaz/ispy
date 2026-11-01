import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { C, F } from "./theme";
import { Button } from "./ui";
import { report } from "./diag";

/**
 * A fence round the views that use native graphics. If one of them throws while rendering, the
 * rest of the app stays up: the error is shown, reported to the bureau, and a button leads back.
 */
export class ErrorBoundary extends React.Component<{ where: string; onBack: () => void; children: React.ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(e: unknown) { return { error: String((e as any)?.message ?? e) }; }
  componentDidCatch(e: unknown) { report(this.props.where, e); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <View style={s.wrap}>
        <Text style={s.eyebrow}>{this.props.where.toUpperCase()} FAILED ON THIS DEVICE</Text>
        <Text style={s.msg}>{this.state.error}</Text>
        <Text style={[s.eyebrow, { marginTop: 8 }]}>Reported to the bureau.</Text>
        <Button title="Back to the map" onPress={() => { this.setState({ error: null }); this.props.onBack(); }} style={{ marginTop: 16 }} />
      </View>
    );
  }
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.ink, padding: 24, justifyContent: "center" },
  eyebrow: { color: C.red, fontFamily: F.displayMed, fontSize: 11, letterSpacing: 1.8 },
  msg: { color: C.text, fontFamily: F.typed, fontSize: 14, marginTop: 8 },
});
