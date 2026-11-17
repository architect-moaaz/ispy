import React, { useEffect, useState } from "react";
import { Image, Text, View } from "react-native";
import type { Faction, Identity, Player, SkillKey, TitleEntry, ToolkitResponse } from "@ispy/shared";
import { available, signInWith, type Provider } from "../auth";
import { api, setToken } from "../api";
import { getOperative, loadOperative, setOperative, type OperativeId } from "../prefs";
import { OperativePicker } from "../operatives";
import { ART } from "../art";
import { C, F, factionColor } from "../theme";
import { Body, Button, Kicker, Label, Meter, Panel, Screen, Surface, Typed } from "../ui";

const SKILLS: SkillKey[] = ["observation", "reasoning", "cipher", "cooperation"];


export function Profile({ player, faction, onSignOut }: { player: Player; faction: Faction | null; onSignOut: () => void }) {
  const [events, setEvents] = useState<{ at: string; text: string }[]>([]);
  useEffect(() => {
    api.history().then((r) => setEvents(r.events)).catch(() => {});
  }, [player.xp]);
  const [titles, setTitles] = useState<TitleEntry[]>([]);
  useEffect(() => { api.titles().then((r) => setTitles(r.titles)).catch(() => {}); }, [player.xp]);
  const [kit, setKit] = useState<ToolkitResponse | null>(null);
  const [kitMsg, setKitMsg] = useState<string | null>(null);
  const loadKit = () => api.tools().then(setKit).catch(() => {});
  useEffect(() => { loadKit(); }, [player.xp, player.credits]);
  const craft = async (tool: string) => { try { const r = await api.craft(tool); setKitMsg(r.ok ? `Crafted. You now hold ${r.qty}.` : r.reason ?? "No."); await loadKit(); } catch (e: any) { setKitMsg(e.message); } };
  const color = factionColor(player.factionId);
  const [operative, setOperativeState] = useState<OperativeId>(getOperative());
  useEffect(() => { loadOperative().then(setOperativeState); }, []);

  return (
    <Screen>
      <Surface raised accent={color} pad={16}>
        <View style={{ flexDirection: "row", gap: 14, alignItems: "center" }}>
          {player.factionId && <Image source={ART.emblem[player.factionId]} style={{ width: 72, height: 72, borderRadius: 36 }} />}
          <View style={{ flex: 1 }}>
            <Kicker color={color}>{faction ? `${faction.name} · reports to ${faction.chiefName}` : "Civilian"}</Kicker>
            <Text style={{ color: C.text, fontFamily: F.displayMed, fontSize: player.codename.length > 14 ? 24 : 30, lineHeight: 32 }} numberOfLines={1} adjustsFontSizeToFit>{player.codename}</Text>
            <Text style={{ color: C.dim, fontSize: 13 }}>{player.rank.replace("_", " ")} · {player.xp} XP · {player.credits} credits</Text>
          </View>
        </View>
        <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 14, borderTopWidth: 1, borderTopColor: C.hair, paddingTop: 12 }}>
          <Stat label="Chief's trust" value={`${player.trust}% · ${player.tier.name}`} />
          <Stat label="Walk radius" value={`${player.walkRadiusM} m`} />
          <Stat label="Field today" value={`${player.fieldToday} of ${player.dailyFieldCap}`} right />
        </View>
        {titles.length > 0 && (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
            {titles.map((t) => <Text key={t.title + t.week} style={{ color: C.amber, backgroundColor: "rgba(255,170,0,0.1)", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, fontSize: 12 }}>{t.title}{t.area ? ` · ${t.area}` : ""} · {t.week}</Text>)}
          </View>
        )}
      </Surface>
      {kit && (
        <Panel>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Image source={ART.tool.fragment} style={{ width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: C.cyan }} />
            <Label style={{ marginBottom: 0 }}>Toolkit · {kit.fragments} cipher fragments</Label>
          </View>
          <Body dim>Caches drop lenses, jammers and decoys. Fragments craft the rest. Field tools sit on the map; desk tools on the desk.</Body>
          {kit.effects.length > 0 && <Text style={{ color: C.ok, fontFamily: F.typed, fontSize: 11.5, marginBottom: 6 }}>ACTIVE · {kit.effects.map((e) => `${e.kind.toUpperCase()} until ${new Date(e.until).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`).join(" · ")}</Text>}
          {kit.tools.filter((t) => t.id !== "fragment").map((t) => (
            <View key={t.id} style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 7, borderTopWidth: 1, borderTopColor: C.hair }}>
              <Image source={ART.tool[t.id]} style={{ width: 52, height: 52, borderRadius: 26, borderWidth: 1, borderColor: t.qty > 0 ? C.cyan : C.line, opacity: t.qty > 0 ? 1 : 0.5 }} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: t.qty > 0 ? C.text : C.dim, fontFamily: F.displayMed, fontSize: 16 }}>{t.name}{t.permanent ? "" : `  ×${t.qty}`}</Text>
                <Text style={{ color: C.dim, fontFamily: F.typed, fontSize: 11.5 }} numberOfLines={2}>{t.use}</Text>
              </View>
              {t.craft && <Button title={`Craft · ${t.craft}`} kind="ghost" onPress={() => craft(t.id)} disabled={kit.fragments < t.craft} style={{ marginTop: 0, paddingVertical: 6, paddingHorizontal: 10 }} />}
            </View>
          ))}
          {kitMsg && <Typed style={{ marginTop: 6 }}>{kitMsg}</Typed>}
        </Panel>
      )}
      <Panel>
        <Label>How you play</Label>
        {SKILLS.map((k) => (
          <View key={k}>
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Body style={{ marginBottom: 2 }}>{k}</Body>
              <Text style={{ color: C.dim, fontFamily: F.displayMed, fontSize: 16 }}>{Math.round(player.skills[k] * 100)}</Text>
            </View>
            <Meter value={player.skills[k]} color={color} />
          </View>
        ))}
        <Body dim style={{ fontSize: 12.5, marginBottom: 0 }}>Observed in play. Not a judgement of you.</Body>
      </Panel>
      <Panel>
        <Label>Record</Label>
        {events.length === 0 && <Body dim>Nothing yet.</Body>}
        {events.slice(0, 14).map((e, i) => (
          <View key={i} style={{ flexDirection: "row", gap: 10, marginBottom: 5 }}>
            <Typed onPaper={false} style={{ color: C.dim, marginBottom: 0, width: 46 }}>{new Date(e.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</Typed>
            <Typed onPaper={false} style={{ marginBottom: 0, flex: 1 }}>{e.text}</Typed>
          </View>
        ))}
      </Panel>
      <Surface pad={14} style={{ marginTop: 10 }}>
        <Label>Operative · 3D street</Label>
        <View style={{ marginTop: 6 }}><OperativePicker value={operative} onChange={(id) => { setOperativeState(id); void setOperative(id); }} accent={color} /></View>
      </Surface>
      <LinkedAccounts />
      <Button title="Sign out" kind="ghost" onPress={async () => { await setToken(null); onSignOut(); }} />
    </Screen>
  );
}

