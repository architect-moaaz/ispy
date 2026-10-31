import React, { useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, View, type ScrollViewInstance } from "react-native";
import Svg, { Circle } from "react-native-svg";
import type { BackChannelOptions, Briefing, ChatMessage } from "@ispy/shared";
import { api } from "../api";
import { onLive } from "../live";
import { C, F, factionColor } from "../theme";
import { Body, Button, Display, Dossier, Input, Screen, Spinner } from "../ui";
import { ChiefBanner, FactionEmblem } from "../graphics";

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
  const scrollRef = useRef<ScrollViewInstance>(null);

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
    finally { setBusy(false); setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50); }
  };

  const color = factionColor(factionId);
  if (!briefing) return <Screen>{err ? <Body style={{ color: C.red }}>{err}</Body> : <Spinner />}</Screen>;
  const pct = Math.min(1, briefing.standing.xp / Math.max(1, briefing.standing.nextRankAt));

  return (
    <Screen>
      <Display color={color}>{briefing.chiefName} HQ ({briefing.factionName} faction)</Display>
      {briefing.today && (
        <Dossier tab={C.amber}>
          <Text style={{ fontFamily: F.displayMed, fontSize: 13, color: C.amber, letterSpacing: 1.6 }}>TODAY{briefing.today.sector ? ` · ${briefing.today.sector.toUpperCase()}` : ""}</Text>
          {briefing.today.firstTimer && <Body dim>Your first assignment is on the Missions tab: break one intercept, then the nearest site in the field.</Body>}
          {briefing.today.hotWindow && <Body dim>Sector goes hot: {briefing.today.hotWindow}. Be deployed before it starts.</Body>}
          {briefing.today.crisis && <Body dim>Live crisis: {briefing.today.crisis.name}. Orders: {briefing.today.crisis.stance ?? "stand by"}{briefing.today.crisis.allies.length ? ` with ${briefing.today.crisis.allies.join(" + ")}` : ""}.</Body>}
          {briefing.today.operation && <Body dim>Your operation: {briefing.today.operation.name}, link {briefing.today.operation.step} of {briefing.today.operation.of}.</Body>}
          {briefing.today.nemesis && <Text style={{ color: factionColor(briefing.today.nemesis.factionId), fontFamily: F.displayMed, fontSize: 13, letterSpacing: 1.4, marginTop: 4 }}>NEMESIS · {briefing.today.nemesis.codename.toUpperCase()} OF {briefing.today.nemesis.faction} · YOU {briefing.today.nemesis.wins} – {briefing.today.nemesis.losses} THEM</Text>}
          {briefing.today.operativeOfTheWeek && <Text style={{ color: C.amber, fontFamily: F.displayMed, fontSize: 13, letterSpacing: 1.4, marginTop: 4 }}>OPERATIVE OF THE WEEK · {briefing.today.operativeOfTheWeek.toUpperCase()}</Text>}
          {briefing.today.titles.length > 0 && <Text style={{ color: C.cyan, fontFamily: F.displayMed, fontSize: 13, letterSpacing: 1.4, marginTop: 4 }}>YOUR TITLES · {briefing.today.titles.map((t) => t.toUpperCase()).join(" · ")}</Text>}
          <Text style={{ fontFamily: F.typed, fontSize: 11.5, color: C.dim }}>
            SECTOR CONTROL · {Object.entries(briefing.today.control).map(([f, n]) => `${f.toUpperCase()} ${n}`).join(" · ")}
          </Text>
        </Dossier>
      )}
      <Dossier tab={color} style={{ marginTop: 8 }}>
        <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
          <FactionEmblem id={factionId} size={52} />
          <View style={{ flex: 1 }}>
            <Text style={s.eyebrow}>Intelligence chief</Text>
            <Text style={s.big}>Chief {briefing.chiefName}</Text>
            <Text style={s.sub}>{SPECIALTY[briefing.chief]}</Text>
          </View>
        </View>
      </Dossier>
      <View style={{ marginBottom: 12 }}><ChiefBanner factionId={factionId} height={210} /></View>

      <Text style={s.section}>[ Encrypted link · active ]</Text>
      <Dossier tab={C.cyanDim} style={{ padding: 0 }}>
        <ScrollView ref={scrollRef} style={{ maxHeight: 300 }} onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}>
          {messages.length === 0 && <Body dim>Nothing yet. Your chief is listening.</Body>}
          {messages.map((m) => m.role === "leak" ? (
            <View key={m.id} style={{ marginBottom: 8, alignSelf: "stretch" }}>
              <Text style={[s.eyebrow, { color: C.amber }]}>UNKNOWN SOURCE · NO RETURN PATH · {new Date(m.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</Text>
              <View style={{ backgroundColor: "rgba(255,179,71,0.07)", borderWidth: 1, borderStyle: "dashed", borderColor: C.amber, padding: 10 }}>
                <Text style={{ color: C.text, fontFamily: F.typed, fontSize: 14.5, lineHeight: 21 }}>{m.text}</Text>
                <Text style={{ color: C.dim, fontFamily: F.typed, fontSize: 11, marginTop: 4 }}>Unsigned. Could be a gift, could be a hook. Your chief has not seen it.</Text>
              </View>
            </View>
          ) : (
            <View key={m.id} style={{ marginBottom: 8, alignSelf: m.role === "player" ? "flex-end" : "flex-start", maxWidth: "92%" }}>
              <Text style={[s.eyebrow, { textAlign: m.role === "player" ? "right" : "left" }]}>{m.role === "player" ? "You" : briefing.chiefName} · {new Date(m.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</Text>
              <View style={{ backgroundColor: m.role === "player" ? C.cyanGlow : C.paper2, borderWidth: 1, borderColor: m.role === "player" ? C.cyan : C.line, padding: 10 }}>
                <Text style={{ color: C.text, fontSize: 15, lineHeight: 21 }}>{m.text}</Text>
              </View>
            </View>
          ))}
        </ScrollView>
        <View style={{ flexDirection: "row", gap: 8, marginTop: 6 }}>
          <Input value={text} onChangeText={setText} placeholder="Message your chief" style={{ flex: 1, marginBottom: 0 }} onSubmitEditing={send} />
          <Button title="Send" onPress={send} loading={busy} style={{ marginTop: 0 }} />
        </View>
      </Dossier>

      <BackChannel />

      <Dossier tab={color}>
        <View style={{ flexDirection: "row", justifyContent: "space-around" }}>
          <Gauge label="Trust score" value={briefing.standing.trust / 100} text={`${briefing.standing.trust}%`} color={color} />
          <Gauge label="Cover integrity" value={0.94} text="94%" color={C.cyan} sub={`rank ${briefing.standing.rank.replace("_", " ")} · ${briefing.standing.xp}/${briefing.standing.nextRankAt} XP`} />
        </View>
      </Dossier>

      <Text style={s.section}>Active strategic orders</Text>
      <Dossier tab={C.cyan}>
        <Text style={{ color: C.text, fontFamily: F.typed, fontSize: 14.5, lineHeight: 21 }}>{briefing.headline}</Text>
        {briefing.recent.length > 0 && (
          <View style={{ marginTop: 8, borderTopWidth: 1, borderTopColor: C.line, paddingTop: 6 }}>
            {briefing.recent.slice(0, 4).map((r, i) => <Text key={i} style={{ color: C.dim, fontFamily: F.typed, fontSize: 12, marginBottom: 2 }}>{r}</Text>)}
          </View>
        )}
      </Dossier>
      <View style={s.drawer}>
        <Button title="Accept mission" onPress={onDuty} style={{ paddingVertical: 16, marginTop: 0 }} />
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Button title="Talk to chief" kind="ghost" onPress={() => scrollRef.current?.scrollToEnd({ animated: true })} style={{ flex: 1 }} />
          <Button title="Decline / defer" kind="ghost" onPress={() => {}} style={{ flex: 1 }} />
        </View>
      </View>
      {err && <Body style={{ color: C.red }}>{err}</Body>}
    </Screen>
  );
}

/**
 * The back channel: a wire to a rival chief that does not carry your name. Sell a teammate's live route
 * for credits from an unknown account, or point a rival at a site where there is nothing. Two a day.
 * Chiefs are not fools: a source that burns them twice is dropped.
 */
function BackChannel() {
  const [opts, setOpts] = useState<BackChannelOptions | null>(null);
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState<string | null>(null);
  const [kind, setKind] = useState<"sell" | "plant">("sell");
  const [ref, setRef] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const load = async () => { try { setOpts(await api.backchannel()); } catch { /* not deployed or no faction */ } };
  useEffect(() => { if (open) load(); }, [open]);
  const send = async () => {
    if (!to || !ref) return;
    setBusy(true); setMsg(null);
    try { const r = await api.sendTip(to, kind, ref); setMsg(r.ok ? (kind === "sell" ? `Sold. ${r.credits} credits landed from an account nobody can trace. ${r.left} left today.` : `Planted. ${r.left} left today. If they walk it, they pay for it.`) : r.reason ?? "No."); if (r.ok) { setRef(null); load(); } }
    catch (e: any) { setMsg(e.message); } finally { setBusy(false); }
  };
  const choices = kind === "sell" ? (opts?.routes ?? []).map((r) => ({ id: r.missionId, label: r.label })) : (opts?.sites ?? []).map((x) => ({ id: x.id, label: x.name }));
  return (
    <Dossier tab={C.amber} style={{ marginTop: 8 }}>
      <Text style={{ color: C.amber, fontFamily: F.displayMed, fontSize: 13, letterSpacing: 1.6 }}>BACK CHANNEL · UNSIGNED</Text>
      <Body dim>A wire to a rival chief that does not carry your name. Sell a teammate's route for credits, or send a rival somewhere empty.</Body>
      {!open ? <Button title="Open the wire" kind="ghost" onPress={() => setOpen(true)} /> : !opts ? <Spinner /> : (
        <>
          <Text style={[s.eyebrow, { marginTop: 6 }]}>To · {opts.left} tip{opts.left === 1 ? "" : "s"} left today</Text>
          <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
            {opts.rivals.map((r) => <Button key={r.id} title={`${r.chief}${r.burned ? " · burned" : ""}`} kind={to === r.id ? "primary" : "ghost"} disabled={r.burned} onPress={() => setTo(r.id)} style={{ paddingVertical: 8, paddingHorizontal: 12, marginTop: 4 }} />)}
          </View>
          <Text style={[s.eyebrow, { marginTop: 8 }]}>What</Text>
          <View style={{ flexDirection: "row", gap: 6 }}>
            <Button title="Sell a route · 40 cr" kind={kind === "sell" ? "primary" : "ghost"} onPress={() => { setKind("sell"); setRef(null); }} style={{ flex: 1, paddingVertical: 8, marginTop: 4 }} />
            <Button title="Plant a false lead" kind={kind === "plant" ? "primary" : "ghost"} onPress={() => { setKind("plant"); setRef(null); }} style={{ flex: 1, paddingVertical: 8, marginTop: 4 }} />
          </View>
          <Text style={[s.eyebrow, { marginTop: 8 }]}>{kind === "sell" ? "Whose route" : "Which site"}</Text>
          {choices.length === 0 ? <Body dim>{kind === "sell" ? "No teammate is walking a route right now." : "Deploy to the field to see sites."}</Body> : choices.map((c) => (
            <Button key={c.id} title={c.label} kind={ref === c.id ? "primary" : "ghost"} onPress={() => setRef(c.id)} style={{ paddingVertical: 8, marginTop: 4 }} />
          ))}
          <Button title={kind === "sell" ? "Sell it" : "Send them"} onPress={send} loading={busy} disabled={!to || !ref || opts.left <= 0} style={{ marginTop: 8 }} />
          {msg && <Body style={{ color: C.amber }}>{msg}</Body>}
          {opts.recent.length > 0 && <Text style={{ color: C.dim, fontFamily: F.typed, fontSize: 11.5, marginTop: 6 }}>{opts.recent.map((r) => `${r.kind === "sell" ? "SOLD" : "PLANTED"} · ${r.about} → ${r.to} · ${r.outcome.toUpperCase()}`).join("\n")}</Text>}
          <Button title="Close the wire" kind="ghost" onPress={() => setOpen(false)} style={{ marginTop: 4, paddingVertical: 8 }} />
        </>
      )}
    </Dossier>
  );
}

function Gauge({ label, value, text, color, sub }: { label: string; value: number; text: string; color: string; sub?: string }) {
  const r = 26, c = 2 * Math.PI * r;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
      <Svg width={64} height={64}>
        <Circle cx={32} cy={32} r={r} stroke={C.line} strokeWidth={5} fill="none" />
        <Circle cx={32} cy={32} r={r} stroke={color} strokeWidth={5} fill="none" strokeDasharray={`${c * Math.max(0, Math.min(1, value))} ${c}`} strokeLinecap="butt" rotation={-90} origin="32, 32" />
      </Svg>
      <View>
        <Text style={s.eyebrow}>{label}</Text>
        <Text style={[s.big, { color }]}>{text}</Text>
        {sub && <Text style={s.sub}>{sub}</Text>}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  eyebrow: { color: C.dim, fontFamily: F.displayMed, fontSize: 11, letterSpacing: 1.4, textTransform: "uppercase" },
  big: { color: C.text, fontFamily: F.displayMed, fontSize: 24, lineHeight: 26, letterSpacing: 1, textTransform: "uppercase" },
  sub: { color: C.dim, fontSize: 13 },
  drawer: { borderWidth: 1, borderColor: C.cyan + "66", backgroundColor: C.glass, padding: 10, marginTop: 4 },
  section: { color: C.cyan, fontFamily: F.displayMed, fontSize: 13, letterSpacing: 1.6, textTransform: "uppercase", marginBottom: 6, marginTop: 4, textAlign: "center" },
});
