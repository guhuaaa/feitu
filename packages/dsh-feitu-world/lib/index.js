import { createGameStore } from './runtime.js';
import { deepSeekStatus, requestCharacterDialogue, requestDeepSeekEvent } from './deepseek.js';

export const name = 'feitu-world';
export const inject = ['tools', 'systemPrompt', 'credentials'];

const inputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    action: { type: 'string', enum: ['world_view', 'list_dungeons', 'start', 'view', 'resume', 'list_saves', 'export_log', 'fork', 'switch_role', 'move', 'inspect', 'take', 'use', 'talk', 'character_dialogue', 'free_action', 'submit_choice', 'resolve_interactive_event', 'save', 'load'] },
    role_id: { type: 'string', enum: ['zhunin', 'linenchuan'] },
    dungeon_id: { type: 'string' },
    target: { type: 'string' },
    target_id: { type: 'string' },
    item_id: { type: 'string' },
    choice_id: { type: 'string' },
    event_id: { type: 'string' },
    result_id: { type: 'string' },
    run_id: { type: 'string' },
    action_text: { type: 'string', maxLength: 280 },
    dialogue_text: { type: 'string', maxLength: 280 },
    selected_action: { type: 'object', additionalProperties: false, properties: { action: { type: 'string', enum: ['move', 'inspect', 'talk', 'take', 'use', 'submit_choice', 'resolve_interactive_event'] }, target: { type: 'string' }, target_id: { type: 'string' }, item_id: { type: 'string' }, choice_id: { type: 'string' }, event_id: { type: 'string' }, result_id: { type: 'string' }, label: { type: 'string', maxLength: 280 } } },
    client_action_id: { type: 'string', maxLength: 120 },
    expected_turn: { type: 'integer', minimum: 0 },
    model_event: { type: 'object', additionalProperties: false, properties: { actor_id: { type: 'string' }, intent: { type: 'string' }, target: { type: 'string' }, choice_id: { type: 'string' }, event_title: { type: 'string' }, event_text: { type: 'string' }, story_segment: { type: 'string', maxLength: 1200 }, next_choice_id: { type: 'string' }, referenced_fact_ids: { type: 'array', items: { type: 'string' }, maxItems: 12 }, confidence: { type: 'number', minimum: 0, maximum: 1 }, effects: { type: 'object', additionalProperties: false, properties: { pollution_delta: { type: 'integer', minimum: -3, maximum: 10 }, oxygen_delta: { type: 'integer', minimum: -4, maximum: 1 }, suit_integrity_delta: { type: 'integer', minimum: -6, maximum: 0 }, countdown_delta: { type: 'integer', minimum: -2, maximum: 1 }, communication: { type: 'string', enum: ['UNCHANGED', 'AVAILABLE', 'USED', 'LOST'] }, characters: { type: 'object', additionalProperties: false, properties: { zhunin: { type: 'object', additionalProperties: false, properties: { mental_delta: { type: 'integer', minimum: -6, maximum: 2 }, stamina_delta: { type: 'integer', minimum: -5, maximum: 2 }, heart_rate_delta: { type: 'integer', minimum: -8, maximum: 18 } } }, linenchuan: { type: 'object', additionalProperties: false, properties: { mental_delta: { type: 'integer', minimum: -6, maximum: 2 }, stamina_delta: { type: 'integer', minimum: -5, maximum: 2 }, heart_rate_delta: { type: 'integer', minimum: -8, maximum: 18 } } } } } } } } },
    model_dialogue: { type: 'object', additionalProperties: false, properties: { speaker_id: { type: 'string', enum: ['zhunin', 'linenchuan', 'xumeng'] }, reply: { type: 'string', maxLength: 500 } } },
  },
  required: ['action'],
};

const outputSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    schema: { type: 'string' },
    world: { type: 'object' },
    regions: { type: 'array' },
    dungeons: { type: 'array' },
    announcedDungeons: { type: 'array' },
    extensionContract: { type: 'object' },
    expansionPolicy: { type: 'object' },
    dungeon: { type: 'object' },
    role: { type: 'object' },
    characters: { type: 'array' },
    turn: { type: 'integer' },
    location: { type: 'object' },
    pressure: { type: 'object' },
    helmet: { type: 'object' },
    dsh: { type: 'object' },
    npcStatus: { type: 'object' },
    recoveryWindows: { type: 'array' },
    map: { type: 'array' },
    inventory: { type: 'array' },
    discoveredClues: { type: 'array' },
    flags: { type: 'object' },
    choices: { type: 'array' },
    roleSwitches: { type: 'array' },
    notice: { type: 'string' },
    currentNode: { type: 'object' },
    visibleFacts: { type: 'array' },
    visibleDialogue: { type: 'array' },
    dialogueTargets: { type: 'array' },
    visibleNarrative: { type: 'array' },
    freeActionEvent: { oneOf: [{ type: 'object' }, { type: 'null' }] },
    freeActionHistory: { type: 'array' },
    storyUnlocks: { type: 'array' },
    factLedger: { type: 'object' },
    actionCount: { type: 'integer' },
    ending: { oneOf: [{ type: 'object' }, { type: 'null' }] },
  },
};

