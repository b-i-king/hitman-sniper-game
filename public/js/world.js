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
      const sp = p.flee.speed || 3;
      return { x: p.flee.x + p.flee.dir * sp * tf, y: p.y, vx: p.fallenAt != null ? 0 : p.flee.dir * sp };
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
    case 'head': return { score: 100, verdict: 'Headshot - target eliminated', eliminated: true, casualty: false, lethal: 1 };
    case 'neck': return { score: 95, verdict: 'Neck shot - target eliminated', eliminated: true, casualty: false, lethal: 1 };
    case 'chest': {
      const d = Math.hypot(impact.x - s.x - BODY.heart.x, impact.y - s.y - BODY.heart.y);
      const score = Math.round(100 - 15 * Math.min(1, d / 0.22));
      // Near the heart is almost always fatal; a chest hit off-center may not drop him.
      return { score, verdict: 'Center mass - target eliminated', eliminated: true, casualty: false, lethal: d < 0.12 ? 0.95 : 0.75 };
    }
    case 'abdomen': return { score: 70, verdict: 'Gut shot - target down, critical', eliminated: true, casualty: false, lethal: 0.5 };
    case 'arm': return { score: 45, verdict: 'Arm hit - target wounded and escaped', eliminated: false, casualty: false };
    case 'leg': return { score: 30, verdict: 'Leg hit - target wounded and escaped', eliminated: false, casualty: false };
    default: return { score: 0, verdict: 'Miss', eliminated: false, casualty: false };
  }
}

export const PASS_SCORE = 70;
export const HINT_CAP = 60;
/** Best score a target who survives the hit and escapes can earn. */
export const WOUNDED_ESCAPE_CAP = 50;
/** Follow-up shots are worth this fraction of a first-shot score. */
export const FOLLOW_UP_FACTOR = 0.8;

/** Rough human name for a hex color ("navy", "red", ...), for the sniper's descriptions. */
export function colorName(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const sat = max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1));
  if (l < 0.13) return 'black';
  if (l > 0.88) return 'white';
  if (sat < 0.18) return l < 0.45 ? 'dark grey' : 'grey';
  let h = 0;
  if (max === r) h = ((g - b) / (max - min)) % 6;
  else if (max === g) h = (b - r) / (max - min) + 2;
  else h = (r - g) / (max - min) + 4;
  h = (h * 60 + 360) % 360;
  if (h < 15 || h >= 340) return l < 0.3 ? 'maroon' : 'red';
  if (h < 40) return l < 0.4 ? 'brown' : sat < 0.5 ? 'tan' : 'orange';
  if (h < 65) return l < 0.4 ? 'olive' : 'yellow';
  if (h < 100 && l < 0.4) return 'olive';
  if (h < 170) return l < 0.3 ? 'dark green' : 'green';
  if (h < 200) return 'teal';
  if (h < 250) return l < 0.3 ? 'navy' : 'blue';
  if (h < 290) return 'purple';
  return 'pink';
}

// Outfit styles: suit (tie), jacket (zip-up), overalls (bib over a shirt), parka (long puffy
// coat, often with a scarf). Hat styles: fedora / brim (wide-brim) / cap / beanie.
const STYLE_NAME = { suit: 'suit', jacket: 'jacket', overalls: 'overalls', parka: 'parka', top: 'top' };
const HAT_NAME = { fedora: 'hat', brim: 'hat', cap: 'cap', beanie: 'beanie' };

/** The visible pieces of an outfit, each as { key, text }. */
export function outfitParts(o) {
  const style = o.style || (o.shirt && o.shirt !== o.coat ? 'suit' : 'top');
  const main = style === 'overalls' ? o.pants : o.coat;
  const parts = [{ key: 'body', text: `${colorName(main)} ${STYLE_NAME[style] || 'top'}` }];
  if (style === 'overalls' && o.shirt) parts.push({ key: 'shirt', text: `${colorName(o.shirt)} shirt` });
  if (o.tie) parts.push({ key: 'tie', text: `${colorName(o.tie)} tie` });
  if (o.scarf) parts.push({ key: 'scarf', text: `${colorName(o.scarf)} scarf` });
  if (o.glasses) parts.push({ key: 'glasses', text: 'sunglasses' });
  if (o.hat) parts.push({ key: 'hat', text: `${colorName(o.hat)} ${HAT_NAME[o.hatStyle] || 'hat'}` });
  return parts;
}

/** What the sniper sees through his scope: "olive jacket, orange cap, sunglasses". */
export function describeOutfit(o) {
  return outfitParts(o).map((p) => p.text).join(', ');
}

/**
 * The dossier line for a target, built from the same words the sniper uses, with the color of
 * the identifying item in capitals: "Olive jacket, ORANGE cap, sunglasses."
 */
