import React, { useEffect, useRef } from "react";
import { Animated, Dimensions, Easing, StyleSheet, Text, View } from "react-native";
import Svg, { Circle, G, Line, Path, Polygon, Rect } from "react-native-svg";
import { C, F, factionColor } from "../theme";

interface TacticalHUDProps {
  heading?: number;
  pitch?: number;
  color?: string;
  codename?: string;
  factionId?: string | null;
  statusText?: string;
  showScanlines?: boolean;
}

/**
 * High-tech "Spy Vision" AR Tactical HUD Overlay.
 * Renders animated scanning grids, corner brackets, gyroscope telemetry, and pitch/heading indicators.
 */
export function TacticalHUD({
  heading = 42,
  pitch = -4.8,
  color = C.cyan,
  codename,
  factionId,
  statusText = "SATELLITE ENCRYPTION: ACTIVE",
  showScanlines = true,
}: TacticalHUDProps) {
  const { width, height } = Dimensions.get("window");
  const pulse = useRef(new Animated.Value(0.5)).current;
  const sweep = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const pulseAnim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1800, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.4, duration: 1800, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ])
    );
    const sweepAnim = Animated.loop(
      Animated.timing(sweep, { toValue: 1, duration: 4000, easing: Easing.linear, useNativeDriver: true })
    );

    pulseAnim.start();
    sweepAnim.start();
    return () => {
      pulseAnim.stop();
      sweepAnim.stop();
    };
  }, []);

  const sweepTranslateY = sweep.interpolate({
    inputRange: [0, 1],
    outputRange: [0, height],
  });

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {/* Background Grid & Corner Targeting Brackets */}
      <Svg style={StyleSheet.absoluteFill} width={width} height={height}>
        {/* Subtle Grid */}
        {showScanlines &&
          Array.from({ length: Math.ceil(width / 48) + 1 }, (_, i) => (
            <Line key={`v${i}`} x1={i * 48} y1={0} x2={i * 48} y2={height} stroke={color} strokeOpacity={0.05} />
          ))}
        {showScanlines &&
          Array.from({ length: Math.ceil(height / 48) + 1 }, (_, i) => (
            <Line key={`h${i}`} x1={0} y1={i * 48} x2={width} y2={i * 48} stroke={color} strokeOpacity={0.05} />
          ))}

        {/* 4 Corner Targeting Brackets */}
        <Path
          d={`M 16 64 V 24 H 64 M ${width - 64} 24 H ${width - 16} V 64 M 16 ${height - 64} V ${height - 24} H 64 M ${width - 64} ${height - 24} H ${width - 16} V ${height - 64}`}
          stroke={color}
          strokeWidth={2}
          fill="none"
        />

        {/* Top Center Azimuth Tape */}
        <Line x1={width / 2 - 80} y1={28} x2={width / 2 + 80} y2={28} stroke={color} strokeWidth={1.5} strokeOpacity={0.5} />
        <Line x1={width / 2} y1={22} x2={width / 2} y2={34} stroke={color} strokeWidth={2} />
      </Svg>

      {/* Moving Laser Sweep Bar */}
      {showScanlines && (
        <Animated.View
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            height: 2,
            backgroundColor: color,
            opacity: 0.15,
            transform: [{ translateY: sweepTranslateY }],
          }}
        />
      )}

      {/* Top HUD Telemetry */}
      <View style={{ position: "absolute", top: 32, alignSelf: "center", alignItems: "center" }}>
        <Text style={{ color, fontFamily: F.typedBold, fontSize: 11, letterSpacing: 2 }}>
          {`${heading.toString().padStart(3, "0")}° AZIMUTH`}
        </Text>
      </View>

      {/* Left Data Column */}
      <View style={{ position: "absolute", left: 24, top: 96, gap: 4 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Animated.View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color, opacity: pulse }} />
          <Text style={{ color, fontFamily: F.typedBold, fontSize: 10, letterSpacing: 1.5 }}>
            {statusText}
          </Text>
        </View>
        {codename && (
          <Text style={{ color: C.text, fontFamily: F.typed, fontSize: 11 }}>
            OPERATIVE: [{codename.toUpperCase()}]
          </Text>
        )}
        <Text style={{ color: C.dim, fontFamily: F.typed, fontSize: 10 }}>
          PITCH: {pitch > 0 ? `+${pitch.toFixed(1)}°` : `${pitch.toFixed(1)}°`}
        </Text>
      </View>

      {/* Right Data Column */}
      <View style={{ position: "absolute", right: 24, top: 96, alignItems: "flex-end", gap: 4 }}>
        <Text style={{ color, fontFamily: F.typedBold, fontSize: 10, letterSpacing: 1.5 }}>
          PRD WDA-02 SECURE VIEW
        </Text>
        <Text style={{ color: C.dim, fontFamily: F.typed, fontSize: 10 }}>
          AR ENCOUNTER: OPT-IN ONLY
        </Text>
        <Text style={{ color: C.ok, fontFamily: F.typedBold, fontSize: 10 }}>
          GPS FIX: AUTHORITATIVE
        </Text>
      </View>
    </View>
  );
}
