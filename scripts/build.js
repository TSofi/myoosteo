// Copies the static site into dist/ for deployment (used by Vercel).
// Usage: npm run build
import { cp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const dist = join(root, 'dist');
const files = ['index.html', 'src', 'data', 'LICENSE', 'ASSETS.md'];

await rm(dist, { recursive: true, force: true });
for (const file of files) {
  await cp(join(root, file), join(dist, file), { recursive: true });
}
console.log(`Built ${files.join(', ')} into dist/`);
