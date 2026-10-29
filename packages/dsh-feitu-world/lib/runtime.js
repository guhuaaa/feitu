import { createSaveStore, stateHash } from './persistence.js';
import { AUTO_NEXT, CHOICES, EVENTS, EVENT_RESULTS, EVENT_RESULT_LABELS, NODE_SCENES, choicesFor } from './story.js';
import { WORLD_REGISTRY, publicWorldView } from './world.js';
import { OPENING, NARRATIVE_REVISION, isRestOpening, contradictsRestOpening } from './opening.js';

import { passesNarrativeCheck } from './narrative.js';

const ROLES = {
  zhunin: { id: 'char_zhu_ning', slug: 'zhunin', name: '祝宁', portrait: '/ui/portrait-zhunin.png', stance: '谨慎、先验证后行动；留意李念川的身体状况，保持同行。', abilities: ['异常证据验证', '污染核心定位', '防护装备即时使用', '近距战斗与保护性干预'], knowledge: [...OPENING.facts], startingItems: ['I001', 'I002', 'I003'] },
  linenchuan: { id: 'char_li_nianchuan', slug: 'linenchuan', name: '李念川', portrait: '/ui/portrait-linianchuan.png', stance: '年轻、反应快，容易把污染不适误判为闷热；倾向先跟随现场判断。', abilities: ['活污染物信号上报', '清理流程与规则执行', '菜谱反制', '司机室远端救助与制动尝试'], knowledge: [...OPENING.facts, '清理流程', '一般污染物远离后应减弱影响', '工作守则要求报告异常', '自身正在不适'], startingItems: ['I001', 'I002', 'I003'] },
};
const ROLE_ALIASES = { zhunin: 'zhunin', char_zhu_ning: 'zhunin', 'CHARACTER::祝宁': 'zhunin', linenchuan: 'linenchuan', char_li_nianchuan: 'linenchuan', 'CHARACTER::李念川': 'linenchuan' };
// These baselines are the player-visible adaptation of the novel's contrast:
// 李念川 already feels unwell and deteriorates under the same contamination
// faster than 祝宁. The model may suggest deltas, but the runtime owns the
// multipliers and all final values.
const CHARACTER_BASELINES = {
  char_zhu_ning: { heartRate: 72, mental: 100, stamina: 86, health: '正常', mentalSensitivity: 0.65, staminaSensitivity: 0.8 },
  char_li_nianchuan: { heartRate: 84, mental: 78, stamina: 82, health: '轻度不适', mentalSensitivity: 1.7, staminaSensitivity: 1.25 },
};

const LOCATIONS = {
  L001: { id: 'L001', name: 'A7号下水道井口警戒区', connections: ['L002'], clues: ['猎魔人已按错误E级判断离场'], items: ['下行绳索', '地面照明'] },
  L002: { id: 'L002', name: 'A7号下水道地下作业区', connections: ['L001', 'L003'], clues: ['E级任务记录：16个污染物已被标记为死亡', '水系孢子需要收容'], items: ['吸管与透明匣', '清洁背包'] },
  L003: { id: 'L003', name: '下水道休息处', connections: ['L002', 'L004'], clues: ['远离已知孢子仍恶化', '鱼人服装与末班车话语', '倒地无孢子'], items: ['腕部手电', '两把空气枪', '鱼人公文包'] },
  L004: { id: 'L004', name: '一号线老旧站台', connections: ['L003', 'L005', 'L009'], clues: ['一号线、23:35', '核心临终陈述', '核心死亡后析孢'], items: ['消防斧', '玻璃消防柜'] },
  L005: { id: 'L005', name: '末班列车四节乘客车厢', connections: ['L004', 'L006', 'L007', 'L008'], clues: ['同伤复制体', '无人下车', '车厢乘客数量差异', '发现核心后车厢变脆'], items: ['拉环', '头盔外放', '电子菜谱', '空气枪'] },
  L006: { id: 'L006', name: '三号车厢古旧手机座位', connections: ['L005', 'L007'], clues: ['手机年代', '无限嵌套当前动作'], items: ['古旧手机'] },
  L007: { id: 'L007', name: '车头司机室', connections: ['L005', 'L006', 'L008'], clues: ['司机并非正常人', '核心在车外', '制动无效、喇叭有效'], items: ['司机帽', '制动按钮', '喇叭按钮', '透明门'] },
  L008: { id: 'L008', name: '列车外侧与车顶', connections: ['L005', 'L007', 'L009'], clues: ['核心真实位置', '被发现后场域物质变弱'], items: [] },
  L009: { id: 'L009', name: '循环轨道', connections: ['L008', 'L004'], clues: ['列车循环', '鱼人未真死时无孢', '核心死亡后孢子出现'], items: ['祝宁在跌落时丢失的空气枪（最终位置未交代）'] },
  L010: { id: 'L010', name: '103区清洁中心技术支持部', connections: [], clues: ['评级错误', '外界仅过15分钟', '猎魔人尚需17分钟', '净化先于猎魔人到场'], items: ['监控屏幕与计算设备'] },
};

const ITEMS = {
  I001: { id: 'I001', name: '黑色清理者防护服与头盔', locations: ['L001', 'L002', 'L003'], use: '密闭皮肤、夜视、通讯与污染读数；不能完全阻止精神污染。' },
  I002: { id: 'I002', name: '空气枪', locations: ['L001', 'L003', 'L005'], use: '发射空气子弹，用于防卫；对未知目标的效果需要现场确认。' },
  I003: { id: 'I003', name: '清洁背包、吸管与透明收容匣', locations: ['L002'], use: '收容血滴孢子；每收容一颗记录净化值+1。' },
  I004: { id: 'I004', name: '电子菜谱：红烧鲫鱼', locations: ['L005'], use: '记录在车厢中发现的电子菜谱线索。' },
  I005: { id: 'I005', name: '古旧手机', locations: ['L006'], use: '观察其年代与无限嵌套的当前动作。' },
  I006: { id: 'I006', name: '鱼人公文包', locations: ['L003'], use: '记录鱼人服装与末班车话语相关物证。' },
  I007: { id: 'I007', name: '司机室控制组（制动/喇叭）', locations: ['L007'], use: '制动无效、喇叭有效；不能伪造列车控制结果。' },
  I008: { id: 'I008', name: '消防斧', locations: ['L004'], use: '可破坏玻璃消防柜，作为站台环境交互。' },
  I009: { id: 'I009', name: '腐烂鱼头', locations: ['L005'], use: '气味与鱼人线索；不是新的超自然能力。' },
  I010: { id: 'I010', name: 'K003炸药', locations: ['L007'], use: '仅作为冻结内容中的高风险物证，当前版本不自动引爆。' },
};

const NPCS = {
  xumeng: { id: 'xumeng', name: '徐萌', fact: '清理小队现场负责人；通过通讯确认队员的位置、症状与读数，协调照应；未向两人布置探索这条通道的任务，也不知道他们尚未报告的异常。' },
  hunter: { id: 'hunter', name: '刚离场的猎魔人', fact: '按错误E级判断离场；外界救援时间是现场压力的一部分。' },
};

const DIALOGUE_CHARACTERS = {
  zhunin: { id: 'zhunin', canonicalId: 'char_zhu_ning', name: '祝宁' },
  linenchuan: { id: 'linenchuan', canonicalId: 'char_li_nianchuan', name: '李念川' },
  xumeng: { id: 'xumeng', canonicalId: 'char_xu_meng', name: '徐萌' },
};
const DIALOGUE_ALIASES = { zhunin: 'zhunin', char_zhu_ning: 'zhunin', linenchuan: 'linenchuan', char_li_nianchuan: 'linenchuan', xumeng: 'xumeng', char_xu_meng: 'xumeng' };
const DIALOGUE_TARGETS_BY_ROLE = {
  zhunin: ['linenchuan', 'xumeng'],
  linenchuan: ['zhunin', 'xumeng'],
};

const PRESSURE = {
  initial: 38,
  max: 100,
  countdown: 80,
  activeAt: 55,
  criticalAt: 80,
  collapseAt: 95,
  costs: { move: 1, inspect: 1, take: 1, use: 1, talk: 0, character_dialogue: 0, submit_choice: 2, resolve_interactive_event: 2, free_action: 2 },
};
const SAVE_FORMAT = 'feitu-world/save/v1';

const MAP_POINTS = {
  L001: { x: 10, y: 12, loop: 'entry' },
  L002: { x: 24, y: 27, loop: 'left' },
  L003: { x: 18, y: 70, loop: 'left' },
  L004: { x: 37, y: 53, loop: 'crossing' },
  L005: { x: 51, y: 50, loop: 'crossing' },
  L006: { x: 68, y: 27, loop: 'right' },
  L007: { x: 82, y: 71, loop: 'right' },
  L008: { x: 91, y: 13, loop: 'support' },
  L009: { x: 53, y: 88, loop: 'infinity' },
  L010: { x: 95, y: 6, loop: 'support' },
};

function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function committedStateHash(state) {
  const snapshot = clone(state);
  if (snapshot.current_free_event) snapshot.current_free_event.stateHashAfter = '';
  for (const event of snapshot.free_action_history ?? []) event.stateHashAfter = '';
  return stateHash(snapshot);
}
function resolvePlayableDungeon(dungeonId = 'one-line-last-train') {
  const dungeon = WORLD_REGISTRY.dungeons.find((item) => item.id === dungeonId && item.status === 'PLAYABLE');
  if (!dungeon) {
    const available = WORLD_REGISTRY.dungeons.filter((item) => item.status === 'PLAYABLE').map((item) => item.id).join(', ') || 'none';
    throw new Error(`副本未登记或当前不可玩：${dungeonId}。可用副本：${available}。请先调用 action=world_view。`);
  }
  return dungeon;
}

