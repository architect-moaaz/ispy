import React, { useEffect, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Asset } from "expo-asset";
import { GLView, type ExpoWebGLRenderingContext } from "expo-gl";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
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
  const [demo, setDemo] = useState<number | null>(null); // tap the gait line to preview walk and run while standing
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
    sc.fog = new THREE.Fog(new THREE.Color(0x070b10), 120, 380);
    sc.add(new THREE.HemisphereLight(0x9fbfd0, 0x0a1118, 1.2));
    const sun = new THREE.DirectionalLight(0xbfdbe6, 1.1); sun.position.set(80, 140, -60); sc.add(sun);
    const rim = new THREE.DirectionalLight(new THREE.Color(C.cyan), 0.6); rim.position.set(-60, 40, 80); sc.add(rim);
    // A soft lamp that rides with the camera, so the operative reads against the dark street.
    const follow = new THREE.PointLight(0xdfe9ee, 60, 26, 1.4); sc.add(follow);
    const fill = new THREE.DirectionalLight(0xcfdde6, 0.8); sc.add(fill); sc.add(fill.target);
    const camera = new THREE.PerspectiveCamera(50, w / h, 0.3, 600);
    const origin = latest.current.scene?.center ?? { lat: latest.current.fix.lat, lng: latest.current.fix.lng };
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1600), new THREE.MeshStandardMaterial({ color: 0x0e151c, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.05; sc.add(ground);
    const grid = new THREE.GridHelper(1600, 200, 0x10262e, 0x0d1f27); grid.position.y = -0.02; sc.add(grid);
    const city = new THREE.Group(); sc.add(city);
    const live = new THREE.Group(); sc.add(live);
    const avatar = makeAvatar(latest.current.factionColor); sc.add(avatar.group);
    void loadOperative().then((model) => { const W = world.current; if (!W || !model) return; W.avatar = dressOperative(W.avatar, model, latest.current.factionColor); console.log("[street] operative ready"); });
    world.current = { gl, renderer, scene: sc, camera, origin, city, live, avatar, raf: 0 };
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
      W.avatar.group.rotation.y = Math.PI - THREE.MathUtils.degToRad(yaw); // front is +z; north is -z
      const sp = speedRef.current;
      walkPhase += dt * (sp < 0.3 ? 0 : sp > 2.4 ? 14 : 8 + sp * 2);
      W.avatar.step(walkPhase, sp);
      // Third person: three-quarter rear while moving. Stand still a couple of seconds and the camera
      // swings round the front to hold on the operative; it swings back the moment you move.
      if (sp >= 0.3) stillSince = nowT;
      const wantOrbit = nowT - stillSince > 2500 ? 1 : 0;
      orbit += (wantOrbit - orbit) * (1 - Math.exp(-dt * (wantOrbit ? 0.9 : 2.2)));
      const rad = THREE.MathUtils.degToRad(yaw) + orbit * Math.PI * 0.82;
      const dist = 7.5 - orbit * 3.2, lift = 4.2 - orbit * 2.3, side = 1.7 - orbit * 0.9;
      const back = new THREE.Vector3(-Math.sin(rad) * dist + Math.cos(rad) * side, lift, Math.cos(rad) * dist + Math.sin(rad) * side);
      W.camera.position.lerp(pos.clone().add(back), 1 - Math.exp(-dt * 2.5));
      follow.position.copy(W.camera.position).add(new THREE.Vector3(0, 2.5, 0));
      const aheadX = Math.sin(rad) * (3 - orbit * 2.6) + Math.cos(rad) * 0.5 * (1 - orbit), aheadZ = -Math.cos(rad) * (3 - orbit * 2.6) + Math.sin(rad) * 0.5 * (1 - orbit);
      W.camera.lookAt(pos.clone().add(new THREE.Vector3(aheadX, 1.3 + orbit * 0.2, aheadZ)));
      fill.position.copy(W.camera.position).add(new THREE.Vector3(0, 3, 0)); fill.target.position.copy(pos); fill.target.updateMatrixWorld();
      // The next-turn arrow bobs; beacons pulse.
      const tt = (nowT - t0) / 1000;
      routeTex.offset.y -= dt * 0.9;
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
let operativeLoading: Promise<THREE.Group | null> | null = null;
function loadOperative(): Promise<THREE.Group | null> {
  if (!operativeLoading) operativeLoading = (async () => {
    try {
      const asset = Asset.fromModule(require("../../assets/models/operative.glb"));
      await asset.downloadAsync();
      const buf = await (await fetch(asset.localUri ?? asset.uri)).arrayBuffer();
      const gltf = await new Promise<any>((res, rej) => new GLTFLoader().parse(buf, "", res, rej));
      const suit = await loadPhoto(require("../../assets/art/tex-suit.jpg"));
      suit.flipY = false; suit.repeat.set(6, 6); // tiled tactical weave; the pack's UVs are not needed
      const root: THREE.Group = gltf.scene;
      root.traverse((o: any) => {
        if (!o.isMesh) return;
        o.frustumCulled = false;
        const name: string = o.name ?? "";
        if (/Retopology/.test(name)) o.material = new THREE.MeshStandardMaterial({ map: suit, color: 0xffffff, emissive: 0x1a232c, emissiveIntensity: 0.8, roughness: 0.6, metalness: 0.15 });
        else if (/Face\.001/.test(name)) o.material = new THREE.MeshStandardMaterial({ color: 0x1a1f24, roughness: 0.3 });
        else o.material = new THREE.MeshStandardMaterial({ color: 0x0b0f13, roughness: 0.9 });
      });
      return root;
    } catch (e) { console.warn("[street] operative failed:", (e as Error)?.message ?? e); return null; }
  })();
  return operativeLoading;
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
  const walls = photos ? { low: facade(photos.shophouse, 0.55), mid: facade(photos.apartment, 0.6), high: facade(photos.tower, 0.7) } : null;
  const wallFor = (h: number) => (walls ? (h < 10 ? walls.low : h < 26 ? walls.mid : walls.high) : fallback);
  const edge = new THREE.LineBasicMaterial({ color: new THREE.Color(C.cyan), transparent: true, opacity: photos ? 0.12 : 0.28 });
  for (const b of scene.buildings) {
    const pts = b.pts.map(([lat, lng]) => toLocal(W.origin, { lat, lng }));
    if (pts.length < 3) continue;
    const shape = new THREE.Shape(pts.map((p) => new THREE.Vector2(p.x, -p.z)));
    const geo = new THREE.ExtrudeGeometry(shape, { depth: b.h ?? 7, bevelEnabled: false });
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, [roof, wallFor(b.h ?? 7)]);
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
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), lampHead); head.position.set(x - nx * side * 0.7, 5.5, z - nz * side * 0.7);
        const pool = new THREE.Mesh(new THREE.CircleGeometry(3.6, 20), lampPool); pool.rotation.x = -Math.PI / 2; pool.position.set(x - nx * side * 1.2, 0.06, z - nz * side * 1.2);
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

/** Replace the shape-built figure with the rigged human, keeping the ring and the hat, and drive its bones. */
function dressOperative(prev: Avatar, model: THREE.Group, color: string): Avatar {
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
  // The kit, placed from the bones every frame: hood and visor on the head; collar, open long coat and
  // pack on the chest; belt and pouches on the hips; straps and holster on the thighs; guards on the
  // forearms; boots on the feet. Teal and violet lamps ride with the figure for the two-tone rim.
  const tint = new THREE.Color(color);
  const cloth = new THREE.MeshStandardMaterial({ color: 0x1c252e, roughness: 0.85, emissive: 0x0c131a, emissiveIntensity: 0.6, side: THREE.DoubleSide });
  const gear = new THREE.MeshStandardMaterial({ color: 0x2a343d, roughness: 0.6, metalness: 0.3, emissive: 0x0d1319, emissiveIntensity: 0.5 });
  const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(C.cyan) });
  const accent = new THREE.MeshStandardMaterial({ color: tint, emissive: tint, emissiveIntensity: 0.7 });
  // head: hood (sphere with the face open), visor bar, neck gaiter
  const hood = new THREE.Group();
  const cowl = new THREE.Mesh(new THREE.SphereGeometry(0.17, 22, 16, Math.PI / 2 + 0.75, Math.PI * 2 - 1.5, 0, Math.PI * 0.64), cloth); cowl.scale.set(1.0, 1.18, 1.12); cowl.position.y = 0.02;
  const peak = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.2, 10), cloth); peak.position.set(0, 0.1, -0.12); peak.rotation.x = -1.0;
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.03, 0.03), glow); visor.position.set(0, 0.015, 0.135);
  const visorRim = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.05, 0.035), gear); visorRim.position.set(0, 0.015, 0.125);
  const gaiter = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.12, 14), cloth); gaiter.position.set(0, -0.14, 0.01);
  const visorLight = new THREE.PointLight(new THREE.Color(C.cyan), 1.2, 1.2, 2); visorLight.position.set(0, 0.02, 0.2);
  hood.add(cowl, peak, visorRim, visor, gaiter, visorLight); group.add(hood);
  // chest: collar, long open coat (gap at the front), straps, pack
  const coat = new THREE.Group();
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.26, 0.12, 16, 1, true, 0.5, Math.PI * 2 - 1), cloth); collar.position.y = 0.06;
  const cape = new THREE.Mesh(new THREE.SphereGeometry(0.27, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), cloth); cape.scale.set(1.0, 0.34, 0.6); cape.position.y = -0.02;
  const skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.29, 0.56, 20, 1, true, 0.42, Math.PI * 2 - 0.84), cloth); skirt.position.y = -0.62;
  const strapL = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.4, 0.015), gear); strapL.position.set(-0.11, -0.24, 0.125); strapL.rotation.z = 0.1; strapL.rotation.x = 0.12;
  const strapR = strapL.clone(); strapR.position.x = 0.11; strapR.rotation.z = -0.1;
  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.4, 0.15), gear); pack.position.set(0, -0.3, -0.24);
  const packLip = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.06, 0.16), cloth); packLip.position.set(0, -0.08, -0.24);
  const packStrap = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.03, 0.17), accent); packStrap.position.set(0, -0.3, -0.24);
  const lapel = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.3, 0.02), accent); lapel.position.set(-0.07, -0.3, 0.165);
  coat.add(collar, cape, skirt, strapL, strapR, pack, packLip, packStrap, lapel); group.add(coat);
  // hips: belt and pouches
  const belt = new THREE.Group();
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.02, 8, 28), gear); band.rotation.x = Math.PI / 2;
  const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.04, 0.03), gear); buckle.position.set(0, 0, 0.2);
  for (const [x, z, r] of [[-0.12, 0.16, 0.6], [0.12, 0.16, -0.6], [0.19, -0.06, -1.9], [-0.19, -0.06, 1.9]] as const) { const pouch = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.11, 0.05), gear); pouch.position.set(x, -0.06, z); pouch.rotation.y = r; belt.add(pouch); }
  belt.add(band, buckle); group.add(belt);
  // limbs: straps and a holster on the thighs, guards on the forearms, boots on the feet
  const mkStrap = () => { const g = new THREE.Group(); const ring = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.014, 6, 20), gear); ring.rotation.x = Math.PI / 2; g.add(ring); return g; };
  const strapTL = mkStrap(), strapTR = mkStrap();
  const holster = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 0.05), gear); holster.position.set(0.07, -0.04, 0.03); strapTR.add(holster);
  const mkGuard = () => { const g = new THREE.Group(); g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.07, 0.2, 12), gear)); return g; };
  const guardL = mkGuard(), guardR = mkGuard();
  const mkBoot = () => { const g = new THREE.Group(); const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.085, 0.2, 12), gear); shaft.position.y = 0.1; const toe = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.07, 0.27), gear); toe.position.set(0, 0.035, 0.05); g.add(shaft, toe); return g; };
  const bootL = mkBoot(), bootR = mkBoot();
  group.add(strapTL, strapTR, guardL, guardR, bootL, bootR);
  // rim lamps: teal left, violet right, both slightly behind
  const lampT = new THREE.PointLight(new THREE.Color(C.cyan), 4, 4.5, 1.5); lampT.position.set(-1.1, 1.9, -0.6);
  const lampV = new THREE.PointLight(0x8a3cff, 2.5, 4.5, 1.5); lampV.position.set(1.1, 1.9, -0.6);
  group.add(lampT, lampV);
  const hip = bone("pelvis") ?? B.spine;
  const chest = B.chest;
  const footL = bone("foot_l"), footR = bone("foot_r"), handL = bone("hand_l"), handR = bone("hand_r");
  const wa = new THREE.Vector3(), wb = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), q = new THREE.Quaternion();
  const place = (o: THREE.Object3D, a: THREE.Object3D | undefined, b: THREE.Object3D | undefined, t: number) => {
    if (!a || !b) { o.visible = false; return; }
    a.updateWorldMatrix(true, false); b.updateWorldMatrix(true, false);
    a.getWorldPosition(wa); b.getWorldPosition(wb);
    group.worldToLocal(wa); group.worldToLocal(wb);
    const dir = wb.clone().sub(wa); const len = dir.length(); dir.normalize();
    o.position.copy(wa).addScaledVector(dir, len * t);
    q.setFromUnitVectors(up, dir.clone().negate()); o.quaternion.copy(q);
  };
  return {
    group,
    step: (phase, speed) => {
      const amp = speed < 0.3 ? 0 : speed > 2.4 ? 0.85 : 0.55;
      const t = Date.now() / 1000;
      const breathe = Math.sin(t * 1.6) * 0.015;
      group.updateMatrixWorld(true);
      // arms down from the T-pose, then swing; a little bend at the elbow
      turn(B.armL, Z, -1.25, true); turn(B.armL, X, -Math.sin(phase) * amp * 0.6, false);
      turn(B.armR, Z, 1.25, true); turn(B.armR, X, Math.sin(phase) * amp * 0.6, false);
      turn(B.foreL, X, -0.35 - Math.max(0, Math.sin(phase)) * amp * 0.3, true);
      turn(B.foreR, X, -0.35 - Math.max(0, -Math.sin(phase)) * amp * 0.3, true);
      // legs: thigh swing, knee bends on the trailing leg
      turn(B.thighL, X, Math.sin(phase) * amp, true); turn(B.calfL, X, -Math.max(0, -Math.sin(phase)) * amp * 1.3, true);
      turn(B.thighR, X, -Math.sin(phase) * amp, true); turn(B.calfR, X, -Math.max(0, Math.sin(phase)) * amp * 1.3, true);
      // trunk: lean into a run, breathe when still, head looks around when idle
      turn(B.spine, X, (speed > 2.4 ? 0.22 : amp ? 0.06 : 0) + breathe, true);
      turn(B.chest, Y, Math.sin(phase) * amp * 0.12, true);
      turn(B.head, Y, amp ? 0 : Math.sin(t / 2.3) * 0.4, true);
      model.position.y = amp ? Math.abs(Math.sin(phase)) * (speed > 2.4 ? 0.07 : 0.03) : 0;
      if (B.head) { B.head.updateWorldMatrix(true, false); B.head.getWorldPosition(v); group.worldToLocal(v); hood.position.copy(v).add(new THREE.Vector3(0, 0.06, 0)); hood.rotation.y = B.head.rotation.y; }
      if (hip && chest) {
        hip.updateWorldMatrix(true, false); hip.getWorldPosition(v); group.worldToLocal(v); const hy = v.y;
        chest.updateWorldMatrix(true, false); chest.getWorldPosition(v); group.worldToLocal(v); const cy = v.y;
        coat.position.set(0, cy + 0.2, 0); skirt.position.y = hy - 0.3 - (cy + 0.2);
        coat.rotation.x = speed > 2.4 ? 0.18 : amp ? 0.05 : 0;
        belt.position.set(0, hy + 0.02, 0);
      }
      place(strapTL, B.thighL, B.calfL, 0.55); place(strapTR, B.thighR, B.calfR, 0.55);
      place(guardL, B.foreL, handL, 0.5); place(guardR, B.foreR, handR, 0.5);
      if (footL) { footL.updateWorldMatrix(true, false); footL.getWorldPosition(v); group.worldToLocal(v); bootL.position.set(v.x, 0, v.z); }
      if (footR) { footR.updateWorldMatrix(true, false); footR.getWorldPosition(v); group.worldToLocal(v); bootR.position.set(v.x, 0, v.z); }
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