export function dossierLine(o, key) {
  const text = outfitParts(o)
    .map((p) => (p.key === key ? p.text.replace(/^(.*) (\S+)$/, (m, color, item) => `${color.toUpperCase()} ${item}`) : p.text))
    .join(', ');
  return `${text[0].toUpperCase()}${text.slice(1)}.`;
}

// --- picking someone by description --------------------------------------------------------
// "the guy in the orange cap", "man with the red scarf", "the one on the far left".

const COLOR_WORDS = {
  black: ['black', 'dark'], white: ['white'], grey: ['grey', 'gray', 'silver'], 'dark grey': ['dark grey', 'dark gray', 'charcoal', 'grey', 'gray'],
  red: ['red'], maroon: ['maroon', 'dark red', 'burgundy', 'red'], orange: ['orange', 'blaze orange', 'hunter orange'],
  tan: ['tan', 'beige', 'khaki', 'brown'], brown: ['brown'], yellow: ['yellow', 'gold'], olive: ['olive', 'army green', 'green', 'khaki'],
  green: ['green'], 'dark green': ['dark green', 'green'], teal: ['teal', 'turquoise'], blue: ['blue', 'light blue'],
  navy: ['navy', 'dark blue', 'navy blue', 'blue'], purple: ['purple', 'violet'], pink: ['pink'],
};
const ITEM_WORDS = {
  cap: ['cap', 'ball cap', 'baseball cap', 'hat'], hat: ['hat', 'cowboy hat', 'brim'], beanie: ['beanie', 'toque', 'hat', 'wool hat'],
  scarf: ['scarf'], tie: ['tie', 'necktie'], suit: ['suit'], jacket: ['jacket', 'coat', 'shirt', 'top'], parka: ['parka', 'coat', 'jacket'],
  overalls: ['overalls', 'dungarees'], shirt: ['shirt'], top: ['top', 'shirt', 'sweater', 'jacket'],
};
const esc = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Find the person a spotter described. Returns { person } for a unique match,
 * { ambiguous: [labels] } when several fit, or null when the text describes nobody.
 */
export function findByDescription(text, people, isVisible = () => true, xOf = (p) => p.x || 0) {
  const s = ` ${String(text).toLowerCase().replace(/['’]/g, '').replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ')} `;
  const candidates = people.filter((p) => p.fallenAt == null && isVisible(p));
  if (!candidates.length) return null;

  // Position in the crowd: far left / leftmost / on the right / in the middle.
  const pos = s.match(/\b(?:(?:guy|man|woman|lady|dude|one|person|target|tango|fella|bloke) (?:on|at|to) the (far )?(left|right)|(far left|far right|leftmost|rightmost|furthest left|furthest right)|(?:in the|the) (middle|center|centre)(?: one| guy| man)?)\b/);
  const scores = candidates.map((p) => {
    let score = 0;
    for (const part of outfitParts(p.outfit)) {
      const m = part.text.match(/^(.*) (\S+)$/);
      if (!m) {
        if (part.key === 'glasses' && /\b(sunglasses|shades|glasses|sunnies)\b/.test(s)) score += 1;
        continue;
      }
      const [, color, item] = m;
      const colors = COLOR_WORDS[color] || [color];
      const items = ITEM_WORDS[item] || [item];
      const colorRe = colors.map(esc).join('|');
      const itemRe = items.map(esc).join('|');
      // "orange cap", "orange baseball cap", "cap is orange", "in orange"
      if (new RegExp(`\\b(?:${colorRe})(?: \\w+){0,2} (?:${itemRe})\\b`).test(s)) score += part.key === 'body' ? 2 : 3;
      else if (new RegExp(`\\b(?:${itemRe}) (?:is |thats |that s )?(?:${colorRe})\\b`).test(s)) score += 2;
    }
    return { p, score };
  });
  let pool = scores;
  const best = Math.max(...scores.map((x) => x.score));
  if (best > 0) pool = scores.filter((x) => x.score === best);
  else if (!pos) return null;

  if (pos) {
    const sorted = [...pool].sort((a, b) => xOf(a.p) - xOf(b.p));
    const side = pos[2] || (pos[3] && /left/.test(pos[3]) ? 'left' : pos[3] ? 'right' : null);
    if (side === 'left') pool = [sorted[0]];
    else if (side === 'right') pool = [sorted[sorted.length - 1]];
    else if (pos[4]) pool = sorted.length % 2 ? [sorted[(sorted.length - 1) / 2]] : sorted.slice(sorted.length / 2 - 1, sorted.length / 2 + 1);
  }
  if (pool.length === 1) return { person: pool[0].p };
  return { ambiguous: pool.map((x) => x.p.label) };
}
