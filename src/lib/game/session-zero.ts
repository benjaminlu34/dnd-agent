import { z } from "zod";
import {
  buildAdjacency,
  countLocationsWithinHops,
  minimumEntryRadius,
} from "@/lib/game/world-validation";

function addDuplicateStringIssues(
  values: string[],
  ctx: z.RefinementCtx,
  pathPrefix: PropertyKey[],
  message: string,
) {
  const seen = new Map<string, number>();

  values.forEach((value, index) => {
    const previousIndex = seen.get(value);
    if (previousIndex != null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [...pathPrefix, index],
        message,
      });
    } else {
      seen.set(value, index);
    }
  });
}

const factionResourcesSchema = z.object({
  gold: z.number().int().min(0),
  military: z.number().int().min(0),
  influence: z.number().int().min(0),
  information: z.number().int().min(0),
});

const locationSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  type: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  description: z.string().trim().min(1),
  state: z.string().trim().min(1),
  controllingFactionId: z.string().trim().min(1).nullable(),
  tags: z.array(z.string().trim().min(1)),
});

const edgeSchema = z.object({
  id: z.string().trim().min(1),
  sourceId: z.string().trim().min(1),
  targetId: z.string().trim().min(1),
  travelTimeMinutes: z.number().int().min(1),
  dangerLevel: z.number().int().min(0).max(10),
  currentStatus: z.string().trim().min(1),
  description: z.string().trim().min(1).nullable(),
});

const factionSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  type: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  agenda: z.string().trim().min(1),
  resources: factionResourcesSchema,
  pressureClock: z.number().int().min(0).max(20),
});

const factionRelationSchema = z.object({
  id: z.string().trim().min(1),
  factionAId: z.string().trim().min(1),
  factionBId: z.string().trim().min(1),
  stance: z.enum(["allied", "neutral", "rival", "war"]),
});

const npcSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  role: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  description: z.string().trim().min(1),
  factionId: z.string().trim().min(1).nullable(),
  currentLocationId: z.string().trim().min(1),
  approval: z.number().int().min(-10).max(10),
  isCompanion: z.boolean(),
});

const informationSchema = z.object({
  id: z.string().trim().min(1),
  title: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  content: z.string().trim().min(1),
  truthfulness: z.enum(["true", "partial", "false", "outdated"]),
  accessibility: z.enum(["public", "guarded", "secret"]),
  locationId: z.string().trim().min(1).nullable(),
  factionId: z.string().trim().min(1).nullable(),
  sourceNpcId: z.string().trim().min(1).nullable(),
});

const informationLinkSchema = z.object({
  id: z.string().trim().min(1),
  sourceId: z.string().trim().min(1),
  targetId: z.string().trim().min(1),
  linkType: z.enum(["supports", "contradicts", "extends", "unlocks"]),
});

const commoditySchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  baseValue: z.number().int().min(0),
  tags: z.array(z.string().trim().min(1)),
});

const marketPriceSchema = z.object({
  id: z.string().trim().min(1),
  commodityId: z.string().trim().min(1),
  locationId: z.string().trim().min(1),
  vendorNpcId: z.string().trim().min(1).nullable(),
  factionId: z.string().trim().min(1).nullable(),
  modifier: z.number().positive(),
  stock: z.number().int().min(-1),
  legalStatus: z.enum(["legal", "restricted", "contraband"]),
});

export const entryPointSchema = z.object({
  id: z.string().trim().min(1),
  title: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  startLocationId: z.string().trim().min(1),
  presentNpcIds: z.array(z.string().trim().min(1)),
  initialInformationIds: z.array(z.string().trim().min(1)),
});

export const launchTemporaryActorSchema = z.object({
  label: z.string().trim().min(1),
  summary: z.string().trim().min(1),
});

export const generatedEntryContextSchema = entryPointSchema.extend({
  immediatePressure: z.string().trim().min(1),
  publicLead: z.string().trim().min(1),
  localContactNpcId: z.string().trim().min(1),
  mundaneActionPath: z.string().trim().min(1),
  evidenceWorldAlreadyMoving: z.string().trim().min(1),
});

