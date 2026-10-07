import { LEVELS } from './levels.js';
import { World, scoreShot, PASS_SCORE, HINT_CAP } from './world.js';
import { Sniper } from './sniper.js';
import { Renderer, drawPortrait } from './render.js';
import { parseCommands, sanitizeCommands } from './commands.js';
import { VoiceInput } from './voice.js';
import { sfx, Voices } from './audio.js';
import { milsToMeters } from './ballistics.js';

const $ = (id) => document.getElementById(id);
const fmt = (n, d = 1) => (Math.round(n * 10 ** d) / 10 ** d).toFixed(d);

// --- state ------------------------------------------------------------------------------
const game = {
  phase: 'menu', // menu | briefing | live | flight | result | final
  levelIndex: 0,
  world: null,
  sniper: null,
  t: 0,
  aim: null,
  zoom: false,
  flight: null,
  hintUsed: false,
  results: [], // score per level this session
  lastBeep: null,
  flash: 0,
  services: { fishTts: false, fishStt: false, llm: false },
  speakingUntil: 0,
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
  const names = { spotter: 'YOU', sniper: 'SNIPER', target: 'INTERCEPT', system: '//' };
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
function showModal(id) {
  for (const m of ['menuModal', 'briefModal', 'resultModal', 'finalModal']) $(m).classList.toggle('hidden', m !== id);
}

function renderMenu() {
  const best = loadBest();
  const list = $('levelList');
  list.innerHTML = '';
  LEVELS.forEach((L, i) => {
    const b = document.createElement('button');
    b.className = 'level';
    const moving = L.train ? 'moving train' : L.people.some((p) => p.isTarget && p.move) ? 'walking target' : 'stationary';
    b.innerHTML = `<span class="n">${i + 1}</span><span><b>${L.name}</b><br><span class="meta">${L.distance} m · ${moving} · ${L.people.length - 1} civilians · ${L.timeLimit}s</span></span><span class="diff">${L.difficulty}</span><span class="best">${best[L.id] != null ? `${best[L.id]}/100` : ''}</span>`;
    b.onclick = () => openBriefing(i);
    list.appendChild(b);
  });
  const s = game.services;
  $('services').innerHTML = `Sniper voice: ${s.fishTts ? '<b>Fish Audio</b>' : '<b class="off">browser voice</b> (set FISH_API_KEY for Fish Audio)'} · Fish STT: ${s.fishStt ? '<b>ready</b>' : '<b class="off">off</b>'} · AI interpreter: ${s.llm ? '<b>on</b>' : '<b class="off">off</b> (built-in parser)'}`;
  game.phase = 'menu';
  showModal('menuModal');
  $('missionName').textContent = 'Select a mission';
  $('timer').textContent = '--';
}

function openBriefing(i) {
  sfx.unlock();
  game.levelIndex = i;
  const L = LEVELS[i];
  game.world = new World(L, { aspect: renderer.aspect });
  game.sniper = new Sniper(game.world);
  game.t = 0;
  game.flight = null;
  game.hintUsed = false;
  game.zoom = false;
  game.aim = null;
  game.aimRaw = null;
  game.lastGoal = null;
  game.lastBeep = null;
  game.phase = 'briefing';
  $('hintBox').classList.add('hidden');

  $('briefCodename').textContent = L.codename;
  $('briefName').textContent = `Mission ${i + 1}: ${L.name}`;
  $('briefDiff').textContent = `${L.difficulty} · ${L.distance} m · ${L.timeLimit} s`;
  $('briefTarget').textContent = L.target.name;
  $('briefDesc').textContent = L.target.description;
  $('briefIntel').textContent = L.intel;
  $('briefTutorial').innerHTML = L.tutorial.map((s) => `<li>${s}</li>`).join('');
  drawPortrait($('portrait'), game.world.target.outfit);
  drawPortrait($('portraitSmall'), game.world.target.outfit);
  $('dName').textContent = L.target.name;
  $('dDesc').textContent = L.target.description;
  $('missionName').textContent = `${i + 1}. ${L.name} · ${L.difficulty}`;
  $('timer').textContent = L.timeLimit;
  $('timer').classList.remove('urgent');
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
  const L = LEVELS[game.levelIndex];
  log('system', `${L.codename} - find ${L.target.name}: ${L.target.description}`);
  sniperSay('Sniper in position. Waiting on your call.');
  setTimeout(() => game.phase === 'live' && targetSay(L.target.lines[0]), 2200);
  if (voiceInput.mode === 'browser' && !voiceInput.enabled && VoiceInput.browserSupported()) voiceInput.start();
}

// --- commands -----------------------------------------------------------------------------
async function handleUtterance(text, { typed = false } = {}) {
  text = text.trim();
  if (!text) return;
  // Without headphones the mic hears the sniper; ignore what arrives while he talks.
  if (!typed && voiceInput.mode === 'browser' && !$('headphones').checked && (voices.speaking || performance.now() < game.speakingUntil)) return;
  log('spotter', text);
  $('transcript').textContent = text;
  $('transcript').classList.remove('interim');
  let cmds = parseCommands(text);
  if (!cmds.length && game.services.llm && game.phase === 'live' && text.split(/\s+/).length >= 2) {
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
    if (c.type === 'start') { if (game.phase === 'briefing') startMission(); else if (game.phase === 'menu') openBriefing(game.levelIndex); continue; }
    if (c.type === 'next') { if (game.phase === 'result') nextMission(); continue; }
    if (c.type === 'retry') { if (game.phase === 'result') openBriefing(game.levelIndex); continue; }
    if (c.type === 'hint') { if (game.phase === 'live') showHint(); continue; }
    if (c.type === 'zoom') { game.zoom = c.dir === 'in'; continue; }
    if (game.phase !== 'live') continue;
    const r = game.sniper.apply(c, game.t);
    if (r.say) say.push(r.say);
    if (r.fire) fire = true;
  }
  if (fire) {
    if (say.length) log('sniper', say.join(' '));
    fireShot();
  } else if (say.length) {
    sniperSay(say.join(' '));
  }
  updateHud(true);
}

function showHint() {
  const w = game.world;
  const tgt = w.target;
  const wind = w.windAt(game.t);
  const speed = Math.abs(w.personState(tgt, game.t).vx);
  const parts = [`Target ${tgt.label}.`, `Range ${w.distance}.`];
  parts.push(Math.abs(wind) < 0.5 ? 'No wind.' : `Wind ${fmt(Math.abs(wind))} from the ${wind < 0 ? 'right' : 'left'}.`);
  parts.push(`Temperature ${w.level.tempF}.`);
  if (w.level.train || tgt.move) parts.push(speed > 0.05 ? `Moving at ${fmt(speed)}.` : 'Stationary (fire while he stands still).');
  parts.push(w.level.train ? 'Fire when ready.' : 'Send it.');
  game.hintUsed = true;
  $('hintBox').textContent = `Say: "${parts.join(' ')}"  (score capped at ${HINT_CAP})`;
  $('hintBox').classList.remove('hidden');
}

// --- shooting -----------------------------------------------------------------------------
function fireShot() {
  if (game.phase !== 'live') return;
  const { world, sniper } = game;
  const tgt = sniper.target;
  if (!tgt) { sniperSay('No target. Give me a number.'); return; }
  if (!world.isVisible(tgt, game.t)) { sniperSay("No shot, I can't see him."); return; }
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
  sniper.s.fireWhenReady = false;
  game.phase = 'flight';
  game.flash = 0.55;
  sfx.gunshot();
  voices.say('Sending.', 'sniper');
  log('sniper', 'Sending.');
}

function resolveImpact() {
  const { world, flight } = game;
  const tHit = flight.t0 + flight.tof;
  const hit = world.hitTest(flight.x, flight.y, tHit);
  const result = scoreShot(hit, flight, world, tHit);
  if (game.hintUsed) result.score = Math.min(result.score, HINT_CAP);
  sfx.impact();
  renderer.addEffect(hit.kind === 'person' ? 'blood' : 'dust', flight.x, flight.y, game.t);
  const tgt = world.target;
  if (hit.kind === 'person' && (result.eliminated || result.casualty)) {
    hit.person.fallenAt = game.t;
    hit.person.fallSide = Math.random() < 0.5 ? -1 : 1;
  }
  if (!result.eliminated && tgt.car == null) {
    const s = world.personState(tgt, game.t);
    tgt.flee = { t0: game.t, x: s.x, dir: s.x >= world.level.camera.x ? 1 : -1 };
    tgt.move = null;
  }
  if (result.casualty) {
    banner('CIVILIAN DOWN', 'bad', 2200);
    sniperSay('Civilian down! That was not our guy.');
    setTimeout(() => targetSay('Sniper! Get me out of here!'), 900);
  } else if (result.eliminated) {
    banner(result.score >= 100 ? 'HEADSHOT' : 'TARGET DOWN', 'good', 2200);
    sniperSay(result.score >= 100 ? 'Headshot. Target down.' : 'Hit. Target is down.');
  } else if (hit.kind === 'person') {
    banner('WOUNDED', 'bad', 2200);
    sniperSay(`Hit ${hit.part === 'arm' ? 'in the arm' : 'in the leg'}. He's running.`);
    setTimeout(() => targetSay("I'm hit! Go, go, go!"), 900);
  } else {
    banner('MISS', 'bad', 2200);
    sniperSay(hit.kind === 'train' ? 'Hit the train. Miss.' : 'Miss. Target is running.');
    setTimeout(() => targetSay('Sniper! Move!'), 900);
  }
  game.phase = 'result';
  setTimeout(() => showResult(result, hit), 2300);
}

function timeUp() {
  game.phase = 'result';
  banner('TARGET ESCAPED', 'bad', 2200);
  sniperSay("Out of time. He's gone.");
  setTimeout(() => showResult({ score: 0, verdict: 'Out of time - the target escaped', eliminated: false, casualty: false }, null), 1800);
}

function showResult(result, hit) {
  const L = LEVELS[game.levelIndex];
  const { world, flight } = game;
  game.results[game.levelIndex] = Math.max(game.results[game.levelIndex] || 0, result.score);
  saveBest(L.id, result.score);
  $('totalScore').textContent = game.results.reduce((a, b) => a + (b || 0), 0);
  const passed = result.score >= PASS_SCORE && !result.casualty;
  if (passed) sfx.success(); else sfx.fail();

  const sc = $('resScore');
  sc.textContent = result.score;
  sc.className = `score-big ${result.score >= PASS_SCORE ? '' : result.score >= 40 ? 'mid' : 'bad'}`;
  $('resKicker').textContent = passed ? 'MISSION SUCCESS' : 'MISSION FAILED';
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
    if (L.train || L.people.some((p) => p.isTarget && p.move)) row('Target speed', c.speed ? `${fmt(c.speed)} m/s` : '0', `${fmt(speed)} m/s`, speedOk);
    if (c.adjV || c.adjH) rows.push(`<tr><td>Corrections</td><td colspan="3">${fmt(c.adjV)} mils vertical, ${fmt(c.adjH)} mils horizontal</td></tr>`);
    // Where it landed relative to the intended aim point (target's chest/head at impact time).
    const ideal = world.aimPoint(flight.designated, flight.t0 + flight.tof, c.part);
    const dx = flight.x - ideal.x;
    const dy = flight.y - ideal.y;
    const desc = `${fmt(Math.abs(dy) * 100, 0)} cm ${dy >= 0 ? 'high' : 'low'}, ${fmt(Math.abs(dx) * 100, 0)} cm ${dx >= 0 ? 'right' : 'left'}`;
    rows.push(`<tr><td>Impact</td><td colspan="3">${desc} of the ${c.part} (${fmt(Math.hypot(dx, dy) * 1000 / L.distance, 2)} mils)${hit && hit.kind === 'person' ? ` · hit ${hit.part}` : ''}</td></tr>`);

    if (!targetOk) tip = 'Wrong person! Compare every number tag with the dossier (tie color, sunglasses) before calling the target.';
    else if (!c.range) tip = `You never called the range. The rifle is zeroed at 100 m, so at ${L.distance} m the bullet drops far below the aim point. Say "Range ${L.distance}".`;
    else if (!rangeOk) tip = `Range was off. ${L.rangefinder ? 'Read it from the rangefinder.' : 'Use the grid: range = size in meters x 1000 / size in mils.'}`;
    else if (!windOk) tip = `Wind call was off: wind from the ${windDir} pushes the bullet to the ${windDir === 'right' ? 'left' : 'right'}. Read the meter just before you fire - it gusts.`;
    else if (!tempOk) tip = `Temperature matters: ${L.tempF < 59 ? 'cold, dense air adds drop' : 'hot, thin air reduces drop'}. Say "Temperature ${L.tempF}".`;
    else if (!speedOk) tip = speed > 0.05 ? `He was moving at ${fmt(speed)} m/s. Call "Moving at ${fmt(speed)}" so the sniper leads him, or wait until he stops.` : 'He had stopped, but you called a lead. Say "Stationary" when he stands still.';
    else if (result.score >= 95) tip = 'Textbook call. The sniper owes you a drink.';
    else tip = 'Good call. For the perfect 100 say "go for the head".';
  } else {
    tip = 'Give the sniper the full call faster: target number, range, wind, then "Send it".';
  }
  $('resTable').innerHTML = rows.length ? `<tr><th></th><th>You called</th><th>Actual</th><th></th></tr>${rows.join('')}` : '';
  $('resTip').textContent = tip;
  const last = game.levelIndex >= LEVELS.length - 1;
  $('nextBtn').textContent = last ? 'FINISH CAMPAIGN' : passed ? 'NEXT MISSION' : 'SKIP TO NEXT';
  showModal('resultModal');
}

