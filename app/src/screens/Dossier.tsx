import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Line, Polygon } from "react-native-svg";
import { LinearGradient } from "expo-linear-gradient";
import type { AccuseResponse, CaseDetail, CaseSummary, FactionId } from "@ispy/shared";
import { api } from "../api";
import { C, F, factionColor } from "../theme";
import { Body, Button, Display, Dossier as Panel, Screen, Spinner, Stamp } from "../ui";
import { FactionEmblem } from "../graphics";

const FACTION_NAME: Record<string, string> = { raven: "RAVEN", phantom: "PHANTOM", cipher: "CIPHER" };

/** Investigation dossier: evidence gathered in the field, an alignment radar, and the formal accusation. */
export function DossierScreen() {
  const [cases, setCases] = useState<CaseSummary[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<CaseDetail | null>(null);
  const [accused, setAccused] = useState<FactionId | null>(null);
  const [result, setResult] = useState<AccuseResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const loadList = async () => {
    try { const r = await api.cases(); setCases(r.cases); if (!selected && r.cases[0]) setSelected(r.cases[0].id); }
    catch (e: any) { setErr(e.message); setCases([]); }
  };
  const loadDetail = async (id: string) => {
    try { const d = await api.caseDetail(id); setDetail(d); setAccused((a) => a ?? topFaction(d)); }
    catch (e: any) { setErr(e.message); }
  };
  useEffect(() => { loadList(); const t = setInterval(loadList, 20000); return () => clearInterval(t); }, []);
  useEffect(() => { if (selected) { setResult(null); setAccused(null); loadDetail(selected); } }, [selected]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true); setErr(null);
    try { await fn(); if (selected) await loadDetail(selected); await loadList(); }
    catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  };

  if (cases === null) return <Screen><Spinner /></Screen>;

  return (
    <Screen>
      <Display>Investigation dossier</Display>
      {cases.length === 0 ? (
        <Panel tab={C.cyanDim}>
          <Text style={s.big}>No open cases</Text>
          <Body dim style={{ marginBottom: 0 }}>Evidence comes from the field. Complete missions while rival operatives are in your sector, or win a contested target, and a case opens on whoever you brushed against.</Body>
        </Panel>
      ) : (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 10, justifyContent: "center" }}>
          {cases.map((c) => (
            <Pressable key={c.id} onPress={() => setSelected(c.id)} accessibilityRole="button" style={[s.chip, selected === c.id && { borderColor: C.cyan, backgroundColor: C.cyanGlow }]}>
              <Text style={[s.chipText, selected === c.id && { color: C.cyan }]}>{c.subject} · {Math.round(c.confidence * 100)}%</Text>
            </Pressable>
          ))}
        </View>
      )}

      {detail && (
        <>
          <Text style={s.caseNo}>CASE FILE #{detail.id.slice(0, 6).toUpperCase()}</Text>
          <Panel tab={detail.state === "confirmed" ? C.ok : detail.state === "cooldown" ? C.red : C.cyan}>
            <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
              {detail.reveal ? <FactionEmblem id={detail.reveal.factionId} size={56} /> : (
                <View style={s.silhouette}><Svg width={54} height={54} viewBox="0 0 100 100"><Circle cx={50} cy={36} r={18} fill={C.cyan} fillOpacity={0.75} /><Circle cx={50} cy={110} r={44} fill={C.cyan} fillOpacity={0.75} /></Svg></View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={s.eyebrow}>Intelligence ID badge</Text>
                <Text style={s.big}>Subject: {detail.subject}</Text>
                {detail.reveal
                  ? <Text style={s.sub}>Identified: <Text style={{ color: factionColor(detail.reveal.factionId) }}>{detail.reveal.codename} · {FACTION_NAME[detail.reveal.factionId]}</Text></Text>
                  : <Text style={s.sub}>Investigation status: <Text style={{ color: detail.state === "cooldown" ? C.red : C.ok }}>{detail.state === "cooldown" ? `COOLDOWN until ${new Date(detail.cooldownUntil!).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "ACTIVE"}</Text></Text>}
              </View>
            </View>
          </Panel>

          <Panel tab={C.cyanDim}>
            <Text style={s.eyebrow}>Fit proof · agency alignment</Text>
            <AlignmentRadar data={detail.alignment} />
          </Panel>

          <Text style={s.section}>Evidence ledger · {detail.evidence.length}</Text>
          {detail.evidence.length === 0 && <Body dim>Nothing in the ledger yet.</Body>}
          {detail.evidence.map((e) => (
            <Panel key={e.id} tab={e.decoyDetected ? C.red : C.cyanDim} style={{ marginBottom: 8 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <View style={{ flex: 1 }}>
                  <Text style={[s.file, e.decoyDetected && { textDecorationLine: "line-through", color: C.dim }]}>{e.file}</Text>
                  <Text style={s.sub}>{e.decoyDetected ? "Decoy, exposed by your analyst" : `${Math.round(e.weight * 100)}% weight · points to ${FACTION_NAME[e.hintsFaction]}`} · {e.source}</Text>
                </View>
                <Text style={s.kind}>{e.kind.toUpperCase()}</Text>
              </View>
            </Panel>
          ))}

          <Panel tab={detail.decoyDetected ? C.red : C.cyan}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              {detail.decoyDetected ? <Text style={[s.file, { color: C.red }]}>⚠ DECOY DETECTED</Text> : <Text style={s.file}>No decoys exposed yet</Text>}
              <Text style={[s.file, { color: C.cyan }]}>CONFIDENCE: {Math.round(detail.confidence * 100)}%</Text>
            </View>
            <View style={s.meterBg}>
              <LinearGradient colors={[C.amber, C.ok, C.cyan]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ width: `${Math.round(detail.confidence * 100)}%`, height: "100%" }} />
              <View style={[s.threshold, { left: `${Math.round(detail.accuseThreshold * 100)}%` }]} />
            </View>
            <Text style={s.eyebrow}>Confidence meter · accusation threshold {Math.round(detail.accuseThreshold * 100)}%</Text>
          </Panel>

          {result ? (
            <Panel tab={result.correct ? C.ok : C.red}>
              <View style={{ alignItems: "center", marginVertical: 6 }}><Stamp text={result.correct ? "Confirmed" : "Rejected"} size={32} color={result.correct ? C.ok : C.red} /></View>
              <Body style={{ textAlign: "center" }}>{result.debrief}</Body>
              <Text style={[s.file, { color: C.cyan, textAlign: "center" }]}>{result.reward.xp ? `+${result.reward.xp} XP · ` : ""}trust {result.reward.trust >= 0 ? "+" : ""}{result.reward.trust}</Text>
            </Panel>
          ) : detail.state === "open" ? (
            <>
              <Text style={s.section}>Accuse of belonging to</Text>
              <View style={{ flexDirection: "row", gap: 6, marginBottom: 6 }}>
                {detail.alignment.map((a) => (
                  <Pressable key={a.factionId} onPress={() => setAccused(a.factionId)} accessibilityRole="button" style={[s.chip, { flex: 1, alignItems: "center" }, accused === a.factionId && { borderColor: factionColor(a.factionId), backgroundColor: factionColor(a.factionId) + "33" }]}>
                    <Text style={[s.chipText, accused === a.factionId && { color: factionColor(a.factionId) }]}>{a.label}</Text>
                  </Pressable>
                ))}
              </View>
              <Button title={`Formal accusation${accused ? ` · ${FACTION_NAME[accused]}` : ""}`} kind="danger" loading={busy}
                onPress={() => accused && act(async () => setResult(await api.accuse(detail.id, accused)))}
                disabled={!accused || detail.confidence < detail.accuseThreshold} style={{ paddingVertical: 18 }} />
              {detail.confidence < detail.accuseThreshold && <Body dim style={{ textAlign: "center", fontSize: 12.5 }}>Gather more evidence before accusing. A wrong call costs 5 trust and an hour.</Body>}
            </>
          ) : null}

          {detail.state === "open" && (
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Button title={`Submit clue (${detail.cluesLeftToday} left)`} kind="ghost" disabled={busy || detail.cluesLeftToday <= 0} onPress={() => act(() => api.clue(detail.id))} style={{ flex: 1 }} />
              <Button title={`Request wire (${detail.wireCostCredits} cr)`} kind="ghost" disabled={busy} onPress={() => act(() => api.wire(detail.id))} style={{ flex: 1 }} />
            </View>
          )}
        </>
      )}
      {err && <Body style={{ color: C.red, textAlign: "center" }}>{err}</Body>}
    </Screen>
  );
}

const topFaction = (d: CaseDetail): FactionId | null => d.alignment.slice().sort((a, b) => b.value - a.value)[0]?.factionId ?? null;

function AlignmentRadar({ data }: { data: { label: string; chief: string; value: number; factionId: FactionId }[] }) {
  const S = 300, cx = S / 2, cy = S / 2, R = 88, n = data.length;
  const pt = (i: number, v: number) => { const a = (-90 + (i * 360) / n) * (Math.PI / 180); return { x: cx + R * v * Math.cos(a), y: cy + R * v * Math.sin(a) }; };
  const poly = data.map((d, i) => pt(i, d.value)).map((p) => `${p.x},${p.y}`).join(" ");
  const ring = (k: number) => data.map((_, i) => pt(i, k)).map((p) => `${p.x},${p.y}`).join(" ");
  return (
    <View style={{ alignItems: "center", height: S }}>
      <Svg width={S} height={S}>
        {[0.25, 0.5, 0.75, 1].map((k) => <Polygon key={k} points={ring(k)} fill="none" stroke={C.cyan} strokeOpacity={0.22} />)}
        {data.map((_, i) => { const p = pt(i, 1); return <Line key={i} x1={cx} y1={cy} x2={p.x} y2={p.y} stroke={C.cyan} strokeOpacity={0.22} />; })}
        <Polygon points={poly} fill={C.cyan} fillOpacity={0.28} stroke={C.cyan} strokeWidth={2} />
        {data.map((d, i) => { const p = pt(i, d.value); return <Circle key={i} cx={p.x} cy={p.y} r={4} fill={factionColor(d.factionId)} />; })}
      </Svg>
      {data.map((d, i) => {
        const p = pt(i, 1.36);
        return (
          <View key={d.label} style={{ position: "absolute", left: p.x - 54, top: p.y - 14, width: 108, alignItems: "center" }}>
            <Text style={[s.axis, { color: factionColor(d.factionId) }]}>{d.label} <Text style={{ color: C.dim }}>({d.chief})</Text></Text>
            <Text style={s.axisNote}>{Math.round(d.value * 100)}%</Text>
          </View>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  caseNo: { color: C.dim, fontFamily: F.typed, fontSize: 12, textAlign: "center", marginBottom: 10 },
  chip: { borderWidth: 1, borderColor: C.line, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: C.ink2 },
  chipText: { color: C.dim, fontFamily: F.displayMed, fontSize: 12, letterSpacing: 1.2 },
  silhouette: { width: 60, height: 60, overflow: "hidden", backgroundColor: C.ink, borderWidth: 1, borderColor: C.cyan, alignItems: "center", justifyContent: "flex-end" },
  eyebrow: { color: C.dim, fontFamily: F.displayMed, fontSize: 11, letterSpacing: 1.4, textTransform: "uppercase" },
  big: { color: C.text, fontFamily: F.displayMed, fontSize: 22, lineHeight: 24, letterSpacing: 1, textTransform: "uppercase" },
  sub: { color: C.dim, fontSize: 13 },
  section: { color: C.cyan, fontFamily: F.displayMed, fontSize: 13, letterSpacing: 1.6, textTransform: "uppercase", marginBottom: 6, marginTop: 4 },
  file: { color: C.text, fontFamily: F.typed, fontSize: 14 },
  kind: { color: C.cyanDim, fontFamily: F.displayMed, fontSize: 11, letterSpacing: 1.2 },
  meterBg: { height: 10, backgroundColor: C.ink, borderWidth: 1, borderColor: C.line, marginBottom: 6, overflow: "hidden", flexDirection: "row" },
  threshold: { position: "absolute", top: -2, width: 2, height: 14, backgroundColor: C.red },
  axis: { fontFamily: F.displayMed, fontSize: 12, letterSpacing: 1, textAlign: "center" },
  axisNote: { color: C.dim, fontSize: 10, textAlign: "center" },
});
