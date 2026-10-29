import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGameStore } from './lib/runtime.js';
import { deepSeekStatus, requestCharacterDialogue, requestDeepSeekEvent } from './lib/deepseek.js';
import { NARRATIVE_REVISION } from './lib/opening.js';

const root = dirname(fileURLToPath(import.meta.url));
const releaseManifest = JSON.parse(readFileSync(join(root, 'RELEASE_MANIFEST.json'), 'utf8'));
const port = Number(process.env.FEITU_PORT ?? 3091);
const storageDir = process.env.FEITU_STORAGE_DIR ?? join(root, '.preview-saves');
const desktopVersion = process.env.FEITU_DESKTOP_VERSION ?? null;
const distribution = process.env.FEITU_DISTRIBUTION ?? 'web-preview';
const launcherProtocol = 2;
const deepseekConfigured = () => deepSeekStatus().configured;
let lastDeepseekDiagnostic = deepSeekStatus();
const store = createGameStore({ storageDir });
const exec = { agent: { id: 'browser-player' } };
const uiAssets = new Map([
  ['preview.svg', 'image/svg+xml; charset=utf-8'],
  ['one-line-map.svg', 'image/svg+xml; charset=utf-8'],
  ['key-clues.svg', 'image/svg+xml; charset=utf-8'],
  ['role-cards.svg', 'image/svg+xml; charset=utf-8'],
  ['ending-routes.svg', 'image/svg+xml; charset=utf-8'],
  ['event-board.svg', 'image/svg+xml; charset=utf-8'],
  ['world-hub.svg', 'image/svg+xml; charset=utf-8'],
  ['dungeon-map-infinity.png', 'image/png'],
  ['portrait-zhunin.png', 'image/png'],
  ['portrait-linianchuan.png', 'image/png'],
  ['helmet-hud-source.png', 'image/png'],
  ['helmet-industrial-visage-v2.png', 'image/png'],
  ['station-platform-concept.png', 'image/png'],
  ['spore-containment-case.png', 'image/png'],
]);

function json(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}

async function body(req) {
  let text = '';
  for await (const chunk of req) text += chunk;
  return text ? JSON.parse(text) : {};
}

const server = createServer(async (req, res) => {
  try {
    const pathname = req.url?.split('?', 1)[0];
    if (pathname === '/api/health' && req.method === 'GET') {
      return json(res, 200, {
        schema: 'feitu-world/health/v1',
        status: 'PASS',
        launcherProtocol,
        narrativeRevision: NARRATIVE_REVISION,
        productShell: releaseManifest.product_shell,
        runtimeContract: releaseManifest.runtime_contract,
        contentId: releaseManifest.content_id,
        desktopVersion,
        distribution,
        playerViewOnly: true,
        network: 'not-required-for-preview',
        deepseek: lastDeepseekDiagnostic,
      });
    }
    if (pathname === '/api/manifest' && req.method === 'GET') {
      return json(res, 200, {
        schema: 'feitu-world/public-manifest/v1',
        releaseId: releaseManifest.release_id,
        productShell: releaseManifest.product_shell,
        runtimeContract: releaseManifest.runtime_contract,
        contentId: releaseManifest.content_id,
        desktopVersion,
        distribution,
        playableDungeonIds: releaseManifest.playable_dungeon_ids,
        gates: releaseManifest.gates,
      });
    }
    if (pathname === '/api/game' && req.method === 'GET') return json(res, 200, { ...store.view(exec), dsh: lastDeepseekDiagnostic, saves: store.saves() });
    if (pathname === '/api/game' && req.method === 'POST') {
      const action = await body(req);
      if (action.action === 'character_dialogue' && !action.model_dialogue) {
        const current = store.view(exec);
        const deepseek = await requestCharacterDialogue({ dialogueText: action.dialogue_text ?? action.action_text, targetId: action.target_id ?? action.target, view: current });
        lastDeepseekDiagnostic = deepseek.diagnostic;
        const result = store.act({ ...action, model_dialogue: deepseek.model_dialogue }, exec);
        result.dsh = deepseek.diagnostic;
        result.notice = `${result.notice} · ${deepseek.diagnostic.message}`;
        return json(res, 200, result);
      }
      if (action.action === 'free_action' && !action.model_event) {
        const current = store.view(exec);
        const deepseek = await requestDeepSeekEvent({ actionText: action.action_text ?? action.text, selectedAction: action.selected_action, view: current });
        lastDeepseekDiagnostic = deepseek.diagnostic;
        const result = store.act({ ...action, model_event: deepseek.model_event }, exec);
        result.dsh = deepseek.diagnostic;
        result.notice = `${result.notice} · ${deepseek.diagnostic.message}`;
        return json(res, 200, result);
      }
      return json(res, 200, { ...store.act(action, exec), dsh: lastDeepseekDiagnostic });
    }
    if (pathname === '/favicon.ico') {
      res.writeHead(204, { 'Cache-Control': 'public, max-age=3600' });
      return res.end();
    }
    const assetName = pathname?.startsWith('/ui/') ? pathname.slice('/ui/'.length) : pathname?.slice(1);
    if (assetName && uiAssets.has(assetName) && !assetName.includes('/')) {
      res.writeHead(200, { 'Content-Type': uiAssets.get(assetName), 'Cache-Control': 'public, max-age=3600' });
      return res.end(readFileSync(join(root, 'ui', assetName)));
    }
    if (pathname === '/' || pathname === '/preview.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(readFileSync(join(root, 'ui', 'preview.html')));
    }
    return json(res, 404, { error: 'not_found' });
  } catch (error) {
    return json(res, 400, { error: error.message });
  }
});

server.listen(port, '127.0.0.1', () => {
  const address = server.address();
  console.log(`FEITU_PREVIEW http://127.0.0.1:${typeof address === 'object' && address ? address.port : port}`);
  console.log(`FEITU_DEEPSEEK ${deepseekConfigured() ? 'configured' : 'not-configured'}`);
});
