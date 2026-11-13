import { Platform } from "react-native";
import { Accelerometer, DeviceMotion, Gyroscope, type DeviceMotionMeasurement } from "expo-sensors";

/**
 * The phone's motion sensors, read for the operative in the 3D street. GPS tells us where you are
 * every few seconds, with a few metres of noise; the accelerometer and gyroscope tell us what your
 * body is doing right now. From them:
 *
 *   steps     a step is a peak in the linear acceleration (gravity removed); each one advances the
 *             walk cycle, so the operative's feet land when yours do;
 *   cadence   steps per second, which sets walking vs running the instant you change pace and
 *             drops to zero the moment you stop, where GPS speed would drift on for a while;
 *   speed     cadence times a step length that grows with it (a stroll is ~0.7 m a step, a run ~1 m);
 *   heading   the compass, steadied by integrating the gyroscope's yaw rate between readings, so a
 *             turn shows at once instead of swinging a second later;
 *   offset    dead reckoning: each step moves an estimate east/north along the heading, and every
 *             GPS fix pulls that estimate back, so between fixes the operative keeps walking
 *             rather than waiting, and never wanders more than a few metres from the fix.
 *
 * Nothing here is required: with no sensors (the web, a desk) the state stays idle and the street
 * falls back to GPS speed and the compass alone.
 */
export interface MotionState {
  at: number; // ms of the last sensor sample; stale after ~1.5 s
  stepping: boolean; // a step landed within the last 1.2 s
  steps: number; // counted since the watch began
  lastStepAt: number;
  cadence: number; // steps per second, 0 when standing
  speed: number; // m/s from cadence and step length
  heading: number | null; // degrees clockwise from north, gyro-steadied compass
  east: number; // dead-reckoned metres east of the last GPS fix
  north: number; // and north
}

export interface MotionTracker {
  readonly state: MotionState;
  start(): void;
  stop(): void;
  /** A compass reading (from expo-location's heading watch); the gyro fills in between them. */
  feedHeading(deg: number): void;
  /** A new GPS fix landed: how far it says we moved since the last one, in metres. */
  onFix(eastM: number, northM: number): void;
}

const STALE_MS = 1500, STEP_GAP_MS = 1200, MIN_STEP_MS = 260, OFFSET_CAP_M = 20;

