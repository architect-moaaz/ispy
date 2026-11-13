import React from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { C, F } from "./theme";
import { OPERATIVE_IDS, type OperativeId } from "./prefs";

/**
 * The ten operatives you can be in the 3D street: Meshy-generated bodies from the concept sheets
 * in `art-source/operatives`, rigged with a Mixamo skeleton and shipped as `assets/art/operatives/<id>.glb`
 * with Idle, Walking and Running clips. The thumbnails are head-to-waist crops of the same sheets.
 */
export const OPERATIVES: Record<OperativeId, { name: string; blurb: string }> = {
  f1: { name: "Vesper", blurb: "Armoured tactical suit" },
  f2: { name: "Marlow", blurb: "Hooded long coat" },
  f3: { name: "Sable", blurb: "Braid, moto jacket, harness" },
  f4: { name: "Kestrel", blurb: "Runner build, armoured vest" },
  f5: { name: "Halden", blurb: "Platinum bob, asymmetric coat" },
  m1: { name: "Reeve", blurb: "Hooded long coat, armoured suit" },
  m2: { name: "Dorian", blurb: "Lean, hooded long coat" },
  m3: { name: "Brock", blurb: "Brawler, cropped bomber" },
  m4: { name: "Kaito", blurb: "Seamed bodysuit, hooded shell" },
  m5: { name: "Ashford", blurb: "Veteran, open leather trench" },
};

export const THUMBS: Record<OperativeId, any> = {
  f1: require("../assets/art/operatives/f1.jpg"), f2: require("../assets/art/operatives/f2.jpg"), f3: require("../assets/art/operatives/f3.jpg"),
  f4: require("../assets/art/operatives/f4.jpg"), f5: require("../assets/art/operatives/f5.jpg"),
  m1: require("../assets/art/operatives/m1.jpg"), m2: require("../assets/art/operatives/m2.jpg"), m3: require("../assets/art/operatives/m3.jpg"),
  m4: require("../assets/art/operatives/m4.jpg"), m5: require("../assets/art/operatives/m5.jpg"),
};

/** A strip of the ten, one lit in the agency colour. Scrolls sideways; the chosen one is named beneath. */
export function OperativePicker({ value, onChange, disabled, accent = C.cyan }: { value: OperativeId; onChange: (id: OperativeId) => void; disabled?: boolean; accent?: string }) {
  const chosen = OPERATIVES[value];
  return (
    <View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 2 }}>
        {OPERATIVE_IDS.map((id) => {
          const on = id === value;
          return (
            <Pressable key={id} onPress={() => onChange(id)} disabled={disabled} accessibilityRole="button" accessibilityLabel={`${OPERATIVES[id].name}, ${OPERATIVES[id].blurb}`} accessibilityState={{ selected: on }}
              style={({ pressed }) => [s.cell, { borderColor: on ? accent : C.hair, opacity: disabled ? 0.5 : pressed ? 0.8 : on ? 1 : 0.72 }]}>
              <Image source={THUMBS[id]} style={s.img} />
              {on && <View style={[s.tick, { backgroundColor: accent }]} />}
            </Pressable>
          );
        })}
      </ScrollView>
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8, marginTop: 6 }}>
        <Text style={[s.name, { color: accent }]}>{chosen.name.toUpperCase()}</Text>
        <Text style={s.blurb} numberOfLines={1}>{chosen.blurb}</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  cell: { width: 64, height: 80, borderRadius: 8, borderWidth: 1.5, overflow: "hidden", backgroundColor: "#000" },
  img: { width: "100%", height: "100%" },
  tick: { position: "absolute", left: 0, right: 0, bottom: 0, height: 3 },
  name: { fontFamily: F.displayMed, fontSize: 13, letterSpacing: 1.8 },
  blurb: { color: C.dim, fontFamily: F.typed, fontSize: 11, flex: 1 },
});
