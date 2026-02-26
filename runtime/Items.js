// Copyright (c) Manfred Foissner. All rights reserved.
// License: See LICENSE.txt in the project root.

// ============================================================
// ITEMS.js v2.3 - Enhanced Item Generation System
// ============================================================
// ilvl gating, pity protection, unique items, power budget
// ============================================================

import { State } from './State.js';
import { getItemData, getRandomAffix, getConfig } from './DataLoader.js';

// ── Pity tracker (in-memory, saved via State.meta.pity) ──
function ensurePity() {
  if (!State.meta.pity) {
    State.meta.pity = {
      killsSinceRare: 0,
      killsSinceLegendary: 0,
      killsSinceUnique: 0,
      totalDrops: 0,
      rarityHist: {}
    };
  }
}

// ── Pity thresholds (overridable via config.json loot.pity) ──
function getPityConfig() {
  return {
    rareGuarantee:      getConfig('loot.pity.rareGuarantee', 40),
    legendaryGuarantee: getConfig('loot.pity.legendaryGuarantee', 200),
    uniqueGuarantee:    getConfig('loot.pity.uniqueGuarantee', 500),
    enabled:            getConfig('loot.pity.enabled', true)
  };
}

export const Items = {

  // ── Generate item with ilvl gating ──
  generate(baseId, forceRarity = null, rarityFloor = null, ilvl = null) {
    const baseData = getItemData(baseId);
    if (!baseData) {
      console.warn('Items.generate: Unknown item', baseId);
      return null;
    }

    const rarities = State.data.rarities;
    if (!rarities) return null;

    // Resolve item level: passed > zone depth > player level
    const itemLevel = ilvl
      || State.run.currentDepth
      || State.meta.level
      || 1;

    // Roll rarity
    let rarity = forceRarity || this.rollRarity(baseData.rarities, itemLevel);

    // Pity override
    if (!forceRarity) {
      rarity = this._applyPity(rarity);
    }

    // Rarity floor (elites etc.)
    if (!forceRarity && rarityFloor) {
      const RANK = { common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4, mythic: 5 };
      if ((RANK[rarity] ?? 0) < (RANK[rarityFloor] ?? 0)) rarity = rarityFloor;
    }

    const rarityData = rarities[rarity];
    if (!rarityData) return null;

    // Create item
    const item = {
      id: this.generateId(),
      baseId: baseId,
      name: baseData.name,
      slot: baseData.slot,
      icon: baseData.icon,
      description: baseData.description,
      rarity: rarity,
      ilvl: itemLevel,
      level: State.meta.level,
      stats: {},
      affixes: [],
      value: 0,
      enchantCount: 0,
      rerollCount: 0,
      isUnique: false
    };

    // ilvl scaling: stats grow with item level
    const ilvlMult = 1 + (itemLevel - 1) * 0.03;  // +3% per ilvl

    // Roll base stats with rarity x ilvl multiplier
    for (const [stat, range] of Object.entries(baseData.stats || {})) {
      const base = range[0] + Math.random() * (range[1] - range[0]);
      item.stats[stat] = Math.round(base * rarityData.powerMult * ilvlMult * 10) / 10;
    }

    // Roll affixes (ilvl gates higher-tier affixes)
    const numAffixes = Math.floor(Math.random() * (rarityData.maxAffixes + 1));
    const usedStats = new Set();

    for (let i = 0; i < numAffixes; i++) {
      const type = i < numAffixes / 2 ? 'prefix' : 'suffix';
      const affix = getRandomAffix(rarity, type);

      if (affix && !usedStats.has(affix.stat)) {
        usedStats.add(affix.stat);

        const value = affix.range[0] + Math.random() * (affix.range[1] - affix.range[0]);
        item.affixes.push({
          id: affix.id,
          name: affix.name,
          stat: affix.stat,
          value: Math.round(value * ilvlMult * 10) / 10,
          type: type
        });
      }
    }

    // Build display name
    item.name = this.buildName(baseData.name, item.affixes);

    // Calculate sell value (scales with ilvl)
    item.value = Math.floor(
      50 * rarityData.sellMult * (1 + itemLevel * 0.12) * (1 + item.affixes.length * 0.15)
    );

    // Calculate power budget for balance tracking
    item.powerBudget = this._calcPowerBudget(item);

    // Track pity
    this._trackDrop(rarity);

    return item;
  },

  // ── Unique item generation ──
  generateUnique(uniqueId, ilvl, options = {}) {
    const uniques = State.data.uniques;
    if (!uniques) return null;

    const itemLevel = ilvl || State.run.currentDepth || State.meta.level || 1;
    const fromBoss = options.fromBoss || false;
    const bossType = options.bossType || null;

    // Find eligible uniques (meet minIlvl requirement)
    const eligible = [];
    for (const [category, items] of Object.entries(uniques)) {
      if (category.startsWith('_')) continue;
      if (typeof items !== 'object') continue;
      for (const [id, data] of Object.entries(items)) {
        if (uniqueId && id !== uniqueId) continue;
        if (itemLevel < (data.minIlvl || 1)) continue;
        // Boss-only items only drop from bosses
        if (data.bossOnly && !fromBoss) continue;
        // Boss-pool items only from specific bosses
        if (data.bossPool && Array.isArray(data.bossPool) && bossType) {
          if (!data.bossPool.includes(bossType)) continue;
        }
        // Depth-gated items
        if (data.minDepth && (State.run.currentDepth || 1) < data.minDepth) continue;
        eligible.push({ id, ...data, category });
      }
    }

    if (eligible.length === 0) return null;

    // Pick one (weighted)
    let picked;
    if (uniqueId) {
      picked = eligible[0];
    } else {
      picked = this._weightedPick(eligible, e => e.dropWeight || 1.0);
    }
    if (!picked) return null;

    const rarityData = State.data.rarities?.[picked.rarity] || State.data.rarities?.legendary;

    const item = {
      id: this.generateId(),
      baseId: picked.id,
      uniqueId: picked.id,
      name: picked.name,
      slot: picked.slot,
      icon: picked.icon,
      description: picked.description,
      flavor: picked.flavor || '',
      rarity: picked.rarity,
      ilvl: itemLevel,
      level: State.meta.level,
      stats: { ...picked.fixedStats },
      affixes: [],       // Uniques have no random affixes
      value: Math.floor(200 * (rarityData?.sellMult || 20) * (1 + itemLevel * 0.1)),
      enchantCount: 0,
      rerollCount: 0,
      isUnique: true,
      powerBudget: 0
    };

    item.powerBudget = this._calcPowerBudget(item);

    // Track pity reset
    ensurePity();
    State.meta.pity.killsSinceUnique = 0;

    return item;
  },

  // ── Roll rarity with ilvl gating ──
  rollRarity(allowedRarities, ilvl) {
    const rarities = State.data.rarities;
    const ilvlVal = ilvl || 1;
    if (!rarities) return allowedRarities?.[0] || 'common';

    const luck = State.player?.luck || 0;

    // ilvl gating: certain rarities only available at higher ilvls
    const RARITY_MIN_ILVL = {
      common: 1, uncommon: 1, rare: 3, epic: 8, legendary: 15, mythic: 30
    };

    const gatedRarities = (allowedRarities || Object.keys(rarities)).filter(
      r => ilvlVal >= (RARITY_MIN_ILVL[r] || 1)
    );

    if (gatedRarities.length === 0) return 'common';

    // Build weighted pool
    let total = 0;
    const weights = {};

    for (const rarity of gatedRarities) {
      const data = rarities[rarity];
      if (!data) continue;

      let weight = data.weight;
      // Luck bonus: +2% per point for non-common
      if (rarity !== 'common') {
        weight *= (1 + luck * 0.02);
      }
      // ilvl bonus: gradually increase rare+ weights at high ilvl
      if (rarity !== 'common' && ilvlVal > 10) {
        weight *= (1 + (ilvlVal - 10) * 0.005);
      }
      weights[rarity] = weight;
      total += weight;
    }

    // Roll
    let roll = Math.random() * total;
    for (const [rarity, weight] of Object.entries(weights)) {
      roll -= weight;
      if (roll <= 0) return rarity;
    }

    return gatedRarities[0];
  },

  // ── Pity protection ──
  _applyPity(rolledRarity) {
    ensurePity();
    const pityCfg = getPityConfig();
    if (!pityCfg.enabled) return rolledRarity;

    const RANK = { common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4, mythic: 5 };
    const pity = State.meta.pity;

    // Legendary pity
    if (pity.killsSinceLegendary >= pityCfg.legendaryGuarantee) {
      if ((RANK[rolledRarity] ?? 0) < RANK.legendary) {
        console.log('[PITY] Legendary guaranteed after ' + pity.killsSinceLegendary + ' drops');
        return 'legendary';
      }
    }

    // Rare pity
    if (pity.killsSinceRare >= pityCfg.rareGuarantee) {
      if ((RANK[rolledRarity] ?? 0) < RANK.rare) {
        console.log('[PITY] Rare guaranteed after ' + pity.killsSinceRare + ' drops');
        return 'rare';
      }
    }

    return rolledRarity;
  },

  _trackDrop(rarity) {
    ensurePity();
    const RANK = { common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4, mythic: 5 };
    const pity = State.meta.pity;

    pity.totalDrops++;
    pity.rarityHist[rarity] = (pity.rarityHist[rarity] || 0) + 1;

    if ((RANK[rarity] ?? 0) >= RANK.rare) {
      pity.killsSinceRare = 0;
    } else {
      pity.killsSinceRare++;
    }

    if ((RANK[rarity] ?? 0) >= RANK.legendary) {
      pity.killsSinceLegendary = 0;
    } else {
      pity.killsSinceLegendary++;
    }

    pity.killsSinceUnique++;
  },

  // ── Power budget calculation ──
  _calcPowerBudget(item) {
    let budget = 0;
    const W = {
      damage: 3.0, fireRate: 2.0, critChance: 2.5, critDamage: 1.5,
      piercing: 4.0, projectiles: 5.0, aoeRadius: 2.0,
      maxHP: 1.0, shieldCap: 1.2, speed: 1.5, luck: 0.8,
      lifesteal: 3.5, dodgeChance: 3.0, damageMult: 3.5,
      energyRegen: 1.0, scrapBonus: 0.5, dropBonus: 1.5
    };

    for (const [stat, val] of Object.entries(item.stats || {})) {
      budget += Math.abs(val) * (W[stat] || 1.0);
    }
    for (const affix of item.affixes || []) {
      budget += Math.abs(affix.value) * (W[affix.stat] || 1.0);
    }

    return Math.round(budget);
  },

  // ── Weighted random pick ──
  _weightedPick(list, weightFn) {
    let total = 0;
    for (const item of list) total += weightFn(item);
    if (total <= 0) return list[0];
    let roll = Math.random() * total;
    for (const item of list) {
      roll -= weightFn(item);
      if (roll <= 0) return item;
    }
    return list[list.length - 1];
  },

  // Build item name
  buildName(baseName, affixes) {
    const prefix = affixes.find(a => a.type === 'prefix');
    const suffix = affixes.find(a => a.type === 'suffix');
    let name = baseName;
    if (prefix) name = prefix.name + ' ' + name;
    if (suffix) name = name + ' ' + suffix.name;
    return name;
  },

  // Generate unique item ID
  generateId() {
    return 'item_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 6);
  },

  // ── Get random item (enhanced with ilvl + unique chance) ──
  generateRandom(forceRarity, rarityFloor, ilvl, dropContext = {}) {
    const items = State.data.items;
    if (!items) return null;

    const itemLevel = ilvl || State.run.currentDepth || State.meta.level || 1;

    // Check for unique drop
    ensurePity();
    const pityCfg = getPityConfig();
    const uniqueChance = getConfig('loot.uniqueDropChance', 0.005);
    const pityUniqueTriggered = pityCfg.enabled
      && State.meta.pity.killsSinceUnique >= pityCfg.uniqueGuarantee;

    if (pityUniqueTriggered || Math.random() < uniqueChance) {
      const unique = this.generateUnique(null, itemLevel, {
        fromBoss: dropContext.fromBoss || false,
        bossType: dropContext.bossType || null
      });
      if (unique) return unique;
    }

    // Normal generation
    const allIds = [];
    for (const category of Object.values(items)) {
      for (const id of Object.keys(category)) {
        allIds.push(id);
      }
    }
    if (allIds.length === 0) return null;

    const randomId = allIds[Math.floor(Math.random() * allIds.length)];
    return this.generate(randomId, forceRarity, rarityFloor, itemLevel);
  },

  // ── Stash management ──
  addToStash(item) {
    const maxSlots = getConfig('stash.baseSlots', 56);
    if (State.meta.stash.length >= maxSlots) {
      console.warn('Stash is full!');
      return false;
    }
    State.meta.stash.push(item);
    if (State.run.stats) State.run.stats.itemsFound++;
    return true;
  },

  removeFromStash(itemId) {
    const index = State.meta.stash.findIndex(i => i.id === itemId);
    if (index !== -1) {
      State.meta.stash.splice(index, 1);
      return true;
    }
    return false;
  },

  equip(itemId) {
    const item = State.meta.stash.find(i => i.id === itemId);
    if (!item) return false;

    let slot = item.slot;
    if (item.slot === 'module' || (item.slot && item.slot.startsWith('module'))) {
      const slots = ['module1', 'module2', 'module3'];
      for (const s of slots) {
        if (!State.meta.equipment[s]) { slot = s; break; }
      }
    }

    State.meta.equipment[slot] = itemId;
    return true;
  },

  unequip(slot) {
    if (State.meta.equipment[slot]) {
      State.meta.equipment[slot] = null;
      return true;
    }
    return false;
  },

  sell(itemId) {
    const item = State.meta.stash.find(i => i.id === itemId);
    if (!item) return 0;

    for (const [slot, id] of Object.entries(State.meta.equipment)) {
      if (id === itemId) State.meta.equipment[slot] = null;
    }

    this.removeFromStash(itemId);
    State.meta.scrap += item.value;
    return item.value;
  },

  compare(item1, item2) {
    if (!item1 || !item2) return null;
    const diff = {};
    const allStats = new Set([
      ...Object.keys(item1.stats || {}),
      ...Object.keys(item2.stats || {})
    ]);
    for (const stat of allStats) {
      const v1 = item1.stats?.[stat] || 0;
      const v2 = item2.stats?.[stat] || 0;
      if (v1 !== v2) diff[stat] = { old: v1, new: v2, change: v2 - v1 };
    }
    return diff;
  },

  // ── Diagnostics ──
  getPityState() {
    ensurePity();
    return { ...State.meta.pity };
  },

  getEquippedPowerBudget() {
    let total = 0;
    const breakdown = {};
    for (const [slot, itemId] of Object.entries(State.meta.equipment || {})) {
      if (!itemId) continue;
      const item = State.meta.stash.find(i => i.id === itemId);
      if (item) {
        const pb = item.powerBudget || this._calcPowerBudget(item);
        breakdown[slot] = pb;
        total += pb;
      }
    }
    return { total, breakdown };
  }
};

export default Items;
