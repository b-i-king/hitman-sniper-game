// The simulated world of one mission: who stands where at time t, the wind right now, the
// train, and what a bullet hits. Pure logic (no drawing), so it is testable in Node.

export const BODY = {
  height: 1.75,
  head: { cx: 0, cy: 1.62, r: 0.11 },
  neck: { x0: -0.05, x1: 0.05, y0: 1.47, y1: 1.52 },
  chest: { x0: -0.2, x1: 0.2, y0: 1.2, y1: 1.48 },
  abdomen: { x0: -0.18, x1: 0.18, y0: 0.9, y1: 1.2 },
  armL: { x0: -0.29, x1: -0.2, y0: 0.85, y1: 1.47 },
  armR: { x0: 0.2, x1: 0.29, y0: 0.85, y1: 1.47 },
  legs: { x0: -0.18, x1: 0.18, y0: 0, y1: 0.9 },
  heart: { x: 0, y: 1.34 },
};

const LOCO_LENGTH = 10;

const inRect = (x, y, r) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class World {
  /**
   * @param level   a LEVELS entry
   * @param opts    { rng, aspect } - aspect = view height / width (for visibility checks)
   */
  constructor(level, { rng = Math.random, aspect = 9 / 16 } = {}) {
    this.level = level;
    this.distance = level.distance;
    this.aspect = aspect;
    this.windPhase = rng() * Math.PI * 2;

    // Shuffle the number labels so the target isn't always "1".
    const labels = level.people.map((_, i) => i + 1);
    for (let i = labels.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [labels[i], labels[j]] = [labels[j], labels[i]];
    }
    this.people = level.people.map((p, i) => ({ ...p, label: labels[i], y: p.y || 0, alive: true, fallenAt: null }));
    this.target = this.people.find((p) => p.isTarget);

    if (level.train) {
      const tr = level.train;
      this.train = { ...tr, length: LOCO_LENGTH + tr.cars * (tr.carLength + tr.gap) };
      const half = this.viewHalfWidth();
      this.train.start = -half - 4; // head x when the whole train is just off-screen left
      this.train.loop = this.train.length + 2 * half + 12;
      // Offset so the target's window first appears ~6 s into the mission.
      const tgtOffset = this.windowOffset(this.target.car, this.target.window);
      const headWhenVisible = -half - tgtOffset;
      this.train.offset0 = headWhenVisible - this.train.start - tr.speed * 6;
      this.train.offset0 = ((this.train.offset0 % this.train.loop) + this.train.loop) % this.train.loop;
    }
  }

  viewHalfWidth() {
    return (this.level.viewMils * this.distance) / 1000 / 2;
  }

  /** View rectangle (meters) of the wide spotter view. */
  viewRect() {
    const half = this.viewHalfWidth();
    const halfH = half * this.aspect;
    const { x, y } = this.level.camera;
    return { x0: x - half, x1: x + half, y0: y - halfH, y1: y + halfH };
  }

  /** Crosswind in mph (positive = blowing toward the right) at time t. */
  windAt(t) {
    const { base, gust } = this.level.wind;
    const p = this.windPhase;
    return base + gust * (0.65 * Math.sin(0.3 * t + p) + 0.35 * Math.sin(0.75 * t + 2 * p));
  }

  // --- train -------------------------------------------------------------------
  trainHeadX(t) {
    const tr = this.train;
    return tr.start + ((tr.speed * t + tr.offset0) % tr.loop);
  }

  /** Distance from the locomotive's front to the center of a given passenger window. */
  windowOffset(car, win) {
    const tr = this.level.train;
    const carFront = LOCO_LENGTH + tr.gap + car * (tr.carLength + tr.gap);
    const spacing = tr.carLength / tr.windowsPerCar;
    return carFront + spacing * (win + 0.5);
  }

  /** Rectangles of the train at time t: [{x0,x1,y0,y1, windows:[rect]}]. */
  trainRects(t) {
    const tr = this.train;
    const head = this.trainHeadX(t);
    const rects = [{ x0: head - LOCO_LENGTH, x1: head, y0: tr.floorY - 0.6, y1: tr.floorY + 3.0, windows: [], loco: true }];
    for (let c = 0; c < tr.cars; c++) {
      const front = head - LOCO_LENGTH - tr.gap - c * (tr.carLength + tr.gap);
      const windows = [];
      for (let w = 0; w < tr.windowsPerCar; w++) {
        const cx = head - this.windowOffset(c, w);
        windows.push({ x0: cx - tr.windowWidth / 2, x1: cx + tr.windowWidth / 2, y0: tr.floorY + tr.windowBottom, y1: tr.floorY + tr.windowTop, car: c, window: w });
      }
      rects.push({ x0: front - tr.carLength, x1: front, y0: tr.floorY - 0.6, y1: tr.floorY + 2.6, windows, car: c });
    }
    return rects;
  }

  // --- people ------------------------------------------------------------------
  /** Feet position and horizontal velocity of a person at time t. */
  personState(p, t) {
    if (p.car != null) {
      const x = this.trainHeadX(t) - this.windowOffset(p.car, p.window);
      return { x, y: this.train.floorY, vx: this.train.speed };
    }
    const tEff = p.fallenAt != null ? p.fallenAt : t;
    if (p.flee) {
      const tf = Math.max(0, tEff - p.flee.t0);
      return { x: p.flee.x + p.flee.dir * 4 * tf, y: p.y, vx: p.fallenAt != null ? 0 : p.flee.dir * 4 };
    }
    if (!p.move) return { x: p.x, y: p.y, vx: 0 };
    const { from, to, speed, pause, phase = 0 } = p.move;
    const d = Math.abs(to - from);
    const walk = d / speed;
    const period = 2 * (walk + pause);
    const tt = (((tEff + phase) % period) + period) % period;
    const dir = Math.sign(to - from);
    let x;
    let vx = 0;
    if (tt < walk) { x = from + dir * speed * tt; vx = dir * speed; }
    else if (tt < walk + pause) { x = to; }
    else if (tt < 2 * walk + pause) { x = to - dir * speed * (tt - walk - pause); vx = -dir * speed; }
    else { x = from; }
    if (p.fallenAt != null) vx = 0;
    return { x, y: p.y, vx };
  }

  /** World point of a body part ('head' | 'chest') on a person at time t. */
  aimPoint(p, t, part = 'chest') {
    const s = this.personState(p, t);
    const off = part === 'head' ? { x: BODY.head.cx, y: BODY.head.cy } : BODY.heart;
    return { x: s.x + off.x, y: s.y + off.y, vx: s.vx };
  }

  byLabel(label) {
    return this.people.find((p) => p.label === label) || null;
  }

  /** Is a world point blocked by the train body (not a window)? */
  occluded(x, y, t) {
    if (!this.train) return false;
    for (const r of this.trainRects(t)) {
      if (inRect(x, y, r)) return !r.windows.some((w) => inRect(x, y, w));
    }
    return false;
  }

  /** Can the spotter/sniper see this person's chest right now (inside the wide view)? */
  isVisible(p, t, margin = 0) {
    const pt = this.aimPoint(p, t, 'chest');
    const v = this.viewRect();
    const inView = pt.x > v.x0 + margin && pt.x < v.x1 - margin && pt.y > v.y0 && pt.y < v.y1;
    return inView && !this.occluded(pt.x, pt.y, t);
  }

  /** Which body part of person p (if any) contains world point (x, y) at time t. */
  partAt(p, x, y, t) {
    if (!p.alive) return null;
    const s = this.personState(p, t);
    const lx = x - s.x;
    const ly = y - s.y;
    const h = BODY.head;
    if ((lx - h.cx) ** 2 + (ly - h.cy) ** 2 <= h.r * h.r) return 'head';
    if (inRect(lx, ly, BODY.neck)) return 'neck';
    if (inRect(lx, ly, BODY.chest)) return 'chest';
    if (inRect(lx, ly, BODY.abdomen)) return 'abdomen';
    if (inRect(lx, ly, BODY.armL) || inRect(lx, ly, BODY.armR)) return 'arm';
    if (inRect(lx, ly, BODY.legs)) return 'leg';
    return null;
  }

  /** What does a bullet arriving at world point (x, y) at time t hit? */
  hitTest(x, y, t) {
    if (this.train) {
      for (const r of this.trainRects(t)) {
        if (!inRect(x, y, r)) continue;
        const win = r.windows.find((w) => inRect(x, y, w));
        if (!win) return { kind: 'train' };
        for (const p of this.people) {
          if (p.car === win.car && p.window === win.window) {
            const part = this.partAt(p, x, y, t);
            if (part) return { kind: 'person', person: p, part };
          }
        }
        return { kind: 'miss' };
      }
    }
    // Later entries are drawn in front, so test them first.
    for (let i = this.people.length - 1; i >= 0; i--) {
      const p = this.people[i];
      if (p.car != null) continue;
      const part = this.partAt(p, x, y, t);
      if (part) return { kind: 'person', person: p, part };
    }
    return { kind: 'miss' };
  }
}

