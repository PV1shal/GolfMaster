// Leaderboard order in one sorted-set number (lower ranks higher): strokes, then tries, then who got there first.
//   strokes * 1e12 + tries * 1e8 + seconds since launch
// tries caps at 9999 and the clock part lasts ~3 years; the largest value (~1e14) stays well under 2^53.
const LAUNCH_S = Date.UTC(2026, 10, 18) / 1000;
const MAX_TRIES = 9999;
const MAX_SECS = 99_999_999;

export function encodeScore(strokes: number, tries: number, nowMs: number): number {
  const secs = Math.min(MAX_SECS, Math.max(0, Math.floor(nowMs / 1000 - LAUNCH_S)));
  return strokes * 1e12 + Math.min(MAX_TRIES, Math.max(1, tries)) * 1e8 + secs;
}

export const decodeScore = (score: number): { strokes: number; tries: number } => ({
  strokes: Math.floor(score / 1e12),
  tries: Math.floor((score % 1e12) / 1e8),
});
