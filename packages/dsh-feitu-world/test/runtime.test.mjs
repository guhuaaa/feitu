import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGameStore } from '../lib/runtime.js';
import { stateHash } from '../lib/persistence.js';
import { apply as applyDshPlugin } from '../lib/index.js';
import { requestCharacterDialogue, requestDeepSeekEvent } from '../lib/deepseek.js';
import { buildCharacterDialogueAuthority } from '../lib/character-authority.js';
import { OPENING } from '../lib/opening.js';

const exec = { agent: { id: 'test-player' } };
const storageDir = mkdtempSync(join(tmpdir(), 'feitu-runtime-'));

test('world hub exposes only registered regions and playable dungeons', () => {
  const store = createGameStore({ storageDir });
  const world = store.act({ action: 'world_view' }, exec);
  assert.equal(world.schema, 'feitu-world/world-view/v1');
  assert.deepEqual(world.regions.map((item) => item.id), ['REGION_103']);
  assert.deepEqual(world.dungeons.map((item) => item.id), ['one-line-last-train']);
  assert.equal(world.announcedDungeons.length, 10);
  assert.deepEqual(world.announcedDungeons[0], { id: 'eating-hotpot', name: '吃人的火锅店', status: 'ANNOUNCED', playable: false, chapterRange: '12-20', taskType: '随机任务' });
  assert.equal(world.expansionPolicy.announcedDungeonsAreCatalogOnly, true);
  assert.equal(world.expansionPolicy.runtimeOwnsWorldState, true);
  assert.deepEqual(world.extensionContract, { schema: 'feitu-world/world-extension/v1', version: 1, sourceRefRequired: true, playableRequiresContentManifestAudit: true });
  assert.equal(Object.hasOwn(world, 'world_state'), false);
});

test('world hub gates dungeon selection before a run starts', () => {
  const store = createGameStore({ storageDir });
  assert.throws(
    () => store.act({ action: 'start', role_id: 'zhunin', dungeon_id: 'unregistered-dungeon' }, exec),
    /副本未登记或当前不可玩/,
  );
  const view = store.act({ action: 'start', role_id: 'zhunin', dungeon_id: 'one-line-last-train' }, exec);
  assert.equal(view.dungeon.id, 'one-line-last-train');
});

test('start exposes a player-facing map and frozen role state', () => {
  const store = createGameStore({ storageDir });
  const view = store.act({ action: 'start', role_id: 'zhunin' }, exec);
  assert.equal(view.location.id, 'L003');
  assert.equal(view.world.regionId, 'REGION_103');
  assert.equal(view.role.name, '祝宁');
  assert.equal(view.map.length, 10);
  assert.deepEqual(view.inventory.map((item) => item.id), ['I001', 'I002', 'I003']);
  assert.deepEqual(view.pressure, { value: 38, max: 100, phase: 'LOW', countdown: 80, communication: 'AVAILABLE', collapsed: false });
  assert.equal(view.npcStatus.xumeng.status, 'ON_SITE_COORDINATION');
  assert.equal(Object.hasOwn(view.npcStatus, 'linlan'), false);
});

test('the shared rest prologue precedes play and survives role changes and resume', () => {
  for (const role_id of ['zhunin', 'linenchuan']) {
    const store = createGameStore({ storageDir });
    const preview = store.view(exec);
    assert.equal(preview.started, false);
    assert.match(preview.opening.paragraphs.join(''), /李念川.*我去喘口气.*祝宁一起去吧/s);
    const start = store.act({ action: 'start', role_id }, exec);
    assert.deepEqual(start.opening, preview.opening);
    assert.equal(start.location.id, 'L003');
    assert.equal(start.turn, 0);
    assert.equal(start.freeActionEvent, null);
    assert.equal(start.helmet.mission.title, '暂时休息 · 留意同伴状态');
    assert.ok(start.choices.some((choice) => choice.action === 'submit_choice'));
    assert.doesNotMatch(JSON.stringify([start.visibleFacts, start.role.knowledge, start.location, start.map, start.choices]), /症状加重|E级任务|鱼人|末班车|老旧站台|继续清理/);
    assert.ok(start.visibleFacts.includes('进入下水道时，两人没有接到探索此处的任务，也不知道这里存在什么异常'));
    for (let i = 0; i < 5; i += 1) store.act({ action: 'character_dialogue', target_id: role_id === 'zhunin' ? 'linenchuan' : 'zhunin', dialogue_text: '先休息一会儿' }, exec);
    const switched = store.act({ action: 'switch_role', role_id: role_id === 'zhunin' ? 'linenchuan' : 'zhunin' }, exec);
    assert.deepEqual(switched.opening, start.opening);
    assert.equal(switched.turn, 5);
    store.act({ action: 'save' }, exec);
    const reopened = createGameStore({ storageDir });
    const resumed = reopened.act({ action: 'resume', run_id: start.run_id }, exec);
    assert.deepEqual(resumed.opening, start.opening);
    assert.equal(resumed.location.id, 'L003');
    const resting = reopened.act({ action: 'submit_choice', choice_id: resumed.role.id === 'zhunin' ? 'CHOICE_002_PRESS_CONTINUE' : 'CHOICE_004_CONCEAL_SYMPTOM' }, exec);
    assert.equal(resting.choices.some((choice) => choice.action === 'submit_choice'), false);
    const inspected = reopened.act({ action: 'inspect' }, exec);
    assert.ok(inspected.choices.some((choice) => choice.action === 'submit_choice'));
    const moved = reopened.act({ action: 'free_action', action_text: '沿通道继续向前', selected_action: { action: 'move', target: 'L004' } }, exec);
    assert.equal(moved.location.name, '一号线老旧站台');
    reopened.act({ action: 'move', target: 'L003' }, exec);
    assert.equal(reopened.view(exec).map.find((point) => point.id === 'L004').name, '一号线老旧站台');
  }
});

const privateNovel = new URL(`../../../${OPENING.source.file}`, import.meta.url);
test('opening excerpt matches the private local novel', {
  skip: existsSync(privateNovel) ? false : 'Private source corpus is intentionally excluded from the public repository.',
}, () => {
  const novel = readFileSync(privateNovel, 'utf16le').split(/\r?\n/);
  assert.deepEqual(OPENING.paragraphs, novel.slice(OPENING.source.startLine - 1, OPENING.source.endLine).map((line) => line.trim()));
});

