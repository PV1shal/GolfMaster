import * as THREE from 'three';
import {
  DT,
  dayKey,
  generateDaily,
  newGame,
  playShot,
  surfaceAt,
  type GameState,
  type Shot,
  type ShotResult,
  type Surface,
  type Weather,
} from '../shared/golf';
import type { Entry, InitResponse, LeaderboardResponse, ScoreResponse } from '../shared/api';

function byId<T extends HTMLElement>(id: string, type: new () => T): T {
  const el = document.getElementById(id);
  if (!(el instanceof type)) throw new Error(`game.html is missing #${id}`);
  return el;
}
const canvas = byId('bg', HTMLCanvasElement);
const strokesEl = byId('strokes', HTMLElement);
const scoreBtn = byId('score-btn', HTMLButtonElement);
const infoEl = byId('info', HTMLElement);
const menuWrap = byId('menu-wrap', HTMLElement);
const menuBtn = byId('menu-btn', HTMLButtonElement);
const menuEl = byId('menu', HTMLElement);
const scorecard = byId('scorecard', HTMLDialogElement);
const scSummary = byId('sc-summary', HTMLElement);
const scTable = byId('sc-table', HTMLTableElement);
const scRows = byId('sc-rows', HTMLElement);
const scEmpty = byId('sc-empty', HTMLElement);
const powerTag = byId('power-tag', HTMLElement);
const scHero = byId('sc-hero', HTMLElement);
const heroTitle = byId('hero-title', HTMLElement);
const heroSub = byId('hero-sub', HTMLElement);
const confettiEl = byId('confetti', HTMLElement);
const scActions = byId('sc-actions', HTMLElement);
const endReplayBtn = byId('end-replay', HTMLButtonElement);
const endNewBtn = byId('end-new', HTMLButtonElement);
const replayBtn = byId('replay', HTMLButtonElement);
const resetBtn = byId('reset', HTMLButtonElement);
const windEl = byId('wind', HTMLElement);
const windSpeed = byId('wind-speed', HTMLElement);
const windArrow = byId('wind-arrow', HTMLElement);
const rainIcon = byId('rain-icon', HTMLElement);
const fogIcon = byId('fog-icon', HTMLElement);
const weatherText = byId('weather-text', HTMLElement);
const spinEl = byId('spin', HTMLElement);
const spinDot = byId('spin-dot', HTMLElement);
const scoreParEl = byId('score-par', HTMLElement);
const heroRank = byId('hero-rank', HTMLButtonElement);
const lbBtn = byId('leaderboard', HTMLButtonElement);
const lbDialog = byId('lb', HTMLDialogElement);
const lbSummary = byId('lb-summary', HTMLElement);
const lbList = byId('lb-list', HTMLElement);

// --- Today's hole: from the server (which owns the leaderboard); generated locally when there's no server ---
async function loadInit(): Promise<InitResponse> {
  try {
    const res = await fetch('/api/init');
    if (res.ok) {
      const data: InitResponse = await res.json();
      return data;
    }
  } catch {
    // no server (vite preview / offline): play today's hole unranked
  }
  return { daily: generateDaily(dayKey()), username: null, mine: null, stats: null, players: 0 };
}
const INIT = await loadInit();
const DAILY = INIT.daily;
const COURSE = DAILY.course;
scoreParEl.textContent = `Par ${COURSE.par}`;

