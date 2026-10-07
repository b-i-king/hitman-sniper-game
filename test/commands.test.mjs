import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCommands, sanitizeCommands } from '../public/js/commands.js';

const cases = [
  ['Target three, range six hundred, wind eight from the right. Send it.', [
    { type: 'wind', value: 8, dir: 'right' }, { type: 'range', value: 600 }, { type: 'target', id: 3 }, { type: 'fire' }]],
  ['range six fifty', [{ type: 'range', value: 650 }]],
  ['come up one point five', [{ type: 'adjust', axis: 'v', value: 1.5 }]],
  ['left 0.3 mils', [{ type: 'adjust', axis: 'h', value: -0.3 }]],
  ['wind 10mph left to right temperature 35 degrees', [{ type: 'wind', value: 10, dir: 'left' }, { type: 'temp', value: 35 }]],
  ['temperature minus five', [{ type: 'temp', value: -5 }]],
  ['hold fire', [{ type: 'cancel' }]],
  ['fire when ready', [{ type: 'fireWhenReady' }]],
  ['Fire! Range 300', [{ type: 'range', value: 300 }, { type: 'fire' }]],
  ['moving at four', [{ type: 'speed', value: 4 }]],
  ['go for the head', [{ type: 'aim', part: 'head' }]],
  ['number for', [{ type: 'target', id: 4 }]],
  ['wind is calm', [{ type: 'wind', value: 0, dir: null }]],
  ['up two and a half', [{ type: 'adjust', axis: 'v', value: 2.5 }]],
  ['start mission', [{ type: 'start' }]],
];

for (const [text, expected] of cases) {
  test(`parses: ${text}`, () => assert.deepEqual(parseCommands(text), expected));
}

test('sanitizeCommands drops unknown or malformed commands and orders fire last', () => {
  const out = sanitizeCommands([{ type: 'fire' }, { type: 'rm -rf' }, { type: 'range', value: '600' }, { type: 'target', id: 'x' }]);
  assert.deepEqual(out, [{ type: 'range', value: 600 }, { type: 'fire' }]);
});

test('binocular commands', () => {
  assert.deepEqual(parseCommands('lower the binoculars'), [{ type: 'binoculars', up: false }]);
  assert.deepEqual(parseCommands('binoculars up'), [{ type: 'binoculars', up: true }]);
});

test('result and pause commands', () => {
  assert.deepEqual(parseCommands('new contract'), [{ type: 'skip' }]);
  assert.deepEqual(parseCommands('pause'), [{ type: 'pause' }]);
  assert.deepEqual(parseCommands('resume'), [{ type: 'resume' }]);
});

test("nothing Ghost says is read as an order to shoot", async () => {
  // Without headphones the mic can hear Ghost; his lines must never parse as "fire".
  const lines = ['Holding.', 'Chambering. One second.', 'Civilian crossing in front. Waiting for a clean line.',
    "Copy. I'll take it when it's clear.", 'Sending.', 'In position. Glass up, tell me what you see.',
    "No shot, I can't see him.", 'Hit. Target is down.', 'Miss! He\'s running left, about 3 meters a second. Call it!'];
  for (const l of lines) {
    const types = parseCommands(l).map((c) => c.type);
    assert.ok(!types.includes('fire') && !types.includes('fireWhenReady'), `${l} -> ${types}`);
  }
});
