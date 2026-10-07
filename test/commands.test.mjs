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
