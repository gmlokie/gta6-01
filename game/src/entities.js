// entities.js — cars, people, traffic AI, police AI. All procedural, all original.
// Cars are box-built models (sedan / taxi / sports / truck / police) with a name and
// a condition % shown in the HUD. Traffic follows the street grid; police chase.
import * as THREE from 'three';
import { mulberry32, clamp, lerp, angleLerp, dist2d } from './util.js';
import { STREETS, collideCircle } from './city.js';

export const CAR_MODELS = {
  sedan: { name: 'Coral Sedan', len: 4.4, wid: 2.0, h: 0.85, maxSpeed: 24, accel: 15, color: 0x8a9ab0 },
  taxi: { name: 'Bay Taxi', len: 4.4, wid: 2.0, h: 0.85, maxSpeed: 24, accel: 15, color: 0xf2c200 },
  sports: { name: 'Vortex GT', len: 4.2, wid: 2.0, h: 0.7, maxSpeed: 31, accel: 20, color: 0xd83838 },
  truck: { name: 'Hauler 6T', len: 5.6, wid: 2.3, h: 1.5, maxSpeed: 19, accel: 11, color: 0x5a7a4a },
  police: { name: 'PD Interceptor', len: 4.5, wid: 2.0, h: 0.85, maxSpeed: 28, accel: 17, color: 0x1a1a22 },
};

export function createCar(scene, type = 'sedan', colorHex = null) {
  const t = CAR_MODELS[type] || CAR_MODELS.sedan;
  const color = colorHex ?? t.color;
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshLambertMaterial({ color });
  const glassMat = new THREE.MeshLambertMaterial({ color: 0x1a2530 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(t.wid, t.h, t.len), bodyMat);
  body.position.y = 0.65; body.castShadow = true; g.add(body);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(t.wid * 0.85, 0.6, t.len * 0.45), glassMat);
  cabin.position.set(0, 1.3, -t.len * 0.08); cabin.castShadow = true; g.add(cabin);
  // wheels
  const wheelGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.3, 10);
  const wheelMat = new THREE.MeshLambertMaterial({ color: 0x141414 });
  const wheels = [];
  for (const [x, z] of [[-t.wid / 2, t.len * 0.32], [t.wid / 2, t.len * 0.32], [-t.wid / 2, -t.len * 0.32], [t.wid / 2, -t.len * 0.32]]) {
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.rotation.z = Math.PI / 2; w.position.set(x, 0.38, z); g.add(w); wheels.push(w);
  }
  // headlights / taillights
  const hl = new THREE.MeshBasicMaterial({ color: 0xfff6c0 });
  const tl = new THREE.MeshBasicMaterial({ color: 0xff2222 });
  for (const x of [-t.wid * 0.32, t.wid * 0.32]) {
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.18, 0.1), hl);
    h.position.set(x, 0.7, t.len / 2 + 0.02); g.add(h);
    const t2 = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.18, 0.1), tl);
    t2.position.set(x, 0.7, -t.len / 2 - 0.02); g.add(t2);
  }
  let lightBar = null;
  if (type === 'police') {
    lightBar = new THREE.Group();
    const r = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.5), new THREE.MeshBasicMaterial({ color: 0xff0000 }));
    r.position.x = -0.35; lightBar.add(r);
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.5), new THREE.MeshBasicMaterial({ color: 0x2266ff }));
    b.position.x = 0.35; lightBar.add(b);
    lightBar.position.set(0, 1.72, -0.1); g.add(lightBar);
  }
  if (type === 'taxi') {
    const sign = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.25, 0.4), new THREE.MeshBasicMaterial({ color: 0xffe94a }));
    sign.position.set(0, 1.72, -0.1); g.add(sign);
  }
  scene.add(g);
  const car = {
    group: g, type, modelName: t.name, spec: t, wheels, lightBar,
    x: 0, z: 0, heading: 0, speed: 0, steer: 0,
    condition: 100, // wear: drops on hard hits, restored at the garage
    radius: Math.max(t.len, t.wid) * 0.55,
    isPlayer: false, isPolice: type === 'police', isTraffic: false,
    flashT: 0,
  };
  car.sync = () => {
    g.position.set(car.x, 0, car.z);
    g.rotation.y = car.heading;
    for (const w of wheels) w.rotation.x += car.speed * 0.016;
    if (lightBar) {
      car.flashT += 0.016;
      const on = Math.floor(car.flashT * 6) % 2 === 0;
      lightBar.children[0].material.color.setHex(on ? 0xff0000 : 0x550000);
      lightBar.children[1].material.color.setHex(on ? 0x113366 : 0x2266ff);
    }
  };
  return car;
}

