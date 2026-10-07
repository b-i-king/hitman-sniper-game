// Endless Contracts: random variations of the five campaign missions, harder each round.
// Range, wind, temperature, weather, crowd size, target identity, movement and time limit are
// all rolled from a seed, so the same seed + round always gives the same contract.

import { LEVELS, civ } from './levels.js';
import { mulberry32 } from './world.js';

const SUITS = [['black', '#16161a'], ['charcoal', '#3a3d42'], ['navy', '#1c2a4a'], ['white', '#e9e9e4'], ['brown', '#5a3e2b'], ['grey', '#7c7f86']];
const TIES = [['red', '#d01818'], ['green', '#1f9e3a'], ['yellow', '#e5c51b'], ['purple', '#7b2fbf'], ['orange', '#ef7a12'], ['blue', '#1d4ed8'], ['pink', '#e04f9a']];
const HATS = [['black', '#151515'], ['tan', '#b8945a'], ['white', '#efefef'], ['red', '#b02020']];
const SKIN = ['#f1c9a5', '#e0b58f', '#d9a77c', '#b07d56', '#8a5a3b', '#5e3a24'];
const HAIR = ['#111', '#2a1d14', '#3a2a1a', '#6b4d2a', '#d4a017', '#888'];
const CIV_COLORS = ['#c0392b', '#2980b9', '#27ae60', '#8e44ad', '#f39c12', '#16a085', '#d35400', '#7f8c8d', '#e84393', '#6c5ce7', '#b8860b', '#556b2f'];

const NAMES = [
  'Viktor "The Viper" Kovac', 'Dmitri "The Butcher" Volkov', 'Sofia "Black Widow" Marquez', 'Lucien "The Fox" Delacroix',
  'Hector "Iron" Mendez', 'Yuri "Ice" Petrov', 'Carmen "La Reina" Santos', 'Felix "The Ferret" Brandt', 'Ivo "Two Knives" Rahn',
];
const LINES = [
  'Keep your eyes open. Somebody is watching us.', 'This deal closes today, one way or another.', 'Relax. Nobody knows we are here.',
  'Where is my car? I hate standing in the open.', 'If the police show up, you never saw me.', 'Double the guards tonight.',
];

// Per template: range band (m), allowed weather, crowd limits.
const SPEC = {
  field: { scene: 'You and Ghost lie side by side in the grass on a ridge above open farmland.', range: [250, 700], weather: ['clear', 'fog', 'rain'], civ: [0, 3] },
  farm: { scene: 'You are both dug in behind a hedgerow overlooking a farm.', range: [300, 750], weather: ['clear', 'fog', 'rain'], civ: [2, 5] },
  market: { scene: 'You and Ghost are tucked into a bell tower above the market square.', range: [400, 850], weather: ['snow', 'clear', 'fog'], civ: [3, 6] },
  rooftop: { scene: 'You and Ghost are on a water-tank platform overlooking the city rooftops.', range: [500, 1000], weather: ['heat', 'clear', 'rain'], civ: [2, 5] },
  train: { scene: 'You and Ghost lie in the mud on a hillside above the railway at night.', range: [350, 650], weather: ['rain', 'clear', 'fog'], civ: [4, 8] },
};

const WEATHER_TEXT = {
  clear: 'Clear skies.',
  rain: 'Rain is falling. It blurs the glass but does not move the bullet much.',
  snow: 'Snow is falling.',
  fog: 'Thick fog: the laser rangefinder cannot get a return. Measure the range with the mil scale.',
  heat: 'Heat shimmer: the laser rangefinder is useless. Measure the range with the mil scale.',
};

const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (v) => Math.max(0, Math.min(1, v));

