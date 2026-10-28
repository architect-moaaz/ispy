import React, { useState } from "react";
import { Text, View } from "react-native";
import { api, setToken } from "../api";
import { C, F } from "../theme";
import { Body, Button, Display, Input, Kicker, Panel, Screen, Typed } from "../ui";
import type { Player } from "@ispy/shared";

export function Welcome({ onRegistered }: { onRegistered: (p: Player) => void }) {
  const [codename, setCodename] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const go = async () => {
    const c = codename.trim();
    if (c.length < 3) return setErr("A codename needs at least 3 characters.");
    setBusy(true);
    setErr(null);
    try {
      const r = await api.register(c);
      await setToken(r.token);
      onRegistered(r.player);
    } catch (e: any) {
      setErr(e.message ?? "Could not register. Try another codename.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <View style={{ height: 36 }} />
      <Kicker color={C.amber}>Bengaluru, after dark</Kicker>
      <Display size={76}>iSpy{"\n"}a Spy</Display>
      <Text style={{ color: C.text, fontFamily: F.displayMed, fontSize: 22, lineHeight: 26, marginBottom: 18 }}>
        Three agencies. Three chiefs who are not human. The operatives are.
      </Text>
      <Body dim>
        Pass the aptitude test, take an offer, and your chief sends you walking to real places to collect what was
        left behind. It is all fiction. Nothing here asks you to watch, follow or photograph anyone.
      </Body>
      <Panel style={{ marginTop: 10 }}>
        <Kicker>Pick a codename</Kicker>
        <Input
          value={codename}
          onChangeText={setCodename}
          placeholder="KESTREL"
          autoCapitalize="characters"
          autoCorrect={false}
          onSubmitEditing={go}
          style={{ fontFamily: F.typed, fontSize: 20 }}
        />
        {err && <Typed onPaper={false} style={{ color: C.stamp }}>{err}</Typed>}
        <Button title="Take the test" onPress={go} loading={busy} />
      </Panel>
      <Body dim style={{ fontSize: 12.5 }}>
        Adults only. No real name needed. Your location is read only while you are on duty, and never shared.
      </Body>
    </Screen>
  );
}
