import React, { useEffect, useRef, useState } from "react";
import { Animated, Dimensions, Easing, Image, Pressable, StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Svg, { Circle, Line, Polygon } from "react-native-svg";
import type { AssessmentQuestion, AssessmentResult, Player, SkillKey } from "@ispy/shared";
import { api } from "../api";
import { C, F, factionColor } from "../theme";
import { Body, Button, Input, Spinner, Stamp, Typed } from "../ui";
import { ChiefAvatar, FactionEmblem } from "../graphics";
import { ART } from "../art";

/**
 * Clearance, step two: the aptitude test as an interrogation, one question at a time on a card
 * that slides in over the sealed-dossier frame, the three chiefs watching from the top with the
 * one whose trade the question tests leaning in. Then the verdict: a stamp, the skill radar
 * drawing itself, and the agencies' offers as cards built from their chiefs' portraits.
 */
const SKILLS: SkillKey[] = ["observation", "reasoning", "cipher", "cooperation"];
const FACTION_NAME: Record<string, string> = { raven: "RAVEN", phantom: "PHANTOM", cipher: "CIPHER" };
const SKILL_CHIEF: Record<string, string> = { observation: "raven", reasoning: "raven", cipher: "cipher", cooperation: "phantom" };

export function Assessment({ onRecruited }: { onRecruited: (p: Player) => void }) {
  const [questions, setQuestions] = useState<AssessmentQuestion[] | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [at, setAt] = useState(0);
  const [result, setResult] = useState<AssessmentResult | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const { width, height } = Dimensions.get("window");

  useEffect(() => { api.assessment().then((r) => setQuestions(r.questions)).catch((e) => setErr(e.message)); }, []);

  const submit = async (all: Record<string, string>) => {
    if (!questions) return;
    const missing = questions.filter((q) => !all[q.id]?.trim());
    if (missing.length) { setErr(`${missing.length} question${missing.length > 1 ? "s" : ""} still unanswered.`); setAt(questions.findIndex((q) => !all[q.id]?.trim())); return; }
    setBusy(true); setErr(null);
    try { const r = await api.submitAssessment({ answers: all }); setResult(r); setChosen(r.offers[0]?.factionId ?? null); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const accept = async () => {
    if (!chosen) return;
    setBusy(true);
    try { const r = await api.acceptOffer(chosen as any); onRecruited(r.player); }
    catch (e: any) { setErr(e.message); setBusy(false); }
  };

  if (err && !questions && !result) return <View style={s.root}><Body style={{ color: C.red, padding: 20 }}>{err}</Body></View>;
  if (!questions) return <View style={s.root}><Spinner /></View>;

  if (result) return <Verdict result={result} chosen={chosen} setChosen={setChosen} accept={accept} busy={busy} err={err} width={width} height={height} />;

  const q = questions[at];
  const answered = !!answers[q.id]?.trim();
  const last = at === questions.length - 1;
  const next = (all = answers) => { if (last) submit(all); else setAt((i) => i + 1); };
  const choose = (opt: string) => { const all = { ...answers, [q.id]: opt }; setAnswers(all); setTimeout(() => next(all), 320); };
  return (
    <View style={s.root}>
      <Image source={ART.story.secrets} resizeMode="cover" style={[StyleSheet.absoluteFill, { width, height, opacity: 0.55 }]} />
      <LinearGradient colors={["rgba(7,11,16,0.55)", "rgba(7,11,16,0.9)", C.ink]} locations={[0, 0.55, 1]} style={StyleSheet.absoluteFill} />
      <View style={{ flex: 1, paddingHorizontal: 18, paddingTop: 18, maxWidth: 560, width: "100%", alignSelf: "center" }}>
        <Text style={s.eyebrow}>CLEARANCE · STEP 2 OF 2 · APTITUDE</Text>
        <View style={{ flexDirection: "row", gap: 4, marginTop: 8 }}>
          {questions.map((qq, i) => <View key={qq.id} style={{ flex: 1, height: 3, borderRadius: 2, backgroundColor: answers[qq.id] ? C.cyan : i === at ? "rgba(0,229,242,0.5)" : "rgba(255,255,255,0.12)" }} />)}
        </View>
        {/* the readers */}
        <View style={{ flexDirection: "row", justifyContent: "center", gap: 18, marginTop: 16 }}>
          {(["raven", "phantom", "cipher"] as const).map((f) => {
            const lean = SKILL_CHIEF[q.skill] === f;
            return (
              <View key={f} style={{ alignItems: "center", opacity: lean ? 1 : 0.45, transform: [{ scale: lean ? 1.12 : 1 }] }}>
                <ChiefAvatar factionId={f} size={lean ? 58 : 50} />
                <Text style={[s.reader, lean && { color: factionColor(f) }]}>{lean ? "READING" : FACTION_NAME[f]}</Text>
              </View>
            );
          })}
        </View>
        <QuestionCard key={q.id} q={q} index={at} total={questions.length} value={answers[q.id] ?? ""} onChoose={choose} onType={(t) => setAnswers((a) => ({ ...a, [q.id]: t }))} onSubmitText={() => answered && next()} />
        {err && <Body style={{ color: C.red }}>{err}</Body>}
        <View style={{ flexDirection: "row", gap: 8, marginTop: "auto", marginBottom: 24 }}>
          <Button title="Back" kind="ghost" onPress={() => setAt((i) => Math.max(0, i - 1))} disabled={at === 0 || busy} style={{ flex: 1, marginTop: 0 }} />
          <Button title={last ? "Submit to the chiefs" : "Next"} onPress={() => next()} loading={busy} disabled={!answered} style={{ flex: 2, marginTop: 0 }} />
        </View>
      </View>
    </View>
  );
}

function QuestionCard({ q, index, total, value, onChoose, onType, onSubmitText }: { q: AssessmentQuestion; index: number; total: number; value: string; onChoose: (o: string) => void; onType: (t: string) => void; onSubmitText: () => void }) {
  const slide = useRef(new Animated.Value(0)).current;
  useEffect(() => { Animated.timing(slide, { toValue: 1, duration: 420, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(); }, []);
  return (
    <Animated.View style={[s.card, { opacity: slide, transform: [{ translateX: slide.interpolate({ inputRange: [0, 1], outputRange: [60, 0] }) }] }]}>
      <Text style={s.cardEyebrow}>QUESTION {index + 1} OF {total} · {String(q.skill).toUpperCase()}</Text>
      <Text style={s.prompt}>{q.prompt}</Text>
      {q.kind === "choice" && q.options ? q.options.map((opt) => (
        <Pressable key={opt} onPress={() => onChoose(opt)} style={[s.option, value === opt && s.optionOn]}>
          <View style={[s.dot, value === opt && { backgroundColor: C.cyan }]} />
          <Text style={[s.optionText, value === opt && { color: C.text }]}>{opt}</Text>
        </Pressable>
      )) : (
        <Input value={value} onChangeText={onType} placeholder="Your answer" autoCapitalize="characters" onSubmitEditing={onSubmitText} style={{ marginTop: 8, marginBottom: 0, fontSize: 18 }} />
      )}
    </Animated.View>
  );
}

function Verdict({ result, chosen, setChosen, accept, busy, err, width, height }: { result: AssessmentResult; chosen: string | null; setChosen: (f: string) => void; accept: () => void; busy: boolean; err: string | null; width: number; height: number }) {
  const [k, setK] = useState(0); // the radar drawing itself
  useEffect(() => {
    let raf = 0; const t0 = Date.now();
    const tick = () => { const p = Math.min(1, (Date.now() - t0) / 1100); setK(1 - Math.pow(1 - p, 3)); if (p < 1) raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  const rise = useRef(new Animated.Value(0)).current;
  useEffect(() => { Animated.timing(rise, { toValue: 1, duration: 800, delay: 900, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(); }, []);
  return (
    <View style={s.root}>
      <Image source={ART.story.heroes} resizeMode="cover" style={[StyleSheet.absoluteFill, { width, height, opacity: 0.4 }]} />
      <LinearGradient colors={["rgba(7,11,16,0.5)", "rgba(7,11,16,0.92)", C.ink]} locations={[0, 0.45, 1]} style={StyleSheet.absoluteFill} />
      <Animated.ScrollView contentContainerStyle={{ paddingHorizontal: 18, paddingTop: 18, paddingBottom: 40, maxWidth: 560, width: "100%", alignSelf: "center" }}>
        <Text style={s.eyebrow}>CLEARANCE · VERDICT</Text>
        <View style={{ alignItems: "center", marginTop: 10 }}>
          <Stamp text="Cleared" size={44} color={C.ok} />
        </View>
        <View style={[s.card, { alignItems: "center" }]}>
          <Text style={s.cardEyebrow}>WHAT THE CHIEFS SAW</Text>
          <SkillRadar skills={result.skills} k={k} />
        </View>
        <Animated.View style={{ opacity: rise, transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }] }}>
          <Text style={[s.eyebrow, { marginTop: 18 }]}>{result.offers.length} OFFER{result.offers.length === 1 ? "" : "S"} ON THE TABLE</Text>
          {result.offers.length === 0 && <Body dim>No chief made an offer yet. You can retake the test later.</Body>}
          {result.offers.map((o) => {
            const col = factionColor(o.factionId);
            const on = chosen === o.factionId;
            return (
              <Pressable key={o.factionId} onPress={() => setChosen(o.factionId)} accessibilityRole="button" style={[s.offer, { borderColor: on ? col : C.hair }]}>
                <Image source={ART.portrait[o.factionId] ?? ART.splash} resizeMode="cover" style={[StyleSheet.absoluteFill, { opacity: on ? 0.55 : 0.3 }]} />
                <LinearGradient colors={["rgba(7,11,16,0.1)", "rgba(7,11,16,0.92)"]} style={StyleSheet.absoluteFill} />
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <FactionEmblem id={o.factionId} size={36} />
                  <View style={{ flex: 1 }}>
                    <Text style={[s.offerName, { color: col }]}>{FACTION_NAME[o.factionId]} · {Math.round(o.fit * 100)}% FIT</Text>
                    <Text style={s.offerSub}>{o.chief.toUpperCase()} · {o.role.toUpperCase()} ROLE</Text>
                  </View>
                  {on && <Text style={[s.cardEyebrow, { color: col }]}>SELECTED</Text>}
                </View>
                <Typed style={{ marginTop: 8, marginBottom: 0, color: C.text }}>{o.pitch}</Typed>
              </Pressable>
            );
          })}
          <Button title={chosen ? `Join ${FACTION_NAME[chosen]}` : "Choose an agency"} onPress={accept} loading={busy} disabled={!chosen} style={{ paddingVertical: 16 }} />
          {err && <Body style={{ color: C.red }}>{err}</Body>}
        </Animated.View>
      </Animated.ScrollView>
    </View>
  );
}

/** Four-axis radar of observed skills, drawn out from the centre by `k` (0..1). */
function SkillRadar({ skills, k }: { skills: Record<SkillKey, number>; k: number }) {
  const S = 280, c = S / 2, R = 78;
  const pt = (i: number, v: number) => { const a = (-90 + i * 90) * (Math.PI / 180); return { x: c + R * v * Math.cos(a), y: c + R * v * Math.sin(a) }; };
  const poly = SKILLS.map((key, i) => pt(i, skills[key] * k)).map((p) => `${p.x},${p.y}`).join(" ");
  const labels = [{ key: "observation", x: c, y: 16 }, { key: "reasoning", x: c + R + 14, y: c + 4, anchor: "left" }, { key: "cipher", x: c, y: S - 6 }, { key: "cooperation", x: c - R - 14, y: c + 4, anchor: "right" }];
  return (
    <View style={{ alignItems: "center", width: S }}>
      <Svg width={S} height={S}>
        {[0.25, 0.5, 0.75, 1].map((r) => <Circle key={r} cx={c} cy={c} r={R * r} fill="none" stroke={C.cyan} strokeOpacity={0.25} />)}
        {SKILLS.map((_, i) => { const p = pt(i, 1); return <Line key={i} x1={c} y1={c} x2={p.x} y2={p.y} stroke={C.cyan} strokeOpacity={0.25} />; })}
        <Polygon points={poly} fill={C.cyan} fillOpacity={0.3} stroke={C.cyan} strokeWidth={2} />
        {SKILLS.map((key, i) => { const p = pt(i, skills[key] * k); return <Circle key={key} cx={p.x} cy={p.y} r={3.5} fill={C.cyan} />; })}
      </Svg>
      {labels.map((l) => (
        <Text key={l.key} style={{ position: "absolute", color: C.text, fontFamily: F.displayMed, fontSize: 12, letterSpacing: 1.2, textTransform: "uppercase", top: l.y - 8, ...(l.anchor === "left" ? { left: l.x } : l.anchor === "right" ? { right: S - l.x } : { left: 0, right: 0, textAlign: "center" }) }}>
          {l.key} {Math.round(skills[l.key as SkillKey] * 100 * k)}
        </Text>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.ink },
  eyebrow: { color: C.dim, fontFamily: F.displayMed, fontSize: 11, letterSpacing: 2 },
  reader: { color: C.dim, fontFamily: F.displayMed, fontSize: 9.5, letterSpacing: 1.6, marginTop: 4 },
  card: { marginTop: 16, borderWidth: 1, borderColor: "rgba(0,229,242,0.4)", borderRadius: 12, padding: 16, backgroundColor: "rgba(7,11,16,0.82)" },
  cardEyebrow: { color: C.dim, fontFamily: F.displayMed, fontSize: 10, letterSpacing: 1.8 },
  prompt: { color: C.text, fontFamily: F.typedBold, fontSize: 16, lineHeight: 23, marginTop: 8, marginBottom: 6 },
  option: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderColor: C.hair, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 12, marginTop: 8, backgroundColor: "rgba(22,32,43,0.6)" },
  optionOn: { borderColor: C.cyan, backgroundColor: "rgba(0,229,242,0.12)" },
  dot: { width: 10, height: 10, borderRadius: 5, borderWidth: 1, borderColor: C.cyan },
  optionText: { color: C.dim, fontFamily: F.typed, fontSize: 14.5, flex: 1 },
  offer: { borderWidth: 1, borderRadius: 12, padding: 12, marginTop: 10, overflow: "hidden" },
  offerName: { fontFamily: F.displayMed, fontSize: 16, letterSpacing: 1.4 },
  offerSub: { color: C.dim, fontFamily: F.typed, fontSize: 11, marginTop: 1 },
});
