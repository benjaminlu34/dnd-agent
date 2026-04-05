import type {
  GeneratedEntryContexts,
  GeneratedKnowledgeEconomy,
  GeneratedRegionalLife,
  GeneratedSocialLayer,
  GeneratedWorldBible,
  GeneratedWorldModule,
  GeneratedWorldSpine,
  WorldScaleTier,
} from "@/lib/game/types";
import { WORLD_BIBLE_SCALE_MINIMUMS } from "@/lib/game/world-scale";

export type ValidationReport = {
  ok: boolean;
  issues: string[];
};

type WorldBibleValidationOptions = {
  minimumExplanationThreads?: number;
  scaleTier?: WorldScaleTier;
};

type WorldSpineValidationOptions = {
  scaleTier?: WorldScaleTier;
};

type SocialLayerValidationOptions = {
  scaleTier?: WorldScaleTier;
};

const FACTION_TEXT_STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "into",
  "of",
  "council",
  "order",
  "clan",
  "clans",
  "guild",
  "union",
  "company",
  "companies",
  "tribe",
  "tribes",
  "cult",
]);

const MAX_MINOR_LOCATIONS_PER_PARENT = 5;
const MIN_TOPOLOGY_TRAVEL_MINUTES = 5;

export function buildAdjacency(module: {
  locations: Array<{ id: string }>;
  edges: Array<{ sourceId: string; targetId: string }>;
}) {
  const adjacency = new Map<string, Set<string>>();

  for (const location of module.locations) {
    adjacency.set(location.id, new Set());
  }

  for (const edge of module.edges) {
    adjacency.get(edge.sourceId)?.add(edge.targetId);
    adjacency.get(edge.targetId)?.add(edge.sourceId);
  }

  return adjacency;
}

function buildAdjacencyFromSpine(spine: GeneratedWorldSpine) {
  const adjacency = new Map<string, Set<string>>();

  for (const location of spine.locations) {
    adjacency.set(location.key, new Set());
  }

  for (const edge of spine.edges) {
    adjacency.get(edge.sourceKey)?.add(edge.targetKey);
    adjacency.get(edge.targetKey)?.add(edge.sourceKey);
  }

  return adjacency;
}

function factionTextTokens(name: string) {
  const tokens = name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 4 && !FACTION_TEXT_STOPWORDS.has(token));

  return [...new Set(tokens.flatMap((token) => {
    const variants = new Set([token]);

    if (token.endsWith("ies")) {
      variants.add(`${token.slice(0, -3)}y`);
    }

    if (token.endsWith("s")) {
      variants.add(token.slice(0, -1));
    } else {
      variants.add(`${token}s`);
    }

    if (token.endsWith("ers")) {
      variants.add(token.slice(0, -1));
      variants.add(token.replace(/ers$/, "er"));
    }

    return [...variants].filter((variant) => variant.length >= 4);
  }))];
}

function hasTextualFactionFootprint(module: GeneratedWorldModule, factionName: string) {
  const tokens = factionTextTokens(factionName);

  if (tokens.length === 0) {
    return false;
  }

  const haystacks = [
    ...module.locations.map((location) => `${location.name} ${location.summary} ${location.description}`),
    ...module.npcs.map((npc) => `${npc.name} ${npc.role} ${npc.summary} ${npc.description}`),
    ...module.information.map((information) => `${information.title} ${information.summary} ${information.content}`),
  ].map((text) => text.toLowerCase());

  return haystacks.some((haystack) => {
    const matchedTokens = tokens.filter((token) => haystack.includes(token));
    return matchedTokens.length >= 2 || matchedTokens.some((token) => token.length >= 9);
  });
}

function hasTextualEconomicIdentity(location: GeneratedWorldModule["locations"][number]) {
  const haystack = `${location.summary} ${location.description}`.toLowerCase();

  return (
    haystack.includes("trade identity:") ||
    haystack.includes("street economy:") ||
    haystack.includes("no settled signature goods")
  );
}

