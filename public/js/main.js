import { LEVELS } from './levels.js';
import { generateLevel } from './endless.js';
import { World, describeOutfit, scoreShot, PASS_SCORE, HINT_CAP, WOUNDED_ESCAPE_CAP, FOLLOW_UP_FACTOR } from './world.js';
import { Sniper } from './sniper.js';
import { Renderer, drawPortrait } from './render.js';
import { parseCommands, sanitizeCommands } from './commands.js';
import { VoiceInput } from './voice.js';
import { sfx, Voices } from './audio.js';
import { milsToMeters } from './ballistics.js';

const $ = (id) => document.getElementById(id);
const fmt = (n, d = 1) => (Math.round(n * 10 ** d) / 10 ** d).toFixed(d);

const ENDLESS_LIVES = 3;
const FOLLOW_UP_WINDOW = 8; // seconds to land a follow-up shot on a running target
const BOLT_CYCLE = 1.3; // seconds before Ghost can fire again
const ZOOMS = [1, 1.6, 2.6]; // binocular magnification steps
const NAKED_EYE_FACTOR = 2.4; // the naked eye sees this much wider than the binoculars

const WEATHER_LABEL = {
  clear: 'Clear',
  rain: 'Rain',
  snow: 'Snow',
  fog: 'Fog - laser blocked',
  heat: 'Heat haze - laser blocked',
};

// --- state ------------------------------------------------------------------------------
const game = {
  phase: 'menu', // menu | briefing | live | flight | result | final
  mode: 'endless', // endless (Survival, the default) | campaign (Training drills)
  levelIndex: 0,
  level: null,
  world: null,
  sniper: null,
  t: 0,
  aim: null,
  binoculars: true,
  zoom: 0,
  look: { x: 0, y: 0 },
  flight: null,
  followUp: null, // { first, deadline, readyAt }
  shots: 0,
  hintUsed: false,
  results: [], // campaign score per level this session
  endless: null, // { seed, round, lives, score, log }
  lastBeep: null,
  flash: 0,
  services: { fishTts: false, fishStt: false, llm: false },
  speakingUntil: 0,
  insight: {},
};

const renderer = new Renderer($('view'));
const voices = new Voices();
voices.onSpeakingChange = (on) => { if (!on) game.speakingUntil = performance.now() + 400; };

// --- persistence (best scores; per-browser convenience only) ---------------------------------
function loadBest() {
  try { return JSON.parse(localStorage.getItem('spotter.best') || '{}'); } catch { return {}; }
}
function saveBest(id, score) {
  try {
    const best = loadBest();
    if (!(best[id] >= score)) best[id] = score;
    localStorage.setItem('spotter.best', JSON.stringify(best));
  } catch { /* storage unavailable */ }
}

// --- comms log ------------------------------------------------------------------------------
function log(who, text) {
  const el = document.createElement('div');
  el.className = who;
  const names = { spotter: 'YOU', sniper: 'GHOST', target: 'INTERCEPT', system: '//' };
  el.innerHTML = `<span class="who">${names[who] || who}:</span>`;
  el.appendChild(document.createTextNode(text));
  const box = $('log');
  box.appendChild(el);
  box.scrollTop = box.scrollHeight;
}

function sniperSay(text) {
  if (!text) return;
  log('sniper', text);
  voices.say(text, 'sniper');
}

function targetSay(text) {
  log('target', `"${text}"`);
  voices.say(text, 'target');
}

let bannerTimer = null;
function banner(text, cls = '', ms = 1800) {
  const b = $('banner');
  b.textContent = text;
  b.className = `banner show ${cls}`;
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => { b.className = 'banner'; }, ms);
}

// --- screens ------------------------------------------------------------------------------
const MODALS = ['menuModal', 'howModal', 'briefModal', 'resultModal', 'finalModal'];
function showModal(id) {
  for (const m of MODALS) $(m).classList.toggle('hidden', m !== id);
}

function renderMenu() {
  const best = loadBest();
  const list = $('levelList');
  list.innerHTML = '';
  LEVELS.forEach((L, i) => {
    const b = document.createElement('button');
    b.className = 'level';
    const moving = L.train ? 'moving train' : L.people.some((p) => p.isTarget && p.move) ? 'walking target' : 'stationary';
    b.innerHTML = `<span class="n">T${i + 1}</span><span><b>${L.name}</b><br><span class="meta">${L.distance} m · ${WEATHER_LABEL[L.weather].split(' -')[0].toLowerCase()} · ${moving} · ${L.people.length - 1} civilians · ${L.timeLimit}s</span></span><span class="diff">${L.difficulty}</span><span class="best">${best[L.id] != null ? `${best[L.id]}/100` : ''}</span>`;
    b.onclick = () => { game.mode = 'campaign'; openBriefing(LEVELS[i], i); };
    list.appendChild(b);
  });
  const slot = $('survivalSlot');
  slot.innerHTML = '';
  const e = document.createElement('button');
  e.className = 'level endless';
  e.innerHTML = `<span class="n">∞</span><span><b>Start Survival</b><br><span class="meta">Endless contracts, harder every round · new targets, weather and trains · ${ENDLESS_LIVES} lives · press Enter or say "start mission"</span></span><span class="diff">Main mode</span><span class="best">${best.endless != null ? `best ${best.endless}` : ''}</span>`;
  e.onclick = startEndless;
  slot.appendChild(e);

  const s = game.services;
  $('services').innerHTML = `Sniper voice: ${s.fishTts ? '<b>Fish Audio</b>' : '<b class="off">browser voice</b> (run the server with FISH_API_KEY for Fish Audio)'} · Fish STT: ${s.fishStt ? '<b>ready</b>' : '<b class="off">off</b>'} · AI interpreter: ${s.llm ? '<b>on</b>' : '<b class="off">off</b> (built-in parser)'}`;
  game.phase = 'menu';
  showModal('menuModal');
  $('missionName').textContent = 'Select a mission';
  $('timer').textContent = '--';
  $('livesStat').classList.add('hidden');
}

