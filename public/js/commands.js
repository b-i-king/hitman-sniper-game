// Turns a spotter's spoken sentence (speech-to-text output) into structured commands for
// the sniper. Pure and synchronous so it adds no latency; an optional LLM fallback on the
// server handles sentences this parser can't make sense of.
//
// Command shapes:
//   { type: 'target', id }            "target three", "number 3", "contact 3"
//   { type: 'aim', part }             "go for the head" | "center mass"
//   { type: 'range', value }          "range 600", "six hundred meters"
//   { type: 'wind', value, dir }      "wind 8 from the right" (dir: 'left'|'right'|null = from)
//   { type: 'temp', value }           "temperature 35", "minus 5 degrees"
//   { type: 'speed', value }          "moving at 4", "speed 4", "4 meters per second"
//   { type: 'lead', value }           "lead 2" (mils, in the direction of travel)
//   { type: 'adjust', axis, value }   "up 0.5" (axis 'v'), "left 1" (axis 'h', right = +)
//   { type: 'reset' }                 "reset", "clear holds"
//   { type: 'fireWhenReady' }         "fire when ready", "take the shot when you have it"
//   { type: 'fire' }                  "fire", "send it", "take the shot"
//   { type: 'cancel' }                "hold fire", "abort"
//   { type: 'zoom', dir }             "zoom in" | "zoom out"
//   { type: 'binoculars', up }        "binoculars up" | "lower binoculars"
//   { type: 'status' }                "status", "read back"
//   { type: 'hint' }                  "hint"
//   { type: 'start' } { type: 'next' } { type: 'retry' } { type: 'skip' }  menu navigation
//   { type: 'pause' } { type: 'resume' }

const UNITS = {
  zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, niner: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
// Words speech recognition often produces in place of a digit right after a keyword.
const HOMOPHONES = { won: 1, to: 2, too: 2, for: 4, fore: 4, ate: 8, free: 3, tree: 3, sex: 6 };

const NUM = '(-?\\d+(?:\\.\\d+)?)';
const B = '(?<![\\w.-])'; // left boundary that also works before a minus sign

/** Lowercase, strip punctuation, and convert spelled-out numbers to digits. */
export function normalize(text) {
  let s = ` ${String(text).toLowerCase()} `
    .replace(/(\d),(\d{3})/g, '$1$2') // 1,000 -> 1000
    .replace(/(\d)(mils?|mph|m\/s|km\/h|m)\b/g, '$1 $2')
    .replace(/°\s*f?/g, ' degrees ')
    .replace(/[^a-z0-9.\-\s]/g, ' ')
    .replace(/([a-z])-([a-z])/g, '$1 $2')
    .replace(/\.(?!\d)/g, ' ')
    .replace(/\s+/g, ' ');

  s = s
    .replace(/\bminus (?=\d)/g, '-')
    .replace(/\bhalf a\b/g, '0.5')
    .replace(/\ba half\b/g, '0.5')
    .replace(/\bhalf\b/g, '0.5');

  const tokens = s.trim().split(' ');
  const isNumWord = (w) => w in UNITS || w in TENS;
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    let neg = false;
    let j = i;
    if (tokens[j] === 'minus' && isNumWord(tokens[j + 1])) { neg = true; j++; }
    if (!isNumWord(tokens[j])) { out.push(tokens[i]); continue; }
    // Parse one run of number words: "six hundred fifty", "one point five", "twenty three".
    // "six fifty" yields two numbers (6, 50); the range rule recombines them.
    let current = 0;
    let last = null; // 'unit' | 'tens' | 'hundred'
    let decimals = '';
    for (; j < tokens.length; j++) {
      const w = tokens[j];
      if (w in UNITS) {
        if (last === 'unit') break;
        if (UNITS[w] >= 10 && last === 'tens') break;
        current += UNITS[w];
        last = 'unit';
      } else if (w in TENS) {
        if (last === 'unit' || last === 'tens') break;
        current += TENS[w];
        last = 'tens';
      } else if (w === 'hundred' && (last === 'unit' || last === 'tens')) {
        current *= 100;
        last = 'hundred';
      } else if (w === 'and' && last === 'hundred' && isNumWord(tokens[j + 1])) {
        continue;
      } else if (w === 'point' && tokens[j + 1] in UNITS && UNITS[tokens[j + 1]] < 10) {
        j++;
        while (j < tokens.length && tokens[j] in UNITS && UNITS[tokens[j]] < 10) decimals += String(UNITS[tokens[j++]]);
        break;
      } else {
        break;
      }
    }
    let value = decimals ? parseFloat(`${current}.${decimals}`) : current;
    if (neg) value = -value;
    out.push(String(value));
    i = j - 1;
  }
  return joinRadioDigits(` ${out.join(' ')} `)
    .replace(/(\d) point (\d)/g, '$1.$2')
    .replace(/(\d) (?:and )?0\.5\b/g, (_, d) => `${d}.5`)
    .replace(/(\d)\.5\.5/g, '$1.5');
}