const resolvedLaunchEntryContextSchemaBase = entryPointSchema.extend({
  immediatePressure: z.string().trim().min(1),
  publicLead: z.string().trim().min(1),
  localContactNpcId: z.string().trim().min(1).nullable(),
  localContactTemporaryActorLabel: z.string().trim().min(1).nullable(),
  temporaryLocalActors: z.array(launchTemporaryActorSchema).max(3),
  mundaneActionPath: z.string().trim().min(1),
  evidenceWorldAlreadyMoving: z.string().trim().min(1),
});

function refineResolvedLaunchEntryShape(
  entryPoint: {
    presentNpcIds: string[];
    localContactNpcId: string | null;
    localContactTemporaryActorLabel: string | null;
    temporaryLocalActors: Array<{ label: string; summary: string }>;
  },
  ctx: z.RefinementCtx,
) {
  const hasNamedContact = Boolean(entryPoint.localContactNpcId);
  const hasTemporaryContact = Boolean(entryPoint.localContactTemporaryActorLabel);

  if (hasNamedContact && hasTemporaryContact) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["localContactNpcId"],
      message: "Resolved launch entries may not use both named and temporary local contact anchors.",
    });
  }

  addDuplicateStringIssues(
    entryPoint.temporaryLocalActors.map((actor) => actor.label.trim().toLowerCase()),
    ctx,
    ["temporaryLocalActors"],
    "Temporary local actor labels must be unique.",
  );

  if (!entryPoint.localContactNpcId && entryPoint.presentNpcIds.length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["presentNpcIds"],
      message: "Present named NPCs require a named localContactNpcId anchor.",
    });
  }

  if (entryPoint.localContactTemporaryActorLabel) {
    const hasMatchingTemporaryActor = entryPoint.temporaryLocalActors.some(
      (actor) => actor.label === entryPoint.localContactTemporaryActorLabel,
    );

    if (!hasMatchingTemporaryActor) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["localContactTemporaryActorLabel"],
        message: "Resolved launch entry temporary local contact must match one temporaryLocalActors label.",
      });
    }
  }

}

export const resolvedLaunchEntryContextSchema = resolvedLaunchEntryContextSchemaBase.superRefine(
  refineResolvedLaunchEntryShape,
);

export const customResolvedLaunchEntryDraftSchema = resolvedLaunchEntryContextSchemaBase
  .omit({
    id: true,
  })
  .superRefine(refineResolvedLaunchEntryShape);

export const resolvedLaunchEntrySchema = resolvedLaunchEntryContextSchemaBase.extend({
  isCustom: z.boolean(),
  customRequestPrompt: z.string().trim().min(1).nullable(),
}).superRefine(refineResolvedLaunchEntryShape);

type EntryPointReferenceIssue = {
  path: PropertyKey[];
  message: string;
};

type WorldEntryPointReference = {
  id?: string;
  startLocationId: string;
  presentNpcIds: string[];
  initialInformationIds: string[];
};

type WorldResolvedLaunchEntry = WorldEntryPointReference & {
  localContactNpcId: string | null;
  localContactTemporaryActorLabel: string | null;
  temporaryLocalActors: Array<{ label: string; summary: string }>;
};

function addEntryPointIssues(
  issues: EntryPointReferenceIssue[],
  ctx: z.RefinementCtx,
  pathPrefix: PropertyKey[] = [],
) {
  for (const issue of issues) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [...pathPrefix, ...issue.path],
      message: issue.message,
    });
  }
}

export function validateEntryPointReferencesAgainstWorld(
  entryPoint: WorldEntryPointReference,
  world: {
    locations: Array<{ id: string }>;
    npcs: Array<{ id: string }>;
    information: Array<{ id: string }>;
  },
): EntryPointReferenceIssue[] {
  const issues: EntryPointReferenceIssue[] = [];
  const locationIds = new Set(world.locations.map((location) => location.id));
  const npcIds = new Set(world.npcs.map((npc) => npc.id));
  const informationIds = new Set(world.information.map((information) => information.id));

  if (!locationIds.has(entryPoint.startLocationId)) {
    issues.push({
      path: ["startLocationId"],
      message: "Entry point startLocationId must reference a known location.",
    });
  }

  entryPoint.presentNpcIds.forEach((npcId, npcIndex) => {
    if (!npcIds.has(npcId)) {
      issues.push({
        path: ["presentNpcIds", npcIndex],
        message: "Entry point presentNpcIds must reference known NPCs.",
      });
    }
  });

  entryPoint.initialInformationIds.forEach((informationId, infoIndex) => {
    if (!informationIds.has(informationId)) {
      issues.push({
        path: ["initialInformationIds", infoIndex],
        message: "Entry point initialInformationIds must reference known information nodes.",
      });
    }
  });

  return issues;
}