export function createMotionTracker(): MotionTracker {
  const st: MotionState = { at: 0, stepping: false, steps: 0, lastStepAt: 0, cadence: 0, speed: 0, heading: null, east: 0, north: 0 };
  let subs: { remove(): void }[] = [];
  let gravity = { x: 0, y: 0, z: 9.81 }; // low-passed over ~1 s: the up axis, and gravity's share when the phone has no linear-acceleration sensor
  let vLP = 0, armed = true; // the vertical bounce, lightly smoothed; armed again once it has swung below the trough line
  const intervals: number[] = [];
  let compass: number | null = null;
  let lastT = 0;

  const wrap = (d: number) => ((d + 540) % 360) - 180;
  const stepLength = (cadence: number) => Math.min(1.25, Math.max(0.55, 0.35 + 0.22 * cadence));

  const onSample = (m: DeviceMotionMeasurement) => {
    const now = Date.now();
    const first = !lastT;
    const dt = first ? 0.02 : Math.min(0.1, (now - lastT) / 1000); lastT = now;
    st.at = now;
    const g = m.accelerationIncludingGravity;
    if (g && first) gravity = { x: g.x, y: g.y, z: g.z }; // seed from the first sample: however the phone is held
    if (g) { const k = 0.02; gravity = { x: gravity.x + (g.x - gravity.x) * k, y: gravity.y + (g.y - gravity.y) * k, z: gravity.z + (g.z - gravity.z) * k }; }
    const gm = Math.hypot(gravity.x, gravity.y, gravity.z) || 1;
    // The bounce: linear acceleration along the up axis (the sensor's own when the phone has one, else
    // gravity taken off by hand). Each step is one swing of it: up through +1 m/s² after a dip below -0.5.
    const lin = m.acceleration ?? (g ? { x: g.x - gravity.x, y: g.y - gravity.y, z: g.z - gravity.z } : null);
    if (lin) {
      const v = (lin.x * gravity.x + lin.y * gravity.y + lin.z * gravity.z) / gm;
      vLP += (v - vLP) * 0.5;
      if (vLP < -0.5) armed = true;
      if (armed && vLP > 1.0 && now - st.lastStepAt > MIN_STEP_MS) {
        if (st.lastStepAt && now - st.lastStepAt < STEP_GAP_MS) { intervals.push(now - st.lastStepAt); if (intervals.length > 4) intervals.shift(); }
        st.lastStepAt = now; st.steps++; armed = false;
        const mean = intervals.length ? intervals.reduce((s, v) => s + v, 0) / intervals.length : 600;
        st.cadence = 1000 / mean;
        // Dead reckoning: this step along the current heading.
        const h = st.heading ?? compass;
        if (h != null) {
          const L = stepLength(st.cadence), r = (h * Math.PI) / 180;
          st.east += Math.sin(r) * L; st.north += Math.cos(r) * L;
          const d = Math.hypot(st.east, st.north); if (d > OFFSET_CAP_M) { st.east *= OFFSET_CAP_M / d; st.north *= OFFSET_CAP_M / d; }
        }
      }
    }
    // Standing: no step for a while.
    st.stepping = now - st.lastStepAt < STEP_GAP_MS;
    if (!st.stepping) { st.cadence = 0; intervals.length = 0; }
    st.speed = st.stepping ? st.cadence * stepLength(st.cadence) : 0;
    // Heading: integrate the yaw rate about the up axis (deg/s), then lean on the compass.
    const rr = m.rotationRate;
    if (st.heading != null && rr) {
      const yawRate = (rr.alpha * gravity.x + rr.beta * gravity.y + rr.gamma * gravity.z) / gm; // rate about the axis gravity points along
      // A positive rate about the up axis is a counter-clockwise turn seen from above, which lowers a
      // compass heading. (Derived from the right-hand rule on expo's device frame; the compass term
      // below corrects it within a second either way.)
      st.heading = (st.heading - yawRate * dt + 360) % 360;
    }
    if (compass != null) st.heading = st.heading == null ? compass : (st.heading + wrap(compass - st.heading) * 0.08 + 360) % 360;
  };

  return {
    state: st,
    start() {
      if (subs.length) return;
      (async () => {
        try {
          // The raw accelerometer (in g) and gyroscope (rad/s), which every phone has. DeviceMotion's fused
          // event is not used: on Android it only reports when the linear-acceleration, gravity and
          // rotation-vector sensors all exist, and its gravity vector comes back inverted.
          if (Platform.OS === "web") { try { await (DeviceMotion as any).requestPermissionsAsync?.(); } catch { /* not every browser asks */ } }
          if (!(await Accelerometer.isAvailableAsync())) { console.log("[motion] no accelerometer"); return; }
          const hasGyro = await Gyroscope.isAvailableAsync();
          console.log("[motion] accelerometer", hasGyro ? "+ gyroscope" : "only");
          let rate = { alpha: 0, beta: 0, gamma: 0 };
          Accelerometer.setUpdateInterval(20);
          const acc = Accelerometer.addListener((a) => onSample({
            acceleration: null, accelerationIncludingGravity: { x: a.x * 9.81, y: a.y * 9.81, z: a.z * 9.81, timestamp: a.timestamp },
            rotation: { alpha: 0, beta: 0, gamma: 0, timestamp: a.timestamp }, rotationRate: hasGyro ? { ...rate, timestamp: a.timestamp } : null, interval: 20, orientation: 0,
          }));
          subs = [acc];
          if (hasGyro) { Gyroscope.setUpdateInterval(20); subs.push(Gyroscope.addListener((g) => { rate = { alpha: g.x * 57.2958, beta: g.y * 57.2958, gamma: g.z * 57.2958 }; })); }
        } catch (e) { console.log("[motion] unavailable", String(e)); /* no sensors: the street runs on GPS alone */ }
      })();
    },
    stop() { for (const s of subs) s.remove(); subs = []; lastT = 0; st.at = 0; st.stepping = false; st.cadence = 0; st.speed = 0; st.east = st.north = 0; intervals.length = 0; },
    feedHeading(deg) { compass = deg; if (st.heading == null) st.heading = deg; },
    onFix(eastM, northM) {
      // What the fix says we moved comes off the estimate, and half of what is left is forgiven:
      // GPS wins over minutes, the steps win over seconds.
      st.east = (st.east - eastM) * 0.5; st.north = (st.north - northM) * 0.5;
    },
  };
}
