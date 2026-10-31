import React, { useEffect, useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import type { BoardResponse, BountyCard as BountyT, CrisisView, Dispatch, LadderResponse, WorldStatus } from "@ispy/shared";
import { api } from "../api";
import { onLive } from "../live";
import { C, F, factionColor } from "../theme";
import { Body, Button, Display, Panel, Screen, Spinner, fmtCountdown } from "../ui";
import { ART } from "../art";

/** Bounty board, the live global event, and the operative's inventory. */
export function Board() {
  const [data, setData] = useState<BoardResponse | null>(null);
  const [news, setNews] = useState<Dispatch[]>([]);
  const [crisis, setCrisis] = useState<CrisisView | null>(null);
  const [world, setWorld] = useState<WorldStatus | null>(null);
  const [ladder, setLadder] = useState<LadderResponse | null>(null);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = () => Promise.all([api.board().then(setData), api.dispatches().then((r) => setNews(r.dispatches)).catch(() => {}), api.crisis().then((r) => setCrisis(r.crisis)).catch(() => {}), api.world().then(setWorld).catch(() => {}), api.ladder().then(setLadder).catch(() => {})]).catch((e) => setErr(e.message));
  useEffect(() => {
    load();
    const t = setInterval(() => setNow(Date.now()), 1000);
    const p = setInterval(load, 90000);
    const off = onLive((ty) => { if (ty.startsWith("bounty.") || ty.startsWith("world_event.") || ty.startsWith("crisis.") || ty === "director.dispatch" || ty === "reward") load(); });
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
      <Display>The board</Display>
      <Text style={s.sub2}>The war this week, the ladder, and contracts worth taking.</Text>

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

      {ladder && (
        <View style={s.control}>
          <Text style={s.eyebrow}>Sector ladder · {ladder.sector ?? "your sector"} · {ladder.week}{ladder.yourRank ? ` · you are #${ladder.yourRank}` : " · not on it yet"}</Text>
          {ladder.rows.length === 0 && <Text style={[s.site, { color: C.dim, marginTop: 4 }]}>Nobody has scored this week. Hold a site, win a face-off, capture a signal.</Text>}
          {ladder.rows.map((r, i) => (
            <View key={r.codename} style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 5, backgroundColor: r.you ? "#12303c" : "transparent" }}>
              <Text style={[s.site, { width: 22, color: C.dim }]}>{i + 1}</Text>
              <Text style={[s.site, { flex: 1, color: factionColor(r.factionId), fontFamily: F.displayMed, letterSpacing: 1 }]} numberOfLines={1}>{r.codename.toUpperCase()}{r.title ? `  · ${r.title.toUpperCase()}` : ""}</Text>
              <Text style={[s.site, { color: C.dim }]} numberOfLines={1}>{r.held} held · {r.wins} won · {r.captures} caught</Text>
              <Text style={[s.site, { width: 34, textAlign: "right", color: C.text }]}>{r.score}</Text>
            </View>
          ))}
          <Text style={[s.site, { color: C.dim, marginTop: 6 }]}>Sites held, face-offs won, signals caught. Resets Monday.</Text>
        </View>
      )}
      {world?.control && Object.values(world.control).some((c) => Object.values(c).some((n) => n > 0)) && (
        <View style={s.control}>
          <Text style={s.eyebrow}>Sector control · a finished site is held for two hours</Text>
          {world.areas.filter((a) => Object.values(world.control![a.id] ?? {}).some((n) => n > 0)).map((a) => (
            <View key={a.id} style={{ flexDirection: "row", gap: 12, marginTop: 4, flexWrap: "wrap" }}>
              <Text style={[s.site, { color: C.dim, width: 120 }]}>{a.name.toUpperCase()}</Text>
              {Object.entries(world.control![a.id]).map(([f, n]) => <Text key={f} style={[s.site, { color: factionColor(f as any) }]}>{f.toUpperCase()} {n}</Text>)}
            </View>
          ))}
        </View>
      )}

      {crisis && (
        <View style={[s.crisis, crisis.state !== "active" && { borderColor: C.dim }]}>
          <Text style={[s.eyebrow, { color: C.amber }]}>Chaos · {crisis.areaName} · {crisis.state === "active" ? `ends in ${fmtCountdown(crisis.endsAt, now)}` : crisis.outcome?.verdict ?? crisis.state}</Text>
          <Text style={s.eventTitle}>{crisis.name}</Text>
          <Text style={[s.sub, { marginTop: 4 }]}>{crisis.state !== "active" && crisis.outcome ? crisis.outcome.epilogue : crisis.premise}</Text>
          {crisis.yourStance && crisis.state === "active" && (
            <Text style={[s.stance]}>YOUR ORDERS: {crisis.yourStance.toUpperCase()}{crisis.allies.length ? ` · PACT WITH ${crisis.allies.join(" + ").toUpperCase()}` : ""}</Text>
          )}
          {crisis.pacts.length > 0 && <Text style={[s.sub, { marginTop: 6, color: C.amber }]}>PACT: {crisis.pacts.join(" · ").toUpperCase()}</Text>}
          <View style={{ flexDirection: "row", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
            {crisis.stances.map((st) => <Text key={st.factionId} style={[s.factionLabel, { color: factionColor(st.factionId) }]}>{st.label} · {st.stance}</Text>)}
          </View>
          <View style={{ marginTop: 8 }}>
            {crisis.sites.map((site) => (
              <View key={site.name} style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 3 }}>
                <Text style={s.site}>{site.name.toUpperCase()}</Text>
                <Text style={[s.site, { color: site.claimedByFaction ? factionColor(site.claimedByFaction) : C.dim }]}>{site.claimedBy ? `${site.claimedBy} · ${site.stance}` : "open"}</Text>
              </View>
            ))}
          </View>
          <Text style={[s.sub, { marginTop: 6, color: C.dim }]}>Sector chaos {crisis.chaos}/10 · crisis missions are on your board; pact allies can run each other's.</Text>
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
      {b.status === "ELIGIBLE" && <Button title="Take it" kind="ghost" onPress={onClaim} loading={busy} style={{ marginTop: 8, paddingVertical: 8 }} />}
    </Panel>
  );
}

const s = StyleSheet.create({
  control: { borderRadius: 14, backgroundColor: C.ink2, padding: 14, marginBottom: 12 },
  crisis: { borderRadius: 14, borderLeftWidth: 3, borderColor: C.amber, backgroundColor: C.ink2, padding: 14, marginBottom: 12 },
  stance: { color: C.amber, fontFamily: F.displayMed, fontSize: 13, letterSpacing: 1.6, marginTop: 8 },
  site: { color: C.text, fontFamily: F.typed, fontSize: 11.5 },
  sub2: { color: C.dim, fontSize: 13, marginTop: -4, marginBottom: 12 },
  banner: { minHeight: 250, borderRadius: 16, overflow: "hidden", marginBottom: 12, justifyContent: "flex-end", backgroundColor: C.ink2 },
  eyebrow: { color: C.cyanDim, fontFamily: F.displayMed, fontSize: 11, letterSpacing: 1.4, textTransform: "uppercase" },
  eventTitle: { color: C.cyan, fontFamily: F.display, fontSize: 34, lineHeight: 36, letterSpacing: 2, textShadowColor: C.cyan, textShadowRadius: 16, textShadowOffset: { width: 0, height: 0 } },
  countdown: { color: C.text, fontFamily: F.typed, fontSize: 13 },
  sub: { color: C.dim, fontSize: 13, lineHeight: 18 },
  factionLabel: { fontFamily: F.displayMed, fontSize: 12, letterSpacing: 1.2, width: 72 },
  progressBg: { flex: 1, height: 8, borderRadius: 4, backgroundColor: C.ink, overflow: "hidden" },
  pct: { color: C.text, fontFamily: F.typed, fontSize: 12, width: 36, textAlign: "right" },
  section: { color: C.cyan, fontFamily: F.displayMed, fontSize: 13, letterSpacing: 1.6, textTransform: "uppercase", marginBottom: 8, marginTop: 4 },
  title: { color: C.text, fontFamily: F.displayMed, fontSize: 20, lineHeight: 22, letterSpacing: 1, textTransform: "uppercase" },
  status: { fontFamily: F.displayMed, fontSize: 11, letterSpacing: 1, borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  tag: { color: C.cyan, fontFamily: F.displayMed, fontSize: 12, letterSpacing: 0.6, backgroundColor: C.cyanGlow, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  item: { color: C.text, fontFamily: F.displayMed, fontSize: 16, letterSpacing: 0.8 },
  qty: { color: C.cyan, fontFamily: F.display, fontSize: 22 },
});