test('opening refreshes older saved recaps without requiring the private corpus', () => {
  assert.match(OPENING.paragraphs.at(-1), /两千米李念川才停下/);
  const dir = mkdtempSync(join(tmpdir(), 'feitu-excerpt-save-'));
  const store = createGameStore({ storageDir: dir });
  const view = store.act({ action: 'start', role_id: 'zhunin' }, exec);
  store.act({ action: 'character_dialogue', target_id: 'linenchuan', dialogue_text: '先休息' }, exec);
  const path = join(dir, `${view.run_id}.json`);
  const saved = JSON.parse(readFileSync(path, 'utf8'));
  saved.opening = { id: OPENING.id, title: '前情提要 · 暂歇', locationId: 'L003', paragraphs: ['旧的改写前情。'] };
  saved.deterministic_state_hash = stateHash(saved);
  writeFileSync(path, JSON.stringify(saved), 'utf8');
  const restored = createGameStore({ storageDir: dir }).act({ action: 'resume', run_id: view.run_id }, exec);
  assert.deepEqual(restored.opening, OPENING);
  assert.equal(restored.turn, saved.turn);
  assert.deepEqual(restored.visibleDialogue, saved.dialogue_history);
});

test('pressure clock advances deterministically and exposes only a player summary', () => {
  const store = createGameStore({ storageDir });
  store.act({ action: 'start', role_id: 'zhunin' }, exec);
  const moved = store.act({ action: 'move', target_id: 'L002' }, exec);
  assert.equal(moved.pressure.value, 39);
  assert.equal(moved.pressure.countdown, 79);
  assert.equal(Object.hasOwn(moved, 'world_state'), false);
  assert.equal(Object.hasOwn(moved, 'pending_consequences'), false);
  assert.equal(Object.hasOwn(moved.npcStatus.xumeng, 'pressure'), false);
});

test('signal choice updates the visible support status without exposing NPC plans', () => {
  const store = createGameStore({ storageDir });
  store.act({ action: 'start', role_id: 'zhunin' }, exec);
  store.act({ action: 'submit_choice', choice_id: 'CHOICE_001_PROTECT_REPORT' }, exec);
  const view = store.act({ action: 'submit_choice', choice_id: 'CHOICE_005_SEND_EVIDENCE_ZN' }, exec);
  assert.equal(view.npcStatus.xumeng.status, 'VERIFYING_SIGNAL');
  assert.equal(Object.hasOwn(view, 'npc_plan_progress'), false);
});

test('player view contains only the source-backed on-site contact', () => {
  const store = createGameStore({ storageDir });
  store.act({ action: 'start', role_id: 'zhunin' }, exec);
  const talked = store.act({ action: 'talk', target: 'xumeng' }, exec);
  assert.equal(talked.visibleDialogue.at(-1).speaker, '徐萌');
  assert.match(talked.visibleDialogue.at(-1).text, /现场负责人/);
  assert.equal(Object.hasOwn(talked.npcStatus, 'linlan'), false);
});

test('character dialogue exposes only the two targets allowed for the active role', () => {
  const store = createGameStore({ storageDir });
  const zhuView = store.act({ action: 'start', role_id: 'zhunin' }, exec);
  assert.deepEqual(zhuView.dialogueTargets.map((item) => item.id), ['linenchuan', 'xumeng']);
  const liView = store.act({ action: 'switch_role', role_id: 'linenchuan' }, exec);
  assert.deepEqual(liView.dialogueTargets.map((item) => item.id), ['zhunin', 'xumeng']);
});

test('character dialogue authority compiles the target state and matching decision rule', () => {
  const store = createGameStore({ storageDir });
  const view = store.act({ action: 'start', role_id: 'zhunin' }, exec);
  const authority = buildCharacterDialogueAuthority('linenchuan', view, '你现在感觉怎么样');
  assert.equal(authority.character_id, 'linenchuan');
  assert.equal(authority.point_in_time_state.relationship_state, '与祝宁短暂双向戒备');
  assert.deepEqual(authority.point_in_time_state.unknown, ['活鱼人即将出现', '自身症状来源']);
  assert.equal(authority.active_rules.some((rule) => rule.id === 'LN-DECEPTION-01'), true);
  assert.equal(authority.active_rules.some((rule) => rule.id === 'LN-INFO-01'), false);
  assert.ok(authority.source_refs.includes('E000304'));
  const laterAuthority = buildCharacterDialogueAuthority('linenchuan', { ...view, currentNode: { ...view.currentNode, id: 'NODE_003' } }, '你现在感觉怎么样');
  assert.equal(laterAuthority.point_in_time_state, null);
  assert.equal(laterAuthority.active_rules.some((rule) => rule.id === 'LN-DECEPTION-01'), false);
});

test('character dialogue returns an in-character exchange without mutating vitals', () => {
  const store = createGameStore({ storageDir });
  const started = store.act({ action: 'start', role_id: 'zhunin' }, exec);
  const vitalsBefore = started.characters.map((item) => item.physiology);
  const view = store.act({ action: 'character_dialogue', target_id: 'linenchuan', dialogue_text: '你现在感觉怎么样', client_action_id: 'dialogue-001' }, exec);
  const exchange = view.visibleDialogue.at(-1);
  assert.equal(exchange.actorName, '祝宁');
  assert.equal(exchange.speaker, '李念川');
  assert.equal(exchange.userText, '你现在感觉怎么样');
  assert.match(exchange.text, /有点闷|头也疼/);
  assert.equal(exchange.source, 'deterministic-fallback');
  assert.deepEqual(view.characters.map((item) => item.physiology), vitalsBefore);
  assert.equal(view.pressure.value, started.pressure.value);
});

test('character dialogue rejects self/unknown targets and validates the model speaker', () => {
  const store = createGameStore({ storageDir });
  store.act({ action: 'start', role_id: 'zhunin' }, exec);
  assert.throws(() => store.act({ action: 'character_dialogue', target_id: 'zhunin', dialogue_text: '测试' }, exec), /不能与这个角色对话/);
  assert.throws(() => store.act({ action: 'character_dialogue', target_id: 'hunter', dialogue_text: '测试' }, exec), /不能与这个角色对话/);
  const view = store.act({ action: 'character_dialogue', target_id: 'linenchuan', dialogue_text: '还能继续吗', model_dialogue: { speaker_id: 'linenchuan', reply: '能。我会跟紧你，读数再变就立刻报告。' } }, exec);
  assert.equal(view.visibleDialogue.at(-1).source, 'deepseek');
  assert.equal(view.visibleDialogue.at(-1).text, '能。我会跟紧你，读数再变就立刻报告。');
  const oocRejected = store.act({ action: 'character_dialogue', target_id: 'xumeng', dialogue_text: '收到吗', model_dialogue: { speaker_id: 'xumeng', reply: '作为AI语言模型，我无法扮演这个角色。' } }, exec);
  assert.equal(oocRejected.visibleDialogue.at(-1).source, 'deterministic-fallback');
  assert.doesNotMatch(oocRejected.visibleDialogue.at(-1).text, /AI|语言模型/);
});

