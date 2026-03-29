import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { dmClient, logBackendDiagnostic } from "@/lib/ai/provider";
import { toCampaignCharacter, toCharacterStats } from "@/lib/game/characters";
import { parseTurnResultPayloadJson, parseCampaignRuntimeStateJson, approvalBandForValue, toCampaignRuntimeStateJson, toFactionResourcesJson } from "@/lib/game/json-contracts";
import { createAdHocCampaignInventoryItem } from "@/lib/game/items";
import {
  sceneActorIdentityClearlyMatches,
  sceneActorMatchesFocus,
  sceneAspectMatchesFocus,
} from "@/lib/game/scene-identity";
import {
  resolvedLaunchEntrySchema,
  validateResolvedLaunchEntryAgainstWorld,
  generatedWorldModuleSchema,
  openWorldGenerationArtifactsSchema,
} from "@/lib/game/session-zero";
import { instanceWorldForCampaign } from "@/lib/game/world-instancing";
import { env } from "@/lib/env";
import type {
  AdventureModuleDetail,
  AdventureModuleSummary,
  ActivePressureSummary,
  ActiveThreadSummary,
  CampaignListItem,
  CampaignRuntimeState,
  CampaignSnapshot,
  CharacterInstance,
  CharacterTemplate,
  CharacterTemplateDraft,
  CharacterTemplateSummary,
  CrossLocationLead,
  FactionIntel,
  FactionRelationSummary,
  FactionMoveSummary,
  FactionSummary,
  GeneratedCampaignOpening,
  GeneratedDailySchedule,
  GeneratedWorldModule,
  InformationDetail,
  InformationSummary,
  LocalTextureSummary,
  LocationSummary,
  MarketPriceDetail,
  MemoryRecord,
  MemoryEntityLinkRecord,
  MemoryKind,
  NpcDetail,
  OpenWorldGenerationArtifacts,
  NpcSummary,
  PlayerCampaignSnapshot,
  PromptInventoryItem,
  PreparedCampaignLaunch,
  ResolvedLaunchEntry,
  RelationshipHistory,
  RecentLocalEventSummary,
  RouteSummary,
  SceneActorSummary,
  PromptContextProfile,
  RouterDecision,
  SpatialPromptContext,
  StoryMessage,
  TemporaryActorSummary,
  TurnRouterContext,
  TurnDigest,
  WorldShiftSummary,
} from "@/lib/game/types";
import { prisma } from "@/lib/prisma";

const characterTemplateSummarySelect = {
  id: true,
  name: true,
  archetype: true,
  strength: true,
  dexterity: true,
  constitution: true,
  intelligence: true,
  wisdom: true,
  charisma: true,
  maxHealth: true,
  backstory: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.CharacterTemplateSelect;

type PrismaCharacterTemplateSummaryRecord = Prisma.CharacterTemplateGetPayload<{
  select: typeof characterTemplateSummarySelect;
}>;

type PrismaItemInstanceRecord = Prisma.ItemInstanceGetPayload<{
  include: {
    template: true;
  };
}>;

type PrismaCommodityStackRecord = Prisma.CharacterCommodityStackGetPayload<{
  include: {
    commodity: true;
  };
}>;

function parseWorldTemplate(value: unknown): GeneratedWorldModule {
  return generatedWorldModuleSchema.parse(value);
}

function parseOpenWorldGenerationArtifacts(value: unknown): OpenWorldGenerationArtifacts | null {
  if (value == null) {
    return null;
  }

  return openWorldGenerationArtifactsSchema.parse(value);
}

function fallbackLocalContactNpcId(
  world: GeneratedWorldModule,
  entryPoint: GeneratedWorldModule["entryPoints"][number],
) {
  return (
    entryPoint.presentNpcIds[0]
    ?? world.npcs.find((npc) => npc.currentLocationId === entryPoint.startLocationId)?.id
    ?? null
  );
}

function createFallbackResolvedLaunchEntry(
  world: GeneratedWorldModule,
  entryPoint: GeneratedWorldModule["entryPoints"][number],
): ResolvedLaunchEntry {
  const localContactNpcId = fallbackLocalContactNpcId(world, entryPoint);

  if (!localContactNpcId) {
    throw new Error("Selected entry point cannot be normalized because no local contact NPC is available.");
  }

  return resolvedLaunchEntrySchema.parse({
    ...entryPoint,
    presentNpcIds: Array.from(new Set([...entryPoint.presentNpcIds, localContactNpcId])),
    immediatePressure: entryPoint.summary,
    publicLead: entryPoint.summary,
    localContactNpcId,
    localContactTemporaryActorLabel: null,
    temporaryLocalActors: [],
    mundaneActionPath: "Take stock of the scene and engage with the nearest visible local.",
    evidenceWorldAlreadyMoving: "The opening situation is already in motion before the player intervenes.",
    isCustom: false,
    customRequestPrompt: null,
  });
}

function resolveStockLaunchEntry(input: {
  world: GeneratedWorldModule;
  artifacts: OpenWorldGenerationArtifacts | null;
  entryPointId: string;
}): ResolvedLaunchEntry {
  const entryPoint = input.world.entryPoints.find((entry) => entry.id === input.entryPointId);

  if (!entryPoint) {
    throw new Error("Selected entry point was not found.");
  }

  const entryContext = input.artifacts?.entryContexts.entryPoints.find(
    (entry) => entry.id === input.entryPointId,
  );

  if (entryContext) {
    return resolvedLaunchEntrySchema.parse({
      ...entryContext,
      localContactTemporaryActorLabel: null,
      temporaryLocalActors: [],
      isCustom: false,
      customRequestPrompt: null,
    });
  }

  return createFallbackResolvedLaunchEntry(input.world, entryPoint);
}

function normalizeLaunchEntrySelection(input: {
  world: GeneratedWorldModule;
  artifacts: OpenWorldGenerationArtifacts | null;
  entryPointId?: string;
  customEntryPoint?: ResolvedLaunchEntry;
}): ResolvedLaunchEntry {
  if (input.customEntryPoint) {
    const entryPoint = resolvedLaunchEntrySchema.parse(input.customEntryPoint);
    const issues = validateResolvedLaunchEntryAgainstWorld(entryPoint, input.world);

    if (issues.length) {
      throw new Error(`Custom launch entry failed validation: ${issues.map((issue) => issue.message).join("; ")}`);
    }

    return entryPoint;
  }

  if (!input.entryPointId) {
    throw new Error("A stock or custom launch entry selection is required.");
  }

  return resolveStockLaunchEntry({
    world: input.world,
    artifacts: input.artifacts,
    entryPointId: input.entryPointId,
  });
}

function collectNearbyLocationIds(world: GeneratedWorldModule, startLocationId: string) {
  const nearby = new Set<string>();

  for (const edge of world.edges) {
    if (edge.sourceId === startLocationId) {
      nearby.add(edge.targetId);
    }
    if (edge.targetId === startLocationId) {
      nearby.add(edge.sourceId);
    }
  }

  return Array.from(nearby).slice(0, 3);
}

function scopeEntityId(scopeId: string, entityType: string, id: string) {
  return `${scopeId}:${entityType}:${id}`;
}

function rescopeScopedEntityId(value: string, nextScopeId: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return trimmed;
  }

  const parts = trimmed.split(":");
  return parts.length >= 3 ? `${nextScopeId}:${parts[1]}:${parts.slice(2).join(":")}` : trimmed;
}

function stripScopedEntityId(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return trimmed;
  }

  const parts = trimmed.split(":");
  return parts.length >= 3 ? `${parts[1]}:${parts.slice(2).join(":")}` : trimmed;
}

function normalizeActorSurfaceText(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function similarityTokens(value: string) {
  const stopWords = new Set([
    "the",
    "and",
    "for",
    "with",
    "that",
    "this",
    "into",
    "from",
    "your",
    "you",
    "are",
    "already",
    "while",
    "they",
    "them",
    "their",
    "have",
    "just",
    "through",
    "before",
    "after",
    "about",
    "another",
    "what",
    "when",
    "where",
    "down",
    "over",
    "more",
    "than",
    "then",
  ]);

  return normalizeActorSurfaceText(value)
    .split(" ")
    .filter((token) => token.length >= 4 && !stopWords.has(token));
}

function tokenOverlapRatio(a: string, b: string) {
  const aTokens = new Set(similarityTokens(a));
  const bTokens = new Set(similarityTokens(b));

  if (!aTokens.size || !bTokens.size) {
    return 0;
  }

  let overlap = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) {
      overlap += 1;
    }
  }

  return overlap / Math.min(aTokens.size, bTokens.size);
}

function overlapCount(left: string[], right: string[]) {
  const rightSet = new Set(right);
  return left.filter((value) => rightSet.has(value)).length;
}

type SimilarStockEntryMatch = {
  entryPoint: GeneratedWorldModule["entryPoints"][number];
  score: number;
  reasons: string[];
};

function findSimilarStockEntry(input: {
  customEntryPoint: ResolvedLaunchEntry;
  world: GeneratedWorldModule;
}): SimilarStockEntryMatch | null {
  const custom = input.customEntryPoint;
  const customSurface = [
    custom.title,
    custom.summary,
    custom.immediatePressure,
    custom.publicLead,
    custom.mundaneActionPath,
  ].join(" ");

  let bestMatch: SimilarStockEntryMatch | null = null;

  for (const stockEntry of input.world.entryPoints) {
    let score = 0;
    const reasons: string[] = [];

    if (stockEntry.startLocationId === custom.startLocationId) {
      score += 2;
      reasons.push("same_start_location");
    }

    const presentNpcOverlap = overlapCount(custom.presentNpcIds, stockEntry.presentNpcIds);
    if (presentNpcOverlap > 0) {
      score += presentNpcOverlap >= Math.min(stockEntry.presentNpcIds.length, 2) ? 2 : 1;
      reasons.push("overlapping_present_npcs");
    }

    if (custom.localContactNpcId && stockEntry.presentNpcIds.includes(custom.localContactNpcId)) {
      score += 2;
      reasons.push("same_named_contact");
    }

    const informationOverlap = overlapCount(custom.initialInformationIds, stockEntry.initialInformationIds);
    if (informationOverlap > 0) {
      score += informationOverlap >= Math.min(stockEntry.initialInformationIds.length, 1) ? 2 : 1;
      reasons.push("overlapping_seeded_information");
    }

    const surfaceOverlap = tokenOverlapRatio(customSurface, `${stockEntry.title} ${stockEntry.summary}`);
    if (surfaceOverlap >= 0.5) {
      score += 3;
      reasons.push("high_surface_overlap");
    } else if (surfaceOverlap >= 0.3) {
      score += 2;
      reasons.push("moderate_surface_overlap");
    }

    if (score >= 7 && (!bestMatch || score > bestMatch.score)) {
      bestMatch = {
        entryPoint: stockEntry,
        score,
        reasons,
      };
    }
  }

  return bestMatch;
}

function buildCustomEntrySimilarityCorrection(input: {
  similarStockEntry: SimilarStockEntryMatch;
  prompt: string;
}) {
  return [
    `The previous custom-entry attempt collapsed too close to the authored stock entry "${input.similarStockEntry.entryPoint.title}".`,
    `Similarity signals: ${input.similarStockEntry.reasons.join(", ")}.`,
    "Keep the player's custom premise, but choose a more distinct social hinge and pressure shape.",
    "Do not reuse the same named contact and seeded information package unless the player's request clearly demands that exact authored hook.",
    "Prefer routine texture, ordinary locals, and player-authored work or domestic details over inheriting the nearest stock crisis.",
    `Player request to preserve: ${input.prompt.trim()}`,
  ].join("\n");
}

function temporaryActorMatchesStartingLocal(input: {
  actor: { label: string; summary: string };
  npc: Pick<GeneratedWorldModule["npcs"][number], "role" | "summary" | "description">;
}) {
  return sceneActorIdentityClearlyMatches({
    candidateRole: input.actor.label,
    existingRole: input.npc.role,
    candidateSummary: input.actor.summary,
    existingSummary: `${input.npc.summary} ${input.npc.description}`,
  });
}

function reconcileEntryPointWithStartingLocals(input: {
  entryPoint: ResolvedLaunchEntry;
  startingLocals: GeneratedWorldModule["npcs"];
}) {
  let localContactNpcId = input.entryPoint.localContactNpcId;
  let localContactTemporaryActorLabel = input.entryPoint.localContactTemporaryActorLabel;
  const temporaryLocalActors = input.entryPoint.temporaryLocalActors.filter((actor) => {
    const matchingLocal = input.startingLocals.find((npc) =>
      npc.currentLocationId === input.entryPoint.startLocationId
      && temporaryActorMatchesStartingLocal({ actor, npc }),
    );

    if (!matchingLocal) {
      return true;
    }

    if (
      !localContactNpcId
      && localContactTemporaryActorLabel
      && normalizeActorSurfaceText(localContactTemporaryActorLabel) === normalizeActorSurfaceText(actor.label)
    ) {
      localContactNpcId = matchingLocal.id;
      localContactTemporaryActorLabel = null;
    }

    return false;
  });

  return {
    ...input.entryPoint,
    localContactNpcId,
    localContactTemporaryActorLabel,
    temporaryLocalActors,
  };
}

function rescopeGeneratedNpcToCampaign(
  npc: GeneratedWorldModule["npcs"][number],
  campaignId: string,
): GeneratedWorldModule["npcs"][number] {
  return {
    ...npc,
    id: rescopeScopedEntityId(npc.id, campaignId),
    factionId: npc.factionId ? rescopeScopedEntityId(npc.factionId, campaignId) : null,
    currentLocationId: rescopeScopedEntityId(npc.currentLocationId, campaignId),
  };
}

function rescopeOpeningToCampaign(
  opening: GeneratedCampaignOpening,
  campaignId: string,
): GeneratedCampaignOpening {
  return {
    ...opening,
    locationNodeId: rescopeScopedEntityId(opening.locationNodeId, campaignId),
    presentNpcIds: opening.presentNpcIds.map((id) => rescopeScopedEntityId(id, campaignId)),
    citedInformationIds: opening.citedInformationIds.map((id) => rescopeScopedEntityId(id, campaignId)),
  };
}

function toPrismaJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function dayStartTimeForDay(dayNumber: number) {
  return (dayNumber - 1) * 1440;
}

function normalizeMemoryKind(value: string): MemoryKind {
  switch (value) {
    case "conflict":
    case "promise":
    case "relationship_shift":
    case "world_change":
    case "discovery":
    case "injury":
    case "travel":
    case "trade":
      return value;
    default:
      return "world_change";
  }
}

function memoryKindPriority(memoryKind: MemoryKind) {
  switch (memoryKind) {
    case "conflict":
      return 8;
    case "promise":
      return 7;
    case "relationship_shift":
      return 6;
    case "world_change":
      return 5;
    case "discovery":
      return 4;
    case "injury":
      return 3;
    case "travel":
      return 2;
    case "trade":
      return 1;
    default:
      return 0;
  }
}

function toMemoryRecord(
  memory: Prisma.MemoryEntryGetPayload<{
    include?: { entityLinks: true };
  }>,
): MemoryRecord {
  return {
    id: memory.id,
    type: memory.type,
    turnId: memory.turnId ?? null,
    memoryKind: normalizeMemoryKind(memory.memoryKind),
    isLongArcCandidate: memory.isLongArcCandidate,
    summary: memory.summary,
    summarySource: memory.summarySource as MemoryRecord["summarySource"],
    narrativeNote: memory.narrativeNote,
    createdAt: memory.createdAt.toISOString(),
  };
}

