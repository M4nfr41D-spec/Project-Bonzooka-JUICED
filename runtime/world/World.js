// Copyright (c) Manfred Foissner. All rights reserved.
// License: See LICENSE.txt in the project root.

// ============================================================
// World.js - Zone & Enemy Spawn Management
// ============================================================
// Manages current zone, spawns enemies when player approaches

import { State } from '../State.js';
import { MapGenerator } from './MapGenerator.js';
import { Camera } from './Camera.js';
import { SeededRandom } from './SeededRandom.js';
import { DepthRules } from './DepthRules.js';
import { SpatialHash } from '../SpatialHash.js';
import { Background } from './Background.js';

// Shared spatial grid – rebuilt every frame in update()
let _grid = null;

export const World = {
  currentZone: null,
  currentAct: null,
  zoneIndex: 0,
  
  // Spatial hash for O(1) collision queries
  get grid() { return _grid; },
  
  // Spawning config
  spawnRadius: 600,      // Distance to trigger spawn
  despawnRadius: 1200,   // Distance to despawn (performance)
  activeEnemies: [],     // Currently active enemies from spawns
  
  // Initialize world with act config
  async init(actId, seed = null) {
    // ── NEW: Tier-based infinite zones ──
    // actId can be a tierId, a legacy actId, or a portal startZone number
    const acts = State.data.acts;
    let startZone = 0;
    let tierConfig = null;

    // Check if called with a portal startZone (number)
    if (typeof actId === 'number') {
      startZone = actId - 1; // convert 1-based depth to 0-based index
      tierConfig = this.getTierForDepth(actId);
    }
    // Check for new tier-based format
    else if (acts?.tiers) {
      const portal = acts.portals?.find(p => p.id === actId || p.tierId === actId);
      if (portal) {
        startZone = (portal.startZone || 1) - 1;
        tierConfig = acts.tiers.find(t => t.id === portal.tierId);
      }
      // Fallback: try legacy act lookup
      if (!tierConfig && acts[actId]) {
        tierConfig = acts[actId];
      }
      // Fallback: first tier
      if (!tierConfig && acts.tiers.length > 0) {
        tierConfig = acts.tiers[0];
      }
    }
    // Legacy: old act-based format
    else if (acts?.[actId]) {
      tierConfig = acts[actId];
    }

    if (!tierConfig) {
      console.error(`No tier/act config found for: ${actId}`);
      return false;
    }

    this.currentAct = { ...tierConfig };
    this.currentAct.id = tierConfig.id || actId;

    // Use provided seed or generate from tier + timestamp
    const actSeed = seed || SeededRandom.fromString(this.currentAct.id + '_' + Date.now());
    this.currentAct.seed = actSeed;

    // Start at the specified zone
    this.zoneIndex = startZone;
    this.loadZone(startZone);
    
    return true;
  },

  /**
   * Get the tier config for a given depth (1-based zone number).
   * Tiers define zone ranges; the last tier extends to infinity.
   */
  getTierForDepth(depth) {
    const tiers = State.data.acts?.tiers;
    if (!tiers || !tiers.length) return this.currentAct; // fallback

    for (let i = tiers.length - 1; i >= 0; i--) {
      if (depth >= tiers[i].zoneStart) return tiers[i];
    }
    return tiers[0];
  },
  
  // Load/generate a zone (endless via depth)
  loadZone(index) {
    // Depth is 1-based
    const depth = index + 1;

    // Portal/zone transition SFX
    const AudioZ = State.modules?.Audio;
    if (AudioZ) AudioZ.portalEnter();

    // ── Auto-switch tier based on depth ──
    const newTier = this.getTierForDepth(depth);
    if (newTier && newTier.id !== this.currentAct?.id) {
      console.log(`[WORLD] Tier transition: ${this.currentAct?.name} -> ${newTier.name} at depth ${depth}`);
      const prevSeed = this.currentAct?.seed;
      this.currentAct = { ...newTier };
      this.currentAct.seed = prevSeed; // Keep seed chain continuous

      // Unlock next portal if entering its tier
      const portals = State.data.acts?.portals;
      if (portals) {
        const portal = portals.find(p => p.tierId === newTier.id);
        if (portal && !portal.unlocked) {
          portal.unlocked = true;
          if (!State.meta.portalsUnlocked) State.meta.portalsUnlocked = {};
          State.meta.portalsUnlocked[portal.id] = true;
          State.ui?.showAnnouncement?.('NEW PORTAL UNLOCKED: ' + portal.name);
        }
      }
    }

    const zoneSeed = MapGenerator.createZoneSeed(this.currentAct.seed, index);

    // Hybrid milestone unlocks (weighted randomness)
    DepthRules.maybeUnlock(depth, this.currentAct);
    DepthRules.recordDepth(depth);

    // Boss interval: configurable per tier (default 5)
    const bossInterval = this.currentAct.bossEvery || this.currentAct.zones || 5;
    const isBossZone = (depth % bossInterval) === 0;

    // Sample active modifiers for this zone
    const activeMods = DepthRules.sampleActive(depth, this.currentAct);
    
    // ═══ DIFFICULTY LANE MODIFIERS ═══
    const diff = State.run.difficulty || 'normal';
    const diffMods = this._getDifficultyMods(diff);
    
    // Inject difficulty-specific map mods
    if (diffMods.mapMods) {
      for (const m of diffMods.mapMods) {
        if (!activeMods.includes(m)) activeMods.push(m);
      }
    }

    if (isBossZone) {
      this.currentZone = MapGenerator.generateBossZone(this.currentAct, zoneSeed, { depth, mods: activeMods, difficulty: diff });
    } else {
      this.currentZone = MapGenerator.generate(this.currentAct, zoneSeed, { depth, mods: activeMods, difficulty: diff });
    }

    this.currentZone.depth = depth;
    this.currentZone.mods = activeMods;
    this.currentZone.difficulty = diff;

    this.zoneIndex = index;
    this.activeEnemies = [];
    State.world.zoneIndex = index;
    State.world.currentZone = this.currentZone;
    
    // ═══ ZONE OBJECTIVE → State.run ═══
    State.run.objective = this.currentZone.objective || null;
    if (State.run.objective) {
      const obj = State.run.objective;
      console.log(`[OBJECTIVE] ${obj.label}: ${obj.desc}`);
      // Announce to player after a short delay (let zone render first)
      setTimeout(() => {
        if (State.ui) {
          State.ui.announcement = { 
            text: `${obj.icon} ${obj.label}: ${obj.desc}`, 
            timer: 3.5 
          };
        }
        const Particles = State.modules?.Particles;
        const p = State.player;
        if (Particles && p) {
          Particles.text(p.x, p.y - 50, `${obj.icon} ${obj.label}`, '#ffcc00', 16);
        }
      }, 500);
    }
    // Apply route choice from previous zone (branch exits)
    if (State.run._nextRoute) {
      const route = State.run._nextRoute;
      // Extra modifiers from risky routes
      if (route.modifiers > 0 && this.currentZone.mods) {
        for (let i = 0; i < route.modifiers; i++) {
          const extraMod = DepthRules.sampleOne?.(depth) || 'swift';
          if (!this.currentZone.mods.includes(extraMod)) this.currentZone.mods.push(extraMod);
        }
      }
      // Vault zones are smaller and guaranteed rare+ reward
      if (route.isVault) {
        this.currentZone._isVault = true;
        this.currentZone._vaultLootMult = route.lootMult || 2.0;
      }
      this.currentZone._lootMult = route.lootMult || 1.0;
      State.run._nextRoute = null;
    }

    // Position player at spawn
    State.player.x = this.currentZone.spawn.x;
    State.player.y = this.currentZone.spawn.y;
    State.player.vx = 0;
    State.player.vy = 0;

    // Prepare tiled background (terrain tiles + fog + deco asteroids)
    try {
      Background.prepareZone(this.currentZone, zoneSeed, this.currentAct);
    } catch (e) { console.warn('[BG] prepareZone failed:', e); }

    // Snap camera to player
    const canvas = document.getElementById('gameCanvas');
    const screenW = canvas?.width || 800;
    const screenH = canvas?.height || 600;
    Camera.snapTo(
      State.player.x - screenW / 2,
      State.player.y - screenH / 2
    );

    // Reset zone-combat counters
    this.spawnedEnemyCount = 0;
    this.spawnedEliteCount = 0;
    this.bossSpawned = false;

    // ── AntiExploit: track seed usage for farming detection ──
    try {
      import('../AntiExploit.js').then(mod => {
        if (mod?.AntiExploit) {
          mod.AntiExploit.onZoneEnter(zoneSeed);
          mod.AntiExploit.snapshot();
        }
      });
    } catch (e) { /* AntiExploit not loaded yet – safe to skip */ }
  },
  
  // Update - handle proximity spawning
  update(dt) {
    if (!this.currentZone) return;
    
    const player = State.player;
    
    // Check enemy spawns
    for (const spawn of this.currentZone.enemySpawns) {
      if (spawn.killed) continue;
      
      const dist = Math.hypot(player.x - spawn.x, player.y - spawn.y);
      
      // Spawn if player close
      if (!spawn.active && dist < this.spawnRadius) {
        this.spawnEnemy(spawn, false);
      }
      
      // Despawn if too far (and not engaged)
      if (spawn.active && dist > this.despawnRadius) {
        // Only despawn when the enemy is effectively "idle" at home.
        // If it was engaged, force a return so it doesn't vanish mid-behavior.
        const enemy = State.enemies.find(e => e.id === spawn.enemyId);
        if (enemy) {
          if (enemy.aiState === 'aggro') enemy.aiState = 'return';

          const distHome = Math.hypot(enemy.x - spawn.x, enemy.y - spawn.y);
          const homeThreshold = enemy.returnThreshold || 60;
          if (enemy.aiState !== 'aggro' && distHome <= homeThreshold) {
            this.despawnEnemy(spawn);
          }
        } else {
          this.despawnEnemy(spawn);
        }
      }
    }
    
    // Check elite spawns
    for (const spawn of this.currentZone.eliteSpawns) {
      if (spawn.killed) continue;
      
      const dist = Math.hypot(player.x - spawn.x, player.y - spawn.y);
      
      if (!spawn.active && dist < this.spawnRadius) {
        this.spawnEnemy(spawn, true);
      }
    }
    
    // Check boss spawn
    if (this.currentZone.bossSpawn && !this.currentZone.bossSpawn.killed) {
      const spawn = this.currentZone.bossSpawn;
      const dist = Math.hypot(player.x - spawn.x, player.y - spawn.y);
      
      if (!spawn.active && dist < this.spawnRadius * 1.5) {
        this.spawnBoss(spawn);
      }
    }
    
    // Check exit collision
    if (this.currentZone.exit) {
      const exit = this.currentZone.exit;
      const obj = State.run.objective;
      const exitLocked = obj && obj.exitLocked && !obj.complete;
      
      // Branch exits (route choice portals)
      const branches = this.currentZone.branchExits;
      if (branches && !exitLocked) {
        for (const b of branches) {
          const bd = Math.hypot(player.x - b.x, player.y - b.y);
          if (bd < b.radius + 15) {
            // Store route choice for next zone
            State.run._nextRoute = { modifiers: b.modifiers, lootMult: b.lootMult, isVault: b.isVault };
            this.onExitReached();
            return; // prevent double trigger
          }
        }
      } else if (!exitLocked) {
        const dist = Math.hypot(player.x - exit.x, player.y - exit.y);
        if (dist < 50) {
          this.onExitReached();
        }
      }
    }
    
    // Check portal collision
    for (const portal of this.currentZone.portals) {
      const dist = Math.hypot(player.x - portal.x, player.y - portal.y);
      if (dist < 60) {
        this.onPortalEnter(portal);
      }
    }

    // ── POI System Update ──
    this._updatePOIs(dt);
    
    // ── Zone Objective Update ──
    this._updateObjective(dt);
    
    // ── Difficulty: Chaos Effects ──
    this._updateChaosEffects(dt);
    
    // ── Player vs Obstacle collision (pushback + mine detonation) ──
    const pRadius = player.radius || 15;
    const obstacles = this.currentZone.obstacles;
    if (obstacles) {
      for (let i = obstacles.length - 1; i >= 0; i--) {
        const obs = obstacles[i];
        if (!obs || obs.destroyed) continue;
        if (obs.type === 'poison_area') continue; // DOT only, no collision

        const dx = player.x - obs.x;
        const dy = player.y - obs.y;
        const dist = Math.hypot(dx, dy);
        const minDist = pRadius + (obs.radius || 30);

        if (dist < minDist && dist > 0.1) {
          if (obs.type === 'mine') {
            // MINE DETONATION
            const { Player: PlayerMod, Particles: ParticlesMod } = State.modules;
            const dmg = obs.damage || 15;
            if (PlayerMod) PlayerMod.takeDamage(dmg);
            if (ParticlesMod) {
              // Big multi-stage explosion
              ParticlesMod.explosion(obs.x, obs.y, '#ff4400', 30, 280);
              ParticlesMod.explosion(obs.x, obs.y, '#ffcc00', 15, 180);
              ParticlesMod.ring(obs.x, obs.y, '#ff6600', 60);
              ParticlesMod.ring(obs.x, obs.y, '#ffcc00', 35);
              ParticlesMod.flash(obs.x, obs.y, '#ffffff', 20);
              ParticlesMod.screenShake = Math.max(ParticlesMod.screenShake || 0, 8);
            }
            const AudioMod = State.modules?.Audio;
            if (AudioMod) AudioMod.mineExplosion();
            obs.destroyed = true;
            // Splash damage to nearby enemies
            for (const e of State.enemies) {
              if (e.dead) continue;
              const eDist = Math.hypot(e.x - obs.x, e.y - obs.y);
              if (eDist < 100) {
                const { Enemies: EnemiesMod } = State.modules;
                if (EnemiesMod) EnemiesMod.damage(e, dmg * 0.6, false);
              }
            }
          } else {
            // SOLID OBSTACLE: push player out
            const overlap = minDist - dist;
            const nx = dx / dist;
            const ny = dy / dist;
            player.x += nx * overlap;
            player.y += ny * overlap;
            // Dampen velocity into the obstacle
            const dot = player.vx * nx + player.vy * ny;
            if (dot < 0) {
              player.vx -= nx * dot * 0.8;
              player.vy -= ny * dot * 0.8;
            }
          }
        }
      }
    }
    
    // Enemy AI (patrol/aggro/return) is handled in Enemies.update() for exploration mode.
    
    // ── Biome Hazards ──
    this._updateHazards(dt);
    
    // ── Rebuild spatial hash for this frame ──
    // Enemies, asteroids, and player are indexed so Bullets.js
    // can do O(1) proximity queries instead of brute-force O(n²).
    if (!_grid) _grid = SpatialHash.create(128);
    SpatialHash.clear(_grid);
    for (const e of State.enemies) {
      if (!e.dead) SpatialHash.insert(_grid, e);
    }
    const zoneAst = this.currentZone?.obstacles;
    if (Array.isArray(zoneAst)) {
      for (const a of zoneAst) {
        if (a && !a.destroyed) SpatialHash.insert(_grid, a);
      }
    }
    // Expose grid for cross-module queries (Bullets.js)
    State._spatialGrid = _grid;
  },
  
  // ============================================================
  // POI System - Update + Draw
  // ============================================================
  
  _updatePOIs(dt) {
    const zone = this.currentZone;
    if (!zone || !zone.pois) return;
    
    const player = State.player;
    
    for (const poi of zone.pois) {
      if (poi.collected) continue;
      
      const dist = Math.hypot(player.x - poi.x, player.y - poi.y);
      
      // ── TRIGGER: player enters POI radius ──
      if (!poi.triggered && dist < poi.radius) {
        poi.triggered = true;
        
        // Ambush zones: spawn enemies with stagger
        if (poi.type === 'ambush_zone' && !poi._ambushStarted) {
          poi._ambushStarted = true;
          poi._ambushTimer = 0;
          if (State.ui) State.ui.announcement = { text: '⚠️ AMBUSH!', timer: 1.5 };
          const Audio = State.modules?.Audio;
          if (Audio?.alert) Audio.alert();
        }
        
        // Show POI label
        if (!poi._announced && poi.label) {
          if (State.ui) State.ui.announcement = { text: `${poi.icon || '📍'} ${poi.label}`, timer: 2 };
          poi._announced = true;
          if (!poi._ambushStarted) {
            const AudioPoi = State.modules?.Audio;
            if (AudioPoi?.poiTrigger) AudioPoi.poiTrigger();
          }
        }
      }
      
      // ── CHECK CLEARED: all POI enemies dead ──
      if (poi.triggered && !poi.cleared && poi.enemies && poi.enemies.length > 0) {
        const allDead = poi.enemies.every(e => {
          // Find matching spawn in zone
          const spawn = zone.enemySpawns.find(s => s.poiId === poi.id && 
            Math.abs(s.x - e.x) < 5 && Math.abs(s.y - e.y) < 5);
          return spawn ? spawn.killed : true;
        });
        if (allDead) {
          poi.cleared = true;
          if (poi.label) {
            if (State.ui) State.ui.announcement = { text: `✅ ${poi.label} CLEARED!`, timer: 2 };
          }
          const AudioClr = State.modules?.Audio;
          if (AudioClr?.poiCleared) AudioClr.poiCleared();
        }
      }
      
      // ── COLLECT REWARD: walk into cleared POI ──
      if (poi.cleared && !poi.collected && poi.reward && dist < 80) {
        this._collectPOIReward(poi);
      }
      
      // ── DEFENSE BEACON: interactable ──
      if (poi.type === 'defense_beacon' && poi.interactable && !poi.cleared && dist < poi.radius) {
        // Show interact prompt
        poi._showPrompt = true;
        
        // Check for E key press
        if (State.input?.interact) {
          State.input.interact = false;
          this._startBeaconDefense(poi);
        }
      } else if (poi._showPrompt) {
        poi._showPrompt = false;
      }
      
      // ── BEACON WAVE LOGIC ──
      if (poi._beaconActive) {
        poi._beaconTimer = (poi._beaconTimer || 0) + dt;
        
        // Spawn waves
        if (poi._beaconWave < poi.waveConfig.count) {
          const waveInterval = 8; // seconds between waves
          if (poi._beaconTimer >= waveInterval * (poi._beaconWave + 1)) {
            this._spawnBeaconWave(poi);
            poi._beaconWave++;
            if (State.ui) State.ui.announcement = { 
              text: `📡 WAVE ${poi._beaconWave}/${poi.waveConfig.count}`, timer: 1.5 
            };
          }
        }
        
        // Check if all beacon enemies are dead after final wave
        if (poi._beaconWave >= poi.waveConfig.count) {
          const allBeaconDead = (poi._beaconEnemyIds || []).every(eid => {
            const e = State.enemies.find(en => en.id === eid);
            return !e || e.dead;
          });
          if (allBeaconDead) {
            poi._beaconActive = false;
            poi.cleared = true;
            if (State.ui) State.ui.announcement = { text: '📡 BEACON DEFENDED! Rewards unlocked!', timer: 2.5 };
            const AudioBcn = State.modules?.Audio;
            if (AudioBcn?.beaconActivate) AudioBcn.beaconActivate();
          }
        }
      }
    }
  },
  
  _collectPOIReward(poi) {
    poi.collected = true;
    const AudioRwd = State.modules?.Audio;
    if (AudioRwd?.poiReward) AudioRwd.poiReward();
    const reward = poi.reward;
    
    if (reward.scrap) {
      State.meta.scrap = (State.meta.scrap || 0) + reward.scrap;
      State.pickups.push({
        type: 'scrap', x: poi.x, y: poi.y,
        vx: 0, vy: -20, life: 0.5, value: reward.scrap, _visual: true
      });
    }
    if (reward.cells) {
      State.run.cells = (State.run.cells || 0) + reward.cells;
    }
    if (reward.voidShards) {
      State.meta.voidShards = (State.meta.voidShards || 0) + reward.voidShards;
    }
    
    // Loot cache → spawn item pickup
    if (reward.type === 'loot_cache') {
      const ilvl = State.run.currentDepth || State.meta.level || 1;
      State.pickups.push({
        type: 'item', x: poi.x, y: poi.y + 10,
        vx: (Math.random() - 0.5) * 50, vy: -40 + Math.random() * 20,
        life: 20, rarity: reward.rarity || 'rare', ilvl
      });
      // Second item for epic+ POIs
      if (['epic', 'legendary', 'mythic'].includes(reward.rarity)) {
        State.pickups.push({
          type: 'item', x: poi.x + 15, y: poi.y - 10,
          vx: (Math.random() - 0.5) * 60, vy: -30 + Math.random() * 20,
          life: 20, rarity: reward.rarity === 'legendary' ? 'epic' : 'rare', ilvl
        });
      }
    }
    
    // Cells reward
    if (reward.type === 'cells') {
      State.run.cells = (State.run.cells || 0) + (reward.value || 0);
    }
    
    // VFX
    const Particles = State.modules?.Particles;
    if (Particles) {
      Particles.explosion(poi.x, poi.y, '#ffdd00', 20, 200);
      Particles.ring(poi.x, poi.y, '#ffaa00', 80);
    }
    
    // Announcement
    const parts = [];
    if (reward.scrap) parts.push(`+${reward.scrap} ⚙`);
    if (reward.cells) parts.push(`+${reward.cells} ⚡`);
    if (reward.voidShards) parts.push(`+${reward.voidShards} 💠`);
    if (reward.type === 'loot_cache') parts.push(`${reward.rarity} item!`);
    if (State.ui) State.ui.announcement = { text: `🎁 ${parts.join(' ')}`, timer: 2.5 };
    
    const Audio = State.modules?.Audio;
    if (Audio?.pickup) Audio.pickup();
  },
  
  _startBeaconDefense(poi) {
    poi._beaconActive = true;
    poi._beaconTimer = 0;
    poi._beaconWave = 0;
    poi._beaconEnemyIds = [];
    poi.interactable = false;
    if (State.ui) State.ui.announcement = { text: '📡 BEACON ACTIVATED! Defend!', timer: 2 };
    // Spawn first wave immediately
    this._spawnBeaconWave(poi);
    poi._beaconWave = 1;
  },
  
  _spawnBeaconWave(poi) {
    const { Enemies } = State.modules;
    if (!Enemies) return;
    
    const pool = poi.waveConfig.pool || ['grunt'];
    const count = poi.waveConfig.enemiesPerWave || 5;
    
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + Math.random() * 0.3;
      const dist = 300 + Math.random() * 150;
      const ex = poi.x + Math.cos(angle) * dist;
      const ey = poi.y + Math.sin(angle) * dist;
      
      const type = pool[Math.floor(Math.random() * pool.length)];
      const enemy = Enemies.spawn(type, ex, ey, false, false);
      if (enemy) {
        enemy.aiState = 'aggro'; // immediately aggressive
        poi._beaconEnemyIds.push(enemy.id);
      }
    }
  },
  
  _drawPOIs(ctx, screenW, screenH) {
    const zone = this.currentZone;
    if (!zone || !zone.pois) return;
    
    const t = Date.now() * 0.001;
    
    for (const poi of zone.pois) {
      if (poi.collected) continue;
      if (poi.hidden && !poi.triggered) continue;
      
      if (!Camera.isVisible(poi.x, poi.y, poi.radius + 100, screenW, screenH)) continue;
      
      // ── POI RADIUS INDICATOR ──
      // Subtle dashed circle showing POI area
      if (!poi.cleared) {
        ctx.save();
        ctx.setLineDash([8, 8]);
        ctx.strokeStyle = poi.cleared ? 'rgba(0,255,100,0.15)' : 'rgba(255,255,255,0.08)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(poi.x, poi.y, poi.radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }
      
      // ── FLOATING ICON ──
      const bobY = Math.sin(t * 2 + poi.x * 0.01) * 5;
      const iconY = poi.y - 40 + bobY;
      
      // Background circle
      const bgAlpha = poi.cleared ? 0.6 : 0.4;
      const bgColor = poi.cleared ? 'rgba(0,200,100,' + bgAlpha + ')' : 'rgba(40,40,60,' + bgAlpha + ')';
      ctx.fillStyle = bgColor;
      ctx.beginPath();
      ctx.arc(poi.x, iconY, 18, 0, Math.PI * 2);
      ctx.fill();
      
      // Border
      const borderColor = poi.cleared ? '#00ff88' : 
                           poi.triggered ? '#ffaa00' : '#888888';
      ctx.strokeStyle = borderColor;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(poi.x, iconY, 18, 0, Math.PI * 2);
      ctx.stroke();
      
      // Icon text
      ctx.fillStyle = '#ffffff';
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(poi.icon || '?', poi.x, iconY);
      
      // Label (only when close)
      const playerDist = Math.hypot(State.player.x - poi.x, State.player.y - poi.y);
      if (playerDist < poi.radius + 200) {
        ctx.fillStyle = borderColor;
        ctx.font = 'bold 10px Orbitron, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(poi.label || '', poi.x, iconY - 24);
        
        // Status text
        if (poi.cleared && !poi.collected && poi.reward) {
          ctx.fillStyle = '#00ff88';
          ctx.font = '9px Orbitron, sans-serif';
          const pulse = 0.7 + Math.sin(t * 4) * 0.3;
          ctx.globalAlpha = pulse;
          ctx.fillText('[ COLLECT ]', poi.x, iconY + 26);
          ctx.globalAlpha = 1;
        } else if (poi._showPrompt) {
          ctx.fillStyle = '#ffdd00';
          ctx.font = '9px Orbitron, sans-serif';
          ctx.fillText('[ PRESS E ]', poi.x, iconY + 26);
        } else if (poi.triggered && !poi.cleared) {
          ctx.fillStyle = '#ff6644';
          ctx.font = '9px Orbitron, sans-serif';
          ctx.fillText('[ CLEAR ENEMIES ]', poi.x, iconY + 26);
        }
      }
    }
  },
  
  // ============================================================
  // CHAOS MODE EFFECTS
  // ============================================================
  
  _updateChaosEffects(dt) {
    const diff = State.run.difficulty;
    if (diff !== 'chaos') return;
    
    const player = State.player;
    const zone = this.currentZone;
    if (!zone) return;
    
    // ── POISON AREAS: DOT when player stands in them ──
    for (const obs of zone.obstacles) {
      if (obs.type !== 'poison_area' || obs.destroyed) continue;
      const dist = Math.hypot(player.x - obs.x, player.y - obs.y);
      if (dist < obs.radius) {
        // Apply DOT
        const dotDmg = (obs.dotDamage || 3) * dt;
        const PlayerMod = State.modules?.Player;
        if (PlayerMod) PlayerMod.takeDamage(dotDmg);
        
        // Poison SFX (throttled)
        if (!this._lastPoisonSfx || Date.now() - this._lastPoisonSfx > 800) {
          const AudioMod = State.modules?.Audio;
          if (AudioMod?.poisonDot) AudioMod.poisonDot();
          this._lastPoisonSfx = Date.now();
        }
        
        // Green particles while in zone
        if (Math.random() < 0.3) {
          State.particles.push({
            x: player.x + (Math.random() - 0.5) * 30,
            y: player.y + (Math.random() - 0.5) * 30,
            vx: (Math.random() - 0.5) * 40,
            vy: -20 - Math.random() * 30,
            life: 0.5, maxLife: 0.6,
            color: '#44ff00', size: 3
          });
        }
      }
    }
    
    // ── HUNTING MINES: slowly track player ──
    for (const obs of zone.obstacles) {
      if (!obs.hunting || obs.destroyed || obs.type !== 'mine') continue;
      const dx = player.x - obs.x;
      const dy = player.y - obs.y;
      const dist = Math.hypot(dx, dy);
      
      // Only hunt within 600px
      if (dist < 600 && dist > 5) {
        const speed = (obs.huntSpeed || 40) * dt;
        obs.x += (dx / dist) * speed;
        obs.y += (dy / dist) * speed;
        
        // Alert beep when close (throttled)
        if (dist < 200 && (!obs._lastBeep || Date.now() - obs._lastBeep > 1500)) {
          const AudioMod = State.modules?.Audio;
          if (AudioMod?.huntingMineAlert) AudioMod.huntingMineAlert();
          obs._lastBeep = Date.now();
        }
      }
    }
  },

  // ============================================================
  // DIFFICULTY LANE SYSTEM
  // ============================================================
  // Normal: standard gameplay
  // Risk: high elite density, better loot and cells
  // Chaos: corrupted enemies, all elites, DOTs, hunting mines, poison, extreme loot
  
  _getDifficultyMods(difficulty) {
    switch (difficulty) {
      case 'risk':
        return {
          mapMods: ['ELITE_PACKS', 'FAST_ENEMIES'],
          enemyHPMult: 1.3,
          enemyDamageMult: 1.2,
          eliteDensityMult: 3.0,    // 3× elites
          lootRarityBoost: 1,       // +1 rarity tier on drops
          cellsMult: 1.8,           // +80% cells
          scrapMult: 1.5,           // +50% scrap
          xpMult: 1.5,             // +50% XP
          asteroidHPMult: 1.0,
          promotionChance: 0.0,     // no auto-elite promotion
          dotDamage: 0,
          huntingMines: false,
          poisonAreas: false,
          corruptVisual: false
        };
      case 'chaos':
        return {
          mapMods: ['ELITE_PACKS', 'BULLET_HELL', 'FAST_ENEMIES', 'MINEFIELD', 'DENSE_OBSTACLES'],
          enemyHPMult: 1.8,
          enemyDamageMult: 1.6,
          eliteDensityMult: 5.0,    // 5× elites
          lootRarityBoost: 2,       // +2 rarity tiers
          cellsMult: 3.0,           // 3× cells
          scrapMult: 2.5,           // 2.5× scrap
          xpMult: 2.5,             // 2.5× XP
          asteroidHPMult: 2.5,      // tougher asteroids
          promotionChance: 0.6,     // 60% chance each regular enemy → elite
          dotDamage: 3,             // environmental DOT per second
          huntingMines: true,       // mines track the player
          poisonAreas: true,        // toxic zones appear
          corruptVisual: true,      // purple tint on enemies
          voidShardMult: 3.0,       // 3× void shard drop rate
          cosmicDustMult: 5.0       // 5× cosmic dust drop rate
        };
      default: // 'normal'
        return {
          mapMods: [],
          enemyHPMult: 1.0,
          enemyDamageMult: 1.0,
          eliteDensityMult: 1.0,
          lootRarityBoost: 0,
          cellsMult: 1.0,
          scrapMult: 1.0,
          xpMult: 1.0,
          asteroidHPMult: 1.0,
          promotionChance: 0.0,
          dotDamage: 0,
          huntingMines: false,
          poisonAreas: false,
          corruptVisual: false
        };
    }
  },
  
  // Get current difficulty modifiers (accessible from other modules)
  getDiffMods() {
    return this._getDifficultyMods(State.run.difficulty || 'normal');
  },

  // ============================================================
  // MINIMAP POI MARKERS
  // ============================================================
  
  drawMinimapPOIs(ctx, mmX, mmY, mmW, mmH, zoneW, zoneH) {
    const zone = this.currentZone;
    if (!zone || !zone.pois) return;
    
    const scaleX = mmW / zoneW;
    const scaleY = mmH / zoneH;
    
    for (const poi of zone.pois) {
      if (poi.collected) continue;
      if (poi.hidden && !poi.triggered) continue;
      
      const px = mmX + poi.x * scaleX;
      const py = mmY + poi.y * scaleY;
      
      // Color by state
      if (poi.cleared) {
        ctx.fillStyle = '#00ff88';
      } else if (poi.triggered) {
        ctx.fillStyle = '#ffaa00';
      } else {
        ctx.fillStyle = '#888888';
      }
      
      // Diamond marker
      const s = 3;
      ctx.beginPath();
      ctx.moveTo(px, py - s);
      ctx.lineTo(px + s, py);
      ctx.lineTo(px, py + s);
      ctx.lineTo(px - s, py);
      ctx.closePath();
      ctx.fill();
    }
    
    // Resource node markers (smaller dots)
    if (zone.resourceNodes) {
      for (const node of zone.resourceNodes) {
        if (node.destroyed) continue;
        const nx = mmX + node.x * scaleX;
        const ny = mmY + node.y * scaleY;
        ctx.fillStyle = node.glow || '#ffaa00';
        ctx.globalAlpha = 0.6;
        ctx.beginPath();
        ctx.arc(nx, ny, 2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  },

  // ── Biome Hazard System ──
  _updateHazards(dt) {
    const zone = this.currentZone;
    if (!zone) return;
    const hazards = this.currentAct?.hazards || [];
    if (hazards.length === 0) return;
    
    const player = State.player;
    const PlayerMod = State.modules?.Player;
    const Particles = State.modules?.Particles;
    
    // Lazy-init hazard zones (placed during zone generation, stored on zone)
    if (!zone._hazardZones) {
      zone._hazardZones = [];
      const rng = { range: (a,b) => a + Math.random() * (b-a) };
      for (const h of hazards) {
        const count = h === 'gravity_wells' ? 2 : (h === 'void_rifts' ? 3 : 4);
        for (let i = 0; i < count; i++) {
          zone._hazardZones.push({
            type: h,
            x: rng.range(100, zone.width - 100),
            y: rng.range(100, zone.height - 100),
            radius: h === 'gravity_wells' ? 200 : (h === 'void_rifts' ? 150 : 120),
            strength: 1.0
          });
        }
      }
      zone._hazardTimer = 0;
    }
    
    zone._hazardTimer = (zone._hazardTimer || 0) + dt;
    
    for (const hz of zone._hazardZones) {
      const dx = player.x - hz.x;
      const dy = player.y - hz.y;
      const dist = Math.hypot(dx, dy);
      if (dist > hz.radius * 1.5) continue; // out of range
      
      const inZone = dist < hz.radius;
      const falloff = inZone ? 1.0 : Math.max(0, 1 - (dist - hz.radius) / (hz.radius * 0.5));
      
      switch (hz.type) {
        case 'toxic_clouds':
          // Periodic damage inside cloud (1% maxHP/s)
          if (inZone && PlayerMod) {
            hz._dmgTimer = (hz._dmgTimer || 0) + dt;
            if (hz._dmgTimer >= 0.5) {
              hz._dmgTimer = 0;
              PlayerMod.takeDamage(Math.max(1, Math.floor(player.maxHP * 0.005)));
            }
          }
          break;
          
        case 'gravity_wells':
          // Pull player toward center
          if (dist > 10 && dist < hz.radius * 1.3) {
            const pull = 80 * falloff * dt;
            player.x -= (dx / dist) * pull;
            player.y -= (dy / dist) * pull;
          }
          break;
          
        case 'void_rifts':
          // Intermittent damage pulse every 2s
          if (inZone && PlayerMod) {
            hz._pulseTimer = (hz._pulseTimer || 0) + dt;
            if (hz._pulseTimer >= 2.0) {
              hz._pulseTimer = 0;
              PlayerMod.takeDamage(Math.max(2, Math.floor(player.maxHP * 0.02)));
              if (Particles) {
                Particles.ring(hz.x, hz.y, '#8800ff', hz.radius * 0.6);
                Particles.flash(player.x, player.y, '#aa44ff', 8);
              }
            }
          }
          break;
          
        case 'radiation_pockets':
          // Slow + damage over time
          if (inZone) {
            player.vx *= (1 - 0.3 * dt); // slight slow
            player.vy *= (1 - 0.3 * dt);
            hz._dmgTimer = (hz._dmgTimer || 0) + dt;
            if (hz._dmgTimer >= 1.0 && PlayerMod) {
              hz._dmgTimer = 0;
              PlayerMod.takeDamage(Math.max(1, Math.floor(player.maxHP * 0.008)));
            }
          }
          break;
          
        case 'debris_storm':
          // Random projectile-like hits
          if (inZone) {
            hz._stormTimer = (hz._stormTimer || 0) + dt;
            if (hz._stormTimer >= 1.5) {
              hz._stormTimer = 0;
              if (Math.random() < 0.4 && PlayerMod) {
                PlayerMod.takeDamage(Math.max(2, Math.floor(player.maxHP * 0.015)));
                if (Particles) {
                  Particles.explosion(player.x, player.y, '#887766', 6, 80);
                }
              }
            }
          }
          break;
      }
    }
  },
  
  // Draw hazard zones (called from draw)
  _drawHazards(ctx) {
    const zone = this.currentZone;
    if (!zone?._hazardZones) return;
    const t = performance.now() * 0.001;
    const screenW = ctx.canvas?.width || 1920;
    const screenH = ctx.canvas?.height || 1080;
    
    for (const hz of zone._hazardZones) {
      if (!Camera.isVisible(hz.x, hz.y, hz.radius * 2, screenW, screenH)) continue;
      
      ctx.save();
      const pulse = 0.4 + Math.sin(t * 2 + hz.x * 0.01) * 0.15;
      
      switch (hz.type) {
        case 'toxic_clouds': {
          const grad = ctx.createRadialGradient(hz.x, hz.y, 0, hz.x, hz.y, hz.radius);
          grad.addColorStop(0, `rgba(0,180,0,${pulse * 0.25})`);
          grad.addColorStop(0.6, `rgba(0,120,0,${pulse * 0.15})`);
          grad.addColorStop(1, 'rgba(0,80,0,0)');
          ctx.fillStyle = grad;
          ctx.beginPath(); ctx.arc(hz.x, hz.y, hz.radius, 0, Math.PI * 2); ctx.fill();
          // Swirl particles
          ctx.strokeStyle = `rgba(0,255,0,${pulse * 0.2})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(hz.x, hz.y, hz.radius * 0.5 + Math.sin(t * 3) * 15, t * 0.5, t * 0.5 + 2);
          ctx.stroke();
          break;
        }
        case 'gravity_wells': {
          // Dark vortex
          const grad = ctx.createRadialGradient(hz.x, hz.y, 0, hz.x, hz.y, hz.radius);
          grad.addColorStop(0, `rgba(20,0,40,${pulse * 0.6})`);
          grad.addColorStop(0.5, `rgba(40,0,80,${pulse * 0.3})`);
          grad.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = grad;
          ctx.beginPath(); ctx.arc(hz.x, hz.y, hz.radius, 0, Math.PI * 2); ctx.fill();
          // Spiral arms
          ctx.strokeStyle = `rgba(100,50,200,${pulse * 0.35})`;
          ctx.lineWidth = 2;
          for (let arm = 0; arm < 3; arm++) {
            ctx.beginPath();
            const offset = (arm / 3) * Math.PI * 2;
            for (let s = 0; s < 30; s++) {
              const angle = offset + t * 1.5 + s * 0.2;
              const r = 10 + s * (hz.radius * 0.03);
              const px = hz.x + Math.cos(angle) * r;
              const py = hz.y + Math.sin(angle) * r;
              s === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
            }
            ctx.stroke();
          }
          break;
        }
        case 'void_rifts': {
          const grad = ctx.createRadialGradient(hz.x, hz.y, 0, hz.x, hz.y, hz.radius);
          grad.addColorStop(0, `rgba(100,0,180,${pulse * 0.4})`);
          grad.addColorStop(0.7, `rgba(60,0,120,${pulse * 0.2})`);
          grad.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = grad;
          ctx.beginPath(); ctx.arc(hz.x, hz.y, hz.radius, 0, Math.PI * 2); ctx.fill();
          // Crackling edge
          ctx.strokeStyle = `rgba(180,80,255,${0.3 + Math.sin(t * 8 + hz.y) * 0.2})`;
          ctx.lineWidth = 1.5;
          ctx.setLineDash([4, 8]);
          ctx.beginPath(); ctx.arc(hz.x, hz.y, hz.radius * 0.8, 0, Math.PI * 2); ctx.stroke();
          ctx.setLineDash([]);
          break;
        }
        case 'radiation_pockets': {
          const grad = ctx.createRadialGradient(hz.x, hz.y, 0, hz.x, hz.y, hz.radius);
          grad.addColorStop(0, `rgba(200,200,0,${pulse * 0.2})`);
          grad.addColorStop(0.5, `rgba(180,120,0,${pulse * 0.12})`);
          grad.addColorStop(1, 'rgba(100,80,0,0)');
          ctx.fillStyle = grad;
          ctx.beginPath(); ctx.arc(hz.x, hz.y, hz.radius, 0, Math.PI * 2); ctx.fill();
          // Warning symbol
          ctx.strokeStyle = `rgba(255,200,0,${pulse * 0.4})`;
          ctx.lineWidth = 2;
          const sz = 12;
          ctx.beginPath();
          ctx.moveTo(hz.x, hz.y - sz);
          ctx.lineTo(hz.x - sz * 0.87, hz.y + sz * 0.5);
          ctx.lineTo(hz.x + sz * 0.87, hz.y + sz * 0.5);
          ctx.closePath();
          ctx.stroke();
          break;
        }
        case 'debris_storm': {
          ctx.globalAlpha = pulse * 0.3;
          ctx.fillStyle = '#665544';
          // Floating debris chunks
          for (let i = 0; i < 6; i++) {
            const angle = t * 0.4 + i * 1.05;
            const r = hz.radius * (0.3 + (i % 3) * 0.2);
            const cx = hz.x + Math.cos(angle) * r;
            const cy = hz.y + Math.sin(angle) * r;
            ctx.fillRect(cx - 3, cy - 2, 6, 4);
          }
          // Dust haze
          const grad = ctx.createRadialGradient(hz.x, hz.y, 0, hz.x, hz.y, hz.radius);
          grad.addColorStop(0, `rgba(80,60,40,${pulse * 0.15})`);
          grad.addColorStop(1, 'rgba(40,30,20,0)');
          ctx.globalAlpha = 1;
          ctx.fillStyle = grad;
          ctx.beginPath(); ctx.arc(hz.x, hz.y, hz.radius, 0, Math.PI * 2); ctx.fill();
          break;
        }
      }
      ctx.restore();
    }
  },
  
  // Spawn regular enemy
  spawnEnemy(spawn, isElite = false) {
    const { Enemies } = State.modules;
    
    // Calculate level based on player
    const playerLvl = State.meta.level || 1;
    let enemyLvl;
    
    if (isElite) {
      enemyLvl = playerLvl; // Elite = same level
    } else {
      enemyLvl = Math.max(1, playerLvl - 1 - Math.floor(Math.random() * 2));
    }
    
    // Create enemy
    const enemy = Enemies.spawn(spawn.type, spawn.x, spawn.y, isElite, false);
    enemy.spawnRef = spawn;
    enemy.level = enemyLvl;

    // World AI baseline (patrol -> aggro -> return)
    const patrolType = spawn.patrol || (isElite ? 'circle' : 'wander');
    const patrolRadius = spawn.patrolRadius || (isElite ? 140 : 110);

    enemy.homeX = spawn.x;
    enemy.homeY = spawn.y;
    enemy.aiState = 'patrol';
    enemy.patrol = patrolType;
    enemy.patrolRadius = patrolRadius;
    enemy.patrolAngle = Math.random() * Math.PI * 2;
    enemy.patrolDir = Math.random() < 0.5 ? -1 : 1;
    enemy.patrolTimer = 0;
    enemy.wanderTarget = null;
    enemy.wanderTimer = 0;

    // Engagement envelope (tuned for exploration)
    enemy.aggroRange = spawn.aggroRange || (isElite ? 520 : 420);
    enemy.attackRange = spawn.attackRange || enemy.aggroRange;
    enemy.disengageRange = spawn.disengageRange || enemy.aggroRange * 1.65;
    enemy.leashRange = spawn.leashRange || Math.max(enemy.aggroRange * 2.2, patrolRadius * 5);
    enemy.returnThreshold = Math.max(40, enemy.size * 1.2);
    
    // Scale stats by level (gentler curve: +6%/lvl keeps TTK stable)
    const levelScale = Math.pow(1.06, enemyLvl - 1);
    enemy.hp *= levelScale;
    enemy.maxHP *= levelScale;
    enemy.damage *= levelScale;
    enemy.xp = Math.floor(enemy.xp * levelScale);
    
    // ═══ DIFFICULTY SCALING ═══
    const diffMods = this.getDiffMods();
    enemy.hp *= diffMods.enemyHPMult;
    enemy.maxHP *= diffMods.enemyHPMult;
    enemy.damage *= diffMods.enemyDamageMult;
    enemy.xp = Math.floor(enemy.xp * diffMods.xpMult);
    
    // Chaos: promote regular enemies to elite with chance
    if (!isElite && diffMods.promotionChance > 0 && Math.random() < diffMods.promotionChance) {
      enemy.isElite = true;
      enemy.hp *= 1.5;
      enemy.maxHP *= 1.5;
      enemy.damage *= 1.3;
      enemy.xp = Math.floor(enemy.xp * 1.5);
      enemy.size = (enemy.size || 20) * 1.2;
    }
    
    // Chaos: corrupt visual tint
    if (diffMods.corruptVisual) {
      enemy._corrupt = true;
      enemy._corruptColor = '#aa22ff';
    }
    
    spawn.active = true;
    spawn.enemyId = enemy.id;
    
    this.activeEnemies.push(enemy);
  },
  
  // Spawn boss
  spawnBoss(spawn) {
    const { Enemies } = State.modules;
    
    const playerLvl = State.meta.level || 1;
    const bossLvl = playerLvl + Math.floor(Math.random() * 3); // +0 to +2 (was +5)
    
    const enemy = Enemies.spawn(spawn.type, spawn.x, spawn.y, false, true);
    enemy.spawnRef = spawn;
    enemy.level = bossLvl;

    // Boss AI baseline
    enemy.homeX = spawn.x;
    enemy.homeY = spawn.y;
    enemy.aiState = 'patrol';
    enemy.patrol = spawn.patrol || 'circle';
    enemy.patrolRadius = spawn.patrolRadius || 220;
    enemy.patrolAngle = Math.random() * Math.PI * 2;
    enemy.patrolDir = 1;
    enemy.patrolTimer = 0;

    enemy.aggroRange = spawn.aggroRange || 750;
    enemy.attackRange = spawn.attackRange || enemy.aggroRange;
    enemy.disengageRange = spawn.disengageRange || enemy.aggroRange * 1.5;
    enemy.leashRange = spawn.leashRange || Math.max(enemy.aggroRange * 2.0, enemy.patrolRadius * 6);
    enemy.returnThreshold = Math.max(60, enemy.size * 1.2);

    // Scale boss (gentler: +8%/lvl, was +15%)
    const levelScale = Math.pow(1.08, bossLvl - 1);
    enemy.hp *= levelScale;
    enemy.maxHP *= levelScale;
    enemy.damage *= levelScale;
    
    spawn.active = true;
    spawn.enemyId = enemy.id;
    
    // Announce boss
    State.ui?.showAnnouncement?.(`[!] ${enemy.name || 'BOSS'} APPEARS!`);
    const Audio = State.modules?.Audio;
    if (Audio) Audio.bossSpawn();
  },
  
  // Despawn enemy (too far)
  despawnEnemy(spawn) {
    // Remove from State.enemies
    const idx = State.enemies.findIndex(e => e.id === spawn.enemyId);
    if (idx !== -1) {
      State.enemies.splice(idx, 1);
    }
    
    spawn.active = false;
    spawn.enemyId = null;
    
    // Remove from active list
    this.activeEnemies = this.activeEnemies.filter(e => e.spawnRef !== spawn);
  },
  
  // Called when enemy dies
  onEnemyKilled(enemy) {
    if (enemy.spawnRef) {
      enemy.spawnRef.killed = true;
      enemy.spawnRef.active = false;
    }
    
    // Check if boss
    if (enemy.isBoss && this.currentZone.bossSpawn) {
      this.onBossKilled();
    }
  },
  
  // Boss killed - spawn portal to NEXT ZONE (not hub!)
  onBossKilled() {
    const nextDepth = this.zoneIndex + 2; // current index + 1 = current depth, +1 = next
    State.ui?.showAnnouncement?.('BOSS DEFEATED! Portal to Zone ' + nextDepth);
    
    // Spawn portal that advances to next zone
    this.currentZone.portals.push({
      x: this.currentZone.width / 2,
      y: this.currentZone.height / 2,
      destination: 'nextZone',
      type: 'victory'
    });

    // Also grant option to return to hub (small side portal)
    this.currentZone.portals.push({
      x: this.currentZone.width / 2 - 120,
      y: this.currentZone.height / 2 + 80,
      destination: 'hub',
      type: 'hub'
    });
  },
  
  // Player reached zone exit
  onExitReached() {
    this._checkZoneMastery();
    
    // ═══ OBJECTIVE REWARDS ON EXIT ═══
    const obj = State.run.objective;
    if (obj) {
      const Particles = State.modules?.Particles;
      const p = State.player;
      
      // Time trial: check if completed in time
      if (obj.type === 'timetrial' && !obj.failed && !obj.complete) {
        obj.complete = true;
        if (Particles) Particles.text(p.x, p.y - 40, '⚡ SPEED BONUS!', '#ffcc00', 16);
        if (State.ui) State.ui.announcement = { text: '⚡ TIME TRIAL COMPLETE', timer: 2.0 };
      }
      
      // Award bonus loot for completed objectives
      if (obj.complete && obj.bonusLoot) {
        const bl = obj.bonusLoot;
        if (bl.scrap) { State.run.scrapEarned += bl.scrap; }
        if (bl.cells) { State.run.cells += bl.cells; }
        if (Particles && p) {
          Particles.text(p.x, p.y - 20, `+${bl.scrap || 0}💰 +${bl.cells || 0}⚡`, '#ffcc00', 12);
        }
      }
      
      // Corruption: bonus scales with how long player stayed
      if (obj.type === 'corruption' && obj.progress > 20) {
        const corruptionBonus = Math.floor(obj.progress * 2);
        State.run.scrapEarned += corruptionBonus;
        if (Particles && p) {
          Particles.text(p.x, p.y - 55, `☠️ CORRUPTION BONUS +${corruptionBonus}`, '#ff6644', 12);
        }
      }
    }
    
    const nextZone = this.zoneIndex + 1;
    this._updateHighestZone(nextZone + 1);
    this.loadZone(nextZone);
  },
  
  // Player entered portal
  onPortalEnter(portal) {
    if (portal.destination === 'hub') {
      // Transition to hub — save progress first
      this._checkZoneMastery();
      this._updateHighestZone(this.zoneIndex + 1);
      State.scene = 'hub';
      State.ui?.renderHub?.();
    } else if (portal.destination === 'nextZone') {
      // Advance to next zone (endless progression!)
      this._checkZoneMastery();
      const nextIndex = this.zoneIndex + 1;
      console.log(`[WORLD] Portal -> Zone ${nextIndex + 1}`);
      this.loadZone(nextIndex);
    } else if (typeof portal.destination === 'number') {
      // Jump to specific zone depth
      this.loadZone(portal.destination - 1);
    } else if (portal.destination) {
      // Load specific act/zone (legacy)
      this.init(portal.destination);
    }
  },
  
  // ═══ ZONE OBJECTIVE UPDATE ═══
  _updateObjective(dt) {
    const obj = State.run.objective;
    if (!obj || obj.complete) return;
    
    switch (obj.type) {
      case 'survival': {
        // Timer counts up, complete when target reached
        obj.progress += dt;
        if (obj.progress >= obj.target) {
          obj.complete = true;
          // Award bonus
          const Particles = State.modules?.Particles;
          const p = State.player;
          if (Particles) {
            Particles.text(p.x, p.y - 40, '✓ SURVIVED — EXIT OPEN', '#00ff88', 18);
            Particles.ring(p.x, p.y, '#00ff88', 80);
          }
          if (State.ui) State.ui.announcement = { text: '✓ SURVIVAL COMPLETE', timer: 2.5 };
          const Audio = State.modules?.Audio;
          if (Audio?.levelUp) Audio.levelUp();
        }
        break;
      }
      case 'timetrial': {
        // Timer counts up, fail if exceeds target
        if (!obj.failed) {
          obj.progress += dt;
          if (obj.progress >= obj.target) {
            obj.failed = true;
            if (State.ui) State.ui.announcement = { text: '⚡ TIME EXPIRED — No bonus', timer: 2.0 };
          }
        }
        break;
      }
      case 'corruption': {
        // Zone gets harder over time
        obj.progress += obj.corruptionRate * dt;
        obj.currentMult = 1.0 + (obj.progress / 100) * 2.0; // up to 3× at 100%
        // Tint screen increasingly red (handled in draw)
        break;
      }
      // exterminate + lockdown: progress tracked in Bullets.onEnemyKilled
    }
  },
  
  // ═══ ZONE MASTERY BONUS ═══
  // If player cleared 80%+ of POIs → bonus scrap/cells/XP burst
  _checkZoneMastery() {
    const zone = this.currentZone;
    if (!zone || !zone.pois || zone.pois.length === 0) return;
    if (zone._masteryChecked) return; // only once per zone
    zone._masteryChecked = true;
    
    const total = zone.pois.length;
    const cleared = zone.pois.filter(p => p.cleared || p.collected).length;
    const ratio = cleared / total;
    
    if (ratio < 0.8) return; // need 80%+ to trigger
    
    // Calculate bonus based on zone depth and difficulty
    const depth = this.zoneIndex + 1;
    const diffMods = this.getDiffMods();
    const bonusScrap = Math.floor((50 + depth * 10) * (diffMods.scrapMult || 1));
    const bonusCells = Math.floor((20 + depth * 5) * (diffMods.cellsMult || 1));
    const bonusXP = Math.floor((100 + depth * 25) * (diffMods.xpMult || 1));
    
    // Apply rewards
    State.run.scrapEarned += bonusScrap;
    State.run.cells += bonusCells;
    import('../Leveling.js').then(module => {
      module.Leveling.addXP(bonusXP);
    });
    
    // Announcement
    const pct = Math.floor(ratio * 100);
    if (State.ui) {
      State.ui.announcement = { 
        text: `⭐ ZONE MASTERED (${pct}%) — +${bonusScrap}💰 +${bonusCells}⚡ +${bonusXP}XP`, 
        timer: 3 
      };
    }
    
    // Audio + VFX
    const AudioZM = State.modules?.Audio;
    if (AudioZM?.zoneMastered) AudioZM.zoneMastered();
    const Particles = State.modules?.Particles;
    if (Particles) {
      Particles.explosion(State.player.x, State.player.y, '#ffcc00', 30, 300);
      Particles.ring(State.player.x, State.player.y, '#ffcc00', 200);
      Particles.ring(State.player.x, State.player.y, '#ffffff', 120);
      Particles.screenShake = Math.max(Particles.screenShake || 0, 6);
    }
    
    console.log(`[WORLD] Zone Mastery! ${cleared}/${total} POIs (${pct}%) → +${bonusScrap} scrap, +${bonusCells} cells, +${bonusXP} XP`);
  },
  
  // Track highest zone per difficulty lane
  _updateHighestZone(zone) {
    const diff = State.run.difficulty || 'normal';
    if (!State.meta.highestZones) State.meta.highestZones = { normal: 0, risk: 0, chaos: 0 };
    State.meta.highestZones[diff] = Math.max(State.meta.highestZones[diff] || 0, zone);
    // Also keep legacy field for backwards compat
    State.meta.highestZone = Math.max(
      State.meta.highestZones.normal || 0,
      State.meta.highestZones.risk || 0,
      State.meta.highestZones.chaos || 0
    );
  },
  
  // Update enemy patrol behavior
  updateEnemyPatrols(dt) {
    for (const enemy of this.activeEnemies) {
      if (!enemy.patrol || enemy.dead) continue;
      
      switch (enemy.patrol) {
        case 'circle':
          enemy.patrolAngle += dt * 0.5;
          enemy.x = enemy.patrolOrigin.x + Math.cos(enemy.patrolAngle) * enemy.patrolRadius;
          enemy.y = enemy.patrolOrigin.y + Math.sin(enemy.patrolAngle) * enemy.patrolRadius;
          break;
          
        case 'line':
          enemy.patrolAngle += dt * 0.8;
          enemy.x = enemy.patrolOrigin.x + Math.sin(enemy.patrolAngle) * enemy.patrolRadius;
          break;
          
        case 'wander':
          // Random direction changes
          if (Math.random() < dt * 0.5) {
            enemy.vx = (Math.random() - 0.5) * enemy.speed;
            enemy.vy = (Math.random() - 0.5) * enemy.speed;
          }
          // Stay near origin
          const dist = Math.hypot(
            enemy.x - enemy.patrolOrigin.x,
            enemy.y - enemy.patrolOrigin.y
          );
          if (dist > enemy.patrolRadius) {
            const angle = Math.atan2(
              enemy.patrolOrigin.y - enemy.y,
              enemy.patrolOrigin.x - enemy.x
            );
            enemy.vx = Math.cos(angle) * enemy.speed * 0.5;
            enemy.vy = Math.sin(angle) * enemy.speed * 0.5;
          }
          break;
      }
    }
  },
  
  // Draw zone elements (obstacles, decorations)
  draw(ctx, screenW, screenH) {
    if (!this.currentZone) return;
    
    // ── LAYER 1: Dust clouds + Nebula patches (behind everything) ──
    // Reduce alpha when tiled background is active (tiles already provide atmosphere)
    const hasTiles = !!this.currentZone._bg;
    const decoAlphaScale = hasTiles ? 0.3 : 1.0;
    
    for (const dec of this.currentZone.decorations) {
      if (dec.type !== 'dust_cloud' && dec.type !== 'nebula_patch') continue;
      if (!Camera.isVisible(dec.x, dec.y, (dec.width || dec.radius || 400) + 200, screenW, screenH)) continue;
      
      ctx.save();
      ctx.translate(dec.x, dec.y);
      ctx.rotate(dec.rotation || 0);
      ctx.globalAlpha = (dec.alpha || 0.1) * decoAlphaScale;
      
      if (dec.type === 'dust_cloud') {
        // Large soft ellipse
        const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, dec.width * 0.5);
        grad.addColorStop(0, dec.color || '#221144');
        grad.addColorStop(1, 'transparent');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.ellipse(0, 0, dec.width * 0.5, dec.height * 0.5, 0, 0, Math.PI * 2);
        ctx.fill();
      } else if (dec.type === 'nebula_patch') {
        // Circular nebula glow
        const r = dec.radius || 200;
        const grad = ctx.createRadialGradient(0, 0, r * 0.1, 0, 0, r);
        grad.addColorStop(0, dec.color || '#4400aa');
        grad.addColorStop(0.6, dec.color ? dec.color + '44' : '#4400aa44');
        grad.addColorStop(1, 'transparent');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
    
    // ── LAYER 2: Landmarks (large background structures) ──
    for (const dec of this.currentZone.decorations) {
      if (!['rock_formation', 'ice_cluster', 'ancient_marker', 'dead_ship', 'mining_rig',
            'station_hull', 'antenna_array', 'cargo_pod', 'solar_panel', 'gas_cloud',
            'comet_trail', 'beacon_ruins'].includes(dec.type)) continue;
      if (!Camera.isVisible(dec.x, dec.y, 200, screenW, screenH)) continue;
      
      ctx.save();
      ctx.translate(dec.x, dec.y);
      ctx.rotate(dec.rotation || 0);
      ctx.globalAlpha = dec.alpha || 0.6;
      const s = (dec.scale || 1) * 40;
      
      switch (dec.type) {
        case 'rock_formation': {
          // Cluster of overlapping dark rocks
          ctx.fillStyle = '#334455';
          for (let i = 0; i < 4; i++) {
            const ox = (i - 1.5) * s * 0.4;
            const oy = (i % 2 - 0.5) * s * 0.3;
            ctx.beginPath();
            ctx.arc(ox, oy, s * (0.3 + (i % 3) * 0.15), 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.fillStyle = '#223344';
          ctx.beginPath(); ctx.arc(0, 0, s * 0.5, 0, Math.PI * 2); ctx.fill();
          break;
        }
        case 'ice_cluster': {
          ctx.fillStyle = 'rgba(100,180,255,0.3)';
          for (let i = 0; i < 5; i++) {
            const a = (i / 5) * Math.PI * 2;
            const d = s * 0.3;
            ctx.beginPath();
            // Diamond shapes
            const cx = Math.cos(a) * d, cy = Math.sin(a) * d;
            const r = s * (0.15 + (i % 3) * 0.08);
            ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r * 0.6, cy);
            ctx.lineTo(cx, cy + r); ctx.lineTo(cx - r * 0.6, cy);
            ctx.closePath(); ctx.fill();
          }
          break;
        }
        case 'dead_ship': {
          // Hull silhouette
          ctx.fillStyle = '#2a3040';
          ctx.beginPath();
          ctx.moveTo(-s, -s * 0.15);
          ctx.lineTo(-s * 0.3, -s * 0.4);
          ctx.lineTo(s * 0.8, -s * 0.15);
          ctx.lineTo(s, s * 0.1);
          ctx.lineTo(s * 0.3, s * 0.35);
          ctx.lineTo(-s * 0.7, s * 0.2);
          ctx.closePath(); ctx.fill();
          // Window lights (flickering)
          const flicker = dec.variant;
          if (flicker !== 2) {
            ctx.fillStyle = 'rgba(255,100,50,0.4)';
            ctx.beginPath(); ctx.arc(-s * 0.2, -s * 0.1, 3, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.arc(s * 0.1, 0, 2, 0, Math.PI * 2); ctx.fill();
          }
          // Broken antenna
          ctx.strokeStyle = '#445566';
          ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.moveTo(-s * 0.5, -s * 0.3); ctx.lineTo(-s * 0.6, -s * 0.6); ctx.stroke();
          break;
        }
        case 'ancient_marker': {
          // Alien obelisk
          const grad = ctx.createLinearGradient(0, -s * 0.6, 0, s * 0.6);
          grad.addColorStop(0, '#556688');
          grad.addColorStop(1, '#223344');
          ctx.fillStyle = grad;
          ctx.fillRect(-s * 0.08, -s * 0.5, s * 0.16, s);
          // Glow rune
          ctx.fillStyle = 'rgba(0,200,255,0.3)';
          ctx.beginPath(); ctx.arc(0, -s * 0.15, s * 0.07, 0, Math.PI * 2); ctx.fill();
          ctx.beginPath(); ctx.arc(0, s * 0.15, s * 0.05, 0, Math.PI * 2); ctx.fill();
          break;
        }
        case 'mining_rig': {
          // Industrial structure
          ctx.fillStyle = '#3a3a40';
          ctx.fillRect(-s * 0.3, -s * 0.5, s * 0.6, s);
          ctx.fillStyle = '#555560';
          ctx.fillRect(-s * 0.5, -s * 0.15, s, s * 0.3);
          // Arm
          ctx.strokeStyle = '#666670';
          ctx.lineWidth = 3;
          ctx.beginPath(); ctx.moveTo(s * 0.5, 0); ctx.lineTo(s * 0.9, -s * 0.3); ctx.stroke();
          // Warning light
          ctx.fillStyle = 'rgba(255,200,0,0.3)';
          ctx.beginPath(); ctx.arc(-s * 0.2, -s * 0.4, 4, 0, Math.PI * 2); ctx.fill();
          break;
        }
        case 'station_hull': {
          // Large curved hull section
          ctx.strokeStyle = '#445566';
          ctx.lineWidth = 6;
          ctx.beginPath();
          ctx.arc(0, s * 0.8, s * 1.2, -Math.PI * 0.7, -Math.PI * 0.3);
          ctx.stroke();
          // Panel detail
          ctx.strokeStyle = '#334455';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(0, s * 0.8, s * 1.1, -Math.PI * 0.65, -Math.PI * 0.35);
          ctx.stroke();
          break;
        }
        case 'gas_cloud': {
          const colors = ['#442266', '#224466', '#226644', '#664422'];
          const col = colors[dec.variant] || colors[0];
          for (let i = 0; i < 3; i++) {
            const r = s * (0.6 - i * 0.15);
            const grad = ctx.createRadialGradient(i * 10, i * 5, 0, i * 10, i * 5, r);
            grad.addColorStop(0, col);
            grad.addColorStop(1, 'transparent');
            ctx.fillStyle = grad;
            ctx.beginPath(); ctx.arc(i * 10, i * 5, r, 0, Math.PI * 2); ctx.fill();
          }
          break;
        }
        case 'comet_trail': {
          ctx.strokeStyle = 'rgba(150,200,255,0.25)';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(-s, -s * 0.2);
          ctx.quadraticCurveTo(0, 0, s * 1.5, s * 0.1);
          ctx.stroke();
          // Head
          ctx.fillStyle = 'rgba(200,230,255,0.4)';
          ctx.beginPath(); ctx.arc(-s, -s * 0.2, 6, 0, Math.PI * 2); ctx.fill();
          break;
        }
        default: {
          // Fallback: simple shape
          ctx.fillStyle = '#334455';
          ctx.beginPath(); ctx.arc(0, 0, s * 0.4, 0, Math.PI * 2); ctx.fill();
          break;
        }
      }
      ctx.restore();
    }
    ctx.globalAlpha = 1;

    // ── LAYER 3: Small decorations (stars, rocks, sparkles) ──
    for (const dec of this.currentZone.decorations) {
      if (['dust_cloud', 'nebula_patch', 'rock_formation', 'ice_cluster', 'ancient_marker',
           'dead_ship', 'mining_rig', 'station_hull', 'antenna_array', 'cargo_pod',
           'solar_panel', 'gas_cloud', 'comet_trail', 'beacon_ruins'].includes(dec.type)) continue;
      if (!Camera.isVisible(dec.x, dec.y, 50, screenW, screenH)) continue;
      
      ctx.globalAlpha = dec.alpha || 0.5;
      const color = dec.color || '#888888';
      const sz = (dec.size || 2) * (dec.scale || 1);
      
      switch (dec.type) {
        case 'star_bright':
          ctx.fillStyle = color;
          ctx.beginPath(); ctx.arc(dec.x, dec.y, sz, 0, Math.PI * 2); ctx.fill();
          // Cross flare
          ctx.strokeStyle = color;
          ctx.lineWidth = 0.5;
          ctx.beginPath(); ctx.moveTo(dec.x - sz * 2, dec.y); ctx.lineTo(dec.x + sz * 2, dec.y); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(dec.x, dec.y - sz * 2); ctx.lineTo(dec.x, dec.y + sz * 2); ctx.stroke();
          break;
        case 'star_colored':
          ctx.fillStyle = color;
          ctx.shadowColor = color;
          ctx.shadowBlur = 4;
          ctx.beginPath(); ctx.arc(dec.x, dec.y, sz * 0.8, 0, Math.PI * 2); ctx.fill();
          ctx.shadowBlur = 0;
          break;
        case 'sparkle': {
          const t = Date.now() * 0.003 + dec.x;
          ctx.globalAlpha = (dec.alpha || 0.5) * (0.5 + Math.sin(t) * 0.5);
          ctx.fillStyle = color;
          ctx.beginPath(); ctx.arc(dec.x, dec.y, sz * 0.6, 0, Math.PI * 2); ctx.fill();
          break;
        }
        case 'light_flicker': {
          const t2 = Date.now() * 0.005 + dec.y;
          ctx.globalAlpha = Math.sin(t2) > 0.3 ? (dec.alpha || 0.5) : 0;
          ctx.fillStyle = color;
          ctx.beginPath(); ctx.arc(dec.x, dec.y, sz, 0, Math.PI * 2); ctx.fill();
          break;
        }
        case 'ice_shard':
          ctx.fillStyle = color;
          ctx.save();
          ctx.translate(dec.x, dec.y);
          ctx.rotate(dec.rotation || 0);
          ctx.beginPath();
          ctx.moveTo(0, -sz * 1.5); ctx.lineTo(sz * 0.5, 0);
          ctx.lineTo(0, sz); ctx.lineTo(-sz * 0.5, 0);
          ctx.closePath(); ctx.fill();
          ctx.restore();
          break;
        default:
          // Generic small dot
          ctx.fillStyle = color;
          ctx.beginPath(); ctx.arc(dec.x, dec.y, sz * 0.7, 0, Math.PI * 2); ctx.fill();
          break;
      }
    }
    ctx.globalAlpha = 1;
    
    // Draw biome hazards (behind obstacles, above background)
    this._drawHazards(ctx);
    
    // Draw obstacles
    for (const obs of this.currentZone.obstacles) {
      if (obs.destroyed) continue;
      if (!Camera.isVisible(obs.x, obs.y, 100, screenW, screenH)) continue;
      
      ctx.save();
      ctx.translate(obs.x, obs.y);
      ctx.rotate(obs.rotation || 0);
      
      // Draw based on type
      switch (obs.type) {
        case 'asteroid': {
          // Multi-layer asteroid with craters
          const r = obs.radius;
          // Base shape (irregular circle via noise)
          const grad = ctx.createRadialGradient(r * 0.3, -r * 0.3, r * 0.1, 0, 0, r);
          grad.addColorStop(0, '#8899aa');
          grad.addColorStop(0.6, '#556677');
          grad.addColorStop(1, '#334455');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(0, 0, r, 0, Math.PI * 2);
          ctx.fill();
          // Crater marks
          ctx.fillStyle = 'rgba(0,0,0,0.2)';
          ctx.beginPath(); ctx.arc(r * 0.3, r * 0.2, r * 0.25, 0, Math.PI * 2); ctx.fill();
          ctx.beginPath(); ctx.arc(-r * 0.2, -r * 0.3, r * 0.15, 0, Math.PI * 2); ctx.fill();
          // Edge highlight
          ctx.strokeStyle = 'rgba(150,170,190,0.3)';
          ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.arc(0, 0, r, -0.5, 1.2); ctx.stroke();
          break;
        }
        case 'debris': {
          // Tumbling metal shard
          const r = obs.radius;
          ctx.fillStyle = '#556677';
          ctx.beginPath();
          ctx.moveTo(-r, -r * 0.3);
          ctx.lineTo(-r * 0.3, -r * 0.6);
          ctx.lineTo(r * 0.8, -r * 0.2);
          ctx.lineTo(r, r * 0.5);
          ctx.lineTo(-r * 0.5, r * 0.4);
          ctx.closePath();
          ctx.fill();
          ctx.strokeStyle = '#778899';
          ctx.lineWidth = 1;
          ctx.stroke();
          break;
        }
        case 'mine': {
          // Pulsing danger mine
          const pulse = 0.8 + Math.sin(Date.now() * 0.005) * 0.2;
          const r = obs.radius;
          ctx.fillStyle = '#cc2222';
          ctx.shadowColor = '#ff4444';
          ctx.shadowBlur = 12 * pulse;
          ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
          // Danger symbol - inner ring
          ctx.strokeStyle = '#ffcc00';
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(0, 0, r * 0.55, 0, Math.PI * 2); ctx.stroke();
          // Core
          ctx.fillStyle = '#ffdd00';
          ctx.beginPath(); ctx.arc(0, 0, r * 0.25, 0, Math.PI * 2); ctx.fill();
          ctx.shadowBlur = 0;
          break;
        }
        case 'pillar': {
          // Ancient pillar / space station ruin
          const r = obs.radius;
          const grad = ctx.createRadialGradient(0, 0, r * 0.2, 0, 0, r);
          grad.addColorStop(0, '#99aabb');
          grad.addColorStop(1, '#556677');
          ctx.fillStyle = grad;
          ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
          // Ring detail
          ctx.strokeStyle = '#aabbcc';
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(0, 0, r * 0.7, 0, Math.PI * 2); ctx.stroke();
          ctx.strokeStyle = 'rgba(0,200,255,0.15)';
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.arc(0, 0, r * 0.85, 0, Math.PI * 2); ctx.stroke();
          break;
        }
        // ── RESOURCE NODES ──
        case 'ore_rich': {
          const r = obs.radius;
          const glow = obs.glow || '#ffaa00';
          // Glowing asteroid with veins
          const grad = ctx.createRadialGradient(r * 0.2, -r * 0.2, r * 0.1, 0, 0, r);
          grad.addColorStop(0, '#aa8844');
          grad.addColorStop(0.5, '#665533');
          grad.addColorStop(1, '#443322');
          ctx.fillStyle = grad;
          ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
          // Gold veins
          ctx.strokeStyle = glow;
          ctx.lineWidth = 2;
          ctx.globalAlpha = 0.6 + Math.sin(Date.now() * 0.003) * 0.3;
          ctx.beginPath(); ctx.moveTo(-r * 0.5, -r * 0.3); ctx.lineTo(r * 0.2, r * 0.4); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(r * 0.1, -r * 0.6); ctx.lineTo(r * 0.5, r * 0.1); ctx.stroke();
          ctx.globalAlpha = 1;
          // Outer glow
          ctx.shadowColor = glow;
          ctx.shadowBlur = 15 + Math.sin(Date.now() * 0.004) * 5;
          ctx.strokeStyle = glow;
          ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.arc(0, 0, r + 3, 0, Math.PI * 2); ctx.stroke();
          ctx.shadowBlur = 0;
          break;
        }
        case 'crystal_node': {
          const r = obs.radius;
          const glow = obs.glow || '#00aaff';
          // Crystal shape (hexagonal)
          ctx.fillStyle = glow;
          ctx.globalAlpha = 0.4 + Math.sin(Date.now() * 0.004) * 0.2;
          ctx.beginPath();
          for (let v = 0; v < 6; v++) {
            const a = (v / 6) * Math.PI * 2 - Math.PI / 6;
            const px = Math.cos(a) * r;
            const py = Math.sin(a) * r;
            v === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
          }
          ctx.closePath(); ctx.fill();
          ctx.globalAlpha = 1;
          // Inner crystal
          ctx.fillStyle = '#ffffff';
          ctx.globalAlpha = 0.3;
          ctx.beginPath();
          for (let v = 0; v < 6; v++) {
            const a = (v / 6) * Math.PI * 2;
            const px = Math.cos(a) * r * 0.5;
            const py = Math.sin(a) * r * 0.5;
            v === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
          }
          ctx.closePath(); ctx.fill();
          ctx.globalAlpha = 1;
          // Glow
          ctx.shadowColor = glow;
          ctx.shadowBlur = 20 + Math.sin(Date.now() * 0.005) * 8;
          ctx.strokeStyle = glow;
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.arc(0, 0, r + 5, 0, Math.PI * 2); ctx.stroke();
          ctx.shadowBlur = 0;
          break;
        }
        case 'void_crystal': {
          const r = obs.radius;
          const glow = obs.glow || '#aa55ff';
          const t = Date.now() * 0.002;
          // Dark crystal with purple glow
          ctx.fillStyle = '#1a0033';
          ctx.beginPath();
          for (let v = 0; v < 5; v++) {
            const a = (v / 5) * Math.PI * 2 + t * 0.3;
            const px = Math.cos(a) * r * (0.8 + Math.sin(t + v) * 0.2);
            const py = Math.sin(a) * r * (0.8 + Math.cos(t + v) * 0.2);
            v === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
          }
          ctx.closePath(); ctx.fill();
          // Pulsing void glow
          ctx.shadowColor = glow;
          ctx.shadowBlur = 25 + Math.sin(t * 2) * 10;
          ctx.strokeStyle = glow;
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(0, 0, r + 4, 0, Math.PI * 2); ctx.stroke();
          // Inner void
          ctx.fillStyle = glow;
          ctx.globalAlpha = 0.3 + Math.sin(t * 3) * 0.15;
          ctx.beginPath(); ctx.arc(0, 0, r * 0.35, 0, Math.PI * 2); ctx.fill();
          ctx.globalAlpha = 1;
          ctx.shadowBlur = 0;
          break;
        }
        case 'salvage_wreck': {
          const r = obs.radius;
          const glow = obs.glow || '#88ff44';
          // Ship hull fragment
          ctx.fillStyle = '#445566';
          ctx.beginPath();
          ctx.moveTo(-r * 0.8, -r * 0.4);
          ctx.lineTo(r * 0.9, -r * 0.2);
          ctx.lineTo(r * 0.7, r * 0.5);
          ctx.lineTo(-r * 0.3, r * 0.6);
          ctx.lineTo(-r, r * 0.1);
          ctx.closePath(); ctx.fill();
          // Panel lines
          ctx.strokeStyle = '#667788';
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(-r * 0.5, -r * 0.3); ctx.lineTo(-r * 0.5, r * 0.4); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(r * 0.2, -r * 0.2); ctx.lineTo(r * 0.2, r * 0.5); ctx.stroke();
          // Salvage indicator glow
          ctx.shadowColor = glow;
          ctx.shadowBlur = 12 + Math.sin(Date.now() * 0.003) * 4;
          ctx.fillStyle = glow;
          ctx.globalAlpha = 0.4;
          ctx.beginPath(); ctx.arc(0, 0, r * 0.3, 0, Math.PI * 2); ctx.fill();
          ctx.globalAlpha = 1;
          ctx.shadowBlur = 0;
          break;
        }
        case 'poison_area': {
          // Toxic green zone (no collision, just visual)
          const r = obs.radius;
          const t = Date.now() * 0.001;
          const pulse = 0.15 + Math.sin(t * 1.5) * 0.05;
          ctx.fillStyle = `rgba(40,255,0,${pulse})`;
          ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
          // Toxic border
          ctx.strokeStyle = `rgba(80,255,20,${pulse + 0.1})`;
          ctx.lineWidth = 2;
          ctx.setLineDash([6, 4]);
          ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
          ctx.setLineDash([]);
          // Inner toxic bubbles
          for (let i = 0; i < 3; i++) {
            const bx = Math.sin(t * 2 + i * 2.1) * r * 0.4;
            const by = Math.cos(t * 1.7 + i * 1.8) * r * 0.4;
            ctx.fillStyle = `rgba(100,255,50,${0.2 + Math.sin(t * 3 + i) * 0.1})`;
            ctx.beginPath(); ctx.arc(bx, by, 8 + Math.sin(t * 4 + i) * 3, 0, Math.PI * 2); ctx.fill();
          }
          // Skull icon center
          ctx.fillStyle = `rgba(255,255,255,${0.3 + Math.sin(t * 2) * 0.1})`;
          ctx.font = '16px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('☠', 0, 0);
          break;
        }
        case 'generator': {
          // Lockdown objective: pulsing red generator
          const r = obs.radius || 30;
          const t = Date.now() * 0.001;
          const pulse = 0.7 + Math.sin(t * 4) * 0.3;
          // Base structure
          ctx.fillStyle = '#442222';
          ctx.beginPath();
          for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2;
            const mx = i === 0 ? 'moveTo' : 'lineTo';
            ctx[mx](Math.cos(a) * r, Math.sin(a) * r);
          }
          ctx.closePath();
          ctx.fill();
          // Red glow core
          ctx.shadowColor = '#ff4444';
          ctx.shadowBlur = 20 * pulse;
          ctx.fillStyle = `rgba(255,60,60,${0.5 + pulse * 0.3})`;
          ctx.beginPath();
          ctx.arc(0, 0, r * 0.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
          // Label
          ctx.fillStyle = '#ff6666';
          ctx.font = 'bold 10px Orbitron';
          ctx.textAlign = 'center';
          ctx.fillText('GEN', 0, r + 16);
          break;
        }
      }
      
      ctx.restore();
    }
    
    // Draw POI indicators (above obstacles, below exit/portals)
    this._drawPOIs(ctx, screenW, screenH);
    
    // Draw exit marker (objective-aware)
    if (this.currentZone.exit) {
      const exit = this.currentZone.exit;
      const t = Date.now() * 0.001;
      const pulse = 0.7 + Math.sin(t * 3) * 0.3;
      const obj = State.run.objective;
      const locked = obj && obj.exitLocked && !obj.complete;
      const branches = this.currentZone.branchExits;
      
      if (branches && !locked) {
        // ── BRANCH EXITS: draw route choice portals ──
        for (const b of branches) {
          ctx.save();
          // Outer ring
          ctx.strokeStyle = b.color + '66';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(b.x, b.y, b.radius + 5 + Math.sin(t * 2) * 3, 0, Math.PI * 2);
          ctx.stroke();
          // Portal glow
          const grad = ctx.createRadialGradient(b.x, b.y, 5, b.x, b.y, b.radius);
          grad.addColorStop(0, b.color + 'cc');
          grad.addColorStop(0.6, b.color + '44');
          grad.addColorStop(1, b.color + '00');
          ctx.fillStyle = grad;
          ctx.shadowColor = b.color;
          ctx.shadowBlur = 20 * pulse;
          ctx.beginPath();
          ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
          // Icon
          ctx.font = '16px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillStyle = '#fff';
          ctx.fillText(b.icon, b.x, b.y + 2);
          // Label
          ctx.font = 'bold 9px Orbitron';
          ctx.fillStyle = b.color;
          ctx.fillText(b.label, b.x, b.y - b.radius - 8);
          // Desc
          ctx.font = '8px sans-serif';
          ctx.fillStyle = '#aaa';
          ctx.fillText(b.desc, b.x, b.y + b.radius + 14);
          ctx.restore();
        }
      } else {
        // ── SINGLE EXIT (locked or normal) ──
        const exitColor = locked ? '#ff4444' : '#00ff88';
        const exitLabel = locked ? '🔒 LOCKED' : 'EXIT';
        // Outer glow ring
        ctx.strokeStyle = locked ? 'rgba(255,60,60,0.3)' : 'rgba(0,255,136,0.3)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(exit.x, exit.y, 38 + Math.sin(t * 2) * 4, 0, Math.PI * 2);
        ctx.stroke();
        // Main circle
        const exitGrad = ctx.createRadialGradient(exit.x, exit.y, 5, exit.x, exit.y, 30);
        if (locked) {
          exitGrad.addColorStop(0, 'rgba(255,80,80,0.6)');
          exitGrad.addColorStop(0.7, 'rgba(180,40,40,0.3)');
          exitGrad.addColorStop(1, 'rgba(100,20,20,0)');
        } else {
          exitGrad.addColorStop(0, 'rgba(0,255,180,0.8)');
          exitGrad.addColorStop(0.7, 'rgba(0,200,100,0.4)');
          exitGrad.addColorStop(1, 'rgba(0,100,50,0)');
        }
        ctx.fillStyle = exitGrad;
        ctx.shadowColor = exitColor;
        ctx.shadowBlur = 25 * pulse;
        ctx.beginPath();
        ctx.arc(exit.x, exit.y, 30, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        // Label
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 12px Orbitron';
        ctx.textAlign = 'center';
        ctx.fillText(exitLabel, exit.x, exit.y + 4);
      }
    }
    
    // Draw portals
    for (const portal of this.currentZone.portals) {
      const t = Date.now() * 0.001;
      const pulse = Math.sin(t * 2.5) * 0.3 + 0.7;
      const isHub = portal.type === 'hub' || portal.destination === 'hub';
      const isVictory = portal.type === 'victory';
      const baseR = isHub ? 22 : 36;
      const r = baseR * (0.9 + pulse * 0.1);

      const color = isVictory ? '#ffdd00' : (isHub ? '#4488cc' : '#8800ff');
      const colorDim = isVictory ? 'rgba(255,200,0,0)' : (isHub ? 'rgba(60,120,200,0)' : 'rgba(100,0,200,0)');

      // Swirl rings (rotating)
      ctx.save();
      ctx.translate(portal.x, portal.y);
      for (let ring = 0; ring < 3; ring++) {
        const ringR = r + ring * 6;
        const ringAlpha = 0.15 - ring * 0.04;
        ctx.globalAlpha = ringAlpha * pulse;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(0, 0, ringR, t * (1 + ring * 0.5), t * (1 + ring * 0.5) + Math.PI * 1.3);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // Core gradient
      const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(0.3, color);
      grad.addColorStop(1, colorDim);
      ctx.fillStyle = grad;
      ctx.shadowColor = color;
      ctx.shadowBlur = 30 * pulse;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      // Label
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold ' + (isHub ? '9' : '11') + 'px Orbitron';
      ctx.textAlign = 'center';
      const label = isHub ? 'HUB' : ('ZONE ' + (this.zoneIndex + 2));
      ctx.fillText(label, 0, 4);
      ctx.restore();
    }
  },
  
  // Draw parallax background layers
  drawParallaxBackground(ctx, screenW, screenH) {
    // Try tiled terrain background first (tile_void, tile_toxicity, etc.)
    if (this.currentZone?._bg) {
      const drawn = Background.draw(ctx, screenW, screenH, this.currentZone);
      if (drawn) return; // Tiled BG handled everything
    }
    
    // Fallback: procedural starfield
    if (!this.currentZone?.parallax) return;
    
    const parallax = this.currentZone.parallax;
    const camX = Camera.getX();
    const camY = Camera.getY();
    
    // Layer 0: Background color
    ctx.fillStyle = parallax.background.color;
    ctx.fillRect(0, 0, screenW, screenH);
    
    // Layer 0: Deep stars
    const bgOffsetX = camX * parallax.background.scrollSpeed;
    const bgOffsetY = camY * parallax.background.scrollSpeed;
    
    ctx.fillStyle = '#ffffff';
    for (const star of parallax.background.stars) {
      const x = ((star.x - bgOffsetX) % screenW + screenW) % screenW;
      const y = ((star.y - bgOffsetY) % screenH + screenH) % screenH;
      
      let brightness = star.brightness;
      if (star.twinkle) {
        brightness *= 0.5 + Math.sin(Date.now() / 500 + star.x) * 0.5;
      }
      
      ctx.globalAlpha = brightness;
      ctx.beginPath();
      ctx.arc(x, y, star.size, 0, Math.PI * 2);
      ctx.fill();
    }
    
    // Layer 1: Mid stars
    const midOffsetX = camX * parallax.midground.scrollSpeed;
    const midOffsetY = camY * parallax.midground.scrollSpeed;
    
    for (const star of parallax.midground.stars) {
      const x = ((star.x - midOffsetX) % screenW + screenW) % screenW;
      const y = ((star.y - midOffsetY) % screenH + screenH) % screenH;
      
      ctx.globalAlpha = star.brightness;
      ctx.beginPath();
      ctx.arc(x, y, star.size * 1.2, 0, Math.PI * 2);
      ctx.fill();
    }
    
    ctx.globalAlpha = 1;
  },

  drawParallaxForeground(ctx, screenW, screenH) {
    // Skip foreground overlays when tiled background is active
    // (wisps + tiles = visual mud; tiles already provide atmosphere)
    if (this.currentZone?._bg) return;
    
    if (!this.currentZone?.parallax) return;
    
    const parallax = this.currentZone.parallax;
    const camX = Camera.getX();
    const camY = Camera.getY();
    
        // Layer 2: Nebula wisps
    if (parallax.foreground.objects) {
      const fgOffsetX = camX * parallax.foreground.scrollSpeed;
      const fgOffsetY = camY * parallax.foreground.scrollSpeed;
      
      for (const wisp of parallax.foreground.objects) {
        const x = wisp.x - fgOffsetX;
        const y = wisp.y - fgOffsetY;
        
        ctx.globalAlpha = wisp.alpha;
        ctx.fillStyle = wisp.color;
        ctx.beginPath();
        ctx.ellipse(x, y, wisp.width / 2, wisp.height / 2, wisp.rotation, 0, Math.PI * 2);
        ctx.fill();
      }
      
      ctx.globalAlpha = 1;
    }
  },

  drawParallax(ctx, screenW, screenH) {
    // Back-compat: some callers still use drawParallax()
    this.drawParallaxBackground(ctx, screenW, screenH);
    this.drawParallaxForeground(ctx, screenW, screenH);
  }
};

export default World;