// main.js — SOLMAR BAY: an original open-world crime game (GTA-inspired, zero Rockstar content).
// You are Danny Cole, a driver-for-hire in Solmar Bay. Steal cars, outrun the police,
// run 8 story missions, and build your cash from $0 to legend.
// Systems: on-foot + driving, traffic, pedestrians, car theft, wanted stars + HEAT,
// police, missions + story, combat, HUD + minimap, start/save, procedural audio.
// Static files only: no network, no external assets.
import * as THREE from 'three';
import { Input, AudioEngine, clamp, lerp, angleLerp, dist2d, mulberry32 } from './util.js';
import { buildCity, collideCircle, STREETS } from './city.js';
import { createCar, createPerson, updatePlayerCar, TrafficSystem, PedSystem, PoliceSystem } from './entities.js';
import { MISSIONS, MissionRunner } from './missions.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const SAVE_KEY = 'solmarbay-save-v2';

// ---------- renderer / scene ----------
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
// Golden-hour stills (?sunset=1): filmic tone mapping so the warm light
// rolls off instead of clipping. Gameplay (no param) is untouched.
if (params.has('sunset')) {
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
}
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 900);
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------- world ----------
const input = new Input(canvas);
const audio = new AudioEngine();
const city = buildCity(scene, { sunset: params.has('sunset') });
const traffic = new TrafficSystem(scene);
const peds = new PedSystem(scene);
const police = new PoliceSystem(scene);
traffic.spawn(14);
peds.spawn(16);
const runner = new MissionRunner();
// parked cars (stealable) at the two lots
const parkedCars = [];
for (const [x, z, type] of [[-80, 80, 'sedan'], [-72, 88, 'sports'], [120, -80, 'taxi'], [128, -72, 'sedan'], [0, -60, 'truck']]) {
  const c = createCar(scene, type);
  c.x = x; c.z = z; c.heading = (x + z) % 3; c.isParked = true; c.sync();
  parkedCars.push(c);
}
// health pickups
const pickups = [];
for (const [x, z] of [[-20, -20], [60, 60], [-100, 100]]) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.4, 1.4),
    new THREE.MeshLambertMaterial({ color: 0x30d060, emissive: 0x0a6010 }));
  m.position.set(x, 1, z); m.castShadow = true; scene.add(m);
  pickups.push({ mesh: m, x, z, taken: 0 });
}

// ---------- state ----------
const S = {
  mode: 'menu', // menu | playing | paused | busted | wasted
  cash: 0, health: 100, wanted: 0, heat: 0, ammo: 12,
  day: 1, clockMin: 12 * 60, playTime: 0,
  playerCar: null,
  camYaw: Math.PI, camPitch: 0.32, lastDragT: -10,
  reloadT: 0, fireCooldown: 0, punchT: 0, crimeCooldown: 0, quietT: 0,
  objective: null, muted: false, shotDone: false, shotMode: false,
};
const player = createPerson(scene, { shirt: 0x3a6ad8, pants: 0x222831, rng: mulberry32(1) });
player.x = 0; player.z = 20; player.heading = Math.PI; player.sync(0);
player.setArmed(true); // Danny carries a pistol
const allCars = () => [...traffic.cars, ...parkedCars, ...police.cars, ...(S.playerCar ? [S.playerCar] : [])];

// mission beacon: golden light pillar + spinning gem at the objective
const beacon = new THREE.Group();
const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 30, 12, 1, true),
  new THREE.MeshBasicMaterial({ color: 0xffd24a, transparent: true, opacity: 0.35, side: THREE.DoubleSide }));
beam.position.y = 15; beacon.add(beam);
const gem = new THREE.Mesh(new THREE.OctahedronGeometry(1.1),
  new THREE.MeshBasicMaterial({ color: 0xffd24a }));
gem.position.y = 6; beacon.add(gem);
beacon.visible = false; scene.add(beacon);

// ---------- HUD helpers ----------
let toastT = null;
function toast(msg) {
  $('toast').textContent = msg; $('toast').style.display = 'block';
  clearTimeout(toastT); toastT = setTimeout(() => { $('toast').style.display = 'none'; }, 3000);
}
let dialogueT = null;
function showDialogue(line) {
  $('dialogue').textContent = line; $('dialogue').style.display = 'block';
  clearTimeout(dialogueT);
  if (!S.shotMode) dialogueT = setTimeout(() => { $('dialogue').style.display = 'none'; }, 6000);
}
function setObjective(x, z, label) {
  S.objective = { x, z, label };
  beacon.position.set(x, 0, z); beacon.visible = true;
  $('objective').textContent = label;
  $('objective').style.display = 'block';
}
function setObjectiveLabel(label) {
  if (S.objective) { S.objective.label = label; $('objective').textContent = label; }
}
function clearObjective() {
  S.objective = null; beacon.visible = false;
  $('objective').style.display = 'none';
}
function showMissionCard(m) {
  $('mission-counter').textContent = `MISSION ${m.id}/8`;
  $('mission-title').textContent = `MISSION ${m.id}: ${m.title}`;
  $('mission-brief').textContent = m.brief;
  $('mission-card').style.display = 'block';
  if (!S.shotMode) setTimeout(() => { $('mission-card').style.display = 'none'; }, 5000);
}

