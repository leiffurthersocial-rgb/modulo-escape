# SETUP

How to reproduce the dev environment (cloud session or your own machine).

## 1. Requirements
- Node.js ≥ 22.21 (for `NODE_USE_ENV_PROXY`; any Node ≥ 20 works without a proxy)
- `unzip` (ambientCG ships zips)
- **KTX-Software 4.3+** (`toktx`, `ktx`) — only for `assets:process`
- Chromium for Playwright (`npx playwright install chromium` on your own machine;
  the cloud container has it preinstalled)

## 2. Install
```bash
npm install
```

### KTX-Software (Linux x86_64, no root needed)
```bash
mkdir -p tools && curl -L -o tools/ktx.tar.bz2 https://github.com/KhronosGroup/KTX-Software/releases/download/v4.3.2/KTX-Software-4.3.2-Linux-x86_64.tar.bz2
```
```bash
tar xjf tools/ktx.tar.bz2 -C tools && mv tools/KTX-Software-4.3.2-Linux-x86_64 tools/ktx && rm tools/ktx.tar.bz2
```
The process script looks in `tools/ktx/bin`, then `$KTX_BIN_DIR`, then `PATH`.
On macOS use the `.pkg` installer from the same release page (installs to `/usr/local/bin`).

## 3. Common commands
| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server (game at `/`, benchmark at `/bench/`) |
| `npm test` | Vitest (generator: 1000+ seeds × 3 sizes) |
| `npm run e2e` | Playwright smoke tests + screenshots (builds first) |
| `npm run gen:dump -- --seed abc --size small` | ASCII dump of a generated level |
| `npm run assets:fetch -- search polyhaven textures concrete` | list candidates |
| `npm run assets:fetch -- search ambientcg textures "wet concrete"` | |
| `npm run assets:fetch -- search sketchfab models "school chair"` | CC0 / CC-BY only |
| `npm run assets:fetch -- fetch [--res 2k] [--only id] [--dry-run]` | download everything in `assets/asset-sources.json`, update `assets/LICENSES.json` |
| `npm run assets:process -- [--tiers 512,1k,2k,4k] [--only id] [--draco]` | KTX2 + GLB into `public/assets/`, size report per tier |

Downloads are cached in `.asset-cache/` (gitignored). API JSON is cached for 7 days.
Requests are rate-limited (≥ 500 ms per host, override with `ASSET_MIN_INTERVAL_MS`)
and retried with backoff on 429/5xx.

## 4. Network hosts the asset scripts need
`api.polyhaven.com`, `dl.polyhaven.org`, `ambientcg.com`,
`acg-download.struffelproductions.com`, `api.sketchfab.com`,
`sketchfab-prod-media.s3.amazonaws.com`, plus `github.com` /
`release-assets.githubusercontent.com` for KTX-Software.
In the Claude cloud session this is the `modulo-architect` environment.

## 5. Sketchfab token
Model downloads (not search) need a free Sketchfab API token
(sketchfab.com → Settings → Password & API). Locally:
```bash
export SKETCHFAB_API_TOKEN=your_token_here
```
In the cloud session it is saved as a network secret for `api.sketchfab.com`
and injected by the proxy, so it never appears in chat or in the repo.

## 6. Deploy (Vercel)
One-time: vercel.com → Add New → Project → import `modulo-escape` from GitHub →
framework "Vite" (auto-detected) → Deploy. `vercel.json` sets the build,
the `/bench` rewrite, immutable caching for `/assets/*` and the WASM/KTX2/GLB MIME types.
Every push then deploys automatically (branches get preview URLs).
