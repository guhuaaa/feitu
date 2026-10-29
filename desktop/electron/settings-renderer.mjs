const api = window.feituSettings;
const byId = (id) => document.getElementById(id);
const form = byId('settings-form');
const mode = byId('mode');
const key = byId('api-key');
const model = byId('model');
const endpoint = byId('endpoint');
const savedFields = byId('saved-fields');
const save = byId('save-settings');
const clear = byId('clear-key');
const restart = byId('restart-game');
const close = byId('close-settings');
const dialog = byId('confirmation');
let state, baseline, busy = false, allowClose = false, closing = false;
const snapshot = () => JSON.stringify([mode.value, model.value, endpoint.value]);
const dirty = () => Boolean(state && (snapshot() !== baseline || key.value));

function message(text, error = false) {
  byId('status').textContent = text;
  byId('status').dataset.error = String(error);
}
function updateControls() {
  for (const control of form.elements) control.disabled = busy || !state;
  const saved = mode.value === 'saved';
  savedFields.hidden = !saved;
  savedFields.disabled = busy || !state || !saved || !state.secureStorageAvailable;
  key.required = saved && !state?.hasSavedKey;
  save.disabled = busy || !state || (saved && !state.secureStorageAvailable);
  clear.disabled = busy || !state?.hasSavedKey;
  restart.disabled = busy || !state?.restartRequired || dirty();
  close.disabled = busy;
  const help = {
    environment: state?.environmentConfigured ? '使用启动器提供的在线配置；本机保存的密钥不会覆盖它。' : '启动器未提供密钥，将使用离线玩法。',
    offline: '关闭在线 AI，使用本地规则与剧情。启动器和本机密钥均不会启用。',
    saved: '使用下方配置，覆盖启动器提供的在线设置。'
  };
  byId('mode-help').textContent = help[mode.value] || '';
}
function renderStatus(data) {
  state = data;
  mode.value = data.mode || 'environment';
  model.value = data.model || 'deepseek-chat';
  endpoint.value = data.endpoint || 'https://api.deepseek.com/chat/completions';
  key.value = '';
  key.placeholder = data.hasSavedKey ? '已保存；留空保留现有密钥' : '填写服务商提供的 API 密钥';
  byId('key-state').textContent = data.hasSavedKey ? '这台电脑已保存一份加密密钥。' : '这台电脑未保存密钥。';
  byId('storage-warning').hidden = data.secureStorageAvailable;
  byId('connection-state').textContent = data.configured ? '在线密钥已配置' : '离线可用';
  byId('version').textContent = `版本 ${data.version || '未知'} · ${{ steam: 'Steam', github: '便携版' }[data.distribution] || '开发版'}`;
  baseline = snapshot();
  updateControls();
}
async function transact(action, success) {
  if (busy) return;
  busy = true;
  updateControls();
  try {
    const result = await action();
    if (!result?.ok) message(result?.error || '操作未完成，请稍后重试。', true);
    else success?.(result.data);
  } catch {
    message('无法完成设置操作，请关闭设置窗口后重试。', true);
  } finally {
    busy = false;
    updateControls();
  }
}
function confirmAction(title, text, label) {
  return new Promise((resolve) => {
    byId('confirmation-title').textContent = title;
    byId('confirmation-message').textContent = text;
    byId('confirm-action').textContent = label;
    dialog.returnValue = '';
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true });
    dialog.showModal();
  });
}
byId('confirm-cancel').addEventListener('click', () => dialog.close());
byId('confirm-action').addEventListener('click', () => dialog.close('confirm'));
form.addEventListener('input', () => {
  endpoint.setCustomValidity('');
  updateControls();
  if (dirty()) message('有未保存的更改。保存后，下次重启游戏生效。');
});
mode.addEventListener('change', () => {
  if (mode.value !== 'saved') key.value = '';
  updateControls();
});
form.addEventListener('submit', (event) => {
  event.preventDefault();
  if (busy) return;
  if (mode.value === 'saved' && !endpoint.value.startsWith('https://')) {
    endpoint.setCustomValidity('请填写以 https:// 开头的完整聊天接口地址。');
  }
  if (!form.reportValidity()) return;
  const settings = mode.value === 'saved'
    ? { mode: mode.value, apiKey: key.value, model: model.value.trim(), endpoint: endpoint.value.trim() }
    : { mode: mode.value };
  transact(() => api.save(settings), (data) => {
    renderStatus(data);
    message(data.error || '设置已保存，下次重启游戏生效。重启前请等待当前行动完成。', Boolean(data.error));
  });
});
clear.addEventListener('click', async () => {
  if (busy || dialog.open) return;
  if (!await confirmAction('删除本机密钥？', '只删除这台电脑当前 Windows 账户中的游戏密钥，不会更改启动器配置或云存档。未保存的更改也会丢弃。', '删除本机密钥')) return;
  transact(() => api.clearKey(), (data) => {
    renderStatus(data);
    message('本机密钥已删除，下次重启游戏生效。');
  });
});
restart.addEventListener('click', () => transact(() => api.restart(), () => {}));
for (const [id, folder] of [['open-saves', 'saves'], ['open-logs', 'logs']]) {
  byId(id).addEventListener('click', () => transact(() => api.openFolder(folder), () => message('已打开文件夹。')));
}
async function requestClose() {
  if (busy || closing || dialog.open) return;
  closing = true;
  try {
    if (dirty() && !await confirmAction('放弃未保存的更改？', '已保存的配置会保留，本次尚未保存的更改将被丢弃。', '放弃并关闭')) return;
    allowClose = true;
    const result = await api.close();
    if (!result?.ok) { allowClose = false; message(result?.error || '无法关闭设置窗口。', true); }
  } catch { allowClose = false; message('无法关闭设置窗口，请稍后重试。', true); }
  finally { closing = false; }
}
close.addEventListener('click', requestClose);
window.addEventListener('beforeunload', (event) => {
  if (!allowClose && (dirty() || busy)) {
    event.preventDefault();
    event.returnValue = false;
    requestClose();
  }
});
transact(() => api.getStatus(), (data) => {
  renderStatus(data);
  message(data.error || (data.restartRequired ? '已保存的更改将在下次重启游戏时生效。' : '离线模式可直接游玩；按需配置在线 AI。'), Boolean(data.error));
});
