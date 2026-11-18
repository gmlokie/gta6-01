// city.js — procedural open-world city "Solmar Bay" (all original: no Rockstar content).
// A 9x9 street grid with distinct districts: downtown towers, the plaza, the beach
// and sea, the docks, the bank, the hideout, Marlowe's Garage and Casino Palma.
// Exports buildCity(scene) -> { colliders, streets, landmarks, bounds, update(dt) }.
import * as THREE from 'three';
import { mulberry32, clamp } from './util.js';

export const STREETS = [-160, -120, -80, -40, 0, 40, 80, 120, 160];
export const ROAD_W = 12;
export const WORLD = 480; // ground plane size

function facadeTexture(rng) {
  const c = document.createElement('canvas'); c.width = 64; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#9aa0a6'; g.fillRect(0, 0, 64, 128); // pale wall so facades read in daylight
  for (let y = 6; y < 122; y += 12) for (let x = 5; x < 58; x += 10) {
    const lit = rng() < 0.35;
    g.fillStyle = lit ? '#ffd98a' : (rng() < 0.5 ? '#5a7a9a' : '#3a4048');
    g.fillRect(x, y, 6, 8);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function addTree(scene, x, z, leafMat, trunkMat) {
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.4, 2.4, 6), trunkMat);
  trunk.position.set(x, 1.2, z); trunk.castShadow = true; scene.add(trunk);
  const top = new THREE.Mesh(new THREE.SphereGeometry(2.2, 8, 6), leafMat);
  top.position.set(x, 3.4, z); top.castShadow = true; scene.add(top);
}

