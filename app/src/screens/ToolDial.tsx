import React, { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, Image, Pressable, StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import type { ToolView } from "@ispy/shared";
import { ART } from "../art";
import { C, F } from "../theme";
import { Button } from "../ui";

/**
 * The tool dial: a half-wheel at the bottom of the map. Tools sit on the arc; drag left or right (or
 * tap one) to rotate it, and the tool at the top of the arc is the one in hand, with its purpose and
 * count. One button uses it. Tools you do not have are greyed but stay on the wheel so the operative
 * learns the set.
 */
export interface DialTool extends ToolView { enabled: boolean; why?: string }

export function ToolDial({ tools, busy, onUse, hint }: { tools: DialTool[]; busy: boolean; onUse: (tool: DialTool) => void; hint?: string | null }) {
  const n = tools.length;
  const [index, setIndex] = useState(0);
  const anim = useRef(new Animated.Value(0)).current; // current angle offset in "slots"
  const dragStart = useRef(0);
  const step = 32; // degrees between tools on the arc
  const radius = 150;
  useEffect(() => { Animated.timing(anim, { toValue: index, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(); }, [index]);
  const pan = useMemo(() => Gesture.Pan().activeOffsetX([-8, 8])
    .onBegin(() => { dragStart.current = index; })
    .onUpdate((e) => { const d = -e.translationX / 70; anim.setValue(Math.max(0, Math.min(n - 1, dragStart.current + d))); })
    .onEnd((e) => { const d = -e.translationX / 70; setIndex(Math.max(0, Math.min(n - 1, Math.round(dragStart.current + d)))); })
    .runOnJS(true), [index, n]);
  const cur = tools[index];
  return (
    <GestureDetector gesture={pan}>
      <View style={s.wrap} collapsable={false}>
        <View style={s.arcBg} />
        {tools.map((t, i) => {
          const angle = anim.interpolate({ inputRange: [i - 3, i, i + 3], outputRange: [`${3 * step}deg`, "0deg", `${-3 * step}deg`], extrapolate: "extend" });
          const scale = anim.interpolate({ inputRange: [i - 1, i, i + 1], outputRange: [0.72, 1.15, 0.72], extrapolate: "clamp" });
          const opacity = anim.interpolate({ inputRange: [i - 3, i - 2, i, i + 2, i + 3], outputRange: [0, 0.5, 1, 0.5, 0], extrapolate: "clamp" });
          return (
            <Animated.View key={t.id} style={[s.slot, { transform: [{ rotate: angle }, { translateY: -radius }] , opacity }]} pointerEvents="box-none">
              <Animated.View style={{ transform: [{ scale }] }}>
                <Pressable onPress={() => setIndex(i)} style={[s.icon, i === index && s.iconOn, !t.enabled && s.iconOff]}>
                  <Image source={ART.tool[t.id]} style={s.img} />
                  {!t.permanent && <View style={s.badge}><Text style={s.badgeText}>{t.qty}</Text></View>}
                </Pressable>
              </Animated.View>
            </Animated.View>
          );
        })}
        <View style={s.hub} pointerEvents="box-none">
          {cur && (
            <>
              <Text style={[s.name, !cur.enabled && { color: C.dim }]}>{cur.name.toUpperCase()}{cur.permanent ? "" : ` · ×${cur.qty}`}</Text>
              <Text style={s.purpose} numberOfLines={2}>{cur.enabled ? cur.use : cur.why ?? cur.use}</Text>
              <Button title={cur.enabled ? `Use ${cur.name.toLowerCase()}` : cur.qty > 0 ? "Not here" : cur.craft ? `Craft on Me · ${cur.craft} fragments` : "None left"} onPress={() => onUse(cur)} loading={busy} disabled={!cur.enabled} style={{ marginTop: 6, paddingVertical: 8, paddingHorizontal: 18 }} />
            </>
          )}
          {hint && <Text style={s.hint}>{hint}</Text>}
        </View>
      </View>
    </GestureDetector>
  );
}

const s = StyleSheet.create({
  wrap: { height: 250, alignItems: "center", justifyContent: "flex-end", overflow: "hidden", marginTop: 8 },
  arcBg: { position: "absolute", bottom: -230, width: 480, height: 480, borderRadius: 240, borderWidth: 1, borderColor: C.cyanDim, backgroundColor: "rgba(6,20,30,0.6)" },
  slot: { position: "absolute", bottom: 24, alignItems: "center" },
  icon: { width: 64, height: 64, borderRadius: 32, borderWidth: 2, borderColor: C.line, overflow: "hidden", backgroundColor: "#000" },
  iconOn: { borderColor: C.cyan, shadowColor: C.cyan, shadowOpacity: 0.9, shadowRadius: 14 },
  iconOff: { opacity: 0.4 },
  img: { width: 64, height: 64 },
  badge: { position: "absolute", right: 2, bottom: 2, minWidth: 20, height: 20, borderRadius: 10, backgroundColor: C.cyan, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  badgeText: { color: C.ink, fontFamily: F.displayMed, fontSize: 11 },
  hub: { position: "absolute", bottom: 6, alignItems: "center", width: 300 },
  name: { color: C.cyan, fontFamily: F.displayMed, fontSize: 15, letterSpacing: 1.6 },
  purpose: { color: C.dim, fontFamily: F.typed, fontSize: 11, textAlign: "center", marginTop: 2 },
  hint: { color: C.cyan, fontFamily: F.typed, fontSize: 11.5, textAlign: "center", marginTop: 6 },
});
