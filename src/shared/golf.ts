// Deterministic golf sim. Inside the sim only + - * / % and Math.sqrt are used (all
// IEEE-754 exact), never Math.sin/cos/exp, so a shot log replays bit-identically on any JS engine.

export type Vec3 = { x: number; y: number; z: number };
export type Surface = 'fairway' | 'rough' | 'green' | 'sand' | 'oob';
/**
 * angle: aim yaw in tenths of a degree (0 = +z, 900 = +x). power: integer 0..100.
 * spinX/spinY: where the ball is struck, integers -100..100 (0 when omitted, so old logs replay unchanged).
 * spinX > 0 curves right (fade), < 0 curves left (draw). spinY < 0 is backspin (lift + bite), > 0 topspin.
 */
export type Shot = { angle: number; power: number; spinX?: number; spinY?: number };
/**
 * windX/windZ: m/s the air moves (same axes as the course). rain: 0 (dry) .. 1 (downpour).
 * fog: 0..1, visibility only; the sim ignores it (fog's effect on a golf ball is negligible).
 */
export type Weather = { windX: number; windZ: number; rain: number; fog?: number };
export type Circle = { x: number; z: number; r: number };
/** One hole. Tee is always at the origin facing +z; the fairway centreline runs straight from the tee to the hole. */
export type Course = {
  par: number;
  tee: { x: number; z: number };
  hole: { x: number; z: number };
  cupRadius: number;
  green: Circle;
  bunkers: Circle[];
  fairway: { halfWidth: number; z0: number; z1: number };
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
};
export type GameState = { course: Course; ball: Vec3; strokes: number; holed: boolean; weather: Weather };
export type ShotOutcome = 'rest' | 'holed' | 'oob';
/** path holds x,y,z per fixed step, starting at the shot's origin. */
export type ShotResult = { state: GameState; path: number[]; outcome: ShotOutcome };

export const DT = 1 / 120;
const G = 9.81;
const DRAG = 0.0045; // a = -DRAG * |v| * v  (~ rho*Cd*A / 2m for a golf ball)
const LOFT_DEG = 30;
const DRIVE_SPEED = 48; // m/s at power 100
const PUTT_SPEED = 9;
const MIN_BOUNCE_VY = 1; // below this the ball stops hopping and rolls
const CAPTURE_SPEED = 2.5;
const MAX_STEPS = 120 * 60;
const MAGNUS = 0.05; // a = MAGNUS * (spin x v), spin normalised to -1..1
const SPIN_DECAY = 0.05; // fraction of spin lost per second in the air
const BITE = 8; // m/s of forward speed removed on landing at full backspin (negative spin adds roll)
const SPIN_KEPT_ON_IMPACT = 0.3;

const CUP_RADIUS = 0.2; // shortcut: ~4x a real cup so swipes on a phone can sink putts; tune with playtests

/** The original hand-made hole; also the fallback if no generated hole passes the solvability check. */
export const DEFAULT_COURSE: Course = {
  par: 3,
  tee: { x: 0, z: 0 },
  hole: { x: 6, z: 125 },
  cupRadius: CUP_RADIUS,
  green: { x: 6, z: 125, r: 14 },
  bunkers: [{ x: -8, z: 110, r: 6 }],
  fairway: { halfWidth: 12, z0: -4, z1: 112 },
  bounds: { minX: -35, maxX: 42, minZ: -12, maxZ: 152 },
};

const SURF = {
  // bounce: kept fraction of vertical speed; friction: lost fraction of horizontal speed per impact;
  // roll: rolling-resistance coefficient (decel = roll * g); lie: launch-speed multiplier;
  // spin: how much of the struck spin the lie lets through (grass between club and ball kills it).
  fairway: { bounce: 0.35, friction: 0.25, roll: 0.12, lie: 1, spin: 1 },
  rough: { bounce: 0.2, friction: 0.5, roll: 0.45, lie: 0.75, spin: 0.3 },
  green: { bounce: 0.25, friction: 0.3, roll: 0.065, lie: 1, spin: 0 }, // putts roll; spin ignored
  sand: { bounce: 0.05, friction: 0.8, roll: 1.5, lie: 0.55, spin: 0.5 },
};

export function surfaceAt(c: Course, x: number, z: number): Surface {
  if (x < c.bounds.minX || x > c.bounds.maxX || z < c.bounds.minZ || z > c.bounds.maxZ) return 'oob';
  if ((x - c.green.x) ** 2 + (z - c.green.z) ** 2 < c.green.r ** 2) return 'green';
  if (c.bunkers.some((b) => (x - b.x) ** 2 + (z - b.z) ** 2 < b.r ** 2)) return 'sand';
  const cx = (c.hole.x * z) / c.hole.z;
  if (z > c.fairway.z0 && z < c.fairway.z1 && Math.abs(x - cx) < c.fairway.halfWidth) return 'fairway';
  return 'rough';
}

