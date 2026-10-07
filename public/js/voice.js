// Voice input for the spotter.
//   'browser' : Web Speech API (Chrome/Edge). Always listening, lowest latency.
//   'fish'    : push-to-talk. Records while you hold the button/space bar, then sends the
//               clip to our server, which transcribes it with Fish Audio speech-to-text.

const FIRE_RE = /\b(fire|send it|shoot|take the shot|execute|green ?light)\b/i;

export class VoiceInput {
  /**
   * handlers: { onFinal(text), onInterim(text), onState(state, detail) }
   * state: 'idle' | 'listening' | 'recording' | 'transcribing' | 'error' | 'unsupported'
   */
  constructor(handlers) {
    this.h = handlers;
    this.mode = 'browser';
    this.enabled = false;
    this.rec = null;
    this.handled = new Set();
  }

  static browserSupported() {
    return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  }

  setMode(mode) {
    const wasOn = this.enabled;
    this.stop();
    this.mode = mode;
    if (wasOn && mode === 'browser') this.start();
    else this.h.onState('idle');
  }

  // --- browser speech recognition (continuous) -------------------------------------
  start() {
    if (this.mode !== 'browser') return;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      this.h.onState('unsupported', 'Browser speech recognition needs Chrome or Edge. Use Fish push-to-talk or type commands.');
      return;
    }
    this.enabled = true;
    const rec = new SR();
    rec.lang = 'en-US';
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.onstart = () => this.h.onState('listening');
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        this.enabled = false;
        this.h.onState('error', 'Microphone permission denied.');
      } else if (e.error !== 'no-speech' && e.error !== 'aborted') {
        this.h.onState('error', `Speech error: ${e.error}`);
      }
    };
    rec.onend = () => {
      // Chrome stops after silence; keep it going while enabled.
      if (this.enabled && this.rec === rec) setTimeout(() => this.enabled && this.rec === rec && this.safeStart(rec), 150);
      else this.h.onState('idle');
    };
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const text = r[0].transcript;
        const key = `${this.session}:${i}`;
        if (this.handled.has(key)) continue;
        if (r.isFinal) {
          this.handled.add(key);
          this.h.onFinal(text);
        } else {
          this.h.onInterim(text);
          // Don't wait for the sentence to finish when the spotter says "fire":
          // timing matters on moving targets.
          if (FIRE_RE.test(text)) {
            this.handled.add(key);
            this.h.onFinal(text);
          }
        }
      }
    };
    this.rec = rec;
    this.session = (this.session || 0) + 1;
    this.safeStart(rec);
  }

  safeStart(rec) {
    try { rec.start(); } catch { /* already started */ }
  }

  stop() {
    this.enabled = false;
    if (this.rec) {
      const r = this.rec;
      this.rec = null;
      try { r.abort(); } catch { /* ignore */ }
    }
    this.h.onState('idle');
  }

  toggle() {
    if (this.enabled) this.stop();
    else this.start();
  }

  // --- Fish Audio push-to-talk --------------------------------------------------------
  /**
   * Push-to-talk. Browser mode: listen only while the key/button is held (does nothing if the
   * mic is already always on). Fish mode: record a clip and transcribe it on release.
   */
  async pttDown() {
    if (this.mode === 'browser') {
      if (this.enabled) return;
      this.ptt = true;
      this.start();
      return;
    }
    if (this.mode !== 'fish' || this.recorder) return;
    try {
      this.stream = this.stream || (await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }));
    } catch {
      this.h.onState('error', 'Microphone permission denied.');
      return;
    }
    const chunks = [];
    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : '';
    const recorder = new MediaRecorder(this.stream, mime ? { mimeType: mime } : undefined);
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.onstop = async () => {
      this.recorder = null;
      const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
      if (blob.size < 2000) { this.h.onState('idle'); return; }
      this.h.onState('transcribing');
      try {
        const res = await fetch('/api/stt', { method: 'POST', headers: { 'Content-Type': blob.type }, body: blob });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || res.statusText);
        this.h.onState('idle');
        if (data.text) this.h.onFinal(data.text);
      } catch (err) {
        this.h.onState('error', `Fish STT failed: ${err.message}`);
      }
    };
    recorder.start();
    this.recorder = recorder;
    this.h.onState('recording');
  }

  pttUp() {
    if (this.mode === 'browser') {
      if (!this.ptt) return;
      this.ptt = false;
      this.enabled = false;
      const rec = this.rec;
      this.rec = null;
      try { rec?.stop(); } catch { /* ignore */ } // stop(), not abort(): deliver what was said
      return;
    }
    if (this.recorder && this.recorder.state === 'recording') this.recorder.stop();
  }
}
