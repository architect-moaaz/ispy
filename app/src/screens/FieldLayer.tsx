import React, { useEffect, useRef, useState } from "react";
import { Animated, Easing, Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import type { CacheView, CaptureResult, DistractionView, OfferPin, Rarity, SignalView, SpinResult, StrongholdView } from "@ispy/shared";
import { ART } from "../art";
import { C, F, factionColor } from "../theme";
import { Body, Button, Dossier, Stamp, Typed, fmtCountdown } from "../ui";

/**
 * The ambient layer on the Spy Vision map: tappable caches, signals, the chief's order pins and the
 * sector stronghold; the nearby tracker; and the two rituals (spin a cache, capture a signal).
 */
export type Selection =
  | { type: "cache"; item: CacheView }
  | { type: "signal"; item: SignalView }
  | { type: "pin"; item: OfferPin }
  | { type: "stronghold"; item: StrongholdView };

export const RARITY_COLOR: Record<Rarity, string> = { common: C.cyan, uncommon: C.ok, rare: C.amber, legendary: "#ff6ad5" };
const MISSION_ART: Record<string, number> = ART.mission;
export const artFor = (key: string) => MISSION_ART[{ extraction: "EXTRACTION", recon: "RECON", intercept: "CIPHER", drop: "DEAD_DROP" }[key] ?? key] ?? ART.mission.DEAD_DROP;
/** The painted object for a signal kind; falls back to the mission scene art. */
export const signalArt = (kind: string, artKey?: string) => ART.signal[kind] ?? artFor(artKey ?? "drop");

/** Markers drawn at projected positions; taps select, the map's pan still works under them. */
export function FieldMarkers({ project, width, height, caches, signals, pins, stronghold, selected, onSelect, factionId, bait = [] }: {
  project: (p: { lat: number; lng: number }) => { x: number; y: number }; width: number; height: number; caches: CacheView[]; signals: SignalView[]; pins: OfferPin[]; stronghold: StrongholdView | null;
  selected: Selection | null; onSelect: (s: Selection | null) => void; factionId: string | null; bait?: DistractionView[];
}) {
  const baited = new Set(bait.map((b) => b.targetId));
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const a = Animated.loop(Animated.sequence([Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }), Animated.timing(pulse, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true })]));
    a.start(); return () => a.stop();
  }, []);
  const inside = (p: { x: number; y: number }) => p.x > -20 && p.y > -20 && p.x < width + 20 && p.y < height + 20;
  const isSel = (type: Selection["type"], id: string) => !!selected && selected.type === type && (selected.item as any).id === id || (type === "stronghold" && selected?.type === "stronghold");
  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      {stronghold && (() => { const p = project({ lat: stronghold.lat, lng: stronghold.lng }); if (!inside(p)) return null; const col = stronghold.holder ? factionColor(stronghold.holder) : C.dim; return (
        <Pressable key="sh" onPress={() => onSelect({ type: "stronghold", item: stronghold })} style={[s.hit, { left: p.x - 30, top: p.y - 30, width: 60, height: 60 }]} hitSlop={6}>
          <View style={[s.strong, { borderColor: col, shadowColor: col }, isSel("stronghold", stronghold.targetId) && { borderWidth: 3 }]}>
            <View style={[s.strongCore, { backgroundColor: col }]} />
          </View>
        </Pressable>); })()}
      {caches.map((c) => { const p = project({ lat: c.lat, lng: c.lng }); if (!inside(p)) return null; const ready = !c.readyAt; const col = c.heldBy ? factionColor(c.heldBy) : C.cyan; return (
        <Pressable key={c.id} onPress={() => onSelect({ type: "cache", item: c })} style={[s.hit, { left: p.x - 16, top: p.y - 16, width: 32, height: 32 }]} hitSlop={6}>
          <View style={[s.cache, { borderColor: col, opacity: ready ? 1 : 0.45 }, isSel("cache", c.id) && { backgroundColor: col + "55" }]} />
          {baited.has(c.id) && <View style={s.baitRing} />}
        </Pressable>); })}
      {pins.map((o) => { const p = project({ lat: o.lat, lng: o.lng }); if (!inside(p)) return null; return (
        <Pressable key={o.offerId} onPress={() => onSelect({ type: "pin", item: o })} style={[s.hit, { left: p.x - 18, top: p.y - 40, width: 36, height: 44 }]} hitSlop={6}>
          <View style={[s.pin, isSel("pin", o.offerId) && { borderColor: C.text }]}>
            <Text style={s.pinText}>{o.templateId === "DEAD_DROP" ? "◆" : o.templateId === "EXTRACTION" ? "▲" : "●"}</Text>
          </View>
          <View style={s.pinStem} />
        </Pressable>); })}
      {signals.map((sg) => { const p = project({ lat: sg.lat, lng: sg.lng }); if (!inside(p)) return null; const col = RARITY_COLOR[sg.rarity]; return (
        <Pressable key={sg.id} onPress={() => onSelect({ type: "signal", item: sg })} style={[s.hit, { left: p.x - 18, top: p.y - 18, width: 36, height: 36 }]} hitSlop={6}>
          <Animated.View style={[s.signalHalo, { borderColor: col, transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1.5] }) }], opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.7, 0] }) }]} />
          <View style={[s.signal, { backgroundColor: col }, isSel("signal", sg.id) && { borderWidth: 2, borderColor: C.text }]} />
        </Pressable>); })}
    </View>
  );
}