// --- Renderer: no AA, no shadows, capped DPR, render only when something changed (mid-range phones) ---
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
const scene = new THREE.Scene();
const DRY_SKY = new THREE.Color(0x8fc7e8);
const WET_SKY = new THREE.Color(0x6f7d88);
const sky = DRY_SKY.clone();
const fog = new THREE.Fog(sky, 120, 260);
scene.background = sky;
scene.fog = fog;
const camera = new THREE.PerspectiveCamera(55, 1, 0.5, 400);
scene.add(new THREE.HemisphereLight(0xffffff, 0x446633, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(-30, 60, -20);
scene.add(sun);

// --- Ground: one flat-shaded mesh, each triangle coloured by the same surfaceAt(COURSE, ) the physics uses ---
const SURF_COLOR: Record<Surface, number> = {
  fairway: 0x6cc24a,
  rough: 0x3f8f3a,
  green: 0x93e36e,
  sand: 0xe8d39a,
  oob: 0x2c6a2e,
};
const b = COURSE.bounds;
const MARGIN = 40;
const groundW = b.maxX - b.minX + 2 * MARGIN;
const groundD = b.maxZ - b.minZ + 2 * MARGIN;
const CELL = 2;
const groundGeo = new THREE.PlaneGeometry(groundW, groundD, Math.round(groundW / CELL), Math.round(groundD / CELL))
  .rotateX(-Math.PI / 2)
  .translate((b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2)
  .toNonIndexed();
const gp = groundGeo.getAttribute('position');
const colors = new Float32Array(gp.count * 3);
const col = new THREE.Color();
for (let i = 0; i < gp.count; i += 3) {
  const cx = (gp.getX(i) + gp.getX(i + 1) + gp.getX(i + 2)) / 3;
  const cz = (gp.getZ(i) + gp.getZ(i + 1) + gp.getZ(i + 2)) / 3;
  col.setHex(SURF_COLOR[surfaceAt(COURSE, cx, cz)]);
  for (let k = 0; k < 3; k++) col.toArray(colors, (i + k) * 3);
}
groundGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
scene.add(new THREE.Mesh(groundGeo, new THREE.MeshLambertMaterial({ vertexColors: true })));

const decal = (color: number, opacity = 1) =>
  new THREE.MeshBasicMaterial({
    color,
    transparent: opacity < 1,
    opacity,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    depthWrite: false,
  });

// Cup + flag
const cup = new THREE.Mesh(new THREE.CircleGeometry(COURSE.cupRadius, 12).rotateX(-Math.PI / 2), decal(0x111111));
cup.position.set(COURSE.hole.x, 0, COURSE.hole.z);
scene.add(cup);
const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.4, 5), new THREE.MeshLambertMaterial({ color: 0xeeeeee }));
pole.position.set(0, 1.2, 0);
const flagGeo = new THREE.BufferGeometry().setAttribute(
  'position',
  new THREE.Float32BufferAttribute([0, 2.4, 0, 0, 1.8, 0, 0.9, 2.1, 0], 3)
);
const flag = new THREE.Mesh(flagGeo, new THREE.MeshBasicMaterial({ color: 0xff4500, side: THREE.DoubleSide }));
// Pole + cloth move together so the pin can be lifted out as the ball nears the cup.
const flagstick = new THREE.Group();
flagstick.position.set(COURSE.hole.x, 0, COURSE.hole.z);
flagstick.add(pole, flag);
scene.add(flagstick);
const FLAG_LIFT_RADIUS = 3; // m from the cup
const FLAG_LIFT = 1.4; // m

// Rain: streaks in a box that follows the camera. Only animates (and forces redraws) while raining.
const MAX_DROPS = 900;
const RAIN_HALF = 15;
const RAIN_TOP = 12;
const RAIN_FALL = 14; // m/s
const drops = Array.from({ length: MAX_DROPS }, () => ({
  x: (Math.random() * 2 - 1) * RAIN_HALF,
  y: Math.random() * RAIN_TOP,
  z: (Math.random() * 2 - 1) * RAIN_HALF,
}));
const rainGeo = new THREE.BufferGeometry();
rainGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(MAX_DROPS * 6), 3));
const rainPos = rainGeo.getAttribute('position');
const rainLines = new THREE.LineSegments(
  rainGeo,
  new THREE.LineBasicMaterial({ color: 0xc8d4e0, transparent: true, opacity: 0.55 })
);
rainLines.frustumCulled = false;
rainLines.visible = false;
scene.add(rainLines);
const wrap = (v: number, h: number) => (v > h ? v - 2 * h : v < -h ? v + 2 * h : v);

function updateRain(dt: number) {
  const w = game.weather;
  const n = Math.round(MAX_DROPS * w.rain);
  drops.forEach((d, i) => {
    if (i >= n) return;
    d.x = wrap(d.x + w.windX * dt, RAIN_HALF);
    d.z = wrap(d.z + w.windZ * dt, RAIN_HALF);
    d.y -= RAIN_FALL * dt;
    if (d.y < 0) d.y += RAIN_TOP;
    rainPos.setXYZ(i * 2, d.x, d.y, d.z);
    rainPos.setXYZ(i * 2 + 1, d.x - w.windX * 0.04, d.y + RAIN_FALL * 0.04, d.z - w.windZ * 0.04);
  });
  rainPos.needsUpdate = true;
  rainGeo.setDrawRange(0, n * 2);
  rainLines.position.set(camera.position.x, 0, camera.position.z);
}

