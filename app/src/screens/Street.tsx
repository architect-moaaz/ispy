import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { GLView, type ExpoWebGLRenderingContext } from "expo-gl";
import * as THREE from "three";
import { C, F } from "../theme";
import { Button } from "../ui";
import type { Fix } from "../location";
import { fmtM, guide, type WalkingRoute } from "../route";

/**
 * The street in three dimensions: real building footprints raised to their heights, roads laid
 * flat, parks and water tinted, all from OpenStreetMap through the server. Your operative stands on
 * the actual pavement, walks or runs as fast as you do, and the camera rides behind. The footpath
 * route is a lit ribbon on the ground, the next turn is a floating arrow, and every site is a beacon
 * you can see over the rooftops. Nothing here is a photo: it is the city as the agency's model of it.
 */
export interface Scene { center: { lat: number; lng: number }; radiusM: number; buildings: { pts: [number, number][]; h?: number }[]; roads: { pts: [number, number][]; kind?: string; name?: string }[]; areas: { pts: [number, number][]; kind?: string }[]; pending?: boolean }
export interface Beacon { lat: number; lng: number; name: string; kind: "target" | "site" | "cache" | "signal"; radiusM?: number }
type LL = { lat: number; lng: number };

const ROAD_WIDTH: Record<string, number> = { motorway: 12, trunk: 11, primary: 9, secondary: 7.5, tertiary: 6.5, residential: 5, unclassified: 5, living_street: 4.5, service: 3.5, pedestrian: 4, footway: 1.8, path: 1.5, steps: 1.5, cycleway: 2, track: 2.5 };

