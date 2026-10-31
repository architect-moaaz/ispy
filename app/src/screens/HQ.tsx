import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import type { BackChannelOptions, Briefing, ChatMessage } from "@ispy/shared";
import { api } from "../api";
import { onLive } from "../live";
import { C, F, factionColor } from "../theme";
import { Body, Button, Hero, Input, Label, Screen, Spinner, Surface } from "../ui";
import { ART } from "../art";

const SPECIALTY: Record<string, string> = {
  oracle: "Investigation, evidence and pattern recognition",
  ghost: "Decoys, stealth and misdirection",
  nexus: "Cryptography and systems",
};

export function HQ({ factionId, onDuty }: { factionId: string | null; onDuty: () => void }) {
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // The chat is part of the page, newest at the bottom: the latest few are always in view and
  // earlier ones unfold above on request, so the page scroll is the only scroll.
  const [showAll, setShowAll] = useState(false);
  const RECENT = 8;

  const load = async () => {
    try {
      const [b, m] = await Promise.all([api.briefing(), api.messages()]);
      setBriefing(b); setMessages(m.messages);
    } catch (e: any) { setErr(e.message); }
  };
  useEffect(() => { load(); return onLive((t) => { if (t === "chief.message" || t === "reward" || t === "rank_up" || t === "leak.delivered") load(); }); }, []);

  const send = async () => {
    const t = text.trim();
    if (!t) return;
    setBusy(true); setText("");
    setMessages((m) => [...m, { id: `local-${Date.now()}`, role: "player", text: t, at: new Date().toISOString() }]);
    try { const r = await api.sendMessage(t); setMessages((m) => [...m, r.reply]); }
    catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const color = factionColor(factionId);
  const lastLine = [...messages].reverse().find((m) => m.role === "chief")?.text ?? null;
  if (!briefing) return <Screen>{err ? <Body style={{ color: C.red }}>{err}</Body> : <Spinner />}</Screen>;
  const pct = Math.min(1, briefing.standing.xp / Math.max(1, briefing.standing.nextRankAt));

  return (
    <Screen>
      <Hero source={ART.portrait[factionId ?? "cipher"]} height={300}>
        <Text style={{ color, fontSize: 13, marginBottom: 2 }}>{briefing.factionName} · your chief</Text>
        <Text style={{ color: C.text, fontFamily: F.displayMed, fontSize: 40, lineHeight: 42 }}>{briefing.chiefName}</Text>
        <Text style={{ color: C.dim, fontSize: 13, marginBottom: 8 }}>{SPECIALTY[briefing.chief]}</Text>
        {lastLine && <Text style={{ color: C.text, fontFamily: F.typed, fontSize: 13.5, lineHeight: 19 }} numberOfLines={3}>“{lastLine}”</Text>}
      </Hero>
      {briefing.today && (
        <Surface accent={C.amber}>
          <Label color={C.amber}>Today{briefing.today.sector ? ` in ${briefing.today.sector}` : ""}</Label>
          {briefing.today.firstTimer && <Body dim>Your first assignment is on the Missions tab: break one intercept, then the nearest site in the field.</Body>}
          {briefing.today.hotWindow && <Body dim>Sector goes hot: {briefing.today.hotWindow}. Be deployed before it starts.</Body>}
          {briefing.today.crisis && <Body dim>Live crisis: {briefing.today.crisis.name}. Orders: {briefing.today.crisis.stance ?? "stand by"}{briefing.today.crisis.allies.length ? ` with ${briefing.today.crisis.allies.join(" + ")}` : ""}.</Body>}
          {briefing.today.operation && <Body dim>Your operation: {briefing.today.operation.name}, link {briefing.today.operation.step} of {briefing.today.operation.of}.</Body>}
          {briefing.today.nemesis && <Text style={{ color: factionColor(briefing.today.nemesis.factionId), fontFamily: F.displayMed, fontSize: 13, letterSpacing: 1.4, marginTop: 4 }}>NEMESIS · {briefing.today.nemesis.codename.toUpperCase()} OF {briefing.today.nemesis.faction} · YOU {briefing.today.nemesis.wins} – {briefing.today.nemesis.losses} THEM</Text>}
          {briefing.today.operativeOfTheWeek && <Text style={{ color: C.amber, fontFamily: F.displayMed, fontSize: 13, letterSpacing: 1.4, marginTop: 4 }}>OPERATIVE OF THE WEEK · {briefing.today.operativeOfTheWeek.toUpperCase()}</Text>}
          {briefing.today.titles.length > 0 && <Text style={{ color: C.cyan, fontFamily: F.displayMed, fontSize: 13, letterSpacing: 1.4, marginTop: 4 }}>YOUR TITLES · {briefing.today.titles.map((t) => t.toUpperCase()).join(" · ")}</Text>}
          <Text style={{ fontSize: 12.5, color: C.dim, marginTop: 4 }}>
            Sector control: {Object.entries(briefing.today.control).map(([f, n]) => `${f.toUpperCase()} ${n}`).join(", ")}
          </Text>
        </Surface>
      )}
      <Surface>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: C.cyan }} />
          <Label style={{ marginBottom: 0 }}>Encrypted link to {briefing.chiefName}</Label>
        </View>
        {messages.length > RECENT && (
          <Pressable onPress={() => setShowAll((v) => !v)} style={{ paddingVertical: 8, alignItems: "center", borderBottomWidth: 1, borderBottomColor: C.hair, marginBottom: 8 }}>
            <Text style={[s.eyebrow, { color: C.cyan }]}>{showAll ? "Hide earlier messages" : `Show ${messages.length - RECENT} earlier message${messages.length - RECENT === 1 ? "" : "s"}`}</Text>
          </Pressable>
        )}
        <View>
          {messages.length === 0 && <Body dim>Nothing yet. Your chief is listening.</Body>}
          {(showAll ? messages : messages.slice(-RECENT)).map((m) => m.role === "leak" ? (
            <View key={m.id} style={{ marginBottom: 8, alignSelf: "stretch" }}>
              <Text style={[s.eyebrow, { color: C.amber }]}>Unknown source · no return path · {new Date(m.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</Text>
              <View style={{ backgroundColor: "rgba(255,170,0,0.07)", borderWidth: 1, borderStyle: "dashed", borderColor: C.amber, borderRadius: 12, padding: 11 }}>
                <Text style={{ color: C.text, fontFamily: F.typed, fontSize: 14.5, lineHeight: 21 }}>{m.text}</Text>
                <Text style={{ color: C.dim, fontFamily: F.typed, fontSize: 11, marginTop: 4 }}>Unsigned. Could be a gift, could be a hook. Your chief has not seen it.</Text>
              </View>
            </View>
          ) : (
            <View key={m.id} style={{ marginBottom: 8, alignSelf: m.role === "player" ? "flex-end" : "flex-start", maxWidth: "92%" }}>
              <Text style={[s.eyebrow, { marginBottom: 3, textAlign: m.role === "player" ? "right" : "left" }]}>{m.role === "player" ? "You" : briefing.chiefName} · {new Date(m.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</Text>
              <View style={{ backgroundColor: m.role === "player" ? C.cyanGlow : C.slate2, borderRadius: 12, borderTopLeftRadius: m.role === "player" ? 12 : 3, borderTopRightRadius: m.role === "player" ? 3 : 12, padding: 11 }}>
                <Text style={{ color: C.text, fontSize: 15, lineHeight: 21, fontFamily: m.role === "chief" ? F.typed : undefined }}>{m.text}</Text>
              </View>
            </View>
          ))}
        </View>
        <View style={{ flexDirection: "row", gap: 8, marginTop: 6 }}>
          <Input value={text} onChangeText={setText} placeholder="Message your chief" style={{ flex: 1, marginBottom: 0 }} onSubmitEditing={send} />
          <Button title="Send" onPress={send} loading={busy} style={{ marginTop: 0 }} />
        </View>
      </Surface>

      <BackChannel />

      <Surface>
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <Gauge label="Chief's trust" value={briefing.standing.trust / 100} text={`${briefing.standing.trust}%`} color={color} />
          <Gauge label="Next rank" value={briefing.standing.xp / Math.max(1, briefing.standing.nextRankAt)} text={briefing.standing.rank.replace("_", " ")} color={C.cyan} sub={`${briefing.standing.xp} / ${briefing.standing.nextRankAt} XP`} />
        </View>
        <View style={{ marginTop: 10, borderTopWidth: 1, borderTopColor: C.hair, paddingTop: 8 }}>
          <Label>Standing orders</Label>
          <Text style={{ color: C.text, fontFamily: F.typed, fontSize: 13.5, lineHeight: 19 }}>{briefing.headline}</Text>
        </View>
      </Surface>
      <View style={s.drawer}>
        <Button title="Open the mission board" onPress={onDuty} style={{ paddingVertical: 16, marginTop: 0 }} />
      </View>
      {err && <Body style={{ color: C.red }}>{err}</Body>}
    </Screen>
  );
}

/**
 * The back channel: a wire to a rival chief that does not carry your name. Sell a live route (a teammate's
 * or your own) for credits from an unknown account. Always open; two tips a day, shared with false leads
 * planted from the map. Chiefs are not fools: a source that burns them twice is dropped.
 */
function BackChannel() {
  const [opts, setOpts] = useState<BackChannelOptions | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [ref, setRef] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const load = async () => { try { const o = await api.backchannel(); setOpts(o); setTo((t) => t ?? o.rivals.find((r) => !r.burned)?.id ?? null); } catch { /* no faction yet */ } };
  useEffect(() => { load(); return onLive((t) => { if (t === "mission.accepted" || t === "mission.verified" || t === "reward") load(); }); }, []);
  const send = async () => {
    if (!to || !ref) return;
    setBusy(true); setMsg(null);
    try { const r = await api.sendTip(to, "sell", ref); setMsg(r.ok ? `Sold. ${r.credits} credits landed from an account nobody can trace. ${r.left} left today.` : r.reason ?? "No."); if (r.ok) { setRef(null); load(); } }
    catch (e: any) { setMsg(e.message); } finally { setBusy(false); }
  };
  return (
    <Surface accent={C.amber}>
      <Label color={C.amber}>Back channel, unsigned</Label>
      <Body dim>Sell a live route to a rival chief for 40 credits, unsigned. Their operative turns up at that target.</Body>
      {!opts ? <Spinner /> : (
        <>
          <Label style={{ marginTop: 6 }}>To which chief · {opts.left} tip{opts.left === 1 ? "" : "s"} left today</Label>
          <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
            {opts.rivals.map((r) => <Button key={r.id} title={`${r.chief}${r.burned ? " · burned" : ""}`} kind={to === r.id ? "primary" : "ghost"} disabled={r.burned} onPress={() => setTo(r.id)} style={{ paddingVertical: 8, paddingHorizontal: 12, marginTop: 4 }} />)}
          </View>
          <Label style={{ marginTop: 8 }}>Whose route</Label>
          {opts.routes.length === 0 ? <Body dim>Nobody in your agency is walking a route right now, you included. Accept an order on the Missions tab, then come back and sell it.</Body> : opts.routes.map((c) => (
            <Button key={c.missionId} title={c.label} kind={ref === c.missionId ? "primary" : "ghost"} onPress={() => setRef(c.missionId)} style={{ paddingVertical: 8, marginTop: 4 }} />
          ))}
          <Button title="Sell it · 40 cr" onPress={send} loading={busy} disabled={!to || !ref || opts.left <= 0} style={{ marginTop: 8 }} />
          {msg && <Body style={{ color: C.amber }}>{msg}</Body>}
          {opts.recent.length > 0 && <Text style={{ color: C.dim, fontFamily: F.typed, fontSize: 11.5, marginTop: 6 }}>{opts.recent.map((r) => `${r.kind === "sell" ? "SOLD" : "FALSE LEAD"} · ${r.about} → ${r.to} · ${r.outcome.toUpperCase()}`).join("\n")}</Text>}
        </>
      )}
    </Surface>
  );
}

function Gauge({ label, value, text, color, sub }: { label: string; value: number; text: string; color: string; sub?: string }) {
  const r = 26, c = 2 * Math.PI * r;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: 1 }}>
      <Svg width={64} height={64}>
        <Circle cx={32} cy={32} r={r} stroke={C.line} strokeWidth={5} fill="none" />
        <Circle cx={32} cy={32} r={r} stroke={color} strokeWidth={5} fill="none" strokeDasharray={`${c * Math.max(0, Math.min(1, value))} ${c}`} strokeLinecap="butt" rotation={-90} origin="32, 32" />
      </Svg>
      <View style={{ flex: 1 }}>
        <Text style={s.eyebrow}>{label}</Text>
        <Text style={[s.big, { color, fontSize: 20 }]} numberOfLines={1}>{text}</Text>
        {sub && <Text style={s.sub} numberOfLines={1}>{sub}</Text>}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  eyebrow: { color: C.dim, fontSize: 11.5, letterSpacing: 0.2, marginBottom: 3 },
  big: { color: C.text, fontFamily: F.displayMed, fontSize: 24, lineHeight: 26, letterSpacing: 1, textTransform: "uppercase" },
  sub: { color: C.dim, fontSize: 13 },
  drawer: { marginTop: 4 },
  section: { color: C.cyan, fontFamily: F.displayMed, fontSize: 13, letterSpacing: 1.6, textTransform: "uppercase", marginBottom: 6, marginTop: 4, textAlign: "center" },
});