function hasSomeExternallyReachableKnowledge(
  information: Array<{ accessibility: "public" | "guarded" | "secret" }>,
) {
  return information.some((entry) => entry.accessibility !== "secret");
}

export function validateWorldBible(
  bible: GeneratedWorldBible,
  options: WorldBibleValidationOptions = {},
): ValidationReport {
  const issues: string[] = [];
  const minimumExplanationThreads = options.minimumExplanationThreads ?? 0;
  const scaleTier = options.scaleTier ?? "regional";
  const minimums = WORLD_BIBLE_SCALE_MINIMUMS[scaleTier];

  if (bible.explanationThreads.length < minimumExplanationThreads) {
    issues.push(
      `World bible needs at least ${minimumExplanationThreads} competing explanation threads.`,
    );
  }

  if (bible.everydayLife.institutions.length < 4) {
    issues.push("World bible must describe at least four institutions that shape everyday life.");
  }

  if (bible.widespreadBurdens.length < minimums.burdens) {
    issues.push(`World bible must define at least ${minimums.burdens} widespread burdens for ${scaleTier} scale.`);
  }

  if (bible.presentScars.length < minimums.scars) {
    issues.push(`World bible should include at least ${minimums.scars} present scars for ${scaleTier} scale.`);
  }

  if (bible.sharedRealities.length < minimums.sharedRealities) {
    issues.push(`World bible should include at least ${minimums.sharedRealities} shared realities for ${scaleTier} scale.`);
  }

  if (bible.everydayLife.trade.length < 3 || bible.everydayLife.gossip.length < 3) {
    issues.push("World bible should show at least three concrete trade and gossip signals.");
  }

  return {
    ok: issues.length === 0,
    issues,
  };
}

export function validateWorldSpine(
  spine: GeneratedWorldSpine,
  _options: WorldSpineValidationOptions = {},
): ValidationReport {
  const issues: string[] = [];
  const adjacency = buildAdjacencyFromSpine(spine);
  const factionKeys = new Set(spine.factions.map((faction) => faction.key));
  const locationKeys = new Set(spine.locations.map((location) => location.key));

  for (const location of spine.locations) {
    if (
      location.controlStatus === "controlled" &&
      !location.controllingFactionKey
    ) {
      issues.push(`Location ${location.name} must name a controlling faction.`);
    }

    if (
      location.controllingFactionKey &&
      !factionKeys.has(location.controllingFactionKey)
    ) {
      issues.push(`Location ${location.name} references an unknown faction.`);
    }

    if (
      !location.controllingFactionKey &&
      !["contested", "independent"].includes(location.controlStatus)
    ) {
      issues.push(`Location ${location.name} must be controlled, contested, or independent.`);
    }
  }

  for (const edge of spine.edges) {
    if (!locationKeys.has(edge.sourceKey) || !locationKeys.has(edge.targetKey)) {
      issues.push(`Route ${edge.key} references an unknown location.`);
    }

    if (edge.travelTimeMinutes < MIN_TOPOLOGY_TRAVEL_MINUTES) {
      issues.push(
        `Route ${edge.key} takes only ${edge.travelTimeMinutes} minute(s). Intra-location movement should stay narrative instead of becoming topology.`,
      );
    }
  }

  for (const relation of spine.factionRelations) {
    if (!factionKeys.has(relation.factionAKey) || !factionKeys.has(relation.factionBKey)) {
      issues.push(`Faction relation ${relation.key} references an unknown faction.`);
    }
  }

  if (spine.locations.length > 0) {
    const start = spine.locations[0]?.key;
    const visited = new Set<string>();
    const queue = start ? [start] : [];

    while (queue.length) {
      const current = queue.shift();
      if (!current || visited.has(current)) {
        continue;
      }

      visited.add(current);
      for (const neighbor of adjacency.get(current) ?? []) {
        if (!visited.has(neighbor)) {
          queue.push(neighbor);
        }
      }
    }

    if (visited.size !== spine.locations.length) {
      issues.push("Location graph is disconnected.");
    }
  }

  return {
    ok: issues.length === 0,
    issues,
  };
}

