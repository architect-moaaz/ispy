import React, { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import type { MissionSummary, Mode, OfferCard, Presence } from "@ispy/shared";
import { api } from "../api";
import { currentFix, getSimFix } from "../location";
import { C, F } from "../theme";
import { Body, Button, Display, Dossier, Kicker, Panel, Screen, Stamp, Typed, fmtCountdown } from "../ui";
import { DevPanel } from "./DevPanel";
import { Desk } from "./Desk";
import { Mission } from "./Mission";

const TEMPLATE_NAME: Record<string, string> = {
  RECON: "Reconnaissance", DEAD_DROP: "Dead drop", EXTRACTION: "Extraction", ANALYSIS: "Analysis", CIPHER: "Cipher",
};

export function Duty({ presence, devSim, onPresence }: { presence: Presence | null; devSim: boolean; onPresence: (p: Presence | null) => void }) {
  const [offers, setOffers] = useState<OfferCard[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [mission, setMission] = useState<MissionSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const onDuty = !!presence && new Date(presence.expiresAt).getTime() > now;
  const mode = presence?.mode;
  const checking = useRef(false);

  // Resume an active field mission after a reload.
  useEffect(() => {
    if (onDuty && mode === "field" && !mission) api.activeMission().then((r) => r.mission && setMission(r.mission)).catch(() => {});
  }, [onDuty, mode]);

  // Poll offers every 5 s and heartbeat every 2 min while on field duty.
  useEffect(() => {
    if (!onDuty || mode !== "field" || mission) return;
    let alive = true;
    const poll = async () => {
      try {
        const r = await api.offers();
        if (alive) { setOffers(r.offers); setNotice(r.notice ?? null); }
      } catch (e: any) {
        if (alive && e.status !== 401) setErr(e.message);
      }
    };
    poll();
    const p = setInterval(poll, 5000);
    const hb = setInterval(async () => {
      try {
        const f = getSimFix() ?? (await currentFix());
        onPresence(await api.heartbeat({ lat: f.lat, lng: f.lng, sim: f.sim }));
      } catch { /* the server expires presence on its own */ }
    }, 120000);
    return () => { alive = false; clearInterval(p); clearInterval(hb); };
  }, [onDuty, mode, mission?.id]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const checkIn = async (m: Mode) => {
    if (checking.current) return;
    checking.current = true;
    setBusy(true);
    setErr(null);
    try {
      if (m === "desk") onPresence(await api.checkIn({ mode: "desk" }));
      else {
        const f = await currentFix();
        onPresence(await api.checkIn({ mode: "field", lat: f.lat, lng: f.lng, accuracyM: f.accuracyM, mock: f.mock, sim: f.sim }));
      }
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
      checking.current = false;
    }
  };

  const checkOut = async () => {
    setBusy(true);
    try { await api.checkOut(); onPresence(null); setOffers([]); }
    catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const accept = async (o: OfferCard) => {
    setBusy(true);
    setErr(null);
    try { const r = await api.acceptMission(o.offerId); setMission(r.mission); setOffers([]); }
    catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  };
  const decline = async (o: OfferCard) => {
    setOffers((os) => os.filter((x) => x.offerId !== o.offerId));
    try { await api.declineMission(o.offerId); } catch { /* the server expires it anyway */ }
  };

  if (mission) return <Mission mission={mission} devSim={devSim} onDone={() => { setMission(null); setOffers([]); }} />;
  if (onDuty && mode === "desk") return <Desk onOffDuty={checkOut} />;

  if (!onDuty) {
    return (
      <Screen>
        {devSim && <DevPanel />}
        <Kicker color={C.amber}>Off duty</Kicker>
        <Display>Report in</Display>
        <Body dim>Field agents walk to real places. Desk agents crack the codes that let them in. Both climb the same ladder.</Body>
        <Panel>
          <Text style={{ fontFamily: F.display, fontSize: 24, color: C.text }}>Field</Text>
          <Body dim>Reads your location once to find your area, then only while a mission is live. Daylight, public places.</Body>
          <Button title="Go on duty in the field" onPress={() => checkIn("field")} loading={busy} />
        </Panel>
        <Panel>
          <Text style={{ fontFamily: F.display, fontSize: 24, color: C.text }}>Desk</Text>
          <Body dim>No location. Ciphers and analysis that a field agent is waiting on right now.</Body>
          <Button title="Go on duty at the desk" kind="ghost" onPress={() => checkIn("desk")} loading={busy} />
        </Panel>
        {err && <Body style={{ color: C.stamp }}>{err}</Body>}
      </Screen>
    );
  }

  return (
    <Screen>
      {devSim && <DevPanel />}
      <Kicker color={C.amber}>
        On duty in {presence?.areaName ?? "no approved area"}, {fmtCountdown(presence!.expiresAt, now)} left
      </Kicker>
      <Display>Orders</Display>
      {!presence?.areaId && <Body style={{ color: C.amber }}>You are outside every approved area. Walk into one to receive orders.</Body>}
      {offers.length === 0 && presence?.areaId && (
        <Panel>
          <Body dim>{notice ?? "Your chief is choosing. Orders land within seconds when the area has open targets."}</Body>
        </Panel>
      )}
      {offers.map((o) => (
        <Dossier key={o.offerId} tab={o.mission.contested ? C.stamp : C.amber}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: F.display, fontSize: 28, lineHeight: 28, color: C.onPaper }}>{TEMPLATE_NAME[o.mission.templateId] ?? o.mission.title}</Text>
              <Text style={{ fontFamily: F.displayMed, fontSize: 15, color: C.onPaperDim, marginBottom: 6 }}>
                {o.mission.targetName ?? "Target withheld"}{o.mission.walkM != null ? `, about ${Math.round(o.mission.walkM)} m` : ""}
              </Text>
            </View>
            <View style={{ alignItems: "flex-end" }}>
              <Text style={{ fontFamily: F.display, fontSize: 24, lineHeight: 24, color: C.onPaper }}>{o.mission.rewardXp}</Text>
              <Text style={{ fontFamily: F.displayMed, fontSize: 13, color: C.onPaperDim }}>XP</Text>
            </View>
          </View>
          {o.mission.contested && <Stamp text="Contested" size={18} style={{ marginBottom: 8 }} />}
          <Typed>{o.mission.brief}</Typed>
          {o.mission.deskLink && <Typed style={{ color: C.onPaperDim }}>A desk agent will send you the code.</Typed>}
          <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
            <Button title="Accept" kind="ink" onPress={() => accept(o)} loading={busy} style={{ flex: 1 }} />
            <Button title="Pass" kind="paperGhost" onPress={() => decline(o)} style={{ flex: 1 }} />
          </View>
          <Text style={{ fontFamily: F.typed, fontSize: 12, color: C.onPaperDim, marginTop: 8 }}>Expires in {fmtCountdown(o.acceptBy, now)}</Text>
        </Dossier>
      ))}
      {err && <Body style={{ color: C.stamp }}>{err}</Body>}
      <Button title="Go off duty" kind="ghost" onPress={checkOut} disabled={busy} />
    </Screen>
  );
}