export function validateResolvedLaunchEntryAgainstWorld(
  entryPoint: WorldResolvedLaunchEntry,
  world: {
    locations: Array<{ id: string }>;
    edges: Array<{ sourceId: string; targetId: string }>;
    npcs: Array<{ id: string; currentLocationId: string }>;
    information: Array<{ id: string; accessibility: string }>;
  },
): EntryPointReferenceIssue[] {
  const issues = validateEntryPointReferencesAgainstWorld(entryPoint, world);
  const npcMap = new Map(world.npcs.map((npc) => [npc.id, npc]));
  const informationMap = new Map(world.information.map((information) => [information.id, information]));

  entryPoint.presentNpcIds.forEach((npcId, npcIndex) => {
    const npc = npcMap.get(npcId);
    if (npc && npc.currentLocationId !== entryPoint.startLocationId) {
      issues.push({
        path: ["presentNpcIds", npcIndex],
        message: "Resolved launch entries may only include NPCs already at the start location.",
      });
    }
  });

  if (entryPoint.localContactNpcId) {
    if (!npcMap.has(entryPoint.localContactNpcId)) {
      issues.push({
        path: ["localContactNpcId"],
        message: "Resolved launch entry localContactNpcId must reference a known NPC.",
      });
    }

    if (!entryPoint.presentNpcIds.includes(entryPoint.localContactNpcId)) {
      issues.push({
        path: ["localContactNpcId"],
        message: "Resolved launch entry localContactNpcId must be included in presentNpcIds.",
      });
    }

    const localContact = npcMap.get(entryPoint.localContactNpcId);
    if (localContact && localContact.currentLocationId !== entryPoint.startLocationId) {
      issues.push({
        path: ["localContactNpcId"],
        message: "Resolved launch entry localContactNpcId must already be at the start location.",
      });
    }
  }

  if (entryPoint.localContactTemporaryActorLabel) {
    const temporaryActorLabels = new Set(
      entryPoint.temporaryLocalActors.map((actor) => actor.label),
    );

    if (!temporaryActorLabels.has(entryPoint.localContactTemporaryActorLabel)) {
      issues.push({
        path: ["localContactTemporaryActorLabel"],
        message: "Resolved launch entry temporary local contact must match one temporaryLocalActors label.",
      });
    }
  }

  entryPoint.initialInformationIds.forEach((informationId, infoIndex) => {
    const information = informationMap.get(informationId);
    if (information?.accessibility === "secret") {
      issues.push({
        path: ["initialInformationIds", infoIndex],
        message: "Resolved launch entries may not seed secret information.",
      });
    }
  });

  const adjacency = buildAdjacency(world);
  const minimumNearbyLocations = minimumEntryRadius(world.locations.length);
  const nearbyReach = countLocationsWithinHops(adjacency, entryPoint.startLocationId, 4);

  if (nearbyReach < minimumNearbyLocations) {
    issues.push({
      path: ["startLocationId"],
      message: `Resolved launch entry must reach at least ${minimumNearbyLocations} locations within four hops, but only reaches ${nearbyReach}.`,
    });
  }

  return issues;
}

const explanationThreadSchema = z.object({
  key: z.string().trim().min(1),
  phenomenon: z.string().trim().min(1),
  prevailingTheories: z.array(z.string().trim().min(1)).min(2),
  actionableSecret: z.string().trim().min(1),
});

export const generatedWorldBibleSchema = z
  .object({
    title: z.string().trim().min(1),
    premise: z.string().trim().min(1),
    tone: z.string().trim().min(1),
    setting: z.string().trim().min(1),
    worldOverview: z.string().trim().min(1),
    systemicPressures: z.array(z.string().trim().min(1)).min(5),
    historicalFractures: z.array(z.string().trim().min(1)).min(5),
    immersionAnchors: z.array(z.string().trim().min(1)).min(6),
    explanationThreads: z.array(explanationThreadSchema).min(2),
    everydayLife: z.object({
      survival: z.string().trim().min(1),
      institutions: z.array(z.string().trim().min(1)).min(4),
      fears: z.array(z.string().trim().min(1)).min(3),
      wants: z.array(z.string().trim().min(1)).min(3),
      trade: z.array(z.string().trim().min(1)).min(3),
      gossip: z.array(z.string().trim().min(1)).min(3),
    }),
  })
  .superRefine((draft, ctx) => {
    addDuplicateStringIssues(
      draft.explanationThreads.map((thread) => thread.key),
      ctx,
      ["explanationThreads"],
      "Explanation thread keys must be unique.",
    );
  });

const worldSpineKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[a-z0-9_]+$/, "World spine keys must be lowercase alphanumeric with underscores.");

export const worldSpineLocationSchema = z.object({
  key: worldSpineKeySchema,
  name: z.string().trim().min(1),
  type: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  description: z.string().trim().min(1),
  state: z.string().trim().min(1),
  controlStatus: z.enum(["controlled", "contested", "independent"]),
  controllingFactionKey: z.string().trim().min(1).nullable(),
  tags: z.array(z.string().trim().min(1)).min(1),
  localIdentity: z.string().trim().min(1),
});

const worldSpineEdgeSchema = z.object({
  key: worldSpineKeySchema,
  sourceKey: worldSpineKeySchema,
  targetKey: worldSpineKeySchema,
  travelTimeMinutes: z.number().int().min(1),
  dangerLevel: z.number().int().min(0).max(10),
  currentStatus: z.string().trim().min(1),
  description: z.string().trim().min(1).nullable(),
});

const worldSpineFactionSchema = z.object({
  key: worldSpineKeySchema,
  name: z.string().trim().min(1),
  type: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  agenda: z.string().trim().min(1),
  resources: factionResourcesSchema,
  pressureClock: z.number().int().min(0).max(20),
  publicFootprint: z.string().trim().min(1),
});

const worldSpineRelationSchema = z.object({
  key: worldSpineKeySchema,
  factionAKey: worldSpineKeySchema,
  factionBKey: worldSpineKeySchema,
  stance: z.enum(["allied", "neutral", "rival", "war"]),
  summary: z.string().trim().min(1),
});

export const generatedWorldSpineSchema = z
  .object({
    locations: z.array(worldSpineLocationSchema).min(8).max(15),
    edges: z.array(worldSpineEdgeSchema).min(7).max(36),
    factions: z.array(worldSpineFactionSchema).min(5).max(12),
    factionRelations: z.array(worldSpineRelationSchema).min(1).max(24),
  })
  .superRefine((draft, ctx) => {
    const factionKeys = new Set(draft.factions.map((faction) => faction.key));
    const locationKeys = new Set(draft.locations.map((location) => location.key));

    addDuplicateStringIssues(
      draft.locations.map((location) => location.key),
      ctx,
      ["locations"],
      "Location keys must be unique.",
    );
    addDuplicateStringIssues(
      draft.factions.map((faction) => faction.key),
      ctx,
      ["factions"],
      "Faction keys must be unique.",
    );
    addDuplicateStringIssues(
      draft.edges.map((edge) => edge.key),
      ctx,
      ["edges"],
      "Edge keys must be unique.",
    );
    addDuplicateStringIssues(
      draft.factionRelations.map((relation) => relation.key),
      ctx,
      ["factionRelations"],
      "Faction relation keys must be unique.",
    );

    draft.locations.forEach((location, index) => {
      if (location.controlStatus === "controlled" && !location.controllingFactionKey) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["locations", index, "controllingFactionKey"],
          message: "Controlled locations must name a controlling faction.",
        });
      }

      if (
        location.controllingFactionKey &&
        !factionKeys.has(location.controllingFactionKey)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["locations", index, "controllingFactionKey"],
          message: "Location controller must reference a known faction key.",
        });
      }
    });

    draft.edges.forEach((edge, index) => {
      if (!locationKeys.has(edge.sourceKey)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["edges", index, "sourceKey"],
          message: "Edge sourceKey must reference a known location key.",
        });
      }

      if (!locationKeys.has(edge.targetKey)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["edges", index, "targetKey"],
          message: "Edge targetKey must reference a known location key.",
        });
      }
    });

    draft.factionRelations.forEach((relation, index) => {
      if (!factionKeys.has(relation.factionAKey) || !factionKeys.has(relation.factionBKey)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["factionRelations", index],
          message: "Faction relations must reference known faction keys.",
        });
      }
    });
  });