// ---- people ----
const SHIRTS = [0xd85050, 0x5080d8, 0x50b060, 0xe8c850, 0xb050a0, 0x50c8c8, 0xe8e8e8, 0x384048];
export function createPerson(scene, opts = {}) {
  const rng = opts.rng || Math.random;
  const g = new THREE.Group();
  const shirt = opts.shirt ?? SHIRTS[Math.floor(rng() * SHIRTS.length)];
  const skin = opts.skin ?? [0xe8b890, 0xc89060, 0x8a5a38][Math.floor(rng() * 3)];
  const pants = opts.pants ?? 0x2a3548;
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.72, 0.34), new THREE.MeshLambertMaterial({ color: shirt }));
  torso.position.y = 1.08; torso.castShadow = true; g.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 8), new THREE.MeshLambertMaterial({ color: skin }));
  head.position.y = 1.66; head.castShadow = true; g.add(head);
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.25, 10, 6, 0, Math.PI * 2, 0, 1.4), new THREE.MeshLambertMaterial({ color: opts.hair ?? 0x241a12 }));
  hair.position.y = 1.72; g.add(hair);
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.72, 0.26), new THREE.MeshLambertMaterial({ color: pants }));
  legL.geometry.translate(0, -0.36, 0); legL.position.set(-0.16, 0.72, 0); g.add(legL);
  const legR = legL.clone(); legR.position.x = 0.16; g.add(legR);
  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.6, 0.2), new THREE.MeshLambertMaterial({ color: shirt }));
  armL.geometry.translate(0, -0.3, 0); armL.position.set(-0.42, 1.36, 0); g.add(armL);
  const armR = armL.clone(); armR.position.x = 0.42; g.add(armR);
  // pistol (hidden unless armed)
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.14, 0.34), new THREE.MeshLambertMaterial({ color: 0x181818 }));
  gun.position.set(0.42, 1.0, 0.2); gun.visible = false; g.add(gun);
  scene.add(g);
  const p = {
    group: g, legL, legR, armL, armR, gun,
    x: 0, z: 0, heading: 0, speed: 0, walkPhase: 0, armed: false,
    health: 100, isPed: true, flee: 0, baseSpeed: 0,
  };
  p.setArmed = (v) => { p.armed = v; gun.visible = v; };
  p.sync = (dt) => {
    g.position.set(p.x, 0, p.z);
    g.rotation.y = p.heading;
    const moving = Math.abs(p.speed) > 0.2;
    if (moving) p.walkPhase += dt * p.speed * 3.2;
    const s = moving ? Math.sin(p.walkPhase) * 0.55 : 0;
    legL.rotation.x = s; legR.rotation.x = -s;
    armL.rotation.x = p.armed ? -1.2 : -s * 0.8;
    armR.rotation.x = p.armed ? -1.2 : s * 0.8;
  };
  return p;
}

