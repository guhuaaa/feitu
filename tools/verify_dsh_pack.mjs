import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const packageRoot = join(repoRoot, 'packages', 'dsh-feitu-world');
const releasePath = join(packageRoot, 'RELEASE_MANIFEST.json');
const release = JSON.parse(readFileSync(releasePath, 'utf8'));
const npmCommand = process.platform === 'win32' ? process.execPath : 'npm';
const cacheDir = mkdtempSync(join(repoRoot, '.npm-pack-cache-'));
const npmArgs = process.platform === 'win32'
  ? [join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'), 'pack', '--dry-run', '--json', '--cache', cacheDir]
  : ['pack', '--dry-run', '--json', '--cache', cacheDir];
let pack = null;
let error = null;
try {
  const raw = execFileSync(npmCommand, npmArgs, {
    cwd: packageRoot,
    encoding: 'utf8',
    timeout: 120_000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  pack = JSON.parse(raw)[0];
} catch (caught) {
  error = String(caught.stderr || caught.message).trim();
} finally {
  rmSync(cacheDir, { recursive: true, force: true });
}

const files = pack?.files?.map((file) => file.path) ?? [];
const forbiddenPatterns = [/^\.dsh\//, /^\.dsh-eval\//, /saves\//i, /我在废土世界扫垃圾/];
const missingRequired = (release.required_assets ?? []).filter((path) => !files.includes(path));
const forbidden = files.filter((path) => forbiddenPatterns.some((pattern) => pattern.test(path)));
const expectedEntryCount = release.pack_audit?.entry_count;
const checks = {
  entry_count: pack?.entryCount === expectedEntryCount,
  required_assets: missingRequired.length === 0,
  forbidden_content_absent: forbidden.length === 0,
  release_id: pack ? `${pack.name}@${pack.version}` === release.release_id : false,
};
const result = {
  schema: 'feitu-world/npm-pack-audit/v1',
  status: !error && Object.values(checks).every(Boolean) ? 'PASS' : 'FAIL',
  package: pack ? { id: `${pack.name}@${pack.version}`, entryCount: pack.entryCount, filename: pack.filename } : null,
  checks,
  missingRequired,
  forbidden,
  error,
};
console.log(JSON.stringify(result, null, 2));
if (result.status !== 'PASS') process.exitCode = 1;
