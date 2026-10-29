import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

export const SOAK_FIELDS = Object.freeze(['run_id', 'turn', 'role', 'location', 'currentNode', 'inventory', 'discoveredClues', 'flags', 'visibleDialogue', 'visibleNarrative', 'storyUnlocks', 'opening', 'pressure', 'helmet', 'checkpoint']);
const fail = (code) => { throw new Error(code); };
const normalizedPath = (value) => resolve(value).replace(/\\/g, '/').toLowerCase();
const validMinutes = (value) => Number.isInteger(value) && value >= 1 && value <= 240;
const paintedWindows = new WeakSet();
const captureReasons = new Map([
  ['Current display surface not available for capture', 'SURFACE_UNAVAILABLE'], ['Unknown', 'COPY_UNKNOWN'],
  ['Not implemented', 'COPY_NOT_IMPLEMENTED'], ['Frame Gone', 'COPY_FRAME_GONE'], ['Timeout', 'COPY_TIMEOUT'],
  ['EmbeddingTokenChanged', 'COPY_EMBEDDING_CHANGED'], ['VizSentEmptyBitmap', 'COPY_EMPTY_BITMAP'], ['UnknownVizError', 'COPY_VIZ_ERROR'],
]);
export const classifyCaptureFailure = (error) => captureReasons.get(error?.message) ?? 'UNKNOWN';

export async function loadSoakWindow(window, load, milliseconds = 9000) {
  let onReady, onClosed;
  const painted = new Promise((resolvePaint, reject) => {
    onReady = () => {
      try { window.showInactive(); paintedWindows.add(window); resolvePaint(); }
      catch { reject(new Error('DESKTOP_SOAK_WINDOW_SHOW_FAILED')); }
    };
    onClosed = () => reject(new Error('DESKTOP_SOAK_WINDOW_CLOSED'));
    window.once('ready-to-show', onReady); window.once('closed', onClosed);
  });
  const loading = Promise.resolve().then(load).catch(() => fail('DESKTOP_SOAK_WINDOW_LOAD_FAILED'));
  try { await deadline(Promise.all([loading, painted]), milliseconds); }
  catch (error) { if (error?.message === 'DESKTOP_SOAK_TIMEOUT') fail('DESKTOP_SOAK_FIRST_PAINT_TIMEOUT'); throw error; }
  finally { window.removeListener('ready-to-show', onReady); window.removeListener('closed', onClosed); }
}

function captureWindowState(window) {
  const state = { firstPaint: paintedWindows.has(window) };
  try {
    state.destroyed = Boolean(window.isDestroyed());
    if (state.destroyed) return state;
    state.visible = Boolean(window.isVisible()); state.minimized = Boolean(window.isMinimized());
    state.loading = Boolean(window.webContents.isLoadingMainFrame());
    const [width, height] = window.getContentSize();
    const size = (value) => Number.isFinite(value) ? Math.max(0, Math.min(32768, Math.round(value))) : 0;
    state.width = size(width); state.height = size(height);
  } catch { state.unavailable = true; }
  return state;
}
const FAILURE_CODES = new Set(['OPTIONS_INVALID', 'VIEW_INVALID', 'ORIGIN_INVALID', 'TIMEOUT', 'RENDERER_FAILED', 'UI_FAILED', 'HTTP_FAILED', 'ACTION_TIMEOUT', 'SANDBOX_INVALID', 'UI_NOT_READY', 'OFFLINE_INVALID', 'REPORT_INVALID', 'SAVED_RUN_MISSING', 'RESUME_CONTROL_TIMEOUT', 'RESTORE_MISMATCH', 'LOCAL_ACTION_FAILED', 'CHECKPOINT_MISMATCH', 'ROLE_COVERAGE_FAILED', 'ITEM_FAILED', 'COVERAGE_FAILED'].map((code) => `DESKTOP_SOAK_${code}`));
export const SOAK_JOURNEY = Object.freeze([
  [{ action: 'inspect' }, { action: 'take', item_id: 'I006' }, ...['L002', 'L001', 'L002', 'L003'].map((target) => ({ action: 'move', target }))],
  [{ action: 'move', target: 'L004' }, { action: 'move', target: 'L005' }, { action: 'inspect' }, { action: 'take', item_id: 'I004' },
    { action: 'move', target: 'L006' }, { action: 'inspect' }, { action: 'take', item_id: 'I005' }],
  [...['L005', 'L004', 'L003'].map((target) => ({ action: 'move', target })),
    ...['CHOICE_001_PROTECT_REPORT', 'CHOICE_005_SEND_EVIDENCE_ZN', 'CHOICE_010_ENTER_DEEP_FIELD', 'CHOICE_011_STAY_AND_SHARE', 'CHOICE_013_CHECK_OUTSIDE_ZN', 'CHOICE_018_OBSERVE_TESTIMONY_ZN'].map((choice_id) => ({ action: 'submit_choice', choice_id })),
    { action: 'resolve_interactive_event', event_id: 'IE_ZN_TRACK_CONFRONTATION', result_id: 'IER_ZN_TRACK_SUCCESS' }, { action: 'submit_choice', choice_id: 'CHOICE_020_PROTECT_IN_TIME' }],
].map((phase) => Object.freeze(phase.map(Object.freeze))));

