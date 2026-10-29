import { OPENING, OPENING_CONSTRAINT, openingSituation, contradictsRestOpening } from './opening.js';
import { NARRATIVE_CONSTRAINT, NARRATIVE_REFERENCE, passesNarrativeCheck } from './narrative.js';
import { buildCharacterDialogueAuthority, characterDialogueAuthorityConflict } from './character-authority.js';

const DEFAULT_ENDPOINT = 'https://api.deepseek.com/chat/completions';

function configuredOptions({ apiKey: suppliedApiKey, endpoint: suppliedEndpoint, model: suppliedModel } = {}) {
  const apiKey = suppliedApiKey || process.env.DEEPSEEK_API_KEY;
  const endpoint = suppliedEndpoint || process.env.DEEPSEEK_API_BASE_URL || DEFAULT_ENDPOINT;
  const model = suppliedModel || process.env.DEEPSEEK_MODEL || 'deepseek-chat';
  return { apiKey, endpoint, model };
}

function diagnosticMessage(reason, configured) {
  if (reason === 'DEEPSEEK_NARRATIVE_CHECK_FAILED') return '剧情未通过文风与人物一致性自检，已改用本地行动结果。';
  if (reason === 'DEEPSEEK_NARRATIVE_CONFLICT') return '对白与当前场景矛盾，已改用符合前情的本地角色回复。';
  if (reason === 'DEEPSEEK_CHARACTER_AUTHORITY_CONFLICT') return '对白违反当前角色的知识、关系或行为规则，已改用本地角色回复。';
  if (!configured || reason === 'DEEPSEEK_API_KEY_NOT_CONFIGURED') return '在线剧情服务未配置：启动进程没有 DEEPSEEK_API_KEY。';
  if (reason === 'DEEPSEEK_NETWORK_BLOCKED') return '在线剧情服务被当前进程的网络策略拦截；若从 Codex 终端启动，请关闭后改为在资源管理器中双击一键启动脚本。当前已切换为本地规则模式。';
  if (reason === 'DEEPSEEK_DNS_FAILURE') return '在线剧情服务的域名无法解析；请检查网络或 API 地址。';
  if (reason === 'DEEPSEEK_TIMEOUT') return '在线剧情服务响应超时；已切换为本地规则模式。';
  if (reason?.startsWith('DEEPSEEK_HTTP_')) return `在线剧情服务返回 ${reason.replace('DEEPSEEK_HTTP_', 'HTTP ')}；已切换为本地规则模式。`;
  if (reason === 'DEEPSEEK_INVALID_JSON') return '在线剧情服务返回了无法校验的数据；已切换为本地规则模式。';
  if (reason === 'READY') return 'DeepSeek 密钥已配置，但网络和模型尚未验证；第一次自由行动后显示真实连接结果。';
  if (reason === 'CONNECTED') return '在线剧情服务已连接。';
  return '在线剧情服务暂不可用；已切换为本地规则模式。';
}

export function deepSeekStatus(options = {}, reason = null) {
  const { apiKey, endpoint, model } = configuredOptions(options);
  const configured = Boolean(apiKey);
  const currentReason = reason || (configured ? 'READY' : 'DEEPSEEK_API_KEY_NOT_CONFIGURED');
  let endpointHost = '未配置';
  try { endpointHost = new URL(endpoint).host; } catch { endpointHost = '地址无效'; }
  return {
    configured,
    state: currentReason === 'CONNECTED' ? 'CONNECTED' : currentReason === 'READY' ? 'READY' : 'FALLBACK',
    reason: currentReason,
    message: diagnosticMessage(currentReason, configured),
    endpointHost,
    model,
  };
}

function classifyTransportError(error) {
  if (error?.name === 'AbortError') return 'DEEPSEEK_TIMEOUT';
  const code = error?.cause?.code || error?.code;
  if (code === 'EACCES' || code === 'EPERM') return 'DEEPSEEK_NETWORK_BLOCKED';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'DEEPSEEK_DNS_FAILURE';
  if (code === 'ECONNREFUSED' || code === 'ECONNRESET') return 'DEEPSEEK_CONNECTION_REFUSED';
  return 'DEEPSEEK_UNAVAILABLE';
}

function parseJson(text) {
  const cleaned = String(text ?? '').trim().replace(/^```json\s*/i, '').replace(/\s*```$/i, '');
  try { return JSON.parse(cleaned); } catch { return null; }
}

