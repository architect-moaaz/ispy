import React, { useState } from "react";
import { View } from "react-native";
import { api, setToken } from "../api";
import { C } from "../theme";
import { Button, Card, H1, Input, Label, P, Screen } from "../ui";
import type { Player } from "@ispy/shared";

export function Welcome({ onRegistered }: { onRegistered: (p: Player) => void }) {
  const [codename, setCodename] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const go = async () => {
    const c = codename.trim();
    if (c.length < 3) return setErr("Codename needs at least 3 characters.");
    setBusy(true);
    setErr(null);
    try {
      const r = await api.register(c);
      await setToken(r.token);
      onRegistered(r.player);
    } catch (e: any) {
      setErr(e.message ?? "Registration failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <View style={{ height: 32 }} />
      <Label>Civilian clearance</Label>
      <H1>iSpy a Spy</H1>
      <P dim>
        Three intelligence agencies are fighting a quiet war in this city. Their chiefs are not human. Their
        operatives are.
      </P>
      <P dim>
        Pass the aptitude test, take an offer, and your chief will send you to real places to pick up what was
        left behind. Everything here is fiction. Nothing asks you to watch, follow or photograph anyone.
      </P>
      <Card>
        <Label>Choose a codename</Label>
        <Input
          value={codename}
          onChangeText={setCodename}
          placeholder="e.g. KESTREL"
          autoCapitalize="characters"
          autoCorrect={false}
          onSubmitEditing={go}
        />
        {err && <P style={{ color: C.danger }}>{err}</P>}
        <Button title="Begin assessment" onPress={go} loading={busy} />
      </Card>
      <P dim style={{ fontSize: 12 }}>
        Adults only. Pseudonymous. Foreground location is used only while you are on duty.
      </P>
    </Screen>
  );
}
