// Spotter: One Shot - tiny zero-dependency server (Node 20+).
//
//   - serves the game from ./public
//   - POST /api/tts     { text, voice: 'sniper'|'target' }  -> mp3 from Fish Audio TTS
//   - POST /api/stt     raw audio body (webm/ogg/wav)       -> { text } from Fish Audio STT
//   - POST /api/sniper  { text, solution, labels }           -> { commands, reply } from an
//                       OpenAI-compatible LLM (optional fallback for free-form sentences)
//   - GET  /api/config  -> which of the above are configured
//
// The Fish API key stays on this server; the browser never sees it.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(ROOT, 'public');

// --- .env loader (no dependency) ------------------------------------------------------------
const envFile = join(ROOT, '.env');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

const env = (k, d = '') => process.env[k] || d;
const FISH_API_KEY = env('FISH_API_KEY');
const FISH_TTS_MODEL = env('FISH_TTS_MODEL', 's2.1-pro');
const FISH_STT_MODEL = env('FISH_STT_MODEL', 'transcribe-1');
const VOICES = { sniper: env('FISH_SNIPER_VOICE_ID'), target: env('FISH_TARGET_VOICE_ID') };
const LLM_API_KEY = env('LLM_API_KEY');
const LLM_BASE_URL = env('LLM_BASE_URL', 'https://api.openai.com/v1').replace(/\/$/, '');
const LLM_MODEL = env('LLM_MODEL', 'gpt-4o-mini');
const PORT = Number(env('PORT', '3000'));

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.ico': 'image/x-icon',
};

function sendJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

