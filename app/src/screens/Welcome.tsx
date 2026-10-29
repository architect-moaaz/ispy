import React, { useState } from "react";
import { Dimensions, Image, StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { api, setToken } from "../api";
import { C, F } from "../theme";
import { Body, Button, Dossier, Input, Kicker, Screen, Typed } from "../ui";
import { FactionRow } from "../graphics";
import { ART } from "../art";
import type { Player } from "@ispy/shared";

export function Welcome({ onRegistered }: { onRegistered: (p: Player) => void }) {
  const [codename, setCodename] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const w = Math.min(Dimensions.get("window").width, 560);
  const heroH = Math.round(w * 1.15);

  const go = async () => {
    const c = codename.trim();
    if (c.length < 3) return setErr("A codename needs at least 3 characters.");
    setBusy(true); setErr(null);
    try { const r = await api.register(c); await setToken(r.token); onRegistered(r.player); }
    catch (e: any) { setErr(e.message ?? "Could not register. Try another codename."); }
    finally { setBusy(false); }
  };

  return (
    <Screen pad={false}>
      {/* Key art hero, fading into the app background with the title set into the dark lower third. */}
      <View style={{ width: w, height: heroH, alignSelf: "center" }}>
        <Image source={ART.splash} style={{ width: w, height: heroH }} resizeMode="cover" />
        <LinearGradient colors={["rgba(7,17,26,0)", "rgba(7,17,26,0.15)", C.ink]} locations={[0, 0.55, 1]} style={StyleSheet.absoluteFill} />
        <View style={{ position: "absolute", left: 0, right: 0, bottom: 18, alignItems: "center" }}>
          <Text style={s.title}>iSpy a Spy</Text>
          <Text style={s.tag}>Real-world satellite intelligence game</Text>
        </View>
      </View>

      <View style={{ paddingHorizontal: 16, paddingBottom: 40, maxWidth: 560, width: "100%", alignSelf: "center" }}>
        <Text style={s.lead}>Five intelligence agencies. Five AI chiefs commanding the shadow war. You work for one of them.</Text>
        <View style={{ alignItems: "center", marginVertical: 14 }}><FactionRow size={52} /></View>
        <Body dim style={{ textAlign: "center" }}>
          Pass the aptitude test, take an offer, and your chief sends you walking to real places on the satellite map. It is all fiction. Nothing here asks you to watch, follow or photograph anyone.
        </Body>
        <Dossier>
          <Kicker>Choose a codename</Kicker>
          <Input value={codename} onChangeText={setCodename} placeholder="KESTREL" autoCapitalize="characters" autoCorrect={false} onSubmitEditing={go} style={{ fontSize: 20 }} />
          {err && <Typed style={{ color: C.red }}>{err}</Typed>}
          <Button title="Begin clearance" onPress={go} loading={busy} style={{ paddingVertical: 16 }} />
        </Dossier>
        <Body dim style={{ fontSize: 12.5, textAlign: "center" }}>Adults only. No real name needed. Your location is read only while you are deployed, and never shared.</Body>
      </View>
    </Screen>
  );
}

const s = StyleSheet.create({
  title: { color: C.cyan, fontFamily: F.display, fontSize: 64, lineHeight: 64, letterSpacing: 2, textTransform: "uppercase", textShadowColor: C.cyan, textShadowRadius: 24, textShadowOffset: { width: 0, height: 0 } },
  tag: { color: C.text, fontFamily: F.displayMed, fontSize: 13, letterSpacing: 2.4, textTransform: "uppercase", marginTop: 2 },
  lead: { color: C.text, fontFamily: F.displayMed, fontSize: 21, lineHeight: 26, textAlign: "center", marginTop: 8, letterSpacing: 0.5 },
});
