import { requestExpandedMode } from '@devvit/web/client';
import { holeLength, weatherWord } from '../shared/golf';
import type { InitResponse } from '../shared/api';

function byId<T extends HTMLElement>(id: string, type: new () => T): T {
  const el = document.getElementById(id);
  if (!(el instanceof type)) throw new Error(`splash.html is missing #${id}`);
  return el;
}
const eyebrow = byId('eyebrow', HTMLElement);
const title = byId('title', HTMLElement);
const facts = byId('facts', HTMLElement);
const you = byId('you', HTMLElement);
const startButton = byId('start-button', HTMLButtonElement);

startButton.addEventListener('click', (e) => requestExpandedMode(e, 'game'));

async function init() {
  const res = await fetch('/api/init');
  if (!res.ok) return; // keep the generic card; the game itself still loads
  const { daily, mine, stats, players }: InitResponse = await res.json();
  const date = new Date(`${daily.day}T00:00:00Z`).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
  eyebrow.textContent = `Daily Golf · ${date}`;
  title.textContent = `Hole #${daily.number}`;
  facts.textContent = `Par ${daily.course.par} · ${holeLength(daily)} m · ${weatherWord(daily.weather)} · ${players} ${players === 1 ? 'player' : 'players'}`;
  if (mine) {
    const streak = stats && stats.streak > 1 ? ` · ${stats.streak}-day streak` : '';
    you.textContent = `Your best: ${mine.strokes} strokes in ${mine.tries} ${mine.tries === 1 ? 'try' : 'tries'} · #${mine.rank}${streak}`;
    you.hidden = false;
    startButton.textContent = 'Play again';
  } else if (stats && stats.streak > 0) {
    you.textContent = `Keep your ${stats.streak}-day streak going`;
    you.hidden = false;
  }
}
void init().catch(() => {});