function buildKnowledgeRows(input: {
  campaignId: string;
  information: GeneratedWorldModule["information"];
}) {
  const locationKnowledge: Array<{
    campaignId: string;
    locationId: string;
    informationId: string;
  }> = [];
  const factionKnowledge: Array<{
    campaignId: string;
    factionId: string;
    informationId: string;
  }> = [];
  const npcKnowledge: Array<{
    campaignId: string;
    npcId: string;
    informationId: string;
    shareability: string;
  }> = [];

  for (const information of input.information) {
    if (information.locationId) {
      locationKnowledge.push({
        campaignId: input.campaignId,
        locationId: information.locationId,
        informationId: information.id,
      });
    }

    if (information.factionId) {
      factionKnowledge.push({
        campaignId: input.campaignId,
        factionId: information.factionId,
        informationId: information.id,
      });
    }

    if (information.sourceNpcId && information.accessibility !== "public") {
      npcKnowledge.push({
        campaignId: input.campaignId,
        npcId: information.sourceNpcId,
        informationId: information.id,
        shareability: information.accessibility === "guarded" ? "guarded" : "private",
      });
    }
  }

  return {
    locationKnowledge,
    factionKnowledge,
    npcKnowledge,
  };
}

function scoreRetrievedMemory(input: {
  memory: Prisma.MemoryEntryGetPayload<{
    include: {
      entityLinks: true;
    };
  }>;
  currentEntityKeys: Set<string>;
  activePressureKeys: Set<string>;
  activeThreadKeys: Set<string>;
  now: number;
}) {
  let score = 0;

  for (const link of input.memory.entityLinks) {
    const key = `${link.entityType}:${link.entityId}`;
    if (input.currentEntityKeys.has(key)) {
      score += link.isPrimary ? 40 : 25;
    }
    if (input.activePressureKeys.has(key)) {
      score += 15;
    }
  }

  if (input.memory.isLongArcCandidate) {
    score += 20;
  }

  score += memoryKindPriority(normalizeMemoryKind(input.memory.memoryKind)) * 5;

  const threadKey = `${input.memory.memoryKind}:${input.memory.id}`;
  if (input.activeThreadKeys.has(threadKey)) {
    score += 10;
  }

  const ageHours = Math.max(0, (input.now - input.memory.createdAt.getTime()) / (1000 * 60 * 60));
  score -= Math.min(18, ageHours * 0.35);

  return score;
}

function toLocalTextureSummary(value: unknown): LocalTextureSummary | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const dominantActivities = Array.isArray(record.dominantActivities)
    ? record.dominantActivities.filter((entry): entry is string => typeof entry === "string").slice(0, 3)
    : [];
  const publicHazards = Array.isArray(record.publicHazards)
    ? record.publicHazards.filter((entry): entry is string => typeof entry === "string").slice(0, 2)
    : [];
  const classTexture = typeof record.classTexture === "string" ? record.classTexture.trim() : "";

  if (!dominantActivities.length || !classTexture) {
    return null;
  }

  return {
    dominantActivities,
    classTexture,
    publicHazards,
  };
}

function buildLocationTextureMap(
  artifacts: OpenWorldGenerationArtifacts | null,
  campaignId: string,
): Map<string, LocalTextureSummary> {
  const textures = new Map<string, LocalTextureSummary>();

  if (!artifacts) {
    return textures;
  }

  for (const location of artifacts.regionalLife.locations) {
    textures.set(scopeEntityId(campaignId, "location", location.locationId), {
      dominantActivities: location.dominantActivities.slice(0, 3),
      classTexture: location.classTexture,
      publicHazards: location.publicHazards.slice(0, 2),
    });
  }

  return textures;
}

function assignStartingLocalNpcIds(
  campaignId: string,
  npcs: Array<Omit<GeneratedWorldModule["npcs"][number], "id">>,
): GeneratedWorldModule["npcs"] {
  return npcs.map((npc, index) => ({
    ...npc,
    id: scopeEntityId(campaignId, "npc", `npc_local_${index + 1}`),
  }));
}

function buildOpeningWorldWithStartingLocals(input: {
  module: GeneratedWorldModule;
  entryPoint: ResolvedLaunchEntry;
  startingLocals: GeneratedWorldModule["npcs"];
}) {
  const reconciledEntryPoint = reconcileEntryPointWithStartingLocals({
    entryPoint: input.entryPoint,
    startingLocals: input.startingLocals,
  });
  const startLocationNpcIds = input.startingLocals
    .filter((npc) => npc.currentLocationId === reconciledEntryPoint.startLocationId)
    .map((npc) => npc.id);

  return {
    module: {
      ...input.module,
      npcs: [...input.module.npcs, ...input.startingLocals],
    },
    entryPoint: {
      ...reconciledEntryPoint,
      // Preserve unnamed-local openings by keeping generated starting locals off-scene
      // unless the launch entry already hinges on named NPCs.
      presentNpcIds:
        !reconciledEntryPoint.localContactNpcId && reconciledEntryPoint.presentNpcIds.length === 0
          ? reconciledEntryPoint.presentNpcIds
          : Array.from(new Set([...reconciledEntryPoint.presentNpcIds, ...startLocationNpcIds])),
    },
  };
}

async function prepareCampaignLaunch(input: {
  campaignId: string;
  world: GeneratedWorldModule;
  entryPoint: ResolvedLaunchEntry;
  template: CharacterTemplate;
  artifacts: OpenWorldGenerationArtifacts | null;
  prompt?: string;
  previousDraft?: GeneratedCampaignOpening;
}): Promise<PreparedCampaignLaunch> {
  const { world: instancedWorld, entryPoint: instancedEntryPoint } = instanceWorldForCampaign(
    input.campaignId,
    input.world,
    input.entryPoint,
  );
  const rescaledPreviousDraft = input.previousDraft
    ? rescopeOpeningToCampaign(input.previousDraft, input.campaignId)
    : undefined;
  const openingSeed =
    rescaledPreviousDraft
    ?? await dmClient.generateCampaignOpening({
      module: instancedWorld,
      character: input.template,
      entryPoint: instancedEntryPoint,
      artifacts: input.artifacts,
      prompt: input.prompt,
    });
  const startingLocals = assignStartingLocalNpcIds(
    input.campaignId,
    await generateStartingHydratedNpcs({
      world: instancedWorld,
      entryPoint: instancedEntryPoint,
      template: input.template,
      opening: openingSeed,
    }),
  );
  const openingInput = buildOpeningWorldWithStartingLocals({
    module: instancedWorld,
    entryPoint: instancedEntryPoint,
    startingLocals,
  });
  const opening = await dmClient.generateCampaignOpening({
    module: openingInput.module,
    character: input.template,
    entryPoint: openingInput.entryPoint,
    artifacts: input.artifacts,
    prompt: input.prompt,
    previousDraft: rescaledPreviousDraft ?? openingSeed,
  });

  return {
    previewCampaignId: input.campaignId,
    entryPoint: openingInput.entryPoint,
    startingLocals,
    opening,
  };
}

function preparedLaunchMatchesSelection(input: {
  preparedLaunch: PreparedCampaignLaunch;
  normalizedEntryPoint: ResolvedLaunchEntry;
}) {
  const prepared = input.preparedLaunch.entryPoint;
  const selected = input.normalizedEntryPoint;

  if (prepared.id !== selected.id || prepared.isCustom !== selected.isCustom) {
    return false;
  }

  if (prepared.customRequestPrompt !== selected.customRequestPrompt) {
    return false;
  }

  if (stripScopedEntityId(prepared.startLocationId) !== stripScopedEntityId(selected.startLocationId)) {
    return false;
  }

  const preparedInformationIds = new Set(
    prepared.initialInformationIds.map((id) => stripScopedEntityId(id)),
  );
  const selectedInformationIds = new Set(
    selected.initialInformationIds.map((id) => stripScopedEntityId(id)),
  );

  if (preparedInformationIds.size !== selectedInformationIds.size) {
    return false;
  }

  for (const informationId of selectedInformationIds) {
    if (!preparedInformationIds.has(informationId)) {
      return false;
    }
  }

  return true;
}

async function generateStartingHydratedNpcs(input: {
  world: GeneratedWorldModule;
  entryPoint: ResolvedLaunchEntry;
  template: CharacterTemplate;
  opening: GeneratedCampaignOpening;
}) {
  try {
    return await dmClient.generateStartingLocalNpcs({
      module: input.world,
      character: input.template,
      entryPoint: input.entryPoint,
      opening: input.opening,
      nearbyLocationIds: collectNearbyLocationIds(input.world, input.entryPoint.startLocationId),
    });
  } catch (error) {
    console.warn(
      "[campaign-start-hydration] Failed to generate additional starting locals, continuing with anchor NPCs only.",
      error,
    );
    logBackendDiagnostic("campaign.starting_locals.fallback", {
      message:
        "Failed to generate additional starting locals, continuing with anchor NPCs only.",
      error: error instanceof Error ? error.message : String(error),
      entryPointId: input.entryPoint.id,
      startLocationId: input.entryPoint.startLocationId,
    });
    return [];
  }
}

function toTemplateRecord(template: Prisma.CharacterTemplateGetPayload<Record<string, never>>): CharacterTemplate {
  return {
    id: template.id,
    name: template.name,
    archetype: template.archetype,
    strength: template.strength,
    dexterity: template.dexterity,
    constitution: template.constitution,
    intelligence: template.intelligence,
    wisdom: template.wisdom,
    charisma: template.charisma,
    maxHealth: template.maxHealth,
    backstory: template.backstory,
    starterItems: [...template.starterItems],
  };
}

function toTemplateSummary(template: PrismaCharacterTemplateSummaryRecord): CharacterTemplateSummary {
  return {
    id: template.id,
    name: template.name,
    archetype: template.archetype,
    strength: template.strength,
    dexterity: template.dexterity,
    constitution: template.constitution,
    intelligence: template.intelligence,
    wisdom: template.wisdom,
    charisma: template.charisma,
    maxHealth: template.maxHealth,
    backstory: template.backstory,
    createdAt: template.createdAt.toISOString(),
    updatedAt: template.updatedAt.toISOString(),
  };
}

function toItemInstanceRecord(
  instance: PrismaItemInstanceRecord,
): CharacterInstance["inventory"][number] {
  return {
    id: instance.id,
    characterInstanceId: instance.characterInstanceId,
    templateId: instance.templateId,
    template: {
      id: instance.template.id,
      campaignId: instance.template.campaignId,
      name: instance.template.name,
      description: instance.template.description,
      value: instance.template.value,
      weight: instance.template.weight,
      rarity: instance.template.rarity,
      tags: [...instance.template.tags],
    },
    isIdentified: instance.isIdentified,
    charges: instance.charges,
    properties:
      instance.properties && typeof instance.properties === "object" && !Array.isArray(instance.properties)
        ? (structuredClone(instance.properties) as Record<string, unknown>)
        : null,
  };
}

function isArchivedInventoryProperties(value: Record<string, unknown> | null) {
  return value?.removedFromInventory === true;
}

function toCommodityStackRecord(
  stack: PrismaCommodityStackRecord,
): CharacterInstance["commodityStacks"][number] {
  return {
    id: stack.id,
    characterInstanceId: stack.characterInstanceId,
    commodityId: stack.commodityId,
    quantity: stack.quantity,
    commodity: {
      id: stack.commodity.id,
      campaignId: stack.commodity.campaignId,
      name: stack.commodity.name,
      baseValue: stack.commodity.baseValue,
      tags: [...stack.commodity.tags],
    },
  };
}

function toPromptInventory(
  character: CharacterInstance,
  campaignItemTemplates: Array<{ id: string; name: string; description: string | null }> = [],
): PromptInventoryItem[] {
  const itemsById = new Map<string, PromptInventoryItem>();

  for (const template of campaignItemTemplates) {
    itemsById.set(template.id, {
      kind: "item",
      id: template.id,
      name: template.name,
      description: template.description,
      quantity: 0,
    });
  }

  for (const item of character.inventory) {
    const existing = itemsById.get(item.templateId);
    if (existing) {
      existing.quantity = (existing.quantity ?? 0) + 1;
      continue;
    }
    itemsById.set(item.templateId, {
      kind: "item",
      id: item.templateId,
      name: item.template.name,
      description: item.template.description,
      quantity: 1,
    });
  }

  return [
    ...Array.from(itemsById.values()).sort((left, right) => {
      const leftQuantity = left.quantity ?? 0;
      const rightQuantity = right.quantity ?? 0;
      if (leftQuantity !== rightQuantity) {
        return rightQuantity - leftQuantity;
      }
      return left.name.localeCompare(right.name);
    }),
    ...character.commodityStacks
      .filter((stack) => stack.quantity > 0)
      .map((stack) => ({
        kind: "commodity" as const,
        id: stack.commodityId,
        name: stack.commodity.name,
        description: `Trade goods x${stack.quantity}`,
        quantity: stack.quantity,
      })),
  ];
}

function toRouterInventorySummary(character: CharacterInstance) {
  const itemsById = new Map<string, { templateId: string; name: string; quantity: number }>();

  for (const item of character.inventory) {
    if (isArchivedInventoryProperties(item.properties as Record<string, unknown> | null)) {
      continue;
    }
    const existing = itemsById.get(item.templateId);
    if (existing) {
      existing.quantity += 1;
      continue;
    }
    itemsById.set(item.templateId, {
      templateId: item.templateId,
      name: item.template.name,
      quantity: 1,
    });
  }

  return Array.from(itemsById.values()).sort((left, right) => {
    if (left.quantity !== right.quantity) {
      return right.quantity - left.quantity;
    }
    return left.name.localeCompare(right.name);
  });
}

function toRouterSceneAspectSummaries(state: CampaignRuntimeState) {
  return Object.entries(state.sceneAspects ?? {})
    .map(([key, aspect]) => ({
      key,
      label: aspect.label,
      state: aspect.state,
      duration: aspect.duration,
      focusKey: aspect.focusKey ?? null,
    }))
    .sort((left, right) => left.key.localeCompare(right.key));
}

function filterSceneActorsForFocus(
  sceneActors: SceneActorSummary[],
  sceneFocus: CampaignRuntimeState["sceneFocus"],
) {
  if (!sceneFocus) {
    return sceneActors;
  }
  return sceneActors.filter((actor) => sceneActorMatchesFocus({ actor, sceneFocus }));
}

function filterSceneAspectsForFocus(
  sceneAspects: CampaignRuntimeState["sceneAspects"],
  sceneFocus: CampaignRuntimeState["sceneFocus"],
) {
  if (!sceneFocus) {
    return structuredClone(sceneAspects ?? {});
  }

  return Object.fromEntries(
    Object.entries(sceneAspects ?? {}).filter(([, aspect]) =>
      sceneAspectMatchesFocus({ aspect, sceneFocus }),
    ),
  );
}

function effectivePromptSceneFocus(input: {
  sceneFocus: CampaignRuntimeState["sceneFocus"];
  routerDecision?: RouterDecision;
}) {
  return input.routerDecision?.attention.impliedDestinationFocus ?? input.sceneFocus ?? null;
}

function rankedEntries<T>(
  entries: T[],
  score: (entry: T) => number,
) {
  return entries
    .map((entry, index) => ({ entry, index, score: score(entry) }))
    .sort((left, right) => {
      if (left.score !== right.score) {
        return right.score - left.score;
      }
      return left.index - right.index;
    })
    .map((entry) => entry.entry);
}