function startEndless() {
  game.mode = 'endless';
  game.endless = { seed: Math.floor(Math.random() * 1e9), round: 0, variant: 0, lives: ENDLESS_LIVES, score: 0, log: [], passed: false };
  $('totalScore').textContent = 0;
  openContract();
}

/** The current Survival contract. Same round + variant always rebuilds the identical contract. */
function contractLevel() {
  const e = game.endless;
  return generateLevel(e.round, e.seed + e.variant * 7919);
}

function openContract() {
  openBriefing(contractLevel(), game.endless.round);
}

/** Primary result action: retry after a failure, move on after a pass. */
function retryMission() {
  if (game.mode === 'endless') {
    if (game.endless.lives <= 0) return showFinal();
    return openContract();
  }
  openBriefing(game.level, game.levelIndex);
}

/** Survival only: give up on a failed contract and roll a different one at the same difficulty. */
function newContract() {
  const e = game.endless;
  if (e.lives <= 0) return showFinal();
  e.variant++;
  openContract();
}

function openBriefing(L, index) {
  sfx.unlock();
  game.levelIndex = index;
  game.level = L;
  game.world = new World(L, { aspect: renderer.aspect });
  game.sniper = new Sniper(game.world);
  game.t = 0;
  game.flight = null;
  game.followUp = null;
  game.shots = 0;
  game.hintUsed = false;
  game.zoom = 0;
  game.look = { x: 0, y: 0 };
  game.binoculars = true;
  game.aim = null;
  game.aimRaw = null;
  game.lastGoal = null;
  game.lastBeep = null;
  game.insight = {};
  game.phase = 'briefing';
  setPaused(false);
  $('hintBox').classList.add('hidden');

  const endless = game.mode === 'endless';
  $('briefCodename').textContent = L.codename;
  $('briefName').textContent = endless ? L.name : `Training ${index + 1}: ${L.name}`;
  $('briefDiff').textContent = `${L.difficulty} · ${L.rangefinder ? `${L.distance} m` : 'range unknown'} · ${WEATHER_LABEL[L.weather]} · ${L.timeLimit} s`;
  $('briefScene').textContent = L.scene;
  $('briefTarget').textContent = L.target.name;
  $('briefDesc').textContent = L.target.description;
  $('briefIntel').textContent = L.intel;
  $('briefTutorial').innerHTML = L.tutorial.map((s) => `<li>${s}</li>`).join('');
  drawPortrait($('portrait'), game.world.target.outfit);
  drawPortrait($('portraitSmall'), game.world.target.outfit);
  $('dName').textContent = L.target.name;
  $('dDesc').textContent = L.target.description;
  $('missionName').textContent = endless ? `SURVIVAL · ${L.codename} · ${L.difficulty}` : `TRAINING ${index + 1} · ${L.name}`;
  $('timer').textContent = L.timeLimit;
  $('timer').classList.remove('urgent');
  $('livesStat').classList.toggle('hidden', !endless);
  if (endless) $('lives').textContent = '♥'.repeat(game.endless.lives) + '♡'.repeat(ENDLESS_LIVES - game.endless.lives);
  showModal('briefModal');
  updateHud(true);
}

function startMission() {
  if (game.phase !== 'briefing') return;
  sfx.unlock();
  game.phase = 'live';
  game.t = 0;
  showModal(null);
  $('log').innerHTML = '';
  const L = game.level;
  log('system', `${L.codename} - find ${L.target.name}: ${L.target.description}`);
  sniperSay(L.rangefinder ? 'In position. Glass up, tell me what you see.' : 'In position. The laser is useless in this, you will have to range it on the glass.');
  setTimeout(() => game.phase === 'live' && targetSay(L.target.lines[0]), 2600);
  if (voiceInput.mode === 'browser' && !voiceInput.enabled && VoiceInput.browserSupported()) voiceInput.start();
}

// --- commands -----------------------------------------------------------------------------
async function handleUtterance(text, { typed = false } = {}) {
  text = text.trim();
  if (!text) return;
  let cmds = parseCommands(text);
  // Without headphones the mic hears Ghost. While he talks, only urgent orders get through
  // (fire / hold fire); anything else could be his own readback echoing back.
  const echo = !typed && voiceInput.mode === 'browser' && !$('headphones').checked && (voices.speaking || performance.now() < game.speakingUntil);
  if (echo) {
    cmds = cmds.filter((c) => ['fire', 'fireWhenReady', 'cancel'].includes(c.type));
    if (!cmds.length) return;
  }
  log('spotter', text);
  $('transcript').textContent = text;
  $('transcript').classList.remove('interim');
  if (!echo && !cmds.length && game.services.llm && game.phase === 'live' && text.split(/\s+/).length >= 2) {
    try {
      const res = await fetch('/api/sniper', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, solution: game.sniper?.s, labels: game.world?.people.map((p) => p.label) }),
      });
      const data = await res.json();
      cmds = sanitizeCommands(data.commands);
      if (!cmds.length && data.reply) sniperSay(String(data.reply).slice(0, 200));
    } catch (err) {
      console.warn('[sniper llm]', err);
    }
  }
  if (!cmds.length) {
    if (game.phase === 'live') sniperSay('Say again?');
    return;
  }
  execute(cmds);
}

