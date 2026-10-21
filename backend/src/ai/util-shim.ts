/**
 * Node.js >= 22 removed several deprecated `util` helpers
 * (isNullOrUndefined, isNull, isUndefined, ...).
 * @tensorflow/tfjs-node <= 4.22 still calls `util.isNullOrUndefined`,
 * so on modern Node it crashes with:
 *   TypeError: (0 , util_1.isNullOrUndefined) is not a function
 *
 * This shim restores the removed helpers onto the `util` module.
 * It must be imported BEFORE `@tensorflow/tfjs-node` is loaded.
 */
import * as util from 'node:util';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const utilModule = require('util') as Record<string, unknown>;

if (typeof utilModule.isNullOrUndefined !== 'function') {
  // Mirrors the legacy Node.js util.isNullOrUndefined semantics.
  utilModule.isNullOrUndefined = (v: unknown): boolean => v === null || v === undefined;
}
if (typeof utilModule.isNull !== 'function') {
  utilModule.isNull = (v: unknown): boolean => v === null;
}
if (typeof utilModule.isUndefined !== 'function') {
  utilModule.isUndefined = (v: unknown): boolean => v === undefined;
}
if (typeof utilModule.isBoolean !== 'function') {
  utilModule.isBoolean = (v: unknown): boolean => typeof v === 'boolean';
}
if (typeof utilModule.isNumber !== 'function') {
  utilModule.isNumber = (v: unknown): boolean => typeof v === 'number';
}
if (typeof utilModule.isString !== 'function') {
  utilModule.isString = (v: unknown): boolean => typeof v === 'string';
}
if (typeof utilModule.isSymbol !== 'function') {
  utilModule.isSymbol = (v: unknown): boolean => typeof v === 'symbol';
}
if (typeof utilModule.isArray !== 'function') {
  utilModule.isArray = (v: unknown): boolean => Array.isArray(v);
}
if (typeof utilModule.isFunction !== 'function') {
  utilModule.isFunction = (v: unknown): boolean => typeof v === 'function';
}
if (typeof utilModule.isBuffer !== 'function') {
  utilModule.isBuffer = (v: unknown): boolean =>
    typeof v === 'object' && v !== null && (v as { constructor?: { name?: string } }).constructor?.name === 'Buffer';
}

// Keep the ESM namespace in sync too (import * as util sees getters on the
// module namespace in some bundlers/transpilers).
const utilNs = util as unknown as Record<string, unknown>;
for (const key of Object.keys(utilModule)) {
  if (typeof utilModule[key] === 'function' && typeof utilNs[key] !== 'function') {
    try {
      Object.defineProperty(utilNs, key, {
        value: utilModule[key],
        writable: true,
        configurable: true,
      });
    } catch {
      // Ignore non-configurable namespace entries.
    }
  }
}

export const utilShimInstalled = true;
