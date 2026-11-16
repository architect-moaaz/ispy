import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { DeskNightResult, DeskNightView, HandoffView, HuntView, MissionSummary, TerritoryView, WireView } from "@ispy/shared";
import { api } from "../api";
import { onLive } from "../live";
import { C, F, factionColor } from "../theme";
import { Body, Button, Choice, Dossier, Input, Label, Stamp, Surface, Typed, fmtCountdown } from "../ui";

/**
 * The five loops that bring an operative back: the Morning Wire (daily), Desk Nights (the days you
 * cannot walk), Territory (the week), the Handoff (other players) and the Burn Notice (the month).
 * Each panel fetches its own view and refetches on its own live events, so any screen can mount one.
 */

const FACTION_NAME: Record<string, string> = { raven: "RAVEN", phantom: "PHANTOM", cipher: "CIPHER" };
const useTick = (ms = 1000) => { const [now, setNow] = useState(Date.now()); useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]); return now; };

// ---------- 1. The Morning Wire ----------
export function WirePanel({ compact, onTaken }: { compact?: boolean; onTaken?: (m: MissionSummary | null) => void }) {
  const [v, setV] = useState<WireView | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const now = useTick();
  const load = () => api.wireToday().then(setV).catch(() => {});
  useEffect(() => { load(); return onLive((t) => { if (t.startsWith("wire.") || t === "mission.verified" || t === "mission.expired") load(); }); }, []);
  if (!v) return null;
  const w = v.wire;
  const take = async () => {
    setBusy(true); setErr(null);
    try { const r = await api.acceptWire(); onTaken?.(r.mission); await load(); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  if (!w) {
    if (compact) return null;
    return (
      <Surface accent={C.amber}>
        <Label color={C.amber}>Morning wire</Label>
        <Body dim>{v.missedInRow >= 3 ? "Your chief has gone quiet. Answer the next one and the mornings start again." : "One personal order a morning, near where you usually are, with a short window. It arrives after 07:00 once your chief has seen you in the field."}</Body>
        {v.streak > 0 && <Text style={s.streak}>{v.streak} MORNING{v.streak === 1 ? "" : "S"} RUNNING</Text>}
      </Surface>
    );
  }
  const open = w.state === "sent" && Date.parse(w.deadline) > now;
  const tab = w.state === "done" ? C.ok : w.state === "missed" ? C.red : C.amber;
  return (
    <Dossier tab={tab} style={compact ? { marginTop: 0 } : undefined}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <Text style={s.title}>Morning wire · {w.target}</Text>
        {open && <Text style={s.mono}>{fmtCountdown(w.deadline, now)}</Text>}
      </View>
      {w.boosted && <Text style={[s.mono, { color: C.amber, letterSpacing: 1.2 }]}>DESK NIGHT BONUS · COUNTS HALF AGAIN</Text>}
      <Typed>{w.brief}</Typed>
      {w.state === "done" && <View style={{ alignItems: "center", marginVertical: 4 }}><Stamp text="Answered" color={C.ok} size={28} /></View>}
      {w.state === "missed" && <View style={{ alignItems: "center", marginVertical: 4 }}><Stamp text="Missed" size={28} /></View>}
      {open && !w.accepted && <Button title="Take it" kind="ink" onPress={take} loading={busy} />}
      {open && w.accepted && <Typed style={{ color: C.onPaperDim }}>On your board. Walk, scan before {new Date(w.deadline).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.</Typed>}
      {err && <Typed style={{ color: C.stamp }}>{err}</Typed>}
      <Text style={[s.mono, { color: C.onPaperDim }]}>{v.streak > 0 ? `${v.streak} MORNING${v.streak === 1 ? "" : "S"} RUNNING` : "FIRST MORNING"}{v.missedInRow ? ` · ${v.missedInRow} MISSED` : ""}</Text>
    </Dossier>
  );
}

// ---------- 2. The Burn Notice ----------
export function HuntPanel({ fix, onTrail, quiet }: { fix?: { lat: number; lng: number; sim?: boolean } | null; onTrail?: (trail: { lat: number; lng: number }[]) => void; quiet?: boolean }) {
  const [v, setV] = useState<HuntView | null>(null);
  const [res, setRes] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const now = useTick(1000);
  const load = () => api.hunt().then((h) => { setV(h); onTrail?.(h.hunt && !h.hunt.youAreIt ? h.hunt.trail : []); }).catch(() => {});
  useEffect(() => { load(); const p = setInterval(load, 120_000); const off = onLive((t) => { if (t.startsWith("hunt.")) load(); }); return () => { clearInterval(p); off(); }; }, []);
  if (!v) return null;
  const h = v.hunt;
  if (!h) {
    if (quiet) return null;
    return (
      <Surface>
        <Label>Burn notice</Label>
        <Body dim>{v.last ? `Last month ${v.last.codename.toUpperCase()} ${v.last.state === "survived" ? "walked out a Ghost" : "was made"}. ` : ""}Once a month one operative's file leaks: codename, agency and a cold trail on every board for seven days. Get within fifty metres and call it. Survive it and you are a Ghost.</Body>
      </Surface>
    );
  }
  const col = factionColor(h.factionId);
  const call = async () => {
    if (!fix) { setRes("No fix yet."); return; }
    setBusy(true);
    try { const r = await api.expose({ lat: fix.lat, lng: fix.lng, sim: fix.sim }); setRes(r.caught ? `MADE. ${h.codename.toUpperCase()} is yours.` : r.reason ?? (r.warm ? "Close." : "Cold.")); if (r.caught) load(); } catch (e: any) { setRes(e.message); } finally { setBusy(false); }
  };
  return (
    <Surface accent={h.youAreIt ? C.red : col}>
      <Label color={h.youAreIt ? C.red : col}>Burn notice · {fmtCountdown(h.endsAt, now)} left</Label>
      {h.youAreIt ? (
        <>
          <Text style={[s.big, { color: C.red }]}>YOU ARE BURNED</Text>
          <Body dim>Every service has your name and your agency this week. Your trail from an hour ago is on their boards. Change your mornings, keep moving. Nobody within fifty metres and you walk out a Ghost.</Body>
          {h.closeCalls.length > 0 && <Text style={[s.mono, { color: C.red }]}>{h.closeCalls.length} CLOSE CALL{h.closeCalls.length === 1 ? "" : "S"} · LAST {new Date(h.closeCalls[0].at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}{h.closeCalls[0].called ? " · THEY CALLED IT AND MISSED" : ""}</Text>}
        </>
      ) : (
        <>
          <Text style={[s.big, { color: col }]}>{h.codename.toUpperCase()} <Text style={{ color: C.dim, fontSize: 13 }}>OF {FACTION_NAME[h.factionId]}</Text></Text>
          <Body dim>{h.yourAgency ? "One of ours. Nothing to do but hope they keep moving." : `Their cold trail is on the map: where they were an hour or more ago, to a hundred metres. Within a hundred metres of them you will feel it warm up. Within fifty, call it.`}</Body>
          <Text style={s.mono}>{h.trail.length ? `${h.trail.length} TRAIL POINTS · LAST SEEN ${h.lastSeenAt ? new Date(h.lastSeenAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}` : "NO TRAIL YET · THEY HAVE NOT MOVED IN HOURS"}</Text>
          {!h.yourAgency && <Button title="Call it · they are within 50 m" kind="danger" onPress={call} loading={busy} disabled={!fix} />}
          {res && <Text style={[s.mono, { color: C.amber, marginTop: 6 }]}>{res}</Text>}
        </>
      )}
    </Surface>
  );
}

// ---------- 3. Territory ----------
export function TerritoryPanel({ fix }: { fix?: { lat: number; lng: number } | null }) {
  const [v, setV] = useState<TerritoryView | null>(null);
  const now = useTick(30_000);
  const load = () => api.territory(fix?.lat, fix?.lng).then(setV).catch(() => {});
  useEffect(() => { load(); const p = setInterval(load, 120_000); const off = onLive((t) => { if (t === "territory.report" || t === "mission.verified") load(); }); return () => { clearInterval(p); off(); }; }, []);
  if (!v) return null;
  return (
    <Surface>
      <Label>Your streets · week {v.week.slice(-3)} · redraws in {fmtCountdown(v.resetsAt, now)}</Label>
      {v.areas.length === 0 && <Body dim>No sectors open yet. Deploy once and yours appears here.</Body>}
      {v.areas.map((a) => {
        const own = a.owner ? factionColor(a.owner) : C.dim;
        const total = Object.values(a.standings).reduce((x, y) => x + y, 0) || 1;
        return (
          <View key={a.id} style={{ marginTop: 8 }}>
            <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
              <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: own, transform: [{ rotate: "45deg" }] }} />
              <Text style={[s.areaName, a.id === v.yourSector && { color: C.text }]} numberOfLines={1}>{a.name}</Text>
              <Text style={[s.mono, { color: own }]}>{a.owner ? `${FACTION_NAME[a.owner]}${a.yours ? " · OURS" : ""}` : "UNCLAIMED"}</Text>
            </View>
            <View style={s.bar}>
              {(Object.entries(a.standings) as [string, number][]).map(([f, n]) => n > 0 && <View key={f} style={{ flex: n / total, backgroundColor: factionColor(f), height: "100%" }} />)}
            </View>
            <Text style={[s.mono, { color: C.dim }]}>THIS WEEK · {(Object.entries(a.standings) as [string, number][]).map(([f, n]) => `${FACTION_NAME[f]} ${n}`).join(" · ")}{a.leader ? ` · ${FACTION_NAME[a.leader]} LEADS` : ""}</Text>
          </View>
        );
      })}
      {v.report.length > 0 && <Text style={[s.mono, { color: C.amber, marginTop: 10 }]}>LAST SUNDAY · {v.report.slice(0, 3).join(" ")}</Text>}
      <Text style={[s.mono, { color: C.dim, marginTop: 6 }]}>Every site held counts one. Most held by Sunday night owns the streets for the week: the map and the lamps take your colour.</Text>
    </Surface>
  );
}

// ---------- 4. The Handoff ----------
export function HandoffPanel() {
  const [v, setV] = useState<HandoffView | null>(null);
  const [note, setNote] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const now = useTick();
  const load = () => api.handoffs().then(setV).catch(() => {});
  useEffect(() => { load(); return onLive((t) => { if (t.startsWith("handoff.") || t === "mission.verified") load(); }); }, []);
  if (!v) return null;
  const leave = async (id: string) => {
    const t = (note[id] ?? "").trim(); if (!t) return;
    setBusy(id);
    try { await api.handoffNote(id, t); setNote((n) => ({ ...n, [id]: "" })); await load(); } catch { /* shown by reload */ } finally { setBusy(null); }
  };
  return (
    <Surface>
      <Label>Handoffs</Label>
      {v.live ? (
        <Body dim>{v.live.role === "drop"
          ? (v.live.state === "open" ? `You are carrying a parcel to ${v.live.target}. Leave it, write one line about where, keep walking.` : `Down at ${v.live.target}. Your partner has until ${v.live.deadline ? new Date(v.live.deadline).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "soon"}.`)
          : (v.live.state === "open" ? `One of ours is carrying a parcel toward ${v.live.target}. When it is down you get forty minutes.` : `${v.live.partner?.toUpperCase() ?? "Your partner"} left it at ${v.live.target}. "${v.live.mark ?? "Left where you would have left it."}" ${v.live.deadline ? fmtCountdown(v.live.deadline, now) : ""} left.`)}</Body>
      ) : (
        <Body dim>Two operatives of one agency who never meet: one leaves a parcel and writes a line about where, the other has forty minutes to find it. Both are paid only if it lands. Pairs that land are paired again. It needs two of you in the field in one sector.</Body>
      )}
      {v.pairs.length > 0 && <Text style={s.mono}>PARTNERS · {v.pairs.map((p) => `${p.partner.toUpperCase()} ${p.landed}–${p.failed}`).join(" · ")}</Text>}
      {v.past.slice(0, 5).map((h) => (
        <View key={h.id} style={{ marginTop: 8, borderTopWidth: 1, borderTopColor: C.hair, paddingTop: 6 }}>
          <Text style={[s.mono, { color: h.outcome === "landed" ? C.ok : C.red }]}>{h.outcome.toUpperCase()} · {h.target} · WITH <Text style={{ color: factionColor(h.partnerFaction) }}>{h.partner.toUpperCase()}</Text> · {h.at ? new Date(h.at).toLocaleDateString([], { day: "2-digit", month: "short" }) : ""}</Text>
          {h.theirNote && <Typed style={{ color: C.text, marginTop: 4 }}>{h.partner.toUpperCase()} wrote: “{h.theirNote}”</Typed>}
          {h.yourNote && <Typed style={{ color: C.dim, marginTop: 2 }}>You wrote: “{h.yourNote}”</Typed>}
          {h.outcome === "landed" && !h.yourNote && (
            <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
              <Input value={note[h.id] ?? ""} onChangeText={(t) => setNote((n) => ({ ...n, [h.id]: t }))} placeholder={`One line in ${h.partner.toUpperCase()}'s file`} style={{ flex: 1, marginBottom: 0 }} maxLength={120} onSubmitEditing={() => leave(h.id)} />
              <Button title="Leave it" kind="ghost" onPress={() => leave(h.id)} loading={busy === h.id} style={{ marginTop: 0 }} />
            </View>
          )}
        </View>
      ))}
    </Surface>
  );
}

/** The dropper's one line about the spot, on the live mission card. */
export function HandoffMark({ mission }: { mission: MissionSummary }) {
  const [text, setText] = useState(mission.handoff?.mark ?? "");
  const [saved, setSaved] = useState<string | null>(mission.handoff?.mark ?? null);
  const [busy, setBusy] = useState(false);
  if (!mission.handoff || mission.handoff.role !== "drop") return null;
  const save = async () => { const t = text.trim(); if (!t) return; setBusy(true); try { const r = await api.handoffMark(mission.handoff!.id, t); setSaved(r.mark); } catch { /* keep typing */ } finally { setBusy(false); } };
  return (
    <View style={{ marginTop: 6 }}>
      <Text style={[s.mono, { color: C.amber, letterSpacing: 1.2 }]}>HANDOFF · THE DROP{saved ? " · SPOT DESCRIBED" : " · DESCRIBE THE SPOT FOR YOUR PARTNER"}</Text>
      <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
        <Input value={text} onChangeText={setText} placeholder="Under the bench with the broken slat" style={{ flex: 1, marginBottom: 0 }} maxLength={140} onSubmitEditing={save} />
        <Button title={saved ? "Update" : "Save"} kind="ghost" onPress={save} loading={busy} style={{ marginTop: 0 }} />
      </View>
    </View>
  );
}

// ---------- 5. Desk Nights ----------
export function DeskNight() {
  const [v, setV] = useState<DeskNightView | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [answer, setAnswer] = useState("");
  const [res, setRes] = useState<Record<number, DeskNightResult>>({});
  const [busy, setBusy] = useState(false);
  const load = () => api.deskNight().then(setV).catch(() => {});
  useEffect(() => { load(); return onLive((t) => { if (t === "desk_night.solved") load(); }); }, []);
  if (!v) return null;
  const submit = async (n: number) => {
    if (!answer.trim()) return;
    setBusy(true);
    try { const r = await api.deskNightSubmit(n, answer.trim()); setRes((x) => ({ ...x, [n]: r })); if (r.correct) { setAnswer(""); setOpen(null); await load(); } } catch (e: any) { setRes((x) => ({ ...x, [n]: { correct: false, debrief: e.message } })); } finally { setBusy(false); }
  };
  return (
    <Dossier tab={v.allDone ? C.ok : C.amber}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
        <Text style={s.title}>Desk night</Text>
        <Text style={s.mono}>{v.solved.length}/3 · {v.xpEach} XP EACH</Text>
      </View>
      <Typed style={{ color: C.onPaperDim }}>{v.allDone ? "The set is done. Tomorrow's morning wire counts half again." : "Three minutes of desk work for the nights you cannot walk. All three, and tomorrow's morning wire pays half again."}{v.boostTomorrow && !v.allDone ? " (Tomorrow's bonus is already yours.)" : ""}</Typed>
      {v.puzzles.map((p) => {
        const done = v.solved.includes(p.n);
        const isOpen = open === p.n;
        return (
          <View key={p.n} style={{ backgroundColor: C.paper2, padding: 10, borderRadius: 3, marginTop: 8, borderLeftWidth: 3, borderLeftColor: done ? C.ok : C.amber }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Typed bold style={{ marginBottom: 0 }}>{p.n}. {p.title}</Typed>
              {done ? <Text style={[s.mono, { color: C.ok }]}>SOLVED</Text> : <Text style={[s.mono, { color: C.cyan }]} onPress={() => { setOpen(isOpen ? null : p.n); setAnswer(""); }}>{isOpen ? "CLOSE" : "OPEN"}</Text>}
            </View>
            {isOpen && !done && (
              <View style={{ marginTop: 6 }}>
                <Typed>{p.prompt}</Typed>
                {p.system && <Typed onPaper style={{ opacity: 0.7 }}>System: {p.system}. Exact answer, capitals.</Typed>}
                {p.options
                  ? p.options.map((o) => <Choice key={o} label={o} onPaper on={answer === o} onPress={() => setAnswer(o)} />)
                  : <Input onPaper value={answer} onChangeText={setAnswer} placeholder="Your answer" autoCapitalize="characters" autoCorrect={false} onSubmitEditing={() => submit(p.n)} />}
                {res[p.n] && !res[p.n].correct && <Typed style={{ color: C.stamp }}>{res[p.n].debrief}</Typed>}
                <Button title="Send it" kind="ink" onPress={() => submit(p.n)} loading={busy} />
              </View>
            )}
            {done && res[p.n]?.debrief && <Typed style={{ color: C.onPaperDim, marginTop: 4 }}>{res[p.n].debrief}</Typed>}
          </View>
        );
      })}
    </Dossier>
  );
}

const s = StyleSheet.create({
  title: { fontFamily: F.display, fontSize: 22, lineHeight: 24, color: C.onPaper, flex: 1 },
  mono: { fontFamily: F.typed, fontSize: 11.5, color: C.dim, letterSpacing: 0.6, marginTop: 4 },
  streak: { fontFamily: F.displayMed, fontSize: 12, letterSpacing: 1.6, color: C.amber, marginTop: 6 },
  big: { fontFamily: F.displayMed, fontSize: 22, letterSpacing: 1.5, marginBottom: 4 },
  areaName: { flex: 1, fontFamily: F.displayMed, fontSize: 14, color: C.dim, letterSpacing: 0.8 },
  bar: { flexDirection: "row", height: 5, borderRadius: 3, overflow: "hidden", backgroundColor: C.slate2, marginTop: 4 },
});
