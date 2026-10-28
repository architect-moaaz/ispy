import React from "react";
import { View } from "react-native";
import Svg, { Circle, Defs, G, Line, Path, Polygon, RadialGradient, Rect, Stop } from "react-native-svg";
import { C, factionColor } from "./theme";

/**
 * Night Bureau marks. Everything is drawn on a 100×100 box, two stroke weights (3 and 6),
 * so the set reads as one hand. Faction colour comes from the theme.
 */

// ---------- faction emblems ----------
function RavenMark({ color }: { color: string }) {
  // A raven in profile reduced to beak, skull and one unblinking eye.
  return (
    <G>
      <Path d="M18 62 C18 36 38 22 60 24 L84 30 L66 36 C74 46 72 62 60 70 L44 72 L30 84 L34 68 C24 66 18 64 18 62 Z" fill={color} />
      <Circle cx={56} cy={40} r={5} fill={C.ink} />
      <Circle cx={57} cy={39} r={1.8} fill={color} />
    </G>
  );
}
function PhantomMark({ color }: { color: string }) {
  // A hood with nothing inside it.
  return (
    <G>
      <Path d="M50 14 C28 14 20 36 20 56 L20 84 L80 84 L80 56 C80 36 72 14 50 14 Z" fill={color} />
      <Path d="M50 30 C36 30 32 44 32 58 L32 84 L68 84 L68 58 C68 44 64 30 50 30 Z" fill={C.ink} />
      <Path d="M38 62 L46 56 M62 62 L54 56" stroke={color} strokeWidth={4} strokeLinecap="round" />
    </G>
  );
}
function CipherMark({ color }: { color: string }) {
  // A hexagonal key with a broken grid: systems break.
  return (
    <G>
      <Polygon points="50,10 84,30 84,70 50,90 16,70 16,30" fill="none" stroke={color} strokeWidth={6} strokeLinejoin="round" />
      <Circle cx={50} cy={42} r={11} fill="none" stroke={color} strokeWidth={6} />
      <Path d="M50 53 L50 76 M50 66 L60 66 M50 74 L58 74" stroke={color} strokeWidth={6} strokeLinecap="round" />
    </G>
  );
}

export function FactionEmblem({ id, size = 48, badge = true }: { id?: string | null; size?: number; badge?: boolean }) {
  const color = factionColor(id);
  const Mark = id === "raven" ? RavenMark : id === "phantom" ? PhantomMark : id === "cipher" ? CipherMark : EyeMark;
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      {badge && <Circle cx={50} cy={50} r={48} fill={C.ink} stroke={color} strokeWidth={3} />}
      <Mark color={color} />
    </Svg>
  );
}

// ---------- the game's own mark: an eye in a keyhole ----------
export function EyeMark({ color = C.amber }: { color?: string }) {
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
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Defs>
        <RadialGradient id="am" cx="50%" cy="45%" r="55%">
          <Stop offset="0" stopColor={C.amber} stopOpacity={0.28} />
          <Stop offset="1" stopColor={C.amber} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Rect x={0} y={0} width={100} height={100} rx={22} fill={C.ink} />
      <Rect x={0} y={0} width={100} height={100} rx={22} fill="url(#am)" />
      <EyeMark />
    </Svg>
  );
}

// ---------- chief avatars: the faction mark inside a paper roundel with a sweep ----------
export function ChiefAvatar({ factionId, size = 120 }: { factionId?: string | null; size?: number }) {
  const color = factionColor(factionId);
  const Mark = factionId === "raven" ? RavenMark : factionId === "phantom" ? PhantomMark : CipherMark;
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} viewBox="0 0 100 100">
        <Circle cx={50} cy={50} r={48} fill={C.paper} />
        <Circle cx={50} cy={50} r={48} fill="none" stroke={color} strokeWidth={4} />
        <Circle cx={50} cy={50} r={40} fill={C.ink} />
        {Array.from({ length: 24 }, (_, i) => {
          const a = (i * 15 * Math.PI) / 180;
          return <Line key={i} x1={50 + 42 * Math.cos(a)} y1={50 + 42 * Math.sin(a)} x2={50 + 46 * Math.cos(a)} y2={50 + 46 * Math.sin(a)} stroke={color} strokeWidth={1.5} />;
        })}
        <G transform="translate(14 14) scale(0.72)"><Mark color={color} /></G>
      </Svg>
    </View>
  );
}

// ---------- mission marks ----------
export function MissionMark({ template, size = 28, color = C.onPaper }: { template: string; size?: number; color?: string }) {
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

/** Three faction badges side by side, for the welcome screen. */
export function FactionRow({ size = 56 }: { size?: number }) {
  return (
    <View style={{ flexDirection: "row", gap: 14, alignItems: "center" }}>
      <FactionEmblem id="raven" size={size} />
      <FactionEmblem id="phantom" size={size} />
      <FactionEmblem id="cipher" size={size} />
    </View>
  );
}
