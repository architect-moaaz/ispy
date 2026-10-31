import React, { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import type { Mode, Presence } from "@ispy/shared";
import { api } from "../api";
import { currentFix } from "../location";
import { C, F } from "../theme";
import { Body, Button, Display, Dossier, Kicker, Screen } from "../ui";
import { DevPanel } from "./DevPanel";
import { Desk } from "./Desk";
import { SpyVision } from "./SpyVision";

export function Duty({ presence, devSim, onPresence, onHQ, onBoard, codename, factionId, rank, xp }: { presence: Presence | null; devSim: boolean; onPresence: (p: Presence | null) => void; onHQ: () => void; onBoard: () => void; codename: string; factionId: string | null; rank: string; xp: number }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const onDuty = !!presence && new Date(presence.expiresAt).getTime() > now;
  const checking = useRef(false);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);
  // Map first: once past the first desk win, opening the app puts you in the field without a button.
  const autoTried = useRef(false);
  useEffect(() => {
    if (autoTried.current || onDuty || xp <= 0) return;
    autoTried.current = true;
    void checkIn("field");
  }, [onDuty, xp]);

  const checkIn = async (m: Mode) => {
    if (checking.current) return;
    checking.current = true;
    setBusy(true); setErr(null);
    try {
      if (m === "desk") onPresence(await api.checkIn({ mode: "desk" }));
      else {
        const f = await currentFix();
        onPresence(await api.checkIn({ mode: "field", lat: f.lat, lng: f.lng, accuracyM: f.accuracyM, mock: f.mock, sim: f.sim }));
      }
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); checking.current = false; }
  };
  const checkOut = async () => {
    setBusy(true);
    try { await api.checkOut(); onPresence(null); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  if (onDuty && presence!.mode === "field") return <SpyVision presence={presence!} devSim={devSim} onHQ={onHQ} onBoard={onBoard} onOffDuty={checkOut} codename={codename} factionId={factionId} rank={rank} />;
  if (onDuty && presence!.mode === "desk") return <Desk onOffDuty={checkOut} />;

  // A recruit's first assignment is the desk: a real cipher, a first win and a rank before any location permission.
  const rookie = xp <= 0;
  const field = (
    <Dossier tab={rookie ? C.cyanDim : C.cyan}>
      <Text style={{ fontFamily: F.displayMed, fontSize: 22, color: C.cyan, letterSpacing: 1.5 }}>FIELD OPS</Text>
      <Body dim>{rookie ? "After your first desk win. Your first field order will be the nearest site, a short walk." : "Reads your location once to find your sector, then only while a mission is live. Daylight, public places."}</Body>
      <Button title="Deploy to the field" kind={rookie ? "ghost" : undefined} onPress={() => checkIn("field")} loading={busy} />
    </Dossier>
  );
  const desk = (
    <Dossier tab={rookie ? C.cyan : C.cyanDim}>
      <Text style={{ fontFamily: F.displayMed, fontSize: 22, color: C.cyan, letterSpacing: 1.5 }}>{rookie ? "FIRST ASSIGNMENT · INTEL DESK" : "INTEL DESK"}</Text>
      <Body dim>{rookie ? "Your chief wants to see how you think before you walk. Break one intercept. No location needed." : "No location. Ciphers and analysis that a field operative is waiting on right now."}</Body>
      <Button title={rookie ? "Take the first intercept" : "Deploy to the intel desk"} kind={rookie ? undefined : "ghost"} onPress={() => checkIn("desk")} loading={busy} />
    </Dossier>
  );
  if (busy && xp > 0 && !err) return <Screen><Display>Deploying</Display><Kicker>Finding your sector</Kicker><Body dim>Reading your position once. The map opens with everything near you: caches to spin, signals to capture, and your chief's orders as pins.</Body></Screen>;
  return (
    <Screen>
      {devSim && <DevPanel />}
      <Display>Mission control</Display>
      <Kicker>{rookie ? "Clearance granted · first assignment" : "Awaiting deployment"}</Kicker>
      <Body dim>Field operatives walk to real targets on the satellite map. Intel analysts crack the codes that unlock them. Both climb the same ladder.</Body>
      {rookie ? <>{desk}{field}</> : <>{field}{desk}</>}
      {err && <Body style={{ color: C.red }}>{err}</Body>}
    </Screen>
  );
}