function execute(cmds) {
  const say = [];
  let fire = false;
  for (const c of cmds) {
    if (c.type === 'start') { if (game.phase === 'briefing') startMission(); else if (game.phase === 'menu') startEndless(); continue; }
    if (c.type === 'next') { if (game.phase === 'result') (game.mode === 'endless' && !game.endless.passed ? newContract() : nextMission()); continue; }
    if (c.type === 'retry') { if (game.phase === 'result') retryMission(); continue; }
    if (c.type === 'skip') { if (game.phase === 'result' && game.mode === 'endless' && !game.endless.passed) newContract(); continue; }
    if (c.type === 'pause' || c.type === 'resume') { setPaused(c.type === 'pause'); continue; }
    if (c.type === 'hint') { if (game.phase === 'live') showHint(); continue; }
    if (c.type === 'zoom') { setZoom(game.zoom + (c.dir === 'in' ? 1 : -1)); continue; }
    if (c.type === 'binoculars') { game.binoculars = c.up; continue; }
    if (game.phase !== 'live' || game.paused) continue;
    const r = game.sniper.apply(c, game.t);
    if (r.say) say.push(r.say);
    if (r.fire) fire = true;
  }
  const spoken = say.length >= 3 && !say.some((x) => /\?|don't/.test(x)) ? compactReadback(cmds) : say.join(' ');
  if (fire) {
    if (say.length) log('sniper', spoken);
    fireShot();
  } else if (say.length) {
    sniperSay(spoken);
  }
  updateHud(true);
}

/** One short sentence instead of five, so Ghost is quiet again quickly. */
function compactReadback(cmds) {
  const s = game.sniper.s;
  const has = (t) => cmds.some((c) => c.type === t);
  const bits = [];
  if (has('target') && game.sniper.target) bits.push(`number ${s.targetLabel}, ${describeOutfit(game.sniper.target.outfit)}`);
  if (has('range')) bits.push(`range ${s.range}`);
  if (has('wind')) bits.push(s.wind ? `wind ${fmt(s.wind)} ${s.windDir}` : 'no wind');
  if (has('temp')) bits.push(`temp ${s.tempF}`);
  if (has('speed')) bits.push(s.speed ? `lead ${fmt(s.speed)}` : 'no lead');
  if (has('aim')) bits.push(s.part === 'head' ? 'head' : 'center mass');
  if (has('adjust')) bits.push('corrections in');
  return `Copy. ${bits.join(', ')}.`;
}

function setPaused(on) {
  if (!['live', 'flight'].includes(game.phase)) on = false;
  game.paused = on;
  $('pauseBtn').textContent = on ? 'RESUME' : 'PAUSE';
  $('pausedOverlay').classList.toggle('hidden', !on);
  if (on) { voices.stopAll(); sfx.stopWind(); }
}

function setZoom(z) {
  game.zoom = Math.max(0, Math.min(ZOOMS.length - 1, z));
}

function showHint() {
  const w = game.world;
  const tgt = w.target;
  const wind = w.windAt(game.t);
  const speed = Math.abs(w.personState(tgt, game.t).vx);
  const parts = [`Target ${tgt.label}.`, `Range ${w.distance}.`];
  parts.push(Math.abs(wind) < 0.5 ? 'No wind.' : `Wind ${fmt(Math.abs(wind))} from the ${wind < 0 ? 'right' : 'left'}.`);
  parts.push(`Temperature ${w.level.tempF}.`);
  if (w.level.train || tgt.move || tgt.flee) parts.push(speed > 0.05 ? `Moving at ${fmt(speed)}.` : 'Stationary (fire while he stands still).');
  parts.push('Go for the head.');
  parts.push(w.level.train ? 'Fire when ready.' : 'Send it.');
  game.hintUsed = true;
  $('hintBox').textContent = `Say: "${parts.join(' ')}"  (score capped at ${HINT_CAP})`;
  $('hintBox').classList.remove('hidden');
}

// --- Ghost's running commentary -----------------------------------------------------------------
// He lies next to you and says what he notices: wind shifts, the target starting or stopping.
function sniperInsights() {
  const { world, sniper, insight } = game;
  if (game.phase !== 'live' || voices.speaking) return;
  const t = game.t;
  const s = sniper.s;
  if (s.windDir || s.wind === 0) {
    const called = !s.wind ? 0 : s.windDir === 'right' ? -s.wind : s.wind;
    const now = world.windAt(t);
    const off = Math.abs(now - called) > 2.5;
    if (off && !insight.windWarned && t - (insight.windAt || 0) > 6) {
      insight.windWarned = true;
      insight.windAt = t;
      sniperSay(`Wind's shifted, spotter. Flags say ${Math.abs(now) < 1 ? 'almost calm' : `more like ${Math.round(Math.abs(now))} from the ${now < 0 ? 'right' : 'left'}`}.`);
    }
    if (!off) insight.windWarned = false;
  }
  const tgt = sniper.target;
  if (tgt && tgt.car == null) {
    const moving = Math.abs(world.personState(tgt, t).vx) > 0.05;
    if (insight.moving !== undefined && moving !== insight.moving && t - (insight.moveAt || 0) > 2) {
      insight.moveAt = t;
      sniperSay(moving ? `He's moving${s.speed ? '' : ', no lead dialed'}.` : `He's stopped${s.speed ? ', I still have lead on' : ''}.`);
    }
    insight.moving = moving;
  }
}

// --- shooting -----------------------------------------------------------------------------
function fireShot() {
  if (game.phase !== 'live') return;
  const { world, sniper } = game;
  const tgt = sniper.target;
  if (!tgt) { sniperSay('No target. Give me a number.'); return; }
  if (game.followUp && game.t < game.followUp.readyAt) {
    sniper.s.fireWhenReady = true;
    sniperSay('Chambering. One second.');
    return;
  }
  if (!world.isVisible(tgt, game.t)) { sniperSay("No shot, I can't see him."); return; }
  // Rifle still swinging onto a new target or hold: squeeze off as soon as it settles.
  if (!aimSettled()) { sniper.s.fireAsap = true; return; }
  // A civilian crossing right in front: hold, and fire the moment he is clear.
  const ts = world.personState(tgt, game.t);
  const blocked = world.people.some((p) => p !== tgt && p.car == null && p.fallenAt == null
    && Math.abs(world.personState(p, game.t).x - ts.x) < 0.6 && Math.abs(p.y - tgt.y) < 1);
  if (blocked) {
    if (!sniper.s.waitingClear) sniperSay('Civilian crossing in front. Waiting for a clean line.');
    sniper.s.waitingClear = true;
    sniper.s.fireAsap = true;
    return;
  }
  if (!sniper.s.range && game.shots === 0) log('sniper', 'No range called, holding my 100 meter zero.');
  const aim = game.aim || sniper.aimPoint(game.t);
  const imp = sniper.impact(aim, game.t);
  game.flight = {
    t0: game.t,
    tof: imp.tof,
    x: imp.x,
    y: imp.y,
    windX: imp.windX,
    targetVx: world.personState(world.target, game.t).vx,
    calls: { ...sniper.s },
    designated: tgt,
  };
  game.shots++;
  sniper.s.fireWhenReady = false;
  sniper.s.fireAsap = false;
  sniper.s.waitingClear = false;
  game.phase = 'flight';
  game.flash = 0.55;
  sfx.gunshot();
  voices.say('Sending.', 'sniper');
  log('sniper', 'Sending.');
}

/** True once the rifle has finished swinging onto the commanded aim point. */
function aimSettled() {
  if (!game.aimRaw) return false;
  const goal = game.sniper.aimPoint(game.t); // the current goal, including holds just called
  return Math.hypot(goal.x - game.aimRaw.x, goal.y - game.aimRaw.y) < milsToMeters(0.08, game.world.distance);
}

/** Civilians scatter away from the shot. */
function panic(x) {
  const { world } = game;
  for (const p of world.people) {
    if (p.isTarget || p.car != null || p.fallenAt != null || p.flee) continue;
    const s = world.personState(p, game.t);
    p.flee = { t0: game.t, x: s.x, dir: s.x >= x ? 1 : -1, speed: 2.5 + Math.random() };
    p.move = null;
  }
}

function resolveImpact() {
  const { world, flight } = game;
  const tHit = flight.t0 + flight.tof;
  const hit = world.hitTest(flight.x, flight.y, tHit);
  const result = scoreShot(hit, flight, world, tHit);
  sfx.impact();
  renderer.addEffect(hit.kind === 'person' ? 'blood' : 'dust', flight.x, flight.y, game.t);
  const tgt = world.target;
  // Anything but a headshot might not drop him.
  const killed = result.eliminated && Math.random() < (result.lethal ?? 1);
  if (hit.kind === 'person' && (killed || !hit.person.isTarget)) {
    hit.person.fallenAt = game.t;
    hit.person.fallSide = Math.random() < 0.5 ? -1 : 1;
  }
  panic(flight.x);
  const followUp = game.followUp;

  if (result.casualty) {
    banner('CIVILIAN DOWN', 'bad', 2200);
    sniperSay('Civilian down! That was not our guy.');
    setTimeout(() => targetSay('Sniper! Get me out of here!'), 900);
    return finish({ ...result, score: 0 }, hit);
  }
  if (killed) {
    banner(result.score >= 100 ? 'HEADSHOT' : 'TARGET DOWN', 'good', 2200);
    sniperSay(result.score >= 100 ? 'Headshot. Target down.' : 'Hit. Target is down.');
    const score = followUp ? Math.max(followUp.first.score, Math.round(result.score * FOLLOW_UP_FACTOR)) : result.score;
    return finish({ ...result, score, verdict: followUp ? `Follow-up: ${result.verdict}` : result.verdict }, hit);
  }

  // He is still up. First shot: he runs and you get one follow-up. Second shot: he's gone.
  const wounded = hit.kind === 'person';
  const first = {
    ...result,
    score: wounded ? Math.min(result.score, WOUNDED_ESCAPE_CAP) : 0,
    verdict: wounded && result.eliminated ? `${result.verdict.split(' - ')[0]} - he survived and escaped` : result.verdict,
  };
  if (followUp) {
    banner('TARGET ESCAPED', 'bad', 2200);
    sniperSay(wounded ? "Hit him again, but he's still going. He's gone." : "Missed again. He's gone.");
    return finish({ ...followUp.first, verdict: `${followUp.first.verdict} (follow-up ${wounded ? 'did not drop him' : 'missed'})` }, hit);
  }
  if (tgt.car == null) {
    const s = world.personState(tgt, game.t);
    tgt.flee = { t0: game.t, x: s.x, dir: s.x >= world.level.camera.x ? 1 : -1, speed: wounded ? 1.8 : 2.6 };
    tgt.move = null;
  }
  game.followUp = { first, deadline: game.t + FOLLOW_UP_WINDOW, readyAt: game.t + BOLT_CYCLE };
  const sp = Math.abs(world.personState(tgt, game.t).vx);
  const dir = tgt.flee ? (tgt.flee.dir > 0 ? ' right' : ' left') : '';
  banner(wounded ? "HE'S HIT - STILL MOVING" : 'MISS - TARGET RUNNING', 'bad', 2200);
  sniperSay(wounded
    ? `He's hit but still up! Running${dir}, about ${fmt(sp, 0)} meters a second. Give me a follow-up!`
    : `Miss! He's running${dir}, about ${fmt(sp, 0)} meters a second. Call it!`);
  setTimeout(() => targetSay(wounded ? "I'm hit! Go, go, go!" : 'Sniper! Move!'), 1200);
  game.sniper.s.speed = 0; // the old lead no longer applies
  game.phase = 'live';
}

function finish(result, hit) {
  game.phase = 'result';
  if (game.hintUsed) result.score = Math.min(result.score, HINT_CAP);
  setTimeout(() => showResult(result, hit), 2300);
}

function timeUp(reason) {
  banner('TARGET ESCAPED', 'bad', 2200);
  sniperSay(reason);
  const first = game.followUp?.first;
  finish(first ? { ...first, verdict: `${first.verdict} - no follow-up in time` } : { score: 0, verdict: 'Out of time - the target escaped', eliminated: false, casualty: false }, null);
}

function showResult(result, hit) {
  const L = game.level;
  const { world, flight } = game;
  const passed = result.score >= PASS_SCORE && !result.casualty;
  const endless = game.mode === 'endless';
  if (endless) {
    const e = game.endless;
    e.score += result.score;
    e.log.push({ name: L.name, score: result.score });
    e.passed = passed;
    if (!passed) e.lives--;
    saveBest('endless', e.score); // keep the best even if the run is abandoned from the menu
    $('totalScore').textContent = e.score;
    $('lives').textContent = '♥'.repeat(Math.max(0, e.lives)) + '♡'.repeat(ENDLESS_LIVES - Math.max(0, e.lives));
  } else {
    game.results[game.levelIndex] = Math.max(game.results[game.levelIndex] || 0, result.score);
    saveBest(L.id, result.score);
    $('totalScore').textContent = game.results.reduce((a, b) => a + (b || 0), 0);
  }
  if (passed) sfx.success(); else sfx.fail();

  const sc = $('resScore');
  sc.textContent = result.score;
  sc.className = `score-big ${result.score >= PASS_SCORE ? '' : result.score >= 40 ? 'mid' : 'bad'}`;
  $('resKicker').textContent = passed ? 'MISSION SUCCESS' : endless ? `MISSION FAILED · ${Math.max(0, game.endless.lives)} ${game.endless.lives === 1 ? 'life' : 'lives'} left` : 'MISSION FAILED';
  $('resVerdict').textContent = result.verdict + (game.hintUsed ? ' (hint used)' : '');

  const rows = [];
  let tip = '';
  if (flight) {
    const c = flight.calls;
    const tgt = world.target;
    const windAbs = Math.abs(flight.windX);
    const windDir = flight.windX < 0 ? 'right' : 'left';
    const calledWindX = !c.wind || !c.windDir ? 0 : c.windDir === 'right' ? -c.wind : c.wind;
    const speed = Math.abs(flight.targetVx);
    const tempOk = Math.abs((c.tempF ?? 59) - L.tempF) <= 10;
    const rangeOk = c.range && Math.abs(c.range - L.distance) / L.distance <= 0.04;
    const windOk = Math.abs(calledWindX - flight.windX) <= 1.5;
    const speedOk = Math.abs((c.speed || 0) - speed) <= 0.5;
    const targetOk = flight.designated === tgt;
    const row = (name, called, actual, ok) => rows.push(`<tr><td>${name}</td><td>${called}</td><td>${actual}</td><td class="${ok ? 'ok' : 'bad'}">${ok ? '✔' : '✘'}</td></tr>`);
    row('Target', `#${flight.designated.label}`, `#${tgt.label}`, targetOk);
    row('Range', c.range ? `${c.range} m` : '— (100 m zero)', `${L.distance} m`, rangeOk);
    row('Wind', c.wind ? `${fmt(c.wind)} mph from ${c.windDir}` : 'none', windAbs < 0.5 ? 'calm' : `${fmt(windAbs)} mph from ${windDir}`, windOk);
    row('Temperature', c.tempF != null ? `${c.tempF}°F` : '— (59°F std)', `${L.tempF}°F`, tempOk);
    if (L.train || speed > 0.05 || c.speed) row('Target speed', c.speed ? `${fmt(c.speed)} m/s` : '0', `${fmt(speed)} m/s`, speedOk);
    if (c.adjV || c.adjH) rows.push(`<tr><td>Corrections</td><td colspan="3">${fmt(c.adjV)} mils vertical, ${fmt(c.adjH)} mils horizontal</td></tr>`);
    const ideal = world.aimPoint(flight.designated, flight.t0 + flight.tof, c.part);
    const dx = flight.x - ideal.x;
    const dy = flight.y - ideal.y;
    const desc = `${fmt(Math.abs(dy) * 100, 0)} cm ${dy >= 0 ? 'high' : 'low'}, ${fmt(Math.abs(dx) * 100, 0)} cm ${dx >= 0 ? 'right' : 'left'}`;
    rows.push(`<tr><td>${game.shots > 1 ? 'Last impact' : 'Impact'}</td><td colspan="3">${desc} of the ${c.part} (${fmt(Math.hypot(dx, dy) * 1000 / L.distance, 2)} mils)${hit && hit.kind === 'person' ? ` · hit ${hit.part}` : ''}</td></tr>`);
    rows.push(`<tr><td>Shots</td><td colspan="3">${game.shots}</td></tr>`);

    if (!targetOk) tip = 'Wrong person! Compare every number tag with the dossier (tie color, glasses, hat) before calling the target. Ghost tells you who he is on - listen.';
    else if (!c.range) tip = `You never called the range. The rifle is zeroed at 100 m, so at ${L.distance} m the bullet drops far below the aim point. Say "Range ${L.distance}".`;
    else if (!rangeOk) tip = `Range was off. ${L.rangefinder ? 'Read it from the rangefinder.' : 'Measure on the binocular scale: range = size in meters x 1000 / size in mils (a person is about 1.75 m).'}`;
    else if (!windOk) tip = `Wind call was off: wind from the ${windDir} pushes the bullet to the ${windDir === 'right' ? 'left' : 'right'}. Read the meter just before you fire - it gusts.`;
    else if (!tempOk) tip = `Temperature matters: ${L.tempF < 59 ? 'cold, dense air adds drop' : 'hot, thin air reduces drop'}. Say "Temperature ${L.tempF}".`;
    else if (!speedOk) tip = speed > 0.05 ? `He was moving at ${fmt(speed)} m/s. Call "Moving at ${fmt(speed)}" so Ghost leads him, or wait until he stops.` : 'He had stopped, but you called a lead. Say "Stationary" when he stands still.';
    else if (result.score >= 95) tip = 'Textbook call. Ghost owes you a drink.';
    else if (hit && hit.kind === 'person' && hit.part !== 'head') tip = 'Good call - but only a headshot is a guaranteed kill. Say "go for the head" so he cannot get away.';
    else tip = 'Good call. For the perfect 100 say "go for the head".';
  } else {
    tip = 'Give Ghost the full call faster: target number, range, wind, temperature, then "Send it".';
  }
  $('resTable').innerHTML = rows.length ? `<tr><th></th><th>You called</th><th>Actual</th><th></th></tr>${rows.join('')}` : '';
  $('resTip').textContent = tip;

  // Failed: retry is the default (Enter). Passed: move on.
  const retry = $('retryBtn');
  const next = $('nextBtn');
  const over = endless && game.endless.lives <= 0;
  retry.classList.toggle('hidden', passed || over);
  retry.classList.toggle('primary', !passed);
  next.classList.toggle('primary', passed || over);
  if (endless) {
    retry.textContent = 'RETRY CONTRACT';
    next.textContent = over ? 'SEE FINAL SCORE' : passed ? 'NEXT CONTRACT' : 'NEW CONTRACT';
    $('resSay').innerHTML = over ? '' : passed ? 'say <q>next mission</q>' : 'say <q>retry</q> (same contract) or <q>new contract</q>';
  } else {
    retry.textContent = 'RETRY';
    const last = game.levelIndex >= LEVELS.length - 1;
    next.textContent = last ? 'FINISH TRAINING' : passed ? 'NEXT DRILL' : 'SKIP TO NEXT';
    $('resSay').innerHTML = passed ? 'say <q>next mission</q>' : 'say <q>retry</q> or <q>next mission</q>';
  }
  showModal('resultModal');
}

function nextMission() {
  if (game.mode === 'endless') {
    const e = game.endless;
    if (e.lives <= 0) return showFinal();
    if (!e.passed) return newContract();
    e.round++;
    e.variant = 0;
    return openContract();
  }
  if (game.levelIndex >= LEVELS.length - 1) return showFinal();
  openBriefing(LEVELS[game.levelIndex + 1], game.levelIndex + 1);
}

function showFinal() {
  game.phase = 'final';
  if (game.mode === 'endless') {
    const e = game.endless;
    saveBest('endless', e.score);
    const done = e.log.filter((r) => r.score >= PASS_SCORE).length;
    $('finalKicker').textContent = 'SURVIVAL OVER · OUT OF LIVES';
    $('finalScore').textContent = `${e.score}`;
    const rank = done >= 15 ? 'Legendary Spotter' : done >= 10 ? 'Elite Spotter' : done >= 6 ? 'Marksman' : done >= 3 ? 'Field Agent' : 'Rookie';
    $('finalRank').textContent = `${rank} · ${done} contract${done === 1 ? '' : 's'} completed`;
    $('finalTable').innerHTML = e.log.map((r) => `<tr><td>${r.name}</td><td class="${r.score >= PASS_SCORE ? 'ok' : 'bad'}">${r.score}</td></tr>`).join('');
  } else {
    const total = LEVELS.reduce((a, _, i) => a + (game.results[i] || 0), 0);
    $('finalKicker').textContent = 'TRAINING COMPLETE';
    $('finalScore').textContent = `${total}`;
    const rank = total >= 470 ? 'Legendary Spotter' : total >= 400 ? 'Elite Spotter' : total >= 300 ? 'Marksman' : total >= 150 ? 'Field Agent' : 'Rookie';
    $('finalRank').textContent = `${rank} · ${total} / ${LEVELS.length * 100}`;
    $('finalTable').innerHTML = LEVELS.map((L, i) => `<tr><td>${i + 1}. ${L.name}</td><td>${game.results[i] ?? '—'}</td></tr>`).join('');
  }
  showModal('finalModal');
}

// --- HUD ---------------------------------------------------------------------------------
let hudTick = 0;
function updateHud(force = false) {
  if (!game.world) return;
  hudTick++;
  if (!force && hudTick % 6) return;
  const { world, sniper } = game;
  const L = world.level;
  const D = world.distance;
  const rng = $('dRange');
  if (L.rangefinder) { rng.textContent = `${D} m`; rng.className = ''; }
  else { rng.textContent = 'NO RETURN - estimate'; rng.className = 'offline'; }
  const w = world.windAt(game.t);
  $('dWind').textContent = Math.abs(w) < 0.5 ? 'calm' : `${w < 0 ? '←' : '→'} ${fmt(Math.abs(w))} mph (from ${w < 0 ? 'R' : 'L'})`;
  $('dTemp').textContent = `${L.tempF}°F`;
  $('dWeather').textContent = WEATHER_LABEL[L.weather] || L.weather;
  $('dIntel').textContent = L.intel;

  const s = sniper.s;
  const h = sniper.holds(game.t);
  const v = (val, unsetText) => (val == null || val === '' ? `<span class="unset">${unsetText}</span>` : `<span>${val}</span>`);
  $('solution').innerHTML = [
    '<span>Target</span>', v(s.targetLabel != null ? `#${s.targetLabel}` : null, 'none'),
    '<span>Aim</span>', `<span>${s.part === 'head' ? 'head' : 'center mass'}</span>`,
    '<span>Range</span>', v(s.range ? `${s.range} m` : null, '— (zeroed 100 m)'),
    '<span>Wind</span>', v(s.wind ? `${fmt(s.wind)} mph from ${s.windDir}` : null, 'none'),
    '<span>Temp</span>', v(s.tempF != null ? `${s.tempF}°F` : null, '— (assumes 59°F)'),
    '<span>Lead</span>', v(s.speed || s.lead ? `${fmt(s.speed)} m/s${s.lead ? ` +${fmt(s.lead)} mil` : ''}` : null, 'none'),
    '<span>Corrections</span>', v(s.adjV || s.adjH ? `${fmt(s.adjV)}↕ ${fmt(s.adjH)}↔ mil` : null, 'none'),
    '<span>Hold</span>', `<span class="hold">${h.elevation >= 0 ? '↑' : '↓'} ${fmt(Math.abs(h.elevation))}  ${h.windage >= 0 ? '→' : '←'} ${fmt(Math.abs(h.windage))} mils</span>`,
  ].join('');
  const tag = $('sReady');
  tag.textContent = game.followUp ? 'FOLLOW-UP!' : s.fireWhenReady ? 'FIRE WHEN READY' : s.targetLabel != null ? 'ON TARGET' : '';
  tag.className = `tag ${s.fireWhenReady || game.followUp ? 'armed' : ''}`;
  if (game.phase === 'live') {
    const left = game.followUp ? Math.max(0, game.followUp.deadline - game.t) : Math.max(0, L.timeLimit - game.t);
    $('timer').textContent = Math.ceil(left);
    $('timer').classList.toggle('urgent', left <= 10);
  }
}

// --- main loop ----------------------------------------------------------------------------
const keys = {};
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const { world, sniper } = game;
  if (world) {
    if (['live', 'flight', 'result'].includes(game.phase) && !game.paused) game.t += dt;
    const L = world.level;
    const D = world.distance;

    if (game.phase === 'live') {
      const fu = game.followUp;
      const left = fu ? fu.deadline - game.t : L.timeLimit - game.t;
      if (left <= 0) timeUp(fu ? "He's out of sight. Gone." : "Out of time. He's gone.");
      else if (fu && world.target.flee && !world.isVisible(world.target, game.t)) timeUp("He's out of sight. Gone.");
      else if (left <= 10 && Math.ceil(left) !== game.lastBeep) { game.lastBeep = Math.ceil(left); sfx.beep(left <= 3); }
      if (game.phase === 'live' && Math.floor(game.t * 2) !== Math.floor((game.t - dt) * 2)) sniperInsights();
    }
    if (game.phase !== 'menu') sfx.setWind(world.windAt(game.t));

    // The rifle tracks the commanded aim point, easing out of jumps, with a little breathing sway.
    const goal = sniper.aimPoint(game.t);
    const sway = milsToMeters(0.03, D);
    if (!game.aimRaw) game.aimOffset = { x: 0, y: 0 };
    else game.aimOffset = { x: game.aimRaw.x - (game.lastGoal?.x ?? goal.x), y: game.aimRaw.y - (game.lastGoal?.y ?? goal.y) };
    const decay = Math.exp(-dt * 6);
    game.aimRaw = { x: goal.x + game.aimOffset.x * decay, y: goal.y + game.aimOffset.y * decay };
    game.lastGoal = goal;
    game.aim = { x: game.aimRaw.x + Math.sin(game.t * 1.3) * sway, y: game.aimRaw.y + Math.sin(game.t * 0.9 + 1) * sway };

    if (game.phase === 'live' && (sniper.s.fireWhenReady || sniper.s.fireAsap) && sniper.target) {
      const tgt = sniper.target;
      const ready = !game.followUp || game.t >= game.followUp.readyAt;
      const margin = game.followUp || sniper.s.fireAsap ? 0 : world.viewHalfWidth() * 0.45;
      if (ready && aimSettled() && world.isVisible(tgt, game.t, margin)) fireShot();
    }
    if (game.phase === 'flight' && game.t >= game.flight.t0 + game.flight.tof) resolveImpact();

    // Arrow keys look around through the binoculars.
    const viewW = (L.viewMils * D) / 1000;
    const pan = (viewW * 0.5 * dt) / ZOOMS[game.zoom];
    if (keys.ArrowLeft) game.look.x -= pan;
    if (keys.ArrowRight) game.look.x += pan;
    if (keys.ArrowUp) game.look.y += pan;
    if (keys.ArrowDown) game.look.y -= pan;
    game.look.x = Math.max(-viewW * 0.6, Math.min(viewW * 0.6, game.look.x));
    game.look.y = Math.max(-viewW * 0.3, Math.min(viewW * 0.3, game.look.y));

    const view = game.binoculars
      ? { cx: L.camera.x + game.look.x, cy: L.camera.y + game.look.y, mils: L.viewMils / ZOOMS[game.zoom] }
      // Naked eye: wider, framed so the scene sits above the ridge you're lying on.
      : { cx: L.camera.x, cy: L.camera.y - 2 + 0.2 * renderer.aspect * viewW * NAKED_EYE_FACTOR, mils: L.viewMils * NAKED_EYE_FACTOR };
    game.view = view;
    game.flash = Math.max(0, game.flash - dt * 2);
    renderer.draw(world, {
      t: game.t,
      view,
      binoculars: game.binoculars,
      aim: ['live', 'flight'].includes(game.phase) ? game.aim : null,
      aimLabel: sniper.target ? `GHOST → #${sniper.target.label}` : 'GHOST',
      showScope: ['live', 'flight', 'result'].includes(game.phase),
      flight: game.phase === 'flight' ? game.flight : null,
      flash: game.flash,
      showDistance: L.rangefinder,
    });
    updateHud();
  } else {
    drawIdle();
  }
  requestAnimationFrame(frame);
}