test('rest dialogue rejects the obsolete shaft briefing and keeps natural replies', () => {
  const store = createGameStore({ storageDir });
  store.act({ action: 'start', role_id: 'zhunin' }, exec);
  for (const reply of [
    '行，频道是通的，我现在就跟徐萌报——离开孢子后症状反而加重，申请先观察，不急着下井。',
    '等休息好了再下井。',
    '我们还没下井，先准备一下。',
    '我们还在地面。',
    '休息后继续任务。',
  ]) {
    const view = store.act({ action: 'character_dialogue', target_id: 'linenchuan', dialogue_text: '跟徐萌说一下吧', model_dialogue: { speaker_id: 'linenchuan', reply } }, exec);
    assert.equal(view.visibleDialogue.at(-1).source, 'deterministic-fallback');
    assert.equal(view.visibleDialogue.at(-1).text, '嗯，我跟徐萌说一声。我还是有点晕，想再歇会儿。');
    assert.equal(view.location.id, 'L003');
  }
  const correct = '嗯，我跟徐萌说一声。我们已经下来休息了，让她别担心。';
  const accepted = store.act({ action: 'character_dialogue', target_id: 'linenchuan', dialogue_text: '跟徐萌说一下吧', model_dialogue: { speaker_id: 'linenchuan', reply: correct } }, exec);
  assert.equal(accepted.visibleDialogue.at(-1).text, correct);
  assert.equal(accepted.visibleDialogue.at(-1).source, 'deepseek');
  store.act({ action: 'move', target: 'L002' }, exec);
  store.act({ action: 'move', target: 'L001' }, exec);
  const returned = store.act({ action: 'character_dialogue', target_id: 'linenchuan', dialogue_text: '先停一下', model_dialogue: { speaker_id: 'linenchuan', reply: '不急着下井。' } }, exec);
  assert.equal(returned.visibleDialogue.at(-1).source, 'deepseek');
});

test('a conflicting story cannot move the rest scene back to the shaft or apply model effects', () => {
  const store = createGameStore({ storageDir });
  const started = store.act({ action: 'start', role_id: 'zhunin' }, exec);
  const args = { action: 'free_action', action_text: '我陪他休息一会儿' };
  const baseline = store.act(args, exec);
  store.act({ action: 'start', role_id: 'zhunin' }, exec);
  const rejected = store.act({ ...args, model_event: { actor_id: 'zhunin', intent: 'observe', event_title: '等待下井', event_text: '祝宁示意李念川在井口警戒区边缘坐下。', story_segment: '祝宁示意李念川在井口警戒区边缘坐下，准备下井继续任务。', effects: { pollution_delta: 10, characters: { linenchuan: { mental_delta: -6 } } } } }, exec);
  assert.equal(rejected.freeActionEvent.source, 'deterministic-fallback');
  assert.doesNotMatch(rejected.freeActionEvent.storySegment, /井口|准备下井/);
  assert.equal(rejected.location.id, started.location.id);
  assert.deepEqual(rejected.characters.map((item) => item.physiology), baseline.characters.map((item) => item.physiology));
  assert.equal(rejected.pressure.value, baseline.pressure.value);
});

test('the dialogue adapter rejects a false OOC self-check against the rest context', async () => {
  const store = createGameStore({ storageDir });
  const view = store.act({ action: 'start', role_id: 'zhunin' }, exec);
  let context;
  const mock = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    context = JSON.parse(JSON.parse(body).messages.find((item) => item.role === 'user').content).player_view;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ speaker_id: 'linenchuan', reply: '行，先休息，不急着下井。', ooc_check: { voice_consistent: true, knowledge_bounded: true, player_not_controlled: true } }) } }] }));
  });
  await new Promise((resolve) => mock.listen(0, '127.0.0.1', resolve));
  try {
    const result = await requestCharacterDialogue({ view, targetId: 'linenchuan', dialogueText: '跟徐萌说一下吧', apiKey: 'test-only', endpoint: `http://127.0.0.1:${mock.address().port}` });
    assert.equal(result.model_dialogue, null);
    assert.equal(result.reason, 'DEEPSEEK_NARRATIVE_CONFLICT');
    assert.match(context.openingSituation, /已经下井/);
    assert.match(context.openingSituation, /没有待执行的下井任务/);
  } finally {
    await new Promise((resolve) => mock.close(resolve));
  }
});

test('the dialogue adapter rejects a reply that violates an active character rule', async () => {
  const store = createGameStore({ storageDir });
  const view = store.act({ action: 'start', role_id: 'zhunin' }, exec);
  const mock = createServer(async (req, res) => {
    for await (const _chunk of req) { /* drain request */ }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ speaker_id: 'linenchuan', reply: '我刚才已经报告徐萌了，她同意我们继续休息。', ooc_check: { voice_consistent: true, knowledge_bounded: true, player_not_controlled: true } }) } }] }));
  });
  await new Promise((resolve) => mock.listen(0, '127.0.0.1', resolve));
  try {
    const result = await requestCharacterDialogue({ view, targetId: 'linenchuan', dialogueText: '跟徐萌说一下吧', apiKey: 'test-only', endpoint: `http://127.0.0.1:${mock.address().port}` });
    assert.equal(result.model_dialogue, null);
    assert.equal(result.reason, 'DEEPSEEK_CHARACTER_AUTHORITY_CONFLICT');
  } finally {
    await new Promise((resolve) => mock.close(resolve));
  }
});

test('pressure collapse is a bounded visible state transition', () => {
  const store = createGameStore({ storageDir });
  store.act({ action: 'start', role_id: 'zhunin' }, exec);
  let view;
  for (let index = 0; index < 57; index += 1) view = store.act({ action: 'inspect' }, exec);
  assert.equal(view.pressure.phase, 'COLLAPSED');
  assert.equal(view.pressure.collapsed, true);
  assert.equal(view.pressure.communication, 'LOST');
  assert.equal(view.npcStatus.xumeng.status, 'OFFLINE');
});

test('movement rejects invented edges and accepts canon edge', () => {
  const store = createGameStore({ storageDir });
  store.act({ action: 'start', role_id: 'linenchuan' }, exec);
  assert.throws(() => store.act({ action: 'move', target_id: 'L005' }, exec), /不能直接前往/);
  const view = store.act({ action: 'move', target_id: 'L002' }, exec);
  assert.equal(view.location.id, 'L002');
  assert.ok(view.location.takeableItems.some((item) => item.id === 'I003'));
});

test('inspect and save/load preserve deterministic evidence', () => {
  const store = createGameStore({ storageDir });
  store.act({ action: 'start', role_id: 'zhunin' }, exec);
  store.act({ action: 'move', target_id: 'L002' }, exec);
  const inspected = store.act({ action: 'inspect' }, exec);
  assert.ok(inspected.discoveredClues.includes('水系孢子需要收容'));
  store.act({ action: 'save' }, exec);
  store.act({ action: 'move', target_id: 'L003' }, exec);
  const restored = store.act({ action: 'load' }, exec);
  assert.equal(restored.location.id, 'L002');
  assert.ok(restored.discoveredClues.includes('水系孢子需要收容'));
});