const regionalLifeLocationSchema = z.object({
  locationId: z.string().trim().min(1),
  publicActivity: z.string().trim().min(1),
  dominantActivities: z.array(z.string().trim().min(1)).min(2),
  localPressure: z.string().trim().min(1),
  classTexture: z.string().trim().min(1),
  everydayTexture: z.string().trim().min(1),
  publicHazards: z.array(z.string().trim().min(1)).min(1),
  ordinaryKnowledge: z.array(z.string().trim().min(1)).min(2),
  institutions: z.array(z.string().trim().min(1)).min(1),
  gossip: z.array(z.string().trim().min(1)).min(1),
  reasonsToLinger: z.array(z.string().trim().min(1)).min(1),
  routineSeeds: z.array(z.string().trim().min(1)).min(1),
  eventSeeds: z.array(z.string().trim().min(1)).min(1),
});

export const generatedRegionalLifeSchema = z.object({
  locations: z.array(regionalLifeLocationSchema).min(1),
});

const generatedSocialNpcSchema = z.object({
  name: z.string().trim().min(1),
  role: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  description: z.string().trim().min(1),
  factionId: z.string().trim().min(1).nullable(),
  currentLocationId: z.string().trim().min(1),
  approval: z.number().int().min(-10).max(10),
  isCompanion: z.boolean(),
  currentConcern: z.string().trim().min(1),
  playerCrossPath: z.string().trim().min(1),
  ties: z.object({
    locationIds: z.array(z.string().trim().min(1)).min(1).max(2),
    factionIds: z.array(z.string().trim().min(1)).max(2),
    economyHooks: z.array(z.string().trim().min(1)).min(1).max(2),
    informationHooks: z.array(z.string().trim().min(1)).min(1).max(2),
  }),
  importance: z.enum(["pillar", "connector", "local"]),
  bridgeLocationIds: z.array(z.string().trim().min(1)).max(2),
  bridgeFactionIds: z.array(z.string().trim().min(1)).max(2),
});

export const generatedSocialLayerInputSchema = z.object({
  npcs: z.array(generatedSocialNpcSchema).min(1),
});

const knowledgeNodeSchema = z.object({
  key: z.string().trim().min(1),
  title: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  content: z.string().trim().min(1),
  truthfulness: z.enum(["true", "partial", "false", "outdated"]),
  accessibility: z.enum(["public", "guarded", "secret"]),
  locationId: z.string().trim().min(1).nullable(),
  factionId: z.string().trim().min(1).nullable(),
  sourceNpcId: z.string().trim().min(1).nullable(),
  actionLead: z.string().trim().min(1),
  knowledgeThread: z.string().trim().min(1).nullable(),
  discoverHow: z.string().trim().min(1),
});

const knowledgeLinkSchema = z.object({
  key: z.string().trim().min(1),
  sourceKey: z.string().trim().min(1),
  targetKey: z.string().trim().min(1),
  linkType: z.enum(["supports", "contradicts", "extends", "unlocks"]),
});

const knowledgeNetworkInputSchema = z.object({
  theme: z.string().trim().min(1),
  publicBeliefs: z.array(z.string().trim().min(1)).min(1),
  hiddenTruth: z.string().trim().min(1),
  linkedInformationKeys: z.array(z.string().trim().min(1)).min(1),
  contradictionThemes: z.array(z.string().trim().min(1)),
});

const pressureSeedSchema = z.object({
  subjectType: z.enum(["location", "faction"]),
  subjectId: z.string().trim().min(1),
  pressure: z.string().trim().min(1),
});

export const generatedKnowledgeWebInputSchema = z
  .object({
    information: z.array(knowledgeNodeSchema).min(4),
    informationLinks: z.array(knowledgeLinkSchema).min(1),
  })
  .superRefine((draft, ctx) => {
    const keys = new Set(draft.information.map((information) => information.key));
    addDuplicateStringIssues(
      draft.information.map((information) => information.key),
      ctx,
      ["information"],
      "Information keys must be unique.",
    );
    addDuplicateStringIssues(
      draft.informationLinks.map((link) => link.key),
      ctx,
      ["informationLinks"],
      "Information link keys must be unique.",
    );

    draft.informationLinks.forEach((link, index) => {
      if (!keys.has(link.sourceKey) || !keys.has(link.targetKey)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["informationLinks", index],
          message: "Information links must reference known information keys.",
        });
      }
    });

  });

