import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CANON } from '../packages/dsh-feitu-world/lib/runtime.js';

const root = resolve(import.meta.dirname, '..');
const readJson = (relative) => JSON.parse(readFileSync(resolve(root, relative), 'utf8'));
const manifest = readJson('packages/dsh-feitu-world/content/one-line-last-train.content.json');
const releaseManifest = readJson('packages/dsh-feitu-world/RELEASE_MANIFEST.json');
const rolesSource = readJson('simulation/game_design/player_roles/player_role_profiles.json').roles;
const choiceSource = readJson('simulation/game_design/choice_system/choice_availability.json').rules;
const eventSource = readJson('simulation/game_design/interactive_events/interactive_events.json').events;
const resultSource = readJson('simulation/game_design/interactive_events/interactive_event_results.json').results;
const routeSource = readJson('simulation/game_design/runtime/playable_route_graph.json');
const pressureSource = readJson('simulation/game_design/runtime/pressure_clock_contract.json');
const pressurePackage = readJson('packages/dsh-feitu-world/content/pressure-clock-contract.json');
const npcSource = readJson('feitu_campaign/feitu-last-train.npcs.json');
const npcContract = readJson('simulation/game_design/runtime/npc_visibility_contract.json');
const npcPackage = readJson('packages/dsh-feitu-world/content/npc-visibility-contract.json');
const authorSource = readJson('simulation/game_design/authoring/one-line-last-train.author.json');
const authorGraph = readJson('packages/dsh-feitu-world/content/author-graph.json');
const resourceStatus = readJson('packages/dsh-feitu-world/ui/RESOURCE_GENERATION_STATUS.json');
const worldSource = readJson('simulation/game_design/runtime/world_registry_contract.json');
const worldPackage = readJson('packages/dsh-feitu-world/content/world-registry.json');
const extensionSource = readJson('simulation/game_design/runtime/world_extension_contract.json');
const extensionPackage = readJson('packages/dsh-feitu-world/content/world-extension-contract.json');

const errors = [];
const sorted = (value) => [...value].sort();
const runtimeRoles = Object.values(CANON.roles);
const runtimeChoiceById = new Map(CANON.choices.map((item) => [item.choice_id, item]));
const runtimeEventIds = Object.keys(CANON.events);
const runtimeResultIds = Object.keys(CANON.eventResults);
const routeNodes = new Set(routeSource.nodes);

