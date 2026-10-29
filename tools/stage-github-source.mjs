import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(await readFile(join(root, 'release/manifests/github-source-files.json'), 'utf8'));
assert.equal(manifest.schema, 'feitu-world/github-source-files/v1');
assert.ok(Array.isArray(manifest.include) && manifest.include.length);
const selected = new Map();
const forbidden = /(^|\/)(?:node_modules|\.git|\.aws|\.codex|\.agents|saves|logs|reports|\.dsh|\.preview-saves)(\/|$)|(?:^|\/)\.env(?:\.|$)|apikey|vault|\.log$|我在废土世界扫垃圾.*\.txt$/i;
async function collect(name) {
  assert.ok(typeof name === 'string' && !isAbsolute(name) && !win32.isAbsolute(name));
  assert.ok(name.split('/').every((part) => part && part !== '.' && part !== '..' && !/[\\:]/.test(part)));
  assert.ok(!forbidden.test(name), `Forbidden publication path: ${name}`);
  let path = root;
  for (const part of name.split('/')) {
    path = join(path, part);
    assert.ok(!(await lstat(path)).isSymbolicLink(), `Linked publication path: ${name}`);
  }
  const info = await lstat(path);
  if (info.isDirectory()) {
    for (const entry of (await readdir(path)).sort()) await collect(`${name}/${entry}`);
  } else {
    assert.ok(info.isFile(), `Publication input is not a file: ${name}`);
    const bytes = await readFile(path);
    assert.ok(bytes.length < 50 * 1024 * 1024, `Oversized source input: ${name}`);
    if (!/\.(?:png|ico)$/i.test(name)) {
      assert.ok(!/sk-[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}/.test(bytes.toString('utf8')), `Credential-shaped content: ${name}`);
    }
    selected.set(name, bytes);
  }
}
for (const name of manifest.include) await collect(name);
const output = join(root, 'release/build', `github-source-${Date.now()}`);
assert.ok(relative(root, output).startsWith('release'));
await mkdir(dirname(output), { recursive: true });
await mkdir(output, { recursive: false });
const files = [];
for (const [name, bytes] of [...selected].sort(([a], [b]) => a.localeCompare(b, 'en'))) {
  const target = resolve(output, ...name.split('/'));
  assert.ok(relative(output, target) && !relative(output, target).startsWith('..'));
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, bytes, { flag: 'wx' });
  files.push({ path: name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
}
const record = { schema: 'feitu-world/github-source-snapshot/v1', output, fileCount: files.length,
  totalBytes: files.reduce((total, file) => total + file.bytes, 0), files };
await writeFile(`${output}.json`, `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx' });
await writeFile(`${output}.paths`, Buffer.from(`${files.map((file) => file.path).join('\0')}\0`), { flag: 'wx' });
console.log(JSON.stringify({ output, fileCount: record.fileCount, totalMiB: +(record.totalBytes / 1048576).toFixed(2),
  manifest: `${output}.json`, gitPathspec: `${output}.paths` }, null, 2));
