// The stylised 3D person, rebuilt for "characters are alive" (design 1i). Same big-head
// silhouette the office had, now with a neck, collar, hands, shoes, eyes and three hair
// styles; a lead wears a blazer, a chip-coloured tie and the gold pin. The rig is plain
// three.js so the sim can drive it from useFrame on refs — no React per frame.
import * as THREE from 'three';
import { mat, geo } from './materials.js';

const hash = s => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };

export function buildPerson({ id, hair, skin, chip, lead }) {
  const g = new THREE.Group();
  const S = lead ? 1.12 : 1;
  const H = hash(id || hair + skin);
  const shirtCol = lead ? '#2B3245' : chip;
  const shirt = mat(shirtCol, { rough: 0.9 });
  const collarM = mat(lead ? '#F2F2EC' : '#FFFFFF', { rough: 0.8 });
  const skinM = mat(skin, { rough: 0.7 });
  const hairM = mat(hair, { rough: 0.95 });
  const pantsM = mat(lead ? '#2A2E3A' : '#3E4048', { rough: 0.95 });
  const shoeM = mat('#26262A', { rough: 0.6, metal: 0.05 });

  // legs + shoes (legs hide while seated — the chair carries the silhouette)
  const legs = new THREE.Group();
  const legGeo = geo('CapsuleGeometry', 0.16 * S, 0.75 * S, 3, 8);
  const legL = new THREE.Mesh(legGeo, pantsM); legL.position.set(-0.2 * S, 0.6 * S, 0);
  const legR = new THREE.Mesh(legGeo, pantsM); legR.position.set(0.2 * S, 0.6 * S, 0);
  legL.castShadow = legR.castShadow = true;
  const shoeGeo = geo('BoxGeometry', 0.24 * S, 0.14 * S, 0.42 * S);
  const shoeL = new THREE.Mesh(shoeGeo, shoeM); shoeL.position.set(0, -0.44 * S, 0.06 * S); legL.add(shoeL);
  const shoeR = new THREE.Mesh(shoeGeo, shoeM); shoeR.position.set(0, -0.44 * S, 0.06 * S); legR.add(shoeR);
  legs.add(legL, legR); g.add(legs);

  // torso pivots at the hips so it can lean into the desk; breath scales it a hair
  const torsoG = new THREE.Group(); torsoG.position.y = 1.2 * S; g.add(torsoG);
  const torso = new THREE.Mesh(geo('CapsuleGeometry', 0.42 * S, 0.85 * S, 4, 12), shirt);
  torso.position.y = 0.55 * S; torso.castShadow = true; torsoG.add(torso);
  const collar = new THREE.Mesh(geo('TorusGeometry', 0.3 * S, 0.06 * S, 6, 16), collarM);
  collar.rotation.x = Math.PI / 2; collar.position.y = 1.05 * S; torsoG.add(collar);
  if (lead) {
    const lapel = new THREE.Mesh(geo('BoxGeometry', 0.22 * S, 0.62 * S, 0.06 * S), collarM);
    lapel.position.set(0, 0.7 * S, 0.41 * S); torsoG.add(lapel);
    const tie = new THREE.Mesh(geo('ConeGeometry', 0.1 * S, 0.5 * S, 4), mat(chip));
    tie.rotation.x = Math.PI; tie.position.set(0, 0.62 * S, 0.45 * S); torsoG.add(tie);
    const pin = new THREE.Mesh(geo('SphereGeometry', 0.06 * S, 8, 8), mat('#E5C158', { metal: 0.8, rough: 0.3, emissive: '#8a6d1f', ei: 0.4 }));
    pin.position.set(0.26 * S, 0.85 * S, 0.4 * S); torsoG.add(pin);
  } else {
    const badge = new THREE.Mesh(geo('BoxGeometry', 0.16 * S, 0.2 * S, 0.03 * S), mat('#FDFFF8', { rough: 0.5 }));
    badge.position.set(0.24 * S, 0.62 * S, 0.43 * S); torsoG.add(badge);
  }
  const neck = new THREE.Mesh(geo('CylinderGeometry', 0.13 * S, 0.15 * S, 0.22 * S, 10), skinM);
  neck.position.y = 1.18 * S; torsoG.add(neck);

  // arms hang from shoulder pivots on the torso; hands at the wrists
  const armGeo = geo('CapsuleGeometry', 0.155 * S, 0.62 * S, 3, 8);
  const handGeo = geo('SphereGeometry', 0.14 * S, 10, 8);
  const shL = new THREE.Group(); shL.position.set(-0.5 * S, 0.9 * S, 0);
  const shR = new THREE.Group(); shR.position.set(0.5 * S, 0.9 * S, 0);
  const armL = new THREE.Mesh(armGeo, shirt); armL.position.y = -0.42 * S; armL.castShadow = true; shL.add(armL);
  const armR = new THREE.Mesh(armGeo, shirt); armR.position.y = -0.42 * S; armR.castShadow = true; shR.add(armR);
  const handL = new THREE.Mesh(handGeo, skinM); handL.position.y = -0.82 * S; shL.add(handL);
  const handR = new THREE.Mesh(handGeo, skinM); handR.position.y = -0.82 * S; shR.add(handR);
  torsoG.add(shL, shR);

  // head pivots at the neck so it can turn, nod and glance
  const headG = new THREE.Group(); headG.position.y = 1.3 * S; torsoG.add(headG);
  const head = new THREE.Mesh(geo('SphereGeometry', 0.5 * S, 20, 16), skinM);
  head.position.y = 0.25 * S; head.castShadow = true; headG.add(head);
  const style = H % 3;
  if (style === 0) { // cap
    const hm = new THREE.Mesh(geo('SphereGeometry', 0.54 * S, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), hairM);
    hm.position.y = 0.31 * S; headG.add(hm);
  } else if (style === 1) { // side part with a fringe
    const hm = new THREE.Mesh(geo('SphereGeometry', 0.54 * S, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), hairM);
    hm.position.y = 0.33 * S; hm.rotation.z = 0.12; headG.add(hm);
    const fringe = new THREE.Mesh(geo('BoxGeometry', 0.5 * S, 0.14 * S, 0.16 * S), hairM);
    fringe.position.set(-0.08 * S, 0.5 * S, 0.42 * S); fringe.rotation.x = 0.35; headG.add(fringe);
  } else { // bun
    const hm = new THREE.Mesh(geo('SphereGeometry', 0.54 * S, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.6), hairM);
    hm.position.y = 0.3 * S; headG.add(hm);
    const bun = new THREE.Mesh(geo('SphereGeometry', 0.2 * S, 10, 8), hairM);
    bun.position.set(0, 0.62 * S, -0.34 * S); headG.add(bun);
  }
  const eyeM = mat('#1A1A1E', { rough: 0.3 });
  const eyeGeo = geo('SphereGeometry', 0.05 * S, 8, 6);
  const eyeL = new THREE.Mesh(eyeGeo, eyeM); eyeL.position.set(-0.17 * S, 0.28 * S, 0.45 * S); headG.add(eyeL);
  const eyeR = new THREE.Mesh(eyeGeo, eyeM); eyeR.position.set(0.17 * S, 0.28 * S, 0.45 * S); headG.add(eyeR);
  const earGeo = geo('SphereGeometry', 0.09 * S, 8, 6);
  const earL = new THREE.Mesh(earGeo, skinM); earL.position.set(-0.48 * S, 0.22 * S, 0); headG.add(earL);
  const earR = new THREE.Mesh(earGeo, skinM); earR.position.set(0.48 * S, 0.22 * S, 0); headG.add(earR);

  g.userData = { legs, legL, legR, shL, shR, handL, handR, torso, torsoG, headG, S, id };
  return g;
}

