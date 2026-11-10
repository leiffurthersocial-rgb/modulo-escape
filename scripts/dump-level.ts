/** Print a generated level as ASCII. Usage: tsx scripts/dump-level.ts --seed abc --size medium */
import { asciiMap, generateLevel, isLevelSize } from '../src/gen/index.ts';

const args = process.argv.slice(2);
const get = (k: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
const seed = get('--seed') ?? 'kzu';
const sizeArg = get('--size');
const size = isLevelSize(sizeArg) ? sizeArg : 'medium';
const t0 = performance.now();
const l = generateLevel(seed, size);
const ms = performance.now() - t0;
console.log(asciiMap(l));
console.log({ seed, size, ms: +ms.toFixed(1), ...l.stats, props: l.props.length, lights: l.lights.length, spawns: l.spawnPoints.length });
