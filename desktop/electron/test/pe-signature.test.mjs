import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as signatures from '../scripts/pe-signature.mjs';

test('only a valid signature with a signer certificate is accepted', () => {
  assert.equal(signatures.isValidAuthenticodeResult({ status: 'Valid', hasSignerCertificate: true }), true);
  assert.equal(signatures.isValidAuthenticodeResult({ status: 'Valid', hasSignerCertificate: false }), false);
  for (const status of ['NotSigned', 'HashMismatch', 'NotTrusted', 'NotSupportedFileFormat', 'Incompatible']) {
    assert.equal(signatures.isValidAuthenticodeResult({ status, hasSignerCertificate: true }), false);
  }
  for (const result of [{}, { status: 'UnknownError', hasSignerCertificate: false }, { status: 'Valid', hasSignerCertificate: 'true' }]) {
    assert.throws(() => signatures.isValidAuthenticodeResult(result));
  }
});

test('forged PE certificate-table fields do not establish a signature', { skip: process.platform !== 'win32' }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'feitu-signature-'));
  // Characters here are valid in Windows paths but meaningful to PowerShell code.
  const executable = join(directory, "forged '$()`; &.exe");
  try {
    const bytes = Buffer.alloc(1024);
    bytes.write('MZ');
    bytes.writeUInt32LE(64, 0x3c);
    bytes.write('PE\0\0', 64);
    bytes.writeUInt16LE(0x8664, 68);
    bytes.writeUInt16LE(240, 84);
    bytes.writeUInt16LE(0x20b, 88);
    bytes.writeUInt32LE(16, 88 + 108);
    bytes.writeUInt32LE(512, 88 + 112 + (4 * 8));
    bytes.writeUInt32LE(256, 88 + 112 + (4 * 8) + 4);
    await writeFile(executable, bytes);
    assert.equal(await signatures.hasAuthenticodeSignature(executable), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('missing executable fails verification instead of reporting unsigned', async () => {
  await assert.rejects(signatures.hasAuthenticodeSignature(join(tmpdir(), 'feitu-no-such-executable', 'missing.exe')));
});
