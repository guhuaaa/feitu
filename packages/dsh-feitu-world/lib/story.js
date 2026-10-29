// This is the executable snapshot of the frozen Step 4C/4E route contracts.
// The source-of-truth files remain under simulation/game_design; this compact
// copy keeps the installable DSH package self-contained and auditable.

export const AUTO_NEXT = {
  START: 'NODE_001',
  NODE_001: 'NODE_002',
  NODE_003: 'NODE_004',
  NODE_006: 'NODE_007',
  NODE_007: 'NODE_008',
  NODE_010: 'NODE_011',
  NODE_016: 'ENDING_NODE_02',
  NODE_018: 'ENDING_NODE_05',
};

export const NODE_SCENES = {
  START: 'SCENE_ROLE_ONBOARDING',
  NODE_001: 'SCENE_A7_ENTRY',
  NODE_002: 'SCENE_TEAMMATE_SYMPTOM',
  NODE_003: 'SCENE_SEWER_CLEANUP',
  NODE_004: 'SCENE_SIGNAL_DECISION',
  NODE_005: 'SCENE_FIELD_ENTRY',
  NODE_006: 'SCENE_SIGNAL_DELAY_FEEDBACK',
  NODE_007: 'SCENE_TRAIN_BOARDING',
  NODE_008: 'SCENE_TRAIN_TEAM_CONTEXT',
  NODE_009: 'SCENE_OUTSIDE_ANOMALY',
  NODE_010: 'SCENE_FALSE_PURIFICATION_FEEDBACK',
  NODE_011: 'SCENE_REMEDIATION_WINDOW',
  NODE_012: 'SCENE_CORE_PURIFICATION',
  NODE_013_ZN: 'SCENE_ZN_TRACK_CONFRONTATION',
  NODE_013_LN: 'SCENE_LN_DRIVER_ROOM',
  NODE_014: 'SCENE_ZN_PROTECTION_WINDOW',
  NODE_015: 'SCENE_ENDING_GATE',
  NODE_016: 'SCENE_HOLD_ENTRY_RESCUE',
  NODE_017: 'SCENE_PRE_EXPANSION_ESCAPE',
  NODE_018: 'SCENE_PERMANENT_LOOP',
  ENDING_NODE_01: 'SCENE_ENDING_01',
  ENDING_NODE_02: 'SCENE_ENDING_02',
  ENDING_NODE_03: 'SCENE_ENDING_03',
  ENDING_NODE_04: 'SCENE_ENDING_04',
  ENDING_NODE_05: 'SCENE_ENDING_05',
};

const choice = (choice_id, source_node, roles, label, next_node) => ({ choice_id, source_node, roles, label, next_node });

