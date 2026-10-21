import { copyFile, mkdir, readFile, writeFile, rm, lstat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { PUBLIC_FILES } from './public-files.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const hash = createHash('sha256');
for (const file of PUBLIC_FILES) {
  const content = await readFile(path.join(root, file));
  hash.update(file).update(content);
}
const version = hash.digest('hex').slice(0, 12);
// Delete only the explicit generated output under this project. Refuse linked directories.
if (path.dirname(dist) !== root || path.basename(dist) !== 'dist') throw new Error('Unsafe build output');
try { if ((await lstat(dist)).isSymbolicLink()) throw new Error('dist must not be a symbolic link'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
for (const file of PUBLIC_FILES) {
  const target = path.join(dist, file);
  await mkdir(path.dirname(target), { recursive: true });
  if (file === 'sw.js') {
    const source = await readFile(path.join(root, file), 'utf8');
    if (!/const VERSION = 'dev-v\d+'/.test(source)) throw new Error('Missing service-worker version marker');
    await writeFile(target, source.replace(/const VERSION = 'dev-v\d+'/, `const VERSION = '${version}'`));
  } else await copyFile(path.join(root, file), target);
}
await writeFile(path.join(dist, '.nojekyll'), '');
console.log(`Built ${PUBLIC_FILES.length} public files → ${dist} (cache ${version})`);