/** Degrees in, sine out. Taylor series to r^13 after range reduction: error < 1e-9, engine-independent. */
export function dsin(deg: number): number {
  let d = deg % 360;
  if (d > 180) d -= 360;
  else if (d < -180) d += 360;
  if (d > 90) d = 180 - d;
  else if (d < -90) d = -180 - d;
  const r = d * (Math.PI / 180);
  const r2 = r * r;
  return r * (1 - (r2 / 6) * (1 - (r2 / 20) * (1 - (r2 / 42) * (1 - (r2 / 72) * (1 - (r2 / 110) * (1 - r2 / 156))))));
}
export const dcos = (deg: number): number => dsin(deg + 90);

const clampSpin = (n: number | undefined): number => Math.max(-100, Math.min(100, n ?? 0));

export const CALM: Weather = { windX: 0, windZ: 0, rain: 0 };

export const newGame = (course: Course, weather: Weather = CALM): GameState => ({
  course,
  ball: { x: course.tee.x, y: 0, z: course.tee.z },
  strokes: 0,
  holed: false,
  weather,
});

type SurfParams = (typeof SURF)['fairway'];
/** Wet turf: softer landings (less bounce, more grab), slower roll, and water at impact cuts spin. */
const wetSurf = (p: SurfParams, rain: number): SurfParams => ({
  bounce: p.bounce * (1 - 0.5 * rain),
  friction: p.friction + (1 - p.friction) * 0.3 * rain,
  roll: p.roll * (1 + 0.6 * rain),
  lie: p.lie,
  spin: p.spin * (1 - 0.5 * rain),
});

export function simulateShot(
  course: Course,
  start: Vec3,
  shot: Shot,
  weather: Weather = CALM
): { path: number[]; end: Vec3; outcome: ShotOutcome } {
  const rain = Math.max(0, Math.min(1, weather.rain));
  const S = {
    fairway: wetSurf(SURF.fairway, rain),
    rough: wetSurf(SURF.rough, rain),
    green: wetSurf(SURF.green, rain),
    sand: wetSurf(SURF.sand, rain),
  };
  const lie = surfaceAt(course, start.x, start.z);
  const putt = lie === 'green';
  const ls = S[lie === 'oob' ? 'rough' : lie];
  const speed = (shot.power / 100) * (putt ? PUTT_SPEED : DRIVE_SPEED) * ls.lie;
  const loft = putt ? 0 : LOFT_DEG;
  const yaw = shot.angle / 10;
  const fx = dsin(yaw);
  const fz = dcos(yaw);
  const h = speed * dcos(loft);
  let vx = h * fx;
  let vz = h * fz;
  let vy = speed * dsin(loft);
  // Spin axis: backspin turns about the launch's right-hand axis (-fz, 0, fx); sidespin about +y.
  let back = (-clampSpin(shot.spinY) / 100) * ls.spin;
  let side = (-clampSpin(shot.spinX) / 100) * ls.spin;
  let { x, y, z } = start;
  let rolling = vy === 0;
  const path = [x, y, z];
  const done = (outcome: ShotOutcome) => ({ path, end: { x, y, z }, outcome });

  for (let i = 0; i < MAX_STEPS; i++) {
    if (!rolling) {
      // Drag and Magnus act on velocity relative to the air, which is how wind pushes the ball.
      const rx = vx - weather.windX;
      const rz = vz - weather.windZ;
      const sp = Math.sqrt(rx * rx + vy * vy + rz * rz);
      const wx = -back * fz;
      const wz = back * fx;
      // Magnus: a = MAGNUS * (w x v_rel), w = (wx, side, wz)
      const mx = MAGNUS * (side * rz - wz * vy);
      const my = MAGNUS * (wz * rx - wx * rz);
      const mz = MAGNUS * (wx * vy - side * rx);
      vx += (mx - DRAG * sp * rx) * DT;
      vy += (my - G - DRAG * sp * vy) * DT;
      vz += (mz - DRAG * sp * rz) * DT;
      back *= 1 - SPIN_DECAY * DT;
      side *= 1 - SPIN_DECAY * DT;
      x += vx * DT;
      y += vy * DT;
      z += vz * DT;
      if (y <= 0) {
        y = 0;
        const s = surfaceAt(course, x, z);
        if (s === 'oob') {
          path.push(x, y, z);
          return done('oob');
        }
        vy = -vy * S[s].bounce;
        vx = vx * (1 - S[s].friction) - fx * back * BITE; // backspin bites (can spin the ball back)
        vz = vz * (1 - S[s].friction) - fz * back * BITE;
        back *= SPIN_KEPT_ON_IMPACT;
        side *= SPIN_KEPT_ON_IMPACT;
        if (vy < MIN_BOUNCE_VY) {
          vy = 0;
          rolling = true;
        }
      }
    } else {
      const s = surfaceAt(course, x, z);
      if (s === 'oob') return done('oob');
      const sp = Math.sqrt(vx * vx + vz * vz);
      const dv = S[s].roll * G * DT;
      if (sp <= dv) return done('rest');
      vx *= 1 - dv / sp;
      vz *= 1 - dv / sp;
      x += vx * DT;
      z += vz * DT;
    }
    path.push(x, y, z);
    if (y === 0) {
      const dx = x - course.hole.x;
      const dz = z - course.hole.z;
      if (dx * dx + dz * dz < course.cupRadius ** 2 && vx * vx + vz * vz < CAPTURE_SPEED ** 2) {
        x = course.hole.x;
        z = course.hole.z;
        path.push(x, -0.1, z);
        return done('holed');
      }
    }
  }
  return done('rest');
}

