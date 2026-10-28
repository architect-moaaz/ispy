import React, { useState } from "react";
import { Text, View } from "react-native";
import { api, setToken } from "../api";
import { C, F } from "../theme";
import { Body, Button, Display, Dossier, Input, Kicker, Screen, Typed } from "../ui";
import { AppMark, FactionRow } from "../graphics";
import type { Player } from "@ispy/shared";

export function Welcome({ onRegistered }: { onRegistered: (p: Player) => void }) {
  const [codename, setCodename] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const go = async () => {
    const c = codename.trim();
    if (c.length < 3) return setErr("A codename needs at least 3 characters.");
    setBusy(true); setErr(null);
    try { const r = await api.register(c); await setToken(r.token); onRegistered(r.player); }
    catch (e: any) { setErr(e.message ?? "Could not register. Try another codename."); }
    finally { setBusy(false); }
  };

  return (
    <Screen>
      <View style={{ alignItems: "center", marginTop: 28, marginBottom: 10 }}>
        <AppMark size={92} />
        <Display size={40} style={{ marginTop: 14 }}>iSpy a Spy</Display>
        <Kicker>Real-world satellite intelligence game</Kicker>
      </View>
      <Text style={{ color: C.text, fontFamily: F.displayMed, fontSize: 20, lineHeight: 25, textAlign: "center", marginBottom: 12, letterSpacing: 0.5 }}>
        Three agencies. Three chiefs who are not human. The operatives are.
      </Text>
      <View style={{ alignItems: "center", marginBottom: 14 }}><FactionRow size={52} /></View>
      <Body dim style={{ textAlign: "center" }}>
        Pass the aptitude test, take an offer, and your chief sends you walking to real places on the satellite map. It is all fiction. Nothing here asks you to watch, follow or photograph anyone.
      </Body>
      <Dossier>
        <Kicker>Choose a codename</Kicker>
        <Input value={codename} onChangeText={setCodename} placeholder="KESTREL" autoCapitalize="characters" autoCorrect={false} onSubmitEditing={go} style={{ fontSize: 20 }} />
        {err && <Typed style={{ color: C.red }}>{err}</Typed>}
        <Button title="Begin clearance" onPress={go} loading={busy} style={{ paddingVertical: 16 }} />
      </Dossier>
      <Body dim style={{ fontSize: 12.5, textAlign: "center" }}>Adults only. No real name needed. Your location is read only while you are on duty, and never shared.</Body>
    </Screen>
  );
}