export function validateRegionalLife(
  regionalLife: GeneratedRegionalLife,
  expectedLocationIds: string[],
): ValidationReport {
  const issues: string[] = [];
  const counts = new Map<string, number>();

  for (const location of regionalLife.locations) {
    counts.set(location.locationId, (counts.get(location.locationId) ?? 0) + 1);
  }

  if (regionalLife.locations.length !== expectedLocationIds.length) {
    issues.push(
      `Regional life should contain exactly ${expectedLocationIds.length} locations, received ${regionalLife.locations.length}.`,
    );
  }

  for (const locationId of expectedLocationIds) {
    if (!counts.has(locationId)) {
      issues.push(`Regional life is missing location ${locationId}.`);
    }
  }

  for (const [locationId, count] of counts.entries()) {
    if (count > 1) {
      issues.push(`Regional life duplicates location ${locationId}.`);
    }
  }

  for (const location of regionalLife.locations) {
    if (!expectedLocationIds.includes(location.locationId)) {
      issues.push(`Regional life references unknown location ${location.locationId}.`);
    }

    if (!location.publicActivity || !location.localPressure || !location.everydayTexture) {
      issues.push(`Regional life for ${location.locationId} feels like an empty postcard.`);
    }
  }

  return {
    ok: issues.length === 0,
    issues,
  };
}

export function validateSocialLayer(
  socialLayer: GeneratedSocialLayer,
  expectedLocationIds: string[],
  _options: SocialLayerValidationOptions = {},
): ValidationReport {
  const issues: string[] = [];
  const npcConcentration = new Map<string, number>();
  const seenNames = new Map<string, string>();
  const seenFirstNames = new Map<string, string>();

  for (const npc of socialLayer.npcs) {
    if (!expectedLocationIds.includes(npc.currentLocationId)) {
      issues.push(`NPC ${npc.id} references an unknown currentLocationId.`);
    }

    if (!npc.summary || !npc.description) {
      issues.push(`NPC ${npc.id} is missing social grounding.`);
    }

    const normalizedName = npc.name.trim().toLowerCase();
    const firstSeenId = seenNames.get(normalizedName);
    if (firstSeenId) {
      issues.push(`NPC names must be unique; ${npc.name} is duplicated by ${firstSeenId} and ${npc.id}.`);
    } else if (normalizedName) {
      seenNames.set(normalizedName, npc.id);
    }

    const normalizedFirstName = npc.name.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
    const firstSeenFirstNameId = seenFirstNames.get(normalizedFirstName);
    if (firstSeenFirstNameId) {
      issues.push(
        `NPC first names must be unique; ${npc.name} repeats the first name used by ${firstSeenFirstNameId} and ${npc.id}.`,
      );
    } else if (normalizedFirstName) {
      seenFirstNames.set(normalizedFirstName, npc.id);
    }

    npcConcentration.set(
      npc.currentLocationId,
      (npcConcentration.get(npc.currentLocationId) ?? 0) + 1,
    );
  }

  for (const locationId of expectedLocationIds) {
    if (!npcConcentration.has(locationId)) {
      issues.push(`Social layer is missing an anchored NPC for location ${locationId}.`);
    }
  }

  const maxNpcShare =
    socialLayer.npcs.length === 0
      ? 0
      : Math.max(...npcConcentration.values()) / Math.max(socialLayer.npcs.length, 1);

  if (maxNpcShare > 0.5) {
    issues.push("No single location should dominate the socially important NPC population.");
  }

  return {
    ok: issues.length === 0,
    issues,
  };
}

