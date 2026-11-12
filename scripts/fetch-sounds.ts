/**
 * Recorded sound effects (CC0, Kenney "Impact Sounds" + "RPG Audio", via a GitHub mirror of
 * kenney.nl) → trimmed, mono MP3 (plays everywhere incl. iOS Safari) in public/assets/audio/,
 * plus a manifest (sounds.json) and LICENSES.json entries.
 *
 *   npm run sounds:fetch
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';

const MIRROR = 'https://raw.githubusercontent.com/ETdoFresh/kenney.nl/HEAD';
const RAW = '.asset-cache/sounds';
const OUT = 'public/assets/audio';

interface Group {
  id: string;
  pack: 'impact' | 'rpg';
  files: string[];
}
const n5 = (base: string) => [0, 1, 2, 3, 4].map((i) => `${base}_00${i}.ogg`);
const GROUPS: Group[] = [
  { id: 'step_concrete', pack: 'impact', files: n5('footstep_concrete') },
  { id: 'flesh_heavy', pack: 'impact', files: n5('impactSoft_heavy') },
  { id: 'punch_heavy', pack: 'impact', files: n5('impactPunch_heavy') },
  { id: 'metal_heavy', pack: 'impact', files: n5('impactMetal_heavy') },
  { id: 'metal_light', pack: 'impact', files: n5('impactMetal_light') },
  { id: 'plate_heavy', pack: 'impact', files: n5('impactPlate_heavy') },
  { id: 'cloth', pack: 'rpg', files: ['cloth1.ogg', 'cloth2.ogg', 'cloth3.ogg', 'cloth4.ogg'] },
  { id: 'creak', pack: 'rpg', files: ['creak1.ogg', 'creak2.ogg', 'creak3.ogg'] },
  { id: 'door_open', pack: 'rpg', files: ['doorOpen_1.ogg', 'doorOpen_2.ogg'] },
  { id: 'latch', pack: 'rpg', files: ['metalLatch.ogg'] },
];
const PACKS = {
  impact: { dir: 'kenney_impactsounds/Audio', name: 'Impact Sounds', url: 'https://kenney.nl/assets/impact-sounds' },
  rpg: { dir: 'kenney_rpgaudio/Audio', name: 'RPG Audio', url: 'https://kenney.nl/assets/rpg-audio' },
};

mkdirSync(RAW, { recursive: true });
mkdirSync(OUT, { recursive: true });
const manifest: Record<string, string[]> = {};
let total = 0;
for (const g of GROUPS) {
  const pack = PACKS[g.pack];
  manifest[g.id] = [];
  for (const [i, f] of g.files.entries()) {
    const raw = `${RAW}/${f}`;
    try {
      statSync(raw);
    } catch {
      const res = await fetch(`${MIRROR}/${pack.dir}/${f}`);
      if (!res.ok) throw new Error(`${f}: HTTP ${res.status}`);
      writeFileSync(raw, Buffer.from(await res.arrayBuffer()));
    }
    // Trim leading silence, mono, 44.1 kHz, ~96 kbps MP3.
    const tmp = `${RAW}/${g.id}_${i}.mp3`;
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', raw, '-af', 'silenceremove=start_periods=1:start_threshold=-55dB', '-ac', '1', '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', '96k', tmp]);
    const data = readFileSync(tmp);
    const hash = createHash('sha256').update(data).digest('hex').slice(0, 8);
    const name = `${g.id}_${i}.${hash}.mp3`;
    writeFileSync(`${OUT}/${name}`, data);
    manifest[g.id]!.push(`/assets/audio/${name}`);
    total += data.length;
  }
  console.log(`${g.id}: ${g.files.length} files`);
}
writeFileSync(`${OUT}/sounds.json`, JSON.stringify(manifest, null, 1) + '\n');

// Licences (shown in the in-game Credits).
const licPath = 'assets/LICENSES.json';
const lic = JSON.parse(readFileSync(licPath, 'utf8')) as { id: string }[];
for (const [key, pack] of Object.entries(PACKS)) {
  const id = `kenney_${key}_audio`;
  if (lic.some((e) => e.id === id)) continue;
  lic.push({
    id,
    source: 'url',
    kind: 'sound',
    category: 'sfx',
    name: `${pack.name} (sound effects)`,
    sourceUrl: pack.url,
    author: 'Kenney',
    license: 'CC0 1.0',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    attributionRequired: false,
  } as { id: string });
}
writeFileSync(licPath, JSON.stringify(lic, null, 2) + '\n');
console.log(`total ${(total / 1024).toFixed(0)} KB in ${OUT}`);
