import React from "react";
import { Image, View } from "react-native";
import Svg, { Circle, G, Path, Rect } from "react-native-svg";
import { C, factionColor } from "./theme";
import { ART } from "./art";

/** Painted faction crest with a glow ring in the faction colour. */
export function FactionEmblem({ id, size = 48 }: { id?: string | null; size?: number; badge?: boolean }) {
  const color = factionColor(id);
  const src = id ? ART.emblem[id] : undefined;
  if (!src) return <View style={{ width: size, height: size }}><Svg width={size} height={size} viewBox="0 0 100 100"><EyeMark /></Svg></View>;
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, overflow: "hidden", shadowColor: color, shadowOpacity: 0.8, shadowRadius: size / 5, elevation: 6, backgroundColor: C.ink }}>
      <Image source={src} style={{ width: size, height: size }} resizeMode="cover" />
    </View>
  );
}

/** Painted chief portrait in a framed roundel with a faction-coloured ring and glow. */
export function ChiefAvatar({ factionId, size = 120, square }: { factionId?: string | null; size?: number; square?: boolean }) {
  const color = factionColor(factionId);
  const src = factionId ? ART.portrait[factionId] : undefined;
  const r = square ? 6 : size / 2;
  return (
    <View style={{ width: size, height: size, borderRadius: r, borderWidth: 2, borderColor: color, overflow: "hidden", shadowColor: color, shadowOpacity: 0.7, shadowRadius: size / 6, elevation: 8, backgroundColor: C.ink2 }}>
      {src && <Image source={src} style={{ width: size - 4, height: size - 4 }} resizeMode="cover" />}
    </View>
  );
}

/** Full-bleed portrait banner for HQ: portrait left, crest right, fading into the panel. */
export function ChiefBanner({ factionId, height = 220 }: { factionId?: string | null; height?: number }) {
  const color = factionColor(factionId);
  const src = factionId ? ART.portrait[factionId] : undefined;
  const crest = factionId ? ART.emblem[factionId] : undefined;
  return (
    <View style={{ height, borderWidth: 1, borderColor: color + "88", overflow: "hidden", backgroundColor: C.ink2, flexDirection: "row" }}>
      {src && <Image source={src} style={{ width: height, height }} resizeMode="cover" />}
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        {crest && <Image source={crest} style={{ width: height * 0.72, height: height * 0.72, borderRadius: height * 0.36 }} resizeMode="cover" />}
      </View>
    </View>
  );
}

// ---------- the game's own mark: an eye in a keyhole ----------
export function EyeMark({ color = C.cyan }: { color?: string }) {
  return (
    <G>
      <Path d="M14 50 C28 30 72 30 86 50 C72 70 28 70 14 50 Z" fill="none" stroke={color} strokeWidth={6} strokeLinejoin="round" />
      <Circle cx={50} cy={50} r={13} fill={color} />
      <Circle cx={50} cy={50} r={5} fill={C.ink} />
      <Path d="M50 63 L44 86 L56 86 Z" fill={color} />
    </G>
  );
}
export function AppMark({ size = 96 }: { size?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size * 0.22, overflow: "hidden", shadowColor: C.cyan, shadowOpacity: 0.7, shadowRadius: size / 5, elevation: 8 }}>
      <Image source={ART.icon} style={{ width: size, height: size }} />
    </View>
  );
}

// ---------- mission marks ----------
export function MissionMark({ template, size = 28, color = C.text }: { template: string; size?: number; color?: string }) {
  const sw = 7;
  const body = {
    RECON: <G><Path d="M12 50 C26 28 74 28 88 50 C74 72 26 72 12 50 Z" fill="none" stroke={color} strokeWidth={sw} strokeLinejoin="round" /><Circle cx={50} cy={50} r={11} fill={color} /></G>,
    DEAD_DROP: <G><Rect x={18} y={30} width={64} height={52} rx={4} fill="none" stroke={color} strokeWidth={sw} /><Path d="M18 44 L82 44 M34 30 L34 18 L66 18 L66 30" fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" /><Path d="M40 56 L60 72 M60 56 L40 72" stroke={color} strokeWidth={sw} strokeLinecap="round" /></G>,
    EXTRACTION: <G><Circle cx={22} cy={70} r={9} fill={color} /><Circle cx={78} cy={30} r={9} fill="none" stroke={color} strokeWidth={sw} /><Path d="M30 62 L68 38" stroke={color} strokeWidth={sw} strokeLinecap="round" /><Path d="M56 36 L70 36 L70 50" fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" /></G>,
    CIPHER: <G><Circle cx={34} cy={40} r={16} fill="none" stroke={color} strokeWidth={sw} /><Path d="M46 52 L82 82 M70 70 L78 62 M60 60 L68 52" stroke={color} strokeWidth={sw} strokeLinecap="round" /></G>,
    ANALYSIS: <G><Circle cx={44} cy={44} r={22} fill="none" stroke={color} strokeWidth={sw} /><Path d="M60 60 L84 84" stroke={color} strokeWidth={sw} strokeLinecap="round" /><Path d="M34 44 L54 44 M44 34 L44 54" stroke={color} strokeWidth={5} strokeLinecap="round" /></G>,
  }[template] ?? <Circle cx={50} cy={50} r={20} fill={color} />;
  return <Svg width={size} height={size} viewBox="0 0 100 100">{body}</Svg>;
}

/** Three faction crests side by side, for the welcome screen. */
export function FactionRow({ size = 56 }: { size?: number }) {
  return (
    <View style={{ flexDirection: "row", gap: 16, alignItems: "center" }}>
      <FactionEmblem id="raven" size={size} />
      <FactionEmblem id="phantom" size={size} />
      <FactionEmblem id="cipher" size={size} />
    </View>
  );
}