/* ---------- poses ----------
   The camera sees agents from BEHIND at their desks, so seated poses must read as back-view
   silhouettes; standing poses face the camera. standK 0 = seated, 1 = standing beside the desk
   (the sim lerps the position). Every target blends in with an exponential ease so a change
   of mode is a movement, never a cut. */
export function poseWork(g, mode, t, dt) {
  const u = g.userData;
  const tg = { shLx: -1.05, shLz: 0.25, shRx: -1.05, shRz: -0.25, headRx: 0.04, headRy: 0, torsoRx: 0, posY: 0.55, standK: 0, handTap: 0, breath: 1 };
  switch (mode) {
    case 'idle': // never frozen: a slow breath, a glance at the screen now and then
      tg.shLx = -0.35; tg.shLz = -0.12; tg.shRx = -0.35; tg.shRz = 0.12; tg.torsoRx = -0.05; tg.headRx = -0.02;
      tg.headRy = u.glanceK ? u.glanceDir * u.glanceK : Math.sin(t / 2800) * 0.05;
      tg.breath = 1 + 0.02 * Math.sin(t / 1600 * Math.PI * 2 / 2);
      break;
    case 'type': // visible effort: shoulders lean in, hands tap
      tg.torsoRx = 0.1;
      tg.shLx = -1.15 + Math.sin(t / 120) * 0.08;
      tg.shRx = -1.15 + Math.sin(t / 120 + Math.PI) * 0.08;
      tg.headRx = 0.1 + Math.sin(t / 420) * 0.04;
      tg.handTap = 1; tg.breath = 1;
      break;
    case 'read': // leans back off the keyboard, head tilts at the screen
      tg.shLx = -0.3; tg.shLz = -0.35; tg.shRx = -0.3; tg.shRz = 0.35; tg.torsoRx = -0.12;
      tg.headRx = 0.18 + Math.sin(t / 650) * 0.05; tg.breath = 1 + 0.015 * Math.sin(t / 800);
      break;
    case 'phone': tg.shRx = -2.3; tg.shRz = 0.55; tg.shLx = -0.4; tg.shLz = -0.2; tg.headRy = -0.18; tg.headRx = 0.05 + (Math.sin(t / 330) > 0.55 ? 0.09 : 0); break;
    case 'glance': tg.shLx = -0.9; tg.shRx = -0.9; tg.headRy = u.glanceDir || 0.55; break;
    case 'sip': tg.shRx = -2.0; tg.shRz = 0.5; tg.shLx = -0.6; tg.headRx = -0.12; break;
    case 'spin': tg.shLx = -0.7; tg.shLz = -0.55; tg.shRx = -0.7; tg.shRz = 0.55; tg.headRx = -0.05; break;
    case 'stretch': // seated stretch: arms up in a wide V, a little arch (design: rare, 0.6 s up)
      tg.shLx = -2.7; tg.shLz = -0.7; tg.shRx = -2.7; tg.shRz = 0.7; tg.headRx = -0.2; tg.torsoRx = -0.12; tg.breath = 1.03;
      break;
    case 'wave': // selected / stuck: standing, facing the camera, right arm up and waving
      tg.standK = 1; tg.posY = 0.12;
      tg.shRx = -2.7; tg.shRz = 0.5 + Math.sin(t / 150) * 0.4;
      tg.shLx = -0.25; tg.shLz = -0.2; tg.headRx = -0.05;
      break;
    case 'stand': tg.standK = 1; tg.posY = 0.12; tg.shLx = -0.15; tg.shLz = 0.15; tg.shRx = -0.15; tg.shRz = -0.15; tg.headRy = Math.sin(t / 900) * 0.12; tg.breath = 1 + 0.015 * Math.sin(t / 900); break;
    case 'cheer': tg.standK = 1; tg.posY = 0.12 + Math.abs(Math.sin(t / 150)) * 0.16; tg.shLx = -2.7; tg.shLz = -0.85 + Math.sin(t / 190) * 0.12; tg.shRx = -2.7; tg.shRz = 0.85 - Math.sin(t / 190) * 0.12; tg.headRx = -0.2; break;
    case 'slump': tg.shLx = -0.2; tg.shLz = -0.3; tg.shRx = -0.2; tg.shRz = 0.3; tg.headRx = 0.45; tg.posY = 0.5; break;
  }
  if (!u.cur) u.cur = { ...tg };
  const k = 1 - Math.exp(-(dt || 0.016) * 7);
  for (const key in tg) u.cur[key] += (tg[key] - u.cur[key]) * k;
  const c = u.cur;
  u.shL.rotation.x = c.shLx; u.shL.rotation.z = c.shLz;
  u.shR.rotation.x = c.shRx; u.shR.rotation.z = c.shRz;
  u.headG.rotation.x = c.headRx; u.headG.rotation.y = c.headRy;
  u.torsoG.rotation.x = c.torsoRx;
  u.torsoG.scale.y = c.breath;
  const tap = c.handTap * 0.05;
  u.handL.position.y = (-0.82 + Math.max(0, Math.sin(t / 60)) * tap) * u.S;
  u.handR.position.y = (-0.82 + Math.max(0, Math.sin(t / 60 + Math.PI)) * tap) * u.S;
  u.legs.visible = c.standK > 0.4;
  u.legL.rotation.x = u.legR.rotation.x = 0;
  g.position.y = c.posY + Math.sin(t / (mode === 'idle' ? 1500 : 460)) * (mode === 'idle' ? 0.008 : 0.02);
}

