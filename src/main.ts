import './style.css';
import { createGame, readUrlParams } from './game/game.ts';
import { UI } from './ui/ui.ts';

async function main() {
  const root = document.getElementById('app') ?? document.body;
  const ui = new UI(root);
  const { seed, size } = readUrlParams();
  ui.setLoadingText(`Generating building ${seed}…`);
  const game = await createGame(root, seed, size, { onState: (s, g) => ui.onState(s, g) });
  ui.attach(game);
  game.renderFrame(0);
  const w = window as unknown as { __game: unknown };
  w.__game = { game, level: game.level, ready: true };
}

main().catch((err: unknown) => {
  console.error(err);
  const el = document.createElement('pre');
  el.style.cssText = 'position:fixed;inset:0;margin:0;padding:24px;color:#f88;background:#111;white-space:pre-wrap;z-index:999';
  el.textContent = `Modulo: Escape failed to start.\n\n${err instanceof Error ? (err.stack ?? err.message) : String(err)}`;
  document.body.appendChild(el);
});