function drawIdle() {
  const c = renderer.ctx;
  c.setTransform(renderer.dpr, 0, 0, renderer.dpr, 0, 0);
  c.fillStyle = '#050805';
  c.fillRect(0, 0, renderer.w, renderer.h);
}

// --- voice input wiring ---------------------------------------------------------------------
const voiceInput = new VoiceInput({
  onFinal: (text) => handleUtterance(text),
  onInterim: (text) => {
    $('transcript').textContent = text;
    $('transcript').classList.add('interim');
  },
  onState: (state, detail) => {
    const btn = $('micBtn');
    btn.classList.toggle('on', state === 'listening');
    btn.classList.toggle('rec', state === 'recording');
    const labels = { listening: 'LISTENING', recording: 'RECORDING', transcribing: 'TRANSCRIBING…', idle: voiceInput.mode === 'fish' ? 'HOLD TO TALK' : 'MIC OFF', error: 'MIC ERROR', unsupported: 'NO SPEECH API' };
    $('micLabel').textContent = labels[state] || state;
    if (detail) { $('transcript').textContent = detail; log('system', detail); }
  },
});

// --- UI events ------------------------------------------------------------------------------
$('voiceMode').onchange = (e) => {
  voiceInput.setMode(e.target.value);
  if (e.target.value === 'fish' && !game.services.fishStt) log('system', 'Fish STT needs the server running with FISH_API_KEY set.');
};
const micBtn = $('micBtn');
micBtn.addEventListener('click', () => { sfx.unlock(); if (voiceInput.mode === 'browser') voiceInput.toggle(); });
micBtn.addEventListener('pointerdown', () => voiceInput.mode === 'fish' && voiceInput.pttDown());
micBtn.addEventListener('pointerup', () => voiceInput.mode === 'fish' && voiceInput.pttUp());
micBtn.addEventListener('pointerleave', () => voiceInput.mode === 'fish' && voiceInput.pttUp());
$('typeForm').addEventListener('submit', (e) => {
  e.preventDefault();
  sfx.unlock();
  const v = $('typeInput').value;
  $('typeInput').value = '';
  $('typeInput').blur(); // give the keyboard shortcuts (B, F, arrows) back
  handleUtterance(v, { typed: true });
});
$('fireBtn').onclick = () => { sfx.unlock(); execute([{ type: 'fire' }]); };
$('binoBtn').onclick = () => { game.binoculars = !game.binoculars; };
$('zoomBtn').onclick = () => setZoom((game.zoom + 1) % ZOOMS.length);
$('pauseBtn').onclick = () => setPaused(!game.paused);
$('hintBtn').onclick = () => game.phase === 'live' && showHint();
$('startBtn').onclick = startMission;
$('retryBtn').onclick = retryMission;
$('nextBtn').onclick = nextMission;
$('finalMenuBtn').onclick = renderMenu;
$('howBtn').onclick = () => { game.howReturn = 'menuModal'; showModal('howModal'); };
$('howBtnTop').onclick = () => {
  if (game.phase === 'live' || game.phase === 'flight') return; // don't cover a live mission
  game.howReturn = MODALS.find((m) => !$(m).classList.contains('hidden')) || 'menuModal';
  showModal('howModal');
};
$('howClose').onclick = () => showModal(game.howReturn || 'menuModal');
$('menuBtn').onclick = () => { setPaused(false); voices.stopAll(); sfx.stopWind(); game.world = null; renderMenu(); };

