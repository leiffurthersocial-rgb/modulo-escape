import './style.css';
import { startGame } from './game/game.ts';

startGame(document.getElementById('app') ?? document.body).catch((err: unknown) => {
  console.error(err);
  const el = document.createElement('pre');
  el.style.cssText = 'position:fixed;inset:0;margin:0;padding:24px;color:#f88;background:#111;white-space:pre-wrap;z-index:999';
  el.textContent = `Modulo: Escape failed to start.\n\n${err instanceof Error ? err.stack ?? err.message : String(err)}`;
  document.body.appendChild(el);
});
