import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { dmClient } from "@/lib/ai/provider";
import { toCampaignRuntimeStateJson } from "@/lib/game/json-contracts";
import type {
  CampaignDescentStatus,
  CharacterTemplate,
  DescendedRegionBundle,
  DescendedRegionManifest,
  DescendedWorldTravelBundle,
  GeneratedWorldModule,
  MaterializationLevel,
  OpenWorldGenerationArtifacts,
} from "@/lib/game/types";
import { prisma } from "@/lib/prisma";

type AdventureModuleRecord = Prisma.AdventureModuleGetPayload<Record<string, never>>;
type TransactionClient = Prisma.TransactionClient;

type WorldRegionCandidate = {
  semanticKey: string;
  locationId: string;
  name: string;
  summary: string;
  description: string;
  adjacentRegionSemanticKeys: string[];
};

type CreateWorldRegionCampaignInput = {
  campaignId: string;
  userId: string;
  module: AdventureModuleRecord;
  template: CharacterTemplate;
  world: GeneratedWorldModule;
  artifacts: OpenWorldGenerationArtifacts | null;
  launchRegionSemanticKey: string;
};

type PersistedWorldRegionGraph = {
  generationId: string;
  worldRegions: WorldRegionCandidate[];
  launchRegion: WorldRegionCandidate;
  adjacentRegionSemanticKeys: string[];
  manifests: DescendedRegionManifest[];
  launchBundle: DescendedRegionBundle;
  worldTravelBundles: DescendedWorldTravelBundle[];
};

type AiProvider = Pick<
  typeof dmClient,
  "generateRegionManifest" | "generateRegionBundle" | "generateWorldTravelBundles"
>;

type WorldTravelSkeletonEdge = ReturnType<typeof buildWorldTravelSkeleton>[number];

function encodeSemanticKeyFragment(semanticKey: string) {
  return Buffer.from(semanticKey, "utf8").toString("base64url");
}

function scopedEntityId(scopeId: string, entityType: string, id: string) {
  return `${scopeId}:${entityType}:${id}`;
}

function createEmptyCampaignRuntimeState() {
  return {
    currentLocationId: null,
    activeJourneyId: null,
    globalTime: 480,
    pendingTurnId: null,
    lastActionSummary: "Region descent completed. Settlement descent is still required before play can begin.",
    sceneFocus: null,
    sceneActorFocuses: {},
    sceneAspects: {},
    characterState: {
      conditions: [],
      activeCompanions: [],
    },
  };
}

export function toRegionSemanticKey(locationId: string) {
  return `region:${locationId}`;
}

export function toInterRegionCorridorSemanticKey(edgeId: string) {
  return `inter_region_corridor:${edgeId}`;
}

export function buildWorldRegionCandidates(world: GeneratedWorldModule): WorldRegionCandidate[] {
  return world.locations
    .filter((location) => location.locationKind !== "minor" && !location.parentLocationId)
    .map((location) => {
      const adjacentRegionSemanticKeys = world.edges.flatMap((edge) => {
        if (edge.sourceId === location.id) {
          return [toRegionSemanticKey(edge.targetId)];
        }
        if (edge.targetId === location.id) {
          return [toRegionSemanticKey(edge.sourceId)];
        }
        return [];
      });

      return {
        semanticKey: toRegionSemanticKey(location.id),
        locationId: location.id,
        name: location.name,
        summary: location.summary,
        description: location.description,
        adjacentRegionSemanticKeys: Array.from(new Set(adjacentRegionSemanticKeys)).sort(),
      };
    });
}

function toRegionSelectionOptions(world: GeneratedWorldModule) {
  return buildWorldRegionCandidates(world).map((region) => ({
    semanticKey: region.semanticKey,
    name: region.name,
    summary: region.summary,
  }));
}

function findLaunchRegion(candidates: WorldRegionCandidate[], launchRegionSemanticKey: string) {
  const region = candidates.find((candidate) => candidate.semanticKey === launchRegionSemanticKey);
  if (!region) {
    throw new Error("Selected launch region was not found in the world module.");
  }
  return region;
}

