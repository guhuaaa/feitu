import { readFileSync } from 'node:fs';

const AUTHORITY_DATA = JSON.parse(readFileSync(new URL('../content/character-dialogue-authority.json', import.meta.url), 'utf8'));
const TARGET_ALIASES = {
  char_zhu_ning: 'zhunin',
  char_li_nianchuan: 'linenchuan',
  char_xu_meng: 'xumeng',
};

function normalizeTargetId(targetId) {
  return TARGET_ALIASES[targetId] ?? targetId;
}

function textIncludesAny(text, needles = []) {
  const value = String(text ?? '');
  return needles.some((needle) => value.includes(needle));
}

function collectVisibleFactText(view) {
  return JSON.stringify([
    view?.visibleFacts ?? [],
    view?.discoveredClues ?? [],
    view?.factLedger?.verified ?? [],
  ]);
}

function communicationStatus(view) {
  return view?.helmet?.communication?.status
    ?? view?.helmet?.communication
    ?? view?.pressure?.communication
    ?? 'UNKNOWN';
}

function ruleMatches(rule, dialogueText, view) {
  const when = rule.when ?? {};
  if (!when.always && when.scene_id && view?.opening?.id !== when.scene_id) return false;
  if (!when.always && when.node_id && view?.currentNode?.id !== when.node_id) return false;
  if (!when.always && when.location_id && view?.location?.id !== when.location_id) return false;
  if (when.input_any && !textIncludesAny(dialogueText, when.input_any)) return false;
  if (when.fact_any && !textIncludesAny(collectVisibleFactText(view), when.fact_any)) return false;
  if (when.communication_in && !when.communication_in.includes(communicationStatus(view))) return false;
  return true;
}

export function buildCharacterDialogueAuthority(targetId, view, dialogueText) {
  const id = normalizeTargetId(targetId);
  const profile = AUTHORITY_DATA.profiles[id];
  if (!profile) return null;

  const scene = AUTHORITY_DATA.scene_states[view?.opening?.id];
  const sceneMatches = scene
    && (!scene.node_id || scene.node_id === view?.currentNode?.id)
    && (!scene.location_id || scene.location_id === view?.location?.id);
  const state = sceneMatches ? scene.characters?.[id] ?? null : null;
  const activeRules = AUTHORITY_DATA.rules
    .filter((rule) => rule.character_id === id && ruleMatches(rule, dialogueText, view))
    .sort((left, right) => right.priority - left.priority)
    .map(({ id: ruleId, directive, source_refs: sourceRefs }) => ({ id: ruleId, directive, source_refs: sourceRefs }));

  return {
    schema: AUTHORITY_DATA.schema,
    character_id: id,
    canonical_id: profile.canonical_id,
    name: profile.name,
    voice_rules: profile.voice_rules,
    core_drives: profile.core_drives,
    hard_boundaries: profile.hard_boundaries,
    relationship_rules: profile.relationship_rules,
    point_in_time_state: state,
    active_rules: activeRules,
    source_refs: [...new Set([
      ...profile.source_refs,
      ...(state?.source_refs ?? []),
      ...activeRules.flatMap((rule) => rule.source_refs),
    ])],
  };
}

export function characterDialogueAuthorityConflict(reply, authority) {
  if (!authority) return null;
  const activeIds = new Set(authority.active_rules.map((rule) => rule.id));
  for (const rule of AUTHORITY_DATA.rules) {
    if (!activeIds.has(rule.id)) continue;
    for (const pattern of rule.forbidden_reply_patterns ?? []) {
      if (new RegExp(pattern, 'u').test(String(reply ?? ''))) return rule.id;
    }
  }
  return null;
}
