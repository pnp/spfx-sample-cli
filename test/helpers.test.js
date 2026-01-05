import test from 'node:test';
import { strict as assert } from 'node:assert';
import { normalizeSampleArg, parseGitVersion, versionGte, assertMethod, assertMode, isGuid } from '../dist/cli.js';

test('normalizeSampleArg removes samples/ and handles backslashes', () => {
  assert.equal(normalizeSampleArg('samples/react-hello'), 'react-hello');
  assert.equal(normalizeSampleArg('samples\\react-hello'), 'react-hello');
  assert.equal(normalizeSampleArg('react-hello'), 'react-hello');
});

test('parseGitVersion extracts semantic version', () => {
  const v = parseGitVersion('git version 2.34.1');
  assert.deepEqual(v, { major: 2, minor: 34, patch: 1 });
  assert.equal(parseGitVersion('notaversion'), null);
});

test('versionGte compares versions correctly', () => {
  const a = { major: 2, minor: 30, patch: 0 };
  const b = { major: 2, minor: 25, patch: 0 };
  const c = { major: 3, minor: 0, patch: 0 };
  assert.equal(versionGte(a, b), true);
  assert.equal(versionGte(b, a), false);
  assert.equal(versionGte(c, b), true);
});

test('assertMethod accepts valid values', () => {
  assert.equal(assertMethod(undefined), 'auto');
  assert.equal(assertMethod('auto'), 'auto');
  assert.equal(assertMethod('git'), 'git');
  assert.equal(assertMethod('api'), 'api');
  let threw = false;
  try { assertMethod('bad'); } catch (e) { threw = true; }
  assert.ok(threw);
});

test('assertMode accepts valid values', () => {
  assert.equal(assertMode(undefined), 'extract');
  assert.equal(assertMode('extract'), 'extract');
  assert.equal(assertMode('repo'), 'repo');
  let threw = false;
  try { assertMode('bad'); } catch (e) { threw = true; }
  assert.ok(threw);
});

test('isGuid validates GUIDs', () => {
  assert.ok(isGuid('3f2504e0-4f89-11d3-9a0c-0305e82c3301'));
  assert.ok(!isGuid('not-a-guid'));
});
