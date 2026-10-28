import React, { useEffect, useState } from "react";
import { Text, View } from "react-native";
import type { MissionSummary, NavigateResponse, ScanResponse } from "@ispy/shared";
import { api } from "../api";
import { bearingDeg, currentFix, distanceM, Fix, watchFix } from "../location";
import { C, mono } from "../theme";
import { Button, Card, H1, Input, Label, P, Screen, Spinner, fmtCountdown } from "../ui";
import { Radar } from "./Radar";
import { DevPanel } from "./DevPanel";

export function Mission({
  mission,
  devSim,
  onDone,
}: {
  mission: MissionSummary;
  devSim: boolean;
  onDone: () => void;
}) {
  const [nav, setNav] = useState<NavigateResponse | null>(null);
  const [fix, setFix] = useState<Fix | null>(null);
  const [locErr, setLocErr] = useState<string | null>(null);
  const [scan, setScan] = useState<ScanResponse | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  const loadNav = () => api.navigate(mission.id).then(setNav).catch((e) => setErr(e.message));

  useEffect(() => {
    loadNav();
    const stop = watchFix(setFix, (e) => setLocErr(e.message));
    const t = setInterval(() => setNow(Date.now()), 1000);
    // Re-check the lock while waiting on a desk agent.
    const poll = setInterval(() => {
      if (!nav || !nav.unlocked) loadNav();
    }, 8000);
    return () => {
      stop();
      clearInterval(t);
      clearInterval(poll);
    };
  }, [mission.id]);

  const dist = fix && nav ? distanceM(fix, nav) : null;
  const bearing = fix && nav ? bearingDeg(fix, nav) : null;

  const doScan = async (onSiteCode?: string) => {
    setBusy(true);
    setErr(null);
    try {
      const f = fix ?? (await currentFix());
      const r = await api.scan(mission.id, { ...f, onSiteCode });
      setScan(r);
      if (r.result === "verified") {
        // let the player read the debrief, then return to duty
      }
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const abandon = async () => {
    setBusy(true);
    try {
      await api.abandon(mission.id);
      onDone();
    } catch (e: any) {
      setErr(e.message);
      setBusy(false);
    }
  };

  if (scan?.result === "verified") {
    return (
      <Screen>
        <Label>Mission complete</Label>
        <H1>Verified</H1>
        <Card style={{ borderColor: C.accent }}>
          {scan.reward && (
            <Text style={{ color: C.accent, fontSize: 20, fontWeight: "700", ...mono }}>
              +{scan.reward.xp} XP · trust {scan.reward.trust >= 0 ? "+" : ""}{scan.reward.trust}
              {scan.reward.contestOutcome ? ` · contest ${scan.reward.contestOutcome}` : ""}
            </Text>
          )}
          {scan.debrief && <P style={{ marginTop: 8 }}>{scan.debrief}</P>}
        </Card>
        <Button title="Back to duty" onPress={onDone} />
      </Screen>
    );
  }

  return (
    <Screen>
      {devSim && <DevPanel />}
      <Label>
        {mission.templateId.replace("_", " ")} · {mission.contested ? "contested · " : ""}expires in {fmtCountdown(mission.expiresAt, now)}
      </Label>
      <H1>{mission.title}</H1>
      <P dim>{mission.brief}</P>
      {!nav ? (
        <Spinner />
      ) : (
        <>
          <Card>
            <Label>Destination</Label>
            <Text style={{ color: C.text, fontSize: 17, fontWeight: "700", marginBottom: 4, ...mono }}>{nav.targetName}</Text>
            <P dim>{nav.hint}</P>
            {!nav.unlocked && (
              <View style={{ borderColor: C.warn, borderWidth: 1, borderRadius: 8, padding: 10, marginTop: 6 }}>
                <Text style={{ color: C.warn, fontWeight: "700", ...mono }}>LOCKED · waiting for desk agent</Text>
                <Text style={{ color: C.dim, fontSize: 13, marginTop: 4 }}>
                  Start walking. The marker unlocks when your analyst cracks the cipher
                  {mission.deskLink ? `, or at ${new Date(mission.deskLink.fallbackAt).toLocaleTimeString()} you get a solo version` : ""}.
                </Text>
              </View>
            )}
          </Card>
          <Radar bearing={bearing} distanceM={dist} approachRadiusM={nav.approachRadiusM} locked={!nav.unlocked} />
          {locErr && !fix && <P style={{ color: C.danger }}>{locErr}</P>}
          <Card>
            <Label>Steps</Label>
            {nav.steps.map((s, i) => (
              <Text key={i} style={{ color: C.text, marginBottom: 4 }}>{i + 1}. {s}</Text>
            ))}
          </Card>

          {scan?.result === "needs_code" && (
            <Card style={{ borderColor: C.info }}>
              <Label>On-site check</Label>
              <P>{scan.puzzle?.prompt}</P>
              <Input value={code} onChangeText={setCode} placeholder="Code" autoCapitalize="none" autoCorrect={false} />
              <Button title="Submit code" onPress={() => doScan(code)} loading={busy} />
            </Card>
          )}
          {scan?.result === "too_far" && (
            <P style={{ color: C.warn }}>Too far: {Math.round(scan.distanceM ?? 0)} m from the target. Get within {nav.approachRadiusM} m.</P>
          )}
          {(scan?.result === "rejected" || scan?.result === "flagged") && (
            <P style={{ color: scan.result === "rejected" ? C.danger : C.warn }}>
              {scan.result === "rejected" ? "Scan rejected" : "Scan flagged"}{scan.reason ? `: ${scan.reason}` : "."}
              {scan.trustScore != null ? ` (trust score ${scan.trustScore.toFixed(2)})` : ""}
            </P>
          )}
          {err && <P style={{ color: C.danger }}>{err}</P>}

          {scan?.result !== "needs_code" && (
            <Button
              title={dist != null && dist <= nav.approachRadiusM ? "Scan target" : "Scan (get closer)"}
              onPress={() => doScan()}
              loading={busy}
              disabled={!nav.unlocked}
            />
          )}
          <Button title="Abandon mission" kind="ghost" onPress={abandon} disabled={busy} />
        </>
      )}
    </Screen>
  );
}
