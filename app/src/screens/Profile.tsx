import React, { useEffect, useState } from "react";
import { Image, Text, View } from "react-native";
import type { Faction, Player, SkillKey, TitleEntry, ToolkitResponse } from "@ispy/shared";
import { api, setToken } from "../api";
import { ART } from "../art";
import { C, F, factionColor } from "../theme";
import { Body, Button, Display, Kicker, Meter, Panel, Screen, Typed } from "../ui";

const SKILLS: SkillKey[] = ["observation", "reasoning", "cipher", "cooperation"];


export function Profile({ player, faction, onSignOut }: { player: Player; faction: Faction | null; onSignOut: () => void }) {
  const [events, setEvents] = useState<{ at: string; text: string }[]>([]);
  useEffect(() => {
    api.history().then((r) => setEvents(r.events)).catch(() => {});
  }, [player.xp]);
  const [titles, setTitles] = useState<TitleEntry[]>([]);
  useEffect(() => { api.titles().then((r) => setTitles(r.titles)).catch(() => {}); }, [player.xp]);
  const [kit, setKit] = useState<ToolkitResponse | null>(null);
  const [kitMsg, setKitMsg] = useState<string | null>(null);
  const loadKit = () => api.tools().then(setKit).catch(() => {});
  useEffect(() => { loadKit(); }, [player.xp, player.credits]);
  const craft = async (tool: string) => { try { const r = await api.craft(tool); setKitMsg(r.ok ? `Crafted. You now hold ${r.qty}.` : r.reason ?? "No."); await loadKit(); } catch (e: any) { setKitMsg(e.message); } };
  const color = factionColor(player.factionId);

  return (
    <Screen>
      <Kicker color={color}>{faction ? `${faction.name}, reporting to ${faction.chiefName}` : "Civilian"}</Kicker>
      <Display size={56}>{player.codename}</Display>
      <Panel style={{ borderColor: color }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <Stat label="rank" value={player.rank.replace("_", " ")} />
          <Stat label="XP" value={`${player.xp}`} />
          <Stat label="trust" value={`${player.trust}`} right />
        </View>
        {titles.length > 0 && (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
            {titles.map((t) => <Text key={t.title + t.week} style={{ color: C.amber, borderWidth: 1, borderColor: C.amber, paddingHorizontal: 8, paddingVertical: 3, fontFamily: F.displayMed, fontSize: 11, letterSpacing: 1.2 }}>{t.title.toUpperCase()}{t.area ? ` · ${t.area.toUpperCase()}` : ""} · {t.week}</Text>)}
          </View>
        )}
        <View style={{ display: "none" }}>
        </View>
        <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 14 }}>
          <Stat label="walk radius" value={`${player.walkRadiusM} m`} />
          <Stat label="field missions today" value={`${player.fieldToday} of ${player.dailyFieldCap}`} right />
        </View>
      </Panel>
      {kit && (
        <Panel>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Image source={ART.tool.fragment} style={{ width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: C.cyan }} />
            <Kicker>Toolkit · {kit.fragments} cipher fragments</Kicker>
          </View>
          <Body dim>Human judgement decides when a tool is worth spending. Caches give fragments, lenses, jammers and decoys; fragments craft the rest.</Body>
          {kit.effects.length > 0 && <Text style={{ color: C.ok, fontFamily: F.typed, fontSize: 11.5, marginBottom: 6 }}>ACTIVE · {kit.effects.map((e) => `${e.kind.toUpperCase()} until ${new Date(e.until).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`).join(" · ")}</Text>}
          {kit.tools.filter((t) => t.id !== "fragment").map((t) => (
            <View key={t.id} style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 7, borderTopWidth: 1, borderTopColor: C.line }}>
              <Image source={ART.tool[t.id]} style={{ width: 52, height: 52, borderRadius: 26, borderWidth: 1, borderColor: t.qty > 0 ? C.cyan : C.line, opacity: t.qty > 0 ? 1 : 0.5 }} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: t.qty > 0 ? C.text : C.dim, fontFamily: F.displayMed, fontSize: 15, letterSpacing: 1.2 }}>{t.name.toUpperCase()}{t.permanent ? "" : ` · ×${t.qty}`}</Text>
                <Text style={{ color: C.dim, fontFamily: F.typed, fontSize: 11.5 }}>{t.blurb}</Text>
                <Text style={{ color: C.cyanDim, fontFamily: F.typed, fontSize: 11 }}>Use: {t.use}</Text>
              </View>
              {t.craft && <Button title={`Craft · ${t.craft}`} kind="ghost" onPress={() => craft(t.id)} disabled={kit.fragments < t.craft} style={{ marginTop: 0, paddingVertical: 6, paddingHorizontal: 10 }} />}
            </View>
          ))}
          {kitMsg && <Typed style={{ marginTop: 6 }}>{kitMsg}</Typed>}
        </Panel>
      )}
      <Panel>
        <Kicker>How you play</Kicker>
        {SKILLS.map((k) => (
          <View key={k}>
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Body style={{ marginBottom: 2 }}>{k}</Body>
              <Text style={{ color: C.dim, fontFamily: F.displayMed, fontSize: 16 }}>{Math.round(player.skills[k] * 100)}</Text>
            </View>
            <Meter value={player.skills[k]} color={color} />
          </View>
        ))}
        <Body dim style={{ fontSize: 12.5, marginBottom: 0 }}>Observed in play. Not a judgement of you.</Body>
      </Panel>
      <Panel>
        <Kicker>Record</Kicker>
        {events.length === 0 && <Body dim>Nothing yet.</Body>}
        {events.map((e, i) => (
          <View key={i} style={{ flexDirection: "row", gap: 10, marginBottom: 5 }}>
            <Typed onPaper={false} style={{ color: C.dim, marginBottom: 0, width: 46 }}>{new Date(e.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</Typed>
            <Typed onPaper={false} style={{ marginBottom: 0, flex: 1 }}>{e.text}</Typed>
          </View>
        ))}
      </Panel>
      <Button title="Sign out" kind="ghost" onPress={async () => { await setToken(null); onSignOut(); }} />
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
