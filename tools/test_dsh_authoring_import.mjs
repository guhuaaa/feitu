import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { importAuthorSourceText } from './dsh_authoring_adapters.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const ink = readFileSync(resolve(root, 'simulation/game_design/authoring/examples/one-line-last-train.sample.ink'), 'utf8');
const yarn = readFileSync(resolve(root, 'simulation/game_design/authoring/examples/one-line-last-train.sample.yarn'), 'utf8');
const inkSource = importAuthorSourceText(ink, { format: 'ink' });
const yarnSource = importAuthorSourceText(yarn, { format: 'yarn' });
assert.equal(inkSource.annotations.length, 3);
assert.equal(yarnSource.annotations.length, 3);
assert.equal(inkSource.annotations[0].node_id, 'NODE_002');
assert.equal(yarnSource.annotations[2].ooc_guard.includes('恢复窗口'), true);
assert.throws(() => importAuthorSourceText('=== NODE_002 ===\n# title: x\n# author_intent: y\n# ooc_guard: world_state = bad', { format: 'ink' }), /forbidden runtime mutation/);
const compiler = resolve(root, 'tools/compile_dsh_author_graph.mjs');
const tempRoot = mkdtempSync(join(tmpdir(), 'feitu-author-import-'));
try {
  for (const [format, sample] of [['ink', 'one-line-last-train.sample.ink'], ['yarn', 'one-line-last-train.sample.yarn']]) {
    const output = join(tempRoot, `${format}.graph.json`);
    const run = spawnSync(process.execPath, [compiler, '--input', resolve(root, 'simulation/game_design/authoring/examples', sample), '--format', format, '--output', output], { encoding: 'utf8' });
    assert.equal(run.status, 0, `${format} compiler failed: ${run.stdout}\n${run.stderr}`);
    const graph = JSON.parse(readFileSync(output, 'utf8'));
    assert.equal(graph.schema, 'feitu-author-graph/v1');
    assert.equal(graph.annotations.length, 3);
  }
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
console.log(JSON.stringify({ schema: 'feitu-world/author-import-test/v1', status: 'PASS', formats: ['ink', 'yarn-spinner'], annotations: 6, compiler_integration: true, forbidden_mutation_rejected: true }, null, 2));