if (manifest.authoring_contract?.source !== 'simulation/game_design/authoring/one-line-last-train.author.json') errors.push('authoring source drift');
if (manifest.authoring_contract?.compiled !== 'content/author-graph.json') errors.push('authoring compiled path drift');
if (manifest.authoring_contract?.schema !== 'feitu-author-graph/v1') errors.push('authoring schema drift');
if (manifest.authoring_contract?.state_machine_owner !== 'packages/dsh-feitu-world/lib/runtime.js') errors.push('authoring state owner drift');
if (manifest.world_registry_contract?.source !== 'simulation/game_design/runtime/world_registry_contract.json') errors.push('world registry source drift');
if (manifest.world_registry_contract?.packaged_copy !== 'content/world-registry.json') errors.push('world registry packaged copy drift');
if (manifest.world_registry_contract?.player_view_is_registry_only !== true) errors.push('world registry player view boundary drift');
if (manifest.world_registry_contract?.runtime_owns_world_state !== true) errors.push('world registry runtime ownership drift');
if (manifest.world_extension_contract?.source !== 'simulation/game_design/runtime/world_extension_contract.json') errors.push('world extension source drift');
if (manifest.world_extension_contract?.packaged_copy !== 'content/world-extension-contract.json') errors.push('world extension packaged copy drift');
if (manifest.world_extension_contract?.schema !== 'feitu-world/world-extension/v1') errors.push('world extension schema drift');
if (JSON.stringify(extensionSource) !== JSON.stringify(extensionPackage)) errors.push('packaged world extension contract drift');
if (extensionSource.governance?.runtime_state_owner !== 'packages/dsh-feitu-world/lib/runtime.js') errors.push('world extension runtime ownership drift');
if (JSON.stringify(worldSource) !== JSON.stringify(worldPackage)) errors.push('packaged world registry drift');
if (worldSource.schema !== 'feitu-world/world-registry/v1') errors.push('world registry schema invalid');
if (worldSource.world_id !== 'feitu-world') errors.push('world registry id drift');
if (worldSource.regions?.length !== manifest.expected_counts.world_regions) errors.push('world region count drift');
if (worldSource.dungeons?.length !== manifest.expected_counts.world_dungeons) errors.push('world dungeon count drift');
if (worldSource.announced_dungeons?.length !== manifest.expected_counts.world_announced_dungeons) errors.push('world announced dungeon count drift');
if (worldSource.regions?.some((region) => region.status !== 'ACTIVE')) errors.push('world registry has non-active source region');
if (worldSource.dungeons?.some((dungeon) => dungeon.status !== 'PLAYABLE')) errors.push('world registry has non-playable declared dungeon');
if (worldSource.expansion_policy?.runtime_owns_world_state !== true) errors.push('world registry expansion policy weakens runtime ownership');
if (worldSource.expansion_policy?.announced_dungeons_are_catalog_only !== true) errors.push('world catalog policy weakens catalog-only boundary');
if (worldSource.expansion_policy?.playable_dungeon_requires_content_manifest !== true) errors.push('world catalog policy weakens playable manifest boundary');
for (const dungeon of worldSource.announced_dungeons ?? []) {
  if (dungeon.status !== 'ANNOUNCED' || dungeon.playable !== false) errors.push(`announced dungeon is not catalog-only: ${dungeon.id}`);
  if (dungeon.content_manifest !== undefined && dungeon.content_manifest !== null) errors.push(`announced dungeon has a content manifest: ${dungeon.id}`);
  if (!dungeon.source_ref || !existsSync(resolve(root, dungeon.source_ref))) errors.push(`announced dungeon source missing: ${dungeon.id}`);
}
const regionIds = new Set((worldSource.regions ?? []).map((region) => region.id));
for (const dungeon of worldSource.dungeons ?? []) {
  if (!regionIds.has(dungeon.region_id)) errors.push(`dungeon points outside registered region: ${dungeon.id}`);
  if (!dungeon.content_manifest) {
    errors.push(`dungeon missing content manifest: ${dungeon.id}`);
    continue;
  }
  const dungeonManifestPath = resolve(root, dungeon.content_manifest);
  if (!existsSync(dungeonManifestPath)) {
    errors.push(`dungeon content manifest missing: ${dungeon.id}`);
    continue;
  }
  const dungeonManifest = JSON.parse(readFileSync(dungeonManifestPath, 'utf8'));
  if (dungeonManifest.content_id !== dungeon.id) errors.push(`dungeon content id drift: ${dungeon.id}`);
  if (dungeonManifest.runtime_contract !== manifest.runtime_contract) errors.push(`dungeon runtime contract drift: ${dungeon.id}`);
  if (dungeon.status === 'PLAYABLE' && !dungeon.entry_node) errors.push(`playable dungeon missing entry node: ${dungeon.id}`);
}
const playableDungeonIds = (worldSource.dungeons ?? []).filter((dungeon) => dungeon.status === 'PLAYABLE').map((dungeon) => dungeon.id).sort();
if (JSON.stringify(playableDungeonIds) !== JSON.stringify([manifest.content_id].sort())) errors.push('playable dungeon set does not match content manifest');
if (JSON.stringify((releaseManifest.playable_dungeon_ids ?? []).slice().sort()) !== JSON.stringify(playableDungeonIds)) errors.push('release playable dungeon set drift');
if (authorSource.schema !== 'feitu-author-source/v1') errors.push('authoring source schema invalid');
if (authorGraph.schema !== 'feitu-author-graph/v1') errors.push('compiled author graph schema invalid');
if (authorGraph.content_id !== manifest.content_id) errors.push('compiled author graph content drift');
if (authorGraph.runtime_contract !== manifest.runtime_contract) errors.push('compiled author graph runtime contract drift');
if (authorGraph.nodes?.length !== routeSource.nodes.length) errors.push('compiled author graph node count drift');
if (authorGraph.choices?.length !== choiceSource.length) errors.push('compiled author graph choice count drift');
if (authorGraph.events?.length !== eventSource.length) errors.push('compiled author graph event count drift');
if (authorGraph.event_results?.length !== resultSource.length) errors.push('compiled author graph result count drift');
if (authorGraph.constraints?.state_mutation !== 'forbidden' || authorGraph.constraints?.player_view_is_runtime_owned !== true) errors.push('compiled author graph weakens runtime ownership');
for (const annotation of authorGraph.annotations ?? []) if (!routeNodes.has(annotation.node_id)) errors.push(`author annotation outside route: ${annotation.node_id}`);
for (const hiddenField of ['world_state', 'pending_consequences', 'npc_plan_progress']) {
  if (JSON.stringify(authorGraph).includes(`"${hiddenField}"`)) errors.push(`compiled author graph leaks hidden field: ${hiddenField}`);
}

