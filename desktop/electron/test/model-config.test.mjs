import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createModelConfig, ModelConfigError } from '../model-config.mjs';

const endpoint = 'https://api.example.test/v1/chat/completions';
const environment = { DEEPSEEK_API_KEY: 'environment-test-token', DEEPSEEK_MODEL: 'env-model', DEEPSEEK_API_BASE_URL: 'http://127.0.0.1:1234/chat/completions', UNRELATED: 'preserved' };
function encryptor(overrides = {}) {
  return {
    isAsyncEncryptionAvailable: async () => true,
    encryptStringAsync: async (value) => Buffer.from(`protected:${value}`),
    decryptStringAsync: async (value) => {
      const text = value.toString();
      if (!text.startsWith('protected:')) throw new Error('private-decryption-detail');
      return { result: text.slice('protected:'.length), shouldReEncrypt: false };
    },
    ...overrides,
  };
}
async function fixture(t, safeStorage = encryptor()) {
  const userDataPath = await mkdtemp(join(tmpdir(), 'feitu-model-config-'));
  t.after(() => rm(userDataPath, { recursive: true, force: true }));
  const configPath = join(userDataPath, 'model-settings.json');
  return { userDataPath, configPath, store: createModelConfig({ userDataPath, safeStorage }) };
}
const saveInput = (extra = {}) => ({ mode: 'saved', apiKey: 'local-test-token', model: 'deepseek-chat', endpoint, ...extra });
const assertSanitized = (value) => {
  const text = JSON.stringify(value);
  for (const secret of ['local-test-token', 'replacement-test-token', 'environment-test-token', 'protected:', 'private-decryption-detail', 'encryptedApiKey']) assert.equal(text.includes(secret), false);
};

test('default environment mode inherits every variable without mutating caller', async (t) => {
  const { store, userDataPath } = await fixture(t);
  const result = await store.applyToEnv(environment);
  assert.deepEqual(result, { env: environment });
  assert.notEqual(result.env, environment);
  const status = await store.getStatus(environment);
  assert.equal(status.mode, 'environment');
  assert.equal(status.environmentConfigured, true);
  assert.equal(status.configured, true);
  assert.equal(status.hasSavedKey, false);
  assertSanitized(status);
  assert.deepEqual(await readdir(userDataPath), []);
});

test('encrypts trimmed key, applies saved precedence, preserves empty key and replaces it', async (t) => {
  const { store, configPath } = await fixture(t);
  assertSanitized(await store.save(saveInput({ apiKey: '  local-test-token  ', model: ' deepseek-chat ', endpoint: ` ${endpoint} ` }), environment));
  const initial = JSON.parse(await readFile(configPath, 'utf8'));
  assert.equal((await readFile(configPath, 'utf8')).includes('local-test-token'), false);
  assert.equal(initial.apiKey, undefined);
  assert.deepEqual((await store.applyToEnv(environment)).env, { ...environment, DEEPSEEK_API_KEY: 'local-test-token', DEEPSEEK_MODEL: 'deepseek-chat', DEEPSEEK_API_BASE_URL: endpoint });
  await store.save(saveInput({ apiKey: '', model: 'deepseek-reasoner' }));
  assert.equal(JSON.parse(await readFile(configPath, 'utf8')).encryptedApiKey, initial.encryptedApiKey);
  await store.save(saveInput({ apiKey: 'replacement-test-token' }));
  assert.equal((await store.applyToEnv({})).env.DEEPSEEK_API_KEY, 'replacement-test-token');
  assertSanitized(await store.getStatus(environment));
});

test('offline mode removes only key and environment mode restores full inheritance', async (t) => {
  const { store } = await fixture(t);
  await store.save(saveInput());
  await store.save({ mode: 'offline', apiKey: '' });
  const offline = await store.applyToEnv(environment);
  const expected = { ...environment }; delete expected.DEEPSEEK_API_KEY;
  assert.deepEqual(offline, { env: expected });
  assert.equal(environment.DEEPSEEK_API_KEY, 'environment-test-token');
  assert.equal((await store.getStatus(environment)).configured, false);
  await store.save({ mode: 'environment' });
  assert.deepEqual(await store.applyToEnv(environment), { env: environment });
});

test('environment mode never replaces saved provider fields when switching back', async (t) => {
  const { store } = await fixture(t);
  const localModel = 'saved-provider-model';
  const other = { ...environment, DEEPSEEK_API_BASE_URL: 'https://other.example.test/chat/completions' };
  await store.save(saveInput({ model: localModel }));
  await store.save({ mode: 'environment' }, other);
  const status = await store.getStatus(other);
  assert.equal(status.model, localModel);
  assert.equal(status.endpoint, endpoint);
  assert.equal(status.environmentConfigured, true);
  assert.equal(status.hasSavedKey, true);
  assert.equal(status.error, undefined);
  assert.deepEqual(await store.applyToEnv(other), { env: other });
  await store.save({ mode: 'saved', apiKey: '', model: status.model, endpoint: status.endpoint }, other);
  assert.deepEqual((await store.applyToEnv(other)).env, { ...other, DEEPSEEK_API_KEY: 'local-test-token', DEEPSEEK_MODEL: localModel, DEEPSEEK_API_BASE_URL: endpoint });
});

