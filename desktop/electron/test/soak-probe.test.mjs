import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { createGameStore } from '../../../packages/dsh-feitu-world/lib/runtime.js';
import { classifyCaptureFailure, classifySoakFailure, loadSoakWindow, readSoakOptions, runDesktopSoak, SOAK_FIELDS, SOAK_JOURNEY, summarizeSoakView, uiCommand } from '../soak-probe.mjs';

const stable = join(tmpdir(), 'FeituWorld-stable');
const isolated = join(tmpdir(), 'FeituWorld-soak-test');
const options = (extra = {}) => ({ FEITU_DESKTOP_SMOKE: '1', FEITU_DESKTOP_UI_SOAK: 'run', FEITU_DESKTOP_TEST_USER_DATA: isolated, ...extra });
async function mockWindowCreation(earlyPaint = false) {
  const main = await readFile(new URL('../main.mjs', import.meta.url), 'utf8');
  const { loadSoakWindow } = await import('../soak-probe.mjs');
  const window = new EventEmitter();
  let shown = 0, captures = 0;
  window.webContents = new EventEmitter(); window.webContents.setWindowOpenHandler = () => {};
  window.loadURL = async () => { if (earlyPaint) window.emit('ready-to-show'); };
  window.showInactive = () => { shown += 1; }; window.setTitle = () => {};
  const create = vm.runInNewContext(`(${main.match(/async function createWindow\(baseUrl\) \{[\s\S]*?\n\}/)[0]})`, {
    BrowserWindow: function () { return window; }, desktopSettings: { installMenu() {} }, URL,
    app: { getVersion: () => 'test' }, productTitle: 'test', soakOptions: { mode: 'run' }, isSmokeRun: true,
    loadSoakWindow, log() {}, mainWindow: null,
  });
  return { window, start: () => create('http://127.0.0.1:12345').then(() => { captures += 1; }), shown: () => shown, captures: () => captures };
}
test('actual main window loading cannot reach capture before first paint and inactive show', async () => {
  const mock = await mockWindowCreation();
  const pending = mock.start();
  await new Promise(setImmediate);
  assert.equal(mock.captures(), 0, 'loadURL completion is not a first-paint guarantee');
  mock.window.emit('ready-to-show'); await pending;
  assert.equal(mock.shown(), 1); assert.equal(mock.captures(), 1);
});
test('first paint during load is retained and missing paint fails within the bounded budget', async () => {
  const early = await mockWindowCreation(true); await early.start();
  assert.equal(early.shown(), 1); assert.equal(early.captures(), 1);
  const window = new EventEmitter(); let shown = 0;
  window.showInactive = () => { shown += 1; };
  await assert.rejects(loadSoakWindow(window, async () => {}, 5), /^Error: DESKTOP_SOAK_FIRST_PAINT_TIMEOUT$/);
  assert.equal(shown, 0); assert.equal(window.listenerCount('ready-to-show'), 0); assert.equal(window.listenerCount('closed'), 0);
  await assert.rejects(loadSoakWindow(window, async () => { throw new Error('private-load-secret'); }, 20), /^Error: DESKTOP_SOAK_WINDOW_LOAD_FAILED$/);
});
test('native capture classification accepts only Electron fixed reasons', () => {
  assert.equal(classifyCaptureFailure(new Error('Current display surface not available for capture')), 'SURFACE_UNAVAILABLE');
  assert.equal(classifyCaptureFailure(new Error('Frame Gone')), 'COPY_FRAME_GONE');
  assert.equal(classifyCaptureFailure(new Error('VizSentEmptyBitmap')), 'COPY_EMPTY_BITMAP');
  assert.equal(classifyCaptureFailure(new Error('private-screenshot-secret')), 'UNKNOWN');
});
test('journey keeps three phases with real exploration, new items and the complete ending route', () => {
  assert.equal(SOAK_JOURNEY.length, 3);
  const steps = SOAK_JOURNEY.flat();
  assert.deepEqual(steps.filter((step) => step.action === 'move').map((step) => step.target), ['L002', 'L001', 'L002', 'L003', 'L004', 'L005', 'L006', 'L005', 'L004', 'L003']);
  assert.deepEqual(steps.filter((step) => step.action === 'take').map((step) => step.item_id), ['I006', 'I004', 'I005']);
  assert.equal(SOAK_JOURNEY[2].at(-1).choice_id, 'CHOICE_020_PROTECT_IN_TIME');
  assert.equal(steps.filter((step) => step.action === 'resolve_interactive_event').length, 1);
  assert.throws(() => SOAK_JOURNEY[0].push({ action: 'start' }));
});
test('terminal UI validation requires disabled gameplay and does not weaken ordinary readiness', () => {
  const value = view(); value.role.name = 'role'; value.location.name = 'place'; value.ending = { id: 'END_01' };
  const nodes = { metaLine: { textContent: `回合 2 · role · run ${value.run_id}`, querySelector: () => ({ textContent: 'NODE_002' }) },
    portraitName: { textContent: 'role' }, role: { value: 'zhunin' }, scene: { querySelector: (selector) => ({ textContent: selector === 'h2' ? 'place' : '已提交终局：END_01' }) },
    map: { querySelector: () => ({ textContent: 'L003' }), querySelectorAll: () => [{ disabled: true }] }, inputError: { hidden: true },
    freeAction: { disabled: true }, freeActionSubmit: { disabled: true }, dialogueTarget: { disabled: true } };
  const previousDocument = globalThis.document, previousWindow = globalThis.window;
  globalThis.document = { getElementById: (id) => nodes[id] }; globalThis.window = {};
  try {
    assert.equal(uiCommand({ action: 'check', view: value }), true);
    nodes.freeActionSubmit.disabled = false; assert.equal(uiCommand({ action: 'check', view: value }), false);
    value.ending = null; assert.equal(uiCommand({ action: 'check', view: value }), false);
    for (const id of ['freeAction', 'freeActionSubmit', 'dialogueTarget']) nodes[id].disabled = false;
    assert.equal(uiCommand({ action: 'check', view: value }), true);
  } finally { globalThis.document = previousDocument; globalThis.window = previousWindow; }
});
test('the staged journey reaches END_01 with deep state and role-local inventory preserved', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'feitu-soak-journey-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = createGameStore({ storageDir: directory }), exec = { agent: { id: 'soak-journey' } };
  let current = store.act({ action: 'start', role_id: 'zhunin' }, exec);
  let submitted = 0;
  const act = (args) => (current = store.act(args, exec));
  const free = (selection) => {
    let selected;
    if (selection?.action === 'take') {
      const item = current.location.takeableItems.find((item) => item.id === selection.item_id);
      assert.ok(item && !current.inventory.some((held) => held.id === item.id), 'The UI must expose a new takeable item.');
      selected = { action: 'take', item_id: item.id, label: `记录物品：${item.name}` };
    } else if (selection) {
      const choice = current.choices.find((item) => Object.entries(selection).every(([key, value]) => item[key] === value));
      assert.ok(choice, `Missing public action: ${selection.choice_id ?? selection.event_id ?? selection.target ?? selection.action}`);
      selected = Object.fromEntries(['action', 'target', 'target_id', 'item_id', 'choice_id', 'event_id', 'result_id', 'label']
        .filter((key) => choice[key] !== undefined).map((key) => [key, choice[key]]));
    }
    return act({ action: 'free_action', action_text: selected?.label ?? '我观察当前地点，确认安全路线', selected_action: selected ?? null,
      run_id: current.run_id, expected_turn: current.turn, client_action_id: `soak-ui-${++submitted}` });
  };
  for (const [index, steps] of SOAK_JOURNEY.entries()) {
    for (const selection of index === 2 ? steps.slice(0, -1) : steps) free(selection);
    if (index === 1) { act({ action: 'switch_role', role_id: 'linenchuan' }); free(); act({ action: 'switch_role', role_id: 'zhunin' }); }
    const checkpoint = act({ action: 'save' }); free(); act({ action: 'load' });
    assert.equal(summarizeSoakView(current).stateSha256, summarizeSoakView(checkpoint).stateSha256);
    if (index === 2) free(steps.at(-1));
  }
  assert.equal(current.ending.id, 'END_01'); assert.ok(current.turn >= 20); assert.ok(current.actionCount >= 25);
  for (const id of ['I006', 'I004', 'I005']) assert.ok(current.inventory.some((item) => item.id === id));
});
test('failure diagnostics allow only fixed codes, types and filesystem categories', () => {
  const native = Object.assign(new TypeError('private-game-text'), { code: 'ERR_INVALID_ARG_TYPE' });
  assert.deepEqual(classifySoakFailure(native), { code: 'DESKTOP_SOAK_CHECK_FAILED', errorType: 'TypeError', systemCode: 'ERR_INVALID_ARG_TYPE' });
  assert.equal(classifySoakFailure(new Error('DESKTOP_SOAK_CHECKPOINT_MISMATCH')).code, 'DESKTOP_SOAK_CHECKPOINT_MISMATCH');
  const malicious = { name: 'private-key-value', code: 'private-system-value', message: 'DESKTOP_SOAK_PRIVATE_INPUT' };
  assert.deepEqual(classifySoakFailure(malicious), { code: 'DESKTOP_SOAK_CHECK_FAILED', errorType: 'OtherError', systemCode: 'NONE' });
  assert.equal(JSON.stringify(classifySoakFailure(native)).includes('private'), false);
});
function view() {
  return {
    run_id: 'one-line-test-123', turn: 2, role: { id: 'zhunin', name: 'private-story-value' }, dungeon: { id: 'one-line-last-train' },
    location: { id: 'L003' }, currentNode: { id: 'NODE_002' }, inventory: [{ id: 'I003', name: 'item' }], discoveredClues: ['private-clue-value'],
    flags: { entranceOpen: true, trainLoop: false }, visibleDialogue: [{ text: 'private-dialogue-value' }], visibleNarrative: ['private-narrative-value'], storyUnlocks: [],
    opening: { id: 'opening', paragraphs: ['private-opening-value'] }, pressure: { value: 40, countdown: 79 }, helmet: { oxygen: { value: 98 } },
    checkpoint: { available: true, hash: 'checkpoint-hash' }, actionCount: 6, notice: 'not hashed', dsh: { configured: false },
  };
}