function emptyState(roleId, dungeonId) {
  const canonicalRoleId = ROLE_ALIASES[roleId] ?? roleId;
  const role = ROLES[canonicalRoleId];
  if (!role) throw new Error(`未知角色：${roleId}。可选 zhunin 或 linenchuan。`);
  const dungeon = resolvePlayableDungeon(dungeonId);
  const runId = `one-line-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const characterStates = Object.fromEntries(Object.values(ROLES).map((candidate) => [candidate.id, createCharacterState(candidate)]));
  return {
    schema: 'feitu-world/v1',
    save_format: SAVE_FORMAT,
    run_id: runId,
    runId,
    dungeonId: dungeon.id,
    dungeonName: dungeon.name,
    player_role_id: role.id,
    roleId: role.slug,
    current_story_node_id: 'START',
    previous_story_node_id: null,
    current_node: 'START',
    turn: 0,
    locationId: OPENING.locationId,
    opening: clone(OPENING),
    inventory: [...role.startingItems],
    discoveredClues: [],
    inspectedLocations: [],
    flags: { entranceOpen: true, coreExposed: false, coreDefeated: false, trainLoop: false },
    world_state: { rating: 'E', external_elapsed_minutes: 0, field_status: 'UNCONFIRMED' },
    player_state: clone(characterStates[role.id]),
    character_states: characterStates,
    inventories_by_role: Object.fromEntries(Object.values(ROLES).map((candidate) => [candidate.id, [...candidate.startingItems]])),
    relationship_states: { trust: {}, fear: {}, debt: {}, conflict: {} },
    knowledge_states: { known_facts: [...new Set([...OPENING.facts, ...role.knowledge])], suspected_facts: [], unknown_facts: [] },
    ability_states: { available: [...role.abilities], degraded: [] },
    item_states: Object.fromEntries(role.startingItems.map((id) => [id, { holder: role.id, status: 'HELD' }])),
    location_states: { current: OPENING.locationId, visited: [OPENING.locationId], inspected: [] },
    pollution_field_state: { phase: 'UNCONFIRMED', core_identified: false, core_exhaustion_progress: 'NONE' },
    time_opportunity_state: { communication: 'AVAILABLE', treatment_window: 'CLOSED', escape_window: 'OPEN' },
    npc_plan_states: { XUMENG: 'ON_SITE_COORDINATION', HUNTER: 'LEFT_AFTER_E_RATING' },
    npc_plan_progress: { XUMENG: 0, HUNTER: 0 },
    pressure_clock: { value: PRESSURE.initial, max: PRESSURE.max, countdown: PRESSURE.countdown, phase: 'LOW', collapsed: false },
    helmet_effects: { oxygen: 0, suitIntegrity: 0 },
    choice_history: [],
    action_history: [],
    dialogue_history: [],
    interactive_event_history: [],
    free_action_history: [],
    current_free_event: null,
    pending_consequences: [],
    active_recovery_windows: [],
    ending_reachability: { END_01: true, END_02: true, END_03: true, END_04: true, END_05: true },
    committed_ending_id: null,
    checkpoint: null,
    player_view_snapshot: null,
    deterministic_state_hash: '',
    log: [...OPENING.paragraphs],
  };
}

function createCharacterState(role) {
  const baseline = CHARACTER_BASELINES[role.id];
  return {
    role_name: role.name,
    alive: true,
    can_act: true,
    injury: 'NONE',
    contamination_pressure: 'LOW',
    physiology: { heartRate: baseline.heartRate, mental: baseline.mental, stamina: baseline.stamina, health: baseline.health },
    equipment: { suitStatus: '完好', suitDurability: 100, filterStatus: 'II级过滤', filterDurability: 96, communicatorStatus: '正常' },
    last_change: { mental: 0, stamina: 0, heartRate: 0, reason: '初始读数' },
  };
}

function ensureCharacterStates(state) {
  if (!state.character_states || typeof state.character_states !== 'object') state.character_states = {};
  for (const role of Object.values(ROLES)) {
    if (!state.character_states[role.id]) state.character_states[role.id] = createCharacterState(role);
    const current = state.character_states[role.id];
    const base = createCharacterState(role);
    current.role_name ??= role.name;
    current.alive ??= true; current.can_act ??= true; current.injury ??= 'NONE'; current.contamination_pressure ??= 'LOW';
    current.physiology = { ...base.physiology, ...(current.physiology ?? {}) };
    current.equipment = { ...base.equipment, ...(current.equipment ?? {}) };
    current.last_change ??= base.last_change;
  }
  if (!state.inventories_by_role || typeof state.inventories_by_role !== 'object') state.inventories_by_role = {};
  for (const role of Object.values(ROLES)) state.inventories_by_role[role.id] ??= role.id === state.player_role_id ? [...(state.inventory ?? role.startingItems)] : [...role.startingItems];
}

function syncActivePlayerToCharacter(state) {
  ensureCharacterStates(state);
  if (state.player_state) state.character_states[state.player_role_id] = { ...state.character_states[state.player_role_id], ...clone(state.player_state) };
  state.inventories_by_role[state.player_role_id] = [...(state.inventory ?? [])];
}

function loadActivePlayerFromCharacter(state) {
  ensureCharacterStates(state);
  state.player_state = clone(state.character_states[state.player_role_id]);
  state.inventory = [...state.inventories_by_role[state.player_role_id]];
}

function switchRole(state, requestedRoleId) {
  const slug = ROLE_ALIASES[requestedRoleId] ?? requestedRoleId;
  const role = ROLES[slug];
  if (!role) throw new Error(`未知角色：${requestedRoleId}。可选 zhunin 或 linenchuan。`);
  syncActivePlayerToCharacter(state);
  state.roleId = role.slug;
  state.player_role_id = role.id;
  loadActivePlayerFromCharacter(state);
  return role;
}
function resolveLocation(target) {
  if (!target) return null;
  if (LOCATIONS[target]) return LOCATIONS[target];
  const key = Object.keys(LOCATIONS).find((id) => LOCATIONS[id].name.includes(target));
  return key ? LOCATIONS[key] : null;
}

function movementLabel(fromId, toId) {
  if (fromId === 'L001' && toId === 'L002') return '沿固定绳索下到地下作业区';
  if (fromId === 'L002' && toId === 'L001') return '返回井口警戒区';
  return `前往 ${LOCATIONS[toId].name}`;
}

function playerChoiceLabel(choice) {
  // The frozen author graph keeps its original titles; the player surface uses
  // wording that describes only the facts already established at this moment.
  if (choice.choice_id === 'CHOICE_002_PRESS_CONTINUE') return '陪李念川休息，留意他的状态';
  if (choice.choice_id === 'CHOICE_003_SELF_REPORT') return '向徐萌说明自己的不适';
  if (choice.choice_id === 'CHOICE_004_CONCEAL_SYMPTOM') return '暂不细说不适程度，先缓一缓';
  return choice.label;
}

function normalizeFreeAction(text) {
  const value = String(text ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!value) throw new Error('自由行动不能为空；请描述你想做的事。');
  if (value.length > 280) throw new Error('自由行动最多 280 个字符，请保留关键动作。');
  return value;
}

function normalizeDialogueText(text) {
  const value = String(text ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!value) throw new Error('对话内容不能为空；请先输入你想说的话。');
  if (value.length > 280) throw new Error('单次对话最多 280 个字符，请保留想问的重点。');
  return value;
}

function dialogueTargetsFor(state) {
  const role = roleForState(state);
  return (DIALOGUE_TARGETS_BY_ROLE[role.slug] ?? []).map((id) => DIALOGUE_CHARACTERS[id]);
}

function fallbackDialogueReply(targetId, input, state) {
  const symptomQuestion = /感觉|怎么样|难受|头疼|头痛|不适|还好吗|没事吧|状态/.test(input);
  if (isRestOpening(state)) {
    if (targetId === 'linenchuan') {
      if (/徐萌|跟.{0,4}说|告诉|报告/.test(input)) return state.time_opportunity_state?.communication === 'LOST'
        ? '现在联系不上她。等频道恢复我再说，你先别走远。'
        : '嗯，我跟徐萌说一声。我还是有点晕，想再歇会儿。';
      return symptomQuestion ? '有点闷，头也疼。我想再歇一会儿，你先别走远。' : '嗯，我听着。让我缓一会儿。';
    }
    if (targetId === 'zhunin') return symptomQuestion ? '我没事。你先歇着，不舒服就说。' : '先歇着。我在这儿。';
  }
  if (targetId === 'zhunin') {
    if (symptomQuestion) return '我没事。先报你的头盔读数，别摘面罩；没有确认之前，不要把感觉当成安全。';
    return '先把你看到的现象和头盔读数分开说。能验证的部分我们马上处理，不能验证的先留着。';
  }
  if (targetId === 'linenchuan') {
    if (symptomQuestion) return '有点闷，头也疼，不过我还能动。你别离太远，我会跟紧，也会继续报读数。';
    return '我听着。你说怎么核验，我配合；要是读数再变，我马上告诉你。';
  }
  const communication = state.time_opportunity_state?.communication;
  if (communication === 'LOST') return '频道断断续续，我听不全。先保持防护、不要分开，把头盔读数重新发一遍。';
  if (symptomQuestion) return '先报告具体症状和头盔读数，不要摘面罩。祝宁留在李念川身边，先休息，有变化就联系我。';
  return '收到。只报告已经确认的现场情况和读数，保持防护、不要走散；我会在外层继续协调。';
}

function safeModelDialogue(modelDialogue, targetId, state) {
  if (!modelDialogue || typeof modelDialogue !== 'object') return null;
  const speakerId = DIALOGUE_ALIASES[modelDialogue.speaker_id];
  const reply = String(modelDialogue.reply ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500);
  const outOfCharacter = /作为(?:AI|人工智能|语言模型)|系统提示|角色设定|OOC|玩家角色|我无法扮演/i.test(reply);
  if (speakerId !== targetId || !reply || outOfCharacter || contradictsRestOpening(reply, state)) return null;
  return { speakerId, reply };
}

function sanitizeStorySegment(value, fallback) {
  const cleaned = String(value ?? '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 1200);
  return cleaned.length >= 24 ? cleaned : fallback;
}

function roleForState(state) {
  return ROLES[state.roleId] ?? ROLES[ROLE_ALIASES[state.player_role_id] ?? 'zhunin'];
}

function fallbackStorySegment({ role, accepted, eventText, location }) {
  const state = accepted ? '动作已记入现场记录。' : '该动作未改变现场状态。';
  return `${role.name}所在的${location}。${state}\n\n${eventText}`;
}

function inferFreeIntent(state, text) {
  const value = text.toLowerCase();
  const visible = choicesFor(state);
  const choice = visible.find((item) => item.label && (text.includes(item.label) || (item.label.split(/[，、；：]/)[0].length > 3 && text.includes(item.label.split(/[，、；：]/)[0]))));
  if (choice) return { intent: 'choice', choice_id: choice.choice_id, label: choice.label };
  if (/通讯|联系|报告|发信号|呼叫|频道/.test(value)) return { intent: 'talk', target: 'xumeng' };
  if (/检查|观察|查看|扫描|读取|搜索|调查/.test(value)) return { intent: 'inspect', target: state.locationId };
  if (/前往|去|移动|进入|登车|上车|走向/.test(value)) {
    const target = Object.values(LOCATIONS).find((location) => text.includes(location.id) || text.includes(location.name.slice(0, 6)));
    if (target) return { intent: 'move', target: target.id };
  }
  if (/拿|拾取|记录|收容|带走/.test(value)) return { intent: 'take', target: state.locationId };
  if (/使用|装备|穿戴|打开|启动/.test(value)) return { intent: 'use' };
  return { intent: 'observe' };
}

function selectedActionIntent(state, selection) {
  if (!selection || typeof selection !== 'object') return null;
  const action = String(selection.action ?? '');
  if (action === 'submit_choice') {
    const choice = choicesFor(state).find((item) => item.choice_id === selection.choice_id);
    return choice ? { intent: 'choice', choice_id: choice.choice_id } : null;
  }
  if (action === 'move') return selection.target || selection.target_id ? { intent: 'move', target: selection.target ?? selection.target_id } : null;
  if (action === 'inspect') return { intent: 'inspect', target: state.locationId };
  if (action === 'talk') return { intent: 'talk', target: selection.target ?? selection.target_id ?? 'xumeng' };
  if (action === 'take') return selection.item_id ? { intent: 'take', target: selection.item_id } : null;
  if (action === 'use') return selection.item_id ? { intent: 'use', target: selection.item_id } : null;
  if (action === 'resolve_interactive_event' && selection.event_id && selection.result_id) return { intent: 'resolve_interactive_event', event_id: selection.event_id, result_id: selection.result_id };
  return null;
}

function helmetReadout(state, pressure) {
  const communication = state.time_opportunity_state?.communication ?? 'AVAILABLE';
  ensureCharacterStates(state);
  const character = state.character_states[state.player_role_id];
  const body = character.physiology;
  const equipment = character.equipment;
  const signal = communication === 'LOST' ? 0 : communication === 'USED' ? 54 : state.world_state?.live_signal_sent ? 82 : 67;
  const modelEffects = state.helmet_effects ?? { oxygen: 0, suitIntegrity: 0 };
  const oxygen = clamp(98 - state.turn - Math.floor(pressure.value / 10) + modelEffects.oxygen, 32, 98);
  const suit = clamp(Math.min(equipment.suitDurability, 100 - Math.floor(pressure.value / 4) - (state.player_state?.injury === 'CRITICAL' ? 18 : 0) + modelEffects.suitIntegrity), 18, 100);
  const temperature = 21 + Math.floor(pressure.value / 12) + (state.locationId === 'L005' ? 4 : 0);
  const trend = pressure.value >= PRESSURE.activeAt ? '上升' : state.turn > 0 ? '稳定' : '待采样';
  return {
    pollution: { value: pressure.value, max: pressure.max, band: pressure.phase, trend, unit: '污染指数' },
    communication: { channel: communication === 'LOST' ? '断联' : '清理频道 C-7', status: communication, signal, latencyMs: communication === 'LOST' ? null : 180 + state.turn * 12 },
    oxygen: { value: oxygen, unit: '%', status: oxygen < 60 ? 'LOW' : 'NOMINAL' },
    suitIntegrity: { value: suit, unit: '%', status: suit < 55 ? 'DEGRADED' : 'NOMINAL' },
    temperature: { value: temperature, unit: '°C' },
    countdown: pressure.countdown,
    physiology: { heartRate: body.heartRate, mental: body.mental, stamina: body.stamina, health: body.health, injury: character.injury, lastChange: character.last_change },
    equipment: { ...equipment, suitDurability: suit, tool: state.inventory?.find((id) => id !== 'I001') ? ITEMS[state.inventory.find((id) => id !== 'I001')]?.name ?? '现场清理工具' : '未切换工具' },
    environment: {
      warning: pressure.value >= PRESSURE.criticalAt ? '高污染场域，建议优先撤离或收容' : pressure.value >= PRESSURE.activeAt ? '孢子活性升高，限制无防护停留' : '环境读数暂稳定，仍需持续采样',
      airIndex: clamp(42 + pressure.value, 0, 150), humidity: clamp(78 + Math.floor(pressure.value / 5), 0, 100), radiation: clamp(8 + Math.floor(pressure.value / 9), 0, 100),
    },
    mission: { title: state.opening && state.current_story_node_id === 'NODE_002' && !state.discoveredClues.length ? '暂时休息 · 留意同伴状态' : LOCATIONS[state.locationId]?.name ?? '现场', progress: clamp(Math.round((state.discoveredClues.length / 22) * 100), 0, 100) },
    team: Object.values(ROLES).map((role) => ({ id: role.slug, name: role.name, active: role.id === state.player_role_id, physiology: state.character_states[role.id].physiology, health: state.character_states[role.id].physiology.health })),
  };
}

function updateCharacterVitals(state, actionArgs) {
  const action = actionArgs?.action;
  if (PRESSURE.costs[action] === undefined) return [];
  if (action === 'character_dialogue') return [];
  ensureCharacterStates(state);
  const modelEffects = action === 'free_action' && actionArgs?.model_event?.effects ? actionArgs.model_event.effects : {};
  const roleEffects = modelEffects.characters && typeof modelEffects.characters === 'object' ? modelEffects.characters : {};
  const hazard = Math.max(1, Math.ceil((PRESSURE.costs[action] + Math.max(0, Number(modelEffects.pollution_delta) || 0) + (state.pressure_clock.value >= PRESSURE.activeAt ? 1 : 0)) / 2));
  const changes = [];
  for (const role of Object.values(ROLES)) {
    const character = state.character_states[role.id];
    const profile = CHARACTER_BASELINES[role.id];
    const proposed = roleEffects[role.slug] ?? roleEffects[role.id] ?? {};
    const rawMental = clamp(Math.round(Number(proposed.mental_delta) || -hazard), -6, 2);
    const rawStamina = clamp(Math.round(Number(proposed.stamina_delta) || -hazard), -5, 2);
    const rawHeart = clamp(Math.round(Number(proposed.heart_rate_delta) || hazard * 2), -8, 18);
    const mentalDelta = clamp(Math.round(rawMental * profile.mentalSensitivity), -12, 3);
    const staminaDelta = clamp(Math.round(rawStamina * profile.staminaSensitivity), -8, 3);
    character.physiology.mental = clamp(character.physiology.mental + mentalDelta, 0, 100);
    character.physiology.stamina = clamp(character.physiology.stamina + staminaDelta, 0, 100);
    character.physiology.heartRate = clamp(character.physiology.heartRate + rawHeart, 45, 160);
    character.physiology.health = character.physiology.mental < 28 || character.physiology.stamina < 22 ? '危险' : character.physiology.mental < 55 || character.injury !== 'NONE' ? '警告' : profile.health;
    character.contamination_pressure = state.pressure_clock.phase;
    character.equipment.suitDurability = clamp(character.equipment.suitDurability + Math.min(0, Number(modelEffects.suit_integrity_delta) || 0) - (hazard > 2 ? 1 : 0), 18, 100);
    character.equipment.filterDurability = clamp(character.equipment.filterDurability - (hazard > 1 ? 1 : 0), 15, 100);
    character.equipment.suitStatus = character.equipment.suitDurability < 55 ? '受损' : '完好';
    character.equipment.communicatorStatus = state.time_opportunity_state.communication === 'LOST' ? '失联' : state.time_opportunity_state.communication === 'USED' ? '占用' : '正常';
    character.last_change = { mental: mentalDelta, stamina: staminaDelta, heartRate: rawHeart, reason: action === 'free_action' ? '剧情事件后重新采样' : '行动后重新采样' };
    changes.push(`${role.name} 精神${mentalDelta} · 体力${staminaDelta}`);
  }
  loadActivePlayerFromCharacter(state);
  return changes;
}

function buildSystemProgress(state, event) {
  const pressure = state.pressure_clock ?? { value: PRESSURE.initial, max: PRESSURE.max, countdown: PRESSURE.countdown, phase: 'LOW' };
  const helmet = helmetReadout(state, pressure);
  const lines = [
    { kind: 'input', label: '行动接收', text: `已记录玩家行动：${event.input}` },
    { kind: event.accepted ? 'change' : 'warn', label: '现场判定', text: event.accepted ? `意图 ${event.intent} 已接入可见因果链 · 分支 ${event.branch}` : `意图 ${event.intent} 未写入状态 · ${event.branch}` },
    { kind: event.accepted ? 'change' : 'warn', label: '事态变化', text: event.text },
  ];
  if (event.appliedEffects?.length) lines.push({ kind: 'change', label: '状态写入', text: event.appliedEffects.join(' · ') });
  if (event.characterChanges?.length) lines.push({ kind: 'change', label: '角色体征', text: event.characterChanges.join('；') });
  lines.push({ kind: 'readout', label: '头盔读数', text: `污染 ${helmet.pollution.value}/${helmet.pollution.max} · 通讯 ${helmet.communication.status} ${helmet.communication.signal}% · 氧气 ${helmet.oxygen.value}% · 防护 ${helmet.suitIntegrity.value}% · 窗口 ${helmet.countdown}s` });
  return lines;
}

function safeModelEvent(modelEvent) {
  if (!modelEvent || typeof modelEvent !== 'object') return null;
  const allowed = ['actor_id', 'intent', 'target', 'choice_id', 'event_title', 'event_text', 'story_segment', 'next_choice_id'];
  const result = Object.fromEntries(allowed.filter((key) => modelEvent[key] !== undefined).map((key) => [key, String(modelEvent[key]).slice(0, key === 'story_segment' ? 1200 : 320)]));
  if (result.intent && !['choice', 'move', 'inspect', 'talk', 'take', 'use', 'observe'].includes(result.intent)) result.intent = 'observe';
  if (modelEvent.effects && typeof modelEvent.effects === 'object') {
    const numeric = (value, min, max) => clamp(Math.round(Number(value) || 0), min, max);
    const communication = ['UNCHANGED', 'AVAILABLE', 'USED', 'LOST'].includes(modelEvent.effects.communication) ? modelEvent.effects.communication : 'UNCHANGED';
    result.effects = {
      pollutionDelta: numeric(modelEvent.effects.pollution_delta, -3, 10),
      oxygenDelta: numeric(modelEvent.effects.oxygen_delta, -4, 1),
      suitIntegrityDelta: numeric(modelEvent.effects.suit_integrity_delta, -6, 0),
      countdownDelta: numeric(modelEvent.effects.countdown_delta, -2, 1),
      communication,
      characters: Object.fromEntries(Object.entries(modelEvent.effects.characters ?? {}).filter(([key, value]) => ROLE_ALIASES[key] && value && typeof value === 'object').map(([key, value]) => [ROLE_ALIASES[key], {
        mental_delta: numeric(value.mental_delta, -6, 2), stamina_delta: numeric(value.stamina_delta, -5, 2), heart_rate_delta: numeric(value.heart_rate_delta, -8, 18),
      }])),
    };
  }
  if (Array.isArray(modelEvent.referenced_fact_ids)) result.referencedFactIds = modelEvent.referenced_fact_ids.filter((item) => typeof item === 'string').slice(0, 12).map((item) => item.slice(0, 120));
  if (modelEvent.confidence !== undefined) result.confidence = clamp(Number(modelEvent.confidence) || 0, 0, 1);
  return result;
}

function applyModelEffects(state, effects, accepted) {
  if (!accepted || !effects) return [];
  if (!state.helmet_effects) state.helmet_effects = { oxygen: 0, suitIntegrity: 0 };
  const applied = [];
  if (effects.pollutionDelta) {
    state.pressure_clock.value = clamp(state.pressure_clock.value + effects.pollutionDelta, 0, state.pressure_clock.max);
    applied.push(`污染 ${effects.pollutionDelta > 0 ? '+' : ''}${effects.pollutionDelta}`);
  }
  if (effects.oxygenDelta) {
    state.helmet_effects.oxygen = clamp(state.helmet_effects.oxygen + effects.oxygenDelta, -30, 5);
    applied.push(`氧气修正 ${effects.oxygenDelta > 0 ? '+' : ''}${effects.oxygenDelta}`);
  }
  if (effects.suitIntegrityDelta) {
    state.helmet_effects.suitIntegrity = clamp(state.helmet_effects.suitIntegrity + effects.suitIntegrityDelta, -35, 0);
    applied.push(`防护修正 ${effects.suitIntegrityDelta}`);
  }
  if (effects.countdownDelta) {
    state.pressure_clock.countdown = clamp(state.pressure_clock.countdown + effects.countdownDelta, 0, PRESSURE.countdown);
    applied.push(`窗口 ${effects.countdownDelta > 0 ? '+' : ''}${effects.countdownDelta}`);
  }
  if (effects.communication !== 'UNCHANGED') {
    const allowLost = effects.communication !== 'LOST' || state.pressure_clock.value >= PRESSURE.criticalAt;
    if (allowLost) {
      state.time_opportunity_state.communication = effects.communication;
      applied.push(`通讯 ${effects.communication}`);
    }
  }
  state.pressure_clock.phase = pressurePhase(state.pressure_clock.value, state.pressure_clock.countdown === 0);
  return applied;
}

function applyFreeAction(state, args) {
  const input = normalizeFreeAction(args.action_text ?? args.text);
  const role = roleForState(state);
  const stateHashBefore = stateHash(state);
  const inferred = inferFreeIntent(state, input);
  // Legacy direct proposals have no check; checked proposals must not bypass the adapter gate.
  const proposedModel = args.model_event && Object.hasOwn(args.model_event, 'narrative_check') && !passesNarrativeCheck(args.model_event) ? null : safeModelEvent(args.model_event);
  const model = proposedModel && !contradictsRestOpening([proposedModel.event_title, proposedModel.event_text, proposedModel.story_segment].join('\n'), state) ? proposedModel : null;
  const selected = selectedActionIntent(state, args.selected_action);
  const actorValid = !model?.actor_id || [role.slug, role.id, state.player_role_id].includes(model.actor_id);
  const intent = selected ?? (model?.intent ? { ...inferred, ...model } : inferred);
  let branch = 'OBSERVATION_ONLY';
  let accepted = actorValid;
  let notice = '自由行动已记录；运行时没有发现可安全落地的状态变化。';
  let eventText = model?.event_text || `行动已记录。现场没有越过已确认事实；头盔仅保留本次行动痕迹。`;
  if (!actorValid) {
    branch = 'ACTOR_MISMATCH';
    notice = `行动主体校验未通过；本回合仍由${role.name}执行。`;
    eventText = `模型提案声称由其他角色行动；运行时拒绝该叙事，未写入世界状态。`;
  } else if (intent.intent === 'choice') {
    const selected = choicesFor(state).find((item) => item.choice_id === intent.choice_id);
    if (!selected) { accepted = false; eventText = '分支校验未通过。当前节点没有这条可见因果链；行动保持记录，不改变状态。'; }
    else { state.turn += 1; applyChoiceEffects(state, selected); advanceAuto(state); branch = selected.next_node; notice = `DeepSeek 将行动接入分支：${playerChoiceLabel(selected)}`; eventText = model?.event_text || `分支已提交。现场因果链转入 ${selected.next_node}；后续读数按新节点重新采样。`; }
  } else if (intent.intent === 'move') {
    const destination = resolveLocation(intent.target);
    if (!destination || !LOCATIONS[state.locationId].connections.includes(destination.id)) { accepted = false; eventText = '路线校验拒绝。目标不在当前地点的已知出口上；未发生位移。'; }
    else { state.locationId = destination.id; state.location_states.current = destination.id; if (!state.location_states.visited.includes(destination.id)) state.location_states.visited.push(destination.id); state.turn += 1; branch = destination.id; notice = `你自由移动到 ${destination.name}。`; eventText = model?.event_text || `沿通道抵达${destination.name}，周围情况仍待确认。`; }
  } else if (intent.intent === 'inspect') {
    discover(state, LOCATIONS[state.locationId]); state.location_states.inspected = [...state.inspectedLocations]; state.turn += 1; branch = state.locationId; notice = '自由观察已转为检查当前区域。'; eventText = model?.event_text || `扫描已完成。${LOCATIONS[state.locationId].name}保持可验证状态；新增事实已写入线索台账。`;
  } else if (intent.intent === 'talk') {
    const npc = NPCS[intent.target] ?? NPCS.xumeng; state.turn += 1; state.dialogue_history.push({ speaker: npc.name, text: npc.fact, turn: state.turn }); branch = npc.id; notice = `已接通${npc.name}。`; eventText = model?.event_text || `通讯链路已接通。${npc.name}返回公开频道信息：${npc.fact}`;
  } else if (intent.intent === 'take') {
    const item = resolveItem(intent.target);
    if (!item || !item.locations.includes(state.locationId)) { accepted = false; eventText = '物品校验拒绝。目标不在当前地点的可见物品中；背包没有变化。'; }
    else {
      if (!state.inventory.includes(item.id)) { state.inventory.push(item.id); state.item_states[item.id] = { holder: state.player_role_id, status: 'HELD' }; }
      state.turn += 1; branch = item.id; notice = `已记录 ${item.name}。`; eventText = model?.event_text || `物品登记通过。${item.name}已进入当前角色的可见背包；现场仍保留可复查的来源位置。`;
    }
  } else if (intent.intent === 'use') {
    const item = resolveItem(intent.target);
    if (!item || !state.inventory.includes(item.id)) { accepted = false; eventText = '物品校验拒绝。只能使用当前角色已经记录在背包中的物品。'; }
    else { state.turn += 1; branch = item.id; notice = `已使用 ${item.name}。`; eventText = model?.event_text || `物品使用已登记。${item.use}；具体后果仍受当前可见因果链约束。`; }
  } else if (intent.intent === 'resolve_interactive_event') {
    try {
      state.turn += 1; resolveEvent(state, intent.event_id, intent.result_id); branch = state.current_story_node_id; notice = '交互事件结果已记录；后续剧情由当前可见状态继续展开。'; eventText = model?.event_text || '交互结果已通过冻结事件表校验。现场变化已写入可见因果链。';
    } catch (error) { accepted = false; eventText = `交互事件校验拒绝：${error.message}`; }
  }
  const appliedEffects = applyModelEffects(state, model?.effects, accepted);
  const event = {
    id: `FREE_${String(state.free_action_history.length + 1).padStart(3, '0')}`,
    turn: state.turn,
    actor: { id: role.slug, canonicalId: role.id, name: role.name },
    input,
    clientActionId: args.client_action_id ? String(args.client_action_id).slice(0, 120) : null,
    source: model ? 'deepseek' : 'deterministic-fallback',
    accepted,
    status: accepted ? (model ? 'ACCEPTED' : 'FALLBACK') : 'REJECTED',
    intent: intent.intent,
    branch,
    title: (accepted ? model?.event_title : null) || (accepted ? '现场记录' : '行动校验'),
    unlockLabel: `第${state.turn}回合 · ${accepted ? '新剧情' : '行动受阻'}`,
    text: eventText,
    storySegment: sanitizeStorySegment(accepted ? model?.story_segment : null, fallbackStorySegment({ role, input, accepted, branch, eventText, location: LOCATIONS[state.locationId].name })),
    nextChoiceId: model?.next_choice_id || null,
    referencedFactIds: model?.referencedFactIds || [],
    confidence: model?.confidence ?? null,
    appliedEffects,
    stateHashBefore,
  };
  state.current_free_event = event;
  state.free_action_history.push({ ...event, turn: state.turn });
  state.log.push(`第${state.turn}回合：${event.title}：${event.text}`);
  event.stateHashAfter = committedStateHash(state);
  state.current_free_event.stateHashAfter = event.stateHashAfter;
  state.free_action_history.at(-1).stateHashAfter = event.stateHashAfter;
  return { event, notice };
}
function resolveItem(target) {
  if (!target) return null;
  if (ITEMS[target]) return ITEMS[target];
  const key = Object.keys(ITEMS).find((id) => ITEMS[id].name.includes(target));
  return key ? ITEMS[key] : null;
}
function publicView(state, notice = '') {
  ensureCharacterStates(state);
  const here = LOCATIONS[state.locationId];
  const role = ROLES[state.roleId] ?? ROLES[ROLE_ALIASES[state.player_role_id] ?? 'zhunin'];
  const knownLocation = (id) => !state.opening || id === state.locationId || state.location_states.visited.includes(id) || state.inspectedLocations.includes(id);
  const locationName = (id) => knownLocation(id) ? LOCATIONS[id].name : '尚未探索的通道';
  const visibleItems = here.items.filter((name) => !(state.opening && here.id === 'L003' && name === '鱼人公文包' && !state.inspectedLocations.includes('L003')));
  const narrativeChoices = choicesFor(state, { playerSurface: true }).map((item) => ({ action: 'submit_choice', choice_id: item.choice_id, label: playerChoiceLabel(item) }));
  const eventChoices = state.interactive_event_history
    .filter((item) => item.status === 'OPEN')
    .flatMap((item) => (EVENTS[item.event_id]?.results ?? []).map((resultId) => ({
      action: 'resolve_interactive_event', event_id: item.event_id, result_id: resultId,
      label: EVENT_RESULT_LABELS[resultId] ?? `处理交互事件 ${resultId}`,
    })));
  const choices = [
    ...here.connections.map((id) => ({ action: 'move', target: id, label: knownLocation(id) ? movementLabel(here.id, id) : `沿${id === 'L002' ? '来路返回' : '通道继续向前'}` })),
    { action: 'inspect', target: state.locationId, label: '检查当前区域' },
    { action: 'talk', target: 'xumeng', label: '联系徐萌，说明当前情况' },
    ...narrativeChoices,
    ...eventChoices,
    { action: 'save', label: '保存检查点' },
  ];
  const pressure = state.pressure_clock ?? { value: PRESSURE.initial, max: PRESSURE.max, countdown: PRESSURE.countdown, phase: 'LOW', collapsed: false };
  const world = publicWorldView();
  const activeDungeon = world.dungeons.find((item) => item.id === state.dungeonId);
  const npcStatus = {
    xumeng: { name: NPCS.xumeng.name, status: state.npc_plan_states?.XUMENG ?? 'OUTER_SUPPORT', visible: true },
    hunter: { name: NPCS.hunter.name, status: state.npc_plan_states?.HUNTER ?? 'LEFT_AFTER_E_RATING', visible: true },
  };
  return {
    schema: state.schema,
    world: { ...world.world, regionId: activeDungeon?.regionId ?? null },
    dungeon: { id: state.dungeonId, name: state.dungeonName },
    opening: state.opening ? clone(state.opening) : null,
    run_id: state.run_id,
    role: { id: role.slug, canonicalId: role.id, slug: role.slug, name: role.name, portrait: role.portrait, stance: role.stance, abilities: role.abilities, knowledge: role.knowledge },
    characters: Object.values(ROLES).map((candidate) => ({ id: candidate.slug, canonicalId: candidate.id, name: candidate.name, active: candidate.id === state.player_role_id, physiology: state.character_states[candidate.id].physiology, equipment: state.character_states[candidate.id].equipment, injury: state.character_states[candidate.id].injury })),
    turn: state.turn,
    currentNode: { id: state.current_story_node_id, sceneId: NODE_SCENES[state.current_story_node_id] ?? null },
    location: { id: here.id, name: here.name, clues: state.inspectedLocations.includes(here.id) ? here.clues : [], visibleItems, takeableItems: visibleItems.map((name) => resolveItem(name)).filter(Boolean).map((item) => ({ id: item.id, name: item.name, use: item.use })), exits: here.connections.map((id) => ({ id, name: locationName(id) })) },
    map: Object.values(LOCATIONS).map((location) => ({ id: location.id, name: locationName(location.id), current: location.id === state.locationId, discovered: state.inspectedLocations.includes(location.id), point: MAP_POINTS[location.id] })),
    inventory: state.inventory.map((id) => ITEMS[id] ? { id, name: ITEMS[id].name, use: ITEMS[id].use } : { id, name: id }),
    discoveredClues: state.discoveredClues,
    visibleFacts: state.knowledge_states.known_facts,
    visibleDialogue: state.dialogue_history.slice(-3),
    dialogueTargets: dialogueTargetsFor(state),
    visibleNarrative: state.log.slice(-4),
    flags: { entranceOpen: state.flags.entranceOpen, trainLoop: state.flags.trainLoop, coreExposed: state.pollution_field_state.core_identified, coreDefeated: state.flags.coreDefeated, endingCommitted: Boolean(state.committed_ending_id) },
    pressure: { value: pressure.value, max: pressure.max, phase: pressure.phase, countdown: pressure.countdown, communication: state.time_opportunity_state.communication, collapsed: pressure.collapsed },
    helmet: helmetReadout(state, pressure),
    factLedger: { verified: state.knowledge_states.known_facts, suspected: state.knowledge_states.suspected_facts ?? [] },
    freeActionEvent: state.current_free_event,
    freeActionHistory: (state.free_action_history ?? []).slice(-5),
    storyUnlocks: (state.free_action_history ?? []).slice(-5).map((item) => ({ id: item.id, turn: item.turn, actor: item.actor, title: item.title, storySegment: item.storySegment, unlockLabel: item.unlockLabel, source: item.source, status: item.status })),
    recoveryWindows: state.active_recovery_windows.map((id) => ({ id, status: 'OPEN' })),
    npcStatus,
    ending: state.committed_ending_id ? { id: state.committed_ending_id } : null,
    notice,
    choices,
    roleSwitches: Object.values(ROLES).filter((candidate) => candidate.id !== state.player_role_id).map((candidate) => ({ action: 'switch_role', role_id: candidate.slug, label: `切换为${candidate.name}视角` })),
    checkpoint: state.checkpoint ? { available: true, hash: state.checkpoint.deterministic_state_hash } : { available: false },
    actionCount: state.action_history?.length ?? 0,
  };
}
function discover(state, location) {
  if (!state.inspectedLocations.includes(location.id)) state.inspectedLocations.push(location.id);
  for (const clue of location.clues) if (!state.discoveredClues.includes(clue)) state.discoveredClues.push(clue);
}

function recordAction(state, args) {
  const allowed = ['action', 'role_id', 'target', 'target_id', 'item_id', 'choice_id', 'event_id', 'result_id', 'run_id', 'action_text', 'dialogue_text', 'client_action_id', 'expected_turn'];
  const input = Object.fromEntries(allowed.filter((key) => args?.[key] !== undefined).map((key) => [key, args[key]]));
  state.action_history.push({ seq: state.action_history.length + 1, turn: state.turn, ...input });
}

function normalizeState(state) {
  if (!state) return state;
  if (state.schema !== 'feitu-world/v1') throw new Error('存档格式不受支持：需要 feitu-world/v1。');
  // Legacy v0.2.x snapshots did not carry a format marker; migrate them in
  // memory while keeping the deterministic game state unchanged.
  const legacyHash = !state.save_format && state.deterministic_state_hash ? stateHash(state) : null;
  if (!state.save_format) state.save_format = SAVE_FORMAT;
  if (state.save_format !== SAVE_FORMAT) throw new Error(`存档格式不受支持：${state.save_format}。`);
  if (state.deterministic_state_hash && stateHash(state) !== state.deterministic_state_hash && legacyHash !== state.deterministic_state_hash) throw new Error('存档完整性校验失败：状态哈希不匹配。');
  const originalState = !state.opening ? clone(state) : null;
  if (!Array.isArray(state.action_history)) state.action_history = [];
  if (!Array.isArray(state.choice_history)) state.choice_history = [];
  if (!Array.isArray(state.dialogue_history)) state.dialogue_history = [];
  if (!Array.isArray(state.interactive_event_history)) state.interactive_event_history = [];
  if (!Array.isArray(state.free_action_history)) state.free_action_history = [];
  if (state.current_free_event === undefined) state.current_free_event = null;
  for (const event of state.free_action_history) {
    if (!event.actor) event.actor = { id: state.roleId, canonicalId: state.player_role_id, name: roleForState(state).name };
    if (!event.storySegment) event.storySegment = sanitizeStorySegment(event.text, fallbackStorySegment({ role: roleForState(state), input: event.input || '继续行动', accepted: event.accepted !== false, branch: event.branch || state.locationId, eventText: event.text || '现场状态已记录。', location: LOCATIONS[state.locationId]?.name || '当前区域' }));
    if (!event.unlockLabel) event.unlockLabel = `第${event.turn ?? state.turn}回合 · 新剧情`;
    if (!event.status) event.status = event.source === 'deepseek' ? (event.accepted === false ? 'REJECTED' : 'ACCEPTED') : 'FALLBACK';
  }
  if (!state.pressure_clock) state.pressure_clock = { value: PRESSURE.initial, max: PRESSURE.max, countdown: PRESSURE.countdown, phase: 'LOW', collapsed: false };
  if (!state.helmet_effects) state.helmet_effects = { oxygen: 0, suitIntegrity: 0 };
  if (!state.npc_plan_progress) state.npc_plan_progress = { XUMENG: 0, HUNTER: 0 };
  if (!state.npc_plan_states) state.npc_plan_states = { XUMENG: 'ON_SITE_COORDINATION', HUNTER: 'LEFT_AFTER_E_RATING' };
  if (!state.current_story_node_id) state.current_story_node_id = state.current_node ?? 'START';
  if (!state.current_node) state.current_node = state.current_story_node_id;
  ensureCharacterStates(state);
  syncActivePlayerToCharacter(state);
  // Only the untouched old opening can be relocated without rewriting a route.
  if (!state.opening && state.current_story_node_id === 'NODE_002' && state.locationId === 'L001'
      && !state.choice_history.length && !state.discoveredClues?.length && !state.inspectedLocations?.length
      && !state.interactive_event_history.length && !state.committed_ending_id
      && !(state.location_states?.visited ?? []).some((id) => id !== 'L001')) {
    state.legacy_opening_snapshot = originalState;
    state.opening_migration = NARRATIVE_REVISION;
    state.opening = clone(OPENING);
    state.locationId = OPENING.locationId;
    state.location_states = { current: OPENING.locationId, visited: [OPENING.locationId], inspected: [] };
    state.knowledge_states = { known_facts: [...roleForState(state).knowledge], suspected_facts: [], unknown_facts: [] };
    state.log = [...OPENING.paragraphs];
    state.dialogue_history = state.dialogue_history.filter((item) => item.userText && item.speakerId).map((item) => ({ ...item, text: fallbackDialogueReply(item.speakerId, item.userText, state), source: 'deterministic-fallback' }));
    state.free_action_history = [];
    state.current_free_event = null;
  }
  if (state.opening?.id === OPENING.id) state.opening = clone(OPENING);
  return state;
}

function pressurePhase(value, collapsed) {
  if (collapsed || value >= PRESSURE.collapseAt) return 'COLLAPSED';
  if (value >= PRESSURE.criticalAt) return 'CRITICAL';
  if (value >= PRESSURE.activeAt) return 'ACTIVE';
  return 'LOW';
}

function advanceNpcPlans(state) {
  const pressure = state.pressure_clock;
  if (pressure.collapsed || state.time_opportunity_state.communication === 'LOST') {
    state.npc_plan_states.XUMENG = 'OFFLINE';
    return;
  }
  if (state.world_state.live_signal_sent) {
    state.npc_plan_progress.XUMENG = Math.min(3, (state.npc_plan_progress.XUMENG ?? 0) + 1);
    if (pressure.phase === 'CRITICAL') state.npc_plan_states.XUMENG = 'CHANNEL_UNSTABLE';
    else if (state.npc_plan_progress.XUMENG >= 2) state.npc_plan_states.XUMENG = 'RATING_REVISED';
    else state.npc_plan_states.XUMENG = 'VERIFYING_SIGNAL';
  }
}

function advancePressure(state, actionArgs) {
  const action = actionArgs?.action;
  const cost = PRESSURE.costs[action];
  if (cost === undefined) return;
  const choiceId = actionArgs?.choice_id ?? actionArgs?.target;
  const extra = choiceId === 'CHOICE_007_DELAY_SIGNAL' ? 2 : (choiceId === 'CHOICE_004_CONCEAL_SYMPTOM' || choiceId === 'CHOICE_002_PRESS_CONTINUE' ? 1 : 0);
  state.pressure_clock.value = Math.min(PRESSURE.max, state.pressure_clock.value + cost + extra);
  state.pressure_clock.countdown = Math.max(0, state.pressure_clock.countdown - 1);
  state.pressure_clock.phase = pressurePhase(state.pressure_clock.value, state.pressure_clock.countdown === 0);
  if (state.pressure_clock.phase === 'COLLAPSED') {
    state.pressure_clock.collapsed = true;
    state.flags.fieldCollapsed = true;
    state.world_state.field_status = 'COLLAPSED';
    state.pollution_field_state.phase = 'COLLAPSED';
    state.time_opportunity_state.communication = 'LOST';
    state.time_opportunity_state.escape_window = 'CLOSING';
  }
  advanceNpcPlans(state);
}

function syncHash(state) { state.deterministic_state_hash = stateHash(state); return state; }

function commitEnding(state) {
  if (state.committed_ending_id || !state.current_story_node_id.startsWith('ENDING_NODE_')) return false;
  state.committed_ending_id = state.current_story_node_id.replace('ENDING_NODE_', 'END_');
  state.ending_reachability = { END_01: false, END_02: false, END_03: false, END_04: false, END_05: false, [state.committed_ending_id]: true };
  state.log.push(`终局提交：${state.committed_ending_id}。`);
  return true;
}

function advanceAuto(state) {
  const transitions = [];
  while (!state.committed_ending_id && (AUTO_NEXT[state.current_story_node_id] || state.current_story_node_id === 'NODE_015')) {
    const next = state.current_story_node_id === 'NODE_015'
      ? ((state.character_states?.char_zhu_ning?.injury ?? state.player_state.injury) === 'CRITICAL' ? 'ENDING_NODE_03' : 'ENDING_NODE_01')
      : AUTO_NEXT[state.current_story_node_id];
    state.previous_story_node_id = state.current_story_node_id;
    state.current_story_node_id = next;
    state.current_node = next;
    transitions.push(next);
    commitEnding(state);
  }
  commitEnding(state);
  if (transitions.length) state.log.push(`自动推进：${transitions.join(' → ')}`);
  return transitions;
}

function setCharacterInjury(state, roleId, injury) {
  ensureCharacterStates(state);
  state.character_states[roleId].injury = injury;
  if (state.player_role_id === roleId) state.player_state.injury = injury;
}

function applyChoiceEffects(state, selected) {
  state.choice_history.push({ choice_id: selected.choice_id, node_id: selected.source_node, turn: state.turn });
  state.previous_story_node_id = state.current_story_node_id;
  state.current_story_node_id = selected.next_node;
  state.current_node = selected.next_node;
  const choiceId = selected.choice_id;
  if (choiceId === 'CHOICE_001_PROTECT_REPORT' || choiceId === 'CHOICE_003_SELF_REPORT') {
    state.knowledge_states.known_facts.push('队友异常已被报告');
    state.relationship_states.trust.TEAMMATE = 'CONDITIONAL_UP';
  }
  if (choiceId === 'CHOICE_002_PRESS_CONTINUE' || choiceId === 'CHOICE_004_CONCEAL_SYMPTOM') state.pending_consequences.push({ id: 'DC_001_SYMPTOM_WORSENING', source: choiceId, status: 'PENDING' });
  if (choiceId === 'CHOICE_005_SEND_EVIDENCE_ZN' || choiceId === 'CHOICE_006_SEND_SIGNAL_LN') {
    state.world_state.live_signal_sent = true;
    state.time_opportunity_state.communication = 'USED';
    state.knowledge_states.known_facts.push('活污染物信号已发送');
  }
  if (choiceId === 'CHOICE_007_DELAY_SIGNAL') {
    state.world_state.live_signal_sent = false;
    state.pending_consequences.push({ id: 'DC_003_FIELD_EXPANSION_AFTER_DELAY', source: choiceId, status: 'PENDING' });
  }
  if (choiceId === 'CHOICE_008_HOLD_ENTRY') state.ending_reachability = { END_01: false, END_02: true, END_03: false, END_04: false, END_05: false };
  if (choiceId === 'CHOICE_009_EVACUATE_NOW') {
    state.world_state.purification_abandoned = true;
    state.active_recovery_windows.push('RW_PRE_EXPANSION_ESCAPE');
    state.interactive_event_history.push({ event_id: 'IE_PRE_EXPANSION_ESCAPE', status: 'OPEN', turn: state.turn });
  }
  if (choiceId === 'CHOICE_010_ENTER_DEEP_FIELD') {
    state.world_state.inner_field_entered = true;
    state.location_states.current = 'INNER_TRAIN_LOOP';
    state.ending_reachability.END_02 = false; state.ending_reachability.END_04 = false; state.ending_reachability.END_05 = false;
  }
  if (choiceId === 'CHOICE_011_STAY_AND_SHARE') {
    state.relationship_states.trust.TEAM_COHESION = 'UP';
    state.knowledge_states.known_facts.push('团队共享了车厢异常信息');
  }
  if (choiceId === 'CHOICE_012_SPLIT_AND_ACT' || choiceId === 'CHOICE_015_FOCUS_MANIFESTATION') {
    state.world_state.misjudgment_occurred = true;
    state.pending_consequences.push({ id: 'DC_007_MISJUDGMENT_FEEDBACK', source: choiceId, status: 'PENDING' });
  }
  if (choiceId === 'CHOICE_013_CHECK_OUTSIDE_ZN' || choiceId === 'CHOICE_014_SHARE_ANOMALY_LN' || choiceId === 'CHOICE_016_RECHECK_CORE') {
    state.pollution_field_state.core_identified = true;
    state.flags.coreExposed = true;
    state.knowledge_states.known_facts.push('核心位于车外，已建立可验证证据');
    state.ending_reachability.END_05 = false;
  }
  if (choiceId === 'CHOICE_017_WAIT_FOR_FALSE_RESULT') {
    state.pending_consequences.push({ id: 'DC_008_IRREVERSIBLE_FIELD_SEAL', source: choiceId, status: 'PENDING' });
    state.ending_reachability = { END_01: false, END_02: false, END_03: false, END_04: false, END_05: true };
  }
  if (choiceId === 'CHOICE_018_OBSERVE_TESTIMONY_ZN' || choiceId === 'CHOICE_019_CREATE_CRUSH_ZN') {
    state.pollution_field_state.core_exhaustion_method = choiceId === 'CHOICE_018_OBSERVE_TESTIMONY_ZN' ? 'OBSERVED' : 'DIRECT_CRUSH';
    state.interactive_event_history.push({ event_id: 'IE_ZN_TRACK_CONFRONTATION', status: 'OPEN', turn: state.turn });
  }
  if (choiceId === 'CHOICE_022_COORDINATE_TESTIMONY_LN' || choiceId === 'CHOICE_023_DRIVER_CRUSH_LN') {
    state.pollution_field_state.core_exhaustion_method = choiceId === 'CHOICE_022_COORDINATE_TESTIMONY_LN' ? 'COORDINATED_OBSERVATION' : 'DRIVER_INTERVENTION';
    state.interactive_event_history.push({ event_id: 'IE_LN_DRIVER_CAB', status: 'OPEN', turn: state.turn });
  }
  if (choiceId === 'CHOICE_020_PROTECT_IN_TIME') { setCharacterInjury(state, 'char_zhu_ning', 'STABILIZED'); state.time_opportunity_state.treatment_window = 'USED'; state.active_recovery_windows = state.active_recovery_windows.filter((id) => id !== 'RW_003_ZN_STABILIZATION'); state.ending_reachability = { END_01: true, END_02: false, END_03: false, END_04: false, END_05: false }; }
  if (choiceId === 'CHOICE_021_DELAY_PROTECTION') { setCharacterInjury(state, 'char_zhu_ning', 'CRITICAL'); state.time_opportunity_state.treatment_window = 'MISSED'; state.active_recovery_windows = state.active_recovery_windows.filter((id) => id !== 'RW_003_ZN_STABILIZATION'); state.pending_consequences.push({ id: 'DC_011_ZN_DEATH_AFTER_PURIFICATION', source: choiceId, status: 'PENDING' }); state.ending_reachability = { END_01: false, END_02: false, END_03: true, END_04: false, END_05: false }; }
  state.log.push(`第${state.turn}回合：提交 ${choiceId}。`);
  return state;
}

function resolveEvent(state, eventId, resultId) {
  const event = EVENTS[eventId];
  const result = EVENT_RESULTS[resultId];
  if (!event || !result || result.event_id !== eventId) throw new Error('交互事件或结果不在冻结事件表中。');
  if (event.node !== state.current_story_node_id) throw new Error(`当前节点不能解决 ${eventId}。`);
  if (event.role !== 'ANY_PLAYABLE' && event.role !== state.player_role_id) throw new Error('当前角色没有资格解决这个交互事件。');
  if (!event.results.includes(resultId)) throw new Error('结果不属于该交互事件。');
  state.interactive_event_history.push({ event_id: eventId, result_id: resultId, status: 'RESOLVED', turn: state.turn });
  for (const [key, value] of Object.entries(result.patch)) {
    if (key === 'injury') state.player_state.injury = value;
    if (key === 'core_exhaustion') state.pollution_field_state.core_exhaustion_progress = value;
    if (key === 'treatment_window') state.time_opportunity_state.treatment_window = value;
    if (key === 'driver_room') state.location_states.driver_room = value;
    if (key === 'survival_window') state.time_opportunity_state.zhu_ning_survival_window = value;
    if (key === 'evacuation') state.world_state.evacuation = value;
    if (key === 'escape_window') state.time_opportunity_state.escape_window = value;
    if (key === 'field_phase') state.pollution_field_state.phase = value;
  }
  for (const windowId of result.recovery_windows ?? []) if (!state.active_recovery_windows.includes(windowId)) state.active_recovery_windows.push(windowId);
  state.previous_story_node_id = state.current_story_node_id;
  state.current_story_node_id = result.node;
  state.current_node = result.node;
  state.log.push(`第${state.turn}回合：${result.visible}`);
  advanceAuto(state);
  return state;
}

export function createGameStore(options = {}) {
  const states = new Map();
  const saveStore = createSaveStore(options.storageDir ?? `${process.cwd()}/.dsh/feitu-world/saves`);
  const keyFor = (exec) => exec?.agent?.id ?? 'standalone';
  const get = (exec) => states.get(keyFor(exec));
  const set = (exec, state) => { states.set(keyFor(exec), state); return state; };
  const persist = (state) => { syncHash(state); saveStore.save(state.run_id, state); return state; };
  const finish = (state, notice = '', actionArgs = null) => {
    if (actionArgs && actionArgs.action !== 'view') {
      advancePressure(state, actionArgs);
      syncActivePlayerToCharacter(state);
      const characterChanges = updateCharacterVitals(state, actionArgs);
      if (actionArgs.action === 'free_action' && state.current_free_event) {
        state.current_free_event.characterChanges = characterChanges;
        const progress = buildSystemProgress(state, state.current_free_event);
        state.current_free_event.systemLines = progress;
        const historyEvent = state.free_action_history.at(-1);
        if (historyEvent?.id === state.current_free_event.id) historyEvent.systemLines = progress;
        const committedHash = committedStateHash(state);
        state.current_free_event.stateHashAfter = committedHash;
        if (historyEvent?.id === state.current_free_event.id) historyEvent.stateHashAfter = committedHash;
      }
      recordAction(state, actionArgs);
    }
    const view = publicView(state, notice); state.player_view_snapshot = clone(view); persist(state); return view;
  };
  const assertMutationGuard = (state, args) => {
    if (args?.run_id && args.run_id !== state.run_id) throw new Error('行动属于旧存档，已拒绝写入当前副本。');
    if (args?.expected_turn !== undefined && Number(args.expected_turn) !== state.turn) throw new Error(`行动已过期：客户端回合 ${args.expected_turn}，当前回合 ${state.turn}。`);
  };
  function act(args, exec) {
    const action = args.action ?? 'view';
    let state = get(exec);
    if (action === 'start') {
      state = emptyState(args.role_id ?? 'zhunin', args.dungeon_id);
      advanceAuto(state);
      set(exec, state);
      const role = ROLES[state.roleId];
      return finish(state, `已选择 ${role.name}。规则：只能以工具返回的地点、线索、物品和旗标为准。`, args);
    }
    if (action === 'resume') {
      let loaded;
      try {
        loaded = normalizeState(saveStore.load(args.run_id ?? args.target));
      } catch (error) {
        throw new Error(`存档无法恢复：${error.message}`);
      }
      if (!loaded) throw new Error('找不到这个存档；请先 action=list_saves 查看可恢复的 run_id。');
      set(exec, loaded);
      return finish(loaded, `已恢复存档 ${loaded.run_id}。${loaded.opening_migration ? '旧开场已校正为下水道休息处，原始记录已保留。' : ''}`, args);
    }
    if (action === 'world_view' || action === 'list_dungeons') return { ...publicWorldView(), notice: '世界枢纽只显示来源登记的区域、可玩副本与未开放目录；未开放目录不能直接开始。' };
    if (action === 'list_saves') return { schema: 'feitu-world/v1', saves: saveStore.list(), notice: '存档列表不会消耗回合。' };
    if (action === 'export_log') {
      if (!state) throw new Error('尚未开始副本。');
      return { schema: 'feitu-world/player-action-log/v1', run_id: state.run_id, actions: clone(state.action_history ?? []), notice: '动作日志是可回放的玩家输入摘要，不包含隐藏状态。' };
    }
    if (action === 'fork') {
      if (!state) throw new Error('尚未开始副本。');
      const forked = clone(state); forked.run_id = `fork-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`; forked.runId = forked.run_id; forked.checkpoint = null; set(exec, forked); return finish(forked, `已从当前状态创建分支存档 ${forked.run_id}。`, args);
    }
    if (!state) throw new Error('尚未开始副本。请先调用 action=start，并提供 role_id。');
    if (action === 'view') return finish(state);
    if (action === 'switch_role') {
      const role = switchRole(state, args.role_id ?? args.target);
      return finish(state, `已切换为${role.name}的第一视角；剧情、地点与回合保持不变。`, args);
    }
    if (action === 'character_dialogue' && args.client_action_id) {
      const duplicate = state.dialogue_history.find((item) => item.clientActionId === String(args.client_action_id));
      if (duplicate) return publicView(state, `已返回与${duplicate.speaker}的上一条对话，不重复生成回复。`);
    }
    if (action === 'free_action' && args.client_action_id) {
      const duplicate = state.free_action_history.find((item) => item.clientActionId === String(args.client_action_id));
      if (duplicate) return publicView(state, `已返回重复行动 ${duplicate.id} 的剧情，不重复写入世界状态。`);
    }
    if (state.committed_ending_id && ['move', 'inspect', 'take', 'use', 'talk', 'free_action', 'character_dialogue', 'submit_choice', 'resolve_interactive_event'].includes(action)) {
      throw new Error('本局已结束，请开始新一局或恢复存档。');
    }
    assertMutationGuard(state, args);
    if (action === 'save') { const checkpoint = clone(state); checkpoint.checkpoint = null; checkpoint.player_view_snapshot = null; state.checkpoint = checkpoint; return finish(state, '检查点已保存；保存的是完整确定性状态快照。', args); }
    if (action === 'load') { if (!state.checkpoint) return finish(state, '当前没有可恢复的检查点。', args); const restored = normalizeState(clone(state.checkpoint)); restored.checkpoint = clone(state.checkpoint); set(exec, restored); return finish(restored, '已恢复最近检查点。', args); }
    if (action === 'free_action') {
      const result = applyFreeAction(state, args);
      return finish(state, result.notice, { ...args, model_event: result.event.source === 'deepseek' ? args.model_event : null });
    }
    if (action === 'character_dialogue') {
      const role = roleForState(state);
      const targetId = DIALOGUE_ALIASES[args.target_id ?? args.target];
      const allowedTargets = new Set((DIALOGUE_TARGETS_BY_ROLE[role.slug] ?? []));
      if (!targetId || !allowedTargets.has(targetId)) throw new Error(`${role.name}当前不能与这个角色对话；请从可用对话对象中选择。`);
      const target = DIALOGUE_CHARACTERS[targetId];
      const input = normalizeDialogueText(args.dialogue_text ?? args.action_text);
      const modelDialogue = safeModelDialogue(args.model_dialogue, targetId, state);
      const reply = modelDialogue?.reply ?? fallbackDialogueReply(targetId, input, state);
      state.turn += 1;
      const dialogue = {
        speaker: target.name,
        speakerId: target.id,
        speakerCanonicalId: target.canonicalId,
        actorName: role.name,
        actorId: role.slug,
        userText: input,
        text: reply,
        source: modelDialogue ? 'deepseek' : 'deterministic-fallback',
        clientActionId: args.client_action_id ? String(args.client_action_id).slice(0, 120) : null,
        turn: state.turn,
      };
      state.dialogue_history.push(dialogue);
      state.log.push(`第${state.turn}回合：${role.name}与${target.name}对话。`);
      return finish(state, `${target.name}已回复。`, args);
    }
    if (action === 'submit_choice') {
      const selected = choicesFor(state).find((item) => item.choice_id === (args.choice_id ?? args.target));
      if (!selected) throw new Error('这个选择当前不可见或不符合角色、节点和世界条件。');
      state.turn += 1; applyChoiceEffects(state, selected); advanceAuto(state); return finish(state, `已执行：${playerChoiceLabel(selected)}`, args);
    }
    if (action === 'resolve_interactive_event') {
      state.turn += 1; resolveEvent(state, args.event_id ?? args.target, args.result_id); return finish(state, '交互事件结果已记录；结果不会越过冻结因果链。', args);
    }
    if (action === 'move') { const destination = resolveLocation(args.target_id ?? args.target); if (!destination) throw new Error('目标地点不在冻结地图中。请使用 L001-L010 或地点名。'); if (!LOCATIONS[state.locationId].connections.includes(destination.id)) throw new Error(`当前地点不能直接前往 ${destination.name}；请按地图中的 exits 行动。`); state.locationId = destination.id; state.location_states.current = destination.id; if (!state.location_states.visited.includes(destination.id)) state.location_states.visited.push(destination.id); state.turn += 1; state.log.push(`第${state.turn}回合：移动到 ${destination.name}。`); if (destination.id === 'L004') state.flags.trainLoop = true; return finish(state, `已抵达 ${destination.name}。`, args); }
    if (action === 'inspect') { const target = resolveLocation(args.target_id ?? args.target) ?? LOCATIONS[state.locationId]; if (target.id !== state.locationId) throw new Error('只能检查当前地点；先 move 到目标地点。'); discover(state, target); state.location_states.inspected = [...state.inspectedLocations]; state.turn += 1; state.log.push(`第${state.turn}回合：检查 ${target.name}，获得 ${target.clues.length} 条冻结线索。`); return finish(state, `检查完成：${target.clues.join('；')}`, args); }
    if (action === 'take') { const item = resolveItem(args.item_id ?? args.target); if (!item) throw new Error('目标物品不在冻结物品表中。'); if (!item.locations.includes(state.locationId)) throw new Error(`${item.name} 不在当前地点；工具不会凭空生成物品。`); if (!state.inventory.includes(item.id)) { state.inventory.push(item.id); state.item_states[item.id] = { holder: state.player_role_id, status: 'HELD' }; } state.turn += 1; state.log.push(`第${state.turn}回合：记录物品 ${item.name}。`); return finish(state, `已记录 ${item.name}。`, args); }
    if (action === 'use') { const item = resolveItem(args.item_id ?? args.target); if (!item || !state.inventory.includes(item.id)) throw new Error('只能使用已在背包中的冻结物品。'); state.turn += 1; state.log.push(`第${state.turn}回合：使用 ${item.name}；实际效果受冻结规则约束。`); return finish(state, item.use, args); }
    if (action === 'talk') { const npc = NPCS[args.target_id ?? args.target] ?? NPCS.xumeng; state.turn += 1; const dialogue = { speaker: npc.name, text: npc.fact, turn: state.turn }; state.dialogue_history.push(dialogue); state.log.push(`第${state.turn}回合：与 ${npc.name} 通讯。`); return finish(state, `${npc.name}：${npc.fact}`, args); }
    throw new Error(`不支持的 action：${action}。可用 world_view/list_dungeons/start/view/resume/list_saves/export_log/fork/switch_role/move/inspect/take/use/talk/character_dialogue/free_action/submit_choice/resolve_interactive_event/save/load。`);
  }
  return { act, view: (exec) => { const state = get(exec); return state ? publicView(state) : { started: false, opening: clone(OPENING), hint: '请先 action=start' }; }, saves: () => saveStore.list() };
}

export const CANON = { roles: ROLES, locations: LOCATIONS, items: ITEMS, npcs: NPCS, dialogueCharacters: DIALOGUE_CHARACTERS, choices: CHOICES, events: EVENTS, eventResults: EVENT_RESULTS, nodeScenes: NODE_SCENES };