function publicContext(view) {
  return {
    opening: view.opening,
    openingSituation: openingSituation(view),
    role: view.role,
    characters: view.characters,
    currentNode: view.currentNode,
    location: view.location,
    map: view.map.filter((item) => item.discovered || item.current),
    choices: view.choices.filter((item) => item.action === 'submit_choice'),
    visibleFacts: view.visibleFacts,
    discoveredClues: view.discoveredClues,
    inventory: view.inventory,
    helmet: view.helmet,
    factLedger: view.factLedger,
    visibleNarrative: view.visibleNarrative,
    visibleDialogue: view.visibleDialogue,
    npcStatus: view.npcStatus,
  };
}

const DIALOGUE_PROFILES = {
  zhunin: {
    id: 'zhunin',
    name: '祝宁',
    voice: '直接、简短，警惕但有自然的疑问和少量吐槽；有战斗经验，却是清理新人，不熟悉的规则会问，不说空泛安慰。',
    drives: ['生存', '照应身体不适的同伴', '遇到异常时先核实'],
    knowledge: [...OPENING.facts],
    boundaries: ['不凭未知信息行动', '不把推测说成事实', '活跃污染环境中不建议摘除防护装备'],
    relationships: '照应李念川，也提防他被污染后失控；对徐萌尊重职责，会询问未知规则。信任随实际协作发展，不预支后期亲密关系。',
  },
  linenchuan: {
    id: 'linenchuan',
    name: '李念川',
    voice: '年轻、性急、口语化，会抱怨、质疑和轻微吐槽，容易把不适说轻一些；不把每句话说成工作汇报，不替尚未发现的异常做专业诊断。',
    drives: ['先休息缓解不适', '与可靠队友保持同场', '生存'],
    knowledge: [...OPENING.facts, '清理流程', '一般污染物远离后影响应减弱', '工作守则要求报告异常', '自己正在不适'],
    boundaries: ['不凭未知规则宣称结果', '主观上容易低估自己的污染症状', '无法通讯时不假装收到远端信息'],
    relationships: '对祝宁的信任建立在现场验证上，不一开始就无条件听从，也会质疑她的举动；对现场负责人徐萌有报告和服从倾向。',
  },
  xumeng: {
    id: 'xumeng',
    name: '徐萌',
    voice: '现场负责人式的清楚、克制和程序化表达；先问读数与症状，再给短而可执行的安排。',
    drives: ['保护队员', '完成孢子收容', '组织救援'],
    knowledge: ['任务登记数据', '队员主动报告过的情况', '外层作业面和通讯状态'],
    boundaries: ['不主动放弃失联队员', '不将未经确认的推测当作规则', '不知道现场未上报的信息'],
    relationships: '对李念川承担熟悉队员的监护责任；对祝宁保持观察，确认可靠后会提高授权。',
  },
};

function dialogueProfile(targetId) {
  const aliases = { char_zhu_ning: 'zhunin', char_li_nianchuan: 'linenchuan' };
  return DIALOGUE_PROFILES[aliases[targetId] ?? targetId] ?? null;
}