export function assertManifestCoverage(
  worldRegions: WorldRegionCandidate[],
  manifests: DescendedRegionManifest[],
  launchRegionSemanticKey: string,
) {
  if (manifests.length !== worldRegions.length) {
    throw new Error("World descent did not produce a region manifest for every world region.");
  }

  const manifestByKey = new Map(manifests.map((manifest) => [manifest.regionSemanticKey, manifest]));
  for (const region of worldRegions) {
    const manifest = manifestByKey.get(region.semanticKey);
    if (!manifest) {
      throw new Error(`Missing region manifest for ${region.semanticKey}.`);
    }

    if (manifest.canonicalWorldLocationId !== region.locationId) {
      throw new Error(
        `Region manifest ${region.semanticKey} referenced canonical world location ${manifest.canonicalWorldLocationId}, expected ${region.locationId}.`,
      );
    }
  }

  const launchManifest = manifestByKey.get(launchRegionSemanticKey);
  if (!launchManifest) {
    throw new Error("Launch region manifest was not produced.");
  }

  return manifestByKey;
}

function createRegionNodeId(campaignId: string, semanticKey: string) {
  return scopedEntityId(campaignId, "location", encodeSemanticKeyFragment(semanticKey));
}

function createEdgeId(campaignId: string, semanticKey: string) {
  return scopedEntityId(campaignId, "edge", encodeSemanticKeyFragment(semanticKey));
}

function buildSemanticLocationIdMap(
  campaignId: string,
  launchBundle: DescendedRegionBundle,
) {
  const semanticLocationIdMap = new Map<string, string>();

  semanticLocationIdMap.set(
    launchBundle.regionSemanticKey,
    createRegionNodeId(campaignId, launchBundle.regionSemanticKey),
  );

  for (const settlement of launchBundle.settlementManifests) {
    semanticLocationIdMap.set(
      settlement.settlementSemanticKey,
      createRegionNodeId(campaignId, settlement.settlementSemanticKey),
    );
  }

  for (const destination of launchBundle.hiddenDestinationManifests) {
    semanticLocationIdMap.set(
      destination.destinationSemanticKey,
      createRegionNodeId(campaignId, destination.destinationSemanticKey),
    );
  }

  return semanticLocationIdMap;
}

function buildWorldTravelSkeleton(input: {
  world: GeneratedWorldModule;
  launchRegion: WorldRegionCandidate;
  worldRegions: WorldRegionCandidate[];
}) {
  const regionBySemanticKey = new Map(
    input.worldRegions.map((region) => [region.semanticKey, region]),
  );

  return input.world.edges
    .filter((edge) => edge.sourceId === input.launchRegion.locationId || edge.targetId === input.launchRegion.locationId)
    .map((edge) => {
      const sourceRegionSemanticKey = toRegionSemanticKey(edge.sourceId);
      const targetRegionSemanticKey = toRegionSemanticKey(edge.targetId);
      const sourceRegion = regionBySemanticKey.get(sourceRegionSemanticKey);
      const targetRegion = regionBySemanticKey.get(targetRegionSemanticKey);

      if (!sourceRegion || !targetRegion) {
        throw new Error("Inter-region corridor referenced an unknown world region.");
      }

      return {
        corridorSemanticKey: toInterRegionCorridorSemanticKey(edge.id),
        edgeId: edge.id,
        sourceRegionSemanticKey,
        targetRegionSemanticKey,
        sourceRegionName: sourceRegion.name,
        targetRegionName: targetRegion.name,
        travelTimeMinutes: edge.travelTimeMinutes,
        dangerLevel: edge.dangerLevel,
        currentStatus: edge.currentStatus,
        description: edge.description,
      };
    });
}