export function Street({ fix, course, heading, route, target, beacons, scene, factionColor, onMap, onAR }: {
  fix: Fix; course: number | null; heading: number | null; route: WalkingRoute | null; target: (LL & { name: string; radiusM: number }) | null;
  beacons: Beacon[]; scene: Scene | null; factionColor: string; onMap: () => void; onAR: () => void;
}) {
  // Everything three.js lives in refs: the render loop reads the latest props without re-creating the scene.
  const world = useRef<{ gl: ExpoWebGLRenderingContext; renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; origin: LL; city: THREE.Group; live: THREE.Group; avatar: Avatar; raf: number } | null>(null);
  const latest = useRef({ fix, course, heading, route, target, beacons, scene, factionColor });
  latest.current = { fix, course, heading, route, target, beacons, scene, factionColor };
  const [speed, setSpeed] = useState(0);
  const prevFix = useRef<{ f: Fix; t: number } | null>(null);
  useEffect(() => {
    const t = Date.now();
    const p = prevFix.current;
    if (fix.speedMps != null && fix.speedMps >= 0) setSpeed(fix.speedMps);
    else if (p && t - p.t > 800) setSpeed(haversine(p.f, fix) / ((t - p.t) / 1000));
    prevFix.current = { f: fix, t };
  }, [fix.lat, fix.lng]);
  const g = route ? guide(route, fix) : null;
  const speedRef = useRef(0); speedRef.current = speed;

  const onContextCreate = (gl: ExpoWebGLRenderingContext) => {
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    const renderer = new THREE.WebGLRenderer({ canvas: shim(gl, w, h), context: gl as any, antialias: true });
    renderer.setSize(w, h, false);
    renderer.setPixelRatio(1);
    renderer.setClearColor(new THREE.Color(C.ink), 1);
    const sc = new THREE.Scene();
    sc.fog = new THREE.Fog(new THREE.Color(C.ink), 160, 420);
    sc.add(new THREE.HemisphereLight(0xa9c9d4, 0x0a1118, 1.5));
    const sun = new THREE.DirectionalLight(0xcfe9ef, 1.4); sun.position.set(80, 140, -60); sc.add(sun);
    const camera = new THREE.PerspectiveCamera(58, w / h, 0.5, 600);
    const origin = latest.current.scene?.center ?? { lat: latest.current.fix.lat, lng: latest.current.fix.lng };
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1600), new THREE.MeshStandardMaterial({ color: 0x0c1319, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.05; sc.add(ground);
    const grid = new THREE.GridHelper(1600, 160, 0x11303a, 0x0f2630); grid.position.y = -0.02; sc.add(grid);
    const city = new THREE.Group(); sc.add(city);
    const live = new THREE.Group(); sc.add(live);
    const avatar = makeAvatar(latest.current.factionColor); sc.add(avatar.group);
    world.current = { gl, renderer, scene: sc, camera, origin, city, live, avatar, raf: 0 };
    buildCity(world.current, latest.current.scene);
    let lastScene = latest.current.scene;
    let lastLive = "";
    let yaw = 0, pos = new THREE.Vector3(), t0 = Date.now(), walkPhase = 0, last = Date.now();
    const loop = () => {
      const W = world.current; if (!W) return;
      const L = latest.current;
      const nowT = Date.now(); const dt = Math.min(0.1, (nowT - last) / 1000); last = nowT;
      if (L.scene !== lastScene) { lastScene = L.scene; buildCity(W, L.scene); }
      const key = `${L.route?.coords.length ?? 0}:${L.target?.lat}:${L.target?.lng}:${L.beacons.map((b) => b.name).join("|")}`;
      if (key !== lastLive) { lastLive = key; buildLive(W, L.route, L.target, L.beacons); }
      // Avatar glides to the latest fix; faces the way you are walking (compass when standing still).
      const p = toLocal(W.origin, L.fix);
      pos.lerp(new THREE.Vector3(p.x, 0, p.z), 1 - Math.exp(-dt * 2.2));
      // Face the way you are walking; standing still, the compass; with neither, along the route.
      const along = L.route ? (() => { const gg = guide(L.route, L.fix); const to = gg.next ?? L.target; return to ? bearingLL(L.fix, to) : null; })() : L.target ? bearingLL(L.fix, L.target) : null;
      const want = L.heading != null && (speedRef.current < 0.6 || L.course == null) ? L.heading : L.course ?? L.heading ?? along ?? 0;
      yaw = lerpAngle(yaw, want, 1 - Math.exp(-dt * 3));
      W.avatar.group.position.copy(pos);
      W.avatar.group.rotation.y = -THREE.MathUtils.degToRad(yaw);
      const sp = speedRef.current;
      walkPhase += dt * (sp < 0.3 ? 0 : sp > 2.4 ? 14 : 8 + sp * 2);
      W.avatar.step(walkPhase, sp);
      // Third person: behind and above, looking a little ahead.
      const rad = THREE.MathUtils.degToRad(yaw);
      const back = new THREE.Vector3(-Math.sin(rad) * 24, 17, -Math.cos(rad) * 24);
      W.camera.position.lerp(pos.clone().add(back), 1 - Math.exp(-dt * 2.5));
      W.camera.lookAt(pos.clone().add(new THREE.Vector3(Math.sin(rad) * 10, 2.5, Math.cos(rad) * 10)));
      // The next-turn arrow bobs; beacons pulse.
      const tt = (nowT - t0) / 1000;
      W.live.children.forEach((o: THREE.Object3D) => { if (o.userData.bob) o.position.y = o.userData.baseY + Math.sin(tt * 3) * 0.6; if (o.userData.pulse) { const s = 1 + Math.sin(tt * 2.2) * 0.08; o.scale.set(s, 1, s); } });
      W.renderer.render(W.scene, W.camera);
      W.gl.endFrameEXP();
      W.raf = requestAnimationFrame(loop);
    };
    world.current.raf = requestAnimationFrame(loop);
  };
  useEffect(() => () => { const W = world.current; if (W) { cancelAnimationFrame(W.raf); W.renderer.dispose(); } }, []);

  const gait = speed < 0.3 ? "Standing" : speed > 2.4 ? "Running" : "Walking";
  const next = g?.next;
  return (
    <View style={{ flex: 1, backgroundColor: C.ink }}>
      <GLView style={StyleSheet.absoluteFill} onContextCreate={onContextCreate} />
      <View style={s.top} pointerEvents="none">
        <Text style={s.eyebrow}>STREET VIEW · {scene && !scene.pending ? `${scene.buildings.length} BUILDINGS · ${scene.roads.length} ROADS` : scene?.pending && scene.buildings.length ? `${scene.buildings.length} BUILDINGS · REFRESHING` : "MAPPING THE BLOCK…"}</Text>
        {target ? <Text style={s.title}>{target.name}</Text> : <Text style={s.title}>No objective</Text>}
        {g && target && (
          <Text style={s.line}>{g.remainingM <= target.radiusM + 15 ? "On the ring. Scan it." : next ? `${next.text} · in ${fmtM(g.toNextM)}` : `${fmtM(g.remainingM)} along the line`}</Text>
        )}
        {!route && target && <Text style={s.line}>{fmtM(haversine(fix, target))} straight line · plotting a footpath</Text>}
      </View>
      <View style={s.bottom}>
        <Text style={s.eyebrow}>{gait.toUpperCase()} · {speed.toFixed(1)} M/S{heading != null ? ` · ${Math.round(heading)}°` : course != null ? ` · ${Math.round(course)}°` : ""}</Text>
        <View style={{ flexDirection: "row", gap: 8, marginTop: 6 }}>
          <Button title="Map" kind="ghost" onPress={onMap} style={{ flex: 1, marginTop: 0, paddingVertical: 9 }} />
          <Button title="AR" kind="ghost" onPress={onAR} style={{ flex: 1, marginTop: 0, paddingVertical: 9 }} />
        </View>
      </View>
    </View>
  );
}

// ---------- geometry ----------
function toLocal(origin: LL, p: LL) {
  const k = 111_320;
  return { x: (p.lng - origin.lng) * k * Math.cos((origin.lat * Math.PI) / 180), z: -(p.lat - origin.lat) * k };
}
function haversine(a: LL, b: LL) {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function bearingLL(a: LL, b: LL) {
  const r = Math.PI / 180, dLng = (b.lng - a.lng) * r;
  const y = Math.sin(dLng) * Math.cos(b.lat * r), x = Math.cos(a.lat * r) * Math.sin(b.lat * r) - Math.sin(a.lat * r) * Math.cos(b.lat * r) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}
function lerpAngle(a: number, b: number, t: number) {
  const d = ((b - a + 540) % 360) - 180;
  return (a + d * t + 360) % 360;
}
function shim(gl: ExpoWebGLRenderingContext, w: number, h: number) {
  return { width: w, height: h, style: {}, clientWidth: w, clientHeight: h, addEventListener() {}, removeEventListener() {}, getContext: () => gl } as any;
}

function ribbon(pts: { x: number; z: number }[], width: number, y: number): THREE.BufferGeometry {
  const pos: number[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p = pts[i], q = pts[i + 1];
    const dx = q.x - p.x, dz = q.z - p.z, len = Math.hypot(dx, dz) || 1;
    const nx = (-dz / len) * (width / 2), nz = (dx / len) * (width / 2);
    pos.push(p.x + nx, y, p.z + nz, q.x + nx, y, q.z + nz, q.x - nx, y, q.z - nz, p.x + nx, y, p.z + nz, q.x - nx, y, q.z - nz, p.x - nx, y, p.z - nz);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return geo;
}

function clearGroup(g: THREE.Group) {
  for (const o of [...g.children]) { g.remove(o); (o as any).geometry?.dispose?.(); const m = (o as any).material; if (m) (Array.isArray(m) ? m : [m]).forEach((x: any) => x.dispose?.()); }
}

function buildCity(W: { origin: LL; city: THREE.Group }, scene: Scene | null) {
  clearGroup(W.city);
  if (!scene) return;
  const wall = new THREE.MeshStandardMaterial({ color: 0x24343f, roughness: 0.8, metalness: 0.08 });
  const edge = new THREE.LineBasicMaterial({ color: new THREE.Color(C.cyan), transparent: true, opacity: 0.5 });
  for (const b of scene.buildings) {
    const pts = b.pts.map(([lat, lng]) => toLocal(W.origin, { lat, lng }));
    if (pts.length < 3) continue;
    const shape = new THREE.Shape(pts.map((p) => new THREE.Vector2(p.x, -p.z)));
    const geo = new THREE.ExtrudeGeometry(shape, { depth: b.h ?? 7, bevelEnabled: false });
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, wall);
    W.city.add(mesh);
    W.city.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 20), edge));
  }
  const roadMat = new THREE.MeshStandardMaterial({ color: 0x24313b, roughness: 1 });
  const pathMat = new THREE.MeshStandardMaterial({ color: 0x2c3a3f, roughness: 1 });
  for (const r of scene.roads) {
    const pts = r.pts.map(([lat, lng]) => toLocal(W.origin, { lat, lng }));
    const wdt = ROAD_WIDTH[r.kind ?? ""] ?? 4;
    W.city.add(new THREE.Mesh(ribbon(pts, wdt, 0.02), wdt < 3 ? pathMat : roadMat));
  }
  for (const a of scene.areas) {
    const pts = a.pts.map(([lat, lng]) => toLocal(W.origin, { lat, lng }));
    if (pts.length < 3) continue;
    const shape = new THREE.Shape(pts.map((p) => new THREE.Vector2(p.x, -p.z)));
    const geo = new THREE.ShapeGeometry(shape); geo.rotateX(-Math.PI / 2);
    W.city.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: a.kind === "water" ? 0x0f2f3e : 0x12301f, roughness: 1 })).translateY(0.01));
  }
}