export async function requestCharacterDialogue({ dialogueText, targetId, view, apiKey: suppliedApiKey, endpoint: suppliedEndpoint, model: suppliedModel }) {
  if (view?.ending) throw new Error('本局已结束，请开始新一局或恢复存档。');
  const { apiKey, endpoint, model } = configuredOptions({ apiKey: suppliedApiKey, endpoint: suppliedEndpoint, model: suppliedModel });
  const target = dialogueProfile(targetId);
  if (!target) {
    const reason = 'DEEPSEEK_INVALID_DIALOGUE_TARGET';
    return { model_available: false, model_dialogue: null, reason, diagnostic: deepSeekStatus({ apiKey, endpoint, model }, reason) };
  }
  if (!apiKey) {
    const reason = 'DEEPSEEK_API_KEY_NOT_CONFIGURED';
    return { model_available: false, model_dialogue: null, reason, diagnostic: deepSeekStatus({ endpoint, model }, reason) };
  }
  const authority = buildCharacterDialogueAuthority(target.id, view, dialogueText);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        temperature: 0.35,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: `你正在扮演《废土世界》角色“${target.name}”，回答当前玩家角色的一句话。必须严格保持角色一致性，不得 OOC。\n\n角色锚点：\n- 说话方式：${target.voice}\n- 核心动机：${target.drives.join('、')}\n- 已知起点：${target.knowledge.join('；')}\n- 硬边界：${target.boundaries.join('；')}\n- 关系：${target.relationships}\n\n约束：只说${target.name}本人此刻会说的话；不替玩家说话，不写旁白、动作描写、心理分析或系统说明。player_view 是事实边界，不代表${target.name}自动知道其中全部内容；只能使用该角色已知起点、对方在 recent_dialogue 中报告的信息，以及当前可直接观察的信息。不泄露隐藏计划，不创造新事实、能力、物品、地点、死亡或结局。对未知信息明确说不知道或要求核实。回答应自然、克制、符合当前危机，通常 1—3 句、20—140 个汉字。只输出 JSON：{"speaker_id":"${target.id}","reply":"角色对白","ooc_check":{"voice_consistent":true,"knowledge_bounded":true,"player_not_controlled":true}}。若无法安全回答，也必须以${target.name}口吻简短说明当前无法确认。`,
          },
          { role: 'system', content: OPENING_CONSTRAINT },
          {
            role: 'system',
            content: `本轮角色权威约束如下。它由人物口吻档案、时间点状态、关系变化和决策规则编译而成；active_rules 是本轮必须执行的规则，point_in_time_state 中 unknown 的内容不得被角色当作已知事实。来源 ID 仅供约束审计，不得在对白中提及。\n${JSON.stringify(authority)}`,
          },
          {
            role: 'user',
            content: JSON.stringify({
              speaking_to: target.id,
              dialogue_text: String(dialogueText ?? '').slice(0, 280),
              recent_dialogue: view.visibleDialogue?.slice(-4) ?? [],
              player_view: publicContext(view),
            }),
          },
        ],
      }),
    });
    if (!response.ok) {
      const reason = `DEEPSEEK_HTTP_${response.status}`;
      return { model_available: false, model_dialogue: null, reason, diagnostic: deepSeekStatus({ apiKey, endpoint, model }, reason) };
    }
    const payload = await response.json();
    const parsed = parseJson(payload?.choices?.[0]?.message?.content);
    const checks = parsed?.ooc_check;
    if (parsed && characterDialogueAuthorityConflict(parsed.reply, authority)) {
      const reason = 'DEEPSEEK_CHARACTER_AUTHORITY_CONFLICT';
      return { model_available: false, model_dialogue: null, reason, diagnostic: deepSeekStatus({ apiKey, endpoint, model }, reason) };
    }
    if (parsed && contradictsRestOpening(parsed.reply, view)) {
      const reason = 'DEEPSEEK_NARRATIVE_CONFLICT';
      return { model_available: false, model_dialogue: null, reason, diagnostic: deepSeekStatus({ apiKey, endpoint, model }, reason) };
    }
    if (!parsed || parsed.speaker_id !== target.id || typeof parsed.reply !== 'string' || !parsed.reply.trim() || parsed.reply.length > 500 || checks?.voice_consistent !== true || checks?.knowledge_bounded !== true || checks?.player_not_controlled !== true) {
      const reason = 'DEEPSEEK_INVALID_JSON';
      return { model_available: false, model_dialogue: null, reason, diagnostic: deepSeekStatus({ apiKey, endpoint, model }, reason) };
    }
    return {
      model_available: true,
      model_dialogue: { speaker_id: target.id, reply: parsed.reply.trim().slice(0, 500) },
      model: payload?.model || model,
      diagnostic: deepSeekStatus({ apiKey, endpoint, model: payload?.model || model }, 'CONNECTED'),
    };
  } catch (error) {
    const reason = classifyTransportError(error);
    return { model_available: false, model_dialogue: null, reason, diagnostic: deepSeekStatus({ apiKey, endpoint, model }, reason) };
  } finally {
    clearTimeout(timeout);
  }
}