function Stat({ label, value, right }: { label: string; value: string; right?: boolean }) {
  return (
    <View style={{ alignItems: right ? "flex-end" : "flex-start" }}>
      <Text style={{ color: C.text, fontFamily: F.displayMed, fontSize: 22, lineHeight: 24 }}>{value}</Text>
      <Text style={{ color: C.dim, fontSize: 12 }}>{label}</Text>
    </View>
  );
}


/** Google and Meta accounts attached to this codename: sign in on another phone and the file follows. */
function LinkedAccounts() {
  const [ids, setIds] = useState<Identity[] | null>(null);
  const [providers, setProviders] = useState<{ google: boolean; facebook: boolean; dev: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const load = () => Promise.all([api.identities().then((r) => setIds(r.identities)), api.world().then((w) => setProviders(w.auth ?? null))]).catch(() => {});
  useEffect(() => { load(); }, []);
  const can = available();
  const rows: { id: Provider | "dev"; name: string }[] = [
    ...(providers?.google && can.google ? [{ id: "google" as const, name: "Google" }] : []),
    ...(providers?.facebook && can.facebook ? [{ id: "facebook" as const, name: "Meta" }] : []),
    ...(providers?.dev ? [{ id: "dev" as const, name: "Dev account" }] : []),
  ];
  if (!ids || rows.length === 0) return null;
  const link = async (p: Provider | "dev") => {
    setBusy(p); setMsg(null);
    try {
      const body = p === "dev" ? { provider: "dev" as const, dev: { subject: `dev-${Math.random().toString(36).slice(2, 8)}`, name: "Dev Agent" } } : await signInWith(p).then((t) => (t ? { provider: t.provider, token: t.token } : null));
      if (!body) return;
      const r = await api.oauth(body);
      if ("token" in r) { await setToken(r.token); setMsg(r.linked ? "Linked. This codename follows that account now." : "That account already belongs to another codename; you are signed in as them."); }
      await load();
    } catch (e: any) { setMsg(e.message); } finally { setBusy(null); }
  };
  const unlink = async (p: string) => { setBusy(p); try { await api.unlinkIdentity(p); await load(); } catch (e: any) { setMsg(e.message); } finally { setBusy(null); } };
  return (
    <Surface>
      <Kicker>Linked accounts</Kicker>
      <Body dim>Attach an account and this codename, rank and file follow you to a new phone. The chiefs still only ever see the codename.</Body>
      {rows.map((r) => {
        const have = ids.find((i) => i.provider === r.id);
        return (
          <View key={r.id} style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 8 }}>
            <Text style={{ color: C.text, fontFamily: F.displayMed, fontSize: 13, letterSpacing: 1.2, width: 90 }}>{r.name.toUpperCase()}</Text>
            <Text style={{ color: C.dim, fontSize: 12.5, flex: 1 }} numberOfLines={1}>{have ? have.email ?? have.name ?? "linked" : "not linked"}</Text>
            <Button title={have ? "Unlink" : "Link"} kind="ghost" onPress={() => (have ? unlink(r.id) : link(r.id))} loading={busy === r.id} style={{ marginTop: 0, paddingVertical: 6, paddingHorizontal: 12 }} />
          </View>
        );
      })}
      {msg && <Body style={{ color: C.cyan, marginTop: 6 }}>{msg}</Body>}
    </Surface>
  );
}