function nextMission() {
  if (game.levelIndex >= LEVELS.length - 1) return showFinal();
  openBriefing(game.levelIndex + 1);
}

function showFinal() {
  game.phase = 'final';
  const total = LEVELS.reduce((a, _, i) => a + (game.results[i] || 0), 0);
  $('finalScore').textContent = `${total}`;
  const rank = total >= 470 ? 'Legendary Spotter' : total >= 400 ? 'Elite Spotter' : total >= 300 ? 'Marksman' : total >= 150 ? 'Field Agent' : 'Rookie';
  $('finalRank').textContent = `${rank} · ${total} / ${LEVELS.length * 100}`;
  $('finalTable').innerHTML = LEVELS.map((L, i) => `<tr><td>${i + 1}. ${L.name}</td><td>${game.results[i] ?? '—'}</td></tr>`).join('');
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
  else { rng.textContent = 'OFFLINE - estimate'; rng.className = 'offline'; }
  const w = world.windAt(game.t);
  $('dWind').textContent = Math.abs(w) < 0.5 ? 'calm' : `${w < 0 ? '←' : '→'} ${fmt(Math.abs(w))} mph (from ${w < 0 ? 'R' : 'L'})`;
  $('dTemp').textContent = `${L.tempF}°F`;
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
  tag.textContent = s.fireWhenReady ? 'FIRE WHEN READY' : s.targetLabel != null ? 'ON TARGET' : '';
  tag.className = `tag ${s.fireWhenReady ? 'armed' : ''}`;
  if (game.phase === 'live') {
    const left = Math.max(0, L.timeLimit - game.t);
    $('timer').textContent = Math.ceil(left);
    $('timer').classList.toggle('urgent', left <= 10);
  }
}

