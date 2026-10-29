import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGameStore } from '../lib/runtime.js';

function player(id = 'player-acceptance') {
  return { agent: { id } };
}

function start(role = 'zhunin', id = 'player-acceptance') {
  const storageDir = mkdtempSync(join(tmpdir(), 'feitu-player-acceptance-'));
  const store = createGameStore({ storageDir });
  const exec = player(id);
  const view = store.act({ action: 'start', role_id: role }, exec);
  return { store, exec, view };
}

test('PVA-001 player can choose a frozen playable role', () => {
  const { view } = start('linenchuan', 'pva-001');
  assert.equal(view.role.id, 'linenchuan');
  assert.equal(view.role.name, '李念川');
});

test('PVA-002 player sees the complete ten-location map', () => {
  const { view } = start('zhunin', 'pva-002');
  assert.deepEqual(view.map.map((node) => node.id), ['L001', 'L002', 'L003', 'L004', 'L005', 'L006', 'L007', 'L008', 'L009', 'L010']);
});

test('PVA-003 player cannot invent a map edge', () => {
  const { store, exec } = start('zhunin', 'pva-003');
  assert.throws(() => store.act({ action: 'move', target_id: 'L005' }, exec), /不能直接前往/);
});

test('PVA-004 player can inspect a location and receive only its frozen clues', () => {
  const { store, exec } = start('zhunin', 'pva-004');
  store.act({ action: 'move', target_id: 'L002' }, exec);
  const view = store.act({ action: 'inspect' }, exec);
  assert.deepEqual(view.discoveredClues, ['E级任务记录：16个污染物已被标记为死亡', '水系孢子需要收容']);
});

test('PVA-005 player can follow the canon route to the train platform', () => {
  const { store, exec } = start('zhunin', 'pva-005');
  for (const target_id of ['L002', 'L003', 'L004']) store.act({ action: 'move', target_id }, exec);
  assert.equal(store.view(exec).location.id, 'L004');
});

test('PVA-006 player cannot teleport from sewer to train carriage', () => {
  const { store, exec } = start('zhunin', 'pva-006');
  store.act({ action: 'move', target_id: 'L002' }, exec);
  assert.throws(() => store.act({ action: 'move', target_id: 'L005' }, exec), /不能直接前往/);
});

test('PVA-007 player can collect a canon item only where it exists', () => {
  const { store, exec } = start('zhunin', 'pva-007');
  store.act({ action: 'move', target_id: 'L002' }, exec);
  const view = store.act({ action: 'take', item_id: 'I003' }, exec);
  assert.ok(view.inventory.some((item) => item.id === 'I003'));
  assert.throws(() => store.act({ action: 'take', item_id: 'I005' }, exec), /不在当前地点/);
});

test('PVA-008 player cannot use an item that is not in the inventory', () => {
  const { store, exec } = start('zhunin', 'pva-008');
  assert.throws(() => store.act({ action: 'use', item_id: 'I005' }, exec), /背包/);
});

test('PVA-009 player can use the cleaning kit without inventing a power', () => {
  const { store, exec } = start('zhunin', 'pva-009');
  store.act({ action: 'move', target_id: 'L002' }, exec);
  const view = store.act({ action: 'use', item_id: 'I003' }, exec);
  assert.match(view.notice, /收容血滴孢子/);
  assert.equal(view.flags.coreDefeated, false);
});

test('PVA-010 save and load restore a player-visible checkpoint', () => {
  const { store, exec } = start('zhunin', 'pva-010');
  store.act({ action: 'move', target_id: 'L002' }, exec);
  store.act({ action: 'save' }, exec);
  store.act({ action: 'move', target_id: 'L003' }, exec);
  assert.equal(store.act({ action: 'load' }, exec).location.id, 'L002');
});

test('PVA-011 support dialogue stays inside frozen NPC facts', () => {
  const { store, exec } = start('zhunin', 'pva-011');
  const view = store.act({ action: 'talk', target_id: 'xumeng' }, exec);
  assert.match(view.notice, /徐萌/);
  assert.match(view.notice, /现场负责人/);
});

test('PVA-012 invalid actions fail closed instead of mutating state', () => {
  const { store, exec } = start('zhunin', 'pva-012');
  assert.throws(() => store.act({ action: 'teleport', target_id: 'L010' }, exec), /不支持的 action/);
  assert.equal(store.view(exec).turn, 0);
});

test('PVA-013 player free action returns an event and helmet HUD without hidden state', () => {
  const { store, exec } = start('zhunin', 'pva-013');
  const view = store.act({ action: 'free_action', action_text: '我观察入口的积水和孢子痕迹' }, exec);
  assert.equal(view.freeActionEvent.accepted, true);
  assert.equal(view.freeActionEvent.branch, 'L003');
  assert.equal(typeof view.helmet.pollution.value, 'number');
  assert.equal(typeof view.helmet.communication.signal, 'number');
  assert.equal(Object.hasOwn(view, 'world_state'), false);
  assert.equal(Object.hasOwn(view, 'pending_consequences'), false);
});
