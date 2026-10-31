import React, { useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { ART } from "../art";
import { C, F } from "../theme";
import { Button } from "../ui";
import type { DialTool } from "./ToolDial";

/**
 * The field kit on the map: a slim strip, not a wheel. Only the tools that mean something on the
 * ground (lens, jammer, tracker, decoy, burner), only the ones you hold, as chips with a count. Tap a
 * chip to read what it does from here and use it. Desk tools (cipher kit, key, fragments) stay on the
 * desk and on Me; the half-wheel dial lives in AR scan, where it opens packages.
 */
const FIELD_IDS = ["lens", "jammer", "tracker", "decoy", "burner"];

export function FieldKit({ tools, busy, onUse, hint, effects }: { tools: DialTool[]; busy: boolean; onUse: (tool: DialTool) => void; hint?: string | null; effects: { kind: string; until: string }[] }) {
  const held = tools.filter((t) => FIELD_IDS.includes(t.id) && (t.permanent || t.qty > 0));
  const [pick, setPick] = useState<string | null>(null);
  const cur = held.find((t) => t.id === pick) ?? null;
  const live = effects.filter((e) => Date.parse(e.until) > Date.now());
  return (
    <View style={s.wrap}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text style={s.eyebrow}>FIELD KIT{held.length ? "" : " · EMPTY"}</Text>
        {live.length > 0 && <Text style={[s.eyebrow, { color: C.cyan }]}>{live.map((e) => `${e.kind.toUpperCase()} UNTIL ${new Date(e.until).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`).join(" · ")}</Text>}
      </View>
      {held.length === 0 ? (
        <Text style={s.mono}>Caches drop lenses, jammers and decoys. Trackers and burners are crafted on Me from fragments.</Text>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 6 }}>
          {held.map((t) => (
            <Pressable key={t.id} onPress={() => setPick(pick === t.id ? null : t.id)} style={[s.chip, pick === t.id && s.chipOn, !t.enabled && s.chipOff]}>
              <Image source={ART.tool[t.id]} style={s.img} />
              {!t.permanent && <View style={s.badge}><Text style={s.badgeText}>{t.qty}</Text></View>}
              <Text style={[s.chipName, pick === t.id && { color: C.cyan }]}>{t.name.toUpperCase()}</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}
      {cur && (
        <View style={s.detail}>
          <View style={{ flex: 1 }}>
            <Text style={[s.name, !cur.enabled && { color: C.dim }]}>{cur.name.toUpperCase()}{cur.permanent ? "" : ` · ×${cur.qty}`}</Text>
            <Text style={s.mono}>{cur.enabled ? cur.use : cur.why ?? cur.use}</Text>
          </View>
          <Button title={cur.enabled ? "Use" : "Not here"} onPress={() => onUse(cur)} loading={busy} disabled={!cur.enabled} style={{ marginTop: 0, paddingVertical: 8, paddingHorizontal: 16 }} />
        </View>
      )}
      {hint && <Text style={s.hint}>{hint}</Text>}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginTop: 10, borderTopWidth: 1, borderTopColor: C.line, paddingTop: 8 },
  eyebrow: { color: C.dim, fontFamily: F.displayMed, fontSize: 10.5, letterSpacing: 1.6 },
  mono: { color: C.dim, fontFamily: F.typed, fontSize: 11.5, marginTop: 4 },
  chip: { width: 74, alignItems: "center", paddingVertical: 6, borderWidth: 1, borderColor: C.line, backgroundColor: "rgba(6,20,30,0.6)" },
  chipOn: { borderColor: C.cyan, backgroundColor: C.cyanGlow },
  chipOff: { opacity: 0.55 },
  img: { width: 44, height: 44, borderRadius: 22, backgroundColor: "#000" },
  badge: { position: "absolute", right: 8, top: 4, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: C.cyan, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  badgeText: { color: C.ink, fontFamily: F.displayMed, fontSize: 10.5 },
  chipName: { color: C.dim, fontFamily: F.displayMed, fontSize: 9.5, letterSpacing: 1, marginTop: 4 },
  detail: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 4, borderWidth: 1, borderColor: C.cyanDim, padding: 8, backgroundColor: "rgba(6,20,30,0.6)" },
  name: { color: C.cyan, fontFamily: F.displayMed, fontSize: 13, letterSpacing: 1.4 },
  hint: { color: C.cyan, fontFamily: F.typed, fontSize: 11.5, marginTop: 6 },
});