test('clearing saved key selects offline but clearing in environment mode retains it', async (t) => {
  const { store, configPath } = await fixture(t);
  await store.save(saveInput());
  const cleared = await store.clearKey(environment);
  assert.equal(cleared.mode, 'offline'); assert.equal(cleared.hasSavedKey, false);
  assert.equal(JSON.parse(await readFile(configPath, 'utf8')).encryptedApiKey, null);
  await assert.rejects(store.save({ mode: 'saved', apiKey: '' }), ModelConfigError);
  await store.save(saveInput({ mode: 'environment' }));
  assert.equal((await store.clearKey(environment)).mode, 'environment');
  assert.deepEqual(await store.applyToEnv(environment), { env: environment });
});

test('invalid inputs never replace existing encrypted configuration', async (t) => {
  const { store, configPath } = await fixture(t);
  await store.save(saveInput());
  const before = await readFile(configPath, 'utf8');
  const invalid = [
    { mode: 'unknown' }, { apiKey: 42 }, { apiKey: 'x'.repeat(4097) }, { apiKey: ' '.repeat(4097) }, { apiKey: '\n' }, { apiKey: 'private\u0000token' },
    { model: 'private\nmodel' }, { model: 'deepseek-chat\n' }, { model: 'a'.repeat(129) },
    { endpoint: 'http://api.example.test/chat/completions' }, { endpoint: 'https://api.example.test/v1' },
    { endpoint: 'https://private-token@api.example.test/chat/completions' },
    { endpoint: 'https://@api.example.test/chat/completions' },
    { endpoint: 'https://api.example.test/chat/completions?key=private-token' },
    { endpoint: 'https://api.example.test/chat/completions#private-token' },
    { endpoint: 'https://api.example.test/chat/completions?' }, { endpoint: 'https://api.example.test/chat/completions#' },
  ];
  for (const value of invalid) {
    await assert.rejects(store.save(saveInput(value)), (error) => error.name === 'ModelConfigError' && !error.message.includes('private'));
    assert.equal(await readFile(configPath, 'utf8'), before);
  }
});

test('corrupt, malicious and oversized files fail offline without reflecting content and can be reset', async (t) => {
  const { store, configPath } = await fixture(t);
  for (const raw of ['{private-secret', 'x'.repeat(16385), JSON.stringify({ schema: 'feitu-world/model-settings/v1', mode: 'saved', model: 'private\nsecret', endpoint, encryptedApiKey: 'cHJpdmF0ZQ==' })]) {
    await writeFile(configPath, raw);
    const status = await store.getStatus(environment);
    assert.equal(status.mode, 'offline'); assert.equal(status.configured, false); assert.ok(status.error);
    assert.equal(JSON.stringify(status).includes('private'), false);
    const applied = await store.applyToEnv(environment);
    assert.equal(applied.env.DEEPSEEK_API_KEY, undefined); assert.ok(applied.warning);
    assert.equal(await readFile(configPath, 'utf8'), raw);
  }
  await store.save(saveInput());
  assert.equal((await store.getStatus({})).configured, true);
});

test('decrypt failure preserves ciphertext and never falls back to inherited key', async (t) => {
  const { store, configPath, userDataPath } = await fixture(t);
  await store.save(saveInput());
  const original = await readFile(configPath, 'utf8');
  const broken = createModelConfig({ userDataPath, safeStorage: encryptor({ decryptStringAsync: async () => { throw new Error('private-decryption-detail'); } }) });
  const status = await broken.getStatus(environment);
  assert.equal(status.configured, false); assert.ok(status.error); assertSanitized(status);
  const applied = await broken.applyToEnv(environment);
  assert.equal(applied.env.DEEPSEEK_API_KEY, undefined); assert.ok(applied.warning); assertSanitized({ warning: applied.warning });
  await assert.rejects(broken.save(saveInput({ apiKey: '' })), ModelConfigError);
  assert.equal(await readFile(configPath, 'utf8'), original);
});

test('unavailable encryption and encryption errors cannot write plaintext or replace old settings', async (t) => {
  const { store, userDataPath, configPath } = await fixture(t);
  await store.save(saveInput());
  const original = await readFile(configPath, 'utf8');
  for (const safeStorage of [encryptor({ isAsyncEncryptionAvailable: async () => false }), encryptor({ encryptStringAsync: async () => { throw new Error('private-encryption-detail'); } })]) {
    const broken = createModelConfig({ userDataPath, safeStorage });
    await assert.rejects(broken.save(saveInput({ apiKey: 'replacement-test-token' })), (error) => error.name === 'ModelConfigError' && !error.message.includes('private'));
    assert.equal(await readFile(configPath, 'utf8'), original);
  }
  const unavailable = createModelConfig({ userDataPath, safeStorage: encryptor({ isAsyncEncryptionAvailable: async () => false }) });
  assert.equal((await unavailable.getStatus({})).secureStorageAvailable, false);
  assert.equal((await unavailable.applyToEnv(environment)).env.DEEPSEEK_API_KEY, undefined);
  await unavailable.clearKey();
  assert.equal((await unavailable.getStatus({})).mode, 'offline');
});

test('save and clear operations serialize and subsequent writes recover after rejection', async (t) => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const { store, userDataPath } = await fixture(t, encryptor({ encryptStringAsync: async (value) => { await gate; return Buffer.from(`protected:${value}`); } }));
  const saving = store.save(saveInput());
  const clearing = store.clearKey();
  const statusPending = store.getStatus({});
  release();
  await Promise.all([saving, clearing]);
  const status = await statusPending;
  assert.equal(status.mode, 'offline'); assert.equal(status.hasSavedKey, false);
  await assert.rejects(store.save({ mode: 'invalid' }), ModelConfigError);
  await store.save({ mode: 'environment' });
  assert.equal((await store.getStatus({})).mode, 'environment');
  assert.deepEqual(await readdir(userDataPath), ['model-settings.json']);
});
