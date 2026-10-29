import React, { useState } from "react";
import { Dimensions, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { C, F, FACTION_INFO, factionColor } from "../theme";
import { Button, Dossier, Kicker, Screen, Typed } from "../ui";
import { FactionEmblem, HoloDeadDropSvg, MissionMark, ProceduralFactionEmblem } from "../graphics";
import { HoloCache3D } from "../effects/HoloCache3D";
import { RadarSweep } from "../effects/RadarSweep";
import { TacticalHUD } from "../effects/TacticalHUD";

export function HoloShowcase({ onBack }: { onBack: () => void }) {
  const [selectedFaction, setSelectedFaction] = useState<string>("raven");
  const [showHud, setShowHud] = useState(false);
  const color = factionColor(selectedFaction);
  const info = FACTION_INFO[selectedFaction] ?? FACTION_INFO.raven;
  const width = Math.min(Dimensions.get("window").width, 560);

  return (
    <Screen pad={false}>
      {showHud && (
        <TacticalHUD
          color={color}
          codename="SPECTRE-09"
          factionId={selectedFaction}
          heading={128}
          pitch={-2.4}
        />
      )}

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48, maxWidth: 560, width: "100%", alignSelf: "center" }}>
        {/* Header */}
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <View>
            <Text style={[s.title, { color }]}>SPATIAL 3D ENGINE</Text>
            <Text style={s.sub}>Visual Assets & Holographic Effects Showcase</Text>
          </View>
          <Button title="Close" kind="ghost" onPress={onBack} style={{ marginTop: 0, paddingHorizontal: 16 }} />
        </View>

        {/* 1. 3D Floating Cache Preview */}
        <Dossier style={{ borderColor: color, marginBottom: 18 }}>
          <Kicker>3D AR Virtual Dead-Drop Cache (MIS-02)</Kicker>
          <View style={{ paddingVertical: 18, alignItems: "center", backgroundColor: C.ink }}>
            <HoloCache3D factionId={selectedFaction} targetName="VIRTUAL CACHE #DD-094" distanceM={14.2} locked={true} size={150} />
          </View>
          <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 8 }}>
            <Text style={{ color: C.dim, fontFamily: F.typed, fontSize: 11 }}>Perspective: 700px</Text>
            <Text style={{ color: C.ok, fontFamily: F.typedBold, fontSize: 11 }}>Active Gyro Bob</Text>
          </View>
        </Dossier>

        {/* 2. Faction Selector & Emblems */}
        <Dossier style={{ marginBottom: 18 }}>
          <Kicker>Five AI Intelligence Chiefs (Section 3)</Kicker>
          <View style={{ flexDirection: "row", justifyContent: "space-around", marginVertical: 12 }}>
            {["raven", "phantom", "sentinel", "cipher", "viper", "director"].map((fid) => {
              const isSel = fid === selectedFaction;
              const fColor = factionColor(fid);
              return (
                <Pressable
                  key={fid}
                  onPress={() => setSelectedFaction(fid)}
                  style={{
                    alignItems: "center",
                    padding: 6,
                    borderWidth: 1.5,
                    borderColor: isSel ? fColor : "transparent",
                    borderRadius: 8,
                    backgroundColor: isSel ? fColor + "22" : "transparent",
                  }}
                >
                  <FactionEmblem id={fid} size={42} />
                  <Text style={{ color: isSel ? fColor : C.dim, fontFamily: F.typedBold, fontSize: 10, marginTop: 4 }}>
                    {fid.toUpperCase().slice(0, 4)}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* Faction Dossier Card */}
          <View style={{ backgroundColor: C.ink, padding: 12, borderRadius: 6, borderLeftWidth: 3, borderLeftColor: color }}>
            <Text style={{ color, fontFamily: F.display, fontSize: 18 }}>{info.name} · CHIEF {info.chief}</Text>
            <Text style={{ color: C.text, fontFamily: F.typed, fontSize: 12, marginTop: 2, fontStyle: "italic" }}>
              "{info.tagline}"
            </Text>
            <Text style={{ color: C.dim, fontFamily: F.typed, fontSize: 11, marginTop: 4 }}>
              Specialty: {info.specialty}
            </Text>
          </View>
        </Dossier>

        {/* 3. Radar & Sonar Sweep */}
        <Dossier style={{ marginBottom: 18 }}>
          <Kicker>Tactical Radar Scanner (GEO-01)</Kicker>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-around", paddingVertical: 12 }}>
            <RadarSweep
              size={110}
              color={color}
              bearing={54}
              blips={[
                { x: 0.3, y: -0.4, factionId: "phantom" },
                { x: -0.5, y: 0.2, factionId: "cipher" },
              ]}
            />
            <View style={{ flex: 1, marginLeft: 16 }}>
              <Text style={{ color: C.text, fontFamily: F.displayMed, fontSize: 14 }}>Real-Time Sector Ping</Text>
              <Text style={{ color: C.dim, fontFamily: F.typed, fontSize: 11, marginTop: 2 }}>
                Sweep speed: 3.2s / revolution
              </Text>
              <Text style={{ color: C.dim, fontFamily: F.typed, fontSize: 11 }}>
                Bearing: 054° NNE
              </Text>
              <Text style={{ color: color, fontFamily: F.typedBold, fontSize: 11, marginTop: 4 }}>
                2 Contacts Detected
              </Text>
            </View>
          </View>
        </Dossier>

        {/* 4. Complete Mission Taxonomy Iconography (PRD 7.1) */}
        <Dossier style={{ marginBottom: 18 }}>
          <Kicker>PRD Section 7.1 Mission Taxonomy Marks</Kicker>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 8 }}>
            {[
              { id: "RECON", label: "Recon" },
              { id: "DEAD_DROP", label: "Dead Drop" },
              { id: "EXTRACTION", label: "Extraction" },
              { id: "CIPHER", label: "Cipher" },
              { id: "ANALYSIS", label: "Analysis" },
              { id: "TERRITORY", label: "Territory" },
              { id: "INVESTIGATION", label: "Investigation" },
              { id: "DOUBLE_AGENT", label: "Double Agent" },
              { id: "BOUNTY", label: "Bounty" },
              { id: "NEGOTIATION", label: "Negotiation" },
            ].map((m) => (
              <View key={m.id} style={{ width: (width - 64) / 2, flexDirection: "row", alignItems: "center", gap: 8, padding: 6, backgroundColor: C.ink, borderRadius: 4 }}>
                <MissionMark template={m.id} size={28} color={color} />
                <Text style={{ color: C.text, fontFamily: F.typed, fontSize: 11 }}>{m.label}</Text>
              </View>
            ))}
          </View>
        </Dossier>

        {/* Toggle HUD button */}
        <Button
          title={showHud ? "Hide Spy Vision HUD" : "Simulate Spy Vision HUD"}
          onPress={() => setShowHud(!showHud)}
          style={{ paddingVertical: 14 }}
        />
      </ScrollView>
    </Screen>
  );
}

const s = StyleSheet.create({
  title: { fontFamily: F.display, fontSize: 26, letterSpacing: 1.5, textTransform: "uppercase" },
  sub: { color: C.dim, fontFamily: F.typed, fontSize: 11, marginTop: 2 },
});