/** Grade a shot from 0 to 100. */
export function scoreShot(hit, impact, world, t) {
  if (hit.kind === 'train') return { score: 0, verdict: 'Bullet hit the train', eliminated: false, casualty: false };
  if (hit.kind !== 'person') return { score: 0, verdict: 'Clean miss', eliminated: false, casualty: false };
  if (!hit.person.isTarget) {
    return { score: 0, verdict: 'CIVILIAN CASUALTY', eliminated: false, casualty: true };
  }
  const s = world.personState(hit.person, t);
  switch (hit.part) {
    case 'head': return { score: 100, verdict: 'Headshot - target eliminated', eliminated: true, casualty: false };
    case 'neck': return { score: 95, verdict: 'Neck shot - target eliminated', eliminated: true, casualty: false };
    case 'chest': {
      const d = Math.hypot(impact.x - s.x - BODY.heart.x, impact.y - s.y - BODY.heart.y);
      const score = Math.round(100 - 15 * Math.min(1, d / 0.22));
      return { score, verdict: 'Center mass - target eliminated', eliminated: true, casualty: false };
    }
    case 'abdomen': return { score: 70, verdict: 'Gut shot - target down, critical', eliminated: true, casualty: false };
    case 'arm': return { score: 45, verdict: 'Arm hit - target wounded and escaped', eliminated: false, casualty: false };
    case 'leg': return { score: 30, verdict: 'Leg hit - target wounded and escaped', eliminated: false, casualty: false };
    default: return { score: 0, verdict: 'Miss', eliminated: false, casualty: false };
  }
}

export const PASS_SCORE = 70;
export const HINT_CAP = 60;