function prunePromptContextForRouter(input: {
  promptContext: SpatialPromptContext;
  profile: PromptContextProfile;
  routerDecision?: RouterDecision;
}): SpatialPromptContext {
  const mustCheck = new Set(input.routerDecision?.attention.mustCheck ?? []);
  const resolvedActorRefs = new Set(
    (input.routerDecision?.attention.resolvedReferents ?? [])
      .filter((entry) => entry.targetKind === "scene_actor")
      .map((entry) => entry.targetRef),
  );
  const resolvedInventoryRefs = new Set(
    (input.routerDecision?.attention.resolvedReferents ?? [])
      .filter((entry) => entry.targetKind === "inventory_item")
      .map((entry) => entry.targetRef),
  );
  const resolvedRouteRefs = new Set(
    (input.routerDecision?.attention.resolvedReferents ?? [])
      .filter((entry) => entry.targetKind === "route")
      .map((entry) => entry.targetRef),
  );
  const resolvedInformationRefs = new Set(
    (input.routerDecision?.attention.resolvedReferents ?? [])
      .filter((entry) => entry.targetKind === "information")
      .map((entry) => entry.targetRef),
  );
  const unresolvedKinds = new Set(
    (input.routerDecision?.attention.unresolvedReferents ?? []).map((entry) => entry.intendedKind),
  );

  const sceneActors = rankedEntries(input.promptContext.sceneActors, (actor) =>
    resolvedActorRefs.has(actor.actorRef) ? 100 : 0,
  ).slice(0, mustCheck.has("sceneActors")
    ? input.profile === "local" ? 6 : 8
    : input.profile === "local" ? 2 : 3);

  const adjacentRoutes =
    mustCheck.has("routes") || resolvedRouteRefs.size > 0
      ? rankedEntries(input.promptContext.adjacentRoutes, (route) =>
          resolvedRouteRefs.has(route.id) ? 100 : 0,
        ).slice(0, input.profile === "local" ? 4 : 8)
      : [];

  const inventory = rankedEntries(
    input.promptContext.inventory.filter((entry) => (entry.quantity ?? 0) > 0),
    (entry) => {
      let value = 0;
      if (resolvedInventoryRefs.has(entry.id)) {
        value += 100;
      }
      value += Math.min(entry.quantity ?? 0, 20);
      return value;
    },
  ).slice(0, mustCheck.has("inventory")
    ? input.profile === "local" ? 8 : 12
    : input.profile === "local" ? 4 : 6);

  const rankedSceneAspectEntries = rankedEntries(
    Object.entries(input.promptContext.sceneAspects),
    () => {
      if (unresolvedKinds.has("scene_aspect")) {
        return 10;
      }
      return 0;
    },
  );
  const sceneAspectLimit = mustCheck.has("sceneAspects") || unresolvedKinds.has("scene_aspect")
    ? input.profile === "local" ? 6 : 8
    : input.profile === "local" ? 0 : 2;
  const sceneAspects = Object.fromEntries(
    rankedSceneAspectEntries.slice(0, sceneAspectLimit),
  );

  return {
    ...input.promptContext,
    adjacentRoutes,
    sceneActors,
    recentLocalEvents: input.promptContext.recentLocalEvents.slice(0, input.profile === "local" ? 2 : 3),
    recentTurnLedger: mustCheck.has("recentTurnLedger")
      ? input.promptContext.recentTurnLedger.slice(0, input.profile === "local" ? 4 : 6)
      : input.profile === "local"
        ? []
        : input.promptContext.recentTurnLedger.slice(0, 2),
    discoveredInformation: input.profile === "local"
      ? []
      : rankedEntries(
          input.promptContext.discoveredInformation,
          (entry) => (resolvedInformationRefs.has(entry.id) ? 100 : 0),
        ).slice(0, 4),
    activePressures: input.profile === "local" ? [] : input.promptContext.activePressures.slice(0, 3),
    recentWorldShifts: input.profile === "local" ? [] : input.promptContext.recentWorldShifts.slice(0, 2),
    activeThreads: input.profile === "local" ? [] : input.promptContext.activeThreads.slice(0, 3),
    inventory,
    sceneAspects,
  };
}

export async function ensureLocalUser() {
  const email = "solo@adventure.local";
  const existingUser = await prisma.user.findUnique({
    where: { email },
  });

  if (existingUser) {
    return existingUser;
  }

  return prisma.user.create({
    data: {
      email,
      name: "Solo Adventurer",
    },
  });
}

export async function listCharacterTemplates(): Promise<CharacterTemplateSummary[]> {
  const user = await ensureLocalUser();
  const templates = await prisma.characterTemplate.findMany({
    where: { userId: user.id },
    select: characterTemplateSummarySelect,
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
  });

  return templates.map(toTemplateSummary);
}

export async function getCharacterTemplateForUser(templateId: string) {
  const user = await ensureLocalUser();
  const template = await prisma.characterTemplate.findFirst({
    where: { id: templateId, userId: user.id },
  });

  return template ? toTemplateRecord(template) : null;
}

export async function createCharacterTemplate(input: CharacterTemplateDraft) {
  const user = await ensureLocalUser();

  return prisma.characterTemplate.create({
    data: {
      userId: user.id,
      name: input.name,
      archetype: input.archetype,
      strength: input.strength,
      dexterity: input.dexterity,
      constitution: input.constitution,
      intelligence: input.intelligence,
      wisdom: input.wisdom,
      charisma: input.charisma,
      maxHealth: input.maxHealth,
      backstory: input.backstory,
      starterItems: input.starterItems,
    },
  });
}

export async function updateCharacterTemplateForUser(
  templateId: string,
  input: CharacterTemplateDraft,
) {
  const user = await ensureLocalUser();
  const template = await prisma.characterTemplate.findFirst({
    where: { id: templateId, userId: user.id },
    select: { id: true },
  });

  if (!template) {
    return null;
  }

  return prisma.characterTemplate.update({
    where: { id: template.id },
    data: {
      name: input.name,
      archetype: input.archetype,
      strength: input.strength,
      dexterity: input.dexterity,
      constitution: input.constitution,
      intelligence: input.intelligence,
      wisdom: input.wisdom,
      charisma: input.charisma,
      maxHealth: input.maxHealth,
      backstory: input.backstory,
      starterItems: input.starterItems,
    },
  });
}

export async function deleteCharacterTemplateForUser(templateId: string) {
  const user = await ensureLocalUser();
  const template = await prisma.characterTemplate.findFirst({
    where: { id: templateId, userId: user.id },
    select: {
      id: true,
      campaigns: {
        select: { id: true },
      },
    },
  });

  if (!template) {
    return null;
  }

  const campaignCount = template.campaigns.length;

  await prisma.characterTemplate.delete({
    where: { id: template.id },
  });

  return {
    templateId: template.id,
    campaignCount,
  };
}

function toAdventureModuleSummary(
  module: Prisma.AdventureModuleGetPayload<{
    include: { _count: { select: { campaigns: true } } };
  }>,
): AdventureModuleSummary {
  const template = parseWorldTemplate(module.openWorldTemplateJson);
  return {
    id: module.id,
    title: module.title,
    premise: module.premise,
    tone: module.tone,
    setting: module.setting,
    generationMode: "open_world",
    entryPointCount: template.entryPoints.length,
    campaignCount: module._count.campaigns,
    createdAt: module.createdAt.toISOString(),
    updatedAt: module.updatedAt.toISOString(),
  };
}

export async function listAdventureModules(): Promise<AdventureModuleSummary[]> {
  const user = await ensureLocalUser();
  const modules = await prisma.adventureModule.findMany({
    where: { userId: user.id },
    include: {
      _count: {
        select: {
          campaigns: true,
        },
      },
    },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
  });

  return modules.map(toAdventureModuleSummary);
}

export async function getAdventureModuleForUser(moduleId: string): Promise<AdventureModuleDetail | null> {
  const user = await ensureLocalUser();
  const adventureModule = await prisma.adventureModule.findFirst({
    where: { id: moduleId, userId: user.id },
  });

  if (!adventureModule) {
    return null;
  }

  const template = parseWorldTemplate(adventureModule.openWorldTemplateJson);

  return {
    id: adventureModule.id,
    title: adventureModule.title,
    premise: adventureModule.premise,
    tone: adventureModule.tone,
    setting: adventureModule.setting,
    generationMode: "open_world",
    schemaVersion: adventureModule.schemaVersion,
    entryPoints: template.entryPoints.map((entryPoint) => {
      const location = template.locations.find((location) => location.id === entryPoint.startLocationId);
      return {
        id: entryPoint.id,
        title: entryPoint.title,
        summary: entryPoint.summary,
        locationName: location?.name ?? entryPoint.startLocationId,
      };
    }),
    createdAt: adventureModule.createdAt.toISOString(),
    updatedAt: adventureModule.updatedAt.toISOString(),
  };
}

export async function resolveCustomEntryPointForUser(input: {
  moduleId: string;
  templateId: string;
  prompt: string;
}) {
  const user = await ensureLocalUser();
  const adventureModule = await prisma.adventureModule.findFirst({
    where: { id: input.moduleId, userId: user.id },
  });
  const template = await prisma.characterTemplate.findFirst({
    where: { id: input.templateId, userId: user.id },
  });

  if (!adventureModule) {
    return { error: "module_not_found" as const };
  }

  if (!template) {
    return { error: "template_not_found" as const };
  }

  const world = parseWorldTemplate(adventureModule.openWorldTemplateJson);
  const templateRecord = toTemplateRecord(template);
  const interpretedIntent = await dmClient.interpretCustomEntryIntent({
    prompt: input.prompt,
    character: templateRecord,
  });
  let correctionNotes: string | null = null;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const resolvedDraft = await dmClient.resolveCustomEntryPoint({
      module: world,
      character: templateRecord,
      prompt: input.prompt,
      correctionNotes,
      interpretedIntent,
    });
    const resolvedEntryPoint = resolvedLaunchEntrySchema.parse({
      id: `custom_entry_${randomUUID()}`,
      ...resolvedDraft,
      isCustom: true,
      customRequestPrompt: input.prompt.trim(),
    });
    const issues = validateResolvedLaunchEntryAgainstWorld(resolvedEntryPoint, world);

    if (issues.length) {
      throw new Error(`Resolved custom entry failed validation: ${issues.map((issue) => issue.message).join("; ")}`);
    }

    const similarStockEntry = findSimilarStockEntry({
      customEntryPoint: resolvedEntryPoint,
      world,
    });

    if (!similarStockEntry) {
      return { entryPoint: resolvedEntryPoint };
    }

    logBackendDiagnostic("campaign.custom_entry.too_similar_to_stock", {
      moduleId: input.moduleId,
      templateId: input.templateId,
      attempt,
      customEntryTitle: resolvedEntryPoint.title,
      similarStockEntryId: similarStockEntry.entryPoint.id,
      similarStockEntryTitle: similarStockEntry.entryPoint.title,
      score: similarStockEntry.score,
      reasons: similarStockEntry.reasons,
    });

    if (attempt === 2) {
      throw new Error(
        `Custom entry kept collapsing into the existing entry "${similarStockEntry.entryPoint.title}". Try re-resolving with a more specific daily-routine setup.`,
      );
    }

    correctionNotes = buildCustomEntrySimilarityCorrection({
      similarStockEntry,
      prompt: input.prompt,
    });
  }

  throw new Error("Custom entry resolution exhausted retry attempts.");
}

export async function createAdventureModule(input: {
  draft: GeneratedWorldModule;
  artifacts?: OpenWorldGenerationArtifacts;
}) {
  const user = await ensureLocalUser();

  const adventureModule = await prisma.adventureModule.create({
    data: {
      userId: user.id,
      title: input.draft.title,
      premise: input.draft.premise,
      tone: input.draft.tone,
      setting: input.draft.setting,
      generationMode: "open_world",
      schemaVersion: 1,
      openWorldTemplateJson: input.draft,
      openWorldGenerationArtifactsJson: input.artifacts ?? Prisma.JsonNull,
    },
    include: {
      _count: {
        select: {
          campaigns: true,
        },
      },
    },
  });

  return toAdventureModuleSummary(adventureModule);
}

export async function deleteAdventureModuleForUser(moduleId: string) {
  const user = await ensureLocalUser();
  const adventureModule = await prisma.adventureModule.findFirst({
    where: { id: moduleId, userId: user.id },
    include: {
      _count: {
        select: {
          campaigns: true,
        },
      },
    },
  });

  if (!adventureModule) {
    return null;
  }

  await prisma.adventureModule.delete({
    where: { id: adventureModule.id },
  });

  return {
    moduleId: adventureModule.id,
    campaignCount: adventureModule._count.campaigns,
  };
}

export async function generateCampaignOpeningDraftForUser(input: {
  moduleId: string;
  templateId: string;
  entryPointId?: string;
  customEntryPoint?: ResolvedLaunchEntry;
  prompt?: string;
  previousDraft?: GeneratedCampaignOpening;
}) {
  logBackendDiagnostic("campaign.opening_draft.start", {
    moduleId: input.moduleId,
    templateId: input.templateId,
    entryPointId: input.entryPointId ?? null,
    customEntryId: input.customEntryPoint?.id ?? null,
    hasPreviousDraft: Boolean(input.previousDraft),
    hasPrompt: Boolean(input.prompt?.trim()),
  });
  const user = await ensureLocalUser();
  const adventureModule = await prisma.adventureModule.findFirst({
    where: { id: input.moduleId, userId: user.id },
  });
  const template = await prisma.characterTemplate.findFirst({
    where: { id: input.templateId, userId: user.id },
  });

  if (!adventureModule) {
    return { error: "module_not_found" as const };
  }

  if (!template) {
    return { error: "template_not_found" as const };
  }

  const world = parseWorldTemplate(adventureModule.openWorldTemplateJson);
  const generationArtifacts = parseOpenWorldGenerationArtifacts(adventureModule.openWorldGenerationArtifactsJson);
  const entryPoint = normalizeLaunchEntrySelection({
    world,
    artifacts: generationArtifacts,
    entryPointId: input.entryPointId,
    customEntryPoint: input.customEntryPoint,
  });

  const character = toTemplateRecord(template);
  const preparedLaunch = await prepareCampaignLaunch({
    campaignId: `preview_${randomUUID()}`,
    world,
    entryPoint,
    template: character,
    artifacts: generationArtifacts,
    prompt: input.prompt,
    previousDraft: input.previousDraft,
  });
  logBackendDiagnostic("campaign.opening_draft.success", {
    previewCampaignId: preparedLaunch.previewCampaignId,
    entryPointId: preparedLaunch.entryPoint.id,
    startLocationId: preparedLaunch.entryPoint.startLocationId,
    startingLocalCount: preparedLaunch.startingLocals.length,
  });

  return {
    draft: preparedLaunch.opening,
    preparedLaunch,
  };
}

function buildDailyScheduleInputFromWorld(input: {
  campaignId: string;
  title: string;
  premise: string;
  tone: string;
  setting: string;
  currentLocationId: string;
  dayStartTime: number;
  world: GeneratedWorldModule;
  discoveredInformationIds: Set<string>;
}) {
  return {
    campaign: {
      id: input.campaignId,
      title: input.title,
      premise: input.premise,
      tone: input.tone,
      setting: input.setting,
      currentLocationId: input.currentLocationId,
      dayStartTime: input.dayStartTime,
      locations: input.world.locations.map((location) => ({
        id: location.id,
        name: location.name,
        type: location.type,
        state: location.state,
        controllingFactionId: location.controllingFactionId,
      })),
      factions: input.world.factions.map((faction) => ({
        id: faction.id,
        name: faction.name,
        type: faction.type,
        agenda: faction.agenda,
        pressureClock: faction.pressureClock,
        resources: faction.resources,
      })),
      npcs: input.world.npcs.map((npc) => ({
        id: npc.id,
        name: npc.name,
        role: npc.role,
        factionId: npc.factionId,
        currentLocationId: npc.currentLocationId,
        state: "active",
        threatLevel: 1,
      })),
      discoveredInformation: input.world.information
        .filter((information) => input.discoveredInformationIds.has(information.id))
        .map((entry) => ({
          id: entry.id,
          title: entry.title,
          summary: entry.summary,
          truthfulness: entry.truthfulness,
          locationId: entry.locationId,
          factionId: entry.factionId,
        })),
    },
  };
}

