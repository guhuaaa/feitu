import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortValue(value[key])]));
  }
  return value;
}

export function stableJson(value) {
  return JSON.stringify(sortValue(value));
}

export function stateHash(state) {
  const hashInput = { ...state };
  delete hashInput.deterministic_state_hash;
  delete hashInput.player_view_snapshot;
  // Checkpoints contain a copy of the state and a nested hash. Exclude them
  // so saving the same logical state remains deterministic.
  delete hashInput.checkpoint;
  return createHash('sha256').update(stableJson(hashInput), 'utf8').digest('hex');
}

function safeName(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'run';
}

export function createSaveStore(storageDir) {
  const root = resolve(storageDir);
  mkdirSync(root, { recursive: true });
  return {
    root,
    save(runId, state) {
      const file = join(root, `${safeName(runId)}.json`);
      const temp = `${file}.tmp`;
      writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
      try {
        renameSync(temp, file);
      } catch (error) {
        // Windows refuses to replace an existing file when a reader briefly
        // holds a handle. The target is this run's own checkpoint, so replace
        // it only after the atomic rename path reports that limitation.
        if (error.code !== 'EPERM' && error.code !== 'EEXIST') throw error;
        if (existsSync(file)) unlinkSync(file);
        renameSync(temp, file);
      }
      return file;
    },
    load(runId) {
      const file = join(root, `${safeName(runId)}.json`);
      if (!existsSync(file)) return null;
      return JSON.parse(readFileSync(file, 'utf8'));
    },
    list() {
      return readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
        .map((entry) => entry.name.slice(0, -5))
        .sort();
    },
  };
}