// --- Weather: fixed per day (part of DAILY) and stored in the game state so replays use the same conditions ---
function applyWeather() {
  const w = game.weather;
  const haze = Math.max(w.fog ?? 0, w.rain * 0.6); // rain brings some murk; fog is the thick stuff
  sky.lerpColors(DRY_SKY, WET_SKY, Math.max(w.rain, (w.fog ?? 0) * 0.6));
  fog.color.copy(sky);
  fog.near = 120 - 110 * haze;
  fog.far = 260 - 120 * haze; // at full fog the flag at 125 m is just a ghost
  sun.intensity = 1.6 * (1 - 0.5 * w.rain);
  rainLines.visible = w.rain > 0;
  // Flag streams downwind; its cloth points along +x before rotation.
  flag.rotation.y = Math.hypot(w.windX, w.windZ) > 0.3 ? Math.atan2(-w.windZ, w.windX) : 0;
}

const LIGHT_CLOUD = new THREE.Color(0xe4e9ee);
const DARK_CLOUD = new THREE.Color(0x3a4350);
/** Wind severity: green calm-ish, yellow breezy, orange windy, red gale. */
const windColor = (s: number) => (s < 2 ? '#8ee27a' : s < 5 ? '#f5d84a' : s < 8 ? '#ff9a3c' : '#ff4d4d');

function updateWeatherHud() {
  const w = game.weather;
  const speed = Math.hypot(w.windX, w.windZ);
  const parts: string[] = [];

  windEl.hidden = speed <= 0.3;
  if (speed > 0.3) {
    // Arrow up = blowing toward the flag from where you stand. Screen rotation is opposite to world yaw.
    const rel = Math.atan2(w.windX, w.windZ) - Math.atan2(heading.x, heading.z);
    windArrow.style.transform = `rotate(${-rel}rad)`;
    windSpeed.textContent = speed.toFixed(0);
    windEl.style.color = windColor(speed);
    const along = Math.cos(rel);
    parts.push(`Wind ${speed.toFixed(0)} m/s ${along > 0.5 ? 'tailwind' : along < -0.5 ? 'headwind' : 'crosswind'}`);
  } else parts.push('Calm');

  rainIcon.hidden = w.rain <= 0;
  if (w.rain > 0) {
    rainIcon.style.color = `#${col.lerpColors(LIGHT_CLOUD, DARK_CLOUD, w.rain).getHexString()}`;
    parts.push(w.rain < 0.5 ? 'Light rain' : w.rain < 0.85 ? 'Rain' : 'Heavy rain');
  }

  fogIcon.hidden = (w.fog ?? 0) <= 0;
  if ((w.fog ?? 0) > 0) parts.push('Fog');

  weatherText.textContent = parts.join(' · ');
}

// Trees: one instanced draw call, placed outside the play area so they never contradict the physics
let seed = 7;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const spots: [number, number][] = [];
for (let z = b.minZ - 10; z < b.maxZ + 20; z += 8) spots.push([b.minX - 4 - rnd() * 18, z], [b.maxX + 4 + rnd() * 18, z]);
for (let x = b.minX; x < b.maxX; x += 8) spots.push([x, b.maxZ + 4 + rnd() * 14]);
const trees = new THREE.InstancedMesh(
  new THREE.ConeGeometry(2.4, 7, 6).translate(0, 3.5, 0),
  new THREE.MeshLambertMaterial({ color: 0x1f5a2a, flatShading: true }),
  spots.length
);
const mtx = new THREE.Matrix4();
spots.forEach(([x, z], i) => {
  const s = 0.7 + rnd() * 0.7;
  trees.setMatrixAt(i, mtx.makeScale(s, s, s).setPosition(x, 0, z));
});
scene.add(trees);

// Ball (drawn ~3.5x real size so it reads on a phone) + blob shadow for height cues
const BALL_R = 0.15;
const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(BALL_R, 1), new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }));
const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.2, 10).rotateX(-Math.PI / 2), decal(0x000000, 0.35));
scene.add(ball, shadow);

