import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { dmClient } from "@/lib/ai/provider";
import { toCampaignCharacter, toCharacterStats } from "@/lib/game/characters";
import { createAdHocCampaignInventoryItem } from "@/lib/game/items";
import {
  generatedWorldModuleSchema,
  openWorldGenerationArtifactsSchema,
} from "@/lib/game/session-zero";
import { instanceWorldForCampaign } from "@/lib/game/world-instancing";
import { env } from "@/lib/env";
import type {
  AdventureModuleDetail,
  AdventureModuleSummary,
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
  GeneratedWorldModule,
  InformationDetail,
  InformationSummary,
  LocalTextureSummary,
  LocationSummary,
  MarketPriceDetail,
  MemoryRecord,
  NpcDetail,
  OpenWorldGenerationArtifacts,
  NpcSummary,
  PlayerCampaignSnapshot,
  PromptInventoryItem,
  RelationshipHistory,
  RecentLocalEventSummary,
  RouteSummary,
  SpatialPromptContext,
  StoryMessage,
  TemporaryActorSummary,
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

function toPrismaJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
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
    id: scopeEntityId(campaignId, "npc", `npc_local_${index + 1}_${randomUUID()}`),
  }));
}

function buildOpeningWorldWithStartingLocals(input: {
  module: GeneratedWorldModule;
  entryPoint: GeneratedWorldModule["entryPoints"][number];
  startingLocals: GeneratedWorldModule["npcs"];
}) {
  const startLocationNpcIds = input.startingLocals
    .filter((npc) => npc.currentLocationId === input.entryPoint.startLocationId)
    .map((npc) => npc.id);

  return {
    module: {
      ...input.module,
      npcs: [...input.module.npcs, ...input.startingLocals],
    },
    entryPoint: {
      ...input.entryPoint,
      presentNpcIds: Array.from(new Set([...input.entryPoint.presentNpcIds, ...startLocationNpcIds])),
    },
  };
}