// ---- player car physics (arcade: accel / steer / handbrake drift) ----
export function updatePlayerCar(car, input, dt, colliders, others) {
  const s = car.spec;
  const fwd = input.down('KeyW') || input.down('ArrowUp');
  const back = input.down('KeyS') || input.down('ArrowDown');
  const left = input.down('KeyA') || input.down('ArrowLeft');
  const right = input.down('KeyD') || input.down('ArrowRight');
  const handbrake = input.down('Space');
  if (fwd) car.speed += s.accel * dt;
  else if (back) car.speed -= (car.speed > 0.5 ? s.accel * 1.6 : s.accel * 0.8) * dt;
  else car.speed -= Math.sign(car.speed) * Math.min(Math.abs(car.speed), 6 * dt);
  if (handbrake) car.speed -= Math.sign(car.speed) * Math.min(Math.abs(car.speed), 26 * dt);
  car.speed = clamp(car.speed, -9, s.maxSpeed);
  const steerInput = (left ? 1 : 0) - (right ? 1 : 0);
  const steerTarget = steerInput * (handbrake ? 1.15 : 0.85);
  car.steer = lerp(car.steer, steerTarget, 1 - Math.exp(-8 * dt));
  const spdFactor = clamp(Math.abs(car.speed) / s.maxSpeed, 0, 1);
  car.heading += car.steer * spdFactor * 1.9 * dt * Math.sign(car.speed || 1);
  car.x += Math.sin(car.heading) * car.speed * dt;
  car.z += Math.cos(car.heading) * car.speed * dt;
  collideCircle(car, 2.1, colliders);
  car.x = clamp(car.x, -232, 232); car.z = clamp(car.z, -232, 245);
  // car-car push (hard hits wear the car down)
  for (const o of others) {
    if (o === car) continue;
    const d = dist2d(car.x, car.z, o.x, o.z);
    const min = car.radius + o.radius - 0.4;
    if (d < min && d > 0.01) {
      const push = (min - d) / 2;
      const ux = (car.x - o.x) / d, uz = (car.z - o.z) / d;
      car.x += ux * push; car.z += uz * push;
      if (!o.isPlayer) { o.x -= ux * push; o.z -= uz * push; }
      if (Math.abs(car.speed) > 6) { car.speed *= 0.6; car.condition = Math.max(20, car.condition - 2); }
    }
  }
  car.sync();
}

// ---- traffic system: lane driving, turns at intersections, slows for cars ahead ----
// FIX vs the round-1 draft: cars also keep separation from each other at
// intersections, so two turning cars no longer overlap in the same spot.
export class TrafficSystem {
  constructor(scene) {
    this.scene = scene;
    this.rng = mulberry32(777);
    this.cars = [];
    this.types = ['sedan', 'sedan', 'taxi', 'sports', 'truck', 'sedan'];
  }
  spawn(n, near = null) {
    for (let i = 0; i < n; i++) {
      const type = this.types[Math.floor(this.rng() * this.types.length)];
      const car = createCar(this.scene, type);
      car.isTraffic = true;
      car.cruise = 2 + this.rng() * 3;
      const horizontal = this.rng() < 0.5;
      const street = STREETS[Math.floor(this.rng() * STREETS.length)];
      const along = -200 + this.rng() * 400;
      const dir = this.rng() < 0.5 ? 1 : -1;
      const lane = 3.2 * dir;
      if (horizontal) { car.x = along; car.z = street + lane; car.heading = dir > 0 ? Math.PI / 2 : -Math.PI / 2; }
      else { car.x = street - lane; car.z = along; car.heading = dir > 0 ? 0 : Math.PI; }
      car.speed = 8 + this.rng() * 4;
      car.dir = dir; car.horizontal = horizontal; car.street = street; car.turnedAt = [];
      if (near) { car.x = near.x + (this.rng() - 0.5) * 120; car.z = near.z + (this.rng() - 0.5) * 120; }
      this.cars.push(car);
      car.sync();
    }
  }
  update(dt, allCars) {
    for (const car of this.cars) {
      // slow for a car ahead on the same lane, and keep separation at intersections
      let targetSpeed = 8 + car.cruise;
      for (const o of allCars) {
        if (o === car) continue;
        const dx = o.x - car.x, dz = o.z - car.z;
        const fwd = Math.sin(car.heading) * dx + Math.cos(car.heading) * dz;
        const lat = Math.abs(Math.cos(car.heading) * dx - Math.sin(car.heading) * dz);
        if (fwd > 0 && fwd < 11 && lat < 2.6) { targetSpeed = 0; break; }
        const d = Math.hypot(dx, dz);
        if (d < 5 && fwd > -2 && fwd < 6) { targetSpeed = Math.min(targetSpeed, 3); }
      }
      car.speed = lerp(car.speed, targetSpeed, 1 - Math.exp(-2 * dt));
      car.x += Math.sin(car.heading) * car.speed * dt;
      car.z += Math.cos(car.heading) * car.speed * dt;
      // at an intersection, maybe turn onto the crossing street
      const cross = car.horizontal ? car.x : car.z;
      const nearCross = STREETS.find((s) => Math.abs(cross - s) < 2.5);
      if (nearCross !== undefined && !car.turnedAt.includes(nearCross + ':' + (car.horizontal ? 'h' : 'v'))) {
        car.turnedAt.push(nearCross + ':' + (car.horizontal ? 'h' : 'v'));
        if (car.turnedAt.length > 6) car.turnedAt.shift();
        if (this.rng() < 0.45) {
          const ndir = this.rng() < 0.5 ? 1 : -1;
          if (car.horizontal) {
            car.horizontal = false; car.street = nearCross;
            car.x = nearCross - 3.2 * ndir;
            car.heading = ndir > 0 ? 0 : Math.PI; car.dir = ndir;
          } else {
            car.horizontal = true; car.street = nearCross;
            car.z = nearCross + 3.2 * ndir;
            car.heading = ndir > 0 ? Math.PI / 2 : -Math.PI / 2; car.dir = ndir;
          }
        }
      }
      // wrap around the city edges
      if (car.x > 210 || car.x < -210 || car.z > 215 || car.z < -210) {
        car.x = -200 + this.rng() * 400; car.z = STREETS[Math.floor(this.rng() * STREETS.length)];
        car.horizontal = true; car.heading = Math.PI / 2;
      }
      car.sync();
    }
  }
}

