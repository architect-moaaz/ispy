import React, { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Animated, Dimensions, Easing, Image, Modal, StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Svg, { Circle, G, Line, Path, Polygon, Polyline, Rect } from "react-native-svg";
import type { CaptureResult, Contact, MapResponse, ToolkitResponse, MissionSummary, NavigateResponse, OfferCard, Presence, ScanResponse, SpinResult } from "@ispy/shared";
import { api } from "../api";
import { onLive } from "../live";
import { bearingDeg, currentFix, distanceM, Fix, getSimFix, watchFix, watchHeading } from "../location";
import { C, F, factionColor } from "../theme";
import { Body, Button, Dossier, Input, Screen, Stamp, Typed, fmtCountdown } from "../ui";
import { Projector, SatMap } from "../SatMap";
import { walkingRoute, fmtWalk, guide, type WalkingRoute } from "../route";
import { Guide } from "./Guide";
import { Street, type Beacon, type Scene } from "./Street";
import { ARGuide } from "./ARGuide";
import { Debrief } from "./Debrief";
import { ART } from "../art";
import { DevPanel } from "./DevPanel";
import { ARScan } from "./ARScan";
import { CaptureRitual, FieldMarkers, NearbyTracker, SelectionCard, type Selection } from "./FieldLayer";
import { BaitSheet } from "./BaitSheet";
import { type DialTool } from "./ToolDial";
import { FieldKit } from "./FieldKit";

const TEMPLATE_NAME: Record<string, string> = { RECON: "RECON", DEAD_DROP: "VIRTUAL DEAD DROP", EXTRACTION: "EXTRACTION", ANALYSIS: "ANALYSIS", CIPHER: "CIPHER" };

export function SpyVision({ presence, devSim, onHQ, onBoard, onOffDuty, codename, factionId, rank }: { presence: Presence; devSim: boolean; onHQ: () => void; onBoard: () => void; onOffDuty: () => void; codename: string; factionId: string | null; rank: string }) {
  const [ar, setAr] = useState(false);
  const width = Math.min(Dimensions.get("window").width, 560) - 28;
  const height = 460;
  const [fix, setFix] = useState<Fix | null>(getSimFix());
  const [offers, setOffers] = useState<OfferCard[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [mission, setMission] = useState<MissionSummary | null>(null);
  const [nav, setNav] = useState<NavigateResponse | null>(null);
  const [scan, setScan] = useState<ScanResponse | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [targets, setTargets] = useState<{ id: string; name: string; lat: number; lng: number }[]>([]);
  const [sector, setSector] = useState<{ lat: number; lng: number; radiusM: number } | null>(null);
  const [route, setRoute] = useState<WalkingRoute | null>(null);
  const [guiding, setGuiding] = useState(false);
  // Ambient layer: what is around you on the map, and what you have tapped.
  const [field, setField] = useState<MapResponse | null>(null);
  const [bc, setBc] = useState<{ rivals: { id: string; chief: string; burned: boolean }[]; left: number; credits: number; costs: { distraction: number; lead: number } } | null>(null);
  const loadBc = async () => { try { const o = await api.backchannel(); setBc({ rivals: o.rivals, left: o.left, credits: o.credits, costs: o.costs }); } catch { /* no faction */ } };
  const [baitSite, setBaitSite] = useState<{ id: string; name: string } | null>(null);
  const [sel, setSel] = useState<Selection | null>(null);
  const [spinResult, setSpinResult] = useState<SpinResult | null>(null);
  const [spinning, setSpinning] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [captureResult, setCaptureResult] = useState<CaptureResult | null>(null);
  const [toolMsg, setToolMsg] = useState<string | null>(null);
  const [kit, setKit] = useState<ToolkitResponse | null>(null);
  const [toolBusy, setToolBusy] = useState(false);
  const loadKit = () => api.tools().then(setKit).catch(() => {});
  useEffect(() => { loadKit(); }, []);
  useEffect(() => onLive((ty) => { if (ty === "reward" || ty === "cache.spun" || ty === "tool.crafted") loadKit(); }), []);
  const useTool = async (tool: string, body: any = {}) => { setToolBusy(true); try { const r = await api.useTool(tool, { ...body, sim: fix?.sim }); setToolMsg(r.ok ? `${tool.toUpperCase()} · ${r.hint ?? r.detail ?? "done"}` : `${tool.toUpperCase()} · ${r.reason ?? "no"}`); await Promise.all([refresh(), loadKit()]); } catch (e: any) { setToolMsg(e.message); } finally { setToolBusy(false); } };
  const [duel, setDuel] = useState<{ outcome: "won" | "lost"; rival: string; rivalFaction: string; target: string } | null>(null);
  useEffect(() => onLive((ty, data: any) => {
    if (ty === "faceoff.started") { setNotice(null); refresh(); }
    if (ty === "faceoff.resolved" && data?.outcome) { setDuel({ outcome: data.outcome, rival: data.rival, rivalFaction: data.rivalFaction, target: data.target }); refresh(); }
  }), [mission?.id]);
  const fixRef = useRef<Fix | null>(null);
  const projectRef = useRef<Projector | null>(null);
  const loadField = async (f: Fix | null) => {
    if (!f) return;
    void loadBc();
    try { const m = await api.map(f.lat, f.lng); setField(m); setSel((cur) => {
      if (!cur) return cur;
      if (cur.type === "signal") { const it = m.signals.find((x) => x.id === cur.item.id); return it ? { type: "signal", item: it } : null; }
      if (cur.type === "cache") { const it = m.caches.find((x) => x.id === cur.item.id); return it ? { type: "cache", item: it } : cur; }
      if (cur.type === "pin") { const it = m.pins.find((x) => x.offerId === cur.item.offerId); return it ? { type: "pin", item: it } : null; }
      return m.stronghold ? { type: "stronghold", item: m.stronghold } : null;
    }); } catch { /* keep the last map */ }
  };

  const refresh = async () => {
    try {
      if (mission) {
        setNav(await api.navigate(mission.id));
      } else {
        const [o, a] = await Promise.all([api.offers(), api.activeMission()]);
        setOffers(o.offers); setNotice(o.notice ?? null);
        if (a.mission) setMission(a.mission);
      }
      setContacts((await api.contacts()).contacts);
      await loadField(fixRef.current);
      setErr(null);
    } catch (e: any) { if (e.status !== 401) setErr(e.message); }
  };

  useEffect(() => {
    const stop = watchFix(setFix, (e) => setErr(e.message));
    const t = setInterval(() => setNow(Date.now()), 1000);
    if (devSim) api.devTargets().then((r) => setTargets(r.targets)).catch(() => {});
    api.world().then((w) => { const a = w.areas.find((x) => x.id === presence.areaId) ?? w.areas[0]; if (a) setSector({ lat: a.lat, lng: a.lng, radiusM: a.radiusM }); }).catch(() => {});
    return () => { stop(); clearInterval(t); };
  }, []);
  useEffect(() => {
    refresh();
    const p = setInterval(refresh, mission ? 30000 : 20000);
    const off = onLive((ty) => { if (["mission.offered", "mission.expired", "desk_link.fulfilled", "desk_link.fallback", "contest.formed", "presence.check_in", "presence.check_out", "live.open"].includes(ty)) refresh(); });
    const hb = setInterval(async () => {
      try { const f = getSimFix() ?? (await currentFix()); await api.heartbeat({ lat: f.lat, lng: f.lng, sim: f.sim }); } catch { /* server expires presence */ }
    }, mission ? 20000 : 120000);
    return () => { clearInterval(p); clearInterval(hb); off(); };
  }, [mission?.id]);

  useEffect(() => { fixRef.current = fix; }, [fix]);
  // Your course: the bearing between fixes once you have moved a few metres, for the guidance arrow.
  const [course, setCourse] = useState<number | null>(null);
  const courseFrom = useRef<Fix | null>(null);
  useEffect(() => {
    if (!fix) return;
    if (!courseFrom.current) { courseFrom.current = fix; return; }
    const moved = distanceM(courseFrom.current, fix);
    if (moved >= 8) { setCourse(bearingDeg(courseFrom.current, fix)); courseFrom.current = fix; }
  }, [fix?.lat, fix?.lng]);
  // Map, 3D street or AR guide. The street scene is fetched per ~110 m cell as you move; the compass runs off-map only.
  const [view, setView] = useState<"map" | "3d" | "ar">("map");
  const [scene3d, setScene3d] = useState<Scene | null>(null);
  const [heading, setHeading] = useState<number | null>(null);
  useEffect(() => { if (view === "map") return; return watchHeading(setHeading); }, [view]);
  const cell = fix ? `${fix.lat.toFixed(3)},${fix.lng.toFixed(3)}` : "";
  useEffect(() => {
    if (view !== "3d" || !fix) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const ask = () => api.scene(fix.lat, fix.lng).then((sc) => { if (!alive) return; setScene3d(sc); if (sc.pending) timer = setTimeout(ask, 6000); }).catch(() => { if (alive) timer = setTimeout(ask, 15000); });
    ask();
    return () => { alive = false; if (timer) clearTimeout(timer); };
  }, [view, cell]);
  useEffect(() => { if (scan?.result === "locked") setAr(true); }, [scan?.result]);
  // Refresh the ambient layer as you move (every ~25 m) and on live spawns.
  useEffect(() => { void loadField(fix); }, [fix ? Math.round(fix.lat * 4000) : 0, fix ? Math.round(fix.lng * 4000) : 0]);
  useEffect(() => onLive((ty) => { if (ty === "signals.spawned" || ty === "cache.spun" || ty === "signal.captured") void loadField(fixRef.current); }), []);
  // What you are walking to: the mission's site, or whatever you tapped on the map.
  const selPoint = !nav && sel && sel.type !== "stronghold" ? { lat: sel.item.lat, lng: sel.item.lng, name: sel.type === "pin" ? sel.item.targetName : sel.item.name } : null;
  const target = nav ? { lat: nav.lat, lng: nav.lng } : selPoint ? { lat: selPoint.lat, lng: selPoint.lng } : null;
  const selDist = fix && selPoint ? distanceM(fix, selPoint) : null;
  const dist = fix && target ? distanceM(fix, target) : null;
  // With a live target, frame both ends of the walk; otherwise centre on the agent.
  const autoCenter = fix && target ? { lat: (fix.lat + target.lat) / 2, lng: (fix.lng + target.lng) / 2 } : fix ?? nav ?? { lat: 12.9763, lng: 77.5929 };
  const span = route ? Math.max(...route.coords.map((c) => distanceM(c, autoCenter)), dist ?? 0) * 2 : dist;
  const autoZoom = span == null ? 17 : span > 1400 ? 15 : span > 650 ? 16 : 17;
  // Operative's own framing: pinch or +/- for zoom, drag to pan, ⌖ to go back to auto framing.
  const [userZoom, setUserZoom] = useState<number | null>(null);
  const [pan, setPan] = useState({ dLat: 0, dLng: 0 });
  const [touching, setTouching] = useState(false);
  const zoom = Math.max(13, Math.min(19, userZoom ?? autoZoom));
  const center = { lat: autoCenter.lat + pan.dLat, lng: autoCenter.lng + pan.dLng };
  const gesture = useRef({ zoom, centerLat: center.lat, pan, panStart: pan, zoomStart: zoom });
  gesture.current.zoom = zoom; gesture.current.centerLat = center.lat; gesture.current.pan = pan;
  const zoomBy = (d: number) => setUserZoom((z) => Math.max(13, Math.min(19, Math.round((z ?? autoZoom) + d))));
  const gestures = useMemo(() => {
    const clampZ = (z: number) => Math.max(13, Math.min(19, z));
    const pinch = Gesture.Pinch()
      .onBegin(() => { setTouching(true); gesture.current.zoomStart = gesture.current.zoom; })
      .onUpdate((e) => { setUserZoom(clampZ(gesture.current.zoomStart + Math.log2(Math.max(0.05, e.scale)))); })
      .onFinalize(() => setTouching(false));
    const drag = Gesture.Pan().minPointers(1).maxPointers(1).activeOffsetX([-6, 6]).activeOffsetY([-6, 6])
      .onBegin(() => { setTouching(true); gesture.current.panStart = gesture.current.pan; })
      .onUpdate((e) => {
        const mpp = (156543.03 * Math.cos((gesture.current.centerLat * Math.PI) / 180)) / 2 ** gesture.current.zoom;
        const base = gesture.current.panStart;
        setPan({ dLat: base.dLat + (e.translationY * mpp) / 111_320, dLng: base.dLng - (e.translationX * mpp) / (111_320 * Math.cos((gesture.current.centerLat * Math.PI) / 180)) });
      })
      .onFinalize(() => setTouching(false));
    return Gesture.Simultaneous(pinch, drag);
  }, []);

  const bearing = fix && target ? bearingDeg(fix, target) : null;
  const onSite = dist != null && nav != null && dist <= nav.approachRadiusM;
  useEffect(() => {
    if (!fix || !target || onSite) { if (!target) setRoute(null); return; }
    let alive = true;
    walkingRoute(fix, target).then((r) => { if (alive) setRoute(r); });
    return () => { alive = false; };
  }, [fix ? Math.round(fix.lat * 2000) : 0, fix ? Math.round(fix.lng * 2000) : 0, target?.lat, target?.lng, onSite]);
  const nearest = mission ? dist : offers.reduce<number | null>((m, o) => (o.mission.walkM != null && (m == null || o.mission.walkM < m) ? o.mission.walkM : m), null);

  const accept = async (o: OfferCard) => {
    setBusy(true); setErr(null);
    try { const r = await api.acceptMission(o.offerId); setMission(r.mission); setOffers([]); setScan(null); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const decline = async (o: OfferCard) => {
    setOffers((os) => os.filter((x) => x.offerId !== o.offerId));
    try { await api.declineMission(o.offerId); } catch { /* expires anyway */ }
  };
  const [arHold, setArHold] = useState(false);
  const doScan = async (onSiteCode?: string) => {
    if (!mission) return refresh();
    setBusy(true); setErr(null);
    try {
      const f = fix ?? (await currentFix());
      const r = await api.scan(mission.id, { ...f, onSiteCode });
      // Keep the AR view mounted through the opening (or the crumble, if this was bait) before the debrief.
      if (ar && r.result === "verified" && r.reward) { setArHold(true); setTimeout(() => setArHold(false), r.decoyed ? 3600 : 2600); }
      setScan(r);
      if (r.result === "verified" && !r.reward) { setCode(""); setTimeout(refresh, 300); }
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const abandonNow = async () => {
    if (!mission) return;
    setBusy(true);
    try { await api.abandon(mission.id); finishMission(); } catch (e: any) { setErr(e.message); setBusy(false); }
  };
  const abandon = () => {
    if (!mission) return;
    Alert.alert("Abandon this mission?", mission.chain ? `It is link ${mission.chain.step} of ${mission.chain.name}. The link goes back on your board, but three drops fold the operation.` : "It goes back to the pool. Your chief will notice.",
      [{ text: "Keep it", style: "cancel" }, { text: "Abandon", style: "destructive", onPress: abandonNow }]);
  };
  const finishMission = () => { setMission(null); setNav(null); setScan(null); setCode(""); setBusy(false); };

  const completed = scan?.result === "verified" && scan.reward;

  const beacons: Beacon[] = field && !mission ? [
    ...field.caches.map((c) => ({ lat: c.lat, lng: c.lng, name: c.name, kind: "cache" as const })),
    ...field.signals.map((g) => ({ lat: g.lat, lng: g.lng, name: g.name, kind: "signal" as const })),
    ...field.pins.map((p) => ({ lat: p.lat, lng: p.lng, name: p.targetName, kind: "site" as const })),
  ] : [];
  const target3d = target ? { ...target, name: nav ? nav.targetName : selPoint?.name ?? "the site", radiusM: nav?.approachRadiusM ?? 40 } : null;
  if (view === "3d" && fix && !ar) {
    return <Street fix={fix} course={course} heading={heading} route={route} target={target3d} beacons={beacons} scene={scene3d} factionColor={factionColor(factionId)} onMap={() => setView("map")} onAR={() => setView("ar")} />;
  }
  if (view === "ar" && fix && !ar) {
    return <ARGuide fix={fix} heading={heading ?? course} route={route} target={target3d} beacons={beacons} onMap={() => setView("map")} on3D={() => setView("3d")} />;
  }
  if (ar && mission && nav && (!completed || arHold)) {
    return (
      <ARScan codename={codename} factionId={factionId} rank={rank} targetName={nav.targetName}
        prompt={scan?.result === "needs_code" ? scan.puzzle?.prompt ?? null : null}
        bearing={bearing} distanceM={dist} busy={busy || toolBusy}
        error={scan?.result === "needs_code" ? scan.reason ?? null : scan?.result === "too_far" ? `Still ${Math.round(scan.distanceM ?? 0)} m out.` : scan?.result === "rejected" ? scan.reason ?? "Scan could not be verified." : err}
        onSubmit={(c) => doScan(c || undefined)} onDisengage={() => setAr(false)}
        lock={nav.lock ?? null} lockOpen={nav.lockOpen ?? true} unlockMsg={toolMsg} templateId={mission.templateId} crisis={!!mission.crisis} opened={scan?.result === "verified" && !scan.decoyed} decoyed={scan?.result === "verified" && !!scan.decoyed}
        tools={kit ? kit.tools.filter((t) => t.id !== "cipher_kit" && t.id !== "fragment").map((t) => ({ ...t, enabled: t.qty > 0 && !!fix && dist != null && dist <= (nav.approachRadiusM ?? 45), why: t.qty > 0 ? "Get inside the ring." : t.craft ? `Craft on Me · ${t.craft} fragments` : "Caches sometimes hold one." })) : []}
        onUnlock={async (t) => {
          if (!fix) return;
          setToolBusy(true);
          try {
            const r = await api.unlock(mission.id, { tool: t.id, lat: fix.lat, lng: fix.lng, sim: fix.sim });
            setToolMsg(r.ok ? `UNLOCKED · ${r.detail ?? ""}` : r.wrong ? `WRONG TOOL · ${r.reason}` : r.reason ?? "No.");
            if (r.ok) { setNav(await api.navigate(mission.id)); setScan(null); }
            await loadKit();
          } catch (e: any) { setToolMsg(e.message); } finally { setToolBusy(false); }
        }} />
    );
  }

  return (
    <Screen scrollEnabled={!touching}>
      {devSim && <DevPanel />}
      <View style={s.titleBar}>
        <View style={s.titleTick} />
        <Text style={s.titleText}>Spy Vision Map · Real world satellite</Text>
      </View>
      <View style={s.statusRow}>
        <View style={{ flexDirection: "row", gap: 3, alignItems: "flex-end" }}>
          {[6, 9, 12].map((h) => <View key={h} style={{ width: 4, height: h, backgroundColor: C.cyan }} />)}
          <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: C.ok, marginLeft: 6, marginBottom: 2 }} />
        </View>
        <Text style={s.mono}>gps: {fix ? `${fix.lat.toFixed(5)}, ${fix.lng.toFixed(5)}` : "acquiring"}</Text>
        <Text style={s.sector}>{presence.areaName?.toUpperCase() ?? "NO SECTOR"}</Text>
      </View>

      <GestureDetector gesture={gestures}>
      <View style={{ width, height }} collapsable={false}>
        <SatMap center={center} zoom={zoom} width={width} height={height}>
          {(project) => (projectRef.current = project) && (
            <MapOverlay project={project} width={width} height={height} fix={fix} offers={field ? [] : offers} target={target ? { ...target, name: nav ? nav.targetName : selPoint!.name, locked: nav ? !nav.unlocked : false, duel: !!nav?.faceoff } : null}
              contacts={contacts} bearing={bearing} dist={dist} nearest={nearest} radius={nav?.approachRadiusM ?? 45} sector={sector} route={route} nextTurn={route && fix && !onSite ? guide(route, fix).next : null} />
          )}
        </SatMap>
        {field && !mission && (
          <FieldMarkers project={(p) => projectRef.current ? projectRef.current(p) : { x: -999, y: -999 }} width={width} height={height}
            caches={field.caches} signals={field.signals} pins={field.pins} stronghold={field.stronghold} selected={sel} onSelect={setSel} factionId={factionId} bait={field.distractions ?? []} />
        )}
        <View style={s.zoomBox}>
          <Text style={s.zoomBtn} onPress={() => zoomBy(1)}>+</Text>
          <Text style={s.zoomBtn} onPress={() => zoomBy(-1)}>−</Text>
          <Text style={[s.zoomBtn, (userZoom != null || pan.dLat || pan.dLng) ? { color: C.cyan } : { color: C.dim }]} onPress={() => { setUserZoom(null); setPan({ dLat: 0, dLng: 0 }); }}>⌖</Text>
        </View>
        <Text style={s.zoomLevel}>Z{zoom.toFixed(1)}</Text>
      </View>
      </GestureDetector>

      {!mission && sel && (
        <View style={{ marginTop: 8 }}>
          <SelectionCard sel={sel} dist={selDist} factionId={factionId} busy={busy || spinning}
            onSpin={async () => { if (!fix || sel.type !== "cache") return; setSpinning(true); try { const r = await api.spinCache(sel.item.id, { lat: fix.lat, lng: fix.lng, sim: fix.sim }); setSpinResult(r); await loadField(fix); } catch (e: any) { setSpinResult({ ok: false, reason: e.message }); } finally { setSpinning(false); } }}
            onCapture={() => { setCaptureResult(null); setCapturing(true); }}
            onAccept={async () => { if (sel.type !== "pin") return; setBusy(true); try { const r = await api.acceptMission(sel.item.offerId); setMission(r.mission); setSel(null); await refresh(); } catch (e: any) { setErr(e.message); } finally { setBusy(false); } }}
            onDecline={async () => { if (sel.type !== "pin") return; try { await api.declineMission(sel.item.offerId); } catch { /* gone */ } setSel(null); await refresh(); }}
            onNavigate={() => setGuiding(true)}
            onClose={() => { setSel(null); setGuiding(false); }}
            bait={field?.distractions ?? []} baitLeft={field?.distractionsLeft ?? 0}
            onTradecraft={() => { if (sel.type === "cache") { void loadBc(); setBaitSite({ id: sel.item.id, name: sel.item.name }); } }}
            />
        </View>
      )}
      {baitSite && bc && (
        <BaitSheet site={baitSite.name} credits={bc.credits} costs={bc.costs} distractionsLeft={field?.distractionsLeft ?? 0} tipsLeft={bc.left} rivals={bc.rivals} busy={busy}
          onClose={() => setBaitSite(null)}
          onSend={async (move) => {
            setBusy(true);
            try {
              if (move.kind === "distraction") { const r = await api.plantDistraction(baitSite.id); if (r.ok) { setToolMsg(`BAIT SET AT ${baitSite.name.toUpperCase()} · ${r.left} LEFT TODAY`); await loadField(fix); await loadBc(); return `Planted. Every rival chief now has an order for ${baitSite.name}. ${r.left} left today.`; } return `!${r.reason}`; }
              const r = await api.sendTip(move.toFaction, "plant", baitSite.id); if (r.ok) { setToolMsg(`FALSE LEAD SET AT ${baitSite.name.toUpperCase()} · ${r.left} TIP${r.left === 1 ? "" : "S"} LEFT TODAY`); await loadField(fix); await loadBc(); return `Sent. ${r.left} tip${r.left === 1 ? "" : "s"} left today.`; } return `!${r.reason}`;
            } catch (e: any) { return `!${e.message}`; } finally { setBusy(false); }
          }} />
      )}
      {!mission && field && <NearbyTracker signals={field.signals} pins={field.pins} selected={sel} onSelect={setSel} />}
      {mission && nav && !completed && onSite && <Text style={[s.mono, { color: C.ok, marginTop: 8 }]}>ON SITE · INSIDE THE RING</Text>}
      {fix && target && !onSite && (mission || guiding) && (route ? (
        <Guide route={route} at={fix} course={course} targetName={nav ? nav.targetName : selPoint?.name ?? "the site"} arriveM={nav?.approachRadiusM ?? 40} />
      ) : (
        <Text style={[s.mono, { color: C.cyan, marginTop: 8 }]}>{dist != null ? `${Math.round(dist)} M STRAIGHT LINE · PLOTTING A FOOTPATH…` : "LOCATING…"}</Text>
      ))}
      <Button title={mission ? (onSite ? "Scan the site" : nav?.unlocked ? "Scan on arrival" : "Site locked") : "Scan region"} onPress={() => doScan()} loading={busy} disabled={!!mission && (!nav?.unlocked || !onSite)} style={{ marginTop: 10, paddingVertical: 16 }} />
      <Text style={[s.mono, { textAlign: "center", marginTop: 4 }]}>
        {mission ? (onSite ? "You are inside the ring. Scan to verify the site." : nav?.unlocked ? "Walk to the ring, then scan." : "An intel analyst is unlocking this site.") : "Refreshes orders and signals around you. Tools are on Me; your chief is on HQ."}
      </Text>
      {mission && nav?.unlocked && !completed && <Button title={!onSite ? "AR view · look for the package" : nav.lock && !nav.lockOpen ? "AR scan · open the package" : "AR scan · camera view"} kind={onSite && nav.lock && !nav.lockOpen ? undefined : "ghost"} onPress={() => setAr(true)} style={{ paddingVertical: 9 }} />}
      <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
        <Button title="3D street" kind="ghost" onPress={() => setView("3d")} disabled={!fix} style={{ flex: 1, marginTop: 0, paddingVertical: 9 }} />
        <Button title="AR guide" kind="ghost" onPress={() => setView("ar")} disabled={!fix} style={{ flex: 1, marginTop: 0, paddingVertical: 9 }} />
      </View>
      {kit && (() => {
        // What each tool can do from exactly here: the dial greys the rest and says why.
        const jam = kit.effects.find((e) => e.kind === "jammer"), trk = kit.effects.find((e) => e.kind === "tracker");
        const dial: DialTool[] = kit.tools.map((t) => {
          const has = t.permanent || t.qty > 0;
          switch (t.id) {
            case "cipher_kit": return { ...t, enabled: false, why: "Open it on the intel desk while you work an intercept." };
            case "fragment": return { ...t, enabled: false, why: `${t.qty} fragments. Craft on Me: key 3, tracker 2, burner 1.` };
            case "key": return { ...t, enabled: false, why: has ? "Use it on the intel desk with an intercept open." : "Craft one on Me from three fragments." };
            case "lens": return { ...t, enabled: has && !!mission && mission.templateId === "RECON" && !completed, why: has ? "Needs a recon mission in hand." : "Caches sometimes hold one." };
            case "jammer": return { ...t, enabled: has && !jam, why: jam ? `Jamming until ${new Date(jam.until).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.` : "Caches sometimes hold one." };
            case "tracker": return { ...t, enabled: has && !trk, why: trk ? `Tracking until ${new Date(trk.until).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.` : "Craft one on Me from two fragments." };
            case "decoy": return { ...t, enabled: has && !!completed && !!nav && !!fix, why: has ? "Plant it on a site right after you verify." : "Caches sometimes hold one." };
            case "burner": return { ...t, enabled: has && !mission, why: has ? "Only while no mission is live." : "Craft one on Me from a fragment." };
            default: return { ...t, enabled: false };
          }
        });
        return <FieldKit tools={dial} effects={kit.effects} busy={toolBusy} hint={toolMsg}
          onUse={(t) => { if (t.id === "lens" && mission) useTool("lens", { missionId: mission.id }); else if (t.id === "decoy" && nav && fix) useTool("decoy", { targetId: nav.targetId, lat: fix.lat, lng: fix.lng }); else useTool(t.id); }} />;
      })()}
      <Text onPress={onOffDuty} style={[s.mono, { textAlign: "right", marginTop: 8, color: C.cyanDim, letterSpacing: 1.4 }]}>STAND DOWN</Text>

      {completed && mission && !arHold && <Debrief scan={scan} mission={mission} targetName={nav?.targetName ?? mission.title} onDone={finishMission} />}

      {mission && nav?.faceoff && !completed && (
        <View style={s.duelBar}>
          <Text style={s.duelText}>FACE-OFF · {nav.faceoff.rivalCodename.toUpperCase()} OF {nav.faceoff.rivalFaction.toUpperCase()} IS ON {nav.targetName.toUpperCase()}</Text>
          <Text style={[s.duelText, { fontSize: 22 }]}>{fmtCountdown(nav.faceoff.endsAt, now)}</Text>
          <Text style={[s.mono, { color: C.text }]}>FIRST CLEAN SCAN KEEPS THE SITE</Text>
        </View>
      )}
      {mission && nav && !completed && (
        <Dossier tab={mission.contested || nav.faceoff ? C.red : C.cyan} style={{ marginTop: 12 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
            <Text style={[s.panelTitle, { flex: 1 }]}>{TEMPLATE_NAME[mission.templateId] ?? mission.title} · {nav.targetName}</Text>
            <Text style={[s.mono, { marginTop: 4 }]}>{fmtCountdown(mission.expiresAt, now)}</Text>
          </View>
          {mission.chain && <Text style={[s.mono, { color: C.amber, letterSpacing: 1.2 }]}>{mission.chain.name.toUpperCase()} · LINK {mission.chain.step} OF {mission.chain.of}</Text>}
          {mission.crisis && <Text style={[s.mono, { color: C.amber, letterSpacing: 1.2 }]}>CRISIS · {mission.crisis.name.toUpperCase()} · {mission.crisis.stance.toUpperCase()}{mission.crisis.joint ? ` · JOINT OP WITH ${mission.crisis.joint.toUpperCase()}` : ""}</Text>}
          {nav.heldBy && nav.heldBy !== factionId && <Text style={[s.mono, { color: C.red, letterSpacing: 1.2 }]}>SITE HELD BY A RIVAL · YOU WILL ARRIVE LATE</Text>}
          {nav.lock && <Text style={[s.mono, { color: nav.lockOpen ? C.ok : C.amber, letterSpacing: 1.2 }]}>{nav.lockOpen ? `PACKAGE OPENED WITH ${nav.lock.tool.toUpperCase()}` : `${nav.lock.label.toUpperCase()} PACKAGE · BRING A ${nav.lock.tool.toUpperCase()} · OPEN IT IN AR SCAN ON SITE`}</Text>}
          {mission.contested && <Stamp text="Contested" size={16} style={{ marginBottom: 6 }} />}
          <Typed>{mission.brief}</Typed>
          {nav.steps.map((st, i) => <Typed key={i} style={{ color: C.dim, marginBottom: 2 }}>{i + 1}. {st}</Typed>)}
          {!nav.unlocked && <Typed style={{ color: C.amber }}>Locked until your analyst cracks the cipher{mission.deskLink?.fallbackAt ? `, or at ${new Date(mission.deskLink.fallbackAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} you get a solo version` : ""}.</Typed>}
          {scan?.result === "needs_code" && (
            <View style={{ marginTop: 6 }}>
              <Text style={[s.panelTitle, { color: C.cyan }]}>On-site check</Text>
              <Typed>{scan.puzzle?.prompt}</Typed>
              {scan.reason && <Typed style={{ color: C.red }}>{scan.reason}</Typed>}
              <Input value={code} onChangeText={setCode} placeholder="ANSWER" autoCapitalize="characters" autoCorrect={false} onSubmitEditing={() => doScan(code)} />
              <Button title="Confirm" onPress={() => doScan(code)} loading={busy} />
            </View>
          )}
          {scan?.result === "too_far" && <Typed style={{ color: C.amber }}>Still {Math.round(scan.distanceM ?? 0)} m out. Get within {nav.approachRadiusM} m.</Typed>}
          {(scan?.result === "rejected" || scan?.result === "flagged") && <Typed style={{ color: C.red }}>{scan.reason ?? "Scan could not be verified."}</Typed>}
          {scan?.result === "verified" && !scan.reward && <Typed style={{ color: C.ok }}>{scan.debrief}</Typed>}
          <Button title="Abandon mission" kind="ghost" onPress={abandon} disabled={busy} />
        </Dossier>
      )}

      {!mission && (
        <View style={{ marginTop: 12 }}>
          <Text style={s.sectionTitle}>Mission board · {offers.length} available</Text>
          {offers.length === 0 && <Dossier tab={C.cyanDim}><Body dim style={{ marginBottom: 0 }}>{notice ?? "Your chief is choosing. Orders land within seconds when the sector has open targets."}</Body></Dossier>}
          {offers.map((o) => (
            <Dossier key={o.offerId} tab={o.mission.contested ? C.red : C.cyan}>
              <View style={{ flexDirection: "row", gap: 10, alignItems: "flex-start" }}>
                <Image source={ART.mission[o.mission.templateId]} style={s.cardArt} />
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text style={s.panelTitle}>{TEMPLATE_NAME[o.mission.templateId] ?? o.mission.title}</Text>
                    <Text style={[s.mono, { color: C.cyan }]}>{o.mission.rewardXp} XP</Text>
                  </View>
                </View>
              </View>
              {o.mission.chain && <Text style={[s.mono, { color: C.amber, letterSpacing: 1.2 }]}>{o.mission.chain.name.toUpperCase()} · LINK {o.mission.chain.step} OF {o.mission.chain.of}</Text>}
              {o.mission.lock && <Text style={[s.mono, { color: C.amber, letterSpacing: 1.2 }]}>{o.mission.lock.label.toUpperCase()} · NEEDS A {o.mission.lock.tool.toUpperCase()}</Text>}
              {o.mission.crisis && <Text style={[s.mono, { color: C.amber, letterSpacing: 1.2 }]}>CRISIS · {o.mission.crisis.name.toUpperCase()} · {o.mission.crisis.stance.toUpperCase()}{o.mission.crisis.joint ? ` · JOINT OP WITH ${o.mission.crisis.joint.toUpperCase()}` : ""}</Text>}
              <Text style={s.mono}>{o.mission.targetName?.toUpperCase()}{o.mission.walkM != null ? ` · ${Math.round(o.mission.walkM)}M` : ""}{o.mission.contested ? " · RIVAL ACTIVITY" : ""}{o.mission.deskLink ? " · ANALYST LINK" : ""}</Text>
              <Typed style={{ marginTop: 4 }}>{o.mission.brief}</Typed>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <Button title="Accept mission" onPress={() => accept(o)} loading={busy} style={{ flex: 1.3 }} />
                <Button title="Decline" kind="ghost" onPress={() => decline(o)} style={{ flex: 1 }} />
              </View>
              <Text style={[s.mono, { marginTop: 6 }]}>ACCEPT WITHIN {fmtCountdown(o.acceptBy, now)} · WINDOW CLOSES IN {fmtCountdown(o.mission.expiresAt, now)}</Text>
            </Dossier>
          ))}
        </View>
      )}
      {err && <Body style={{ color: C.red }}>{err}</Body>}
      {spinResult && <SpinSheetHost result={spinResult} onDone={() => setSpinResult(null)} />}
      {duel && (
        <Modal visible transparent animationType="fade" onRequestClose={() => setDuel(null)}>
        <View style={s.duelModal}>
          <Stamp text={duel.outcome === "won" ? "First in" : "Outrun"} size={46} color={duel.outcome === "won" ? C.red : C.dim} />
          <Text style={[s.duelText, { marginTop: 14, textAlign: "center" }]}>{duel.outcome === "won" ? `${duel.rival.toUpperCase()} OF ${duel.rivalFaction.toUpperCase()} WATCHED YOU TAKE ${duel.target.toUpperCase()}` : `${duel.rival.toUpperCase()} OF ${duel.rivalFaction.toUpperCase()} TOOK ${duel.target.toUpperCase()} FIRST`}</Text>
          <Text style={[s.mono, { marginTop: 8, textAlign: "center" }]}>{duel.outcome === "won" ? "+80 XP · THEY WILL REMEMBER YOUR NAME" : "THE SITE IS THEIRS FOR TWO HOURS · REMEMBER THE NAME"}</Text>
          <Button title="Back to the map" onPress={() => setDuel(null)} />
        </View>
        </Modal>
      )}
      {capturing && sel?.type === "signal" && (
        <CaptureRitual signal={sel.item} busy={busy} result={captureResult}
          onAttempt={async (hold, flick) => { if (!fix) return; setBusy(true); try { const r = await api.captureSignal(sel.item.id, { lat: fix.lat, lng: fix.lng, hold, flick, sim: fix.sim }); setCaptureResult(r); if (r.result === "captured" || r.result === "fled" || r.result === "gone") await loadField(fix); } catch (e: any) { setErr(e.message); } finally { setBusy(false); } }}
          onRetry={() => setCaptureResult(null)}
          onDone={() => { setCapturing(false); setCaptureResult(null); if (captureResult?.result === "captured") setSel(null); }} />
      )}
    </Screen>
  );
}
import { SpinSheet as SpinSheetHost } from "./FieldLayer";

// ---------- overlay ----------
function MapOverlay({ project, width, height, fix, offers, target, contacts, bearing, dist, nearest, radius, sector, route, nextTurn }: {
  project: Projector; width: number; height: number; fix: Fix | null; offers: OfferCard[];
  target: { lat: number; lng: number; name: string; locked: boolean; duel?: boolean } | null; contacts: Contact[];
  bearing: number | null; dist: number | null; nearest: number | null; radius: number;
  sector: { lat: number; lng: number; radiusM: number } | null;
  route: WalkingRoute | null; nextTurn: { lat: number; lng: number; type: string } | null;
}) {
  const turn = nextTurn && nextTurn.type !== "arrive" ? project(nextTurn) : null;
  const routePts = route ? route.coords.map((c) => { const p = project(c); return `${p.x},${p.y}`; }).join(" ") : null;
  // Controlled sector as a glowing octagon around the area centre.
  const sectorPts = sector ? Array.from({ length: 8 }, (_, i) => {
    const a = (i * 45 + 22.5) * (Math.PI / 180);
    const dLat = (sector.radiusM / 111_320) * Math.cos(a);
    const dLng = (sector.radiusM / (111_320 * Math.cos((sector.lat * Math.PI) / 180))) * Math.sin(a);
    const p = project({ lat: sector.lat + dLat, lng: sector.lng + dLng });
    return `${p.x},${p.y}`;
  }).join(" ") : null;
  const sweep = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const a = Animated.loop(Animated.timing(sweep, { toValue: 1, duration: 4000, easing: Easing.linear, useNativeDriver: true }));
    const b = Animated.loop(Animated.timing(pulse, { toValue: 1, duration: 1600, easing: Easing.out(Easing.quad), useNativeDriver: true }));
    a.start(); b.start();
    return () => { a.stop(); b.stop(); };
  }, []);
  const me = fix ? project(fix) : { x: width / 2, y: height / 2 };
  const tgt = target ? project(target) : null;
  const rPx = radius / project.metersPerPx;
  const rotate = sweep.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
  const ringScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.3, 2.2] });
  const ringOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.9, 0] });
  // Scan wedge from the player toward the target (or north).
  const wedgeAngle = bearing ?? 0;
  const inRange = dist != null && dist <= radius;

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
        {sectorPts && <Polygon points={sectorPts} fill={C.cyan} fillOpacity={0.05} stroke={C.cyan} strokeOpacity={0.75} strokeWidth={1.5} strokeDasharray="10 6" />}
        {/* approach radius + reticle on the live target */}
        {tgt && (
          <G>
            <Circle cx={tgt.x} cy={tgt.y} r={rPx} fill={target!.duel ? C.red : C.cyan} fillOpacity={target!.locked ? 0.05 : target!.duel ? 0.18 : 0.12} stroke={target!.duel ? C.red : inRange ? C.ok : C.cyan} strokeWidth={target!.duel ? 3 : 1.5} strokeDasharray={target!.duel ? undefined : "6 4"} />
            <Reticle x={tgt.x} y={tgt.y} color={inRange ? C.ok : target!.locked ? C.amber : C.cyan} />
          </G>
        )}
        {/* walking route, or a straight bearing line until the route arrives */}
        {routePts ? (
          <G>
            <Polyline points={routePts} fill="none" stroke={C.ink} strokeOpacity={0.6} strokeWidth={6} strokeLinejoin="round" strokeLinecap="round" />
            <Polyline points={routePts} fill="none" stroke={C.cyan} strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" />
            <Polyline points={routePts} fill="none" stroke={C.text} strokeOpacity={0.9} strokeWidth={1} strokeDasharray="2 10" strokeLinecap="round" />
          </G>
        ) : tgt && fix ? <Line x1={me.x} y1={me.y} x2={tgt.x} y2={tgt.y} stroke={C.cyan} strokeOpacity={0.55} strokeWidth={1} strokeDasharray="3 5" /> : null}
        {/* the next turn on the route */}
        {turn && <G><Circle cx={turn.x} cy={turn.y} r={9} fill={C.ink} fillOpacity={0.7} stroke={C.text} strokeWidth={1.5} /><Circle cx={turn.x} cy={turn.y} r={3} fill={C.text} /></G>}
        {/* contacts */}
        {contacts.map((c) => { const p = project(c); return <ContactGlyph key={c.id} x={p.x} y={p.y} color={c.faction === "unknown" ? C.cyan : factionColor(c.faction)} />; })}
        {/* player */}
        <Circle cx={me.x} cy={me.y} r={16} fill={C.cyan} fillOpacity={0.15} />
        <Circle cx={me.x} cy={me.y} r={5} fill={C.cyan} />
        <Circle cx={me.x} cy={me.y} r={9} fill="none" stroke={C.cyan} strokeWidth={1.5} />
      </Svg>
      {/* rotating sweep anchored on the player */}
      <Animated.View style={{ position: "absolute", left: me.x - 110, top: me.y - 110, width: 220, height: 220, transform: [{ rotate }] }}>
        <Svg width={220} height={220}>
          <Path d="M110 110 L110 0 A110 110 0 0 1 180 24 Z" fill={C.cyan} fillOpacity={0.16} />
          <Line x1={110} y1={110} x2={110} y2={0} stroke={C.cyan} strokeOpacity={0.9} strokeWidth={1.5} />
        </Svg>
      </Animated.View>
      {/* wedge toward the target */}
      {tgt && <View style={{ position: "absolute", left: me.x - 110, top: me.y - 110, width: 220, height: 220, transform: [{ rotate: `${wedgeAngle}deg` }] }}>
        <Svg width={220} height={220}><Path d="M110 110 L92 0 A110 110 0 0 1 128 0 Z" fill={C.cyan} fillOpacity={0.22} /></Svg>
      </View>}
      {/* pulse on the target */}
      {tgt && <Animated.View style={{ position: "absolute", left: tgt.x - 14, top: tgt.y - 14, width: 28, height: 28, borderRadius: 14, borderWidth: 1.5, borderColor: inRange ? C.ok : C.cyan, transform: [{ scale: ringScale }], opacity: ringOpacity }} />}

      {/* labels */}
      {tgt && <HudLabel width={width} height={height} x={tgt.x + 18} y={tgt.y - 14} title={target!.locked ? "LOCKED SITE" : "OBJECTIVE"} sub={`${target!.name.toUpperCase()}${dist != null ? ` (${Math.round(dist)}m)` : ""}`} color={inRange ? C.ok : C.cyan} />}
      {!target && offers.map((o, i) => { const px = offerPoint(o, project, me, i); return px ? <HudLabel width={width} height={height} key={o.offerId} x={px.x + 14} y={px.y - 14} title={TEMPLATE_NAME[o.mission.templateId] ?? o.mission.title} sub={`${o.mission.targetName?.toUpperCase() ?? ""} · ${o.mission.walkM != null ? Math.round(o.mission.walkM) + "m" : "?"}`} /> : null; })}
      {contacts.map((c) => { const p = project(c); return <HudLabel width={width} height={height} key={"l" + c.id} x={p.x + 16} y={p.y - 12} title={c.faction === "unknown" ? "CONTACT // UNKNOWN" : `CONTACT // ${c.faction.toUpperCase()}`} sub={`(${c.distanceM}m)`} small color={c.faction === "unknown" ? C.cyan : factionColor(c.faction)} />; })}

      {/* compass */}
      <View style={s.compass}>
        <Svg width={84} height={84}>
          <Circle cx={42} cy={42} r={38} fill={C.glass} stroke={C.cyan} strokeOpacity={0.7} />
          <Circle cx={42} cy={42} r={26} fill="none" stroke={C.cyan} strokeOpacity={0.3} />
          {bearing != null && <G rotation={bearing} origin="42, 42"><Path d="M42 42 L30 12 A32 32 0 0 1 54 12 Z" fill={C.cyan} fillOpacity={0.5} /></G>}
          <Polygon points="42,34 38,46 42,43 46,46" fill={C.cyan} />
        </Svg>
        <Text style={[s.compassText, { top: 4, left: 37 }]}>N</Text>
        <Text style={[s.compassText, { bottom: 4, left: 38 }]}>S</Text>
        <Text style={[s.compassText, { top: 34, left: 6 }]}>W</Text>
        <Text style={[s.compassText, { top: 34, right: 6 }]}>E</Text>
      </View>
      <Text style={[s.hudText, { position: "absolute", left: 10, top: 100 }]}>SIGNAL LOCK: {fix ? "STABLE" : "SEARCHING"}</Text>
      <Text style={[s.hudText, { position: "absolute", left: 10, bottom: 16 }]}>NEAREST OBJECTIVE: {nearest == null ? "--" : `${Math.round(nearest)}M`}</Text>
      {/* frame ticks */}
      <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
        {[0, 0.25, 0.5, 0.75, 1].map((k) => <Line key={k} x1={width * k} y1={height - 6} x2={width * k} y2={height} stroke={C.cyan} strokeOpacity={0.7} />)}
        <Rect x={width - 60} y={8} width={52} height={14} fill={C.glass} stroke={C.cyan} strokeOpacity={0.4} />
      </Svg>
      <Text style={[s.hudText, { position: "absolute", right: 12, top: 9, fontSize: 9 }]}>SECTOR</Text>
    </View>
  );
}

