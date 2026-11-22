import type { Daily, Shot } from './golf';

export type Stats = { played: number; streak: number; bestStreak: number };
/** A player's best round on a day; tries = rounds they had started when they set it. */
export type Entry = { rank: number; username: string; strokes: number; tries: number };

/** GET /api/init: the hole this post is for, plus the viewer's result on it (if they already finished). */
export type InitResponse = {
  daily: Daily;
  username: string | null;
  mine: Entry | null;
  stats: Stats | null;
  players: number;
};

/** POST /api/score. Only the shot log is sent; the server replays it to get the score. */
export type ScoreRequest = { shots: Shot[] };
/** strokes/tries: this round. improved: it became the viewer's best (mine). */
export type ScoreResponse = { mine: Entry; improved: boolean; strokes: number; tries: number; players: number; stats: Stats };
export type StartResponse = { tries: number };

export type LeaderboardResponse = { top: Entry[]; mine: Entry | null; players: number };

export type ErrorResponse = { status: 'error'; message: string };
