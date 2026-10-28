import React, { useEffect, useState } from "react";
import { Pressable, Text } from "react-native";
import type { DeskMissionDetail, DeskSubmitResponse } from "@ispy/shared";
import { api } from "../api";
import { C, mono } from "../theme";
import { Button, Card, H1, Input, Label, P, Screen, Spinner, fmtCountdown } from "../ui";

export function Desk({ onOffDuty }: { onOffDuty: () => void }) {
  const [detail, setDetail] = useState<DeskMissionDetail | null | undefined>(undefined);
  const [answer, setAnswer] = useState("");
  const [result, setResult] = useState<DeskSubmitResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  const load = async () => {
    try {
      const r = await api.deskActive();
      setDetail("puzzle" in r ? r : null);
    } catch (e: any) {
      setErr(e.message);
    }
  };

  useEffect(() => {
    load();
    const poll = setInterval(() => {
      if (!detail) load();
    }, 5000);
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(t);
    };
  }, [detail?.mission.id]);

  const submit = async () => {
    if (!detail || !answer.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await api.deskSubmit(detail.mission.id, answer.trim());
      setResult(r);
      if (r.correct) {
        setAnswer("");
      }
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const next = () => {
    setResult(null);
    setAnswer("");
    setDetail(undefined);
    load();
  };

  return (
    <Screen>
      <Label>Desk · on duty</Label>
      <H1>Analyst station</H1>
      {detail === undefined && <Spinner />}
      {detail === null && (
        <Card>
          <P dim>No desk work right now. Field agents in your area generate it; stay on duty.</P>
        </Card>
      )}
      {detail && (
        <Card style={{ borderColor: C.info }}>
          <Label>
            {detail.puzzle.kind} · {detail.mission.rewardXp} XP · expires in {fmtCountdown(detail.mission.expiresAt, now)}
          </Label>
          <Text style={{ color: C.text, fontSize: 17, fontWeight: "700", marginBottom: 6, ...mono }}>{detail.mission.title}</Text>
          <P dim>{detail.mission.brief}</P>
          {detail.linkedFieldAgent && <P dim>Field agent waiting: {detail.linkedFieldAgent}</P>}
          <Text style={{ color: C.text, marginBottom: 8, ...mono }}>{detail.puzzle.prompt}</Text>
          {result?.correct ? (
            <>
              <Text style={{ color: C.accent, fontWeight: "700", ...mono }}>
                Correct. +{result.reward?.xp ?? 0} XP{result.unlockedFor ? ` · unlocked for ${result.unlockedFor}` : ""}
              </Text>
              {result.debrief && <P style={{ marginTop: 6 }}>{result.debrief}</P>}
              <Button title="Next assignment" onPress={next} />
            </>
          ) : (
            <>
              {detail.puzzle.options ? (
                detail.puzzle.options.map((o) => (
                  <Pressable
                    key={o}
                    onPress={() => setAnswer(o)}
                    style={{
                      padding: 10,
                      borderRadius: 8,
                      borderWidth: 1,
                      borderColor: answer === o ? C.accent : C.line,
                      backgroundColor: answer === o ? "#12302a" : C.panel2,
                      marginBottom: 6,
                    }}
                  >
                    <Text style={{ color: C.text }}>{o}</Text>
                  </Pressable>
                ))
              ) : (
                <Input value={answer} onChangeText={setAnswer} placeholder="Your answer" autoCapitalize="none" autoCorrect={false} onSubmitEditing={submit} />
              )}
              {result && !result.correct && <P style={{ color: C.danger }}>Wrong. {result.debrief ?? "Try again."}</P>}
              <Button title="Submit" onPress={submit} loading={busy} />
            </>
          )}
        </Card>
      )}
      {err && <P style={{ color: C.danger }}>{err}</P>}
      <Button title="Go off duty" kind="ghost" onPress={onOffDuty} />
    </Screen>
  );
}