function buildCampaignDescentMetadata(input: PersistedWorldRegionGraph) {
  const preloadRegionSemanticKeys = Array.from(
    new Set([input.launchRegion.semanticKey, ...input.adjacentRegionSemanticKeys]),
  ).sort();

  return {
    worldToRegion: {
      generationId: input.generationId,
      launchRegionSemanticKey: input.launchRegion.semanticKey,
      preloadRegionSemanticKeys,
      adjacentManifestRegionSemanticKeys: input.adjacentRegionSemanticKeys,
      worldRegionSemanticKeys: input.worldRegions.map((region) => region.semanticKey),
      materializedRegionSemanticKeys: [input.launchBundle.regionSemanticKey],
      worldTravelBundleSemanticKeys: input.worldTravelBundles.map((bundle) => bundle.corridorSemanticKey),
    },
  };
}

function assertExactSemanticKeySet(label: string, actual: string[], expected: string[]) {
  const actualKeys = [...actual].sort();
  const expectedKeys = [...expected].sort();

  if (
    actualKeys.length !== expectedKeys.length
    || actualKeys.some((value, index) => value !== expectedKeys[index])
  ) {
    throw new Error(
      `${label} mismatch. Expected [${expectedKeys.join(", ")}], received [${actualKeys.join(", ")}].`,
    );
  }
}

function assertNoDuplicateSemanticKeys(label: string, values: string[]) {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  const duplicates = Array.from(counts.entries())
    .filter(([, count]) => count > 1)
    .map(([value]) => value)
    .sort();

  if (duplicates.length) {
    throw new Error(`${label} contained duplicate semantic keys: ${duplicates.join(", ")}.`);
  }
}