if (manifest.pressure_clock_contract?.source !== 'simulation/game_design/runtime/pressure_clock_contract.json') errors.push('pressure clock source drift');
if (manifest.pressure_clock_contract?.packaged_copy !== 'content/pressure-clock-contract.json') errors.push('pressure clock packaged copy drift');
if (pressureSource.initial?.contamination !== 38 || pressureSource.initial?.time_remaining !== 80) errors.push('pressure clock initial values drift');
if (pressureSource.thresholds?.collapse !== 95 || pressureSource.thresholds?.critical !== 80) errors.push('pressure clock thresholds drift');
for (const key of ['initial', 'thresholds', 'action_costs', 'npc_plan_states', 'hard_boundaries']) {
  if (JSON.stringify(pressureSource[key]) !== JSON.stringify(pressurePackage[key])) errors.push(`packaged pressure contract drift: ${key}`);
}
if (JSON.stringify(npcContract) !== JSON.stringify(npcPackage)) errors.push('packaged NPC visibility contract drift');
for (const item of Object.values(npcContract.visible_npcs ?? {})) {
  const sourceNpc = npcSource.find((npc) => npc.id === item.source_id);
  if (!sourceNpc) { errors.push(`missing NPC source ${item.source_id}`); continue; }
  for (const token of item.required_source_tokens ?? []) {
    const sourceText = JSON.stringify(sourceNpc);
    if (!sourceText.includes(token)) errors.push(`NPC source token missing ${item.source_id}: ${token}`);
  }
}
const allowedNpcStatuses = {
  xumeng: ['OUTER_SUPPORT', 'VERIFYING_SIGNAL', 'RATING_REVISED', 'CHANNEL_UNSTABLE', 'OFFLINE'],
  linlan: ['AVAILABLE', 'DATA_REQUIRED', 'CHANNEL_UNSTABLE', 'OFFLINE'],
};
for (const [npcId, contract] of Object.entries(npcContract.visible_npcs ?? {})) {
  for (const status of contract.visible_statuses ?? []) {
    if (!(allowedNpcStatuses[npcId] ?? []).includes(status)) errors.push(`unknown ${npcId} status ${status}`);
  }
}
for (const hidden of manifest.pressure_clock_contract?.hidden_plan_fields_forbidden ?? []) {
  if (!['pending_consequences', 'npc_plan_progress', 'world_state'].includes(hidden)) errors.push(`unknown hidden pressure field ${hidden}`);
}

if (runtimeRoles.length !== manifest.expected_counts.roles) errors.push(`runtime roles=${runtimeRoles.length}`);
if (Object.keys(CANON.locations).length !== manifest.expected_counts.locations) errors.push('location count drift');
if (Object.keys(CANON.items).length !== manifest.expected_counts.items) errors.push('item count drift');
if (CANON.choices.length !== manifest.expected_counts.choices) errors.push('choice count drift');
if (runtimeEventIds.length !== manifest.expected_counts.events) errors.push('event count drift');
if (runtimeResultIds.length !== manifest.expected_counts.event_results) errors.push('event result count drift');

for (const role of rolesSource) {
  const runtime = runtimeRoles.find((item) => item.id === role.role_id);
  if (!runtime) {
    errors.push(`missing runtime role ${role.role_id}`);
    continue;
  }
  if (runtime.name !== role.role_name) errors.push(`role name drift ${role.role_id}`);
  if (sorted(runtime.abilities).join('|') !== sorted(role.ability_profile.active_abilities).join('|')) errors.push(`role abilities drift ${role.role_id}`);
  if (sorted(runtime.knowledge).join('|') !== sorted(role.knowledge_state.known_facts).join('|')) errors.push(`role knowledge drift ${role.role_id}`);
  for (const field of manifest.ooc_contract.required_role_fields) {
    if (role[field] === undefined || role[field] === null) errors.push(`role ${role.role_id} missing OOC field ${field}`);
  }
  if (!role.personality_profile.hard_boundaries?.length) errors.push(`role ${role.role_id} has no hard boundaries`);
  if (!role.ability_profile.unavailable_abilities?.length) errors.push(`role ${role.role_id} has no unavailable abilities`);
}

const sourceChoiceIds = new Set(choiceSource.map((item) => item.choice_id));
for (const choice of choiceSource) {
  const runtime = runtimeChoiceById.get(choice.choice_id);
  if (!runtime) {
    errors.push(`missing runtime choice ${choice.choice_id}`);
    continue;
  }
  if (runtime.source_node !== choice.source_node) errors.push(`choice node drift ${choice.choice_id}`);
  const visibleRoles = Object.entries(choice.role_status).filter(([, status]) => status === 'VISIBLE').map(([id]) => id);
  if (sorted(runtime.roles).join('|') !== sorted(visibleRoles).join('|')) errors.push(`choice role gate drift ${choice.choice_id}`);
  if (!routeNodes.has(runtime.next_node)) errors.push(`choice ${choice.choice_id} points outside route graph: ${runtime.next_node}`);
}
for (const choiceId of runtimeChoiceById.keys()) if (!sourceChoiceIds.has(choiceId)) errors.push(`runtime has undocumented choice ${choiceId}`);