/** Radio-style digits: "range four five zero" -> "range 450", "wind one two" -> "wind 12". */
function joinRadioDigits(s) {
  return s
    .replace(/\b(\d) (\d) (\d)\b/g, '$1$2$3')
    .replace(/\b(range|distance|wind|winds|temperature|temp|speed|at|target|tango|number) (\d) (\d)\b(?! \d)/g, '$1 $2$3');
}

function num(token) {
  if (token == null) return null;
  if (token in HOMOPHONES) return HOMOPHONES[token];
  const n = parseFloat(token);
  return Number.isFinite(n) ? n : null;
}

const NUMTOK = `(${NUM.slice(1, -1)}|won|to|too|for|fore|ate|free|tree)`;

/** Parse a sentence into an ordered list of commands (fire-type commands always last). */
export function parseCommands(text) {
  let s = normalize(text);
  const cmds = [];
  const take = (re, fn) => {
    s = s.replace(re, (...m) => {
      const c = fn(...m);
      if (c) cmds.push(c);
      return ' ';
    });
  };

  // --- menu navigation ------------------------------------------------------
  if (/\b(start|begin|launch|go) (the )?(mission|game|level)\b|\bi'?m ready\b|\blet'?s go\b/.test(s)) cmds.push({ type: 'start' });
  if (/\bnext (mission|level)\b|\bcontinue\b/.test(s)) cmds.push({ type: 'next' });
  if (/\b(retry|try again|restart|again)\b/.test(s)) cmds.push({ type: 'retry' });
  if (/\b(hint|help me|what should i say)\b/.test(s)) cmds.push({ type: 'hint' });
  if (/\b(new|different|another) contract\b|\bskip( it| this| contract| this contract)?\b/.test(s)) cmds.push({ type: 'skip' });
  if (/\b(pause|time out|freeze)( the game)?\b/.test(s)) cmds.push({ type: 'pause' });
  if (/\b(resume|unpause|un pause|continue the game)\b/.test(s)) cmds.push({ type: 'resume' });

  // --- cancel before fire so "hold fire" is not read as "fire" ---------------
  take(/\b(hold fire|cease fire|don'?t (fire|shoot)|do not (fire|shoot)|abort|cancel|stand by|negative)\b/g, () => ({ type: 'cancel' }));

  // --- fire when ready (before plain fire) ------------------------------------
  take(/\b(fire|shoot|send it|take (the|your) shot|engage|take him out)?\s*(when|once|if) (you'?re |you are )?(ready|you have (it|the shot|a shot)|you got (it|the shot)|clear|he'?s clear|it'?s clear)\b|\b(fire|shoot|engage) at will\b|\bcleared hot\b/g,
    () => ({ type: 'fireWhenReady' }));

  // --- environment calls ------------------------------------------------------
  take(new RegExp(`\\b(no wind|wind (is )?(calm|zero|nothing|none)|calm wind|zero wind)\\b`, 'g'), () => ({ type: 'wind', value: 0, dir: null }));
  const WDIR = '(?:(?:coming |blowing )?(?:from )?(?:the )?(?:full value )?(left|right)(?: to (?:the )?(?:left|right))?)';
  const WUNIT = '(?:\\s+(?:mph|miles? per hour|miles? an hour|knots|mile))?';
  take(new RegExp(`\\bwinds?\\s+(?:is\\s+|at\\s+|of\\s+|about\\s+|call\\s+)*${NUMTOK}${WUNIT}(?:\\s+${WDIR})?`, 'g'),
    (m, a, dir) => ({ type: 'wind', value: Math.abs(num(a)), dir: dir || null }));
  take(new RegExp(`\\bwinds?\\s+(?:is\\s+)?${WDIR}\\s+(?:at\\s+)?${NUMTOK}${WUNIT}`, 'g'),
    (m, dir, a) => ({ type: 'wind', value: Math.abs(num(a)), dir }));

  take(new RegExp(`\\b(?:range|distance|ranged at|range is)\\s+(?:is\\s+|of\\s+|at\\s+)?${NUMTOK}(?:\\s+(\\d{2}))?(?:\\s+(?:meters?|metres?|m))?\\b`, 'g'),
    (m, a, b) => {
      let v = num(a);
      if (b && v < 10) v = v * 100 + parseInt(b, 10); // "range six fifty" -> 650
      else if (v != null && v < 20) v *= 100; // "range 6" (hundred) -> 600
      return v != null ? { type: 'range', value: v } : null;
    });
  take(new RegExp(`${B}${NUM}\\s+(?:meters|metres|meter|metre)\\b(?!\\s+per)`, 'g'), (m, a) => {
    const v = num(a);
    return v >= 50 ? { type: 'range', value: v } : null;
  });

  take(new RegExp(`\\b(?:temperature|temp|temps)\\s+(?:is\\s+|of\\s+|at\\s+)?${NUM}(?:\\s+degrees?)?(?:\\s+(?:fahrenheit|f))?\\b`, 'g'), (m, a) => ({ type: 'temp', value: num(a) }));
  take(new RegExp(`${B}${NUM}\\s+degrees?\\b(?:\\s+(?:fahrenheit|f))?`, 'g'), (m, a) => ({ type: 'temp', value: num(a) }));

  take(new RegExp(`\\b(?:moving|speed|traveling|travelling|going|walking|running)\\b(?:\\s+(?:left|right|to the left|to the right|at|about|around|is|of))*\\s+${NUMTOK}(?:\\s+(?:meters? per second|metres? per second|m\\/s|mps))?`, 'g'),
    (m, a) => ({ type: 'speed', value: num(a) }));
  take(new RegExp(`${B}${NUM}\\s+(?:meters? per second|metres? per second|m\\/s|mps)\\b`, 'g'), (m, a) => ({ type: 'speed', value: num(a) }));
  take(/\b(?:stationary|not moving|stopped|standing still|he'?s still)\b/g, () => ({ type: 'speed', value: 0 }));

  take(new RegExp(`\\blead(?:\\s+(?:him|her|it|by|of|left|right))*\\s+${NUMTOK}(?:\\s+mils?)?`, 'g'), (m, a) => ({ type: 'lead', value: num(a) }));

  // --- target designation -----------------------------------------------------
  take(new RegExp(`\\b(?:target|targets|number|person|contact|subject|tango|guy|man|woman|passenger|individual|hostile)\\s+(?:is\\s+)?(?:number\\s+)?${NUMTOK}\\b`, 'g'),
    (m, a) => {
      const v = num(a);
      return v != null && v >= 0 && v < 100 ? { type: 'target', id: Math.round(v) } : null;
    });

  // --- aim point ----------------------------------------------------------------
  take(/\b(head ?shot|headshot|the head|his head|her head|aim (for )?(the )?head|go for head|head)\b/g, () => ({ type: 'aim', part: 'head' }));
  take(/\b(center mass|centre mass|centre of mass|center of mass|chest|body shot|the body|torso|heart)\b/g, () => ({ type: 'aim', part: 'chest' }));

  // --- holds / corrections --------------------------------------------------------
  take(/\b(reset|clear) (the )?(holds?|adjustments?|corrections?|solution|everything)\b|\breset\b/g, () => ({ type: 'reset' }));
  take(new RegExp(`\\b(?:come |hold |adjust |go |move |dial |aim )?(up|down|left|right|high|low)\\s+(?:by\\s+)?${NUMTOK}(?:\\s+mils?)?`, 'g'), (m, dir, a) => {
    const v = num(a);
    if (v == null) return null;
    const axis = ['up', 'down', 'high', 'low'].includes(dir) ? 'v' : 'h';
    const sign = ['down', 'left', 'low'].includes(dir) ? -1 : 1;
    return { type: 'adjust', axis, value: sign * Math.abs(v) };
  });

  // --- binoculars ------------------------------------------------------------------
  take(/\b(?:(?:lower|drop|put down|take down)(?: the| my)? (?:binoculars?|binos?|glass)|(?:binoculars?|binos?|glass) down|naked eye)\b/g, () => ({ type: 'binoculars', up: false }));
  take(/\b(?:(?:raise|lift|pick up|grab)(?: the| my)? (?:binoculars?|binos?|glass)|(?:binoculars?|binos?|glass) up)\b/g, () => ({ type: 'binoculars', up: true }));

  // --- optics / status ------------------------------------------------------------
  take(/\bzoom (in|out)\b/g, (m, d) => ({ type: 'zoom', dir: d }));
  take(/\b(status|read ?back|say again|what'?s your (solution|status)|repeat( that)?)\b/g, () => ({ type: 'status' }));

  // --- fire -----------------------------------------------------------------------
  if (/\b(fire|fired|firing|shoot|send it|sent it|take (the|your|him|her) (shot|out)|take him out|take her out|execute|green ?light|engage|drop him|drop her|pull the trigger|light him up|smoke him|now now|go go)\b/.test(s)
    || /^\s*(now|go)\s*$/.test(s)) {
    cmds.push({ type: 'fire' });
  }

  // Fire-type commands always run last so "fire, range 600" still dials the range first.
  const order = (c) => (c.type === 'fire' || c.type === 'fireWhenReady' ? 1 : 0);
  return cmds.map((c, i) => [c, i]).sort((a, b) => order(a[0]) - order(b[0]) || a[1] - b[1]).map(([c]) => c);
}

export const KNOWN_TYPES = new Set([
  'target', 'aim', 'range', 'wind', 'temp', 'speed', 'lead', 'adjust', 'reset', 'fireWhenReady',
  'fire', 'cancel', 'zoom', 'binoculars', 'status', 'hint', 'start', 'next', 'retry', 'skip', 'pause', 'resume',
]);

/** Validate commands coming back from the (untrusted) LLM fallback. */
export function sanitizeCommands(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const c of list) {
    if (!c || !KNOWN_TYPES.has(c.type)) continue;
    const n = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : parseFloat(v));
    switch (c.type) {
      case 'target': if (Number.isFinite(n(c.id))) out.push({ type: 'target', id: Math.round(n(c.id)) }); break;
      case 'aim': out.push({ type: 'aim', part: c.part === 'head' ? 'head' : 'chest' }); break;
      case 'wind': if (Number.isFinite(n(c.value))) out.push({ type: 'wind', value: Math.abs(n(c.value)), dir: c.dir === 'left' || c.dir === 'right' ? c.dir : null }); break;
      case 'adjust': if (Number.isFinite(n(c.value))) out.push({ type: 'adjust', axis: c.axis === 'h' ? 'h' : 'v', value: n(c.value) }); break;
      case 'zoom': out.push({ type: 'zoom', dir: c.dir === 'out' ? 'out' : 'in' }); break;
      case 'binoculars': out.push({ type: 'binoculars', up: c.up !== false }); break;
      case 'range': case 'temp': case 'speed': case 'lead':
        if (Number.isFinite(n(c.value))) out.push({ type: c.type, value: n(c.value) });
        break;
      default: out.push({ type: c.type });
    }
  }
  const order = (c) => (c.type === 'fire' || c.type === 'fireWhenReady' ? 1 : 0);
  return out.sort((a, b) => order(a) - order(b));
}