test('route choices advance frozen nodes and reject the other role', () => {
  const store = createGameStore({ storageDir });
  const view = store.act({ action: 'start', role_id: 'zhunin' }, exec);
  assert.equal(view.currentNode.id, 'NODE_002');
  assert.throws(() => store.act({ action: 'submit_choice', choice_id: 'CHOICE_003_SELF_REPORT' }, exec), /不可见/);
  const next = store.act({ action: 'submit_choice', choice_id: 'CHOICE_001_PROTECT_REPORT' }, exec);
  assert.equal(next.currentNode.id, 'NODE_004');
  assert.ok(next.visibleFacts.includes('队友异常已被报告'));
});

test('interactive event results are role- and node-gated', () => {
  const store = createGameStore({ storageDir });
  store.act({ action: 'start', role_id: 'zhunin' }, exec);
  for (const choice_id of ['CHOICE_001_PROTECT_REPORT', 'CHOICE_005_SEND_EVIDENCE_ZN', 'CHOICE_010_ENTER_DEEP_FIELD', 'CHOICE_011_STAY_AND_SHARE', 'CHOICE_013_CHECK_OUTSIDE_ZN', 'CHOICE_018_OBSERVE_TESTIMONY_ZN']) {
    store.act({ action: 'submit_choice', choice_id }, exec);
  }
  assert.equal(store.view(exec).currentNode.id, 'NODE_013_ZN');
  const result = store.act({ action: 'resolve_interactive_event', event_id: 'IE_ZN_TRACK_CONFRONTATION', result_id: 'IER_ZN_TRACK_SUCCESS' }, exec);
  assert.equal(result.currentNode.id, 'NODE_014');
  assert.deepEqual(result.recoveryWindows, [{ id: 'RW_003_ZN_STABILIZATION', status: 'OPEN' }]);
});

test('escape recovery event is visible and accepts either playable role', () => {
  const store = createGameStore({ storageDir });
  store.act({ action: 'start', role_id: 'linenchuan' }, exec);
  for (const choice_id of ['CHOICE_003_SELF_REPORT', 'CHOICE_006_SEND_SIGNAL_LN', 'CHOICE_009_EVACUATE_NOW']) {
    store.act({ action: 'submit_choice', choice_id }, exec);
  }
  const pending = store.view(exec);
  assert.equal(pending.currentNode.id, 'NODE_017');
  assert.ok(pending.choices.some((item) => item.event_id === 'IE_PRE_EXPANSION_ESCAPE'));
  const escaped = store.act({ action: 'resolve_interactive_event', event_id: 'IE_PRE_EXPANSION_ESCAPE', result_id: 'IER_ESCAPE_SUCCESS' }, exec);
  assert.equal(escaped.ending.id, 'END_04');
});

test('protection gate commits END_01 and delayed protection commits END_03', () => {
  const store = createGameStore({ storageDir });
  const execEnd1 = { agent: { id: 'test-ending-01' } };
  store.act({ action: 'start', role_id: 'zhunin' }, execEnd1);
  for (const choice_id of ['CHOICE_001_PROTECT_REPORT', 'CHOICE_005_SEND_EVIDENCE_ZN', 'CHOICE_010_ENTER_DEEP_FIELD', 'CHOICE_011_STAY_AND_SHARE', 'CHOICE_013_CHECK_OUTSIDE_ZN', 'CHOICE_018_OBSERVE_TESTIMONY_ZN']) store.act({ action: 'submit_choice', choice_id }, execEnd1);
  store.act({ action: 'resolve_interactive_event', event_id: 'IE_ZN_TRACK_CONFRONTATION', result_id: 'IER_ZN_TRACK_SUCCESS' }, execEnd1);
  const end1 = store.act({ action: 'submit_choice', choice_id: 'CHOICE_020_PROTECT_IN_TIME' }, execEnd1);
  assert.equal(end1.currentNode.id, 'ENDING_NODE_01');
  assert.equal(end1.ending.id, 'END_01');
  assert.deepEqual(end1.recoveryWindows, []);

  const execEnd3 = { agent: { id: 'test-ending-03' } };
  store.act({ action: 'start', role_id: 'zhunin' }, execEnd3);
  for (const choice_id of ['CHOICE_001_PROTECT_REPORT', 'CHOICE_005_SEND_EVIDENCE_ZN', 'CHOICE_010_ENTER_DEEP_FIELD', 'CHOICE_011_STAY_AND_SHARE', 'CHOICE_013_CHECK_OUTSIDE_ZN', 'CHOICE_018_OBSERVE_TESTIMONY_ZN']) store.act({ action: 'submit_choice', choice_id }, execEnd3);
  store.act({ action: 'resolve_interactive_event', event_id: 'IE_ZN_TRACK_CONFRONTATION', result_id: 'IER_ZN_TRACK_PARTIAL' }, execEnd3);
  const end3 = store.act({ action: 'submit_choice', choice_id: 'CHOICE_021_DELAY_PROTECTION' }, execEnd3);
  assert.equal(end3.currentNode.id, 'ENDING_NODE_03');
  assert.equal(end3.ending.id, 'END_03');
  assert.deepEqual(end3.recoveryWindows, []);
});

function commitGuardTestEnding(store, player) {
  store.act({ action: 'start', role_id: 'zhunin' }, player);
  for (const choice_id of ['CHOICE_001_PROTECT_REPORT', 'CHOICE_005_SEND_EVIDENCE_ZN', 'CHOICE_010_ENTER_DEEP_FIELD', 'CHOICE_011_STAY_AND_SHARE', 'CHOICE_013_CHECK_OUTSIDE_ZN', 'CHOICE_018_OBSERVE_TESTIMONY_ZN']) store.act({ action: 'submit_choice', choice_id }, player);
  store.act({ action: 'resolve_interactive_event', event_id: 'IE_ZN_TRACK_CONFRONTATION', result_id: 'IER_ZN_TRACK_SUCCESS' }, player);
  store.act({ action: 'save' }, player);
  return store.act({ action: 'submit_choice', choice_id: 'CHOICE_020_PROTECT_IN_TIME' }, player);
}

test('committed ending rejects gameplay without changing view or disk and preserves recovery controls', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'feitu-ending-guard-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = createGameStore({ storageDir: directory });
  const ended = commitGuardTestEnding(store, exec);
  assert.equal(ended.ending.id, 'END_01');
  const before = store.view(exec);
  const path = join(directory, `${ended.run_id}.json`);
  const bytes = readFileSync(path, 'utf8');
  for (const action of ['move', 'inspect', 'take', 'use', 'talk', 'free_action', 'character_dialogue', 'submit_choice', 'resolve_interactive_event']) {
    assert.throws(() => store.act({ action, action_text: '继续行动', dialogue_text: '继续说话' }, exec), /本局已结束/);
    assert.deepEqual(store.view(exec), before, action);
    assert.equal(readFileSync(path, 'utf8'), bytes, action);
  }
  assert.equal(store.act({ action: 'export_log' }, exec).run_id, ended.run_id);
  const reopened = createGameStore({ storageDir: directory });
  assert.equal(reopened.act({ action: 'resume', run_id: ended.run_id }, exec).ending.id, 'END_01');
  const restored = store.act({ action: 'load' }, exec);
  assert.equal(restored.ending, null);
  assert.equal(restored.currentNode.id, 'NODE_014');
  store.act({ action: 'submit_choice', choice_id: 'CHOICE_020_PROTECT_IN_TIME' }, exec);
  assert.equal(store.act({ action: 'save' }, exec).checkpoint.available, true);
  assert.equal(store.act({ action: 'load' }, exec).ending.id, 'END_01');
  assert.equal(store.act({ action: 'switch_role', role_id: 'linenchuan' }, exec).ending.id, 'END_01');
  assert.notEqual(store.act({ action: 'fork' }, exec).run_id, ended.run_id);
  const restarted = store.act({ action: 'start', role_id: 'linenchuan' }, exec);
  assert.equal(restarted.ending, null);
  assert.equal(restarted.turn, 0);
  assert.notEqual(restarted.run_id, ended.run_id);
});