export const CHOICES = [
  choice('CHOICE_001_PROTECT_REPORT', 'NODE_002', ['char_zhu_ning'], '报告李念川的异常并保护他', 'NODE_003'),
  choice('CHOICE_002_PRESS_CONTINUE', 'NODE_002', ['char_zhu_ning'], '暂不打断，继续清理并观察', 'NODE_003'),
  choice('CHOICE_003_SELF_REPORT', 'NODE_002', ['char_li_nianchuan'], '报告自己的不适', 'NODE_003'),
  choice('CHOICE_004_CONCEAL_SYMPTOM', 'NODE_002', ['char_li_nianchuan'], '暂时隐瞒不适', 'NODE_003'),
  choice('CHOICE_005_SEND_EVIDENCE_ZN', 'NODE_004', ['char_zhu_ning'], '发送已验证的活污染物证据', 'NODE_005'),
  choice('CHOICE_006_SEND_SIGNAL_LN', 'NODE_004', ['char_li_nianchuan'], '发送活污染物信号', 'NODE_005'),
  choice('CHOICE_007_DELAY_SIGNAL', 'NODE_004', ['char_zhu_ning', 'char_li_nianchuan'], '延迟信号，继续确认', 'NODE_006'),
  choice('CHOICE_008_HOLD_ENTRY', 'NODE_005', ['char_zhu_ning', 'char_li_nianchuan'], '守住入口等待支援', 'NODE_016'),
  choice('CHOICE_009_EVACUATE_NOW', 'NODE_005', ['char_zhu_ning', 'char_li_nianchuan'], '立即沿已知路线撤离', 'NODE_017'),
  choice('CHOICE_010_ENTER_DEEP_FIELD', 'NODE_005', ['char_zhu_ning', 'char_li_nianchuan'], '穿戴防护后进入深层场域', 'NODE_007'),
  choice('CHOICE_011_STAY_AND_SHARE', 'NODE_008', ['char_zhu_ning', 'char_li_nianchuan'], '留在一起并共享发现', 'NODE_009'),
  choice('CHOICE_012_SPLIT_AND_ACT', 'NODE_008', ['char_zhu_ning', 'char_li_nianchuan'], '分开行动调查车厢', 'NODE_010'),
  choice('CHOICE_013_CHECK_OUTSIDE_ZN', 'NODE_009', ['char_zhu_ning'], '检查车窗外的异常位置', 'NODE_012'),
  choice('CHOICE_014_SHARE_ANOMALY_LN', 'NODE_009', ['char_li_nianchuan'], '把车外异常告诉祝宁', 'NODE_012'),
  choice('CHOICE_015_FOCUS_MANIFESTATION', 'NODE_009', ['char_zhu_ning', 'char_li_nianchuan'], '先压制司机表现体', 'NODE_010'),
  choice('CHOICE_016_RECHECK_CORE', 'NODE_011', ['char_zhu_ning', 'char_li_nianchuan'], '重新检查真正的核心', 'NODE_012'),
  choice('CHOICE_017_WAIT_FOR_FALSE_RESULT', 'NODE_011', ['char_zhu_ning', 'char_li_nianchuan'], '等待错误结果自行显现', 'NODE_018'),
  choice('CHOICE_018_OBSERVE_TESTIMONY_ZN', 'NODE_012', ['char_zhu_ning'], '观察核心临终陈述', 'NODE_013_ZN'),
  choice('CHOICE_019_CREATE_CRUSH_ZN', 'NODE_012', ['char_zhu_ning'], '制造轨道碾压窗口', 'NODE_013_ZN'),
  choice('CHOICE_020_PROTECT_IN_TIME', 'NODE_014', ['char_zhu_ning', 'char_li_nianchuan'], '及时保护祝宁', 'NODE_015'),
  choice('CHOICE_021_DELAY_PROTECTION', 'NODE_014', ['char_zhu_ning', 'char_li_nianchuan'], '延后保护，继续净化', 'NODE_015'),
  choice('CHOICE_022_COORDINATE_TESTIMONY_LN', 'NODE_012', ['char_li_nianchuan'], '配合祝宁的核心判断', 'NODE_013_LN'),
  choice('CHOICE_023_DRIVER_CRUSH_LN', 'NODE_012', ['char_li_nianchuan'], '进入司机室尝试司机干预', 'NODE_013_LN'),
];

export const EVENTS = {
  IE_ZN_TRACK_CONFRONTATION: {
    node: 'NODE_013_ZN', role: 'char_zhu_ning', results: ['IER_ZN_TRACK_SUCCESS', 'IER_ZN_TRACK_PARTIAL', 'IER_ZN_TRACK_FAILURE'],
  },
  IE_LN_DRIVER_CAB: {
    node: 'NODE_013_LN', role: 'char_li_nianchuan', results: ['IER_LN_CAB_SUCCESS', 'IER_LN_CAB_PARTIAL', 'IER_LN_CAB_FAILURE'],
  },
  IE_PRE_EXPANSION_ESCAPE: {
    node: 'NODE_017', role: 'ANY_PLAYABLE', results: ['IER_ESCAPE_SUCCESS', 'IER_ESCAPE_PARTIAL', 'IER_ESCAPE_FAILURE'],
  },
};

