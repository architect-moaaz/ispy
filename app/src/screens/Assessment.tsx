import React, { useEffect, useState } from "react";
import { Text, View } from "react-native";
import type { AssessmentQuestion, AssessmentResult, Player, SkillKey } from "@ispy/shared";
import { api } from "../api";
import { C, F, factionColor } from "../theme";
import { Body, Button, Choice, Display, Dossier, Input, Kicker, Meter, Panel, Screen, Spinner, Title, Typed } from "../ui";

const SKILLS: SkillKey[] = ["observation", "reasoning", "cipher", "cooperation"];
const FACTION_NAME: Record<string, string> = { raven: "RAVEN", phantom: "PHANTOM", cipher: "CIPHER" };

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
    if (missing.length) return setErr(`${missing.length} question${missing.length > 1 ? "s" : ""} still unanswered.`);
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

  if (err && !questions && !result) return <Screen><Body style={{ color: C.stamp }}>{err}</Body></Screen>;
  if (!questions) return <Screen><Spinner /></Screen>;

  if (result) {
    return (
      <Screen>
        <Kicker color={C.amber}>The chiefs have read your file</Kicker>
        <Display>Offers</Display>
        {result.offers.length === 0 && <Body dim>No chief made an offer yet. You can retake the test later.</Body>}
        {result.offers.map((o) => {
          const col = factionColor(o.factionId);
          return (
            <Dossier key={o.factionId} tab={col}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" }}>
                <Text style={{ fontFamily: F.display, fontSize: 30, lineHeight: 30, color: col }}>{FACTION_NAME[o.factionId]}</Text>
                <Text style={{ fontFamily: F.displayMed, fontSize: 16, color: C.onPaperDim }}>{Math.round(o.fit * 100)}% fit</Text>
              </View>
              <Typed style={{ color: C.onPaperDim, marginBottom: 2 }}>From {o.chief.toUpperCase()}, {o.role === "desk" ? "for the desk" : "for the field"}</Typed>
              <Typed>{o.pitch}</Typed>
              <Button title={`Join ${FACTION_NAME[o.factionId]}`} kind="ink" onPress={() => accept(o.factionId)} loading={busy} />
            </Dossier>
          );
        })}
        <Panel>
          <Kicker>What they saw</Kicker>
          {SKILLS.map((k) => (
            <View key={k}>
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Body style={{ marginBottom: 2 }}>{k}</Body>
                <Text style={{ color: C.dim, fontFamily: F.displayMed, fontSize: 16 }}>{Math.round(result.skills[k] * 100)}</Text>
              </View>
              <Meter value={result.skills[k]} />
            </View>
          ))}
        </Panel>
        {err && <Body style={{ color: C.stamp }}>{err}</Body>}
      </Screen>
    );
  }

  return (
    <Screen>
      <Kicker color={C.amber}>Aptitude test</Kicker>
      <Display>Prove it</Display>
      <Body dim>Six questions. The chiefs read everything, including how long you took.</Body>
      {questions.map((q, i) => (
        <Dossier key={q.id} tab={C.paper2}>
          <Text style={{ fontFamily: F.displayMed, fontSize: 15, color: C.onPaperDim, marginBottom: 2 }}>
            {i + 1} of {questions.length}. {q.skill}
          </Text>
          <Typed bold>{q.prompt}</Typed>
          {q.kind === "choice" && q.options ? (
            q.options.map((opt) => (
              <Choice key={opt} label={opt} onPaper on={answers[q.id] === opt} onPress={() => setAnswers((a) => ({ ...a, [q.id]: opt }))} />
            ))
          ) : (
            <Input onPaper value={answers[q.id] ?? ""} onChangeText={(t) => setAnswers((a) => ({ ...a, [q.id]: t }))} placeholder="Your answer" autoCapitalize="none" />
          )}
        </Dossier>
      ))}
      {err && <Body style={{ color: C.stamp }}>{err}</Body>}
      <Button title="Send to the chiefs" onPress={submit} loading={busy} />
      <Title> </Title>
    </Screen>
  );
}