/** OOB costs stroke-and-distance: +1 penalty and the ball returns to where it was hit from. */
export function playShot(state: GameState, shot: Shot): ShotResult {
  const r = simulateShot(state.course, state.ball, shot, state.weather);
  const oob = r.outcome === 'oob';
  return {
    path: r.path,
    outcome: r.outcome,
    state: {
      course: state.course,
      ball: oob ? state.ball : r.end,
      strokes: state.strokes + (oob ? 2 : 1),
      holed: r.outcome === 'holed',
      weather: state.weather,
    },
  };
}

export const replay = (course: Course, shots: Shot[], weather: Weather = CALM): GameState =>
  shots.reduce((s, shot) => playShot(s, shot).state, newGame(course, weather));

// ---------------- Daily hole generation ----------------

export type Daily = { day: string; number: number; course: Course; weather: Weather };

const LAUNCH_DAY = Date.UTC(2026, 10, 18); // Daily #1
const DAY_MS = 86_400_000;

/** UTC calendar day, e.g. "2026-11-18". Everyone gets the same hole on the same UTC day. */
export const dayKey = (t: number = Date.now()): string => new Date(t).toISOString().slice(0, 10);
export const dayNumber = (day: string): number => Math.round((Date.parse(day) - LAUNCH_DAY) / DAY_MS) + 1;
export const prevDay = (day: string): string => dayKey(Date.parse(day) - DAY_MS);

export const holeLength = (d: Daily): number => Math.round(Math.hypot(d.course.hole.x, d.course.hole.z));

export function weatherWord(w: Weather): string {
  const wind = Math.hypot(w.windX, w.windZ);
  if (w.rain >= 1) return 'Storm';
  if (w.rain > 0) return 'Rain';
  if (w.fog) return 'Fog';
  return wind >= 5 ? 'Windy' : wind >= 2 ? 'Breezy' : 'Calm';
}

