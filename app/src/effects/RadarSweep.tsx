import React, { useEffect, useRef } from "react";
import { Animated, Easing, Text, View } from "react-native";
import Svg, { Circle, G, Line, Path } from "react-native-svg";
import { C, F, factionColor } from "../theme";

interface RadarSweepProps {
  size?: number;
  color?: string;
  bearing?: number | null;
  blips?: { x: number; y: number; factionId?: string }[];
}

/**
 * Animated Tactical Radar with rotating sweep line, concentric distance rings, and contact indicators.
 */
export function RadarSweep({
  size = 96,
  color = C.cyan,
  bearing = null,
  blips = [],
}: RadarSweepProps) {
  const spin = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const sweepAnim = Animated.loop(
      Animated.timing(spin, { toValue: 1, duration: 3200, easing: Easing.linear, useNativeDriver: true })
    );
    sweepAnim.start();
    return () => sweepAnim.stop();
  }, []);

  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
  const center = size / 2;
  const radius = center - 4;

  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      {/* Base Grid Rings */}
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <Circle cx={center} cy={center} r={radius} fill={C.glass} stroke={color} strokeOpacity={0.8} strokeWidth={1.5} />
        <Circle cx={center} cy={center} r={radius * 0.66} fill="none" stroke={color} strokeOpacity={0.35} strokeWidth={1} />
        <Circle cx={center} cy={center} r={radius * 0.33} fill="none" stroke={color} strokeOpacity={0.35} strokeWidth={1} />

        {/* Crosshair axes */}
        <Line x1={center} y1={4} x2={center} y2={size - 4} stroke={color} strokeOpacity={0.25} strokeWidth={1} />
        <Line x1={4} y1={center} x2={size - 4} y2={center} stroke={color} strokeOpacity={0.25} strokeWidth={1} />

        {/* Target Heading Line */}
        {bearing != null && (
          <Line
            x1={center}
            y1={center}
            x2={center + (radius - 4) * Math.sin((bearing * Math.PI) / 180)}
            y2={center - (radius - 4) * Math.cos((bearing * Math.PI) / 180)}
            stroke={C.red}
            strokeWidth={2}
          />
        )}

        {/* Contact Blips */}
        {blips.map((b, idx) => (
          <Circle
            key={idx}
            cx={center + b.x * (radius * 0.8)}
            cy={center + b.y * (radius * 0.8)}
            r={3}
            fill={factionColor(b.factionId)}
          />
        ))}

        {/* Center Operative Dot */}
        <Circle cx={center} cy={center} r={3} fill={color} />
      </Svg>

      {/* Rotating Sweep Line */}
      <Animated.View
        style={{
          position: "absolute",
          width: size,
          height: size,
          alignItems: "center",
          justifyContent: "center",
          transform: [{ rotate }],
        }}
      >
        <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <Line x1={center} y1={center} x2={center} y2={4} stroke={color} strokeWidth={1.5} strokeOpacity={0.8} />
          {/* Sweep Sector Arc */}
          <Path
            d={`M ${center} ${center} L ${center} 4 A ${radius} ${radius} 0 0 1 ${center + radius * 0.5} ${center - radius * 0.86} Z`}
            fill={color}
            fillOpacity={0.12}
          />
        </Svg>
      </Animated.View>
    </View>
  );
}
