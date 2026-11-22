import { Hono } from 'hono';
import { publishDaily } from '../core/daily';

export const scheduler = new Hono();

/** Cron (devvit.json, 00:00 UTC): publish today's hole. Idempotent, so a retried run won't double-post. */
scheduler.post('/daily-post', async (c) => {
  const { postId, created } = await publishDaily();
  console.log(`daily-post: ${created ? 'created' : 'already had'} ${postId}`);
  return c.json({ status: 'ok' }, 200);
});
