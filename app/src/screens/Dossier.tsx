import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Line, Polygon } from "react-native-svg";
import { LinearGradient } from "expo-linear-gradient";
import { C, F } from "../theme";
import { Body, Button, Display, Dossier as Panel, Screen, Stamp } from "../ui";
import { MOCK_CASE } from "../mock";

/** Investigation dossier: who is the rival, and is there enough to accuse? Mock-driven until the server grows cases. */
export function DossierScreen() {
  const c = MOCK_CASE;
  const [accused, setAccused] = useState(false);
  const canAccuse = c.confidence >= c.accuseThreshold;

  return (
    <Screen>
      <Display>Investigation dossier</Display>
      <Text style={s.caseNo}>CASE FILE #{c.caseId}</Text>

      <Panel tab={C.cyan}>
        <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
          <View style={s.silhouette}><Svg width={54} height={54} viewBox="0 0 100 100"><Circle cx={50} cy={36} r={18} fill={C.cyan} fillOpacity={0.75} /><Circle cx={50} cy={110} r={44} fill={C.cyan} fillOpacity={0.75} /></Svg></View>
          <View style={{ flex: 1 }}>
            <Text style={s.eyebrow}>Intelligence ID badge</Text>
            <Text style={s.big}>Subject: {c.subject}</Text>
            <Text style={s.sub}>Investigation status: <Text style={{ color: C.ok }}>{c.status}</Text></Text>
          </View>
        </View>
      </Panel>

      <Panel tab={C.cyanDim}>
        <Text style={s.eyebrow}>Fit proof · 5 agency alignment</Text>
        <AlignmentRadar data={c.alignment} />
      </Panel>

      <Text style={s.section}>Evidence ledger</Text>
      {c.evidence.map((e) => (
        <Panel key={e.id} tab={C.cyanDim} style={{ marginBottom: 8 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <View>
              <Text style={s.file}>{e.file}</Text>
              <Text style={s.sub}>{Math.round(e.weight * 100)}% {e.label}</Text>
            </View>
            <Text style={s.kind}>{e.kind.toUpperCase()}</Text>
          </View>
        </Panel>
      ))}

      <Panel tab={c.decoyDetected ? C.red : C.cyan}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          {c.decoyDetected ? <Text style={[s.file, { color: C.red }]}>⚠ DECOY DETECTED</Text> : <Text style={s.file}>No decoys found</Text>}
          <Text style={[s.file, { color: C.cyan }]}>CONFIDENCE: {Math.round(c.confidence * 100)}%</Text>
        </View>
        <View style={s.meterBg}>
          <LinearGradient colors={[C.amber, C.ok, C.cyan]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ width: `${Math.round(c.confidence * 100)}%`, height: "100%" }} />
          <View style={[s.threshold, { left: `${Math.round(c.accuseThreshold * 100)}%` }]} />
        </View>
        <Text style={s.eyebrow}>Confidence meter · accusation threshold {Math.round(c.accuseThreshold * 100)}%</Text>
      </Panel>

      {accused ? (
        <Panel tab={C.ok}>
          <View style={{ alignItems: "center", marginVertical: 6 }}><Stamp text="Accusation filed" size={28} color={C.red} /></View>
          <Body dim style={{ marginBottom: 0, textAlign: "center" }}>The World Arbiter will confirm or reject within the hour. A wrong call costs trust; a right one reveals the subject's agency.</Body>
        </Panel>
      ) : (
        <Button title="Formal accusation" kind="danger" onPress={() => setAccused(true)} disabled={!canAccuse} style={{ paddingVertical: 18 }} />
      )}
      {!canAccuse && !accused && <Body dim style={{ textAlign: "center", fontSize: 12.5 }}>Gather more evidence before accusing.</Body>}
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Button title="Submit clue" kind="ghost" onPress={() => {}} style={{ flex: 1 }} />
        <Button title="Request wire" kind="ghost" onPress={() => {}} style={{ flex: 1 }} />
      </View>
      <Body dim style={{ fontSize: 11.5, textAlign: "center", marginTop: 10 }}>Preview: case data is simulated until investigations go live on the server.</Body>
    </Screen>
  );
}

function AlignmentRadar({ data }: { data: { label: string; chief: string; note: string; value: number }[] }) {
  const S = 320, cx = S / 2, cy = S / 2 - 6, R = 92, n = data.length;
  const pt = (i: number, v: number) => { const a = (-90 + (i * 360) / n) * (Math.PI / 180); return { x: cx + R * v * Math.cos(a), y: cy + R * v * Math.sin(a) }; };
  const poly = data.map((d, i) => pt(i, d.value)).map((p) => `${p.x},${p.y}`).join(" ");
  const ring = (k: number) => data.map((_, i) => pt(i, k)).map((p) => `${p.x},${p.y}`).join(" ");
  return (
    <View style={{ alignItems: "center", height: S }}>
      <Svg width={S} height={S}>
        {[0.25, 0.5, 0.75, 1].map((k) => <Polygon key={k} points={ring(k)} fill="none" stroke={C.cyan} strokeOpacity={0.22} />)}
        {data.map((_, i) => { const p = pt(i, 1); return <Line key={i} x1={cx} y1={cy} x2={p.x} y2={p.y} stroke={C.cyan} strokeOpacity={0.22} />; })}
        <Polygon points={poly} fill={C.cyan} fillOpacity={0.28} stroke={C.cyan} strokeWidth={2} />
        {data.map((d, i) => { const p = pt(i, d.value); return <Circle key={i} cx={p.x} cy={p.y} r={4} fill={C.cyan} />; })}
      </Svg>
      {data.map((d, i) => {
        const p = pt(i, 1.42);
        return (
          <View key={d.label} style={{ position: "absolute", left: p.x - 54, top: p.y - 14, width: 108, alignItems: "center" }}>
            <Text style={s.axis}>{d.label} <Text style={{ color: C.dim }}>({d.chief})</Text></Text>
            <Text style={s.axisNote}>{d.note}</Text>
          </View>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  caseNo: { color: C.dim, fontFamily: F.typed, fontSize: 12, textAlign: "center", marginBottom: 10 },
  silhouette: { width: 60, height: 60, overflow: "hidden", backgroundColor: C.ink, borderWidth: 1, borderColor: C.cyan, alignItems: "center", justifyContent: "flex-end" },
  eyebrow: { color: C.dim, fontFamily: F.displayMed, fontSize: 11, letterSpacing: 1.4, textTransform: "uppercase" },
  big: { color: C.text, fontFamily: F.displayMed, fontSize: 22, lineHeight: 24, letterSpacing: 1, textTransform: "uppercase" },
  sub: { color: C.dim, fontSize: 13 },
  section: { color: C.cyan, fontFamily: F.displayMed, fontSize: 13, letterSpacing: 1.6, textTransform: "uppercase", marginBottom: 6, marginTop: 4 },
  file: { color: C.text, fontFamily: F.typed, fontSize: 14 },
  kind: { color: C.cyanDim, fontFamily: F.displayMed, fontSize: 11, letterSpacing: 1.2 },
  meterBg: { height: 10, backgroundColor: C.ink, borderWidth: 1, borderColor: C.line, marginBottom: 6, overflow: "hidden", flexDirection: "row" },
  threshold: { position: "absolute", top: -2, width: 2, height: 14, backgroundColor: C.red },
  axis: { color: C.text, fontFamily: F.displayMed, fontSize: 12, letterSpacing: 1, textAlign: "center" },
  axisNote: { color: C.dim, fontSize: 10, textAlign: "center" },
});
