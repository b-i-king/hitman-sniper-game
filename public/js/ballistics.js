// Simplified external ballistics. Pure functions, shared by the game and the tests.
//
// Model: bullet velocity decays exponentially with distance (v = v0 * e^(-c*x)), the drag
// constant c scales with air density (colder air = denser = more drag = more drop), gravity
// acts over the time of flight, and crosswind drift uses the classic "lag time" formula.
// The rifle is zeroed at 100 m in standard conditions (59°F).

export const G = 9.81; // m/s²
export const MUZZLE_VELOCITY = 900; // m/s
export const DRAG_C0 = 0.0007; // 1/m at standard density
export const STD_TEMP_F = 59;
export const ZERO_RANGE = 100; // m
export const MPH_TO_MPS = 0.44704;

export function fahrenheitToKelvin(f) {
  return ((f - 32) * 5) / 9 + 273.15;
}

/** Drag constant for the given air temperature (denser cold air -> more drag). */
export function dragCoef(tempF = STD_TEMP_F) {
  return DRAG_C0 * (fahrenheitToKelvin(STD_TEMP_F) / fahrenheitToKelvin(tempF));
}

export function timeOfFlight(range, tempF = STD_TEMP_F) {
  const c = dragCoef(tempF);
  return (Math.exp(c * range) - 1) / (c * MUZZLE_VELOCITY);
}

export function dropMeters(range, tempF = STD_TEMP_F) {
  const t = timeOfFlight(range, tempF);
  return 0.5 * G * t * t;
}

/** Barrel angle above the line of sight (radians) that zeroes the rifle at 100 m. */
export const ZERO_ANGLE = dropMeters(ZERO_RANGE) / ZERO_RANGE;

/**
 * Vertical offset (m) of the impact relative to the crosshair, with no hold applied.
 * Negative = the bullet lands low.
 */
export function impactOffsetY(range, tempF = STD_TEMP_F) {
  return range * ZERO_ANGLE - dropMeters(range, tempF);
}

/**
 * Horizontal drift (m). windX is the crosswind in mph, positive = blowing toward the
 * right (i.e. wind coming FROM the left).
 */
export function windDriftMeters(range, tempF, windXMph) {
  const lag = timeOfFlight(range, tempF) - range / MUZZLE_VELOCITY;
  return windXMph * MPH_TO_MPS * lag;
}

export const metersToMils = (m, range) => (m * 1000) / range;
export const milsToMeters = (mils, range) => (mils * range) / 1000;

/**
 * The firing solution the sniper dials, in mils, from the values the spotter called.
 * Positive elevation = hold up. Positive windage = hold right.
 * Lead is returned as an unsigned magnitude; the sniper applies it in the direction the
 * target is moving.
 */
export function firingSolution({ range, tempF = STD_TEMP_F, windXMph = 0, speed = 0 }) {
  const r = Math.max(range || ZERO_RANGE, 1);
  const elevation = -metersToMils(impactOffsetY(r, tempF), r);
  const windage = -metersToMils(windDriftMeters(r, tempF, windXMph), r);
  const lead = metersToMils(Math.abs(speed) * timeOfFlight(r, tempF), r);
  return { elevation, windage, lead, tof: timeOfFlight(r, tempF) };
}
