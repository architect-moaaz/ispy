import React, { useEffect, useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import type { BoardResponse, BountyCard as BountyT, Dispatch } from "@ispy/shared";
import { api } from "../api";
import { onLive } from "../live";
import { C, F, factionColor } from "../theme";
import { Body, Button, Display, Dossier as Panel, Screen, Spinner, fmtCountdown } from "../ui";
import { ART } from "../art";

/** Bounty board, the live global event, and the operative's inventory. */
export function Board() {
  const [data, setData] = useState<BoardResponse | null>(null);
  const [news, setNews] = useState<Dispatch[]>([]);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = () => Promise.all([api.board().then(setData), api.dispatches().then((r) => setNews(r.dispatches)).catch(() => {})]).catch((e) => setErr(e.message));
  useEffect(() => {
    load();
    const t = setInterval(() => setNow(Date.now()), 1000);
    const p = setInterval(load, 90000);
    const off = onLive((ty) => { if (ty.startsWith("bounty.") || ty.startsWith("world_event.") || ty === "director.dispatch" || ty === "reward") load(); });
    return () => { clearInterval(t); clearInterval(p); off(); };
  }, []);

  const claim = async (id: string) => {
    setBusy(id); setErr(null);
    try { await api.claimBounty(id); await load(); } catch (e: any) { setErr(e.message); } finally { setBusy(null); }
  };

  if (!data) return <Screen>{err ? <Body style={{ color: C.red }}>{err}</Body> : <Spinner />}</Screen>;
  const ev = data.event;

  return (
    <Screen>
      <Display>Bounty board</Display>
      <Text style={s.sub2}>Chief-issued contracts · non-cash rewards only</Text>

      {ev && (
        <View style={[s.banner, ev.state === "resolved" && { borderColor: C.dim }]}>
          <Image source={ART.splash} style={StyleSheet.absoluteFill} resizeMode="cover" />
          <LinearGradient colors={["rgba(10,14,20,0.2)", "rgba(10,14,20,0.92)"]} style={StyleSheet.absoluteFill} />
          <View style={{ padding: 14 }}>
            <Text style={s.eyebrow}>Global event · {ev.state === "active" ? "live" : "resolved"}</Text>
            <Text style={s.eventTitle}>{ev.name}</Text>
            {ev.state === "active"
              ? <Text style={s.countdown}>ENDS IN {fmtCountdown(ev.endsAt, now)}</Text>
              : <Text style={[s.countdown, { color: C.ok }]}>{ev.winner ? `${ev.winner.toUpperCase()} WON` : "NO WINNER"}</Text>}
            <Text style={[s.sub, { marginTop: 6 }]}>{ev.state === "resolved" && ev.epilogue ? ev.epilogue : ev.brief}</Text>
            <View style={{ marginTop: 10 }}>
              {ev.progress.map((p) => (
                <View key={p.factionId} style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <Text style={[s.factionLabel, { color: factionColor(p.factionId) }]}>{p.label}</Text>
                  <View style={s.progressBg}><View style={{ width: `${Math.round(p.value * 100)}%`, height: "100%", backgroundColor: factionColor(p.factionId) }} /></View>
                  <Text style={s.pct}>{p.fragments}/{p.of}</Text>
                </View>
              ))}
            </View>
          </View>
        </View>
      )}

      {news.length > 0 && (
        <>
          <Text style={s.section}>World dispatches</Text>
          {news.slice(0, 3).map((d) => (
            <Panel key={d.id} tab={d.factionId ? factionColor(d.factionId) : C.cyanDim} style={{ marginBottom: 8 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Text style={s.title}>{d.headline}</Text>
                <Text style={s.sub}>{new Date(d.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</Text>
              </View>
              <Text style={[s.sub, { color: C.text }]}>{d.body}</Text>
            </Panel>
          ))}
        </>
      )}
      <Text style={s.section}>Contracts</Text>
      {data.bounties.length === 0 && <Body dim>No contracts posted yet. The chiefs publish new ones every few minutes.</Body>}
      {data.bounties.map((b) => <BountyCard key={b.id} b={b} now={now} busy={busy === b.id} onClaim={() => claim(b.id)} />)}

      <Text style={s.section}>Inventory · {data.credits} credits</Text>
      <Panel tab={C.cyanDim}>
        {data.inventory.map((i, idx) => (
          <View key={i.id} style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 6, borderTopWidth: idx ? 1 : 0, borderTopColor: C.line }}>
            <View style={{ flex: 1 }}>
              <Text style={s.item}>{i.name}</Text>
              <Text style={s.sub}>{i.note}</Text>
            </View>
            <Text style={s.qty}>×{i.qty}</Text>
          </View>
        ))}
      </Panel>
      {err && <Body style={{ color: C.red, textAlign: "center" }}>{err}</Body>}
    </Screen>
  );
}

function BountyCard({ b, now, busy, onClaim }: { b: BountyT; now: number; busy: boolean; onClaim: () => void }) {
  const color = b.status === "ACTIVE" ? C.ok : b.status === "COMPLETED" ? C.cyan : b.status === "LOCKED" ? C.dim : C.cyan;
  return (
    <Panel tab={color} style={{ marginBottom: 10 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
        <View style={{ flex: 1 }}>
          <Text style={s.eyebrow}>{b.type}{b.squad ? " · SQUAD" : ""} · from {b.issuer.toUpperCase()}{b.factionId ? "" : " · all agencies"}</Text>
          <Text style={s.title}>{b.title}</Text>
        </View>
        <Text style={[s.status, { color, borderColor: color }]}>{b.status}</Text>
      </View>
      <Text style={[s.sub, { marginVertical: 4 }]}>{b.brief}</Text>
      {b.status === "ACTIVE" && (
        <View style={{ marginBottom: 6 }}>
          <View style={s.progressBg}><View style={{ width: `${Math.round((b.progress.done / b.progress.of) * 100)}%`, height: "100%", backgroundColor: C.ok }} /></View>
          <Text style={s.sub}>{b.progress.done} of {b.progress.of}</Text>
        </View>
      )}
      <View style={{ flexDirection: "row", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <Text style={s.tag}>{b.reward.xp} XP</Text>
        {b.reward.credits > 0 && <Text style={s.tag}>{b.reward.credits} CREDITS</Text>}
        {b.status === "LOCKED" && <Text style={[s.tag, { color: C.dim, borderColor: C.line }]}>needs {b.minRank.replace("_", " ")}</Text>}
        <Text style={[s.sub, { marginLeft: "auto" }]}>expires {fmtCountdown(b.expiresAt, now)}</Text>
      </View>
      {b.status === "ELIGIBLE" && <Button title="Claim contract" onPress={onClaim} loading={busy} style={{ marginTop: 10, paddingVertical: 10 }} />}
    </Panel>
  );
}

const s = StyleSheet.create({
  sub2: { color: C.dim, fontFamily: F.displayMed, fontSize: 12, letterSpacing: 1.4, textTransform: "uppercase", textAlign: "center", marginBottom: 12 },
  banner: { minHeight: 250, borderWidth: 1, borderColor: C.cyan + "88", overflow: "hidden", marginBottom: 14, justifyContent: "flex-end" },
  eyebrow: { color: C.cyanDim, fontFamily: F.displayMed, fontSize: 11, letterSpacing: 1.4, textTransform: "uppercase" },
  eventTitle: { color: C.cyan, fontFamily: F.display, fontSize: 34, lineHeight: 36, letterSpacing: 2, textShadowColor: C.cyan, textShadowRadius: 16, textShadowOffset: { width: 0, height: 0 } },
  countdown: { color: C.text, fontFamily: F.typed, fontSize: 13 },
  sub: { color: C.dim, fontSize: 13, lineHeight: 18 },
  factionLabel: { fontFamily: F.displayMed, fontSize: 12, letterSpacing: 1.2, width: 72 },
  progressBg: { flex: 1, height: 8, backgroundColor: C.ink, borderWidth: 1, borderColor: C.line, overflow: "hidden" },
  pct: { color: C.text, fontFamily: F.typed, fontSize: 12, width: 36, textAlign: "right" },
  section: { color: C.cyan, fontFamily: F.displayMed, fontSize: 13, letterSpacing: 1.6, textTransform: "uppercase", marginBottom: 8, marginTop: 4 },
  title: { color: C.text, fontFamily: F.displayMed, fontSize: 20, lineHeight: 22, letterSpacing: 1, textTransform: "uppercase" },
  status: { fontFamily: F.displayMed, fontSize: 11, letterSpacing: 1.4, borderWidth: 1, paddingHorizontal: 6, paddingVertical: 2 },
  tag: { color: C.cyan, fontFamily: F.displayMed, fontSize: 12, letterSpacing: 1.2, borderWidth: 1, borderColor: C.cyanDim, paddingHorizontal: 6, paddingVertical: 2 },
  item: { color: C.text, fontFamily: F.displayMed, fontSize: 16, letterSpacing: 0.8 },
  qty: { color: C.cyan, fontFamily: F.display, fontSize: 22 },
});
