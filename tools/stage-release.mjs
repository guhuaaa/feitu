import { cp, mkdir, readFile, rm, stat } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = join(projectRoot, 'release', 'manifests', 'release-files.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const sourceRoot = resolve(projectRoot, manifest.source_root);
const stagingRoot = resolve(projectRoot, manifest.staging_root);
const allowedParent = resolve(projectRoot, 'release', 'staging');

if (stagingRoot !== join(allowedParent, 'player-runtime')) {
  throw new Error(`Refusing to rebuild unexpected staging path: ${stagingRoot}`);
}
if (!stagingRoot.startsWith(`${allowedParent}${sep}`)) {
  throw new Error(`Staging path escaped release/staging: ${stagingRoot}`);
}

async function assertExists(path) {
  try {
    await stat(path);
  } catch {
    throw new Error(`Required release input is missing: ${relative(projectRoot, path)}`);
  }
}

await assertExists(sourceRoot);
for (const item of manifest.include) await assertExists(join(sourceRoot, item));
for (const item of manifest.root_documents) await assertExists(join(projectRoot, item));

await rm(stagingRoot, { recursive: true, force: true });
await mkdir(stagingRoot, { recursive: true });

for (const item of manifest.include) {
  await cp(join(sourceRoot, item), join(stagingRoot, item), { recursive: true });
}

const docsRoot = join(stagingRoot, 'docs');
await mkdir(docsRoot, { recursive: true });
for (const item of manifest.root_documents) {
  await cp(join(projectRoot, item), join(docsRoot, item));
}
await cp(join(projectRoot, 'release', 'RIGHTS_AND_COMPLIANCE.md'), join(docsRoot, 'RIGHTS_AND_COMPLIANCE.md'));

console.log(`STAGED ${relative(projectRoot, stagingRoot)}`);
console.log(`SOURCE ${relative(projectRoot, sourceRoot)}`);
console.log(`INCLUDED ${manifest.include.length + manifest.root_documents.length + 1} roots/files`);