test('both model adapters reject a real ending before any network request', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'feitu-ending-model-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const view = commitGuardTestEnding(createGameStore({ storageDir: directory }), exec);
  let requests = 0;
  const mock = createServer((_request, response) => { requests += 1; response.end('{}'); });
  await new Promise((done) => mock.listen(0, '127.0.0.1', done));
  try {
    const options = { view, apiKey: 'test-only', endpoint: `http://127.0.0.1:${mock.address().port}` };
    await assert.rejects(requestCharacterDialogue({ ...options, targetId: 'linenchuan', dialogueText: '继续说话' }), /本局已结束/);
    await assert.rejects(requestDeepSeekEvent({ ...options, actionText: '继续行动' }), /本局已结束/);
    assert.equal(requests, 0);
  } finally { await new Promise((done) => mock.close(done)); }
});

test('a second store instance can resume the persisted run', () => {
  const first = createGameStore({ storageDir });
  first.act({ action: 'start', role_id: 'linenchuan' }, exec);
  first.act({ action: 'move', target_id: 'L002' }, exec);
  const runId = first.view(exec).run_id;
  const second = createGameStore({ storageDir });
  const resumed = second.act({ action: 'resume', run_id: runId }, exec);
  assert.equal(resumed.run_id, runId);
  assert.equal(resumed.location.id, 'L002');
  assert.ok(resumed.checkpoint.available === false || resumed.checkpoint.available === true);
});

test('legacy saves migrate in memory and tampered saves fail closed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'feitu-save-integrity-'));
  const first = createGameStore({ storageDir: dir });
  const started = first.act({ action: 'start', role_id: 'zhunin' }, exec);
  first.act({ action: 'save' }, exec);
  const path = join(dir, `${started.run_id}.json`);
  const saved = JSON.parse(readFileSync(path, 'utf8'));
  delete saved.save_format;
  saved.deterministic_state_hash = stateHash(saved);
  writeFileSync(path, `${JSON.stringify(saved)}\n`, 'utf8');
  const migrated = createGameStore({ storageDir: dir }).act({ action: 'resume', run_id: started.run_id }, exec);
  assert.equal(migrated.run_id, started.run_id);
  const tampered = JSON.parse(readFileSync(path, 'utf8'));
  tampered.locationId = 'L010';
  writeFileSync(path, `${JSON.stringify(tampered)}\n`, 'utf8');
  assert.throws(
    () => createGameStore({ storageDir: dir }).act({ action: 'resume', run_id: started.run_id }, exec),
    /存档完整性校验失败/,
  );
});

test('old shaft openings migrate with an archived original while progressed saves stay put', () => {
  for (const progressed of [false, true]) {
    const dir = mkdtempSync(join(tmpdir(), 'feitu-rest-migration-'));
    const store = createGameStore({ storageDir: dir });
    const start = store.act({ action: 'start', role_id: 'zhunin' }, exec);
    const path = join(dir, `${start.run_id}.json`);
    const old = JSON.parse(readFileSync(path, 'utf8'));
    delete old.opening;
    old.locationId = 'L001'; old.location_states = { current: 'L001', visited: [], inspected: [] };
    old.knowledge_states.known_facts = ['官方评级为 E 级', '李念川离开已知孢子后症状加重'];
    old.log = ['清理小队抵达井口，准备下井。']; old.turn = 2;
    old.dialogue_history = [{ speakerId: 'linenchuan', speaker: '李念川', userText: '跟徐萌说一下吧', text: '不急着下井。', source: 'deepseek', turn: 2 }];
    if (progressed) old.discoveredClues = ['已检查的现场'];
    old.deterministic_state_hash = stateHash(old);
    writeFileSync(path, JSON.stringify(old), 'utf8');
    const restored = createGameStore({ storageDir: dir }).act({ action: 'resume', run_id: start.run_id }, exec);
    assert.equal(restored.location.id, progressed ? 'L001' : 'L003');
    if (!progressed) {
      assert.equal(restored.turn, 2);
      assert.ok(restored.opening);
      assert.doesNotMatch(JSON.stringify([restored.visibleFacts, restored.visibleNarrative, restored.visibleDialogue]), /不急着下井|离开已知孢子后症状加重/);
      const saved = JSON.parse(readFileSync(path, 'utf8'));
      assert.deepEqual(saved.legacy_opening_snapshot, old);
      assert.equal(saved.deterministic_state_hash, stateHash(saved));
      assert.equal(Object.hasOwn(restored, 'legacy_opening_snapshot'), false);
      const again = createGameStore({ storageDir: dir }).act({ action: 'resume', run_id: start.run_id }, exec);
      assert.equal(again.location.id, 'L003');
    }
  }
});

test('player action log exports replayable intent without hidden state', () => {
  const store = createGameStore({ storageDir });
  store.act({ action: 'start', role_id: 'zhunin' }, exec);
  store.act({ action: 'inspect' }, exec);
  store.act({ action: 'save' }, exec);
  const exported = store.act({ action: 'export_log' }, exec);
  assert.equal(exported.actions.map((item) => item.action).join(','), 'start,inspect,save');
  assert.equal(exported.actions.some((item) => Object.prototype.hasOwnProperty.call(item, 'world_state')), false);
  assert.equal(store.view(exec).actionCount, 3);
});

test('exported player action log replays to the same visible route', () => {
  const source = createGameStore({ storageDir });
  const sourceExec = { agent: { id: 'replay-source' } };
  source.act({ action: 'start', role_id: 'linenchuan' }, sourceExec);
  source.act({ action: 'move', target_id: 'L002' }, sourceExec);
  source.act({ action: 'inspect' }, sourceExec);
  const log = source.act({ action: 'export_log' }, sourceExec);
  const replay = createGameStore({ storageDir: mkdtempSync(join(tmpdir(), 'feitu-replay-test-')) });
  const replayExec = { agent: { id: 'replay-target' } };
  let final;
  for (const action of log.actions) final = replay.act(action, replayExec);
  assert.equal(final.role.id, 'linenchuan');
  assert.equal(final.location.id, 'L002');
  assert.deepEqual(final.discoveredClues, ['E级任务记录：16个污染物已被标记为死亡', '水系孢子需要收容']);
  assert.equal(final.actionCount, 3);
});

