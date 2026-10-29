import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

// Isolate the real pure validator without executing the file-writing CLI.
const source = await readFile(new URL('../scripts/generate-steam-vdf.mjs', import.meta.url), 'utf8');
const match = source.match(/function requireNumericId\(name, value\) \{[\s\S]*?^\}/m);
assert.ok(match, 'Steamworks ID validator must remain directly testable.');
const requireNumericId = vm.runInNewContext(`(${match[0]})`, {}, { timeout: 1000 });

test('Steamworks application and depot IDs accept the complete positive uint32 range', () => {
  for (const name of ['app-id', 'depot-id']) {
    for (const value of ['1', '2147483648', '4294967294', '4294967295']) {
      assert.equal(requireNumericId(name, value), value);
    }
  }
});

test('Steamworks ID validator rejects overflow, SteamID64 and textual placeholders', () => {
  for (const value of [undefined, '', '0', '-1', '+1', '01', '1.5', '1e3',
    'YOUR_APP_ID', 'YOUR_DEPOT_ID', '4294967296', '76561199145042064', '9'.repeat(1000)]) {
    assert.throws(() => requireNumericId('app-id', value), /Steamworks ID/, String(value));
  }
});
