import React, { useEffect, useState } from "react";
import { Text, View } from "react-native";
import type { DeskMissionDetail, DeskSubmitResponse } from "@ispy/shared";
import { api } from "../api";
import { onLive } from "../live";
import { C, F } from "../theme";
import { Body, Button, Choice, Display, Dossier, Input, Kicker, Panel, Screen, Spinner, Stamp, Typed, fmtCountdown } from "../ui";

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
    const poll = setInterval(() => { if (!detail) load(); }, 20000);
    const t = setInterval(() => setNow(Date.now()), 1000);
    const off = onLive((ty) => { if (ty === "mission.offered" || ty === "mission.accepted" || ty === "mission.expired") load(); });
    return () => { clearInterval(poll); clearInterval(t); off(); };
  }, [detail?.mission.id]);

  const submit = async () => {
    if (!detail || !answer.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await api.deskSubmit(detail.mission.id, answer.trim());
      setResult(r);
      if (r.correct) setAnswer("");
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const next = () => { setResult(null); setAnswer(""); setDetail(undefined); load(); };

  return (
    <Screen>
      <Kicker color={C.amber}>Intel desk · deployed</Kicker>
      <Display>Intercepts</Display>
      {detail === undefined && <Spinner />}
      {detail === null && (
        <Panel>
          <Body dim>Nothing on the wire. Field operatives in your sector generate work; stay deployed and it will come.</Body>
        </Panel>
      )}
      {detail && (
        <Dossier tab={detail.linkedFieldAgent ? C.stamp : C.amber}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
            <Text style={{ fontFamily: F.display, fontSize: 28, lineHeight: 28, color: C.onPaper, flex: 1 }}>{detail.mission.title}</Text>
            <View style={{ alignItems: "flex-end" }}>
              <Text style={{ fontFamily: F.display, fontSize: 24, lineHeight: 24, color: C.onPaper }}>{detail.mission.rewardXp}</Text>
              <Text style={{ fontFamily: F.displayMed, fontSize: 13, color: C.onPaperDim }}>XP</Text>
            </View>
          </View>
          {detail.linkedFieldAgent && <Typed bold style={{ color: C.stamp }}>{detail.linkedFieldAgent} is in the field waiting on you.</Typed>}
          <Typed style={{ color: C.onPaperDim }}>{detail.mission.brief}</Typed>
          <View style={{ backgroundColor: C.paper2, padding: 10, borderRadius: 3, marginBottom: 10 }}>
            <Typed bold style={{ marginBottom: 0 }}>{detail.puzzle.prompt}</Typed>
          </View>
          {result?.correct ? (
            <>
              <View style={{ alignItems: "center", marginVertical: 8 }}>
                <Stamp text="Cracked" size={36} />
              </View>
              <Typed>{result.debrief}{result.unlockedFor ? ` ${result.unlockedFor} can move.` : ""}</Typed>
              <Button title="Next intercept" kind="ink" onPress={next} />
            </>
          ) : (
            <>
              {detail.puzzle.options
                ? detail.puzzle.options.map((o) => <Choice key={o} label={o} onPaper on={answer === o} onPress={() => setAnswer(o)} />)
                : <Input onPaper value={answer} onChangeText={setAnswer} placeholder="Your answer" autoCapitalize="characters" autoCorrect={false} onSubmitEditing={submit} />}
              {result && !result.correct && <Typed style={{ color: C.stamp }}>{result.debrief ?? "Not it. Try again."}</Typed>}
              <Button title="Send it" kind="ink" onPress={submit} loading={busy} />
            </>
          )}
          <Text style={{ fontFamily: F.typed, fontSize: 12, color: C.onPaperDim, marginTop: 8 }}>Expires in {fmtCountdown(detail.mission.expiresAt, now)}</Text>
        </Dossier>
      )}
      {err && <Body style={{ color: C.stamp }}>{err}</Body>}
      <Button title="Stand down" kind="ghost" onPress={onOffDuty} />
    </Screen>
  );
}
