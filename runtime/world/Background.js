// Copyright (c) Manfred Foissner. All rights reserved.
// License: See LICENSE.txt in the project root.

// ============================================================
// Background.js - Tiled terrain + fog overlays + deco objects
// ============================================================
// Renders a deterministic, zone-seeded background stack:
//  - Base terrain tile (world-locked tiling)
//  - Optional starfield (cheap procedural)
//  - Fog overlays (screen-space parallax)
//  - Decorative asteroids (non-collision parallax)

import { State } from '../State.js';
import { Camera } from './Camera.js';
import { SeededRandom } from './SeededRandom.js';

export const Background = {
  _imgCache: new Map(),
  _patternCache: new Map(),

  _loadImage(src) {
    if (this._imgCache.has(src)) return this._imgCache.get(src);
    const img = new Image();
    img.src = src;
    this._imgCache.set(src, img);
    return img;
  },

  _getPattern(ctx, src) {
    // Pattern creation is context-bound but stable enough per canvas.
    const key = src;
    const existing = this._patternCache.get(key);
    if (existing && existing._ctx === ctx) return existing;

    const img = this._loadImage(src);
    if (!img || !img.complete || !img.naturalWidth) return null;

    const pat = ctx.createPattern(img, 'repeat');
    if (!pat) return null;
    pat._ctx = ctx;
    this._patternCache.set(key, pat);
    return pat;
  },

  // Decide tile per act/biome (can be overridden via config).
  _tileForAct(act) {
    const cfg = State.data.config?.background || {};
    if (cfg.tileByAct && cfg.tileByAct[act?.id]) return cfg.tileByAct[act.id];

    // Default mapping for the provided test tiles.
    switch (act?.biome) {
      case 'void':
        return './assets/backgrounds/tile_void.webp';
      case 'nebula':
        return './assets/backgrounds/tile_toxicity.webp';
      case 'derelict':
        return './assets/backgrounds/tile_city_ruins.webp';
      case 'blackhole':
        return './assets/backgrounds/tile_void.webp';
      case 'asteroid':
      default:
        return './assets/backgrounds/tile_city_ruins.webp';
    }
  },

  prepareZone(zone, zoneSeed, act) {
    const cfg = State.data.config?.background || {};
    if (cfg.enabled === false) {
      zone._bg = null;
      return;
    }

    const rng = new SeededRandom((zoneSeed ^ 0xBADC0DE) >>> 0);

    const tileSrc = this._tileForAct(act);
    const fogSrcs = Array.isArray(cfg.fog?.paths) && cfg.fog.paths.length
      ? cfg.fog.paths
      : [
          './assets/fog/fog_1.png'
        ];

    const decoSrcs = Array.isArray(cfg.deco?.spritePaths) && cfg.deco.spritePaths.length
      ? cfg.deco.spritePaths
      : [
          './assets/asteroids_deco/asteroid_deco_4.png',
          './assets/asteroids_deco/asteroid_deco_cluster.png'
        ];

    // Defaults tuned for perf: few big shapes are enough.
    const decoCount = (typeof cfg.deco?.count === 'number') ? cfg.deco.count : 6;
    const fogCount = (typeof cfg.fog?.count === 'number') ? cfg.fog.count : 1;

    // Deterministic placement in world-space for deco.
    const deco = [];
    for (let i = 0; i < Math.max(0, decoCount); i++) {
      deco.push({
        x: rng.range(0, zone.width),
        y: rng.range(0, zone.height),
        r: rng.range(0, Math.PI * 2),
        s: rng.range(cfg.deco?.scaleMin ?? 0.35, cfg.deco?.scaleMax ?? 1.05),
        a: rng.range(cfg.deco?.alphaMin ?? 0.22, cfg.deco?.alphaMax ?? 0.55),
        idx: rng.int(0, decoSrcs.length - 1)
      });
    }

    // Fog overlays are screen-space; store a few drifting layers.
    const fog = [];
    for (let i = 0; i < Math.max(0, fogCount); i++) {
      fog.push({
        // Drift seed offsets
        ox: rng.range(0, 10000),
        oy: rng.range(0, 10000),
        r: rng.range(0, Math.PI * 2),
        s: rng.range(cfg.fog?.scaleMin ?? 1.1, cfg.fog?.scaleMax ?? 1.9),
        a: rng.range(cfg.fog?.alphaMin ?? 0.08, cfg.fog?.alphaMax ?? 0.20),
        idx: rng.int(0, fogSrcs.length - 1)
      });
    }

    zone._bg = {
      tileSrc,
      fogSrcs,
      decoSrcs,
      deco,
      fog
    };

    // Kick off image loads (non-blocking).
    this._loadImage(tileSrc);
    fogSrcs.forEach(p => this._loadImage(p));
    decoSrcs.forEach(p => this._loadImage(p));
  },

  draw(ctx, screenW, screenH, zone) {
    const cfg = State.data.config?.background || {};
    if (cfg.enabled === false) return false;

    // Fallback to legacy parallax if no background spec exists.
    if (!zone?._bg) return false;

    const camX = Camera.getX();
    const camY = Camera.getY();
    const now = performance.now() * 0.001;

    // 1) Base terrain tile (world-locked; scrollSpeed=1)
    const tilePat = this._getPattern(ctx, zone._bg.tileSrc);
    if (tilePat) {
      const tileScale = (typeof cfg.tileScale === 'number') ? cfg.tileScale : 1.0;
      const tileImg = this._imgCache.get(zone._bg.tileSrc);
      const tw = tileImg?.naturalWidth || 1024;
      const th = tileImg?.naturalHeight || 1024;
      
      // Disable smoothing to prevent subpixel seam artifacts
      const prevSmoothing = ctx.imageSmoothingEnabled;
      ctx.imageSmoothingEnabled = false;
      
      ctx.save();
      ctx.scale(tileScale, tileScale);
      ctx.fillStyle = tilePat;
      // Positive modulo to avoid negative offset gaps (the white border fix)
      const offX = (((camX % tw) + tw) % tw) / tileScale;
      const offY = (((camY % th) + th) % th) / tileScale;
      ctx.translate(-offX, -offY);
      // Extra padding to ensure full coverage
      ctx.fillRect(-tw, -th, (screenW / tileScale) + tw * 3, (screenH / tileScale) + th * 3);
      ctx.restore();
      
      ctx.imageSmoothingEnabled = prevSmoothing;
    } else {
      // If tile not ready, keep a cheap fill to avoid white flashes.
      ctx.fillStyle = zone.parallax?.background?.color || '#050810';
      ctx.fillRect(0, 0, screenW, screenH);
    }

    // 2) Deco asteroids (non-collision) - subtle parallax depth layer
    if (cfg.deco?.enabled !== false) {
      const speed = (typeof cfg.deco?.scrollSpeed === 'number') ? cfg.deco.scrollSpeed : 0.55;
      const sprites = zone._bg.decoSrcs;

      for (const d of zone._bg.deco) {
        const src = sprites[d.idx];
        const img = this._imgCache.get(src);
        if (!img || !img.complete || !img.naturalWidth) continue;

        const x = d.x - camX * speed;
        const y = d.y - camY * speed;
        if (x < -600 || y < -600 || x > screenW + 600 || y > screenH + 600) continue;

        ctx.save();
        ctx.globalAlpha = d.a;
        ctx.translate(x, y);
        ctx.rotate(d.r);
        ctx.scale(d.s, d.s);
        ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    }

    // 3) Fog overlays (screen space) - slow drift + slight parallax
    if (cfg.fog?.enabled !== false) {
      const speed = (typeof cfg.fog?.scrollSpeed === 'number') ? cfg.fog.scrollSpeed : 0.10;
      const drift = (typeof cfg.fog?.driftSpeed === 'number') ? cfg.fog.driftSpeed : 35;
      const fogPaths = zone._bg.fogSrcs;

      for (let i = 0; i < zone._bg.fog.length; i++) {
        const f = zone._bg.fog[i];
        const src = fogPaths[f.idx];
        const img = this._imgCache.get(src);
        if (!img || !img.complete || !img.naturalWidth) continue;

        const px = (-camX * speed) + Math.sin(now * 0.07 + f.ox) * drift;
        const py = (-camY * speed) + Math.cos(now * 0.06 + f.oy) * drift;

        ctx.save();
        ctx.globalAlpha = f.a;
        ctx.translate(screenW / 2 + px, screenH / 2 + py);
        ctx.rotate(f.r + Math.sin(now * 0.05 + f.ox) * 0.06);
        ctx.scale(f.s, f.s);
        ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    }

    return true;
  }
};

export default Background;