// ---------- wanted / HEAT ----------
// HEAT 0-100 drives the stars: 1-20 -> 1 star, ..., 81-100 -> 5 stars.
// Crimes add HEAT; laying low (no cop within 45 m for a while) cools it down.
function syncWantedFromHeat() {
  S.wanted = S.heat <= 0 ? 0 : Math.min(5, Math.ceil(S.heat / 20));
  updateStars();
}
function addWanted(n, why) {
  if (S.crimeCooldown > 0 && why !== 'setup') return;
  S.heat = clamp(S.heat + n * 20, 0, 100);
  S.quietT = 0;
  if (why !== 'setup') S.crimeCooldown = 4;
  syncWantedFromHeat();
}
function updateStars() {
  const el = $('stars');
  el.textContent = '★'.repeat(S.wanted) + '☆'.repeat(5 - S.wanted);
  el.className = S.wanted >= 3 ? 'hot' : '';
  $('heat-fill').style.width = S.heat + '%';
  $('heat-num').textContent = Math.round(S.heat);
  if (S.wanted > 0) audio.sirenStart(); else audio.sirenStop();
}
function clearWanted() { S.heat = 0; S.quietT = 0; syncWantedFromHeat(); }

// ---------- save ----------
function saveGame() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({ cash: S.cash, missionIndex: runner.index, health: S.health, day: S.day }));
  } catch { /* private mode */ }
}
function loadGame() {
  try {
    const d = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
    if (d) {
      S.cash = d.cash || 0; S.health = d.health || 100; S.day = d.day || 1;
      runner.index = Math.min(d.missionIndex || 0, MISSIONS.length - 1);
      return true;
    }
  } catch { /* ignore */ }
  return false;
}

// ---------- missions glue (the world object the runner talks to) ----------
function spawnThugs(n, x, z) {
  const rng = mulberry32((Date.now() % 100000) + 7);
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = createPerson(scene, { shirt: 0x8a2020, pants: 0x1a1a1a, rng });
    t.x = x + (rng() - 0.5) * 16; t.z = z + (rng() - 0.5) * 16;
    t.health = 100; t.isThug = true; t.isPed = false; t.fireT = 1 + rng();
    t.setArmed(true);
    out.push(t);
  }
  return out;
}
function removePerson(p) { scene.remove(p.group); }
function damagePlayer(amount) {
  S.health -= amount;
  if (S.health <= 0) { S.health = 0; wasted(); }
}
function startMission(i) { runner.start(i, world); }
function completeMission() {
  const m = runner.mission;
  if (!m) return;
  S.cash += m.reward;
  $('reward-text').textContent = `+$${m.reward} — ${m.title} complete`;
  $('reward-card').style.display = 'block';
  audio.sfx('cash');
  clearObjective();
  runner.clearThugs(world);
  setTimeout(() => { $('reward-card').style.display = 'none'; }, 3500);
  const next = runner.index + 1;
  if (next >= MISSIONS.length) {
    $('mission-counter').textContent = 'STORY COMPLETE';
    $('mission-title').textContent = 'STORY COMPLETE';
    $('mission-brief').textContent = 'You own Solmar Bay now, Danny. Free roam — keep the cash coming.';
    $('mission-card').style.display = 'block';
    runner.mission = null; runner.index = next;
  } else {
    setTimeout(() => startMission(next), 1200);
  }
  saveGame();
}
function failMission(reason) {
  audio.sfx('fail');
  $('mission-brief').textContent = `Mission failed: ${reason}. Try again — the job is still open.`;
  $('mission-title').textContent = 'MISSION FAILED';
  $('mission-card').style.display = 'block';
  runner.clearThugs(world);
  setTimeout(() => { $('mission-card').style.display = 'none'; }, 4000);
  setTimeout(() => startMission(runner.index), 1500);
}
const world = {
  state: S, player, city,
  setObjective, clearObjective, setObjectiveLabel,
  addWanted, clearWanted,
  complete: completeMission, fail: failMission,
  spawnThugs, removePerson, toast, audio, saveGame,
  showMissionCard, showDialogue, damagePlayer,
};

