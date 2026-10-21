import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, copyFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { PUBLIC_FILES } from '../scripts/public-files.mjs';

const exec = promisify(execFile);
test('build includes public assets only, removes stale output and versions offline cache by content', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'zk-build-test-'));
  // Every operation stays in a newly-created, task-owned temporary fixture.
  assert.equal(path.dirname(tempRoot), path.resolve(tmpdir()));
  try {
    await mkdir(path.join(tempRoot, 'scripts'));
    for (const file of ['build.mjs', 'public-files.mjs']) await copyFile(new URL(`../scripts/${file}`, import.meta.url), path.join(tempRoot, 'scripts', file));
    for (const file of PUBLIC_FILES) {
      const target = path.join(tempRoot, file);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, file === 'sw.js' ? "const VERSION = 'dev-v2';" : `public fixture: ${file}`);
    }
    await mkdir(path.join(tempRoot, 'supabase'));
    await writeFile(path.join(tempRoot, 'supabase', 'private.txt'), 'MUST NOT PUBLISH');
    await writeFile(path.join(tempRoot, '.env'), 'SECRET=MUST_NOT_PUBLISH');
    await mkdir(path.join(tempRoot, 'dist'));
    await writeFile(path.join(tempRoot, 'dist', 'stale-private.txt'), 'MUST BE REMOVED');
    const build = () => exec(process.execPath, [path.join(tempRoot, 'scripts', 'build.mjs')], { cwd: tempRoot });
    await build();
    const first = await readFile(path.join(tempRoot, 'dist', 'sw.js'), 'utf8');
    assert.match(first, /const VERSION = '[a-f0-9]{12}'/);
    const outputFiles = (await readdir(path.join(tempRoot, 'dist'), { recursive: true })).map(x => x.replaceAll('\\', '/'));
    assert.ok(!outputFiles.some(file => /private|\.env|supabase|README|tests/.test(file)));
    for (const file of PUBLIC_FILES) assert.ok(outputFiles.includes(file), file);
    await build();
    assert.equal(await readFile(path.join(tempRoot, 'dist', 'sw.js'), 'utf8'), first);
    await writeFile(path.join(tempRoot, 'app.js'), 'changed application');
    await build();
    assert.notEqual(await readFile(path.join(tempRoot, 'dist', 'sw.js'), 'utf8'), first);
  } finally {
    // Verified absolute temporary fixture, never the workspace or a derived parent.
    if (path.dirname(tempRoot) === path.resolve(tmpdir()) && path.basename(tempRoot).startsWith('zk-build-test-')) await rm(tempRoot, { recursive: true, force: true });
  }
});