function offerPoint(o: OfferCard, project: Projector, me: { x: number; y: number }, i: number) {
  // Offers carry distance but not coordinates (targets stay withheld until accepted); place
  // the label on a ring at that distance so the player sees how far, not where.
  if (o.mission.walkM == null) return null;
  const r = o.mission.walkM / project.metersPerPx;
  const a = (-60 + i * 75) * (Math.PI / 180);
  return { x: me.x + r * Math.cos(a), y: me.y + r * Math.sin(a) };
}

function Reticle({ x, y, color }: { x: number; y: number; color: string }) {
  const s = 14;
  return (
    <G stroke={color} strokeWidth={1.5} fill="none">
      <Path d={`M${x - s} ${y - s / 2} V${y - s} H${x - s / 2} M${x + s / 2} ${y - s} H${x + s} V${y - s / 2} M${x + s} ${y + s / 2} V${y + s} H${x + s / 2} M${x - s / 2} ${y + s} H${x - s} V${y + s / 2}`} />
      <Circle cx={x} cy={y} r={5} />
      <Circle cx={x} cy={y} r={1.5} fill={color} />
    </G>
  );
}
function ContactGlyph({ x, y, color }: { x: number; y: number; color: string }) {
  return (
    <G>
      <Rect x={x - 11} y={y - 11} width={22} height={22} fill={C.glass} stroke={color} strokeWidth={1} />
      <Circle cx={x} cy={y - 5} r={2.6} fill={color} />
      <Path d={`M${x - 4} ${y + 8} V${y + 1} a4 4 0 0 1 8 0 V${y + 8} Z`} fill={color} />
    </G>
  );
}
function HudLabel({ x, y, title, sub, color = C.cyan, small, width = 360, height = 460 }: { x: number; y: number; title: string; sub?: string; color?: string; small?: boolean; width?: number; height?: number }) {
  // Keep labels inside the map frame.
  const left = Math.max(4, Math.min(x, width - 176));
  const top = Math.max(4, Math.min(y, height - 44));
  return (
    <View style={[s.label, { left, top, borderColor: color }]}>
      <Text style={[s.labelTitle, { color, fontSize: small ? 10 : 12 }]}>{title}</Text>
      {sub ? <Text style={[s.labelSub, { fontSize: small ? 9.5 : 11 }]}>{sub}</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  titleBar: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderColor: C.line, backgroundColor: C.ink2, paddingVertical: 8, paddingHorizontal: 10, marginBottom: 6 },
  titleTick: { width: 3, height: 18, backgroundColor: C.cyan },
  titleText: { color: C.cyan, fontFamily: F.displayMed, fontSize: 17, letterSpacing: 1.6, textTransform: "uppercase" },
  statusRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6, paddingHorizontal: 2 },
  mono: { color: C.dim, fontFamily: F.typed, fontSize: 11.5 },
  zoomBox: { position: "absolute", right: 8, bottom: 26, borderWidth: 1, borderColor: C.cyanDim, backgroundColor: "rgba(6,20,30,0.75)" },
  zoomBtn: { color: C.cyan, fontFamily: F.displayMed, fontSize: 20, width: 34, height: 34, lineHeight: 34, textAlign: "center", borderBottomWidth: 1, borderBottomColor: C.line },
  cardArt: { width: 64, height: 64, borderWidth: 1, borderColor: C.line },
  toolBtn: { marginTop: 0, paddingVertical: 6, paddingHorizontal: 10 },
  duelBar: { borderWidth: 2, borderColor: C.red, backgroundColor: "rgba(255,93,108,0.12)", padding: 10, marginTop: 8, alignItems: "center", gap: 2 },
  duelText: { color: C.red, fontFamily: F.displayMed, fontSize: 13, letterSpacing: 1.6 },
  duelModal: { flex: 1, backgroundColor: "rgba(4,10,14,0.96)", alignItems: "center", justifyContent: "center", padding: 24 },
  zoomLevel: { position: "absolute", right: 48, bottom: 30, color: C.dim, fontFamily: F.typed, fontSize: 9, letterSpacing: 1 },
  sector: { color: C.text, fontFamily: F.displayMed, fontSize: 11, letterSpacing: 1.2, backgroundColor: C.ink2, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: C.line },
  compass: { position: "absolute", left: 10, top: 10, width: 84, height: 84 },
  compassText: { position: "absolute", color: C.cyan, fontFamily: F.displayMed, fontSize: 10 },
  hudText: { color: C.cyan, fontFamily: F.displayMed, fontSize: 12, letterSpacing: 1.2, backgroundColor: C.glass, paddingHorizontal: 6, paddingVertical: 2 },
  label: { position: "absolute", backgroundColor: C.glass, borderLeftWidth: 2, paddingHorizontal: 7, paddingVertical: 3, maxWidth: 190 },
  labelTitle: { fontFamily: F.displayMed, letterSpacing: 1.2 },
  labelSub: { color: C.text, fontFamily: F.typed },
  panelTitle: { color: C.text, fontFamily: F.displayMed, fontSize: 17, letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 2, flexShrink: 1 },
  sectionTitle: { color: C.cyanDim, fontFamily: F.displayMed, fontSize: 13, letterSpacing: 1.6, textTransform: "uppercase", marginBottom: 8 },
});