/** mulberry32: tiny seeded PRNG, integer ops only, so a seed gives the same sequence on any engine. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const tenth = (n: number) => Math.round(n * 10) / 10;
const between = (rnd: () => number, lo: number, hi: number) => tenth(lo + rnd() * (hi - lo));

const WEATHER_PRESETS = [
  { wind: 0, rain: 0, fog: 0 },
  { wind: 3, rain: 0, fog: 0 },
  { wind: 7, rain: 0, fog: 0 },
  { wind: 1, rain: 0.35, fog: 0 },
  { wind: 2, rain: 0.7, fog: 0 },
  { wind: 9, rain: 1, fog: 0 },
  { wind: 1, rain: 0, fog: 1 },
];

export function makeWeather(rnd: () => number): Weather {
  const p = WEATHER_PRESETS[Math.floor(rnd() * WEATHER_PRESETS.length)] ?? { wind: 0, rain: 0, fog: 0 };
  const a = rnd() * 360;
  return { windX: tenth(p.wind * dsin(a)), windZ: tenth(p.wind * dcos(a)), rain: p.rain, fog: p.fog };
}

/** Par 3 (100-155 m) or par 4 (220-280 m), the green offset left or right, 1-2 bunkers guarding it. */
export function makeCourse(rnd: () => number): Course {
  const par = rnd() < 0.35 ? 4 : 3;
  const length = par === 4 ? between(rnd, 220, 280) : between(rnd, 100, 155);
  const hole = { x: between(rnd, -0.12 * length, 0.12 * length), z: length };
  const greenR = between(rnd, 11, 15);
  const halfWidth = between(rnd, 9, 13);
  const bunkers: Circle[] = [];
  // Greenside: centred just outside the green's edge so they pinch it; the green wins in surfaceAt, so the cup stays clear.
  const greenside = 1 + Math.floor(rnd() * 2);
  for (let i = 0; i < greenside; i++) {
    const a = between(rnd, 120, 240) + i * 120; // first in front of the green, the second off to a side
    const r = between(rnd, 4, 7);
    const d = greenR + r * 0.4;
    bunkers.push({ x: tenth(hole.x + d * dsin(a)), z: tenth(hole.z + d * dcos(a)), r });
  }
  if (par === 4) {
    // Fairway bunker in the drive landing zone, on one edge of the fairway.
    const z = between(rnd, 135, 165);
    const side = rnd() < 0.5 ? -1 : 1;
    bunkers.push({ x: tenth((hole.x * z) / hole.z + side * halfWidth * 0.8), z, r: between(rnd, 5, 8) });
  }
  return {
    par,
    tee: { x: 0, z: 0 },
    hole,
    cupRadius: CUP_RADIUS,
    green: { x: hole.x, z: hole.z, r: greenR },
    bunkers,
    fairway: { halfWidth, z0: -4, z1: tenth(hole.z - greenR + 2) },
    bounds: {
      minX: Math.floor(Math.min(0, hole.x) - 35),
      maxX: Math.ceil(Math.max(0, hole.x) + 35),
      minZ: -12,
      maxZ: Math.ceil(hole.z + 27),
    },
  };
}

/**
 * Greedy bot: each stroke, try a fan of aims and powers and keep the shot that ends nearest the cup.
 * Returns strokes to hole out, or Infinity if it can't within maxStrokes. Used to reject unfair holes.
 */
export function solve(course: Course, weather: Weather, maxStrokes: number): number {
  let s = newGame(course, weather);
  while (s.strokes < maxStrokes) {
    const aim = Math.round((Math.atan2(course.hole.x - s.ball.x, course.hole.z - s.ball.z) * 1800) / Math.PI);
    const putt = surfaceAt(course, s.ball.x, s.ball.z) === 'green';
    let best: GameState | undefined;
    let bestD = Infinity;
    for (let k = -12; k <= 12; k++) {
      const angle = aim + k * (putt ? 1 : 10); // putts: 0.1 degree steps; full shots: 1 degree, enough to hold against wind
      for (let power = 1; power <= 100; power += putt ? 1 : 2) {
        const r = playShot(s, { angle, power });
        if (r.outcome === 'holed') return r.state.strokes;
        if (r.outcome === 'oob') continue;
        const d = Math.hypot(course.hole.x - r.state.ball.x, course.hole.z - r.state.ball.z);
        if (d < bestD) {
          bestD = d;
          best = r.state;
        }
      }
    }
    if (!best) return Infinity;
    s = best;
  }
  return Infinity;
}

/** The day's hole and weather. Rerolls (deterministically) until the bot can hole out within par + 1. */
export function generateDaily(day: string): Daily {
  const number = dayNumber(day);
  for (let attempt = 0; attempt < 8; attempt++) {
    const rnd = seededRandom(Date.parse(day) / DAY_MS + attempt * 1_000_003);
    const course = makeCourse(rnd);
    const weather = makeWeather(rnd);
    if (solve(course, weather, course.par + 1) <= course.par + 1) return { day, number, course, weather };
  }
  return { day, number, course: DEFAULT_COURSE, weather: CALM };
}

// ---------------- Untrusted shot logs (server input) ----------------

export const MAX_SHOTS = 40;
const intIn = (v: unknown, lo: number, hi: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;

/** Returns the log as clean Shots, or null if anything is out of range or not an integer. */
export function parseShots(v: unknown): Shot[] | null {
  if (!Array.isArray(v) || v.length === 0 || v.length > MAX_SHOTS) return null;
  const shots: Shot[] = [];
  for (const s of v) {
    if (typeof s !== 'object' || s === null) return null;
    const angle = 'angle' in s ? s.angle : undefined;
    const power = 'power' in s ? s.power : undefined;
    const spinX = 'spinX' in s ? s.spinX : 0;
    const spinY = 'spinY' in s ? s.spinY : 0;
    if (!intIn(angle, -3600, 3600) || !intIn(power, 0, 100) || !intIn(spinX, -100, 100) || !intIn(spinY, -100, 100)) return null;
    shots.push({ angle, power, spinX, spinY });
  }
  return shots;
}
