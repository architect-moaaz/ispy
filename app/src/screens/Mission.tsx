import React, { useEffect, useState } from "react";
import { Text, View } from "react-native";
import type { MissionSummary, NavigateResponse, ScanResponse } from "@ispy/shared";
import { api } from "../api";
import { bearingDeg, currentFix, distanceM, Fix, watchFix } from "../location";
import { C, F } from "../theme";
import { Body, Button, Display, Dossier, Input, Kicker, Panel, Screen, Spinner, Stamp, Typed, fmtCountdown } from "../ui";
import { Radar } from "./Radar";
import { DevPanel } from "./DevPanel";

export function Mission({ mission, devSim, onDone }: { mission: MissionSummary; devSim: boolean; onDone: () => void }) {
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
    const poll = setInterval(() => { if (!nav || !nav.unlocked) loadNav(); }, 8000); // re-check the lock
    return () => { stop(); clearInterval(t); clearInterval(poll); };
  }, [mission.id]);

  const dist = fix && nav ? distanceM(fix, nav) : null;
  const bearing = fix && nav ? bearingDeg(fix, nav) : null;
  const onSite = dist != null && nav != null && dist <= nav.approachRadiusM;

  const doScan = async (onSiteCode?: string) => {
    setBusy(true);
    setErr(null);
    try {
      const f = fix ?? (await currentFix());
      const r = await api.scan(mission.id, { ...f, onSiteCode });
      setScan(r);
      if (r.result === "verified" && !r.reward) { setTimeout(loadNav, 400); setCode(""); } // extraction leg: keep going
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const abandon = async () => {
    setBusy(true);
    try { await api.abandon(mission.id); onDone(); }
    catch (e: any) { setErr(e.message); setBusy(false); }
  };

  if (scan?.result === "verified" && scan.reward) {
    const r = scan.reward;
    return (
      <Screen>
        <View style={{ height: 24 }} />
        <Dossier tab={r.contestOutcome === "lost" ? C.onPaperDim : C.ok}>
          <Text style={{ fontFamily: F.display, fontSize: 30, lineHeight: 30, color: C.onPaper }}>{mission.title}</Text>
          <Typed style={{ color: C.onPaperDim }}>{nav?.targetName}</Typed>
          <View style={{ alignItems: "center", marginVertical: 14 }}>
            <Stamp text={r.contestOutcome === "lost" ? "Outrun" : r.contestOutcome === "won" ? "First in" : "Verified"} size={44} color={r.contestOutcome === "lost" ? C.onPaperDim : C.stamp} />
          </View>
          <Typed>{scan.debrief}</Typed>
          <View style={{ flexDirection: "row", gap: 24, marginTop: 6 }}>
            <View>
              <Text style={{ fontFamily: F.display, fontSize: 40, lineHeight: 40, color: C.onPaper }}>+{r.xp}</Text>
              <Text style={{ fontFamily: F.displayMed, fontSize: 14, color: C.onPaperDim }}>XP</Text>
            </View>
            <View>
              <Text style={{ fontFamily: F.display, fontSize: 40, lineHeight: 40, color: C.onPaper }}>{r.trust >= 0 ? "+" : ""}{r.trust}</Text>
              <Text style={{ fontFamily: F.displayMed, fontSize: 14, color: C.onPaperDim }}>trust</Text>
            </View>
          </View>
        </Dossier>
        <Button title="Back on duty" onPress={onDone} />
      </Screen>
    );
  }

  return (
    <Screen>
      {devSim && <DevPanel />}
      <Kicker color={C.amber}>{mission.contested ? "Contested. " : ""}Expires in {fmtCountdown(mission.expiresAt, now)}</Kicker>
      <Display size={40}>{nav?.targetName ?? mission.title}</Display>
      {!nav ? <Spinner /> : (
        <>
          <Radar bearing={bearing} distanceM={dist} approachRadiusM={nav.approachRadiusM} locked={!nav.unlocked} />
          {locErr && !fix && <Body style={{ color: C.stamp }}>{locErr}</Body>}

          {scan?.result === "needs_code" ? (
            <Dossier tab={C.stamp}>
              <Text style={{ fontFamily: F.display, fontSize: 22, color: C.onPaper }}>On site</Text>
              <Typed>{scan.puzzle?.prompt}</Typed>
              {scan.reason && <Typed style={{ color: C.stamp }}>{scan.reason}</Typed>}
              <Input onPaper value={code} onChangeText={setCode} placeholder="Answer" autoCapitalize="characters" autoCorrect={false} onSubmitEditing={() => doScan(code)} />
              <Button title="Confirm" kind="ink" onPress={() => doScan(code)} loading={busy} />
            </Dossier>
          ) : (
            <Button title={onSite ? "Scan the site" : nav.unlocked ? "Scan when you arrive" : "Locked by the desk"} onPress={() => doScan()} loading={busy} disabled={!nav.unlocked || !onSite} />
          )}
          {scan?.result === "too_far" && <Body style={{ color: C.amber }}>Still {Math.round(scan.distanceM ?? 0)} m out. Get within {nav.approachRadiusM} m.</Body>}
          {(scan?.result === "rejected" || scan?.result === "flagged") && (
            <Body style={{ color: C.stamp }}>{scan.reason ?? "That scan could not be verified."}</Body>
          )}
          {scan?.result === "verified" && !scan.reward && <Body style={{ color: C.ok }}>{scan.debrief}</Body>}
          {err && <Body style={{ color: C.stamp }}>{err}</Body>}

          <Dossier tab={nav.unlocked ? C.amber : C.onPaperDim} style={{ marginTop: 14 }}>
            <Text style={{ fontFamily: F.display, fontSize: 22, color: C.onPaper }}>{mission.title}</Text>
            <Typed>{mission.brief}</Typed>
            {nav.steps.map((st, i) => (
              <Typed key={i} style={{ marginBottom: 2 }}>{i + 1}. {st}</Typed>
            ))}
            {!nav.unlocked && (
              <View style={{ marginTop: 10, borderTopWidth: 1, borderTopColor: C.paper2, paddingTop: 8 }}>
                <Typed bold>Locked. Start walking.</Typed>
                <Typed style={{ color: C.onPaperDim }}>
                  The site opens when your desk agent cracks the cipher
                  {mission.deskLink?.fallbackAt ? `, or at ${new Date(mission.deskLink.fallbackAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} you get a solo version` : ""}.
                </Typed>
              </View>
            )}
          </Dossier>
          <Panel style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Body dim style={{ marginBottom: 0, flex: 1 }}>{nav.hint}</Body>
            <Button title="Abandon" kind="ghost" onPress={abandon} disabled={busy} style={{ marginTop: 0, paddingVertical: 8 }} />
          </Panel>
        </>
      )}
    </Screen>
  );
}