function render(_args, value) {
  const lines = [`## ${value.dungeon?.name ?? 'Feitu World'}`];
  if (value.world) lines.push(`世界：${value.world.name}${value.world.regionId ? `　区域：${value.world.regionId}` : ''}`);
  if (value.world && value.regions && value.dungeons) {
    lines.push(`区域：${value.regions?.map((item) => `${item.id} ${item.name}`).join('、') || '无'}`);
    lines.push(`可玩副本：${value.dungeons?.map((item) => `${item.id} ${item.name}`).join('、') || '无'}`);
    if (value.announcedDungeons?.length) lines.push(`已登记未开放：${value.announcedDungeons.map((item) => item.name).join('、')}`);
  }
  if (value.role) lines.push(`角色：${value.role.name}　回合：${value.turn}`);
  if (value.currentNode) lines.push(`节点：${value.currentNode.id}　场景：${value.currentNode.sceneId ?? '未绑定'}`);
  if (value.location) {
    lines.push(`地点：${value.location.id} ${value.location.name}`);
    lines.push(`出口：${value.location.exits.map((x) => `${x.id} ${x.name}`).join('、') || '无'}`);
  }
  if (value.notice) lines.push('', value.notice);
  if (value.freeActionEvent) {
    lines.push('', `剧情已解锁：${value.freeActionEvent.unlockLabel ?? `第${value.freeActionEvent.turn ?? value.turn}回合`}`, `${value.freeActionEvent.actor?.name ?? value.role?.name ?? '当前角色'}：${value.freeActionEvent.title}`);
    lines.push(value.freeActionEvent.storySegment ?? value.freeActionEvent.text ?? '');
    lines.push('', '运行时审计：');
    for (const item of value.freeActionEvent.systemLines ?? []) lines.push(`【${item.label}】${item.text}`);
  }
  if (value.helmet) lines.push('', `头盔读数：污染 ${value.helmet.pollution.value}/${value.helmet.pollution.max}（${value.helmet.pollution.band}），通讯 ${value.helmet.communication.status}，行动窗口 ${value.helmet.countdown}`);
  if (value.discoveredClues?.length) lines.push('', `已确认线索：${value.discoveredClues.join('；')}`);
  if (value.inventory?.length) lines.push('', `背包：${value.inventory.map((x) => x.name).join('、')}`);
  lines.push('', '玩家可见状态：', '```json', JSON.stringify(value, null, 2), '```');
  return [{ type: 'text', text: lines.join('\n') }];
}

export function apply(ctx, config = {}) {
  const store = createGameStore({ storageDir: config.storageDir });
  const credentials = typeof ctx.get === 'function' ? ctx.get('credentials') : ctx.credentials;
  async function resolveDeepSeekCredential() {
    if (!credentials?.resolve) return undefined;
    try { return (await credentials.resolve('DEEPSEEK_API_KEY'))?.value; } catch { return undefined; }
  }
  ctx.systemPrompt.section({
    name: 'tool:feitu-world',
    order: 114,
    text: '你是《废土世界》的叙事主持人。网页的“选择行动”进入 feitu_game(action=free_action) 事件导演链路；“与角色对话”进入独立的 action=character_dialogue 链路，target_id 必须来自 dialogueTargets，且不得把对白当成移动、调查或剧情分支。所有区域、副本、地点、人物、物品、线索、旗标、故事节点、选择和交互结果必须来自 feitu_game 返回的玩家可见状态。开始前先调用 feitu_game(action=world_view)，只能用返回的可玩 dungeon_id 调用 action=start；进入副本后先调用 feitu_game(action=view) 检查状态。可以使用 action=switch_role 切换当前存档的第一视角；它不重置剧情，随后必须使用返回的角色专属 choices 行动。每次 free_action 除剧情外，必须在 model_event.effects.characters 中评估祝宁和李念川的体征提议；李念川在相同污染事件中的精神下降应明显更快。运行时会按小说基线限幅和最终写入。不得凭空新增区域、能力、历史、物品、连接、死亡或结局，不得直接改背包或隐藏计划。状态改变必须通过 feitu_game；叙事只能解释工具返回的 visibleFacts、visibleNarrative、visibleDialogue、helmet 和 freeActionEvent。',
  });
  ctx.tools.register({
    name: 'feitu_game',
    description: '推进《消失的一号线末班车》确定性副本，并返回玩家可见的地图、地点、线索、背包、角色和可选行动。',
    parameters: inputSchema,
    output: { schema: outputSchema, render },
    async execute(args, exec) {
      if (args.action === 'character_dialogue' && !args.model_dialogue) {
        const current = store.view(exec);
        const deepseek = await requestCharacterDialogue({ dialogueText: args.dialogue_text ?? args.action_text, targetId: args.target_id ?? args.target, view: current, apiKey: await resolveDeepSeekCredential() });
        const result = store.act({ ...args, model_dialogue: deepseek.model_dialogue }, exec);
        result.dsh = deepseek.diagnostic;
        result.notice = `${result.notice || ''}${result.notice ? ' · ' : ''}${deepseek.diagnostic.message}`;
        return result;
      }
      if (args.action === 'free_action' && !args.model_event) {
        const current = store.view(exec);
        const deepseek = await requestDeepSeekEvent({ actionText: args.action_text ?? args.text, selectedAction: args.selected_action, view: current, apiKey: await resolveDeepSeekCredential() });
        const result = store.act({ ...args, model_event: deepseek.model_event }, exec);
        result.dsh = deepseek.diagnostic;
        result.notice = `${result.notice || ''}${result.notice ? ' · ' : ''}${deepseek.diagnostic.message}`;
        return result;
      }
      return { ...store.act(args, exec), dsh: deepSeekStatus({ apiKey: await resolveDeepSeekCredential() }) };
    },
  });
}
