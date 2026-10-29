import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AUTO_NEXT, CHOICES, EVENTS, EVENT_RESULTS, NODE_SCENES } from '../packages/dsh-feitu-world/lib/story.js';
import { importAuthorSourceText } from './dsh_authoring_adapters.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const inputPath = resolve(root, arg('--input', 'simulation/game_design/authoring/one-line-last-train.author.json'));
const outputPath = resolve(root, arg('--output', 'packages/dsh-feitu-world/content/author-graph.json'));
const checkOnly = process.argv.includes('--check');
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const repoRelative = (path) => relative(root, path).split('\\').join('/');
const inputExtension = extname(inputPath).toLowerCase();
const inputFormat = arg('--format', inputExtension === '.yarn' ? 'yarn' : inputExtension === '.ink' ? 'ink' : null);
const source = inputFormat
  ? importAuthorSourceText(readFileSync(inputPath, 'utf8'), { format: inputFormat, contentId: arg('--content-id', 'one-line-last-train') })
  : readJson(inputPath);
const route = readJson(resolve(root, 'simulation/game_design/runtime/playable_route_graph.json'));
const choicesSource = readJson(resolve(root, 'simulation/game_design/choice_system/choice_availability.json')).rules;
const eventsSource = readJson(resolve(root, 'simulation/game_design/interactive_events/interactive_events.json')).events;
const resultsSource = readJson(resolve(root, 'simulation/game_design/interactive_events/interactive_event_results.json')).results;

const fail = (message) => { throw new Error(`author graph: ${message}`); };
if (source.schema !== 'feitu-author-source/v1') fail('unsupported source schema');
if (source.content_id !== 'one-line-last-train') fail('content_id must match the frozen content package');
if (source.runtime_contract !== 'feitu-world/v1') fail('runtime_contract drift');
if (source.authoring_rules?.state_mutation !== 'forbidden') fail('authoring rules must forbid state mutation');
if (source.authoring_rules?.player_view_is_runtime_owned !== true) fail('Player View must remain runtime-owned');

const routeNodes = new Set(route.nodes);
const seenAnnotations = new Set();
for (const annotation of source.annotations ?? []) {
  if (!routeNodes.has(annotation.node_id)) fail(`annotation points outside route: ${annotation.node_id}`);
  if (seenAnnotations.has(annotation.node_id)) fail(`duplicate annotation: ${annotation.node_id}`);
  seenAnnotations.add(annotation.node_id);
  for (const field of ['title', 'author_intent', 'ooc_guard']) {
    if (!annotation[field]) fail(`annotation ${annotation.node_id} missing ${field}`);
  }
}

const choiceById = new Map(CHOICES.map((choice) => [choice.choice_id, choice]));
const requirementsById = new Map(choicesSource.map((choice) => [choice.choice_id, choice]));
const normalizedChoices = choicesSource.map((sourceChoice) => {
  const runtimeChoice = choiceById.get(sourceChoice.choice_id);
  if (!runtimeChoice) fail(`source choice missing from runtime: ${sourceChoice.choice_id}`);
  if (!routeNodes.has(runtimeChoice.source_node) || !routeNodes.has(runtimeChoice.next_node)) fail(`choice outside route: ${sourceChoice.choice_id}`);
  return {
    id: runtimeChoice.choice_id,
    source_node: runtimeChoice.source_node,
    next_node: runtimeChoice.next_node,
    roles: runtimeChoice.roles,
    label: runtimeChoice.label,
    visibility: sourceChoice.role_status,
    requirements: {
      knowledge: sourceChoice.knowledge_requirements,
      abilities: sourceChoice.ability_requirements,
      locations: sourceChoice.location_requirements,
      items: sourceChoice.item_requirements,
      time: sourceChoice.time_requirements,
      rules: sourceChoice.rule_requirements,
    },
  };
});
for (const choiceId of choiceById.keys()) if (!requirementsById.has(choiceId)) fail(`runtime choice undocumented: ${choiceId}`);

const normalizedEvents = eventsSource.map((event) => ({
  id: event.event_id,
  node: event.story_node_id,
  eligible_roles: event.eligible_roles,
  success_results: event.success_results,
  partial_results: event.partial_results,
  failure_results: event.failure_results,
}));
for (const event of normalizedEvents) {
  if (!EVENTS[event.id]) fail(`event missing from runtime: ${event.id}`);
  if (!routeNodes.has(event.node)) fail(`event outside route: ${event.id}`);
}
const normalizedResults = resultsSource.map((result) => {
  const runtimeResult = EVENT_RESULTS[result.result_id];
  if (!runtimeResult) fail(`event result missing from runtime: ${result.result_id}`);
  return {
    id: result.result_id,
    event_id: runtimeResult.event_id,
    node: runtimeResult.node,
    visible: runtimeResult.visible,
    recovery_windows: runtimeResult.recovery_windows ?? [],
  };
});

const autoEdges = Object.entries(AUTO_NEXT).map(([from, to]) => ({ from, to, via: 'AUTO' }));
const graph = {
  schema: 'feitu-author-graph/v1',
  content_id: source.content_id,
  runtime_contract: source.runtime_contract,
  source_engine_compatibility: source.engine_compatibility,
  generated_from: [
    repoRelative(inputPath),
    'simulation/game_design/runtime/playable_route_graph.json',
    'simulation/game_design/choice_system/choice_availability.json',
    'simulation/game_design/interactive_events/interactive_events.json',
    'simulation/game_design/interactive_events/interactive_event_results.json',
  ],
  constraints: source.authoring_rules,
  nodes: route.nodes.map((id) => ({ id, scene_id: NODE_SCENES[id] ?? null })),
  auto_edges: autoEdges,
  choices: normalizedChoices,
  events: normalizedEvents,
  event_results: normalizedResults,
  annotations: source.annotations ?? [],
};

const serialized = `${JSON.stringify(graph, null, 2)}\n`;
if (checkOnly) {
  if (!existsSync(outputPath)) fail(`compiled output missing: ${outputPath}`);
  const existing = readFileSync(outputPath, 'utf8');
  if (existing !== serialized) fail(`compiled output drift: ${outputPath}`);
  console.log(JSON.stringify({ status: 'PASS', output: outputPath, nodes: graph.nodes.length, choices: graph.choices.length, events: graph.events.length }, null, 2));
} else {
  writeFileSync(outputPath, serialized, 'utf8');
  console.log(JSON.stringify({ status: 'PASS', output: outputPath, nodes: graph.nodes.length, choices: graph.choices.length, events: graph.events.length }, null, 2));
}
