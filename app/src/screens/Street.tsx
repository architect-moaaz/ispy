import React, { useEffect, useMemo, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { Asset } from "expo-asset";
import { GLView, type ExpoWebGLRenderingContext } from "expo-gl";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { C, F } from "../theme";
import { Button } from "../ui";
import type { Fix } from "../location";
import { fmtM, guide, type WalkingRoute } from "../route";
import type { Build } from "../prefs";

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

export function Street({ fix, course, heading, route, target, beacons, scene, factionColor, build, onMap, onAR }: {
  fix: Fix; course: number | null; heading: number | null; route: WalkingRoute | null; target: (LL & { name: string; radiusM: number }) | null;
  beacons: Beacon[]; scene: Scene | null; factionColor: string; build: Build; onMap: () => void; onAR: () => void;
}) {
  // Everything three.js lives in refs: the render loop reads the latest props without re-creating the scene.
  const world = useRef<{ gl: ExpoWebGLRenderingContext; renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; origin: LL; city: THREE.Group; live: THREE.Group; avatar: Avatar; raf: number } | null>(null);
  const latest = useRef({ fix, course, heading, route, target, beacons, scene, factionColor, build });
  latest.current = { fix, course, heading, route, target, beacons, scene, factionColor, build };
  const [speed, setSpeed] = useState(0);
  const [demo, setDemo] = useState<number | null>(null); // tap the gait line to preview walk and run while standing
  // Free look: drag to orbit round the operative, drag up and down for height, pinch for distance.
  const look = useRef({ yaw: 0, pitch: 0, zoom: 1, start: { yaw: 0, pitch: 0, zoom: 1 } });
  const [moved, setMoved] = useState(false);
  const gestures = useMemo(() => {
    const pan = Gesture.Pan().minPointers(1).maxPointers(1)
      .onBegin(() => { look.current.start = { ...look.current }; })
      .onUpdate((e) => { const L = look.current; L.yaw = L.start.yaw + e.translationX * 0.35; L.pitch = Math.max(-0.6, Math.min(1, L.start.pitch - e.translationY * 0.004)); setMoved(true); })
      .runOnJS(true);
    const pinch = Gesture.Pinch()
      .onBegin(() => { look.current.start = { ...look.current }; })
      .onUpdate((e) => { look.current.zoom = Math.max(0.45, Math.min(2.4, look.current.start.zoom / Math.max(0.05, e.scale))); setMoved(true); })
      .runOnJS(true);
    return Gesture.Simultaneous(pan, pinch);
  }, []);
  const recentre = () => { look.current = { yaw: 0, pitch: 0, zoom: 1, start: { yaw: 0, pitch: 0, zoom: 1 } }; setMoved(false); };
  const prevFix = useRef<{ f: Fix; t: number } | null>(null);
  useEffect(() => {
    const t = Date.now();
    const p = prevFix.current;
    if (fix.speedMps != null && fix.speedMps >= 0) setSpeed(fix.speedMps);
    else if (p && t - p.t > 800) setSpeed(haversine(p.f, fix) / ((t - p.t) / 1000));
    prevFix.current = { f: fix, t };
  }, [fix.lat, fix.lng]);
  const g = route ? guide(route, fix) : null;
  const speedRef = useRef(0); speedRef.current = demo ?? speed;

  const onContextCreate = (gl: ExpoWebGLRenderingContext) => {
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    const renderer = new THREE.WebGLRenderer({ canvas: shim(gl, w, h), context: gl as any, antialias: true });
    renderer.setSize(w, h, false);
    renderer.setPixelRatio(1);
    renderer.setClearColor(new THREE.Color(C.ink), 1);
    const sc = new THREE.Scene();
    sc.fog = new THREE.Fog(new THREE.Color(0x0a1016), 140, 460);
    const hemi = new THREE.HemisphereLight(0x9fbfd0, 0x0a1118, 1.2); sc.add(hemi);
    const sun = new THREE.DirectionalLight(0xbfdbe6, 1.1); sun.position.set(80, 140, -60); sc.add(sun);
    const rim = new THREE.DirectionalLight(new THREE.Color(C.cyan), 0.6); rim.position.set(-60, 40, 80); sc.add(rim);
    // A soft lamp that rides with the camera, so the operative reads against the dark street.
    const follow = new THREE.PointLight(0xdfe9ee, 22, 26, 1.4); sc.add(follow);
    const fill = new THREE.DirectionalLight(0xcfdde6, 0.45); sc.add(fill); sc.add(fill.target);
    const camera = new THREE.PerspectiveCamera(50, w / h, 0.3, 1200);
    const origin = latest.current.scene?.center ?? { lat: latest.current.fix.lat, lng: latest.current.fix.lng };
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1600), new THREE.MeshStandardMaterial({ color: 0x0e151c, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.05; sc.add(ground);
    const grid = new THREE.GridHelper(1600, 200, 0x10262e, 0x0d1f27); grid.position.y = -0.02; sc.add(grid);
    // The sky: painted panoramas on two domes that crossfade with the hour, turning very slowly, outside the fog.
    const skyTex: Partial<Record<Phase, THREE.Texture>> = {};
    const skyA = new THREE.Mesh(new THREE.SphereGeometry(540, 48, 24), new THREE.MeshBasicMaterial({ color: 0x3a4650, side: THREE.BackSide, fog: false }));
    const skyB = new THREE.Mesh(new THREE.SphereGeometry(536, 48, 24), new THREE.MeshBasicMaterial({ color: 0x3a4650, side: THREE.BackSide, fog: false, transparent: true, opacity: 0 }));
    skyA.rotation.y = Math.PI; skyB.rotation.y = Math.PI; sc.add(skyA, skyB);
    const skyFor = (ph: Phase) => { if (skyTex[ph]) return; void loadPhoto(SKIES[ph]).then((t) => { t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping; skyTex[ph] = t; }).catch(() => {}); };
    let skyShown: [Phase | null, Phase | null] = [null, null];
    const city = new THREE.Group(); sc.add(city);
    const live = new THREE.Group(); sc.add(live);
    const avatar = makeAvatar(latest.current.factionColor); sc.add(avatar.group);
    let dressed: Build | null = null;
    const dress = (b: Build) => void loadOperative(b).then((model) => { const W = world.current; if (!W || !model || latest.current.build !== b) return; dressed = b; W.avatar = dressOperative(W.avatar, model, latest.current.factionColor, b); console.log("[street] operative ready", b); });
    dress(latest.current.build);
    world.current = { gl, renderer, scene: sc, camera, origin, city, live, avatar, raf: 0 };
    if (Platform.OS === "web") (globalThis as any).__street = world; // inspection in the web preview only
    buildCity(world.current, latest.current.scene);
    let lastScene = latest.current.scene;
    let lastPhotos = photos;
    void loadPhotos().catch((e) => { console.warn("[street] photos failed:", e?.message ?? e); photosLoading = null; return null; }).then((p) => { const W = world.current; if (!W || !p) return; console.log("[street] photos ready"); (ground.material as THREE.MeshStandardMaterial).map = p.asphalt; p.asphalt.repeat.set(200, 200); (ground.material as THREE.MeshStandardMaterial).color.set(0x4f5b64); (ground.material as THREE.MeshStandardMaterial).needsUpdate = true; });
    let lastLive = "";
    let yaw = 0, pos = new THREE.Vector3(), t0 = Date.now(), walkPhase = 0, last = Date.now();
    let stillSince = Date.now(), orbit = 0; // 0 behind, 1 round the front: the idle turn
    const loop = () => {
      const W = world.current; if (!W) return;
      const L = latest.current;
      const nowT = Date.now(); const dt = Math.min(0.1, (nowT - last) / 1000); last = nowT;
      if (L.scene !== lastScene || photos !== lastPhotos) { lastScene = L.scene; lastPhotos = photos; buildCity(W, L.scene); }
      if (dressed && dressed !== L.build) { dressed = L.build; dress(L.build); }
      const key = `${L.route?.coords.length ?? 0}:${L.target?.lat}:${L.target?.lng}:${L.beacons.map((b) => b.name).join("|")}`;
      if (key !== lastLive) { lastLive = key; buildLive(W, L.route, L.target, L.beacons.filter((b) => haversine(b, L.fix) > 6)); } // nothing standing on the operative's own spot
      // Avatar glides to the latest fix; faces the way you are walking (compass when standing still).
      const p = toLocal(W.origin, L.fix);
      pos.lerp(new THREE.Vector3(p.x, 0, p.z), 1 - Math.exp(-dt * 2.2));
      // Face the way you are walking; standing still, the compass; with neither, along the route.
      const along = L.route ? (() => { const gg = guide(L.route, L.fix); const to = gg.next ?? L.target; return to ? bearingLL(L.fix, to) : null; })() : L.target ? bearingLL(L.fix, L.target) : null;
      const want = L.heading != null && (speedRef.current < 0.6 || L.course == null) ? L.heading : L.course ?? L.heading ?? along ?? 0;
      yaw = lerpAngle(yaw, want, 1 - Math.exp(-dt * 3));
      W.avatar.group.position.copy(pos);
      W.avatar.group.rotation.y = Math.PI - THREE.MathUtils.degToRad(yaw); // front is +z; north is -z
      const sp = speedRef.current;
      walkPhase += dt * (sp < 0.3 ? 0 : sp > 2.4 ? 14 : 8 + sp * 2);
      W.avatar.step(walkPhase, sp);
      // Third person: three-quarter rear while moving. Stand still a couple of seconds and the camera
      // swings round the front to hold on the operative; it swings back the moment you move.
      if (sp >= 0.3) stillSince = nowT;
      const wantOrbit = nowT - stillSince > 2500 ? 1 : 0;
      orbit += (wantOrbit - orbit) * (1 - Math.exp(-dt * (wantOrbit ? 0.9 : 2.2)));
      const LK = look.current;
      const rad = THREE.MathUtils.degToRad(yaw + LK.yaw) + orbit * Math.PI * 0.82;
      const dist = (7.5 - orbit * 4.3) * LK.zoom, lift = (4.2 - orbit * 2.7) * LK.zoom + LK.pitch * 5 * LK.zoom, side = (1.7 - orbit * 1.1) * LK.zoom;
      const back = new THREE.Vector3(-Math.sin(rad) * dist + Math.cos(rad) * side, lift, Math.cos(rad) * dist + Math.sin(rad) * side);
      if (back.y < 0.6) back.y = 0.6; // never below the pavement
      W.camera.position.lerp(pos.clone().add(back), 1 - Math.exp(-dt * (LK.yaw || LK.pitch ? 6 : 2.5)));
      follow.position.copy(W.camera.position).add(new THREE.Vector3(0, 2.5, 0));
      const aheadX = Math.sin(rad) * (3 - orbit * 2.6) + Math.cos(rad) * 0.5 * (1 - orbit), aheadZ = -Math.cos(rad) * (3 - orbit * 2.6) + Math.sin(rad) * 0.5 * (1 - orbit);
      W.camera.lookAt(pos.clone().add(new THREE.Vector3(aheadX, 1.3 + orbit * 0.1, aheadZ)));
      fill.position.copy(W.camera.position).add(new THREE.Vector3(0, 3, 0)); fill.target.position.copy(pos); fill.target.updateMatrixWorld();
      // The next-turn arrow bobs; beacons pulse.
      const tt = (nowT - t0) / 1000;
      routeTex.offset.y -= dt * 0.9;
      // Time of day: pick the two skies for this hour, load them lazily, crossfade, and move the light.
      const hourNow = (W as any).hourOverride ?? (new Date().getHours() + new Date().getMinutes() / 60);
      const ph = phaseAt(hourNow);
      skyFor(ph.a); skyFor(ph.b);
      const setSky = (mesh: THREE.Mesh, p: Phase, slot: 0 | 1) => { const t = skyTex[p]; const m = mesh.material as THREE.MeshBasicMaterial; if (t && skyShown[slot] !== p) { m.map = t; m.color.set(0xffffff); m.needsUpdate = true; skyShown[slot] = p; } };
      setSky(skyA, ph.a, 0); setSky(skyB, ph.b, 1);
      (skyB.material as THREE.MeshBasicMaterial).opacity = ph.a === ph.b ? 0 : ph.t;
      const la = LIGHTS[ph.a], lb = LIGHTS[ph.b];
      sun.intensity = la.sun + (lb.sun - la.sun) * ph.t; sun.color.copy(lerpC(la.sunColor, lb.sunColor, ph.t));
      hemi.intensity = la.sky + (lb.sky - la.sky) * ph.t; hemi.color.copy(lerpC(la.skyColor, lb.skyColor, ph.t));
      (sc.fog as THREE.Fog).color.copy(lerpC(la.fog, lb.fog, ph.t));
      const win = la.windows + (lb.windows - la.windows) * ph.t, lampK = la.lamps + (lb.lamps - la.lamps) * ph.t;
      W.city.traverse((o: any) => { if (Array.isArray(o.material)) { for (const m of o.material) if (m.userData.windows) m.emissiveIntensity = win; } if (o.userData.lampHead) o.visible = lampK > 0.05; if (o.userData.lampPool) o.material.opacity = 0.09 * lampK; });
      for (const d of [skyA, skyB]) { d.rotation.y += dt * 0.004; d.position.copy(W.camera.position).setY(-40); }
      W.live.children.forEach((o: THREE.Object3D) => { if (o.userData.bob) o.position.y = o.userData.baseY + Math.sin(tt * 3) * 0.6; if (o.userData.pulse) { const s = 1 + Math.sin(tt * 2.2) * 0.08; o.scale.set(s, 1, s); } });
      W.renderer.render(W.scene, W.camera);
      W.gl.endFrameEXP();
      W.raf = requestAnimationFrame(loop);
    };
    world.current.raf = requestAnimationFrame(loop);
  };
  useEffect(() => () => { const W = world.current; if (W) { cancelAnimationFrame(W.raf); W.renderer.dispose(); } }, []);

  const shown = demo ?? speed;
  const gait = shown < 0.3 ? "Standing" : shown > 2.4 ? "Running" : "Walking";
  const next = g?.next;
  return (
    <View style={{ flex: 1, backgroundColor: C.ink }}>
      <GLView style={StyleSheet.absoluteFill} onContextCreate={onContextCreate} />
      <GestureDetector gesture={gestures}><View style={StyleSheet.absoluteFill} collapsable={false} /></GestureDetector>
      {moved && (
        <Pressable onPress={recentre} style={s.recentre} hitSlop={8}><Text style={s.recentreText}>RECENTRE</Text></Pressable>
      )}
      <View style={s.top} pointerEvents="none">
        <Text style={s.eyebrow}>STREET VIEW · {scene && !scene.pending ? `${scene.buildings.length} BUILDINGS · ${scene.roads.length} ROADS` : scene?.pending && scene.buildings.length ? `${scene.buildings.length} BUILDINGS · REFRESHING` : "MAPPING THE BLOCK…"}</Text>
        {target ? <Text style={s.title}>{target.name}</Text> : <Text style={s.title}>No objective</Text>}
        {g && target && (
          <Text style={s.line}>{g.remainingM <= target.radiusM + 15 ? "On the ring. Scan it." : next ? `${next.text} · in ${fmtM(g.toNextM)}` : `${fmtM(g.remainingM)} along the line`}</Text>
        )}
        {!route && target && <Text style={s.line}>{fmtM(haversine(fix, target))} straight line · plotting a footpath</Text>}
      </View>
      <View style={s.bottom}>
        <Pressable onPress={() => setDemo((d) => (d == null ? 1.3 : d < 2 ? 3.2 : null))} hitSlop={8}>
          <Text style={s.eyebrow}>{gait.toUpperCase()} · {shown.toFixed(1)} M/S{heading != null ? ` · ${Math.round(heading)}°` : course != null ? ` · ${Math.round(course)}°` : ""}{demo != null ? " · PREVIEW · TAP TO STOP" : " · TAP TO PREVIEW THE WALK"}</Text>
        </Pressable>
        <View style={{ flexDirection: "row", gap: 8, marginTop: 6 }}>
          <Button title="Map" kind="ghost" onPress={onMap} style={{ flex: 1, marginTop: 0, paddingVertical: 9 }} />
          <Button title="AR" kind="ghost" onPress={onAR} style={{ flex: 1, marginTop: 0, paddingVertical: 9 }} />
        </View>
      </View>
    </View>
  );
}

// ---------- time of day ----------
/**
 * The sky and the light follow the clock. Four painted panoramas (dystopian dawn, ashen day, blood
 * dusk, storm night) crossfade through the day, and the sun, sky light, fog and window glow move
 * with them. `hourOverride` on the world object lets the web preview jump the clock.
 */
type Phase = "night" | "dawn" | "day" | "dusk";
const SKIES = { night: require("../../assets/art/sky-dystopia.jpg"), dawn: require("../../assets/art/sky-dawn.jpg"), day: require("../../assets/art/sky-day.jpg"), dusk: require("../../assets/art/sky-dusk.jpg") } as const;
interface Light { sun: number; sunColor: number; sky: number; skyColor: number; fog: number; windows: number; lamps: number }
const LIGHTS: Record<Phase, Light> = {
  night: { sun: 1.1, sunColor: 0xbfdbe6, sky: 1.2, skyColor: 0x9fbfd0, fog: 0x0a1016, windows: 0.7, lamps: 1 },
  dawn: { sun: 1.6, sunColor: 0xe8a070, sky: 1.5, skyColor: 0xb89aa0, fog: 0x3a2a2a, windows: 0.35, lamps: 0.5 },
  day: { sun: 2.4, sunColor: 0xd9e4ea, sky: 2.2, skyColor: 0xb9c8cf, fog: 0x5a6670, windows: 0.08, lamps: 0 },
  dusk: { sun: 1.5, sunColor: 0xff6a5a, sky: 1.4, skyColor: 0x8a5a7a, fog: 0x2e1a2a, windows: 0.5, lamps: 0.8 },
};
/** Which two phases the hour sits between, and how far along. */
function phaseAt(hour: number): { a: Phase; b: Phase; t: number } {
  const h = ((hour % 24) + 24) % 24;
  const seg: [number, number, Phase, Phase][] = [[5, 7, "night", "dawn"], [7, 9, "dawn", "day"], [9, 16.5, "day", "day"], [16.5, 18.5, "day", "dusk"], [18.5, 20.5, "dusk", "night"]];
  for (const [s0, s1, a, b] of seg) if (h >= s0 && h < s1) return { a, b, t: (h - s0) / (s1 - s0) };
  return { a: "night", b: "night", t: 0 };
}
const lerpC = (a: number, b: number, t: number) => new THREE.Color(a).lerp(new THREE.Color(b), t);

// ---------- textures (procedural; no files, no canvas) ----------
/** A block of night windows: 4 columns × 4 floors per tile, each lit warm, cool or dark. */
function windowTexture(): THREE.DataTexture {
  const S = 64, data = new Uint8Array(S * S * 4);
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let cy = 0; cy < 4; cy++) for (let cx = 0; cx < 4; cx++) {
    const r = rnd();
    const lit = r < 0.42 ? [255, 196, 120] : r < 0.58 ? [150, 225, 240] : r < 0.66 ? [255, 236, 200] : null;
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const i = ((cy * 16 + y) * S + cx * 16 + x) * 4;
      const inWin = x >= 4 && x < 12 && y >= 3 && y < 12;
      const wall = [46, 58, 68];
      const col = inWin ? (lit ?? [18, 24, 30]) : wall;
      data[i] = col[0]; data[i + 1] = col[1]; data[i + 2] = col[2]; data[i + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, S, S); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.NearestFilter; t.minFilter = THREE.LinearMipMapLinearFilter; t.generateMipmaps = true; t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true;
  return t;
}
/** Only the lit panes glow: same layout, black elsewhere. */
function windowEmissive(src: THREE.DataTexture): THREE.DataTexture {
  const S = 64, d = new Uint8Array(S * S * 4), a = src.image.data as Uint8Array;
  for (let i = 0; i < S * S * 4; i += 4) { const bright = a[i] + a[i + 1] + a[i + 2] > 300; d[i] = bright ? a[i] : 0; d[i + 1] = bright ? a[i + 1] : 0; d[i + 2] = bright ? a[i + 2] : 0; d[i + 3] = 255; }
  const t = new THREE.DataTexture(d, S, S); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true;
  return t;
}
/** Chevrons along the route, scrolled each frame so the line flows toward the objective. */
function chevronTexture(): THREE.DataTexture {
  const W = 16, H = 32, d = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    const v = Math.abs(x - W / 2 + 0.5) / (W / 2); // 0 centre .. 1 edge
    const on = ((y + Math.floor(v * 8)) % 16) < 6;
    const a = on ? 255 : 70;
    d[i] = 0; d[i + 1] = 229; d[i + 2] = 242; d[i + 3] = a;
  }
  const t = new THREE.DataTexture(d, W, H); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.needsUpdate = true;
  return t;
}
const winTex = windowTexture();
const winGlow = windowEmissive(winTex);
const routeTex = chevronTexture();

/** Photographic tiles: three facades picked by building height, and wet asphalt for the ground and roads. */
interface Photos { apartment: THREE.Texture; tower: THREE.Texture; shophouse: THREE.Texture; asphalt: THREE.Texture }
let photos: Photos | null = null;
let photosLoading: Promise<Photos> | null = null;
async function loadPhoto(mod: number): Promise<THREE.Texture> {
  const asset = Asset.fromModule(mod);
  await asset.downloadAsync();
  let t: THREE.Texture;
  if (Platform.OS === "web") t = await new THREE.TextureLoader().loadAsync(asset.uri);
  else {
    // expo-gl uploads an Asset (anything with a localUri) through texImage2D as the pixel source.
    t = new THREE.Texture();
    (t as any).image = { data: asset, width: asset.width ?? 512, height: asset.height ?? 512 };
    (t as any).isDataTexture = true;
    t.minFilter = THREE.LinearFilter; t.generateMipmaps = false;
    t.needsUpdate = true;
  }
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function loadPhotos(): Promise<Photos> {
  if (!photosLoading) photosLoading = (async () => {
    const [apartment, tower, shophouse, asphalt] = await Promise.all([
      loadPhoto(require("../../assets/art/tex-apartment.jpg")), loadPhoto(require("../../assets/art/tex-tower.jpg")),
      loadPhoto(require("../../assets/art/tex-shophouse.jpg")), loadPhoto(require("../../assets/art/tex-asphalt.jpg")),
    ]);
    photos = { apartment, tower, shophouse, asphalt };
    return photos;
  })();
  return photosLoading;
}

/**
 * The operative: a CC0 rigged human (Quaternius Universal Base Characters, mannequin skeleton),
 * packed as a GLB without its textures; the dark suit texture is applied here through the same
 * loader as the facades. No clips ship with the rig, so the walk is driven on the bones.
 */
const operativeLoading: Partial<Record<Build, Promise<THREE.Group | null>>> = {};
const MODELS = { m: require("../../assets/models/operative.glb"), f: require("../../assets/models/operative-f.glb") } as const;
const SUITS = { m: require("../../assets/art/tex-operative-suit.jpg"), f: require("../../assets/art/tex-operative-f-suit.jpg") } as const;
const NORMALS = { m: require("../../assets/art/tex-operative-normal.jpg"), f: require("../../assets/art/tex-operative-f-normal.jpg") } as const;
function loadOperative(build: Build): Promise<THREE.Group | null> {
  if (!operativeLoading[build]) operativeLoading[build] = (async () => {
    try {
      const asset = Asset.fromModule(MODELS[build]);
      await asset.downloadAsync();
      const buf = await (await fetch(asset.localUri ?? asset.uri)).arrayBuffer();
      const gltf = await new Promise<any>((res, rej) => new GLTFLoader().parse(buf, "", res, rej));
      // The suit painted onto the body's own UV layout, the pack's normal map, and the eye and brow maps.
      const [body, normal, eye, hair, cloth] = await Promise.all([
        loadPhoto(SUITS[build]), loadPhoto(NORMALS[build]), loadPhoto(require("../../assets/art/tex-eye.jpg")), loadPhoto(require("../../assets/art/tex-hair.jpg")), loadPhoto(require("../../assets/art/tex-coat.jpg")),
      ]);
      for (const t of [body, normal, eye, hair]) { t.flipY = false; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; }
      normal.colorSpace = THREE.NoColorSpace;
      cloth.flipY = false; cloth.repeat.set(3, 3);
      const root: THREE.Group = gltf.scene;
      let bodyMesh: THREE.SkinnedMesh | null = null;
      root.traverse((o: any) => {
        if (!o.isMesh) return;
        o.frustumCulled = false;
        const name: string = o.name ?? "";
        if (/male|retopology|body/i.test(name) && o.isSkinnedMesh) bodyMesh = o;
        // Names as GLTFLoader gives them (node names): SuperHero_Male, Eyes, Eyebrows.
        if (/male|retopology|body/i.test(name)) o.material = new THREE.MeshStandardMaterial({ map: body, normalMap: normal, normalScale: new THREE.Vector2(0.6, 0.6), roughness: 0.85, metalness: 0.05, emissive: 0x0a1015, emissiveIntensity: 0.6 });
        else if (/eye(?!brow)/i.test(name)) { o.material = new THREE.MeshStandardMaterial({ map: eye, roughness: 0.35, metalness: 0 }); o.visible = false; } // under the cowl
        else { o.material = new THREE.MeshStandardMaterial({ map: hair, color: 0x241a14, roughness: 0.85, metalness: 0 }); o.visible = false; } // brows sit under the hood; the heavy mesh read as a scowl
      });
      if (bodyMesh) dressCoat(bodyMesh, cloth);
      root.scale.set(0.94, 1, 0.94); // a touch slimmer than the pack's hero proportions
      return root;
    } catch (e) { console.warn("[street] operative failed:", (e as Error)?.message ?? e); return null; }
  })();
  return operativeLoading[build]!;
}

/**
 * The coat and the hood are shells of the body itself: the torso, sleeves and thighs pushed out from
 * the skin along their normals, with the front split open, a standing collar and a hem that flares
 * from the hips; the hood is the head pushed out with the face cut away. Each shell keeps the body's
 * own skin indices and weights, so it is bound to the same skeleton and moves with every bone.
 */
function shellOf(body: THREE.SkinnedMesh, keep: (p: THREE.Vector3) => boolean, offset: (p: THREE.Vector3) => number, material: THREE.Material, shift?: (p: THREE.Vector3) => [number, number, number], floorY?: number): THREE.SkinnedMesh {
  const g = body.geometry;
  const pos = g.attributes.position, nor = g.attributes.normal, idx = g.index!;
  const n = pos.count, out = new Float32Array(n * 3), ok = new Uint8Array(n);
  const p = new THREE.Vector3(), nn = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    p.fromBufferAttribute(pos, i); nn.fromBufferAttribute(nor, i);
    ok[i] = keep(p) ? 1 : 0;
    const o = offset(p); const sh = shift ? shift(p) : [0, 0, 0];
    out[i * 3] = p.x + nn.x * o + sh[0]; out[i * 3 + 1] = Math.max(floorY ?? -Infinity, p.y + nn.y * o + sh[1]); out[i * 3 + 2] = p.z + nn.z * o + sh[2]; // a floor gives a clean level hem
  }
  const tris: number[] = [];
  for (let t = 0; t < idx.count; t += 3) { const a = idx.getX(t), b = idx.getX(t + 1), c = idx.getX(t + 2); if (ok[a] && ok[b] && ok[c]) tris.push(a, b, c); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(out, 3));
  geo.setAttribute("normal", nor.clone());
  geo.setAttribute("uv", g.attributes.uv.clone());
  geo.setAttribute("skinIndex", g.attributes.skinIndex.clone());
  geo.setAttribute("skinWeight", g.attributes.skinWeight.clone());
  geo.setIndex(tris);
  const m = new THREE.SkinnedMesh(geo, material);
  m.frustumCulled = false;
  m.position.copy(body.position); m.quaternion.copy(body.quaternion); m.scale.copy(body.scale);
  m.bind(body.skeleton, body.bindMatrix);
  return m;
}
function dressCoat(body: THREE.SkinnedMesh, cloth: THREE.Texture) {
  body.geometry.computeBoundingBox();
  const bb = body.geometry.boundingBox!;
  const H = bb.max.y, armX = bb.max.x; // the rig stands in a T-pose: arms out to ±armX
  const hem = 0.33 * H, hip = 0.52 * H, waist = 0.6 * H, shoulder = 0.86 * H, chin = 0.885 * H, lips = 0.922 * H;
  const mat = new THREE.MeshStandardMaterial({ map: cloth, color: 0xffffff, roughness: 0.62, metalness: 0.1, emissive: 0x0b0e12, emissiveIntensity: 0.45, side: THREE.DoubleSide });
  // Tailored: a few millimetres off the suit through the waist and hips, sleeves close, a wide open
  // front down the chest, mid-thigh hem with just a little swing below the hips, a short standing collar.
  const coat = shellOf(body,
    (p) => p.y >= hem - 0.07 && p.y <= shoulder && Math.abs(p.x) <= armX * 0.8 && !(p.z > 0.02 && p.y > hip && Math.abs(p.x) < (p.y > waist ? 0.05 : 0.03)),
    (p) => 0.007 + Math.max(0, hip - p.y) * 0.03 + (p.y > shoulder - 0.05 ? 0.01 : 0),
    mat, undefined, hem);
  // A deep peaked cowl: the head is covered down to just above the lips, the front edge pushed forward
  // into a beak so eyes and nose sit in darkness; only the mouth and chin show beneath.
  const hood = shellOf(body,
    (p) => p.y >= chin && !(p.z > 0.012 && p.y < lips && Math.abs(p.x) < 0.1),
    (p) => (p.y >= lips ? 0.024 : 0.014),
    mat,
    (p) => {
      if (p.z < -0.03 || p.y < lips - 0.01) return [0, 0, 0];
      const t = Math.max(0, 1 - (p.y - lips) / (H - lips)); // 1 at the lip line, 0 at the crown
      const front = Math.max(0, Math.min(1, (p.z + 0.03) / 0.12)); // only the forward-facing part of the head
      const k = Math.pow(t, 1.6) * front;
      return [0, -0.018 * k, 0.06 * k];
    });
  body.parent!.add(coat, hood);
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
  const pos: number[] = [], uv: number[] = [];
  let along = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const p = pts[i], q = pts[i + 1];
    const dx = q.x - p.x, dz = q.z - p.z, len = Math.hypot(dx, dz) || 1;
    const nx = (-dz / len) * (width / 2), nz = (dx / len) * (width / 2);
    const a0 = along, a1 = along + len; along = a1;
    pos.push(p.x + nx, y, p.z + nz, q.x + nx, y, q.z + nz, q.x - nx, y, q.z - nz, p.x + nx, y, p.z + nz, q.x - nx, y, q.z - nz, p.x - nx, y, p.z - nz);
    uv.push(0, a0, 0, a1, 1, a1, 0, a0, 1, a1, 1, a0);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  return geo;
}

function clearGroup(g: THREE.Group) {
  for (const o of [...g.children]) { g.remove(o); (o as any).geometry?.dispose?.(); const m = (o as any).material; if (m) (Array.isArray(m) ? m : [m]).forEach((x: any) => x.dispose?.()); }
}

function buildCity(W: { origin: LL; city: THREE.Group }, scene: Scene | null) {
  clearGroup(W.city);
  if (!scene) return;
  // Extrusions carry two material groups: caps (roof) first, sides second. Side UVs are in metres,
  // so one window tile per 16 m across and 12.8 m up gives a window every 4 m on every third floor-metre.
  const roof = new THREE.MeshStandardMaterial({ color: 0x151d24, roughness: 0.95 });
  const fallback = new THREE.MeshStandardMaterial({ color: 0x9fb0bb, map: winTex, emissive: 0xffffff, emissiveMap: winGlow, emissiveIntensity: 0.9, roughness: 0.85, metalness: 0.05 });
  winTex.repeat.set(1 / 7.2, 1 / 6); winGlow.repeat.set(1 / 7.2, 1 / 6);
  // Photographic facades: a tile is about four floors (12.8 m) tall and 12 m wide; the lit panes glow through the emissive map.
  const facade = (t: THREE.Texture, glow: number) => { t.repeat.set(1 / 12, 1 / 12.8); return new THREE.MeshStandardMaterial({ color: 0xffffff, map: t, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: glow, roughness: 0.9, metalness: 0.05 }); };
  const markWindows = (m: THREE.Mesh) => { m.userData.windows = true; return m; };
  const walls = photos ? { low: facade(photos.shophouse, 0.55), mid: facade(photos.apartment, 0.6), high: facade(photos.tower, 0.7) } : null;
  const wallFor = (h: number) => (walls ? (h < 10 ? walls.low : h < 26 ? walls.mid : walls.high) : fallback);
  const edge = new THREE.LineBasicMaterial({ color: new THREE.Color(C.cyan), transparent: true, opacity: photos ? 0.12 : 0.28 });
  for (const b of scene.buildings) {
    const pts = b.pts.map(([lat, lng]) => toLocal(W.origin, { lat, lng }));
    if (pts.length < 3) continue;
    const shape = new THREE.Shape(pts.map((p) => new THREE.Vector2(p.x, -p.z)));
    const geo = new THREE.ExtrudeGeometry(shape, { depth: b.h ?? 7, bevelEnabled: false });
    geo.rotateX(-Math.PI / 2);
    const wallMat = wallFor(b.h ?? 7);
    const mesh = new THREE.Mesh(geo, [roof, wallMat.clone()]);
    (mesh.material as THREE.Material[])[1].userData.windows = true; mesh.userData.windows = false;
    W.city.add(mesh);
    W.city.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 20), edge));
  }
  const roadMat = photos ? (() => { const t = photos.asphalt.clone(); t.needsUpdate = true; t.repeat.set(1, 1 / 8); return new THREE.MeshStandardMaterial({ color: 0x8b969d, map: t, roughness: 0.7, metalness: 0.1 }); })() : new THREE.MeshStandardMaterial({ color: 0x252f38, roughness: 1 });
  const lampPole = new THREE.MeshStandardMaterial({ color: 0x2a343c, roughness: 0.8 });
  const lampHead = new THREE.MeshBasicMaterial({ color: 0xffc46a });
  const lampPool = new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.09, depthWrite: false });
  const kerbMat = new THREE.MeshStandardMaterial({ color: 0x3a4650, roughness: 1 });
  const pathMat = new THREE.MeshStandardMaterial({ color: 0x33414a, roughness: 1 });
  const laneMat = new THREE.MeshBasicMaterial({ color: 0x6d7f8a, transparent: true, opacity: 0.35 });
  for (const r of scene.roads) {
    const pts = r.pts.map(([lat, lng]) => toLocal(W.origin, { lat, lng }));
    const wdt = ROAD_WIDTH[r.kind ?? ""] ?? 4;
    if (wdt < 3) { W.city.add(new THREE.Mesh(ribbon(pts, wdt, 0.03), pathMat)); continue; }
    W.city.add(new THREE.Mesh(ribbon(pts, wdt + 2.4, 0.02), kerbMat)); // pavement either side
    W.city.add(new THREE.Mesh(ribbon(pts, wdt, 0.04), roadMat));
    if (wdt >= 6) W.city.add(new THREE.Mesh(ribbon(pts, 0.25, 0.05), laneMat)); // centre line
    // Street lamps every ~30 m along the kerb, alternating sides: a pole, a lit head, a pool of light.
    let acc = 14;
    for (let i = 0; i < pts.length - 1; i++) {
      const p = pts[i], q = pts[i + 1];
      const dx = q.x - p.x, dz = q.z - p.z, len = Math.hypot(dx, dz) || 1;
      const nx = -dz / len, nz = dx / len;
      for (let d = acc; d < len; d += 30) {
        const side = Math.floor((d + i * 7) / 30) % 2 ? 1 : -1;
        const x = p.x + (dx / len) * d + nx * side * (wdt / 2 + 0.9), z = p.z + (dz / len) * d + nz * side * (wdt / 2 + 0.9);
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 5.5, 6), lampPole); pole.position.set(x, 2.75, z);
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), lampHead); head.position.set(x - nx * side * 0.7, 5.5, z - nz * side * 0.7); head.userData.lampHead = true;
        const pool = new THREE.Mesh(new THREE.CircleGeometry(3.6, 20), lampPool.clone()); pool.userData.lampPool = true; pool.rotation.x = -Math.PI / 2; pool.position.set(x - nx * side * 1.2, 0.06, z - nz * side * 1.2);
        W.city.add(pole, head, pool);
      }
      acc = ((acc - len) % 30 + 30) % 30;
    }
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
    routeTex.repeat.set(1, 1 / 4);
    W.live.add(new THREE.Mesh(ribbon(pts, 1.3, 0.12), new THREE.MeshBasicMaterial({ map: routeTex, transparent: true, opacity: 0.75, depthWrite: false })));
    W.live.add(new THREE.Mesh(ribbon(pts, 3.6, 0.08), new THREE.MeshBasicMaterial({ color: cyan, transparent: true, opacity: 0.14, depthWrite: false })));
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
/**
 * The operative at 1.8 m: knee-length coat over dark trousers, shoulders, a brimmed hat, a lit
 * device in the right hand, the agency colour on the lapel and the ground ring. Limbs pivot at
 * hip and shoulder so the walk reads as a walk; a run leans the whole figure in.
 */