// Aim arrow: flat on the ground, shaft split into segments so the colour ramp has room to show.
const ARROW_SEGS = 8;
const ARROW_VERTS = ARROW_SEGS * 6 + 3;
const arrowGeo = new THREE.BufferGeometry();
arrowGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(ARROW_VERTS * 3), 3));
arrowGeo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(ARROW_VERTS * 3), 3));
const arrowMat = decal(0xffffff);
arrowMat.vertexColors = true;
arrowMat.side = THREE.DoubleSide;
const arrow = new THREE.Mesh(arrowGeo, arrowMat);
arrow.frustumCulled = false; // bounds change every drag; not worth recomputing
arrow.visible = false;
scene.add(arrow);
const arrowPos = arrowGeo.getAttribute('position');
const arrowCol = arrowGeo.getAttribute('color');
const RAMP = [new THREE.Color(0x22cc44), new THREE.Color(0x2266ff), new THREE.Color(0xff2000)];

/** t in 0..1 → green → blue → red */
function ramp(t: number, out: THREE.Color) {
  const [g, bl, r] = RAMP;
  if (!g || !bl || !r) return out;
  return t < 0.5 ? out.lerpColors(g, bl, t * 2) : out.lerpColors(bl, r, t * 2 - 1);
}

function updateArrow(shot: Shot) {
  const a = (shot.angle / 1800) * Math.PI;
  const dx = Math.sin(a);
  const dz = Math.cos(a);
  const len = 1 + shot.power * 0.08;
  const head = Math.min(1, len * 0.4);
  const shaft = len - head;
  const p = shot.power / 100;
  let v = 0;
  // along = distance from ball, side = offset to the right of the aim direction
  const put = (along: number, side: number) => {
    arrowPos.setXYZ(v, game.ball.x + dx * along + dz * side, 0.05, game.ball.z + dz * along - dx * side);
    ramp((along / len) * p, col);
    arrowCol.setXYZ(v++, col.r, col.g, col.b);
  };
  const W = 0.125;
  for (let i = 0; i < ARROW_SEGS; i++) {
    const s0 = (shaft * i) / ARROW_SEGS;
    const s1 = (shaft * (i + 1)) / ARROW_SEGS;
    put(s0, -W);
    put(s0, W);
    put(s1, W);
    put(s0, -W);
    put(s1, W);
    put(s1, -W);
  }
  put(shaft, -0.35);
  put(shaft, 0.35);
  put(len, 0);
  arrowPos.needsUpdate = true;
  arrowCol.needsUpdate = true;
  arrow.visible = true;

  tagAnchor.set(game.ball.x + dx * (len + 0.6), 0.05, game.ball.z + dz * (len + 0.6));
  powerTag.textContent = `${shot.power}%`;
  powerTag.style.color = `#${ramp(p, col).getHexString()}`;
  powerTag.hidden = false;
  placePowerTag();
}

const tagAnchor = new THREE.Vector3();
const tagScreen = new THREE.Vector3();
/** Pin the % label just past the arrow tip, in screen space (re-run while the camera moves). */
function placePowerTag() {
  tagScreen.copy(tagAnchor).project(camera);
  const x = THREE.MathUtils.clamp(((tagScreen.x + 1) / 2) * window.innerWidth, 24, window.innerWidth - 24);
  const y = THREE.MathUtils.clamp(((1 - tagScreen.y) / 2) * window.innerHeight, 24, window.innerHeight - 24);
  powerTag.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
}

function hideArrow() {
  arrow.visible = false;
  powerTag.hidden = true;
}

// --- Game state ---
let game: GameState = newGame(COURSE, DAILY.weather);
let log: Shot[] = [];
let queue: Shot[] = []; // shots waiting to be animated (replay)
let wait = 0;
let flight: { result: ShotResult; t: number } | null = null;
let drag: { x0: number; y0: number; shot: Shot | null } | null = null;
let dirty = true;
const heading = new THREE.Vector3(0, 0, 1);
const look = new THREE.Vector3();

function setBall(x: number, y: number, z: number) {
  ball.position.set(x, y + BALL_R, z);
  shadow.position.set(x, 0, z);
  shadow.visible = y > -0.05;
}

function headToHole() {
  heading.set(COURSE.hole.x - game.ball.x, 0, COURSE.hole.z - game.ball.z).normalize();
}

function cameraGoal(pos: THREE.Vector3, target: THREE.Vector3) {
  const d = Math.hypot(COURSE.hole.x - ball.position.x, COURSE.hole.z - ball.position.z);
  const back = THREE.MathUtils.clamp(d * 0.25, 3, 9);
  pos.copy(ball.position).addScaledVector(heading, -back).setY(ball.position.y + back * 0.6 + 0.5);
  target.copy(ball.position).addScaledVector(heading, Math.min(d, 40) * 0.5);
}
const goalPos = new THREE.Vector3();
const goalLook = new THREE.Vector3();
function snapCamera() {
  cameraGoal(camera.position, look);
  camera.lookAt(look);
  dirty = true;
}