function buildLive(W: { origin: LL; live: THREE.Group }, route: WalkingRoute | null, target: (LL & { radiusM: number }) | null, beacons: Beacon[]) {
  clearGroup(W.live);
  const cyan = new THREE.Color(C.cyan), amber = new THREE.Color(C.amber);
  if (route) {
    const pts = route.coords.map((c) => toLocal(W.origin, c));
    W.live.add(new THREE.Mesh(ribbon(pts, 1.6, 0.12), new THREE.MeshBasicMaterial({ color: cyan, transparent: true, opacity: 0.85 })));
    W.live.add(new THREE.Mesh(ribbon(pts, 3.2, 0.08), new THREE.MeshBasicMaterial({ color: cyan, transparent: true, opacity: 0.18 })));
    const next = route.steps.find((st) => st.type !== "depart" && st.type !== "arrive");
    void next;
  }
  if (target) {
    const p = toLocal(W.origin, target);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 90, 10, 1, true), new THREE.MeshBasicMaterial({ color: cyan, transparent: true, opacity: 0.55, side: THREE.DoubleSide }));
    beam.position.set(p.x, 45, p.z); W.live.add(beam);
    const ring = new THREE.Mesh(new THREE.RingGeometry(target.radiusM - 0.8, target.radiusM, 64), new THREE.MeshBasicMaterial({ color: cyan, transparent: true, opacity: 0.6, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(p.x, 0.15, p.z); ring.userData.pulse = true; W.live.add(ring);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(target.radiusM, 48), new THREE.MeshBasicMaterial({ color: cyan, transparent: true, opacity: 0.08 }));
    disc.rotation.x = -Math.PI / 2; disc.position.set(p.x, 0.1, p.z); W.live.add(disc);
  }
  for (const b of beacons) {
    const p = toLocal(W.origin, b);
    const col = b.kind === "cache" ? amber : b.kind === "signal" ? new THREE.Color(0xff5dcb) : cyan;
    const h = b.kind === "site" ? 40 : 18;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, h, 6), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.5 }));
    pole.position.set(p.x, h / 2, p.z); W.live.add(pole);
    const head = new THREE.Mesh(new THREE.OctahedronGeometry(1.4), new THREE.MeshBasicMaterial({ color: col }));
    head.position.set(p.x, h + 1.5, p.z); head.userData.bob = true; head.userData.baseY = h + 1.5; W.live.add(head);
  }
  if (route) {
    // The next turn: an arrow hanging over the manoeuvre point, pointing on along the route.
    const steps = route.steps.filter((st) => st.type !== "depart" && st.type !== "arrive");
    for (const st of steps.slice(0, 3)) {
      const p = toLocal(W.origin, st);
      const arrow = new THREE.Group();
      const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 4), new THREE.MeshBasicMaterial({ color: cyan }));
      const head = new THREE.Mesh(new THREE.ConeGeometry(1.6, 2.6, 4), new THREE.MeshBasicMaterial({ color: cyan }));
      head.rotation.x = Math.PI / 2; head.rotation.y = Math.PI / 4; head.position.z = 3.2;
      arrow.add(shaft, head);
      arrow.position.set(p.x, 5, p.z);
      arrow.rotation.y = -THREE.MathUtils.degToRad(st.bearing) + Math.PI;
      arrow.userData.bob = true; arrow.userData.baseY = 5;
      W.live.add(arrow);
    }
  }
}