function randomTarget(rng) {
  const suit = pick(rng, SUITS);
  const tie = pick(rng, TIES);
  const glasses = rng() < 0.6;
  const hat = !glasses || rng() < 0.3 ? pick(rng, HATS) : null;
  const outfit = { coat: suit[1], shirt: suit[0] === 'white' ? '#cfd8dc' : '#f2f2f2', tie: tie[1], pants: suit[1], skin: pick(rng, SKIN), hair: pick(rng, HAIR), glasses, hat: hat ? hat[1] : null };
  const desc = `${suit[0][0].toUpperCase()}${suit[0].slice(1)} suit, ${tie[0].toUpperCase()} tie${glasses ? ', sunglasses' : ''}${hat ? `, ${hat[0]} hat` : ''}.`;
  // A bodyguard dressed the same except for the tie.
  const otherTie = pick(rng, TIES.filter((t) => t !== tie));
  const decoy = { ...outfit, tie: otherTie[1], skin: pick(rng, SKIN) };
  return { outfit, desc, decoy, decoyTie: otherTie[0] };
}

function randomCivilian(rng, i) {
  const coat = CIV_COLORS[(i * 5 + Math.floor(rng() * CIV_COLORS.length)) % CIV_COLORS.length];
  return civ(coat, pick(rng, ['#2c3e50', '#333', '#4a3a2a', '#34495e']), { skin: pick(rng, SKIN), hair: pick(rng, HAIR), hat: rng() < 0.3 ? pick(rng, HATS)[1] : undefined, glasses: rng() < 0.15 });
}

/** Spread n x positions across [-half, half] with at least `gap` meters between them. */
function spread(rng, n, half, gap = 1.3) {
  const xs = [];
  for (let tries = 0; xs.length < n && tries < 400; tries++) {
    const x = (rng() * 2 - 1) * half;
    if (xs.every((o) => Math.abs(o - x) >= gap)) xs.push(Math.round(x * 10) / 10);
  }
  return xs;
}

/**
 * Build contract number `round` (0-based) for a run seeded with `seed`.
 * Difficulty ramps up with the round number.
 */