export function assertWorldRegionGraphConsistency(input: {
  launchRegion: WorldRegionCandidate;
  launchManifest: DescendedRegionManifest;
  launchBundle: DescendedRegionBundle;
  worldTravelSkeleton: WorldTravelSkeletonEdge[];
  worldTravelBundles: DescendedWorldTravelBundle[];
  allWorldRegionSemanticKeys?: string[];
  allWorldEdgeSemanticKeys?: string[];
}) {
  const {
    launchRegion,
    launchManifest,
    launchBundle,
    worldTravelSkeleton,
    worldTravelBundles,
    allWorldRegionSemanticKeys = [launchRegion.semanticKey],
    allWorldEdgeSemanticKeys = worldTravelSkeleton.map((edge) => edge.corridorSemanticKey),
  } = input;

  if (launchBundle.regionSemanticKey !== launchRegion.semanticKey) {
    throw new Error("Launch bundle regionSemanticKey did not match the selected launch region.");
  }

  if (launchBundle.canonicalWorldLocationId !== launchManifest.canonicalWorldLocationId) {
    throw new Error("Launch bundle canonicalWorldLocationId did not match the launch manifest.");
  }

  assertExactSemanticKeySet(
    "Launch bundle settlement keys",
    launchBundle.settlementManifests.map((entry) => entry.settlementSemanticKey),
    launchManifest.settlementManifests.map((entry) => entry.settlementSemanticKey),
  );
  assertExactSemanticKeySet(
    "Launch bundle hidden destination keys",
    launchBundle.hiddenDestinationManifests.map((entry) => entry.destinationSemanticKey),
    launchManifest.hiddenDestinationManifests.map((entry) => entry.destinationSemanticKey),
  );
  assertExactSemanticKeySet(
    "Launch bundle corridor keys",
    launchBundle.corridorPacks.map((entry) => entry.corridorSemanticKey),
    launchManifest.intraRegionCorridorIndex.map((entry) => entry.corridorSemanticKey),
  );
  assertNoDuplicateSemanticKeys(
    "Launch bundle settlement manifests",
    launchBundle.settlementManifests.map((entry) => entry.settlementSemanticKey),
  );
  assertNoDuplicateSemanticKeys(
    "Launch bundle hidden destinations",
    launchBundle.hiddenDestinationManifests.map((entry) => entry.destinationSemanticKey),
  );
  assertNoDuplicateSemanticKeys(
    "Launch bundle corridor packs",
    launchBundle.corridorPacks.map((entry) => entry.corridorSemanticKey),
  );
  assertNoDuplicateSemanticKeys(
    "Persisted location semantic keys",
    [
      ...allWorldRegionSemanticKeys,
      ...launchBundle.settlementManifests.map((entry) => entry.settlementSemanticKey),
      ...launchBundle.hiddenDestinationManifests.map((entry) => entry.destinationSemanticKey),
    ],
  );
  assertNoDuplicateSemanticKeys(
    "Persisted world-region edges",
    [
      ...allWorldEdgeSemanticKeys,
      ...launchBundle.corridorPacks.map((entry) => entry.corridorSemanticKey),
    ],
  );

  for (const settlement of launchBundle.settlementManifests) {
    if (settlement.parentRegionSemanticKey !== launchRegion.semanticKey) {
      throw new Error(
        `Settlement ${settlement.settlementSemanticKey} must belong to launch region ${launchRegion.semanticKey}.`,
      );
    }
  }

  for (const destination of launchBundle.hiddenDestinationManifests) {
    if (destination.parentRegionSemanticKey !== launchRegion.semanticKey) {
      throw new Error(
        `Hidden destination ${destination.destinationSemanticKey} must belong to launch region ${launchRegion.semanticKey}.`,
      );
    }
  }

  const launchChildSemanticKeys = new Set<string>([
    launchRegion.semanticKey,
    ...launchBundle.settlementManifests.map((entry) => entry.settlementSemanticKey),
    ...launchBundle.hiddenDestinationManifests.map((entry) => entry.destinationSemanticKey),
  ]);
  const corridorPackKeys = new Set(
    launchBundle.corridorPacks.map((entry) => entry.corridorSemanticKey),
  );
  const launchManifestChildSemanticKeys = new Set<string>([
    launchRegion.semanticKey,
    ...launchManifest.settlementManifests.map((entry) => entry.settlementSemanticKey),
    ...launchManifest.hiddenDestinationManifests.map((entry) => entry.destinationSemanticKey),
  ]);

  for (const corridor of launchManifest.intraRegionCorridorIndex) {
    if (!launchManifestChildSemanticKeys.has(corridor.sourceSemanticKey)) {
      throw new Error(
        `Launch manifest corridor ${corridor.corridorSemanticKey} referenced unknown source ${corridor.sourceSemanticKey}.`,
      );
    }

    if (!launchManifestChildSemanticKeys.has(corridor.targetSemanticKey)) {
      throw new Error(
        `Launch manifest corridor ${corridor.corridorSemanticKey} referenced unknown target ${corridor.targetSemanticKey}.`,
      );
    }
  }
  const manifestCorridorByKey = new Map(
    launchManifest.intraRegionCorridorIndex.map((entry) => [entry.corridorSemanticKey, entry]),
  );

  for (const pack of launchBundle.corridorPacks) {
    const manifestCorridor = manifestCorridorByKey.get(pack.corridorSemanticKey);
    if (!manifestCorridor) {
      throw new Error(
        `Launch-region corridor ${pack.corridorSemanticKey} was missing from the launch manifest corridor index.`,
      );
    }

    if (
      manifestCorridor.sourceSemanticKey !== pack.sourceSemanticKey
      || manifestCorridor.targetSemanticKey !== pack.targetSemanticKey
      || manifestCorridor.baseClass !== pack.baseClass
      || [...manifestCorridor.modifiers].sort().join("|")
        !== [...pack.modifiers].sort().join("|")
    ) {
      throw new Error(
        `Launch-region corridor ${pack.corridorSemanticKey} did not match the launch manifest corridor index.`,
      );
    }

    if (!launchChildSemanticKeys.has(pack.sourceSemanticKey)) {
      throw new Error(
        `Launch-region corridor ${pack.corridorSemanticKey} referenced unknown source ${pack.sourceSemanticKey}.`,
      );
    }

    if (!launchChildSemanticKeys.has(pack.targetSemanticKey)) {
      throw new Error(
        `Launch-region corridor ${pack.corridorSemanticKey} referenced unknown target ${pack.targetSemanticKey}.`,
      );
    }

    if (pack.nextAnchorSemanticKey && !launchChildSemanticKeys.has(pack.nextAnchorSemanticKey)) {
      throw new Error(
        `Launch-region corridor ${pack.corridorSemanticKey} referenced unknown next anchor ${pack.nextAnchorSemanticKey}.`,
      );
    }

    if (
      pack.fallbackAnchorSemanticKey
      && !launchChildSemanticKeys.has(pack.fallbackAnchorSemanticKey)
    ) {
      throw new Error(
        `Launch-region corridor ${pack.corridorSemanticKey} referenced unknown fallback anchor ${pack.fallbackAnchorSemanticKey}.`,
      );
    }
  }

  for (const settlement of launchBundle.settlementManifests) {
    for (const arrivalCorridorSemanticKey of settlement.arrivalCorridorSemanticKeys) {
      if (!corridorPackKeys.has(arrivalCorridorSemanticKey)) {
        throw new Error(
          `Settlement ${settlement.settlementSemanticKey} is missing arrival corridor bundle ${arrivalCorridorSemanticKey}.`,
        );
      }
    }

    for (const egressCorridorSemanticKey of settlement.egressCorridorSemanticKeys) {
      if (!corridorPackKeys.has(egressCorridorSemanticKey)) {
        throw new Error(
          `Settlement ${settlement.settlementSemanticKey} is missing egress corridor bundle ${egressCorridorSemanticKey}.`,
        );
      }
    }
  }

  const settlementByKey = new Map(
    launchBundle.settlementManifests.map((entry) => [entry.settlementSemanticKey, entry]),
  );
  for (const pack of launchBundle.corridorPacks) {
    const sourceSettlement = settlementByKey.get(pack.sourceSemanticKey);
    if (
      sourceSettlement
      && !sourceSettlement.egressCorridorSemanticKeys.includes(pack.corridorSemanticKey)
    ) {
      throw new Error(
        `Settlement ${sourceSettlement.settlementSemanticKey} did not list egress corridor ${pack.corridorSemanticKey}.`,
      );
    }

    const targetSettlement = settlementByKey.get(pack.targetSemanticKey);
    if (
      targetSettlement
      && !targetSettlement.arrivalCorridorSemanticKeys.includes(pack.corridorSemanticKey)
    ) {
      throw new Error(
        `Settlement ${targetSettlement.settlementSemanticKey} did not list arrival corridor ${pack.corridorSemanticKey}.`,
      );
    }
  }

  if (!launchBundle.downstreamLaunchability.readyForSettlementDescent) {
    throw new Error("Launch bundle reported that it is not ready for settlement descent.");
  }

  if (
    launchBundle.downstreamLaunchability.settlementManifestCount
    !== launchBundle.settlementManifests.length
  ) {
    throw new Error("Launch bundle settlement manifest count did not match downstreamLaunchability.");
  }

  if (
    launchBundle.downstreamLaunchability.corridorPackCount
    !== launchBundle.corridorPacks.length
  ) {
    throw new Error("Launch bundle corridor pack count did not match downstreamLaunchability.");
  }

  if (
    launchBundle.downstreamLaunchability.hiddenDestinationCount
    !== launchBundle.hiddenDestinationManifests.length
  ) {
    throw new Error("Launch bundle hidden destination count did not match downstreamLaunchability.");
  }

  const skeletonByKey = new Map(
    worldTravelSkeleton.map((edge) => [edge.corridorSemanticKey, edge]),
  );
  assertExactSemanticKeySet(
    "World travel bundle keys",
    worldTravelBundles.map((bundle) => bundle.corridorSemanticKey),
    worldTravelSkeleton.map((edge) => edge.corridorSemanticKey),
  );

  for (const bundle of worldTravelBundles) {
    const expected = skeletonByKey.get(bundle.corridorSemanticKey);
    if (!expected) {
      throw new Error(`Unexpected world travel bundle ${bundle.corridorSemanticKey}.`);
    }

    if (
      bundle.sourceRegionSemanticKey !== expected.sourceRegionSemanticKey
      || bundle.targetRegionSemanticKey !== expected.targetRegionSemanticKey
    ) {
      throw new Error(
        `World travel bundle ${bundle.corridorSemanticKey} did not match its world-edge endpoints.`,
      );
    }

    if (
      bundle.travelTimeMinutes !== expected.travelTimeMinutes
      || bundle.dangerLevel !== expected.dangerLevel
      || bundle.currentStatus !== expected.currentStatus
      || bundle.description !== expected.description
    ) {
      throw new Error(
        `World travel bundle ${bundle.corridorSemanticKey} drifted from canonical world-edge travel data.`,
      );
    }

    const validAnchorSemanticKeys = new Set([
      expected.sourceRegionSemanticKey,
      expected.targetRegionSemanticKey,
    ]);
    if (
      bundle.nextAnchorSemanticKey
      && !validAnchorSemanticKeys.has(bundle.nextAnchorSemanticKey)
    ) {
      throw new Error(
        `World travel bundle ${bundle.corridorSemanticKey} referenced unknown next anchor ${bundle.nextAnchorSemanticKey}.`,
      );
    }

    if (
      bundle.fallbackAnchorSemanticKey
      && !validAnchorSemanticKeys.has(bundle.fallbackAnchorSemanticKey)
    ) {
      throw new Error(
        `World travel bundle ${bundle.corridorSemanticKey} referenced unknown fallback anchor ${bundle.fallbackAnchorSemanticKey}.`,
      );
    }
  }
}