const sourceEventIds = new Set(eventSource.map((item) => item.event_id));
for (const event of eventSource) {
  const runtime = CANON.events[event.event_id];
  if (!runtime) {
    errors.push(`missing runtime event ${event.event_id}`);
    continue;
  }
  if (runtime.node !== event.story_node_id) errors.push(`event node drift ${event.event_id}`);
  const expectedRole = event.eligible_roles.length > 1 ? 'ANY_PLAYABLE' : event.eligible_roles[0];
  if (runtime.role !== expectedRole) errors.push(`event role drift ${event.event_id}`);
  const expectedResults = [...event.success_results, ...event.partial_results, ...event.failure_results];
  if (sorted(runtime.results).join('|') !== sorted(expectedResults).join('|')) errors.push(`event result gate drift ${event.event_id}`);
}
for (const eventId of runtimeEventIds) if (!sourceEventIds.has(eventId)) errors.push(`runtime has undocumented event ${eventId}`);

const sourceResultIds = new Set(resultSource.map((item) => item.result_id));
for (const resultId of sourceResultIds) if (!CANON.eventResults[resultId]) errors.push(`missing runtime event result ${resultId}`);
for (const resultId of runtimeResultIds) if (!sourceResultIds.has(resultId)) errors.push(`runtime has undocumented result ${resultId}`);
for (const sourceResult of resultSource) {
  const runtimeResult = CANON.eventResults[sourceResult.result_id];
  if (!runtimeResult) continue;
  if (sorted(runtimeResult.recovery_windows ?? []).join('|') !== sorted(sourceResult.recovery_windows ?? []).join('|')) errors.push(`recovery window drift ${sourceResult.result_id}`);
}

for (const node of routeNodes) if (!CANON.nodeScenes[node]) errors.push(`route node has no scene ${node}`);
const resourceByPath = new Map((resourceStatus.assets ?? []).map((asset) => [asset.path, asset]));
const manifestAssetPaths = manifest.asset_manifest.map((asset) => asset.startsWith('packages/dsh-feitu-world/') ? asset.slice('packages/dsh-feitu-world/'.length) : asset);
const requiredReleaseAssets = releaseManifest.required_assets ?? [];
for (const required of requiredReleaseAssets) {
  if (!existsSync(resolve(root, 'packages/dsh-feitu-world', required))) errors.push(`missing release asset ${required}`);
}
for (const asset of manifestAssetPaths) {
  if (asset.startsWith('ui/') && !requiredReleaseAssets.includes(asset)) errors.push(`content asset absent from release manifest: ${asset}`);
}
if (releaseManifest.product_shell !== 'DeepSeek Harness') errors.push('release product shell drift');
if (releaseManifest.runtime_contract !== manifest.runtime_contract) errors.push('release runtime contract drift');
if (releaseManifest.content_id !== manifest.content_id) errors.push('release content id drift');
for (const asset of manifest.asset_manifest) {
  if (!existsSync(resolve(root, asset))) {
    errors.push(`missing asset ${asset}`);
    continue;
  }
  const packageRelative = asset.startsWith('packages/dsh-feitu-world/') ? asset.slice('packages/dsh-feitu-world/'.length) : asset;
  const status = resourceByPath.get(packageRelative);
  if (!status) errors.push(`asset not registered in RESOURCE_GENERATION_STATUS: ${packageRelative}`);
  else if (status.status !== 'ready') errors.push(`asset is not ready: ${packageRelative} (${status.status})`);
}

const report = {
  status: errors.length ? 'FAIL' : 'PASS',
  content_id: manifest.content_id,
  content_version: manifest.content_version,
  source_counts: { roles: rolesSource.length, choices: choiceSource.length, events: eventSource.length, event_results: resultSource.length, route_nodes: routeSource.nodes.length, world_regions: worldSource.regions.length, world_dungeons: worldSource.dungeons.length, world_announced_dungeons: worldSource.announced_dungeons.length },
  runtime_counts: { roles: runtimeRoles.length, locations: Object.keys(CANON.locations).length, items: Object.keys(CANON.items).length, choices: CANON.choices.length, events: runtimeEventIds.length, event_results: runtimeResultIds.length, scenes: Object.keys(CANON.nodeScenes).length },
  ooc_contract_checked: true,
  source_gates_checked: true,
  pressure_clock_contract_checked: true,
  errors,
};
console.log(JSON.stringify(report, null, 2));
if (errors.length) process.exitCode = 1;
