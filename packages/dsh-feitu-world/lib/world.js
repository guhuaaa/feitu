import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
export const WORLD_REGISTRY = require('../content/world-registry.json');
const EXTENSION_CONTRACT = require('../content/world-extension-contract.json');

export function publicWorldView() {
  return {
    schema: 'feitu-world/world-view/v1',
    world: { id: WORLD_REGISTRY.world_id, name: WORLD_REGISTRY.name },
    regions: WORLD_REGISTRY.regions.map(({ id, name, status, hub_location }) => ({ id, name, status, hubLocation: hub_location })),
    dungeons: WORLD_REGISTRY.dungeons.map(({ id, name, region_id, status, entry_node }) => ({ id, name, regionId: region_id, status, entryNode: entry_node })),
    announcedDungeons: (WORLD_REGISTRY.announced_dungeons ?? []).map(({ id, name, status, playable, chapter_range, task_type }) => ({ id, name, status, playable, chapterRange: chapter_range, taskType: task_type })),
    extensionContract: {
      schema: EXTENSION_CONTRACT.schema,
      version: EXTENSION_CONTRACT.contract_version,
      sourceRefRequired: EXTENSION_CONTRACT.governance.source_ref_required,
      playableRequiresContentManifestAudit: EXTENSION_CONTRACT.governance.playable_requires_content_manifest_audit,
    },
    expansionPolicy: {
      newDungeonRequires: [...WORLD_REGISTRY.expansion_policy.new_dungeon_requires],
      unknownRegionsAreNotPlayerVisible: WORLD_REGISTRY.expansion_policy.unknown_regions_are_not_player_visible,
      runtimeOwnsWorldState: WORLD_REGISTRY.expansion_policy.runtime_owns_world_state,
      announcedDungeonsAreCatalogOnly: WORLD_REGISTRY.expansion_policy.announced_dungeons_are_catalog_only,
      playableDungeonRequiresContentManifest: WORLD_REGISTRY.expansion_policy.playable_dungeon_requires_content_manifest,
    },
  };
}