interface Avatar { group: THREE.Group; step: (phase: number, speed: number) => void }
function makeAvatar(color: string): Avatar {
  const group = new THREE.Group();
  const jacket = new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: 0.6 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x0e151c, roughness: 0.9 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xd9c2a6, roughness: 0.8 });
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 0.7, 4, 10), jacket); torso.position.y = 1.35;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 10), skin); head.position.y = 2.15;
  const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.36, 0.22, 12), dark); hat.position.y = 2.38;
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.04, 14), dark); brim.position.y = 2.28;
  const legL = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.6, 3, 8), dark); legL.position.set(-0.2, 0.55, 0);
  const legR = legL.clone(); legR.position.x = 0.2;
  const armL = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.55, 3, 8), jacket); armL.position.set(-0.55, 1.4, 0);
  const armR = armL.clone(); armR.position.x = 0.55;
  const glow = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.1, 32), new THREE.MeshBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity: 0.6, side: THREE.DoubleSide }));
  glow.rotation.x = -Math.PI / 2; glow.position.y = 0.05;
  group.add(torso, head, hat, brim, legL, legR, armL, armR, glow);
  return {
    group,
    step: (phase, speed) => {
      const amp = speed < 0.3 ? 0 : speed > 2.4 ? 0.9 : 0.55;
      legL.rotation.x = Math.sin(phase) * amp; legR.rotation.x = -Math.sin(phase) * amp;
      armL.rotation.x = -Math.sin(phase) * amp * 0.8; armR.rotation.x = Math.sin(phase) * amp * 0.8;
      torso.position.y = 1.35 + Math.abs(Math.sin(phase)) * (speed > 2.4 ? 0.12 : 0.04);
      group.rotation.x = speed > 2.4 ? 0.12 : 0;
    },
  };
}

const s = StyleSheet.create({
  top: { position: "absolute", left: 14, right: 14, top: 14, backgroundColor: "rgba(7,11,16,0.72)", borderWidth: 1, borderColor: "rgba(0,229,242,0.35)", borderRadius: 10, padding: 10 },
  bottom: { position: "absolute", left: 14, right: 14, bottom: 18, backgroundColor: "rgba(7,11,16,0.72)", borderWidth: 1, borderColor: "rgba(141,178,189,0.25)", borderRadius: 10, padding: 10 },
  eyebrow: { color: C.dim, fontFamily: F.displayMed, fontSize: 10.5, letterSpacing: 1.6 },
  title: { color: C.text, fontFamily: F.displayMed, fontSize: 22, marginTop: 2 },
  line: { color: C.cyan, fontFamily: F.typed, fontSize: 13.5, marginTop: 3 },
});
