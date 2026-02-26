// Copyright (c) Manfred Foissner. All rights reserved.
// License: See LICENSE.txt in the project root.

// ============================================================
// AUDIO.js v3.0 — Professional Procedural Audio Engine
// Layered synthesis · BiquadFilters · DynamicsCompressor
// Feedback-delay reverb · Full SFX library · Zero audio files
// ============================================================

import { State } from './State.js';

let _ctx = null;
let _master = null;
let _comp = null;
let _sfxBus = null;
let _musicBus = null;
let _revBus = null;       // Reverb send (feedback delay)
let _muted = false;
let _sfxVol = 0.55;
let _musVol = 0.25;

const _pool = {};
const MAX_SIM = 5;

let _curTrack = null;
let _musNodes = [];

// ── Lazy AudioContext (Chrome autoplay policy) ──
function _init() {
  if (_ctx) return true;
  try {
    _ctx = new (window.AudioContext || window.webkitAudioContext)();

    // Compressor → destination (consistent levels)
    _comp = _ctx.createDynamicsCompressor();
    _comp.threshold.value = -18;
    _comp.knee.value = 12;
    _comp.ratio.value = 4;
    _comp.attack.value = 0.003;
    _comp.release.value = 0.15;
    _comp.connect(_ctx.destination);

    _master = _ctx.createGain();
    _master.gain.value = _muted ? 0 : 1;
    _master.connect(_comp);

    _sfxBus = _ctx.createGain();
    _sfxBus.gain.value = _sfxVol;
    _sfxBus.connect(_master);

    _musicBus = _ctx.createGain();
    _musicBus.gain.value = _musVol;
    _musicBus.connect(_master);

    // Reverb: feedback delay + lowpass
    _revBus = _ctx.createGain();
    _revBus.gain.value = 0.15;
    const dly = _ctx.createDelay(0.5);
    dly.delayTime.value = 0.12;
    const fb = _ctx.createGain();
    fb.gain.value = 0.25;
    const lp = _ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2500;
    _revBus.connect(dly);
    dly.connect(lp);
    lp.connect(fb);
    fb.connect(dly);
    dly.connect(_master);

    return true;
  } catch (e) {
    console.warn('[AUDIO] Web Audio not available:', e);
    return false;
  }
}

function _resume() { if (_ctx?.state === 'suspended') _ctx.resume(); }

function _ok(n) {
  const c = _pool[n] || 0;
  if (c >= MAX_SIM) return false;
  _pool[n] = c + 1;
  setTimeout(() => { _pool[n] = Math.max(0, (_pool[n] || 1) - 1); }, 180);
  return true;
}

// ── Synthesis core: oscillator with envelope + optional filter + reverb ──
function _o(freq, type, dur, vol, opts = {}) {
  if (!_ctx) return;
  const t = _ctx.currentTime + (opts.delay || 0);
  const dest = opts.dest || _sfxBus;

  const osc = _ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (opts.freqEnd) osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.freqEnd), t + (opts.sweep || dur));

  const env = _ctx.createGain();
  const a = opts.a || 0.005;
  env.gain.setValueAtTime(0.001, t);
  env.gain.linearRampToValueAtTime(vol, t + a);
  env.gain.linearRampToValueAtTime((opts.sus ?? vol) * 0.8, t + a + (opts.d || 0.02));
  env.gain.linearRampToValueAtTime(0.001, t + dur);

  let chain = osc;
  if (opts.fType) {
    const f = _ctx.createBiquadFilter();
    f.type = opts.fType;
    f.frequency.setValueAtTime(opts.fFreq || 2000, t);
    if (opts.fEnd) f.frequency.exponentialRampToValueAtTime(opts.fEnd, t + (opts.fTime || dur));
    f.Q.value = opts.fQ || 1;
    osc.connect(f);
    chain = f;
  }

  chain.connect(env);
  env.connect(dest);

  if (opts.rev && _revBus) {
    const rs = _ctx.createGain();
    rs.gain.value = opts.rev;
    chain.connect(rs);
    rs.connect(_revBus);
  }

  osc.start(t);
  osc.stop(t + dur + 0.05);
}

