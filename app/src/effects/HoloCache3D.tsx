import React, { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Polygon, Polyline } from "react-native-svg";
import { C, F, factionColor } from "../theme";

interface HoloCache3DProps {
  factionId?: string | null;
  targetName?: string;
  distanceM?: number | null;
  locked?: boolean;
  size?: number;
}

/**
 * Procedural 3D Holographic Dead-Drop Cache.
 * Features 3D perspective rotation, floating bob, counter-spinning electromagnetic rings,
 * and high-tech telemetry readouts.
 */
export function HoloCache3D({
  factionId,
  targetName = "VIRTUAL PACKET #DD-04",
  distanceM,
  locked = true,
  size = 140,
}: HoloCache3DProps) {
  const color = factionColor(factionId);
  const spinY = useRef(new Animated.Value(0)).current;
  const spinZ = useRef(new Animated.Value(0)).current;
  const bob = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0.7)).current;

  useEffect(() => {
    const animY = Animated.loop(
      Animated.timing(spinY, { toValue: 1, duration: 6000, easing: Easing.linear, useNativeDriver: true })
    );
    const animZ = Animated.loop(
      Animated.timing(spinZ, { toValue: 1, duration: 8000, easing: Easing.linear, useNativeDriver: true })
    );
    const animBob = Animated.loop(
      Animated.sequence([
        Animated.timing(bob, { toValue: 1, duration: 1600, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(bob, { toValue: 0, duration: 1600, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ])
    );
    const animPulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1000, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.6, duration: 1000, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ])
    );

    animY.start();
    animZ.start();
    animBob.start();
    animPulse.start();

    return () => {
      animY.stop();
      animZ.stop();
      animBob.stop();
      animPulse.stop();
    };
  }, []);

  const rotateY = spinY.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
  const rotateZ = spinZ.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "-360deg"] });
  const translateY = bob.interpolate({ inputRange: [0, 1], outputRange: [0, -12] });

  return (
    <View style={{ alignItems: "center", justifyContent: "center" }}>
      {/* Top Telemetry Header */}
      <View style={{ alignItems: "center", marginBottom: 12 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Animated.View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: locked ? C.red : C.ok, opacity: pulse }} />
          <Text style={{ color, fontFamily: F.typedBold, fontSize: 11, letterSpacing: 1.5 }}>
            {locked ? "CONTAINMENT: LOCKED" : "CONTAINMENT: UNSEALED"}
          </Text>
        </View>
        <Text style={{ color: C.text, fontFamily: F.displayMed, fontSize: 16, marginTop: 2 }}>
          {targetName}
        </Text>
        {distanceM != null && (
          <Text style={{ color: C.dim, fontFamily: F.typed, fontSize: 11 }}>
            DISTANCE: {distanceM < 1000 ? `${distanceM.toFixed(1)}M` : `${(distanceM / 1000).toFixed(2)}KM`}
          </Text>
        )}
      </View>

      {/* 3D Floating Cache Assembly */}
      <Animated.View
        style={{
          width: size,
          height: size,
          alignItems: "center",
          justifyContent: "center",
          transform: [{ perspective: 700 }, { translateY }],
        }}
      >
        {/* Outer Counter-Rotating Containment Ring */}
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            {
              alignItems: "center",
              justifyContent: "center",
              transform: [{ rotate: rotateZ }],
            },
          ]}
        >
          <Svg width={size} height={size} viewBox="0 0 100 100">
            <Circle cx={50} cy={50} r={46} fill="none" stroke={color} strokeWidth={1.5} strokeDasharray="8,6" opacity={0.65} />
            <Circle cx={50} cy={50} r={40} fill="none" stroke={C.cyan} strokeWidth={1} strokeDasharray="4,8" opacity={0.4} />
          </Svg>
        </Animated.View>

        {/* 3D Rotating Isometric Box */}
        <Animated.View
          style={{
            width: size * 0.7,
            height: size * 0.7,
            alignItems: "center",
            justifyContent: "center",
            transform: [{ rotateY }, { rotateX: "18deg" }],
          }}
        >
          <Svg width={size * 0.7} height={size * 0.7} viewBox="0 0 100 100">
            {/* Top Plane */}
            <Polygon points="50,18 78,32 50,46 22,32" fill={C.ink2} stroke={color} strokeWidth={2.5} />
            {/* Left Plane */}
            <Polygon points="22,32 50,46 50,74 22,60" fill={C.ink} stroke={color} strokeWidth={2.5} />
            {/* Right Plane */}
            <Polygon points="50,46 78,32 78,60 50,74" fill={C.ink2} stroke={color} strokeWidth={2.5} />

            {/* Glowing Core Orb */}
            <Circle cx={50} cy={46} r={7} fill={color} />
            <Circle cx={50} cy={46} r={3} fill="#FFFFFF" />

            {/* Inner Cyber Circuit Traces */}
            <Polyline points="34,42 42,46 42,62" fill="none" stroke={C.cyan} strokeWidth={1.5} opacity={0.8} />
            <Polyline points="66,42 58,46 58,62" fill="none" stroke={C.cyan} strokeWidth={1.5} opacity={0.8} />
          </Svg>
        </Animated.View>
      </Animated.View>

      {/* Ground Projection Shadows / Sonar Ripples */}
      <View style={{ marginTop: 8, alignItems: "center" }}>
        <Svg width={size * 0.8} height={24} viewBox="0 0 100 24">
          <Circle cx={50} cy={12} r={36} fill="none" stroke={color} strokeWidth={1} opacity={0.3} />
          <Circle cx={50} cy={12} r={18} fill="none" stroke={color} strokeWidth={1.5} opacity={0.6} />
        </Svg>
      </View>
    </View>
  );
}
