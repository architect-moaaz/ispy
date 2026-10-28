import React, { useEffect, useRef } from "react";
import { Animated, Easing, Text, View } from "react-native";
import Svg, { Circle, Defs, Line, Path, RadialGradient, Stop } from "react-native-svg";
import { C, F } from "../theme";

const SIZE = 268;
const CX = SIZE / 2;
const R = CX - 10;

/**
 * Amber sonar. A sweep turns continuously; the target is a blip placed by bearing,
 * with distance mapped on a log scale (20 m at the first ring, ~2 km at the rim).
 */
export function Radar({
  bearing, distanceM, approachRadiusM, locked,
}: { bearing: number | null; distanceM: number | null; approachRadiusM: number; locked: boolean }) {
  const sweep = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const a = Animated.loop(Animated.timing(sweep, { toValue: 1, duration: 3200, easing: Easing.linear, useNativeDriver: true }));
    const p = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 0, useNativeDriver: true }),
    ]));
    a.start(); p.start();
    return () => { a.stop(); p.stop(); };
  }, []);

  const inRange = distanceM != null && distanceM <= approachRadiusM;
  const color = locked ? C.dim : inRange ? C.ok : C.amber;
  const blipR = distanceM == null ? 0 : Math.min(R - 10, (R - 10) * Math.log10(1 + distanceM / 20) / Math.log10(101));
  const ang = ((bearing ?? 0) - 90) * (Math.PI / 180);
  const bx = CX + blipR * Math.cos(ang);
  const by = CX + blipR * Math.sin(ang);
  const rotate = sweep.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
  const ringScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.4, 2.6] });
  const ringOpacity = pulse.interpolate({ inputRange: [0, 0.7, 1], outputRange: [0.8, 0.2, 0] });

  return (
    <View style={{ alignItems: "center", marginVertical: 6 }}>
      <View style={{ width: SIZE, height: SIZE }}>
        <Svg width={SIZE} height={SIZE}>
          <Defs>
            <RadialGradient id="glow" cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor={C.amber} stopOpacity={0.16} />
              <Stop offset="1" stopColor={C.amber} stopOpacity={0.02} />
            </RadialGradient>
          </Defs>
          <Circle cx={CX} cy={CX} r={R} fill="url(#glow)" stroke={C.amber} strokeOpacity={0.55} strokeWidth={1.5} />
          {[0.25, 0.5, 0.75].map((k) => <Circle key={k} cx={CX} cy={CX} r={R * k} stroke={C.amber} strokeOpacity={0.22} strokeWidth={1} fill="none" />)}
          {Array.from({ length: 36 }, (_, i) => {
            const a = (i * 10 * Math.PI) / 180;
            const long = i % 9 === 0;
            const r0 = long ? R - 12 : R - 5;
            return <Line key={i} x1={CX + r0 * Math.cos(a)} y1={CX + r0 * Math.sin(a)} x2={CX + R * Math.cos(a)} y2={CX + R * Math.sin(a)} stroke={C.amber} strokeOpacity={long ? 0.8 : 0.3} strokeWidth={1} />;
          })}
          <Line x1={CX} y1={CX - R} x2={CX} y2={CX + R} stroke={C.amber} strokeOpacity={0.12} />
          <Line x1={CX - R} y1={CX} x2={CX + R} y2={CX} stroke={C.amber} strokeOpacity={0.12} />
          <Circle cx={CX} cy={CX} r={3} fill={C.amber} />
        </Svg>
        {/* Sweep: a wedge that trails fading amber behind the leading edge. */}
        <Animated.View style={{ position: "absolute", width: SIZE, height: SIZE, transform: [{ rotate }] }} pointerEvents="none">
          <Svg width={SIZE} height={SIZE}>
            <Path d={`M${CX} ${CX} L${CX} ${CX - R} A${R} ${R} 0 0 1 ${CX + R * Math.sin(0.9)} ${CX - R * Math.cos(0.9)} Z`} fill={C.amber} fillOpacity={0.14} />
            <Line x1={CX} y1={CX} x2={CX} y2={CX - R} stroke={C.amber} strokeWidth={2} strokeOpacity={0.95} />
          </Svg>
        </Animated.View>
        {distanceM != null && (
          <>
            <Animated.View pointerEvents="none" style={{ position: "absolute", left: bx - 10, top: by - 10, width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: color, transform: [{ scale: ringScale }], opacity: ringOpacity }} />
            <View pointerEvents="none" style={{ position: "absolute", left: bx - 6, top: by - 6, width: 12, height: 12, borderRadius: 6, backgroundColor: color, shadowColor: color, shadowOpacity: 0.9, shadowRadius: 8 }} />
          </>
        )}
      </View>
      <Text style={{ color, fontFamily: F.display, fontSize: 56, lineHeight: 56, marginTop: 4 }}>
        {distanceM == null ? "—" : distanceM < 1000 ? `${Math.round(distanceM)} m` : `${(distanceM / 1000).toFixed(2)} km`}
      </Text>
      <Text style={{ color: C.dim, fontFamily: F.displayMed, fontSize: 16 }}>
        {bearing == null ? "Waiting for your position" : inRange ? "You are on site" : locked ? `Bearing ${Math.round(bearing)}°. Site locked until your desk clears it.` : `Bearing ${Math.round(bearing)}°. Scan within ${approachRadiusM} m.`}
      </Text>
    </View>
  );
}
