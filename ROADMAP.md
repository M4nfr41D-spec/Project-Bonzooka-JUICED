<!-- Copyright (c) Manfred Foissner. All rights reserved. License: See LICENSE.txt -->

# BONZOOKAA v2.5 - Exploration ARPG Roadmap

## &#x2705; PHASE 1: Core Architecture (DONE)

| System | File | Status |
|--------|------|--------|
| Seeded Random | `runtime/world/SeededRandom.js` | &#x2705; |
| Camera System | `runtime/world/Camera.js` | &#x2705; |
| Map Generator | `runtime/world/MapGenerator.js` | &#x2705; |
| World Manager | `runtime/world/World.js` | &#x2705; |
| Scene Manager | `runtime/world/SceneManager.js` | &#x2705; |
| Background System | `runtime/world/Background.js` | &#x2705; |
| Depth Rules | `runtime/world/DepthRules.js` | &#x2705; |
| Acts/Tiers Config | `data/acts.json` | &#x2705; |
| Hub Modal | `index.html` | &#x2705; |
| Game Loop | `main.js` | &#x2705; |
| Enemy Level Scaling | `runtime/Enemies.js` | &#x2705; |
| Spatial Hash | `runtime/SpatialHash.js` | &#x2705; |
| Loot System | `runtime/Items.js` | &#x2705; |
| Affix System | `data/affixes.json` | &#x2705; |
| Rarity Tiers | `data/rarities.json` | &#x2705; |
| Skill Trees | `data/skills.json` | &#x2705; |
| Pilot Stats | `data/pilotStats.json` | &#x2705; |
| Save/Load | `runtime/Save.js` | &#x2705; |
| Contracts | `runtime/Contracts.js` | &#x2705; |
| Crafting System | `data/crafting.json` | &#x2705; |
| Vendor System | `index.html` (modal) | &#x2705; |

---

## &#x2705; PHASE 2: Infinite Progression (DONE - v2.4.0)