async function readBody(req, limit = 10 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw Object.assign(new Error('body too large'), { status: 413 });
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

// --- Fish Audio -----------------------------------------------------------------------------
async function tts(req, res) {
  if (!FISH_API_KEY) return sendJson(res, 503, { error: 'FISH_API_KEY not set' });
  const { text, voice } = JSON.parse((await readBody(req, 64 * 1024)).toString() || '{}');
  if (!text || typeof text !== 'string') return sendJson(res, 400, { error: 'text required' });
  const body = { text: text.slice(0, 500), format: 'mp3', latency: 'low', prosody: { speed: voice === 'sniper' ? 1.1 : 1 } };
  const ref = VOICES[voice];
  if (ref) body.reference_id = ref;
  const r = await fetch('https://api.fish.audio/v1/tts', {
    method: 'POST',
    headers: { Authorization: `Bearer ${FISH_API_KEY}`, 'Content-Type': 'application/json', model: FISH_TTS_MODEL },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const msg = await r.text();
    console.warn(`[tts] ${r.status} ${msg.slice(0, 200)}`);
    return sendJson(res, 502, { error: `Fish TTS ${r.status}` });
  }
  res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' });
  for await (const chunk of r.body) res.write(chunk);
  res.end();
}

async function stt(req, res) {
  if (!FISH_API_KEY) return sendJson(res, 503, { error: 'FISH_API_KEY not set' });
  const audio = await readBody(req);
  const type = req.headers['content-type'] || 'audio/webm';
  const form = new FormData();
  form.append('audio', new Blob([audio], { type }), `clip.${type.includes('ogg') ? 'ogg' : type.includes('wav') ? 'wav' : 'webm'}`);
  form.append('language', 'en');
  form.append('ignore_timestamps', 'true');
  const r = await fetch('https://api.fish.audio/v1/asr', {
    method: 'POST',
    headers: { Authorization: `Bearer ${FISH_API_KEY}`, model: FISH_STT_MODEL },
    body: form,
    signal: AbortSignal.timeout(30_000),
  });
  if (!r.ok) {
    const msg = await r.text();
    console.warn(`[stt] ${r.status} ${msg.slice(0, 200)}`);
    return sendJson(res, 502, { error: `Fish STT ${r.status}` });
  }
  const data = await r.json();
  console.log(`[stt] "${data.text}"`);
  sendJson(res, 200, { text: (data.text || '').trim() });
}

// --- optional LLM interpreter ---------------------------------------------------------------
const SNIPER_PROMPT = `You are the AI sniper in a voice-controlled sniper game. The human is your spotter.
Convert the spotter's sentence into JSON commands for the game. Reply with ONLY a JSON object:
{"commands": [...], "reply": "short in-character radio reply (max 12 words)"}
Allowed commands:
{"type":"target","id":<person number>}
{"type":"aim","part":"head"|"chest"}
{"type":"range","value":<meters>}
{"type":"wind","value":<mph>,"dir":"left"|"right"}   (dir = side the wind comes FROM)
{"type":"temp","value":<fahrenheit>}
{"type":"speed","value":<target speed m/s>}
{"type":"lead","value":<mils>}
{"type":"adjust","axis":"v"|"h","value":<mils, up/right positive>}
{"type":"reset"} {"type":"fire"} {"type":"fireWhenReady"} {"type":"cancel"} {"type":"status"}
If the sentence contains no game instruction, return an empty commands list and a brief reply.`;

async function sniper(req, res) {
  if (!LLM_API_KEY) return sendJson(res, 503, { error: 'LLM not configured' });
  const { text, solution, labels } = JSON.parse((await readBody(req, 64 * 1024)).toString() || '{}');
  const r = await fetch(`${LLM_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${LLM_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: LLM_MODEL,
      temperature: 0,
      max_tokens: 300,
      messages: [
        { role: 'system', content: SNIPER_PROMPT },
        { role: 'user', content: `Visible person numbers: ${JSON.stringify(labels || [])}. Current solution: ${JSON.stringify(solution || {})}.\nSpotter says: "${String(text).slice(0, 500)}"` },
      ],
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) return sendJson(res, 502, { error: `LLM ${r.status}` });
  const data = await r.json();
  const content = data.choices?.[0]?.message?.content || '{}';
  const json = content.match(/\{[\s\S]*\}/);
  try {
    const parsed = JSON.parse(json ? json[0] : '{}');
    sendJson(res, 200, { commands: parsed.commands || [], reply: parsed.reply || '' });
  } catch {
    sendJson(res, 200, { commands: [], reply: '' });
  }
}

// --- static files -----------------------------------------------------------------------------
async function serveStatic(req, res) {
  const url = new URL(req.url, 'http://x');
  let path = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
  if (path.includes('..')) return sendJson(res, 400, { error: 'bad path' });
  let file = join(PUBLIC, path || 'index.html');
  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
}

const routes = {
  'GET /api/config': (req, res) => sendJson(res, 200, { fishTts: !!FISH_API_KEY, fishStt: !!FISH_API_KEY, llm: !!LLM_API_KEY }),
  'POST /api/tts': tts,
  'POST /api/stt': stt,
  'POST /api/sniper': sniper,
};

createServer(async (req, res) => {
  const route = routes[`${req.method} ${req.url.split('?')[0]}`];
  try {
    if (route) await route(req, res);
    else if (req.method === 'GET') await serveStatic(req, res);
    else sendJson(res, 404, { error: 'not found' });
  } catch (err) {
    console.error(`[server] ${req.method} ${req.url}:`, err.message);
    if (!res.headersSent) sendJson(res, err.status || 500, { error: err.message });
    else res.end();
  }
}).listen(PORT, () => {
  console.log(`\n  🎯 Spotter: One Shot  ->  http://localhost:${PORT}\n`);
  console.log(`  Fish Audio TTS/STT: ${FISH_API_KEY ? 'ON' : 'off (set FISH_API_KEY in .env; browser voices are used instead)'}`);
  console.log(`  LLM interpreter:    ${LLM_API_KEY ? `ON (${LLM_MODEL})` : 'off (built-in command parser only)'}\n`);
});
