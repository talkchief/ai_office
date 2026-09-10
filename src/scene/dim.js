// Focus dim: everything outside the focused department genuinely darkens and desaturates,
// by lerping a private twin of each material toward a grey — the same look as before, now
// driven from the store's focused key inside the frame loop.
import * as THREE from 'three';
import { rig } from './rig.js';

const dimSwapped = [];
const dimCache = new Map();
function dimTwin(m) {
  if (!dimCache.has(m.uuid)) {
    const d = m.clone();
    d.userData.baseColor = m.color.clone();
    const l = (m.color.r + m.color.g + m.color.b) / 3;
    d.userData.dimColor = new THREE.Color(l * 0.40 + 0.10, l * 0.40 + 0.10, l * 0.38 + 0.09);
    dimCache.set(m.uuid, d);
  }
  return dimCache.get(m.uuid);
}
export function applySceneDim(scene, deptKey) {
  restoreSceneDim();
  scene.traverse(o => {
    if (!(o.isMesh || o.isLine || o.isSprite) || !o.material || o.material.isShadowMaterial || !o.userData.dept) return;
    if (o.userData.dept === deptKey) return;
    if (!o.material.color) return;
    dimSwapped.push({ mesh: o, orig: o.material });
    o.material = dimTwin(o.material);
  });
}
export function restoreSceneDim() { for (const s of dimSwapped) s.mesh.material = s.orig; dimSwapped.length = 0; }
export function clearDimCache() { restoreSceneDim(); dimCache.clear(); }
export function tickDim(dt) {
  rig.focusDim += (rig.focusDimTarget - rig.focusDim) * (1 - Math.exp(-dt * 5));
  if (rig.focusDimTarget === 0 && rig.focusDim < 0.02 && dimSwapped.length) restoreSceneDim();
  for (const m of dimCache.values()) m.color.copy(m.userData.baseColor).lerp(m.userData.dimColor, rig.focusDim);
}