async function generateStartingHydratedNpcs(input: {
  world: GeneratedWorldModule;
  entryPoint: GeneratedWorldModule["entryPoints"][number];
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

function toPromptInventory(character: CharacterInstance): PromptInventoryItem[] {
  return [
    ...character.inventory.map((item) => ({
      kind: "item" as const,
      id: item.id,
      name: item.template.name,
      description: item.template.description,
    })),
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

export async function ensureLocalUser() {
  return prisma.user.upsert({
    where: { email: "solo@adventure.local" },
    update: {},
    create: {
      email: "solo@adventure.local",
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
  entryPointId: string;
  prompt?: string;
  previousDraft?: GeneratedCampaignOpening;
}) {
  const user = await ensureLocalUser();
  const [module, template] = await Promise.all([
    prisma.adventureModule.findFirst({
      where: { id: input.moduleId, userId: user.id },
    }),
    prisma.characterTemplate.findFirst({
      where: { id: input.templateId, userId: user.id },
    }),
  ]);

  if (!module) {
    return { error: "module_not_found" as const };
  }

  if (!template) {
    return { error: "template_not_found" as const };
  }

  const world = parseWorldTemplate(module.openWorldTemplateJson);
  const generationArtifacts = parseOpenWorldGenerationArtifacts(module.openWorldGenerationArtifactsJson);
  const entryPoint = world.entryPoints.find((entry) => entry.id === input.entryPointId);

  if (!entryPoint) {
    throw new Error("Entry point not found on selected module.");
  }

  const previewCampaignId = `preview_${randomUUID()}`;
  const { world: previewWorld, entryPoint: previewEntryPoint } = instanceWorldForCampaign(
    previewCampaignId,
    world,
    input.entryPointId,
  );
  const character = toTemplateRecord(template);
  const preliminaryOpening = await dmClient.generateCampaignOpening({
    module: previewWorld,
    character,
    entryPoint: previewEntryPoint,
    artifacts: generationArtifacts,
    prompt: input.prompt,
    previousDraft: input.previousDraft,
  });
  const hydratedStartingNpcs = assignStartingLocalNpcIds(
    previewCampaignId,
    await generateStartingHydratedNpcs({
      world: previewWorld,
      entryPoint: previewEntryPoint,
      template: character,
      opening: preliminaryOpening,
    }),
  );
  const openingInput = buildOpeningWorldWithStartingLocals({
    module: previewWorld,
    entryPoint: previewEntryPoint,
    startingLocals: hydratedStartingNpcs,
  });
  const draft = await dmClient.generateCampaignOpening({
    module: openingInput.module,
    character,
    entryPoint: openingInput.entryPoint,
    artifacts: generationArtifacts,
    prompt: input.prompt,
    previousDraft: preliminaryOpening,
  });

  return { draft };
}

async function createCampaignInTx(
  tx: Prisma.TransactionClient,
  input: {
    campaignId: string;
    userId: string;
    module: Prisma.AdventureModuleGetPayload<Record<string, never>>;
    template: CharacterTemplate;
    entryPointId: string;
    opening: GeneratedCampaignOpening;
    instancedWorld: GeneratedWorldModule;
    instancedEntryPoint: GeneratedWorldModule["entryPoints"][number];
    hydratedStartingNpcs: GeneratedWorldModule["npcs"];
    locationTextures: Map<string, LocalTextureSummary>;
  },
) {
  const campaign = await tx.campaign.create({
    data: {
      id: input.campaignId,
      userId: input.userId,
      moduleId: input.module.id,
      templateId: input.template.id,
      moduleSchemaVersion: input.module.schemaVersion,
      selectedEntryPointId: input.entryPointId,
      stateJson: {
        currentLocationId: "",
        globalTime: 480,
        pendingTurnId: null,
        lastActionSummary: input.opening.activeThreat,
      } satisfies CampaignRuntimeState,
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

  const state: CampaignRuntimeState = {
    currentLocationId: input.instancedEntryPoint.startLocationId,
    globalTime: 480,
    pendingTurnId: null,
    lastActionSummary: input.opening.activeThreat,
  };

  if (input.instancedWorld.factions.length) {
    await tx.faction.createMany({
      data: input.instancedWorld.factions.map((faction) => ({
        id: faction.id,
        campaignId: campaign.id,
        name: faction.name,
        type: faction.type,
        summary: faction.summary,
        agenda: faction.agenda,
        resources: faction.resources,
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
    hydrationClaimedAt: null,
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
          hydrationClaimedAt: null,
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
      stateJson: state,
    },
  });

  return {
    campaignId: campaign.id,
    sessionId: campaign.sessions[0].id,
  };
}

export async function createCampaignFromModuleForUser(input: {
  moduleId: string;
  templateId: string;
  entryPointId: string;
  opening?: GeneratedCampaignOpening;
}) {
  const user = await ensureLocalUser();
  const [module, template] = await Promise.all([
    prisma.adventureModule.findFirst({
      where: { id: input.moduleId, userId: user.id },
    }),
    prisma.characterTemplate.findFirst({
      where: { id: input.templateId, userId: user.id },
    }),
  ]);

  if (!module) {
    return { error: "module_not_found" as const };
  }

  if (!template) {
    return { error: "template_not_found" as const };
  }

  const world = parseWorldTemplate(module.openWorldTemplateJson);
  const generationArtifacts = parseOpenWorldGenerationArtifacts(module.openWorldGenerationArtifactsJson);
  const entryPoint = world.entryPoints.find((entry) => entry.id === input.entryPointId);
  if (!entryPoint) {
    throw new Error("Selected entry point was not found.");
  }

  const templateRecord = toTemplateRecord(template);
  const campaignId = `camp_${randomUUID()}`;
  const { world: instancedWorld, entryPoint: instancedEntryPoint } = instanceWorldForCampaign(
    campaignId,
    world,
    input.entryPointId,
  );
  const preliminaryOpening =
    input.opening ??
    (await dmClient.generateCampaignOpening({
      module: instancedWorld,
      character: templateRecord,
      entryPoint: instancedEntryPoint,
      artifacts: generationArtifacts,
    }));
  const hydratedStartingNpcs = assignStartingLocalNpcIds(
    campaignId,
    await generateStartingHydratedNpcs({
      world: instancedWorld,
      entryPoint: instancedEntryPoint,
      template: templateRecord,
      opening: preliminaryOpening,
    }),
  );
  const openingInput = buildOpeningWorldWithStartingLocals({
    module: instancedWorld,
    entryPoint: instancedEntryPoint,
    startingLocals: hydratedStartingNpcs,
  });
  const opening = await dmClient.generateCampaignOpening({
    module: openingInput.module,
    character: templateRecord,
    entryPoint: openingInput.entryPoint,
    artifacts: generationArtifacts,
    previousDraft: input.opening ?? preliminaryOpening,
  });
  const locationTextures = buildLocationTextureMap(generationArtifacts, campaignId);

  const result = await prisma.$transaction((tx) =>
    createCampaignInTx(tx, {
      campaignId,
      userId: user.id,
      module,
      template: templateRecord,
      entryPointId: input.entryPointId,
      opening,
      instancedWorld,
      instancedEntryPoint,
      hydratedStartingNpcs,
      locationTextures,
    }),
  );

  return { campaignId: result.campaignId };
}

export async function listCampaigns(): Promise<CampaignListItem[]> {
  const campaigns = await prisma.campaign.findMany({
    orderBy: { updatedAt: "desc" },
    include: {
      module: true,
      template: true,
    },
  });

  if (!campaigns.length) {
    return [];
  }

  const locationRecords = await prisma.locationNode.findMany({
    where: {
      OR: campaigns.map((campaign) => ({
        campaignId: campaign.id,
        id: (campaign.stateJson as CampaignRuntimeState).currentLocationId,
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
    return {
      id: campaign.id,
      title: campaign.module.title,
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

export async function fetchNpcDetail(campaignId: string, npcId: string): Promise<NpcDetail | null> {
  const [npc, factions, information, memories, temporaryActor] = await Promise.all([
    prisma.nPC.findFirst({
      where: { id: npcId, campaignId },
    }),
    prisma.faction.findMany({
      where: { campaignId },
    }),
    prisma.information.findMany({
      where: {
        campaignId,
        OR: [{ sourceNpcId: npcId }, { isDiscovered: true }],
      },
      orderBy: { title: "asc" },
      take: 12,
    }),
    prisma.memoryEntry.findMany({
      where: {
        campaignId,
        summary: {
          contains: npcId,
          mode: "insensitive",
        },
      },
      orderBy: { createdAt: "desc" },
      take: 8,
    }),
    prisma.temporaryActor.findFirst({
      where: {
        campaignId,
        promotedNpcId: npcId,
      },
    }),
  ]);

  if (!npc) {
    return null;
  }

  const locations = await prisma.locationNode.findMany({
    where: { campaignId },
  });
  const npcs = await prisma.nPC.findMany({
    where: { campaignId },
  });

  return {
    ...toNpcSummary(npc, factions),
    knownInformation: information.map((entry) =>
      toInformationSummary(entry, locations, factions, npcs),
    ),
    relationshipHistory: memories.map((memory) => ({
      id: memory.id,
      type: memory.type,
      summary: memory.summary,
      createdAt: memory.createdAt.toISOString(),
    })),
    temporaryActorId: temporaryActor?.id ?? null,
  };
}

export async function fetchMarketPrices(
  campaignId: string,
  locationId: string,
): Promise<MarketPriceDetail[]> {
  const [location, prices] = await Promise.all([
    prisma.locationNode.findFirst({
      where: { id: locationId, campaignId },
      select: { id: true, name: true },
    }),
    prisma.marketPrice.findMany({
      where: { campaignId, locationId },
      include: {
        commodity: true,
        vendorNpc: true,
      },
      orderBy: [{ commodity: { name: "asc" } }, { createdAt: "asc" }],
    }),
  ]);

  if (!location) {
    return [];
  }

  return prices.map((price) => ({
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
  }));
}

export async function fetchFactionIntel(campaignId: string, factionId: string): Promise<FactionIntel | null> {
  const [faction, factions, relations, moves, locations] = await Promise.all([
    prisma.faction.findFirst({
      where: { id: factionId, campaignId },
    }),
    prisma.faction.findMany({
      where: { campaignId },
    }),
    prisma.factionRelation.findMany({
      where: {
        campaignId,
        OR: [{ factionAId: factionId }, { factionBId: factionId }],
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.factionMove.findMany({
      where: {
        campaignId,
        factionId,
      },
      orderBy: { scheduledAtTime: "asc" },
      take: 8,
    }),
    prisma.locationNode.findMany({
      where: {
        campaignId,
        controllingFactionId: factionId,
      },
      select: { id: true },
    }),
  ]);

  if (!faction) {
    return null;
  }

  return {
    ...toFactionSummary(faction),
    relations: relations.map((relation) => toFactionRelationSummary(relation, factions)),
    visibleMoves: moves.map<FactionMoveSummary>((move) => ({
      id: move.id,
      description: move.description,
      scheduledAtTime: move.scheduledAtTime,
      isExecuted: move.isExecuted,
      isCancelled: move.isCancelled,
      cancellationReason: move.cancellationReason,
    })),
    controlledLocationIds: locations.map((location) => location.id),
  };
}

export async function fetchInformationDetail(
  campaignId: string,
  informationId: string,
): Promise<InformationDetail | null> {
  const [information, locations, factions, npcs] = await Promise.all([
    prisma.information.findFirst({
      where: { id: informationId, campaignId, isDiscovered: true },
    }),
    prisma.locationNode.findMany({
      where: { campaignId },
    }),
    prisma.faction.findMany({
      where: { campaignId },
    }),
    prisma.nPC.findMany({
      where: { campaignId },
    }),
  ]);

  if (!information) {
    return null;
  }

  return {
    ...toInformationSummary(information, locations, factions, npcs),
    content: information.content,
  };
}

export async function fetchInformationConnections(
  campaignId: string,
  informationIds: string[],
): Promise<CrossLocationLead[]> {
  const [information, informationLinks, locations, factions, npcs] = await Promise.all([
    prisma.information.findMany({
      where: {
        campaignId,
      },
      orderBy: { title: "asc" },
    }),
    prisma.informationLink.findMany({
      where: {
        campaignId,
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.locationNode.findMany({
      where: { campaignId },
    }),
    prisma.faction.findMany({
      where: { campaignId },
    }),
    prisma.nPC.findMany({
      where: { campaignId },
    }),
  ]);

  return buildCrossLocationLeads({
    discoveredInformationIds: informationIds,
    information,
    informationLinks,
    locations,
    factions,
    npcs,
  });
}

export async function fetchRelationshipHistory(
  campaignId: string,
  npcId: string,
): Promise<RelationshipHistory | null> {
  const [npc, memories] = await Promise.all([
    prisma.nPC.findFirst({
      where: { id: npcId, campaignId },
      select: { id: true, name: true },
    }),
    prisma.memoryEntry.findMany({
      where: {
        campaignId,
        OR: [
          {
            summary: {
              contains: npcId,
              mode: "insensitive",
            },
          },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
  ]);

  if (!npc) {
    return null;
  }

  return {
    npcId: npc.id,
    npcName: npc.name,
    memories: memories.map((memory) => ({
      id: memory.id,
      type: memory.type,
      summary: memory.summary,
      createdAt: memory.createdAt.toISOString(),
    })),
  };
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
        take: 12,
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
      worldEvents: {
        orderBy: { triggerTime: "desc" },
        take: 30,
      },
      temporaryActors: {
        orderBy: [{ lastSeenAtTurn: "desc" }, { updatedAt: "desc" }],
        take: 20,
      },
      turns: {
        where: { status: "resolved" },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          id: true,
          sessionId: true,
        },
      },
    },
  });

  if (!campaign || !campaign.characterInstance || !campaign.sessions[0]) {
    return null;
  }

  const state = campaign.stateJson as unknown as CampaignRuntimeState;
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
  const localInformation = campaign.information
    .filter(
      (information) =>
        information.locationId === currentLocation.id &&
        (information.accessibility === "public" || discoveredIds.has(information.id)),
    )
    .map((information) =>
      toInformationSummary(information, campaign.locationNodes, campaign.factions, campaign.npcs),
    );

  const discoveredInformation = campaign.information
    .filter((information) => discoveredIds.has(information.id) || information.isDiscovered)
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

  const knownFactionIds = new Set<string>();
  if (currentLocation.controllingFactionId) {
    knownFactionIds.add(currentLocation.controllingFactionId);
  }
  for (const npc of presentNpcs) {
    if (npc.factionId) {
      knownFactionIds.add(npc.factionId);
    }
  }
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
    inventory: campaign.characterInstance.inventory.map(toItemInstanceRecord),
    commodityStacks: campaign.characterInstance.commodityStacks.map(toCommodityStackRecord),
  };

  const character = toCampaignCharacter(toTemplateRecord(campaign.template), instance);

  const memories: MemoryRecord[] = campaign.memories.map((memory) => ({
    id: memory.id,
    type: memory.type,
    summary: memory.summary,
    createdAt: memory.createdAt.toISOString(),
  }));

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

  const temporaryActors = campaign.temporaryActors.map(toTemporaryActorSummary);
  const canRetryLatestTurn =
    env.enableTurnUndo &&
    Boolean(campaign.turns[0]?.id) &&
    campaign.turns[0]?.sessionId === session.id;

  return {
    campaignId: campaign.id,
    sessionId: session.id,
    sessionTurnCount: session.turnCount,
    moduleId: campaign.moduleId,
    selectedEntryPointId: campaign.selectedEntryPointId,
    title: campaign.module.title,
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
    knownFactions,
    factionRelations,
    localInformation,
    discoveredInformation,
    connectedLeads,
    temporaryActors,
    memories,
    recentMessages,
    canRetryLatestTurn,
  };
}

export function toPlayerCampaignSnapshot(snapshot: CampaignSnapshot): PlayerCampaignSnapshot {
  return {
    campaignId: snapshot.campaignId,
    sessionId: snapshot.sessionId,
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
    recentMessages: snapshot.recentMessages,
    canRetryLatestTurn: snapshot.canRetryLatestTurn,
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
  const recentEntries = snapshot.recentMessages.slice(-8);

  return recentEntries.map((message) => {
    const speaker =
      message.role === "user" ? "You" : message.role === "assistant" ? "DM" : "System";
    return `[${speaker}] ${message.content}`;
  });
}

export async function getPromptContext(snapshot: CampaignSnapshot): Promise<SpatialPromptContext> {
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

  return {
    currentLocation: {
      id: snapshot.currentLocation.id,
      name: snapshot.currentLocation.name,
      type: snapshot.currentLocation.type,
      summary: snapshot.currentLocation.summary,
      state: snapshot.currentLocation.state,
    },
    adjacentRoutes: snapshot.adjacentRoutes,
    presentNpcs: snapshot.presentNpcs.map((npc) => ({
      id: npc.id,
      name: npc.name,
      role: npc.role,
      requiresDetailFetch: npc.socialLayer === "promoted_local" && !npc.isNarrativelyHydrated,
    })),
    recentUnnamedLocals: snapshot.temporaryActors
      .filter(
        (actor) =>
          actor.currentLocationId === snapshot.currentLocation.id
          && actor.promotedNpcId == null,
      )
      .slice(0, 5)
      .map((actor) => ({
        label: actor.label,
        interactionCount: actor.interactionCount,
        lastSummary: actor.lastSummary,
        lastSeenAtTurn: actor.lastSeenAtTurn,
      })),
    recentLocalEvents,
    recentTurnLedger: buildRecentTurnLedger(snapshot),
    discoveredInformation: snapshot.discoveredInformation.map((information) => ({
      id: information.id,
      title: information.title,
      summary: information.summary,
      truthfulness: information.truthfulness,
    })),
    inventory: toPromptInventory(snapshot.character),
    localTexture: snapshot.currentLocation.localTexture,
    globalTime: snapshot.state.globalTime,
    timeOfDay: timeOfDay(snapshot.state.globalTime),
    dayCount: Math.floor(snapshot.state.globalTime / 1440) + 1,
  };
}