test('free action creates a bounded event and exposes helmet readings', () => {
  const store = createGameStore({ storageDir });
  store.act({ action: 'start', role_id: 'zhunin' }, exec);
  const observed = store.act({ action: 'free_action', action_text: '我检查入口附近的积水和孢子痕迹' }, exec);
  assert.equal(observed.freeActionEvent.source, 'deterministic-fallback');
  assert.equal(observed.freeActionEvent.accepted, true);
  assert.equal(observed.location.id, 'L003');
  assert.equal(observed.helmet.pollution.value, 40);
  assert.equal(typeof observed.helmet.communication.signal, 'number');
  assert.equal(observed.freeActionEvent.systemLines.at(-1).label, '头盔读数');
  assert.match(observed.freeActionEvent.systemLines.at(-1).text, /污染 40\/100/);
  assert.equal(Object.hasOwn(observed, 'pending_consequences'), false);
  const moved = store.act({ action: 'free_action', action_text: '前往 L002' }, exec);
  assert.equal(moved.location.id, 'L002');
  assert.equal(moved.freeActionEvent.branch, 'L002');
});

test('a clicked visible choice uses the free-action story pipeline', () => {
  const store = createGameStore({ storageDir });
  store.act({ action: 'start', role_id: 'zhunin' }, exec);
  const view = store.act({
    action: 'free_action',
    action_text: '报告李念川异常并请求保护',
    selected_action: { action: 'submit_choice', choice_id: 'CHOICE_001_PROTECT_REPORT' },
    client_action_id: 'clicked-choice-001',
  }, exec);
  assert.equal(view.currentNode.id, 'NODE_004');
  assert.equal(view.freeActionEvent.intent, 'choice');
  assert.equal(view.freeActionEvent.source, 'deterministic-fallback');
  assert.match(view.freeActionEvent.storySegment, /祝宁/);
  assert.equal(view.freeActionEvent.systemLines.at(-1).label, '头盔读数');
});

test('model event may choose only a currently visible branch', () => {
  const store = createGameStore({ storageDir });
  store.act({ action: 'start', role_id: 'zhunin' }, exec);
  const advanced = store.act({ action: 'free_action', action_text: '报告异常', model_event: { intent: 'choice', choice_id: 'CHOICE_001_PROTECT_REPORT', event_title: '频道亮起', event_text: '徐萌收到异常报告。', effects: { pollution_delta: 4, oxygen_delta: -2, suit_integrity_delta: -1, countdown_delta: -1, communication: 'USED' } } }, exec);
  assert.equal(advanced.currentNode.id, 'NODE_004');
  assert.equal(advanced.freeActionEvent.source, 'deepseek');
  assert.deepEqual(advanced.freeActionEvent.appliedEffects, ['污染 +4', '氧气修正 -2', '防护修正 -1', '窗口 -1', '通讯 USED']);
  assert.equal(advanced.helmet.pollution.value, 44);
  assert.equal(advanced.helmet.communication.status, 'USED');
  assert.ok(advanced.freeActionEvent.systemLines.some((item) => item.label === '状态写入'));
  const rejected = store.act({ action: 'free_action', action_text: '越过封锁', model_event: { intent: 'choice', choice_id: 'CHOICE_023_DRIVER_CRUSH_LN' } }, exec);
  assert.equal(rejected.freeActionEvent.accepted, false);
});

test('role switching keeps the current run while changing the first-person branch set', () => {
  const store = createGameStore({ storageDir });
  const initial = store.act({ action: 'start', role_id: 'zhunin' }, exec);
  assert.equal(initial.choices.some((item) => item.choice_id === 'CHOICE_001_PROTECT_REPORT'), true);
  const started = store.act({ action: 'character_dialogue', target_id: 'linenchuan', dialogue_text: '先休息一会儿' }, exec);
  const switched = store.act({ action: 'switch_role', role_id: 'linenchuan', run_id: started.run_id, expected_turn: started.turn }, exec);
  assert.equal(switched.run_id, started.run_id);
  assert.equal(switched.turn, started.turn);
  assert.equal(switched.location.id, started.location.id);
  assert.equal(switched.currentNode.id, started.currentNode.id);
  assert.equal(switched.role.id, 'linenchuan');
  assert.ok(switched.choices.some((item) => item.choice_id === 'CHOICE_003_SELF_REPORT'));
  assert.equal(switched.choices.some((item) => item.choice_id === 'CHOICE_001_PROTECT_REPORT'), false);
});

test('same model event lowers Li Nianchuan mental state faster than Zhu Ning', () => {
  const store = createGameStore({ storageDir });
  const started = store.act({ action: 'start', role_id: 'zhunin' }, exec);
  const before = Object.fromEntries(started.characters.map((item) => [item.id, item.physiology.mental]));
  const advanced = store.act({
    action: 'free_action', action_text: '我检查入口的积水',
    model_event: {
      actor_id: 'zhunin', intent: 'inspect',
      effects: { pollution_delta: 2, oxygen_delta: 0, suit_integrity_delta: 0, countdown_delta: 0, communication: 'UNCHANGED', characters: {
        zhunin: { mental_delta: -2, stamina_delta: -1, heart_rate_delta: 4 },
        linenchuan: { mental_delta: -2, stamina_delta: -1, heart_rate_delta: 4 },
      } },
    },
  }, exec);
  const after = Object.fromEntries(advanced.characters.map((item) => [item.id, item.physiology.mental]));
  assert.ok(before.zhunin - after.zhunin < before.linenchuan - after.linenchuan);
  assert.match(advanced.freeActionEvent.systemLines.find((item) => item.label === '角色体征').text, /李念川/);
});

test('DSH tool free_action routes through the DeepSeek adapter before runtime apply', async () => {
  let registered;
  applyDshPlugin({
    systemPrompt: { section() {} },
    tools: { register(tool) { registered = tool; } },
  }, { storageDir: mkdtempSync(join(tmpdir(), 'feitu-dsh-plugin-free-action-')) });
  assert.ok(registered);
  await registered.execute({ action: 'start', role_id: 'zhunin' }, { agent: { id: 'dsh-plugin-free-action' } });
  const view = await registered.execute({ action: 'free_action', action_text: '我观察入口附近的积水' }, { agent: { id: 'dsh-plugin-free-action' } });
  assert.equal(view.freeActionEvent.accepted, true);
  assert.match(view.notice, /在线剧情服务/);
});

