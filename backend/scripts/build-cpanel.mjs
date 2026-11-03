import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  rmSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const backendDir = path.resolve(scriptDir, '..');
const projectRoot = path.resolve(backendDir, '..');

const frontendDir = path.join(projectRoot, 'frontend');
const frontendDist = path.join(frontendDir, 'dist');
const publicDir = path.join(backendDir, 'public');

function runNpm(args, cwd, extraEnv = {}) {
  const command = process.platform === 'win32' ? 'npm.cmd' : 'npm';

  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    env: { ...process.env, ...extraEnv },
    shell: process.platform === 'win32',
  });

  if (result.error) throw result.error;

  if (result.status !== 0) {
    throw new Error(`npm ${args.join(' ')} failed in ${cwd}`);
  }
}

try {
  console.log('\n[1/5] Installing backend dependencies...');
  runNpm(['ci', '--include=dev'], backendDir);

  console.log('\n[2/5] Installing frontend dependencies...');
  runNpm(['ci', '--include=dev'], frontendDir);

  console.log('\n[3/5] Building frontend...');
  runNpm(['run', 'build'], frontendDir, {
    VITE_BASE_PATH: '/',
  });

  if (!existsSync(path.join(frontendDist, 'index.html'))) {
    throw new Error('Frontend build did not produce index.html');
  }

  console.log('\n[4/5] Copying frontend into backend/public...');
  rmSync(publicDir, { recursive: true, force: true });
  mkdirSync(publicDir, { recursive: true });
  cpSync(frontendDist, publicDir, { recursive: true });

  console.log('\n[5/5] Building backend...');
  runNpm(['run', 'build:server'], backendDir);

  if (!existsSync(path.join(backendDir, 'dist', 'index.js'))) {
    throw new Error('Backend build did not produce dist/index.js');
  }

  console.log('\nSENSOURA production build completed successfully.');

} catch (error) {
  console.error('\nSENSOURA build failed:', error);
  process.exitCode = 1;
}