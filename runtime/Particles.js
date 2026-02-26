// Copyright (c) Manfred Foissner. All rights reserved.
// License: See LICENSE.txt in the project root.

// ============================================================
// PARTICLES.js - Enhanced Particle FX System (v2.5.0)
// ============================================================

import { State } from './State.js';

export const Particles = {
  screenShake: 0,      // current shake intensity
  _shakeDecay: 8,

  spawn(x, y, type) {
    switch(type) {
      case 'muzzle':
        this.sparks(x, y, '#00ffff', 5);
        this.flash(x, y, '#00ffff', 6);
        break;
      case 'playerHit':
        this.sparks(x, y, '#ff6666', 8);
        this.flash(x, y, '#ff4444', 10);
        break;
      case 'shieldHit':
        this.ring(x, y, '#00ccff', 25);
        this.sparks(x, y, '#88ddff', 4);
        break;
      case 'explosion':
        this.explosion(x, y, '#ff4444', 20, 200);
        this.ring(x, y, '#ff6600', 25);
        this.screenShake = Math.min(this.screenShake + 4, 12);
        break;
      case 'explosionBig':
        this.explosion(x, y, '#ff6600', 35, 300);
        this.explosion(x, y, '#ffcc00', 15, 150);
        this.ring(x, y, '#ff8800', 40);
        this.ring(x, y, '#ffdd00', 20);
        this.screenShake = Math.min(this.screenShake + 8, 16);
        break;
      case 'heal':
        this.ring(x, y, '#00ff88', 20);
        this.floatUp(x, y, '#00ff88', 6);
        break;
      case 'levelUp':
        this.explosion(x, y, '#ffff00', 30, 250);
        this.ring(x, y, '#ffff00', 40);
        this.ring(x, y, '#ffaa00', 55);
        this.screenShake = Math.min(this.screenShake + 3, 10);
        break;
      case 'loot':
        this.floatUp(x, y, '#ffdd00', 8);
        this.sparks(x, y, '#ffcc00', 3);
        break;
      default:
        State.particles.push({
          x, y,
          vx: (Math.random() - 0.5) * 50,
          vy: (Math.random() - 0.5) * 50,
          life: 0.3, maxLife: 0.3,
          color: '#ffffff', size: 3
        });
    }
  },

  update(dt) {
    // Screen shake decay
    if (this.screenShake > 0) {
      this.screenShake -= this._shakeDecay * dt;
      if (this.screenShake < 0.1) this.screenShake = 0;
    }

    for (let i = State.particles.length - 1; i >= 0; i--) {
      const p = State.particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;

      if (p.gravity) p.vy += 200 * dt;
      if (p.friction) { p.vx *= 0.95; p.vy *= 0.95; }
      if (p.drag) {
        const d = 1 - p.drag * dt;
        p.vx *= d; p.vy *= d;
      }

      if (p.life <= 0) State.particles.splice(i, 1);
    }

    // Perf cap
    const max = 600;
    if (State.particles.length > max) {
      State.particles.splice(0, State.particles.length - max);
    }
  },

  draw(ctx) {
    // Apply screen shake offset
    if (this.screenShake > 0.1) {
      const sx = (Math.random() - 0.5) * this.screenShake;
      const sy = (Math.random() - 0.5) * this.screenShake;
      ctx.translate(sx, sy);
    }

    for (const p of State.particles) {
      const alpha = Math.min(1, (p.life / p.maxLife) * 2);
      ctx.globalAlpha = alpha;

      if (p.isText) {
        // Damage/pickup floating text
        let scale = 1.0;
        if (p.scale && p.scale > 1) {
          const prog = 1 - (p.life / p.maxLife);
          scale = prog < 0.15
            ? 1 + (p.scale - 1) * (prog / 0.15)
            : p.scale - (p.scale - 1) * ((prog - 0.15) / 0.85);
        }
        const fs = Math.round(p.size * scale);
        ctx.font = `bold ${fs}px 'Orbitron', monospace`;
        ctx.textAlign = 'center';
        ctx.fillStyle = p.color;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = p.isCrit ? 15 : 5;
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 3;
        ctx.strokeText(p.text, p.x, p.y);
        ctx.fillText(p.text, p.x, p.y);
        ctx.shadowBlur = 0;
      } else if (p.isFlash) {
        // Screen flash circle (fast fade)
        const r = p.size * (1 + (1 - p.life / p.maxLife) * 2);
        const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
        grad.addColorStop(0, p.color);
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.isRing) {
        // Expanding ring
        const progress = 1 - (p.life / p.maxLife);
        const r = p.size * (0.3 + progress * 0.7);
        ctx.strokeStyle = p.color;
        ctx.lineWidth = Math.max(0.5, 2 * (1 - progress));
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        // Regular particle dot
        const size = p.size * Math.min(1, p.life / p.maxLife * 2);
        ctx.fillStyle = p.color;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = size * 2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(0.5, size), 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    }
    ctx.globalAlpha = 1;
  },

  // ========== SPAWN HELPERS ==========

  explosion(x, y, color, count = 15, speed = 150) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.3 + Math.random() * 0.7);
      State.particles.push({
        x, y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: 0.2 + Math.random() * 0.4,
        maxLife: 0.6,
        color, size: 1.5 + Math.random() * 4,
        friction: true
      });
    }
  },

  sparks(x, y, color, count = 8) {
    for (let i = 0; i < count; i++) {
      State.particles.push({
        x: x + (Math.random() - 0.5) * 8,
        y: y + (Math.random() - 0.5) * 8,
        vx: (Math.random() - 0.5) * 120,
        vy: (Math.random() - 0.5) * 120 - 30,
        life: 0.1 + Math.random() * 0.2,
        maxLife: 0.3,
        color, size: 1.5 + Math.random() * 2,
        gravity: true
      });
    }
  },

  ring(x, y, color, radius = 30) {
    State.particles.push({
      x, y, vx: 0, vy: 0,
      life: 0.35, maxLife: 0.35,
      color, size: radius,
      isRing: true
    });
  },

  flash(x, y, color, radius = 10) {
    State.particles.push({
      x, y, vx: 0, vy: 0,
      life: 0.08, maxLife: 0.08,
      color, size: radius,
      isFlash: true
    });
  },

  floatUp(x, y, color, count = 5) {
    for (let i = 0; i < count; i++) {
      State.particles.push({
        x: x + (Math.random() - 0.5) * 12,
        y: y,
        vx: (Math.random() - 0.5) * 20,
        vy: -40 - Math.random() * 40,
        life: 0.5 + Math.random() * 0.3,
        maxLife: 0.8,
        color, size: 2 + Math.random() * 2,
        drag: 2
      });
    }
  },

  trail(x, y, color, size = 3) {
    State.particles.push({
      x, y,
      vx: (Math.random() - 0.5) * 20,
      vy: Math.random() * 20 + 10,
      life: 0.08 + Math.random() * 0.08,
      maxLife: 0.16,
      color, size: size * (0.5 + Math.random() * 0.5)
    });
  },

  text(x, y, text, color, size = 14) {
    State.particles.push({
      x, y, vx: 0, vy: -60,
      life: 0.8, maxLife: 0.8,
      text, isText: true,
      color, size
    });
  },

  clear() { State.particles = []; }
};

export default Particles;
