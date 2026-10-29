import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

const SCHEMA = 'feitu-world/model-settings/v1';
const DEFAULT_MODEL = 'deepseek-chat';
const DEFAULT_ENDPOINT = 'https://api.deepseek.com/chat/completions';
const MAX_CONFIG_BYTES = 16 * 1024;
const MODES = ['environment', 'offline', 'saved'];
const UNAVAILABLE = '本机安全存储不可用，请使用离线模式或环境变量。';
const INVALID_FILE = '本机在线剧情设置无法读取，请重新保存设置。';
const INVALID_KEY = '密钥格式无效，请检查长度和不可见字符。';
const DECRYPT_FAILED = '本机密钥无法解密，请重新输入并保存。';
const STARTUP_WARNING = '在线剧情设置不可用，已切换为离线模式；请重新保存设置。';

export class ModelConfigError extends Error {
  constructor(message) { super(message); this.name = 'ModelConfigError'; }
}

function keyValue(value) {
  if (typeof value !== 'string' || value.length > 4096 || /[\x00-\x1f\x7f]/.test(value)) throw new ModelConfigError(INVALID_KEY);
  const result = value.trim();
  if (!result) throw new ModelConfigError(INVALID_KEY);
  return result;
}

function modelValue(value) {
  if (typeof value !== 'string' || value.length > 128 || /[\x00-\x1f\x7f]/.test(value) || !/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(value.trim())) throw new ModelConfigError('模型名称无效，请填写不超过 128 个字符的模型标识。');
  return value.trim();
}

function endpointValue(value) {
  try {
    if (typeof value !== 'string' || value.length > 2048 || /[\x00-\x1f\x7f?#]/.test(value) || /^https:\/\/[^/]*@/i.test(value.trim())) throw new Error();
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.search || url.hash || !/\/chat\/completions\/?$/.test(url.pathname)) throw new Error();
    return url.href;
  } catch {
    throw new ModelConfigError('服务地址必须是完整的 HTTPS chat/completions 地址，且不能包含凭据、查询或片段。');
  }
}

function defaultConfig(mode = 'environment') {
  return { schema: SCHEMA, mode, model: DEFAULT_MODEL, endpoint: DEFAULT_ENDPOINT, encryptedApiKey: null };
}

function validateConfig(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.schema !== SCHEMA || !MODES.includes(value.mode)
      || Object.keys(value).some((key) => !['schema', 'mode', 'model', 'endpoint', 'encryptedApiKey'].includes(key))) throw new ModelConfigError(INVALID_FILE);
  const cipher = value.encryptedApiKey;
  if (cipher !== null && (typeof cipher !== 'string' || !cipher.length || cipher.length > 12000 || Buffer.from(cipher, 'base64').toString('base64') !== cipher)) throw new ModelConfigError(INVALID_FILE);
  if (value.mode === 'saved' && !cipher) throw new ModelConfigError(INVALID_FILE);
  return { schema: SCHEMA, mode: value.mode, model: modelValue(value.model), endpoint: endpointValue(value.endpoint), encryptedApiKey: cipher };
}