export function classifySoakFailure(error) {
  return {
    code: FAILURE_CODES.has(error?.message) ? error.message : 'DESKTOP_SOAK_CHECK_FAILED',
    errorType: ['Error', 'TypeError', 'RangeError', 'AbortError', 'TimeoutError'].includes(error?.name) ? error.name : 'OtherError',
    systemCode: ['EPERM', 'EACCES', 'ENOENT', 'ENOSPC', 'EIO', 'ERR_INVALID_ARG_TYPE', 'ERR_INVALID_ARG_VALUE'].includes(error?.code) ? error.code : 'NONE',
  };
}

export function readSoakOptions(env, stableUserDataPath) {
  if (env.FEITU_DESKTOP_SMOKE !== '1' || env.FEITU_DESKTOP_UI_SOAK === undefined) return null;
  const mode = env.FEITU_DESKTOP_UI_SOAK;
  const raw = env.FEITU_DESKTOP_UI_SOAK_MINUTES ?? '60';
  const minutes = /^\d+$/.test(raw) ? Number(raw) : NaN;
  const directory = env.FEITU_DESKTOP_TEST_USER_DATA;
  if (!['run', 'resume'].includes(mode) || !validMinutes(minutes) || typeof directory !== 'string'
    || !isAbsolute(directory) || normalizedPath(directory) === normalizedPath(stableUserDataPath)) fail('DESKTOP_SOAK_OPTIONS_INVALID');
  return { mode, minutes };
}

function ordered(value) {
  if (Array.isArray(value)) return value.map(ordered);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, ordered(value[key])]));
  return value;
}

export function summarizeSoakView(view) {
  if (!view || SOAK_FIELDS.some((key) => !Object.hasOwn(view, key) || view[key] === undefined)
    || !/^(one-line|fork)-[a-z0-9-]+$/i.test(view.run_id) || !Number.isInteger(view.turn) || view.turn < 0) fail('DESKTOP_SOAK_VIEW_INVALID');
  const selected = Object.fromEntries(SOAK_FIELDS.map((key) => [key, ordered(view[key])]));
  return { runId: view.run_id, turn: view.turn, stateSha256: createHash('sha256').update(JSON.stringify(selected)).digest('hex'), fields: [...SOAK_FIELDS] };
}