export function validateKnowledgeEconomy(
  knowledgeEconomy: GeneratedKnowledgeEconomy,
  expectedLocationIds: string[],
): ValidationReport {
  const issues: string[] = [];

  for (const identity of knowledgeEconomy.locationTradeIdentity) {
    if (!expectedLocationIds.includes(identity.locationId)) {
      issues.push(`Location trade identity references unknown location ${identity.locationId}.`);
    }
  }

  if (
    knowledgeEconomy.information.length > 0
    && !hasSomeExternallyReachableKnowledge(knowledgeEconomy.information)
  ) {
    issues.push("Knowledge economy should expose at least some non-secret knowledge surfaces.");
  }

  return {
    ok: issues.length === 0,
    issues,
  };
}

export function validateEntryContexts(
  entryContexts: GeneratedEntryContexts,
  module: GeneratedWorldModule,
): ValidationReport {
  const issues: string[] = [];
  const adjacency = buildAdjacency(module);
  const npcIds = new Set(module.npcs.map((npc) => npc.id));
  const informationIds = new Set(module.information.map((information) => information.id));

  for (const entryPoint of entryContexts.entryPoints) {
    if (!npcIds.has(entryPoint.localContactNpcId)) {
      issues.push(`Entry point ${entryPoint.id} references an unknown local contact NPC.`);
    }

    if (!entryPoint.presentNpcIds.includes(entryPoint.localContactNpcId)) {
      issues.push(`Entry point ${entryPoint.id} should include its local contact among present NPCs.`);
    }

    if (!entryPoint.immediatePressure || !entryPoint.publicLead || !entryPoint.mundaneActionPath) {
      issues.push(`Entry point ${entryPoint.id} lacks pressure, lead, or mundane action path.`);
    }

    for (const informationId of entryPoint.initialInformationIds) {
      if (!informationIds.has(informationId)) {
        issues.push(`Entry point ${entryPoint.id} references unknown information ${informationId}.`);
      }
    }
  }

  const minimumNearbyLocations = minimumEntryRadius(module.locations.length);

  for (const entryPoint of entryContexts.entryPoints) {
    const nearbyReach = countLocationsWithinHops(adjacency, entryPoint.startLocationId, 4);
    if (nearbyReach < minimumNearbyLocations) {
      issues.push(
        `Entry point ${entryPoint.id} should reach at least ${minimumNearbyLocations} locations within four hops, but only reaches ${nearbyReach}.`,
      );
    }
  }

  return {
    ok: issues.length === 0,
    issues,
  };
}

