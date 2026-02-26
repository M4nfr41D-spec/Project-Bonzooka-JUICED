// Copyright (c) Manfred Foissner. All rights reserved.
// License: See LICENSE.txt in the project root.

// ============================================================
// BULLETS.js - Projectile System
// ============================================================

import { State } from './State.js';
import { Enemies } from './Enemies.js';
import { Player } from './Player.js';
import { SpatialHash } from './SpatialHash.js';

export const Bullets = {
  // Spawn a new bullet
  spawn(config) {
    State.bullets.push({
      x: config.x,
      y: config.y,
      vx: config.vx || 0,
      vy: config.vy || -500,
      damage: config.damage || 10,
      size: config.size || 4,
      pierce: config.piercing || 0,
      hits: 0,
      isCrit: config.crit || false,
      isPlayer: config.isPlayer !== false,
      bulletType: config.bulletType || 'laser'
    });
  },
  
  // Spawn enemy bullet
  spawnEnemy(config) {
    State.enemyBullets.push({
      x: config.x,
      y: config.y,
      vx: config.vx || 0,
      vy: config.vy || 200,
      damage: config.damage || 10,
      size: config.size || 6,
      bulletType: config.bulletType || 'enemy'
    });
  },
  
  // Update all bullets
  update(dt, canvas) {
    // Player bullets
    for (let i = State.bullets.length - 1; i >= 0; i--) {
      const b = State.bullets[i];
      
      b.x += b.vx * dt;
      b.y += b.vy * dt;      // Off screen (world mode uses zone bounds)
      const zone = State.world?.currentZone;
      if (zone) {
        const margin = 200;
        if (b.y < -margin || b.y > zone.height + margin || b.x < -margin || b.x > zone.width + margin) {
          State.bullets.splice(i, 1);
          continue;
        }
      } else {
        if (b.y < -20 || b.y > canvas.height + 20 || b.x < -20 || b.x > canvas.width + 20) {
          State.bullets.splice(i, 1);
          continue;
        }
      }
      // ── Spatial hash accelerated collision (falls back to brute-force if grid unavailable) ──
      const grid = State._spatialGrid;
      const queryR = Math.max(b.size, 10) + 80; // covers largest asteroid/enemy radius

      // Check collision with asteroid props (player bullets only)
      if (b.isPlayer) {
        let hitAsteroid = false;
        const nearby = grid
          ? SpatialHash.query(grid, b.x, b.y, queryR)
          : (zone?.obstacles || []);
        for (const a of nearby) {
          if (!a || a.destroyed || a.dead !== undefined) continue; // skip enemies (they have .dead)
          const distA = Math.hypot(b.x - a.x, b.y - a.y);
          if (distA < (b.size + (a.radius || 50))) {
            // Mine: detonate on bullet hit
            if (a.type === 'mine') {
              a.destroyed = true;
              const Particles = State.modules?.Particles;
              const PlayerMod = State.modules?.Player;
              if (Particles) {
                Particles.explosion(a.x, a.y, '#ff4400', 30, 280);
                Particles.explosion(a.x, a.y, '#ffcc00', 15, 180);
                Particles.ring(a.x, a.y, '#ff6600', 60);
                Particles.ring(a.x, a.y, '#ffcc00', 35);
                Particles.flash(a.x, a.y, '#ffffff', 20);
                Particles.screenShake = Math.max(Particles.screenShake || 0, 8);
              }
              const AudioB = State.modules?.Audio;
              if (AudioB) AudioB.mineExplosion();
              // Splash damage to player if close
              const pDist = Math.hypot(State.player.x - a.x, State.player.y - a.y);
              if (pDist < 100 && PlayerMod) PlayerMod.takeDamage(a.damage || 15);
              // Splash damage to enemies
              for (const en of State.enemies) {
                if (en.dead) continue;
                if (Math.hypot(en.x - a.x, en.y - a.y) < 100) {
                  const EnemiesMod = State.modules?.Enemies;
                  if (EnemiesMod) EnemiesMod.damage(en, (a.damage || 15) * 0.6, false);
                }
              }
              State.bullets.splice(i, 1);
              hitAsteroid = true;
              break;
            }

            // Non-destructible obstacles (pillars): just stop bullet
            if (a.destructible === false) {
              // Spark impact
              for (let k = 0; k < 4; k++) {
                State.particles.push({
                  x: b.x, y: b.y,
                  vx: (Math.random() - 0.5) * 120,
                  vy: (Math.random() - 0.5) * 120,
                  life: 0.15, maxLife: 0.2,
                  color: '#aabbcc', size: 2
                });
              }
              State.bullets.splice(i, 1);
              hitAsteroid = true;
              break;
            }

            // Damage destructible obstacle
            a.hp = (typeof a.hp === 'number') ? a.hp - b.damage : 0;

            // Impact sparks (bigger than before)
            for (let k = 0; k < 5; k++) {
              State.particles.push({
                x: b.x, y: b.y,
                vx: (Math.random() - 0.5) * 120,
                vy: (Math.random() - 0.5) * 120,
                life: 0.2, maxLife: 0.25,
                color: k < 2 ? '#ffffff' : '#aabbcc',
                size: 2 + Math.random()
              });
            }

            // Destroyed -> explosion + drop resources
            if (a.hp <= 0) {
              a.destroyed = true;
              
              // Generator destroyed → objective progress
              if (a.isGenerator) {
                const obj = State.run.objective;
                if (obj && obj.type === 'lockdown' && !obj.complete) {
                  obj.progress++;
                  const Particles = State.modules?.Particles;
                  if (Particles) {
                    Particles.text(a.x, a.y - 30, `GENERATOR ${obj.progress}/${obj.target}`, '#ff4444', 14);
                    Particles.explosion(a.x, a.y, '#ff4444', 10, 60);
                  }
                  if (obj.progress >= obj.target) {
                    obj.complete = true;
                    this._announceObjectiveComplete();
                  }
                }
              }

              // Destruction explosion
              const Particles = State.modules?.Particles;
              if (Particles) {
                const r = a.radius || 30;
                // Resource nodes get colored explosions
                const expColor = a.glow || '#889aab';
                Particles.explosion(a.x, a.y, expColor, Math.floor(r * 0.5), r * 2.5);
                Particles.ring(a.x, a.y, expColor, r * 1.2);
                if (r > 40) Particles.flash(a.x, a.y, '#ffffff', r * 0.3);
                Particles.screenShake = Math.max(Particles.screenShake || 0, Math.min(3, r * 0.04));
              }

              // ── RESOURCE NODE DROPS ──
              if (a.resourceType) {
                const mult = a.resourceMult || 1;
                const acfg = State.data.config?.asteroids || {};
                const sMin = (typeof acfg.scrapMin === 'number') ? acfg.scrapMin : 2;
                const sMax = (typeof acfg.scrapMax === 'number') ? acfg.scrapMax : 6;
                const sizeFactor = Math.max(0.7, Math.min(1.6, (a.radius || 50) / 50));
                
                switch (a.resourceType) {
                  case 'scrap':
                    State.pickups.push({
                      type: 'scrap', x: a.x, y: a.y,
                      vx: (Math.random() - 0.5) * 60, vy: (Math.random() - 0.5) * 60,
                      life: 15, value: Math.max(1, Math.floor((sMin + Math.random() * (sMax - sMin + 1)) * sizeFactor * mult))
                    });
                    break;
                  case 'cells':
                    State.pickups.push({
                      type: 'cells', x: a.x, y: a.y,
                      vx: (Math.random() - 0.5) * 60, vy: (Math.random() - 0.5) * 60,
                      life: 15, value: Math.max(1, Math.floor((sMin * 0.7 + Math.random() * sMax * 0.5) * mult))
                    });
                    // Chance for void shard
                    if (a.voidShardChance && Math.random() < a.voidShardChance) {
                      State.meta.voidShards = (State.meta.voidShards || 0) + 1;
                      if (State.ui) State.ui.announcement = { text: '💠 VOID SHARD found!', timer: 2 };
                      const AudioR = State.modules?.Audio;
                      if (AudioR?.voidShardDrop) AudioR.voidShardDrop();
                    }
                    break;
                  case 'voidShard':
                    State.meta.voidShards = (State.meta.voidShards || 0) + 1;
                    if (State.ui) State.ui.announcement = { text: '💠 VOID SHARD found!', timer: 2 };
                    { const AudioV = State.modules?.Audio; if (AudioV?.voidShardDrop) AudioV.voidShardDrop(); }
                    // Chance for cosmic dust
                    if (a.cosmicDustChance && Math.random() < a.cosmicDustChance) {
                      State.meta.cosmicDust = (State.meta.cosmicDust || 0) + 1;
                      if (State.ui) State.ui.announcement = { text: '✨ COSMIC DUST found!', timer: 2.5 };
                      const AudioC = State.modules?.Audio;
                      if (AudioC?.cosmicDustDrop) AudioC.cosmicDustDrop();
                    }
                    // Also drop some scrap
                    State.pickups.push({
                      type: 'scrap', x: a.x, y: a.y,
                      vx: (Math.random() - 0.5) * 60, vy: (Math.random() - 0.5) * 60,
                      life: 15, value: Math.max(3, Math.floor(sMax * sizeFactor))
                    });
                    break;
                  case 'mixed':
                    // Mixed: scrap + cells + chance of item
                    State.pickups.push({
                      type: 'scrap', x: a.x + 10, y: a.y,
                      vx: (Math.random() - 0.5) * 80, vy: (Math.random() - 0.5) * 80,
                      life: 15, value: Math.floor((sMax + Math.random() * sMax) * mult)
                    });
                    State.pickups.push({
                      type: 'cells', x: a.x - 10, y: a.y,
                      vx: (Math.random() - 0.5) * 80, vy: (Math.random() - 0.5) * 80,
                      life: 15, value: Math.floor((sMin + Math.random() * sMax * 0.5) * mult)
                    });
                    if (a.itemChance && Math.random() < a.itemChance) {
                      State.pickups.push({
                        type: 'item', x: a.x, y: a.y + 15,
                        vx: (Math.random() - 0.5) * 40, vy: -30 + Math.random() * 20,
                        life: 15, rarity: Math.random() < 0.2 ? 'epic' : 'rare',
                        ilvl: State.run.currentDepth || State.meta.level || 1
                      });
                    }
                    break;
                }
              } else {
                // Standard asteroid: drop scrap (original behavior)
                const acfg = State.data.config?.asteroids || {};
                const sMin = (typeof acfg.scrapMin === 'number') ? acfg.scrapMin : 2;
                const sMax = (typeof acfg.scrapMax === 'number') ? acfg.scrapMax : 6;
                const sizeFactor = Math.max(0.7, Math.min(1.6, (a.radius || 50) / 50));
                const value = Math.floor((sMin + Math.random() * (sMax - sMin + 1)) * sizeFactor);
                State.pickups.push({
                  type: 'scrap',
                  x: a.x, y: a.y,
                  vx: (Math.random() - 0.5) * 60,
                  vy: (Math.random() - 0.5) * 60,
                  life: 12,
                  value: Math.max(1, value)
                });
              }
            }

            // Bullet consumed
            State.bullets.splice(i, 1);
            hitAsteroid = true;
            break;
          }
        }
        if (hitAsteroid) continue;
      }

      // Check collision with enemies (spatial hash query or fallback)
      const nearbyEnemies = grid
        ? SpatialHash.query(grid, b.x, b.y, queryR)
        : State.enemies;

      // ── Shielder barrier: block player bullets in arc ──
      if (b.isPlayer) {
        let blocked = false;
        for (const e of nearbyEnemies) {
          if (e.dead || !e.abilities || !e.abilities.includes('projectBarrier')) continue;
          if (e._barrierHP <= 0) continue;
          const dx = b.x - e.x;
          const dy = b.y - e.y;
          const dist = Math.hypot(dx, dy);
          if (dist > (e._barrierRadius || 100) || dist < e.size) continue;
          // Check if bullet is within barrier arc
          const bulletAngle = Math.atan2(dy, dx);
          let diff = bulletAngle - (e._barrierAngle || 0);
          diff = ((diff + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
          if (Math.abs(diff) < (e._barrierArc || 1.2) / 2) {
            e._barrierHP -= b.damage;
            e._barrierRegenTimer = 0;
            // Deflect spark
            State.particles.push({
              x: b.x, y: b.y,
              vx: (Math.random() - 0.5) * 100, vy: (Math.random() - 0.5) * 100,
              life: 0.15, maxLife: 0.2, color: '#33aacc', size: 3
            });
            State.bullets.splice(i, 1);
            blocked = true;
            break;
          }
        }
        if (blocked) continue;
      }

      for (const e of nearbyEnemies) {
        if (e.dead || e.destroyed !== undefined) continue; // skip asteroids (they have .destroyed)
        
        const dist = Math.hypot(b.x - e.x, b.y - e.y);
        if (dist < b.size + e.size) {
          // Hit!
          const killData = Enemies.damage(e, b.damage, b.isCrit);
          
          // Spawn damage number
          this.spawnDamageNumber(b.x, b.y, b.damage, b.isCrit);
          
          // Per-weapon impact VFX
          const Particles = State.modules?.Particles;
          if (Particles) {
            const bType = b.bulletType || 'laser';
            switch (bType) {
              case 'laser':
                Particles.sparks(b.x, b.y, '#00ffff', b.isCrit ? 6 : 3);
                break;
              case 'plasma':
                Particles.sparks(b.x, b.y, '#88ff44', 4);
                Particles.trail(b.x + (Math.random()-0.5)*8, b.y + (Math.random()-0.5)*8, '#aaff66', 3);
                break;
              case 'railgun':
                Particles.sparks(b.x, b.y, '#cc88ff', 5);
                Particles.flash(b.x, b.y, '#ddaaff', 4);
                break;
              case 'missile':
                Particles.explosion(b.x, b.y, '#ff8800', 8, 80);
                Particles.flash(b.x, b.y, '#ffaa00', 6);
                break;
              case 'gatling':
                Particles.sparks(b.x, b.y, '#ffee44', 2);
                break;
              case 'nova':
                Particles.ring(b.x, b.y, '#aa66ff', 20);
                Particles.sparks(b.x, b.y, '#cc88ff', 3);
                break;
              default:
                Particles.sparks(b.x, b.y, '#00ffff', 3);
            }
          }
          
          // Audio (hit only, kill sfx handled in Enemies.damage)
          if (!killData) {
            const Audio = State.modules?.Audio;
            if (Audio) Audio.hitEnemy();
          }
          
          // Handle kill rewards
          if (killData) {
            this.onEnemyKilled(killData);
          }
          
          b.hits++;
          if (b.hits > b.pierce) {
            State.bullets.splice(i, 1);
          }
          break;
        }
      }
    }
    
    // Enemy bullets
    for (let i = State.enemyBullets.length - 1; i >= 0; i--) {
      const b = State.enemyBullets[i];
      
      b.x += b.vx * dt;
      b.y += b.vy * dt;      // Off screen (world mode uses zone bounds)
      const zone = State.world?.currentZone;
      if (zone) {
        const margin = 200;
        if (b.y < -margin || b.y > zone.height + margin || b.x < -margin || b.x > zone.width + margin) {
          State.enemyBullets.splice(i, 1);
          continue;
        }
      } else {
        if (b.y < -20 || b.y > canvas.height + 20 || b.x < -20 || b.x > canvas.width + 20) {
          State.enemyBullets.splice(i, 1);
          continue;
        }
      }
      // Check collision with player
      const p = State.player;
      const dist = Math.hypot(b.x - p.x, b.y - p.y);
      if (dist < b.size + 15) {
        Player.takeDamage(b.damage);
        if (b.dot) Player.applyDot(b.dot);
        State.enemyBullets.splice(i, 1);
      }
    }
  },
  
  // Spawn floating damage number
  spawnDamageNumber(x, y, damage, isCrit) {
    const cfg = State.data.config?.effects?.damageNumbers || {};
    
    // Config values with Diablo-style defaults
    const baseSize = cfg.baseSize || 16;
    const critSize = cfg.critSize || 28;
    const normalColor = cfg.normalColor || '#ffffff';
    const critColor = cfg.critColor || '#ffcc00';
    const bigHitColor = cfg.bigHitColor || '#ff6600';
    const floatSpeed = cfg.floatSpeed || 120;
    const duration = cfg.duration || 0.9;
    const spread = cfg.spread || 30;
    
    // Big hit threshold (relative to player damage)
    const bigHitThreshold = State.player.damage * 3;
    const isBigHit = damage >= bigHitThreshold;
    
    let color = normalColor;
    let size = baseSize;
    
    if (isCrit) {
      color = critColor;
      size = critSize;
    }
    if (isBigHit) {
      color = bigHitColor;
      size = critSize + 4;
    }
    
    State.particles.push({
      x: x + (Math.random() - 0.5) * spread,
      y: y,
      vx: (Math.random() - 0.5) * 50,
      vy: -floatSpeed,
      life: duration,
      maxLife: duration,
      text: Math.round(damage).toString(),
      isText: true,
      color: color,
      size: size,
      isCrit: isCrit,
      scale: isCrit ? 1.5 : 1.0  // For punch animation
    });
  },
  
  // Handle enemy kill rewards
  onEnemyKilled(killData) {
    const cfg = State.data.config;
    
    // ═══ KILL STREAK SYSTEM ═══
    const streak = State.run.streak;
    if (streak) {
      streak.count++;
      streak.timer = 0; // reset decay timer
      streak.best = Math.max(streak.best, streak.count);
      // Multipliers: ×1.0 at 1 kill, ×2.0 at 11 kills, ×3.0 at 21+ kills (linear 0.1 per kill)
      streak.xpMult = Math.min(3.0, 1 + (streak.count - 1) * 0.1);
      // Loot: ×1.0 at 1 kill, ×1.5 at 11, ×2.0 at 21+ (0.05 per kill)
      streak.lootMult = Math.min(2.0, 1 + (streak.count - 1) * 0.05);
      
      // Milestone audio + particles at thresholds
      const AudioS = State.modules?.Audio;
      const Particles = State.modules?.Particles;
      if (streak.count === 5 || streak.count === 10 || streak.count === 15 || streak.count === 20) {
        if (AudioS?.comboUp) AudioS.comboUp(streak.count);
        if (Particles) {
          Particles.ring(State.player.x, State.player.y, '#ffcc00', 60 + streak.count * 3);
          Particles.flash(State.player.x, State.player.y, '#ffcc00', 8);
        }
        // Announce milestones
        if (State.ui) {
          const mult = streak.xpMult.toFixed(1);
          State.ui.announcement = { text: `🔥 ${streak.count}× STREAK! (${mult}× XP)`, timer: 1.5 };
        }
      }
    }
    
    // ═══ DIFFICULTY MULTIPLIERS ═══
    const World = State.modules?.World;
    const diffMods = World?.getDiffMods?.() || { cellsMult: 1, scrapMult: 1, xpMult: 1, lootRarityBoost: 0 };
    
    // Streak multiplier stacks with difficulty
    const streakXP = streak?.xpMult || 1;
    const streakLoot = streak?.lootMult || 1;
    
    // XP (streak × difficulty)
    const xpAmount = Math.floor(killData.xp * diffMods.xpMult * streakXP);
    import('./Leveling.js').then(module => {
      module.Leveling.addXP(xpAmount);
    });
    
    // Cells (streak boosts)
    const baseCells = cfg?.economy?.cellsPerKill || 3;
    let cells = baseCells;
    if (killData.isElite) cells *= 3;
    if (killData.isBoss) cells *= 10;
    State.run.cells += Math.floor(cells * diffMods.cellsMult * streakXP);
    
    // Scrap
    const baseScrap = cfg?.economy?.scrapPerKill || 5;
    let scrap = baseScrap;
    if (killData.isElite) scrap *= (cfg?.economy?.eliteScrapMult || 3);
    if (killData.isBoss) scrap *= (cfg?.economy?.bossScrapMult || 10);
    State.run.scrapEarned += Math.floor(scrap * diffMods.scrapMult * streakXP);
    
    // Loot drop check (pass difficulty boost + streak loot mult)
    this.checkLootDrop(killData, diffMods, streakLoot);
    
    // ═══ WEAPON DROP (Elites: 15%, Bosses: 50%) ═══
    const weaponTypes = ['laser','plasma','railgun','missile','gatling','nova'];
    let weaponChance = 0;
    if (killData.isBoss) weaponChance = 0.50;
    else if (killData.isElite) weaponChance = 0.15;
    if (weaponChance > 0 && Math.random() < weaponChance) {
      const current = State.player.weaponType || 'laser';
      const others = weaponTypes.filter(w => w !== current);
      const dropped = others[Math.floor(Math.random() * others.length)];
      const Pickups = State.modules?.Pickups;
      if (Pickups) {
        Pickups.add({
          x: killData.x + (Math.random()-0.5)*40,
          y: killData.y + (Math.random()-0.5)*40,
          type: 'weapon', weaponType: dropped, life: 30
        });
      }
    }
    
    // ═══ ZONE OBJECTIVE PROGRESS ═══
    const obj = State.run.objective;
    if (obj && !obj.complete) {
      if (obj.type === 'exterminate') {
        obj.progress++;
        if (obj.progress >= obj.target) {
          obj.complete = true;
          this._announceObjectiveComplete();
        }
      } else if (obj.type === 'lockdown' && killData.isGenerator) {
        obj.progress++;
        if (obj.progress >= obj.target) {
          obj.complete = true;
          this._announceObjectiveComplete();
        }
      }
    }
  },
  
  _announceObjectiveComplete() {
    const Particles = State.modules?.Particles;
    const Audio = State.modules?.Audio;
    const p = State.player;
    if (Particles) {
      Particles.text(p.x, p.y - 40, '✓ OBJECTIVE COMPLETE — EXIT OPEN', '#00ff88', 18);
      Particles.ring(p.x, p.y, '#00ff88', 80);
    }
    if (Audio?.levelUp) Audio.levelUp();
    if (State.ui) State.ui.announcement = { text: '✓ OBJECTIVE COMPLETE', timer: 2.5 };
  },
  
  // Check for item drop (with pity + anti-exploit integration)
  checkLootDrop(killData, diffMods = {}, streakLootMult = 1) {
    const cfg = State.data.config?.loot;
    if (!cfg) return;

    let dropChance = cfg.baseDropChance || 0.03;
    if (killData.isElite) dropChance = cfg.eliteDropChance || 0.25;
    if (killData.isBoss) dropChance = cfg.bossDropChance || 1.0;

    // Apply luck
    dropChance *= (1 + (State.player.luck || 0) * 0.02);
    
    // Apply streak loot multiplier to drop chance
    dropChance *= streakLootMult;
    
    // Apply route loot multiplier (from branch exit choice)
    const World = State.modules?.World;
    const zoneLootMult = World?.currentZone?._lootMult || 1.0;
    dropChance *= zoneLootMult;

    // Anti-exploit: seed farming nerf (if module loaded)
    if (State.meta.antiExploit) {
      const currentSeed = State.run.currentSeed;
      if (currentSeed) {
        const hist = State.meta.antiExploit.seedHistory || [];
        const maxReuse = State.data.config?.antiExploit?.maxSeedReuse || 3;
        const reuseCount = hist.filter(s => s.seed === currentSeed).length;
        if (reuseCount > maxReuse) {
          dropChance *= Math.max(0.1, 1 / reuseCount);
        }
      }
    }

    // Pity: increment kill counter even if no drop
    if (State.meta.pity) {
      State.meta.pity.killsSinceRare++;
      State.meta.pity.killsSinceLegendary++;
      State.meta.pity.killsSinceUnique++;
    }

    if (Math.random() < dropChance) {
      // Pre-roll rarity so the pickup has the correct color BEFORE collection
      const ilvl = State.run.currentDepth || State.meta.level || 1;
      let preRolledRarity = null;
      if (killData.isBoss) {
        preRolledRarity = 'legendary';
      } else if (killData.isElite) {
        // Elite floor = rare, can roll higher
        const roll = Math.random();
        if (roll < 0.05) preRolledRarity = 'legendary';
        else if (roll < 0.20) preRolledRarity = 'epic';
        else preRolledRarity = 'rare';
      } else {
        const roll = Math.random();
        if (roll < 0.005) preRolledRarity = 'legendary';
        else if (roll < 0.03) preRolledRarity = 'epic';
        else if (roll < 0.12) preRolledRarity = 'rare';
        else if (roll < 0.35) preRolledRarity = 'uncommon';
        else preRolledRarity = 'common';
      }
      // Pity override
      if (State.meta.pity) {
        if (State.meta.pity.killsSinceLegendary >= 200) preRolledRarity = 'legendary';
        else if (State.meta.pity.killsSinceRare >= 40 && preRolledRarity === 'common') preRolledRarity = 'rare';
      }
      
      // ═══ DIFFICULTY RARITY BOOST ═══
      const rarityBoost = diffMods.lootRarityBoost || 0;
      if (rarityBoost > 0) {
        const rarityLadder = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
        let idx = rarityLadder.indexOf(preRolledRarity);
        if (idx >= 0) {
          idx = Math.min(rarityLadder.length - 1, idx + rarityBoost);
          preRolledRarity = rarityLadder[idx];
        }
      }
      
      // ═══ VAULT ROUTE: minimum rare floor ═══
      if (World?.currentZone?._isVault) {
        const rarityLadder2 = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
        const curIdx = rarityLadder2.indexOf(preRolledRarity);
        const rareIdx = rarityLadder2.indexOf('rare');
        if (curIdx < rareIdx) preRolledRarity = 'rare';
      }
      
      State.pickups.push({
        type: 'item',
        x: killData.x,
        y: killData.y,
        vx: (Math.random() - 0.5) * 50,
        vy: -50 + Math.random() * 30,
        life: 10,
        rarity: preRolledRarity,
        rarityFloor: killData.isElite ? 'rare' : null,
        ilvl: ilvl,
        fromBoss: killData.isBoss || false,
        bossType: killData.bossType || null
      });
    }
    
    // Always drop cells pickup
    const cellValue = killData.isBoss ? 50 : (killData.isElite ? 20 : 5);
    State.pickups.push({
      type: 'cells',
      x: killData.x + (Math.random() - 0.5) * 20,
      y: killData.y,
      vx: (Math.random() - 0.5) * 40,
      vy: -30 + Math.random() * 20,
      value: Math.floor(cellValue * (diffMods.cellsMult || 1)),
      life: 8
    });
    
    // Chance for scrap pickup
    if (Math.random() < 0.3 || killData.isElite || killData.isBoss) {
      const scrapValue = killData.isBoss ? 100 : (killData.isElite ? 30 : 10);
      State.pickups.push({
        type: 'scrap',
        x: killData.x + (Math.random() - 0.5) * 20,
        y: killData.y,
        vx: (Math.random() - 0.5) * 40,
        vy: -30 + Math.random() * 20,
        value: Math.floor(scrapValue * (diffMods.scrapMult || 1)),
        life: 10
      });
    }
    
    // Chaos: bonus rare material drops from elites/bosses
    const diff = State.run.difficulty || 'normal';
    const AudioDrop = State.modules?.Audio;
    if (diff === 'chaos') {
      if (killData.isElite && Math.random() < 0.12) {
        State.meta.voidShards = (State.meta.voidShards || 0) + 1;
        if (State.ui) State.ui.announcement = { text: '💠 VOID SHARD from corrupted elite!', timer: 2 };
        if (AudioDrop?.voidShardDrop) AudioDrop.voidShardDrop();
      }
      if (killData.isBoss) {
        const shards = 1 + Math.floor(Math.random() * 3);
        State.meta.voidShards = (State.meta.voidShards || 0) + shards;
        if (Math.random() < 0.25) {
          State.meta.cosmicDust = (State.meta.cosmicDust || 0) + 1;
          if (State.ui) State.ui.announcement = { text: '✨ COSMIC DUST from corrupted boss!', timer: 2.5 };
          if (AudioDrop?.cosmicDustDrop) AudioDrop.cosmicDustDrop();
        }
      }
    } else if (diff === 'risk') {
      if (killData.isBoss && Math.random() < 0.3) {
        State.meta.voidShards = (State.meta.voidShards || 0) + 1;
        if (State.ui) State.ui.announcement = { text: '💠 VOID SHARD bonus!', timer: 2 };
        if (AudioDrop?.voidShardDrop) AudioDrop.voidShardDrop();
      }
    }
  },
  
  // Draw all bullets
  draw(ctx) {
    const t = performance.now() * 0.001;

    // === PLAYER BULLETS (type-specific) ===
    for (const b of State.bullets) {
      const type = b.bulletType || 'laser';
      const s = b.size;
      const ang = Math.atan2(b.vy, b.vx);

      ctx.save();

      switch (type) {
        case 'laser': {
          // Bright cyan bolt with long glow trail
          const trailLen = 24;
          // Outer glow trail (wider, softer)
          const g0 = ctx.createLinearGradient(
            b.x - Math.cos(ang) * trailLen * 1.3, b.y - Math.sin(ang) * trailLen * 1.3,
            b.x, b.y
          );
          g0.addColorStop(0, 'rgba(0,150,255,0)');
          g0.addColorStop(1, 'rgba(0,200,255,0.25)');
          ctx.strokeStyle = g0;
          ctx.lineWidth = s * 4;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(b.x - Math.cos(ang) * trailLen * 1.3, b.y - Math.sin(ang) * trailLen * 1.3);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
          // Inner bright trail
          const g = ctx.createLinearGradient(
            b.x - Math.cos(ang) * trailLen, b.y - Math.sin(ang) * trailLen,
            b.x, b.y
          );
          g.addColorStop(0, 'rgba(0,200,255,0)');
          g.addColorStop(1, 'rgba(0,255,255,0.9)');
          ctx.strokeStyle = g;
          ctx.lineWidth = s * 1.5;
          ctx.beginPath();
          ctx.moveTo(b.x - Math.cos(ang) * trailLen, b.y - Math.sin(ang) * trailLen);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
          // Core dot
          ctx.fillStyle = '#ffffff';
          ctx.shadowColor = '#00ffff';
          ctx.shadowBlur = 10;
          ctx.beginPath();
          ctx.arc(b.x, b.y, s * 0.6, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        case 'plasma': {
          // Wobbly green-yellow plasma blob with dripping trail
          const wobble = Math.sin(t * 20 + b.x * 0.1) * 2;
          // Glow trail behind
          const pTrail = 16;
          ctx.globalAlpha = 0.3;
          const pg = ctx.createLinearGradient(
            b.x - Math.cos(ang) * pTrail, b.y - Math.sin(ang) * pTrail, b.x, b.y
          );
          pg.addColorStop(0, 'rgba(100,255,0,0)');
          pg.addColorStop(1, 'rgba(136,255,68,0.5)');
          ctx.fillStyle = pg;
          ctx.beginPath();
          ctx.moveTo(b.x - Math.cos(ang) * pTrail + wobble, b.y - Math.sin(ang) * pTrail);
          ctx.quadraticCurveTo(b.x + wobble * 2, b.y - s * 2, b.x + s, b.y);
          ctx.quadraticCurveTo(b.x + wobble * 2, b.y + s * 2, b.x - Math.cos(ang) * pTrail - wobble, b.y - Math.sin(ang) * pTrail);
          ctx.fill();
          ctx.globalAlpha = 1;
          // Main blob
          ctx.fillStyle = '#88ff44';
          ctx.shadowColor = '#88ff00';
          ctx.shadowBlur = 14;
          ctx.beginPath();
          ctx.arc(b.x + wobble * 0.3, b.y, s, 0, Math.PI * 2);
          ctx.fill();
          // Inner bright core
          ctx.fillStyle = '#eeffaa';
          ctx.beginPath();
          ctx.arc(b.x, b.y, s * 0.4, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        case 'railgun': {
          // Thin bright line + extended trail + sparks
          const trailLen = 40;
          // Wide subtle glow
          ctx.strokeStyle = 'rgba(200,140,255,0.12)';
          ctx.lineWidth = 8;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(b.x - Math.cos(ang) * trailLen, b.y - Math.sin(ang) * trailLen);
          ctx.lineTo(b.x + Math.cos(ang) * 3, b.y + Math.sin(ang) * 3);
          ctx.stroke();
          // Core beam
          ctx.strokeStyle = '#ffddff';
          ctx.shadowColor = '#cc88ff';
          ctx.shadowBlur = 8;
          ctx.lineWidth = 1.8;
          ctx.beginPath();
          ctx.moveTo(b.x - Math.cos(ang) * trailLen, b.y - Math.sin(ang) * trailLen);
          ctx.lineTo(b.x + Math.cos(ang) * 3, b.y + Math.sin(ang) * 3);
          ctx.stroke();
          // Tip flash
          ctx.fillStyle = '#ffffff';
          ctx.shadowBlur = 12;
          ctx.beginPath();
          ctx.arc(b.x, b.y, 2.5, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        case 'missile': {
          // Small triangle + orange exhaust
          ctx.translate(b.x, b.y);
          ctx.rotate(ang + Math.PI / 2);
          // Exhaust
          ctx.fillStyle = 'rgba(255,150,0,0.6)';
          ctx.beginPath();
          ctx.moveTo(-2, 4); ctx.lineTo(0, 10 + Math.random() * 4); ctx.lineTo(2, 4);
          ctx.fill();
          // Body
          ctx.fillStyle = '#ffaa33';
          ctx.shadowColor = '#ff6600';
          ctx.shadowBlur = 6;
          ctx.beginPath();
          ctx.moveTo(0, -s * 1.5); ctx.lineTo(-s * 0.7, s); ctx.lineTo(s * 0.7, s);
          ctx.closePath();
          ctx.fill();
          break;
        }
        case 'gatling': {
          // Small fast yellow dots with speed trail
          const gTrail = 8;
          ctx.strokeStyle = 'rgba(255,238,68,0.3)';
          ctx.lineWidth = s * 1.2;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(b.x - Math.cos(ang) * gTrail, b.y - Math.sin(ang) * gTrail);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
          ctx.fillStyle = '#ffee44';
          ctx.shadowColor = '#ffcc00';
          ctx.shadowBlur = 6;
          ctx.beginPath();
          ctx.arc(b.x, b.y, s * 0.7, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        case 'nova': {
          // Pulsing energy sphere
          const pulse = 0.8 + Math.sin(t * 15 + b.x) * 0.3;
          ctx.fillStyle = `rgba(180,100,255,${0.7 * pulse})`;
          ctx.shadowColor = '#aa66ff';
          ctx.shadowBlur = 14;
          ctx.beginPath();
          ctx.arc(b.x, b.y, s * pulse, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#eeddff';
          ctx.beginPath();
          ctx.arc(b.x, b.y, s * 0.3, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        default: {
          // Fallback circle
          ctx.fillStyle = '#00ffff';
          ctx.shadowColor = '#00ffff';
          ctx.shadowBlur = 8;
          ctx.beginPath();
          ctx.arc(b.x, b.y, s, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Crit sparkle
      if (b.isCrit) {
        ctx.fillStyle = '#ffffff';
        ctx.globalAlpha = 0.5 + Math.sin(t * 30) * 0.3;
        ctx.beginPath();
        ctx.arc(b.x + (Math.random() - 0.5) * 4, b.y + (Math.random() - 0.5) * 4, 1.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      ctx.shadowBlur = 0;
      ctx.restore();
    }

    // === ENEMY BULLETS ===
    for (const b of State.enemyBullets) {
      const s = b.size;
      ctx.save();

      // Red-orange energy bolt
      const ang = Math.atan2(b.vy, b.vx);
      const trailLen = 8;

      // Trail
      ctx.globalAlpha = 0.4;
      const g = ctx.createLinearGradient(
        b.x - Math.cos(ang) * trailLen, b.y - Math.sin(ang) * trailLen,
        b.x, b.y
      );
      g.addColorStop(0, 'rgba(255,50,0,0)');
      g.addColorStop(1, 'rgba(255,80,20,0.7)');
      ctx.strokeStyle = g;
      ctx.lineWidth = s;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(b.x - Math.cos(ang) * trailLen, b.y - Math.sin(ang) * trailLen);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.globalAlpha = 1;

      // Core
      ctx.fillStyle = '#ff4444';
      ctx.shadowColor = '#ff0000';
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(b.x, b.y, s * 0.7, 0, Math.PI * 2);
      ctx.fill();

      // Hot center
      ctx.fillStyle = '#ffaa66';
      ctx.beginPath();
      ctx.arc(b.x, b.y, s * 0.3, 0, Math.PI * 2);
      ctx.fill();

      ctx.shadowBlur = 0;
      ctx.restore();
    }
  }
};

export default Bullets;
