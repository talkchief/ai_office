// The camera rig + everything imperative the page and the scene share: the view, the fly-to
// tween, world↔screen projection, the agent runtime map R and the per-department runtime.
// Components read this on every frame through refs; the page reaches it through the handle.
import * as THREE from 'three';

export const FR = 42;                 // frustum half-height at zoom 1
export const ISO = new THREE.Vector3(1, 0.92, 1).normalize();
export const CAM_DIST = 220;
export const SR = new THREE.Vector3(1, 0, -1).normalize();   // screen-right in world space
export const FRONT = new THREE.Vector3(1, 0, 1).normalize(); // toward the camera
const UP = new THREE.Vector3(0, 1, 0);

export const rig = {
  camera: null,                 // the R3F OrthographicCamera once mounted
  view: { target: new THREE.Vector3(), zoom: 0.8, arc: 0, yaw: 0, pitch: Math.asin(0.92 / Math.hypot(1, 0.92, 1)) }, // yaw / pitch: the owner's free turn and tilt of the office
  tween: null, yawTween: null,
  minZoom: 0.72, maxZoom: 5.2,
  overview: { base: [-9, 0, -9], zoom: 0.8 },
  panelWidth: () => 400,         // the task panel owns the right edge; the page tells us how wide
  focusDim: 0, focusDimTarget: 0,
  R: {},                         // agent id → runtime (seat, person ref, state, pill…)
  deptRT: {},                    // dept key → { L, group, badge, gate, brainGate… }
  hud: null,
  DEMO: false,
  size: { w: innerWidth, h: innerHeight },
};

const isoWork = new THREE.Vector3();
export function applyCamera(cam = rig.camera) {
  if (!cam) return;
  const { w, h } = rig.size;
  const aspect = w / h;
  cam.left = -FR * aspect; cam.right = FR * aspect; cam.top = FR; cam.bottom = -FR;
  cam.zoom = rig.view.zoom;
  // the view direction from the turn (yaw + the fly-in swing) and the tilt (pitch): the classic iso is yaw 0, pitch ≈ 33°
  const az = Math.PI / 4 - (rig.view.arc + rig.view.yaw), pitch = Math.max(0.12, Math.min(1.52, rig.view.pitch));
  isoWork.set(Math.cos(pitch) * Math.cos(az), Math.sin(pitch), Math.cos(pitch) * Math.sin(az));
  cam.position.copy(rig.view.target).addScaledVector(isoWork, CAM_DIST);
  cam.lookAt(rig.view.target);
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld();
}

// house easing cubic-bezier(0.2, 0.8, 0.2, 1)
export function bezier(t) {
  const cx = 3 * 0.2, bx = 3 * (0.2 - 0.2) - cx, ax = 1 - cx - bx;
  const cy = 3 * 0.8, by = 3 * (1 - 0.8) - cy, ay = 1 - cy - by;
  let u = t;
  for (let i = 0; i < 5; i++) {
    const x = ((ax * u + bx) * u + cx) * u - t;
    const dx = (3 * ax * u + 2 * bx) * u + cx;
    if (Math.abs(dx) < 1e-6) break;
    u -= x / dx;
  }
  return ((ay * u + by) * u + cy) * u;
}
export function flyTo(targetPos, zoom, dur = 800, opts = {}) {
  rig.tween = {
    t0: performance.now(), dur,
    fromT: rig.view.target.clone(), toT: new THREE.Vector3(...targetPos),
    fromZ: rig.view.zoom, toZ: zoom, arc: opts.arc || 0, onDone: opts.onDone,
  };
}
export function screenRight(out = new THREE.Vector3()) { return out.copy(SR).applyAxisAngle(UP, rig.view.yaw); }
export function rotateTo(yaw, dur = 600, pitch = null) { rig.yawTween = { t0: performance.now(), dur, from: rig.view.yaw, to: yaw, fromP: rig.view.pitch, toP: pitch == null ? rig.view.pitch : pitch }; }
export function tickTween(now) {
  const yt = rig.yawTween;
  if (yt) { const k = Math.min(1, (now - yt.t0) / yt.dur); const e = bezier(k); rig.view.yaw = yt.from + (yt.to - yt.from) * e; rig.view.pitch = yt.fromP + (yt.toP - yt.fromP) * e; if (k >= 1) rig.yawTween = null; }
  const tw = rig.tween; if (!tw) return;
  const k = Math.min(1, (now - tw.t0) / tw.dur);
  const e = bezier(k);
  rig.view.target.lerpVectors(tw.fromT, tw.toT, e);
  rig.view.zoom = tw.fromZ + (tw.toZ - tw.fromZ) * e;
  rig.view.arc = Math.sin(e * Math.PI) * tw.arc;
  if (k >= 1) { const cb = tw.onDone; rig.view.arc = 0; rig.tween = null; if (cb) cb(); }
}
export function overviewPos() {
  const pw = rig.panelWidth() + 30;
  const ppw = rig.overview.zoom * rig.size.h / (2 * FR);
  const sh = (pw / 2) / ppw;
  const sr = screenRight(v3b);
  return [rig.overview.base[0] + sr.x * sh, 0, rig.overview.base[2] + sr.z * sh];
}

const v3 = new THREE.Vector3(), v3b = new THREE.Vector3();
export function toScreen(p) {
  v3.copy(p).project(rig.camera);
  return [(v3.x * 0.5 + 0.5) * rig.size.w, (-v3.y * 0.5 + 0.5) * rig.size.h];
}
const ray = new THREE.Raycaster();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
export function worldAt(nx, ny) {
  ray.setFromCamera(new THREE.Vector2(nx, ny), rig.camera);
  const p = new THREE.Vector3();
  return ray.ray.intersectPlane(groundPlane, p) ? p : null;
}
export function pxPerWorld() { return rig.view.zoom * rig.size.h / (2 * FR); }