// Noise burst with envelope + filter
function _n(dur, vol, opts = {}) {
  if (!_ctx) return;
  const t = _ctx.currentTime + (opts.delay || 0);
  const dest = opts.dest || _sfxBus;
  const sz = Math.floor(_ctx.sampleRate * dur);
  const buf = _ctx.createBuffer(1, sz, _ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < sz; i++) d[i] = Math.random() * 2 - 1;

  const src = _ctx.createBufferSource();
  src.buffer = buf;
  const env = _ctx.createGain();
  env.gain.setValueAtTime(vol, t);
  env.gain.exponentialRampToValueAtTime(0.001, t + dur);

  let chain = src;
  if (opts.fType) {
    const f = _ctx.createBiquadFilter();
    f.type = opts.fType;
    f.frequency.setValueAtTime(opts.fFreq || 4000, t);
    if (opts.fEnd) f.frequency.exponentialRampToValueAtTime(opts.fEnd, t + dur);
    f.Q.value = opts.fQ || 0.5;
    src.connect(f);
    chain = f;
  }
  chain.connect(env);
  env.connect(dest);
  if (opts.rev && _revBus) {
    const rs = _ctx.createGain(); rs.gain.value = opts.rev;
    chain.connect(rs); rs.connect(_revBus);
  }
  src.start(t);
}


// ================================================================
//  PUBLIC API
// ================================================================