const SURF_LABEL: Record<Surface, string> = {
  fairway: 'Fairway',
  rough: 'Rough',
  green: 'On the green',
  sand: 'Bunker',
  oob: 'Out of bounds',
};

function updateHud(message?: string) {
  strokesEl.textContent = String(game.strokes);
  scoreBtn.setAttribute('aria-label', `Scorecard: ${game.strokes} strokes, par ${COURSE.par}`);
  const d = Math.hypot(COURSE.hole.x - game.ball.x, COURSE.hole.z - game.ball.z);
  infoEl.textContent = message ?? `${SURF_LABEL[surfaceAt(COURSE, game.ball.x, game.ball.z)]} · ${d.toFixed(0)} m`;
  replayBtn.disabled = log.length === 0;
  spinEl.classList.toggle('off', surfaceAt(COURSE, game.ball.x, game.ball.z) === 'green'); // putts ignore spin
  updateWeatherHud();
}

const SCORE_NAME: Record<number, string> = { [-3]: 'Albatross', [-2]: 'Eagle', [-1]: 'Birdie', 0: 'Par', 1: 'Bogey', 2: 'Double bogey' };

function scoreWords(strokes: number): { vsPar: string; name: string } {
  const diff = strokes - COURSE.par;
  const vsPar = diff === 0 ? 'E' : `${diff > 0 ? '+' : ''}${diff}`;
  const name = strokes === 1 ? 'Hole in one!' : (SCORE_NAME[diff] ?? `${diff} over par`);
  return { vsPar, name };
}

function spinLabel(s: Shot): string {
  const x = s.spinX ?? 0;
  const y = s.spinY ?? 0;
  const parts = [y < 0 ? `Back ${-y}` : y > 0 ? `Top ${y}` : '', x > 0 ? `Fade ${x}` : x < 0 ? `Draw ${-x}` : ''];
  return parts.filter(Boolean).join(' · ') || '—';
}

/** Rebuilt from the log on open: the sim is deterministic, so replaying it gives each shot's result. */
function renderScorecard() {
  let s = newGame(COURSE, game.weather);
  const rows = log.map((shot, i) => {
    const r = playShot(s, shot);
    s = r.state;
    const d = Math.hypot(COURSE.hole.x - s.ball.x, COURSE.hole.z - s.ball.z);
    const result =
      r.outcome === 'holed' ? 'Holed' : r.outcome === 'oob' ? 'OOB · +1' : `${SURF_LABEL[surfaceAt(COURSE, s.ball.x, s.ball.z)]} · ${d.toFixed(0)} m`;
    const tr = document.createElement('tr');
    for (const text of [String(i + 1), `${(shot.angle / 10).toFixed(1)}°`, `${shot.power}%`, spinLabel(shot), result]) {
      const td = document.createElement('td');
      td.textContent = text;
      tr.append(td);
    }
    return tr;
  });
  scRows.replaceChildren(...rows);
  scTable.hidden = rows.length === 0;
  scEmpty.hidden = rows.length > 0;

  const { vsPar, name } = scoreWords(s.strokes);
  const d = Math.hypot(COURSE.hole.x - s.ball.x, COURSE.hole.z - s.ball.z);
  const status = s.holed ? `Holed · ${vsPar} · ${name}` : `In play · ${d.toFixed(0)} m to pin`;
  const strong = document.createElement('strong');
  strong.textContent = `${s.strokes} ${s.strokes === 1 ? 'stroke' : 'strokes'}`;
  const lines = [status, `Daily #${DAILY.number} · Par ${COURSE.par} · ${Math.hypot(COURSE.hole.x, COURSE.hole.z).toFixed(0)} m`, weatherText.textContent ?? ''];
  scSummary.replaceChildren(
    strong,
    ...lines.map((t) => {
      const div = document.createElement('div');
      div.textContent = t;
      return div;
    })
  );
}

function fire(shot: Shot) {
  flight = { result: playShot(game, shot), t: 0 };
  hideArrow();
}

