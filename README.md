# SOLMAR BAY — open-world crime game (make.fun gta6-01)

[![make.fun](https://make.fun/badge/gta6-01.svg)](https://make.fun/c/gta6-01)
[![rank](https://make.fun/badge/gta6-01/gmlokie/gta6-01/rank.svg)](https://make.fun/c/gta6-01)
[![reward](https://make.fun/badge/gta6-01/gmlokie/gta6-01/reward.svg)](https://make.fun/c/gta6-01)

An original open-world crime game in the spirit of GTA 6, built for the
[make.fun gta6-01 competition](https://make.fun/c/gta6-01). Everything is
original — the city, characters, vehicles, names, story, art, sound and music.
No Rockstar content. Three.js 0.187.0 vendored, static files only, no network.

## Play

Serve `game/` locally and open it in a desktop browser:

```
node serve.ts   # http://localhost:8080
```

**You are Danny Cole**, a driver-for-hire with empty pockets in Solmar Bay.
Steal cars, outrun the Solmar PD, run eight jobs for the crew — and take the city.

## Systems

- **Open-world city** — 9×9 street grid with distinct districts: downtown towers,
  the plaza with its fountain, the beach and sea, the docks, the bank,
  Marlowe's Garage (pay-n-spray) and Casino Palma.
- **On foot and by car** — third-person on-foot movement plus arcade driving
  (accel / steer / handbrake drift), with named cars and a condition % in the HUD.
- **Traffic and pedestrians** — lane-driving traffic that turns at intersections
  and slows for cars ahead; sidewalk pedestrians who flee from nearby threats.
- **Cars to steal** — traffic cars and parked cars; witnesses call the cops.
- **Wanted level and police** — 0–5 stars driven by a 0–100 HEAT meter, police
  chase cars that ram, on-foot officers that bust you; HEAT cools when you lay low.
- **Missions and a story** — 8 jobs with dialogue, numbered counters, timers and
  checkpoints: First Wheels, Package Run, Heat Wave, Plaza Standoff, Casino Debt,
  Dockside Trouble, The Getaway, The Big Score.
- **Combat** — pistol (raycast) and punch; rival thugs shoot back.
- **HUD with minimap** — cash, health, ammo, speed, DAY + clock, mission n/8,
  objective banner, dialogue line, and a live circular minimap with blips.
- **Start and save** — title screen with story and controls, localStorage save
  with continue, pause, busted/wasted flow with respawn.
- **Polish** — procedural WebAudio SFX and a music loop (no audio files),
  day sky with drifting clouds, shadows, headlights/taillights, flashing
  police light bars, mission beacon.

## Controls

| Key | Action |
| --- | --- |
| W A S D | move / drive |
| Mouse drag | look |
| E | steal / enter / exit car |
| Shift | sprint |
| Click | shoot |
| F | punch |
| R | reload |
| Space | handbrake |
| G | pay-n-spray at Marlowe's Garage ($200, clears wanted) |
| Esc | pause |
| M | mute |

## Layout

- `game/` — the game: `index.html`, `style.css`, `src/` (util, city,
  entities, missions, main), `vendor/three.module.min.js` (three.js 0.187.0).
- `main.ts` — entrypoint: atomically installs `game/` + `screenshots/` into
  `/output` and writes `dossier.json` (concurrent-safe, pid + random staging).
- `serve.ts` — local static server for `game/`.
- `test-game.mjs` — headless QA: in-game self-test + 4 screenshots.
- `screenshots/` — the 4 judged stills (city, drive, chase, mission).
- `vendor/makefun-game.ts` — the kit's dossier library, unchanged.
