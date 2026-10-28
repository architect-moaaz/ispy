import React, { useEffect, useRef, useState } from "react";
import { ScrollView, Text, View, type ScrollViewInstance } from "react-native";
import type { Briefing, ChatMessage } from "@ispy/shared";
import { api } from "../api";
import { C, F, factionColor } from "../theme";
import { Body, Button, Display, Input, Kicker, Panel, Screen, Spinner, Typed } from "../ui";

export function HQ({ factionId }: { factionId: string | null }) {
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const scrollRef = useRef<ScrollViewInstance>(null);

  const load = async () => {
    try {
      const [b, m] = await Promise.all([api.briefing(), api.messages()]);
      setBriefing(b);
      setMessages(m.messages);
    } catch (e: any) {
      setErr(e.message);
    }
  };
  useEffect(() => { load(); }, []);

  const send = async () => {
    const t = text.trim();
    if (!t) return;
    setBusy(true);
    setText("");
    setMessages((m) => [...m, { id: `local-${Date.now()}`, role: "player", text: t, at: new Date().toISOString() }]);
    try {
      const r = await api.sendMessage(t);
      setMessages((m) => [...m, r.reply]);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
    }
  };

  const color = factionColor(factionId);
  if (!briefing) return <Screen>{err ? <Body style={{ color: C.stamp }}>{err}</Body> : <Spinner />}</Screen>;
  const pct = Math.min(1, briefing.standing.xp / Math.max(1, briefing.standing.nextRankAt));

  return (
    <Screen>
      <Kicker color={color}>{briefing.factionName} headquarters</Kicker>
      <Display size={60} color={color}>{briefing.chiefName}</Display>
      <Text style={{ fontFamily: F.typed, fontSize: 17, lineHeight: 24, color: C.text, marginBottom: 16 }}>“{briefing.headline}”</Text>

      <Panel style={{ borderColor: color }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" }}>
          <Stat label="rank" value={briefing.standing.rank.replace("_", " ")} />
          <Stat label="trust" value={`${briefing.standing.trust}`} />
          <Stat label="next rank" value={`${briefing.standing.xp} / ${briefing.standing.nextRankAt}`} right />
        </View>
        <View style={{ height: 6, backgroundColor: C.ink, marginTop: 10, borderRadius: 2, overflow: "hidden" }}>
          <View style={{ width: `${Math.round(pct * 100)}%`, height: 6, backgroundColor: color }} />
        </View>
      </Panel>

      {briefing.recent.length > 0 && (
        <Panel>
          <Kicker>Lately</Kicker>
          {briefing.recent.map((r, i) => <Typed key={i} onPaper={false} style={{ color: C.dim, marginBottom: 3 }}>{r}</Typed>)}
        </Panel>
      )}

      <Kicker>Secure channel</Kicker>
      <Panel style={{ padding: 8 }}>
        <ScrollView ref={scrollRef} style={{ maxHeight: 320 }} onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}>
          {messages.length === 0 && <Body dim style={{ padding: 8 }}>Nothing yet. Your chief is listening.</Body>}
          {messages.map((m) => (
            <View
              key={m.id}
              style={{
                alignSelf: m.role === "player" ? "flex-end" : "flex-start",
                backgroundColor: m.role === "player" ? C.ink : C.paper,
                borderRadius: 3, padding: 10, marginBottom: 6, maxWidth: "88%",
                borderLeftWidth: m.role === "chief" ? 6 : 0, borderLeftColor: color,
              }}
            >
              <Text style={{ fontFamily: F.typed, fontSize: 14.5, lineHeight: 20, color: m.role === "player" ? C.text : C.onPaper }}>{m.text}</Text>
            </View>
          ))}
        </ScrollView>
        <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
          <Input value={text} onChangeText={setText} placeholder="Say something" style={{ flex: 1, marginBottom: 0 }} onSubmitEditing={send} />
          <Button title="Send" onPress={send} loading={busy} style={{ marginTop: 0 }} />
        </View>
      </Panel>
      {err && <Body style={{ color: C.stamp }}>{err}</Body>}
    </Screen>
  );
}

function Stat({ label, value, right }: { label: string; value: string; right?: boolean }) {
  return (
    <View style={{ alignItems: right ? "flex-end" : "flex-start" }}>
      <Text style={{ color: C.text, fontFamily: F.display, fontSize: 24, lineHeight: 24 }}>{value}</Text>
      <Text style={{ color: C.dim, fontFamily: F.displayMed, fontSize: 14 }}>{label}</Text>
    </View>
  );
}