function land(r: ShotResult) {
  game = r.state;
  flight = null;
  setBall(game.ball.x, r.outcome === 'holed' ? -0.1 : 0, game.ball.z);
  if (r.outcome === 'holed') {
    const { vsPar, name } = scoreWords(game.strokes);
    updateHud(`Holed! ${name} · ${vsPar}`);
    const finished = game;
    const posted = postScore([...log]);
    // Short beat so the drop and the lifted pin are seen first; skip if a new game started meanwhile.
    setTimeout(() => {
      if (game !== finished) return;
      openScorecard(true);
      void posted.then((text) => {
        if (game !== finished) return;
        heroRank.textContent = text;
        heroRank.hidden = !text;
      });
    }, 1200);
    return;
  }
  headToHole();
  updateHud(r.outcome === 'oob' ? 'Out of bounds · +1' : undefined);
  wait = 0.8;
}

function reset(shots: Shot[], weather: Weather) {
  game = newGame(COURSE, weather);
  applyWeather();
  flight = null;
  queue = shots;
  wait = 0.5;
  setBall(game.ball.x, 0, game.ball.z);
  headToHole();
  snapCamera();
  updateHud(shots.length ? 'Replaying…' : undefined);
}

// --- Swipe to swing: swipe up toward the flag; length = power, sideways = aim ---
function shotFromSwipe(dx: number, dy: number): Shot | null {
  if (dy > -20) return null; // must be an upward swipe
  const power = Math.min(100, Math.round((Math.hypot(dx, dy) / (window.innerHeight * 0.5)) * 100));
  const wx = heading.x * -dy - heading.z * dx * 0.5; // right = (-h.z, 0, h.x); sideways halved for finer aim
  const wz = heading.z * -dy + heading.x * dx * 0.5;
  // Quantised to integers so the logged shot is exactly what gets simulated and replayed.
  return { angle: Math.round((Math.atan2(wx, wz) * 1800) / Math.PI), power };
}

canvas.addEventListener('pointerdown', (e) => {
  if (menuOpen) return setMenu(false); // a tap outside the menu only closes it
  if (flight || queue.length || game.holed) return;
  canvas.setPointerCapture(e.pointerId);
  drag = { x0: e.clientX, y0: e.clientY, shot: null };
});
canvas.addEventListener('pointermove', (e) => {
  if (!drag) return;
  drag.shot = shotFromSwipe(e.clientX - drag.x0, e.clientY - drag.y0);
  if (drag.shot) updateArrow(drag.shot);
  else hideArrow();
  dirty = true;
});
canvas.addEventListener('pointerup', () => {
  const shot = drag?.shot && { ...drag.shot, spinX: spin.x, spinY: spin.y };
  drag = null;
  if (!shot || shot.power === 0) {
    hideArrow();
    updateHud();
    dirty = true;
    return;
  }
  log.push(shot);
  // First shot of a round = one try on the leaderboard. Fire-and-forget: offline play just isn't counted.
  if (log.length === 1) void fetch('/api/start', { method: 'POST' }).catch(() => {});
  setSpin(0, 0); // each shot starts from a centre strike
  console.log('[shot]', JSON.stringify(shot), 'replay:', JSON.stringify({ weather: game.weather, shots: log }));
  fire(shot);
});
canvas.addEventListener('pointercancel', () => {
  drag = null;
  hideArrow();
  dirty = true;
});

// --- Spin: tap/drag on the ball icon to pick the strike point (like english in pool) ---
let spin = { x: 0, y: 0 };
function setSpin(x: number, y: number) {
  const m = Math.hypot(x, y);
  const k = m < 12 ? 0 : m > 100 ? 100 / m : 1; // snap near-centre to zero, clamp to the ball's edge
  spin = { x: Math.round(x * k), y: Math.round(y * k) };
  spinDot.style.left = `${50 + spin.x / 2}%`;
  spinDot.style.top = `${50 - spin.y / 2}%`;
  spinEl.setAttribute('aria-valuetext', `side ${spin.x}, ${spin.y < 0 ? 'backspin' : 'topspin'} ${Math.abs(spin.y)}`);
}
function spinFromPointer(e: PointerEvent) {
  const r = spinEl.getBoundingClientRect();
  setSpin(((e.clientX - r.left) / r.width - 0.5) * 200, -((e.clientY - r.top) / r.height - 0.5) * 200);
}
spinEl.addEventListener('pointerdown', (e) => {
  spinEl.setPointerCapture(e.pointerId);
  spinFromPointer(e);
});
spinEl.addEventListener('pointermove', (e) => {
  if (spinEl.hasPointerCapture(e.pointerId)) spinFromPointer(e);
});
const SPIN_KEYS: Record<string, [number, number]> = {
  ArrowLeft: [-25, 0],
  ArrowRight: [25, 0],
  ArrowUp: [0, 25],
  ArrowDown: [0, -25],
};
spinEl.addEventListener('keydown', (e) => {
  const d = SPIN_KEYS[e.key];
  if (!d) return;
  e.preventDefault();
  setSpin(spin.x + d[0], spin.y + d[1]);
});

