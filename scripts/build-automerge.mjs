import esbuild from 'esbuild';
import {copyFile, mkdir} from 'fs/promises';
import path from 'path';
import {fileURLToPath} from 'url';

await esbuild.build({
  entryPoints: ['scripts/automerge-entry.mjs'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2022'],
  minify: true,
  legalComments: 'none',
  outfile: 'public/automerge.js',
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
await mkdir(path.join(__dirname, '..', 'public'), { recursive: true });
await copyFile(
  path.join(__dirname, '..', 'node_modules/@automerge/automerge/dist/automerge.wasm'),
  path.join(__dirname, '..', 'public/automerge.wasm')
);