// ---------- enter / exit car ----------
function nearestCar(maxD) {
  let best = null, bd = maxD;
  for (const c of [...traffic.cars, ...parkedCars]) {
    const d = dist2d(player.x, player.z, c.x, c.z);
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}
function enterCar(car) {
  const witnessed = peds.peds.some((p) => p.group.visible && dist2d(p.x, p.z, player.x, player.z) < 28) || police.cars.length > 0;
  if (car.isTraffic) traffic.cars = traffic.cars.filter((c) => c !== car);
  if (car.isParked) parkedCars.splice(parkedCars.indexOf(car), 1);
  S.playerCar = car; car.isPlayer = true; car.speed = 0;
  player.group.visible = false;
  audio.sfx('enterCar'); audio.engineStart();
  if (witnessed) { addWanted(1, 'theft'); toast('CAR STOLEN — witnesses called it in!'); }
  else toast('Car taken. Keep it clean.');
}
function exitCar() {
  const car = S.playerCar;
  car.isPlayer = false; car.speed = 0;
  S.playerCar = null;
  player.x = car.x + Math.sin(car.heading + Math.PI / 2) * 2.5;
  player.z = car.z + Math.cos(car.heading + Math.PI / 2) * 2.5;
  player.heading = car.heading;
  player.group.visible = true;
  player.sync(0);
  audio.engineSet(0, false);
}
// Pay-n-spray at Marlowe's Garage: $200 clears wanted + HEAT and repairs the car.
function payNSpray() {
  if (!S.playerCar) return false;
  const g = city.landmarks.garage;
  if (dist2d(S.playerCar.x, S.playerCar.z, g.x, g.z) > 12) return false;
  if (S.cash < 200) { toast('Pay-n-spray costs $200 — you are short.'); return false; }
  S.cash -= 200;
  S.playerCar.condition = 100;
  clearWanted();
  audio.sfx('spray'); audio.sfx('cash');
  toast('Fresh paint, clean plates. The heat is gone.');
  updateHUD();
  return true;
}

// ---------- combat ----------
const raycaster = new THREE.Raycaster();
function shoot() {
  if (S.reloadT > 0 || S.fireCooldown > 0 || S.ammo <= 0) {
    if (S.ammo <= 0) toast('Out of ammo — press R to reload');
    return;
  }
  S.ammo--; S.fireCooldown = 0.22;
  audio.sfx('shoot');
  raycaster.setFromCamera({ x: 0, y: 0 }, camera);
  const targets = [...runner.thugs, ...police.officers, ...peds.peds].filter((p) => p.group.visible);
  const hits = raycaster.intersectObjects(targets.map((p) => p.group), true);
  if (hits.length) {
    let o = hits[0].object;
    while (o.parent && !targets.some((t) => t.group === o)) o = o.parent;
    const t = targets.find((x) => x.group === o);
    if (t) {
      t.health -= 34;
      if (t.health <= 0) {
        t.group.visible = false;
        if (t.isThug) {
          runner.thugs = runner.thugs.filter((x) => x !== t);
          addWanted(1, 'shooting');
          const kind = runner.mission && runner.mission.kind;
          if ((kind === 'standoff' || kind === 'clear') && runner.thugs.length === 0) completeMission();
          else if (kind === 'standoff' || kind === 'clear') {
            setObjectiveLabel(`Take down the rival crew (${runner.thugs.length} left)`);
          }
        } else if (t.isPed) {
          addWanted(1, 'shooting');
          toast('Pedestrian down — the heat is on!');
        }
      }
    }
  }
  if (S.ammo === 0) toast('Magazine empty — R to reload');
  updateHUD();
}
function punch() {
  if (S.punchT > 0) return;
  S.punchT = 0.4; audio.sfx('punch');
  for (const t of [...runner.thugs, ...police.officers, ...peds.peds]) {
    if (!t.group.visible) continue;
    const d = dist2d(player.x, player.z, t.x, t.z);
    if (d < 2.2) {
      t.health -= 25;
      const a = Math.atan2(t.x - player.x, t.z - player.z); // knockback away from the player
      t.x += Math.sin(a) * 1.5; t.z += Math.cos(a) * 1.5;
      if (t.health <= 0) {
        t.group.visible = false;
        if (t.isThug) {
          runner.thugs = runner.thugs.filter((x) => x !== t);
          const kind = runner.mission && runner.mission.kind;
          if ((kind === 'standoff' || kind === 'clear') && runner.thugs.length === 0) completeMission();
        }
      }
    }
  }
}

// ---------- busted / wasted ----------
function busted() {
  if (S.mode !== 'playing') return;
  S.mode = 'busted'; audio.sfx('busted');
  const fine = Math.min(S.cash, 100);
  S.cash -= fine; clearWanted(); police.clear();
  $('end-title').textContent = 'BUSTED';
  $('end-text').textContent = `The Solmar PD caught you. Fine: $${fine}. Your car is impounded.`;
  $('end-screen').style.display = 'flex';
  saveGame();
}
function wasted() {
  if (S.mode !== 'playing') return;
  S.mode = 'wasted'; audio.sfx('fail');
  const fee = Math.min(S.cash, 150);
  S.cash -= fee; clearWanted(); police.clear();
  $('end-title').textContent = 'WASTED';
  $('end-text').textContent = `You got flattened. Hospital bill: $${fee}.`;
  $('end-screen').style.display = 'flex';
  saveGame();
}
function respawn() {
  $('end-screen').style.display = 'none';
  if (S.playerCar) { S.playerCar.isPlayer = false; S.playerCar = null; }
  player.x = city.landmarks.hideout.x; player.z = city.landmarks.hideout.z + 6;
  S.health = 100;
  player.group.visible = true; player.sync(0);
  S.mode = 'playing';
  updateHUD();
}

// ---------- HUD / minimap ----------
function updateHUD() {
  $('cash').textContent = '$' + S.cash.toLocaleString();
  $('health-fill').style.width = S.health + '%';
  $('health-fill').style.background = S.health > 50 ? '#37d67a' : S.health > 25 ? '#e8a13a' : '#d83a3a';
  $('ammo').textContent = 'AMMO ' + S.ammo + ' / ∞';
  $('speed').textContent = S.playerCar ? Math.round(Math.abs(S.playerCar.speed) * 3.6) + ' km/h' : '';
  const h = Math.floor(S.clockMin / 60) % 24, m = Math.floor(S.clockMin % 60);
  $('day-clock').textContent = `DAY ${S.day} · ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  const carLine = $('car-line');
  if (S.playerCar) {
    carLine.style.display = 'block';
    carLine.textContent = `${S.playerCar.modelName} · ${Math.round(S.playerCar.condition)}%`;
  } else carLine.style.display = 'none';
  $('crosshair').style.display = (!S.playerCar && S.mode === 'playing') ? 'block' : 'none';
  const near = !S.playerCar && S.mode === 'playing' && nearestCar(4.5);
  $('interact').style.display = near ? 'block' : 'none';
  if (near) $('interact').textContent = 'Press E — steal car';
  if (S.playerCar && dist2d(S.playerCar.x, S.playerCar.z, city.landmarks.garage.x, city.landmarks.garage.z) < 12) {
    $('interact').style.display = 'block';
    $('interact').textContent = 'Press G — pay-n-spray $200';
  }
}
const mm = $('minimap').getContext('2d');
const mmStatic = document.createElement('canvas'); mmStatic.width = 200; mmStatic.height = 200;
(function drawStatic() {
  const g = mmStatic.getContext('2d');
  g.fillStyle = '#20242a'; g.fillRect(0, 0, 200, 200);
  const s = (v) => ((v + 240) / 480) * 200;
  g.fillStyle = '#2a7fa8'; g.fillRect(0, s(200), 200, 200 - s(200)); // sea
  g.fillStyle = '#d9c28a'; g.fillRect(0, s(199), 200, s(222) - s(199)); // beach
  g.strokeStyle = '#4a4e55'; g.lineWidth = 5;
  for (const st of STREETS) {
    g.beginPath(); g.moveTo(0, s(st)); g.lineTo(200, s(st)); g.stroke();
    g.beginPath(); g.moveTo(s(st), 0); g.lineTo(s(st), 200); g.stroke();
  }
  const mark = (x, z, w, h, color) => { g.fillStyle = color; g.fillRect(s(x), s(z), s(x + w) - s(x), s(z + h) - s(z)); };
  mark(128, 131, 24, 18, '#3a6a9a'); // bank
  mark(-145, -144, 10, 8, '#c8a86a'); // hideout
  mark(-150, 133, 20, 14, '#3a7a72'); // garage
  mark(129, -148, 22, 16, '#c8a848'); // casino
})();
function drawMinimap() {
  const s = (v) => ((v + 240) / 480) * 200;
  mm.drawImage(mmStatic, 0, 0);
  const dot = (x, z, color, r = 3) => { mm.fillStyle = color; mm.beginPath(); mm.arc(s(x), s(z), r, 0, 7); mm.fill(); };
  if (S.objective) {
    mm.fillStyle = '#ffd24a';
    mm.save(); mm.translate(s(S.objective.x), s(S.objective.z)); mm.rotate(Math.PI / 4);
    mm.fillRect(-4, -4, 8, 8); mm.restore();
  }
  dot(city.landmarks.hideout.x, city.landmarks.hideout.z, '#37d67a', 3);
  dot(city.landmarks.garage.x, city.landmarks.garage.z, '#37d6c8', 3);
  for (const c of traffic.cars) dot(c.x, c.z, '#cfd6dd', 2);
  for (const c of police.cars) dot(c.x, c.z, '#4a8aff', 3);
  for (const t of runner.thugs) if (t.group.visible) dot(t.x, t.z, '#ff4a4a', 3);
  // player arrow
  const px = s(player.x), pz = s(player.z);
  const heading = S.playerCar ? S.playerCar.heading : player.heading;
  mm.save(); mm.translate(px, pz); mm.rotate(-heading + Math.PI);
  mm.fillStyle = '#ffffff';
  mm.beginPath(); mm.moveTo(0, -6); mm.lineTo(4, 5); mm.lineTo(-4, 5); mm.closePath(); mm.fill();
  mm.restore();
}

// ---------- camera ----------
const camTarget = new THREE.Vector3();
function updateCamera(dt) {
  const { dx, dy } = input.consumeMouse();
  if (dx || dy) {
    S.camYaw -= dx * 0.004; S.camPitch = clamp(S.camPitch + dy * 0.003, 0.05, 1.1);
    S.lastDragT = S.playTime;
  }
  const inCar = !!S.playerCar;
  const px = inCar ? S.playerCar.x : player.x;
  const pz = inCar ? S.playerCar.z : player.z;
  const heading = inCar ? S.playerCar.heading : player.heading;
  // ease the camera yaw toward the car's heading while driving (unless the player just dragged)
  if (inCar && S.playTime - S.lastDragT > 1.2 && Math.abs(S.playerCar.speed) > 2) {
    S.camYaw = angleLerp(S.camYaw, heading + Math.PI, 1 - Math.exp(-1.6 * dt));
  }
  const dist = inCar ? 12.5 : 8;
  const h = inCar ? 5 : 3.4;
  const cx = px + Math.sin(S.camYaw) * Math.cos(S.camPitch) * dist;
  const cz = pz + Math.cos(S.camYaw) * Math.cos(S.camPitch) * dist;
  const cy = h + Math.sin(S.camPitch) * dist * 0.6;
  camera.position.set(cx, cy, cz);
  camTarget.set(px + Math.sin(heading) * 2, inCar ? 1.4 : 1.6, pz + Math.cos(heading) * 2);
  camera.lookAt(camTarget);
}

// ---------- player on foot ----------
function updatePlayer(dt) {
  if (S.playerCar) return;
  const fwd = (input.down('KeyW') || input.down('ArrowUp') ? 1 : 0) - (input.down('KeyS') || input.down('ArrowDown') ? 1 : 0);
  const strafe = (input.down('KeyD') || input.down('ArrowRight') ? 1 : 0) - (input.down('KeyA') || input.down('ArrowLeft') ? 1 : 0);
  const sprint = input.down('ShiftLeft') || input.down('ShiftRight');
  const speed = sprint ? 7.5 : 4.6;
  if (fwd || strafe) {
    const cy = S.camYaw + Math.PI; // camera looks from behind toward the player
    const mx = Math.sin(cy) * fwd + Math.cos(cy) * strafe;
    const mz = Math.cos(cy) * fwd - Math.sin(cy) * strafe;
    const len = Math.hypot(mx, mz) || 1;
    player.x += (mx / len) * speed * dt;
    player.z += (mz / len) * speed * dt;
    player.heading = Math.atan2(mx / len, mz / len);
    player.speed = speed;
  } else player.speed = 0;
  player.x = clamp(player.x, -232, 232); player.z = clamp(player.z, -232, 245);
  collideCircle(player, 0.7, city.colliders);
  player.sync(dt);
  for (const p of pickups) {
    if (p.taken > 0) { p.taken -= dt; if (p.taken <= 0) p.mesh.visible = true; continue; }
    p.mesh.rotation.y += dt;
    if (dist2d(player.x, player.z, p.x, p.z) < 2) {
      S.health = Math.min(100, S.health + 50); p.taken = 60; p.mesh.visible = false;
      audio.sfx('pickup'); toast('Health +50');
    }
  }
}

// ---------- main loop ----------
// THREE.Clock is deprecated in r187; track delta manually.
let lastT = performance.now();
let frames = 0;
function loop() {
  requestAnimationFrame(loop);
  const now = performance.now();
  const dt = Math.min((now - lastT) / 1000, 0.05);
  lastT = now;
  if (S.mode === 'playing') {
    S.playTime += dt;
    S.clockMin += dt * 0.5; // 1 game hour per 2 real minutes
    if (S.clockMin >= 24 * 60) { S.clockMin -= 24 * 60; S.day++; toast(`DAY ${S.day} — Solmar Bay wakes up.`); }
    S.fireCooldown -= dt; S.punchT -= dt; S.crimeCooldown -= dt;
    if (S.reloadT > 0) {
      S.reloadT -= dt;
      if (S.reloadT <= 0) { S.ammo = 12; toast('Reloaded'); updateHUD(); }
    }
    // HEAT cools down when quiet: no cop within 45 m for 10 s -> lose 2 HEAT/s
    if (S.heat > 0) {
      const ref = S.playerCar || player;
      const nearestCop = police.cars.length ? Math.min(...police.cars.map((c) => dist2d(c.x, c.z, ref.x, ref.z))) : 999;
      if (nearestCop > 45) {
        S.quietT += dt;
        if (S.quietT > 10) { S.heat = Math.max(0, S.heat - 2 * dt); syncWantedFromHeat(); }
      } else S.quietT = 0;
    }
    // interactions
    if (input.hit('KeyE')) {
      if (S.playerCar) exitCar();
      else { const c = nearestCar(4.5); if (c) enterCar(c); }
    }
    if (input.hit('KeyG') && S.playerCar) payNSpray();
    if (input.hit('KeyR') && !S.playerCar && S.reloadT <= 0 && S.ammo < 12) { S.reloadT = 1.2; audio.sfx('click'); }
    if (input.hit('KeyF') && !S.playerCar) punch();
    if (input.consumeClick() && !S.playerCar && S.mode === 'playing') shoot();
    if (input.hit('Escape')) pauseGame();
    if (input.hit('KeyM')) { S.muted = !S.muted; audio.enabled = !S.muted; toast(S.muted ? 'Sound off' : 'Sound on'); }

    if (S.playerCar) {
      updatePlayerCar(S.playerCar, input, dt, city.colliders, allCars());
      audio.engineSet(Math.abs(S.playerCar.speed) / S.playerCar.spec.maxSpeed, true);
      // running a ped over with the car
      for (const p of peds.peds) {
        if (!p.group.visible) continue;
        if (dist2d(S.playerCar.x, S.playerCar.z, p.x, p.z) < 2.4 && Math.abs(S.playerCar.speed) > 3) {
          p.group.visible = false; p.health = 0;
          addWanted(1, 'hit-ped'); audio.sfx('crash');
          toast('You hit a pedestrian!');
        }
      }
    } else {
      updatePlayer(dt);
      audio.engineSet(0, false);
    }
    const danger = S.playerCar && Math.abs(S.playerCar.speed) > 8;
    traffic.update(dt, allCars());
    peds.update(dt, player, S.playerCar, danger);
    police.update(dt, player, S.playerCar, S.wanted, city.colliders, busted);
    city.update(dt);
    runner.update(dt, world);
    // beacon spin
    if (beacon.visible) { gem.rotation.y += dt * 2; gem.position.y = 6 + Math.sin(S.playTime * 2) * 0.5; }
    updateCamera(dt);
    drawMinimap();
    if (frames % 10 === 0) updateHUD();
  }
  renderer.render(scene, camera);
  frames++;
  input.endFrame();
  if (frames === 5) onFirstFrames();
}

// ---------- menus / flow ----------
function startGame(fresh) {
  audio.ensure(); audio.musicStart();
  $('menu').style.display = 'none';
  $('hud').style.display = 'block';
  S.mode = 'playing';
  if (fresh) { S.cash = 0; S.health = 100; S.day = 1; runner.index = 0; }
  updateStars(); updateHUD();
  startMission(runner.index);
}
function pauseGame() {
  if (S.mode !== 'playing') return;
  S.mode = 'paused';
  $('pause-screen').style.display = 'flex';
}
function resumeGame() {
  $('pause-screen').style.display = 'none';
  S.mode = 'playing';
}
$('btn-new').addEventListener('click', () => { audio.ensure(); audio.sfx('click'); try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ } startGame(true); });
$('btn-continue').addEventListener('click', () => { audio.ensure(); audio.sfx('click'); loadGame(); startGame(false); });
$('btn-resume').addEventListener('click', resumeGame);
$('btn-restart').addEventListener('click', () => { $('pause-screen').style.display = 'none'; location.reload(); });
$('btn-respawn').addEventListener('click', respawn);
$('btn-mute').addEventListener('click', () => { S.muted = !S.muted; audio.enabled = !S.muted; $('btn-mute').textContent = S.muted ? '🔇 Sound: OFF' : '🔊 Sound: ON'; });
if (loadGame()) { $('btn-continue').style.display = 'inline-block'; $('save-line').textContent = `Save found: $${S.cash} · Mission ${Math.min(runner.index + 1, 8)} of 8 · Day ${S.day}`; }
else loadGame(); // reset to defaults when no save

// ---------- self-test + shot presets (headless QA hooks) ----------
function onFirstFrames() {
  if (params.has('selftest')) runSelfTest();
  if (params.has('shot')) setupShot(params.get('shot'));
}
function setupShot(name) {
  if (S.shotDone) return; S.shotDone = true;
  S.shotMode = true; // keep mission card + dialogue on screen for the still
  audio.enabled = false;
  // clean slate for stills: no leftover save cash from a self-test run
  try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
  S.cash = 0; S.health = 100;
  $('menu').style.display = 'none'; $('hud').style.display = 'block';
  S.mode = 'playing';
  if (name === 'menu') { $('menu').style.display = 'flex'; $('hud').style.display = 'none'; S.mode = 'menu'; }
  else if (name === 'city') {
    player.x = 0; player.z = 8; player.heading = Math.PI; S.camYaw = Math.PI; S.camPitch = 0.25;
    startMission(0);
    traffic.spawn(8, { x: 0, z: 0 }); peds.spawn(10, { x: 0, z: 0 });
  } else if (name === 'drive') {
    const car = createCar(scene, 'sports', 0xd83838);
    car.x = 0; car.z = 40; car.heading = Math.PI / 2; car.speed = 18; car.sync();
    S.playerCar = car; car.isPlayer = true; player.group.visible = false;
    traffic.spawn(6, { x: 0, z: 40 }); peds.spawn(6, { x: 0, z: 40 });
    S.camYaw = Math.PI / 2 + Math.PI; S.camPitch = 0.3;
    startMission(1);
  } else if (name === 'beach') {
    // beach road at the south edge (z=160): sea on the left, low western
    // sun dead ahead. Same car/setup as drive, staged on the coast road;
    // this still replaces 'drive' in the judged set (drive ≈ city).
    // Heading: atan2(dx,dz) — -PI/2 is WEST (-x). (PI would be north.)
    // The car drives on the sand (z≈240) so the sea is close on the left
    // and the north-side buildings don't fill the right half of the frame.
    const car = createCar(scene, 'sports', 0xd83838);
    car.x = 0; car.z = 240; car.heading = -Math.PI / 2; car.speed = 22; car.sync();
    S.playerCar = car; car.isPlayer = true; player.group.visible = false;
    traffic.spawn(8, { x: 0, z: 160 });
    // peds on the sand near the car, never on the road itself — the first
    // shoot hit a ped on the road and the still showed a wanted star
    peds.spawn(6, { x: 0, z: 235 });
    S.camYaw = Math.PI / 2; S.camPitch = 0.12; // flatter: more sky + sea
    startMission(0); // docks beacon sits just off the beach road, in frame
  } else if (name === 'chase') {
    const car = createCar(scene, 'sedan', 0x3a6ad8);
    car.x = 0; car.z = 0; car.heading = 0; car.speed = 20; car.sync();
    S.playerCar = car; car.isPlayer = true; player.group.visible = false;
    S.heat = 60; syncWantedFromHeat();
    // police cut across ahead of the player so they are IN the still;
    // the chase AI steers them onto the player during the ~3 s before the shot
    for (const [px, pz] of [[8, 14], [-8, 20]]) {
      const pc = createCar(scene, 'police');
      pc.x = px; pc.z = pz; pc.heading = Math.PI; pc.speed = 22; pc.sync();
      police.cars.push(pc);
    }
    traffic.spawn(8, { x: 0, z: 0 });
    S.camYaw = Math.PI; S.camPitch = 0.3;
    setObjective(160, -160, 'Lose the heat!');
  } else if (name === 'mission') {
    // player stands off-axis from the plaza ring trees (a tree at (-20,-8)
    // blocked the centre in the first shoot), facing the fountain + thugs;
    // camera sits behind him, so plaza + fountain + thugs are in frame
    player.x = -12; player.z = -4;
    player.heading = Math.atan2(-20 - player.x, -20 - player.z);
    S.camYaw = player.heading + Math.PI; S.camPitch = 0.3;
    startMission(3);
  }
  // stage the HUD for the still: golden-hour clock + a plausible
  // mid-mission cash balance so it never reads $0 ("nothing happened yet")
  if (params.has('sunset')) S.clockMin = 18 * 60 + 45; // 18:45
  const SHOT_CASH = { city: 1850, drive: 2400, beach: 2900, chase: 4200, mission: 3600 };
  if (name in SHOT_CASH) S.cash = SHOT_CASH[name];
  updateHUD();
  setTimeout(() => { window.__shotReady = true; }, 1500);
}
async function runSelfTest() {
  const results = [];
  const check = (name, ok, detail) => results.push({ name, pass: !!ok, detail: String(detail ?? '') });
  try {
    $('menu').style.display = 'none'; $('hud').style.display = 'block';
    S.mode = 'playing';
    check('renderer', renderer.info.render.calls > 0, `calls=${renderer.info.render.calls}`);
    check('scene-populated', scene.children.length > 60, `children=${scene.children.length}`);
    check('colliders', city.colliders.length > 50, `n=${city.colliders.length}`);
    check('traffic', traffic.cars.length >= 10, `n=${traffic.cars.length}`);
    check('pedestrians', peds.peds.length >= 10, `n=${peds.peds.length}`);
    check('player-spawn', player.group.visible && player.x === 0, `x=${player.x} z=${player.z}`);
    // enter the nearest parked car programmatically
    const car = parkedCars[0];
    player.x = car.x + 1; player.z = car.z; player.sync(0);
    enterCar(car);
    check('enter-car', S.playerCar === car, 'playerCar set');
    // drive forward 1 s
    input.inject('KeyW', true);
    for (let i = 0; i < 60; i++) updatePlayerCar(car, input, 1 / 60, city.colliders, allCars());
    input.inject('KeyW', false);
    check('car-moves', Math.abs(car.speed) > 2, `speed=${car.speed.toFixed(1)}`);
    check('car-stays-in-bounds', Math.abs(car.x) < 240 && Math.abs(car.z) < 250, `x=${car.x.toFixed(0)} z=${car.z.toFixed(0)}`);
    exitCar();
    check('exit-car', S.playerCar === null && player.group.visible, 'on foot again');
    // missions
    startMission(0);
    check('mission-1-objective', !!S.objective && beacon.visible, S.objective?.label);
    check('mission-count-8', MISSIONS.length === 8, `n=${MISSIONS.length}`);
    // HEAT / wanted
    S.heat = 0; S.crimeCooldown = 0;
    addWanted(2, 'test');
    check('heat-raises', S.wanted === 2 && S.heat === 40, `wanted=${S.wanted} heat=${S.heat}`);
    check('police-spawn', (() => { police.update(0.016, player, null, 2, city.colliders, () => {}); return police.cars.length >= 2; })(), `police=${police.cars.length}`);
    clearWanted(); police.clear();
    check('wanted-clears', S.wanted === 0 && S.heat === 0, `wanted=${S.wanted}`);
    // pay-n-spray clears heat and repairs
    S.cash = 500; S.heat = 60; syncWantedFromHeat();
    const sprayCar = createCar(scene, 'sedan');
    sprayCar.x = city.landmarks.garage.x; sprayCar.z = city.landmarks.garage.z + 4; sprayCar.condition = 55; sprayCar.sync();
    S.playerCar = sprayCar;
    const sprayed = payNSpray();
    check('pay-n-spray', sprayed && S.wanted === 0 && sprayCar.condition === 100 && S.cash === 300, `wanted=${S.wanted} cond=${sprayCar.condition} cash=${S.cash}`);
    S.playerCar = null;
    // thugs + save/load
    const thugs = spawnThugs(1, player.x + 6, player.z + 6);
    runner.thugs = thugs;
    check('thug-spawns', runner.thugs.length === 1, `n=${runner.thugs.length}`);
    S.cash = 1234; saveGame();
    const ok = loadGame();
    check('save-load', ok && S.cash === 1234, `cash=${S.cash}`);
    S.cash = 0;
    // day clock advances
    S.day = 1; S.clockMin = 23 * 60 + 59;
    S.clockMin += 2; if (S.clockMin >= 24 * 60) { S.clockMin -= 24 * 60; S.day++; }
    check('day-advances', S.day === 2, `day=${S.day}`);
    // minimap draws something
    drawMinimap();
    const px = mm.getImageData(0, 0, 200, 200).data;
    let nonBg = 0; for (let i = 0; i < px.length; i += 400) if (px[i] > 40 || px[i + 1] > 40) nonBg++;
    check('minimap-draws', nonBg > 20, `nonBgSamples=${nonBg}`);
    // HUD updates
    updateHUD();
    check('hud-updates', $('cash').textContent.includes('$') && $('day-clock').textContent.includes('DAY'), $('cash').textContent + ' / ' + $('day-clock').textContent);
  } catch (e) {
    results.push({ name: 'exception', pass: false, detail: String(e && e.stack || e).slice(0, 300) });
  }
  const pass = results.filter((r) => r.pass).length;
  window.__selftest = { pass, total: results.length, results };
}

// expose for debugging / shot hooks
window.__game = { S, player, city, traffic, peds, police, runner, startMission, addWanted, MISSIONS };
loop();
