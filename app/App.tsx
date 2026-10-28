import React, { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { useFonts, BarlowCondensed_600SemiBold, BarlowCondensed_800ExtraBold } from "@expo-google-fonts/barlow-condensed";
import { CourierPrime_400Regular, CourierPrime_700Bold } from "@expo-google-fonts/courier-prime";
import type { Faction, Player, Presence } from "@ispy/shared";
import { api, loadToken, setToken, setUnauthorizedHandler, type World } from "./src/api";
import { C, F, factionColor } from "./src/theme";
import { Banner, Spinner } from "./src/ui";
import { Welcome } from "./src/screens/Welcome";
import { Assessment } from "./src/screens/Assessment";
import { HQ } from "./src/screens/HQ";
import { Duty } from "./src/screens/Duty";
import { Profile } from "./src/screens/Profile";

type Tab = "hq" | "duty" | "profile";

export default function App() {
  const [fontsLoaded] = useFonts({ BarlowCondensed_600SemiBold, BarlowCondensed_800ExtraBold, CourierPrime_400Regular, CourierPrime_700Bold });
  const [booted, setBooted] = useState(false);
  const [player, setPlayer] = useState<Player | null>(null);
  const [faction, setFaction] = useState<Faction | null>(null);
  const [presence, setPresence] = useState<Presence | null>(null);
  const [world, setWorld] = useState<World | null>(null);
  const [offline, setOffline] = useState(false);
  const [tab, setTab] = useState<Tab>("duty");

  const signOut = useCallback(async () => {
    await setToken(null);
    setPlayer(null); setFaction(null); setPresence(null);
  }, []);

  const refreshMe = useCallback(async () => {
    try {
      const me = await api.me();
      setPlayer(me.player); setFaction(me.faction); setPresence(me.presence);
    } catch { /* handled by the 401 handler or the offline banner */ }
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => { setPlayer(null); setFaction(null); setPresence(null); });
    (async () => {
      const t = await loadToken();
      if (t) await refreshMe();
      setBooted(true);
    })();
  }, [refreshMe]);

  // World status (paused flag, devSim) every 15 s; doubles as the offline check.
  useEffect(() => {
    let alive = true;
    const poll = () => api.world().then((w) => { if (alive) { setWorld(w); setOffline(false); } }).catch(() => alive && setOffline(true));
    poll();
    const id = setInterval(poll, 15_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  // Pick up rank/XP changes after missions.
  useEffect(() => {
    if (!player) return;
    const id = setInterval(refreshMe, 20_000);
    return () => clearInterval(id);
  }, [player?.id, refreshMe]);

  if (!booted || !fontsLoaded) return <View style={s.root}><Spinner /></View>;

  let body: React.ReactNode;
  if (!player) body = <Welcome onRegistered={(p) => { setPlayer(p); }} />;
  else if (!player.factionId) body = <Assessment onRecruited={(p) => { setPlayer(p); refreshMe(); setTab("duty"); }} />;
  else if (tab === "hq") body = <HQ factionId={player.factionId} onDuty={() => setTab("duty")} />;
  else if (tab === "profile") body = <Profile player={player} faction={faction} onSignOut={signOut} />;
  else body = <Duty presence={presence} devSim={!!world?.devSim} onPresence={(p) => { setPresence(p); refreshMe(); }} onHQ={() => setTab("hq")} />;

  const inGame = !!player?.factionId;
  const accent = factionColor(player?.factionId);
  const tabs: [Tab, string][] = [["hq", "HQ"], ["duty", "Duty"], ["profile", player?.codename ?? "You"]];
  return (
    <View style={s.root}>
      <StatusBar style="light" />
      {offline && <Banner text="Can't reach the bureau. Retrying." color={C.stamp} />}
      {world?.paused && <Banner text="The world is paused." />}
      <View style={s.body}>{body}</View>
      {inGame && (
        <View style={s.tabs}>
          {tabs.map(([t, label]) => (
            <Pressable key={t} onPress={() => { setTab(t); refreshMe(); }} style={s.tab} accessibilityRole="button" testID={`tab-${t}`}>
              <Text style={[s.tabText, tab === t && { color: C.text }]} numberOfLines={1}>{label}</Text>
              <View style={[s.tabLine, tab === t && { backgroundColor: accent }]} />
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.ink },
  body: { flex: 1 },
  tabs: { flexDirection: "row", borderTopWidth: 1, borderTopColor: C.line, backgroundColor: C.ink, paddingBottom: 16 },
  tab: { flex: 1, alignItems: "center", paddingTop: 12, gap: 6 },
  tabText: { color: C.dim, fontFamily: F.displayMed, fontSize: 16, letterSpacing: 2, textTransform: "uppercase" },
  tabLine: { height: 3, width: 36, borderRadius: 2, backgroundColor: "transparent" },
});