// --- Settings menu + scorecard ---
let menuOpen = false;
function setMenu(open: boolean) {
  menuOpen = open;
  menuEl.hidden = !open;
  menuBtn.setAttribute('aria-expanded', String(open));
  if (open) resetBtn.focus();
}
menuBtn.addEventListener('click', () => setMenu(!menuOpen));
document.addEventListener('pointerdown', (e) => {
  if (menuOpen && e.target instanceof Node && e.target !== canvas && !menuWrap.contains(e.target)) setMenu(false);
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !menuOpen) return;
  setMenu(false);
  menuBtn.focus();
});

function startReplay() {
  reset([...log], game.weather);
}
function startNewGame() {
  log = [];
  reset([], DAILY.weather);
}
replayBtn.addEventListener('click', () => {
  setMenu(false);
  startReplay();
});
resetBtn.addEventListener('click', () => {
  setMenu(false);
  startNewGame();
});
endReplayBtn.addEventListener('click', () => {
  scorecard.close();
  startReplay();
});
endNewBtn.addEventListener('click', () => {
  scorecard.close();
  startNewGame();
});

const CONFETTI_COLORS = ['#ff4500', '#ffd43b', '#4dabf7', '#69db7c', '#f783ac', '#ffffff'];
/** celebrate: the end-of-hole version with "Well done!", confetti and Replay/New game. */
function openScorecard(celebrate: boolean) {
  renderScorecard();
  scHero.hidden = !celebrate;
  scActions.hidden = !game.holed;
  scorecard.setAttribute('aria-labelledby', celebrate ? 'hero-title' : 'sc-title');
  if (celebrate) {
    const { vsPar, name } = scoreWords(game.strokes);
    heroTitle.textContent = game.strokes === 1 ? 'Hole in one!' : 'Well done!';
    heroSub.textContent = `${game.strokes === 1 ? 'Ace' : name} · ${game.strokes} ${game.strokes === 1 ? 'stroke' : 'strokes'} · ${vsPar}`;
    // Fresh nodes restart the CSS animations each time.
    confettiEl.replaceChildren(
      ...Array.from({ length: 28 }, (_, i) => {
        const piece = document.createElement('i');
        const a = Math.random() * Math.PI * 2;
        const dist = 70 + Math.random() * 110;
        piece.style.setProperty('--x', `${Math.cos(a) * dist}px`);
        piece.style.setProperty('--y', `${Math.sin(a) * dist * 0.7 - 20}px`);
        piece.style.setProperty('--r', `${Math.round(Math.random() * 720 - 360)}deg`);
        piece.style.setProperty('--d', `${Math.random() * 0.25}s`);
        piece.style.setProperty('--c', CONFETTI_COLORS[i % CONFETTI_COLORS.length] ?? '#fff');
        return piece;
      })
    );
    heroRank.hidden = true;
    heroTitle.style.animation = 'none';
    void heroTitle.offsetWidth; // reflow so the pop replays on a second hole
    heroTitle.style.animation = '';
  }
  if (!scorecard.open) scorecard.showModal();
  if (celebrate) endNewBtn.focus();
}
scoreBtn.addEventListener('click', () => openScorecard(false));

// --- Leaderboard: the server replays the shot log to score it; only the first finish of the day is ranked ---
/** Returns the line for the end card, or '' when there's nothing to show (offline). */
async function postScore(shots: Shot[]): Promise<string> {
  try {
    const res = await fetch('/api/score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shots }),
    });
    if (res.status === 401) return 'Log in to Reddit to join the leaderboard';
    if (!res.ok) return '';
    const r: ScoreResponse = await res.json();
    const best = `${r.mine.strokes} in ${tryWord(r.mine.tries)}`;
    if (!r.improved) return `Your best stands: ${best} · #${r.mine.rank} of ${r.players}`;
    const streak = r.stats.streak > 1 ? ` · ${r.stats.streak}-day streak` : '';
    return `New best: ${best} · #${r.mine.rank} of ${r.players}${streak}`;
  } catch {
    return '';
  }
}