test('soak is ignored for normal player launches and absent opt-in', () => {
  assert.equal(readSoakOptions({ FEITU_DESKTOP_UI_SOAK: 'invalid' }, stable), null);
  assert.equal(readSoakOptions({ FEITU_DESKTOP_SMOKE: '0', FEITU_DESKTOP_UI_SOAK: 'run' }, stable), null);
  assert.equal(readSoakOptions({ FEITU_DESKTOP_SMOKE: '1' }, stable), null);
});

test('explicit isolated opt-in defaults to sixty minutes and allows bounded pilots/resume', () => {
  assert.deepEqual(readSoakOptions(options(), stable), { mode: 'run', minutes: 60 });
  assert.deepEqual(readSoakOptions(options({ FEITU_DESKTOP_UI_SOAK_MINUTES: '1' }), stable), { mode: 'run', minutes: 1 });
  assert.deepEqual(readSoakOptions(options({ FEITU_DESKTOP_UI_SOAK: 'resume', FEITU_DESKTOP_UI_SOAK_MINUTES: '240' }), stable), { mode: 'resume', minutes: 240 });
});

test('invalid modes, durations, relative paths and case-insensitive real userData are rejected', () => {
  for (const mode of ['', 'RUN', 'other']) assert.throws(() => readSoakOptions(options({ FEITU_DESKTOP_UI_SOAK: mode }), stable), /DESKTOP_SOAK_OPTIONS_INVALID/);
  for (const minutes of ['', '0', '-1', '241', '1.5', 'NaN', '1e2']) assert.throws(() => readSoakOptions(options({ FEITU_DESKTOP_UI_SOAK_MINUTES: minutes }), stable), /DESKTOP_SOAK_OPTIONS_INVALID/);
  for (const directory of [undefined, '', 'relative-test-data', stable, stable.toUpperCase(), join(stable, '..', 'FeituWorld-stable')]) {
    assert.throws(() => readSoakOptions(options({ FEITU_DESKTOP_TEST_USER_DATA: directory }), stable), /DESKTOP_SOAK_OPTIONS_INVALID/);
  }
});