export function posePerson(g, pose, t = 0) {
  const u = g.userData;
  u.cur = null;
  u.headG.rotation.x = 0; u.headG.rotation.y = 0; u.torsoG.rotation.x = 0; u.torsoG.scale.y = 1;
  u.handL.position.y = u.handR.position.y = -0.82 * u.S;
  if (pose === 'walk') { // leg swing 8° at 4 Hz, a 1.5 px bob, arms counter-swing
    u.legs.visible = true;
    const sw = Math.sin(t / 125);
    g.position.y = 0.12 + Math.abs(Math.cos(t / 125)) * 0.07;
    u.legL.rotation.x = sw * 0.5; u.legR.rotation.x = -sw * 0.5;
    u.shL.rotation.x = -sw * 0.42; u.shR.rotation.x = sw * 0.42;
    u.shL.rotation.z = 0.08; u.shR.rotation.z = -0.08;
    u.torsoG.rotation.x = 0.06;
  } else { // stand: idle-stand, no breath scale (design), a glance at whoever is near
    u.legs.visible = true;
    g.position.y = 0.12;
    u.legL.rotation.x = u.legR.rotation.x = 0;
    u.shL.rotation.x = -0.15 + Math.sin(t / 500) * 0.05; u.shR.rotation.x = -0.15 - Math.sin(t / 500) * 0.05;
    u.shL.rotation.z = 0.15; u.shR.rotation.z = -0.15;
    u.headG.rotation.y = Math.sin(t / 900) * 0.12;
  }
}
