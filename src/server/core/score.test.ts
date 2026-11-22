import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeScore, encodeScore } from './score.ts';

test('leaderboard order: fewer strokes, then fewer tries, then earlier', () => {
  const t = Date.UTC(2026, 10, 20, 12);
  assert.ok(encodeScore(3, 9, t + 5000) < encodeScore(4, 1, t)); // strokes beat tries
  assert.ok(encodeScore(3, 2, t + 5000) < encodeScore(3, 3, t)); // then tries beat time
  assert.ok(encodeScore(3, 2, t) < encodeScore(3, 2, t + 5000)); // then earlier wins
  assert.deepEqual(decodeScore(encodeScore(5, 12, t)), { strokes: 5, tries: 12 });
  assert.deepEqual(decodeScore(encodeScore(80, 50_000, Date.UTC(2040, 0, 1))), { strokes: 80, tries: 9999 });
});
