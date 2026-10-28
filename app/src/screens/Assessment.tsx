import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Line, Polygon } from "react-native-svg";
import type { AssessmentQuestion, AssessmentResult, Player, SkillKey } from "@ispy/shared";
import { api } from "../api";
import { C, F, factionColor } from "../theme";
import { Body, Button, Choice, Display, Dossier, Input, Kicker, Screen, Spinner, Typed } from "../ui";
import { ChiefAvatar } from "../graphics";

const SKILLS: SkillKey[] = ["observation", "reasoning", "cipher", "cooperation"];
const FACTION_NAME: Record<string, string> = { raven: "RAVEN", phantom: "PHANTOM", cipher: "CIPHER" };

export function Assessment({ onRecruited }: { onRecruited: (p: Player) => void }) {
  const [questions, setQuestions] = useState<AssessmentQuestion[] | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<AssessmentResult | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { api.assessment().then((r) => setQuestions(r.questions)).catch((e) => setErr(e.message)); }, []);

  const submit = async () => {
    if (!questions) return;
    const missing = questions.filter((q) => !answers[q.id]?.trim());
    if (missing.length) return setErr(`${missing.length} question${missing.length > 1 ? "s" : ""} still unanswered.`);
    setBusy(true); setErr(null);
    try { const r = await api.submitAssessment({ answers }); setResult(r); setChosen(r.offers[0]?.factionId ?? null); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const accept = async () => {
    if (!chosen) return;
    setBusy(true);
    try { const r = await api.acceptOffer(chosen as any); onRecruited(r.player); }
    catch (e: any) { setErr(e.message); setBusy(false); }
  };

  if (err && !questions && !result) return <Screen><Body style={{ color: C.red }}>{err}</Body></Screen>;
  if (!questions) return <Screen><Spinner /></Screen>;

  if (result) {
    return (
      <Screen>
        <Display>Clearance granted</Display>
        <Dossier tab={C.cyan} style={{ marginTop: 8 }}>
          <Text style={s.eyebrow}>Intelligence ID badge</Text>
          <Text style={s.big}>Civilian candidate</Text>
          <Text style={s.sub}>Fit proof · {result.offers.length} agency offer{result.offers.length === 1 ? "" : "s"}</Text>
        </Dossier>
        <Dossier tab={C.cyanDim}>
          <SkillRadar skills={result.skills} />
        </Dossier>
        <Text style={s.section}>Active agency offers</Text>
        {result.offers.length === 0 && <Body dim>No chief made an offer yet. You can retake the test later.</Body>}
        {result.offers.map((o) => {
          const col = factionColor(o.factionId);
          const on = chosen === o.factionId;
          return (
            <Pressable key={o.factionId} onPress={() => setChosen(o.factionId)} accessibilityRole="button" style={[s.offer, { borderColor: on ? col : C.line, backgroundColor: on ? col + "22" : C.glass }]}>
              <ChiefAvatar factionId={o.factionId} size={54} />
              <View style={{ flex: 1 }}>
                <Text style={[s.big, { fontSize: 20, lineHeight: 22 }]}>{o.chief.toUpperCase()} <Text style={{ color: col }}>/ {Math.round(o.fit * 100)}% match</Text></Text>
                <Text style={s.sub}>{FACTION_NAME[o.factionId]} · {o.role} role</Text>
                <Typed style={{ marginTop: 4, marginBottom: 0, color: C.text }}>{o.pitch}</Typed>
              </View>
            </Pressable>
          );
        })}
        <Button title={chosen ? `Accept offer · ${FACTION_NAME[chosen]}` : "Accept offer"} onPress={accept} loading={busy} disabled={!chosen} style={{ paddingVertical: 16 }} />
        {err && <Body style={{ color: C.red }}>{err}</Body>}
      </Screen>
    );
  }

  return (
    <Screen>
      <Display>Aptitude test</Display>
      <Kicker>Six questions. The chiefs read everything.</Kicker>
      {questions.map((q, i) => (
        <Dossier key={q.id} tab={C.cyanDim}>
          <Text style={s.eyebrow}>{i + 1} of {questions.length} · {q.skill}</Text>
          <Typed bold>{q.prompt}</Typed>
          {q.kind === "choice" && q.options
            ? q.options.map((opt) => <Choice key={opt} label={opt} on={answers[q.id] === opt} onPress={() => setAnswers((a) => ({ ...a, [q.id]: opt }))} />)
            : <Input value={answers[q.id] ?? ""} onChangeText={(t) => setAnswers((a) => ({ ...a, [q.id]: t }))} placeholder="YOUR ANSWER" autoCapitalize="characters" />}
        </Dossier>
      ))}
      {err && <Body style={{ color: C.red }}>{err}</Body>}
      <Button title="Submit to the chiefs" onPress={submit} loading={busy} style={{ paddingVertical: 16 }} />
    </Screen>
  );
}

/** Four-axis radar of observed skills. */
function SkillRadar({ skills }: { skills: Record<SkillKey, number> }) {
  const S = 300, c = S / 2, R = 78;
  const pt = (i: number, v: number) => { const a = (-90 + i * 90) * (Math.PI / 180); return { x: c + R * v * Math.cos(a), y: c + R * v * Math.sin(a) }; };
  const poly = SKILLS.map((k, i) => pt(i, skills[k])).map((p) => `${p.x},${p.y}`).join(" ");
  const labels = [{ k: "observation", x: c, y: 16 }, { k: "reasoning", x: c + R + 14, y: c + 4, anchor: "left" }, { k: "cipher", x: c, y: S - 6 }, { k: "cooperation", x: c - R - 14, y: c + 4, anchor: "right" }];
  return (
    <View style={{ alignItems: "center" }}>
      <Svg width={S} height={S}>
        {[0.25, 0.5, 0.75, 1].map((k) => <Circle key={k} cx={c} cy={c} r={R * k} fill="none" stroke={C.cyan} strokeOpacity={0.25} />)}
        {SKILLS.map((_, i) => { const p = pt(i, 1); return <Line key={i} x1={c} y1={c} x2={p.x} y2={p.y} stroke={C.cyan} strokeOpacity={0.25} />; })}
        <Polygon points={poly} fill={C.cyan} fillOpacity={0.3} stroke={C.cyan} strokeWidth={2} />
        {SKILLS.map((k, i) => { const p = pt(i, skills[k]); return <Circle key={k} cx={p.x} cy={p.y} r={3.5} fill={C.cyan} />; })}
      </Svg>
      {labels.map((l) => (
        <Text key={l.k} style={{ position: "absolute", color: C.text, fontFamily: F.displayMed, fontSize: 12, letterSpacing: 1.2, textTransform: "uppercase", top: l.y - 8, ...(l.anchor === "left" ? { left: l.x + (S / 2 - c) } : l.anchor === "right" ? { right: S - l.x + (S / 2 - c) } : { left: 0, right: 0, textAlign: "center" }) }}>
          {l.k} {Math.round(skills[l.k as SkillKey] * 100)}
        </Text>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  eyebrow: { color: C.dim, fontFamily: F.displayMed, fontSize: 11, letterSpacing: 1.4, textTransform: "uppercase" },
  big: { color: C.text, fontFamily: F.displayMed, fontSize: 24, lineHeight: 26, letterSpacing: 1, textTransform: "uppercase" },
  sub: { color: C.dim, fontSize: 13 },
  section: { color: C.cyan, fontFamily: F.displayMed, fontSize: 13, letterSpacing: 1.6, textTransform: "uppercase", marginBottom: 6, marginTop: 4 },
  offer: { flexDirection: "row", gap: 12, alignItems: "center", borderWidth: 1, padding: 10, marginBottom: 8 },
});