test('DSH character_dialogue uses the selected character model with OOC checks', async () => {
  let requestBody;
  const mock = createServer(async (request, response) => {
    let text = '';
    for await (const chunk of request) text += chunk;
    requestBody = JSON.parse(text);
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ model: 'deepseek-chat', choices: [{ message: { content: JSON.stringify({ speaker_id: 'linenchuan', reply: '有点闷，头也疼，不过还能动。我会跟紧你。', ooc_check: { voice_consistent: true, knowledge_bounded: true, player_not_controlled: true } }) } }] }));
  });
  await new Promise((resolve) => mock.listen(0, '127.0.0.1', resolve));
  const previousKey = process.env.DEEPSEEK_API_KEY;
  const previousEndpoint = process.env.DEEPSEEK_API_BASE_URL;
  delete process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_BASE_URL = `http://127.0.0.1:${mock.address().port}/chat/completions`;
  try {
    let registered;
    applyDshPlugin({ get(name) { return name === 'credentials' ? { resolve: async () => ({ value: 'test-only-not-a-real-key' }) } : undefined; }, systemPrompt: { section() {} }, tools: { register(tool) { registered = tool; } } }, { storageDir: mkdtempSync(join(tmpdir(), 'feitu-dsh-character-dialogue-')) });
    const dialogueExec = { agent: { id: 'dsh-character-dialogue' } };
    await registered.execute({ action: 'start', role_id: 'zhunin' }, dialogueExec);
    const view = await registered.execute({ action: 'character_dialogue', target_id: 'linenchuan', dialogue_text: '你现在感觉怎么样' }, dialogueExec);
    assert.equal(view.visibleDialogue.at(-1).speaker, '李念川');
    assert.equal(view.visibleDialogue.at(-1).source, 'deepseek');
    assert.match(view.visibleDialogue.at(-1).text, /有点闷/);
    assert.match(requestBody.messages[0].content, /严格保持角色一致性/);
    assert.match(requestBody.messages[0].content, /李念川/);
    const systemPrompt = requestBody.messages.filter((item) => item.role === 'system').map((item) => item.content).join('\n');
    assert.match(systemPrompt, /两人为休息进入下水道/);
    assert.match(systemPrompt, /LN-DECEPTION-01/);
    assert.match(systemPrompt, /短暂双向戒备/);
    assert.match(systemPrompt, /E000304/);
    const context = JSON.parse(requestBody.messages.find((item) => item.role === 'user').content).player_view;
    assert.equal(context.opening.id, 'sewer-rest-v1');
    assert.equal(context.location.id, 'L003');
    assert.match(view.notice, /在线剧情服务已连接/);
  } finally {
    if (previousKey === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = previousKey;
    if (previousEndpoint === undefined) delete process.env.DEEPSEEK_API_BASE_URL; else process.env.DEEPSEEK_API_BASE_URL = previousEndpoint;
    await new Promise((resolve) => mock.close(resolve));
  }
});

test('DSH free_action accepts a DeepSeek-compatible event and advances the visible branch', async () => {
  let requestBody;
  const mock = createServer(async (request, response) => {
    if (request.method !== 'POST') { response.writeHead(405).end(); return; }
    let text = '';
    for await (const chunk of request) text += chunk;
    requestBody = JSON.parse(text);
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ model: 'deepseek-chat', choices: [{ message: { content: JSON.stringify({ narrative_check: { style_consistent: true, character_consistent: true, knowledge_bounded: true, player_agency_preserved: true, facts_bounded: true }, intent: 'choice', choice_id: 'CHOICE_001_PROTECT_REPORT', event_title: '频道亮起', event_text: '徐萌收到异常报告，行动窗口被重新计算。', effects: { pollution_delta: 3, oxygen_delta: -1, suit_integrity_delta: 0, countdown_delta: -1, communication: 'USED' } }) } }] }));
  });
  await new Promise((resolve) => mock.listen(0, '127.0.0.1', resolve));
  const previousKey = process.env.DEEPSEEK_API_KEY;
  const previousEndpoint = process.env.DEEPSEEK_API_BASE_URL;
  delete process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_BASE_URL = `http://127.0.0.1:${mock.address().port}/chat/completions`;
  try {
    let registered;
    applyDshPlugin({ get(name) { return name === 'credentials' ? { resolve: async () => ({ value: 'test-only-not-a-real-key' }) } : undefined; }, systemPrompt: { section() {} }, tools: { register(tool) { registered = tool; } } }, { storageDir: mkdtempSync(join(tmpdir(), 'feitu-dsh-deepseek-bridge-')) });
    const exec = { agent: { id: 'dsh-deepseek-bridge' } };
    await registered.execute({ action: 'start', role_id: 'zhunin' }, exec);
    const view = await registered.execute({ action: 'free_action', action_text: '报告李念川异常并请求保护' }, exec);
    assert.equal(view.freeActionEvent.source, 'deepseek');
    assert.match(requestBody.messages.filter((item) => item.role === 'system').map((item) => item.content).join('\n'), /不能倒写两人最初进入这里的原因/);
    assert.equal(JSON.parse(requestBody.messages.find((item) => item.role === 'user').content).player_view.opening.id, 'sewer-rest-v1');
    assert.equal(view.currentNode.id, 'NODE_004');
    assert.equal(view.helmet.pollution.value, 43);
    assert.equal(view.helmet.communication.status, 'USED');
    assert.ok(view.freeActionEvent.systemLines.some((item) => item.label === '状态写入'));
    assert.match(view.notice, /在线剧情服务已连接/);
  } finally {
    if (previousKey === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = previousKey;
    if (previousEndpoint === undefined) delete process.env.DEEPSEEK_API_BASE_URL; else process.env.DEEPSEEK_API_BASE_URL = previousEndpoint;
    await new Promise((resolve) => mock.close(resolve));
  }
});

test('free action persists a story unlock with the selected actor and audit hashes', () => {
  const store = createGameStore({ storageDir });
  store.act({ action: 'start', role_id: 'zhunin' }, exec);
  const view = store.act({
    action: 'free_action',
    action_text: '我沿着积水边缘观察通讯噪声',
    client_action_id: 'story-unlock-001',
    expected_turn: 0,
    model_event: {
      actor_id: 'zhunin',
      intent: 'inspect',
      event_title: '积水下的回声',
      event_text: '头盔捕捉到积水下方的短促回声，现场没有新增未确认事实。',
      story_segment: '祝宁没有立刻向前。她把灯光压低，沿着积水边缘观察通讯噪声的起伏。\n\n回声从水面下方折回，像有什么东西在更远处碰了一下管壁。李念川的频道没有主动发声，但他的脚步在下一秒变得更轻。\n\n头盔把这段变化登记为可追踪线索；前方仍有出口，回声也没有给出足以替代判断的答案。',
      confidence: 0.86,
    },
  }, exec);
  assert.equal(view.freeActionEvent.actor.id, 'zhunin');
  assert.equal(view.freeActionEvent.actor.name, '祝宁');
  assert.match(view.freeActionEvent.storySegment, /祝宁/);
  assert.ok(view.freeActionEvent.storySegment.length <= 1200);
  assert.equal(view.freeActionEvent.status, 'ACCEPTED');
  assert.equal(view.freeActionEvent.unlockLabel, '第1回合 · 新剧情');
  assert.equal(typeof view.freeActionEvent.stateHashBefore, 'string');
  assert.equal(typeof view.freeActionEvent.stateHashAfter, 'string');
  assert.equal(view.storyUnlocks[0].storySegment, view.freeActionEvent.storySegment);
});

