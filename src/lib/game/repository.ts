import { Prisma } from "@prisma/client";
import { dmClient } from "@/lib/ai/provider";
import { toCampaignCharacter, toCharacterStats } from "@/lib/game/characters";
import { createAdHocCampaignInventoryItem } from "@/lib/game/items";
import { generatedWorldModuleSchema } from "@/lib/game/session-zero";
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
  FactionSummary,
  GeneratedCampaignOpening,
  GeneratedWorldModule,
  InformationSummary,
  LocationSummary,
  MemoryRecord,
  NpcSummary,
  PlayerCampaignSnapshot,
  PromptInventoryItem,
  RouteSummary,
  SpatialPromptContext,
  StoryMessage,
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

function parseWorldTemplate(value: unknown): GeneratedWorldModule {
  return generatedWorldModuleSchema.parse(value);
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

function toPromptInventory(items: CharacterInstance["inventory"]): PromptInventoryItem[] {
  return items.map((item) => ({
    name: item.template.name,
    description: item.template.description,
  }));
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

export async function createAdventureModule(input: GeneratedWorldModule) {
  const user = await ensureLocalUser();

  const adventureModule = await prisma.adventureModule.create({
    data: {
      userId: user.id,
      title: input.title,
      premise: input.premise,
      tone: input.tone,
      setting: input.setting,
      generationMode: "open_world",
      schemaVersion: 1,
      isLocked: false,
      openWorldTemplateJson: input,
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
  const entryPoint = world.entryPoints.find((entry) => entry.id === input.entryPointId);

  if (!entryPoint) {
    throw new Error("Entry point not found on selected module.");
  }

  const draft = await dmClient.generateCampaignOpening({
    module: world,
    character: toTemplateRecord(template),
    entryPoint,
    prompt: input.prompt,
    previousDraft: input.previousDraft,
  });

  return { draft };
}

async function createCampaignInTx(
  tx: Prisma.TransactionClient,
  input: {
    userId: string;
    module: Prisma.AdventureModuleGetPayload<Record<string, never>>;
    template: CharacterTemplate;
    entryPointId: string;
    opening: GeneratedCampaignOpening;
  },
) {
  const world = parseWorldTemplate(input.module.openWorldTemplateJson);
  const entryPoint = world.entryPoints.find((entry) => entry.id === input.entryPointId);

  if (!entryPoint) {
    throw new Error("Entry point not found during campaign creation.");
  }

  const state: CampaignRuntimeState = {
    currentLocationId: entryPoint.startLocationId,
    globalTime: 480,
    pendingTurnId: null,
    lastActionSummary: input.opening.activeThreat,
    discoveredInformationIds: [...entryPoint.initialInformationIds],
  };

  const campaign = await tx.campaign.create({
    data: {
      userId: input.userId,
      moduleId: input.module.id,
      templateId: input.template.id,
      moduleSchemaVersion: input.module.schemaVersion,
      selectedEntryPointId: input.entryPointId,
      stateJson: state,
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

  if (world.factions.length) {
    await tx.faction.createMany({
      data: world.factions.map((faction) => ({
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

  if (world.locations.length) {
    await tx.locationNode.createMany({
      data: world.locations.map((location) => ({
        id: location.id,
        campaignId: campaign.id,
        name: location.name,
        type: location.type,
        summary: location.summary,
        description: location.description,
        state: location.state,
        controllingFactionId: location.controllingFactionId,
        tags: location.tags,
      })),
    });
  }

  if (world.edges.length) {
    await tx.locationEdge.createMany({
      data: world.edges.map((edge) => ({
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

  if (world.factionRelations.length) {
    await tx.factionRelation.createMany({
      data: world.factionRelations.map((relation) => ({
        id: relation.id,
        campaignId: campaign.id,
        factionAId: relation.factionAId,
        factionBId: relation.factionBId,
        stance: relation.stance,
      })),
    });
  }

  if (world.npcs.length) {
    await tx.nPC.createMany({
      data: world.npcs.map((npc) => ({
        id: npc.id,
        campaignId: campaign.id,
        name: npc.name,
        role: npc.role,
        summary: npc.summary,
        description: npc.description,
        factionId: npc.factionId,
        currentLocationId: npc.currentLocationId,
        approval: npc.approval,
        isCompanion: npc.isCompanion,
      })),
    });
  }

  if (world.information.length) {
    await tx.information.createMany({
      data: world.information.map((information) => ({
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
        isDiscovered: entryPoint.initialInformationIds.includes(information.id),
        discoveredAtTurn: entryPoint.initialInformationIds.includes(information.id) ? 0 : null,
      })),
    });
  }

  if (world.informationLinks.length) {
    await tx.informationLink.createMany({
      data: world.informationLinks.map((link) => ({
        id: link.id,
        campaignId: campaign.id,
        sourceId: link.sourceId,
        targetId: link.targetId,
        linkType: link.linkType,
      })),
    });
  }

  if (world.commodities.length) {
    await tx.commodity.createMany({
      data: world.commodities.map((commodity) => ({
        id: commodity.id,
        campaignId: campaign.id,
        name: commodity.name,
        baseValue: commodity.baseValue,
        tags: commodity.tags,
      })),
    });
  }

  if (world.marketPrices.length) {
    await tx.marketPrice.createMany({
      data: world.marketPrices.map((price) => ({
        id: price.id,
        campaignId: campaign.id,
        commodityId: price.commodityId,
        locationId: price.locationId,
        vendorNpcId: price.vendorNpcId,
        factionId: price.factionId,
        modifier: price.modifier,
        stock: price.stock,
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

  await tx.adventureModule.update({
    where: { id: input.module.id },
    data: {
      isLocked: true,
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
  const entryPoint = world.entryPoints.find((entry) => entry.id === input.entryPointId);
  if (!entryPoint) {
    throw new Error("Selected entry point was not found.");
  }

  const templateRecord = toTemplateRecord(template);
  const opening =
    input.opening ??
    (await dmClient.generateCampaignOpening({
      module: world,
      character: templateRecord,
      entryPoint,
    }));

  const result = await prisma.$transaction((tx) =>
    createCampaignInTx(tx, {
      userId: user.id,
      module,
      template: templateRecord,
      entryPointId: input.entryPointId,
      opening,
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
      locationNodes: true,
    },
  });

  return campaigns.map((campaign) => {
    const state = campaign.stateJson as unknown as CampaignRuntimeState;
    const currentLocation = campaign.locationNodes.find(
      (location) => location.id === state.currentLocationId,
    );

    return {
      id: campaign.id,
      title: campaign.module.title,
      premise: campaign.module.premise,
      setting: campaign.module.setting,
      tone: campaign.module.tone,
      characterName: campaign.template.name,
      characterArchetype: campaign.template.archetype,
      currentLocationName: currentLocation?.name ?? "Unknown location",
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
    factionId: npc.factionId,
    factionName: faction?.name ?? null,
    currentLocationId: npc.currentLocationId,
    approval: npc.approval,
    isCompanion: npc.isCompanion,
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

      const nextDepth = (current.depth + 1) as 1 | 2;
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
      npcs: {
        orderBy: { name: "asc" },
      },
      information: {
        orderBy: { title: "asc" },
      },
      informationLinks: {
        orderBy: { createdAt: "asc" },
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

  const discoveredIds = new Set(state.discoveredInformationIds);
  const localInformation = campaign.information
    .filter(
      (information) =>
        information.locationId === currentLocation.id &&
        (information.accessibility === "public" || discoveredIds.has(information.id) || information.isDiscovered),
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
    discoveredInformationIds: state.discoveredInformationIds,
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

  const instance: CharacterInstance = {
    id: campaign.characterInstance.id,
    templateId: campaign.characterInstance.templateId,
    health: campaign.characterInstance.health,
    gold: campaign.characterInstance.gold,
    inventory: campaign.characterInstance.inventory.map(toItemInstanceRecord),
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

  return {
    campaignId: campaign.id,
    sessionId: session.id,
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
    localInformation,
    discoveredInformation,
    connectedLeads,
    memories,
    recentMessages,
    canRetryLatestTurn: false,
  };
}

export function toPlayerCampaignSnapshot(snapshot: CampaignSnapshot): PlayerCampaignSnapshot {
  return snapshot;
}

function timeOfDay(globalTime: number) {
  const minuteOfDay = ((globalTime % 1440) + 1440) % 1440;
  if (minuteOfDay < 360) return "night";
  if (minuteOfDay < 720) return "morning";
  if (minuteOfDay < 1080) return "afternoon";
  if (minuteOfDay < 1260) return "evening";
  return "night";
}

export async function getPromptContext(snapshot: CampaignSnapshot): Promise<SpatialPromptContext> {
  return {
    currentLocation: snapshot.currentLocation,
    adjacentRoutes: snapshot.adjacentRoutes,
    presentNpcs: snapshot.presentNpcs,
    localInformation: snapshot.localInformation,
    connectedLeads: snapshot.connectedLeads,
    knownFactions: snapshot.knownFactions,
    inventory: toPromptInventory(snapshot.character.inventory),
    memories: snapshot.memories,
    recentMessages: snapshot.recentMessages.slice(-8),
    discoveredInformationIds: [...snapshot.state.discoveredInformationIds],
    globalTime: snapshot.state.globalTime,
    timeOfDay: timeOfDay(snapshot.state.globalTime),
  };
}
