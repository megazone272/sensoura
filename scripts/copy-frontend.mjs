import {
  cpSync,
  existsSync,
  mkdirSync,
  rmSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, '..');
const frontendDist = path.join(root, 'frontend', 'dist');
const distPublic = path.join(root, 'backend', 'dist', 'public');
const rootPublic = path.join(root, 'backend', 'public');

if (!existsSync(path.join(frontendDist, 'index.html'))) {
  throw new Error('Frontend build did not produce index.html');
}

for (const targetDir of [distPublic, rootPublic]) {
  mkdirSync(targetDir, { recursive: true });
  cpSync(frontendDist, targetDir, { recursive: true });
  if (!existsSync(path.join(targetDir, 'index.html'))) {
    throw new Error(`Frontend index.html missing from ${targetDir}`);
  }
}

console.log('Frontend copied successfully to backend/dist/public and backend/public');