// ---- pedestrians: sidewalk walking, flee only from a NEAR threat ----
// FIX vs the round-1 draft: the old code fled whenever the player drove fast
// anywhere (`danger` had no distance check), so peds ran from a car 200 m away.
// Now fleeing needs the threat within 25 m.
export class PedSystem {
  constructor(scene) {
    this.scene = scene; this.rng = mulberry32(4242);
    this.peds = [];
  }
  spawn(n, near = null) {
    for (let i = 0; i < n; i++) {
      const p = createPerson(this.scene, { rng: this.rng });
      const street = STREETS[Math.floor(this.rng() * STREETS.length)];
      if (this.rng() < 0.5) { p.x = -200 + this.rng() * 400; p.z = street + (this.rng() < 0.5 ? 8.5 : -8.5); }
      else { p.x = street + (this.rng() < 0.5 ? 8.5 : -8.5); p.z = -200 + this.rng() * 400; }
      if (near) { p.x = near.x + (this.rng() - 0.5) * 60; p.z = near.z + (this.rng() - 0.5) * 60; }
      p.heading = this.rng() * Math.PI * 2;
      p.baseSpeed = 1.4 + this.rng() * 1.1;
      p.speed = p.baseSpeed;
      p.wanderT = 0;
      this.peds.push(p);
    }
  }
  update(dt, player, playerCar, danger) {
    for (const p of this.peds) {
      if (!p.group.visible) continue;
      p.wanderT -= dt;
      const pd = player ? dist2d(p.x, p.z, player.x, player.z) : 999;
      const cd = playerCar ? dist2d(p.x, p.z, playerCar.x, playerCar.z) : 999;
      const nearThreat = (pd < 6 && player && player.armed) || (cd < 25 && danger) || cd < 7;
      if (nearThreat) {
        const ax = playerCar && cd < pd ? playerCar.x : (player ? player.x : p.x + 1);
        const az = playerCar && cd < pd ? playerCar.z : (player ? player.z : p.z + 1);
        p.heading = Math.atan2(p.x - ax, p.z - az);
        p.speed = 5.2; p.flee = 1.5;
      } else if (p.flee > 0) {
        p.flee -= dt; p.speed = 5.2;
      } else {
        p.speed = p.baseSpeed;
        if (p.wanderT <= 0) {
          p.wanderT = 2 + this.rng() * 4;
          p.heading += (this.rng() - 0.5) * 1.6;
        }
      }
      p.x += Math.sin(p.heading) * p.speed * dt;
      p.z += Math.cos(p.heading) * p.speed * dt;
      p.x = clamp(p.x, -230, 230); p.z = clamp(p.z, -230, 240);
      p.sync(dt);
    }
  }
}

