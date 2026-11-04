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
const publicDir = path.join(root, 'backend', 'dist', 'public');

if (!existsSync(path.join(frontendDist, 'index.html'))) {
  throw new Error('Frontend build did not produce index.html');
}

rmSync(publicDir, { recursive: true, force: true });
mkdirSync(publicDir, { recursive: true });
cpSync(frontendDist, publicDir, { recursive: true });

if (!existsSync(path.join(publicDir, 'index.html'))) {
  throw new Error('Frontend index.html missing from backend/dist/public');
}

console.log('Frontend copied successfully to backend/dist/public');