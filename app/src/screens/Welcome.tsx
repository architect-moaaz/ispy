import React, { useEffect, useRef, useState } from "react";
import { Animated, Dimensions, Easing, ScrollView, StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { api, setToken } from "../api";
import { C, F } from "../theme";
import { Button, Input, Typed } from "../ui";
import { FactionEmblem } from "../graphics";
import { ART } from "../art";
import type { Player } from "@ispy/shared";

/**
 * Clearance, step one. The story's last frame (the three on the rooftop) keeps drifting behind
 * a live identity card: the codename you type appears on the card as you type it, the three
 * agencies' marks line up beneath as the readers of your file, and the request goes out with a
 * transmission bar rather than a spinner. Onboarding looks like the film it follows.
 */
const AGENCIES = [["raven", "RAVEN", "Patience. Pattern. Proof."], ["phantom", "PHANTOM", "If they saw you, you were never there."], ["cipher", "CIPHER", "Everything is a system. Systems break."]] as const;

export function Welcome({ onRegistered }: { onRegistered: (p: Player) => void }) {
  const [codename, setCodename] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const { width, height } = Dimensions.get("window");
  const drift = useRef(new Animated.Value(0)).current;
  const rise = useRef(new Animated.Value(0)).current;
  const blink = useRef(new Animated.Value(1)).current;
  const bar = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(Animated.sequence([
      Animated.timing(drift, { toValue: 1, duration: 16000, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(drift, { toValue: 0, duration: 16000, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ])).start();
    Animated.timing(rise, { toValue: 1, duration: 900, delay: 200, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    Animated.loop(Animated.sequence([Animated.timing(blink, { toValue: 0, duration: 500, useNativeDriver: true }), Animated.timing(blink, { toValue: 1, duration: 500, useNativeDriver: true })])).start();
  }, []);

  const go = async () => {
    const c = codename.trim();
    if (c.length < 3) return setErr("A codename needs at least 3 characters.");
    setBusy(true); setErr(null); setSending(true);
    bar.setValue(0);
    Animated.timing(bar, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.quad), useNativeDriver: false }).start();
    try {
      const [r] = await Promise.all([api.register(c), new Promise((res) => setTimeout(res, 1400))]);
      await setToken(r.token); onRegistered(r.player);
    } catch (e: any) { setErr(e.message ?? "Could not register. Try another codename."); setSending(false); }
    finally { setBusy(false); }
  };
  const name = codename.trim().toUpperCase();
  return (
    <View style={{ flex: 1, backgroundColor: C.ink }}>
      <Animated.Image source={ART.story.heroes} resizeMode="cover" style={[StyleSheet.absoluteFill, { width, height, transform: [{ scale: 1.15 }, { translateX: drift.interpolate({ inputRange: [0, 1], outputRange: [-12, 12] }) }] }]} />
      <LinearGradient colors={["rgba(7,11,16,0.35)", "rgba(7,11,16,0.75)", C.ink]} locations={[0, 0.5, 0.82]} style={StyleSheet.absoluteFill} />
      <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
        <Animated.View style={{ paddingHorizontal: 18, paddingTop: height * 0.3, paddingBottom: 40, maxWidth: 560, width: "100%", alignSelf: "center", opacity: rise, transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }] }}>
          <Text style={s.eyebrow}>CLEARANCE · STEP 1 OF 2</Text>
          <Text style={s.head}>They are recruiting.{"\n"}Quietly.</Text>
          <Typed style={{ marginTop: 6 }}>Three chiefs will read your file. None of them will meet you. Choose the name they will know you by.</Typed>

          {/* the identity card, live */}
          <View style={s.card}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={s.cardEyebrow}>INTELLIGENCE ID · CANDIDATE</Text>
              <Text style={[s.cardEyebrow, { color: C.red }]}>● UNCLEARED</Text>
            </View>
            <View style={{ flexDirection: "row", alignItems: "flex-end", marginTop: 10 }}>
              <Text style={s.cardName}>{name || "CODENAME"}</Text>
              {!name && <Animated.View style={{ width: 12, height: 30, backgroundColor: C.cyan, marginLeft: 4, marginBottom: 6, opacity: blink }} />}
            </View>
            <Text style={s.cardSub}>EARTH 686 · SECTOR UNASSIGNED · RANK NONE</Text>
            <Input value={codename} onChangeText={(t) => { setCodename(t); setErr(null); }} placeholder="Type your codename" autoCapitalize="characters" autoCorrect={false} onSubmitEditing={go} editable={!sending} style={{ fontSize: 18, marginTop: 12, marginBottom: 0 }} />
            {err && <Typed style={{ color: C.red, marginTop: 6, marginBottom: 0 }}>{err}</Typed>}
          </View>

          <Text style={[s.eyebrow, { marginTop: 18 }]}>WHO WILL READ IT</Text>
          <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
            {AGENCIES.map(([id, nm, tag]) => (
              <View key={id} style={s.agency}>
                <FactionEmblem id={id} size={40} />
                <Text style={s.agencyName}>{nm}</Text>
                <Text style={s.agencyTag} numberOfLines={2}>{tag}</Text>
              </View>
            ))}
          </View>

          {sending ? (
            <View style={{ marginTop: 18 }}>
              <View style={s.track}><Animated.View style={[s.fill, { width: bar.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] }) }]} /></View>
              <Text style={[s.eyebrow, { color: C.cyan, textAlign: "center", marginTop: 6 }]}>TRANSMITTING FILE TO THREE DESKS…</Text>
            </View>
          ) : (
            <Button title="Request clearance" onPress={go} loading={busy} disabled={name.length < 3} style={{ paddingVertical: 16, marginTop: 18 }} />
          )}
          <Text style={s.fine}>Adults only. No real name needed. Your location is read only while you are deployed, and never shared. Everything here is fiction; nothing asks you to watch, follow or photograph anyone.</Text>
        </Animated.View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  eyebrow: { color: C.dim, fontFamily: F.displayMed, fontSize: 11, letterSpacing: 2 },
  head: { color: C.text, fontFamily: F.display, fontSize: 40, lineHeight: 42, marginTop: 6 },
  card: { marginTop: 16, borderWidth: 1, borderColor: "rgba(0,229,242,0.45)", borderRadius: 12, padding: 14, backgroundColor: "rgba(7,11,16,0.78)" },
  cardEyebrow: { color: C.dim, fontFamily: F.displayMed, fontSize: 10, letterSpacing: 1.8 },
  cardName: { color: C.cyan, fontFamily: F.display, fontSize: 34, lineHeight: 38, letterSpacing: 1.5 },
  cardSub: { color: C.dim, fontFamily: F.typed, fontSize: 11, marginTop: 2, letterSpacing: 0.5 },
  agency: { flex: 1, alignItems: "center", borderWidth: 1, borderColor: C.hair, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 6, backgroundColor: "rgba(7,11,16,0.6)" },
  agencyName: { color: C.text, fontFamily: F.displayMed, fontSize: 12, letterSpacing: 1.6, marginTop: 6 },
  agencyTag: { color: C.dim, fontFamily: F.typed, fontSize: 10, textAlign: "center", marginTop: 2 },
  track: { height: 6, borderWidth: 1, borderColor: C.cyan, backgroundColor: "#000", borderRadius: 3, overflow: "hidden" },
  fill: { height: "100%", backgroundColor: C.cyan },
  fine: { color: C.dim, fontFamily: F.typed, fontSize: 11.5, textAlign: "center", marginTop: 16, lineHeight: 16 },
});