test('free action rejects a model that changes the acting role and preserves a readable blocked story', () => {
  const store = createGameStore({ storageDir });
  store.act({ action: 'start', role_id: 'zhunin' }, exec);
  const view = store.act({ action: 'free_action', action_text: '我继续观察', model_event: { actor_id: 'linenchuan', intent: 'inspect', story_segment: '李念川已经离开入口并改变了路线。' } }, exec);
  assert.equal(view.freeActionEvent.accepted, false);
  assert.equal(view.freeActionEvent.branch, 'ACTOR_MISMATCH');
  assert.match(view.notice, /行动主体校验未通过/);
  assert.equal(view.turn, 0);
});

test('free action client id is idempotent and stale turns fail closed', () => {
  const store = createGameStore({ storageDir });
  store.act({ action: 'start', role_id: 'zhunin' }, exec);
  const first = store.act({ action: 'free_action', action_text: '观察入口', client_action_id: 'same-action', expected_turn: 0 }, exec);
  const repeated = store.act({ action: 'free_action', action_text: '观察入口', client_action_id: 'same-action', expected_turn: 2 }, exec);
  assert.equal(repeated.freeActionEvent.id, first.freeActionEvent.id);
  assert.match(repeated.notice, /不重复写入/);
  assert.throws(() => store.act({ action: 'free_action', action_text: '再次观察', client_action_id: 'stale-action', expected_turn: 0 }, exec), /行动已过期/);
});

test('story unlock remains available after save and load', () => {
  const store = createGameStore({ storageDir });
  store.act({ action: 'start', role_id: 'linenchuan' }, exec);
  store.act({ action: 'free_action', action_text: '我检查车厢连接处', client_action_id: 'persist-story', expected_turn: 0 }, exec);
  const saved = store.act({ action: 'save' }, exec);
  const story = saved.freeActionEvent.storySegment;
  store.act({ action: 'free_action', action_text: '我继续前进' }, exec);
  const restored = store.act({ action: 'load' }, exec);
  assert.equal(restored.role.id, 'linenchuan');
  assert.equal(restored.freeActionEvent.storySegment, story);
  assert.equal(restored.storyUnlocks.at(-1).storySegment, story);
});


test('online stories receive source-grounded narrative rules and fail closed on missing or failed self-checks', async () => {
  const { requestDeepSeekEvent } = await import('../lib/deepseek.js');
  const { NARRATIVE_CHECK_KEYS } = await import('../lib/narrative.js');
  const store = createGameStore({ storageDir: mkdtempSync(join(tmpdir(), 'feitu-narrative-check-')) });
  const view = store.act({ action: 'start', role_id: 'zhunin' }, exec);
  let requestBody;
  let event = { actor_id: 'zhunin', intent: 'observe', story_segment: '祝宁看着李念川。他已经说过不舒服，至于原因，她还不知道。' };
  const mock = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    requestBody = JSON.parse(body);
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(event) } }] }));
  });
  await new Promise((resolve) => mock.listen(0, '127.0.0.1', resolve));
  const options = { actionText: '看看他现在怎么样', view, apiKey: 'test-only', endpoint: 'http://127.0.0.1:' + mock.address().port };
  try {
    const missing = await requestDeepSeekEvent(options);
    assert.equal(missing.reason, 'DEEPSEEK_NARRATIVE_CHECK_FAILED');
    const checks = Object.fromEntries(NARRATIVE_CHECK_KEYS.map((key) => [key, true]));
    event.narrative_check = checks;
    const accepted = await requestDeepSeekEvent(options);
    assert.equal(accepted.model_available, true);
    const system = requestBody.messages.filter((message) => message.role === 'system').map((message) => message.content).join('\n');
    assert.match(system, /第三人称限知/);
    assert.match(system, /不熟悉的术语与程序会直接问/);
    assert.match(system, /不提前使用后期/);
    assert.match(system, /体征可以保持不变/);
    const context = JSON.parse(requestBody.messages.find((message) => message.role === 'user').content);
    assert.equal(context.narrative_reference.sources.length, 3);
    assert.equal(context.character_profiles.length, 3);
    for (const key of NARRATIVE_CHECK_KEYS) {
      event.narrative_check = { ...checks, [key]: false };
      const rejected = await requestDeepSeekEvent(options);
      assert.equal(rejected.model_event, null);
      assert.equal(rejected.reason, 'DEEPSEEK_NARRATIVE_CHECK_FAILED');
    }
    event.narrative_check = checks;
    event.story_segment = '祝宁示意李念川在井口警戒区边缘坐下，准备下井继续任务。';
    assert.equal((await requestDeepSeekEvent(options)).model_event, null);
  } finally {
    await new Promise((resolve) => mock.close(resolve));
  }
});

test('failed narrative checks discard model prose and effects at the runtime boundary', () => {
  const store = createGameStore({ storageDir: mkdtempSync(join(tmpdir(), 'feitu-narrative-runtime-')) });
  store.act({ action: 'start', role_id: 'zhunin' }, exec);
  const view = store.act({ action: 'free_action', action_text: '先等等', model_event: {
    intent: 'observe', event_title: '不应显示的标题', story_segment: '不应显示的剧情：祝宁决定丢下李念川，独自走进新的通道。',
    narrative_check: { character_consistent: false }, effects: { pollution_delta: 10 },
  } }, exec);
  assert.equal(view.freeActionEvent.source, 'deterministic-fallback');
  assert.doesNotMatch(view.freeActionEvent.storySegment, /不应显示|丢下/);
  assert.notEqual(view.freeActionEvent.title, '不应显示的标题');
  assert.deepEqual(view.freeActionEvent.appliedEffects, []);
});

test('rejected actions never render model prose as an accomplished event', () => {
  for (const proposal of [
    { actor_id: 'linenchuan', intent: 'inspect' },
    { actor_id: 'zhunin', intent: 'move', target: 'unknown-place' },
  ]) {
    const store = createGameStore({ storageDir: mkdtempSync(join(tmpdir(), 'feitu-rejected-story-')) });
    store.act({ action: 'start', role_id: 'zhunin' }, exec);
    const view = store.act({ action: 'free_action', action_text: '继续看', model_event: {
      ...proposal, event_title: '已经抵达秘密出口', story_segment: '祝宁已经抵达秘密出口，并且拿走了这里的所有物品。',
    } }, exec);
    assert.equal(view.freeActionEvent.accepted, false);
    assert.doesNotMatch(view.freeActionEvent.storySegment, /秘密出口|所有物品/);
    assert.doesNotMatch(view.freeActionEvent.title, /秘密出口/);
  }
});