export function generateLevel(round, seed = 1) {
  const rng = mulberry32((seed * 7919 + round * 104729) >>> 0);
  const tier = Math.min(round, 12);
  const ramp = clamp01(tier / 10);
  // Early contracts use the easier templates; everything is fair game later.
  const pool = round < 2 ? [0, 1] : round < 4 ? [0, 1, 2, 4] : [0, 1, 2, 3, 4];
  const base = LEVELS[pick(rng, pool)];
  const spec = SPEC[base.id];
  const L = structuredClone(base);

  L.id = `endless-${seed}-${round}`;
  L.endless = true;
  L.name = `Contract ${round + 1}: ${base.name}`;
  L.codename = `CONTRACT #${String(round + 1).padStart(3, '0')}`;
  L.difficulty = ['Recruit', 'Easy', 'Medium', 'Hard', 'Expert', 'Elite'][Math.min(5, Math.floor(tier / 2))];
  L.distance = Math.round(lerp(spec.range[0], spec.range[1], clamp01(ramp * 0.75 + rng() * 0.35)) / 10) * 10;
  L.tempF = Math.round(lerp(-5, 105, rng()));
  const windMag = Math.round(rng() * Math.min(18, 2 + tier * 1.4) * 10) / 10;
  L.wind = { base: rng() < 0.5 ? -windMag : windMag, gust: Math.round(rng() * Math.min(3.5, 0.4 + tier * 0.3) * 10) / 10 };
  L.weather = round < 1 ? 'clear' : pick(rng, spec.weather);
  L.rangefinder = L.weather !== 'fog' && L.weather !== 'heat' && rng() > tier * 0.03;
  L.timeLimit = Math.max(35, Math.round(90 - tier * 5 - rng() * 10));
  L.sky = base.id === 'train' ? 'night' : L.weather === 'fog' ? 'fog' : L.weather === 'rain' ? 'overcast' : L.weather === 'snow' ? 'winter' : base.id === 'rooftop' ? pick(rng, ['dusk', 'day']) : 'day';
  L.snow = L.weather === 'snow';
  if (L.snow) L.ground = '#e8eef2';
  else if (base.id === 'market') L.ground = '#8a8478';

  const t = randomTarget(rng);
  const name = pick(rng, NAMES);
  const moving = rng() < Math.min(0.85, tier * 0.12);
  const nCiv = Math.round(lerp(spec.civ[0], spec.civ[1], clamp01(ramp * 0.7 + rng() * 0.4)));
  const useDecoy = tier >= 3 && nCiv > 0 && rng() < 0.6;
  L.target = {
    name,
    description: t.desc + (useDecoy ? ` (A bodyguard wears the same suit with a ${t.decoyTie} tie.)` : ''),
    lines: [pick(rng, LINES), pick(rng, LINES)],
  };

  if (base.id === 'train') {
    const tr = L.train;
    tr.speed = Math.round((3 + rng() * Math.min(4, 1 + tier * 0.35)) * 10) / 10;
    const seats = [];
    for (let c = 0; c < tr.cars; c++) for (let w = 0; w < tr.windowsPerCar; w++) seats.push([c, w]);
    for (let i = seats.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [seats[i], seats[j]] = [seats[j], seats[i]]; }
    L.people = seats.slice(0, nCiv + 1).map(([car, window], i) => ({
      car, window,
      outfit: i === 0 ? t.outfit : i === 1 && useDecoy ? t.decoy : randomCivilian(rng, i),
      isTarget: i === 0,
    }));
    L.intel = `The target is on a moving train circling the valley. Intel: train speed about ${tr.speed} m/s. Call his speed so the sniper leads him, and use "Fire when ready".`;
  } else {
    const viewHalf = (L.viewMils * L.distance) / 1000 / 2;
    const half = Math.min(viewHalf * 0.55, base.id === 'rooftop' ? 11 : 13);
    const xs = spread(rng, nCiv + 1, half);
    const y = base.id === 'rooftop' ? L.roofY : 0;
    L.people = xs.map((x, i) => {
      const p = { x, y, outfit: i === 0 ? t.outfit : i === 1 && useDecoy ? t.decoy : randomCivilian(rng, i), isTarget: i === 0 };
      const walks = i === 0 ? moving : rng() < 0.35 + ramp * 0.3;
      if (walks) {
        const span = 3 + rng() * 5;
        const from = Math.max(-half, Math.min(half - span, x - span / 2));
        p.move = {
          from: Math.round(from * 10) / 10,
          to: Math.round((from + span) * 10) / 10,
          speed: Math.round((0.5 + rng() * (0.4 + ramp * 0.8)) * 10) / 10,
          pause: Math.round((2 + rng() * 3) * 10) / 10,
          phase: Math.round(rng() * 6 * 10) / 10,
        };
      }
      return p;
    });
    // Shuffle draw order so the target isn't always drawn first.
    L.people.sort(() => rng() - 0.5);
    L.intel = [
      nCiv ? `${nCiv} civilian${nCiv > 1 ? 's' : ''} near the target - do not hit them.` : 'The target is alone.',
      moving ? 'He is on the move: fire while he stops, or call his speed.' : 'He is standing still.',
      L.rangefinder ? '' : 'Rangefinder is down: Range (m) = size (m) x 1000 / size (mils). People are about 1.75 m tall.',
      L.tempF < 40 ? 'Cold air adds drop - call the temperature.' : L.tempF > 85 ? 'Hot air means less drop - call the temperature.' : '',
    ].filter(Boolean).join(' ');
  }

  L.scene = `${spec.scene} ${WEATHER_TEXT[L.weather]} Glass up, spotter - Ghost is waiting for your call.`;
  L.tutorial = [
    `Find ${name.split(' ')[0]}: ${t.desc}`,
    L.rangefinder ? 'Read the range, wind and temperature, then give Ghost the full call.' : 'No rangefinder: measure a person (1.75 m) on the mil scale.',
    'Go for the head - anything else and he might survive and run.',
  ];
  return L;
}
