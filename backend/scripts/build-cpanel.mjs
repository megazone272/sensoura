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

const backendDist = path.join(backendDir, 'dist');
const publicDir = path.join(backendDist, 'public');

function runNpm(args, cwd, extraEnv = {}) {
  const npmCli = process.env.npm_execpath;

  if (!npmCli) {
    throw new Error(
      'npm_execpath is unavailable. Run this script through npm run build.'
    );
  }

  const nodeCommand = process.platform === 'win32' ? process.execPath : 'node';

  const result = spawnSync(nodeCommand, [npmCli, ...args], {
    cwd,
    stdio: 'inherit',
    env: { ...process.env, ...extraEnv },
  });

  if (result.error) throw result.error;

  if (result.status !== 0) {
    throw new Error(`npm ${args.join(' ')} failed in ${cwd}`);
  }
}

try {
  if (!existsSync(path.join(frontendDir, 'node_modules'))) {
    console.log('\n[1/4] Installing frontend dependencies...');
    runNpm(['ci', '--include=dev'], frontendDir);
  } else {
    console.log('\n[1/4] Frontend dependencies already installed, skipping reinstall...');
  }

  console.log('\n[2/4] Building frontend...');
  runNpm(['run', 'build'], frontendDir, {
    VITE_BASE_PATH: '/',
  });

  if (!existsSync(path.join(frontendDist, 'index.html'))) {
    throw new Error('Frontend build did not produce index.html');
  }

  console.log('\n[3/4] Building backend...');
  runNpm(['run', 'build:server'], backendDir);

  if (!existsSync(path.join(backendDist, 'index.js'))) {
    throw new Error('Backend build did not produce dist/index.js');
  }

  console.log('\n[4/4] Copying frontend into backend/dist/public and backend/public...');
  const rootPublic = path.join(backendDir, 'public');
  for (const targetDir of [publicDir, rootPublic]) {
    mkdirSync(targetDir, { recursive: true });
    cpSync(frontendDist, targetDir, { recursive: true });
    if (!existsSync(path.join(targetDir, 'index.html'))) {
      throw new Error(`Frontend index.html missing from ${targetDir}`);
    }
  }

  console.log('\nSENSOURA production build completed successfully.');
  console.log('Frontend location: dist/public and public');

} catch (error) {
  console.error('\nSENSOURA build failed:', error);
  process.exitCode = 1;
}