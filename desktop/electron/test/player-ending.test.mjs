import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

async function playerPage() {
  const html = await readFile(new URL('../../../packages/dsh-feitu-world/ui/preview.html', import.meta.url), 'utf8');
  const nodes = new Map();
  const node = () => ({ value: '', children: [], dataset: {}, disabled: false,
    setAttribute() {}, addEventListener() {},
    replaceChildren(...children) { this.children = children; },
    appendChild(child) { this.children.push(child); return child; },
    get options() { return this.children; }, get selectedOptions() { return this.children.filter((item) => item.value === this.value); } });
  const byId = (id) => { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); };
  byId('role').value = 'zhunin';
  let requests = 0;
  const context = vm.createContext({ document: { getElementById: byId, createElement: node, querySelectorAll: () => [], addEventListener() {} },
    location: { search: '' }, URLSearchParams, fetch: () => { requests += 1; return new Promise(() => {}); } });
  vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], context);
  const run = (script) => vm.runInContext(script, context);
  return { byId, run, requests: () => requests };
}

test('committed ending disables gameplay in both input modes but retains save controls', async () => {
  const page = await playerPage();
  page.run("latestView = { ending: { id: 'END_01' }, role: roleMeta.zhunin };");
  for (const mode of ['action', 'dialogue']) {
    page.run(`setInputMode('${mode}')`);
    for (const id of ['freeAction', 'freeActionSubmit', 'dialogueTarget']) assert.equal(page.byId(id).disabled, true);
    assert.match(page.byId('freeActionHint').textContent, /本局已结束/);
  }
  assert.equal(page.run("actionButton({ action: 'move', label: 'move' }).disabled"), true);
  assert.equal(page.run("actionButton({ action: 'save', label: 'save' }).disabled"), false);
});

test('ended gameplay is rejected before network, errors cannot reenable it, and a new run unlocks input', async () => {
  const page = await playerPage();
  page.run("latestView = { ending: { id: 'END_01' }, role: roleMeta.zhunin };");
  const initialRequests = page.requests();
  await assert.rejects(page.run("submitNarrativeAction(null, 'observe')"), /本局已结束/);
  await assert.rejects(page.run("submitCharacterDialogue('hello')"), /本局已结束/);
  assert.equal(page.requests(), initialRequests);
  page.run("showError(new Error('test')); setInputMode('action');");
  assert.equal(page.byId('freeActionSubmit').disabled, true);
  page.run("latestView = { ending: null, role: roleMeta.zhunin }; setInputMode('action');");
  assert.equal(page.byId('freeAction').disabled, false);
  assert.equal(page.byId('freeActionSubmit').disabled, false);
});
