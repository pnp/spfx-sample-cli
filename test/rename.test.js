import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { renameSpfxProject } from '../dist/cli.js';

async function mkTmpProject() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'spfx-test-'));
  // create minimal SPFx project files
  const pkg = { name: 'old-package-name' };
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify(pkg, null, 2));

  const yo = { "@microsoft/generator-sharepoint": { libraryName: 'old-package-name', solutionName: 'old-package-name Solution', libraryId: '11111111-1111-1111-1111-111111111111' } };
  await fs.writeFile(path.join(root, '.yo-rc.json'), JSON.stringify(yo, null, 2));

  await fs.mkdir(path.join(root, 'config'));
  const ps = { solution: { name: 'old-package-name Solution', id: '11111111-1111-1111-1111-111111111111' } };
  await fs.writeFile(path.join(root, 'config', 'package-solution.json'), JSON.stringify(ps, null, 2));

  await fs.writeFile(path.join(root, 'README.md'), 'This references old-package-name in docs');

  return root;
}

test('renameSpfxProject updates files correctly', async () => {
  const root = await mkTmpProject();
  await renameSpfxProject(root, { rename: 'new-name', newId: '22222222-2222-2222-2222-222222222222' });

  const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.name, 'new-name');

  const yo = JSON.parse(await fs.readFile(path.join(root, '.yo-rc.json'), 'utf8'));
  const gen = yo['@microsoft/generator-sharepoint'];
  assert.equal(gen.libraryName, 'new-name');
  assert.equal(gen.solutionName, 'new-name');
  assert.equal(gen.libraryId, '22222222-2222-2222-2222-222222222222');

  const ps = JSON.parse(await fs.readFile(path.join(root, 'config', 'package-solution.json'), 'utf8'));
  assert.equal(ps.solution.name, 'new-name Solution');
  assert.equal(ps.solution.id, '22222222-2222-2222-2222-222222222222');

  const readme = await fs.readFile(path.join(root, 'README.md'), 'utf8');
  assert.ok(readme.includes('new-name'));
});

test('postProcessProject applies rename via public API', async () => {
  const { postProcessProject } = await import('../dist/cli.js');
  const root = await mkTmpProject();
  await postProcessProject(root, { rename: 'another-name' }, undefined);

  const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.name, 'another-name');
});