export const generatedKnowledgeThreadsInputSchema = z
  .object({
    knowledgeNetworks: z.array(knowledgeNetworkInputSchema).min(1).max(4),
    pressureSeeds: z.array(pressureSeedSchema).min(2).max(8),
  });

const economyCommoditySchema = z.object({
  key: z.string().trim().min(1),
  name: z.string().trim().min(1),
  baseValue: z.number().int().min(0),
  tags: z.array(z.string().trim().min(1)).min(1),
  everydayUse: z.string().trim().min(1),
  scarcityDriver: z.string().trim().min(1),
  profitFactionIds: z.array(z.string().trim().min(1)),
});

const economyMarketPriceSchema = z.object({
  commodityKey: z.string().trim().min(1),
  locationId: z.string().trim().min(1),
  vendorNpcId: z.string().trim().min(1).nullable(),
  factionId: z.string().trim().min(1).nullable(),
  modifier: z.number().positive(),
  stock: z.number().int().min(-1),
  legalStatus: z.enum(["legal", "restricted", "contraband"]),
  whyHere: z.string().trim().min(1),
});

const locationTradeIdentitySchema = z.object({
  locationId: z.string().trim().min(1),
  signatureGoods: z.array(z.string().trim().min(1)).min(1),
  scarcityNotes: z.string().trim().min(1),
  streetLevelEconomy: z.string().trim().min(1),
});

export const generatedEconomyMaterialLifeInputSchema = z
  .object({
    commodities: z.array(economyCommoditySchema).min(2),
    marketPrices: z.array(economyMarketPriceSchema).min(2),
    locationTradeIdentity: z.array(locationTradeIdentitySchema).min(4),
  })
  .superRefine((draft, ctx) => {
    const commodityKeys = new Set(draft.commodities.map((commodity) => commodity.key));

    addDuplicateStringIssues(
      draft.commodities.map((commodity) => commodity.key),
      ctx,
      ["commodities"],
      "Commodity keys must be unique.",
    );

    draft.marketPrices.forEach((price, index) => {
      if (!commodityKeys.has(price.commodityKey)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["marketPrices", index, "commodityKey"],
          message: "Market prices must reference known commodity keys.",
        });
      }
    });
  });

const entryContextSchema = generatedEntryContextSchema.extend({
  presentNpcIds: z.array(z.string().trim().min(1)).min(1),
  initialInformationIds: z.array(z.string().trim().min(1)).min(1),
});

export const generatedEntryContextsInputSchema = z.object({
  entryPoints: z.array(entryContextSchema).length(3),
});

