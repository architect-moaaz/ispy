import React, { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import type { MissionSummary, Mode, OfferCard, Presence } from "@ispy/shared";
import { api } from "../api";
import { currentFix, getSimFix } from "../location";
import { C, mono } from "../theme";
import { Button, Card, H1, Label, P, Screen, fmtCountdown } from "../ui";
import { DevPanel } from "./DevPanel";
import { Desk } from "./Desk";
import { Mission } from "./Mission";

export function Duty({
  presence,
  devSim,
  onPresence,
}: {
  presence: Presence | null;
  devSim: boolean;
  onPresence: (p: Presence | null) => void;
}) {
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
        const sim = getSimFix();
        const f = sim ?? (await currentFix());
        onPresence(await api.heartbeat({ lat: f.lat, lng: f.lng, sim: f.sim }));
      } catch {
        // keep polling; the server expires presence on its own
      }
    }, 120000);
    return () => {
      alive = false;
      clearInterval(p);
      clearInterval(hb);
    };
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
      if (m === "desk") {
        onPresence(await api.checkIn({ mode: "desk" }));
      } else {
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
    try {
      await api.checkOut();
      onPresence(null);
      setOffers([]);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const accept = async (o: OfferCard) => {
    setBusy(true);
    setErr(null);
    try {
      const r = await api.acceptMission(o.offerId);
      setMission(r.mission);
      setOffers([]);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  const decline = async (o: OfferCard) => {
    setOffers((os) => os.filter((x) => x.offerId !== o.offerId));
    try {
      await api.declineMission(o.offerId);
    } catch {
      // the server expires it anyway
    }
  };

  if (mission) {
    return (
      <Mission
        mission={mission}
        devSim={devSim}
        onDone={() => {
          setMission(null);
          setOffers([]);
        }}
      />
    );
  }

  if (onDuty && mode === "desk") return <Desk onOffDuty={checkOut} />;

  if (!onDuty) {
    return (
      <Screen>
        {devSim && <DevPanel />}
        <Label>Off duty</Label>
        <H1>Report for duty</H1>
        <P dim>
          Field agents walk to real targets in their area. Desk agents crack the codes that unlock them. Both earn
          rank.
        </P>
        <Card>
          <Label>Field</Label>
          <P>Uses your location once to find your area, then while a mission is active. Daylight, public places only.</P>
          <Button title="Go on duty · Field" onPress={() => checkIn("field")} loading={busy} />
        </Card>
        <Card>
          <Label>Desk</Label>
          <P>No location needed. You get ciphers and analysis that field agents are waiting on.</P>
          <Button title="Go on duty · Desk" kind="ghost" onPress={() => checkIn("desk")} loading={busy} />
        </Card>
        {err && <P style={{ color: C.danger }}>{err}</P>}
      </Screen>
    );
  }

  return (
    <Screen>
      {devSim && <DevPanel />}
      <Label>
        Field · on duty in {presence?.areaName ?? "no approved area"} · {fmtCountdown(presence!.expiresAt, now)}
      </Label>
      <H1>Orders</H1>
      {!presence?.areaId && (
        <P style={{ color: C.warn }}>You are outside every approved area. Move into one to receive field orders.</P>
      )}
      {offers.length === 0 && presence?.areaId && (
        <Card>
          <P dim>{notice ?? "Waiting for your chief. Offers arrive within seconds when the area has open targets."}</P>
        </Card>
      )}
      {offers.map((o) => (
        <Card key={o.offerId} style={{ borderColor: o.mission.contested ? C.warn : C.line }}>
          <Label>
            {o.mission.templateId.replace("_", " ")} · {o.mission.rewardXp} XP · accept in {fmtCountdown(o.acceptBy, now)}
          </Label>
          <Text style={{ color: C.text, fontSize: 17, fontWeight: "700", marginBottom: 4, ...mono }}>{o.mission.title}</Text>
          <P dim>{o.mission.brief}</P>
          <Text style={{ color: C.dim, fontSize: 13, ...mono }}>
            {o.mission.targetName ?? "target undisclosed"}
            {o.mission.walkM != null ? ` · ~${Math.round(o.mission.walkM)} m walk` : ""}
            {o.mission.contested ? " · rival activity expected" : ""}
            {o.mission.deskLink ? " · needs a desk agent" : ""}
          </Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Button title="Accept" onPress={() => accept(o)} loading={busy} style={{ flex: 1 }} />
            <Button title="Decline" kind="ghost" onPress={() => decline(o)} style={{ flex: 1 }} />
          </View>
        </Card>
      ))}
      {err && <P style={{ color: C.danger }}>{err}</P>}
      <Button title="Go off duty" kind="ghost" onPress={checkOut} disabled={busy} />
    </Screen>
  );
}
