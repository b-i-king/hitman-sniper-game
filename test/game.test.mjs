import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS } from '../public/js/levels.js';
import { World, scoreShot, mulberry32 } from '../public/js/world.js';
import { Sniper } from '../public/js/sniper.js';
import { firingSolution, timeOfFlight } from '../public/js/ballistics.js';

/** Fire with a perfect call (true range, wind, temp, speed) at the first moment the target is visible. */
function perfectShot(level, { part = 'chest', calls = true } = {}) {
  const world = new World(level, { rng: mulberry32(7) });
  const sniper = new Sniper(world);
  let t = 0;
  while (!world.isVisible(world.target, t, 3) && t < 60) t += 0.05;
  // Prefer a moment the target walks (exercises the lead), but any visible moment works.
  sniper.apply({ type: 'target', id: world.target.label }, t);
  sniper.apply({ type: 'aim', part }, t);
  if (calls) {
    const w = world.windAt(t);
    sniper.apply({ type: 'range', value: level.distance }, t);
    sniper.apply({ type: 'temp', value: level.tempF }, t);
    if (Math.abs(w) > 0) sniper.apply({ type: 'wind', value: Math.abs(w), dir: w < 0 ? 'right' : 'left' }, t);
    sniper.apply({ type: 'speed', value: Math.abs(world.personState(world.target, t).vx) }, t);
  }
  const aim = sniper.aimPoint(t);
  const imp = sniper.impact(aim, t);
  const tHit = t + imp.tof;
  const hit = world.hitTest(imp.x, imp.y, tHit);
  return { world, hit, result: scoreShot(hit, imp, world, tHit) };
}

for (const level of LEVELS) {
  test(`${level.id}: a perfect call eliminates the target`, () => {
    const { hit, result } = perfectShot(level);
    assert.equal(hit.kind, 'person');
    assert.ok(hit.person.isTarget, 'hit the target');
    assert.ok(result.score >= 90, `score ${result.score} (${hit.part})`);
  });
  test(`${level.id}: perfect headshot call scores 100`, () => {
    const { result } = perfectShot(level, { part: 'head' });
    assert.equal(result.score, 100);
  });
}

test('field: forgetting the range drops the shot low (no kill)', () => {
  const { result } = perfectShot(LEVELS[0], { calls: false });
  assert.ok(result.score < 70, `score ${result.score}`);
});

test('colder air means more drop', () => {
  const cold = firingSolution({ range: 600, tempF: 10 }).elevation;
  const warm = firingSolution({ range: 600, tempF: 95 }).elevation;
  assert.ok(cold > warm);
});

test('wind from the right needs a hold to the right', () => {
  assert.ok(firingSolution({ range: 500, windXMph: -10 }).windage > 0);
});

test('time of flight grows with range', () => {
  assert.ok(timeOfFlight(800) > timeOfFlight(300));
});

test('hitting a civilian is a casualty with zero score', () => {
  const level = LEVELS[1];
  const world = new World(level, { rng: mulberry32(1) });
  const civ = world.people.find((p) => !p.isTarget);
  const pt = world.aimPoint(civ, 0, 'chest');
  const hit = world.hitTest(pt.x, pt.y, 0);
  const r = scoreShot(hit, pt, world, 0);
  assert.equal(r.casualty, true);
  assert.equal(r.score, 0);
});

test('train body blocks shots between windows', () => {
  const level = LEVELS.find((l) => l.train);
  const world = new World(level, { rng: mulberry32(1) });
  const rects = world.trainRects(0);
  const car = rects[1];
  const w0 = car.windows[0];
  const w1 = car.windows[1];
  const hit = world.hitTest((w0.x0 + w1.x1) / 2, (w0.y0 + w0.y1) / 2, 0);
  assert.equal(hit.kind, 'train');
});
