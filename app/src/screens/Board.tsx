import React, { useEffect, useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { C, F, factionColor } from "../theme";
import { Body, Button, Display, Dossier as Panel, Screen, fmtCountdown } from "../ui";
import { ART } from "../art";
import { MOCK_BOUNTIES, MOCK_EVENT, MOCK_INVENTORY, type Bounty } from "../mock";

/** Bounty board, the live global event, and the operative's inventory. Mock-driven until the bounty engine ships. */
export function Board() {
  const [now, setNow] = useState(Date.now());
  const [claimed, setClaimed] = useState<Record<string, boolean>>({});
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);

  return (
    <Screen>
      <Display>Bounty board</Display>
      <Text style={s.sub2}>Chief-issued contracts · non-cash rewards only</Text>

      <View style={s.banner}>
        <Image source={ART.splash} style={StyleSheet.absoluteFill} resizeMode="cover" />
        <LinearGradient colors={["rgba(10,14,20,0.2)", "rgba(10,14,20,0.92)"]} style={StyleSheet.absoluteFill} />
        <View style={{ padding: 14 }}>
          <Text style={s.eyebrow}>Global event · live</Text>
          <Text style={s.eventTitle}>{MOCK_EVENT.name}</Text>
          <Text style={s.countdown}>ENDS IN {fmtCountdown(MOCK_EVENT.endsAt, now)}</Text>
          <Text style={[s.sub, { marginTop: 6 }]}>{MOCK_EVENT.brief}</Text>
          <View style={{ marginTop: 10 }}>
            {MOCK_EVENT.progress.map((p) => (
              <View key={p.faction} style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <Text style={[s.factionLabel, { color: factionColor(p.faction) }]}>{p.label}</Text>
                <View style={s.progressBg}><View style={{ width: `${Math.round(p.value * 100)}%`, height: "100%", backgroundColor: factionColor(p.faction) }} /></View>
                <Text style={s.pct}>{Math.round(p.value * 100)}%</Text>
              </View>
            ))}
          </View>
        </View>
      </View>

      <Text style={s.section}>Contracts</Text>
      {MOCK_BOUNTIES.map((b) => <BountyCard key={b.id} b={b} now={now} claimed={!!claimed[b.id]} onClaim={() => setClaimed((c) => ({ ...c, [b.id]: true }))} />)}

      <Text style={s.section}>Inventory</Text>
      <Panel tab={C.cyanDim}>
        {MOCK_INVENTORY.map((i, idx) => (
          <View key={i.id} style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 6, borderTopWidth: idx ? 1 : 0, borderTopColor: C.line }}>
            <View style={{ flex: 1 }}>
              <Text style={s.item}>{i.name}</Text>
              <Text style={s.sub}>{i.note}</Text>
            </View>
            <Text style={s.qty}>×{i.qty}</Text>
          </View>
        ))}
      </Panel>
      <Body dim style={{ fontSize: 11.5, textAlign: "center", marginTop: 6 }}>Preview: contracts and inventory are simulated until the bounty engine ships.</Body>
    </Screen>
  );
}

function BountyCard({ b, now, claimed, onClaim }: { b: Bounty; now: number; claimed: boolean; onClaim: () => void }) {
  const status = claimed ? "ACTIVE" : b.status;
  const color = status === "ACTIVE" ? C.ok : status === "LOCKED" ? C.dim : C.cyan;
  return (
    <Panel tab={color} style={{ marginBottom: 10 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
        <View style={{ flex: 1 }}>
          <Text style={s.eyebrow}>{b.type}{b.squad ? " · SQUAD" : ""} · from {b.issuer}</Text>
          <Text style={s.title}>{b.title}</Text>
        </View>
        <Text style={[s.status, { color, borderColor: color }]}>{status}</Text>
      </View>
      <Text style={[s.sub, { marginVertical: 4 }]}>{b.brief}</Text>
      <View style={{ flexDirection: "row", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <Text style={s.tag}>{b.reward.xp} XP</Text>
        {b.reward.credits > 0 && <Text style={s.tag}>{b.reward.credits} CREDITS</Text>}
        <Text style={[s.sub, { marginLeft: "auto" }]}>expires {fmtCountdown(b.expiresAt, now)}</Text>
      </View>
      {status === "ELIGIBLE" && <Button title="Claim contract" onPress={onClaim} style={{ marginTop: 10, paddingVertical: 10 }} />}
    </Panel>
  );
}

const s = StyleSheet.create({
  sub2: { color: C.dim, fontFamily: F.displayMed, fontSize: 12, letterSpacing: 1.4, textTransform: "uppercase", textAlign: "center", marginBottom: 12 },
  banner: { height: 250, borderWidth: 1, borderColor: C.cyan + "88", overflow: "hidden", marginBottom: 14, justifyContent: "flex-end" },
  eyebrow: { color: C.cyanDim, fontFamily: F.displayMed, fontSize: 11, letterSpacing: 1.4, textTransform: "uppercase" },
  eventTitle: { color: C.cyan, fontFamily: F.display, fontSize: 34, lineHeight: 36, letterSpacing: 2, textShadowColor: C.cyan, textShadowRadius: 16, textShadowOffset: { width: 0, height: 0 } },
  countdown: { color: C.text, fontFamily: F.typed, fontSize: 13 },
  sub: { color: C.dim, fontSize: 13, lineHeight: 18 },
  factionLabel: { fontFamily: F.displayMed, fontSize: 12, letterSpacing: 1.2, width: 72 },
  progressBg: { flex: 1, height: 8, backgroundColor: C.ink, borderWidth: 1, borderColor: C.line, overflow: "hidden" },
  pct: { color: C.text, fontFamily: F.typed, fontSize: 12, width: 36, textAlign: "right" },
  section: { color: C.cyan, fontFamily: F.displayMed, fontSize: 13, letterSpacing: 1.6, textTransform: "uppercase", marginBottom: 8, marginTop: 4 },
  title: { color: C.text, fontFamily: F.displayMed, fontSize: 20, lineHeight: 22, letterSpacing: 1, textTransform: "uppercase" },
  status: { fontFamily: F.displayMed, fontSize: 11, letterSpacing: 1.4, borderWidth: 1, paddingHorizontal: 6, paddingVertical: 2 },
  tag: { color: C.cyan, fontFamily: F.displayMed, fontSize: 12, letterSpacing: 1.2, borderWidth: 1, borderColor: C.cyanDim, paddingHorizontal: 6, paddingVertical: 2 },
  item: { color: C.text, fontFamily: F.displayMed, fontSize: 16, letterSpacing: 0.8 },
  qty: { color: C.cyan, fontFamily: F.display, fontSize: 22 },
});
