import { expect, test, type Page } from '@playwright/test';

/** Collect console errors and page errors; tests fail if any appear. */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

const ready = (page: Page) => page.waitForFunction(() => (window as unknown as { __game?: { ready: boolean } }).__game?.ready, null, { timeout: 180_000 });
// CI renders on the CPU: use light presets so frames come back in reasonable time.

test('loads a fixed seed, enters the building, no console errors', async ({ page }, info) => {
  test.setTimeout(300_000);
  const errors = watchErrors(page);
  await page.goto('/?seed=kzu&size=small&quality=battery&monster=off');
  await ready(page);
  await expect(page.locator('#btn-enter')).toBeVisible();
  await page.screenshot({ path: `docs/screenshots/${info.project.name}-title.png` });

  // Touch controls are on by default everywhere now; tap only where the device can.
  const isTouch = !!info.project.use.hasTouch;
  if (isTouch) await page.tap('#btn-enter');
  else await page.click('#btn-enter');
  await page.waitForFunction(() => (window as any).__game.game.state === 'playing');
  // Walk forward a bit with the autopilot and turn on the flashlight.
  await page.evaluate(() => {
    const g = (window as any).__game.game;
    g.player.setFlashlight(true);
    g.autopilot.active = true;
  });
  await page.waitForTimeout(4000);
  await page.evaluate(() => (window as any).__game.game.autopilot.stop());
  await page.screenshot({ path: `docs/screenshots/${info.project.name}-play.png` });
  const moved = await page.evaluate(() => (window as any).__game.game.elapsedMs as number);
  expect(moved).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('same seed builds the same level in the browser', async ({ page }) => {
  await page.goto('/?seed=determinism&size=medium&quality=battery&monster=off');
  await ready(page);
  const a = await page.evaluate(() => JSON.stringify((window as any).__game.level.cells));
  await page.reload();
  await ready(page);
  const b = await page.evaluate(() => JSON.stringify((window as any).__game.level.cells));
  expect(a).toBe(b);
});

test('autopilot escapes a small building and sees the win screen', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'one full run is enough');
  test.setTimeout(720_000);
  const errors = watchErrors(page);
  // Software rendering in CI is slow and sim time is capped per frame: keep the canvas small.
  await page.setViewportSize({ width: 480, height: 300 });
  await page.goto('/?seed=kzu&size=small&quality=battery&monster=off');
  await ready(page);
  await page.click('#btn-enter');
  await page.evaluate(() => ((window as any).__game.game.autopilot.active = true));
  // Two floors: down the stairs and across the ground floor.
  await page.waitForFunction(() => (window as any).__game.game.state === 'won', null, { timeout: 700_000, polling: 2000 });
  await expect(page.getByText('You got out')).toBeVisible();
  await page.screenshot({ path: `docs/screenshots/${info.project.name}-win.png` });
  expect(errors).toEqual([]);
});

test('bench route produces results', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'desktop only');
  const errors = watchErrors(page);
  await page.goto('/bench/?frames=20&presets=low,battery&monster=off');
  test.setTimeout(300_000);
  await page.waitForFunction(() => (window as any).__bench?.done, null, { timeout: 280_000 });
  const results = await page.evaluate(() => (window as any).__bench.results as { preset: string; avgMs: number }[]);
  expect(results.map((r) => r.preset)).toEqual(['low', 'battery']);
  expect(results.every((r) => r.avgMs > 0)).toBe(true);
  expect(errors).toEqual([]);
});

test('texture lab loads and lists candidates', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'desktop only');
  test.setTimeout(300_000);
  const errors = watchErrors(page);
  await page.goto('/lab/?quality=battery');
  await page.waitForFunction(() => (window as any).__lab?.ready, null, { timeout: 280_000 });
  const n = await page.evaluate(() => (window as any).__lab.candidates('concrete_wall').length as number);
  expect(n).toBeGreaterThanOrEqual(8);
  expect(errors).toEqual([]);
});
