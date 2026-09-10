// Shared geometry + material caches. Same maths as the retired src/builders.js so the office
// keeps its exact look; every component draws from here instead of allocating per instance.
import * as THREE from 'three';

export const PLINTH_H = 2.6;
export const WHITE = '#F7F7F2';

const matCache = new Map();
export function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (!matCache.has(key)) {
    matCache.set(key, new THREE.MeshStandardMaterial({
      color, roughness: opts.rough ?? 0.85, metalness: opts.metal ?? 0.02,
      ...(opts.emissive ? { emissive: opts.emissive, emissiveIntensity: opts.ei ?? 1 } : {}),
      ...(opts.transparent ? { transparent: true, opacity: opts.opacity ?? 1 } : {}),
    }));
  }
  return matCache.get(key);
}
// a private (uncached) copy for meshes that re-tint on their own: floors, plinths, walkways
export function ownMat(color, opts = {}) { const m = mat(color, opts).clone(); m.userData.base = m.color.clone(); return m; }

const geoCache = new Map();
// Rounded-rectangle prism via extrusion. Origin at the centre of the base, extruded along +Y.
export function rboxGeo(w, d, h, r = 0.35) {
  const key = `${w}|${d}|${h}|${r}`;
  if (geoCache.has(key)) return geoCache.get(key);
  const s = new THREE.Shape();
  const x = -w / 2, y = -d / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + d - r); s.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
  s.lineTo(x + r, y + d); s.quadraticCurveTo(x, y + d, x, y + d - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  const g = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false, curveSegments: 6 });
  g.rotateX(-Math.PI / 2);
  geoCache.set(key, g);
  return g;
}
export function geo(kind, ...args) {
  const key = kind + '|' + args.join('|');
  if (!geoCache.has(key)) geoCache.set(key, new THREE[kind](...args));
  return geoCache.get(key);
}

// canvas → texture helper (sRGB, anisotropic)
export function canvasTexture(c, aniso = 8) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso;
  return t;
}
export function smooth(a, b, x) { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