async function persistWorldRegionCampaign(
  tx: TransactionClient,
  input: CreateWorldRegionCampaignInput,
  graph: PersistedWorldRegionGraph,
) {
  const descentStatus: CampaignDescentStatus = "awaiting_settlement_descent";
  const manifestByKey = new Map(graph.manifests.map((manifest) => [manifest.regionSemanticKey, manifest]));
  const semanticLocationIdMap = buildSemanticLocationIdMap(input.campaignId, graph.launchBundle);

  await tx.campaign.create({
    data: {
      id: input.campaignId,
      userId: input.userId,
      moduleId: input.module.id,
      templateId: input.template.id,
      moduleSchemaVersion: input.module.schemaVersion,
      selectedEntryPointId: null,
      customEntryPointJson: Prisma.JsonNull,
      descentStatus,
      descentDataJson: buildCampaignDescentMetadata(graph) as Prisma.InputJsonValue,
      generatedThroughDay: 0,
      stateJson: toCampaignRuntimeStateJson(createEmptyCampaignRuntimeState()),
      characterInstance: {
        create: {
          templateId: input.template.id,
          health: input.template.vitality ?? input.template.maxHealth ?? 1,
          currencyCp: 0,
          frameworkValues: (input.template.frameworkValues ?? {}) as Prisma.InputJsonValue,
        },
      },
    },
  });

  await tx.locationNode.createMany({
    data: graph.worldRegions.map((region) => {
      const manifest = manifestByKey.get(region.semanticKey);
      if (!manifest) {
        throw new Error(`Missing manifest for region ${region.semanticKey}.`);
      }

      const isLaunchRegion = region.semanticKey === graph.launchRegion.semanticKey;
      return {
        id: createRegionNodeId(input.campaignId, region.semanticKey),
        campaignId: input.campaignId,
        semanticKey: region.semanticKey,
        materializationLevel: (isLaunchRegion ? "bundle" : "manifest") satisfies MaterializationLevel,
        descentDataJson: {
          generationId: graph.generationId,
          canonicalWorldLocationId: manifest.canonicalWorldLocationId,
          inheritedWorldReferences: manifest.inheritedWorldReferences,
          preloadEligible: manifest.preloadEligible,
          settlementSemanticKeys: manifest.settlementManifests.map((entry) => entry.settlementSemanticKey),
          hiddenDestinationSemanticKeys: manifest.hiddenDestinationManifests.map(
            (entry) => entry.destinationSemanticKey,
          ),
          corridorIndex: manifest.intraRegionCorridorIndex,
        } as Prisma.InputJsonValue,
        name: manifest.name,
        type: "region",
        locationKind: "spine",
        parentLocationId: null,
        discoveryState: "revealed",
        summary: manifest.summary,
        description: manifest.description,
        localTextureJson: Prisma.JsonNull,
        state: isLaunchRegion ? "region_bundle_materialized" : "region_manifest_ready",
        controllingFactionId: null,
        tags: isLaunchRegion ? ["region_bundle", "launch_region"] : ["region_manifest"],
      };
    }),
  });

  const worldTravelBundleByKey = new Map(
    graph.worldTravelBundles.map((bundle) => [bundle.corridorSemanticKey, bundle]),
  );

  await tx.locationEdge.createMany({
    data: input.world.edges.map((edge) => {
      const semanticKey = toInterRegionCorridorSemanticKey(edge.id);
      const bundle = worldTravelBundleByKey.get(semanticKey);
      return {
        id: createEdgeId(input.campaignId, semanticKey),
        campaignId: input.campaignId,
        semanticKey,
        materializationLevel: (bundle ? "bundle" : "manifest") satisfies MaterializationLevel,
        sourceId: createRegionNodeId(input.campaignId, toRegionSemanticKey(edge.sourceId)),
        targetId: createRegionNodeId(input.campaignId, toRegionSemanticKey(edge.targetId)),
        corridorClass: bundle?.baseClass ?? null,
        modifiers: bundle?.modifiers ?? [],
        travelBundleJson: bundle
          ? ({
              generationId: graph.generationId,
              ...bundle,
            } satisfies Prisma.InputJsonValue)
          : Prisma.JsonNull,
        travelTimeMinutes: edge.travelTimeMinutes,
        dangerLevel: edge.dangerLevel,
        currentStatus: edge.currentStatus,
        visibility: edge.visibility,
        accessRequirementText: edge.accessRequirementText,
        description: edge.description,
      };
    }),
  });

  await tx.locationNode.createMany({
    data: [
      ...graph.launchBundle.settlementManifests.map((settlement) => ({
        id: createRegionNodeId(input.campaignId, settlement.settlementSemanticKey),
        campaignId: input.campaignId,
        semanticKey: settlement.settlementSemanticKey,
        materializationLevel: "manifest" satisfies MaterializationLevel,
        descentDataJson: {
          generationId: graph.generationId,
          parentRegionSemanticKey: settlement.parentRegionSemanticKey,
          arrivalCorridorSemanticKeys: settlement.arrivalCorridorSemanticKeys,
          egressCorridorSemanticKeys: settlement.egressCorridorSemanticKeys,
          downstreamShellPrerequisites: settlement.downstreamShellPrerequisites,
          preloadPriority: settlement.preloadPriority,
        } as Prisma.InputJsonValue,
        name: settlement.name,
        type: settlement.type,
        locationKind: "spine",
        parentLocationId: createRegionNodeId(input.campaignId, settlement.parentRegionSemanticKey),
        discoveryState: "revealed",
        summary: settlement.summary,
        description: settlement.description,
        localTextureJson: Prisma.JsonNull,
        state: "settlement_manifest_ready",
        controllingFactionId: null,
        tags: ["settlement_manifest", settlement.preloadPriority],
      })),
      ...graph.launchBundle.hiddenDestinationManifests.map((destination) => ({
        id: createRegionNodeId(input.campaignId, destination.destinationSemanticKey),
        campaignId: input.campaignId,
        semanticKey: destination.destinationSemanticKey,
        materializationLevel: "manifest" satisfies MaterializationLevel,
        descentDataJson: {
          generationId: graph.generationId,
          parentRegionSemanticKey: destination.parentRegionSemanticKey,
          hidden: destination.hidden,
          discoverabilityHooks: destination.discoverabilityHooks,
        } as Prisma.InputJsonValue,
        name: destination.name,
        type: destination.type,
        locationKind: destination.hidden ? "minor" : "spine",
        parentLocationId: createRegionNodeId(input.campaignId, destination.parentRegionSemanticKey),
        discoveryState: destination.hidden ? "rumored" : "revealed",
        summary: destination.summary,
        description: destination.description,
        localTextureJson: Prisma.JsonNull,
        state: destination.hidden ? "hidden_destination_manifest_ready" : "regional_destination_manifest_ready",
        controllingFactionId: null,
        tags: destination.hidden ? ["hidden_destination_manifest"] : ["regional_destination_manifest"],
      })),
    ],
  });

  await tx.locationEdge.createMany({
    data: graph.launchBundle.corridorPacks.map((pack) => {
      const sourceId = semanticLocationIdMap.get(pack.sourceSemanticKey);
      const targetId = semanticLocationIdMap.get(pack.targetSemanticKey);

      if (!sourceId || !targetId) {
        throw new Error(`Launch-region corridor ${pack.corridorSemanticKey} referenced an unknown semantic key.`);
      }

      return {
        id: createEdgeId(input.campaignId, pack.corridorSemanticKey),
        campaignId: input.campaignId,
        semanticKey: pack.corridorSemanticKey,
        materializationLevel: "bundle" satisfies MaterializationLevel,
        sourceId,
        targetId,
        corridorClass: pack.baseClass,
        modifiers: pack.modifiers,
        travelBundleJson: {
          generationId: graph.generationId,
          ...pack,
        } as Prisma.InputJsonValue,
        travelTimeMinutes: pack.travelTimeMinutes,
        dangerLevel: pack.dangerLevel,
        currentStatus: pack.currentStatus,
        visibility: pack.modifiers.includes("hidden") ? "hidden" : "public",
        accessRequirementText: null,
        description: pack.description,
      };
    }),
  });

  return {
    campaignId: input.campaignId,
    descentStatus,
  };
}

