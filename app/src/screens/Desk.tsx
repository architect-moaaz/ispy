import React, { useEffect, useState } from "react";
import { Text, View, Image } from "react-native";
import type { DeskMissionDetail, DeskSubmitResponse } from "@ispy/shared";
import { api } from "../api";
import { ART } from "../art";
import { onLive } from "../live";
import { C, F } from "../theme";
import { Body, Button, Choice, Display, Dossier, Input, Kicker, Panel, Screen, Spinner, Stamp, Typed, fmtCountdown } from "../ui";

export function Desk({ onOffDuty }: { onOffDuty: () => void }) {
  const [kitOpen, setKitOpen] = useState(false);
  const [keyHint, setKeyHint] = useState<string | null>(null);
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
            <Image source={ART.mission[detail.mission.templateId] ?? ART.mission.CIPHER} style={{ width: "100%", height: 150, marginBottom: 10, borderWidth: 1, borderColor: C.line }} resizeMode="cover" />
            <Typed bold style={{ marginBottom: 0 }}>{detail.puzzle.prompt}</Typed>
            {detail.puzzle.system && <Typed onPaper style={{ marginTop: 6, opacity: 0.7 }}>System: {detail.puzzle.system}. Work it on paper; the answer is checked exactly.</Typed>}
            <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
              <Button title={kitOpen ? "Close cipher kit" : "Cipher kit"} kind="ink" onPress={() => setKitOpen((v) => !v)} style={{ flex: 1, marginTop: 0, paddingVertical: 8 }} />
              <Button title="Use a key" kind="ink" onPress={async () => { try { const r = await api.useTool("key", { missionId: detail.mission.id }); setKeyHint(r.ok ? r.hint ?? "" : r.reason ?? "No key."); } catch (e: any) { setKeyHint(e.message); } }} style={{ flex: 1, marginTop: 0, paddingVertical: 8 }} />
            </View>
            {keyHint && <Typed bold style={{ marginTop: 8 }}>KEY · {keyHint}</Typed>}
            {kitOpen && (
              <View style={{ marginTop: 8 }}>
                <Typed bold>LETTER INDEX (A=0 … Z=25)</Typed>
                <Typed style={{ fontSize: 11 }}>{"ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((c, i) => `${c}${i}`).join(" ")}</Typed>
                <Typed bold style={{ marginTop: 6 }}>MIRROR (ATBASH)</Typed>
                <Typed style={{ fontSize: 11 }}>{"ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((c) => `${c}↔${String.fromCharCode(90 - (c.charCodeAt(0) - 65))}`).slice(0, 13).join("  ")}</Typed>
                <Typed bold style={{ marginTop: 6 }}>MORSE</Typed>
                <Typed style={{ fontSize: 11 }}>{Object.entries({ A: ".-", B: "-...", C: "-.-.", D: "-..", E: ".", F: "..-.", G: "--.", H: "....", I: "..", J: ".---", K: "-.-", L: ".-..", M: "--", N: "-.", O: "---", P: ".--.", Q: "--.-", R: ".-.", S: "...", T: "-", U: "..-", V: "...-", W: ".--", X: "-..-", Y: "-.--", Z: "--.." }).map(([k, v]) => `${k} ${v}`).join("   ")}</Typed>
                <Typed bold style={{ marginTop: 6 }}>POLYBIUS (row, column; I and J share 24)</Typed>
                <Typed style={{ fontSize: 11 }}>{"ABCDE FGHIK LMNOP QRSTU VWXYZ".split(" ").map((row, r) => `${r + 1}: ${row.split("").map((c, i) => `${c}${r + 1}${i + 1}`).join(" ")}`).join("\n")}</Typed>
                <Typed bold style={{ marginTop: 6 }}>VIGENÈRE</Typed>
                <Typed style={{ fontSize: 11 }}>Plain = (cipher − key letter) mod 26. Write the key under the message, repeating; subtract letter indices.</Typed>
                <Typed bold style={{ marginTop: 6 }}>RAIL FENCE (3 rails)</Typed>
                <Typed style={{ fontSize: 11 }}>Count the letters, mark the zigzag positions 1-2-3-2-1-2-3…, fill rail 1 first from the ciphertext, then rail 2, then rail 3, read the zigzag.</Typed>
              </View>
            )}
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