export function validateWorldModuleCoherence(module: GeneratedWorldModule): ValidationReport {
  const issues: string[] = [];
  const locationIds = new Set(module.locations.map((location) => location.id));
  const factionIds = new Set(module.factions.map((faction) => faction.id));
  const npcIds = new Set(module.npcs.map((npc) => npc.id));
  const informationIds = new Set(module.information.map((information) => information.id));
  const edgeIds = new Set(module.edges.map((edge) => edge.id));
  const adjacency = buildAdjacency(module);
  const locationNames = new Map(module.locations.map((location) => [location.id, location.name]));
  const minorChildrenByParent = new Map<string, number>();

  for (const edge of module.edges) {
    if (!locationIds.has(edge.sourceId) || !locationIds.has(edge.targetId)) {
      issues.push(`Edge ${edge.id} references an unknown location.`);
    }

    if (edge.travelTimeMinutes < MIN_TOPOLOGY_TRAVEL_MINUTES) {
      issues.push(
        `Edge ${edge.id} takes only ${edge.travelTimeMinutes} minute(s). Intra-location movement should stay narrative instead of becoming topology.`,
      );
    }
  }

  for (const location of module.locations) {
    if (location.locationKind === "minor") {
      if (!location.parentLocationId) {
        issues.push(`Minor location ${location.name} is missing a parent location.`);
      }

      if (!location.justificationForNode?.trim()) {
        issues.push(`Minor location ${location.name} is missing justificationForNode.`);
      }

      if (location.parentLocationId) {
        minorChildrenByParent.set(
          location.parentLocationId,
          (minorChildrenByParent.get(location.parentLocationId) ?? 0) + 1,
        );
      }
    }
  }

  for (const [parentLocationId, childCount] of minorChildrenByParent.entries()) {
    if (childCount > MAX_MINOR_LOCATIONS_PER_PARENT) {
      issues.push(
        `Location ${locationNames.get(parentLocationId) ?? parentLocationId} has ${childCount} minor locations attached. Consolidate micro-places into world objects or scene focus instead of topology.`,
      );
    }
  }

  for (const relation of module.factionRelations) {
    if (!factionIds.has(relation.factionAId) || !factionIds.has(relation.factionBId)) {
      issues.push(`Faction relation ${relation.id} references an unknown faction.`);
    }
  }

  for (const npc of module.npcs) {
    if (!locationIds.has(npc.currentLocationId)) {
      issues.push(`NPC ${npc.id} references an unknown currentLocationId.`);
    }

    if (npc.factionId && !factionIds.has(npc.factionId)) {
      issues.push(`NPC ${npc.id} references an unknown faction.`);
    }
  }

  for (const information of module.information) {
    if (information.locationId && !locationIds.has(information.locationId)) {
      issues.push(`Information ${information.id} references an unknown location.`);
    }

    if (information.factionId && !factionIds.has(information.factionId)) {
      issues.push(`Information ${information.id} references an unknown faction.`);
    }

    if (information.sourceNpcId && !npcIds.has(information.sourceNpcId)) {
      issues.push(`Information ${information.id} references an unknown source NPC.`);
    }

    for (const edgeId of information.revealsEdgeIds ?? []) {
      if (!edgeIds.has(edgeId)) {
        issues.push(`Information ${information.id} reveals unknown edge ${edgeId}.`);
      }
    }

    for (const locationId of information.revealsLocationIds ?? []) {
      if (!locationIds.has(locationId)) {
        issues.push(`Information ${information.id} reveals unknown location ${locationId}.`);
      }
    }
  }

  for (const price of module.marketPrices) {
    if (!locationIds.has(price.locationId)) {
      issues.push(`Market price ${price.id} references an unknown location.`);
    }

    if (!module.commodities.some((commodity) => commodity.id === price.commodityId)) {
      issues.push(`Market price ${price.id} references an unknown commodity.`);
    }

    if (price.vendorNpcId && !npcIds.has(price.vendorNpcId)) {
      issues.push(`Market price ${price.id} references an unknown vendor NPC.`);
    }

    if (price.factionId && !factionIds.has(price.factionId)) {
      issues.push(`Market price ${price.id} references an unknown faction.`);
    }
  }

  for (const link of module.informationLinks) {
    if (!informationIds.has(link.sourceId) || !informationIds.has(link.targetId)) {
      issues.push(`Information link ${link.id} references an unknown information node.`);
    }
  }

  for (const entryPoint of module.entryPoints) {
    if (!locationIds.has(entryPoint.startLocationId)) {
      issues.push(`Entry point ${entryPoint.id} references an unknown start location.`);
    }

    const startLocation = module.locations.find((location) => location.id === entryPoint.startLocationId);
    if (startLocation?.discoveryState === "ambient") {
      issues.push(`Entry point ${entryPoint.id} starts at an ambient-only location.`);
    }
  }

  if (module.locations.length > 0) {
    const start = module.locations[0]?.id;
    const visited = new Set<string>();
    const queue = start ? [start] : [];

    while (queue.length) {
      const current = queue.shift();
      if (!current || visited.has(current)) {
        continue;
      }

      visited.add(current);
      for (const neighbor of adjacency.get(current) ?? []) {
        if (!visited.has(neighbor)) {
          queue.push(neighbor);
        }
      }
    }

    if (visited.size !== module.locations.length) {
      issues.push("Location graph is disconnected.");
    }
  }

  return {
    ok: issues.length === 0,
    issues,
  };
}

