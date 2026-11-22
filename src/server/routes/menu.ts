import { Hono } from 'hono';
import type { UiResponse } from '@devvit/web/shared';
import { context } from '@devvit/web/server';
import { publishDaily } from '../core/daily';

export const menu = new Hono();

/** Manual fallback for the cron: publishes today's hole, or opens it if it's already up. */
menu.post('/post-create', async (c) => {
  try {
    const { postId } = await publishDaily();
    return c.json<UiResponse>({ navigateTo: `https://reddit.com/r/${context.subredditName}/comments/${postId}` }, 200);
  } catch (error) {
    console.error(`Error creating post: ${error}`);
    return c.json<UiResponse>({ showToast: 'Failed to create post' }, 400);
  }
});