test('summary hashes exactly fifteen ordered fields without returning story or credentials', () => {
  const value = view();
  value.apiKey = 'private-test-credential';
  const summary = summarizeSoakView(value);
  assert.equal(SOAK_FIELDS.length, 15);
  assert.deepEqual(summary.fields, [...SOAK_FIELDS]);
  assert.equal(summary.runId, value.run_id); assert.equal(summary.turn, 2);
  assert.match(summary.stateSha256, /^[a-f0-9]{64}$/);
  for (const forbidden of ['private-story-value', 'private-clue-value', 'private-dialogue-value', 'private-narrative-value', 'private-opening-value', 'private-test-credential']) assert.equal(JSON.stringify(summary).includes(forbidden), false);
});

test('object key order and resume bookkeeping do not affect state hash', () => {
  const before = view();
  const after = Object.fromEntries(Object.entries(before).reverse());
  after.role = { name: before.role.name, id: before.role.id };
  after.flags = { trainLoop: false, entranceOpen: true };
  after.actionCount += 1; after.notice = 'resumed';
  assert.equal(summarizeSoakView(before).stateSha256, summarizeSoakView(after).stateSha256);
});

test('every persisted key field affects the restoration hash', () => {
  const original = view();
  const expected = summarizeSoakView(original).stateSha256;
  for (const field of SOAK_FIELDS) {
    const changed = structuredClone(original);
    if (field === 'run_id') changed[field] = 'one-line-other-456';
    else if (field === 'turn') changed[field] += 1;
    else if (Array.isArray(changed[field])) changed[field].push({ changed: true });
    else changed[field].changed = true;
    assert.notEqual(summarizeSoakView(changed).stateSha256, expected, field);
  }
});