| Feature | Status |
|---------|--------|
| Tier-based portals (P1: Z1-100, P2: Z101-250, P3: Z251+&#x221E;) | &#x2705; |
| Boss spawns TWO portals (gold next + blue hub) | &#x2705; |
| Auto-tier biome switching | &#x2705; |
| Difficulty scaling per depth | &#x2705; |

---

## &#x2705; PHASE 2.5: Data Integrity (DONE - v2.4.1)

| Fix | Status |
|-----|--------|
| JSON emoji decoding (8 files, 354+ unicode escapes) | &#x2705; |
| Hold-to-repeat stat/skill allocation | &#x2705; |
| Stash auto-refresh on pickup | &#x2705; |
| Console.log cleanup (13 files) | &#x2705; |

---

## &#x2705; PHASE 3: Visual Overhaul (DONE - v2.5.0)

| System | Changes | Status |
|--------|---------|--------|
| Player ship | Multi-layer hull/wings, dual engines, cockpit, nav lights, thrust lerp, damage flash | &#x2705; |
| Bullets | 6 weapon types (laser, plasma, railgun, missile, gatling, nova) + crit sparkle | &#x2705; |
| Enemy bullets | Gradient trail + hot center | &#x2705; |
| Particles | Screen shake, flash FX, expanding rings, float-up, drag | &#x2705; |
| Enemies | Rotating shapes, elite pulse, boss double-hex with eye, gradient HP bars, name tags | &#x2705; |
| Obstacles | Crater asteroids, metal debris, pulsing mines, ancient pillars | &#x2705; |
| Portals | Swirling arc rings, radial gradient core, animated glow | &#x2705; |
| Shield | Hex-bubble outline + glow ring | &#x2705; |
| Combat UI | Compact panels (195px/210px), ~20% more canvas, no-scroll at 1080p | &#x2705; |

---

## &#x2705; PHASE 4: Combat Systems (DONE - v2.6.0)

### 4.1 Collision System
- [x] Player vs Obstacles (slide/pushback with velocity dampening)
- [x] Bullets vs Obstacles (destroy asteroids, drop scrap) - was v2.4
- [x] Mine explosion on player proximity (damage + splash to enemies)
- [x] Solid obstacle pushback (asteroids, pillars, debris)

### 4.2 Boss Phase System
- [x] HP-threshold phase transitions (N phases, evenly spaced)
- [x] Phase change VFX (ring + flash + screen shake)
- [x] Shield phase ability (80% damage reduction, 4s duration)
- [x] Add spawning on phase change + periodic (every 8s in phase 3+)
- [x] Enrage on final phase (+35% speed, +40% damage, -40% fire interval)
- [x] Boss shield/enrage visual overlays

### 4.3 Drone Companion System
- [x] Combat drone (orbiting auto-fire at nearest, 25% player damage)
- [x] Shield drone (absorbs nearby enemy bullets)
- [x] Repair drone (heals 2% max HP per second)
- [x] Visual: type-specific shapes + connection line
- [x] G key to cycle: Combat > Shield > Repair > Off


---

## &#x2705; PHASE 5: Content Expansion (DONE - v2.7.0)

### &#x2705; 5.5 Retention & Feel Overhaul (v2.7.1)
- Power rebalance: percentage pilotStats + per-level auto-scaling + gentler enemy curves
- Rarity drop colors: pre-rolled at spawn, enhanced rendering (beams, sparkles, labels)
- Stash: equipped items hidden from stash grid
- Vendor: stat previews, cheaper tier-1, purchase feedback, broken flat/percent stats fixed
- Crafting: contextual descriptions, WHY-disabled reasons, color-coded success rates

### 5.1 Enemy Type Integration
- [x] All 12 enemy types active in tier pools (bomber, cloaker, summoner, turret, shielder, corrupted, repair_drone)
- [x] Wave compositions data-driven (7 brackets: 1-5 through 101+)
- [x] Tier-specific enemy pools (acts.json → MapGenerator)

### 5.2 All 5 Biomes Active
- [x] Tier 4: Derelict Fleet (zones 401-600) - generation config fixed
- [x] Tier 5: Black Hole Approach (zones 601+∞) - generation config fixed
- [x] Biome hazards: toxic clouds, gravity wells, void rifts, radiation pockets, debris storms
- [x] Hazard visual rendering (radial gradients, spirals, particles)

### 5.3 Unique/Legendary Items
- [x] 16 unique items + 2 set families wired into drop system
- [x] Boss-only drop filtering (bossOnly + bossPool + minDepth)
- [x] Boss context threaded: Enemies.kill → Bullets → Pickups → Items.generateRandom

### ✅ 5.6 Level Design Overhaul (v2.8.0)
- [x] 10 POI types with progressive depth unlocks
- [x] Resource mining: 4 node types with unique visuals and typed drops
- [x] POI lifecycle: trigger → clear → collect with visual feedback
- [x] Navigation HUD: compass arrows, minimap markers, zone tracker
- [x] Zone density retuning: smaller maps, tighter encounter spacing

### ✅ 5.7 Resume Portal + Difficulty Lanes (v2.9.0)
- [x] Resume from highest zone portal in hub (anti-frustration)
- [x] 3 difficulty lanes: Normal / Risk / Chaos
- [x] Risk: 3× elites, +30% HP, better loot (+1 rarity), +80% cells
- [x] Chaos: 5× elites, 60% elite promotion, corrupted visuals, hunting mines, poison areas, +2 rarity, 3× cells
- [x] Difficulty HUD badge with loot bonus indicator
- [x] Chaos-specific rare material bonus drops (void shards, cosmic dust)

### ✅ 5.8 Per-Difficulty Progress + Audio v3 (v2.9.1)
- [x] Per-difficulty zone tracking: `highestZones: { normal, risk, chaos }` — anti-exploit
- [x] Hub shows separate resume buttons per difficulty lane with progress
- [x] Legacy migration: old `highestZone` → `highestZones.normal`

### ✅ 5.9 "The Juice Patch" (v2.10.0)
- [x] Kill streak / combo system: 3.5s timer, ×3.0 XP cap, ×2.0 loot cap, HUD counter
- [x] Zone mastery bonus: 80%+ POIs → scrap/cells/XP burst with fanfare
- [x] 3 active abilities: Dash (Q, 4s CD, invuln), Shield Burst (R, 12s CD, AoE + shield), Orbital Strike (F, 18s CD, expanding ring)
- [x] Ability cooldown HUD: 3 slots at bottom-center with radial sweep
- [x] Streak HUD: top-right with pulse glow, multiplier display, decay bar

---

## ✅ PHASE 6: Audio (DONE — v2.9.1)

### ✅ 6.1 Professional Procedural Synthesis (Audio.js v3.0)
- [x] Zero audio files — all 49 SFX synthesized via Web Audio API
- [x] DynamicsCompressor on master bus for consistent levels
- [x] Feedback-delay reverb bus for spatial depth
- [x] BiquadFilter per-SFX with sweep automation
- [x] Layered synthesis (2-4 oscillators + noise per SFX)
- [x] SFX pooling (max 5 concurrent per type)

### ✅ 6.2 SFX Library (49 methods)
- [x] 7 weapon sounds (laser, plasma, railgun, gatling, beam, homing, scatter)
- [x] 3 impact sounds (enemy hit, player hit, critical hit)
- [x] 3 explosions (normal, big, mine)
- [x] 5 pickups (item, health, scrap, generic, void shard, cosmic dust)
- [x] 4 POI lifecycle (trigger, cleared, reward, beacon activate)
- [x] 3 resource sounds (mine, drop, resource drop)
- [x] 4 chaos/difficulty (difficulty start, poison DOT, hunting mine alert, corrupt ambience)
- [x] 8 game events (portal, boss spawn, boss phase, level up, shield break/recharge, drone switch, alert)
- [x] 3 progression (combo up, zone mastered, wave complete)

### ✅ 6.3 Procedural Music System
- [x] 5 dynamic tracks: hub, combat_t1, combat_t2, combat_chaos, boss
- [x] Bass drone + filter LFO + chord pads (3-4 voices) + dissonant beating
- [x] Auto-select: chaos difficulty → combat_chaos track
- [x] Mute/unmute + separate SFX/Music volume controls

### 🔮 6.4 Future Audio (Backlog)
- [ ] Weapon-type audio dispatch (when weapon system expands)
- [ ] Positional audio (pan based on enemy position)
- [ ] Dynamic music intensity scaling (enemy count → filter opening)
- [ ] Audio file support (optional .wav/.mp3 override per SFX)

---

## &#x2699; PHASE 7: Performance & Polish

### ✅ 7.0 "The Polish Patch" (v2.11.0)
- [x] Background tiles activated (Background.js was dead code — now wired)
- [x] PostFX pipeline: bloom, vignette, CRT scanlines, ambient dust
- [x] Enhanced weapon trails (laser/plasma/railgun/gatling — longer, multi-layer)
- [x] Per-weapon impact sparks on enemy hit (6 types)
- [x] Per-weapon muzzle flash colors
- [x] Loot drop bounce animation + rarity ground glow aura

### 7.1 Render Optimization
- [ ] Object pooling (bullets, particles)
- [ ] Batch rendering (same-type draws)
- [ ] Offscreen canvas for static BG
- [ ] Particle LOD (reduce at high count)

### 7.2 Save System Enhancement
- [ ] Multiple save slots
- [ ] Export/import save (JSON)
- [ ] Autosave indicator
- [ ] Save migration (old mojibake items)

### 7.3 Settings Menu
- [ ] Volume sliders
- [ ] Screen shake toggle
- [ ] Damage numbers toggle
- [ ] Minimap size

---

## &#x1F3C6; PHASE 8: Endgame

### 8.1 Map Modifiers (PoE-style)
- [ ] Zone affixes (+damage, +speed, reflect, etc.)
- [ ] Risk/reward: harder mods = better loot
- [ ] Corruption system (stackable difficulty)

### 8.2 Endless Leaderboard
- [ ] Deepest zone reached
- [ ] Fastest boss kill
- [ ] Most damage dealt (per run)
- [ ] Local storage leaderboard

### 8.3 Prestige / New Game+
- [ ] Permanent stat bonuses on reset
- [ ] Unlockable ship skins
- [ ] Achievement system

---

## Priority Matrix

| Phase | Priority | Effort | Impact |
|-------|----------|--------|--------|
| 4.1 Collision | &#x1F534; HIGH | Medium | High |
| 4.2 Enemy AI | &#x1F534; HIGH | Medium | High |
| 4.3 Drones | &#x1F7E1; MED | Medium | High |
| 5.1 Enemies | &#x1F7E1; MED | Medium | High |
| 6.1 SFX | &#x1F7E1; MED | Low | High |
| 5.3 Uniques | &#x1F7E2; LOW | Medium | Medium |
| 7.1 Perf | &#x1F7E2; LOW | High | Medium |
| 8.1 Map Mods | &#x1F7E2; LOW | High | High |

---

## File Structure (v2.5.0)

```
bonzookaa/
  index.html              # Main HTML + CSS + modals
  main.js                 # Game loop + render pipeline
  runtime/
    State.js              # Global state singleton
    DataLoader.js         # JSON asset loading
    Save.js               # localStorage persistence
    Stats.js              # Computed stat engine
    Leveling.js           # XP curves + level ups
    Items.js              # Item generation + affixes
    Player.js             # Ship logic + draw (v2.5.0)
    Enemies.js            # AI + draw (v2.5.0)
    Bullets.js            # Projectiles + weapon visuals (v2.5.0)
    Pickups.js            # Drop collection
    Particles.js          # VFX engine (v2.5.0)
    Input.js              # Keyboard + mouse
    UI.js                 # HTML panel rendering
    Invariants.js         # Debug assertions
    Contracts.js          # Mission/quest system
    SpatialHash.js        # Collision grid
    world/
      index.js
      SeededRandom.js
      Camera.js
      MapGenerator.js
      World.js            # Obstacles + portals (v2.5.0)
      SceneManager.js
      Background.js       # Tiled terrain + fog + deco
      DepthRules.js
  data/
    config.json
    acts.json
    enemies.json
    items.json
    affixes.json
    skills.json
    pilotStats.json
    rarities.json
    runUpgrades.json
    slots.json
    crafting.json
    uniques.json
    packs.json
  assets/
    backgrounds/          # Tile textures
    fog/                  # Fog overlays
    asteroids_deco/       # Decorative sprites
    sprites/              # Enemy/player sprites
    audio/                # (Future)
```

---

## Version History

| Version | Date | Summary |
|---------|------|---------|
| v2.0.0 | 2025-01 | Core exploration mode |
| v2.3.0 | 2026-02 | Tier portals, background system |
| v2.4.0 | 2026-02-23 | Infinite zones, emoji HTML fix, UI overflow |
| v2.4.1 | 2026-02-23 | JSON emoji decode, hold-repeat, stash refresh |
| v2.5.0 | 2026-02-23 | Full visual overhaul (ship, bullets, particles, enemies, portals, compact UI) |
| v2.6.0 | 2026-02-23 | Combat systems: obstacle collision, boss phases, drone companion |
| v2.6.1 | 2026-02-24 | Hotfix: bullets vs obstacles, mine destruction, enhanced particle FX |
| v2.7.0 | 2026-02-24 | Content expansion: all 12 enemies, 5 biomes, biome hazards, unique drops |
| v2.7.1 | 2026-02-24 | Retention overhaul: power rebalance, rarity drop colors, vendor/crafting UX |
| v2.8.0 | 2026-02-24 | Level design overhaul: 10 POI types, resource mining, navigation HUD |
| v2.9.0 | 2026-02-24 | Resume portal + 3 difficulty lanes (Normal/Risk/Chaos) |
| v2.9.1 | 2025-02-25 | Per-difficulty zone progress (anti-exploit) + Audio Engine v3.0 (49 procedural SFX, 5 music tracks) |
| v2.12.0 | 2026-02-26 | "The Gameplay Patch": Zone objectives (5 types: exterminate/survival/timetrial/corruption/lockdown), weapon system (6 playable types with drops), branching exits (safe/risky/vault route choice) |
| v2.11.1 | 2026-02-26 | "Cleanup Hotfix": Fixed tile white borders (modulo bug), removed 5 noise layers (starfield-over-tiles, wisps, scanlines, bloom, dust), reduced decoration alpha when tiles active |
| v2.11.0 | 2026-02-26 | "The Polish Patch": Background tiles activated, PostFX pipeline (bloom/vignette/scanlines/dust), enhanced weapon trails (6 types), per-weapon impact sparks, muzzle flash colors, loot bounce + ground glow |
| v2.10.0 | 2025-02-25 | "The Juice Patch": Kill streak system, zone mastery bonus, 3 active abilities (dash/shield/orbital) |

---

*Last updated: 2026-02-24*
