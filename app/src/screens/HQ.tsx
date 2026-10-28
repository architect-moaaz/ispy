import React, { useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, View, type ScrollViewInstance } from "react-native";
import Svg, { Circle } from "react-native-svg";
import type { Briefing, ChatMessage } from "@ispy/shared";
import { api } from "../api";
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
  useEffect(() => { load(); }, []);

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
          {messages.map((m) => (
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

      <Dossier tab={color}>
        <View style={{ flexDirection: "row", justifyContent: "space-around" }}>
          <Gauge label="Trust score" value={briefing.standing.trust / 100} text={`${briefing.standing.trust}%`} color={color} />
          <Gauge label="Next rank" value={pct} text={`${Math.round(pct * 100)}%`} color={C.cyan} sub={`${briefing.standing.xp} / ${briefing.standing.nextRankAt} XP`} />
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
      <Button title="Go to the field" onPress={onDuty} style={{ paddingVertical: 16 }} />
      {err && <Body style={{ color: C.red }}>{err}</Body>}
    </Screen>
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
  section: { color: C.cyan, fontFamily: F.displayMed, fontSize: 13, letterSpacing: 1.6, textTransform: "uppercase", marginBottom: 6, marginTop: 4, textAlign: "center" },
});
