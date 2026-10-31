import React, { useEffect, useRef } from "react";
import { Animated, Easing, Modal, ScrollView, StyleSheet, Text, View } from "react-native";
import type { MissionSummary, ScanResponse } from "@ispy/shared";
import { C, F } from "../theme";
import { Button, Stamp, Typed } from "../ui";

/**
 * The outcome of a scan, on top of everything: the stamp, the chief's debrief, what it paid and
 * what opens next. It sits over the map until the operative dismisses it, so a result is never a
 * card lost somewhere down the page.
 */
export function Debrief({ scan, mission, targetName, onDone }: { scan: ScanResponse; mission: MissionSummary; targetName: string; onDone: () => void }) {
  const rise = useRef(new Animated.Value(0)).current;
  useEffect(() => { Animated.timing(rise, { toValue: 1, duration: 320, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(); }, []);
  const r = scan.reward!;
  const lost = r.contestOutcome === "lost";
  const bait = !!scan.decoyed;
  const stamp = bait ? "Decoy" : lost ? "Outrun" : r.contestOutcome === "won" ? "First in" : "Verified";
  const tone = bait ? C.amber : lost ? C.dim : C.ok;
  const chain = mission.chain;
  const chainLine = chain ? (chain.step >= chain.of ? `${chain.name} · complete` : `${chain.name} · link ${chain.step} of ${chain.of} done · link ${chain.step + 1} is on your board`) : null;
  return (
    <Modal visible transparent animationType="none" onRequestClose={onDone}>
      <View style={s.backdrop}>
        <Animated.View style={[s.sheet, { borderColor: tone, opacity: rise, transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [40, 0] }) }] }]}>
          <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 24 }}>
            <Text style={s.eyebrow}>{bait ? "BAIT · NOTHING HERE" : "SITE VERIFIED"}</Text>
            <Text style={s.title}>{targetName}</Text>
            <View style={{ alignItems: "center", marginVertical: 10 }}>
              <Stamp text={stamp} size={44} color={bait ? C.amber : lost ? C.dim : C.red} />
            </View>
            <Typed>{scan.debrief}</Typed>
            {scan.artifact && <Text style={[s.mono, { color: C.amber, marginTop: 6 }]}>Recovered · {scan.artifact.name}{scan.artifact.dossier ? ` · dossier ${scan.artifact.dossier}` : ""} · in the archive</Text>}
            {chainLine && <Text style={[s.mono, { color: C.amber, marginTop: 6 }]}>{chainLine}</Text>}
            {mission.crisis && !bait && <Text style={[s.mono, { color: C.cyan, marginTop: 6 }]}>Crisis · {mission.crisis.name} · {mission.crisis.stance}</Text>}
            <View style={s.payRow}>
              <View>
                <Text style={s.payLabel}>XP</Text>
                <Text style={[s.pay, { color: r.xp < 0 ? C.red : C.cyan }]}>{r.xp > 0 ? "+" : ""}{r.xp}</Text>
              </View>
              <View>
                <Text style={s.payLabel}>Trust</Text>
                <Text style={[s.pay, { color: r.trust < 0 ? C.red : C.text }]}>{r.trust >= 0 ? "+" : ""}{r.trust}</Text>
              </View>
            </View>
            <Button title={chain && chain.step < chain.of ? "Next link" : "Back to the board"} onPress={onDone} />
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(4,10,14,0.9)", justifyContent: "center", padding: 16 },
  sheet: { maxHeight: "88%", borderWidth: 1, borderRadius: 12, backgroundColor: C.ink2 },
  eyebrow: { color: C.dim, fontFamily: F.displayMed, fontSize: 10.5, letterSpacing: 1.6 },
  title: { color: C.text, fontFamily: F.displayMed, fontSize: 24, letterSpacing: 0.6, marginTop: 2 },
  mono: { color: C.dim, fontFamily: F.typed, fontSize: 12 },
  payRow: { flexDirection: "row", gap: 28, marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: C.hair },
  payLabel: { color: C.dim, fontFamily: F.displayMed, fontSize: 10.5, letterSpacing: 1.6 },
  pay: { fontFamily: F.displayMed, fontSize: 30, letterSpacing: 0.5 },
});