export const EVENT_RESULTS = {
  IER_ZN_TRACK_SUCCESS: { event_id: 'IE_ZN_TRACK_CONFRONTATION', node: 'NODE_014', visible: '祝宁制造出短暂的脱离窗口，核心被削弱但没有被直接宣称净化。', recovery_windows: ['RW_003_ZN_STABILIZATION'], patch: { injury: 'LIGHT_OR_NONE', core_exhaustion: 'UP', treatment_window: 'OPEN' } },
  IER_ZN_TRACK_PARTIAL: { event_id: 'IE_ZN_TRACK_CONFRONTATION', node: 'NODE_014', visible: '祝宁带伤脱离，核心仍然存在；救治窗口被保留下来。', recovery_windows: ['RW_003_ZN_STABILIZATION'], patch: { injury: 'INJURED', core_exhaustion: 'UP', treatment_window: 'OPEN' } },
  IER_ZN_TRACK_FAILURE: { event_id: 'IE_ZN_TRACK_CONFRONTATION', node: 'NODE_014', visible: '轨道行动失败，祝宁伤势加重，但终局仍由后续保护选择决定。', recovery_windows: ['RW_003_ZN_STABILIZATION'], patch: { injury: 'HEAVY', core_exhaustion: 'UNCHANGED', treatment_window: 'OPEN' } },
  IER_LN_CAB_SUCCESS: { event_id: 'IE_LN_DRIVER_CAB', node: 'NODE_014', visible: '李念川稳住司机室，鸣笛和远端救助窗口暂时延长。', recovery_windows: ['RW_003_ZN_STABILIZATION'], patch: { driver_room: 'SECURED', survival_window: 'EXTENDED', core_exhaustion: 'UP' } },
  IER_LN_CAB_PARTIAL: { event_id: 'IE_LN_DRIVER_CAB', node: 'NODE_014', visible: '李念川进入司机室但受到阻断，窗口缩短。', recovery_windows: ['RW_003_ZN_STABILIZATION'], patch: { driver_room: 'ALERTED', survival_window: 'SHORTENED' } },
  IER_LN_CAB_FAILURE: { event_id: 'IE_LN_DRIVER_CAB', node: 'NODE_014', visible: '司机室隔绝失败，李念川被迫离开；保护选择仍然可用。', recovery_windows: ['RW_003_ZN_STABILIZATION'], patch: { driver_room: 'BLOCKED', survival_window: 'SHORTENED' } },
  IER_ESCAPE_SUCCESS: { event_id: 'IE_PRE_EXPANSION_ESCAPE', node: 'ENDING_NODE_04', visible: '小队沿已知来路与外层会合，净化链被主动放弃。', patch: { evacuation: 'COMPLETED' } },
  IER_ESCAPE_PARTIAL: { event_id: 'IE_PRE_EXPANSION_ESCAPE', node: 'NODE_006', visible: '撤离被拖慢，场域开始展开；尚未形成终局。', patch: { escape_window: 'SHORTENED', field_phase: 'EXPANDING' } },
  IER_ESCAPE_FAILURE: { event_id: 'IE_PRE_EXPANSION_ESCAPE', node: 'NODE_006', visible: '撤离失败，小队被迫停在场域边界；尚未直接锁定终局。', patch: { escape_window: 'CLOSED', field_phase: 'EXPANDING' } },
};

export const EVENT_RESULT_LABELS = {
  IER_ZN_TRACK_SUCCESS: '制造脱离窗口（成功）',
  IER_ZN_TRACK_PARTIAL: '带伤脱离（部分成功）',
  IER_ZN_TRACK_FAILURE: '轨道行动失败',
  IER_LN_CAB_SUCCESS: '稳住司机室（成功）',
  IER_LN_CAB_PARTIAL: '进入司机室但受阻',
  IER_LN_CAB_FAILURE: '司机室干预失败',
  IER_ESCAPE_SUCCESS: '沿已知路线撤离',
  IER_ESCAPE_PARTIAL: '撤离被拖慢',
  IER_ESCAPE_FAILURE: '停在场域边界',
};

export function choicesFor(state, { playerSurface = false } = {}) {
  return CHOICES.filter((item) => {
    if (item.source_node !== state.current_story_node_id || !item.roles.includes(state.player_role_id) || state.committed_ending_id) return false;
    // The rest prologue already establishes the symptom; older saves retain
    // their work-area discovery gate.
    if (playerSurface && item.source_node === 'NODE_002') return state.opening ? state.locationId === 'L003' : state.locationId === 'L002' && state.inspectedLocations?.includes('L002');
    if (playerSurface && state.opening && item.source_node === 'NODE_004') return state.discoveredClues?.includes('鱼人服装与末班车话语');
    return true;
  });
}