// Fixed commands run in the existing page; no caller-provided script or HTTP mutation.
export function uiCommand(command) {
  const byId = (id) => document.getElementById(id);
  const clickLabel = (label) => {
    const button = [...document.querySelectorAll('#choices button')].find((item) => item.textContent === label);
    if (!button || button.disabled) throw new Error('UI_CONTROL_MISSING');
    button.click();
  };
  if (command.action === 'install') {
    window.__feituSoakPageErrors = 0;
    window.addEventListener('error', () => { window.__feituSoakPageErrors += 1; });
    window.addEventListener('unhandledrejection', () => { window.__feituSoakPageErrors += 1; });
    return Boolean(byId('start') && byId('freeActionForm'));
  }
  if (window.__feituSoakPageErrors) throw new Error('UI_PAGE_ERROR');
  if (command.action === 'resumeReady') {
    return [...document.querySelectorAll('#choices button')].some((button) => button.textContent === `恢复存档：${command.runId}` && !button.disabled);
  }
  if (command.action === 'check') {
    const view = command.view;
    const ended = Boolean(view.ending);
    return byId('metaLine').textContent.includes(`回合 ${view.turn} · ${view.role.name} · `)
      && byId('metaLine').textContent.includes(`run ${view.run_id}`)
      && byId('metaLine').querySelector('.chip')?.textContent === view.currentNode.id
      && byId('portraitName').textContent === view.role.name && byId('role').value === view.role.id
      && byId('scene').querySelector('h2')?.textContent === view.location.name
      && byId('map').querySelector('[aria-current="location"]')?.textContent.startsWith(view.location.id)
      && ['freeAction', 'freeActionSubmit', 'dialogueTarget'].every((id) => byId(id).disabled === ended)
      && (!ended || (byId('scene').querySelector('.ending')?.textContent === `已提交终局：${view.ending.id}`
        && [...byId('map').querySelectorAll('button')].every((button) => button.disabled))) && byId('inputError').hidden;
  }
  if (command.action === 'role') {
    if (byId('role').value !== command.value) {
      byId('role').value = command.value;
      byId('role').dispatchEvent(new Event('change', { bubbles: true }));
    }
  } else if (command.action === 'choice' || command.action === 'take') {
    const meta = byId('metaLine').textContent;
    if (!meta.includes(`回合 ${command.turn} · `) || !meta.includes(`run ${command.runId}`)) throw new Error('UI_STALE_CONTROL');
    byId('actionModeChoice').click();
    if (command.action === 'take') clickLabel(command.label);
    else {
      const button = document.querySelectorAll('#choices button')[command.index];
      if (!button || button.disabled || button.textContent !== command.label) throw new Error('UI_CONTROL_MISSING');
      button.click();
    }
  } else if (command.action === 'start') byId('start').click();
  else if (command.action === 'free') {
    byId('actionModeChoice').click();
    byId('freeAction').value = '我观察当前地点，确认安全路线';
    byId('freeActionForm').requestSubmit();
  } else if (command.action === 'save') clickLabel('保存检查点');
  else if (command.action === 'load') clickLabel('恢复检查点');
  else if (command.action === 'resume') clickLabel(`恢复存档：${command.runId}`);
  else if (command.action === 'drawers') {
    for (const [toggle, drawer] of [['mapToggle', 'mapDrawer'], ['helmetToggle', 'helmetDrawer']]) {
      byId(toggle).click();
      if (byId(drawer).hidden || byId(toggle).getAttribute('aria-expanded') !== 'true') throw new Error('UI_DRAWER_FAILED');
      byId(drawer).querySelector('[data-close]').click();
      if (!byId(drawer).hidden) throw new Error('UI_DRAWER_FAILED');
    }
  } else throw new Error('UI_COMMAND_INVALID');
  return true;
}

async function deadline(promise, milliseconds = 9000) {
  let timer;
  try { return await Promise.race([promise, new Promise((_done, reject) => { timer = setTimeout(() => reject(new Error('DESKTOP_SOAK_TIMEOUT')), Math.max(1, Math.min(milliseconds, 9000))); })]); }
  finally { clearTimeout(timer); }
}
const pause = (milliseconds) => new Promise((done) => setTimeout(done, milliseconds));