async function generateRequiredInitialSchedules(input: {
  campaignId: string;
  module: Prisma.AdventureModuleGetPayload<Record<string, never>>;
  opening: GeneratedCampaignOpening;
  world: GeneratedWorldModule;
  entryPoint: ResolvedLaunchEntry;
}) {
  const discoveredInformationIds = new Set(input.entryPoint.initialInformationIds);
  const schedules: Array<{ dayNumber: number; schedule: GeneratedDailySchedule }> = [];

  for (const dayNumber of [1, 2]) {
    try {
      schedules.push({
        dayNumber,
        schedule: await dmClient.generateDailyWorldSchedule(
          buildDailyScheduleInputFromWorld({
            campaignId: input.campaignId,
            title: input.module.title,
            premise: input.module.premise,
            tone: input.module.tone,
            setting: input.module.setting,
            currentLocationId: input.entryPoint.startLocationId,
            dayStartTime: dayStartTimeForDay(dayNumber),
            world: input.world,
            discoveredInformationIds,
          }),
        ),
      });
    } catch (error) {
      logBackendDiagnostic("campaign.create.initial_schedule_fallback", {
        campaignId: input.campaignId,
        dayNumber,
        startLocationId: input.entryPoint.startLocationId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return schedules;
}

async function createCampaignInTx(
  tx: Prisma.TransactionClient,
  input: {
    campaignId: string;
    userId: string;
    module: Prisma.AdventureModuleGetPayload<Record<string, never>>;
    template: CharacterTemplate;
    entryPoint: ResolvedLaunchEntry;
    opening: GeneratedCampaignOpening;
    instancedWorld: GeneratedWorldModule;
    instancedEntryPoint: ResolvedLaunchEntry;
    hydratedStartingNpcs: GeneratedWorldModule["npcs"];
    locationTextures: Map<string, LocalTextureSummary>;
    initialSchedules: Array<{ dayNumber: number; schedule: GeneratedDailySchedule }>;
  },
) {
  const state: CampaignRuntimeState = {
    currentLocationId: input.instancedEntryPoint.startLocationId,
    globalTime: 480,
    pendingTurnId: null,
    lastActionSummary: input.opening.activeThreat ?? input.opening.scene.summary,
    sceneFocus: null,
    sceneAspects: {},
  };

  const campaign = await tx.campaign.create({
    data: {
      id: input.campaignId,
      userId: input.userId,
      moduleId: input.module.id,
      templateId: input.template.id,
      moduleSchemaVersion: input.module.schemaVersion,
      selectedEntryPointId: input.entryPoint.id,
      customEntryPointJson: input.entryPoint.isCustom
        ? toPrismaJsonValue(input.entryPoint)
        : Prisma.JsonNull,
      generatedThroughDay: 2,
      stateJson: toCampaignRuntimeStateJson(state),
      characterInstance: {
        create: {
          templateId: input.template.id,
          health: input.template.maxHealth,
          gold: 0,
        },
      },
      sessions: {
        create: {
          title: "Session 1",
          status: "active",
          messages: {
            create: {
              role: "assistant",
              kind: "narration",
              content: input.opening.narration,
              payload: toPrismaJsonValue({
                suggestedActions: input.opening.scene.suggestedActions,
                fetchedFacts: [],
                checkResult: null,
                whatChanged: [],
                why: [],
              }),
            },
          },
        },
      },
    },
    select: {
      id: true,
      characterInstance: {
        select: { id: true },
      },
      sessions: {
        select: { id: true },
        take: 1,
      },
    },
  });

  if (!campaign.characterInstance || !campaign.sessions[0]) {
    throw new Error("Campaign initialization failed.");
  }

  if (input.instancedWorld.factions.length) {
    await tx.faction.createMany({
      data: input.instancedWorld.factions.map((faction) => ({
        id: faction.id,
        campaignId: campaign.id,
        name: faction.name,
        type: faction.type,
        summary: faction.summary,
        agenda: faction.agenda,
        resources: toFactionResourcesJson(faction.resources),
        pressureClock: faction.pressureClock,
      })),
    });
  }

  if (input.instancedWorld.locations.length) {
    await tx.locationNode.createMany({
      data: input.instancedWorld.locations.map((location) => ({
        id: location.id,
        campaignId: campaign.id,
        name: location.name,
        type: location.type,
        summary: location.summary,
        description: location.description,
        localTextureJson: input.locationTextures.has(location.id)
          ? toPrismaJsonValue(input.locationTextures.get(location.id))
          : Prisma.JsonNull,
        state: location.state,
        controllingFactionId: location.controllingFactionId,
        tags: location.tags,
      })),
    });
  }

  if (input.instancedWorld.edges.length) {
    await tx.locationEdge.createMany({
      data: input.instancedWorld.edges.map((edge) => ({
        id: edge.id,
        campaignId: campaign.id,
        sourceId: edge.sourceId,
        targetId: edge.targetId,
        travelTimeMinutes: edge.travelTimeMinutes,
        dangerLevel: edge.dangerLevel,
        currentStatus: edge.currentStatus,
        description: edge.description,
      })),
    });
  }

  if (input.instancedWorld.factionRelations.length) {
    await tx.factionRelation.createMany({
      data: input.instancedWorld.factionRelations.map((relation) => ({
        id: relation.id,
        campaignId: campaign.id,
        factionAId: relation.factionAId,
        factionBId: relation.factionBId,
        stance: relation.stance,
      })),
    });
  }

  const hydratedStartingNpcRecords = input.hydratedStartingNpcs.map((npc) => ({
    id: npc.id,
    campaignId: campaign.id,
    name: npc.name,
    role: npc.role,
    summary: npc.summary,
    description: npc.description,
    factionId: npc.factionId,
    currentLocationId: npc.currentLocationId,
    approval: npc.approval,
    isCompanion: false,
    socialLayer: "starting_local",
    isNarrativelyHydrated: true,
    hydrationClaimRequestId: null,
    hydrationClaimExpiresAt: null,
    state: "active",
    threatLevel: 1,
  }));

  if (input.instancedWorld.npcs.length || hydratedStartingNpcRecords.length) {
    await tx.nPC.createMany({
      data: [
        ...input.instancedWorld.npcs.map((npc) => ({
          id: npc.id,
          campaignId: campaign.id,
          name: npc.name,
          role: npc.role,
          summary: npc.summary,
          description: npc.description,
          socialLayer: "anchor",
          isNarrativelyHydrated: true,
          hydrationClaimRequestId: null,
          hydrationClaimExpiresAt: null,
          factionId: npc.factionId,
          currentLocationId: npc.currentLocationId,
          approval: npc.approval,
          isCompanion: npc.isCompanion,
          state: "active",
          threatLevel: 1,
        })),
        ...hydratedStartingNpcRecords,
      ],
    });
  }

  if (input.instancedEntryPoint.temporaryLocalActors.length) {
    await tx.temporaryActor.createMany({
      data: input.instancedEntryPoint.temporaryLocalActors.map((actor) => ({
        id: `tactor_${randomUUID()}`,
        campaignId: campaign.id,
        label: actor.label,
        currentLocationId: input.instancedEntryPoint.startLocationId,
        interactionCount: 0,
        firstSeenAtTurn: 0,
        lastSeenAtTurn: 0,
        lastSeenAtTime: state.globalTime,
        recentTopics: [],
        lastSummary: actor.summary,
        holdsInventory: false,
        affectedWorldState: false,
        isInMemoryGraph: false,
        promotedNpcId: null,
      })),
    });
  }

  if (input.instancedWorld.information.length) {
    await tx.information.createMany({
      data: input.instancedWorld.information.map((information) => ({
        id: information.id,
        campaignId: campaign.id,
        title: information.title,
        summary: information.summary,
        content: information.content,
        truthfulness: information.truthfulness,
        accessibility: information.accessibility,
        locationId: information.locationId,
        factionId: information.factionId,
        sourceNpcId: information.sourceNpcId,
        isDiscovered: input.instancedEntryPoint.initialInformationIds.includes(information.id),
        discoveredAtTurn: input.instancedEntryPoint.initialInformationIds.includes(information.id)
          ? 0
          : null,
        expiresAtTime: null,
      })),
    });

    const knowledgeRows = buildKnowledgeRows({
      campaignId: campaign.id,
      information: input.instancedWorld.information,
    });

    if (knowledgeRows.locationKnowledge.length) {
      await tx.locationKnowledge.createMany({
        data: knowledgeRows.locationKnowledge,
      });
    }

    if (knowledgeRows.factionKnowledge.length) {
      await tx.factionKnowledge.createMany({
        data: knowledgeRows.factionKnowledge,
      });
    }

    if (knowledgeRows.npcKnowledge.length) {
      await tx.npcKnowledge.createMany({
        data: knowledgeRows.npcKnowledge,
      });
    }
  }

  if (input.instancedWorld.informationLinks.length) {
    await tx.informationLink.createMany({
      data: input.instancedWorld.informationLinks.map((link) => ({
        id: link.id,
        campaignId: campaign.id,
        sourceId: link.sourceId,
        targetId: link.targetId,
        linkType: link.linkType,
      })),
    });
  }

  if (input.instancedWorld.commodities.length) {
    await tx.commodity.createMany({
      data: input.instancedWorld.commodities.map((commodity) => ({
        id: commodity.id,
        campaignId: campaign.id,
        name: commodity.name,
        baseValue: commodity.baseValue,
        tags: commodity.tags,
      })),
    });
  }

  if (input.instancedWorld.marketPrices.length) {
    await tx.marketPrice.createMany({
      data: input.instancedWorld.marketPrices.map((price) => ({
        id: price.id,
        campaignId: campaign.id,
        commodityId: price.commodityId,
        locationId: price.locationId,
        vendorNpcId: price.vendorNpcId,
        factionId: price.factionId,
        modifier: price.modifier,
        stock: price.stock,
        restockTime: null,
        legalStatus: price.legalStatus,
      })),
    });
  }

  for (const starterItem of input.template.starterItems) {
    await createAdHocCampaignInventoryItem(tx, {
      campaignId: campaign.id,
      characterInstanceId: campaign.characterInstance.id,
      name: starterItem,
    });
  }

  await tx.campaign.update({
    where: { id: campaign.id },
    data: {
      stateJson: toCampaignRuntimeStateJson(state),
    },
  });

  for (const day of input.initialSchedules) {
    await tx.scheduleGenerationJob.create({
      data: {
        campaignId: campaign.id,
        dayNumber: day.dayNumber,
        dayStartTime: dayStartTimeForDay(day.dayNumber),
        status: "completed",
        attempts: 1,
        completedAt: new Date(),
      },
    });

    for (const event of day.schedule.worldEvents) {
      await tx.worldEvent.create({
        data: {
          id: `wevt_${randomUUID()}`,
          campaignId: campaign.id,
          locationId: event.locationId,
          triggerTime: event.triggerTime,
          triggerCondition: event.triggerCondition
            ? (event.triggerCondition as unknown as Prisma.JsonObject)
            : Prisma.JsonNull,
          description: event.description,
          payload: event.payload as unknown as Prisma.JsonObject,
          isProcessed: false,
          isCancelled: false,
          cancellationReason: null,
          cascadeDepth: event.cascadeDepth ?? 0,
        },
      });
    }

    for (const move of day.schedule.factionMoves) {
      await tx.factionMove.create({
        data: {
          id: `fmove_${randomUUID()}`,
          campaignId: campaign.id,
          factionId: move.factionId,
          scheduledAtTime: move.scheduledAtTime,
          description: move.description,
          payload: move.payload as unknown as Prisma.JsonObject,
          isExecuted: false,
          isCancelled: false,
          cancellationReason: null,
          cascadeDepth: move.cascadeDepth ?? 0,
        },
      });
    }
  }

  return {
    campaignId: campaign.id,
    sessionId: campaign.sessions[0].id,
  };
}

export async function createCampaignFromModuleForUser(input: {
  moduleId: string;
  templateId: string;
  entryPointId?: string;
  customEntryPoint?: ResolvedLaunchEntry;
  opening?: GeneratedCampaignOpening;
  preparedLaunch?: PreparedCampaignLaunch;
}) {
  const user = await ensureLocalUser();
  const adventureModule = await prisma.adventureModule.findFirst({
    where: { id: input.moduleId, userId: user.id },
  });
  const template = await prisma.characterTemplate.findFirst({
    where: { id: input.templateId, userId: user.id },
  });

  if (!adventureModule) {
    return { error: "module_not_found" as const };
  }

  if (!template) {
    return { error: "template_not_found" as const };
  }

  logBackendDiagnostic("campaign.create.start", {
    moduleId: input.moduleId,
    templateId: input.templateId,
    entryPointId: input.entryPointId ?? null,
    customEntryId: input.customEntryPoint?.id ?? null,
    hasPreparedLaunch: Boolean(input.preparedLaunch),
    hasOpeningDraft: Boolean(input.opening),
  });

  const world = parseWorldTemplate(adventureModule.openWorldTemplateJson);
  const generationArtifacts = parseOpenWorldGenerationArtifacts(adventureModule.openWorldGenerationArtifactsJson);
  const entryPoint = normalizeLaunchEntrySelection({
    world,
    artifacts: generationArtifacts,
    entryPointId: input.entryPointId,
    customEntryPoint: input.customEntryPoint,
  });

  const templateRecord = toTemplateRecord(template);
  const campaignId = `camp_${randomUUID()}`;
  const { world: instancedWorld, entryPoint: instancedEntryPoint } = instanceWorldForCampaign(
    campaignId,
    world,
    entryPoint,
  );
  const preparedLaunchSelectionMatches = input.preparedLaunch
    ? preparedLaunchMatchesSelection({
        preparedLaunch: input.preparedLaunch,
        normalizedEntryPoint: entryPoint,
      })
    : false;
  const preparedLaunch = input.preparedLaunch && preparedLaunchSelectionMatches
    ? {
        ...input.preparedLaunch,
        entryPoint: {
          ...instancedEntryPoint,
          ...input.preparedLaunch.entryPoint,
          startLocationId: rescopeScopedEntityId(input.preparedLaunch.entryPoint.startLocationId, campaignId),
          presentNpcIds: input.preparedLaunch.entryPoint.presentNpcIds.map((id) =>
            rescopeScopedEntityId(id, campaignId),
          ),
          initialInformationIds: input.preparedLaunch.entryPoint.initialInformationIds.map((id) =>
            rescopeScopedEntityId(id, campaignId),
          ),
          localContactNpcId: input.preparedLaunch.entryPoint.localContactNpcId
            ? rescopeScopedEntityId(input.preparedLaunch.entryPoint.localContactNpcId, campaignId)
            : null,
        },
        startingLocals: input.preparedLaunch.startingLocals.map((npc) =>
          rescopeGeneratedNpcToCampaign(npc, campaignId),
        ),
        opening: rescopeOpeningToCampaign(input.preparedLaunch.opening, campaignId),
      }
    : await (async () => {
        if (input.preparedLaunch && !preparedLaunchSelectionMatches) {
          logBackendDiagnostic("campaign.create.prepared_launch_mismatch", {
            moduleId: input.moduleId,
            templateId: input.templateId,
            campaignId,
            selectedEntryPointId: entryPoint.id,
            preparedEntryPointId: input.preparedLaunch.entryPoint.id,
          });
        }

        return prepareCampaignLaunch({
          campaignId,
          world,
          entryPoint,
          template: templateRecord,
          artifacts: generationArtifacts,
          previousDraft: input.opening,
        });
      })();
  const openingInput = buildOpeningWorldWithStartingLocals({
    module: instancedWorld,
    entryPoint: instancedEntryPoint,
    startingLocals: preparedLaunch.startingLocals,
  });
  const opening = {
    ...preparedLaunch.opening,
    locationNodeId: openingInput.entryPoint.startLocationId,
    presentNpcIds: preparedLaunch.opening.presentNpcIds.filter((id) =>
      openingInput.module.npcs.some((npc) => npc.id === id),
    ),
    citedInformationIds: preparedLaunch.opening.citedInformationIds.filter((id) =>
      openingInput.module.information.some((information) => information.id === id),
    ),
  };
  const locationTextures = buildLocationTextureMap(generationArtifacts, campaignId);
  const initialSchedules = await generateRequiredInitialSchedules({
    campaignId,
    module: adventureModule,
    opening,
    world: openingInput.module,
    entryPoint: openingInput.entryPoint,
  });
  logBackendDiagnostic("campaign.create.initial_schedules_ready", {
    campaignId,
    dayNumbers: initialSchedules.map((schedule) => schedule.dayNumber),
    startLocationId: openingInput.entryPoint.startLocationId,
  });

  const result = await prisma.$transaction((tx) =>
    createCampaignInTx(tx, {
      campaignId,
      userId: user.id,
      module: adventureModule,
      template: templateRecord,
      entryPoint: openingInput.entryPoint,
      opening,
      instancedWorld,
      instancedEntryPoint: openingInput.entryPoint,
      hydratedStartingNpcs: preparedLaunch.startingLocals,
      locationTextures,
      initialSchedules,
    }),
  );

  logBackendDiagnostic("campaign.create.success", {
    campaignId: result.campaignId,
    startLocationId: openingInput.entryPoint.startLocationId,
    preparedLaunchReused: Boolean(input.preparedLaunch),
  });

  return { campaignId: result.campaignId };
}

export async function listCampaigns(): Promise<CampaignListItem[]> {
   const campaigns = await prisma.campaign.findMany({
     orderBy: { updatedAt: "desc" },
     select: {
       id: true,
       createdAt: true,
       updatedAt: true,
       stateJson: true,
       module: {
         select: {
           title: true,
           premise: true,
           setting: true,
           tone: true,
         },
       },
       template: {
         select: {
           name: true,
           archetype: true,
         },
       },
     },
   });

   if (!campaigns.length) {
     return [];
   }

   const locationRecords = await prisma.locationNode.findMany({
     where: {
       OR: campaigns.map((campaign) => ({
         campaignId: campaign.id,
         id: parseCampaignRuntimeStateJson(campaign.stateJson).currentLocationId,
       })),
     },
     select: {
       campaignId: true,
       name: true,
     },
   });
   const currentLocationNameByCampaignId = new Map(
     locationRecords.map((location) => [location.campaignId, location.name]),
   );

    return campaigns.map((campaign) => {
      const state = parseCampaignRuntimeStateJson(campaign.stateJson) as CampaignRuntimeState & {
        customTitle?: string;
      };
      const title = state.customTitle ?? campaign.module.title;
      return {
        id: campaign.id,
        title,
        premise: campaign.module.premise,
        setting: campaign.module.setting,
        tone: campaign.module.tone,
        characterName: campaign.template.name,
        characterArchetype: campaign.template.archetype,
        currentLocationName: currentLocationNameByCampaignId.get(campaign.id) ?? "Unknown location",
        updatedAt: campaign.updatedAt.toISOString(),
        createdAt: campaign.createdAt.toISOString(),
      };
    });
 }

export async function deleteCampaignForUser(campaignId: string): Promise<{ campaignId: string } | null> {
   const user = await ensureLocalUser();
   const campaign = await prisma.campaign.findFirst({
     where: { id: campaignId, userId: user.id },
   });

   if (!campaign) {
     return null;
   }

   await prisma.campaign.delete({
     where: { id: campaign.id },
   });

   return { campaignId: campaign.id };
 }

export async function renameCampaignForUser(campaignId: string, title: string): Promise<{ campaignId: string; title: string } | null> {
   const user = await ensureLocalUser();
   const campaign = await prisma.campaign.findFirst({
     where: { id: campaignId, userId: user.id },
   });

   if (!campaign) {
     return null;
   }

  const updatedCampaign = await prisma.campaign.update({
    where: { id: campaign.id },
    data: {
      stateJson: toCampaignRuntimeStateJson({
        ...parseCampaignRuntimeStateJson(campaign.stateJson),
        customTitle: title,
      } as CampaignRuntimeState),
    },
  });

   return {
     campaignId: updatedCampaign.id,
     title: title,
   };
 }

function toLocationSummary(
  location: Prisma.LocationNodeGetPayload<Record<string, never>>,
  factions: Prisma.FactionGetPayload<Record<string, never>>[],
): LocationSummary {
  const controller = location.controllingFactionId
    ? factions.find((faction) => faction.id === location.controllingFactionId)
    : null;

  return {
    id: location.id,
    name: location.name,
    type: location.type,
    summary: location.summary,
    description: location.description,
    localTexture: toLocalTextureSummary(location.localTextureJson),
    state: location.state,
    controllingFactionId: location.controllingFactionId,
    controllingFactionName: controller?.name ?? null,
    tags: [...location.tags],
  };
}

function toFactionSummary(
  faction: Prisma.FactionGetPayload<Record<string, never>>,
): FactionSummary {
  return {
    id: faction.id,
    name: faction.name,
    type: faction.type,
    summary: faction.summary,
    agenda: faction.agenda,
    pressureClock: faction.pressureClock,
  };
}

function toFactionRelationSummary(
  relation: Prisma.FactionRelationGetPayload<Record<string, never>>,
  factions: Prisma.FactionGetPayload<Record<string, never>>[],
): FactionRelationSummary {
  const factionA = factions.find((entry) => entry.id === relation.factionAId);
  const factionB = factions.find((entry) => entry.id === relation.factionBId);

  return {
    factionAId: relation.factionAId,
    factionAName: factionA?.name ?? relation.factionAId,
    factionBId: relation.factionBId,
    factionBName: factionB?.name ?? relation.factionBId,
    stance: relation.stance,
  };
}

function toNpcSummary(
  npc: Prisma.NPCGetPayload<Record<string, never>>,
  factions: Prisma.FactionGetPayload<Record<string, never>>[],
): NpcSummary {
  const faction = npc.factionId ? factions.find((entry) => entry.id === npc.factionId) : null;

  return {
    id: npc.id,
    name: npc.name,
    role: npc.role,
    summary: npc.summary,
    description: npc.description,
    socialLayer: npc.socialLayer as NpcSummary["socialLayer"],
    isNarrativelyHydrated: npc.isNarrativelyHydrated,
    factionId: npc.factionId,
    factionName: faction?.name ?? null,
    currentLocationId: npc.currentLocationId,
    approval: npc.approval,
    approvalBand: approvalBandForValue(npc.approval),
    isCompanion: npc.isCompanion,
    state: npc.state as NpcSummary["state"],
    threatLevel: npc.threatLevel,
  };
}

function toInformationSummary(
  information: Prisma.InformationGetPayload<Record<string, never>>,
  locations: Prisma.LocationNodeGetPayload<Record<string, never>>[],
  factions: Prisma.FactionGetPayload<Record<string, never>>[],
  npcs: Prisma.NPCGetPayload<Record<string, never>>[],
): InformationSummary {
  const location = information.locationId
    ? locations.find((entry) => entry.id === information.locationId)
    : null;
  const faction = information.factionId
    ? factions.find((entry) => entry.id === information.factionId)
    : null;
  const sourceNpc = information.sourceNpcId
    ? npcs.find((entry) => entry.id === information.sourceNpcId)
    : null;

  return {
    id: information.id,
    title: information.title,
    summary: information.summary,
    accessibility: information.accessibility as InformationSummary["accessibility"],
    truthfulness: information.truthfulness,
    locationId: information.locationId,
    locationName: location?.name ?? null,
    factionId: information.factionId,
    factionName: faction?.name ?? null,
    sourceNpcId: information.sourceNpcId,
    sourceNpcName: sourceNpc?.name ?? null,
    isDiscovered: information.isDiscovered,
    expiresAtTime: information.expiresAtTime ?? null,
  };
}

function toTemporaryActorSummary(
  actor: Prisma.TemporaryActorGetPayload<Record<string, never>>,
): TemporaryActorSummary {
  return {
    id: actor.id,
    label: actor.label,
    currentLocationId: actor.currentLocationId,
    interactionCount: actor.interactionCount,
    firstSeenAtTurn: actor.firstSeenAtTurn,
    lastSeenAtTurn: actor.lastSeenAtTurn,
    lastSeenAtTime: actor.lastSeenAtTime,
    recentTopics: [...actor.recentTopics],
    lastSummary: actor.lastSummary,
    holdsInventory: actor.holdsInventory,
    affectedWorldState: actor.affectedWorldState,
    isInMemoryGraph: actor.isInMemoryGraph,
    promotedNpcId: actor.promotedNpcId,
  };
}

function toSceneActorSummaries(input: {
  presentNpcs: NpcSummary[];
  temporaryActors: TemporaryActorSummary[];
  currentLocationId: string;
}): SceneActorSummary[] {
  return [
    ...input.presentNpcs.map<SceneActorSummary>((npc) => ({
      actorRef: `npc:${npc.id}`,
      kind: "npc",
      displayLabel: npc.name,
      role: npc.role,
      focusKey: null,
      detailFetchHint:
        npc.socialLayer === "promoted_local" && !npc.isNarrativelyHydrated
          ? {
              type: "fetch_npc_detail",
              npcId: npc.id,
            }
          : null,
      lastSummary: npc.summary,
    })),
    ...input.temporaryActors
      .filter((actor) => actor.currentLocationId === input.currentLocationId && actor.promotedNpcId == null)
      .map<SceneActorSummary>((actor) => ({
        actorRef: `temp:${actor.id}`,
        kind: "temporary_actor",
        displayLabel: actor.label,
        role: actor.label,
        focusKey: null,
        detailFetchHint: null,
        lastSummary: actor.lastSummary,
      })),
  ];
}

function buildCrossLocationLeads(input: {
  discoveredInformationIds: string[];
  information: Prisma.InformationGetPayload<Record<string, never>>[];
  informationLinks: Prisma.InformationLinkGetPayload<Record<string, never>>[];
  locations: Prisma.LocationNodeGetPayload<Record<string, never>>[];
  factions: Prisma.FactionGetPayload<Record<string, never>>[];
  npcs: Prisma.NPCGetPayload<Record<string, never>>[];
}): CrossLocationLead[] {
  const informationById = new Map(input.information.map((entry) => [entry.id, entry]));
  const linksBySource = new Map<string, Prisma.InformationLinkGetPayload<Record<string, never>>[]>();

  for (const link of input.informationLinks) {
    const existing = linksBySource.get(link.sourceId) ?? [];
    existing.push(link);
    linksBySource.set(link.sourceId, existing);
  }

  const leads = new Map<string, CrossLocationLead>();
  const queue = input.discoveredInformationIds.map((id) => ({
    id,
    depth: 0,
    path: [id],
  }));
  const seen = new Set<string>(input.discoveredInformationIds);

  while (queue.length) {
    const current = queue.shift();
    if (!current) {
      continue;
    }

    if (current.depth >= 2) {
      continue;
    }

    for (const link of linksBySource.get(current.id) ?? []) {
      const target = informationById.get(link.targetId);
      if (!target) {
        continue;
      }

      const nextDepth = current.depth === 0 ? 1 : 2;
      if (!input.discoveredInformationIds.includes(target.id)) {
        leads.set(target.id, {
          information: toInformationSummary(target, input.locations, input.factions, input.npcs),
          depth: nextDepth,
          viaInformationIds: current.path,
        });
      }

      if (!seen.has(target.id)) {
        seen.add(target.id);
        queue.push({
          id: target.id,
          depth: current.depth + 1,
          path: [...current.path, target.id],
        });
      }
    }
  }

  return Array.from(leads.values()).sort((left, right) => left.depth - right.depth);
}

function sortMemoriesByPriority(
  memories: Array<Prisma.MemoryEntryGetPayload<{ include: { entityLinks: true } }>>,
  prioritizedKinds: MemoryKind[] = [],
) {
  const rank = new Map(prioritizedKinds.map((kind, index) => [kind, prioritizedKinds.length - index]));

  return [...memories].sort((left, right) => {
    const leftRank = rank.get(normalizeMemoryKind(left.memoryKind)) ?? 0;
    const rightRank = rank.get(normalizeMemoryKind(right.memoryKind)) ?? 0;

    if (leftRank !== rightRank) {
      return rightRank - leftRank;
    }

    const leftKind = memoryKindPriority(normalizeMemoryKind(left.memoryKind));
    const rightKind = memoryKindPriority(normalizeMemoryKind(right.memoryKind));
    if (leftKind !== rightKind) {
      return rightKind - leftKind;
    }

    return right.createdAt.getTime() - left.createdAt.getTime();
  });
}

async function fetchEntityLinkedMemories(input: {
  campaignId: string;
  entityType: MemoryEntityLinkRecord["entityType"];
  entityId: string;
  take: number;
  prioritizedKinds?: MemoryKind[];
}) {
  const memories = await prisma.memoryEntry.findMany({
    where: {
      campaignId: input.campaignId,
      entityLinks: {
        some: {
          entityType: input.entityType,
          entityId: input.entityId,
        },
      },
    },
    include: {
      entityLinks: true,
    },
    orderBy: { createdAt: "desc" },
    take: Math.max(input.take, 12),
  });

  return sortMemoriesByPriority(memories, input.prioritizedKinds).slice(0, input.take);
}

async function fetchNpcLinkedMemoriesById(input: {
  campaignId: string;
  npcIds: string[];
  take: number;
  prioritizedKinds?: MemoryKind[];
}) {
  const npcIds = Array.from(new Set(input.npcIds));
  if (!npcIds.length) {
    return new Map<string, MemoryRecord[]>();
  }

  const memories = await prisma.memoryEntry.findMany({
    where: {
      campaignId: input.campaignId,
      entityLinks: {
        some: {
          entityType: "npc",
          entityId: {
            in: npcIds,
          },
        },
      },
    },
    include: {
      entityLinks: true,
    },
    orderBy: { createdAt: "desc" },
  });

  const byNpcId = new Map<string, typeof memories>();
  for (const npcId of npcIds) {
    const linked = memories.filter((memory) =>
      memory.entityLinks.some((link) => link.entityType === "npc" && link.entityId === npcId),
    );
    byNpcId.set(
      npcId,
      sortMemoriesByPriority(linked, input.prioritizedKinds).slice(0, input.take),
    );
  }

  return new Map(
    Array.from(byNpcId.entries()).map(([npcId, linked]) => [
      npcId,
      linked.map((memory) => toMemoryRecord(memory)),
    ]),
  );
}

export async function fetchNpcDetailsBulk(
  campaignId: string,
  npcIds: string[],
) {
  const uniqueNpcIds = Array.from(new Set(npcIds));
  if (!uniqueNpcIds.length) {
    return new Map<string, NpcDetail>();
  }

  const npcRecords = await prisma.nPC.findMany({
    where: {
      campaignId,
      id: {
        in: uniqueNpcIds,
      },
    },
    orderBy: { name: "asc" },
  });
  if (!npcRecords.length) {
    return new Map<string, NpcDetail>();
  }

  const [factions, locations, npcs, temporaryActors, memoriesByNpcId, npcKnowledge, factionKnowledge, locationKnowledge] =
    await Promise.all([
      prisma.faction.findMany({
        where: { campaignId },
      }),
      prisma.locationNode.findMany({
        where: { campaignId },
      }),
      prisma.nPC.findMany({
        where: { campaignId },
      }),
      prisma.temporaryActor.findMany({
        where: {
          campaignId,
          promotedNpcId: {
            in: uniqueNpcIds,
          },
        },
      }),
      fetchNpcLinkedMemoriesById({
        campaignId,
        npcIds: uniqueNpcIds,
        take: 8,
        prioritizedKinds: ["relationship_shift", "promise", "conflict"],
      }),
      prisma.npcKnowledge.findMany({
        where: {
          campaignId,
          npcId: {
            in: uniqueNpcIds,
          },
        },
        include: {
          information: true,
        },
        orderBy: { informationId: "asc" },
      }),
      prisma.factionKnowledge.findMany({
        where: {
          campaignId,
          factionId: {
            in: Array.from(new Set(npcRecords.flatMap((npc) => (npc.factionId ? [npc.factionId] : [])))),
          },
        },
        include: {
          information: true,
        },
        orderBy: { informationId: "asc" },
      }),
      prisma.locationKnowledge.findMany({
        where: {
          campaignId,
          locationId: {
            in: Array.from(new Set(npcRecords.flatMap((npc) => (npc.currentLocationId ? [npc.currentLocationId] : [])))),
          },
        },
        include: {
          information: true,
        },
        orderBy: { informationId: "asc" },
      }),
    ]);

  const temporaryActorByNpcId = new Map(
    temporaryActors
      .filter((actor): actor is typeof actor & { promotedNpcId: string } => actor.promotedNpcId != null)
      .map((actor) => [actor.promotedNpcId, actor.id]),
  );
  const npcKnowledgeByNpcId = new Map<string, typeof npcKnowledge>();
  const factionKnowledgeByFactionId = new Map<string, typeof factionKnowledge>();
  const locationKnowledgeByLocationId = new Map<string, typeof locationKnowledge>();

  for (const entry of npcKnowledge) {
    const list = npcKnowledgeByNpcId.get(entry.npcId) ?? [];
    list.push(entry);
    npcKnowledgeByNpcId.set(entry.npcId, list);
  }
  for (const entry of factionKnowledge) {
    const list = factionKnowledgeByFactionId.get(entry.factionId) ?? [];
    list.push(entry);
    factionKnowledgeByFactionId.set(entry.factionId, list);
  }
  for (const entry of locationKnowledge) {
    const list = locationKnowledgeByLocationId.get(entry.locationId) ?? [];
    list.push(entry);
    locationKnowledgeByLocationId.set(entry.locationId, list);
  }

  return new Map(
    npcRecords.map((npc) => {
      const visibleKnowledgeById = new Map<string, InformationSummary>();
      for (const entry of npcKnowledgeByNpcId.get(npc.id) ?? []) {
        if (entry.shareability === "private" && !entry.information.isDiscovered) {
          continue;
        }
        visibleKnowledgeById.set(
          entry.informationId,
          toInformationSummary(entry.information, locations, factions, npcs),
        );
      }
      if (npc.factionId) {
        for (const entry of factionKnowledgeByFactionId.get(npc.factionId) ?? []) {
          if (entry.information.accessibility === "secret" && !entry.information.isDiscovered) {
            continue;
          }
          if (!visibleKnowledgeById.has(entry.informationId)) {
            visibleKnowledgeById.set(
              entry.informationId,
              toInformationSummary(entry.information, locations, factions, npcs),
            );
          }
        }
      }
      if (npc.currentLocationId) {
        for (const entry of locationKnowledgeByLocationId.get(npc.currentLocationId) ?? []) {
          if (entry.information.accessibility === "secret" && !entry.information.isDiscovered) {
            continue;
          }
          if (!visibleKnowledgeById.has(entry.informationId)) {
            visibleKnowledgeById.set(
              entry.informationId,
              toInformationSummary(entry.information, locations, factions, npcs),
            );
          }
        }
      }

      return [npc.id, {
        ...toNpcSummary(npc, factions),
        knownInformation: Array.from(visibleKnowledgeById.values()).slice(0, 12),
        relationshipHistory: memoriesByNpcId.get(npc.id) ?? [],
        temporaryActorId: temporaryActorByNpcId.get(npc.id) ?? null,
      } satisfies NpcDetail];
    }),
  );
}

export async function fetchMarketPricesBulk(
  campaignId: string,
  locationIds: string[],
) {
  const uniqueLocationIds = Array.from(new Set(locationIds));
  if (!uniqueLocationIds.length) {
    return new Map<string, MarketPriceDetail[]>();
  }

  const [locations, prices] = await Promise.all([
    prisma.locationNode.findMany({
      where: {
        campaignId,
        id: {
          in: uniqueLocationIds,
        },
      },
      select: { id: true, name: true },
    }),
    prisma.marketPrice.findMany({
      where: {
        campaignId,
        locationId: {
          in: uniqueLocationIds,
        },
      },
      include: {
        commodity: true,
        vendorNpc: true,
      },
      orderBy: [{ locationId: "asc" }, { commodity: { name: "asc" } }, { createdAt: "asc" }],
    }),
  ]);

  const locationById = new Map(locations.map((location) => [location.id, location]));
  const pricesByLocationId = new Map<string, MarketPriceDetail[]>();
  for (const price of prices) {
    const location = locationById.get(price.locationId);
    if (!location) {
      continue;
    }
    const list = pricesByLocationId.get(price.locationId) ?? [];
    list.push({
      marketPriceId: price.id,
      commodityId: price.commodityId,
      commodityName: price.commodity.name,
      baseValue: price.commodity.baseValue,
      modifier: price.modifier,
      price: Math.max(1, Math.round(price.commodity.baseValue * price.modifier)),
      stock: price.stock,
      legalStatus: price.legalStatus,
      vendorNpcId: price.vendorNpcId,
      vendorNpcName: price.vendorNpc?.name ?? null,
      locationId: location.id,
      locationName: location.name,
      restockTime: price.restockTime ?? null,
    });
    pricesByLocationId.set(price.locationId, list);
  }

  for (const locationId of uniqueLocationIds) {
    if (!pricesByLocationId.has(locationId)) {
      pricesByLocationId.set(locationId, []);
    }
  }

  return pricesByLocationId;
}

export async function fetchFactionIntelBulk(
  campaignId: string,
  factionIds: string[],
) {
  const uniqueFactionIds = Array.from(new Set(factionIds));
  if (!uniqueFactionIds.length) {
    return new Map<string, FactionIntel>();
  }

  const factions = await prisma.faction.findMany({
    where: {
      campaignId,
      id: {
        in: uniqueFactionIds,
      },
    },
  });
  if (!factions.length) {
    return new Map<string, FactionIntel>();
  }

  const relations = await prisma.factionRelation.findMany({
    where: {
      campaignId,
      OR: [
        { factionAId: { in: uniqueFactionIds } },
        { factionBId: { in: uniqueFactionIds } },
      ],
    },
    orderBy: { createdAt: "asc" },
  });
  const relatedFactionIds = Array.from(new Set([
    ...factions.map((faction) => faction.id),
    ...relations.flatMap((relation) => [relation.factionAId, relation.factionBId]),
  ]));
  const [relationFactions, moves, locations] = await Promise.all([
    prisma.faction.findMany({
      where: {
        campaignId,
        id: {
          in: relatedFactionIds,
        },
      },
    }),
    prisma.factionMove.findMany({
      where: {
        campaignId,
        factionId: {
          in: uniqueFactionIds,
        },
      },
      orderBy: { scheduledAtTime: "asc" },
      take: uniqueFactionIds.length * 8,
    }),
    prisma.locationNode.findMany({
      where: {
        campaignId,
        controllingFactionId: {
          in: uniqueFactionIds,
        },
      },
      select: { id: true, controllingFactionId: true },
    }),
  ]);

  return new Map(
    factions.map((faction) => [
      faction.id,
      {
        ...toFactionSummary(faction),
        relations: relations
          .filter((relation) => relation.factionAId === faction.id || relation.factionBId === faction.id)
          .map((relation) => toFactionRelationSummary(relation, relationFactions)),
        visibleMoves: moves
          .filter((move) => move.factionId === faction.id)
          .slice(0, 8)
          .map<FactionMoveSummary>((move) => ({
            id: move.id,
            description: move.description,
            scheduledAtTime: move.scheduledAtTime,
            isExecuted: move.isExecuted,
            isCancelled: move.isCancelled,
            cancellationReason: move.cancellationReason,
          })),
        controlledLocationIds: locations
          .filter((location) => location.controllingFactionId === faction.id)
          .map((location) => location.id),
      } satisfies FactionIntel,
    ]),
  );
}

export async function fetchInformationDetailsBulk(
  campaignId: string,
  informationIds: string[],
) {
  const uniqueInformationIds = Array.from(new Set(informationIds));
  if (!uniqueInformationIds.length) {
    return new Map<string, InformationDetail>();
  }

  const information = await prisma.information.findMany({
    where: {
      campaignId,
      id: {
        in: uniqueInformationIds,
      },
      isDiscovered: true,
    },
    orderBy: { title: "asc" },
  });
  if (!information.length) {
    return new Map<string, InformationDetail>();
  }

  const [locations, factions, npcs] = await Promise.all([
    prisma.locationNode.findMany({
      where: {
        campaignId,
        id: {
          in: Array.from(new Set(information.flatMap((entry) => (entry.locationId ? [entry.locationId] : [])))),
        },
      },
    }),
    prisma.faction.findMany({
      where: {
        campaignId,
        id: {
          in: Array.from(new Set(information.flatMap((entry) => (entry.factionId ? [entry.factionId] : [])))),
        },
      },
    }),
    prisma.nPC.findMany({
      where: {
        campaignId,
        id: {
          in: Array.from(new Set(information.flatMap((entry) => (entry.sourceNpcId ? [entry.sourceNpcId] : [])))),
        },
      },
    }),
  ]);

  return new Map(
    information.map((entry) => [
      entry.id,
      {
        ...toInformationSummary(entry, locations, factions, npcs),
        content: entry.content,
      } satisfies InformationDetail,
    ]),
  );
}

export async function fetchInformationConnectionsBulk(input: {
  campaignId: string;
  groups: Array<{ key: string; informationIds: string[] }>;
}) {
  if (!input.groups.length) {
    return new Map<string, CrossLocationLead[]>();
  }

  const [information, informationLinks, locations, factions, npcs] = await Promise.all([
    prisma.information.findMany({
      where: { campaignId: input.campaignId },
      orderBy: { title: "asc" },
    }),
    prisma.informationLink.findMany({
      where: { campaignId: input.campaignId },
      orderBy: { createdAt: "asc" },
    }),
    prisma.locationNode.findMany({
      where: { campaignId: input.campaignId },
    }),
    prisma.faction.findMany({
      where: { campaignId: input.campaignId },
    }),
    prisma.nPC.findMany({
      where: { campaignId: input.campaignId },
    }),
  ]);

  return new Map(
    input.groups.map((group) => [
      group.key,
      buildCrossLocationLeads({
        discoveredInformationIds: group.informationIds,
        information,
        informationLinks,
        locations,
        factions,
        npcs,
      }),
    ]),
  );
}

export async function fetchRelationshipHistoriesBulk(
  campaignId: string,
  npcIds: string[],
) {
  const uniqueNpcIds = Array.from(new Set(npcIds));
  if (!uniqueNpcIds.length) {
    return new Map<string, RelationshipHistory>();
  }

  const [npcs, memoriesByNpcId] = await Promise.all([
    prisma.nPC.findMany({
      where: {
        campaignId,
        id: {
          in: uniqueNpcIds,
        },
      },
      select: { id: true, name: true },
    }),
    fetchNpcLinkedMemoriesById({
      campaignId,
      npcIds: uniqueNpcIds,
      take: 8,
      prioritizedKinds: ["relationship_shift", "promise", "conflict"],
    }),
  ]);

  return new Map(
    npcs.map((npc) => [
      npc.id,
      {
        npcId: npc.id,
        npcName: npc.name,
        memories: memoriesByNpcId.get(npc.id) ?? [],
      } satisfies RelationshipHistory,
    ]),
  );
}

export async function fetchNpcDetail(campaignId: string, npcId: string): Promise<NpcDetail | null> {
  return (await fetchNpcDetailsBulk(campaignId, [npcId])).get(npcId) ?? null;
}

export async function fetchMarketPrices(
  campaignId: string,
  locationId: string,
): Promise<MarketPriceDetail[]> {
  return (await fetchMarketPricesBulk(campaignId, [locationId])).get(locationId) ?? [];
}

export async function fetchFactionIntel(campaignId: string, factionId: string): Promise<FactionIntel | null> {
  return (await fetchFactionIntelBulk(campaignId, [factionId])).get(factionId) ?? null;
}

export async function fetchInformationDetail(
  campaignId: string,
  informationId: string,
): Promise<InformationDetail | null> {
  return (await fetchInformationDetailsBulk(campaignId, [informationId])).get(informationId) ?? null;
}

export async function fetchInformationConnections(
  campaignId: string,
  informationIds: string[],
): Promise<CrossLocationLead[]> {
  const key = informationIds.join("\u0000");
  return (await fetchInformationConnectionsBulk({
    campaignId,
    groups: [{ key, informationIds }],
  })).get(key) ?? [];
}

export async function fetchRelationshipHistory(
  campaignId: string,
  npcId: string,
): Promise<RelationshipHistory | null> {
  return (await fetchRelationshipHistoriesBulk(campaignId, [npcId])).get(npcId) ?? null;
}

function toTurnDigest(
  turn: Prisma.TurnGetPayload<Record<string, never>>,
): TurnDigest {
  const result = parseTurnResultPayloadJson(turn.resultJson);
  const narration =
    result && result.error == null && result.clarification == null
      ? typeof result.whatChanged[0] === "string"
        ? result.whatChanged[0]
        : null
      : null;

  return {
    turnId: turn.id,
    requestId: turn.requestId,
    status: turn.status,
    stateVersionAfter: turn.stateVersionAfter ?? result?.stateVersionAfter ?? null,
    narration,
    whatChanged: result?.whatChanged ?? [],
    why: result?.why ?? [],
    createdAt: turn.createdAt.toISOString(),
  };
}

function buildRelevantKnowledgeIds(input: {
  currentLocationId: string;
  presentNpcIds: string[];
  knownFactionIds: string[];
  locationKnowledge: Prisma.LocationKnowledgeGetPayload<Record<string, never>>[];
  factionKnowledge: Prisma.FactionKnowledgeGetPayload<Record<string, never>>[];
  npcKnowledge: Prisma.NpcKnowledgeGetPayload<Record<string, never>>[];
}) {
  const ids = new Set<string>();

  for (const knowledge of input.locationKnowledge) {
    if (knowledge.locationId === input.currentLocationId) {
      ids.add(knowledge.informationId);
    }
  }

  for (const knowledge of input.factionKnowledge) {
    if (input.knownFactionIds.includes(knowledge.factionId)) {
      ids.add(knowledge.informationId);
    }
  }

  for (const knowledge of input.npcKnowledge) {
    if (
      input.presentNpcIds.includes(knowledge.npcId)
      && knowledge.shareability !== "private"
    ) {
      ids.add(knowledge.informationId);
    }
  }

  return ids;
}

function buildActivePressures(input: {
  factions: Prisma.FactionGetPayload<Record<string, never>>[];
  knownFactionIds: Set<string>;
  currentLocation: LocationSummary;
}): ActivePressureSummary[] {
  const factionPressures = input.factions
    .filter((faction) => input.knownFactionIds.has(faction.id))
    .sort((left, right) => right.pressureClock - left.pressureClock)
    .slice(0, 4)
    .map<ActivePressureSummary>((faction) => ({
      entityType: "faction",
      entityId: faction.id,
      label: faction.name,
      summary: faction.agenda,
    }));

  if (input.currentLocation.state !== "active") {
    factionPressures.unshift({
      entityType: "location",
      entityId: input.currentLocation.id,
      label: input.currentLocation.name,
      summary: `The current area is ${input.currentLocation.state}.`,
    });
  }

  return factionPressures.slice(0, 4);
}

function buildRecentWorldShifts(
  turns: Array<Prisma.TurnGetPayload<Record<string, never>>>,
): WorldShiftSummary[] {
  return turns
    .map((turn) => ({
      turnId: turn.id,
      payload: parseTurnResultPayloadJson(turn.resultJson),
    }))
    .filter((entry): entry is { turnId: string; payload: NonNullable<ReturnType<typeof parseTurnResultPayloadJson>> } =>
      entry.payload != null && entry.payload.changeCodes.length > 0,
    )
    .slice(0, 4)
    .map((entry) => ({
      turnId: entry.turnId,
      summary: entry.payload.whatChanged[0] ?? "The world shifted.",
      changeCodes: entry.payload.changeCodes,
    }));
}

function buildActiveThreads(input: {
  memories: Array<Prisma.MemoryEntryGetPayload<{ include: { entityLinks: true } }>>;
  worldEvents: Prisma.WorldEventGetPayload<Record<string, never>>[];
  factionMoves: Prisma.FactionMoveGetPayload<Record<string, never>>[];
  currentLocationId: string;
  knownFactionIds: Set<string>;
}): ActiveThreadSummary[] {
  const memoryThreads = input.memories
    .filter((memory) => memory.isLongArcCandidate)
    .map((memory) => {
      const primary = memory.entityLinks.find((link) => link.isPrimary) ?? memory.entityLinks[0] ?? null;
      return {
        memoryId: memory.id,
        memoryKind: normalizeMemoryKind(memory.memoryKind),
        summary: memory.summary,
        isLongArcCandidate: memory.isLongArcCandidate,
        primaryEntityType: primary?.entityType as ActiveThreadSummary["primaryEntityType"],
        primaryEntityId: primary?.entityId ?? null,
      };
    })
    .slice(0, 4);

  const obligationThreads: ActiveThreadSummary[] = [];

  for (const event of input.worldEvents) {
    if (event.isProcessed || event.isCancelled || event.locationId !== input.currentLocationId) {
      continue;
    }

    obligationThreads.push({
      memoryId: `wevt:${event.id}`,
      memoryKind: "world_change",
      summary: event.description,
      isLongArcCandidate: true,
      primaryEntityType: "location",
      primaryEntityId: event.locationId,
    });
  }

  for (const move of input.factionMoves) {
    if (move.isExecuted || move.isCancelled || !input.knownFactionIds.has(move.factionId)) {
      continue;
    }

    obligationThreads.push({
      memoryId: `fmove:${move.id}`,
      memoryKind: "world_change",
      summary: move.description,
      isLongArcCandidate: true,
      primaryEntityType: "faction",
      primaryEntityId: move.factionId,
    });
  }

  return [...memoryThreads, ...obligationThreads].slice(0, 6);
}

function pickRetrievedMemories(input: {
  memories: Array<Prisma.MemoryEntryGetPayload<{ include: { entityLinks: true } }>>;
  currentLocationId: string;
  presentNpcIds: string[];
  knownFactionIds: string[];
  currentRouteIds: string[];
  discoveredInformationIds: string[];
  activePressures: ActivePressureSummary[];
  activeThreads: ActiveThreadSummary[];
}) {
  const currentEntityKeys = new Set<string>([
    `location:${input.currentLocationId}`,
    ...input.presentNpcIds.map((id) => `npc:${id}`),
    ...input.knownFactionIds.map((id) => `faction:${id}`),
    ...input.currentRouteIds.map((id) => `route:${id}`),
    ...input.discoveredInformationIds.map((id) => `information:${id}`),
  ]);
  const activePressureKeys = new Set(
    input.activePressures.map((pressure) => `${pressure.entityType}:${pressure.entityId}`),
  );
  const activeThreadKeys = new Set(
    input.activeThreads.map((thread) => `${thread.memoryKind}:${thread.memoryId}`),
  );
  const now = Date.now();

  return [...input.memories]
    .sort(
      (left, right) =>
        scoreRetrievedMemory({
          memory: right,
          currentEntityKeys,
          activePressureKeys,
          activeThreadKeys,
          now,
        })
        - scoreRetrievedMemory({
          memory: left,
          currentEntityKeys,
          activePressureKeys,
          activeThreadKeys,
          now,
        }),
    )
    .slice(0, 6);
}

export async function getCampaignSnapshot(campaignId: string): Promise<CampaignSnapshot | null> {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: {
      module: true,
      template: true,
      characterInstance: {
        include: {
          inventory: {
            orderBy: { createdAt: "asc" },
            include: { template: true },
          },
          commodityStacks: {
            orderBy: { createdAt: "asc" },
            include: { commodity: true },
          },
        },
      },
      sessions: {
        orderBy: { createdAt: "desc" },
        take: 1,
        include: {
          messages: {
            orderBy: { createdAt: "desc" },
            take: 20,
          },
        },
      },
      memories: {
        orderBy: { createdAt: "desc" },
        take: 32,
        include: {
          entityLinks: true,
        },
      },
      locationNodes: {
        orderBy: { name: "asc" },
      },
      locationEdges: {
        orderBy: { createdAt: "asc" },
      },
      factions: {
        orderBy: { name: "asc" },
      },
      factionRelations: {
        orderBy: { createdAt: "asc" },
      },
      npcs: {
        orderBy: { name: "asc" },
      },
      information: {
        orderBy: { title: "asc" },
      },
      informationLinks: {
        orderBy: { createdAt: "asc" },
      },
      npcKnowledge: true,
      factionKnowledge: true,
      locationKnowledge: true,
      worldEvents: {
        where: {
          isProcessed: false,
          isCancelled: false,
        },
        orderBy: { triggerTime: "desc" },
        take: 30,
      },
      factionMoves: {
        where: {
          isExecuted: false,
          isCancelled: false,
        },
        orderBy: { scheduledAtTime: "asc" },
        take: 30,
      },
      temporaryActors: {
        orderBy: [{ lastSeenAtTurn: "desc" }, { lastSeenAtTime: "desc" }, { id: "asc" }],
        take: 50,
      },
      turns: {
        where: { status: "resolved" },
        orderBy: { createdAt: "desc" },
        take: 8,
      },
    },
  });

  if (!campaign || !campaign.characterInstance || !campaign.sessions[0]) {
    return null;
  }

  const state = parseCampaignRuntimeStateJson(campaign.stateJson);
  const session = campaign.sessions[0];
  const currentLocationRecord = campaign.locationNodes.find((location) => location.id === state.currentLocationId);
  if (!currentLocationRecord) {
    return null;
  }

  const currentLocation = toLocationSummary(currentLocationRecord, campaign.factions);
  const adjacentRoutes = campaign.locationEdges
    .filter((edge) => edge.sourceId === currentLocation.id || edge.targetId === currentLocation.id)
    .map<RouteSummary>((edge) => {
      const targetId = edge.sourceId === currentLocation.id ? edge.targetId : edge.sourceId;
      const target = campaign.locationNodes.find((location) => location.id === targetId);

      return {
        id: edge.id,
        targetLocationId: targetId,
        targetLocationName: target?.name ?? targetId,
        travelTimeMinutes: edge.travelTimeMinutes,
        dangerLevel: edge.dangerLevel,
        currentStatus: edge.currentStatus,
        description: edge.description,
      };
    });

  const presentNpcs = campaign.npcs
    .filter((npc) => npc.currentLocationId === currentLocation.id)
    .map((npc) => toNpcSummary(npc, campaign.factions));

  const discoveredIds = new Set(
    campaign.information.filter((information) => information.isDiscovered).map((information) => information.id),
  );
  const knownFactionIds = new Set<string>();
  if (currentLocation.controllingFactionId) {
    knownFactionIds.add(currentLocation.controllingFactionId);
  }
  for (const npc of presentNpcs) {
    if (npc.factionId) {
      knownFactionIds.add(npc.factionId);
    }
  }
  const visibleKnowledgeIds = buildRelevantKnowledgeIds({
    currentLocationId: currentLocation.id,
    presentNpcIds: presentNpcs.map((npc) => npc.id),
    knownFactionIds: Array.from(knownFactionIds),
    locationKnowledge: campaign.locationKnowledge,
    factionKnowledge: campaign.factionKnowledge,
    npcKnowledge: campaign.npcKnowledge,
  });

  const localInformation = campaign.information
    .filter(
      (information) =>
        visibleKnowledgeIds.has(information.id)
        && (information.accessibility === "public" || discoveredIds.has(information.id)),
    )
    .map((information) =>
      toInformationSummary(information, campaign.locationNodes, campaign.factions, campaign.npcs),
    );

  const discoveredInformation = campaign.information
    .filter((information) => discoveredIds.has(information.id))
    .map((information) =>
      toInformationSummary(information, campaign.locationNodes, campaign.factions, campaign.npcs),
    );

  const connectedLeads = buildCrossLocationLeads({
    discoveredInformationIds: Array.from(discoveredIds),
    information: campaign.information,
    informationLinks: campaign.informationLinks,
    locations: campaign.locationNodes,
    factions: campaign.factions,
    npcs: campaign.npcs,
  });

  for (const information of [...localInformation, ...discoveredInformation, ...connectedLeads.map((lead) => lead.information)]) {
    if (information.factionId) {
      knownFactionIds.add(information.factionId);
    }
  }

  const knownFactions = campaign.factions
    .filter((faction) => knownFactionIds.has(faction.id))
    .map(toFactionSummary);
  const factionRelations = campaign.factionRelations
    .filter(
      (relation) => knownFactionIds.has(relation.factionAId) && knownFactionIds.has(relation.factionBId),
    )
    .map((relation) => toFactionRelationSummary(relation, campaign.factions));

  const instance: CharacterInstance = {
    id: campaign.characterInstance.id,
    templateId: campaign.characterInstance.templateId,
    health: campaign.characterInstance.health,
    gold: campaign.characterInstance.gold,
    inventory: campaign.characterInstance.inventory
      .map(toItemInstanceRecord)
      .filter((item) => !isArchivedInventoryProperties(item.properties)),
    commodityStacks: campaign.characterInstance.commodityStacks.map(toCommodityStackRecord),
  };

  const character = toCampaignCharacter(toTemplateRecord(campaign.template), instance);
  const activePressures = buildActivePressures({
    factions: campaign.factions,
    knownFactionIds,
    currentLocation,
  });
  const activeThreads = buildActiveThreads({
    memories: campaign.memories,
    worldEvents: campaign.worldEvents,
    factionMoves: campaign.factionMoves,
    currentLocationId: currentLocation.id,
    knownFactionIds,
  });
  const memories: MemoryRecord[] = pickRetrievedMemories({
    memories: campaign.memories,
    currentLocationId: currentLocation.id,
    presentNpcIds: presentNpcs.map((npc) => npc.id),
    knownFactionIds: Array.from(knownFactionIds),
    currentRouteIds: adjacentRoutes.map((route) => route.id),
    discoveredInformationIds: Array.from(discoveredIds),
    activePressures,
    activeThreads,
  }).map((memory) => toMemoryRecord(memory));
  const recentWorldShifts = buildRecentWorldShifts(campaign.turns);

  const recentMessages: StoryMessage[] = [...session.messages]
    .reverse()
    .map((message) => ({
      id: message.id,
      role: message.role as StoryMessage["role"],
      kind: message.kind as StoryMessage["kind"],
      content: message.content,
      createdAt: message.createdAt.toISOString(),
      payload:
        message.payload && typeof message.payload === "object" && !Array.isArray(message.payload)
          ? (structuredClone(message.payload) as Record<string, unknown>)
          : null,
    }));

  const temporaryActors = campaign.temporaryActors
    .filter((actor) => actor.promotedNpcId == null)
    .map(toTemporaryActorSummary);
  const knownNpcLocationIds = Object.fromEntries(
    campaign.npcs.map((npc) => [npc.id, npc.currentLocationId]),
  );
  const latestRetryableTurnId =
    env.enableTurnUndo && campaign.turns[0]?.sessionId === session.id
      ? campaign.turns[0]?.id ?? null
      : null;
  const canRetryLatestTurn =
    latestRetryableTurnId != null;

  return {
    campaignId: campaign.id,
    sessionId: session.id,
    sessionTurnCount: session.turnCount,
    stateVersion: campaign.stateVersion,
    generatedThroughDay: campaign.generatedThroughDay,
    moduleId: campaign.moduleId,
    selectedEntryPointId: campaign.selectedEntryPointId,
    title: state.customTitle ?? campaign.module.title,
    premise: campaign.module.premise,
    tone: campaign.module.tone,
    setting: campaign.module.setting,
    state,
    character: {
      ...character,
      stats: toCharacterStats(character),
    },
    currentLocation,
    adjacentRoutes,
    presentNpcs,
    knownNpcLocationIds,
    knownFactions,
    factionRelations,
    localInformation,
    discoveredInformation,
    connectedLeads,
    temporaryActors,
    memories,
    activePressures,
    recentWorldShifts,
    activeThreads,
    recentMessages,
    canRetryLatestTurn,
    latestRetryableTurnId,
  };
}

export async function getTurnSnapshot(
  campaignId: string,
  sessionId: string,
): Promise<CampaignSnapshot | null> {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: {
      module: true,
      template: true,
      characterInstance: {
        include: {
          inventory: {
            orderBy: { createdAt: "asc" },
            include: { template: true },
          },
          commodityStacks: {
            orderBy: { createdAt: "asc" },
            include: { commodity: true },
          },
        },
      },
      sessions: {
        where: { id: sessionId },
        take: 1,
        include: {
          messages: {
            orderBy: { createdAt: "desc" },
            take: 20,
          },
        },
      },
      memories: {
        orderBy: { createdAt: "desc" },
        take: 32,
        include: {
          entityLinks: true,
        },
      },
      turns: {
        where: { status: "resolved" },
        orderBy: { createdAt: "desc" },
        take: 8,
      },
    },
  });

  if (!campaign || !campaign.characterInstance || !campaign.sessions[0]) {
    return null;
  }

  const state = parseCampaignRuntimeStateJson(campaign.stateJson);
  const session = campaign.sessions[0];

  const currentLocationRecord = await prisma.locationNode.findFirst({
    where: {
      campaignId,
      id: state.currentLocationId,
    },
  });
  const adjacentEdges = await prisma.locationEdge.findMany({
    where: {
      campaignId,
      OR: [{ sourceId: state.currentLocationId }, { targetId: state.currentLocationId }],
    },
    orderBy: { createdAt: "asc" },
  });
  const presentNpcRecords = await prisma.nPC.findMany({
    where: {
      campaignId,
      currentLocationId: state.currentLocationId,
    },
    orderBy: { name: "asc" },
  });
  const offscreenNpcRecords = await prisma.nPC.findMany({
    where: {
      campaignId,
      currentLocationId: null,
    },
    orderBy: { name: "asc" },
  });
  const temporaryActorRecords = await prisma.temporaryActor.findMany({
    where: {
      campaignId,
      promotedNpcId: null,
      OR: [
        { currentLocationId: state.currentLocationId },
        { currentLocationId: null },
      ],
    },
    orderBy: [{ lastSeenAtTurn: "desc" }, { lastSeenAtTime: "desc" }, { id: "asc" }],
    take: 50,
  });
  const discoveredInfoRecords = await prisma.information.findMany({
    where: {
      campaignId,
      isDiscovered: true,
    },
    orderBy: { title: "asc" },
  });

  if (!currentLocationRecord) {
    return null;
  }

  const baseKnownFactionIds = new Set<string>();
  if (currentLocationRecord.controllingFactionId) {
    baseKnownFactionIds.add(currentLocationRecord.controllingFactionId);
  }
  for (const npc of presentNpcRecords) {
    if (npc.factionId) {
      baseKnownFactionIds.add(npc.factionId);
    }
  }

  const locationKnowledge = await prisma.locationKnowledge.findMany({
    where: {
      campaignId,
      locationId: state.currentLocationId,
    },
  });
  const factionKnowledge = baseKnownFactionIds.size
    ? await prisma.factionKnowledge.findMany({
        where: {
          campaignId,
          factionId: {
            in: Array.from(baseKnownFactionIds),
          },
        },
      })
    : [];
  const npcKnowledge = presentNpcRecords.length
    ? await prisma.npcKnowledge.findMany({
        where: {
          campaignId,
          npcId: {
            in: presentNpcRecords.map((npc) => npc.id),
          },
          shareability: {
            not: "private",
          },
        },
      })
    : [];

  const discoveredIds = new Set(discoveredInfoRecords.map((information) => information.id));
  const visibleKnowledgeIds = buildRelevantKnowledgeIds({
    currentLocationId: state.currentLocationId,
    presentNpcIds: presentNpcRecords.map((npc) => npc.id),
    knownFactionIds: Array.from(baseKnownFactionIds),
    locationKnowledge,
    factionKnowledge,
    npcKnowledge,
  });

  const firstHopLinks = discoveredIds.size
    ? await prisma.informationLink.findMany({
        where: {
          campaignId,
          sourceId: {
            in: Array.from(discoveredIds),
          },
        },
        orderBy: { createdAt: "asc" },
      })
    : [];
  const firstHopIds = Array.from(new Set(firstHopLinks.map((link) => link.targetId)));
  const secondHopLinks = firstHopIds.length
    ? await prisma.informationLink.findMany({
        where: {
          campaignId,
          sourceId: {
            in: firstHopIds,
          },
        },
        orderBy: { createdAt: "asc" },
      })
    : [];

  const relevantInformationIds = Array.from(new Set([
    ...Array.from(discoveredIds),
    ...Array.from(visibleKnowledgeIds),
    ...firstHopIds,
    ...secondHopLinks.map((link) => link.targetId),
  ]));
  const relevantInformationRecords = relevantInformationIds.length
    ? await prisma.information.findMany({
        where: {
          campaignId,
          id: {
            in: relevantInformationIds,
          },
        },
        orderBy: { title: "asc" },
      })
    : [];

  const adjacentLocationIds = Array.from(
    new Set(
      adjacentEdges.map((edge) =>
        edge.sourceId === state.currentLocationId ? edge.targetId : edge.sourceId,
      ),
    ),
  );
  const relevantLocationIds = Array.from(new Set([
    state.currentLocationId,
    ...adjacentLocationIds,
    ...relevantInformationRecords.flatMap((information) => (information.locationId ? [information.locationId] : [])),
  ]));
  const relevantFactionIds = Array.from(new Set([
    ...Array.from(baseKnownFactionIds),
    ...relevantInformationRecords.flatMap((information) => (information.factionId ? [information.factionId] : [])),
  ]));
  const relevantNpcIds = Array.from(new Set([
    ...presentNpcRecords.map((npc) => npc.id),
    ...relevantInformationRecords.flatMap((information) => (information.sourceNpcId ? [information.sourceNpcId] : [])),
  ]));

  const locationRecords = relevantLocationIds.length
    ? await prisma.locationNode.findMany({
        where: {
          campaignId,
          id: {
            in: relevantLocationIds,
          },
        },
      })
    : [];
  const factionRecords = relevantFactionIds.length
    ? await prisma.faction.findMany({
        where: {
          campaignId,
          id: {
            in: relevantFactionIds,
          },
        },
        orderBy: { name: "asc" },
      })
    : [];
  const sourceNpcRecords = relevantNpcIds.length
    ? await prisma.nPC.findMany({
        where: {
          campaignId,
          id: {
            in: relevantNpcIds,
          },
        },
        orderBy: { name: "asc" },
      })
    : [];

  const currentLocation = toLocationSummary(currentLocationRecord, factionRecords);
  const adjacentRoutes = adjacentEdges.map<RouteSummary>((edge) => {
    const targetId = edge.sourceId === currentLocation.id ? edge.targetId : edge.sourceId;
    const target = locationRecords.find((location) => location.id === targetId);

    return {
      id: edge.id,
      targetLocationId: targetId,
      targetLocationName: target?.name ?? targetId,
      travelTimeMinutes: edge.travelTimeMinutes,
      dangerLevel: edge.dangerLevel,
      currentStatus: edge.currentStatus,
      description: edge.description,
    };
  });
  const presentNpcs = presentNpcRecords.map((npc) => toNpcSummary(npc, factionRecords));
  const knownNpcLocationIds = Object.fromEntries(
    [...presentNpcRecords, ...offscreenNpcRecords].map((npc) => [npc.id, npc.currentLocationId]),
  );

  const localInformation = relevantInformationRecords
    .filter(
      (information) =>
        visibleKnowledgeIds.has(information.id)
        && (information.accessibility === "public" || discoveredIds.has(information.id)),
    )
    .map((information) =>
      toInformationSummary(information, locationRecords, factionRecords, sourceNpcRecords),
    );
  const discoveredInformation = discoveredInfoRecords.map((information) =>
    toInformationSummary(information, locationRecords, factionRecords, sourceNpcRecords),
  );
  const connectedLeads = buildCrossLocationLeads({
    discoveredInformationIds: Array.from(discoveredIds),
    information: relevantInformationRecords,
    informationLinks: [...firstHopLinks, ...secondHopLinks],
    locations: locationRecords,
    factions: factionRecords,
    npcs: sourceNpcRecords,
  });

  const knownFactionIds = new Set(relevantFactionIds);
  for (const information of [
    ...localInformation,
    ...discoveredInformation,
    ...connectedLeads.map((lead) => lead.information),
  ]) {
    if (information.factionId) {
      knownFactionIds.add(information.factionId);
    }
  }

  const knownFactionRecords = knownFactionIds.size
    ? await prisma.faction.findMany({
        where: {
          campaignId,
          id: {
            in: Array.from(knownFactionIds),
          },
        },
        orderBy: { name: "asc" },
      })
    : [];
  const factionRelations = knownFactionIds.size
    ? await prisma.factionRelation.findMany({
        where: {
          campaignId,
          factionAId: {
            in: Array.from(knownFactionIds),
          },
          factionBId: {
            in: Array.from(knownFactionIds),
          },
        },
        orderBy: { createdAt: "asc" },
      })
    : [];
  const pendingWorldEvents = await prisma.worldEvent.findMany({
    where: {
      campaignId,
      locationId: state.currentLocationId,
      isProcessed: false,
      isCancelled: false,
    },
    orderBy: { triggerTime: "desc" },
    take: 30,
  });
  const pendingFactionMoves = knownFactionIds.size
    ? await prisma.factionMove.findMany({
        where: {
          campaignId,
          factionId: {
            in: Array.from(knownFactionIds),
          },
          isExecuted: false,
          isCancelled: false,
        },
        orderBy: { scheduledAtTime: "asc" },
        take: 30,
      })
    : [];

  const knownFactions = knownFactionRecords.map(toFactionSummary);
  const normalizedFactionRecords = knownFactionRecords.length ? knownFactionRecords : factionRecords;
  const normalizedFactionRelations = factionRelations.map((relation) =>
    toFactionRelationSummary(relation, normalizedFactionRecords),
  );

  const instance: CharacterInstance = {
    id: campaign.characterInstance.id,
    templateId: campaign.characterInstance.templateId,
    health: campaign.characterInstance.health,
    gold: campaign.characterInstance.gold,
    inventory: campaign.characterInstance.inventory
      .map(toItemInstanceRecord)
      .filter((item) => !isArchivedInventoryProperties(item.properties)),
    commodityStacks: campaign.characterInstance.commodityStacks.map(toCommodityStackRecord),
  };
  const character = toCampaignCharacter(toTemplateRecord(campaign.template), instance);
  const activePressures = buildActivePressures({
    factions: normalizedFactionRecords,
    knownFactionIds,
    currentLocation,
  });
  const activeThreads = buildActiveThreads({
    memories: campaign.memories,
    worldEvents: pendingWorldEvents,
    factionMoves: pendingFactionMoves,
    currentLocationId: currentLocation.id,
    knownFactionIds,
  });
  const memories: MemoryRecord[] = pickRetrievedMemories({
    memories: campaign.memories,
    currentLocationId: currentLocation.id,
    presentNpcIds: presentNpcs.map((npc) => npc.id),
    knownFactionIds: Array.from(knownFactionIds),
    currentRouteIds: adjacentRoutes.map((route) => route.id),
    discoveredInformationIds: Array.from(discoveredIds),
    activePressures,
    activeThreads,
  }).map((memory) => toMemoryRecord(memory));
  const recentWorldShifts = buildRecentWorldShifts(campaign.turns);
  const recentMessages: StoryMessage[] = [...session.messages]
    .reverse()
    .map((message) => ({
      id: message.id,
      role: message.role as StoryMessage["role"],
      kind: message.kind as StoryMessage["kind"],
      content: message.content,
      createdAt: message.createdAt.toISOString(),
      payload:
        message.payload && typeof message.payload === "object" && !Array.isArray(message.payload)
          ? (structuredClone(message.payload) as Record<string, unknown>)
          : null,
    }));
  const temporaryActors = temporaryActorRecords.map(toTemporaryActorSummary);
  const latestRetryableTurnId =
    env.enableTurnUndo && campaign.turns[0]?.sessionId === session.id
      ? campaign.turns[0]?.id ?? null
      : null;
  const canRetryLatestTurn =
    latestRetryableTurnId != null;

  return {
    campaignId: campaign.id,
    sessionId: session.id,
    sessionTurnCount: session.turnCount,
    stateVersion: campaign.stateVersion,
    generatedThroughDay: campaign.generatedThroughDay,
    moduleId: campaign.moduleId,
    selectedEntryPointId: campaign.selectedEntryPointId,
    title: state.customTitle ?? campaign.module.title,
    premise: campaign.module.premise,
    tone: campaign.module.tone,
    setting: campaign.module.setting,
    state,
    character: {
      ...character,
      stats: toCharacterStats(character),
    },
    currentLocation,
    adjacentRoutes,
    presentNpcs,
    knownNpcLocationIds,
    knownFactions,
    factionRelations: normalizedFactionRelations,
    localInformation,
    discoveredInformation,
    connectedLeads,
    temporaryActors,
    memories,
    activePressures,
    recentWorldShifts,
    activeThreads,
    recentMessages,
    canRetryLatestTurn,
    latestRetryableTurnId,
  };
}