export class WorldDescentOrchestrator {
  constructor(
    private readonly provider: AiProvider = dmClient,
  ) {}

  async createRegionDescendedCampaign(input: CreateWorldRegionCampaignInput) {
    const worldRegions = buildWorldRegionCandidates(input.world);
    const launchRegion = findLaunchRegion(worldRegions, input.launchRegionSemanticKey);
    const manifests = await Promise.all(
      worldRegions.map((region) =>
        this.provider.generateRegionManifest({
          world: input.world,
          artifacts: input.artifacts,
          region,
        })),
    );
    assertManifestCoverage(worldRegions, manifests, launchRegion.semanticKey);

    const launchManifest = manifests.find((manifest) => manifest.regionSemanticKey === launchRegion.semanticKey);
    if (!launchManifest) {
      throw new Error("Launch region manifest was not found after manifest generation.");
    }

    const launchBundle = await this.provider.generateRegionBundle({
      world: input.world,
      artifacts: input.artifacts,
      region: launchRegion,
      manifest: launchManifest,
    });
    const worldTravelSkeleton = buildWorldTravelSkeleton({
      world: input.world,
      launchRegion,
      worldRegions,
    });

    const worldTravelBundles = await this.provider.generateWorldTravelBundles({
      world: input.world,
      artifacts: input.artifacts,
      launchRegionSemanticKey: launchRegion.semanticKey,
      launchRegionLocationId: launchRegion.locationId,
      regionManifests: manifests,
      corridorEdges: worldTravelSkeleton,
    });
    assertWorldRegionGraphConsistency({
      launchRegion,
      launchManifest,
      launchBundle,
      worldTravelSkeleton,
      worldTravelBundles,
      allWorldRegionSemanticKeys: worldRegions.map((region) => region.semanticKey),
      allWorldEdgeSemanticKeys: input.world.edges.map((edge) =>
        toInterRegionCorridorSemanticKey(edge.id),
      ),
    });

    const graph: PersistedWorldRegionGraph = {
      generationId: `world_region_${randomUUID()}`,
      worldRegions,
      launchRegion,
      adjacentRegionSemanticKeys: launchRegion.adjacentRegionSemanticKeys,
      manifests,
      launchBundle,
      worldTravelBundles,
    };

    return prisma.$transaction((tx) => persistWorldRegionCampaign(tx, input, graph));
  }
}

export function buildRegionSelectionOptions(world: GeneratedWorldModule) {
  return toRegionSelectionOptions(world);
}
