import React from "react";
import { Image, View } from "react-native";
import Svg, { Circle, G, Line, Path, Polygon, Polyline, Rect } from "react-native-svg";
import { C, factionColor, factionGlow } from "./theme";
import { ART } from "./art";

/**
 * Procedural Vector Emblems for all 5 Factions + World Director (PRD Section 3).
 * Rendered at infinite resolution with high-tech cyan/neon cyber accents.
 */
export function ProceduralFactionEmblem({ id, size = 48, color }: { id?: string | null; size?: number; color?: string }) {
  const c = color ?? factionColor(id);
  const sw = 3.5;

  let body = null;
  switch (id) {
    case "raven": // Chief ORACLE: Evidence, investigation, pattern recognition
      body = (
        <G>
          <Circle cx={50} cy={50} r={42} fill="none" stroke={c} strokeWidth={sw} />
          <Circle cx={50} cy={50} r={28} fill="none" stroke={c} strokeWidth={2} strokeDasharray="5,4" />
          <Circle cx={50} cy={50} r={13} fill={c} />
          <Circle cx={50} cy={50} r={4} fill={C.ink} />
          <Line x1={50} y1={8} x2={50} y2={22} stroke={c} strokeWidth={2.5} strokeLinecap="round" />
          <Line x1={50} y1={78} x2={50} y2={92} stroke={c} strokeWidth={2.5} strokeLinecap="round" />
          <Line x1={8} y1={50} x2={22} y2={50} stroke={c} strokeWidth={2.5} strokeLinecap="round" />
          <Line x1={78} y1={50} x2={92} y2={50} stroke={c} strokeWidth={2.5} strokeLinecap="round" />
        </G>
      );
      break;

    case "phantom": // Chief GHOST: Decoys, stealth, misdirection
      body = (
        <G>
          <Polygon points="50,14 84,34 84,66 50,86 16,66 16,34" fill="none" stroke={c} strokeWidth={sw} />
          <Polygon points="50,26 72,40 72,60 50,74 28,60 28,40" fill="none" stroke={c} strokeWidth={2} strokeDasharray="4,4" />
          <Polygon points="50,38 62,48 50,58 38,48" fill={c} opacity={0.85} />
        </G>
      );
      break;

    case "sentinel": // Chief ATLAS: Defense, group coordination, protection
      body = (
        <G>
          <Path d="M50 12 L84 26 V52 C84 72 50 88 50 88 C50 88 16 72 16 52 V26 Z" fill="none" stroke={c} strokeWidth={sw} />
          <Path d="M50 25 L72 35 V52 C72 65 50 76 50 76 C50 76 28 65 28 52 V35 Z" fill={c} opacity={0.3} />
          <Circle cx={50} cy={48} r={9} fill={c} />
          <Circle cx={50} cy={48} r={3} fill={C.ink} />
          <Line x1={50} y1={25} x2={50} y2={39} stroke={c} strokeWidth={2} />
        </G>
      );
      break;

    case "cipher": // Chief NEXUS: Cryptography, systems puzzles, simulations
      body = (
        <G>
          <Rect x={18} y={18} width={64} height={64} rx={8} fill="none" stroke={c} strokeWidth={sw} />
          <Line x1={32} y1={32} x2={68} y2={68} stroke={c} strokeWidth={2} />
          <Line x1={68} y1={32} x2={32} y2={68} stroke={c} strokeWidth={2} />
          <Circle cx={50} cy={50} r={17} fill={C.ink} stroke={c} strokeWidth={2.5} />
          <Circle cx={50} cy={50} r={6} fill={c} />
        </G>
      );
      break;

    case "viper": // Chief VEX: Negotiation, alliances, social strategy
      body = (
        <G>
          <Path d="M25 76 C25 40 75 40 75 76" fill="none" stroke={c} strokeWidth={sw} strokeLinecap="round" />
          <Path d="M35 24 C35 60 65 60 65 24" fill="none" stroke={c} strokeWidth={sw} strokeLinecap="round" />
          <Circle cx={50} cy={47} r={7} fill={c} />
          <Polygon points="50,14 56,25 44,25" fill={c} />
          <Polygon points="50,86 56,75 44,75" fill={c} />
        </G>
      );
      break;

    case "director": // World Director: Invariant Truth Engine
    default:
      body = (
        <G>
          <Circle cx={50} cy={50} r={42} fill="none" stroke={c} strokeWidth={sw} />
          <Circle cx={50} cy={50} r={30} fill="none" stroke={c} strokeWidth={2} strokeDasharray="3,3" />
          <Polygon points="50,18 78,68 22,68" fill="none" stroke={c} strokeWidth={2.5} />
          <Circle cx={50} cy={51} r={6} fill={c} />
        </G>
      );
      break;
  }

  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      {body}
    </Svg>
  );
}

