// Copyright (c) Manfred Foissner. All rights reserved.
// License: See LICENSE.txt in the project root.

// ============================================================
// DepthRules.js - Depth-driven Escalation & Modifiers
// ============================================================
// Depth is the single progression axis. It drives difficulty and unlocks
// new modifier rules at milestones. Active modifiers per zone are sampled
// from the unlocked pool (weighted), so no run is the same.
//
// Copyright (c) Manfred Foissner. All rights reserved.
// License: See LICENSE.txt in the project root.

import { State } from '../State.js';

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

// Default modifier pool (can be overridden per act via data/acts.json later)
const DEFAULT_POOL = [
  { id: 'ELITE_PACKS', weight: 1.2 },
  { id: 'BULLET_HELL', weight: 0.9 },
  { id: 'FAST_ENEMIES', weight: 1.1 },
  { id: 'CRAMPED_ZONE', weight: 0.8 },
  { id: 'MINEFIELD', weight: 1.0 },
  { id: 'DENSE_OBSTACLES', weight: 0.9 },
  { id: 'RICH_LOOT', weight: 0.6 }
];

// Milestones where we unlock a new modifier rule (hybrid)
const UNLOCK_EVERY_DEPTH = 25;

export const DepthRules = {

  // Ensure meta schema exists
  ensureMeta() {
    if (!State.meta.depth) {
      State.meta.depth = {
        bestDepth: 1,
        unlocked: [],    // array of modifier ids
        lastUnlockAt: 0  // depth where last unlock happened
      };
    }
    if (!Array.isArray(State.meta.depth.unlocked)) State.meta.depth.unlocked = [];
    if (typeof State.meta.depth.bestDepth !== 'number') State.meta.depth.bestDepth = 1;
    if (typeof State.meta.depth.lastUnlockAt !== 'number') State.meta.depth.lastUnlockAt = 0;
  },

  // Active modifier slot count per depth bucket
  modifierSlots(depth) {
    if (depth < 25) return 1;
    if (depth < 50) return 2;
    if (depth < 100) return 3;
    if (depth < 200) return 4;
    // Open-ended: slow growth
    return 5 + Math.floor((depth - 200) / 150);
  },

  // Unlock new rule at milestones using weighted randomness (B)
  maybeUnlock(depth, actConfig = null) {
    this.ensureMeta();

    const last = State.meta.depth.lastUnlockAt || 0;
    if (depth < UNLOCK_EVERY_DEPTH) return null;

    // Only unlock once per milestone boundary
    const milestone = Math.floor(depth / UNLOCK_EVERY_DEPTH) * UNLOCK_EVERY_DEPTH;
    if (milestone <= last) return null;

    const pool = (actConfig && actConfig.modifiers && Array.isArray(actConfig.modifiers.pool))
      ? actConfig.modifiers.pool
      : DEFAULT_POOL;

    const unlockedSet = new Set(State.meta.depth.unlocked);
    const candidates = pool.filter(m => !unlockedSet.has(m.id));
    if (candidates.length === 0) {
      State.meta.depth.lastUnlockAt = milestone;
      return null;
    }

    const picked = this.weightedPick(candidates);
    State.meta.depth.unlocked.push(picked.id);
    State.meta.depth.lastUnlockAt = milestone;
    return picked.id;
  },

  // Sample active modifiers for this zone from unlocked pool + baseline
  sampleActive(depth, actConfig = null) {
    this.ensureMeta();

    const pool = (actConfig && actConfig.modifiers && Array.isArray(actConfig.modifiers.pool))
      ? actConfig.modifiers.pool
      : DEFAULT_POOL;

    // Baseline rules that can always appear (even at depth 1)
    const baseline = (actConfig && actConfig.modifiers && Array.isArray(actConfig.modifiers.baseline))
      ? actConfig.modifiers.baseline
      : ['ELITE_PACKS'];

    const unlocked = new Set(State.meta.depth.unlocked);
    for (const b of baseline) unlocked.add(b);

    const available = pool.filter(m => unlocked.has(m.id));
    if (available.length === 0) return [];

    const slots = clamp(this.modifierSlots(depth), 0, 8);
    const picked = [];
    const used = new Set();

    // Without a seeded RNG here: use Math.random for variety between runs
    for (let i = 0; i < slots; i++) {
      const cand = available.filter(m => !used.has(m.id));
      if (cand.length === 0) break;
      const p = this.weightedPick(cand);
      picked.push(p.id);
      used.add(p.id);
    }
    return picked;
  },

  weightedPick(list) {
    let total = 0;
    for (const it of list) total += (it.weight ?? 1);
    let r = Math.random() * total;
    for (const it of list) {
      r -= (it.weight ?? 1);
      if (r <= 0) return it;
    }
    return list[list.length - 1];
  },

  // Convenience: update best depth
  recordDepth(depth) {
    this.ensureMeta();
    if (depth > State.meta.depth.bestDepth) State.meta.depth.bestDepth = depth;
  }
};

export default DepthRules;
