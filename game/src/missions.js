// missions.js — SOLMAR BAY story chain: 8 jobs for the crew, each with a dialogue
// line, a numbered counter and a reward. The runner owns per-mission runtime state;
// main.js owns the world (player, cars, HUD) and passes it in as `w`.
import { dist2d } from './util.js';

export const MISSIONS = [
  { id: 1, title: 'FIRST WHEELS', kind: 'steal-drive', reward: 150,
    brief: 'You need wheels. Steal any car (E) and bring it to the docks.',
    dialogue: 'Marla: Wheels first, Danny. The docks crew is waiting.' },
  { id: 2, title: 'PACKAGE RUN', kind: 'drops', reward: 250,
    brief: 'Two drops, 90 seconds. Drive fast, drive clean.',
    dialogue: 'Marla: Two drops, ninety seconds. Don\'t scratch the paint.' },
  { id: 3, title: 'HEAT WAVE', kind: 'survive', reward: 300,
    brief: 'The cops are on you. Reach the hideout — or survive 40 seconds.',
    dialogue: 'Marla: PD is all over us after the docks. Lose them!' },
  { id: 4, title: 'PLAZA STANDOFF', kind: 'standoff', reward: 400,
    brief: 'Rival crew at the plaza. On foot. Take all three down.',
    dialogue: 'Rico: This plaza is ours now, Cole.' },
  { id: 5, title: 'CASINO DEBT', kind: 'collect', reward: 350,
    brief: 'Casino Palma owes the crew. Walk in, collect, get out clean.',
    dialogue: 'Marla: The Casino owes us. Collect — and don\'t get spotted.' },
  { id: 6, title: 'DOCKSIDE TROUBLE', kind: 'clear', reward: 450,
    brief: 'Sharks moved into the old docks. Clear all three out.',
    dialogue: 'Rico: Sharks at the docks, Cole. Send them packing.' },
  { id: 7, title: 'THE GETAWAY', kind: 'timed', reward: 500,
    brief: 'Three stops, 100 seconds. The crew is counting on you.',
    dialogue: 'Marla: Three stops, a hundred seconds. Go, go, go!' },
  { id: 8, title: 'THE BIG SCORE', kind: 'heist', reward: 600,
    brief: 'Hit the bank, grab the case, lose the heat at the hideout.',
    dialogue: 'Marla: One last job, Danny. The vault — then vanish.' },
];

export class MissionRunner {
  constructor() {
    this.index = 0;
    this.mission = null;
    this.cpIndex = 0;
    this.checkpoints = [];
    this.timer = 0;
    this.caseTaken = false;
    this.thugs = [];
  }

  start(i, w) {
    this.index = i;
    const m = MISSIONS[i];
    this.mission = m;
    this.cpIndex = 0;
    this.checkpoints = [];
    this.caseTaken = false;
    w.showMissionCard(m);
    w.showDialogue(m.dialogue);
    w.audio.sfx('mission');
    const L = w.city.landmarks;
    if (m.kind === 'steal-drive') {
      w.setObjective(L.docks.x, L.docks.z, 'Steal a car, then drive to the docks');
    } else if (m.kind === 'drops') {
      this.checkpoints = [{ x: 160, z: -160 }, { x: -160, z: 160 }];
      this.timer = 90;
      w.setObjective(this.checkpoints[0].x, this.checkpoints[0].z, 'Drop 1 of 2 — 90s on the clock');
    } else if (m.kind === 'survive') {
      w.addWanted(2, 'setup');
      this.timer = 40;
      w.setObjective(L.hideout.x, L.hideout.z, 'Reach the hideout or survive 40s');
    } else if (m.kind === 'standoff') {
      this.thugs = w.spawnThugs(3, L.plaza.x, L.plaza.z);
      w.setObjective(L.plaza.x, L.plaza.z, 'Take down the rival crew (3 left)');
    } else if (m.kind === 'collect') {
      w.setObjective(L.casino.x, L.casino.z, 'Walk into Casino Palma and collect');
    } else if (m.kind === 'clear') {
      this.thugs = w.spawnThugs(3, L.docks.x, L.docks.z);
      w.setObjective(L.docks.x, L.docks.z, 'Clear the sharks from the docks (3 left)');
    } else if (m.kind === 'timed') {
      this.checkpoints = [{ x: 160, z: 160 }, { x: -160, z: -160 }, { x: 0, z: 160 }];
      this.timer = 100;
      w.setObjective(this.checkpoints[0].x, this.checkpoints[0].z, 'Stop 1 of 3 — 100s on the clock');
    } else if (m.kind === 'heist') {
      w.setObjective(L.bank.x, L.bank.z, 'Get to the bank vault door');
    }
    w.saveGame();
  }

