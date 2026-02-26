// Copyright (c) Manfred Foissner. All rights reserved.
// License: See LICENSE.txt in the project root.

// ============================================================
// UI.js - Desktop UI System
// ============================================================

import { State } from './State.js';
import { Stats } from './Stats.js';
import { Leveling } from './Leveling.js';
import { Items } from './Items.js';
import { Save } from './Save.js';

export const UI = {
  tooltipEl: null,
  // Persist opened skill tree sections across rerenders (prevents accordion reset)
  openTrees: new Set(),
  
  init() {
    this.tooltipEl = document.getElementById('tooltip');
    
    // Initial render
    this.renderAll();
  },
  
  renderAll() {
    this.renderEquipment();
    this.renderStash();
    this.renderShipStats();
    this.renderPilotStats();
    this.renderSkillTrees();
  },
  
  // ========== EQUIPMENT PANEL ==========
  renderEquipment() {
    const container = document.getElementById('equipmentGrid');
    if (!container) return;
    
    const slots = State.data.slots;
    const equipment = State.meta.equipment;
    const stash = State.meta.stash;
    const rarities = State.data.rarities;
    
    let html = '';
    
    for (const [slotId, slotDef] of Object.entries(slots || {})) {
      const equippedId = equipment[slotId];
      const item = equippedId ? stash.find(i => i.id === equippedId) : null;
      const rarityColor = item ? (rarities[item.rarity]?.color || '#666') : '#333';
      
      html += `
        <div class="equip-slot ${item ? 'filled' : ''}" 
             style="--rarity-color: ${rarityColor}"
             onclick="UI.onEquipSlotClick('${slotId}')"
             onmouseenter="UI.showSlotTooltip(event, '${slotId}')"
             onmouseleave="UI.hideTooltip()">
          <div class="slot-icon">${item ? item.icon : slotDef.icon}</div>
          <div class="slot-info">
            <div class="slot-type">${slotDef.name}</div>
            ${item 
              ? `<div class="slot-item" style="color:${rarityColor}">${item.name}</div>`
              : `<div class="slot-empty">Empty</div>`
            }
          </div>
        </div>
      `;
    }
    
    container.innerHTML = html;
  },
  
  // ========== STASH PANEL ==========
  renderStash() {
    const container = document.getElementById('stashGrid');
    if (!container) return;
    
    const stash = State.meta.stash;
    const equipment = State.meta.equipment;
    const rarities = State.data.rarities;
    const maxSlots = State.data.config?.stash?.baseSlots || 40;
    const equippedIds = new Set(Object.values(equipment).filter(Boolean));
    
    let html = '';
    
    // Items - HIDE equipped items (they show in equipment grid)
    let visibleCount = 0;
    for (const item of stash) {
      if (equippedIds.has(item.id)) continue; // Skip equipped items
      visibleCount++;
      const rarityColor = rarities[item.rarity]?.color || '#666';
      
      html += `
        <div class="stash-slot filled"
             style="--rarity-color: ${rarityColor}"
             onclick="UI.onStashItemClick('${item.id}')"
             oncontextmenu="UI.sellItem(event, '${item.id}')"
             onmouseenter="UI.showItemTooltip(event, '${item.id}')"
             onmouseleave="UI.hideTooltip()">
          ${item.icon}
        </div>
      `;
    }
    
    // Empty slots (based on non-equipped items)
    const freeSlots = Math.max(0, maxSlots - stash.length);
    const emptyCount = Math.min(freeSlots, 20);
    for (let i = 0; i < emptyCount; i++) {
      html += `<div class="stash-slot"></div>`;
    }
    
    container.innerHTML = html;
  },
  
  // ========== SHIP STATS ==========
  renderShipStats() {
    const container = document.getElementById('shipStats');
    if (!container) return;
    
    const p = State.player;
    
    const stats = [
      { name: 'HP', value: Math.round(p.maxHP) },
      { name: 'Shield', value: Math.round(p.maxShield) },
      { name: 'Damage', value: p.damage.toFixed(1) },
      { name: 'Fire Rate', value: p.fireRate.toFixed(1) + '/s' },
      { name: 'Crit %', value: p.critChance.toFixed(0) + '%' },
      { name: 'Crit Dmg', value: p.critDamage + '%' },
      { name: 'Speed', value: Math.round(p.speed) },
      { name: 'Projectiles', value: p.projectiles },
      { name: 'Pierce', value: p.piercing },
      { name: 'Luck', value: p.luck },
      { name: 'DPS', value: Stats.getDPS(), highlight: true }
    ];
    
    let html = '';
    for (const stat of stats) {
      html += `
        <div class="stat-item ${stat.highlight ? 'highlight' : ''}">
          <span>${stat.name}</span>
          <span class="stat-value">${stat.value}</span>
        </div>
      `;
    }
    
    container.innerHTML = html;
  },
  
  // ========== PILOT STATS ==========
  renderPilotStats() {
    const container = document.getElementById('pilotStats');
    const pointsEl = document.getElementById('statPointsNum');
    if (!container) return;
    
    const pilotStats = State.data.pilotStats;
    const allocated = State.meta.stats;
    const points = State.meta.statPoints;
    
    if (pointsEl) pointsEl.textContent = points;
    
    let html = '';
    
    for (const [statId, statDef] of Object.entries(pilotStats || {})) {
      const current = allocated[statId] || 0;
      
      html += `
        <div class="pilot-stat-row">
          <span class="pstat-icon" style="color:${statDef.color}">${statDef.icon}</span>
          <span class="pstat-name">${statDef.name}</span>
          <span class="pstat-value">${current}</span>
          <button class="pstat-btn" 
                  onmousedown="UI.startHold('stat','${statId}')"
                  onmouseup="UI.stopHold()"
                  onmouseleave="UI.stopHold()"
                  ontouchstart="UI.startHold('stat','${statId}')"
                  ontouchend="UI.stopHold()"
                  ${points > 0 ? '' : 'disabled'}>+</button>
        </div>
      `;
    }
    
    container.innerHTML = html;
  },
  
  // ========== SKILL TREES ==========
  renderSkillTrees() {
    const container = document.getElementById('skillTrees');
    const pointsEl = document.getElementById('skillPointsNum');
    if (!container) return;
    
    const trees = State.data.skills;
    const learned = State.meta.skills;
    const points = State.meta.skillPoints;
    
    if (pointsEl) pointsEl.textContent = points;
    
    let html = '';
    
    for (const [treeId, tree] of Object.entries(trees || {})) {
      const totalInTree = Object.values(learned[treeId] || {}).reduce((a, b) => a + b, 0);
      
      html += `
        <div class="skill-tree-section ${this.openTrees.has(treeId) ? 'open' : ''}" id="tree-${treeId}">
          <div class="skill-tree-header" style="--tree-color: ${tree.color}" onclick="UI.toggleTree('${treeId}')">
            <span class="tree-icon">${tree.icon}</span>
            <span class="tree-name">${tree.name}</span>
            <span class="tree-pts">${totalInTree} pts</span>
          </div>
          <div class="skill-tree-body">
      `;
      
      for (const [skillId, skill] of Object.entries(tree.skills)) {
        const currentRank = learned[treeId]?.[skillId] || 0;
        const canLearn = Leveling.canLearnSkill(treeId, skillId);
        const maxed = currentRank >= skill.maxRank;
        
        html += `
          <div class="skill-node ${currentRank > 0 ? 'learned' : ''} ${canLearn && !maxed ? 'available' : ''}"
               onmousedown="UI.startHold('skill','${treeId}','${skillId}')"
               onmouseup="UI.stopHold()"
               onmouseleave="UI.stopHold()"
               ontouchstart="UI.startHold('skill','${treeId}','${skillId}')"
               ontouchend="UI.stopHold()">
            <span class="skill-icon">${skill.icon}</span>
            <div class="skill-info">
              <div class="skill-name">${skill.name}</div>
              <div class="skill-desc">${skill.description}</div>
            </div>
            <span class="skill-rank">${currentRank}/${skill.maxRank}</span>
          </div>
        `;
      }
      
      html += `</div></div>`;
    }
    
    container.innerHTML = html;
  },
  
  toggleTree(treeId) {
    const section = document.getElementById(`tree-${treeId}`);
    // Update DOM + persisted state so the tree stays open after rerenders.
    if (section) section.classList.toggle('open');
    if (this.openTrees.has(treeId)) this.openTrees.delete(treeId);
    else this.openTrees.add(treeId);
  },
  
  // ========== VENDOR ==========
  renderVendor() {
    const container = document.getElementById('vendorGrid');
    const cellsEl = document.getElementById('vendorCells');
    if (!container) return;
    
    const upgrades = State.data.runUpgrades;
    const current = State.run.upgrades;
    const cells = State.run.cells;
    
    if (cellsEl) cellsEl.textContent = cells;
    
    // Helper: compute what stat looks like before/after this upgrade
    const getStatPreview = (upgrade, tier) => {
      const eff = upgrade.effect;
      if (!eff) return '';
      const perT = eff.perTier || 0;
      const curVal = perT * tier;
      const nextVal = perT * (tier + 1);
      const unit = ['critChance', 'dropRate'].includes(eff.stat) ? '%' : '';
      // For additive stats like projectiles/piercing show absolute
      if (['projectiles', 'piercing'].includes(eff.stat)) {
        return `<span style="color:#888">+${curVal}</span> → <span style="color:#0f0">+${nextVal}</span>`;
      }
      return `<span style="color:#888">+${curVal}${unit}</span> → <span style="color:#0f0">+${nextVal}${unit}</span>`;
    };
    
    let html = '';
    
    for (const [upgradeId, upgrade] of Object.entries(upgrades || {})) {
      const tier = current[upgradeId] || 0;
      const maxed = tier >= upgrade.maxTier;
      const cost = maxed ? 0 : upgrade.costs[tier];
      const canBuy = !maxed && cells >= cost;
      const preview = maxed ? '<span style="color:#0f0">MAXED</span>' : getStatPreview(upgrade, tier);
      
      html += `
        <div class="vendor-card ${maxed ? 'maxed' : ''} ${canBuy ? 'available' : ''}"
             onclick="UI.buyUpgrade('${upgradeId}')">
          <div class="upgrade-icon">${upgrade.icon}</div>
          <div class="upgrade-name">${upgrade.name}</div>
          <div class="upgrade-desc" style="font-size:9px;color:#8af;margin:2px 0">${upgrade.description || ''}</div>
          <div class="upgrade-preview" style="font-size:11px;font-family:'Orbitron',sans-serif;margin:3px 0">${preview}</div>
          <div class="upgrade-tier" style="font-size:9px;color:#666">Tier ${tier}/${upgrade.maxTier}</div>
          <div class="upgrade-cost ${canBuy ? '' : 'expensive'}">${maxed ? '✓' : cost + ' \u26A1'}</div>
        </div>
      `;
    }
    
    container.innerHTML = html;
  },
  
  // ========== TOOLTIPS ==========
  showItemTooltip(event, itemId) {
    const item = State.meta.stash.find(i => i.id === itemId);
    if (!item) return;
    
    const rarities = State.data.rarities;
    const rarityData = rarities?.[item.rarity];
    const isEquipped = Object.values(State.meta.equipment).includes(itemId);
    
    let statsHtml = '';
    for (const [stat, value] of Object.entries(item.stats || {})) {
      statsHtml += `<div class="tooltip-stat">+${value} ${this.formatStatName(stat)}</div>`;
    }
    for (const affix of item.affixes || []) {
      statsHtml += `<div class="tooltip-stat affix">+${affix.value} ${this.formatStatName(affix.stat)}</div>`;
    }
    
    const html = `
      <div class="tooltip-header">
        <span class="tooltip-icon">${item.icon}</span>
        <div>
          <div class="tooltip-name" style="color:${rarityData?.color || '#fff'}">${item.name}</div>
          <div class="tooltip-type">${item.slot} \u2022 Level ${item.level}</div>
        </div>
      </div>
      <div class="tooltip-body">
        ${statsHtml}
        <div class="tooltip-value">Sell: ${item.value} \uD83D\uDCB0</div>
        <div class="tooltip-hint">${isEquipped ? 'Click to unequip' : 'Click to equip'}</div>
      </div>
    `;
    
    this.showTooltip(event, html, rarityData?.color);
  },
  
  showSlotTooltip(event, slotId) {
    const slots = State.data.slots;
    if (!slots) return;
    
    const equipment = State.meta.equipment;
    const stash = State.meta.stash;
    const slotDef = slots[slotId];
    if (!slotDef) return;
    
    const equippedId = equipment[slotId];
    const item = equippedId ? stash.find(i => i.id === equippedId) : null;
    
    if (item) {
      this.showItemTooltip(event, item.id);
    } else {
      const html = `
        <div class="tooltip-header">
          <span class="tooltip-icon">${slotDef.icon}</span>
          <div>
            <div class="tooltip-name">${slotDef.name}</div>
            <div class="tooltip-type">Empty Slot</div>
          </div>
        </div>
        <div class="tooltip-body">
          <div class="tooltip-hint">Click to see available items</div>
        </div>
      `;
      this.showTooltip(event, html);
    }
  },
  
  showTooltip(event, html, color = null) {
    if (!this.tooltipEl) return;
    
    // Wrap in tooltip-panel for proper styling
    this.tooltipEl.innerHTML = `
      <div class="tooltip-panel" style="--rarity-color: ${color || 'var(--cyan)'}">
        ${html}
      </div>
    `;
    this.tooltipEl.classList.add('visible');
    
    // Position
    const rect = this.tooltipEl.getBoundingClientRect();
    let x = event.clientX + 15;
    let y = event.clientY + 15;
    
    // Keep on screen
    if (x + rect.width > window.innerWidth - 10) {
      x = event.clientX - rect.width - 15;
    }
    if (y + rect.height > window.innerHeight - 10) {
      y = event.clientY - rect.height - 15;
    }
    
    this.tooltipEl.style.left = x + 'px';
    this.tooltipEl.style.top = y + 'px';
  },
  
  hideTooltip() {
    if (this.tooltipEl) {
      this.tooltipEl.classList.remove('visible');
    }
  },
  
  // ========== ACTIONS ==========
  onEquipSlotClick(slotId) {
    const equipment = State.meta.equipment;
    const equippedId = equipment[slotId];
    
    if (equippedId) {
      // Unequip
      Items.unequip(slotId);
      Stats.calculate();
      Save.save();
      this.renderAll();
    }
  },
  
  onStashItemClick(itemId) {
    const item = State.meta.stash.find(i => i.id === itemId);
    if (!item) return;
    
    const isEquipped = Object.values(State.meta.equipment).includes(itemId);
    
    if (isEquipped) {
      // Find slot and unequip
      for (const [slot, id] of Object.entries(State.meta.equipment)) {
        if (id === itemId) {
          Items.unequip(slot);
          break;
        }
      }
    } else {
      // Equip
      Items.equip(itemId);
    }
    
    Stats.calculate();
    Save.save();
    this.renderAll();
  },
  
  // Right-click to sell item
  sellItem(event, itemId) {
    event.preventDefault(); // Prevent context menu
    
    const item = State.meta.stash.find(i => i.id === itemId);
    if (!item) return;
    
    // Can't sell equipped items directly
    const isEquipped = Object.values(State.meta.equipment).includes(itemId);
    if (isEquipped) {
      this.showFloatingText(event.clientX, event.clientY, 'Unequip first!', '#ff4444');
      return;
    }
    
    // Sell it!
    const value = Items.sell(itemId);
    
    // Show feedback
    this.showFloatingText(event.clientX, event.clientY, `+${value} \uD83D\uDCB0`, '#ffcc00');
    
    Save.save();
    this.renderAll();
    this.renderScrap();
  },
  
  // Show floating text feedback
  showFloatingText(x, y, text, color) {
    const el = document.createElement('div');
    el.className = 'floating-text';
    el.style.cssText = `
      position: fixed;
      left: ${x}px;
      top: ${y}px;
      color: ${color};
      font-family: 'Orbitron', monospace;
      font-size: 18px;
      font-weight: bold;
      text-shadow: 0 0 10px ${color};
      pointer-events: none;
      z-index: 9999;
      animation: floatUp 1s ease-out forwards;
    `;
    el.textContent = text;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1000);
  },
  
  // Update scrap display (hub/start/hud)
  renderScrap() {
    const metaScrap = State.meta.scrap || 0;
    const runScrap = State.run?.scrapEarned || 0;

    // Hub + Start screens show meta only
    const hubEl = document.getElementById('hubScrap');
    if (hubEl) hubEl.textContent = metaScrap;

    const startEl = document.getElementById('startScrap');
    if (startEl) startEl.textContent = metaScrap;

    // HUD shows meta + run earnings
    const hudEl = document.getElementById('hudScrap');
    if (hudEl) hudEl.textContent = metaScrap + runScrap;
  },
  
  // ========== HOLD-TO-REPEAT (stat + skill allocation) ==========
  _holdTimer: null,
  _holdDelay: 350,   // ms before repeat starts
  _holdRate: 80,     // ms between repeats

  startHold(type, arg1, arg2) {
    this.stopHold();
    const action = () => {
      if (type === 'stat') this.allocateStat(arg1);
      else if (type === 'skill') this.learnSkill(arg1, arg2);
    };
    // Immediate first allocation
    action();
    // After delay, start repeating
    this._holdTimer = setTimeout(() => {
      this._holdTimer = setInterval(action, this._holdRate);
    }, this._holdDelay);
  },

  stopHold() {
    if (this._holdTimer) {
      clearTimeout(this._holdTimer);
      clearInterval(this._holdTimer);
      this._holdTimer = null;
    }
  },

  allocateStat(statId) {
    if (Leveling.allocateStat(statId)) {
      this.renderPilotStats();
      this.renderShipStats();
    }
  },
  
  learnSkill(treeId, skillId) {
    if (Leveling.learnSkill(treeId, skillId)) {
      this.renderSkillTrees();
      this.renderShipStats();
    }
  },
  
  buyUpgrade(upgradeId) {
    const upgrades = State.data.runUpgrades;
    const upgrade = upgrades?.[upgradeId];
    if (!upgrade) return;
    
    const tier = State.run.upgrades[upgradeId] || 0;
    if (tier >= upgrade.maxTier) return;
    
    const cost = upgrade.costs[tier];
    if (State.run.cells < cost) return;
    
    State.run.cells -= cost;
    State.run.upgrades[upgradeId] = tier + 1;
    
    Stats.calculate();
    this.renderVendor();
    this.renderShipStats();
    
    // Purchase feedback
    const eff = upgrade.effect;
    const newTier = tier + 1;
    const msg = `${upgrade.icon} ${upgrade.name} T${newTier}: ${upgrade.description}`;
    if (State.ui) State.ui.announcement = { text: msg, timer: 2.5 };
    
    // Audio feedback
    const Audio = State.modules?.Audio;
    if (Audio?.pickup) Audio.pickup();
  },
  
  // ========== HELPERS ==========
  formatStatName(stat) {
    const names = {
      damage: 'Damage',
      fireRate: 'Fire Rate',
      speed: 'Speed',
      maxHP: 'Max HP',
      shieldCap: 'Shield',
      critChance: 'Crit %',
      critDamage: 'Crit Dmg',
      piercing: 'Pierce',
      projectiles: 'Projectiles',
      luck: 'Luck',
      pickupRadius: 'Pickup',
      hpRegen: 'HP Regen',
      shieldRegen: 'Shield Regen',
      lifesteal: 'Lifesteal'
    };
    return names[stat] || stat;
  }
};

// Global access
window.UI = UI;

export default UI;
