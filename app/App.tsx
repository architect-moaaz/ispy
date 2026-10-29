import React, { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { useFonts, BarlowCondensed_600SemiBold, BarlowCondensed_800ExtraBold } from "@expo-google-fonts/barlow-condensed";
import { CourierPrime_400Regular, CourierPrime_700Bold } from "@expo-google-fonts/courier-prime";
import type { Faction, Player, Presence } from "@ispy/shared";
import { api, loadToken, setToken, setUnauthorizedHandler, type World } from "./src/api";
import { connectLive, disconnectLive, onLive } from "./src/live";
import { registerForPush } from "./src/push";
import { C, F, factionColor } from "./src/theme";
import { Banner, Spinner } from "./src/ui";
import { Welcome } from "./src/screens/Welcome";
import { Assessment } from "./src/screens/Assessment";
import { HQ } from "./src/screens/HQ";
import { Duty } from "./src/screens/Duty";
import { Profile } from "./src/screens/Profile";
import { DossierScreen } from "./src/screens/Dossier";
import { Board } from "./src/screens/Board";

type Tab = "hq" | "duty" | "dossier" | "board" | "profile";

import { GestureHandlerRootView } from "react-native-gesture-handler";

export default function App() {
  const [fontsLoaded] = useFonts({ BarlowCondensed_600SemiBold, BarlowCondensed_800ExtraBold, CourierPrime_400Regular, CourierPrime_700Bold });
  const [booted, setBooted] = useState(false);
  const [player, setPlayer] = useState<Player | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [faction, setFaction] = useState<Faction | null>(null);
  const [presence, setPresence] = useState<Presence | null>(null);
  const [world, setWorld] = useState<World | null>(null);
  const [offline, setOffline] = useState(false);
  const [unread, setUnread] = useState(0);
  const [tab, setTab] = useState<Tab>("duty");

  const signOut = useCallback(async () => {
    disconnectLive();
    await setToken(null);
    setPlayer(null); setFaction(null); setPresence(null);
  }, []);

  const refreshMe = useCallback(async () => {
    try {
      const me = await api.me();
      setPlayer(me.player); setFaction(me.faction); setPresence(me.presence); setUnread(me.unreadChief ?? 0);
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
    const id = setInterval(poll, 60_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  // Live stream while signed in; the poll below is only a backstop.
  useEffect(() => {
    if (!player) return;
    connectLive();
    registerForPush();
    const off = onLive((type, data: any) => {
      if (type === "reward" && data?.xp) { setToast(`+${data.xp} XP${data.credits ? ` · +${data.credits} CREDITS` : ""}${data.why ? ` · ${String(data.why).toUpperCase()}` : ""}`); setTimeout(() => setToast(null), 5000); }
      if (type === "rank_up" && data?.to) { setToast(`PROMOTED · ${String(data.to).replace("_", " ").toUpperCase()}`); setTimeout(() => setToast(null), 6000); }
      if (["chief.message", "reward", "rank_up", "presence.check_in", "presence.check_out", "live.open"].includes(type)) refreshMe();
      if (type === "admin.paused" || type === "admin.resumed") api.world().then(setWorld).catch(() => {});
    });
    const id = setInterval(refreshMe, 45_000);
    return () => { off(); clearInterval(id); };
  }, [player?.id, refreshMe]);

  if (!booted || !fontsLoaded) return <View style={s.root}><Spinner /></View>;

  let body: React.ReactNode;
  if (!player) body = <Welcome onRegistered={(p) => { setPlayer(p); }} />;
  else if (!player.factionId) body = <Assessment onRecruited={(p) => { setPlayer(p); refreshMe(); setTab("duty"); }} />;
  else if (tab === "hq") body = <HQ factionId={player.factionId} onDuty={() => setTab("duty")} />;
  else if (tab === "profile") body = <Profile player={player} faction={faction} onSignOut={signOut} />;
  else if (tab === "dossier") body = <DossierScreen />;
  else if (tab === "board") body = <Board />;
  else body = <Duty presence={presence} devSim={!!world?.devSim} onPresence={(p) => { setPresence(p); refreshMe(); }} onHQ={() => setTab("hq")} onBoard={() => setTab("board")} codename={player.codename} factionId={player.factionId} rank={player.rank} />;

  const inGame = !!player?.factionId;
  const accent = factionColor(player?.factionId);
  const tabs: [Tab, string][] = [["hq", "HQ"], ["duty", "Missions"], ["dossier", "Dossier"], ["board", "Board"], ["profile", "Me"]];
  return (
    <GestureHandlerRootView style={s.root}>
      <StatusBar style="light" />
      {offline && <Banner text="Can't reach the bureau. Retrying." color={C.stamp} />}
      {world?.paused && <Banner text="The world is paused." />}
      {toast && <Banner text={toast} color={C.ok} />}
      <View style={s.body}>{body}</View>
      {inGame && (
        <View style={s.tabs}>
          {tabs.map(([t, label]) => (
            <Pressable key={t} onPress={() => { setTab(t); refreshMe(); }} style={s.tab} accessibilityRole="button" testID={`tab-${t}`}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                <Text style={[s.tabText, tab === t && { color: C.text }]} numberOfLines={1}>{label}</Text>
                {t === "hq" && unread > 0 && tab !== "hq" && <View style={s.badge}><Text style={s.badgeText}>{unread}</Text></View>}
              </View>
              <View style={[s.tabLine, tab === t && { backgroundColor: accent }]} />
            </Pressable>
          ))}
        </View>
      )}
    </GestureHandlerRootView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.ink },
  body: { flex: 1 },
  tabs: { flexDirection: "row", borderTopWidth: 1, borderTopColor: C.line, backgroundColor: C.ink, paddingBottom: 16 },
  tab: { flex: 1, alignItems: "center", paddingTop: 12, gap: 6 },
  tabText: { color: C.dim, fontFamily: F.displayMed, fontSize: 14, letterSpacing: 1.4, textTransform: "uppercase" },
  badge: { minWidth: 16, height: 16, borderRadius: 8, backgroundColor: C.red, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  badgeText: { color: C.text, fontFamily: F.displayMed, fontSize: 11 },
  tabLine: { height: 3, width: 36, borderRadius: 2, backgroundColor: "transparent" },
});
