// Copies the Basis Universal transcoder shipped with three into public/basis.
// The F-22 GLB stores its textures as KTX2 (KHR_texture_basisu), and KTX2Loader
// fetches the transcoder from this folder at runtime.
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules/three/examples/jsm/libs/basis');
const dst = join(root, 'public/basis');

if (!existsSync(src)) {
  console.warn('[copy-basis] three is not installed yet, skipping');
  process.exit(0);
}
mkdirSync(dst, { recursive: true });
cpSync(src, dst, { recursive: true });
console.log('[copy-basis] basis transcoder -> public/basis');