export function createModelConfig({ userDataPath, safeStorage }) {
  const configPath = join(userDataPath, 'model-settings.json');
  let writes = Promise.resolve();
  const serialize = (operation) => {
    const job = writes.then(operation);
    writes = job.catch(() => {});
    return job;
  };
  const secureAvailable = async () => {
    try {
      return await safeStorage?.isAsyncEncryptionAvailable() === true && typeof safeStorage.encryptStringAsync === 'function' && typeof safeStorage.decryptStringAsync === 'function';
    } catch { return false; }
  };
  async function readConfig() {
    try {
      const info = await stat(configPath);
      if (!info.isFile() || info.size > MAX_CONFIG_BYTES) throw new ModelConfigError(INVALID_FILE);
      const raw = await readFile(configPath, 'utf8');
      if (Buffer.byteLength(raw) > MAX_CONFIG_BYTES) throw new ModelConfigError(INVALID_FILE);
      return { config: validateConfig(JSON.parse(raw)) };
    } catch (error) {
      if (error.code === 'ENOENT') return { config: defaultConfig() };
      return { config: defaultConfig('offline'), error: INVALID_FILE };
    }
  }
  async function decryptKey(config) {
    if (!await secureAvailable()) throw new ModelConfigError(UNAVAILABLE);
    if (!config.encryptedApiKey) throw new ModelConfigError('请先输入并保存本机密钥。');
    try {
      const decrypted = await safeStorage.decryptStringAsync(Buffer.from(config.encryptedApiKey, 'base64'));
      return keyValue(decrypted?.result);
    } catch { throw new ModelConfigError(DECRYPT_FAILED); }
  }
  async function writeConfig(config) {
    const temporary = `${configPath}.${randomUUID()}.tmp`;
    await mkdir(userDataPath, { recursive: true });
    try {
      const handle = await open(temporary, 'wx', 0o600);
      try {
        await handle.writeFile(`${JSON.stringify(config, null, 2)}\n`, 'utf8');
        await handle.sync();
      } finally { await handle.close(); }
      await rename(temporary, configPath);
    } finally { await rm(temporary, { force: true }); }
  }
  async function statusFrom({ config, error }, env) {
    const status = {
      mode: config.mode,
      hasSavedKey: Boolean(config.encryptedApiKey),
      secureStorageAvailable: await secureAvailable(),
      environmentConfigured: Boolean(env.DEEPSEEK_API_KEY),
      configured: false,
      model: config.model,
      endpoint: config.endpoint,
    };
    if (error) status.error = error;
    if (config.mode === 'environment') {
      status.configured = status.environmentConfigured;
    } else if (config.mode === 'saved' && !error) {
      try { await decryptKey(config); status.configured = true; }
      catch (failure) { status.error = failure.message; }
    }
    return status;
  }
  return {
    async getStatus(env = process.env) {
      await writes;
      return statusFrom(await readConfig(), env);
    },
    save(input, env = process.env) {
      return serialize(async () => {
        if (!input || typeof input !== 'object' || !MODES.includes(input.mode)) throw new ModelConfigError('请选择有效的在线剧情模式。');
        const previous = await readConfig();
        const config = {
          schema: SCHEMA,
          mode: input.mode,
          model: modelValue(input.model === undefined ? previous.config.model : input.model),
          endpoint: endpointValue(input.endpoint === undefined ? previous.config.endpoint : input.endpoint),
          encryptedApiKey: previous.config.encryptedApiKey,
        };
        if (input.apiKey !== undefined && (typeof input.apiKey !== 'string' || input.apiKey.length > 4096 || /[\x00-\x1f\x7f]/.test(input.apiKey))) throw new ModelConfigError(INVALID_KEY);
        if (input.apiKey?.trim()) {
          const key = keyValue(input.apiKey);
          if (!await secureAvailable()) throw new ModelConfigError(UNAVAILABLE);
          try {
            const encrypted = await safeStorage.encryptStringAsync(key);
            if (!Buffer.isBuffer(encrypted) || !encrypted.length) throw new Error();
            config.encryptedApiKey = encrypted.toString('base64');
          } catch { throw new ModelConfigError('无法加密本机密钥，请重试或使用离线模式。'); }
        }
        if (config.mode === 'saved') await decryptKey(config);
        validateConfig(config);
        if (Buffer.byteLength(JSON.stringify(config)) > MAX_CONFIG_BYTES) throw new ModelConfigError(INVALID_FILE);
        await writeConfig(config);
        return statusFrom({ config }, env);
      });
    },
    clearKey(env = process.env) {
      return serialize(async () => {
        const { config } = await readConfig();
        config.encryptedApiKey = null;
        if (config.mode === 'saved') config.mode = 'offline';
        await writeConfig(config);
        return statusFrom({ config }, env);
      });
    },
    async applyToEnv(env = process.env) {
      await writes;
      const selected = await readConfig();
      const result = { env: { ...env } };
      if (selected.error) {
        delete result.env.DEEPSEEK_API_KEY;
        result.warning = STARTUP_WARNING;
      } else if (selected.config.mode === 'offline') {
        delete result.env.DEEPSEEK_API_KEY;
      } else if (selected.config.mode === 'saved') {
        try {
          result.env.DEEPSEEK_API_KEY = await decryptKey(selected.config);
          result.env.DEEPSEEK_MODEL = selected.config.model;
          result.env.DEEPSEEK_API_BASE_URL = selected.config.endpoint;
        } catch {
          delete result.env.DEEPSEEK_API_KEY;
          result.warning = STARTUP_WARNING;
        }
      }
      return result;
    },
  };
}
