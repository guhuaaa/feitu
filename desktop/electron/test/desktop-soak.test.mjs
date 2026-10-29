import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertSoakCoverage, assertSoakExit, parseSoakArgs, readSoakBuildBinding, readSoakPhaseReport, summarizeMemory } from '../../../tools/soak-desktop.mjs';

test('duration alone cannot replace a continuous journey through locations, inventory and ending', () => {
  const coverage = { visitedLocationIds: ['L001', 'L002', 'L003', 'L004', 'L005', 'L006'],
    newItemIds: ['I006', 'I004', 'I005'], endingIds: ['END_01'], maxRunTurn: 22, maxRunActionCount: 30, completedJourneyCount: 1 };
  assert.doesNotThrow(() => assertSoakCoverage({ coverage }));
  assert.throws(() => assertSoakCoverage({ elapsedMs: 3600000 }), /COVERAGE_INCOMPLETE/);
  for (const key of Object.keys(coverage)) {
    const changed = structuredClone(coverage); changed[key] = Array.isArray(changed[key]) ? changed[key].slice(1) : 0;
    assert.throws(() => assertSoakCoverage({ coverage: changed }), /COVERAGE_INCOMPLETE/);
  }
});

test('acceptance binds to the exact candidate rather than its reusable local version', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'feitu-soak-build-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, 'resources'));
  const infoPath = join(directory, 'resources', 'build-info.json');
  const info = { version: '0.2.5', distribution: 'steam', sourceFingerprint: 'a'.repeat(64), builtAt: 'test' };
  await writeFile(infoPath, JSON.stringify(info));
  await writeFile(join(directory, 'resources', 'app.asar'), 'first-package');
  await writeFile(join(directory, 'checksums.sha256'), 'first-checksums');
  const binding = await readSoakBuildBinding(directory, '0.2.5', 'steam');
  assert.equal(binding.sourceFingerprint, info.sourceFingerprint);
  await writeFile(join(directory, 'resources', 'app.asar'), 'second-package');
  assert.notEqual((await readSoakBuildBinding(directory, '0.2.5', 'steam')).appAsarSha256, binding.appAsarSha256);
  await assert.rejects(readSoakBuildBinding(directory, '0.2.4', 'steam'), /BUILD_MISMATCH/);
  await assert.rejects(readSoakBuildBinding(directory, '0.2.5', 'github'), /BUILD_MISMATCH/);
  await writeFile(infoPath, JSON.stringify({ ...info, sourceFingerprint: 'invalid' }));
  await assert.rejects(readSoakBuildBinding(directory, '0.2.5', 'steam'), /BUILD_MISMATCH/);
});

test('soak defaults to 60-minute actual Steam candidate and accepts an explicit pilot', () => {
  assert.deepEqual(parseSoakArgs([]), { channel: 'steam', minutes: 60, development: false });
  assert.deepEqual(parseSoakArgs(['--channel', 'github', '--minutes', '1', '--development']), {
    channel: 'github', minutes: 1, development: true
  });
});

test('soak rejects unbounded, duplicate, incomplete and arbitrary launch options', () => {
  for (const args of [['--minutes', '0'], ['--minutes', '241'], ['--minutes', '1.5'],
    ['--minutes', 'NaN'], ['--minutes'], ['--channel', 'other'], ['--channel'],
    ['--minutes', '60', '--minutes', '1'], ['--development', '--development'],
    ['--user-data-dir', '../real-saves']]) assert.throws(() => parseSoakArgs(args));
});

test('memory summary uses sampled concurrent process totals and labels its limits', () => {
  const samples = [
    { workingSetBytes: 100 * 1048576, privateBytes: 80 * 1048576, processCount: 3 },
    { workingSetBytes: 130 * 1048576, privateBytes: 110 * 1048576, processCount: 4 },
    { workingSetBytes: 120 * 1048576, privateBytes: 100 * 1048576, processCount: 3 }
  ];
  const summary = summarizeMemory(samples);
  assert.equal(summary.sampleCount, 3);
  assert.equal(summary.observedPeakWorkingSetMiB, 130);
  assert.equal(summary.observedPeakPrivateMiB, 110);
  assert.equal(summary.finalWorkingSetMiB, 120);
  assert.match(summary.note, /not a continuous OS high-water mark/);
  assert.throws(() => summarizeMemory([]));
  assert.throws(() => summarizeMemory([{ workingSetBytes: -1, privateBytes: 0, processCount: 1 }]));
});

test('zero exit cannot hide a probe failure behind the subsequent startup error', () => {
  const log = [{ event: 'desktop_soak_failure', code: 'DESKTOP_SOAK_CHECK_FAILED', stage: 'capture_start' },
    { event: 'desktop_startup_error', message: 'untrusted error text' }].map(JSON.stringify).join('\n');
  assert.throws(() => assertSoakExit('run', { code: 0 }, log), /DESKTOP_SOAK_CHECK_FAILED: mode=run, stage=capture_start/);
  assert.throws(() => assertSoakExit('run', { code: 9 }, ''), /did not exit cleanly/);
  assert.throws(() => assertSoakExit('resume', { code: 0 }, '{"event":"desktop_soak_timeout"}'), /DESKTOP_SOAK_TIMEOUT/);
});

test('absent probe output has a stage error instead of a filesystem ENOENT', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'feitu-soak-output-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await assert.rejects(readSoakPhaseReport(join(directory, 'desktop-soak.json')), /^Error: DESKTOP_SOAK_OUTPUT_MISSING$/);
});

test('failure diagnostics discard arbitrary messages and unsafe code or stage values', () => {
  const secret = 'private-credential-and-story-value';
  for (const code of [secret, 'DESKTOP_SOAK_PRIVATE_KEY']) {
    const log = JSON.stringify({ event: 'desktop_soak_failure', code, stage: secret, message: secret, stack: secret });
    assert.throws(() => assertSoakExit('run', { code: 0 }, log), (error) => {
      assert.equal(error.message, 'DESKTOP_SOAK_CHECK_FAILED: mode=run, stage=unknown');
      assert.equal(error.stack.includes(secret), false);
      assert.equal(error.message.includes('PRIVATE_KEY'), false);
      return true;
    });
  }
});
