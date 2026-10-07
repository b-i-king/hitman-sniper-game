// Sound effects (synthesized with Web Audio, no files needed) and character voices.
// Voices use Fish Audio TTS through our server when it is configured, and fall back to the
// browser's built-in speechSynthesis otherwise.

let ctx = null;
let windNode = null;

function ac() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function noiseBuffer(seconds = 1) {
  const a = ac();
  const buf = a.createBuffer(1, a.sampleRate * seconds, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

function burst({ dur = 0.3, freq = 1000, q = 0.7, gain = 0.8, type = 'lowpass', delay = 0 }) {
  const a = ac();
  const src = a.createBufferSource();
  src.buffer = noiseBuffer(dur + 0.1);
  const f = a.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = a.createGain();
  const t = a.currentTime + delay;
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f).connect(g).connect(a.destination);
  src.start(t);
  src.stop(t + dur + 0.1);
}

function tone({ freq = 440, dur = 0.1, gain = 0.2, type = 'sine', delay = 0, slideTo = null }) {
  const a = ac();
  const o = a.createOscillator();
  o.type = type;
  const t = a.currentTime + delay;
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  const g = a.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + dur + 0.05);
}

export const sfx = {
  unlock() { ac(); },
  gunshot() {
    burst({ dur: 0.08, freq: 6000, gain: 1, type: 'highpass' });
    burst({ dur: 0.6, freq: 900, gain: 0.9 });
    tone({ freq: 120, slideTo: 40, dur: 0.35, gain: 0.8 });
    burst({ dur: 1.4, freq: 300, gain: 0.25, delay: 0.15 }); // echo across the valley
  },
  impact() { burst({ dur: 0.15, freq: 500, gain: 0.5 }); },
  squelch() { burst({ dur: 0.07, freq: 2500, q: 2, gain: 0.25, type: 'bandpass' }); },
  beep(high = false) { tone({ freq: high ? 1320 : 880, dur: 0.09, gain: 0.12, type: 'square' }); },
  success() { [523, 659, 784, 1046].forEach((f, i) => tone({ freq: f, dur: 0.18, gain: 0.15, type: 'triangle', delay: i * 0.12 })); },
  fail() { [392, 311, 233].forEach((f, i) => tone({ freq: f, dur: 0.3, gain: 0.15, type: 'sawtooth', delay: i * 0.2 })); },
  /** Continuous wind ambience; call setWind(mph) every frame-ish. */
  setWind(mph) {
    const a = ac();
    if (!windNode) {
      const src = a.createBufferSource();
      src.buffer = noiseBuffer(3);
      src.loop = true;
      const f = a.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 400;
      f.Q.value = 0.6;
      const g = a.createGain();
      g.gain.value = 0;
      src.connect(f).connect(g).connect(a.destination);
      src.start();
      windNode = { g, f };
    }
    const v = Math.min(Math.abs(mph), 20) / 20;
    windNode.g.gain.setTargetAtTime(0.02 + v * 0.12, a.currentTime, 0.4);
    windNode.f.frequency.setTargetAtTime(250 + v * 700, a.currentTime, 0.4);
  },
  stopWind() { if (windNode) windNode.g.gain.setTargetAtTime(0, ac().currentTime, 0.2); },
};

// --- character voices ---------------------------------------------------------------

const BROWSER_VOICE = {
  sniper: { pitch: 0.7, rate: 1.08 },
  target: { pitch: 1.15, rate: 0.95 },
  handler: { pitch: 1.0, rate: 1.0 },
};

export class Voices {
  constructor() {
    this.useFish = false;
    this.cache = new Map();
    this.queue = [];
    this.playing = false;
    this.onSpeakingChange = () => {};
    this.muted = false;
  }

  get speaking() {
    return this.playing;
  }

  /** Queue a line. Sniper lines replace any older sniper lines still waiting. */
  say(text, who = 'sniper') {
    if (!text || this.muted) return;
    if (who === 'sniper') this.queue = this.queue.filter((q) => q.who !== 'sniper');
    this.queue.push({ text, who });
    if (this.useFish) this.prefetch(text, who);
    this.pump();
  }

  stopAll() {
    this.queue = [];
    if (this.audio) this.audio.pause();
    if (window.speechSynthesis) speechSynthesis.cancel();
    this.setPlaying(false);
  }

  setPlaying(v) {
    this.playing = v;
    this.onSpeakingChange(v);
  }

  prefetch(text, who) {
    const key = `${who}|${text}`;
    if (!this.cache.has(key)) {
      this.cache.set(key, fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice: who }),
      }).then((r) => (r.ok ? r.blob() : Promise.reject(new Error(`tts ${r.status}`)))).then((b) => URL.createObjectURL(b)));
    }
    return this.cache.get(key);
  }

  async pump() {
    if (this.playing || !this.queue.length) return;
    const { text, who } = this.queue.shift();
    this.setPlaying(true);
    sfx.squelch();
    try {
      if (this.useFish) await this.playFish(text, who);
      else await this.playBrowser(text, who);
    } catch (err) {
      console.warn('[voice] Fish TTS failed, using browser voice:', err.message);
      try { await this.playBrowser(text, who); } catch { /* ignore */ }
    }
    this.setPlaying(false);
    this.pump();
  }

  async playFish(text, who) {
    const url = await this.prefetch(text, who);
    await new Promise((resolve, reject) => {
      this.audio = new Audio(url);
      this.audio.onended = resolve;
      this.audio.onerror = () => reject(new Error('audio playback failed'));
      this.audio.play().catch(reject);
    });
  }

  playBrowser(text, who) {
    return new Promise((resolve) => {
      if (!window.speechSynthesis) return resolve();
      const u = new SpeechSynthesisUtterance(text);
      const cfg = BROWSER_VOICE[who] || BROWSER_VOICE.handler;
      u.pitch = cfg.pitch;
      u.rate = cfg.rate;
      const voices = speechSynthesis.getVoices().filter((v) => v.lang.startsWith('en'));
      if (voices.length) {
        const pick = who === 'target' ? voices.find((v) => /female|zira|samantha|victoria|karen/i.test(v.name)) : voices.find((v) => /male|daniel|alex|david|fred|google uk english male/i.test(v.name));
        u.voice = pick || voices[0];
      }
      u.onend = resolve;
      u.onerror = resolve;
      speechSynthesis.speak(u);
      setTimeout(resolve, 8000); // safety: some browsers never fire onend
    });
  }
}
