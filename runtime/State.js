// Copyright (c) Manfred Foissner. All rights reserved.
// License: See LICENSE.txt in the project root.

// ============================================================
// State.js - Single Source of Truth
// ============================================================

export const State = {
  // Loaded JSON data
  data: {
    config: null,
    items: null,
    rarities: null,
    affixes: null,
    skills: null,
    pilotStats: null,
    enemies: null,
    runUpgrades: null,
    slots: null,
    acts: {}  // Act configurations
  },
  
  // Module references (set during init)
  modules: {
    UI: null,
    Stats: null,
    Save: null,
    Items: null,
    Enemies: null,
    Bullets: null,
    Particles: null,
    Pickups: null,
    Leveling: null,
    World: null,
    Camera: null,
    SceneManager: null
  },
  
  // Current scene
  scene: 'hub', // 'hub', 'combat', 'loading', 'gameover'
  
  // World state (for exploration mode)
  world: {
    currentZone: null,
    currentAct: null,
    zoneIndex: 0
  },
  
  // Persistent meta progress (saved to localStorage)
  meta: {
    scrap: 0,
    level: 1,
    xp: 0,
    skillPoints: 0,
    statPoints: 0,

    // Endless depth progression (saved)
    depth: {
      bestDepth: 1,
      unlocked: [],
      lastUnlockAt: 0
    },
    skills: {},       // { treeId: { skillId: rank } }
    stats: {},        // { statId: points }
    equipment: {},    // { slotId: itemId }
    stash: [],        // Array of item objects
    highestWave: 0,
    // Per-difficulty highest zones (anti-exploit: each lane tracked separately)
    highestZones: { normal: 0, risk: 0, chaos: 0 },
    totalRuns: 0,
    totalKills: 0,
    totalPlaytime: 0,
    actsCompleted: [], // ['act1', 'act2', ...]
    actsUnlocked: ['act1'] // Acts available to play
  },
  
  // Current run state (reset each run)
  run: {
    active: false,
    inCombat: false,
    currentAct: null,
    difficulty: 'normal', // 'normal' | 'risk' | 'chaos'
    wave: 0,
    cells: 0,
    scrapEarned: 0,
    xpEarned: 0,
    upgrades: {},     // { upgradeId: tier }
    stats: {
      kills: 0,
      damageDealt: 0,
      damageTaken: 0,
      timeElapsed: 0,
      timeStarted: 0,
      itemsFound: 0,
      elitesKilled: 0,
      bossesKilled: 0
    },
    // Kill streak / combo system
    streak: {
      count: 0,       // current kill chain
      timer: 0,       // seconds since last kill (resets on kill)
      best: 0,        // best streak this run
      xpMult: 1,      // calculated from count
      lootMult: 1     // calculated from count
    },
    // Zone objective (set per zone by MapGenerator)
    objective: null    // { type, label, icon, progress, target, complete, bonusLoot }
  },
  
  // Player state
  player: {
    x: 0, y: 0,
    vx: 0, vy: 0,
    angle: 0,         // Rotation toward mouse
    radius: 18,
    
    // Active abilities
    abilities: {
      dash:    { cooldown: 0, maxCooldown: 4,  duration: 0, active: false },
      shield:  { cooldown: 0, maxCooldown: 12, duration: 0, active: false },
      orbital: { cooldown: 0, maxCooldown: 18, duration: 0, active: false }
    },
    
    // Stats (calculated by Stats.js)
    maxHP: 100,
    hp: 100,
    maxShield: 0,
    shield: 0,
    damage: 10,
    fireRate: 3,
    speed: 280,
    critChance: 5,
    critDamage: 150,
    projectiles: 1,
    piercing: 0,
    spread: 0,
    bulletSpeed: 600,
    luck: 0,
    pickupRadius: 50,
    
    // Active weapon
    weaponType: 'laser',
    // Weapon definitions (base modifiers applied on switch)
    weaponDefs: {
      laser:   { fireRate: 1.0, damage: 1.0, bulletSpeed: 1.0,  spread: 0,   projectiles: 0, piercing: 0, bulletType: 'laser',   label: 'Laser',   color: '#00ffff' },
      plasma:  { fireRate: 0.6, damage: 1.5, bulletSpeed: 0.7,  spread: 8,   projectiles: 0, piercing: 0, bulletType: 'plasma',  label: 'Plasma',  color: '#88ff44' },
      railgun: { fireRate: 0.35,damage: 3.0, bulletSpeed: 1.5,  spread: 0,   projectiles: 0, piercing: 2, bulletType: 'railgun', label: 'Railgun', color: '#cc88ff' },
      missile: { fireRate: 0.5, damage: 2.0, bulletSpeed: 0.55, spread: 0,   projectiles: 0, piercing: 0, bulletType: 'missile', label: 'Missile', color: '#ff8800' },
      gatling: { fireRate: 2.2, damage: 0.4, bulletSpeed: 0.9,  spread: 16,  projectiles: 2, piercing: 0, bulletType: 'gatling', label: 'Gatling', color: '#ffee44' },
      nova:    { fireRate: 0.7, damage: 1.4, bulletSpeed: 0.45, spread: 360, projectiles: 5, piercing: 0, bulletType: 'nova',    label: 'Nova',    color: '#aa66ff' }
    },
    
    // Cooldowns
    fireCooldown: 0,
    shieldRegenDelay: 0,

    // Drone companion
    drone: {
      active: true,
      type: 'combat',  // combat, shield, repair
      x: 0, y: 0,
      damagePct: 0.25,
      fireRate: 0.5,
      healPct: 0.02
    }
  },
  
  // Input state
  input: {
    up: false,
    down: false,
    left: false,
    right: false,
    fire: false,
    // Interaction (portals, terminals, etc.)
    interact: false,
    interactPressed: false,
    shift: false,
    // Abilities (Q/R/F or 1/2/3)
    ability1: false, // dash
    ability2: false, // shield burst
    ability3: false, // orbital strike
    mouseX: 0,
    mouseY: 0
  },
  
  // Game objects
  bullets: [],
  enemyBullets: [],
  enemies: [],
  pickups: [],
  particles: [],
  
  // UI state
  ui: {
    paused: false,
    tooltip: null,
    selectedItem: null
  }
};

// Reset run state
export function resetRun() {
  State.run = {
    active: false,
    inCombat: false,
    currentAct: null,
    difficulty: 'normal',
    wave: 0,
    cells: 0,
    scrapEarned: 0,
    xpEarned: 0,
    upgrades: {},
    stats: { 
      kills: 0, 
      damageDealt: 0, 
      damageTaken: 0, 
      timeElapsed: 0,
      timeStarted: 0,
      itemsFound: 0,
      elitesKilled: 0,
      bossesKilled: 0
    }
  };
  State.bullets = [];
  State.enemyBullets = [];
  State.enemies = [];
  State.pickups = [];
  State.particles = [];
  State.world = {
    currentZone: null,
    currentAct: null,
    zoneIndex: 0
  };
}

// Reset player position
export function resetPlayer(canvasW, canvasH) {
  State.player.x = canvasW / 2;
  State.player.y = canvasH * 0.7;
  State.player.vx = 0;
  State.player.vy = 0;
  State.player.angle = -Math.PI / 2; // Point up
  State.player.fireCooldown = 0;
  State.player.shieldRegenDelay = 0;
}

export default State;