/** The strip under the map: what is near, nearest first, with footprints for distance. */
export function NearbyTracker({ signals, pins, selected, onSelect }: { signals: SignalView[]; pins: OfferPin[]; selected: Selection | null; onSelect: (s: Selection) => void }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  if (!signals.length && !pins.length) return <Text style={[s.mono, { marginTop: 8 }]}>NEARBY · nothing on the scope yet. Walk; signals spawn around you.</Text>;
  const feet = (m: number) => (m < 80 ? "▪" : m < 200 ? "▪▪" : m < 400 ? "▪▪▪" : "▪▪▪▪");
  return (
    <View style={{ marginTop: 8 }}>
      <Text style={s.mono}>NEARBY · {signals.length} SIGNAL{signals.length === 1 ? "" : "S"}{pins.length ? ` · ${pins.length} ORDER${pins.length === 1 ? "" : "S"}` : ""}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 6 }} contentContainerStyle={{ gap: 8 }}>
        {pins.map((o) => (
          <Pressable key={o.offerId} onPress={() => onSelect({ type: "pin", item: o })} style={[s.tile, { borderColor: C.amber }, selected?.type === "pin" && selected.item.offerId === o.offerId && s.tileOn]}>
            <Image source={ART.mission[o.templateId]} style={s.tileArt} />
            <Text style={[s.tileName, { color: C.amber }]} numberOfLines={1}>ORDER · {o.title.split(" · ")[0].toUpperCase()}</Text>
            <Text style={s.tileSub}>{Math.round(o.walkM)} m {feet(o.walkM)}</Text>
          </Pressable>
        ))}
        {signals.map((sg) => (
          <Pressable key={sg.id} onPress={() => onSelect({ type: "signal", item: sg })} style={[s.tile, { borderColor: RARITY_COLOR[sg.rarity] }, selected?.type === "signal" && selected.item.id === sg.id && s.tileOn]}>
            <Image source={signalArt(sg.kind, sg.art)} style={s.tileArt} />
            <Text style={[s.tileName, { color: RARITY_COLOR[sg.rarity] }]} numberOfLines={1}>{sg.name.toUpperCase()}</Text>
            <Text style={s.tileSub}>{sg.distanceM} m {feet(sg.distanceM)} · {fmtCountdown(sg.expiresAt, now)}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

/** The card for whatever is selected on the map, with the one action that makes sense from here. */
export function SelectionCard({ sel, dist, factionId, busy, onSpin, onCapture, onAccept, onDecline, onNavigate, onClose, bait, baitLeft, onPlant, rivals, tipsLeft, onFalseLead }: {
  sel: Selection; dist: number | null; factionId: string | null; busy: boolean;
  onSpin: () => void; onCapture: () => void; onAccept: () => void; onDecline: () => void; onNavigate: () => void; onClose: () => void;
  bait?: DistractionView[]; baitLeft?: number; onPlant?: () => void;
  rivals?: { id: string; chief: string; burned: boolean }[]; tipsLeft?: number; onFalseLead?: (toFaction: string) => void;
}) {
  const [leadOpen, setLeadOpen] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const near = dist != null && dist <= 40;
  if (sel.type === "cache") {
    const c = sel.item;
    return (
      <Dossier tab={c.heldBy ? factionColor(c.heldBy) : C.cyan}>
        <Text style={s.title}>CACHE · {c.name.toUpperCase()}</Text>
        <Text style={s.mono}>{c.kind.toUpperCase()} · {dist != null ? `${Math.round(dist)} M` : `${c.distanceM} M`}{c.heldBy ? ` · HELD BY ${c.heldByCodename ? c.heldByCodename.toUpperCase() + " · " : ""}${c.heldBy.toUpperCase()}` : ""}{c.readyAt ? ` · COLD, READY IN ${fmtCountdown(c.readyAt, now)}` : " · READY"}</Text>
        <Body dim>Inside 40 m, spin it for intel: cipher fragments, decoys, sometimes a jammer or a lens. Every five minutes.</Body>
        {(() => { const b = bait?.find((x) => x.targetId === c.id); return b ? <Text style={[s.mono, { color: C.amber }]}>BAIT · PLANTED BY {b.by.toUpperCase()} · RIVALS SEE A REAL ORDER HERE · {b.bites} BITE{b.bites === 1 ? "" : "S"} · FADES {fmtCountdown(b.expiresAt, now)}</Text> : null; })()}
        <View style={{ flexDirection: "row", gap: 8 }}>
          {near ? <Button title="Spin cache" onPress={onSpin} loading={busy} disabled={!!c.readyAt} style={{ flex: 1, marginTop: 0 }} /> : <Button title="Navigate" onPress={onNavigate} style={{ flex: 1, marginTop: 0 }} />}
          <Button title="Close" kind="ghost" onPress={onClose} style={{ marginTop: 0 }} />
        </View>
        {onPlant && !bait?.some((x) => x.targetId === c.id) && (
          <Button title={`Plant a distraction here · ${baitLeft ?? 0} left today`} kind="ghost" onPress={onPlant} disabled={(baitLeft ?? 0) <= 0 || busy} style={{ marginTop: 8, paddingVertical: 8 }} />
        )}
        {onFalseLead && rivals && !bait?.some((x) => x.targetId === c.id) && (
          !leadOpen ? <Button title={`Point one rival here · false lead · ${tipsLeft ?? 0} left`} kind="ghost" onPress={() => setLeadOpen(true)} disabled={(tipsLeft ?? 0) <= 0 || busy} style={{ marginTop: 6, paddingVertical: 8, borderColor: C.amber }} /> : (
            <View style={{ marginTop: 6 }}>
              <Text style={[s.mono, { color: C.amber }]}>AN UNSIGNED TIP TO ONE CHIEF. THEIR OPERATIVE WALKS HERE FOR NOTHING AND PAYS XP. TWO BURNS A DAY AND THAT CHIEF DROPS YOU.</Text>
              <View style={{ flexDirection: "row", gap: 6 }}>
                {rivals.map((r) => <Button key={r.id} title={`${r.chief}${r.burned ? " · burned" : ""}`} kind="ghost" disabled={r.burned || busy} onPress={() => { setLeadOpen(false); onFalseLead(r.id); }} style={{ flex: 1, paddingVertical: 8, marginTop: 4, borderColor: C.amber }} />)}
                <Button title="Cancel" kind="ghost" onPress={() => setLeadOpen(false)} style={{ paddingVertical: 8, marginTop: 4 }} />
              </View>
            </View>
          )
        )}
      </Dossier>
    );
  }
  if (sel.type === "signal") {
    const sg = sel.item;
    return (
      <Dossier tab={RARITY_COLOR[sg.rarity]}>
        <View style={{ flexDirection: "row", gap: 10 }}>
          <Image source={signalArt(sg.kind, sg.art)} style={{ width: 64, height: 64, borderWidth: 1, borderColor: C.line }} />
          <View style={{ flex: 1 }}>
            <Text style={[s.title, { color: RARITY_COLOR[sg.rarity] }]}>{sg.name.toUpperCase()} · {sg.rarity.toUpperCase()}</Text>
            <Text style={s.mono}>{dist != null ? `${Math.round(dist)} M` : `${sg.distanceM} M`} · FADES IN {fmtCountdown(sg.expiresAt, now)} · {sg.attemptsLeft} ATTEMPT{sg.attemptsLeft === 1 ? "" : "S"}</Text>
            <Typed style={{ marginTop: 4 }}>{sg.blurb}</Typed>
          </View>
        </View>
        <View style={{ flexDirection: "row", gap: 8 }}>
          {near ? <Button title="Capture" onPress={onCapture} loading={busy} disabled={sg.attemptsLeft <= 0} style={{ flex: 1, marginTop: 0 }} /> : <Button title="Navigate" onPress={onNavigate} style={{ flex: 1, marginTop: 0 }} />}
          <Button title="Close" kind="ghost" onPress={onClose} style={{ marginTop: 0 }} />
        </View>
      </Dossier>
    );
  }
  if (sel.type === "pin") {
    const o = sel.item;
    return (
      <Dossier tab={C.amber}>
        <View style={{ flexDirection: "row", gap: 10 }}>
          <Image source={ART.mission[o.templateId]} style={{ width: 64, height: 64, borderWidth: 1, borderColor: C.line }} />
          <View style={{ flex: 1 }}>
            <Text style={[s.title, { color: C.amber }]}>ORDER · {o.title.toUpperCase()}</Text>
            {o.chain && <Text style={[s.mono, { color: C.amber }]}>{o.chain.name.toUpperCase()} · LINK {o.chain.step} OF {o.chain.of}</Text>}
            {o.lock && <Text style={[s.mono, { color: C.amber }]}>{o.lock.label.toUpperCase()} · NEEDS A {o.lock.tool.toUpperCase()}</Text>}
            {o.crisis && <Text style={[s.mono, { color: C.amber }]}>CRISIS · {o.crisis.name.toUpperCase()} · {o.crisis.stance.toUpperCase()}{o.crisis.joint ? ` · JOINT OP WITH ${o.crisis.joint.toUpperCase()}` : ""}</Text>}
            <Text style={s.mono}>{o.targetName.toUpperCase()} · {Math.round(o.walkM)} M · {o.rewardXp} XP · ACCEPT WITHIN {fmtCountdown(o.acceptBy, now)}</Text>
          </View>
        </View>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Button title="Accept mission" onPress={onAccept} loading={busy} style={{ flex: 1.3, marginTop: 0 }} />
          <Button title="Decline" kind="ghost" onPress={onDecline} style={{ flex: 1, marginTop: 0 }} />
        </View>
      </Dossier>
    );
  }
  const st = sel.item;
  return (
    <Dossier tab={st.holder ? factionColor(st.holder) : C.dim}>
      <Text style={s.title}>STRONGHOLD · {st.name.toUpperCase()}</Text>
      <Text style={s.mono}>{st.holder ? `HELD BY ${st.holder.toUpperCase()}` : "UNHELD"} · {Object.entries(st.control).map(([f, n]) => `${f.toUpperCase()} ${n}`).join(" · ")}</Text>
      <Body dim>The agency holding the most sites in this sector owns the stronghold. Finish sites to tip it{st.holder && st.holder !== factionId ? "; it is theirs right now" : ""}.</Body>
      <Button title="Close" kind="ghost" onPress={onClose} style={{ marginTop: 0 }} />
    </Dossier>
  );
}

/** Spin ritual: the ring turns, then the haul. */
export function SpinSheet({ result, onDone }: { result: SpinResult | null; onDone: () => void }) {
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => { spin.setValue(0); Animated.timing(spin, { toValue: 1, duration: 1100, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(); }, [result]);
  return (
    <View style={s.modal}>
      <View style={s.sheet}>
        <Animated.View style={[s.ring, { transform: [{ rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "720deg"] }) }] }]}>
          <View style={s.ringTick} />
        </Animated.View>
        {result?.ok ? (
          <>
            <Text style={s.title}>CACHE OPENED</Text>
            {result.items?.map((it) => <Text key={it.id} style={[s.mono, { color: C.text, fontSize: 14 }]}>+{it.qty} {it.name.toUpperCase()}</Text>)}
            <Text style={[s.mono, { color: C.ok, marginTop: 6 }]}>+{result.xp} XP · +{result.credits} CREDITS</Text>
          </>
        ) : (
          <>
            <Text style={s.title}>NOTHING</Text>
            <Body dim>{result?.reason ?? "Too far."}</Body>
          </>
        )}
        <Button title="Back to the map" onPress={onDone} />
      </View>
    </View>
  );
}

/**
 * Capture ritual: a drifting signal; hold your finger on it to build a lock (3 s), then flick up to take it.
 * Hold quality (time on target, fewer slips) and the flick go to the server, which rolls the catch by rarity.
 */
export function CaptureRitual({ signal, busy, onAttempt, result, onRetry, onDone }: {
  signal: SignalView; busy: boolean; onAttempt: (hold: number, flick: boolean) => void; result: CaptureResult | null; onRetry: () => void; onDone: () => void;
}) {
  const col = RARITY_COLOR[signal.rarity];
  const drift = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const [lock, setLock] = useState(0); // 0..1
  const [slips, setSlips] = useState(0);
  const [armed, setArmed] = useState(false);
  const holding = useRef(false);
  const amp = signal.rarity === "legendary" ? 70 : signal.rarity === "rare" ? 55 : signal.rarity === "uncommon" ? 40 : 26;
  useEffect(() => {
    let alive = true;
    const wander = () => { if (!alive) return; Animated.timing(drift, { toValue: { x: (Math.random() - 0.5) * 2 * amp, y: (Math.random() - 0.5) * 2 * amp }, duration: 900 + Math.random() * 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }).start(wander); };
    wander();
    const t = setInterval(() => { if (holding.current) setLock((l) => Math.min(1, l + 0.05)); }, 150);
    return () => { alive = false; clearInterval(t); };
  }, []);
  useEffect(() => { if (lock >= 1 && !armed) setArmed(true); }, [lock]);
  const flick = Gesture.Pan().onEnd((e) => { if (armed && !busy && !result && e.translationY < -60) onAttempt(Math.max(0, 1 - slips * 0.15), true); }).runOnJS(true);
  const reset = () => { setLock(0); setSlips(0); setArmed(false); onRetry(); };
  return (
    <GestureDetector gesture={flick}>
      <View style={s.modal} collapsable={false}>
        <View style={{ alignItems: "center", paddingHorizontal: 20 }}>
          <Text style={[s.title, { color: col }]}>{signal.name.toUpperCase()} · {signal.rarity.toUpperCase()}</Text>
          <Text style={s.mono}>{result ? "" : armed ? "LOCKED · FLICK UP TO TAKE IT" : "HOLD THE SIGNAL TO BUILD A LOCK"}</Text>
        </View>
        <View style={{ width: 300, height: 300, alignItems: "center", justifyContent: "center" }}>
          <View style={[s.reticle, { borderColor: col + "66" }]} />
          <View style={[s.lockBar, { width: 240 }]}><View style={{ width: `${Math.round(lock * 100)}%`, height: "100%", backgroundColor: col }} /></View>
          {!result && (
            <Animated.View style={{ transform: drift.getTranslateTransform() }}>
              <Pressable
                onPressIn={() => { holding.current = true; }}
                onPressOut={() => { holding.current = false; if (!armed) setSlips((x) => x + 1); }}
                style={[s.blip, { backgroundColor: col, shadowColor: col }, armed && { borderWidth: 3, borderColor: C.text }]}
              >
                <Image source={signalArt(signal.kind, signal.art)} style={{ width: 84, height: 84, borderRadius: 42, opacity: 0.95 }} />
              </Pressable>
            </Animated.View>
          )}
          {result && (
            <View style={{ alignItems: "center" }}>
              <Stamp text={result.result === "captured" ? "Captured" : result.result === "fled" ? "Fled" : result.result === "too_far" ? "Too far" : result.result === "gone" ? "Gone" : "Slipped"} size={38} color={result.result === "captured" ? C.red : C.dim} />
              {result.result === "captured" && <Text style={[s.mono, { color: C.ok, marginTop: 10, fontSize: 14 }]}>+{result.xp} XP · {result.collection?.count} IN YOUR COLLECTION</Text>}
              {result.result === "escaped" && <Text style={[s.mono, { marginTop: 10 }]}>{result.attemptsLeft} ATTEMPT{result.attemptsLeft === 1 ? "" : "S"} LEFT</Text>}
              {result.result === "too_far" && <Text style={[s.mono, { marginTop: 10 }]}>{result.distanceM} M · GET INSIDE 40 M</Text>}
            </View>
          )}
        </View>
        <View style={{ flexDirection: "row", gap: 8, paddingHorizontal: 20 }}>
          {result?.result === "escaped" || result?.result === "too_far" ? <Button title="Try again" onPress={reset} style={{ flex: 1 }} /> : null}
          {armed && !result && <Button title="Take it" onPress={() => onAttempt(Math.max(0, 1 - slips * 0.15), false)} loading={busy} style={{ flex: 1 }} />}
          <Button title={result ? "Back to the map" : "Disengage"} kind="ghost" onPress={onDone} style={{ flex: 1 }} />
        </View>
      </View>
    </GestureDetector>
  );
}

const s = StyleSheet.create({
  hit: { position: "absolute", alignItems: "center", justifyContent: "center" },
  cache: { width: 14, height: 14, borderWidth: 2, transform: [{ rotate: "45deg" }], backgroundColor: "rgba(6,20,30,0.7)" },
  signal: { width: 12, height: 12, borderRadius: 6 },
  baitRing: { position: "absolute", width: 30, height: 30, borderRadius: 15, borderWidth: 2, borderColor: C.amber, borderStyle: "dashed" },
  signalHalo: { position: "absolute", width: 28, height: 28, borderRadius: 14, borderWidth: 2 },
  pin: { width: 26, height: 26, borderRadius: 13, backgroundColor: C.amber, borderWidth: 2, borderColor: C.ink, alignItems: "center", justifyContent: "center" },
  pinText: { color: C.ink, fontSize: 12, fontFamily: F.displayMed },
  pinStem: { width: 2, height: 12, backgroundColor: C.amber },
  strong: { width: 44, height: 44, borderRadius: 22, borderWidth: 2, alignItems: "center", justifyContent: "center", shadowOpacity: 0.9, shadowRadius: 12, backgroundColor: "rgba(6,20,30,0.5)" },
  strongCore: { width: 12, height: 12, borderRadius: 6 },
  mono: { color: C.dim, fontFamily: F.typed, fontSize: 11.5 },
  title: { color: C.cyan, fontFamily: F.displayMed, fontSize: 17, letterSpacing: 1.4 },
  tile: { width: 128, borderWidth: 1, backgroundColor: C.ink2, padding: 6 },
  tileOn: { backgroundColor: "#12303c" },
  tileArt: { width: "100%", height: 54, marginBottom: 4 },
  tileName: { fontFamily: F.displayMed, fontSize: 11, letterSpacing: 1 },
  tileSub: { color: C.dim, fontFamily: F.typed, fontSize: 10 },
  modal: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: "rgba(4,10,14,0.96)", alignItems: "center", justifyContent: "center", gap: 10, zIndex: 50 },
  sheet: { width: 320, borderWidth: 1, borderColor: C.line, backgroundColor: C.ink2, padding: 18, alignItems: "center", gap: 6 },
  ring: { width: 120, height: 120, borderRadius: 60, borderWidth: 3, borderColor: C.cyan, borderStyle: "dashed", alignItems: "center", marginBottom: 10 },
  ringTick: { width: 6, height: 18, backgroundColor: C.cyan, marginTop: -3 },
  reticle: { position: "absolute", width: 260, height: 260, borderRadius: 130, borderWidth: 1 },
  lockBar: { position: "absolute", bottom: 0, height: 4, backgroundColor: C.line },
  blip: { width: 92, height: 92, borderRadius: 46, alignItems: "center", justifyContent: "center", shadowOpacity: 0.9, shadowRadius: 18 },
});
