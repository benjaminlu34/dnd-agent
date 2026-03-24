import type {
  GeneratedCommodity,
  GeneratedFaction,
  GeneratedFactionRelation,
  GeneratedInformation,
  GeneratedInformationLink,
  GeneratedLocationEdge,
  GeneratedLocationNode,
  GeneratedMarketPrice,
  GeneratedNpc,
  GeneratedWorldModule,
  ResolvedLaunchEntry,
} from "@/lib/game/types";

type InstancedWorld = {
  world: GeneratedWorldModule;
  entryPoint: ResolvedLaunchEntry;
};

function scopedId(campaignId: string, entityType: string, id: string) {
  return `${campaignId}:${entityType}:${id}`;
}

function buildIdMap(items: Array<{ id: string }>, campaignId: string, entityType: string) {
  return new Map(items.map((item) => [item.id, scopedId(campaignId, entityType, item.id)]));
}

function remapFaction(
  faction: GeneratedFaction,
  factionIds: Map<string, string>,
): GeneratedFaction {
  return {
    ...faction,
    id: factionIds.get(faction.id) ?? faction.id,
  };
}

function remapLocation(
  location: GeneratedLocationNode,
  locationIds: Map<string, string>,
  factionIds: Map<string, string>,
): GeneratedLocationNode {
  return {
    ...location,
    id: locationIds.get(location.id) ?? location.id,
    controllingFactionId: location.controllingFactionId
      ? (factionIds.get(location.controllingFactionId) ?? location.controllingFactionId)
      : null,
  };
}

function remapEdge(
  edge: GeneratedLocationEdge,
  edgeIds: Map<string, string>,
  locationIds: Map<string, string>,
): GeneratedLocationEdge {
  return {
    ...edge,
    id: edgeIds.get(edge.id) ?? edge.id,
    sourceId: locationIds.get(edge.sourceId) ?? edge.sourceId,
    targetId: locationIds.get(edge.targetId) ?? edge.targetId,
  };
}

function remapRelation(
  relation: GeneratedFactionRelation,
  relationIds: Map<string, string>,
  factionIds: Map<string, string>,
): GeneratedFactionRelation {
  return {
    ...relation,
    id: relationIds.get(relation.id) ?? relation.id,
    factionAId: factionIds.get(relation.factionAId) ?? relation.factionAId,
    factionBId: factionIds.get(relation.factionBId) ?? relation.factionBId,
  };
}

function remapNpc(
  npc: GeneratedNpc,
  npcIds: Map<string, string>,
  factionIds: Map<string, string>,
  locationIds: Map<string, string>,
): GeneratedNpc {
  return {
    ...npc,
    id: npcIds.get(npc.id) ?? npc.id,
    factionId: npc.factionId ? (factionIds.get(npc.factionId) ?? npc.factionId) : null,
    currentLocationId: locationIds.get(npc.currentLocationId) ?? npc.currentLocationId,
  };
}

function remapInformation(
  information: GeneratedInformation,
  informationIds: Map<string, string>,
  factionIds: Map<string, string>,
  locationIds: Map<string, string>,
  npcIds: Map<string, string>,
): GeneratedInformation {
  return {
    ...information,
    id: informationIds.get(information.id) ?? information.id,
    locationId: information.locationId
      ? (locationIds.get(information.locationId) ?? information.locationId)
      : null,
    factionId: information.factionId ? (factionIds.get(information.factionId) ?? information.factionId) : null,
    sourceNpcId: information.sourceNpcId
      ? (npcIds.get(information.sourceNpcId) ?? information.sourceNpcId)
      : null,
  };
}

function remapInformationLink(
  link: GeneratedInformationLink,
  linkIds: Map<string, string>,
  informationIds: Map<string, string>,
): GeneratedInformationLink {
  return {
    ...link,
    id: linkIds.get(link.id) ?? link.id,
    sourceId: informationIds.get(link.sourceId) ?? link.sourceId,
    targetId: informationIds.get(link.targetId) ?? link.targetId,
  };
}

