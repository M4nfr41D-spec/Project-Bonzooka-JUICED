// Copyright (c) Manfred Foissner. All rights reserved.
// License: See LICENSE.txt in the project root.

// ============================================================
// PICKUPS.js - Loot and Currency Pickups
// ============================================================

import { State } from './State.js';
import { Items } from './Items.js';

export const Pickups = {
  // Update all pickups
  update(dt, canvas) {
    const p = State.player;
    const zone = State.world?.currentZone;
    const inWorld = !!zone;
    
    for (let i = State.pickups.length - 1; i >= 0; i--) {
      const pk = State.pickups[i];

      // Movement
      if (inWorld) {
        // Exploration mode: no gravity (space), strong damping to remove drift
        pk.x += pk.vx * dt;
        pk.y += pk.vy * dt;

        // Damping (frame-rate independent)
        const damp = Math.pow(0.12, dt); // ~88% damp per second
        pk.vx *= damp;
        pk.vy *= damp;

        if (Math.abs(pk.vx) < 2) pk.vx = 0;
        if (Math.abs(pk.vy) < 2) pk.vy = 0;

        // Keep within zone bounds
        const margin = 20;
        pk.x = Math.max(margin, Math.min(zone.width - margin, pk.x));
        pk.y = Math.max(margin, Math.min(zone.height - margin, pk.y));
      } else {
        // Wave mode: gravity + bounce floor
        pk.vy += 100 * dt;
        pk.x += pk.vx * dt;
        pk.y += pk.vy * dt;

        pk.vx *= 0.98;
        pk.vy *= 0.98;
      }
      
      // Lifetime
      pk.life -= dt;
      if (pk.life <= 0) {
        State.pickups.splice(i, 1);
        continue;
      }
      
      // Magnet effect
      const dx = p.x - pk.x;
      const dy = p.y - pk.y;
      const dist = Math.hypot(dx, dy);
      
      if (dist > 0.001 && dist < p.pickupRadius) {
        const pull = (p.pickupRadius - dist) / p.pickupRadius * 500;
        pk.x += (dx / dist) * pull * dt;
        pk.y += (dy / dist) * pull * dt;
      }
      
      // Collection
      if (dist < 25) {
        this.collect(pk);
        State.pickups.splice(i, 1);
        continue;
      }

      // Floor bounce (wave mode only)
      if (!inWorld) {
        const floorY = canvas.height - 20;
        if (pk.y > floorY) {
          pk.y = floorY;
          pk.vy = -Math.abs(pk.vy) * 0.5;
        }
      }
    }
  },
  
  // Add a pickup to the world
  add(config) {
    State.pickups.push({
      x: config.x || 0,
      y: config.y || 0,
      vx: config.vx || (Math.random() - 0.5) * 40,
      vy: config.vy || -40 + Math.random() * 20,
      life: config.life || 15,
      lifespan: config.life || 15,
      type: config.type || 'cells',
      value: config.value || 0,
      rarity: config.rarity || null,
      weaponType: config.weaponType || null,
      fromBoss: config.fromBoss || false
    });
  },
  
  // Collect a pickup
  collect(pickup) {
    const Audio = State.modules?.Audio;
    switch (pickup.type) {
      case 'cells':
        State.run.cells += pickup.value;
        this.spawnCollectEffect(pickup.x, pickup.y, '#00d4ff');
        this.spawnFloatText(pickup.x, pickup.y, `+${pickup.value}\u26A1`, '#00d4ff');
        if (Audio) Audio.pickupScrap();
        break;
        
      case 'scrap':
        State.run.scrapEarned += pickup.value;
        this.spawnCollectEffect(pickup.x, pickup.y, '#ffd700');
        this.spawnFloatText(pickup.x, pickup.y, `+${pickup.value}\uD83D\uDCB0`, '#ffd700');
        if (Audio) Audio.pickupScrap();
        break;
        
      case 'item':
        const item = Items.generateRandom(pickup.rarity, pickup.rarityFloor, pickup.ilvl, {
          fromBoss: pickup.fromBoss,
          bossType: pickup.bossType
        });
        if (item) {
          const added = Items.addToStash(item);
          if (added) {
            this.spawnCollectEffect(pickup.x, pickup.y, State.data.rarities[item.rarity]?.color || '#ffffff');
            this.spawnFloatText(pickup.x, pickup.y, item.name, State.data.rarities[item.rarity]?.color || '#ffffff');
            if (window.UI) window.UI.renderStash();
            if (Audio) Audio.pickupItem();
          } else {
            const scrapValue = item.value;
            State.run.scrapEarned += scrapValue;
            this.spawnFloatText(pickup.x, pickup.y, `FULL! +${scrapValue}\uD83D\uDCB0`, '#ff8800');
            if (Audio) Audio.pickupScrap();
          }
        }
        break;
        
      case 'health':
        const healed = pickup.value || 25;
        State.player.hp = Math.min(State.player.maxHP, State.player.hp + healed);
        this.spawnCollectEffect(pickup.x, pickup.y, '#00ff88');
        this.spawnFloatText(pickup.x, pickup.y, `+${healed}\u00E2\u009D\u00A4\u00EF\u00B8\u008F`, '#00ff88');
        if (Audio) Audio.pickupHealth();
        break;
        
      case 'xp':
        import('./Leveling.js').then(module => {
          module.Leveling.addXP(pickup.value);
        });
        this.spawnCollectEffect(pickup.x, pickup.y, '#aa55ff');
        this.spawnFloatText(pickup.x, pickup.y, `+${pickup.value}XP`, '#aa55ff');
        if (Audio) Audio.pickupScrap();
        break;
        
      case 'weapon': {
        const Player = State.modules?.Player;
        if (Player?.switchWeapon) Player.switchWeapon(pickup.weaponType);
        const wDef = State.player.weaponDefs?.[pickup.weaponType];
        const wCol = wDef?.color || '#ffffff';
        this.spawnCollectEffect(pickup.x, pickup.y, wCol);
        break;
      }
    }
  },
  
  // Spawn collection effect
  spawnCollectEffect(x, y, color) {
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      State.particles.push({
        x: x,
        y: y,
        vx: Math.cos(angle) * 80,
        vy: Math.sin(angle) * 80,
        life: 0.25,
        maxLife: 0.25,
        color: color,
        size: 4
      });
    }
  },
  
  // Spawn floating text
  spawnFloatText(x, y, text, color) {
    State.particles.push({
      x: x,
      y: y - 10,
      vx: 0,
      vy: -60,
      life: 0.8,
      maxLife: 0.8,
      text: text,
      isText: true,
      color: color,
      size: 14
    });
  },
  
  // Draw all pickups
  draw(ctx) {
    const now = Date.now();
    
    for (const pk of State.pickups) {
      // Fade when about to expire
      ctx.globalAlpha = Math.min(1, pk.life * 2);
      
      // Pulse effect
      const pulse = 1 + Math.sin(now * 0.01) * 0.1;
      
      // === DROP BOUNCE (first 0.5s of life) ===
      // life counts down from ~30. If life > 29.5, we're in the first 0.5s
      const maxLife = pk.lifespan || 30;
      const age = maxLife - pk.life;
      let bounceY = 0;
      if (age < 0.5) {
        // Elastic bounce: drop from 20px above, bounce twice
        const t = age / 0.5;
        bounceY = -20 * Math.abs(Math.sin(t * Math.PI * 2.5)) * (1 - t);
      }
      
      switch (pk.type) {
        case 'cells':
          ctx.fillStyle = '#00d4ff';
          ctx.shadowColor = '#00d4ff';
          ctx.shadowBlur = 12;
          ctx.beginPath();
          ctx.arc(pk.x, pk.y, 8 * pulse, 0, Math.PI * 2);
          ctx.fill();
          
          // Lightning bolt symbol
          ctx.fillStyle = '#ffffff';
          ctx.font = 'bold 10px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('\u26A1', pk.x, pk.y + 4);
          break;
          
        case 'scrap':
          ctx.fillStyle = '#ffd700';
          ctx.shadowColor = '#ffd700';
          ctx.shadowBlur = 12;
          ctx.beginPath();
          ctx.arc(pk.x, pk.y, 8 * pulse, 0, Math.PI * 2);
          ctx.fill();
          
          ctx.fillStyle = '#000000';
          ctx.font = 'bold 10px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('$', pk.x, pk.y + 3);
          break;
          
        case 'item':
          const rarityColor = State.data.rarities?.[pk.rarity]?.color || '#ffffff';
          const rarityOrder = { common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4, mythic: 5 };
          const rIdx = rarityOrder[pk.rarity] || 0;
          
          // Scale size by rarity: common=10, uncommon=12, rare=14, epic=16, legendary=18, mythic=20
          const baseSize = 10 + rIdx * 2;
          const sz = baseSize * pulse;
          
          // Apply bounce offset
          const drawY = pk.y + bounceY;
          
          // Glow scales with rarity
          ctx.shadowColor = rarityColor;
          ctx.shadowBlur = 10 + rIdx * 5;
          
          // Rare+ ground glow (circular aura beneath the item)
          if (rIdx >= 2) {
            const auraR = 20 + rIdx * 8;
            const auraGrad = ctx.createRadialGradient(pk.x, pk.y + 4, 0, pk.x, pk.y + 4, auraR);
            auraGrad.addColorStop(0, rarityColor + '33');
            auraGrad.addColorStop(0.5, rarityColor + '15');
            auraGrad.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = auraGrad;
            ctx.beginPath();
            ctx.arc(pk.x, pk.y + 4, auraR, 0, Math.PI * 2);
            ctx.fill();
          }
          
          // Epic+ gets a vertical beam of light
          if (rIdx >= 3) {
            const beamAlpha = 0.15 + rIdx * 0.05;
            const beamW = 3 + rIdx;
            ctx.fillStyle = rarityColor;
            ctx.globalAlpha = Math.min(1, pk.life * 2) * beamAlpha;
            ctx.fillRect(pk.x - beamW/2, drawY - 80, beamW, 160);
            ctx.globalAlpha = Math.min(1, pk.life * 2);
          }
          
          // Diamond shape (with bounce offset)
          ctx.fillStyle = rarityColor;
          ctx.beginPath();
          ctx.moveTo(pk.x, drawY - sz);
          ctx.lineTo(pk.x + sz * 0.8, drawY);
          ctx.lineTo(pk.x, drawY + sz);
          ctx.lineTo(pk.x - sz * 0.8, drawY);
          ctx.closePath();
          ctx.fill();
          
          // Inner highlight
          ctx.fillStyle = '#ffffff';
          ctx.globalAlpha = Math.min(1, pk.life * 2) * 0.4;
          ctx.beginPath();
          ctx.moveTo(pk.x, drawY - sz * 0.5);
          ctx.lineTo(pk.x + sz * 0.3, drawY);
          ctx.lineTo(pk.x, drawY + sz * 0.5);
          ctx.lineTo(pk.x - sz * 0.3, drawY);
          ctx.closePath();
          ctx.fill();
          ctx.globalAlpha = Math.min(1, pk.life * 2);
          
          // Rarity ring (thicker for higher rarity)
          ctx.strokeStyle = rarityColor;
          ctx.lineWidth = 1 + rIdx * 0.5;
          ctx.beginPath();
          ctx.arc(pk.x, drawY, (sz + 6) * pulse, 0, Math.PI * 2);
          ctx.stroke();
          
          // Legendary+ gets orbiting sparkles
          if (rIdx >= 4) {
            const t = now * 0.003;
            const sparkCount = rIdx === 5 ? 4 : 2;
            for (let s = 0; s < sparkCount; s++) {
              const angle = t + (s * Math.PI * 2 / sparkCount);
              const sx = pk.x + Math.cos(angle) * (sz + 10);
              const sy = drawY + Math.sin(angle) * (sz + 10);
              ctx.fillStyle = '#ffffff';
              ctx.globalAlpha = Math.min(1, pk.life * 2) * 0.8;
              ctx.beginPath();
              ctx.arc(sx, sy, 2, 0, Math.PI * 2);
              ctx.fill();
            }
            ctx.globalAlpha = Math.min(1, pk.life * 2);
          }
          
          // Rarity label text for rare+
          if (rIdx >= 2) {
            const labels = { rare: 'RARE', epic: 'EPIC', legendary: 'LEGEND', mythic: 'MYTHIC' };
            const label = labels[pk.rarity];
            if (label) {
              ctx.fillStyle = rarityColor;
              ctx.font = `bold ${8 + rIdx}px sans-serif`;
              ctx.textAlign = 'center';
              ctx.fillText(label, pk.x, drawY - sz - 6);
            }
          }
          break;
          
        case 'health':
          ctx.fillStyle = '#00ff88';
          ctx.shadowColor = '#00ff88';
          ctx.shadowBlur = 12;
          ctx.beginPath();
          ctx.arc(pk.x, pk.y, 8 * pulse, 0, Math.PI * 2);
          ctx.fill();
          
          ctx.fillStyle = '#ffffff';
          ctx.font = 'bold 12px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('+', pk.x, pk.y + 4);
          break;
          
        case 'xp':
          ctx.fillStyle = '#aa55ff';
          ctx.shadowColor = '#aa55ff';
          ctx.shadowBlur = 10;
          ctx.beginPath();
          ctx.arc(pk.x, pk.y, 6 * pulse, 0, Math.PI * 2);
          ctx.fill();
          break;
          
        case 'weapon': {
          const wDef = State.player.weaponDefs?.[pk.weaponType];
          const wCol = wDef?.color || '#ffffff';
          const wDrawY = pk.y + bounceY;
          // Glowing hexagon
          ctx.shadowColor = wCol;
          ctx.shadowBlur = 16;
          ctx.fillStyle = wCol;
          ctx.beginPath();
          for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2 - Math.PI / 6;
            const r = 14 * pulse;
            const mx = i === 0 ? 'moveTo' : 'lineTo';
            ctx[mx](pk.x + Math.cos(a) * r, wDrawY + Math.sin(a) * r);
          }
          ctx.closePath();
          ctx.fill();
          // Weapon label
          ctx.fillStyle = '#000';
          ctx.font = 'bold 9px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(wDef?.label?.[0] || '?', pk.x, wDrawY + 3);
          // Name above
          ctx.fillStyle = wCol;
          ctx.font = 'bold 10px sans-serif';
          ctx.fillText(wDef?.label || pk.weaponType, pk.x, wDrawY - 18);
          break;
        }
      }
      
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    }
  }
};

export default Pickups;