export const generatedWorldModuleSchema = z
  .object({
    title: z.string().trim().min(1),
    premise: z.string().trim().min(1),
    tone: z.string().trim().min(1),
    setting: z.string().trim().min(1),
    locations: z.array(locationSchema).min(4),
    edges: z.array(edgeSchema).min(4),
    factions: z.array(factionSchema).min(2),
    factionRelations: z.array(factionRelationSchema).min(1),
    npcs: z.array(npcSchema).min(4),
    information: z.array(informationSchema).min(4),
    informationLinks: z.array(informationLinkSchema).min(1),
    commodities: z.array(commoditySchema).min(2),
    marketPrices: z.array(marketPriceSchema).min(2),
    entryPoints: z.array(entryPointSchema).min(2).max(5),
  })
  .superRefine((draft, ctx) => {
    const locationIds = new Set(draft.locations.map((location) => location.id));
    const factionIds = new Set(draft.factions.map((faction) => faction.id));
    const npcIds = new Set(draft.npcs.map((npc) => npc.id));
    const informationIds = new Set(draft.information.map((information) => information.id));
    const commodityIds = new Set(draft.commodities.map((commodity) => commodity.id));

    draft.edges.forEach((edge, index) => {
      if (!locationIds.has(edge.sourceId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["edges", index, "sourceId"],
          message: "Edge source must reference a known location.",
        });
      }

      if (!locationIds.has(edge.targetId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["edges", index, "targetId"],
          message: "Edge target must reference a known location.",
        });
      }
    });

    draft.locations.forEach((location, index) => {
      if (location.controllingFactionId && !factionIds.has(location.controllingFactionId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["locations", index, "controllingFactionId"],
          message: "Location controller must reference a known faction.",
        });
      }
    });

    draft.factionRelations.forEach((relation, index) => {
      if (!factionIds.has(relation.factionAId) || !factionIds.has(relation.factionBId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["factionRelations", index],
          message: "Faction relations must reference known factions.",
        });
      }
    });

    draft.npcs.forEach((npc, index) => {
      if (!locationIds.has(npc.currentLocationId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["npcs", index, "currentLocationId"],
          message: "NPC currentLocationId must reference a known location.",
        });
      }

      if (npc.factionId && !factionIds.has(npc.factionId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["npcs", index, "factionId"],
          message: "NPC factionId must reference a known faction.",
        });
      }
    });

    draft.information.forEach((information, index) => {
      if (information.locationId && !locationIds.has(information.locationId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["information", index, "locationId"],
          message: "Information locationId must reference a known location.",
        });
      }

      if (information.factionId && !factionIds.has(information.factionId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["information", index, "factionId"],
          message: "Information factionId must reference a known faction.",
        });
      }

      if (information.sourceNpcId && !npcIds.has(information.sourceNpcId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["information", index, "sourceNpcId"],
          message: "Information sourceNpcId must reference a known NPC.",
        });
      }
    });

    draft.informationLinks.forEach((link, index) => {
      if (!informationIds.has(link.sourceId) || !informationIds.has(link.targetId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["informationLinks", index],
          message: "Information links must reference known information nodes.",
        });
      }
    });

    draft.marketPrices.forEach((price, index) => {
      if (!commodityIds.has(price.commodityId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["marketPrices", index, "commodityId"],
          message: "Market price commodityId must reference a known commodity.",
        });
      }

      if (!locationIds.has(price.locationId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["marketPrices", index, "locationId"],
          message: "Market price locationId must reference a known location.",
        });
      }

      if (price.vendorNpcId && !npcIds.has(price.vendorNpcId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["marketPrices", index, "vendorNpcId"],
          message: "Market price vendorNpcId must reference a known NPC.",
        });
      }

      if (price.factionId && !factionIds.has(price.factionId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["marketPrices", index, "factionId"],
          message: "Market price factionId must reference a known faction.",
        });
      }
    });

    draft.entryPoints.forEach((entryPoint, index) => {
      addEntryPointIssues(
        validateEntryPointReferencesAgainstWorld(entryPoint, {
          locations: draft.locations,
          npcs: draft.npcs,
          information: draft.information,
        }),
        ctx,
        ["entryPoints", index],
      );
    });
  });

export const openWorldGenerationArtifactsSchema = z.object({
  prompt: z.string().trim().min(1),
  model: z.string().trim().min(1),
  createdAt: z.string().trim().min(1),
  worldBible: generatedWorldBibleSchema,
  worldSpine: generatedWorldSpineSchema,
  regionalLife: generatedRegionalLifeSchema,
  socialLayer: z.object({
    npcs: z.array(npcSchema).min(4),
    socialGravity: z.array(
      z.object({
        npcId: z.string().trim().min(1),
        importance: z.enum(["pillar", "connector", "local"]),
        bridgeLocationIds: z.array(z.string().trim().min(1)),
        bridgeFactionIds: z.array(z.string().trim().min(1)),
      }),
    ),
  }),
  knowledgeEconomy: z.object({
    information: z.array(informationSchema).min(4),
    informationLinks: z.array(informationLinkSchema).min(1),
    knowledgeNetworks: z.array(
      z.object({
        theme: z.string().trim().min(1),
        publicBeliefs: z.array(z.string().trim().min(1)).min(1),
        hiddenTruth: z.string().trim().min(1),
        linkedInformationIds: z.array(z.string().trim().min(1)).min(1),
        contradictionThemes: z.array(z.string().trim().min(1)),
      }),
    ),
    pressureSeeds: z.array(pressureSeedSchema).min(2),
    commodities: z.array(commoditySchema).min(2),
    marketPrices: z.array(marketPriceSchema).min(2),
    locationTradeIdentity: z.array(locationTradeIdentitySchema).min(4),
  }),
  entryContexts: z.object({
    entryPoints: z.array(
      entryPointSchema.extend({
        immediatePressure: z.string().trim().min(1),
        publicLead: z.string().trim().min(1),
        localContactNpcId: z.string().trim().min(1),
        mundaneActionPath: z.string().trim().min(1),
        evidenceWorldAlreadyMoving: z.string().trim().min(1),
      }),
    ),
  }),
  attempts: z.array(
    z.object({
      stage: z.enum([
        "world_bible",
        "world_spine",
        "regional_life",
        "social_cast",
        "knowledge_web",
        "knowledge_threads",
        "economy_material_life",
        "entry_contexts",
        "final_world",
      ]),
      attempt: z.number().int().min(1),
      correctionNotes: z.string().nullable(),
      completedAt: z.string().trim().min(1),
    }),
  ),
  validationReports: z.array(
    z.object({
      stage: z.enum([
        "world_bible",
        "world_spine",
        "regional_life",
        "social_cast",
        "knowledge_web",
        "knowledge_threads",
        "economy_material_life",
        "entry_contexts",
        "final_world",
      ]),
      attempt: z.number().int().min(1),
      ok: z.boolean(),
      category: z.enum(["schema", "coherence", "playability", "immersion"]),
      issues: z.array(z.string()),
    }),
  ),
  idMaps: z.object({
    factions: z.record(z.string(), z.string()),
    locations: z.record(z.string(), z.string()),
    edges: z.record(z.string(), z.string()),
    factionRelations: z.record(z.string(), z.string()),
    npcs: z.record(z.string(), z.string()),
    information: z.record(z.string(), z.string()),
    commodities: z.record(z.string(), z.string()),
  }),
  stageSummaries: z.record(z.string(), z.string()),
});

