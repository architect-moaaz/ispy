import React, { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { api, DevTarget } from "../api";
import { getSimFix, offsetM, onSimChange, setSimFix } from "../location";
import { C, mono } from "../theme";
import { Button, Label } from "../ui";

// Shown only when the server reports devSim. Lets you fake the device position.
export function DevPanel() {
  const [open, setOpen] = useState(false);
  const [targets, setTargets] = useState<DevTarget[]>([]);
  const [sim, setSim] = useState(getSimFix());

  useEffect(() => onSimChange(() => setSim(getSimFix())), []);
  useEffect(() => {
    if (open && targets.length === 0) api.devTargets().then((r) => setTargets(r.targets)).catch(() => {});
  }, [open]);

  return (
    <View style={{ borderWidth: 1, borderColor: C.warn, borderRadius: 8, padding: 10, marginBottom: 12, borderStyle: "dashed" }}>
      <Pressable onPress={() => setOpen((o) => !o)}>
        <Text style={{ color: C.warn, fontWeight: "700", ...mono }}>
          DEV · simulated position {sim ? `(${sim.lat.toFixed(5)}, ${sim.lng.toFixed(5)})` : "off"} {open ? "▲" : "▼"}
        </Text>
      </Pressable>
      {open && (
        <View style={{ marginTop: 8 }}>
          <Label>Teleport</Label>
          {targets.map((t) => (
            <View key={t.id} style={{ flexDirection: "row", alignItems: "center", marginBottom: 4, gap: 6 }}>
              <Text style={{ color: C.text, flex: 1, fontSize: 13 }}>{t.name}</Text>
              <Button title="here" kind="ghost" style={{ marginTop: 0, paddingVertical: 6 }} onPress={() => setSimFix({ lat: t.lat, lng: t.lng })} />
              <Button title="300 m" kind="ghost" style={{ marginTop: 0, paddingVertical: 6 }} onPress={() => setSimFix(offsetM(t, 300, 45))} />
            </View>
          ))}
          {sim && <Button title="Use real GPS" kind="danger" onPress={() => setSimFix(null)} />}
        </View>
      )}
    </View>
  );
}