/** Painted faction crest with a glow ring, fallback to vector emblem if image is absent. */
export function FactionEmblem({ id, size = 48 }: { id?: string | null; size?: number; badge?: boolean }) {
  const color = factionColor(id);
  const src = id ? ART.emblem[id] : undefined;

  if (!src) {
    return (
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: 1.5,
          borderColor: color,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: C.ink,
          shadowColor: color,
          shadowOpacity: 0.8,
          shadowRadius: size / 5,
          elevation: 6,
        }}
      >
        <ProceduralFactionEmblem id={id} size={size * 0.76} color={color} />
      </View>
    );
  }

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        overflow: "hidden",
        shadowColor: color,
        shadowOpacity: 0.8,
        shadowRadius: size / 5,
        elevation: 6,
        backgroundColor: C.ink,
        borderWidth: 1,
        borderColor: color,
      }}
    >
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
    <View
      style={{
        width: size,
        height: size,
        borderRadius: r,
        borderWidth: 2,
        borderColor: color,
        overflow: "hidden",
        shadowColor: color,
        shadowOpacity: 0.7,
        shadowRadius: size / 6,
        elevation: 8,
        backgroundColor: C.ink2,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {src ? (
        <Image source={src} style={{ width: size - 4, height: size - 4 }} resizeMode="cover" />
      ) : (
        <ProceduralFactionEmblem id={factionId} size={size * 0.75} color={color} />
      )}
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
      <View style={{ width: height, height, alignItems: "center", justifyContent: "center", backgroundColor: C.ink }}>
        {src ? (
          <Image source={src} style={{ width: height, height }} resizeMode="cover" />
        ) : (
          <ProceduralFactionEmblem id={factionId} size={height * 0.7} color={color} />
        )}
      </View>
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        {crest ? (
          <Image source={crest} style={{ width: height * 0.72, height: height * 0.72, borderRadius: height * 0.36 }} resizeMode="cover" />
        ) : (
          <FactionEmblem id={factionId} size={height * 0.65} />
        )}
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

// ---------- 3D Isometric Holographic Dead-Drop Cache ----------
export function HoloDeadDropSvg({ size = 100, color = C.cyan }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      {/* Outer Rotating Containment Rings */}
      <Circle cx={50} cy={50} r={46} fill="none" stroke={color} strokeWidth={1} strokeDasharray="6,8" opacity={0.6} />
      <Circle cx={50} cy={50} r={41} fill="none" stroke={color} strokeWidth={1.5} opacity={0.8} />

      {/* 3D Isometric Case Top Face */}
      <Polygon points="50,22 76,34 50,46 24,34" fill={C.ink2} stroke={color} strokeWidth={2} />
      {/* Left Face */}
      <Polygon points="24,34 50,46 50,68 24,56" fill={C.ink} stroke={color} strokeWidth={2} />
      {/* Right Face */}
      <Polygon points="50,46 76,34 76,56 50,68" fill={C.ink2} stroke={color} strokeWidth={2} />

      {/* Core Glowing Power Cell */}
      <Circle cx={50} cy={46} r={6} fill={color} />
      <Circle cx={50} cy={46} r={2} fill="#FFFFFF" />

      {/* Floating Tactical Data Brackets */}
      <Polyline points="12,28 12,18 22,18" fill="none" stroke={color} strokeWidth={2} />
      <Polyline points="88,28 88,18 78,18" fill="none" stroke={color} strokeWidth={2} />
      <Polyline points="12,72 12,82 22,82" fill="none" stroke={color} strokeWidth={2} />
      <Polyline points="88,72 88,82 78,82" fill="none" stroke={color} strokeWidth={2} />
    </Svg>
  );
}

// ---------- Complete PRD Section 7.1 Mission Taxonomy Marks ----------
export function MissionMark({ template, size = 28, color = C.text }: { template: string; size?: number; color?: string }) {
  const sw = 7;
  const body = {
    RECON: (
      <G>
        <Path d="M12 50 C26 28 74 28 88 50 C74 72 26 72 12 50 Z" fill="none" stroke={color} strokeWidth={sw} strokeLinejoin="round" />
        <Circle cx={50} cy={50} r={11} fill={color} />
      </G>
    ),
    DEAD_DROP: (
      <G>
        <Rect x={18} y={30} width={64} height={52} rx={4} fill="none" stroke={color} strokeWidth={sw} />
        <Path d="M18 44 L82 44 M34 30 L34 18 L66 18 L66 30" fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" />
        <Path d="M40 56 L60 72 M60 56 L40 72" stroke={color} strokeWidth={sw} strokeLinecap="round" />
      </G>
    ),
    EXTRACTION: (
      <G>
        <Circle cx={22} cy={70} r={9} fill={color} />
        <Circle cx={78} cy={30} r={9} fill="none" stroke={color} strokeWidth={sw} />
        <Path d="M30 62 L68 38" stroke={color} strokeWidth={sw} strokeLinecap="round" />
        <Path d="M56 36 L70 36 L70 50" fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
      </G>
    ),
    CIPHER: (
      <G>
        <Circle cx={34} cy={40} r={16} fill="none" stroke={color} strokeWidth={sw} />
        <Path d="M46 52 L82 82 M70 70 L78 62 M60 60 L68 52" stroke={color} strokeWidth={sw} strokeLinecap="round" />
      </G>
    ),
    ANALYSIS: (
      <G>
        <Circle cx={44} cy={44} r={22} fill="none" stroke={color} strokeWidth={sw} />
        <Path d="M60 60 L84 84" stroke={color} strokeWidth={sw} strokeLinecap="round" />
        <Path d="M34 44 L54 44 M44 34 L44 54" stroke={color} strokeWidth={5} strokeLinecap="round" />
      </G>
    ),
    TERRITORY: (
      <G>
        <Polygon points="50,14 84,34 84,66 50,86 16,66 16,34" fill="none" stroke={color} strokeWidth={sw} />
        <Circle cx={50} cy={50} r={12} fill={color} />
      </G>
    ),
    INVESTIGATION: (
      <G>
        <Circle cx={45} cy={45} r={24} fill="none" stroke={color} strokeWidth={sw} />
        <Line x1={62} y1={62} x2={86} y2={86} stroke={color} strokeWidth={sw + 2} strokeLinecap="round" />
        <Circle cx={45} cy={45} r={8} fill={color} />
      </G>
    ),
    DOUBLE_AGENT: (
      <G>
        <Path d="M30 35 C30 25 45 25 50 35 C55 25 70 25 70 35 C70 55 50 75 50 75 C50 75 30 55 30 35 Z" fill="none" stroke={color} strokeWidth={sw} />
        <Line x1={50} y1={25} x2={50} y2={75} stroke={color} strokeWidth={4} strokeDasharray="6,4" />
      </G>
    ),
    BOUNTY: (
      <G>
        <Circle cx={50} cy={50} r={34} fill="none" stroke={color} strokeWidth={sw} />
        <Path d="M42 34 L58 34 M50 34 L50 66 M42 66 L58 66" stroke={color} strokeWidth={sw} strokeLinecap="round" />
      </G>
    ),
    NEGOTIATION: (
      <G>
        <Path d="M22 55 L38 38 L54 54 L78 30" fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" />
        <Circle cx={22} cy={55} r={6} fill={color} />
        <Circle cx={78} cy={30} r={6} fill={color} />
      </G>
    ),
  }[template] ?? <Circle cx={50} cy={50} r={20} fill={color} />;

  return <Svg width={size} height={size} viewBox="0 0 100 100">{body}</Svg>;
}

/** All five faction crests side by side, for welcome screens and faction pickers. */
export function FactionRow({ size = 48 }: { size?: number }) {
  return (
    <View style={{ flexDirection: "row", gap: 12, alignItems: "center", justifyContent: "center" }}>
      {/* Only the agencies that exist in the live world; SENTINEL and VIPER wait for their chiefs. */}
      <FactionEmblem id="raven" size={size} />
      <FactionEmblem id="phantom" size={size} />
      <FactionEmblem id="cipher" size={size} />
    </View>
  );
}