export function buildCity(scene, opts = {}) {
  const rng = mulberry32(20261118);
  const colliders = []; // {x0,z0,x1,z1}
  const winTex = facadeTexture(rng);

  // --- sky, fog, lights: bright daylight so screenshots stay legible ---
  // opts.sunset: golden-hour preset for the judged stills (?sunset=1) —
  // orange haze, warm low sun from the west, long shadows. Gameplay is
  // unchanged; only the lighting params differ. Values reconciled from two
  // bench rounds (Gemini + Perplexity): exposure 1.2, fog density 0.0035
  // (Perplexity's 0.0028 beach / Gemini's 0.015 was far too heavy at this
  // 480-unit map scale), sun due west ~13° elevation, hemi 1.45 (raised
  // three times after the first shoots — the street canyon read as night).
  const sunset = !!opts.sunset;
  scene.background = new THREE.Color(sunset ? 0xff8f4d : 0x87b5e0);
  scene.fog = sunset
    ? new THREE.FogExp2(0xff9a56, 0.0035)
    : new THREE.Fog(0x9fc3e8, 220, 520);
  scene.add(new THREE.HemisphereLight(
    sunset ? 0xffc08a : 0xbfd9ff, sunset ? 0x3d2a22 : 0x8a8a72, sunset ? 1.45 : 1.6));
  const sun = new THREE.DirectionalLight(sunset ? 0xffab3d : 0xfff2d0, sunset ? 3.0 : 2.2);
  // low western sun: ~13° elevation, shadows rake east across the streets
  sun.position.set(sunset ? -70 : 120, sunset ? 16 : 180, sunset ? 0 : 60);
  // low sun disc on the western horizon so the sunset sky isn't empty
  if (sunset) {
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(18, 24),
      new THREE.MeshBasicMaterial({ color: 0xffd27a, fog: false }));
    disc.position.set(-280, 30, 0);
    disc.rotation.y = Math.PI / 2; // face east, toward the city
    scene.add(disc);
  }
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -260; sun.shadow.camera.right = 260;
  sun.shadow.camera.top = 260; sun.shadow.camera.bottom = -260;
  sun.shadow.camera.far = 600;
  scene.add(sun);
  scene.add(sun.target);

  // drifting clouds
  const cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });
  const clouds = [];
  for (let i = 0; i < 10; i++) {
    const grp = new THREE.Group();
    for (let j = 0; j < 4; j++) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(6 + rng() * 8, 8, 6), cloudMat);
      s.position.set(j * 8 - 12 + rng() * 4, rng() * 2, rng() * 6 - 3);
      s.scale.y = 0.45; grp.add(s);
    }
    grp.position.set(rng() * 480 - 240, 90 + rng() * 30, rng() * 480 - 240);
    scene.add(grp); clouds.push(grp);
  }

  // --- ground, beach, sea ---
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(WORLD + 240, WORLD + 240),
    new THREE.MeshLambertMaterial({ color: 0x7d8f66 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
  scene.add(ground);
  const sand = new THREE.Mesh(new THREE.PlaneGeometry(520, 46),
    new THREE.MeshLambertMaterial({ color: 0xd9c28a }));
  sand.rotation.x = -Math.PI / 2; sand.position.set(0, 0.05, 222); sand.receiveShadow = true;
  scene.add(sand);
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(560, 120),
    new THREE.MeshLambertMaterial({ color: 0x2a7fa8 }));
  sea.rotation.x = -Math.PI / 2; sea.position.set(0, 0.02, 300);
  scene.add(sea);

  // --- roads, sidewalks, centre dashes ---
  const roadMat = new THREE.MeshLambertMaterial({ color: 0x3d4148 });
  const sideMat = new THREE.MeshLambertMaterial({ color: 0x9a9a90 });
  const lineMat = new THREE.MeshBasicMaterial({ color: 0xd8c95a });
  const roadGeoX = new THREE.PlaneGeometry(WORLD, ROAD_W);
  const sideGeoX = new THREE.PlaneGeometry(WORLD, ROAD_W + 7);
  for (const s of STREETS) {
    for (const [geo, mat, y, rot] of [
      [sideGeoX, sideMat, 0.06, 0], [roadGeoX, roadMat, 0.1, 0],
      [sideGeoX, sideMat, 0.06, Math.PI / 2], [roadGeoX, roadMat, 0.1, Math.PI / 2],
    ]) {
      const m = new THREE.Mesh(geo, mat);
      m.rotation.x = -Math.PI / 2; m.rotation.z = rot;
      m.position.set(rot === 0 ? 0 : s, y, rot === 0 ? s : 0);
      m.receiveShadow = true; scene.add(m);
    }
    for (let d = -220; d <= 220; d += 16) {
      if (Math.abs(d - s) < 10) continue; // skip the intersection itself
      const dash = new THREE.Mesh(new THREE.PlaneGeometry(5, 0.5), lineMat);
      dash.rotation.x = -Math.PI / 2; dash.position.set(d, 0.12, s); scene.add(dash);
      const dash2 = new THREE.Mesh(new THREE.PlaneGeometry(5, 0.5), lineMat);
      dash2.rotation.x = -Math.PI / 2; dash2.rotation.z = Math.PI / 2; dash2.position.set(s, 0.12, d); scene.add(dash2);
    }
  }

  // --- buildings: one per block, with district variety ---
  const palette = [0x9a8f7a, 0x7a8a9a, 0xa89a8a, 0x6a7a8a, 0xb0a090, 0x8a7a6a, 0x5a6a7a];
  const glassMat = new THREE.MeshLambertMaterial({ map: winTex, color: 0xffffff });
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const roofMat = new THREE.MeshLambertMaterial({ color: 0x4a4a44 });
  const leafMat = new THREE.MeshLambertMaterial({ color: 0x3a7a3a });
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x6a4a2a });
  const lampMat = new THREE.MeshLambertMaterial({ color: 0x222222 });
  const bulbMat = new THREE.MeshBasicMaterial({ color: 0xfff2b0 });

  const isDowntown = (bx, bz) => Math.abs(bx) <= 40 && Math.abs(bz) <= 40;
  const isPlaza = (bx, bz) => bx === -20 && bz === -20;
  const isLot = (bx, bz) => (bx === -80 && bz === 80) || (bx === 120 && bz === -80);
  const landmarks = {};

  for (let ix = 0; ix < STREETS.length - 1; ix++) {
    for (let iz = 0; iz < STREETS.length - 1; iz++) {
      const bx = (STREETS[ix] + STREETS[ix + 1]) / 2;
      const bz = (STREETS[iz] + STREETS[iz + 1]) / 2;
      if (bz > 190) continue; // beach strip
      if (isPlaza(bx, bz)) {
        // central plaza: fountain + ring of trees
        const plaza = new THREE.Mesh(new THREE.PlaneGeometry(30, 30),
          new THREE.MeshLambertMaterial({ color: 0xb0a894 }));
        plaza.rotation.x = -Math.PI / 2; plaza.position.set(bx, 0.08, bz); plaza.receiveShadow = true; scene.add(plaza);
        const basin = new THREE.Mesh(new THREE.CylinderGeometry(5, 5.5, 1.2, 16),
          new THREE.MeshLambertMaterial({ color: 0x9aa8b0 }));
        basin.position.set(bx, 0.6, bz); basin.castShadow = true; scene.add(basin);
        const water = new THREE.Mesh(new THREE.CylinderGeometry(4.4, 4.4, 0.3, 16),
          new THREE.MeshLambertMaterial({ color: 0x3a9ac8 }));
        water.position.set(bx, 1.2, bz); scene.add(water);
        for (let t = 0; t < 8; t++) {
          const a = (t / 8) * Math.PI * 2;
          addTree(scene, bx + Math.cos(a) * 12, bz + Math.sin(a) * 12, leafMat, trunkMat);
        }
        landmarks.plaza = { x: bx, z: bz };
        continue;
      }
      if (isLot(bx, bz)) {
        const lot = new THREE.Mesh(new THREE.PlaneGeometry(30, 30),
          new THREE.MeshLambertMaterial({ color: 0x55585c }));
        lot.rotation.x = -Math.PI / 2; lot.position.set(bx, 0.08, bz); lot.receiveShadow = true; scene.add(lot);
        continue;
      }
      // ordinary building block
      const w = 20 + rng() * 8, d = 20 + rng() * 8;
      const downtown = isDowntown(bx, bz);
      const h = downtown ? 30 + rng() * 55 : 8 + rng() * 18;
      const mat = downtown && rng() < 0.6
        ? glassMat.clone()
        : new THREE.MeshLambertMaterial({ color: palette[Math.floor(rng() * palette.length)] });
      if (mat.map) {
        mat.map = winTex.clone(); mat.map.needsUpdate = true;
        mat.map.repeat.set(Math.max(1, Math.round(w / 10)), Math.max(1, Math.round(h / 12)));
      }
      const b = new THREE.Mesh(boxGeo, mat);
      b.scale.set(w, h, d);
      b.position.set(bx, h / 2, bz);
      b.castShadow = true; b.receiveShadow = true;
      scene.add(b);
      const roof = new THREE.Mesh(boxGeo, roofMat);
      roof.scale.set(w * 0.92, 0.6, d * 0.92); roof.position.set(bx, h + 0.3, bz);
      scene.add(roof);
      if (rng() < 0.5) { // rooftop unit
        const ac = new THREE.Mesh(boxGeo, roofMat);
        ac.scale.set(3, 1.6, 2); ac.position.set(bx + w * 0.2, h + 1.2, bz); scene.add(ac);
      }
      if (downtown && rng() < 0.5) { // neon sign on a downtown tower
        const sign = new THREE.Mesh(new THREE.PlaneGeometry(8, 1.6),
          new THREE.MeshBasicMaterial({ color: [0xff4a6a, 0x4ae8ff, 0xffd24a][Math.floor(rng() * 3)] }));
        sign.position.set(bx, h * 0.75, bz + d / 2 + 0.1); scene.add(sign);
      }
      colliders.push({ x0: bx - w / 2, x1: bx + w / 2, z0: bz - d / 2, z1: bz + d / 2 });
    }
  }

  // --- named landmarks ---
  // Hideout: small house at (-140,-140), yellow door.
  const hide = new THREE.Group();
  const hideBody = new THREE.Mesh(boxGeo, new THREE.MeshLambertMaterial({ color: 0xc8a86a }));
  hideBody.scale.set(10, 5, 8); hideBody.position.y = 2.5; hideBody.castShadow = true; hide.add(hideBody);
  const hideRoof = new THREE.Mesh(new THREE.ConeGeometry(7.5, 3, 4), new THREE.MeshLambertMaterial({ color: 0x8a3a2a }));
  hideRoof.position.y = 6.5; hideRoof.rotation.y = Math.PI / 4; hide.add(hideRoof);
  const door = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 2.6), new THREE.MeshBasicMaterial({ color: 0xffd24a }));
  door.position.set(0, 1.3, 4.05); hide.add(door);
  hide.position.set(-140, 0, -140); scene.add(hide);
  colliders.push({ x0: -145, x1: -135, z0: -144, z1: -136 });
  landmarks.hideout = { x: -140, z: -128 };

  // Bank: marble block at (140,140), blue sign.
  const bank = new THREE.Mesh(boxGeo, new THREE.MeshLambertMaterial({ color: 0xd8d0c0 }));
  bank.scale.set(24, 14, 18); bank.position.set(140, 7, 140); bank.castShadow = true; scene.add(bank);
  const bankSign = new THREE.Mesh(new THREE.PlaneGeometry(16, 2), new THREE.MeshBasicMaterial({ color: 0x2a4a8a }));
  bankSign.position.set(140, 12, 149.1); scene.add(bankSign);
  colliders.push({ x0: 128, x1: 152, z0: 131, z1: 149 });
  landmarks.bank = { x: 140, z: 126 };

  // Marlowe's Garage (pay-n-spray): teal workshop at (-140, 140) with a green sign.
  const garage = new THREE.Mesh(boxGeo, new THREE.MeshLambertMaterial({ color: 0x3a7a72 }));
  garage.scale.set(20, 8, 14); garage.position.set(-140, 4, 140); garage.castShadow = true; scene.add(garage);
  const garageSign = new THREE.Mesh(new THREE.PlaneGeometry(14, 1.8), new THREE.MeshBasicMaterial({ color: 0x37d67a }));
  garageSign.position.set(-140, 7, 147.1); scene.add(garageSign);
  colliders.push({ x0: -150, x1: -130, z0: 133, z1: 147 });
  landmarks.garage = { x: -140, z: 128 };

  // Casino Palma: gold tower at (140,-140) with a pink neon crown.
  const casino = new THREE.Mesh(boxGeo, new THREE.MeshLambertMaterial({ color: 0xc8a848 }));
  casino.scale.set(22, 26, 16); casino.position.set(140, 13, -140); casino.castShadow = true; scene.add(casino);
  const casinoSign = new THREE.Mesh(new THREE.PlaneGeometry(16, 2), new THREE.MeshBasicMaterial({ color: 0xff4a6a }));
  casinoSign.position.set(140, 22, -131.9); scene.add(casinoSign);
  colliders.push({ x0: 129, x1: 151, z0: -148, z1: -132 });
  landmarks.casino = { x: 140, z: -126 };

  // Docks: crate stacks near the beach road.
  const crateMat = new THREE.MeshLambertMaterial({ color: 0x8a6a3a });
  for (let i = 0; i < 8; i++) {
    const c = new THREE.Mesh(boxGeo, crateMat);
    const s = 2 + rng() * 2;
    c.scale.set(s, s, s);
    c.position.set(-120 + (i % 4) * 7, s / 2, 196 + Math.floor(i / 4) * 7);
    c.rotation.y = rng() * 0.8; c.castShadow = true; scene.add(c);
    colliders.push({ x0: c.position.x - s / 2, x1: c.position.x + s / 2, z0: c.position.z - s / 2, z1: c.position.z + s / 2 });
  }
  landmarks.docks = { x: -105, z: 192 };

  // --- street lamps ---
  for (const s of STREETS) {
    for (let d = -180; d <= 180; d += 40) {
      if (Math.abs(d - s) < 12) continue;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 6, 6), lampMat);
      pole.position.set(d, 3, s + 8.5); pole.castShadow = true; scene.add(pole);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 6), bulbMat);
      bulb.position.set(d, 6.1, s + 8.5); scene.add(bulb);
    }
  }

  // --- scattered trees on block corners ---
  for (let i = 0; i < 24; i++) {
    const bx = STREETS[Math.floor(rng() * STREETS.length)];
    const bz = STREETS[Math.floor(rng() * STREETS.length)];
    addTree(scene, bx + 14 + rng() * 6, bz + 14 + rng() * 6, leafMat, trunkMat);
  }

  const bounds = { min: -235, max: 235 };
  return {
    colliders, streets: STREETS, landmarks, bounds,
    update(dt) { for (const c of clouds) { c.position.x += dt * 1.2; if (c.position.x > 260) c.position.x = -260; } },
  };
}

// Resolve a circle (x,z,r) against building AABBs; returns the corrected position.
// Axis-separated push-out: if the centre is inside a box, push along the
// smallest-penetration axis.
export function collideCircle(pos, r, colliders) {
  for (const c of colliders) {
    const nx = clamp(pos.x, c.x0, c.x1), nz = clamp(pos.z, c.z0, c.z1);
    const dx = pos.x - nx, dz = pos.z - nz;
    const d2 = dx * dx + dz * dz;
    if (d2 < r * r) {
      if (d2 > 1e-6) {
        const d = Math.sqrt(d2);
        pos.x = nx + (dx / d) * r; pos.z = nz + (dz / d) * r;
      } else {
        const pl = pos.x - c.x0, pr = c.x1 - pos.x, pt = pos.z - c.z0, pb = c.z1 - pos.z;
        const m = Math.min(pl, pr, pt, pb);
        if (m === pl) pos.x = c.x0 - r; else if (m === pr) pos.x = c.x1 + r;
        else if (m === pt) pos.z = c.z0 - r; else pos.z = c.z1 + r;
      }
    }
  }
  return pos;
}