export const generatedCampaignOpeningSchema = z.object({
  narration: z.string().trim().min(1),
  activeThreat: z.string().trim().min(1),
  entryPointId: z.string().trim().min(1),
  locationNodeId: z.string().trim().min(1),
  presentNpcIds: z.array(z.string().trim().min(1)),
  citedInformationIds: z.array(z.string().trim().min(1)),
  scene: z.object({
    title: z.string().trim().min(1),
    summary: z.string().trim().min(1),
    location: z.string().trim().min(1),
    atmosphere: z.string().trim().min(1),
    suggestedActions: z.array(z.string().trim().min(1)).min(1).max(4),
  }),
});

export const campaignDraftRequestSchema = z.object({
  prompt: z.string().trim().min(1, "Prompt is required."),
  previousDraft: generatedWorldModuleSchema.optional(),
  progressId: z.string().trim().min(1).optional(),
});

export const customEntryResolutionRequestSchema = z.object({
  moduleId: z.string().trim().min(1, "Module selection is required."),
  templateId: z.string().trim().min(1, "Template selection is required."),
  prompt: z.string().trim().min(1, "Custom entry prompt is required."),
});

function hasExactlyOneLaunchEntrySelection(input: {
  entryPointId?: string;
  customEntryPoint?: unknown;
}) {
  return (input.entryPointId !== undefined) !== (input.customEntryPoint !== undefined);
}

export const campaignOpeningDraftRequestSchema = z.object({
  moduleId: z.string().trim().min(1, "Module selection is required."),
  templateId: z.string().trim().min(1, "Template selection is required."),
  entryPointId: z.string().trim().min(1, "Entry point selection is required.").optional(),
  customEntryPoint: resolvedLaunchEntrySchema.optional(),
  prompt: z.string().trim().optional(),
  previousDraft: generatedCampaignOpeningSchema.optional(),
}).refine(hasExactlyOneLaunchEntrySelection, {
  message: "Must provide exactly one of entryPointId or customEntryPoint.",
});

export const campaignCreateRequestSchema = z.object({
  moduleId: z.string().trim().min(1, "Module selection is required."),
  templateId: z.string().trim().min(1, "Template selection is required."),
  entryPointId: z.string().trim().min(1, "Entry point selection is required.").optional(),
  customEntryPoint: resolvedLaunchEntrySchema.optional(),
  opening: generatedCampaignOpeningSchema,
}).refine(hasExactlyOneLaunchEntrySelection, {
  message: "Must provide exactly one of entryPointId or customEntryPoint.",
});

export const moduleCreateRequestSchema = z.object({
  draft: generatedWorldModuleSchema,
  artifacts: openWorldGenerationArtifactsSchema.optional(),
});
