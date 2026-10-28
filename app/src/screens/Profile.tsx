import React, { useEffect, useState } from "react";
import { Text, View } from "react-native";
import type { Faction, Player, SkillKey } from "@ispy/shared";
import { api, setToken } from "../api";
import { C, factionColor, mono } from "../theme";
import { Bar, Button, Card, H1, Label, P, Screen } from "../ui";

const SKILLS: SkillKey[] = ["observation", "reasoning", "cipher", "cooperation"];

export function Profile({ player, faction, onSignOut }: { player: Player; faction: Faction | null; onSignOut: () => void }) {
  const [events, setEvents] = useState<{ at: string; text: string }[]>([]);
  useEffect(() => {
    api.history().then((r) => setEvents(r.events)).catch(() => {});
  }, []);

  return (
    <Screen>
      <Label>Operative profile</Label>
      <H1>{player.codename}</H1>
      <Card style={{ borderColor: factionColor(player.factionId) }}>
        <Text style={{ color: factionColor(player.factionId), fontWeight: "700", ...mono }}>
          {faction ? `${faction.name} · chief ${faction.chiefName}` : "Civilian"}
        </Text>
        <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 8 }}>
          <Stat label="rank" value={player.rank.replace("_", " ")} />
          <Stat label="xp" value={`${player.xp}`} />
          <Stat label="trust" value={`${player.trust}`} />
        </View>
        <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 8 }}>
          <Stat label="walk radius" value={`${player.walkRadiusM} m`} />
          <Stat label="field today" value={`${player.fieldToday} / ${player.dailyFieldCap}`} />
        </View>
      </Card>
      <Card>
        <Label>Gameplay skills</Label>
        {SKILLS.map((k) => (
          <View key={k}>
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Text style={{ color: C.dim, fontSize: 12, ...mono }}>{k}</Text>
              <Text style={{ color: C.dim, fontSize: 12, ...mono }}>{Math.round(player.skills[k] * 100)}</Text>
            </View>
            <Bar value={player.skills[k]} color={factionColor(player.factionId)} />
          </View>
        ))}
        <P dim style={{ fontSize: 12 }}>Observed in play. Not a judgement of you.</P>
      </Card>
      <Card>
        <Label>History</Label>
        {events.length === 0 && <P dim>Nothing yet.</P>}
        {events.map((e, i) => (
          <View key={i} style={{ marginBottom: 6 }}>
            <Text style={{ color: C.dim, fontSize: 11, ...mono }}>{new Date(e.at).toLocaleString()}</Text>
            <Text style={{ color: C.text }}>{e.text}</Text>
          </View>
        ))}
      </Card>
      <Button
        title="Sign out"
        kind="ghost"
        onPress={async () => {
          await setToken(null);
          onSignOut();
        }}
      />
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
