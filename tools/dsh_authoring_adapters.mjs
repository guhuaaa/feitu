const FORBIDDEN = /(?:world_state|hidden_world_state|pending_consequences|npc_private_plan|state_mutation|inventory\s*=|ending\s*=)/i;
const nodeIdPattern = /^NODE_[A-Z0-9_]+$/;

const clean = (value) => value.replace(/^\s+|\s+$/g, '').replace(/^['"]|['"]$/g, '');
const fail = (message) => { throw new Error(`authoring adapter: ${message}`); };
const checkSafe = (text, lineNumber) => {
  if (FORBIDDEN.test(text)) fail(`forbidden runtime mutation token at line ${lineNumber}`);
};
const buildSource = ({ format, contentId, annotations }) => {
  if (!contentId || !/^[a-z0-9-]+$/.test(contentId)) fail('contentId must be package-safe');
  const dedupe = new Set();
  for (const annotation of annotations) {
    if (!nodeIdPattern.test(annotation.node_id)) fail(`invalid node id: ${annotation.node_id}`);
    if (dedupe.has(annotation.node_id)) fail(`duplicate annotation: ${annotation.node_id}`);
    dedupe.add(annotation.node_id);
    for (const field of ['title', 'author_intent', 'ooc_guard']) if (!annotation[field]) fail(`${annotation.node_id} missing ${field}`);
  }
  return {
    schema: 'feitu-author-source/v1',
    content_id: contentId,
    runtime_contract: 'feitu-world/v1',
    engine_compatibility: [format === 'ink' ? 'ink' : 'yarn-spinner'],
    authoring_rules: {
      state_mutation: 'forbidden',
      choices_must_reference_runtime: true,
      unknown_facts_remain_unknown: true,
      player_view_is_runtime_owned: true,
    },
    annotations,
    adapter: { format, contract: 'feitu-author-adapter/v1', prose_import: 'disabled' },
  };
};

export function parseInkSource(text, { contentId = 'one-line-last-train' } = {}) {
  const annotations = [];
  let current = null;
  const flush = () => { if (current) annotations.push(current); current = null; };
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (!line) return;
    checkSafe(line, index + 1);
    const knot = line.match(/^===\s*([A-Za-z0-9_]+)\s*===/);
    if (knot) {
      flush();
      current = { node_id: knot[1], title: '', author_intent: '', ooc_guard: '' };
      return;
    }
    if (!current) return;
    const tag = line.match(/^#\s*(title|author_intent|ooc_guard)\s*[:=]\s*(.+)$/i);
    if (tag) current[tag[1].toLowerCase()] = clean(tag[2]);
  });
  flush();
  if (!annotations.length) fail('Ink source contains no annotated knots');
  return buildSource({ format: 'ink', contentId, annotations });
}

export function parseYarnSource(text, { contentId = 'one-line-last-train' } = {}) {
  const annotations = [];
  let current = null;
  let inBody = false;
  const flush = () => { if (current) annotations.push(current); current = null; inBody = false; };
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (!line) return;
    checkSafe(line, index + 1);
    const title = line.match(/^title:\s*(.+)$/i);
    if (title && !current) {
      current = { node_id: clean(title[1]), title: '', author_intent: '', ooc_guard: '' };
      return;
    }
    if (line === '---') { if (!current) fail(`Yarn node body without title at line ${index + 1}`); inBody = true; return; }
    if (line === '===') { flush(); return; }
    if (current && !inBody) {
      const metadata = line.match(/^(title_text|author_intent|ooc_guard):\s*(.+)$/i);
      if (metadata) {
        const field = metadata[1].toLowerCase() === 'title_text' ? 'title' : metadata[1].toLowerCase();
        current[field] = clean(metadata[2]);
      }
    }
  });
  flush();
  if (!annotations.length) fail('Yarn source contains no annotated nodes');
  return buildSource({ format: 'yarn-spinner', contentId, annotations });
}

export function importAuthorSourceText(text, { format, contentId } = {}) {
  const resolved = format || 'ink';
  if (resolved === 'ink') return parseInkSource(text, { contentId });
  if (resolved === 'yarn' || resolved === 'yarn-spinner') return parseYarnSource(text, { contentId });
  fail(`unsupported format: ${resolved}`);
}
