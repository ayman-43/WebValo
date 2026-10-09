<div align="center">

# ⟁ WEBVALO

**A Valorant-inspired tactical FPS that runs entirely in your browser.**
No install. No launcher. No queue. Just `index.html` and a pointer lock.

[![Made with Three.js](https://img.shields.io/badge/Three.js-r160-0f1923?style=for-the-badge&logo=three.js&logoColor=ff4655)](https://threejs.org)
[![Zero Build](https://img.shields.io/badge/build_step-none-ff4655?style=for-the-badge)](#tech)
[![Deployed on Vercel](https://img.shields.io/badge/deployed-vercel-0f1923?style=for-the-badge&logo=vercel)](https://webvalo.vercel.app)

</div>

---

## ▸ What is this?

WebValo is a fan-made, browser-native tribute to Valorant: pick one of **5 agents**, lock in on the map **FORGE**, and play **Team Deathmatch — first to 30 kills (10 minute clock)** against a squad of AI soldiers, with full ability kits: smokes, dashes, teleports, recon bolts, and orbital lasers.

The enemies are **procedurally built and animated tactical soldiers** (≈1.8 m tall): every visible body part is its own hitbox, so what you see is exactly what you can shoot — head, body and legs each take their own damage. They path around walls, react with a human-ish delay, strafe, fire visible bursts, chase your last known position, and fall when they die.

Map textures, enemy models, agent card art and all sound design are procedural (Canvas + Web Audio). Only the first-person gun models stream at runtime from a CC0 pack ([Quaternius](https://quaternius.com) sci-fi guns), so the repo ships **zero binary assets**; if they fail to load the engine falls back to a procedural gun.

## ▸ Agents

| Agent | Role | C | Q | E | X (Ultimate) |
|---|---|---|---|---|---|
| **JETT** | Duelist | Cloudburst (smoke) | Updraft (boost) | Tailwind (dash) | **Blade Storm** — one-shot knives |
| **RAZE** | Duelist | Blast Pack (rocket-jump) | Paint Shells (nade) | Boom Bot (seeker) | **Showstopper** — rocket launcher |
| **YORU** | Duelist | Fakeout (decoy) | Blindside (flash) | Gatecrash (teleport) | **Dimensional Drift** — untouchable |
| **BRIMSTONE** | Controller | Stim Beacon (fire rate) | Incendiary (molly) | Sky Smoke (anywhere) | **Orbital Strike** — laser from space |
| **SOVA** | Initiator | Owl Drone (tagger) | Shock Bolt (AOE) | Recon Bolt (wallhack) | **Hunter's Fury** — 3 wall-piercing blasts |

## ▸ Controls

| Key | Action |
|---|---|
| `WASD` | Move · `Shift` walk · `Space` jump |
| `Mouse` | Aim · `LMB` fire · `RMB` aim down sights (Operator: scope) |
| `1` / `2` / `Wheel` | Primary / secondary weapon |
| `R` | Reload |
| `C` `Q` `E` | Abilities (some, like Raze's Blast Pack, hold **2 charges**) |
| `X` | Ultimate (charge by getting kills) |
| `B` | Armory (works while dead too) |
| `Tab` | Scoreboard |
| `Esc` | Pause |

⚙ **Settings** (landing page + pause): mouse sensitivity, FOV, master volume, **bot difficulty** (easy / normal / hard), damage numbers, reduced motion, FPS counter — all saved to `localStorage`.

## ▸ The Armory

Valorant-style columns — **Sidearms · SMGs · Rifles · Sniper · Heavy · Shields**:
Classic · Shorty · Sheriff · Spectre · Bulldog · Phantom · Vandal · Operator · Odin, plus Light (+25) and Heavy (+50) shields.

- **Click** a card to buy *and* equip instantly; **right-click** to sell back anything bought this life.
- **Hotkeys** while open: `1–9` guns (numbers shown on each card), `L` / `H` shields.
- You carry a **primary + sidearm** and **keep your guns when you die** (ammo refills; shields don't carry over).
- Start with **$2,000**; kills pay **$200**, +$100 for a headshot.

Real-ish damage models with head / body / leg multipliers, ADS, movement & spray inaccuracy, and a synthesized gunshot per weapon class.

## ▸ Run it locally

It's a static site — any file server works:

```bash
git clone https://github.com/platret/WebValo.git
cd WebValo
python3 -m http.server 8000
# open http://localhost:8000
```

<a id="tech"></a>
## ▸ Tech

- **Three.js r160** via CDN import map — no bundler, no `node_modules`
- `js/enemy.js` — procedural soldier rig (hips → legs/knees, spine → arms/head) with a speed-matched walk cycle, **two-bone IK** keeping both hands on the rifle, aim pitch, recoil, hit flinches and a gravity-eased death fall; per-part hitboxes tagged head / body / legs
- `js/nav.js` — the arena is rasterized into a nav grid; bots use **A\*** + string-pulling to route around cover
- Bot AI: perception cone + line of sight (blocked by walls *and* smokes), reaction delay, strafe/stand/burst-fire, hunt last-known position, hear your gunfire; difficulty-scaled accuracy and damage
- Pointer-lock FPS controller with per-axis AABB collision; lock survives death, and any lost lock falls back to pause / click-to-resume so input never gets stuck
- Hitscan weapons with spread, bloom, recoil, ADS zoom and a scoped Operator; damage numbers, hit sparks, directional damage indicators, positional (panned) enemy gunfire
- **Object pooling** — one shared `Raycaster`, scratch vectors, and tracer / impact / spark pools
- Procedural canvas textures (concrete, wall panels, crates, hazard metal, sky) with world-scaled UVs
- Pure CSS UI — Valorant-style angular clip-paths, Anton + Rajdhani type

## ▸ Disclaimer

WebValo is a non-commercial fan project for learning purposes. It is **not affiliated with or endorsed by Riot Games**. Valorant and all related characters are property of Riot Games, Inc.

---

<div align="center"><sub>built in the browser, for the browser · <code>FPS.SYS READY_</code></sub></div>
