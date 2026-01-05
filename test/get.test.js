import test from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { getCommandHandler } from '../dist/cli.js';

async function mkTmpDir() {
  return await fs.mkdtemp(path.join(os.tmpdir(), 'spfx-get-'));
}

test('getCommandHandler uses API download when git unavailable', async () => {
  const tmp = await mkTmpDir();
  let downloaded = false;
  const fakeDownload = async (opts) => {
    downloaded = true;
    // create a package.json to simulate download
    await fs.writeFile(path.join(opts.destDir, 'package.json'), JSON.stringify({ name: 'downloaded' }, null, 2));
  };
  await getCommandHandler('react-hello-world', { method: 'auto', mode: 'extract', dest: tmp }, {
    download: fakeDownload,
    isGitAvailable: async () => false,
    ensureGit: async () => {},
    postProcess: async () => {},
    finalize: async () => {}
  });

  assert.ok(downloaded);
  const pkg = JSON.parse(await fs.readFile(path.join(tmp, 'package.json'), 'utf8'));
  assert.equal(pkg.name, 'downloaded');
});

test('getCommandHandler throws when dest exists and not force', async () => {
  const tmp = await mkTmpDir();
  await fs.writeFile(path.join(tmp, 'existing.txt'), 'x');
  let threw = false;
  try {
    await getCommandHandler('react-hello-world', { method: 'api', mode: 'extract', dest: tmp }, {
      download: async () => {},
      isGitAvailable: async () => false,
      ensureGit: async () => {},
      postProcess: async () => {},
      finalize: async () => {}
    });
  } catch (e) {
    threw = true;
  }
  assert.ok(threw);
});

test('getCommandHandler accepts --force and overwrites', async () => {
  const tmp = await mkTmpDir();
  await fs.writeFile(path.join(tmp, 'existing.txt'), 'x');
  let downloaded = false;
  const fakeDownload = async (opts) => {
    downloaded = true;
    await fs.writeFile(path.join(opts.destDir, 'package.json'), JSON.stringify({ name: 'forced' }, null, 2));
  };
  await getCommandHandler('react-hello-world', { method: 'api', mode: 'extract', dest: tmp, force: true }, {
    download: fakeDownload,
    isGitAvailable: async () => false,
    ensureGit: async () => {},
    postProcess: async () => {},
    finalize: async () => {}
  });
  assert.ok(downloaded);
  const pkg = JSON.parse(await fs.readFile(path.join(tmp, 'package.json'), 'utf8'));
  assert.equal(pkg.name, 'forced');
});
