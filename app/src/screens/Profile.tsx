import React, { useEffect, useState } from "react";
import { Text, View } from "react-native";
import type { Faction, Player, SkillKey } from "@ispy/shared";
import { api, setToken } from "../api";
import { C, F, factionColor } from "../theme";
import { Body, Button, Display, Kicker, Meter, Panel, Screen, Typed } from "../ui";

const SKILLS: SkillKey[] = ["observation", "reasoning", "cipher", "cooperation"];

export function Profile({ player, faction, onSignOut }: { player: Player; faction: Faction | null; onSignOut: () => void }) {
  const [events, setEvents] = useState<{ at: string; text: string }[]>([]);
  useEffect(() => {
    api.history().then((r) => setEvents(r.events)).catch(() => {});
  }, [player.xp]);
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
        <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 14 }}>
          <Stat label="walk radius" value={`${player.walkRadiusM} m`} />
          <Stat label="field missions today" value={`${player.fieldToday} of ${player.dailyFieldCap}`} right />
        </View>
      </Panel>
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
