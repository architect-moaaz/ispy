import React, { useEffect, useRef, useState } from "react";
import { Animated, Easing, Image, Modal, ScrollView, StyleSheet, Text, View } from "react-native";
import type { ArchiveView } from "@ispy/shared";
import { ART } from "../art";
import { C, F } from "../theme";
import { Body, Button, Input, Stamp, Typed } from "../ui";

type Artifact = ArchiveView["artifacts"][number];

/**
 * An artifact's file: the painted object, its classification stamp, provenance, what it contains,
 * the examiner's finding, the cipher (if you are cleared to read it) with a place to decipher, and
 * the chief's note. Opens over the archive when an artifact is tapped.
 */
export function ArtifactSheet({ a, clearance, busy, onExamine, onDecipher, onClose, msg }: {
  a: Artifact; clearance: number; busy: boolean; onExamine: () => void; onDecipher: (answer: string) => void; onClose: () => void; msg: string | null;
}) {
  const [answer, setAnswer] = useState("");
  const rise = useRef(new Animated.Value(0)).current;
  const bob = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(rise, { toValue: 1, duration: 320, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    const b = Animated.loop(Animated.sequence([Animated.timing(bob, { toValue: 1, duration: 1600, easing: Easing.inOut(Easing.quad), useNativeDriver: true }), Animated.timing(bob, { toValue: 0, duration: 1600, easing: Easing.inOut(Easing.quad), useNativeDriver: true })]));
    b.start(); return () => b.stop();
  }, []);
  const color = a.genuine === false ? C.red : a.deciphered ? C.ok : a.examined ? C.cyan : C.amber;
  const corrupted = !!a.corruptedUntil && Date.parse(a.corruptedUntil) > Date.now();
  const when = a.recoveredAt ? new Date(a.recoveredAt).toLocaleString([], { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";
  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
    <View style={s.backdrop}>
      <Animated.View style={[s.sheet, { opacity: rise, transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [40, 0] }) }] }]}>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 28 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
            <Text style={s.eyebrow}>CLASSIFIED ARCHIVE · FILE</Text>
            <Text style={[s.eyebrow, { color }]}>{a.classification}</Text>
          </View>
          <View style={{ alignItems: "center", marginVertical: 10 }}>
            <Animated.View style={{ transform: [{ translateY: bob.interpolate({ inputRange: [0, 1], outputRange: [0, -6] }) }] }}>
              <View style={[s.ring, { borderColor: color, shadowColor: color }]}>
                <Image source={ART.artifact[a.art] ?? ART.artifact.page} style={s.img} />
                {a.genuine === false && <View style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(255,93,108,0.16)", borderRadius: 110 }]} />}
              </View>
            </Animated.View>
            {a.genuine === false && <View style={{ position: "absolute", top: 70 }}><Stamp text="Forgery" size={34} color={C.red} /></View>}
            {a.deciphered && <View style={{ position: "absolute", top: 70 }}><Stamp text="Deciphered" size={30} color={C.red} angle={8} /></View>}
          </View>
          <Text style={s.title}>{a.name.toUpperCase()}</Text>
          <Text style={s.mono}>{a.kind.toUpperCase()}{a.dossier ? ` · DOSSIER ${a.dossier.toUpperCase()}` : ""}</Text>

          <Text style={s.label}>PROVENANCE</Text>
          <Typed>Recovered by {a.recoveredBy ?? "—"} at {a.site ?? "—"}, {when}. Unique: no other agency will ever hold it.</Typed>

          <Text style={s.label}>CONTENTS</Text>
          <Typed>{a.contents}</Typed>

          <Text style={s.label}>EXAMINATION</Text>
          {a.examined ? (
            <Typed style={{ color: a.genuine ? C.ok : C.red }}>{a.genuine ? "Genuine. Logged." : `Forgery, planted by ${a.plantedBy ?? "unknown"}. That is evidence of its own.`}</Typed>
          ) : clearance >= 2 ? (
            <Button title="Examine" onPress={onExamine} loading={busy} style={{ marginTop: 4 }} />
          ) : (
            <Typed style={{ color: C.dim }}>Unexamined. Examining needs field-agent clearance (400 XP).</Typed>
          )}

          {a.kind === "fragment" && a.examined && a.genuine && (
            <>
              <Text style={s.label}>CIPHER</Text>
              {a.deciphered ? <Typed style={{ color: C.ok }}>Deciphered. One line of the secret is ours.</Typed>
                : a.prompt ? (
                  <>
                    <Text style={[s.mono, { color: C.text, marginTop: 4 }]}>{a.prompt}</Text>
                    {a.system && <Typed style={{ color: C.dim, marginTop: 4 }}>System: {a.system}. The cipher kit on the desk has the tables.</Typed>}
                    {corrupted ? <Typed style={{ color: C.red }}>Corrupted by a wrong reading. Settles at {new Date(a.corruptedUntil!).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.</Typed> : (
                      <>
                        <Input value={answer} onChangeText={setAnswer} placeholder="PLAINTEXT" autoCapitalize="characters" autoCorrect={false} style={{ marginTop: 6 }} />
                        <Button title="Decipher" onPress={() => onDecipher(answer)} loading={busy} style={{ marginTop: 6 }} />
                      </>
                    )}
                  </>
                ) : <Typed style={{ color: C.dim }}>Reading the cipher needs field-agent clearance.</Typed>}
            </>
          )}

          {a.note && (
            <>
              <Text style={s.label}>FROM YOUR CHIEF</Text>
              <View style={s.note}><Typed style={{ marginBottom: 0 }}>{a.note}</Typed></View>
            </>
          )}
          {msg && <Body style={{ color: C.cyan, marginTop: 8 }}>{msg}</Body>}
          <Button title="Close the file" kind="ghost" onPress={onClose} />
        </ScrollView>
      </Animated.View>
    </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(4,10,14,0.94)", justifyContent: "flex-end" },
  sheet: { maxHeight: "92%", borderTopWidth: 1, borderColor: C.line, backgroundColor: C.ink2 },
  eyebrow: { color: C.dim, fontFamily: F.displayMed, fontSize: 10.5, letterSpacing: 1.6 },
  ring: { width: 220, height: 220, borderRadius: 110, borderWidth: 2, overflow: "hidden", backgroundColor: "#000", shadowOpacity: 0.9, shadowRadius: 24 },
  img: { width: 220, height: 220, borderRadius: 110 },
  title: { color: C.text, fontFamily: F.displayMed, fontSize: 22, letterSpacing: 1.4 },
  mono: { color: C.dim, fontFamily: F.typed, fontSize: 11.5 },
  label: { color: C.cyanDim, fontFamily: F.displayMed, fontSize: 11, letterSpacing: 1.6, marginTop: 12, marginBottom: 2 },
  note: { borderLeftWidth: 2, borderLeftColor: C.cyan, paddingLeft: 10, paddingVertical: 4 },
});
