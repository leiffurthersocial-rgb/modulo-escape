/**
 * Frame-time monitor: feeds the Battery Saver suggestion and the opt-in quality watchdog.
 * Uses wall-clock frame intervals while playing (never while paused or hidden).
 */
import { bus } from '../core/events.ts';

export class PerfMonitor {
  private samples: number[] = [];
  private badSince = 0;
  private suggested = false;
  private lastLowered = 0;

  constructor() {
    // Battery API: Chromium only (Safari has none); used only as an extra hint.
    const nav = navigator as Navigator & { getBattery?: () => Promise<{ level: number; charging: boolean; addEventListener(t: string, f: () => void): void }> };
    void nav.getBattery?.().then((b) => {
      const check = () => {
        if (!this.suggested && !b.charging && b.level < 0.2) {
          this.suggested = true;
          bus.emit('perf:suggest', { reason: 'battery' });
        }
      };
      check();
      b.addEventListener('levelchange', check);
      b.addEventListener('chargingchange', check);
    }).catch(() => {});
  }

  reset() {
    this.samples = [];
    this.badSince = 0;
  }

  /**
   * @param frameMs measured interval
   * @param targetMs budget for the current cap (16.7 or 33.3)
   * @returns true if the watchdog wants one notch lower
   */
  push(frameMs: number, targetMs: number, now: number, isBattery: boolean, watchdog: boolean): boolean {
    this.samples.push(frameMs);
    if (this.samples.length > 180) this.samples.shift();
    if (this.samples.length < 90) return false;
    const sorted = [...this.samples].sort((a, b) => a - b);
    const avg = sorted.reduce((s, v) => s + v, 0) / sorted.length;
    const p95 = sorted[Math.floor(sorted.length * 0.95)]!;
    const bad = avg > targetMs * 1.45 || p95 > targetMs * 2.2;
    if (!bad) {
      this.badSince = 0;
      return false;
    }
    if (!this.badSince) this.badSince = now;
    const sustained = now - this.badSince;
    if (!this.suggested && !isBattery && sustained > 10000) {
      this.suggested = true;
      bus.emit('perf:suggest', { reason: 'frametime' });
    }
    if (watchdog && sustained > 6000 && now - this.lastLowered > 12000) {
      this.lastLowered = now;
      this.badSince = 0;
      this.samples = [];
      return true;
    }
    return false;
  }

  get stats(): { avg: number; p95: number } {
    const sorted = [...this.samples].sort((a, b) => a - b);
    if (!sorted.length) return { avg: 0, p95: 0 };
    return { avg: sorted.reduce((s, v) => s + v, 0) / sorted.length, p95: sorted[Math.floor(sorted.length * 0.95)]! };
  }
}
