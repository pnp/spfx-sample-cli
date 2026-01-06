import test from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { maybePrintNvmrcAdvice, getSpfxMatrix } from '../dist/cli.js';

// Helper to capture stdout and stderr
function captureStdout(fn) {
  const origOut = process.stdout.write;
  const origErr = process.stderr.write;
  let out = '';
  process.stdout.write = (chunk, enc, cb) => { out += chunk instanceof Buffer ? chunk.toString() : String(chunk); if (cb) cb(); return true; };
  process.stderr.write = (chunk, enc, cb) => { out += chunk instanceof Buffer ? chunk.toString() : String(chunk); if (cb) cb(); return true; };
  return Promise.resolve().then(() => fn()).then(() => { process.stdout.write = origOut; process.stderr.write = origErr; return out; }, (err) => { process.stdout.write = origOut; process.stderr.write = origErr; throw err; });
}

test('maybePrintNvmrcAdvice prints nvm instructions when .nvmrc present and major differs', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'spfx-test-'));
  const nvmrcPath = path.join(tmp, '.nvmrc');
  await fs.writeFile(nvmrcPath, 'v0.10.0\n', 'utf8');

  const out = await captureStdout(async () => { process.env.SPFX_SAMPLE_DEBUG = '1'; await maybePrintNvmrcAdvice(tmp); delete process.env.SPFX_SAMPLE_DEBUG; });
  assert.ok(out.includes('This sample suggests Node'));
  assert.ok(out.includes('Consider installing a Node version manager') || out.includes('nvm') || out.includes('nvs'));
});

test('getSpfxMatrix returns an array-like structure', async () => {
  const m = await getSpfxMatrix();
  assert.ok(m, 'matrix should be returned');
  assert.ok(Array.isArray(m) || typeof m === 'object');
});
