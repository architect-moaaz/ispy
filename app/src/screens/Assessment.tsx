import React, { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { AssessmentQuestion, AssessmentResult, Player, SkillKey } from "@ispy/shared";
import { api } from "../api";
import { C, factionColor, mono } from "../theme";
import { Bar, Button, Card, H1, H2, Input, Label, P, Screen, Spinner } from "../ui";

const SKILLS: SkillKey[] = ["observation", "reasoning", "cipher", "cooperation"];

export function Assessment({ onRecruited }: { onRecruited: (p: Player) => void }) {
  const [questions, setQuestions] = useState<AssessmentQuestion[] | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<AssessmentResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.assessment().then((r) => setQuestions(r.questions)).catch((e) => setErr(e.message));
  }, []);

  const submit = async () => {
    if (!questions) return;
    const missing = questions.filter((q) => !answers[q.id]?.trim());
    if (missing.length) return setErr(`Answer every question (${missing.length} left).`);
    setBusy(true);
    setErr(null);
    try {
      setResult(await api.submitAssessment({ answers }));
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const accept = async (factionId: AssessmentResult["offers"][number]["factionId"]) => {
    setBusy(true);
    try {
      const r = await api.acceptOffer(factionId);
      onRecruited(r.player);
    } catch (e: any) {
      setErr(e.message);
      setBusy(false);
    }
  };

  if (err && !questions && !result) return <Screen><P style={{ color: C.danger }}>{err}</P></Screen>;
  if (!questions) return <Screen><Spinner /></Screen>;

  if (result) {
    return (
      <Screen>
        <Label>Assessment complete</Label>
        <H1>Your profile</H1>
        <Card>
          {SKILLS.map((k) => (
            <View key={k}>
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Label>{k}</Label>
                <Text style={{ color: C.dim, ...mono }}>{Math.round(result.skills[k] * 100)}</Text>
              </View>
              <Bar value={result.skills[k]} />
            </View>
          ))}
        </Card>
        <H2>Offers</H2>
        {result.offers.length === 0 && <P dim>No chief made an offer yet. Try the assessment again later.</P>}
        {result.offers.map((o) => (
          <Card key={o.factionId} style={{ borderColor: factionColor(o.factionId) }}>
            <Label>{o.factionId.toUpperCase()} · {o.role} role · fit {Math.round(o.fit * 100)}%</Label>
            <Text style={{ color: factionColor(o.factionId), fontSize: 18, fontWeight: "700", marginBottom: 6, ...mono }}>
              {o.chief.toUpperCase()}
            </Text>
            <P>{o.pitch}</P>
            <Button title={`Join ${o.factionId.toUpperCase()}`} onPress={() => accept(o.factionId)} loading={busy} />
          </Card>
        ))}
        {err && <P style={{ color: C.danger }}>{err}</P>}
      </Screen>
    );
  }

  return (
    <Screen>
      <Label>Aptitude test</Label>
      <H1>Prove yourself</H1>
      <P dim>Short answers. The chiefs read everything.</P>
      {questions.map((q, i) => (
        <Card key={q.id}>
          <Label>{i + 1} / {questions.length} · {q.skill}</Label>
          <P>{q.prompt}</P>
          {q.kind === "choice" && q.options ? (
            q.options.map((opt) => {
              const on = answers[q.id] === opt;
              return (
                <Pressable
                  key={opt}
                  onPress={() => setAnswers((a) => ({ ...a, [q.id]: opt }))}
                  style={{
                    padding: 10,
                    borderRadius: 8,
                    borderWidth: 1,
                    borderColor: on ? C.accent : C.line,
                    backgroundColor: on ? "#12302a" : C.panel2,
                    marginBottom: 6,
                  }}
                >
                  <Text style={{ color: C.text }}>{opt}</Text>
                </Pressable>
              );
            })
          ) : (
            <Input
              value={answers[q.id] ?? ""}
              onChangeText={(t) => setAnswers((a) => ({ ...a, [q.id]: t }))}
              placeholder="Your answer"
              autoCapitalize="none"
            />
          )}
        </Card>
      ))}
      {err && <P style={{ color: C.danger }}>{err}</P>}
      <Button title="Submit to the chiefs" onPress={submit} loading={busy} />
    </Screen>
  );
}