// --- main loop ----------------------------------------------------------------------------
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const { world, sniper } = game;
  if (world) {
    if (['live', 'flight', 'result'].includes(game.phase)) game.t += dt;
    const L = world.level;
    const D = world.distance;

    if (game.phase === 'live') {
      const left = L.timeLimit - game.t;
      if (left <= 0) timeUp();
      else if (left <= 10 && Math.ceil(left) !== game.lastBeep) { game.lastBeep = Math.ceil(left); sfx.beep(left <= 3); }
    }
    if (game.phase !== 'menu') sfx.setWind(world.windAt(game.t));

    // The rifle swings smoothly onto the commanded aim point, with a little breathing sway.
    const goal = sniper.aimPoint(game.t);
    // Track the goal exactly, but ease out of any jump (new target or new hold).
    const sway = milsToMeters(0.03, D);
    if (!game.aimRaw) game.aimOffset = { x: 0, y: 0 };
    else game.aimOffset = { x: game.aimRaw.x - (game.lastGoal?.x ?? goal.x), y: game.aimRaw.y - (game.lastGoal?.y ?? goal.y) };
    const decay = Math.exp(-dt * 6);
    game.aimRaw = { x: goal.x + game.aimOffset.x * decay, y: goal.y + game.aimOffset.y * decay };
    game.lastGoal = goal;
    game.aim = { x: game.aimRaw.x + Math.sin(game.t * 1.3) * sway, y: game.aimRaw.y + Math.sin(game.t * 0.9 + 1) * sway };

    if (game.phase === 'live' && sniper.s.fireWhenReady && sniper.target) {
      const tgt = sniper.target;
      const settled = Math.hypot(goal.x - game.aimRaw.x, goal.y - game.aimRaw.y) < milsToMeters(0.08, D);
      if (settled && world.isVisible(tgt, game.t, world.viewHalfWidth() * 0.45)) fireShot();
    }
    if (game.phase === 'flight' && game.t >= game.flight.t0 + game.flight.tof) resolveImpact();

    // Camera: wide spotter view, or zoomed on the designated target.
    let view = { cx: L.camera.x, cy: L.camera.y, mils: L.viewMils };
    if (game.zoom) {
      const tgt = sniper.target;
      const p = tgt ? world.aimPoint(tgt, game.t, 'chest') : game.aim;
      view = { cx: p.x, cy: p.y, mils: L.viewMils / 2.5 };
    }
    game.flash = Math.max(0, game.flash - dt * 2);
    renderer.draw(world, {
      t: game.t,
      view,
      aim: ['live', 'flight'].includes(game.phase) ? game.aim : null,
      aimLabel: sniper.target ? `SNIPER → #${sniper.target.label}` : 'SNIPER',
      showScope: ['live', 'flight', 'result'].includes(game.phase),
      labels: true,
      flight: game.phase === 'flight' ? game.flight : null,
      flash: game.flash,
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
  handleUtterance(v, { typed: true });
});
$('fireBtn').onclick = () => { sfx.unlock(); execute([{ type: 'fire' }]); };
$('hintBtn').onclick = () => game.phase === 'live' && showHint();
$('startBtn').onclick = startMission;
$('retryBtn').onclick = () => openBriefing(game.levelIndex);
$('nextBtn').onclick = nextMission;
$('finalMenuBtn').onclick = renderMenu;
$('menuBtn').onclick = () => { voices.stopAll(); sfx.stopWind(); game.world = null; renderMenu(); };

window.addEventListener('keydown', (e) => {
  const typing = document.activeElement === $('typeInput');
  if (typing) { if (e.key === 'Escape') $('typeInput').blur(); return; }
  if (e.code === 'Space' && voiceInput.mode === 'fish') { e.preventDefault(); if (!e.repeat) voiceInput.pttDown(); return; }
  if (e.key === 'm' || e.key === 'M') { sfx.unlock(); if (voiceInput.mode === 'browser') voiceInput.toggle(); }
  if (e.key === 'f' || e.key === 'F') execute([{ type: 'fire' }]);
  if (e.key === 'h' || e.key === 'H') game.phase === 'live' && showHint();
  if (e.key === 'z' || e.key === 'Z') game.zoom = !game.zoom;
  if (e.key === 'Enter') {
    if (game.phase === 'briefing') startMission();
    else if (game.phase === 'result' && !$('resultModal').classList.contains('hidden')) nextMission();
  }
  if (e.key === 'Escape') $('menuBtn').click();
  if (e.key === '/' || e.key === 't') { e.preventDefault(); $('typeInput').focus(); }
});
window.addEventListener('keyup', (e) => {
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
    if (res.ok) game.services = await res.json();
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