function remapCommodity(
  commodity: GeneratedCommodity,
  commodityIds: Map<string, string>,
): GeneratedCommodity {
  return {
    ...commodity,
    id: commodityIds.get(commodity.id) ?? commodity.id,
  };
}

function remapMarketPrice(
  price: GeneratedMarketPrice,
  marketPriceIds: Map<string, string>,
  commodityIds: Map<string, string>,
  locationIds: Map<string, string>,
  npcIds: Map<string, string>,
  factionIds: Map<string, string>,
): GeneratedMarketPrice {
  return {
    ...price,
    id: marketPriceIds.get(price.id) ?? price.id,
    commodityId: commodityIds.get(price.commodityId) ?? price.commodityId,
    locationId: locationIds.get(price.locationId) ?? price.locationId,
    vendorNpcId: price.vendorNpcId ? (npcIds.get(price.vendorNpcId) ?? price.vendorNpcId) : null,
    factionId: price.factionId ? (factionIds.get(price.factionId) ?? price.factionId) : null,
  };
}

export function instanceWorldForCampaign(
  campaignId: string,
  world: GeneratedWorldModule,
  entryPoint: ResolvedLaunchEntry,
): InstancedWorld {
  const factionIds = buildIdMap(world.factions, campaignId, "faction");
  const locationIds = buildIdMap(world.locations, campaignId, "location");
  const edgeIds = buildIdMap(world.edges, campaignId, "edge");
  const relationIds = buildIdMap(world.factionRelations, campaignId, "faction-relation");
  const npcIds = buildIdMap(world.npcs, campaignId, "npc");
  const informationIds = buildIdMap(world.information, campaignId, "information");
  const informationLinkIds = buildIdMap(world.informationLinks, campaignId, "information-link");
  const commodityIds = buildIdMap(world.commodities, campaignId, "commodity");
  const marketPriceIds = buildIdMap(world.marketPrices, campaignId, "market-price");

  const instancedEntryPoints = world.entryPoints.map((entry) => ({
    ...entry,
    startLocationId: locationIds.get(entry.startLocationId) ?? entry.startLocationId,
    presentNpcIds: entry.presentNpcIds.map((id) => npcIds.get(id) ?? id),
    initialInformationIds: entry.initialInformationIds.map(
      (id) => informationIds.get(id) ?? id,
    ),
  }));
  const instancedEntryPoint: ResolvedLaunchEntry = {
    ...entryPoint,
    startLocationId: locationIds.get(entryPoint.startLocationId) ?? entryPoint.startLocationId,
    presentNpcIds: entryPoint.presentNpcIds.map((id) => npcIds.get(id) ?? id),
    initialInformationIds: entryPoint.initialInformationIds.map(
      (id) => informationIds.get(id) ?? id,
    ),
    localContactNpcId: entryPoint.localContactNpcId
      ? (npcIds.get(entryPoint.localContactNpcId) ?? entryPoint.localContactNpcId)
      : null,
  };

  if (entryPoint.isCustom) {
    instancedEntryPoints.push(instancedEntryPoint);
  }

  return {
    world: {
      ...world,
      factions: world.factions.map((faction) => remapFaction(faction, factionIds)),
      locations: world.locations.map((location) => remapLocation(location, locationIds, factionIds)),
      edges: world.edges.map((edge) => remapEdge(edge, edgeIds, locationIds)),
      factionRelations: world.factionRelations.map((relation) =>
        remapRelation(relation, relationIds, factionIds),
      ),
      npcs: world.npcs.map((npc) => remapNpc(npc, npcIds, factionIds, locationIds)),
      information: world.information.map((information) =>
        remapInformation(information, informationIds, factionIds, locationIds, npcIds),
      ),
      informationLinks: world.informationLinks.map((link) =>
        remapInformationLink(link, informationLinkIds, informationIds),
      ),
      commodities: world.commodities.map((commodity) => remapCommodity(commodity, commodityIds)),
      marketPrices: world.marketPrices.map((price) =>
        remapMarketPrice(price, marketPriceIds, commodityIds, locationIds, npcIds, factionIds),
      ),
      entryPoints: instancedEntryPoints,
    },
    entryPoint: instancedEntryPoint,
  };
}
