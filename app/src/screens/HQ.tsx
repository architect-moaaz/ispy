import React, { useEffect, useRef, useState } from "react";
import { ScrollView, Text, View, type ScrollViewInstance } from "react-native";
import type { Briefing, ChatMessage } from "@ispy/shared";
import { api } from "../api";
import { C, factionColor, mono } from "../theme";
import { Button, Card, H1, Input, Label, P, Screen, Spinner } from "../ui";

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
  useEffect(() => {
    load();
  }, []);

  const send = async () => {
    const t = text.trim();
    if (!t) return;
    setBusy(true);
    setText("");
    const mine: ChatMessage = { id: `local-${Date.now()}`, role: "player", text: t, at: new Date().toISOString() };
    setMessages((m) => [...m, mine]);
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
  if (!briefing) return <Screen>{err ? <P style={{ color: C.danger }}>{err}</P> : <Spinner />}</Screen>;

  return (
    <Screen>
      <Label>{briefing.factionName} headquarters</Label>
      <H1>{briefing.chiefName}</H1>
      <Card style={{ borderColor: color }}>
        <P style={{ fontStyle: "italic" }}>{briefing.headline}</P>
        <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 6 }}>
          <Stat label="rank" value={briefing.standing.rank.replace("_", " ")} />
          <Stat label="xp" value={`${briefing.standing.xp} / ${briefing.standing.nextRankAt}`} />
          <Stat label="trust" value={`${briefing.standing.trust}`} />
        </View>
      </Card>
      {briefing.recent.length > 0 && (
        <Card>
          <Label>Recent</Label>
          {briefing.recent.map((r, i) => (
            <Text key={i} style={{ color: C.dim, fontSize: 13, marginBottom: 4 }}>· {r}</Text>
          ))}
        </Card>
      )}
      <Label>Secure channel</Label>
      <Card style={{ padding: 8 }}>
        <ScrollView ref={scrollRef} style={{ maxHeight: 320 }} onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}>
          {messages.length === 0 && <P dim style={{ padding: 8 }}>No messages yet. Ask your chief for orders.</P>}
          {messages.map((m) => (
            <View
              key={m.id}
              style={{
                alignSelf: m.role === "player" ? "flex-end" : "flex-start",
                backgroundColor: m.role === "player" ? "#1f3b33" : C.panel2,
                borderRadius: 8,
                padding: 10,
                marginBottom: 6,
                maxWidth: "88%",
                borderLeftWidth: m.role === "chief" ? 3 : 0,
                borderLeftColor: color,
              }}
            >
              <Text style={{ color: C.text }}>{m.text}</Text>
            </View>
          ))}
        </ScrollView>
        <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
          <Input value={text} onChangeText={setText} placeholder="Message your chief" style={{ flex: 1, marginBottom: 0 }} onSubmitEditing={send} />
          <Button title="Send" onPress={send} loading={busy} style={{ marginTop: 0 }} />
        </View>
      </Card>
      {err && <P style={{ color: C.danger }}>{err}</P>}
    </Screen>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View>
      <Label>{label}</Label>
      <Text style={{ color: C.text, fontWeight: "700", ...mono }}>{value}</Text>
    </View>
  );
}