// Drag to look around through the binoculars, scroll to zoom, double-click to re-center.
const canvas = $('view');
let drag = null;
canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener('pointermove', (e) => {
  if (!drag || !game.world || !game.binoculars || !game.view) return;
  const ppm = renderer.w / ((game.view.mils * game.world.distance) / 1000);
  game.look.x -= (e.clientX - drag.x) / ppm;
  game.look.y += (e.clientY - drag.y) / ppm;
  drag = { x: e.clientX, y: e.clientY };
});
canvas.addEventListener('pointerup', () => { drag = null; });
canvas.addEventListener('wheel', (e) => { e.preventDefault(); setZoom(game.zoom + (e.deltaY < 0 ? 1 : -1)); }, { passive: false });
canvas.addEventListener('dblclick', () => { game.look = { x: 0, y: 0 }; });

window.addEventListener('keydown', (e) => {
  const typing = document.activeElement === $('typeInput');
  if (typing) { if (e.key === 'Escape') $('typeInput').blur(); return; }
  if (e.code === 'Space' && voiceInput.mode === 'fish') { e.preventDefault(); if (!e.repeat) voiceInput.pttDown(); return; }
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) { keys[e.key] = true; e.preventDefault(); }
  if (e.key === 'm' || e.key === 'M') { sfx.unlock(); if (voiceInput.mode === 'browser') voiceInput.toggle(); }
  if (e.key === 'f' || e.key === 'F') execute([{ type: 'fire' }]);
  if (e.key === 'h' || e.key === 'H') game.phase === 'live' && showHint();
  if (e.key === 'b' || e.key === 'B') game.binoculars = !game.binoculars;
  if (e.key === 'z' || e.key === 'Z') setZoom((game.zoom + 1) % ZOOMS.length);
  if (e.key === 'c' || e.key === 'C') game.look = { x: 0, y: 0 };
  if (e.key === 'p' || e.key === 'P') setPaused(!game.paused);
  if (e.key === 'Enter') {
    if (game.phase === 'menu' && !$('menuModal').classList.contains('hidden')) startEndless();
    else if (game.phase === 'briefing') startMission();
    else if (game.phase === 'result' && !$('resultModal').classList.contains('hidden')) {
      const failed = !$('retryBtn').classList.contains('hidden');
      if (failed) retryMission(); else nextMission();
    }
  }
  if (e.key === 'Escape') $('menuBtn').click();
  if (e.key === '/' || e.key === 't') { e.preventDefault(); $('typeInput').focus(); }
});
window.addEventListener('keyup', (e) => {
  keys[e.key] = false;
  if (e.code === 'Space' && voiceInput.mode === 'fish') voiceInput.pttUp();
});
window.addEventListener('resize', () => {
  renderer.resize();
  if (game.world) game.world.aspect = renderer.aspect;
});

// --- boot -----------------------------------------------------------------------------------
async function boot() {
  try {
    const res = await fetch('/api/config');
    if (res.ok && (res.headers.get('content-type') || '').includes('json')) game.services = await res.json();
  } catch { /* opened without the server: browser-only mode */ }
  voices.useFish = !!game.services.fishTts;
  if (!VoiceInput.browserSupported()) {
    if (game.services.fishStt) { $('voiceMode').value = 'fish'; voiceInput.setMode('fish'); }
    log('system', 'This browser has no built-in speech recognition. Use Chrome/Edge, Fish push-to-talk, or type commands.');
  }
  renderMenu();
  requestAnimationFrame(frame);
}
boot();

// Exposed for automated play-testing.
window.__spotter = { game };