export async function getMissedTurnDigests(
  campaignId: string,
  expectedStateVersion: number,
): Promise<TurnDigest[]> {
  const turns = await prisma.turn.findMany({
    where: {
      campaignId,
      stateVersionAfter: {
        gt: expectedStateVersion,
      },
      status: "resolved",
    },
    orderBy: { stateVersionAfter: "asc" },
  });

  return turns.map((turn) => toTurnDigest(turn));
}

export function toPlayerCampaignSnapshot(snapshot: CampaignSnapshot): PlayerCampaignSnapshot {
  return {
    campaignId: snapshot.campaignId,
    sessionId: snapshot.sessionId,
    stateVersion: snapshot.stateVersion,
    generatedThroughDay: snapshot.generatedThroughDay,
    moduleId: snapshot.moduleId,
    selectedEntryPointId: snapshot.selectedEntryPointId,
    title: snapshot.title,
    premise: snapshot.premise,
    tone: snapshot.tone,
    setting: snapshot.setting,
    state: snapshot.state,
    character: snapshot.character,
    currentLocation: snapshot.currentLocation,
    adjacentRoutes: snapshot.adjacentRoutes,
    presentNpcs: snapshot.presentNpcs,
    knownFactions: snapshot.knownFactions,
    localInformation: snapshot.localInformation,
    discoveredInformation: snapshot.discoveredInformation,
    temporaryActors: snapshot.temporaryActors,
    memories: snapshot.memories,
    activePressures: snapshot.activePressures,
    recentWorldShifts: snapshot.recentWorldShifts,
    activeThreads: snapshot.activeThreads,
    recentMessages: snapshot.recentMessages,
    canRetryLatestTurn: snapshot.canRetryLatestTurn,
    latestRetryableTurnId: snapshot.latestRetryableTurnId,
  };
}