  // Remove live thugs from the scene (mission done / failed / new mission).
  clearThugs(w) {
    for (const t of this.thugs) w.removePerson(t);
    this.thugs = [];
  }

  // The reference point for distance checks: the car, or the player on foot.
  ref(w) { return w.state.playerCar || w.player; }

  timerLabel(m) {
    const total = this.checkpoints.length;
    if (m.kind === 'drops') return `Drop ${this.cpIndex + 1} of ${total} — ${Math.ceil(this.timer)}s left`;
    return `Stop ${this.cpIndex + 1} of ${total} — ${Math.ceil(this.timer)}s left`;
  }

  update(dt, w) {
    if (!this.mission) return;
    const m = this.mission;
    const L = w.city.landmarks;
    if (m.kind === 'steal-drive') {
      const ref = w.state.playerCar;
      if (ref && dist2d(ref.x, ref.z, L.docks.x, L.docks.z) < 10) w.complete();
    } else if (m.kind === 'drops' || m.kind === 'timed') {
      this.timer -= dt;
      const cp = this.checkpoints[this.cpIndex];
      const ref = this.ref(w);
      if (dist2d(ref.x, ref.z, cp.x, cp.z) < 10) {
        this.cpIndex++;
        w.audio.sfx('pickup');
        if (this.cpIndex >= this.checkpoints.length) { w.complete(); return; }
        const total = this.checkpoints.length;
        const label = m.kind === 'drops' ? `Drop ${this.cpIndex + 1} of ${total}` : `Stop ${this.cpIndex + 1} of ${total}`;
        w.setObjective(this.checkpoints[this.cpIndex].x, this.checkpoints[this.cpIndex].z, `${label} — ${Math.ceil(this.timer)}s left`);
      }
      if (this.timer <= 0) { w.fail('Out of time'); return; }
      if (w.state.objective) w.setObjectiveLabel(this.timerLabel(m));
    } else if (m.kind === 'survive') {
      this.timer -= dt;
      const ref = this.ref(w);
      if (dist2d(ref.x, ref.z, L.hideout.x, L.hideout.z) < 9) {
        w.clearWanted(); w.complete(); return;
      }
      if (this.timer <= 0) { w.clearWanted(); w.complete(); return; }
      if (w.state.objective) w.setObjectiveLabel(`Reach the hideout or survive ${Math.ceil(this.timer)}s`);
    } else if (m.kind === 'standoff' || m.kind === 'clear') {
      // thugs shoot back at the player
      for (const t of this.thugs) {
        if (!t.group.visible) continue;
        const d = dist2d(t.x, t.z, w.player.x, w.player.z);
        t.fireT -= dt;
        if (d < 30 && t.fireT <= 0) {
          t.fireT = 1.4 + Math.random() * 0.8;
          t.heading = Math.atan2(w.player.x - t.x, w.player.z - t.z);
          w.audio.sfx('shoot');
          w.damagePlayer(6 + Math.random() * 4);
          if (w.state.health <= 0) return;
        }
        t.x += Math.sin(t.heading + 1.5) * 0.6 * dt;
        t.z += Math.cos(t.heading + 1.5) * 0.6 * dt;
        t.speed = 0.6; t.sync(dt);
      }
    } else if (m.kind === 'collect') {
      if (!w.state.playerCar && dist2d(w.player.x, w.player.z, L.casino.x, L.casino.z) < 9) {
        w.addWanted(1, 'debt');
        w.audio.sfx('cash');
        w.toast('DEBT COLLECTED — get to the garage, lose the tail!');
        w.setObjective(L.garage.x, L.garage.z, 'Lose the tail at Marlowe\'s Garage');
        this.mission = { ...m, kind: 'collect-escape' };
      }
    } else if (m.kind === 'collect-escape') {
      const ref = this.ref(w);
      if (dist2d(ref.x, ref.z, L.garage.x, L.garage.z) < 9) {
        w.clearWanted(); w.complete();
      }
    } else if (m.kind === 'heist') {
      if (!this.caseTaken) {
        if (!w.state.playerCar && dist2d(w.player.x, w.player.z, L.bank.x, L.bank.z) < 9) {
          this.caseTaken = true;
          w.addWanted(3, 'heist');
          w.audio.sfx('cash');
          w.toast('CASE GRABBED — lose the heat at the hideout!');
          w.setObjective(L.hideout.x, L.hideout.z, 'Escape to the hideout');
        }
      } else {
        const ref = this.ref(w);
        if (dist2d(ref.x, ref.z, L.hideout.x, L.hideout.z) < 9) {
          w.clearWanted(); w.complete();
        }
      }
    }
  }
}
