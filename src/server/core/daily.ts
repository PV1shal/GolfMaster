import { reddit, redis } from '@devvit/web/server';
import { dayKey, generateDaily, holeLength, prevDay, replay, weatherWord, type Daily, type Shot } from '../../shared/golf';
import type { Entry, Stats } from '../../shared/api';
import { decodeScore, encodeScore } from './score';

// Redis layout
//   daily:{day}        JSON Daily, frozen the first time it's generated so generator tweaks never change a past hole
//   daypost:{day}      postId of that day's published post
//   postday:{postId}   which day a post plays
//   lb:{day}           sorted set username -> each player's best round, see encodeScore (strokes, then tries, then time)
//   starts:{day}       hash username -> rounds started (a try = striking the first shot of a round)
//   finishes:{day}     hash username -> rounds finished
//   stats:{username}   hash played / streak / bestStreak / lastDay

export async function getDaily(day: string): Promise<Daily> {
  const saved = await redis.get(`daily:${day}`);
  if (saved) {
    const daily: Daily = JSON.parse(saved);
    return daily;
  }
  const daily = generateDaily(day);
  await redis.set(`daily:${day}`, JSON.stringify(daily), { nx: true });
  return daily;
}

/** Posts made by hand or before daily mode adopt the day they're first opened. */
export async function dayForPost(postId: string): Promise<string> {
  const day = await redis.get(`postday:${postId}`);
  if (day) return day;
  await redis.set(`postday:${postId}`, dayKey(), { nx: true });
  return (await redis.get(`postday:${postId}`)) ?? dayKey();
}

/** Creates the day's post once; later calls return the existing one. */
export async function publishDaily(day: string = dayKey()): Promise<{ postId: string; created: boolean }> {
  const existing = await redis.get(`daypost:${day}`);
  if (existing) return { postId: existing, created: false };
  const daily = await getDaily(day);
  // shortcut: two publishes racing in the same instant could both post; fine for one cron + manual menu.
  const post = await reddit.submitCustomPost({
    title: `Daily Golf #${daily.number} · Par ${daily.course.par} · ${holeLength(daily)} m · ${weatherWord(daily.weather)}`,
  });
  await Promise.all([redis.set(`daypost:${day}`, post.id), redis.set(`postday:${post.id}`, day)]);
  return { postId: post.id, created: true };
}

async function entryFor(day: string, username: string): Promise<Entry | null> {
  const [score, rank] = await Promise.all([redis.zScore(`lb:${day}`, username), redis.zRank(`lb:${day}`, username)]);
  if (score === undefined || rank === undefined) return null;
  return { rank: rank + 1, username, ...decodeScore(score) };
}

export async function getStats(username: string): Promise<Stats> {
  const h = await redis.hGetAll(`stats:${username}`);
  const today = dayKey();
  const alive = h.lastDay === today || h.lastDay === prevDay(today); // a missed day shows as 0 before the next finish resets it
  return { played: Number(h.played ?? 0), streak: alive ? Number(h.streak ?? 0) : 0, bestStreak: Number(h.bestStreak ?? 0) };
}

export async function playerView(day: string, username: string | undefined) {
  const [mine, stats, players] = await Promise.all([
    username ? entryFor(day, username) : null,
    username ? getStats(username) : null,
    redis.zCard(`lb:${day}`),
  ]);
  return { mine, stats, players };
}

export async function leaderboard(day: string, username: string | undefined, count = 10) {
  const [rows, view] = await Promise.all([
    redis.zRange(`lb:${day}`, 0, count - 1, { by: 'rank' }),
    playerView(day, username),
  ]);
  const top: Entry[] = rows.map((r, i) => ({ rank: i + 1, username: r.member, ...decodeScore(r.score) }));
  return { top, mine: view.mine, players: view.players };
}

/** Called when a round's first shot is struck, so restarting after a bad shot still costs a try. */
export async function startRound(day: string, username: string): Promise<number> {
  return redis.hIncrBy(`starts:${day}`, username, 1);
}

/**
 * Replays the log server-side (the sim is deterministic and shared), so the score can't be faked.
 * Keeps each player's best: a round replaces it only with fewer strokes (a later equal round has more tries).
 */
export async function submitScore(day: string, username: string, shots: Shot[]) {
  const daily = await getDaily(day);
  const end = replay(daily.course, shots, daily.weather);
  if (!end.holed) return null;

  const [finishes, starts, before] = await Promise.all([
    redis.hIncrBy(`finishes:${day}`, username, 1),
    redis.hGet(`starts:${day}`, username),
    entryFor(day, username),
  ]);
  // shortcut: a modified client could skip /api/start on abandoned rounds; each finish still counts as at least one try.
  const tries = Math.max(Number(starts ?? 0), finishes);
  const improved = !before || end.strokes < before.strokes;
  if (improved) await redis.zAdd(`lb:${day}`, { member: username, score: encodeScore(end.strokes, tries, Date.now()) });
  if (!before) {
    const h = await redis.hGetAll(`stats:${username}`);
    const last = h.lastDay ?? '';
    // Only finishing a newer day than the last one moves the streak; catching up on old posts just counts as played.
    const streak = day > last ? (last === prevDay(day) ? Number(h.streak ?? 0) + 1 : 1) : Number(h.streak ?? 0);
    await redis.hSet(`stats:${username}`, {
      played: String(Number(h.played ?? 0) + 1),
      streak: String(streak),
      bestStreak: String(Math.max(streak, Number(h.bestStreak ?? 0))),
      lastDay: day > last ? day : last,
    });
  }
  const view = await playerView(day, username);
  if (!view.mine || !view.stats) return null;
  return { mine: view.mine, improved, strokes: end.strokes, tries, players: view.players, stats: view.stats };
}