function timeOfDay(globalTime: number) {
  const minuteOfDay = ((globalTime % 1440) + 1440) % 1440;
  if (minuteOfDay < 360) return "night";
  if (minuteOfDay < 720) return "morning";
  if (minuteOfDay < 1080) return "afternoon";
  if (minuteOfDay < 1260) return "evening";
  return "night";
}

function buildRecentTurnLedger(snapshot: CampaignSnapshot) {
  const recentEntries = snapshot.recentMessages
    .filter((message) => message.role !== "system")
    .slice(-8);

  return recentEntries.map((message) => {
    const speaker =
      message.role === "user" ? "You" : message.role === "assistant" ? "DM" : "System";
    return `[${speaker}] ${message.content}`;
  });
}

async function loadRecentLocalEvents(snapshot: CampaignSnapshot) {
  const recentLocalEvents: RecentLocalEventSummary[] = [];
  const now = snapshot.state.globalTime;
  const worldEventRecords = await prisma.worldEvent.findMany({
    where: {
      campaignId: snapshot.campaignId,
      locationId: snapshot.currentLocation.id,
      triggerTime: {
        lte: now,
        gte: Math.max(0, now - 60),
      },
      isProcessed: true,
      isCancelled: false,
    },
    orderBy: { triggerTime: "desc" },
    take: 5,
  });

  for (const event of worldEventRecords) {
    recentLocalEvents.push({
      id: event.id,
      description: event.description,
      locationId: event.locationId,
      triggerTime: event.triggerTime,
      minutesAgo: Math.max(0, now - event.triggerTime),
    });
  }

  return recentLocalEvents;
}

