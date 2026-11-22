import { Hono } from 'hono';
import { context, reddit } from '@devvit/web/server';
import { parseShots } from '../../shared/golf';
import type { ErrorResponse, InitResponse, LeaderboardResponse, ScoreResponse, StartResponse } from '../../shared/api';
import { dayForPost, getDaily, leaderboard, playerView, startRound, submitScore } from '../core/daily';

export const api = new Hono();

const fail = (message: string) => ({ status: 'error', message }) satisfies ErrorResponse;

api.get('/init', async (c) => {
  const { postId } = context;
  if (!postId) return c.json(fail('postId missing from context'), 400);
  const day = await dayForPost(postId);
  const [daily, username] = await Promise.all([getDaily(day), reddit.getCurrentUsername()]);
  const view = await playerView(day, username);
  return c.json<InitResponse>({ daily, username: username ?? null, ...view });
});

api.post('/start', async (c) => {
  const { postId } = context;
  if (!postId) return c.json(fail('postId missing from context'), 400);
  const username = await reddit.getCurrentUsername();
  if (!username) return c.json(fail('Log in to post a score'), 401);
  return c.json<StartResponse>({ tries: await startRound(await dayForPost(postId), username) });
});

api.post('/score', async (c) => {
  const { postId } = context;
  if (!postId) return c.json(fail('postId missing from context'), 400);
  const username = await reddit.getCurrentUsername();
  if (!username) return c.json(fail('Log in to post a score'), 401);
  const body: unknown = await c.req.json().catch(() => null);
  const shots = parseShots(typeof body === 'object' && body !== null && 'shots' in body ? body.shots : null);
  if (!shots) return c.json(fail('Invalid shot log'), 400);
  const result = await submitScore(await dayForPost(postId), username, shots);
  if (!result) return c.json(fail('That round does not finish the hole'), 400);
  return c.json<ScoreResponse>(result);
});

api.get('/leaderboard', async (c) => {
  const { postId } = context;
  if (!postId) return c.json(fail('postId missing from context'), 400);
  const username = await reddit.getCurrentUsername();
  return c.json<LeaderboardResponse>(await leaderboard(await dayForPost(postId), username));
});
