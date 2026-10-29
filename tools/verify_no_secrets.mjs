import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const ignoredDirectories = new Set([
  '.git', '.dsh-acceptance', '.dsh-eval', '.pnpm-store', '.npm-cache',
  'node_modules', '.venv', '.pytest_cache', '.hypothesis', '.browsercheck',
  '.workbuddy', 'sillytavern_bundle', 'dist', 'build',
]);
const binaryExtensions = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf', '.zip', '.tgz',
  '.woff', '.woff2', '.ttf', '.eot', '.mp3', '.mp4', '.db', '.sqlite',
  '.asar', '.bin', '.dat', '.dll', '.exe', '.node', '.pak',
]);
const secretPatterns = [
  /sk-[A-Za-z0-9]{20,}/g,
  /(?:DEEPSEEK_API_KEY|OPENAI_API_KEY)\s*[:=]\s*["']?sk-[A-Za-z0-9]{20,}/g,
];
const matches = [];

function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) walk(join(directory, entry.name));
      continue;
    }
    const path = join(directory, entry.name);
    if (binaryExtensions.has(path.slice(path.lastIndexOf('.')).toLowerCase())) continue;
    let stats;
    try { stats = statSync(path); } catch { continue; }
    if (stats.size > 2_000_000) continue;
    let text;
    try { text = readFileSync(path, 'utf8'); } catch { continue; }
    for (const pattern of secretPatterns) {
      for (const match of text.matchAll(pattern)) {
        const line = text.slice(0, match.index).split('\n').length;
        matches.push({ path: relative(root, path).replaceAll('\\', '/'), line, pattern: pattern.source });
      }
    }
  }
}

walk(root);
const result = {
  schema: 'feitu-world/secret-scan/v1',
  status: matches.length ? 'FAIL' : 'PASS',
  scanned_root: root,
  matches,
  note: 'Text-only scan; caches and binary assets are excluded.',
};
console.log(JSON.stringify(result, null, 2));
if (matches.length) process.exitCode = 1;