export async function getTurnRouterContext(snapshot: CampaignSnapshot): Promise<TurnRouterContext> {
  const sceneFocus = snapshot.state.sceneFocus ?? null;
  return {
    currentLocation: {
      id: snapshot.currentLocation.id,
      name: snapshot.currentLocation.name,
      type: snapshot.currentLocation.type,
      summary: snapshot.currentLocation.summary,
      state: snapshot.currentLocation.state,
    },
    sceneFocus,
    adjacentRoutes: snapshot.adjacentRoutes,
    sceneActors: filterSceneActorsForFocus(
      toSceneActorSummaries({
        presentNpcs: snapshot.presentNpcs,
        temporaryActors: snapshot.temporaryActors,
        currentLocationId: snapshot.currentLocation.id,
      }),
      sceneFocus,
    ).slice(0, sceneFocus ? 4 : 8),
    recentLocalEvents: await loadRecentLocalEvents(snapshot),
    recentTurnLedger: buildRecentTurnLedger(snapshot),
    discoveredInformation: snapshot.discoveredInformation.map((information) => ({
      id: information.id,
      title: information.title,
      summary: information.summary,
      truthfulness: information.truthfulness,
    })),
    activePressures: snapshot.activePressures,
    activeThreads: snapshot.activeThreads,
    inventory: toRouterInventorySummary(snapshot.character),
    sceneAspects: toRouterSceneAspectSummaries({
      ...snapshot.state,
      sceneAspects: filterSceneAspectsForFocus(snapshot.state.sceneAspects ?? {}, sceneFocus),
    }),
    gold: snapshot.character.gold,
  };
}

