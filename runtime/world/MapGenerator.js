// Copyright (c) Manfred Foissner. All rights reserved.
// License: See LICENSE.txt in the project root.

// ============================================================
// MapGenerator.js - Procedural Map Generation
// ============================================================
// Generates zones from seed + act config
// Same seed = same map layout

import { SeededRandom } from './SeededRandom.js';
import { State } from '../State.js';

export const MapGenerator = {
  
  // Generate a zone from act config and seed
  generate(actConfig, zoneSeed, options = {}) {
    const rng = new SeededRandom(zoneSeed);
    const cfg = actConfig.generation || {};
    const pickRange = (v, fallbackMin, fallbackMax) => {
      if (Array.isArray(v) && v.length >= 2) return rng.int(v[0], v[1]);
      if (typeof v === 'number') return v;
      return rng.int(fallbackMin, fallbackMax);
    };


    const depth = options.depth || 1;
    const mods = options.mods || [];

    // Apply depth & modifiers to generation parameters (combinatorial, no run is the same)
    const modSet = new Set(mods);
    const scale = (v, mult) => v * mult;

    // Base depth ramps (gentle; combat scaling handled elsewhere)
    const depthEnemyMult = 1 + Math.min(depth * 0.012, 1.6);  // up to +160%
    const depthEliteMult = 1 + Math.min(depth * 0.010, 1.2);  // up to +120%
    const depthObsMult   = 1 + Math.min(depth * 0.008, 1.0);  // up to +100%

    let enemyDensity = (cfg.enemyDensity || 0.0005) * depthEnemyMult;
    let eliteDensity = (cfg.eliteDensity || 0.00008) * depthEliteMult;
    let obstacleDensity = (cfg.obstacleDensity || 0.0002) * depthObsMult;

    // Modifier effects (kept small but cumulative)
    if (modSet.has('BULLET_HELL')) enemyDensity = scale(enemyDensity, 1.35);
    if (modSet.has('ELITE_PACKS')) eliteDensity = scale(eliteDensity, 1.55);
    if (modSet.has('FAST_ENEMIES')) enemyDensity = scale(enemyDensity, 1.10);
    if (modSet.has('DENSE_OBSTACLES')) obstacleDensity = scale(obstacleDensity, 1.35);
    if (modSet.has('MINEFIELD')) obstacleDensity = scale(obstacleDensity, 1.15);
    let crampedMult = 1.0;
    if (modSet.has('CRAMPED_ZONE')) crampedMult = 0.85;

    // ═══ DIFFICULTY LANE MULTIPLIERS ═══
    const diff = options.difficulty || 'normal';
    if (diff === 'risk') {
      eliteDensity *= 3.0;
    } else if (diff === 'chaos') {
      eliteDensity *= 5.0;
      enemyDensity *= 1.3;
      obstacleDensity *= 1.4;
    }

    // Global exploration tuning overrides (config.json)
    // These exist to keep the engine testable (lower density / calmer combat) without touching act data.
    const tune = State.data.config?.exploration || {};
    if (typeof tune.enemyDensityMult === 'number') enemyDensity *= tune.enemyDensityMult;
    if (typeof tune.eliteDensityMult === 'number') eliteDensity *= tune.eliteDensityMult;
    
    // Zone dimensions
    let width = pickRange(cfg.width, 1500, 3000);
    let height = pickRange(cfg.height, 1500, 3000);
    if (crampedMult !== 1.0) { width = Math.floor(width * crampedMult); height = Math.floor(height * crampedMult); }

    // Map scale (exploration tuning)
    // NOTE: We intentionally scale the *world size* without scaling enemy counts linearly.
    // Density and hard caps (maxEnemySpawnsPerZone) remain the primary knobs to keep zones testable.
    const mapScale = (typeof tune.mapScale === 'number' && isFinite(tune.mapScale) && tune.mapScale > 0)
      ? tune.mapScale
      : 1.0;
    if (mapScale !== 1.0) {
      width = Math.max(600, Math.floor(width * mapScale));
      height = Math.max(600, Math.floor(height * mapScale));
    }
    
    // Generate zone structure
    const zone = {
      seed: zoneSeed,
      width: width,
      height: height,
      biome: actConfig.biome || 'space',
      
      // Spawn point (usually near edge)
      spawn: this.generateSpawnPoint(rng, width, height, cfg),
      
      // Exit point (opposite side from spawn)
      exit: null,
      
      // Enemy spawn positions
      enemySpawns: [],
      
      // Elite spawn positions  
      eliteSpawns: [],
      
      // Boss spawn (only in boss zones)
      bossSpawn: null,
      
      // Obstacles/Collision
      obstacles: [],
      
      // Decoration (asteroids, debris, etc)
      decorations: [],
      
      // Parallax layers
      parallax: this.generateParallax(rng, actConfig, width, height),
      
      // Pickups placed on map
      pickups: [],
      
      // Portals
      portals: []
    };
    
    // Generate exit opposite to spawn
    zone.exit = this.generateExitPoint(rng, zone.spawn, width, height);
    
    // Generate enemy spawns based on act config
    zone.enemySpawns = this.generateEnemySpawns(
      rng, 
      actConfig.enemies?.pool || ['grunt'],
      enemyDensity,
      width, 
      height,
      zone.spawn,
      zone.exit
    );

    // Optional: apply pack director (v9A0). Packs consume the existing spawn budget.
    // This keeps density/perf stable while adding composition variety.
    zone.enemySpawns = this.applyPackDirector(
      rng,
      zone.enemySpawns,
      actConfig.enemies?.pool || ['grunt'],
      zone.spawn,
      zone.exit
    );
    
    // Generate elite spawns
    zone.eliteSpawns = this.generateEliteSpawns(
      rng,
      actConfig.enemies?.elitePool || ['commander'],
      eliteDensity,
      width,
      height
    );
    
    // Generate obstacles
    zone.obstacles = this.generateObstacles(
      rng,
      obstacleDensity,
      width,
      height,
      { depth, mods }
    );
    
    // Generate decorations
    zone.decorations = this.generateDecorations(
      rng,
      actConfig.biome,
      width,
      height
    );
    
    // ========== POI SYSTEM ==========
    // Points of Interest give structure and reason to explore
    zone.pois = this.generatePOIs(rng, zone, actConfig, options);
    
    // ========== RESOURCE NODES ==========
    // Special destructible asteroids that drop crafting materials
    zone.resourceNodes = this.generateResourceNodes(rng, zone, actConfig, options);
    
    // ========== ZONE OBJECTIVE ==========
    // Gives each zone a purpose beyond "reach exit"
    zone.objective = this.generateObjective(rng, zone, depth);
    
    // ========== BRANCHING EXITS ==========
    // After depth 3, offer route choices at zone end
    if (depth >= 3) {
      zone.branchExits = this.generateBranchExits(rng, zone, depth);
    }
    
    return zone;
  },
  
  // Generate boss zone
  generateBossZone(actConfig, zoneSeed, options = {}) {
    const rng = new SeededRandom(zoneSeed);
    const cfg = actConfig.boss || {};
    
    // Boss arenas are more structured
    const width = cfg.arenaWidth || 1200;
    const height = cfg.arenaHeight || 1000;
    
    const zone = {
      seed: zoneSeed,
      width: width,
      height: height,
      biome: actConfig.biome,
      isBossZone: true,
      
      spawn: { x: width / 2, y: height - 100 },
      exit: null, // Portal appears after boss kill
      
      bossSpawn: { 
        x: width / 2, 
        y: 200,
        type: cfg.type || rng.pick(actConfig.enemies?.bossPool || ['sentinel'])
      },
      
      enemySpawns: [], // Boss spawns adds
      eliteSpawns: [],
      obstacles: this.generateBossArenaObstacles(rng, width, height),
      decorations: [],
      parallax: this.generateParallax(rng, actConfig, width, height),
      pickups: [],
      portals: []
    };
    
    return zone;
  },
  
  // Spawn point generation
  generateSpawnPoint(rng, w, h, cfg) {
    const edge = rng.pick(['bottom', 'left', 'right']);
    const margin = 100;
    
    switch (edge) {
      case 'bottom':
        return { x: rng.range(margin, w - margin), y: h - margin };
      case 'left':
        return { x: margin, y: rng.range(margin, h - margin) };
      case 'right':
        return { x: w - margin, y: rng.range(margin, h - margin) };
      default:
        return { x: w / 2, y: h - margin };
    }
  },
  
  // Exit point (opposite to spawn)
  generateExitPoint(rng, spawn, w, h) {
    const margin = 100;
    
    // If spawn is bottom, exit is top
    if (spawn.y > h / 2) {
      return { x: rng.range(margin, w - margin), y: margin };
    }
    // If spawn is left, exit is right
    if (spawn.x < w / 2) {
      return { x: w - margin, y: rng.range(margin, h - margin) };
    }
    // Otherwise exit is left
    return { x: margin, y: rng.range(margin, h - margin) };
  },
  
  // Enemy spawn positions
  generateEnemySpawns(rng, pool, density, w, h, spawn, exit) {
    const spawns = [];
    // Density is expressed as spawns per pixel^2.
    // We hard-cap the final amount to avoid runaway zones and keep perf + readability stable.
    const tune = State.data.config?.exploration || {};
    const maxSpawns = (typeof tune.maxEnemySpawnsPerZone === 'number') ? tune.maxEnemySpawnsPerZone : 120;
    const countRaw = Math.floor(w * h * density);
    const count = Math.max(0, Math.min(countRaw, maxSpawns));

    const minDistFromSpawn = (typeof tune.enemySpawnMinDistFromSpawn === 'number') ? tune.enemySpawnMinDistFromSpawn : 300;
    const minDistFromExit  = (typeof tune.enemySpawnMinDistFromExit === 'number') ? tune.enemySpawnMinDistFromExit : 200;
    const minDistBetween   = (typeof tune.enemySpawnMinDistBetween === 'number') ? tune.enemySpawnMinDistBetween : 150;
    
    for (let i = 0; i < count * 3 && spawns.length < count; i++) {
      const x = rng.range(100, w - 100);
      const y = rng.range(100, h - 100);
      
      // Check distances
      const distSpawn = Math.hypot(x - spawn.x, y - spawn.y);
      const distExit = Math.hypot(x - exit.x, y - exit.y);
      
      if (distSpawn < minDistFromSpawn) continue;
      if (distExit < minDistFromExit) continue;
      
      // Check distance from other spawns
      let tooClose = false;
      for (const s of spawns) {
        if (Math.hypot(x - s.x, y - s.y) < minDistBetween) {
          tooClose = true;
          break;
        }
      }
      if (tooClose) continue;
      
      spawns.push({
        x: x,
        y: y,
        type: rng.pick(pool),
        patrol: rng.pick(['static', 'circle', 'line', 'wander']),
        patrolRadius: rng.int(50, 150),
        active: false,
        killed: false
      });
    }
    
    return spawns;
  },

  // ------------------------------------------------------------
  // Pack Director (v9A0)
  // ------------------------------------------------------------
  // Turns a portion of single spawns into small packs (3-5 members)
  // using templates from data/packs.json when available.
  // Invariants:
  // - Does NOT increase total spawn count (consumes existing budget)
  // - Deterministic for a given rng/seed
  // - Keeps spawns away from spawn/exit
  applyPackDirector(rng, spawns, pool, spawnPt, exitPt) {
    const packsData = State.data.packs;
    if (!packsData || !Array.isArray(packsData.templates) || packsData.templates.length === 0) {
      return spawns;
    }

    // Settings (defaults chosen to be safe/testable)
    const packChance = (typeof packsData.packChance === 'number') ? packsData.packChance : 0.7;
    const minSize = (typeof packsData.packSizeMin === 'number') ? packsData.packSizeMin : 3;
    const maxSize = (typeof packsData.packSizeMax === 'number') ? packsData.packSizeMax : 5;
    const maxPacksPerZone = (typeof packsData.maxPacksPerZone === 'number') ? packsData.maxPacksPerZone : 6;
    const spacing = (typeof packsData.memberSpacing === 'number') ? packsData.memberSpacing : 120;
    const minDistFromSpawn = (typeof packsData.minDistFromSpawn === 'number') ? packsData.minDistFromSpawn : 350;
    const minDistFromExit  = (typeof packsData.minDistFromExit === 'number') ? packsData.minDistFromExit : 250;

    if (!Array.isArray(spawns) || spawns.length < minSize) return spawns;

    // Shuffle indices deterministically
    const idx = spawns.map((_, i) => i);
    for (let i = idx.length - 1; i > 0; i--) {
      const j = rng.int(0, i);
      const tmp = idx[i];
      idx[i] = idx[j];
      idx[j] = tmp;
    }

    // Helpers
    const pickTemplate = () => {
      // weighted pick
      let total = 0;
      for (const t of packsData.templates) total += (typeof t.weight === 'number' ? t.weight : 1);
      let r = rng.range(0, total);
      for (const t of packsData.templates) {
        r -= (typeof t.weight === 'number' ? t.weight : 1);
        if (r <= 0) return t;
      }
      return packsData.templates[0];
    };

    const validAnchor = (p) => {
      const ds = Math.hypot(p.x - spawnPt.x, p.y - spawnPt.y);
      const de = Math.hypot(p.x - exitPt.x,  p.y - exitPt.y);
      return ds >= minDistFromSpawn && de >= minDistFromExit;
    };

    const used = new Set();
    const out = [];
    let packsMade = 0;

    for (let k = 0; k < idx.length && packsMade < maxPacksPerZone; k++) {
      const i = idx[k];
      if (used.has(i)) continue;
      const anchor = spawns[i];
      if (!anchor || !validAnchor(anchor)) continue;

      if (rng.range(0, 1) > packChance) continue;

      const tpl = pickTemplate();

      // If template defines explicit members, build exact composition.
      let memberTypes = null;
      if (tpl && Array.isArray(tpl.members) && tpl.members.length > 0) {
        memberTypes = [];
        for (const mm of tpl.members) {
          const mi = (typeof mm.min === 'number') ? mm.min : 1;
          const ma = (typeof mm.max === 'number') ? mm.max : mi;
          const cnt = rng.int(mi, ma);
          for (let c = 0; c < cnt; c++) memberTypes.push(mm.type);
        }
        // Ensure minimal size
        if (memberTypes.length < 1) memberTypes = null;
      }

      const size = memberTypes ? memberTypes.length : rng.int(minSize, maxSize);

      // consume 'size' spawns from budget (anchor + size-1 additional)
      used.add(i);
      let consumed = 1;
      for (let kk = k + 1; kk < idx.length && consumed < size; kk++) {
        const j = idx[kk];
        if (used.has(j)) continue;
        used.add(j);
        consumed++;
      }

      // Create pack members around anchor
      for (let m = 0; m < size; m++) {
        const angle = rng.range(0, Math.PI * 2);
        const dist = rng.range(30, spacing);
        const px = anchor.x + Math.cos(angle) * dist;
        const py = anchor.y + Math.sin(angle) * dist;

        // Template can force composition via members, or allow random types via tpl.types; otherwise use pool
        let type = null;
        if (memberTypes && memberTypes.length === size) {
          type = memberTypes[m];
        } else if (tpl && Array.isArray(tpl.types) && tpl.types.length > 0) {
          type = rng.pick(tpl.types);
        }
        if (!type) type = rng.pick(pool);

        out.push({
          x: px,
          y: py,
          type,
          patrol: anchor.patrol,
          patrolRadius: anchor.patrolRadius,
          active: false,
          killed: false,
          packId: tpl?.id || 'pack'
        });
      }

      packsMade++;
    }

    // Add remaining singles (not consumed)
    for (let i = 0; i < spawns.length; i++) {
      if (used.has(i)) continue;
      out.push(spawns[i]);
    }

    return out;
  },
  
  // Elite spawn positions
  generateEliteSpawns(rng, pool, density, w, h) {
    const spawns = [];
    const tune = State.data.config?.exploration || {};
    const maxElites = (typeof tune.maxEliteSpawnsPerZone === 'number') ? tune.maxEliteSpawnsPerZone : 8;
    const countRaw = Math.floor(w * h * density);
    const count = Math.max(1, Math.min(countRaw, maxElites));
    
    for (let i = 0; i < count; i++) {
      spawns.push({
        x: rng.range(200, w - 200),
        y: rng.range(200, h - 200),
        type: rng.pick(pool),
        active: false,
        killed: false
      });
    }
    
    return spawns;
  },
  
  // Obstacles (collision)
  generateObstacles(rng, density, w, h, options = {}) {
    const obstacles = [];
    const tune = State.data.config?.exploration || {};
    const maxObs = (typeof tune.maxObstaclesPerZone === 'number') ? tune.maxObstaclesPerZone : 1200;
    const depth = options.depth || 1;
    const mods = options.mods || [];
    const modSet = new Set(mods);

    const countRaw = Math.floor(w * h * density);
    const budgetTotal = Math.min(countRaw, maxObs);
    
    // ── PHASE 1: Corridor walls (40% of budget) ──
    // Create asteroid walls along paths between key points
    const corridorBudget = Math.floor(budgetTotal * 0.4);
    const corridorObs = this._generateCorridorWalls(rng, w, h, corridorBudget, options);
    for (const o of corridorObs) obstacles.push(o);
    
    // ── PHASE 2: Cluster formations (30% of budget) ──
    // Dense asteroid clusters in specific areas for visual density
    const clusterBudget = Math.floor(budgetTotal * 0.3);
    const clusterCount = rng.int(3, 6);
    let clusterUsed = 0;
    
    for (let c = 0; c < clusterCount && clusterUsed < clusterBudget; c++) {
      const cx = rng.range(200, w - 200);
      const cy = rng.range(200, h - 200);
      const clusterSize = rng.int(8, 20);
      const clusterRadius = rng.range(80, 200);
      
      for (let i = 0; i < clusterSize && clusterUsed < clusterBudget; i++) {
        const a = rng.range(0, Math.PI * 2);
        const d = rng.range(0, clusterRadius);
        const typePool = modSet.has('MINEFIELD') ? ['asteroid','debris','mine','mine'] : ['asteroid','debris','asteroid'];
        const type = rng.pick(typePool);
        obstacles.push({
          x: cx + Math.cos(a) * d,
          y: cy + Math.sin(a) * d,
          type: type,
          radius: type === 'asteroid' ? rng.int(20, 60) : rng.int(12, 25),
          rotation: rng.range(0, Math.PI * 2),
          destructible: true,
          hp: type === 'asteroid' ? rng.int(25, 60) : (type === 'mine' ? 6 : 12),
          damage: type === 'mine' ? (8 + Math.floor(depth * 0.25)) : 0
        });
        clusterUsed++;
      }
    }
    
    // ── PHASE 3: Scatter fill (remaining budget) ──
    const scatterBudget = budgetTotal - obstacles.length;
    for (let i = 0; i < scatterBudget; i++) {
      const typePool = modSet.has('MINEFIELD') ? ['asteroid','debris','mine','mine'] : ['asteroid','debris'];
      const type = rng.pick(typePool);
      obstacles.push({
        x: rng.range(100, w - 100),
        y: rng.range(100, h - 100),
        type: type,
        radius: type === 'asteroid' ? rng.int(25, 70) : rng.int(15, 30),
        rotation: rng.range(0, Math.PI * 2),
        destructible: true,
        hp: type === 'asteroid' ? rng.int(25, 60) : (type === 'mine' ? 6 : 12),
        damage: type === 'mine' ? (8 + Math.floor(depth * 0.25)) : 0
      });
    }
    
    // ═══ DIFFICULTY HP SCALING ═══
    const diff = options.difficulty || 'normal';
    if (diff === 'chaos') {
      // Chaos: tougher asteroids, mines become hunting mines
      for (const obs of obstacles) {
        if (obs.hp) obs.hp = Math.ceil(obs.hp * 2.5);
        if (obs.type === 'mine') {
          obs.hunting = true;      // mines track player
          obs.huntSpeed = 40;      // px/s tracking speed
          obs.damage = Math.ceil(obs.damage * 1.5);
        }
      }
      
      // Add poison areas (3-5 toxic zones)
      const poisonCount = rng.int(3, 5);
      for (let i = 0; i < poisonCount; i++) {
        obstacles.push({
          x: rng.range(200, w - 200),
          y: rng.range(200, h - 200),
          type: 'poison_area',
          radius: rng.int(80, 160),
          destructible: false,
          dotDamage: 3 + Math.floor(depth * 0.1),
          rotation: 0,
          glow: '#44ff00'
        });
      }
    }
    
    return obstacles;
  },
  
  // Generate asteroid walls along natural corridors
  _generateCorridorWalls(rng, w, h, budget, options) {
    const walls = [];
    
    // Create 2-4 corridor paths across the zone
    const corridorCount = rng.int(2, 4);
    const perCorridor = Math.floor(budget / corridorCount);
    
    for (let c = 0; c < corridorCount; c++) {
      // Random start/end edges
      const startEdge = rng.pick(['top', 'bottom', 'left', 'right']);
      let sx, sy, ex, ey;
      const m = 150;
      
      switch (startEdge) {
        case 'top': sx = rng.range(m, w - m); sy = m; ex = rng.range(m, w - m); ey = h - m; break;
        case 'bottom': sx = rng.range(m, w - m); sy = h - m; ex = rng.range(m, w - m); ey = m; break;
        case 'left': sx = m; sy = rng.range(m, h - m); ex = w - m; ey = rng.range(m, h - m); break;
        default: sx = w - m; sy = rng.range(m, h - m); ex = m; ey = rng.range(m, h - m); break;
      }
      
      // Generate wall points along the corridor with jitter
      const segments = rng.int(8, 15);
      const corridorWidth = rng.range(100, 200); // gap width
      
      for (let s = 0; s <= segments; s++) {
        const t = s / segments;
        const baseX = sx + (ex - sx) * t;
        const baseY = sy + (ey - sy) * t;
        
        // Perpendicular direction
        const dx = ex - sx;
        const dy = ey - sy;
        const len = Math.hypot(dx, dy) || 1;
        const perpX = -dy / len;
        const perpY = dx / len;
        
        // Add jitter to make it organic
        const jitterX = rng.range(-80, 80);
        const jitterY = rng.range(-80, 80);
        
        // Place asteroids on both sides of the corridor
        const asteroidsPerSide = Math.floor(perCorridor / segments / 2);
        
        for (let side = -1; side <= 1; side += 2) {
          for (let a = 0; a < asteroidsPerSide && walls.length < budget; a++) {
            const offset = corridorWidth * 0.5 + rng.range(20, 120);
            const spread = rng.range(-40, 40);
            const px = baseX + jitterX + perpX * offset * side + rng.range(-20, 20);
            const py = baseY + jitterY + perpY * offset * side + rng.range(-20, 20);
            
            if (px < 50 || px > w - 50 || py < 50 || py > h - 50) continue;
            
            walls.push({
              x: px, y: py,
              type: 'asteroid',
              radius: rng.int(20, 55),
              rotation: rng.range(0, Math.PI * 2),
              destructible: true,
              hp: rng.int(30, 60)
            });
          }
        }
      }
    }
    
    return walls;
  },
  
  // Boss arena obstacles
  generateBossArenaObstacles(rng, w, h) {
    const obstacles = [];
    // Pillars for cover
    const pillarCount = rng.int(2, 4);
    
    for (let i = 0; i < pillarCount; i++) {
      const angle = (i / pillarCount) * Math.PI * 2;
      const dist = rng.range(200, 350);
      obstacles.push({
        x: w / 2 + Math.cos(angle) * dist,
        y: h / 2 + Math.sin(angle) * dist,
        type: 'pillar',
        radius: 40,
        destructible: false
      });
    }
    
    return obstacles;
  },
  
  // Decorations (no collision, just visual)
  generateDecorations(rng, biome, w, h) {
    const decorations = [];
    const tune = State.data.config?.exploration || {};
    const maxDec = (typeof tune.maxDecorationsPerZone === 'number') ? tune.maxDecorationsPerZone : 3000;
    
    // ── LAYER 1: Background dust clouds (large, very faint) ──
    const dustCount = rng.int(4, 8);
    for (let i = 0; i < dustCount; i++) {
      const colors = {
        'space': ['#221144', '#112244', '#110033', '#001122'],
        'asteroid': ['#332211', '#221100', '#1a1a00', '#112211'],
        'station': ['#111122', '#0a0a1a', '#1a1122', '#0a1122']
      };
      decorations.push({
        x: rng.range(0, w),
        y: rng.range(0, h),
        type: 'dust_cloud',
        width: rng.range(400, 900),
        height: rng.range(250, 600),
        color: rng.pick(colors[biome] || colors['space']),
        alpha: rng.range(0.06, 0.15),
        rotation: rng.range(0, Math.PI * 2),
        scale: 1
      });
    }
    
    // ── LAYER 2: Nebula patches (medium, colored, atmospheric) ──
    const nebulaCount = rng.int(2, 5);
    const nebulaColors = {
      'space': ['#4400aa', '#aa0044', '#0044aa', '#006644'],
      'asteroid': ['#664400', '#446600', '#884400', '#226622'],
      'station': ['#004488', '#440088', '#006688', '#880044']
    };
    for (let i = 0; i < nebulaCount; i++) {
      decorations.push({
        x: rng.range(100, w - 100),
        y: rng.range(100, h - 100),
        type: 'nebula_patch',
        radius: rng.range(150, 400),
        color: rng.pick(nebulaColors[biome] || nebulaColors['space']),
        alpha: rng.range(0.04, 0.12),
        rotation: rng.range(0, Math.PI * 2),
        scale: 1
      });
    }
    
    // ── LAYER 3: Landmarks (large, distinctive, non-interactive) ──
    const landmarkCount = rng.int(3, 6);
    const landmarkTypes = this._getLandmarkTypes(biome);
    for (let i = 0; i < landmarkCount; i++) {
      const type = rng.pick(landmarkTypes);
      decorations.push({
        x: rng.range(200, w - 200),
        y: rng.range(200, h - 200),
        type: type,
        scale: rng.range(0.7, 1.5),
        rotation: rng.range(0, Math.PI * 2),
        alpha: rng.range(0.4, 0.8),
        variant: rng.int(0, 3) // visual variant
      });
    }
    
    // ── LAYER 4: Scattered small decorations (stars, rocks, sparkles) ──
    const smallTypes = {
      'space': ['star_bright', 'star_dim', 'star_colored', 'sparkle'],
      'asteroid': ['rock_small', 'rock_tiny', 'ice_shard', 'metal_flake'],
      'station': ['panel_fragment', 'wire_coil', 'light_flicker', 'spark']
    };
    const smallPool = smallTypes[biome] || smallTypes['space'];
    const smallCount = Math.min(maxDec - decorations.length, Math.floor(w * h * 0.0004));
    
    for (let i = 0; i < smallCount; i++) {
      const type = rng.pick(smallPool);
      decorations.push({
        x: rng.range(0, w),
        y: rng.range(0, h),
        type: type,
        scale: rng.range(0.3, 1.2),
        rotation: rng.range(0, Math.PI * 2),
        alpha: type.includes('dim') ? rng.range(0.15, 0.4) : rng.range(0.4, 0.9),
        color: this._getDecoColor(rng, type, biome),
        size: rng.range(1, 4)
      });
    }
    
    return decorations;
  },
  
  // Landmark types per biome
  _getLandmarkTypes(biome) {
    switch (biome) {
      case 'asteroid':
        return ['rock_formation', 'ice_cluster', 'ancient_marker', 'dead_ship', 'mining_rig'];
      case 'station':
        return ['station_hull', 'antenna_array', 'cargo_pod', 'solar_panel', 'dead_ship'];
      default: // space
        return ['gas_cloud', 'dead_ship', 'ancient_marker', 'comet_trail', 'beacon_ruins'];
    }
  },
  
  // Decoration colors per type/biome
  _getDecoColor(rng, type, biome) {
    const palettes = {
      star_bright: ['#ffffff', '#ffffcc', '#ccddff'],
      star_dim: ['#666688', '#556677', '#445566'],
      star_colored: ['#ff8866', '#66aaff', '#ffcc44', '#88ff88', '#ff66aa'],
      sparkle: ['#ffffff', '#aaddff', '#ffddaa'],
      rock_small: ['#667788', '#556677', '#445566'],
      rock_tiny: ['#778899', '#556677', '#445566'],
      ice_shard: ['#88ccff', '#aaddff', '#66bbee'],
      metal_flake: ['#8899aa', '#99aabb', '#778899'],
      panel_fragment: ['#556677', '#667788', '#445566'],
      wire_coil: ['#887744', '#776633', '#665522'],
      light_flicker: ['#ffcc00', '#ff8800', '#00aaff'],
      spark: ['#ffdd44', '#ff8844', '#ffffff']
    };
    return rng.pick(palettes[type] || ['#888888']);
  },
  
  // Parallax layer generation
  generateParallax(rng, actConfig, w, h) {
    const cfg = actConfig.parallax || {};
    const tune = State.data.config?.exploration || {};
    const maxBgStars = (typeof tune.maxStarsBackground === 'number') ? tune.maxStarsBackground : 1800;
    const maxMidStars = (typeof tune.maxStarsMidground === 'number') ? tune.maxStarsMidground : 1200;
    
    return {
      // Layer 0: Deep background (slowest)
      background: {
        color: cfg.bgColor || '#0a0a15',
        stars: this.generateStarfield(rng, w * 1.5, h * 1.5, 0.0003, maxBgStars),
        scrollSpeed: 0.1
      },
      // Layer 1: Mid stars
      midground: {
        stars: this.generateStarfield(rng, w * 1.3, h * 1.3, 0.0002, maxMidStars),
        scrollSpeed: 0.3
      },
      // Layer 2: Near stars/nebula
      foreground: {
        objects: this.generateNebulaWisps(rng, w, h, cfg.nebula),
        scrollSpeed: 0.6
      },
      // Layer 3: Very close particles (fastest, optional)
      particles: {
        scrollSpeed: 0.9
      }
    };
  },
  
  // Generate starfield
  generateStarfield(rng, w, h, density, maxCount = null) {
    const stars = [];
    const countRaw = Math.floor(w * h * density);
    const cap = (typeof maxCount === 'number' && Number.isFinite(maxCount) && maxCount > 0)
      ? Math.floor(maxCount)
      : null;
    const count = cap ? Math.min(countRaw, cap) : countRaw;
    for (let i = 0; i < count; i++) {
      stars.push({
        x: rng.range(0, w),
        y: rng.range(0, h),
        size: rng.range(0.5, 2),
        brightness: rng.range(0.3, 1),
        twinkle: rng.chance(0.3)
      });
    }
    
    return stars;
  },
  
  // Generate nebula wisps
  generateNebulaWisps(rng, w, h, nebulaConfig) {
    if (!nebulaConfig?.enabled) return [];
    
    const wisps = [];
    const count = nebulaConfig.count || rng.int(3, 8);
    const color = nebulaConfig.color || '#4400aa';
    
    for (let i = 0; i < count; i++) {
      wisps.push({
        x: rng.range(0, w),
        y: rng.range(0, h),
        width: rng.range(200, 500),
        height: rng.range(100, 300),
        color: color,
        alpha: rng.range(0.05, 0.15),
        rotation: rng.range(0, Math.PI * 2)
      });
    }
    
    return wisps;
  },
  
  // ============================================================
  // POI SYSTEM - Points of Interest
  // ============================================================
  // Places structured encounters along a path from spawn → exit
  // Each POI type has different gameplay: combat, loot, mining, challenge
  
  generatePOIs(rng, zone, actConfig, options = {}) {
    const pois = [];
    const depth = options.depth || 1;
    const w = zone.width;
    const h = zone.height;
    const spawn = zone.spawn;
    const exit = zone.exit;
    
    // POI budget: 3-4 early → 5-7 endgame
    const area = w * h;
    const basePOIs = Math.max(2, Math.floor(area / 15000000) + 1);
    const depthBonus = Math.floor(depth / 15);
    const maxPOIs = Math.min(7, basePOIs + depthBonus);
    const poiCount = rng.int(Math.max(2, maxPOIs - 1), maxPOIs);
    
    // Generate POI positions along a path from spawn to exit
    // This creates a "journey" through the zone instead of random scatter
    const pathPoints = this._generatePathPoints(rng, spawn, exit, w, h, poiCount);
    
    // Available POI types per tier
    const tierPOIs = this._getPOITypesForTier(actConfig, depth);
    
    for (let i = 0; i < pathPoints.length; i++) {
      const pt = pathPoints[i];
      const poiType = rng.pick(tierPOIs);
      const poi = this._createPOI(rng, poiType, pt.x, pt.y, depth, actConfig, i);
      if (poi) {
        pois.push(poi);
        
        // POI enemies are added to zone.enemySpawns with a poiId reference
        if (poi.enemies) {
          for (const e of poi.enemies) {
            zone.enemySpawns.push({
              ...e,
              poiId: poi.id,
              active: false,
              killed: false
            });
          }
        }
        
        // POI obstacles (cover, walls) added to zone
        if (poi.obstacles) {
          for (const o of poi.obstacles) {
            zone.obstacles.push(o);
          }
        }
      }
    }
    
    return pois;
  },
  
  // Generate waypoints from spawn to exit with jitter for natural pathing
  _generatePathPoints(rng, spawn, exit, w, h, count) {
    const points = [];
    const margin = 200;
    
    for (let i = 0; i < count; i++) {
      // Interpolate along spawn→exit with perpendicular jitter
      const t = (i + 1) / (count + 1);
      const baseX = spawn.x + (exit.x - spawn.x) * t;
      const baseY = spawn.y + (exit.y - spawn.y) * t;
      
      // Perpendicular offset for variety (up to 30% of zone width)
      const perpX = -(exit.y - spawn.y);
      const perpY = exit.x - spawn.x;
      const perpLen = Math.hypot(perpX, perpY) || 1;
      const maxOffset = Math.min(w, h) * 0.3;
      const offset = rng.range(-maxOffset, maxOffset);
      
      let x = baseX + (perpX / perpLen) * offset;
      let y = baseY + (perpY / perpLen) * offset;
      
      // Clamp to zone bounds
      x = Math.max(margin, Math.min(w - margin, x));
      y = Math.max(margin, Math.min(h - margin, y));
      
      points.push({ x, y });
    }
    
    return points;
  },
  
  // POI types available per tier
  _getPOITypesForTier(actConfig, depth) {
    const base = ['guard_post', 'treasure_cache', 'ore_deposit'];
    if (depth >= 5) base.push('ambush_zone', 'salvage_wreck');
    if (depth >= 10) base.push('elite_den', 'crystal_cavern');
    if (depth >= 20) base.push('defense_beacon', 'void_rift');
    if (depth >= 50) base.push('ancient_vault');
    return base;
  },
  
  // Create a specific POI with enemies, obstacles, and rewards
  _createPOI(rng, type, cx, cy, depth, actConfig, index) {
    const pool = actConfig.enemies?.pool || ['grunt'];
    const elitePool = actConfig.enemies?.elitePool || ['commander'];
    const id = `poi_${index}_${type}`;
    
    switch (type) {
      // ── GUARD POST ──
      // 4-6 enemies arranged in a circle guarding a loot container
      case 'guard_post': {
        const guardCount = rng.int(4, 6);
        const enemies = [];
        const radius = rng.int(100, 160);
        for (let i = 0; i < guardCount; i++) {
          const a = (i / guardCount) * Math.PI * 2;
          enemies.push({
            x: cx + Math.cos(a) * radius,
            y: cy + Math.sin(a) * radius,
            type: rng.pick(pool),
            patrol: 'circle',
            patrolRadius: 40
          });
        }
        // Cover obstacles around the loot
        const obstacles = [];
        for (let i = 0; i < 3; i++) {
          const a = rng.range(0, Math.PI * 2);
          obstacles.push({
            x: cx + Math.cos(a) * (radius * 0.5),
            y: cy + Math.sin(a) * (radius * 0.5),
            type: 'debris', radius: rng.int(20, 35),
            destructible: true, hp: 20, rotation: rng.range(0, Math.PI * 2)
          });
        }
        return {
          id, type, x: cx, y: cy, radius: radius + 80,
          icon: '📦', label: 'Guarded Cache',
          reward: { type: 'loot_cache', rarity: depth > 20 ? 'rare' : 'uncommon', scrap: rng.int(15, 40) },
          enemies, obstacles,
          triggered: false, cleared: false, collected: false
        };
      }
      
      // ── TREASURE CACHE ──
      // Light or no enemies, guaranteed item drop
      case 'treasure_cache': {
        const hasGuard = rng.chance(0.4);
        const enemies = [];
        if (hasGuard) {
          enemies.push({
            x: cx + rng.range(-60, 60), y: cy + rng.range(-60, 60),
            type: rng.pick(pool), patrol: 'static', patrolRadius: 30
          });
        }
        return {
          id, type, x: cx, y: cy, radius: 80,
          icon: '💎', label: 'Hidden Cache',
          reward: { type: 'loot_cache', rarity: rng.chance(0.15) ? 'epic' : 'rare', scrap: rng.int(8, 20) },
          enemies, obstacles: [],
          triggered: false, cleared: !hasGuard, collected: false
        };
      }
      
      // ── AMBUSH ZONE ──
      // Enemies spawn when player enters radius (not visible beforehand)
      case 'ambush_zone': {
        const count = rng.int(5, 8);
        const enemies = [];
        for (let i = 0; i < count; i++) {
          const a = rng.range(0, Math.PI * 2);
          const d = rng.range(80, 200);
          enemies.push({
            x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d,
            type: rng.pick(pool), patrol: 'wander', patrolRadius: 60,
            ambush: true, ambushDelay: rng.range(0.2, 1.5) // staggered spawn
          });
        }
        return {
          id, type, x: cx, y: cy, radius: 250,
          icon: '⚠️', label: 'Danger Zone',
          reward: { type: 'cells', value: rng.int(20, 50), scrap: rng.int(20, 50) },
          enemies, obstacles: [],
          triggered: false, cleared: false, collected: false,
          hidden: true // not shown on minimap until triggered
        };
      }
      
      // ── ELITE DEN ──
      // Mini-boss + 2-3 minions, guaranteed rare+ drop
      case 'elite_den': {
        const enemies = [];
        // Elite in center
        enemies.push({
          x: cx, y: cy, type: rng.pick(elitePool),
          patrol: 'circle', patrolRadius: 80, isElite: true
        });
        // Minions
        const minionCount = rng.int(2, 3);
        for (let i = 0; i < minionCount; i++) {
          const a = rng.range(0, Math.PI * 2);
          enemies.push({
            x: cx + Math.cos(a) * 120, y: cy + Math.sin(a) * 120,
            type: rng.pick(pool), patrol: 'circle', patrolRadius: 50
          });
        }
        // Arena walls
        const obstacles = [];
        const wallCount = rng.int(4, 6);
        for (let i = 0; i < wallCount; i++) {
          const a = (i / wallCount) * Math.PI * 2 + rng.range(-0.3, 0.3);
          obstacles.push({
            x: cx + Math.cos(a) * 200, y: cy + Math.sin(a) * 200,
            type: 'asteroid', radius: rng.int(35, 55),
            destructible: true, hp: 40, rotation: rng.range(0, Math.PI * 2)
          });
        }
        return {
          id, type, x: cx, y: cy, radius: 220,
          icon: '💀', label: 'Elite Den',
          reward: { type: 'loot_cache', rarity: 'epic', scrap: rng.int(30, 60), cells: rng.int(15, 30) },
          enemies, obstacles,
          triggered: false, cleared: false, collected: false
        };
      }
      
      // ── ORE DEPOSIT ──
      // Cluster of rich ore asteroids (3-5) that drop extra crafting mats
      case 'ore_deposit': {
        const nodeCount = rng.int(3, 5);
        const obstacles = [];
        for (let i = 0; i < nodeCount; i++) {
          const a = rng.range(0, Math.PI * 2);
          const d = rng.range(30, 100);
          obstacles.push({
            x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d,
            type: 'ore_rich', radius: rng.int(25, 50),
            destructible: true, hp: rng.int(30, 60),
            rotation: rng.range(0, Math.PI * 2),
            resourceType: 'scrap', resourceMult: 3,
            glow: '#ffaa00'
          });
        }
        return {
          id, type, x: cx, y: cy, radius: 150,
          icon: '⛏️', label: 'Ore Deposit',
          reward: null, // reward comes from mining individual nodes
          enemies: [], obstacles,
          triggered: true, cleared: true, collected: false
        };
      }
      
      // ── CRYSTAL CAVERN ──
      // Blue crystal nodes that drop cells + chance of void shards
      case 'crystal_cavern': {
        const nodeCount = rng.int(3, 4);
        const obstacles = [];
        for (let i = 0; i < nodeCount; i++) {
          const a = (i / nodeCount) * Math.PI * 2 + rng.range(-0.4, 0.4);
          const d = rng.range(40, 90);
          obstacles.push({
            x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d,
            type: 'crystal_node', radius: rng.int(20, 40),
            destructible: true, hp: rng.int(20, 45),
            rotation: rng.range(0, Math.PI * 2),
            resourceType: 'cells', resourceMult: 4,
            glow: '#00aaff',
            voidShardChance: depth >= 30 ? 0.15 : 0.05
          });
        }
        // Light enemy guard
        const enemies = [];
        if (rng.chance(0.5)) {
          enemies.push({
            x: cx + rng.range(-80, 80), y: cy + rng.range(-80, 80),
            type: rng.pick(pool), patrol: 'circle', patrolRadius: 60
          });
        }
        return {
          id, type, x: cx, y: cy, radius: 140,
          icon: '🔷', label: 'Crystal Cavern',
          reward: null, enemies, obstacles,
          triggered: true, cleared: enemies.length === 0, collected: false
        };
      }
      
      // ── SALVAGE WRECK ──
      // Destroyed ship hull with mixed loot: scrap + cells + chance of item
      case 'salvage_wreck': {
        const obstacles = [];
        // Main hull
        obstacles.push({
          x: cx, y: cy, type: 'salvage_wreck',
          radius: rng.int(40, 65), destructible: true,
          hp: rng.int(50, 90), rotation: rng.range(0, Math.PI * 2),
          resourceType: 'mixed', resourceMult: 2,
          glow: '#88ff44', itemChance: 0.3
        });
        // Debris around it
        for (let i = 0; i < rng.int(2, 4); i++) {
          const a = rng.range(0, Math.PI * 2);
          obstacles.push({
            x: cx + Math.cos(a) * rng.range(60, 120),
            y: cy + Math.sin(a) * rng.range(60, 120),
            type: 'debris', radius: rng.int(15, 30),
            destructible: true, hp: 12, rotation: rng.range(0, Math.PI * 2)
          });
        }
        return {
          id, type, x: cx, y: cy, radius: 150,
          icon: '🔧', label: 'Salvage Wreck',
          reward: null, enemies: [], obstacles,
          triggered: true, cleared: true, collected: false
        };
      }
      
      // ── DEFENSE BEACON ──
      // Interact to start timed wave defense. Reward on survive.
      case 'defense_beacon': {
        return {
          id, type, x: cx, y: cy, radius: 120,
          icon: '📡', label: 'Defense Beacon',
          reward: { type: 'loot_cache', rarity: depth > 40 ? 'legendary' : 'epic', cells: rng.int(30, 60) },
          enemies: [], obstacles: [],
          interactable: true, interactPrompt: 'Press E to activate beacon',
          waveConfig: { count: rng.int(2, 3), enemiesPerWave: rng.int(4, 7), pool },
          triggered: false, cleared: false, collected: false
        };
      }
      
      // ── VOID RIFT ──
      // Dangerous area with cosmic dust drops from void-touched asteroids
      case 'void_rift': {
        const nodeCount = rng.int(2, 3);
        const obstacles = [];
        for (let i = 0; i < nodeCount; i++) {
          const a = rng.range(0, Math.PI * 2);
          const d = rng.range(30, 80);
          obstacles.push({
            x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d,
            type: 'void_crystal', radius: rng.int(20, 35),
            destructible: true, hp: rng.int(40, 70),
            rotation: rng.range(0, Math.PI * 2),
            resourceType: 'voidShard', resourceMult: 1,
            glow: '#aa55ff',
            cosmicDustChance: 0.10
          });
        }
        // Dangerous enemies nearby
        const enemies = [];
        for (let i = 0; i < rng.int(2, 4); i++) {
          const a = rng.range(0, Math.PI * 2);
          enemies.push({
            x: cx + Math.cos(a) * 180, y: cy + Math.sin(a) * 180,
            type: rng.pick(pool), patrol: 'wander', patrolRadius: 100
          });
        }
        return {
          id, type, x: cx, y: cy, radius: 200,
          icon: '🌀', label: 'Void Rift',
          reward: null, enemies, obstacles,
          triggered: false, cleared: false, collected: false
        };
      }
      
      // ── ANCIENT VAULT ──
      // Endgame POI: heavy resistance, guaranteed legendary
      case 'ancient_vault': {
        const enemies = [];
        // 2 elites + 4-6 minions
        for (let i = 0; i < 2; i++) {
          const a = (i === 0 ? -1 : 1) * Math.PI * 0.3;
          enemies.push({
            x: cx + Math.cos(a) * 150, y: cy + Math.sin(a) * 150,
            type: rng.pick(elitePool), patrol: 'circle', patrolRadius: 80, isElite: true
          });
        }
        for (let i = 0; i < rng.int(4, 6); i++) {
          const a = rng.range(0, Math.PI * 2);
          enemies.push({
            x: cx + Math.cos(a) * rng.range(100, 250),
            y: cy + Math.sin(a) * rng.range(100, 250),
            type: rng.pick(pool), patrol: 'wander', patrolRadius: 80
          });
        }
        // Heavy walls
        const obstacles = [];
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          obstacles.push({
            x: cx + Math.cos(a) * 280, y: cy + Math.sin(a) * 280,
            type: 'asteroid', radius: rng.int(40, 60),
            destructible: true, hp: 60, rotation: rng.range(0, Math.PI * 2)
          });
        }
        return {
          id, type, x: cx, y: cy, radius: 300,
          icon: '🏛️', label: 'Ancient Vault',
          reward: { type: 'loot_cache', rarity: 'legendary', scrap: rng.int(50, 100), cells: rng.int(30, 60), voidShards: rng.int(1, 3) },
          enemies, obstacles,
          triggered: false, cleared: false, collected: false
        };
      }
      
      default:
        return null;
    }
  },
  
  // ============================================================
  // RESOURCE NODES - Scattered rare mineable asteroids
  // ============================================================
  // Independent of POIs, these add occasional "ore veins" to zones
  
  generateResourceNodes(rng, zone, actConfig, options = {}) {
    const nodes = [];
    const depth = options.depth || 1;
    const w = zone.width;
    const h = zone.height;
    
    // 3-6 scattered resource nodes per zone (in addition to POI ore deposits)
    const count = rng.int(3, Math.min(6, 3 + Math.floor(depth / 15)));
    
    const nodeTypes = [
      { type: 'ore_rich', weight: 50, glow: '#ffaa00', resource: 'scrap', mult: 3 },
      { type: 'crystal_node', weight: 25, glow: '#00aaff', resource: 'cells', mult: 3 }
    ];
    if (depth >= 30) nodeTypes.push({ type: 'void_crystal', weight: 10, glow: '#aa55ff', resource: 'voidShard', mult: 1 });
    
    const totalWeight = nodeTypes.reduce((s, n) => s + n.weight, 0);
    
    for (let i = 0; i < count; i++) {
      // Random position away from spawn/exit
      let x, y, valid = false;
      for (let attempt = 0; attempt < 20; attempt++) {
        x = rng.range(150, w - 150);
        y = rng.range(150, h - 150);
        if (Math.hypot(x - zone.spawn.x, y - zone.spawn.y) < 300) continue;
        if (Math.hypot(x - zone.exit.x, y - zone.exit.y) < 200) continue;
        valid = true;
        break;
      }
      if (!valid) continue;
      
      // Pick type by weight
      let roll = rng.range(0, totalWeight);
      let picked = nodeTypes[0];
      for (const nt of nodeTypes) {
        roll -= nt.weight;
        if (roll <= 0) { picked = nt; break; }
      }
      
      const node = {
        x, y,
        type: picked.type,
        radius: rng.int(25, 50),
        destructible: true,
        hp: rng.int(25, 55),
        rotation: rng.range(0, Math.PI * 2),
        resourceType: picked.resource,
        resourceMult: picked.mult,
        glow: picked.glow
      };
      
      // Add chance modifiers for rare drops
      if (picked.type === 'crystal_node') {
        node.voidShardChance = depth >= 30 ? 0.12 : 0.03;
      }
      if (picked.type === 'void_crystal') {
        node.cosmicDustChance = 0.08;
      }
      
      nodes.push(node);
      // Also add to zone obstacles for collision/destruction
      zone.obstacles.push(node);
    }
    
    return nodes;
  },

  // ============================================================
  // ZONE OBJECTIVES — give each zone a purpose
  // ============================================================
  generateObjective(rng, zone, depth) {
    // First 2 zones: no objective (tutorial buffer)
    if (depth <= 2) return null;
    
    const objectives = [
      { type: 'exterminate', weight: 30 },  // Kill all enemies
      { type: 'survival',    weight: 20 },  // Survive timer
      { type: 'timetrial',   weight: 15 },  // Speed bonus
      { type: 'corruption',  weight: 15 },  // Escalating danger
      { type: 'lockdown',    weight: 20 }   // Destroy generators
    ];
    // Survival + corruption unlocked at depth 5
    if (depth < 5) {
      objectives[1].weight = 0;
      objectives[3].weight = 0;
    }
    
    const totalW = objectives.reduce((s, o) => s + o.weight, 0);
    let roll = rng.range(0, totalW);
    let picked = objectives[0];
    for (const o of objectives) {
      roll -= o.weight;
      if (roll <= 0) { picked = o; break; }
    }
    
    switch (picked.type) {
      case 'exterminate': {
        // Count total enemies in zone
        const total = zone.enemySpawns.length + zone.eliteSpawns.length;
        const target = Math.max(5, Math.floor(total * 0.8)); // 80% kill requirement
        return {
          type: 'exterminate', label: 'EXTERMINATE', icon: '💀',
          desc: `Kill ${target} enemies to unlock the exit`,
          progress: 0, target, complete: false, exitLocked: true,
          bonusLoot: { scrap: 30 + depth * 5, cells: 10 + depth * 2 }
        };
      }
      case 'survival': {
        const duration = 30 + Math.min(depth, 50); // 30-80 seconds
        return {
          type: 'survival', label: 'SURVIVE', icon: '⏱️',
          desc: `Survive ${duration}s in the arena zone`,
          progress: 0, target: duration, complete: false, exitLocked: true,
          arenaCenter: { x: zone.width / 2, y: zone.height / 2 },
          arenaRadius: 400,
          bonusLoot: { scrap: 40 + depth * 6, cells: 15 + depth * 3 }
        };
      }
      case 'timetrial': {
        const timeLimit = 20 + Math.floor(zone.width / 100); // bigger zone → more time
        return {
          type: 'timetrial', label: 'TIME TRIAL', icon: '⚡',
          desc: `Reach exit within ${timeLimit}s for bonus loot`,
          progress: 0, target: timeLimit, complete: false, exitLocked: false,
          bonusLoot: { scrap: 60 + depth * 8, cells: 20 + depth * 4 },
          failed: false
        };
      }
      case 'corruption': {
        return {
          type: 'corruption', label: 'CORRUPTION', icon: '☠️',
          desc: 'Zone grows deadlier over time. Exit when you dare.',
          progress: 0, target: 100, complete: false, exitLocked: false,
          corruptionRate: 1.0 + depth * 0.02, // % per second
          currentMult: 1.0, // enemy damage/speed mult grows
          bonusLoot: { scrap: 20 + depth * 3, cells: 5 + depth }
        };
      }
      case 'lockdown': {
        // Place 3 generator obstacles that must be destroyed
        const genCount = 3;
        const generators = [];
        for (let i = 0; i < genCount; i++) {
          const a = (i / genCount) * Math.PI * 2 + rng.range(-0.4, 0.4);
          const dist = Math.min(zone.width, zone.height) * 0.3;
          const gx = zone.width / 2 + Math.cos(a) * dist;
          const gy = zone.height / 2 + Math.sin(a) * dist;
          const gen = {
            x: gx, y: gy,
            type: 'generator', radius: 30,
            destructible: true, hp: 50 + depth * 5,
            rotation: 0, glow: '#ff4444',
            isGenerator: true
          };
          generators.push(gen);
          zone.obstacles.push(gen);
        }
        return {
          type: 'lockdown', label: 'LOCKDOWN', icon: '🔒',
          desc: `Destroy ${genCount} generators to unlock the exit`,
          progress: 0, target: genCount, complete: false, exitLocked: true,
          generators,
          bonusLoot: { scrap: 50 + depth * 7, cells: 15 + depth * 3 }
        };
      }
    }
    return null;
  },

  // ============================================================
  // BRANCHING EXITS — route choice at zone end
  // ============================================================
  generateBranchExits(rng, zone, depth) {
    const exit = zone.exit;
    if (!exit) return null;
    
    // 3 portals spread around the exit area
    const branches = [];
    const types = [
      { id: 'safe',  label: 'SAFE ROUTE',  icon: '🟢', color: '#00ff88', 
        desc: 'Standard zone',          modifiers: 0, lootMult: 1.0 },
      { id: 'risky', label: 'RISKY ROUTE', icon: '🟡', color: '#ffcc00',
        desc: '+1 modifier, +50% loot',  modifiers: 1, lootMult: 1.5 },
      { id: 'vault', label: 'VAULT',       icon: '🔴', color: '#ff4444',
        desc: 'Dead end, guaranteed rare+', modifiers: 2, lootMult: 2.0,
        isVault: true }
    ];
    
    // Remove vault sometimes (60% chance at depth < 10)
    if (depth < 10 && rng.chance(0.4)) {
      types.splice(2, 1);
    }
    
    const spacing = 120;
    const totalW = (types.length - 1) * spacing;
    
    for (let i = 0; i < types.length; i++) {
      const t = types[i];
      const offsetX = -totalW / 2 + i * spacing;
      branches.push({
        ...t,
        x: exit.x + offsetX,
        y: exit.y + (Math.abs(offsetX) * 0.3), // slight arc
        radius: 35
      });
    }
    
    return branches;
  },

  // Create zone seed from act + zone index
  createZoneSeed(actSeed, zoneIndex) {
    const a = (actSeed >>> 0);
    const z = ((zoneIndex + 1) >>> 0);
    return (a ^ Math.imul(z, 0x9E3779B9)) >>> 0;
  }
};

export default MapGenerator;