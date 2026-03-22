import type {
  GeneratedEntryContexts,
  GeneratedKnowledgeEconomy,
  GeneratedRegionalLife,
  GeneratedSocialLayer,
  GeneratedWorldBible,
  GeneratedWorldModule,
  GeneratedWorldSpine,
} from "@/lib/game/types";

export type ValidationReport = {
  ok: boolean;
  issues: string[];
};

type WorldBibleValidationOptions = {
  minimumExplanationThreads?: number;
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

function buildAdjacency(module: GeneratedWorldModule) {
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

export function validateWorldBible(
  bible: GeneratedWorldBible,
  options: WorldBibleValidationOptions = {},
): ValidationReport {
  const issues: string[] = [];
  const minimumExplanationThreads = options.minimumExplanationThreads ?? 2;

  if (bible.explanationThreads.length < minimumExplanationThreads) {
    issues.push(
      `World bible needs at least ${minimumExplanationThreads} competing explanation threads.`,
    );
  }

  if (bible.everydayLife.institutions.length < 4) {
    issues.push("World bible must describe at least four institutions that shape everyday life.");
  }

  if (bible.systemicPressures.length < 5) {
    issues.push("World bible must define at least five systemic pressures.");
  }

  if (bible.historicalFractures.length < 5) {
    issues.push("World bible should include at least five historical fractures.");
  }

  if (bible.immersionAnchors.length < 6) {
    issues.push("World bible should include at least six immersion anchors.");
  }

  if (bible.everydayLife.trade.length < 3 || bible.everydayLife.gossip.length < 3) {
    issues.push("World bible should show at least three concrete trade and gossip signals.");
  }

  return {
    ok: issues.length === 0,
    issues,
  };
}

export function validateWorldSpine(spine: GeneratedWorldSpine): ValidationReport {
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

  const accessibleInfoRatio =
    knowledgeEconomy.information.length === 0
      ? 1
      : knowledgeEconomy.information.filter((information) => information.accessibility === "public").length /
        knowledgeEconomy.information.length;

  if (accessibleInfoRatio < 0.3) {
    issues.push("At least 30% of information should be publicly accessible.");
  }

  for (const identity of knowledgeEconomy.locationTradeIdentity) {
    if (!expectedLocationIds.includes(identity.locationId)) {
      issues.push(`Location trade identity references unknown location ${identity.locationId}.`);
    }
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
  const adjacency = buildAdjacency(module);

  for (const edge of module.edges) {
    if (!locationIds.has(edge.sourceId) || !locationIds.has(edge.targetId)) {
      issues.push(`Edge ${edge.id} references an unknown location.`);
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

function shortestHops(adjacency: Map<string, Set<string>>, from: string, to: string) {
  if (from === to) {
    return 0;
  }

  const visited = new Set<string>([from]);
  const queue: Array<{ id: string; depth: number }> = [{ id: from, depth: 0 }];

  while (queue.length) {
    const current = queue.shift();
    if (!current) {
      continue;
    }

    for (const neighbor of adjacency.get(current.id) ?? []) {
      if (neighbor === to) {
        return current.depth + 1;
      }

      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push({ id: neighbor, depth: current.depth + 1 });
      }
    }
  }

  return Number.POSITIVE_INFINITY;
}

function countLocationsWithinHops(
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

function minimumEntryRadius(totalLocations: number) {
  return Math.min(totalLocations, Math.max(4, Math.ceil(totalLocations * 0.4)));
}

export function validateWorldModulePlayability(module: GeneratedWorldModule): ValidationReport {
  const issues: string[] = [];
  const adjacency = buildAdjacency(module);

  const accessibleInfoRatio =
    module.information.length === 0
      ? 1
      : module.information.filter((information) => information.accessibility === "public").length /
        module.information.length;

  if (accessibleInfoRatio < 0.3) {
    issues.push("At least 30% of information should be publicly accessible.");
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

export function validateWorldModuleImmersion(module: GeneratedWorldModule): ValidationReport {
  const issues: string[] = [];

  for (const location of module.locations) {
    const hasNpc = module.npcs.some((npc) => npc.currentLocationId === location.id);
    const hasInformation = module.information.some((information) => information.locationId === location.id);
    const hasEconomy = module.marketPrices.some((price) => price.locationId === location.id);
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