test('missing fields and invalid run identity fail with static errors', () => {
  for (const field of SOAK_FIELDS) {
    const broken = view(); delete broken[field];
    assert.throws(() => summarizeSoakView(broken), /^Error: DESKTOP_SOAK_VIEW_INVALID$/);
  }
  for (const invalid of [null, { ...view(), run_id: 'private-invalid-input' }, { ...view(), turn: -1 }]) assert.throws(() => summarizeSoakView(invalid), /DESKTOP_SOAK_VIEW_INVALID/);
});

test('resume waits for asynchronously rendered save controls and preserves run evidence', async (t) => {
  const userDataPath = await mkdtemp(join(tmpdir(), 'feitu-soak-resume-'));
  t.after(() => rm(userDataPath, { recursive: true, force: true }));
  const reportPath = join(userDataPath, 'desktop-soak.json');
  const original = { schema: 'feitu-world/desktop-soak/v1', status: 'RUN_COMPLETE', version: '0.2.4', distribution: 'steam',
    requestedMinutes: 1, elapsedMs: 60001, actionCount: 12, cycleCount: 2, saveCount: 3, roles: ['linenchuan', 'zhunin'], resumed: false, ...summarizeSoakView(view()) };
  await writeFile(reportPath, JSON.stringify(original));
  let readyChecks = 0;
  let restored = false;
  const window = new EventEmitter();
  window.isDestroyed = () => false;
  window.webContents = new EventEmitter();
  window.webContents.getLastWebPreferences = () => ({ sandbox: true, contextIsolation: true, nodeIntegration: false });
  window.webContents.capturePage = async () => ({ toPNG: () => Buffer.from('test-image') });
  window.webContents.executeJavaScript = async (script) => {
    const command = JSON.parse(script.slice(script.lastIndexOf('})(') + 3, -1));
    if (command.action === 'install') return true;
    if (command.action === 'resumeReady') return ++readyChecks >= 3;
    if (command.action === 'resume') {
      assert.ok(readyChecks >= 3, 'resume must wait until its DOM control exists');
      restored = true; return true;
    }
    if (command.action === 'check') return restored;
    throw new Error('Unexpected test command');
  };
  const previousFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = previousFetch; });
  globalThis.fetch = async (url, options) => {
    assert.equal(options.method, undefined, 'probe must not mutate through HTTP');
    const data = url.pathname === '/api/health'
      ? { status: 'PASS', deepseek: { configured: false }, desktopVersion: '0.2.4', distribution: 'steam' }
      : restored ? { ...view(), actionCount: 7 } : { started: false, saves: [original.runId] };
    return { ok: true, json: async () => data };
  };
  const logged = [];
  const result = await runDesktopSoak({ window, baseUrl: 'http://127.0.0.1:12345', userDataPath, mode: 'resume', minutes: 1,
    version: '0.2.4', distribution: 'steam', log: (...entry) => logged.push(entry) });
  assert.equal(result.status, 'PASS'); assert.equal(result.resumed, true);
  for (const key of ['elapsedMs', 'actionCount', 'cycleCount', 'saveCount', 'stateSha256']) assert.equal(result[key], original[key]);
  assert.equal(result.resumedStateSha256, original.stateSha256);
  assert.equal(logged.at(-1)[1], 'desktop_soak_resume_complete');
  assert.equal(JSON.parse(await readFile(reportPath, 'utf8')).resumed, true);
  await writeFile(reportPath, JSON.stringify(original)); restored = false;
  let failedCaptures = 0;
  window.isVisible = () => true; window.isMinimized = () => false; window.getContentSize = () => [1440, 900];
  window.webContents.isLoadingMainFrame = () => false;
  window.webContents.capturePage = async () => { failedCaptures += 1; throw new TypeError('private-screenshot-detail'); };
  await assert.rejects(runDesktopSoak({ window, baseUrl: 'http://127.0.0.1:12345', userDataPath, mode: 'resume', minutes: 1,
    version: '0.2.4', distribution: 'steam', log: (...entry) => logged.push(entry) }), /桌面长期验收失败/);
  const failure = logged.at(-1)[2];
  assert.equal(failure.stage, 'capture_resume'); assert.equal(failure.operation, 'capture_page');
  assert.equal(failure.errorType, 'TypeError'); assert.equal(failure.captureSummary.returned, false);
  assert.equal(failedCaptures, 1); assert.equal(failure.captureSummary.nativeReason, 'UNKNOWN');
  assert.deepEqual(failure.captureSummary.windowState, { firstPaint: false, destroyed: false, visible: true, minimized: false, loading: false, width: 1440, height: 900 });
  assert.equal(JSON.stringify(failure).includes('private'), false);
});
