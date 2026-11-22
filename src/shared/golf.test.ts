import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CALM, DEFAULT_COURSE as C, dsin, generateDaily, parseShots, playShot, replay, simulateShot, solve, type GameState } from './golf.ts';

test('dsin matches Math.sin', () => {
  for (let d = -720; d <= 720; d += 7.3) assert.ok(Math.abs(dsin(d) - Math.sin((d * Math.PI) / 180)) < 1e-9, `${d}`);
});

test('replay of the same log is bit-identical', () => {
  const log = [
    { angle: 25, power: 92 },
    { angle: -40, power: 30 },
    { angle: 15, power: 20 },
  ];
  assert.deepEqual(replay(C, log), replay(C, log));
  assert.deepEqual(simulateShot(C, { x: 0, y: 0, z: 0 }, log[0]!), simulateShot(C, { x: 0, y: 0, z: 0 }, log[0]!));
});

test('full drive from tee carries a par-3 distance and comes to rest', () => {
  const r = simulateShot(C, { x: 0, y: 0, z: 0 }, { angle: 0, power: 100 });
  console.log('full drive ends at z =', r.end.z.toFixed(1));
  assert.equal(r.outcome, 'rest');
  assert.ok(r.end.z > 110 && r.end.z < 160, `z=${r.end.z}`);
});

test('a straight putt with the right pace drops', () => {
  const s: GameState = { course: C, ball: { x: C.hole.x, y: 0, z: C.hole.z - 5 }, strokes: 1, holed: false, weather: CALM };
  const r = playShot(s, { angle: 0, power: 33 });
  assert.equal(r.outcome, 'holed');
  assert.equal(r.state.strokes, 2);
  assert.ok(r.state.holed);
});

test('out of bounds costs stroke and distance', () => {
  const s: GameState = { course: C, ball: { x: 0, y: 0, z: 0 }, strokes: 0, holed: false, weather: CALM };
  const r = playShot(s, { angle: -900, power: 100 }); // hard left
  assert.equal(r.outcome, 'oob');
  assert.deepEqual(r.state.ball, s.ball);
  assert.equal(r.state.strokes, 2);
});

const carryAndApex = (p: number[]) => {
  let carry = 0;
  let apex = 0;
  for (let i = 3; i < p.length; i += 3) {
    apex = Math.max(apex, p[i + 1] ?? 0);
    if (!carry && p[i + 1] === 0) carry = p[i + 2] ?? 0;
  }
  return { carry, apex };
};

test('omitted spin replays identically to zero spin', () => {
  const o = { x: 0, y: 0, z: 0 };
  assert.deepEqual(simulateShot(C, o, { angle: 12, power: 80 }), simulateShot(C, o, { angle: 12, power: 80, spinX: 0, spinY: 0 }));
});

test('backspin flies higher, carries further, and stops sooner than topspin', () => {
  const o = { x: 0, y: 0, z: 0 };
  const back = simulateShot(C, o, { angle: 0, power: 80, spinY: -100 });
  const plain = simulateShot(C, o, { angle: 0, power: 80 });
  const top = simulateShot(C, o, { angle: 0, power: 80, spinY: 100 });
  const [b, p, t] = [back, plain, top].map((r) => carryAndApex(r.path));
  assert.ok(b!.apex > p!.apex && p!.apex > t!.apex);
  assert.ok(b!.carry > p!.carry && p!.carry > t!.carry);
  assert.ok(back.end.z - b!.carry < plain.end.z - p!.carry, 'backspin should roll out less');
});

test('sidespin curves: +spinX goes right of target (-x from the tee), -spinX left', () => {
  const o = { x: 0, y: 0, z: 0 };
  assert.ok(simulateShot(C, o, { angle: 0, power: 70, spinX: 100 }).end.x < -3);
  assert.ok(simulateShot(C, o, { angle: 0, power: 70, spinX: -100 }).end.x > 3);
});

test('putts ignore spin', () => {
  const s = { x: C.hole.x, y: 0, z: C.hole.z - 8 };
  assert.deepEqual(simulateShot(C, s, { angle: 30, power: 40 }), simulateShot(C, s, { angle: 30, power: 40, spinX: 90, spinY: -90 }));
});

test('headwind shortens carry, tailwind lengthens it, crosswind drifts downwind', () => {
  const o = { x: 0, y: 0, z: 0 };
  const shot = { angle: 0, power: 80 };
  const carry = (windX: number, windZ: number) => carryAndApex(simulateShot(C, o, shot, { windX, windZ, rain: 0 }).path).carry;
  assert.ok(carry(0, -8) < carry(0, 0) - 5);
  assert.ok(carry(0, 8) > carry(0, 0) + 5);
  assert.ok(simulateShot(C, o, shot, { windX: 8, windZ: 0, rain: 0 }).end.x > 3);
});

test('rain shortens the roll-out and wind does not touch putts', () => {
  const o = { x: 0, y: 0, z: 0 };
  const dry = simulateShot(C, o, { angle: 0, power: 80 });
  const wet = simulateShot(C, o, { angle: 0, power: 80 }, { windX: 0, windZ: 0, rain: 1 });
  assert.ok(wet.end.z - carryAndApex(wet.path).carry < dry.end.z - carryAndApex(dry.path).carry);
  const g = { x: C.hole.x, y: 0, z: C.hole.z - 8 };
  assert.deepEqual(simulateShot(C, g, { angle: 0, power: 40 }), simulateShot(C, g, { angle: 0, power: 40 }, { windX: 9, windZ: -9, rain: 0 }));
});

test('replay with weather is deterministic and differs from calm', () => {
  const log = [{ angle: 10, power: 85, spinY: -40 }, { angle: -20, power: 30 }];
  const storm = { windX: -6.5, windZ: 3.2, rain: 0.8 };
  assert.deepEqual(replay(C, log, storm), replay(C, log, storm));
  assert.notDeepEqual(replay(C, log, storm).ball, replay(C, log).ball);
});

test('daily holes: same day gives the same hole, days differ, and every hole is finishable', () => {
  assert.deepEqual(generateDaily('2026-11-20'), generateDaily('2026-11-20'));
  assert.notDeepEqual(generateDaily('2026-11-20').course, generateDaily('2026-11-21').course);
  for (let d = 0; d < 14; d++) {
    const day = new Date(Date.UTC(2026, 10, 18 + d)).toISOString().slice(0, 10);
    const { course, weather, number } = generateDaily(day);
    assert.equal(number, d + 1);
    assert.ok(solve(course, weather, course.par + 1) <= course.par + 1, day);
  }
});

test('parseShots accepts client logs and rejects anything else', () => {
  assert.deepEqual(parseShots([{ angle: 27, power: 69 }]), [{ angle: 27, power: 69, spinX: 0, spinY: 0 }]);
  for (const bad of [null, [], {}, [null], [{ angle: 1.5, power: 50 }], [{ angle: 0, power: 101 }], [{ angle: 0 }],
    [{ angle: 0, power: 50, spinX: 200 }], [{ angle: '0', power: 50 }], Array(41).fill({ angle: 0, power: 1 })])
    assert.equal(parseShots(bad), null, JSON.stringify(bad));
});