export async function runDesktopSoak({ window, baseUrl, userDataPath, mode, minutes, version, distribution, log }) {
  if (!['run', 'resume'].includes(mode) || !validMinutes(minutes) || !isAbsolute(userDataPath)) fail('DESKTOP_SOAK_OPTIONS_INVALID');
  let origin;
  try { origin = new URL(baseUrl); } catch { fail('DESKTOP_SOAK_ORIGIN_INVALID'); }
  if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1' || !origin.port || origin.username || origin.password || origin.search || origin.hash) fail('DESKTOP_SOAK_ORIGIN_INVALID');
  const reportPath = join(userDataPath, 'desktop-soak.json');
  const started = performance.now();
  const counters = { actionCount: 0, cycleCount: 0, saveCount: 0 };
  const roles = new Set();
  const visited = new Set(), newItems = new Set(), endings = new Set();
  const coverage = { maxRunTurn: 0, maxRunActionCount: 0, completedJourneyCount: 0 };
  const note = (view) => {
    visited.add(view.location.id); roles.add(view.role.id);
    coverage.maxRunTurn = Math.max(coverage.maxRunTurn, view.turn);
    coverage.maxRunActionCount = Math.max(coverage.maxRunActionCount, view.actionCount);
  };
  const errors = { console: 0, renderer: 0, page: 0 };
  let report = { schema: 'feitu-world/desktop-soak/v1', version, distribution, requestedMinutes: minutes, resumed: false };
  let stage = 'startup';
  let operation = 'idle';
  let captureSummary = null;
  let progress;
  const listeners = [];
  const listen = (target, event, handler) => { target.on(event, handler); listeners.push(() => target.removeListener(event, handler)); };
  const assertHealthy = () => { if (Object.values(errors).some(Boolean) || window.isDestroyed()) fail('DESKTOP_SOAK_RENDERER_FAILED'); };
  const js = async (command, remaining = 9000) => {
    assertHealthy();
    operation = ['install', 'check', 'role', 'start', 'free', 'save', 'load', 'resume', 'resumeReady', 'drawers', 'choice', 'take'].includes(command.action) ? `ui_${command.action}` : 'ui_unknown';
    try { return await deadline(window.webContents.executeJavaScript(`(${uiCommand.toString()})(${JSON.stringify(command)})`), remaining); }
    catch { errors.page += 1; fail('DESKTOP_SOAK_UI_FAILED'); }
  };
  const get = async (pathname, remaining = 9000) => {
    assertHealthy();
    operation = pathname === '/api/health' ? 'health_get' : 'game_get';
    const response = await fetch(new URL(pathname, origin), { signal: AbortSignal.timeout(Math.max(1, Math.floor(Math.min(remaining, 8000)))) });
    if (!response.ok) fail('DESKTOP_SOAK_HTTP_FAILED');
    return deadline(response.json(), Math.max(1, Math.min(remaining, 8000)));
  };
  const waitFor = async (predicate) => {
    const end = performance.now() + 9000;
    while (performance.now() < end) {
      const remaining = () => Math.max(1, end - performance.now());
      const view = await get('/api/game', remaining());
      if (predicate(view) && await js({ action: 'check', view }, remaining())) return view;
      await pause(Math.min(100, remaining()));
    }
    fail('DESKTOP_SOAK_ACTION_TIMEOUT');
  };
  const act = async (command, predicate) => {
    stage = ({ start: 'game_start', free: 'free_action', save: 'checkpoint_save', load: 'checkpoint_restore', resume: 'run_resume', choice: 'story_action', take: 'item_take' })[command.action] || 'unknown_action';
    await js(command);
    const view = await waitFor(predicate);
    counters.actionCount += 1;
    note(view);
    return view;
  };
  const save = async (view) => {
    const saved = await act({ action: 'save' }, (next) => next.run_id === view.run_id && next.actionCount > view.actionCount && next.checkpoint?.available);
    counters.saveCount += 1;
    return saved;
  };
  const capture = async (name) => {
    stage = ({ 'soak-start.png': 'capture_start', 'soak-final.png': 'capture_final', 'soak-resume.png': 'capture_resume' })[name] || 'capture_unknown';
    operation = 'capture_page'; captureSummary = { returned: false, imageType: 'unknown', hasToPng: false, pngBytes: 0,
      nativeReason: 'NONE', windowState: captureWindowState(window) };
    let image;
    try { image = await deadline(window.webContents.capturePage()); }
    catch (error) { captureSummary.nativeReason = classifyCaptureFailure(error); throw error; }
    captureSummary = { ...captureSummary, returned: true, imageType: typeof image, hasToPng: typeof image?.toPNG === 'function' };
    operation = 'png_encode';
    const png = image.toPNG();
    captureSummary.pngBytes = Buffer.isBuffer(png) ? png.length : 0;
    operation = 'png_write';
    await writeFile(join(userDataPath, name), png);
  };
  const writeReport = async () => {
    const temporary = `${reportPath}.${randomUUID()}.tmp`;
    try { await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, 'utf8'); await rename(temporary, reportPath); }
    finally { await rm(temporary, { force: true }); }
  };
  try {
    await mkdir(userDataPath, { recursive: true });
    const preferences = window.webContents.getLastWebPreferences();
    if (!preferences.sandbox || !preferences.contextIsolation || preferences.nodeIntegration) fail('DESKTOP_SOAK_SANDBOX_INVALID');
    listen(window.webContents, 'console-message', (...args) => {
      if (args[1]?.level === 'error' || args[1] === 3) errors.console += 1;
    });
    listen(window.webContents, 'render-process-gone', () => { errors.renderer += 1; });
    listen(window.webContents, 'did-fail-load', () => { errors.page += 1; });
    listen(window, 'unresponsive', () => { errors.renderer += 1; });
    if (!await js({ action: 'install' })) fail('DESKTOP_SOAK_UI_NOT_READY');
    stage = 'health_check';
    const health = await get('/api/health');
    if (health.status !== 'PASS' || health.deepseek?.configured !== false || health.desktopVersion !== version || health.distribution !== distribution) fail('DESKTOP_SOAK_OFFLINE_INVALID');
    if (mode === 'resume') {
      stage = 'resume_report';
      if ((await stat(reportPath)).size > 16384) fail('DESKTOP_SOAK_REPORT_INVALID');
      report = JSON.parse(await readFile(reportPath, 'utf8'));
      if (report.schema !== 'feitu-world/desktop-soak/v1' || report.status !== 'RUN_COMPLETE' || report.version !== version || report.distribution !== distribution
        || !/^(one-line|fork)-[a-z0-9-]+$/i.test(report.runId) || !/^[a-f0-9]{64}$/.test(report.stateSha256)) fail('DESKTOP_SOAK_REPORT_INVALID');
      const initial = await get('/api/game');
      if (initial.started !== false || !initial.saves?.includes(report.runId)) fail('DESKTOP_SOAK_SAVED_RUN_MISSING');
      const readyBy = performance.now() + 9000;
      stage = 'resume_control';
      while (!await js({ action: 'resumeReady', runId: report.runId }, Math.max(1, readyBy - performance.now()))) {
        if (performance.now() >= readyBy) fail('DESKTOP_SOAK_RESUME_CONTROL_TIMEOUT');
        await pause(Math.min(100, readyBy - performance.now()));
      }
      const restored = await act({ action: 'resume', runId: report.runId }, (view) => view.run_id === report.runId);
      const summary = summarizeSoakView(restored);
      if (summary.stateSha256 !== report.stateSha256) fail('DESKTOP_SOAK_RESTORE_MISMATCH');
      await capture('soak-resume.png');
      report = { ...report, status: 'PASS', resumed: true, resumedStateSha256: summary.stateSha256, resumedAt: new Date().toISOString() };
      stage = 'report_write'; await writeReport();
      log('INFO', 'desktop_soak_resume_complete', { runId: report.runId, stateSha256: summary.stateSha256, fieldCount: SOAK_FIELDS.length });
      return report;
    }
    report.startedAt = new Date().toISOString();
    progress = setInterval(() => log('INFO', 'desktop_soak_progress', { elapsedMs: Math.round(performance.now() - started), ...counters }), 30000);
    let view = await get('/api/game');
    const switchTo = async (role) => {
      stage = 'role_switch';
      await js({ action: 'role', value: role });
      if (view.started !== false && view.role?.id !== role) {
        view = await waitFor((next) => next.run_id === view.run_id && next.role?.id === role);
        counters.actionCount += 1; note(view);
      }
    };
    const free = async () => {
      const before = view;
      view = await act({ action: 'free' }, (next) => next.run_id === before.run_id && next.turn > before.turn);
      if (!view.freeActionEvent?.accepted || view.freeActionEvent.source !== 'deterministic-fallback') fail('DESKTOP_SOAK_LOCAL_ACTION_FAILED');
    };
    const play = async (selection) => {
      const before = view;
      const index = before.choices.findIndex((item) => Object.entries(selection).every(([key, value]) => item[key] === value));
      const item = before.location.takeableItems?.find((item) => item.id === selection.item_id);
      if (selection.action === 'take' && (!item || before.inventory.some((held) => held.id === item.id))) fail('DESKTOP_SOAK_ITEM_FAILED');
      if (selection.action !== 'take' && index < 0) fail('DESKTOP_SOAK_COVERAGE_FAILED');
      const command = { action: selection.action === 'take' ? 'take' : 'choice', index,
        label: selection.action === 'take' ? `记录物品：${item.name}` : before.choices[index].label, runId: before.run_id, turn: before.turn };
      view = await act(command, (next) => next.run_id === before.run_id && next.turn > before.turn);
      if (!view.freeActionEvent?.accepted || view.freeActionEvent.source !== 'deterministic-fallback') fail('DESKTOP_SOAK_LOCAL_ACTION_FAILED');
      if (selection.action === 'take') {
        if (!view.inventory.some((held) => held.id === item.id)) fail('DESKTOP_SOAK_ITEM_FAILED');
        newItems.add(item.id);
      }
    };
    const checkpointRoundTrip = async () => {
      const checkpoint = await save(view);
      await free();
      view = await act({ action: 'load' }, (next) => next.run_id === checkpoint.run_id && next.turn === checkpoint.turn && next.freeActionEvent?.id === checkpoint.freeActionEvent.id);
      if (summarizeSoakView(view).stateSha256 !== summarizeSoakView(checkpoint).stateSha256) fail('DESKTOP_SOAK_CHECKPOINT_MISMATCH');
    };
    while (performance.now() - started < minutes * 60000 || counters.cycleCount % 3 || !coverage.completedJourneyCount) {
      const phase = counters.cycleCount % 3;
      if (!phase) {
        if (view.started !== false && !view.ending) fail('DESKTOP_SOAK_COVERAGE_FAILED');
        await switchTo('zhunin');
        const priorRun = view.run_id;
        view = await act({ action: 'start' }, (next) => next.run_id !== priorRun && next.role?.id === 'zhunin' && next.turn === 0);
        if (!counters.cycleCount) await capture('soak-start.png');
      }
      stage = 'drawers'; await js({ action: 'drawers' });
      const steps = SOAK_JOURNEY[phase];
      for (const selection of phase === 2 ? steps.slice(0, -1) : steps) await play(selection);
      if (phase === 1) {
        await switchTo('linenchuan'); await free(); await switchTo('zhunin');
        if (!['I006', 'I004', 'I005'].every((id) => view.inventory.some((item) => item.id === id))) fail('DESKTOP_SOAK_ITEM_FAILED');
      }
      await checkpointRoundTrip();
      if (phase === 2) {
        await play(steps.at(-1));
        if (view.ending?.id !== 'END_01' || view.flags.endingCommitted !== true) fail('DESKTOP_SOAK_COVERAGE_FAILED');
        endings.add(view.ending.id); coverage.completedJourneyCount += 1;
      }
      counters.cycleCount += 1;
      const nextCycle = Math.min(started + minutes * 60000, started + counters.cycleCount * 20000);
      while (performance.now() < nextCycle) { assertHealthy(); await pause(Math.min(1000, nextCycle - performance.now())); }
    }
    if (roles.size !== 2) fail('DESKTOP_SOAK_ROLE_COVERAGE_FAILED');
    view = await save(view);
    assertHealthy();
    await capture('soak-final.png');
    report = { ...report, status: 'RUN_COMPLETE', ...summarizeSoakView(view), ...counters, roles: [...roles].sort(), errors,
      coverage: { ...coverage, visitedLocationIds: [...visited].sort(), newItemIds: [...newItems].sort(), endingIds: [...endings].sort() },
      elapsedMs: Math.round(performance.now() - started), stateActionCount: view.actionCount, completedAt: new Date().toISOString() };
    stage = 'report_write'; await writeReport();
    log('INFO', 'desktop_soak_run_complete', { elapsedMs: report.elapsedMs, ...counters, fieldCount: SOAK_FIELDS.length });
    return report;
  } catch (error) {
    log('ERROR', 'desktop_soak_failure', { mode, ...classifySoakFailure(error), stage, operation, captureSummary, ...counters, errors });
    throw new Error('桌面长期验收失败，请检查隔离测试日志。');
  } finally {
    clearInterval(progress);
    for (const remove of listeners) remove();
  }
}