function makeAvatar(color: string): Avatar {
  const group = new THREE.Group();
  const tint = new THREE.Color(color);
  const coat = new THREE.MeshStandardMaterial({ color: 0x1c2630, roughness: 0.75 });
  const trouser = new THREE.MeshStandardMaterial({ color: 0x10171d, roughness: 0.9 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xc9a98a, roughness: 0.8 });
  const felt = new THREE.MeshStandardMaterial({ color: 0x0c1115, roughness: 0.95 });
  const accent = new THREE.MeshStandardMaterial({ color: tint, emissive: tint, emissiveIntensity: 0.5, roughness: 0.4 });
  const glow = new THREE.MeshBasicMaterial({ color: tint });

  // legs: pivot at the hip (y 0.92), shaft hangs below
  const mkLeg = (x: number) => { const g = new THREE.Group(); g.position.set(x, 0.92, 0); const m = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.07, 0.88, 10), trouser); m.position.y = -0.44; const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.08, 0.3), felt); shoe.position.set(0, -0.88, 0.06); g.add(m, shoe); return g; };
  const legL = mkLeg(-0.12), legR = mkLeg(0.12);
  // coat: tapered, hem at the knee, slight flare; belt and lapel strip
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.4, 1.0, 16), coat); body.position.y = 1.3;
  const chest = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.3, 0.3, 16), coat); chest.position.y = 1.78;
  const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.335, 0.335, 0.06, 16), felt); belt.position.y = 1.12;
  const lapel = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.42, 0.04), accent); lapel.position.set(-0.1, 1.62, 0.33);
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.06, 8, 18), coat); collar.rotation.x = Math.PI / 2; collar.position.y = 1.9;
  // shoulders and arms: pivot at the shoulder (y 1.86)
  const mkArm = (x: number, withDevice: boolean) => { const g = new THREE.Group(); g.position.set(x, 1.86, 0); const sh = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), coat); const m = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.065, 0.72, 10), coat); m.position.y = -0.38; const hand = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), skin); hand.position.y = -0.78; g.add(sh, m, hand); if (withDevice) { const dev = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.12, 0.02), glow); dev.position.set(0, -0.8, 0.07); g.add(dev); } return g; };
  const armL = mkArm(-0.38, false), armR = mkArm(0.38, true);
  // head and hat
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.1, 8), skin); neck.position.y = 1.96;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 14, 12), skin); head.position.y = 2.1; head.scale.set(1, 1.12, 1);
  const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 0.16, 16), felt); crown.position.y = 2.27;
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.31, 0.31, 0.025, 20), felt); brim.position.y = 2.195; brim.rotation.x = 0.06;
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.152, 0.162, 0.04, 16), accent); band.position.y = 2.215;
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.62, 40), new THREE.MeshBasicMaterial({ color: tint, transparent: true, opacity: 0.7, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.03; ring.userData.keep = true;
  const figure = new THREE.Group();
  figure.add(legL, legR, body, chest, belt, lapel, collar, armL, armR, neck, head, crown, brim, band);
  group.add(figure, ring);
  return {
    group,
    step: (phase, speed) => {
      const amp = speed < 0.3 ? 0 : speed > 2.4 ? 0.95 : 0.6;
      legL.rotation.x = Math.sin(phase) * amp; legR.rotation.x = -Math.sin(phase) * amp;
      armL.rotation.x = -Math.sin(phase) * amp * 0.7; armR.rotation.x = Math.sin(phase) * amp * 0.7;
      armL.rotation.z = 0.08; armR.rotation.z = -0.08;
      figure.position.y = amp ? Math.abs(Math.sin(phase)) * (speed > 2.4 ? 0.09 : 0.035) : 0;
      figure.rotation.x = speed > 2.4 ? 0.18 : speed >= 0.3 ? 0.05 : 0;
      if (!amp) { const idle = Math.sin(Date.now() / 900) * 0.02; figure.rotation.z = idle; head.rotation.y = Math.sin(Date.now() / 2300) * 0.35; } else { figure.rotation.z = 0; head.rotation.y = 0; }
    },
  };
}

/**
 * Idle stances, as bone angles in model space (X right, Y up, Z forward; radians). Hers: hands on
 * hips, weight on one leg, a tilt through the hips and shoulders. His: arms folded, square. The
 * walk blends out of the stance as speed rises. `pose` on the scene handle overrides these live.
 */
interface Stance { armZ: number; armX: number; armY: number; foreX: number; foreY: number; foreZ: number; spineZ: number; spineX: number; chestY: number; headY: number; headZ: number; thighLZ: number; thighRZ: number; calfRX: number; hipShift: number }
const STANCES: Record<Build, Stance> = {
  f: { armZ: 0.9, armX: 0.35, armY: 0.0, foreX: 0.0, foreY: 0.0, foreZ: 1.55, spineZ: 0.05, spineX: 0.0, chestY: 0.08, headY: 0.1, headZ: -0.04, thighLZ: 0.08, thighRZ: -0.1, calfRX: -0.08, hipShift: 0.02 },
  m: { armZ: 1.4, armX: 0.42, armY: 0.0, foreX: -1.08, foreY: -1.45, foreZ: 0.0, spineZ: 0.0, spineX: 0.02, chestY: 0.08, headY: 0.06, headZ: 0.0, thighLZ: 0.05, thighRZ: -0.05, calfRX: 0.0, hipShift: 0.0 },
};

/** Replace the shape-built figure with the rigged human, keeping the ring and the hat, and drive its bones. */
function dressOperative(prev: Avatar, model: THREE.Group, color: string, build: Build): Avatar {
  const group = prev.group;
  for (const o of [...group.children]) if (!o.userData.keep) group.remove(o);
  group.add(model);
  const bone = (n: string) => model.getObjectByName(n) as THREE.Bone | undefined;
  const B = { thighL: bone("thigh_l"), thighR: bone("thigh_r"), calfL: bone("calf_l"), calfR: bone("calf_r"), armL: bone("upperarm_l"), armR: bone("upperarm_r"), foreL: bone("lowerarm_l"), foreR: bone("lowerarm_r"), spine: bone("spine_01"), chest: bone("spine_03"), neck: bone("neck_01"), head: bone("Head") };
  const rest = new Map<THREE.Object3D, THREE.Quaternion>();
  for (const b of Object.values(B)) if (b) rest.set(b, b.quaternion.clone());
  const tmpQ = new THREE.Quaternion(), pw = new THREE.Quaternion(), pinv = new THREE.Quaternion(), axis = new THREE.Vector3(), v = new THREE.Vector3();
  // Rotate a bone about a model-space axis by `angle`, whatever its local frame: local = P⁻¹ · R · P · rest.
  const turn = (b: THREE.Object3D | undefined, ax: THREE.Vector3, angle: number, first: boolean) => {
    if (!b || !b.parent) return;
    if (first) b.quaternion.copy(rest.get(b)!);
    b.parent.updateWorldMatrix(true, false);
    b.parent.getWorldQuaternion(pw); pinv.copy(pw).invert();
    axis.copy(ax).applyQuaternion(group.quaternion).normalize();
    tmpQ.setFromAxisAngle(axis, angle);
    b.quaternion.premultiply(pinv.multiply(tmpQ).multiply(pw));
  };
  const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
  // No added shapes on the body: the sculpt carries the look. Teal and violet lamps ride with the figure
  // for the two-tone rim the concept art has.
  const lampT = new THREE.PointLight(new THREE.Color(C.cyan), 4, 4.5, 1.5); lampT.position.set(-1.1, 1.9, -0.6);
  const lampV = new THREE.PointLight(0x8a3cff, 2.5, 4.5, 1.5); lampV.position.set(1.1, 1.9, -0.6);
  group.add(lampT, lampV);
  return {
    group,
    step: (phase, speed) => {
      const amp = speed < 0.3 ? 0 : speed > 2.4 ? 0.85 : 0.55;
      const t = Date.now() / 1000;
      const breathe = Math.sin(t * 1.6) * 0.015;
      group.updateMatrixWorld(true);
      // How much of the idle stance shows: all of it standing, none once walking properly.
      const P: Stance = ((globalThis as any).__street?.current?.pose as Stance | undefined) ?? STANCES[build];
      const st = Math.max(0, 1 - speed / 0.6);
      const mv = 1 - st;
      // arms: the stance when still, hanging and swinging when moving
      turn(B.armL, Z, -(1.25 * mv + P.armZ * st), true); turn(B.armL, X, -Math.sin(phase) * amp * 0.6 - P.armX * st, false); if (P.armY) turn(B.armL, Y, P.armY * st, false);
      turn(B.armR, Z, 1.25 * mv + P.armZ * st, true); turn(B.armR, X, Math.sin(phase) * amp * 0.6 - P.armX * st, false); if (P.armY) turn(B.armR, Y, -P.armY * st, false);
      turn(B.foreL, X, (-0.35 - Math.max(0, Math.sin(phase)) * amp * 0.3) * mv + P.foreX * st, true); if (P.foreY) turn(B.foreL, Y, P.foreY * st, false); if (P.foreZ) turn(B.foreL, Z, P.foreZ * st, false);
      turn(B.foreR, X, (-0.35 - Math.max(0, -Math.sin(phase)) * amp * 0.3) * mv + P.foreX * st, true); if (P.foreY) turn(B.foreR, Y, -P.foreY * st, false); if (P.foreZ) turn(B.foreR, Z, -P.foreZ * st, false);
      // legs: thigh swing and knee bends when moving; the stance's weight shift when still
      turn(B.thighL, X, Math.sin(phase) * amp, true); if (P.thighLZ) turn(B.thighL, Z, P.thighLZ * st, false); turn(B.calfL, X, -Math.max(0, -Math.sin(phase)) * amp * 1.3, true);
      turn(B.thighR, X, -Math.sin(phase) * amp, true); if (P.thighRZ) turn(B.thighR, Z, P.thighRZ * st, false); turn(B.calfR, X, -Math.max(0, Math.sin(phase)) * amp * 1.3 + P.calfRX * st, true);
      // trunk: lean into a run, the stance's tilt when still, breathe, head looks around when idle
      turn(B.spine, X, (speed > 2.4 ? 0.22 : amp ? 0.06 : 0) + P.spineX * st + breathe, true); if (P.spineZ) turn(B.spine, Z, P.spineZ * st, false);
      turn(B.chest, Y, Math.sin(phase) * amp * 0.12 + P.chestY * st, true);
      turn(B.head, Y, (amp ? 0 : Math.sin(t / 2.3) * 0.4) + P.headY * st, true); if (P.headZ) turn(B.head, Z, P.headZ * st, false);
      model.position.y = amp ? Math.abs(Math.sin(phase)) * (speed > 2.4 ? 0.07 : 0.03) : 0;
      model.position.x = P.hipShift * st;
    },
  };
}

const s = StyleSheet.create({
  top: { position: "absolute", left: 14, right: 14, top: 14, backgroundColor: "rgba(7,11,16,0.72)", borderWidth: 1, borderColor: "rgba(0,229,242,0.35)", borderRadius: 10, padding: 10 },
  bottom: { position: "absolute", left: 14, right: 14, bottom: 18, backgroundColor: "rgba(7,11,16,0.72)", borderWidth: 1, borderColor: "rgba(141,178,189,0.25)", borderRadius: 10, padding: 10 },
  eyebrow: { color: C.dim, fontFamily: F.displayMed, fontSize: 10.5, letterSpacing: 1.6 },
  title: { color: C.text, fontFamily: F.displayMed, fontSize: 22, marginTop: 2 },
  line: { color: C.cyan, fontFamily: F.typed, fontSize: 13.5, marginTop: 3 },
  recentre: { position: "absolute", right: 14, top: 128, borderWidth: 1, borderColor: "rgba(0,229,242,0.6)", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: "rgba(7,11,16,0.72)" },
  recentreText: { color: C.cyan, fontFamily: F.displayMed, fontSize: 11, letterSpacing: 1.6 },
});
