import type { GeneratedWorldModule } from "@/lib/game/types";

export type ValidationReport = {
  ok: boolean;
  issues: string[];
};

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

  for (const entryPoint of module.entryPoints) {
    for (const location of module.locations) {
      const hops = shortestHops(adjacency, entryPoint.startLocationId, location.id);
      if (!Number.isFinite(hops) || hops > 4) {
        issues.push(
          `Entry point ${entryPoint.id} cannot reach ${location.name} within four hops.`,
        );
        break;
      }
    }
  }

  return {
    ok: issues.length === 0,
    issues,
  };
}
