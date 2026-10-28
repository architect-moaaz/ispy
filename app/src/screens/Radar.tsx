import React from "react";
import { View, Text } from "react-native";
import Svg, { Circle, Line, Polygon, G } from "react-native-svg";
import { C, mono } from "../theme";

// Bearing arrow on a radar ring. The blip sits at the bearing, scaled by distance (log).
export function Radar({
  bearing,
  distanceM,
  approachRadiusM,
  locked,
}: {
  bearing: number | null;
  distanceM: number | null;
  approachRadiusM: number;
  locked: boolean;
}) {
  const size = 240;
  const c = size / 2;
  const r = c - 12;
  const inRange = distanceM != null && distanceM <= approachRadiusM;
  const color = locked ? C.warn : inRange ? C.accent : C.info;
  // 0 m at centre, ~2 km at the rim.
  const blipR = distanceM == null ? 0 : Math.min(r - 8, (r - 8) * Math.log10(1 + distanceM / 20) / Math.log10(101));
  const ang = ((bearing ?? 0) - 90) * (Math.PI / 180);
  const bx = c + blipR * Math.cos(ang);
  const by = c + blipR * Math.sin(ang);

  return (
    <View style={{ alignItems: "center", marginVertical: 8 }}>
      <Svg width={size} height={size}>
        <Circle cx={c} cy={c} r={r} stroke={C.line} strokeWidth={1} fill={C.panel} />
        <Circle cx={c} cy={c} r={r * 0.66} stroke={C.line} strokeWidth={1} fill="none" />
        <Circle cx={c} cy={c} r={r * 0.33} stroke={C.line} strokeWidth={1} fill="none" />
        <Line x1={c} y1={12} x2={c} y2={size - 12} stroke={C.line} strokeWidth={1} />
        <Line x1={12} y1={c} x2={size - 12} y2={c} stroke={C.line} strokeWidth={1} />
        <Circle cx={c} cy={c} r={4} fill={C.text} />
        {bearing != null && (
          <G rotation={bearing} origin={`${c}, ${c}`}>
            <Polygon points={`${c},${c - r + 18} ${c - 7},${c - r + 34} ${c + 7},${c - r + 34}`} fill={color} />
          </G>
        )}
        {distanceM != null && <Circle cx={bx} cy={by} r={7} fill={color} opacity={0.9} />}
      </Svg>
      <Text style={{ color, fontSize: 28, fontWeight: "700", ...mono }}>
        {distanceM == null ? "— m" : distanceM < 1000 ? `${Math.round(distanceM)} m` : `${(distanceM / 1000).toFixed(2)} km`}
      </Text>
      <Text style={{ color: C.dim, ...mono }}>
        {bearing == null ? "waiting for position" : `bearing ${Math.round(bearing)}° · arrive within ${approachRadiusM} m`}
      </Text>
    </View>
  );
}