const tryWord = (n: number) => `${n} ${n === 1 ? 'try' : 'tries'}`;

function lbRow(e: Entry, me: boolean): HTMLLIElement {
  const li = document.createElement('li');
  li.className = me ? 'me' : '';
  const diff = e.strokes - COURSE.par;
  for (const [cls, text] of [
    ['lb-rank', String(e.rank)],
    ['lb-name', `u/${e.username}`],
    ['lb-score', `${e.strokes} (${diff === 0 ? 'E' : `${diff > 0 ? '+' : ''}${diff}`})`],
    ['lb-tries', tryWord(e.tries)],
  ]) {
    const span = document.createElement('span');
    span.className = cls ?? '';
    span.textContent = text ?? '';
    li.append(span);
  }
  return li;
}

async function openLeaderboard() {
  setMenu(false);
  if (scorecard.open) scorecard.close();
  lbSummary.textContent = 'Loading…';
  lbList.replaceChildren();
  if (!lbDialog.open) lbDialog.showModal();
  try {
    const res = await fetch('/api/leaderboard');
    if (!res.ok) throw new Error(String(res.status));
    const lb: LeaderboardResponse = await res.json();
    const day = new Date(`${DAILY.day}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
    lbSummary.textContent = `Daily #${DAILY.number} · ${day} · ${lb.players} ${lb.players === 1 ? 'player' : 'players'}`;
    const rows = lb.top.map((e) => lbRow(e, e.username === lb.mine?.username));
    if (lb.mine && lb.mine.rank > lb.top.length) rows.push(lbRow(lb.mine, true));
    lbList.replaceChildren(...rows);
    if (!rows.length) lbSummary.textContent += ' · Be the first to finish!';
  } catch {
    lbSummary.textContent = 'Leaderboard is unavailable right now.';
  }
}
lbBtn.addEventListener('click', () => void openLeaderboard());
heroRank.addEventListener('click', () => void openLeaderboard());
lbDialog.addEventListener('click', (e) => {
  if (e.target === lbDialog) lbDialog.close();
});
scorecard.addEventListener('click', (e) => {
  if (e.target === scorecard) scorecard.close(); // tap on the backdrop
});

function resize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  dirty = true;
}
window.addEventListener('resize', resize);

// --- Loop: physics already ran at a fixed step in playShot(); here we only play the path back ---
let last = performance.now();
renderer.setAnimationLoop((now: number) => {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;

  if (flight) {
    flight.t += dt;
    const p = flight.result.path;
    const steps = p.length / 3 - 1;
    const f = Math.min(flight.t / DT, steps);
    const i = Math.min(Math.floor(f), steps - 1);
    const a = f - i;
    const at = (j: number) => p[j] ?? 0;
    const lerp = (k: number) => at(i * 3 + k) + (at((i + 1) * 3 + k) - at(i * 3 + k)) * a;
    if (steps > 0) setBall(lerp(0), lerp(1), lerp(2));
    if (f >= steps) land(flight.result);
    dirty = true;
  } else if (queue.length && (wait -= dt) <= 0) {
    const next = queue.shift();
    if (next) fire(next);
  }

  const nearCup =
    ball.position.y < 1.5 && Math.hypot(ball.position.x - COURSE.hole.x, ball.position.z - COURSE.hole.z) < FLAG_LIFT_RADIUS;
  const liftTo = nearCup ? FLAG_LIFT : 0;
  if (Math.abs(flagstick.position.y - liftTo) > 0.002) {
    flagstick.position.y += (liftTo - flagstick.position.y) * (1 - Math.exp(-dt * 8));
    dirty = true;
  }

  if (!powerTag.hidden) placePowerTag();
  cameraGoal(goalPos, goalLook);
  if (camera.position.distanceToSquared(goalPos) > 1e-4 || look.distanceToSquared(goalLook) > 1e-4) {
    const k = 1 - Math.exp(-dt * 4);
    camera.position.lerp(goalPos, k);
    look.lerp(goalLook, k);
    camera.lookAt(look);
    dirty = true;
  }

  if (game.weather.rain > 0) {
    updateRain(dt);
    dirty = true;
  }

  if (dirty) {
    renderer.render(scene, camera);
    dirty = false;
  }
});

resize();
reset([], DAILY.weather);