// ---- police: chase cars that ram, on-foot officers that bust ----
export class PoliceSystem {
  constructor(scene) {
    this.scene = scene; this.rng = mulberry32(99);
    this.cars = []; this.officers = [];
  }
  wantedCount(wanted) { return Math.min(4, wanted + 1); }
  update(dt, player, playerCar, wanted, colliders, onBusted) {
    const want = this.wantedCount(wanted);
    while (this.cars.length < want && wanted > 0) {
      const car = createCar(this.scene, 'police');
      const a = this.rng() * Math.PI * 2;
      const px = playerCar ? playerCar.x : player.x, pz = playerCar ? playerCar.z : player.z;
      car.x = clamp(px + Math.sin(a) * 70, -220, 220);
      car.z = clamp(pz + Math.cos(a) * 70, -220, 220);
      car.speed = 10; this.cars.push(car); car.sync();
    }
    while (this.cars.length > want) {
      const c = this.cars.pop(); this.scene.remove(c.group);
    }
    const tx = playerCar ? playerCar.x : player.x;
    const tz = playerCar ? playerCar.z : player.z;
    for (const car of this.cars) {
      const d = dist2d(car.x, car.z, tx, tz);
      const wantHeading = Math.atan2(tx - car.x, tz - car.z);
      car.heading = angleLerp(car.heading, wantHeading, 1 - Math.exp(-2.2 * dt));
      const targetSpeed = d > 6 ? 27 : 12;
      car.speed = lerp(car.speed, targetSpeed, 1 - Math.exp(-1.5 * dt));
      car.x += Math.sin(car.heading) * car.speed * dt;
      car.z += Math.cos(car.heading) * car.speed * dt;
      collideCircle(car, 2.1, colliders);
      // ram the player car
      if (playerCar && d < 4.2) {
        playerCar.speed *= 0.94;
        playerCar.x += Math.sin(car.heading) * 12 * dt;
        playerCar.z += Math.cos(car.heading) * 12 * dt;
      }
      car.sync();
    }
    // on-foot officers when the player is on foot and wanted >= 2
    const wantOfficers = (!playerCar && wanted >= 2) ? 2 : 0;
    while (this.officers.length < wantOfficers) {
      const o = createPerson(this.scene, { shirt: 0x1a2a4a, pants: 0x1a2a4a, rng: this.rng });
      o.isOfficer = true; o.isPed = false;
      o.x = player.x + (this.rng() - 0.5) * 50; o.z = player.z + (this.rng() - 0.5) * 50;
      o.bustT = 0;
      this.officers.push(o);
    }
    while (this.officers.length > wantOfficers) {
      const o = this.officers.pop(); this.scene.remove(o.group);
    }
    for (const o of this.officers) {
      const d = dist2d(o.x, o.z, player.x, player.z);
      o.heading = Math.atan2(player.x - o.x, player.z - o.z);
      o.speed = d > 2 ? 5.6 : 0;
      o.x += Math.sin(o.heading) * o.speed * dt;
      o.z += Math.cos(o.heading) * o.speed * dt;
      if (d < 1.6) { o.bustT += dt; if (o.bustT > 1.2) onBusted(); } else o.bustT = 0;
      o.sync(dt);
    }
  }
  clear() {
    for (const c of this.cars) this.scene.remove(c.group);
    for (const o of this.officers) this.scene.remove(o.group);
    this.cars = []; this.officers = [];
  }
}
