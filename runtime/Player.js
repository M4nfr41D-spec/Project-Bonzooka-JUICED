// Copyright (c) Manfred Foissner. All rights reserved.
// License: See LICENSE.txt in the project root.

// ============================================================
// Player.js - Player Controller (v2.5.0 - visual upgrade only)
// ============================================================

import { State } from './State.js';
import { Input } from './Input.js';
import { Bullets } from './Bullets.js';
import { Particles } from './Particles.js';

export const Player = {
  _hitFlash: 0,
  _thrustAnim: 0,

  update(dt, canvas, explorationMode = false) {
    const p = State.player;
    const cfg = State.data.config?.player || {};

    // ========== CORRUPTION DOT ==========
    if (p.dotT && p.dotT > 0) {
      p.dotT -= dt;
      this.takeDamage(p.maxHP * (p.dotPct || 0) * dt);
      if (p.dotT <= 0) { p.dotT = 0; p.dotPct = 0; }
    }

    // ========== MOVEMENT (WASD) ==========
    const move = Input.getMovement();

    const accel = cfg.acceleration || 3000;
    const friction = cfg.friction || 0.75;
    const deadzone = cfg.deadzone || 0.1;

    if (Math.abs(move.dx) > deadzone || Math.abs(move.dy) > deadzone) {
      const targetVX = move.dx * p.speed;
      const targetVY = move.dy * p.speed;
      p.vx += (targetVX - p.vx) * Math.min(1, accel * dt / p.speed);
      p.vy += (targetVY - p.vy) * Math.min(1, accel * dt / p.speed);
    } else {
      p.vx *= friction;
      p.vy *= friction;
      if (Math.abs(p.vx) < 5) p.vx = 0;
      if (Math.abs(p.vy) < 5) p.vy = 0;
    }

    p.x += p.vx * dt;
    p.y += p.vy * dt;

    // Boundary clamping
    const margin = p.radius + 5;
    if (explorationMode) {
      const zone = State.world?.currentZone;
      if (zone) {
        p.x = Math.max(margin, Math.min(zone.width - margin, p.x));
        p.y = Math.max(margin, Math.min(zone.height - margin, p.y));
      }
    } else {
      p.x = Math.max(margin, Math.min(canvas.width - margin, p.x));
      p.y = Math.max(margin, Math.min(canvas.height - margin, p.y));
    }

    // ========== AIM (Mouse) ==========
    if (explorationMode) {
      const Camera = State.modules?.Camera;
      if (Camera) {
        const worldMouse = Camera.screenToWorld(State.input.mouseX, State.input.mouseY);
        p.angle = Math.atan2(worldMouse.y - p.y, worldMouse.x - p.x);
      } else {
        p.angle = Input.getAimAngle(p.x, p.y);
      }
    } else {
      p.angle = Input.getAimAngle(p.x, p.y);
    }

    // ========== SHOOTING ==========
    p.fireCooldown -= dt;
    if (State.input.fire && p.fireCooldown <= 0) {
      this.fire();
      p.fireCooldown = 1 / this.getWeaponFireRate();
    }

    // ========== SHIELD REGEN ==========
    p.shieldRegenDelay -= dt;
    if (p.shieldRegenDelay <= 0 && p.shield < p.maxShield) {
      const regenRate = cfg.shieldRegenRate || 5;
      p.shield = Math.min(p.maxShield, p.shield + regenRate * dt);
    }
    
    // ========== KILL STREAK DECAY ==========
    const streak = State.run.streak;
    if (streak && streak.count > 0) {
      streak.timer += dt;
      // Streak breaks after 3.5s without a kill (generous window)
      if (streak.timer > 3.5) {
        if (streak.count >= 5) {
          // Announce streak break if it was significant
          const Particles = State.modules?.Particles;
          if (Particles) Particles.text(p.x, p.y - 30, `${streak.count}× STREAK ENDED`, '#ff4444', 14);
        }
        streak.count = 0;
        streak.timer = 0;
        streak.xpMult = 1;
        streak.lootMult = 1;
      }
    }
    
    // ========== ACTIVE ABILITIES ==========
    this.updateAbilities(dt);

    // ========== VISUAL: thrust lerp + flash decay ==========
    const isMoving = Math.abs(p.vx) > 15 || Math.abs(p.vy) > 15;
    this._thrustAnim += ((isMoving ? 1 : 0) - this._thrustAnim) * Math.min(1, dt * 8);
    if (this._hitFlash > 0) this._hitFlash -= dt;

    // Engine trail particles
    if (isMoving && Math.random() < 0.4) {
      const bx = p.x - Math.cos(p.angle) * 18;
      const by = p.y - Math.sin(p.angle) * 18;
      Particles.trail(bx, by, '#00ccff', 2);
    }

    // Update drone companion
    this.updateDrone(dt);
  },

  fire() {
    const p = State.player;
    const wType = p.weaponType || 'laser';
    const wDef = p.weaponDefs?.[wType] || p.weaponDefs?.laser;
    
    const baseAngle = p.angle;
    // Weapon modifies projectile count additively
    const count = p.projectiles + (wDef.projectiles || 0);
    // Weapon modifies spread
    const spreadDeg = wType === 'nova' ? 360 : (p.spread || 0) + (wDef.spread || 0);
    const spreadRad = spreadDeg * (Math.PI / 180);

    let angles = [];
    if (count === 1) {
      angles = [baseAngle];
    } else if (spreadDeg >= 360) {
      // Full circle (Nova)
      for (let i = 0; i < count; i++) {
        angles.push(baseAngle + (i / count) * Math.PI * 2);
      }
    } else {
      const totalSpread = spreadRad * (count - 1);
      const startAngle = baseAngle - totalSpread / 2;
      for (let i = 0; i < count; i++) {
        angles.push(startAngle + (spreadRad * i));
      }
    }

    // Weapon modifies damage, bulletSpeed, piercing
    const dmg = Math.max(1, Math.floor(p.damage * (wDef.damage || 1)));
    const bSpd = p.bulletSpeed * (wDef.bulletSpeed || 1);
    const pierce = p.piercing + (wDef.piercing || 0);

    for (const angle of angles) {
      // Gatling: random spread jitter
      const jitter = wType === 'gatling' ? (Math.random() - 0.5) * 0.12 : 0;
      const a = angle + jitter;
      
      Bullets.spawn({
        x: p.x + Math.cos(a) * 20,
        y: p.y + Math.sin(a) * 20,
        vx: Math.cos(a) * bSpd,
        vy: Math.sin(a) * bSpd,
        damage: dmg,
        piercing: pierce,
        isPlayer: true,
        crit: Math.random() * 100 < p.critChance,
        bulletType: wDef.bulletType || 'laser'
      });
    }

    Particles.spawn(p.x + Math.cos(p.angle) * 22, p.y + Math.sin(p.angle) * 22, 'muzzle');
    const muzzleX = p.x + Math.cos(p.angle) * 22;
    const muzzleY = p.y + Math.sin(p.angle) * 22;
    Particles.flash(muzzleX, muzzleY, wDef.color || '#00ffff', 3);

    // Audio feedback
    const Audio = State.modules?.Audio;
    if (Audio) Audio.shootLaser();
  },
  
  // Switch weapon type
  switchWeapon(newType) {
    const p = State.player;
    if (!p.weaponDefs?.[newType]) return;
    const old = p.weaponType;
    p.weaponType = newType;
    const wDef = p.weaponDefs[newType];
    
    // Announce
    const Particles = State.modules?.Particles;
    if (Particles) {
      Particles.text(p.x, p.y - 30, `${wDef.label} EQUIPPED`, wDef.color, 16);
      Particles.ring(p.x, p.y, wDef.color, 40);
    }
    const Audio = State.modules?.Audio;
    if (Audio) Audio.itemEquip?.() || Audio.shieldRecharge?.();
    
    console.log(`[WEAPON] ${old} → ${newType}`);
  },

  getWeaponFireRate() {
    const p = State.player;
    const wDef = p.weaponDefs?.[p.weaponType || 'laser'] || {};
    return p.fireRate * (wDef.fireRate || 1);
  },

  takeDamage(amount) {
    const p = State.player;
    
    // Dash invulnerability
    if (p._dashInvuln) return;
    
    // Corruption objective: incoming damage scales with corruption level
    const obj = State.run?.objective;
    if (obj && obj.type === 'corruption' && obj.currentMult > 1) {
      amount = Math.floor(amount * obj.currentMult);
    }
    
    if (State.run?.stats) State.run.stats.damageTaken += amount;

    // Shield absorbs first
    if (p.shield > 0) {
      const shieldDmg = Math.min(p.shield, amount);
      p.shield -= shieldDmg;
      amount -= shieldDmg;
      if (amount <= 0) {
        p.shieldRegenDelay = State.data.config?.player?.shieldRegenDelay || 3;
        return;
      }
    }

    p.hp -= amount;
    p.shieldRegenDelay = State.data.config?.player?.shieldRegenDelay || 3;
    this._hitFlash = 0.15;
    Particles.spawn(p.x, p.y, 'playerHit');

    // Audio
    const Audio = State.modules?.Audio;
    if (Audio) Audio.hitPlayer();

    if (p.hp <= 0) {
      p.hp = 0;
      Particles.spawn(p.x, p.y, 'explosion');
      if (Audio) Audio.explosionBig();
    }
  },

  applyDot(dot) {
    const p = State.player;
    const dur = (dot && dot.duration) ? dot.duration : 4.0;
    const pct = (dot && dot.dpsPctMaxHp) ? dot.dpsPctMaxHp : 0.01;
    p.dotT = Math.max(p.dotT || 0, dur);
    p.dotPct = Math.max(p.dotPct || 0, pct);
  },

  isDead() {
    return State.player.hp <= 0;
  },

  // ============ ACTIVE ABILITIES SYSTEM ============
  // Q/1 = Dash (invuln burst), R/2 = Shield Burst (AoE + temp shield), F/3 = Orbital Strike (ring damage)
  _dashTrail: [],
  
  updateAbilities(dt) {
    const p = State.player;
    const ab = p.abilities;
    if (!ab) return;
    const input = State.input;
    const Particles = State.modules?.Particles;
    const AudioA = State.modules?.Audio;
    
    // Tick cooldowns
    for (const key of ['dash', 'shield', 'orbital']) {
      if (ab[key].cooldown > 0) ab[key].cooldown = Math.max(0, ab[key].cooldown - dt);
      if (ab[key].duration > 0) ab[key].duration = Math.max(0, ab[key].duration - dt);
      if (ab[key].duration <= 0) ab[key].active = false;
    }
    
    // ── DASH (Q/1): 0.15s invuln burst forward ──
    if (input.ability1 && ab.dash.cooldown <= 0 && !ab.dash.active) {
      input.ability1 = false; // consume press
      ab.dash.active = true;
      ab.dash.duration = 0.15;
      ab.dash.cooldown = ab.dash.maxCooldown;
      
      // Burst forward in aim direction
      const dashSpeed = p.speed * 4;
      p.vx = Math.cos(p.angle) * dashSpeed;
      p.vy = Math.sin(p.angle) * dashSpeed;
      
      // VFX: afterimage trail + flash
      if (Particles) {
        Particles.flash(p.x, p.y, '#00ccff', 10);
        for (let i = 0; i < 8; i++) {
          const bx = p.x - Math.cos(p.angle) * i * 8;
          const by = p.y - Math.sin(p.angle) * i * 8;
          Particles.trail(bx, by, '#00ccff', 4);
        }
      }
      if (AudioA?.portalEnter) AudioA.portalEnter(); // whoosh reuse
    }
    
    // Dash invuln: player takes no damage while active
    p._dashInvuln = ab.dash.active;
    
    // ── SHIELD BURST (R/2): AoE knockback + temp bonus shield ──
    if (input.ability2 && ab.shield.cooldown <= 0 && !ab.shield.active) {
      input.ability2 = false;
      ab.shield.active = true;
      ab.shield.duration = 0.3;
      ab.shield.cooldown = ab.shield.maxCooldown;
      
      // Grant temp shield (50% of maxHP)
      const shieldGain = Math.floor(p.maxHP * 0.5);
      p.shield = Math.min(p.maxShield + shieldGain, p.shield + shieldGain);
      
      // AoE damage to nearby enemies (200px radius)
      const aoeRadius = 200;
      const aoeDmg = Math.floor(p.damage * 2);
      for (const e of State.enemies) {
        if (e.dead) continue;
        const dist = Math.hypot(e.x - p.x, e.y - p.y);
        if (dist < aoeRadius) {
          const Enemies = State.modules?.Enemies;
          if (Enemies?.damage) Enemies.damage(e, aoeDmg);
        }
      }
      
      // VFX: expanding ring + shield flash
      if (Particles) {
        Particles.ring(p.x, p.y, '#00ffaa', aoeRadius);
        Particles.ring(p.x, p.y, '#00ffaa', aoeRadius * 0.6);
        Particles.flash(p.x, p.y, '#00ffaa', 15);
        Particles.screenShake = Math.max(Particles.screenShake || 0, 5);
      }
      if (AudioA?.shieldRecharge) AudioA.shieldRecharge();
    }
    
    // ── ORBITAL STRIKE (F/3): expanding ring of damage ──
    if (input.ability3 && ab.orbital.cooldown <= 0 && !ab.orbital.active) {
      input.ability3 = false;
      ab.orbital.active = true;
      ab.orbital.duration = 0.8;
      ab.orbital.cooldown = ab.orbital.maxCooldown;
      ab.orbital._radius = 0; // grows over duration
      ab.orbital._hitSet = new Set(); // track already-hit enemies
      
      if (AudioA?.explosionBig) AudioA.explosionBig();
    }
    
    // Orbital Strike: expanding damage ring
    if (ab.orbital.active && ab.orbital.duration > 0) {
      const maxRadius = 350;
      const progress = 1 - (ab.orbital.duration / 0.8);
      ab.orbital._radius = progress * maxRadius;
      const r = ab.orbital._radius;
      const orbDmg = Math.floor(p.damage * 4);
      
      // Hit enemies in the ring band (r-30 to r)
      for (const e of State.enemies) {
        if (e.dead || ab.orbital._hitSet?.has(e)) continue;
        const dist = Math.hypot(e.x - p.x, e.y - p.y);
        if (dist < r && dist > r - 40) {
          const Enemies = State.modules?.Enemies;
          if (Enemies?.damage) Enemies.damage(e, orbDmg);
          ab.orbital._hitSet?.add(e);
        }
      }
      
      // VFX: ring particles at current radius
      if (Particles && Math.random() < 0.5) {
        const angle = Math.random() * Math.PI * 2;
        Particles.trail(p.x + Math.cos(angle) * r, p.y + Math.sin(angle) * r, '#ff6600', 5);
      }
    }
  },
  
  // Draw orbital strike ring overlay (called from main draw)
  drawAbilityEffects(ctx) {
    const p = State.player;
    const ab = p.abilities;
    if (!ab) return;
    
    // Dash trail afterimage
    if (ab.dash.active) {
      ctx.globalAlpha = 0.4;
      ctx.fillStyle = '#00ccff';
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius * 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    
    // Shield burst expanding ring
    if (ab.shield.active) {
      const progress = 1 - (ab.shield.duration / 0.3);
      const r = 200 * progress;
      ctx.strokeStyle = `rgba(0,255,170,${0.6 - progress * 0.6})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    
    // Orbital strike expanding ring
    if (ab.orbital.active) {
      const r = ab.orbital._radius || 0;
      // Outer ring
      ctx.strokeStyle = 'rgba(255,102,0,0.7)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.stroke();
      // Inner glow ring
      ctx.strokeStyle = 'rgba(255,200,0,0.3)';
      ctx.lineWidth = 30;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 1;
    }
  },

  // ============ DRONE COMPANION SYSTEM ============
  _droneAngle: 0,
  _droneFireTimer: 0,

  updateDrone(dt) {
    const p = State.player;
    const drone = p.drone;
    if (!drone || !drone.active) return;

    // Orbit around player
    const orbitSpeed = drone.type === 'shield' ? 1.5 : 2.2;
    this._droneAngle += dt * orbitSpeed;
    const orbitR = 45;
    drone.x = p.x + Math.cos(this._droneAngle) * orbitR;
    drone.y = p.y + Math.sin(this._droneAngle) * orbitR;

    if (drone.type === 'combat') {
      // Auto-fire at nearest enemy
      this._droneFireTimer -= dt;
      if (this._droneFireTimer <= 0) {
        let nearest = null;
        let nearDist = 350; // max range
        for (const e of State.enemies) {
          if (e.dead) continue;
          const d = Math.hypot(e.x - drone.x, e.y - drone.y);
          if (d < nearDist) { nearDist = d; nearest = e; }
        }
        if (nearest) {
          const ang = Math.atan2(nearest.y - drone.y, nearest.x - drone.x);
          const spd = 500;
          Bullets.spawn({
            x: drone.x, y: drone.y,
            vx: Math.cos(ang) * spd,
            vy: Math.sin(ang) * spd,
            damage: Math.max(1, Math.floor(p.damage * (drone.damagePct || 0.25))),
            piercing: 0,
            isPlayer: true,
            crit: false,
            bulletType: 'gatling'
          });
          this._droneFireTimer = drone.fireRate || 0.5;
        }
      }
    } else if (drone.type === 'shield') {
      // Absorb nearby enemy bullets
      for (let i = State.enemyBullets.length - 1; i >= 0; i--) {
        const b = State.enemyBullets[i];
        const d = Math.hypot(b.x - drone.x, b.y - drone.y);
        if (d < 20) {
          State.enemyBullets.splice(i, 1);
          drone.absorbed = (drone.absorbed || 0) + 1;
          // Small flash
          Particles.spawn(b.x, b.y, 'muzzle');
        }
      }
    } else if (drone.type === 'repair') {
      // Heal player over time
      drone._healTimer = (drone._healTimer || 0) + dt;
      if (drone._healTimer >= 1) {
        drone._healTimer = 0;
        const healAmt = Math.max(1, Math.floor(p.maxHP * (drone.healPct || 0.02)));
        if (p.hp < p.maxHP) {
          p.hp = Math.min(p.maxHP, p.hp + healAmt);
          Particles.trail(drone.x, drone.y, '#00ff88', 3);
        }
      }
    }
  },

  drawDrone(ctx) {
    const p = State.player;
    const drone = p.drone;
    if (!drone || !drone.active) return;

    const t = performance.now() * 0.001;
    const dx = drone.x;
    const dy = drone.y;

    ctx.save();
    ctx.translate(dx, dy);

    if (drone.type === 'combat') {
      // Small aggressive triangle
      ctx.rotate(this._droneAngle * 2);
      ctx.fillStyle = '#ff8844';
      ctx.shadowColor = '#ff6622';
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.moveTo(0, -8); ctx.lineTo(-6, 6); ctx.lineTo(6, 6);
      ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0;
    } else if (drone.type === 'shield') {
      // Blue hex shield icon
      ctx.rotate(t * 1.5);
      ctx.strokeStyle = '#44aaff';
      ctx.lineWidth = 2;
      ctx.shadowColor = '#44aaff';
      ctx.shadowBlur = 8;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = i * Math.PI / 3;
        i === 0 ? ctx.moveTo(Math.cos(a) * 8, Math.sin(a) * 8)
          : ctx.lineTo(Math.cos(a) * 8, Math.sin(a) * 8);
      }
      ctx.closePath();
      ctx.stroke();
      ctx.shadowBlur = 0;
    } else if (drone.type === 'repair') {
      // Green cross
      ctx.rotate(t);
      ctx.fillStyle = '#44ff88';
      ctx.shadowColor = '#00ff44';
      ctx.shadowBlur = 6;
      ctx.fillRect(-7, -2, 14, 4);
      ctx.fillRect(-2, -7, 4, 14);
      ctx.shadowBlur = 0;
    }

    ctx.restore();

    // Connection line to player
    ctx.save();
    ctx.globalAlpha = 0.12;
    ctx.strokeStyle = drone.type === 'combat' ? '#ff8844' :
      drone.type === 'shield' ? '#44aaff' : '#44ff88';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(dx, dy);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  },

  // ============ ENHANCED DRAW (v2.5.0) ============
  draw(ctx) {
    const p = State.player;
    const t = performance.now() * 0.001;
    const thrust = this._thrustAnim || 0;

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle + Math.PI / 2);

    // === ENGINE EXHAUST ===
    if (thrust > 0.05) {
      const fl = 0.7 + Math.random() * 0.3;
      const len = 16 + thrust * 14 * fl;

      const g1 = ctx.createLinearGradient(-7, 14, -7, 14 + len);
      g1.addColorStop(0, 'rgba(0,220,255,0.9)');
      g1.addColorStop(0.5, 'rgba(0,120,255,0.5)');
      g1.addColorStop(1, 'rgba(0,60,200,0)');
      ctx.fillStyle = g1;
      ctx.beginPath();
      ctx.moveTo(-10, 13); ctx.lineTo(-7, 13 + len); ctx.lineTo(-4, 13);
      ctx.fill();

      const g2 = ctx.createLinearGradient(7, 14, 7, 14 + len);
      g2.addColorStop(0, 'rgba(0,220,255,0.9)');
      g2.addColorStop(0.5, 'rgba(0,120,255,0.5)');
      g2.addColorStop(1, 'rgba(0,60,200,0)');
      ctx.fillStyle = g2;
      ctx.beginPath();
      ctx.moveTo(4, 13); ctx.lineTo(7, 13 + len * 0.85); ctx.lineTo(10, 13);
      ctx.fill();

      ctx.strokeStyle = 'rgba(200,240,255,0.7)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-7, 14); ctx.lineTo(-7, 14 + len * 0.5);
      ctx.moveTo(7, 14); ctx.lineTo(7, 14 + len * 0.45);
      ctx.stroke();
    }

    // === WING LAYER ===
    ctx.beginPath();
    ctx.moveTo(0, -18);
    ctx.lineTo(-16, 12); ctx.lineTo(-12, 15);
    ctx.lineTo(0, 8);
    ctx.lineTo(12, 15); ctx.lineTo(16, 12);
    ctx.closePath();
    const wg = ctx.createLinearGradient(-16, 0, 16, 0);
    wg.addColorStop(0, '#003344');
    wg.addColorStop(0.5, '#006677');
    wg.addColorStop(1, '#003344');
    ctx.fillStyle = wg;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,136,153,0.4)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Wing stripe accents
    ctx.strokeStyle = 'rgba(0,200,255,0.3)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(-3, -10); ctx.lineTo(-12, 12);
    ctx.moveTo(3, -10); ctx.lineTo(12, 12);
    ctx.stroke();

    // === HULL ===
    ctx.beginPath();
    ctx.moveTo(0, -21);
    ctx.lineTo(-8, 10); ctx.lineTo(0, 6); ctx.lineTo(8, 10);
    ctx.closePath();
    const hg = ctx.createLinearGradient(0, -21, 0, 10);
    hg.addColorStop(0, '#00ffcc');
    hg.addColorStop(0.4, '#00bb99');
    hg.addColorStop(1, '#005544');
    ctx.fillStyle = hg;
    ctx.fill();
    ctx.strokeStyle = '#00ffaa';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // === COCKPIT ===
    const cpulse = 0.7 + Math.sin(t * 3) * 0.3;
    ctx.shadowColor = '#00ffcc';
    ctx.shadowBlur = 8;
    ctx.fillStyle = `rgba(0,255,220,${cpulse})`;
    ctx.beginPath();
    ctx.ellipse(0, -8, 2.5, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // === NAV LIGHTS ===
    if (Math.sin(t * 4) > 0) {
      ctx.fillStyle = '#ff3333';
      ctx.beginPath(); ctx.arc(-15, 12, 1.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#33ff33';
      ctx.beginPath(); ctx.arc(15, 12, 1.5, 0, Math.PI * 2); ctx.fill();
    }

    // Engine nacelles
    ctx.fillStyle = '#00ddff';
    ctx.shadowColor = '#00ccff';
    ctx.shadowBlur = 5;
    ctx.beginPath(); ctx.arc(-7, 13, 2.5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(7, 13, 2.5, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;

    // === DAMAGE FLASH ===
    if (this._hitFlash > 0) {
      ctx.globalAlpha = this._hitFlash / 0.15;
      ctx.fillStyle = '#ff4444';
      ctx.beginPath();
      ctx.moveTo(0, -21); ctx.lineTo(-16, 12); ctx.lineTo(16, 12);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    ctx.restore();

    // === SHIELD HEX BUBBLE ===
    if (p.shield > 0) {
      const pct = p.shield / (p.maxShield || 1);
      const r = p.radius + 10 + Math.sin(t * 2) * 2;
      ctx.save();
      ctx.globalAlpha = 0.12 + pct * 0.2;
      ctx.strokeStyle = '#00ccff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = i * Math.PI / 3 - Math.PI / 6;
        const hx = p.x + Math.cos(a) * r;
        const hy = p.y + Math.sin(a) * r;
        i === 0 ? ctx.moveTo(hx, hy) : ctx.lineTo(hx, hy);
      }
      ctx.closePath();
      ctx.stroke();
      ctx.shadowColor = '#00ccff';
      ctx.shadowBlur = 12;
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.restore();
    }
  }
};

export default Player;
