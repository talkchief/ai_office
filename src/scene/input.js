// Pointer + wheel on the canvas ONLY: zoom to cursor, drag pan, click to pick. Nothing here
// touches events whose target is scrollable UI (001 FR-015), and a 4 px drag cancels a click.
import * as THREE from 'three';
import { rig, applyCamera, worldAt, flyTo } from './rig.js';
import { clamp } from './materials.js';

export function bindInput(canvas, { clickTargets, personTargets, onPerson, onDept, onEmptyDouble, onZoomChange }) {
  const ray = new THREE.Raycaster();
  const nd = e => [(e.clientX / rig.size.w) * 2 - 1, -(e.clientY / rig.size.h) * 2 + 1];
  const onWheel = (e) => {
    if (e.target !== canvas) return; // the rail, feed and dialogs scroll on their own
    e.preventDefault();
    rig.tween = null; rig.view.arc = 0;
    const [nx, ny] = nd(e);
    const before = worldAt(nx, ny);
    rig.view.zoom = clamp(rig.view.zoom * Math.exp(-e.deltaY * 0.0032), Math.min(rig.minZoom, rig.overview.zoom), rig.maxZoom);
    applyCamera();
    const after = worldAt(nx, ny);
    if (before && after) rig.view.target.add(before.sub(after));
    onZoomChange && onZoomChange(rig.view.zoom);
  };
  canvas.addEventListener('wheel', onWheel, { passive: false });
  let drag = null;
  // Touch: two fingers pinch to zoom around their midpoint; while pinching, no drag or click.
  const touches = new Map(); let pinch = null;
  const pinchOf = () => { const [a, b] = [...touches.values()]; return { d: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; };
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch') { touches.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (touches.size === 2) { pinch = pinchOf(); drag = null; return; } }
    drag = { x: e.clientX, y: e.clientY, moved: false, rotate: e.button === 2 || e.shiftKey || e.altKey };
  });
  const endTouch = e => { touches.delete(e.pointerId); if (touches.size < 2) pinch = null; };
  addEventListener('pointercancel', endTouch);
  addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch' && touches.has(e.pointerId)) {
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && touches.size === 2) {
        const now = pinchOf(), [nx, ny] = [(now.x / rig.size.w) * 2 - 1, -(now.y / rig.size.h) * 2 + 1];
        const before = worldAt(nx, ny);
        rig.tween = null; rig.view.zoom = clamp(rig.view.zoom * (now.d / Math.max(1, pinch.d)), Math.min(rig.minZoom, rig.overview.zoom), rig.maxZoom); applyCamera();
        const after = worldAt(nx, ny); if (before && after) rig.view.target.add(before.sub(after));
        pinch = now; onZoomChange && onZoomChange(rig.view.zoom); return;
      }
    }
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
    if (drag.moved && drag.rotate) { // 360°: drag sideways to walk around the office
      rig.yawTween = null; rig.view.yaw -= dx * 0.006; rig.view.pitch = Math.max(0.12, Math.min(1.52, rig.view.pitch + dy * 0.005));
      drag.x = e.clientX; drag.y = e.clientY;
      return;
    }
    if (drag.moved) {
      rig.tween = null;
      const a = worldAt((drag.x / rig.size.w) * 2 - 1, -(drag.y / rig.size.h) * 2 + 1);
      const b = worldAt((e.clientX / rig.size.w) * 2 - 1, -(e.clientY / rig.size.h) * 2 + 1);
      if (a && b) rig.view.target.add(a.sub(b));
      drag.x = e.clientX; drag.y = e.clientY;
    }
  });
  addEventListener('pointerup', (e) => {
    const wasPinch = e.pointerType === 'touch' && (pinch || touches.size >= 2); if (e.pointerType === 'touch') endTouch(e);
    if (wasPinch) { drag = null; return; }
    const wasDrag = drag && drag.moved;
    const wasRotate = drag && drag.rotate;
    drag = null;
    if (wasDrag || wasRotate) return;
    if (e.target !== canvas) return; // HTML chrome handles its own clicks
    const [nx, ny] = nd(e);
    ray.setFromCamera(new THREE.Vector2(nx, ny), rig.camera);
    const pHits = ray.intersectObjects(personTargets, false);
    if (pHits.length) { onPerson(pHits[0].object.userData.agentId); return; }
    const hits = ray.intersectObjects(clickTargets, false);
    if (hits.length) { onDept(hits[0].object.userData.dept); }
  });
  canvas.addEventListener('dblclick', (e) => {
    const [nx, ny] = nd(e);
    ray.setFromCamera(new THREE.Vector2(nx, ny), rig.camera);
    if (!ray.intersectObjects(clickTargets, false).length) onEmptyDouble();
  });
  return { zoomStep: (f, minZ) => { flyTo([rig.view.target.x, 0, rig.view.target.z], clamp(rig.view.zoom * f, Math.min(rig.minZoom, rig.overview.zoom), rig.maxZoom), 350); } };
}