export function countLocationsWithinHops(
  adjacency: Map<string, Set<string>>,
  startLocationId: string,
  maxHops: number,
) {
  const visited = new Set<string>([startLocationId]);
  const queue: Array<{ id: string; depth: number }> = [{ id: startLocationId, depth: 0 }];

  while (queue.length) {
    const current = queue.shift();
    if (!current) {
      continue;
    }

    if (current.depth >= maxHops) {
      continue;
    }

    for (const neighbor of adjacency.get(current.id) ?? []) {
      if (visited.has(neighbor)) {
        continue;
      }
      visited.add(neighbor);
      queue.push({ id: neighbor, depth: current.depth + 1 });
    }
  }

  return visited.size;
}

export function minimumEntryRadius(totalLocations: number) {
  return Math.min(totalLocations, Math.max(4, Math.ceil(totalLocations * 0.4)));
}

export function validateWorldModulePlayability(module: GeneratedWorldModule): ValidationReport {
  const issues: string[] = [];
  const adjacency = buildAdjacency(module);

  if (module.information.length > 0 && !hasSomeExternallyReachableKnowledge(module.information)) {
    issues.push("The world should expose at least some non-secret knowledge surfaces.");
  }

  const npcConcentration = new Map<string, number>();
  for (const npc of module.npcs) {
    npcConcentration.set(
      npc.currentLocationId,
      (npcConcentration.get(npc.currentLocationId) ?? 0) + 1,
    );
  }

  const maxNpcShare =
    module.npcs.length === 0
      ? 0
      : Math.max(...npcConcentration.values()) / Math.max(module.npcs.length, 1);

  if (maxNpcShare > 0.4) {
    issues.push("No single location should contain more than 40% of the NPC population.");
  }

  const hasPotentialAlly = module.factionRelations.some((relation) => relation.stance !== "war");
  if (!hasPotentialAlly) {
    issues.push("At least one non-war faction relationship should exist.");
  }

  const minimumNearbyLocations = minimumEntryRadius(module.locations.length);

  for (const entryPoint of module.entryPoints) {
    const nearbyReach = countLocationsWithinHops(adjacency, entryPoint.startLocationId, 4);
    if (nearbyReach < minimumNearbyLocations) {
      issues.push(
        `Entry point ${entryPoint.id} should reach at least ${minimumNearbyLocations} locations within four hops, but only reaches ${nearbyReach}.`,
      );
    }
  }

  return {
    ok: issues.length === 0,
    issues,
  };
}

export function validateFactionFootprints(module: GeneratedWorldModule): ValidationReport {
  const issues: string[] = [];

  for (const faction of module.factions) {
    const visibleFootprint =
      module.locations.some((location) => location.controllingFactionId === faction.id) ||
      module.npcs.some((npc) => npc.factionId === faction.id) ||
      module.information.some((information) => information.factionId === faction.id) ||
      hasTextualFactionFootprint(module, faction.name);

    if (!visibleFootprint) {
      issues.push(`Faction ${faction.name} needs a visible mark on the world.`);
    }
  }

  return {
    ok: issues.length === 0,
    issues,
  };
}

export function validateWorldModuleImmersion(module: GeneratedWorldModule): ValidationReport {
  const issues: string[] = [];

  for (const location of module.locations) {
    const hasNpc = module.npcs.some((npc) => npc.currentLocationId === location.id);
    const hasInformation = module.information.some((information) => information.locationId === location.id);
    const hasEconomy =
      module.marketPrices.some((price) => price.locationId === location.id) ||
      hasTextualEconomicIdentity(location);
    const hasFactionFootprint =
      location.controllingFactionId != null ||
      module.npcs.some((npc) => npc.currentLocationId === location.id && npc.factionId != null);

    if (!hasNpc || !hasInformation) {
      issues.push(`Location ${location.name} needs visible people and discoverable knowledge.`);
    }

    if (!hasEconomy && location.type !== "wilderness") {
      issues.push(`Location ${location.name} needs an economic identity or a deliberate lack of one.`);
    }

    if (!hasFactionFootprint) {
      issues.push(`Location ${location.name} should show a faction footprint or deliberate independence.`);
    }
  }

  issues.push(...validateFactionFootprints(module).issues);

  return {
    ok: issues.length === 0,
    issues,
  };
}
