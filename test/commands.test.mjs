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

test('nothing Ghost says is read as an order to shoot', async () => {
  // Without headphones the mic can hear Ghost, so none of his lines may parse as "fire"
  // (or "stand by"/"abort", which would cancel a pending shot). Scan every line in the source,
  // both as written and as spoken on the radio.
  const { readFileSync } = await import('node:fs');
  const { radioSpeech } = await import('../public/js/audio.js');
  const src = ['public/js/main.js', 'public/js/sniper.js'].map((f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')).join('\n')
    .replace(/function showHint[\s\S]*?\n}\n/, '') // the hint is what the *spotter* should say
    .replace(/function showResult[\s\S]*?\n}\n/, '') // debrief tips are on screen, never spoken
    .replace(/function coachTip[\s\S]*?\n}\n/, ''); // coach tips are on screen, never spoken
  const lines = [...src.matchAll(/(?:sniperSay|voices\.say|say:|\? |: )\s*\(?\s*(['"`])((?:(?!\1).)*)\1/g)]
    .map((m) => m[2].replace(/\$\{[^}]*\}/g, '3'))
    .filter((l) => /[A-Za-z]{3}/.test(l) && /[.!?]$/.test(l));
  assert.ok(lines.length > 25, `found ${lines.length} lines`);
  for (const l of lines) {
    for (const said of [l, radioSpeech(l)]) {
      const types = parseCommands(said).map((c) => c.type);
      assert.ok(!types.some((t) => ['fire', 'fireWhenReady', 'cancel'].includes(t)), `"${said}" -> ${types}`);
    }
  }
});

test('nothing the target says is read as an order', async () => {
  const { LEVELS } = await import('../public/js/levels.js');
  const { generateLevel } = await import('../public/js/endless.js');
  const lines = new Set(["I'm hit! Get me out of here!", 'Sniper! Move!', 'Sniper! Get me out of here!']);
  for (const L of LEVELS) L.target.lines.forEach((l) => lines.add(l));
  for (let r = 0; r < 40; r++) generateLevel(r, 3).target.lines.forEach((l) => lines.add(l));
  for (const l of lines) {
    const types = parseCommands(l).map((c) => c.type);
    assert.ok(!types.some((t) => ['fire', 'fireWhenReady', 'cancel'].includes(t)), `"${l}" -> ${types}`);
  }
});

test('radio procedure: digits and niner', async () => {
  const { radioSpeech } = await import('../public/js/audio.js');
  assert.equal(radioSpeech('Range 450, roger.'), 'Range four five zero, roger.');
  assert.equal(radioSpeech('Lead 2.5'), 'Lead 2 point five');
  assert.equal(radioSpeech('Tango 9'), 'Tango niner');
  assert.deepEqual(parseCommands('tango three range four five zero'), [{ type: 'range', value: 450 }, { type: 'target', id: 3 }]);
  assert.deepEqual(parseCommands('range niner zero zero'), [{ type: 'range', value: 900 }]);
});

test('everyday and dialect phrasings', () => {
  const p = (t) => parseCommands(t);
  assert.deepEqual(p('move right'), [{ type: 'adjust', axis: 'h', value: 0.5 }]);
  assert.deepEqual(p('move down a little'), [{ type: 'adjust', axis: 'v', value: -0.2 }]);
  assert.deepEqual(p('a little higher'), [{ type: 'adjust', axis: 'v', value: 0.2 }]);
  assert.deepEqual(p('way more left'), [{ type: 'adjust', axis: 'h', value: -1 }]);
  assert.deepEqual(p('two clicks left'), [{ type: 'adjust', axis: 'h', value: -0.2 }]);
  assert.deepEqual(p('right 3 clicks'), [{ type: 'adjust', axis: 'h', value: 0.3 }]);
  assert.deepEqual(p('bump it up'), [{ type: 'adjust', axis: 'v', value: 0.5 }]);
  assert.deepEqual(p('lower the binoculars'), [{ type: 'binoculars', up: false }]);
  assert.deepEqual(p("don't fire"), [{ type: 'cancel' }]);
  assert.deepEqual(p('wait'), [{ type: 'cancel' }]);
  assert.deepEqual(p('take it'), [{ type: 'fire' }]);
  assert.deepEqual(p('take it when ready'), [{ type: 'fireWhenReady' }]);
  assert.deepEqual(p('drop the hammer'), [{ type: 'fire' }]);
  assert.deepEqual(p('range 500 yards'), [{ type: 'range', value: 460 }]);
  assert.deepEqual(p('temperature 10 celsius'), [{ type: 'temp', value: 50 }]);
  assert.deepEqual(p('moving at 9 mph'), [{ type: 'speed', value: 4 }]);
  assert.deepEqual(p('train doing 14 km/h'), [{ type: 'speed', value: 3.9 }]);
  assert.deepEqual(p('aim for his face'), [{ type: 'aim', part: 'head' }]);
  assert.deepEqual(p('hvt is number 4'), [{ type: 'target', id: 4 }]);
});
