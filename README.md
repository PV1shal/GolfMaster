# GolfMaster
Reddit Golf Game

A daily golf hole on Reddit, built with Devvit Web and three.js. Every day at 00:00 UTC a new hole is generated and posted. Players swipe to swing and compete on the day's leaderboard: fewest strokes wins, and fewest tries breaks ties.

## Develop

Requires Node 22.

- `npm run login`: log in to Reddit (once)
- `npm run dev`: playtest on the dev subreddit
- `npm run test:unit`: physics, daily-hole and scoring tests
- `npm run deploy`: type-check, lint and upload the app

Built from Reddit's Devvit three.js starter; its license is in `LICENSE-devvit-template`.