export async function getPromptContext(
  snapshot: CampaignSnapshot,
  profile: PromptContextProfile = "full",
  routerDecision?: RouterDecision,
): Promise<SpatialPromptContext> {
  const routerContext = await getTurnRouterContext(snapshot);
  const promptSceneFocus = effectivePromptSceneFocus({
    sceneFocus: snapshot.state.sceneFocus ?? null,
    routerDecision,
  });
  const focusedSceneActors = filterSceneActorsForFocus(
    toSceneActorSummaries({
      presentNpcs: snapshot.presentNpcs,
      temporaryActors: snapshot.temporaryActors,
      currentLocationId: snapshot.currentLocation.id,
    }),
    promptSceneFocus,
  );
  const campaignItemTemplates = await prisma.itemTemplate.findMany({
    where: { campaignId: snapshot.campaignId },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      description: true,
    },
  });
  const isLocal = profile === "local";

  const promptContext = {
    currentLocation: routerContext.currentLocation,
    sceneFocus: snapshot.state.sceneFocus ?? null,
    adjacentRoutes: isLocal ? [] : routerContext.adjacentRoutes,
    sceneActors: focusedSceneActors,
    recentLocalEvents: routerContext.recentLocalEvents,
    recentTurnLedger: routerContext.recentTurnLedger,
    discoveredInformation: isLocal ? [] : routerContext.discoveredInformation,
    activePressures: isLocal ? [] : routerContext.activePressures,
    recentWorldShifts: isLocal ? [] : snapshot.recentWorldShifts,
    activeThreads: isLocal ? [] : routerContext.activeThreads,
    inventory: toPromptInventory(snapshot.character, campaignItemTemplates),
    sceneAspects: filterSceneAspectsForFocus(
      structuredClone(snapshot.state.sceneAspects ?? {}),
      promptSceneFocus,
    ),
    localTexture: snapshot.currentLocation.localTexture,
    globalTime: snapshot.state.globalTime,
    timeOfDay: timeOfDay(snapshot.state.globalTime),
    dayCount: Math.floor(snapshot.state.globalTime / 1440) + 1,
  };

  return prunePromptContextForRouter({
    promptContext,
    profile,
    routerDecision,
  });
}

export const repositoryTestUtils = {
  prunePromptContextForRouter,
  toRouterInventorySummary,
  toRouterSceneAspectSummaries,
  effectivePromptSceneFocus,
  filterSceneActorsForFocus,
  filterSceneAspectsForFocus,
  buildRecentTurnLedger,
  createFallbackResolvedLaunchEntry,
  normalizeLaunchEntrySelection,
  resolveStockLaunchEntry,
  stripScopedEntityId,
  findSimilarStockEntry,
  assignStartingLocalNpcIds,
  buildOpeningWorldWithStartingLocals,
  rescopeOpeningToCampaign,
  preparedLaunchMatchesSelection,
  toPlayerCampaignSnapshot,
};
