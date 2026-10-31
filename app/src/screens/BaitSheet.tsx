import React, { useEffect, useRef, useState } from "react";
import { Animated, Easing, Modal, ScrollView, StyleSheet, Text, View } from "react-native";
import { C, F } from "../theme";
import { Body, Button, Typed } from "../ui";

/**
 * Tradecraft at a site: a sealed order that has to be read, chosen and armed before it goes out.
 * Two moves. A distraction: every rival agency sees a real order here and pays for the walk. A false
 * lead: one chief you pick gets an unsigned tip pointing here. Both cost credits, both are capped, and
 * the order arms over three seconds before it can be sent, so nobody plants bait by accident.
 */
export type BaitMove = { kind: "distraction" } | { kind: "lead"; toFaction: string };

export function BaitSheet({ site, credits, costs, distractionsLeft, tipsLeft, rivals, busy, onSend, onClose }: {
  site: string; credits: number; costs: { distraction: number; lead: number }; distractionsLeft: number; tipsLeft: number;
  rivals: { id: string; chief: string; burned: boolean }[]; busy: boolean; onSend: (move: BaitMove) => Promise<string | null>; onClose: () => void;
}) {
  const [move, setMove] = useState<BaitMove | null>(null);
  const [armed, setArmed] = useState(0); // 0..1 while arming, 1 = armed
  const [result, setResult] = useState<string | null>(null);
  const arm = useRef(new Animated.Value(0)).current;
  const rise = useRef(new Animated.Value(0)).current;
  useEffect(() => { Animated.timing(rise, { toValue: 1, duration: 280, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(); }, []);
  useEffect(() => { setArmed(0); arm.setValue(0); }, [move?.kind, move?.kind === "lead" ? move.toFaction : ""]);
  const cost = move?.kind === "distraction" ? costs.distraction : costs.lead;
  const canAfford = credits >= cost;
  const startArming = () => {
    arm.setValue(0); setArmed(0.01);
    Animated.timing(arm, { toValue: 1, duration: 3000, easing: Easing.linear, useNativeDriver: false }).start(({ finished }) => { if (finished) setArmed(1); });
  };
  const abortArming = () => { arm.stopAnimation(); arm.setValue(0); setArmed(0); };
  const send = async () => { if (!move) return; const r = await onSend(move); setResult(r); if (r && !r.startsWith("!")) setTimeout(onClose, 1400); };
  const rivalName = move?.kind === "lead" ? rivals.find((r) => r.id === move.toFaction)?.chief ?? "" : "";
  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
      <View style={s.backdrop}>
        <Animated.View style={[s.sheet, { opacity: rise, transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [40, 0] }) }] }]}>
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 28 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Text style={s.eyebrow}>TRADECRAFT · SEALED ORDER</Text>
              <Text style={[s.eyebrow, { color: C.amber }]}>{credits} CR</Text>
            </View>
            <Text style={s.title}>{site.toUpperCase()}</Text>
            <Typed>Bait is a move against the other agencies. It costs credits, it is counted, and it cannot be taken back once it is on the wire.</Typed>

            <Text style={s.label}>THE MOVE</Text>
            <Button title={`Distraction · all rivals see a real order here · ${costs.distraction} cr · ${distractionsLeft} left today`} kind={move?.kind === "distraction" ? "primary" : "ghost"} disabled={distractionsLeft <= 0 || busy} onPress={() => setMove({ kind: "distraction" })} style={{ paddingVertical: 10, marginTop: 4 }} />
            <Text style={[s.mono, { marginTop: 4 }]}>Every rival chief puts an order on their board for this site. Whoever walks it finds nothing, loses XP, and you are paid per bite. Your agency knows it is bait.</Text>
            <Text style={[s.label, { marginTop: 10 }]}>OR A FALSE LEAD · ONE CHIEF · {costs.lead} CR · {tipsLeft} TIP{tipsLeft === 1 ? "" : "S"} LEFT</Text>
            <View style={{ flexDirection: "row", gap: 6 }}>
              {rivals.map((r) => <Button key={r.id} title={`${r.chief}${r.burned ? " · burned" : ""}`} kind={move?.kind === "lead" && move.toFaction === r.id ? "primary" : "ghost"} disabled={r.burned || tipsLeft <= 0 || busy} onPress={() => setMove({ kind: "lead", toFaction: r.id })} style={{ flex: 1, paddingVertical: 10, marginTop: 4 }} />)}
            </View>
            <Text style={[s.mono, { marginTop: 4 }]}>An unsigned tip to that chief alone. Their operative walks here for nothing and pays XP. Two burns in a day and that chief drops your source.</Text>

            {move && (
              <View style={s.confirm}>
                <Text style={[s.eyebrow, { color: C.amber }]}>CONFIRM</Text>
                <Typed style={{ marginBottom: 6 }}>
                  {move.kind === "distraction" ? `Plant a distraction at ${site}. Every rival agency gets a real order here for two hours.` : `Send ${rivalName} an unsigned tip pointing at ${site}.`} Cost {cost} credits, leaving {Math.max(0, credits - cost)}.
                </Typed>
                {!canAfford ? <Text style={[s.mono, { color: C.red }]}>Not enough credits. Spin caches and finish orders.</Text> : armed >= 1 ? (
                  <Button title={move.kind === "distraction" ? "Plant it. No way back." : `Send it to ${rivalName}. No way back.`} kind="danger" onPress={send} loading={busy} style={{ marginTop: 4 }} />
                ) : armed > 0 ? (
                  <View>
                    <View style={s.armTrack}><Animated.View style={[s.armFill, { width: arm.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] }) }]} /></View>
                    <Text style={[s.mono, { color: C.amber, textAlign: "center", marginTop: 4 }]}>ARMING · hold your nerve</Text>
                    <Button title="Abort" kind="ghost" onPress={abortArming} style={{ marginTop: 6, paddingVertical: 8 }} />
                  </View>
                ) : (
                  <Button title="Arm the order" kind="ghost" onPress={startArming} style={{ marginTop: 4, borderColor: C.amber }} />
                )}
              </View>
            )}
            {result && <Body style={{ color: result.startsWith("!") ? C.red : C.ok, marginTop: 8 }}>{result.replace(/^!/, "")}</Body>}
            <Button title="Close without planting" kind="ghost" onPress={onClose} style={{ marginTop: 8 }} />
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(4,10,14,0.94)", justifyContent: "flex-end" },
  sheet: { maxHeight: "92%", borderTopWidth: 1, borderColor: C.amber, backgroundColor: C.ink2 },
  eyebrow: { color: C.dim, fontFamily: F.displayMed, fontSize: 10.5, letterSpacing: 1.6 },
  title: { color: C.text, fontFamily: F.displayMed, fontSize: 22, letterSpacing: 1.4, marginBottom: 6 },
  mono: { color: C.dim, fontFamily: F.typed, fontSize: 11.5 },
  label: { color: C.amber, fontFamily: F.displayMed, fontSize: 11, letterSpacing: 1.6, marginTop: 12, marginBottom: 2 },
  confirm: { marginTop: 14, borderWidth: 1, borderStyle: "dashed", borderColor: C.amber, padding: 10, backgroundColor: "rgba(255,170,0,0.06)" },
  armTrack: { height: 8, borderWidth: 1, borderColor: C.amber, backgroundColor: "#000" },
  armFill: { height: "100%", backgroundColor: C.amber },
});
