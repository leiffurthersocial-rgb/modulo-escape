/** Print a generated building as ASCII. Usage: tsx scripts/dump-level.ts --seed abc --size medium */
import { asciiBuilding, generateBuilding, isLevelSize } from '../src/gen/index.ts';

const args = process.argv.slice(2);
const get = (k: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
const seed = get('--seed') ?? 'kzu';
const sizeArg = get('--size');
const size = isLevelSize(sizeArg) ? sizeArg : 'medium';
const t0 = performance.now();
const b = generateBuilding(seed, size);
const ms = performance.now() - t0;
console.log(asciiBuilding(b));
console.log({ seed, size, ms: +ms.toFixed(1), ...b.stats, stairsAt: b.stairs, start: b.start, exit: b.exit });
