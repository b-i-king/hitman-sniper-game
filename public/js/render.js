// Canvas renderer: the spotter's scope (wide view with a mil grid) and the sniper's scope
// inset. Everything is drawn in world meters through a camera transform.

import { BODY } from './world.js';

const SKIES = {
  day: ['#7fb6e8', '#cfe6f5'],
  winter: ['#9fb3c4', '#e3ebf1'],
  dusk: ['#2c2350', '#c4566a', '#f2a65a'],
  night: ['#050814', '#101a33'],
};

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.effects = []; // { kind, x, y, t0 }
    this.snow = Array.from({ length: 140 }, () => ({ x: Math.random(), y: Math.random(), r: 0.5 + Math.random() * 1.6, s: 0.3 + Math.random() * 0.7 }));
    this.resize();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = this.canvas.getBoundingClientRect();
    this.w = Math.max(320, rect.width);
    this.h = Math.max(200, rect.height);
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.dpr = dpr;
  }

  get aspect() {
    return this.h / this.w;
  }

  // --- camera -------------------------------------------------------------------
  setCamera(cx, cy, viewWidthMeters, w, h, ox = 0, oy = 0) {
    this.cam = { cx, cy, ppm: w / viewWidthMeters, w, h, ox, oy };
  }
  sx(x) { return this.cam.ox + this.cam.w / 2 + (x - this.cam.cx) * this.cam.ppm; }
  sy(y) { return this.cam.oy + this.cam.h / 2 - (y - this.cam.cy) * this.cam.ppm; }
  m(v) { return v * this.cam.ppm; }

  rect(x0, y0, x1, y1, fill) {
    const c = this.ctx;
    c.fillStyle = fill;
    c.fillRect(this.sx(x0), this.sy(y1), this.m(x1 - x0), this.m(y1 - y0));
  }

  // --- main entry -----------------------------------------------------------------
  /**
   * opts: { t, view: {cx, cy, mils}, aim, sniperZoom, labels, flight, flash, haze }
   */
  draw(world, opts) {
    const c = this.ctx;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const D = world.distance;
    const viewW = (opts.view.mils * D) / 1000;

    // Spotter view
    this.setCamera(opts.view.cx, opts.view.cy, viewW, this.w, this.h);
    this.drawScene(world, opts.t, { labels: opts.labels });
    this.drawEffects(opts.t);
    if (opts.flight) this.drawTrace(opts.flight, opts.t);
    if (world.level.snow) this.drawSnow(world.windAt(opts.t), opts.t);
    this.drawMilGrid(D, opts.view.mils);
    this.drawSpotterVignette();
    if (opts.aim) this.drawSniperMarker(opts.aim, opts.aimLabel);

    // Sniper scope inset
    if (opts.aim && opts.showScope) {
      const r = Math.min(this.w, this.h) * 0.2;
      const ox = this.w - r - 18;
      const oy = this.h - r - 18;
      c.save();
      c.beginPath();
      c.arc(ox, oy, r, 0, Math.PI * 2);
      c.clip();
      const scopeMils = Math.max(3, opts.view.mils / 6);
      this.setCamera(opts.aim.x, opts.aim.y, (scopeMils * D) / 1000, r * 2, r * 2, ox - r, oy - r);
      this.drawScene(world, opts.t, { labels: false });
      this.drawEffects(opts.t);
      if (world.level.snow) this.drawSnow(world.windAt(opts.t), opts.t, r * 2, ox - r, oy - r);
      this.drawScopeReticle(ox, oy, r, r / (scopeMils / 2));
      c.restore();
      c.strokeStyle = '#000';
      c.lineWidth = 10;
      c.beginPath();
      c.arc(ox, oy, r + 4, 0, Math.PI * 2);
      c.stroke();
      c.strokeStyle = '#3a3f36';
      c.lineWidth = 2;
      c.beginPath();
      c.arc(ox, oy, r + 9, 0, Math.PI * 2);
      c.stroke();
      c.fillStyle = 'rgba(255,255,255,0.75)';
      c.font = '600 11px ui-monospace, Menlo, monospace';
      c.textAlign = 'center';
      c.fillText("SNIPER'S SCOPE", ox, oy - r - 14);
    }

    if (opts.flash) {
      c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      c.fillStyle = `rgba(255,240,200,${opts.flash})`;
      c.fillRect(0, 0, this.w, this.h);
    }
  }

  // --- scene ------------------------------------------------------------------------
  drawScene(world, t, { labels }) {
    const c = this.ctx;
    const L = world.level;
    const { ox, oy, w, h } = this.cam;
    const k = world.distance / 1000; // scale for far-away scenery

    // Sky
    const sky = SKIES[L.sky] || SKIES.day;
    const g = c.createLinearGradient(0, oy, 0, oy + h);
    sky.forEach((col, i) => g.addColorStop(i / (sky.length - 1), col));
    c.fillStyle = g;
    c.fillRect(ox, oy, w, h);
    if (L.sky === 'night') this.drawStars(ox, oy, w, h);

    const windX = world.windAt(t);
    for (const p of L.props) this.drawFarProp(p, k, world);
    // Ground
    this.rect(-500, -50, 500, 0, L.ground);
    if (L.sky === 'night') this.rect(-500, -50, 500, 0.02, '#1f2a1d');
    for (const p of L.props) this.drawProp(p, k, windX, t);

    // People not on a train, then the train with its passengers.
    for (const p of world.people) if (p.car == null) this.drawPerson(world, p, t);
    if (world.train) this.drawTrain(world, t);
    if (labels) this.drawLabels(world, t);
  }

  drawStars(ox, oy, w, h) {
    const c = this.ctx;
    const frac = (v) => v - Math.floor(v);
    c.fillStyle = 'rgba(255,255,255,0.8)';
    for (let i = 0; i < 90; i++) {
      const x = ox + frac(Math.sin(i * 12.9898) * 43758.5453) * w;
      const y = oy + frac(Math.sin(i * 78.233) * 12345.678) * h * 0.6;
      c.fillRect(x, y, 1.3, 1.3);
    }
  }

  drawFarProp(p, k) {
    const c = this.ctx;
    if (p.type === 'hills' || p.type === 'mountains') {
      const amp = p.type === 'mountains' ? 9 * k : 3 * k;
      const base = p.type === 'mountains' ? 6 * k : 2.5 * k;
      c.fillStyle = p.color;
      c.beginPath();
      c.moveTo(this.sx(-400), this.sy(0));
      for (let x = -400; x <= 400; x += 2) {
        const y = base + amp * (0.5 + 0.3 * Math.sin(x * 0.045) + 0.2 * Math.sin(x * 0.13 + 1) + (p.type === 'mountains' ? 0.4 * Math.abs(Math.sin(x * 0.02)) : 0));
        c.lineTo(this.sx(x), this.sy(y));
      }
      c.lineTo(this.sx(400), this.sy(0));
      c.closePath();
      c.fill();
    } else if (p.type === 'skyline') {
      c.fillStyle = p.color;
      for (let i = -12; i <= 12; i++) {
        const bw = 6 + ((i * 37) % 5 + 5) % 5;
        const bh = 14 + (((i * 53) % 13) + 13) % 13 + 6;
        this.rect(i * 9 - bw / 2, 0, i * 9 + bw / 2, bh, p.color);
      }
    } else if (p.type === 'buildings') {
      for (let i = -8; i <= 8; i++) {
        const bw = 7.5;
        const bh = 8 + ((((i * 31) % 7) + 7) % 7);
        const x0 = i * 8 - bw / 2;
        const shade = ['#8d8f9a', '#9a8f86', '#7f8a96', '#a39a8f'][((i % 4) + 4) % 4];
        this.rect(x0, 0, x0 + bw, bh, shade);
        this.rect(x0 - 0.2, bh, x0 + bw + 0.2, bh + 0.35, '#f4f7fa');
        for (let fy = 2; fy < bh - 1; fy += 2.4) for (let fx = 1; fx < bw - 1; fx += 1.8) this.rect(x0 + fx, fy, x0 + fx + 0.9, fy + 1.2, '#5b6470');
      }
    } else if (p.type === 'moon') {
      c.fillStyle = '#f4f1de';
      c.beginPath();
      c.arc(this.sx(p.x * k * 2), this.sy(p.y * k * 1.2), this.m(1.6 * k * 2), 0, Math.PI * 2);
      c.fill();
    }
  }

  drawProp(p, k, windX, t) {
    const c = this.ctx;
    switch (p.type) {
      case 'tree': {
        this.rect(p.x - 0.25, 0, p.x + 0.25, p.h * 0.45, '#5a3d24');
        c.fillStyle = '#3f6b2f';
        for (const [dx, dy, r] of [[0, 0.62, 0.3], [-0.18, 0.5, 0.24], [0.2, 0.52, 0.24], [0, 0.82, 0.2]]) {
          c.beginPath();
          c.arc(this.sx(p.x + dx * p.h), this.sy(dy * p.h), this.m(r * p.h), 0, Math.PI * 2);
          c.fill();
        }
        break;
      }
      case 'fence':
        for (let x = p.from; x <= p.to; x += 2) this.rect(x - 0.06, 0, x + 0.06, 1.1, '#7a5a3a');
        this.rect(p.from, 0.75, p.to, 0.85, '#8a6a4a');
        this.rect(p.from, 0.35, p.to, 0.45, '#8a6a4a');
        break;
      case 'rock':
        c.fillStyle = '#7d7d76';
        c.beginPath();
        c.ellipse(this.sx(p.x), this.sy(0), this.m(p.w / 2), this.m(p.w * 0.35), 0, Math.PI, 0);
        c.fill();
        break;
      case 'hay':
        c.fillStyle = '#d8b04c';
        c.beginPath();
        c.ellipse(this.sx(p.x), this.sy(p.w / 2), this.m(p.w / 2), this.m(p.w / 2), 0, 0, Math.PI * 2);
        c.fill();
        c.strokeStyle = '#b08a30';
        c.lineWidth = Math.max(1, this.m(0.05));
        c.stroke();
        break;
      case 'barn': {
        const x0 = p.x - p.w / 2;
        const x1 = p.x + p.w / 2;
        this.rect(x0, 0, x1, p.h * 0.65, '#9b2d20');
        c.fillStyle = '#5a1a12';
        c.beginPath();
        c.moveTo(this.sx(x0 - 0.4), this.sy(p.h * 0.65));
        c.lineTo(this.sx(p.x), this.sy(p.h));
        c.lineTo(this.sx(x1 + 0.4), this.sy(p.h * 0.65));
        c.fill();
        this.rect(p.x - 1.4, 0, p.x + 1.4, 3.2, '#e8e0d0');
        this.rect(p.x - 1.2, 0, p.x + 1.2, 3.0, '#6e1f16');
        break;
      }
      case 'house': {
        const x0 = p.x - p.w / 2;
        const x1 = p.x + p.w / 2;
        this.rect(x0, 0, x1, p.h * 0.6, '#efe6d2');
        c.fillStyle = '#4a4a55';
        c.beginPath();
        c.moveTo(this.sx(x0 - 0.5), this.sy(p.h * 0.6));
        c.lineTo(this.sx(p.x), this.sy(p.h));
        c.lineTo(this.sx(x1 + 0.5), this.sy(p.h * 0.6));
        c.fill();
        this.rect(p.x - 0.5, 0, p.x + 0.5, 2.1, '#6b4a2b');
        this.rect(x0 + 1, 1.6, x0 + 2.4, 2.9, '#8fb3d1');
        this.rect(x1 - 2.4, 1.6, x1 - 1, 2.9, '#8fb3d1');
        break;
      }
      case 'stall': {
        const x0 = p.x - p.w / 2;
        const x1 = p.x + p.w / 2;
        this.rect(x0 + 0.1, 0, x0 + 0.2, 2.4, '#5a4632');
        this.rect(x1 - 0.2, 0, x1 - 0.1, 2.4, '#5a4632');
        this.rect(x0 + 0.2, 0.0, x1 - 0.2, 0.95, '#8a6a4a');
        for (let i = 0; i < 6; i++) {
          const sx0 = x0 + (i * p.w) / 6;
          this.rect(sx0, 2.2, sx0 + p.w / 6, 2.8, i % 2 ? '#f5f5f5' : p.color);
        }
        this.rect(x0, 2.8, x1, 2.9, '#f4f7fa');
        break;
      }
      case 'lamp':
        this.rect(p.x - 0.06, 0, p.x + 0.06, 3.6, '#2b2b2b');
        this.rect(p.x - 0.22, 3.5, p.x + 0.22, 3.85, '#ffe8a3');
        break;
      case 'tower': {
        const x0 = p.x - p.w / 2;
        const x1 = p.x + p.w / 2;
        this.rect(x0, 0, x1, p.h, p.color);
        this.rect(x0 - 0.2, p.h - 0.25, x1 + 0.2, p.h, '#2e2724');
        for (let fy = 1.5; fy < p.h - 1.5; fy += 3) {
          for (let fx = 1; fx < p.w - 1; fx += 2.5) this.rect(x0 + fx, fy, x0 + fx + 1.2, fy + 1.6, (fx * 7 + fy) % 3 < 1 ? '#f6c56a' : '#2a2433');
        }
        break;
      }
      case 'watertower': {
        const b = p.baseY;
        this.rect(p.x - 1.4, b, p.x - 1.25, b + 2.6, '#3b2f2a');
        this.rect(p.x + 1.25, b, p.x + 1.4, b + 2.6, '#3b2f2a');
        this.rect(p.x - 1.6, b + 2.5, p.x + 1.6, b + 5.4, '#7a5a43');
        c.fillStyle = '#4b3a30';
        c.beginPath();
        c.moveTo(this.sx(p.x - 1.7), this.sy(b + 5.4));
        c.lineTo(this.sx(p.x), this.sy(b + p.h));
        c.lineTo(this.sx(p.x + 1.7), this.sy(b + 5.4));
        c.fill();
        break;
      }
      case 'tracks':
        this.rect(-500, 0, 500, 0.45, '#3b3530');
        for (let x = -60; x <= 60; x += 0.8) this.rect(x, 0.4, x + 0.25, 0.55, '#4a3a2a');
        this.rect(-500, 0.55, 500, 0.62, '#8a8f96');
        break;
      case 'pole':
        this.rect(p.x - 0.1, 0, p.x + 0.1, 6.5, '#3a2d22');
        this.rect(p.x - 0.9, 6, p.x + 0.9, 6.15, '#3a2d22');
        break;
      case 'flag':
        this.drawFlag(p.x, p.baseY || 0, windX, t);
        break;
      default:
        break;
    }
  }

  drawFlag(x, baseY, windX, t) {
    const c = this.ctx;
    const poleH = 4;
    this.rect(x - 0.04, baseY, x + 0.04, baseY + poleH, '#d8d8d8');
    const speed = Math.min(Math.abs(windX), 20);
    const dir = windX >= 0 ? 1 : -1;
    const len = 1.4;
    const droop = 1 - speed / 20; // limp flag hangs down
    const topY = baseY + poleH;
    c.fillStyle = '#ff7a1a';
    c.beginPath();
    c.moveTo(this.sx(x), this.sy(topY));
    const n = 10;
    for (let i = 1; i <= n; i++) {
      const f = i / n;
      const wave = Math.sin(t * (2 + speed * 0.4) + f * 6) * 0.08 * (0.3 + speed / 20);
      const px = x + dir * f * len * (1 - droop * 0.85);
      const py = topY - f * len * droop * 0.9 + wave;
      c.lineTo(this.sx(px), this.sy(py));
    }
    for (let i = n; i >= 0; i--) {
      const f = i / n;
      const wave = Math.sin(t * (2 + speed * 0.4) + f * 6) * 0.08 * (0.3 + speed / 20);
      const px = x + dir * f * len * (1 - droop * 0.85) + droop * 0.25 * f * dir;
      const py = topY - 0.6 - f * len * droop * 0.9 + wave + (1 - droop) * 0.15 * f;
      c.lineTo(this.sx(px), this.sy(py));
    }
    c.closePath();
    c.fill();
  }

  drawPerson(world, p, t) {
    const s = world.personState(p, t);
    const c = this.ctx;
    const o = p.outfit;
    c.save();
    c.translate(this.sx(s.x), this.sy(s.y));
    if (p.fallenAt != null) {
      const fall = Math.min(1, (t - p.fallenAt) / 0.6);
      c.rotate((p.fallSide || 1) * fall * (Math.PI / 2));
    }
    const m = this.cam.ppm;
    const R = (x0, y0, x1, y1, fill) => {
      c.fillStyle = fill;
      c.fillRect(x0 * m, -y1 * m, (x1 - x0) * m, (y1 - y0) * m);
    };
    const swing = Math.abs(s.vx) > 0.05 ? Math.sin(t * 7 + p.label) * 0.06 : 0;
    // Legs and shoes
    R(-0.17 + swing, 0.05, -0.02 + swing, 0.9, o.pants);
    R(0.02 - swing, 0.05, 0.17 - swing, 0.9, o.pants);
    R(-0.19 + swing, 0, -0.01 + swing, 0.06, '#111');
    R(0.01 - swing, 0, 0.19 - swing, 0.06, '#111');
    // Torso and arms
    R(-0.2, 0.86, 0.2, 1.48, o.coat);
    R(-0.29, 0.86, -0.2, 1.46, o.coat);
    R(0.2, 0.86, 0.29, 1.46, o.coat);
    R(-0.28, 0.78, -0.21, 0.86, o.skin);
    R(0.21, 0.78, 0.28, 0.86, o.skin);
    if (o.shirt && o.shirt !== o.coat) {
      c.fillStyle = o.shirt;
      c.beginPath();
      c.moveTo(-0.08 * m, -1.48 * m);
      c.lineTo(0.08 * m, -1.48 * m);
      c.lineTo(0, -1.22 * m);
      c.fill();
    }
    if (o.tie) {
      c.fillStyle = o.tie;
      c.beginPath();
      c.moveTo(-0.025 * m, -1.47 * m);
      c.lineTo(0.025 * m, -1.47 * m);
      c.lineTo(0.04 * m, -1.18 * m);
      c.lineTo(0, -1.12 * m);
      c.lineTo(-0.04 * m, -1.18 * m);
      c.fill();
    }
    // Neck and head
    R(-0.05, 1.46, 0.05, 1.53, o.skin);
    c.fillStyle = o.skin;
    c.beginPath();
    c.arc(0, -BODY.head.cy * m, BODY.head.r * m, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = o.hair;
    c.beginPath();
    c.arc(0, -BODY.head.cy * m, BODY.head.r * m, Math.PI * 1.05, Math.PI * 1.95);
    c.fill();
    if (o.glasses) R(-0.085, 1.615, 0.085, 1.655, '#050505');
    if (o.hat) {
      R(-0.16, 1.69, 0.16, 1.72, o.hat);
      R(-0.1, 1.72, 0.1, 1.82, o.hat);
    }
    c.restore();
  }

  drawTrain(world, t) {
    const c = this.ctx;
    const rects = world.trainRects(t);
    const night = world.level.sky === 'night';
    // Window interiors (lit), then passengers, then the car bodies with window holes.
    for (const r of rects) for (const w of r.windows) this.rect(w.x0, w.y0, w.x1, w.y1, night ? '#f7d98b' : '#c9d6dd');
    for (const p of world.people) if (p.car != null && p.fallenAt == null) this.drawPerson(world, p, t);
    for (const r of rects) {
      c.fillStyle = r.loco ? '#7a1f1f' : '#2f4f6f';
      c.beginPath();
      c.rect(this.sx(r.x0), this.sy(r.y1), this.m(r.x1 - r.x0), this.m(r.y1 - r.y0));
      for (const w of r.windows) c.rect(this.sx(w.x1), this.sy(w.y1), -this.m(w.x1 - w.x0), this.m(w.y1 - w.y0));
      c.fill('evenodd');
      this.rect(r.x0, r.y1 - 0.25, r.x1, r.y1, r.loco ? '#4a1010' : '#1d3349');
      this.rect(r.x0, r.y0 + 0.5, r.x1, r.y0 + 0.62, '#c9b458');
      for (let wx = r.x0 + 1.2; wx < r.x1 - 0.5; wx += r.loco ? 2.6 : (r.x1 - r.x0) - 2.4) {
        c.fillStyle = '#111';
        c.beginPath();
        c.arc(this.sx(wx), this.sy(r.y0 + 0.05), this.m(0.42), 0, Math.PI * 2);
        c.fill();
      }
      if (r.loco) {
        this.rect(r.x1 - 3, r.y1, r.x1 - 2.2, r.y1 + 1.0, '#222');
        if (night) {
          c.fillStyle = 'rgba(255,240,180,0.25)';
          c.beginPath();
          c.moveTo(this.sx(r.x1), this.sy(r.y0 + 1.6));
          c.lineTo(this.sx(r.x1 + 14), this.sy(r.y0 + 3.2));
          c.lineTo(this.sx(r.x1 + 14), this.sy(r.y0));
          c.fill();
        }
      }
    }
  }

  drawLabels(world, t) {
    const c = this.ctx;
    c.font = '700 13px ui-monospace, Menlo, monospace';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    for (const p of world.people) {
      if (!p.alive && p.fallenAt != null) continue;
      const s = world.personState(p, t);
      const top = p.car != null ? s.y + world.train.windowTop + 0.1 : s.y + 1.9;
      const x = this.sx(s.x);
      const y = this.sy(top) - 12;
      if (x < -20 || x > this.w + 20) continue;
      c.fillStyle = 'rgba(0,0,0,0.72)';
      c.strokeStyle = 'rgba(160,255,160,0.9)';
      c.lineWidth = 1.5;
      c.beginPath();
      c.roundRect(x - 11, y - 10, 22, 20, 4);
      c.fill();
      c.stroke();
      c.fillStyle = '#b6ffb0';
      c.fillText(String(p.label), x, y + 1);
      c.strokeStyle = 'rgba(160,255,160,0.6)';
      c.beginPath();
      c.moveTo(x, y + 10);
      c.lineTo(x, y + 16);
      c.stroke();
    }
  }

  // --- effects -------------------------------------------------------------------------
  addEffect(kind, x, y, t0) {
    this.effects.push({ kind, x, y, t0 });
  }

  drawEffects(t) {
    const c = this.ctx;
    this.effects = this.effects.filter((e) => t - e.t0 < 3);
    for (const e of this.effects) {
      const a = (t - e.t0) / 3;
      if (t < e.t0) continue;
      if (e.kind === 'blood') {
        c.fillStyle = `rgba(170,0,0,${0.9 * (1 - a)})`;
        for (let i = 0; i < 8; i++) {
          const ang = (i / 8) * Math.PI * 2;
          const d = 0.05 + a * 0.25;
          c.beginPath();
          c.arc(this.sx(e.x + Math.cos(ang) * d), this.sy(e.y + Math.sin(ang) * d), Math.max(1.5, this.m(0.04)), 0, Math.PI * 2);
          c.fill();
        }
      } else {
        c.fillStyle = `rgba(200,180,140,${0.8 * (1 - a)})`;
        for (let i = 0; i < 6; i++) {
          c.beginPath();
          c.arc(this.sx(e.x + (i - 2.5) * 0.08 * (1 + a * 3)), this.sy(e.y + a * 0.6 + (i % 2) * 0.1), Math.max(2, this.m(0.12 + a * 0.3)), 0, Math.PI * 2);
          c.fill();
        }
      }
      // Impact marker
      c.strokeStyle = `rgba(255,60,60,${1 - a})`;
      c.lineWidth = 2;
      const x = this.sx(e.x);
      const y = this.sy(e.y);
      c.beginPath();
      c.moveTo(x - 6, y - 6); c.lineTo(x + 6, y + 6);
      c.moveTo(x + 6, y - 6); c.lineTo(x - 6, y + 6);
      c.stroke();
    }
  }

  drawTrace(flight, t) {
    const p = (t - flight.t0) / flight.tof;
    if (p < 0 || p > 1) return;
    const c = this.ctx;
    const x0 = this.w * 0.5;
    const y0 = this.h + 10;
    const x1 = this.sx(flight.x);
    const y1 = this.sy(flight.y);
    const arc = -this.h * 0.25 * Math.sin(Math.PI * p);
    const x = x0 + (x1 - x0) * p;
    const y = y0 + (y1 - y0) * p + arc;
    const g = c.createRadialGradient(x, y, 0, x, y, 10);
    g.addColorStop(0, 'rgba(255,255,220,0.95)');
    g.addColorStop(1, 'rgba(255,255,220,0)');
    c.fillStyle = g;
    c.beginPath();
    c.arc(x, y, 10, 0, Math.PI * 2);
    c.fill();
  }

  drawSnow(windX, t, w = this.w, ox = 0, oy = 0) {
    const c = this.ctx;
    c.fillStyle = 'rgba(255,255,255,0.85)';
    const h = w === this.w ? this.h : w;
    for (const f of this.snow) {
      const x = ox + ((((f.x + t * windX * 0.004 * f.s) % 1) + 1) % 1) * w;
      const y = oy + (((f.y + t * 0.05 * f.s) % 1) + 1) % 1 * h;
      c.beginPath();
      c.arc(x, y, f.r, 0, Math.PI * 2);
      c.fill();
    }
  }

  // --- overlays ------------------------------------------------------------------------
  drawMilGrid(D, viewMils) {
    const c = this.ctx;
    const pxPerMil = this.w / viewMils;
    const cx = this.w / 2;
    const cy = this.h / 2;
    c.lineWidth = 1;
    c.font = '10px ui-monospace, Menlo, monospace';
    c.textAlign = 'center';
    c.textBaseline = 'top';
    const half = Math.ceil(viewMils / 2);
    for (let i = -half; i <= half; i++) {
      const x = cx + i * pxPerMil;
      const major = i % 5 === 0;
      c.strokeStyle = major ? 'rgba(180,255,180,0.28)' : 'rgba(180,255,180,0.1)';
      c.beginPath();
      c.moveTo(x, 0);
      c.lineTo(x, this.h);
      c.stroke();
      if (major) {
        c.fillStyle = 'rgba(200,255,200,0.7)';
        c.fillText(String(i), x, 4);
      }
    }
    const halfV = Math.ceil(this.h / pxPerMil / 2);
    c.textAlign = 'left';
    c.textBaseline = 'middle';
    for (let i = -halfV; i <= halfV; i++) {
      const y = cy + i * pxPerMil;
      const major = i % 5 === 0;
      c.strokeStyle = major ? 'rgba(180,255,180,0.28)' : 'rgba(180,255,180,0.1)';
      c.beginPath();
      c.moveTo(0, y);
      c.lineTo(this.w, y);
      c.stroke();
      if (major && i !== 0) {
        c.fillStyle = 'rgba(200,255,200,0.7)';
        c.fillText(String(-i), 4, y);
      }
    }
    c.fillStyle = 'rgba(200,255,200,0.8)';
    c.textAlign = 'left';
    c.textBaseline = 'bottom';
    c.fillText(`SPOTTER SCOPE  ·  grid = 1 mil  (1 mil = ${(D / 1000).toFixed(2)} m at ${D} m)`, 8, this.h - 8);
  }

  drawSpotterVignette() {
    const c = this.ctx;
    const g = c.createRadialGradient(this.w / 2, this.h / 2, Math.min(this.w, this.h) * 0.35, this.w / 2, this.h / 2, Math.max(this.w, this.h) * 0.75);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.55)');
    c.fillStyle = g;
    c.fillRect(0, 0, this.w, this.h);
  }

  drawSniperMarker(aim, label) {
    const c = this.ctx;
    const x = this.sx(aim.x);
    const y = this.sy(aim.y);
    const clampedX = Math.max(14, Math.min(this.w - 14, x));
    const clampedY = Math.max(14, Math.min(this.h - 14, y));
    c.strokeStyle = 'rgba(255,70,70,0.95)';
    c.lineWidth = 1.5;
    if (clampedX !== x || clampedY !== y) {
      c.fillStyle = 'rgba(255,70,70,0.95)';
      c.beginPath();
      c.arc(clampedX, clampedY, 6, 0, Math.PI * 2);
      c.fill();
      c.font = '600 11px ui-monospace, Menlo, monospace';
      c.textAlign = clampedX > this.w / 2 ? 'right' : 'left';
      c.fillText('SNIPER AIM (off view)', clampedX + (clampedX > this.w / 2 ? -10 : 10), clampedY);
      return;
    }
    c.beginPath();
    c.arc(x, y, 9, 0, Math.PI * 2);
    c.moveTo(x - 16, y); c.lineTo(x - 4, y);
    c.moveTo(x + 4, y); c.lineTo(x + 16, y);
    c.moveTo(x, y - 16); c.lineTo(x, y - 4);
    c.moveTo(x, y + 4); c.lineTo(x, y + 16);
    c.stroke();
    c.fillStyle = 'rgba(255,90,90,0.95)';
    c.font = '600 11px ui-monospace, Menlo, monospace';
    c.textAlign = 'left';
    c.textBaseline = 'bottom';
    c.fillText(label || 'SNIPER', x + 12, y - 10);
  }

  drawScopeReticle(cx, cy, r, pxPerMil) {
    const c = this.ctx;
    c.strokeStyle = 'rgba(0,0,0,0.9)';
    c.lineWidth = 1.2;
    c.beginPath();
    c.moveTo(cx - r, cy); c.lineTo(cx + r, cy);
    c.moveTo(cx, cy - r); c.lineTo(cx, cy + r);
    c.stroke();
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(cx - r, cy); c.lineTo(cx - r * 0.55, cy);
    c.moveTo(cx + r * 0.55, cy); c.lineTo(cx + r, cy);
    c.moveTo(cx, cy + r * 0.55); c.lineTo(cx, cy + r);
    c.stroke();
    c.fillStyle = 'rgba(0,0,0,0.9)';
    for (let i = -5; i <= 5; i++) {
      if (!i) continue;
      c.beginPath();
      c.arc(cx + i * pxPerMil, cy, 1.8, 0, Math.PI * 2);
      c.arc(cx, cy + i * pxPerMil, 1.8, 0, Math.PI * 2);
      c.fill();
    }
    c.fillStyle = 'rgba(255,0,0,0.9)';
    c.beginPath();
    c.arc(cx, cy, 1.6, 0, Math.PI * 2);
    c.fill();
    const g = c.createRadialGradient(cx, cy, r * 0.75, cx, cy, r);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.6)');
    c.fillStyle = g;
    c.fillRect(cx - r, cy - r, r * 2, r * 2);
  }
}

/** Draw a small standalone portrait of an outfit (for the target dossier). */
export function drawPortrait(canvas, outfit) {
  const c = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  c.fillStyle = '#1b2118';
  c.fillRect(0, 0, w, h);
  const fake = {
    personState: () => ({ x: 0, y: 0, vx: 0 }),
  };
  const r = Object.create(Renderer.prototype);
  r.ctx = c;
  r.w = w;
  r.h = h;
  r.setCamera(0, 1.25, 1.2, w, h);
  r.drawPerson(fake, { outfit, label: 0 }, 0);
}
