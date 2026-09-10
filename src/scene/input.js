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
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, moved: false, rotate: e.button === 2 || e.shiftKey || e.altKey }; });
  addEventListener('pointermove', (e) => {
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