export const Audio = {

  init() {
    document.addEventListener('click', _resume, { once: false });
    document.addEventListener('keydown', _resume, { once: false });
  },

  // ── Master controls ──
  toggleMute() { _muted = !_muted; if (_master) _master.gain.value = _muted ? 0 : 1; return _muted; },
  get muted() { return _muted; },
  setSfxVolume(v) { _sfxVol = Math.max(0, Math.min(1, v)); if (_sfxBus) _sfxBus.gain.value = _sfxVol; },
  setMusicVolume(v) { _musVol = Math.max(0, Math.min(1, v)); if (_musicBus) _musicBus.gain.value = _musVol; },
  get sfxVolume() { return _sfxVol; },
  get musicVolume() { return _musVol; },


  // ================================================================
  //  WEAPONS — Layered for distinct identities
  // ================================================================

  shootLaser() {
    if (!_init() || !_ok('laser')) return;
    _o(1400, 'sine', 0.07, 0.10, { freqEnd: 500, fType: 'lowpass', fFreq: 5000, fEnd: 800 });
    _o(700, 'square', 0.06, 0.04, { freqEnd: 300, fType: 'lowpass', fFreq: 3000 });
  },

  shootPlasma() {
    if (!_init() || !_ok('plasma')) return;
    _o(350, 'sawtooth', 0.18, 0.09, { freqEnd: 60, fType: 'lowpass', fFreq: 1800, fEnd: 400 });
    _o(180, 'sine', 0.12, 0.06, { freqEnd: 40, a: 0.001 });
    _n(0.06, 0.04, { fType: 'lowpass', fFreq: 1200 });
  },

  shootRailgun() {
    if (!_init() || !_ok('railgun')) return;
    _o(3000, 'sawtooth', 0.1, 0.14, { freqEnd: 80, fType: 'bandpass', fFreq: 2000, fQ: 2 });
    _o(80, 'sine', 0.15, 0.12, { freqEnd: 25, a: 0.001 });
    _n(0.08, 0.10, { fType: 'highpass', fFreq: 800, fEnd: 200 });
  },

  shootGatling() {
    if (!_init() || !_ok('gatling')) return;
    const f = 700 + Math.random() * 400;
    _o(f, 'square', 0.035, 0.07, { freqEnd: 150, fType: 'lowpass', fFreq: 4000 });
    _n(0.02, 0.04, { fType: 'highpass', fFreq: 1500 });
  },

  shootBeam() {
    if (!_init() || !_ok('beam')) return;
    _o(440, 'sawtooth', 0.3, 0.06, { fType: 'bandpass', fFreq: 1200, fQ: 4 });
    _o(443, 'sawtooth', 0.3, 0.04);
  },

  shootHoming() {
    if (!_init() || !_ok('homing')) return;
    _o(200, 'triangle', 0.15, 0.08, { freqEnd: 1200, fType: 'lowpass', fFreq: 1500, fEnd: 4000 });
    _n(0.1, 0.03, { fType: 'bandpass', fFreq: 800, fEnd: 3000 });
  },

  shootScatter() {
    if (!_init() || !_ok('scatter')) return;
    for (let i = 0; i < 3; i++) {
      _o(600 + Math.random() * 400, 'square', 0.04, 0.05, { freqEnd: 200, delay: i * 0.015, fType: 'lowpass', fFreq: 3000 });
    }
    _n(0.06, 0.06, { fType: 'lowpass', fFreq: 2000 });
  },


  // ================================================================
  //  IMPACTS
  // ================================================================

  hitEnemy() {
    if (!_init() || !_ok('hitE')) return;
    _o(700 + Math.random() * 300, 'triangle', 0.055, 0.09, { freqEnd: 120, fType: 'lowpass', fFreq: 4000 });
    _n(0.03, 0.05, { fType: 'bandpass', fFreq: 2000, fQ: 1.5 });
  },

  hitPlayer() {
    if (!_init() || !_ok('hitP')) return;
    _o(120, 'sine', 0.15, 0.18, { freqEnd: 30, a: 0.001 });
    _o(60, 'triangle', 0.2, 0.08, { freqEnd: 20 });
    _n(0.1, 0.10, { fType: 'lowpass', fFreq: 1200, fEnd: 200 });
  },

  hitCrit() {
    if (!_init() || !_ok('crit')) return;
    _o(2000, 'sine', 0.08, 0.10, { freqEnd: 800, rev: 0.3 });
    _o(100, 'sine', 0.1, 0.12, { freqEnd: 30 });
    _o(4000, 'sine', 0.05, 0.04, { freqEnd: 2000 });
  },


  // ================================================================
  //  EXPLOSIONS — Rich layered blasts
  // ================================================================

  explosion() {
    if (!_init() || !_ok('expl')) return;
    _o(100, 'sine', 0.35, 0.20, { freqEnd: 18, fType: 'lowpass', fFreq: 400 });
    _o(250, 'sawtooth', 0.12, 0.08, { freqEnd: 40, fType: 'lowpass', fFreq: 1500, fEnd: 200 });
    _n(0.30, 0.16, { fType: 'lowpass', fFreq: 3000, fEnd: 200, rev: 0.2 });
  },

  explosionBig() {
    if (!_init() || !_ok('explB')) return;
    _o(60, 'sine', 0.6, 0.28, { freqEnd: 12, fType: 'lowpass', fFreq: 200 });
    _o(40, 'triangle', 0.5, 0.15, { freqEnd: 8 });
    _o(200, 'sawtooth', 0.15, 0.10, { freqEnd: 30, fType: 'lowpass', fFreq: 1000 });
    _n(0.45, 0.22, { fType: 'lowpass', fFreq: 2500, fEnd: 150, rev: 0.35 });
    _n(0.15, 0.08, { fType: 'highpass', fFreq: 3000, delay: 0.05 });
  },

  mineExplosion() {
    if (!_init() || !_ok('mExpl')) return;
    _o(2200, 'square', 0.04, 0.10, { freqEnd: 200, fType: 'bandpass', fFreq: 1500, fQ: 3 });
    _o(80, 'sine', 0.25, 0.18, { freqEnd: 15 });
    _n(0.20, 0.14, { fType: 'lowpass', fFreq: 4000, fEnd: 300, rev: 0.15 });
  },


  // ================================================================
  //  PICKUPS — Instantly recognizable per type
  // ================================================================

  pickupItem() {
    if (!_init() || !_ok('pI')) return;
    // Magical ascending arpeggio
    _o(523, 'sine', 0.15, 0.08, { rev: 0.25 });
    _o(659, 'sine', 0.12, 0.07, { delay: 0.05, rev: 0.25 });
    _o(784, 'sine', 0.10, 0.06, { delay: 0.10, rev: 0.30 });
    _o(1047, 'sine', 0.15, 0.05, { delay: 0.15, rev: 0.35 });
  },

  pickupHealth() {
    if (!_init() || !_ok('pH')) return;
    _o(330, 'sine', 0.2, 0.08, { freqEnd: 660, fType: 'lowpass', fFreq: 2000, rev: 0.2 });
    _o(660, 'triangle', 0.15, 0.04, { delay: 0.05, rev: 0.15 });
  },

  pickupScrap() {
    if (!_init() || !_ok('pS')) return;
    _o(1800 + Math.random() * 400, 'square', 0.04, 0.06, { freqEnd: 600, fType: 'bandpass', fFreq: 2500, fQ: 2 });
    _n(0.02, 0.04, { fType: 'highpass', fFreq: 3000 });
  },

  pickup() {
    if (!_init() || !_ok('pG')) return;
    _o(400, 'sine', 0.08, 0.06, { freqEnd: 800 });
  },


  // ================================================================
  //  GAME EVENTS
  // ================================================================

  portalEnter() {
    if (!_init() || !_ok('portal')) return;
    _o(80, 'sawtooth', 0.6, 0.08, { freqEnd: 600, fType: 'bandpass', fFreq: 300, fEnd: 2000, fQ: 3, rev: 0.5 });
    _o(100, 'sine', 0.5, 0.06, { freqEnd: 400, rev: 0.4 });
    _n(0.4, 0.06, { fType: 'bandpass', fFreq: 500, fEnd: 3000, rev: 0.3 });
  },

  bossSpawn() {
    if (!_init() || !_ok('bossS')) return;
    _o(55, 'sawtooth', 0.8, 0.12, { fType: 'lowpass', fFreq: 600, fEnd: 150, rev: 0.4 });
    _o(82.5, 'sawtooth', 0.7, 0.08, { fType: 'lowpass', fFreq: 500, rev: 0.3 });
    _o(40, 'sine', 1.0, 0.10, { freqEnd: 20 });
    _n(0.3, 0.04, { fType: 'lowpass', fFreq: 800, delay: 0.1, rev: 0.3 });
  },

  bossPhaseChange() {
    if (!_init() || !_ok('bossP')) return;
    _o(800, 'sawtooth', 0.4, 0.10, { freqEnd: 200, fType: 'bandpass', fFreq: 1200, fQ: 3, rev: 0.3 });
    _o(100, 'sine', 0.3, 0.12, { freqEnd: 30 });
    _n(0.15, 0.08, { fType: 'highpass', fFreq: 2000, rev: 0.2 });
  },

  levelUp() {
    if (!_init() || !_ok('lvl')) return;
    _o(262, 'sine', 0.4, 0.08, { rev: 0.35 });
    _o(330, 'sine', 0.35, 0.07, { delay: 0.08, rev: 0.3 });
    _o(392, 'sine', 0.30, 0.06, { delay: 0.16, rev: 0.35 });
    _o(523, 'sine', 0.35, 0.08, { delay: 0.24, rev: 0.4 });
    _o(784, 'triangle', 0.3, 0.04, { delay: 0.30, rev: 0.5 });
    _n(0.1, 0.03, { fType: 'highpass', fFreq: 6000, delay: 0.25, rev: 0.4 });
  },

  shieldBreak() {
    if (!_init() || !_ok('shB')) return;
    _o(3000, 'sine', 0.08, 0.10, { freqEnd: 500, rev: 0.2 });
    _n(0.12, 0.12, { fType: 'highpass', fFreq: 4000, fEnd: 1000, rev: 0.15 });
    _o(80, 'sine', 0.2, 0.08, { freqEnd: 20 });
  },

  shieldRecharge() {
    if (!_init() || !_ok('shR')) return;
    _o(220, 'sine', 0.3, 0.04, { freqEnd: 440, fType: 'lowpass', fFreq: 1000, fEnd: 2000 });
    _o(330, 'triangle', 0.2, 0.02, { delay: 0.1, rev: 0.2 });
  },

  droneSwitch() {
    if (!_init() || !_ok('drn')) return;
    _o(600, 'sine', 0.1, 0.06, { freqEnd: 1200, rev: 0.15 });
    _o(300, 'triangle', 0.08, 0.04);
  },

  enemyShoot() {
    if (!_init() || !_ok('eS')) return;
    _o(900, 'sawtooth', 0.07, 0.05, { freqEnd: 200, fType: 'bandpass', fFreq: 1500, fQ: 2 });
  },

  uncloak() {
    if (!_init() || !_ok('unc')) return;
    _o(1500, 'sine', 0.15, 0.06, { freqEnd: 400, rev: 0.25 });
    _n(0.08, 0.04, { fType: 'highpass', fFreq: 5000, rev: 0.3 });
  },

  summon() {
    if (!_init() || !_ok('sum')) return;
    _o(120, 'sawtooth', 0.4, 0.06, { freqEnd: 60, fType: 'lowpass', fFreq: 800, fEnd: 200, rev: 0.3 });
    _o(180, 'sine', 0.3, 0.04, { freqEnd: 90, delay: 0.05 });
  },

  alert() {
    if (!_init() || !_ok('alrt')) return;
    _o(880, 'square', 0.08, 0.08, { fType: 'lowpass', fFreq: 3000 });
    _o(660, 'square', 0.08, 0.08, { delay: 0.1, fType: 'lowpass', fFreq: 3000 });
  },


  // ================================================================
  //  POI & RESOURCE SFX (v2.8+)
  // ================================================================

  poiTrigger() {
    if (!_init() || !_ok('poiT')) return;
    _o(600, 'sine', 0.12, 0.07, { freqEnd: 1200, rev: 0.35 });
    _o(900, 'sine', 0.08, 0.04, { delay: 0.06, rev: 0.3 });
  },

  poiCleared() {
    if (!_init() || !_ok('poiC')) return;
    _o(523, 'sine', 0.2, 0.07, { rev: 0.25 });
    _o(659, 'sine', 0.18, 0.06, { delay: 0.06, rev: 0.25 });
    _o(784, 'sine', 0.25, 0.07, { delay: 0.12, rev: 0.3 });
  },

  poiReward() {
    if (!_init() || !_ok('poiR')) return;
    _o(800, 'sine', 0.1, 0.05, { rev: 0.3 });
    _o(1200, 'sine', 0.08, 0.04, { delay: 0.04, rev: 0.35 });
    _o(1600, 'sine', 0.06, 0.03, { delay: 0.08, rev: 0.4 });
    _o(2000, 'sine', 0.08, 0.03, { delay: 0.12, rev: 0.45 });
    _n(0.06, 0.03, { fType: 'highpass', fFreq: 6000, delay: 0.10, rev: 0.3 });
  },

  resourceMine() {
    if (!_init() || !_ok('rM')) return;
    _o(1200 + Math.random() * 600, 'square', 0.05, 0.06, { freqEnd: 300, fType: 'bandpass', fFreq: 2000, fQ: 4 });
    _o(80, 'sine', 0.06, 0.04, { freqEnd: 30 });
  },

  resourceDrop() {
    if (!_init() || !_ok('rD')) return;
    _n(0.08, 0.08, { fType: 'highpass', fFreq: 4000 });
    _o(880, 'sine', 0.2, 0.06, { rev: 0.25 });
    _o(1320, 'sine', 0.15, 0.04, { delay: 0.04, rev: 0.2 });
  },

  voidShardDrop() {
    if (!_init() || !_ok('void')) return;
    _o(80, 'sawtooth', 0.5, 0.06, { fType: 'lowpass', fFreq: 400, rev: 0.4 });
    _o(1760, 'sine', 0.3, 0.04, { delay: 0.1, rev: 0.5 });
    _o(2640, 'sine', 0.2, 0.02, { delay: 0.15, rev: 0.5 });
    _n(0.2, 0.03, { fType: 'bandpass', fFreq: 1500, fQ: 5, delay: 0.05, rev: 0.4 });
  },

  cosmicDustDrop() {
    if (!_init() || !_ok('cosm')) return;
    _o(440, 'sine', 0.6, 0.04, { rev: 0.5 });
    _o(554, 'sine', 0.5, 0.03, { delay: 0.05, rev: 0.5 });
    _o(660, 'sine', 0.45, 0.03, { delay: 0.1, rev: 0.5 });
    _o(880, 'sine', 0.4, 0.02, { delay: 0.15, rev: 0.55 });
    _n(0.15, 0.02, { fType: 'highpass', fFreq: 8000, delay: 0.2, rev: 0.5 });
  },


  // ================================================================
  //  DIFFICULTY & CHAOS SFX (v2.9+)
  // ================================================================

  difficultyStart(level) {
    if (!_init() || !_ok('diff')) return;
    if (level === 'chaos') {
      _o(200, 'sawtooth', 0.5, 0.08, { freqEnd: 50, fType: 'lowpass', fFreq: 800, fEnd: 150, rev: 0.3 });
      _o(203, 'sawtooth', 0.5, 0.06, { freqEnd: 48, fType: 'lowpass', fFreq: 700, rev: 0.3 });
      _n(0.3, 0.06, { fType: 'lowpass', fFreq: 1000, delay: 0.1 });
    } else if (level === 'risk') {
      _o(110, 'sawtooth', 0.4, 0.06, { fType: 'lowpass', fFreq: 600, rev: 0.2 });
      _o(165, 'sawtooth', 0.35, 0.04, { fType: 'lowpass', fFreq: 500, delay: 0.05 });
    }
  },

  poisonDot() {
    if (!_init() || !_ok('psn')) return;
    _n(0.06, 0.04, { fType: 'bandpass', fFreq: 2000 + Math.random() * 2000, fQ: 3 });
    _o(80 + Math.random() * 40, 'sine', 0.08, 0.03, { freqEnd: 30 });
  },

  huntingMineAlert() {
    if (!_init() || !_ok('hMn')) return;
    for (let i = 0; i < 3; i++) {
      _o(1800, 'square', 0.03, 0.06, { delay: i * 0.06, fType: 'lowpass', fFreq: 4000 });
    }
  },

  corruptAmbience() {
    if (!_init() || !_ok('corr')) return;
    _o(55, 'sawtooth', 0.8, 0.03, { fType: 'lowpass', fFreq: 300, rev: 0.4 });
    _o(57, 'sawtooth', 0.8, 0.02, { fType: 'lowpass', fFreq: 280, rev: 0.3 });
  },

  comboUp(level) {
    if (!_init() || !_ok('cmb')) return;
    const base = 400 + Math.min(level || 1, 10) * 80;
    _o(base, 'sine', 0.08, 0.06, { freqEnd: base * 1.5, rev: 0.15 });
    _o(base * 1.5, 'sine', 0.06, 0.03, { delay: 0.03, rev: 0.2 });
  },

  zoneMastered() {
    if (!_init() || !_ok('znM')) return;
    _o(262, 'sine', 0.5, 0.06, { rev: 0.4 });
    _o(330, 'sine', 0.45, 0.05, { delay: 0.06, rev: 0.4 });
    _o(392, 'sine', 0.4, 0.05, { delay: 0.12, rev: 0.4 });
    _o(523, 'sine', 0.35, 0.05, { delay: 0.18, rev: 0.45 });
    _o(659, 'sine', 0.3, 0.04, { delay: 0.24, rev: 0.5 });
    _o(784, 'sine', 0.35, 0.04, { delay: 0.30, rev: 0.55 });
    _n(0.08, 0.03, { fType: 'highpass', fFreq: 8000, delay: 0.32, rev: 0.5 });
  },

  beaconActivate() {
    if (!_init() || !_ok('bcn')) return;
    _o(110, 'sawtooth', 0.6, 0.05, { freqEnd: 440, fType: 'lowpass', fFreq: 500, fEnd: 2000, rev: 0.3 });
    _o(220, 'sine', 0.5, 0.04, { freqEnd: 660, delay: 0.1, rev: 0.25 });
  },

  waveComplete() {
    if (!_init() || !_ok('wvC')) return;
    _o(440, 'sine', 0.1, 0.06, { rev: 0.2 });
    _o(660, 'sine', 0.12, 0.06, { delay: 0.08, rev: 0.25 });
  },


  // ================================================================
  //  MUSIC — Filtered chord pads with LFO modulation
  // ================================================================

  playMusic(track) {
    if (!_init()) return;
    if (_curTrack === track) return;
    this.stopMusic();
    _curTrack = track;

    const now = _ctx.currentTime;
    const nodes = [];

    const C = {
      hub:           { base: 55,  chords: [82.5, 110, 165],          wave: 'sine',     lfo: 0.08, lfod: 3,  vol: 0.04, fF: 800,  fLfo: 0.05, fLfod: 300 },
      combat_t1:     { base: 65,  chords: [98, 130, 195],            wave: 'sawtooth', lfo: 0.25, lfod: 6,  vol: 0.03, fF: 600,  fLfo: 0.12, fLfod: 250 },
      combat_t2:     { base: 50,  chords: [75, 100, 150],            wave: 'sawtooth', lfo: 0.4,  lfod: 10, vol: 0.035,fF: 500,  fLfo: 0.2,  fLfod: 200 },
      combat_chaos:  { base: 42,  chords: [63, 84, 126, 168],        wave: 'sawtooth', lfo: 0.6,  lfod: 15, vol: 0.04, fF: 400,  fLfo: 0.3,  fLfod: 250 },
      boss:          { base: 40,  chords: [60, 80, 120, 47],         wave: 'sawtooth', lfo: 0.7,  lfod: 12, vol: 0.045,fF: 450,  fLfo: 0.25, fLfod: 200 }
    };
    const c = C[track] || C.hub;

    // Bass drone + filter LFO
    const bass = _ctx.createOscillator();
    const bFilt = _ctx.createBiquadFilter();
    const bGain = _ctx.createGain();
    bass.type = c.wave;
    bass.frequency.setValueAtTime(c.base, now);
    bFilt.type = 'lowpass';
    bFilt.frequency.setValueAtTime(c.fF, now);
    bFilt.Q.value = 2;
    bGain.gain.setValueAtTime(c.vol, now);

    const lfo = _ctx.createOscillator();
    const lfoG = _ctx.createGain();
    lfo.type = 'sine';
    lfo.frequency.setValueAtTime(c.lfo, now);
    lfoG.gain.setValueAtTime(c.lfod, now);
    lfo.connect(lfoG);
    lfoG.connect(bass.frequency);
    lfo.start(now);

    const fLfo = _ctx.createOscillator();
    const fLfoG = _ctx.createGain();
    fLfo.type = 'sine';
    fLfo.frequency.setValueAtTime(c.fLfo, now);
    fLfoG.gain.setValueAtTime(c.fLfod, now);
    fLfo.connect(fLfoG);
    fLfoG.connect(bFilt.frequency);
    fLfo.start(now);

    bass.connect(bFilt);
    bFilt.connect(bGain);
    bGain.connect(_musicBus);
    bass.start(now);
    nodes.push(bass, lfo, fLfo);

    // Chord pads
    for (const freq of c.chords) {
      const p = _ctx.createOscillator();
      const pF = _ctx.createBiquadFilter();
      const pG = _ctx.createGain();
      p.type = 'sine';
      p.frequency.setValueAtTime(freq, now);
      pF.type = 'lowpass';
      pF.frequency.setValueAtTime(freq * 4, now);
      pF.Q.value = 0.5;
      pG.gain.setValueAtTime(c.vol * 0.4, now);
      p.connect(pF);
      pF.connect(pG);
      pG.connect(_musicBus);
      p.start(now);
      nodes.push(p);
    }

    // Boss/Chaos: dissonant beating layer
    if (track === 'boss' || track === 'combat_chaos') {
      const dis = _ctx.createOscillator();
      const dG = _ctx.createGain();
      const dF = _ctx.createBiquadFilter();
      dis.type = 'sawtooth';
      dis.frequency.setValueAtTime(c.base * 1.02, now);
      dG.gain.setValueAtTime(c.vol * 0.3, now);
      dF.type = 'lowpass';
      dF.frequency.setValueAtTime(300, now);
      dis.connect(dF);
      dF.connect(dG);
      dG.connect(_musicBus);
      dis.start(now);
      nodes.push(dis);
    }

    _musNodes = nodes;
  },

  stopMusic() {
    const t = _ctx?.currentTime || 0;
    for (const n of _musNodes) { try { n.stop(t + 0.5); } catch (_) {} }
    _musNodes = [];
    _curTrack = null;
  },

  get currentTrack() { return _curTrack; },

  updateMusicForState() {
    const mode = State.mode;
    if (mode === 'exploration' || mode === 'combat') {
      const diff = State.run?.difficulty || 'normal';
      const tier = State.world?.currentAct?.id;
      const hasBoss = State.enemies?.some(e => e.isBoss && !e.dead && e.aiState === 'aggro');
      if (hasBoss) this.playMusic('boss');
      else if (diff === 'chaos') this.playMusic('combat_chaos');
      else if (tier === 'tier3' || tier === 'tier4' || tier === 'tier5') this.playMusic('combat_t2');
      else this.playMusic('combat_t1');
    } else {
      this.playMusic('hub');
    }
  }
};
