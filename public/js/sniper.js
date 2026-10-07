// The AI sniper: keeps the firing solution the spotter has called, dials holds, tracks the
// designated target, and works out where the bullet really lands (true physics vs. the
// values the spotter called).

import { describeOutfit } from './world.js';
import { firingSolution, impactOffsetY, windDriftMeters, timeOfFlight, milsToMeters, STD_TEMP_F } from './ballistics.js';

const fmt = (n) => (Math.round(n * 10) / 10).toString();

export function defaultSolution() {
  return { targetLabel: null, part: 'chest', range: null, wind: 0, windDir: null, tempF: null, speed: 0, lead: 0, adjV: 0, adjH: 0, fireWhenReady: false, fireAsap: false };
}

export class Sniper {
  constructor(world) {
    this.world = world;
    this.s = defaultSolution();
  }

  get target() {
    return this.s.targetLabel != null ? this.world.byLabel(this.s.targetLabel) : null;
  }

  /** Signed crosswind (mph, + = blowing right) the spotter called. */
  calledWindX() {
    if (!this.s.wind || !this.s.windDir) return 0;
    return this.s.windDir === 'right' ? -this.s.wind : this.s.wind; // "from the right" blows left
  }

  /** Holds in mils (positive = up / right) for the target's current motion. */
  holds(t) {
    const s = this.s;
    const sol = firingSolution({ range: s.range, tempF: s.tempF ?? STD_TEMP_F, windXMph: this.calledWindX(), speed: s.speed });
    const tgt = this.target;
    const vx = tgt ? this.world.personState(tgt, t).vx : 0;
    const dir = Math.sign(vx);
    const lead = dir * (sol.lead + s.lead);
    return { elevation: sol.elevation + s.adjV, windage: sol.windage + lead + s.adjH, lead, tof: sol.tof };
  }

  /** Where the crosshair sits (world meters) at time t. */
  aimPoint(t) {
    const tgt = this.target;
    const D = this.world.distance;
    const base = tgt ? this.world.aimPoint(tgt, t, this.s.part) : { x: this.world.level.camera.x, y: this.world.level.camera.y };
    if (!tgt) return { x: base.x, y: base.y };
    const h = this.holds(t);
    return { x: base.x + milsToMeters(h.windage, D), y: base.y + milsToMeters(h.elevation, D) };
  }

  /**
   * True ballistic result of a shot fired at time t0 with the crosshair at `aim`.
   * Returns the impact point and the time it arrives.
   */
  impact(aim, t0) {
    const w = this.world;
    const D = w.distance;
    const T = w.level.tempF;
    const windX = w.windAt(t0);
    return {
      x: aim.x + windDriftMeters(D, T, windX),
      y: aim.y + impactOffsetY(D, T),
      tof: timeOfFlight(D, T),
      windX,
    };
  }

  /**
   * Apply one spotter command. Returns a short spoken readback (or null) and flags.
   */
  apply(cmd, t) {
    const s = this.s;
    switch (cmd.type) {
      case 'target': {
        const p = this.world.byLabel(cmd.id);
        if (!p) return { say: `I don't see a number ${cmd.id}.` };
        s.targetLabel = cmd.id;
        // Describe what he sees so the spotter can double-check the ID.
        const seen = describeOutfit(p.outfit);
        return { say: `Number ${cmd.id}, I'm on him. ${seen[0].toUpperCase()}${seen.slice(1)}.` };
      }
      case 'aim':
        s.part = cmd.part;
        return { say: cmd.part === 'head' ? 'Going for the head.' : 'Center mass.' };
      case 'range':
        if (cmd.value < 20 || cmd.value > 2500) return { say: `Range ${cmd.value}? Say again.` };
        s.range = cmd.value;
        return { say: `Range ${cmd.value}.` };
      case 'wind':
        if (cmd.value > 0 && !cmd.dir) return { say: `Wind ${fmt(cmd.value)}, from which side? Left or right?` };
        s.wind = cmd.value;
        s.windDir = cmd.dir;
        return { say: cmd.value === 0 ? 'No wind.' : `Wind ${fmt(cmd.value)}, from the ${cmd.dir}.` };
      case 'temp':
        s.tempF = cmd.value;
        return { say: `Temp ${cmd.value}.` };
      case 'speed':
        s.speed = Math.abs(cmd.value);
        return { say: s.speed === 0 ? 'No lead.' : `Leading at ${fmt(s.speed)}.` };
      case 'lead':
        s.lead = Math.abs(cmd.value);
        return { say: `Extra lead ${fmt(s.lead)} mils.` };
      case 'adjust': {
        if (cmd.axis === 'v') s.adjV += cmd.value;
        else s.adjH += cmd.value;
        const d = cmd.axis === 'v' ? (cmd.value > 0 ? 'up' : 'down') : cmd.value > 0 ? 'right' : 'left';
        return { say: `${fmt(Math.abs(cmd.value))} ${d}.` };
      }
      case 'reset':
        s.adjV = 0; s.adjH = 0; s.lead = 0;
        return { say: 'Corrections cleared.' };
      case 'cancel':
        s.fireWhenReady = false;
        s.fireAsap = false;
        s.waitingClear = false;
        return { say: 'Holding.', cancel: true }; // never say 'fire': the mic may hear it
      case 'fireWhenReady':
        if (s.targetLabel == null) return { say: 'No target designated. Give me a number.' };
        s.fireWhenReady = true;
        return { say: "Copy. I'll take it when it's clear." };
      case 'fire':
        return { fire: true };
      case 'status':
        return { say: this.readback(t) };
      default:
        return {};
    }
  }

  readback(t) {
    const s = this.s;
    if (s.targetLabel == null) return 'No target yet. Give me a number.';
    const h = this.holds(t);
    const parts = [`Target ${s.targetLabel}`];
    parts.push(s.range ? `range ${s.range}` : 'no range');
    if (s.wind) parts.push(`wind ${fmt(s.wind)} ${s.windDir}`);
    if (s.tempF != null) parts.push(`temp ${s.tempF}`);
    if (s.speed) parts.push(`lead at ${fmt(s.speed)}`);
    const v = `${fmt(Math.abs(h.elevation))} ${h.elevation >= 0 ? 'up' : 'down'}`;
    const w = Math.abs(h.windage) < 0.05 ? '' : `, ${fmt(Math.abs(h.windage))} ${h.windage > 0 ? 'right' : 'left'}`;
    return `${parts.join(', ')}. Holding ${v}${w}.`;
  }
}
