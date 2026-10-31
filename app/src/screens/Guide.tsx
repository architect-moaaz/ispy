import React from "react";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { C, F } from "../theme";
import { Surface } from "../ui";
import { fmtM, guide, walkMin, type LatLng, type WalkingRoute } from "../route";

/**
 * Turn-by-turn guidance on the map screen. The arrow points the way to go relative to the way
 * you are walking (your course from the last few fixes); with no course yet it points from north,
 * like the compass. One instruction at a time, the next one small beneath it, and the whole walk
 * summed at the foot. Nobody leaves the app to find a footpath.
 */
export function Guide({ route, at, course, targetName, arriveM }: { route: WalkingRoute; at: LatLng; course: number | null; targetName: string; arriveM: number }) {
  const g = guide(route, at);
  const off = g.offRouteM > 40;
  const next = g.next;
  const bearing = next ? bearingTo(at, next) : null;
  const rel = bearing == null ? 0 : course == null ? bearing : ((bearing - course + 540) % 360) - 180;
  const turnWord = next?.modifier?.includes("left") ? "left" : next?.modifier?.includes("right") ? "right" : null;
  const nearArrival = g.remainingM <= arriveM + 15;
  return (
    <Surface accent={off ? C.amber : C.cyan} style={{ marginTop: 8 }} pad={10}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <View style={[s.arrowBox, off && { borderColor: C.amber }]}>
          <Svg width={54} height={54} viewBox="0 0 54 54" style={{ transform: [{ rotate: `${rel}deg` }] }}>
            <Path d="M27 5 L41 27 L31 27 L31 49 L23 49 L23 27 L13 27 Z" fill={off ? C.amber : C.cyan} />
          </Svg>
          {course == null && <Text style={s.tiny}>N UP</Text>}
        </View>
        <View style={{ flex: 1 }}>
          {off ? (
            <>
              <Text style={[s.big, { color: C.amber }]}>Off the route</Text>
              <Text style={s.body}>{Math.round(g.offRouteM)} m from the path. Re-plotting from where you stand.</Text>
            </>
          ) : nearArrival ? (
            <>
              <Text style={s.big}>{targetName}</Text>
              <Text style={s.body}>Almost on the ring. Get inside it and scan.</Text>
            </>
          ) : next ? (
            <>
              <Text style={s.big}>In {fmtM(g.toNextM)}{turnWord ? ` · ${turnWord}` : ""}</Text>
              <Text style={s.body}>{next.text}</Text>
              {g.after && <Text style={s.then}>then {lower(g.after.text)}{g.after.type !== "arrive" ? ` · ${fmtM(next.distanceM)}` : ""}</Text>}
            </>
          ) : (
            <>
              <Text style={s.big}>{fmtM(g.remainingM)} to go</Text>
              <Text style={s.body}>Follow the line to {targetName}.</Text>
            </>
          )}
        </View>
      </View>
      <View style={s.foot}>
        <Text style={s.mono}>{fmtM(g.remainingM)} left · about {walkMin(g.remainingM)} min on foot</Text>
        <Text style={s.mono}>{targetName.toUpperCase()}</Text>
      </View>
    </Surface>
  );
}

const lower = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);
function bearingTo(a: LatLng, b: LatLng) {
  const toR = Math.PI / 180;
  const dLng = (b.lng - a.lng) * toR;
  const y = Math.sin(dLng) * Math.cos(b.lat * toR);
  const x = Math.cos(a.lat * toR) * Math.sin(b.lat * toR) - Math.sin(a.lat * toR) * Math.cos(b.lat * toR) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

const s = StyleSheet.create({
  arrowBox: { width: 66, height: 66, borderRadius: 33, borderWidth: 1.5, borderColor: C.cyan, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,229,242,0.06)" },
  tiny: { position: "absolute", bottom: 2, color: C.dim, fontFamily: F.displayMed, fontSize: 8, letterSpacing: 1 },
  big: { color: C.text, fontFamily: F.displayMed, fontSize: 22, letterSpacing: 0.4, lineHeight: 26 },
  body: { color: C.text, fontFamily: F.typed, fontSize: 13.5, marginTop: 2 },
  then: { color: C.dim, fontFamily: F.typed, fontSize: 12, marginTop: 3 },
  foot: { flexDirection: "row", justifyContent: "space-between", marginTop: 8, paddingTop: 6, borderTopWidth: 1, borderTopColor: C.hair },
  mono: { color: C.dim, fontFamily: F.typed, fontSize: 11.5 },
});