export async function requestDeepSeekEvent({ actionText, selectedAction, view, apiKey: suppliedApiKey, endpoint: suppliedEndpoint, model: suppliedModel }) {
  if (view?.ending) throw new Error('本局已结束，请开始新一局或恢复存档。');
  const { apiKey, endpoint, model } = configuredOptions({ apiKey: suppliedApiKey, endpoint: suppliedEndpoint, model: suppliedModel });
  if (!apiKey) {
    const reason = 'DEEPSEEK_API_KEY_NOT_CONFIGURED';
    return { model_available: false, model_event: null, reason, diagnostic: deepSeekStatus({ endpoint, model }, reason) };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        temperature: 0.45,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: '你是《废土世界》的事件导演。玩家从网页自由行动输入框提交的内容与从 DSH 对话输入框提交完全等价，且必须解释为当前角色亲自采取的行动。你只能使用玩家可见地点、出口、人物、物品、事实和选择；不能创建新地点、物品、人物、事实、能力、隐藏计划、死亡或结局。模型只提出事件，运行时负责最终裁决。若请求带 selected_action，表示玩家刚点击了一个当前可见按钮；必须保留其 action 和标识，不得改选其他分支。叙事遵循下述原文适配约束，使用第三人称限知视角，剧情正文先落到当前角色的行动，再写现场环境或 NPC 的可见反应，结尾留下可继续行动的局势。不要写玩家未输入的内心决定，不要复制小说原句或长段落。每次事件评估已在 characters 中出现的角色体征，允许零变化；李念川已有不适，但不能无证据地每回合加重。同一已确认污染/恐惧事件下，李念川比祝宁更易受影响，不能把两人写成相同反应。只输出 JSON：{"actor_id":"必须等于当前角色 id","intent":"choice|move|inspect|talk|observe","target":"可见目标ID或NPC","choice_id":"可见choice_id或空","event_title":"不超过24字，像章节标题","event_text":"40-160字，系统审计短摘要","story_segment":"通常180-600字、2-4个短段落，事实不足可短写，最多1200字符","narrative_check":{"style_consistent":true,"character_consistent":true,"knowledge_bounded":true,"player_agency_preserved":true,"facts_bounded":true},"next_choice_id":"可见choice_id或空","referenced_fact_ids":[],"confidence":0.0,"effects":{"pollution_delta":"-3到10的整数","oxygen_delta":"-4到1的整数","suit_integrity_delta":"-6到0的整数","countdown_delta":"-2到1的整数","communication":"UNCHANGED|AVAILABLE|USED|LOST","characters":{"zhunin":{"mental_delta":"-6到2","stamina_delta":"-5到2","heart_rate_delta":"-8到18"},"linenchuan":{"mental_delta":"-6到2","stamina_delta":"-5到2","heart_rate_delta":"-8到18"}}}}。effects 必须是玩家行动的直接可见后果；运行时按角色小说基线限幅和放大/缩小，正文不得写未经最终批准的具体读数。如果行动不安全，使用 observe 并解释阻碍。' },
          { role: 'system', content: OPENING_CONSTRAINT },
          { role: 'system', content: NARRATIVE_CONSTRAINT },
          { role: 'user', content: JSON.stringify({ action_text: actionText, selected_action: selectedAction ?? null, player_view: publicContext(view), character_profiles: Object.values(DIALOGUE_PROFILES), narrative_reference: NARRATIVE_REFERENCE }) },
        ],
      }),
    });
    if (!response.ok) {
      const reason = `DEEPSEEK_HTTP_${response.status}`;
      return { model_available: false, model_event: null, reason, diagnostic: deepSeekStatus({ apiKey, endpoint, model }, reason) };
    }
    const payload = await response.json();
    const parsed = parseJson(payload?.choices?.[0]?.message?.content);
    if (!parsed || typeof parsed !== 'object') {
      const reason = 'DEEPSEEK_INVALID_JSON';
      return { model_available: false, model_event: null, reason, diagnostic: deepSeekStatus({ apiKey, endpoint, model }, reason) };
    }
    if (!passesNarrativeCheck(parsed) || contradictsRestOpening([parsed.event_title, parsed.event_text, parsed.story_segment].join('\n'), view)) {
      const reason = 'DEEPSEEK_NARRATIVE_CHECK_FAILED';
      return { model_available: false, model_event: null, reason, diagnostic: deepSeekStatus({ apiKey, endpoint, model }, reason) };
    }
    return { model_available: true, model_event: parsed, model: payload?.model || model, diagnostic: deepSeekStatus({ apiKey, endpoint, model: payload?.model || model }, 'CONNECTED') };
  } catch (error) {
    const reason = classifyTransportError(error);
    return { model_available: false, model_event: null, reason, diagnostic: deepSeekStatus({ apiKey, endpoint, model }, reason) };
  } finally {
    clearTimeout(timeout);
  }
}
