import { defineConfig, type Plugin } from 'vite';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';

/** Dev-only endpoint: the /lab "Pick" button writes src/config/materials.json directly. */
function labSave(): Plugin {
  return {
    name: 'lab-save',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__lab/save', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }
        let body = '';
        req.on('data', (c: Buffer) => (body += c.toString()));
        req.on('end', () => {
          try {
            const data = JSON.parse(body) as { picks: Record<string, string>; tuning: Record<string, { scale: number }> };
            const ok =
              data && typeof data.picks === 'object' && typeof data.tuning === 'object' &&
              Object.values(data.picks).every((v) => typeof v === 'string' && /^[\w-]+$/.test(v)) &&
              Object.values(data.tuning).every((t) => typeof t?.scale === 'number' && t.scale > 0 && t.scale < 10);
            if (!ok) throw new Error('invalid picks');
            void writeFile(resolve(import.meta.dirname, 'src/config/materials.json'), `${JSON.stringify({ picks: data.picks, tuning: data.tuning }, null, 2)}\n`).then(() => {
              res.statusCode = 200;
              res.end('ok');
            });
          } catch (e) {
            res.statusCode = 400;
            res.end(String(e));
          }
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [labSave()],
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 3000,
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        bench: resolve(import.meta.dirname, 'bench/index.html'),
        lab: resolve(import.meta.dirname, 'lab/index.html'),
        robin: resolve(import.meta.dirname, 'robin/index.html'),
      },
    },
  },
  worker: { format: 'es' },
  server: { host: true },
});
