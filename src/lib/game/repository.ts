import type {
  AdventureModule as PrismaAdventureModule,
  Arc,
  Prisma,
  CharacterInstance as PrismaCharacterInstance,
  CharacterTemplate as PrismaCharacterTemplate,
  Clue as PrismaClue,
  MemoryEntry,
  Message,
  NPC,
} from "@prisma/client";
import {
  toCampaignCharacter,
  toCharacterStats,
} from "@/lib/game/characters";
import { auditSceneSnapshot } from "@/lib/ai/narration-audit";
import {
  buildArcRecordsFromBlueprint,
  buildCampaignBlueprintFromSetup,
  buildCampaignStateFromSetup,
  buildClueRecordsFromSetup,
  buildNpcRecordsFromSetup,
  buildQuestRecordsFromSetup,
} from "@/lib/game/campaign-setup";
import type {
  AdventureModuleSummary,
  CampaignCharacter,
  CampaignListItem,
  CampaignSnapshot,
  CharacterInstance,
  CharacterTemplate,
  CharacterTemplateDraft,
  CharacterTemplateSummary,
  CheckResult,
  Clue,
  ClueStatus,
  GeneratedCampaignOpening,
  GeneratedCampaignSetup,
  ItemInstance,
  ItemTemplate,
  MemoryRecord,
  NpcRecord,
  PromptContext,
  PromptInventoryItem,
  PlayerCampaignSnapshot,
  PlayerVisibleKeyLocation,
  PlayerVisibleClue,
  PlayerVisibleNpcRecord,
  PlayerVisibleQuestRecord,
  QuestRecord,
  QuestStatus,
  RecentResolvedTurn,
  StoryMessage,
  TurnFacts,
} from "@/lib/game/types";
import {
  hydrateCampaignState,
  parseGeneratedCampaignSetup,
} from "@/lib/game/serialization";
import { createAdHocCampaignInventoryItem } from "@/lib/game/items";
import { getStaleClues } from "@/lib/game/reveals";
import { dmClient } from "@/lib/ai/provider";
import { prisma } from "@/lib/prisma";

type PrismaItemTemplateRecord = Prisma.ItemTemplateGetPayload<Record<string, never>>;
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
type PrismaQuestRecord = Prisma.QuestGetPayload<{
  include: {
    rewardItemTemplate: true;
  };
}>;

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

function toTemplateRecord(template: PrismaCharacterTemplate): CharacterTemplate {
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

function toItemTemplateRecord(template: PrismaItemTemplateRecord): ItemTemplate {
  return {
    id: template.id,
    campaignId: template.campaignId,
    name: template.name,
    description: template.description,
    value: template.value,
    weight: template.weight,
    rarity: template.rarity,
    tags: [...template.tags],
  };
}

function toItemInstanceRecord(instance: PrismaItemInstanceRecord): ItemInstance {
  return {
    id: instance.id,
    characterInstanceId: instance.characterInstanceId,
    templateId: instance.templateId,
    template: toItemTemplateRecord(instance.template),
    isIdentified: instance.isIdentified,
    charges: instance.charges,
    properties:
      instance.properties && typeof instance.properties === "object" && !Array.isArray(instance.properties)
        ? (structuredClone(instance.properties) as Record<string, unknown>)
        : null,
  };
}

function toPromptInventory(items: ItemInstance[]): PromptInventoryItem[] {
  return items.map((item) => ({
    name: item.template.name,
    description: item.template.description,
  }));
}

function toInstanceRecord(
  instance: PrismaCharacterInstance & {
    inventory: PrismaItemInstanceRecord[];
  },
): CharacterInstance {
  return {
    id: instance.id,
    templateId: instance.templateId,
    health: instance.health,
    gold: instance.gold,
    inventory: instance.inventory.map(toItemInstanceRecord),
  };
}

function toCharacter(
  template: PrismaCharacterTemplate,
  instance: PrismaCharacterInstance & {
    inventory: PrismaItemInstanceRecord[];
  },
): CampaignCharacter {
  return toCampaignCharacter(toTemplateRecord(template), toInstanceRecord(instance));
}

type ModuleWithSetup = Pick<
  PrismaAdventureModule,
  "id" | "userId" | "title" | "publicSynopsis" | "secretEngine" | "createdAt" | "updatedAt"
> & {
  _count?: {
    campaigns: number;
  };
};

function toGeneratedCampaignSetup(module: Pick<
  PrismaAdventureModule,
  "publicSynopsis" | "secretEngine"
>): GeneratedCampaignSetup {
  return parseGeneratedCampaignSetup(module.publicSynopsis, module.secretEngine);
}

function toAdventureModuleSummary(module: ModuleWithSetup): AdventureModuleSummary {
  const setup = toGeneratedCampaignSetup(module);

  return {
    id: module.id,
    title: setup.publicSynopsis.title,
    premise: setup.publicSynopsis.premise,
    tone: setup.publicSynopsis.tone,
    setting: setup.publicSynopsis.setting,
    campaignCount: module._count?.campaigns ?? 0,
    createdAt: module.createdAt.toISOString(),
    updatedAt: module.updatedAt.toISOString(),
  };
}

function buildCampaignCreationData(input: {
  module: ModuleWithSetup;
  template: CharacterTemplate;
  opening: GeneratedCampaignOpening;
}) {
  const setup = toGeneratedCampaignSetup(input.module);
  const blueprint = buildCampaignBlueprintFromSetup(setup);
  const state = buildCampaignStateFromSetup(setup, input.opening);
  const questSeeds = buildQuestRecordsFromSetup(setup);
  const arcs = buildArcRecordsFromBlueprint(blueprint);
  const npcs = buildNpcRecordsFromSetup(setup);
  const clues = buildClueRecordsFromSetup(setup, blueprint);

  return {
    setup,
    blueprint,
    state,
    questSeeds,
    arcs,
    npcs,
    clues,
    template: input.template,
  };
}

async function createCampaignInTx(
  tx: Prisma.TransactionClient,
  input: {
    userId: string;
    module: ModuleWithSetup;
    template: CharacterTemplate;
    opening: GeneratedCampaignOpening;
  },
) {
  const { state, questSeeds, arcs, npcs, clues, template } = buildCampaignCreationData(input);

  const campaign = await tx.campaign.create({
    data: {
      userId: input.userId,
      moduleId: input.module.id,
      templateId: template.id,
      stateJson: state,
      characterInstance: {
        create: {
          templateId: template.id,
          health: template.maxHealth,
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
        select: {
          id: true,
        },
      },
    },
  });

  if (!campaign.characterInstance) {
    throw new Error("Campaign is missing its character instance.");
  }

  for (const starterItem of template.starterItems) {
    await createAdHocCampaignInventoryItem(tx, {
      campaignId: campaign.id,
      characterInstanceId: campaign.characterInstance.id,
      name: starterItem,
    });
  }

  for (const quest of questSeeds) {
    const rewardItemTemplate = quest.rewardItemName
      ? await tx.itemTemplate.create({
          data: {
            campaignId: campaign.id,
            name: quest.rewardItemName,
            description: null,
            value: 0,
            weight: 0,
            rarity: "common",
            tags: [],
          },
          select: { id: true },
        })
      : null;

    await tx.quest.create({
      data: {
        id: quest.id,
        campaignId: campaign.id,
        title: quest.title,
        summary: quest.summary,
        stage: quest.stage,
        maxStage: quest.maxStage,
        status: quest.status,
        rewardGold: quest.rewardGold,
        rewardItemTemplateId: rewardItemTemplate?.id ?? null,
        discoveredAtTurn: quest.discoveredAtTurn,
      },
    });
  }

  if (arcs.length) {
    await tx.arc.createMany({
      data: arcs.map((arc) => ({
        id: arc.id,
        campaignId: campaign.id,
        title: arc.title,
        summary: arc.summary,
        status: arc.status,
        expectedTurns: arc.expectedTurns,
        currentTurn: arc.currentTurn,
        orderIndex: arc.orderIndex,
      })),
    });
  }

  if (npcs.length) {
    await tx.nPC.createMany({
      data: npcs.map((npc) => ({
        id: npc.id,
        campaignId: campaign.id,
        name: npc.name,
        role: npc.role,
        status: npc.status,
        isCompanion: npc.isCompanion,
        approval: npc.approval,
        personalHook: npc.personalHook,
        notes: npc.notes,
        discoveredAtTurn: npc.discoveredAtTurn,
      })),
    });
  }

  if (clues.length) {
    await tx.clue.createMany({
      data: clues.map((clue) => ({
        id: clue.id,
        campaignId: campaign.id,
        linkedRevealId: clue.linkedRevealId,
        text: clue.text,
        source: clue.source,
        status: clue.status,
        discoveredAtTurn: clue.discoveredAtTurn,
      })),
    });
  }

  return campaign;
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

export async function getAdventureModuleForUser(moduleId: string) {
  const user = await ensureLocalUser();
  const adventureModule = await prisma.adventureModule.findFirst({
    where: {
      id: moduleId,
      userId: user.id,
    },
  });

  if (!adventureModule) {
    return null;
  }

  return {
    id: adventureModule.id,
    userId: adventureModule.userId,
    title: adventureModule.title,
    setup: toGeneratedCampaignSetup(adventureModule),
    createdAt: adventureModule.createdAt.toISOString(),
    updatedAt: adventureModule.updatedAt.toISOString(),
  };
}

export async function createAdventureModule(input: GeneratedCampaignSetup) {
  const user = await ensureLocalUser();

  const adventureModule = await prisma.adventureModule.create({
    data: {
      userId: user.id,
      title: input.publicSynopsis.title,
      publicSynopsis: input.publicSynopsis,
      secretEngine: input.secretEngine,
    },
  });

  return toAdventureModuleSummary(adventureModule);
}

export async function deleteAdventureModuleForUser(moduleId: string) {
  const user = await ensureLocalUser();
  const adventureModule = await prisma.adventureModule.findFirst({
    where: {
      id: moduleId,
      userId: user.id,
    },
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

export async function getCharacterTemplateForUser(templateId: string) {
  const user = await ensureLocalUser();
  const template = await prisma.characterTemplate.findFirst({
    where: {
      id: templateId,
      userId: user.id,
    },
  });

  return template ? toTemplateRecord(template) : null;
}

export async function createCampaignFromModuleForUser(input: {
  moduleId: string;
  templateId: string;
  opening?: GeneratedCampaignOpening;
}) {
  const user = await ensureLocalUser();
  const [module, template] = await Promise.all([
    prisma.adventureModule.findFirst({
      where: {
        id: input.moduleId,
        userId: user.id,
      },
    }),
    prisma.characterTemplate.findFirst({
      where: {
        id: input.templateId,
        userId: user.id,
      },
    }),
  ]);

  if (!module) {
    return { error: "module_not_found" as const };
  }

  if (!template) {
    return { error: "template_not_found" as const };
  }

  const templateRecord = toTemplateRecord(template);
  const setup = toGeneratedCampaignSetup(module);
  const opening =
    input.opening ??
    (await dmClient.generateCampaignOpening({
      setup,
      character: templateRecord,
    }));

  const campaign = await prisma.$transaction((tx) =>
    createCampaignInTx(tx, {
      userId: user.id,
      module,
      template: templateRecord,
      opening,
    }),
  );

  return { campaignId: campaign.id };
}

export async function generateCampaignOpeningDraftForUser(input: {
  moduleId: string;
  templateId: string;
  prompt?: string;
  previousDraft?: GeneratedCampaignOpening;
}) {
  const user = await ensureLocalUser();
  const [module, template] = await Promise.all([
    prisma.adventureModule.findFirst({
      where: {
        id: input.moduleId,
        userId: user.id,
      },
    }),
    prisma.characterTemplate.findFirst({
      where: {
        id: input.templateId,
        userId: user.id,
      },
    }),
  ]);

  if (!module) {
    return { error: "module_not_found" as const };
  }

  if (!template) {
    return { error: "template_not_found" as const };
  }

  const setup = toGeneratedCampaignSetup(module);
  const character = toTemplateRecord(template);
  const draft = await dmClient.generateCampaignOpening({
    setup,
    character,
    prompt: input.prompt,
    previousDraft: input.previousDraft,
  });

  return { draft };
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
    where: {
      id: templateId,
      userId: user.id,
    },
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
    where: {
      id: templateId,
      userId: user.id,
    },
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

export async function getCampaignAggregate(campaignId: string) {
  return prisma.campaign.findUnique({
    where: { id: campaignId },
    include: {
      module: true,
      template: true,
      characterInstance: {
        include: {
          inventory: {
            orderBy: { createdAt: "asc" },
            include: {
              template: true,
            },
          },
        },
      },
      sessions: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
      quests: {
        orderBy: { createdAt: "asc" },
        include: {
          rewardItemTemplate: true,
        },
      },
      arcs: {
        orderBy: { orderIndex: "asc" },
      },
      npcs: {
        orderBy: { createdAt: "asc" },
      },
      clues: {
        orderBy: { createdAt: "asc" },
      },
      memories: {
        orderBy: { createdAt: "desc" },
        take: 6,
      },
    },
  });
}

export async function listCampaigns(): Promise<CampaignListItem[]> {
  const campaigns = await prisma.campaign.findMany({
    orderBy: { updatedAt: "desc" },
    include: {
      module: true,
      template: true,
      sessions: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });

  return campaigns.map((campaign) => {
    const moduleSummary = toAdventureModuleSummary(campaign.module);

    return {
      id: campaign.id,
      title: moduleSummary.title,
      premise: moduleSummary.premise,
      setting: moduleSummary.setting,
      tone: moduleSummary.tone,
      characterName: campaign.template.name,
      characterArchetype: campaign.template.archetype,
      sessionTitle: campaign.sessions[0]?.title ?? null,
      turnCount: campaign.sessions[0]?.turnCount ?? 0,
      updatedAt: campaign.updatedAt.toISOString(),
      createdAt: campaign.createdAt.toISOString(),
    };
  });
}

function toQuest(quest: PrismaQuestRecord): QuestRecord {
  return {
    id: quest.id,
    title: quest.title,
    summary: quest.summary,
    stage: quest.stage,
    maxStage: quest.maxStage,
    status: quest.status as QuestStatus,
    rewardGold: quest.rewardGold,
    rewardItem: quest.rewardItemTemplate
      ? {
          templateId: quest.rewardItemTemplate.id,
          name: quest.rewardItemTemplate.name,
        }
      : null,
    discoveredAtTurn: quest.discoveredAtTurn,
  };
}

function toArc(arc: Arc) {
  return {
    id: arc.id,
    title: arc.title,
    summary: arc.summary,
    status: arc.status as "active" | "complete" | "locked",
    expectedTurns: arc.expectedTurns,
    currentTurn: arc.currentTurn,
    orderIndex: arc.orderIndex,
  };
}

function toNpc(npc: NPC): NpcRecord {
  return {
    id: npc.id,
    name: npc.name,
    role: npc.role,
    status: npc.status,
    isCompanion: npc.isCompanion,
    approval: npc.approval,
    personalHook: npc.personalHook,
    notes: npc.notes,
    discoveredAtTurn: npc.discoveredAtTurn,
  };
}

function toClue(clue: PrismaClue): Clue {
  return {
    id: clue.id,
    text: clue.text,
    source: clue.source,
    linkedRevealId: clue.linkedRevealId,
    status: clue.status as ClueStatus,
    discoveredAtTurn: clue.discoveredAtTurn,
  };
}

function toMemory(entry: MemoryEntry): MemoryRecord {
  return {
    id: entry.id,
    type: entry.type,
    summary: entry.summary,
    createdAt: entry.createdAt.toISOString(),
  };
}

function toMessage(message: Message): StoryMessage {
  return {
    id: message.id,
    role: message.role as StoryMessage["role"],
    kind: message.kind as StoryMessage["kind"],
    content: message.content,
    createdAt: message.createdAt.toISOString(),
    payload: (message.payload as Record<string, unknown> | null) ?? null,
  };
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildPlayerKnowledgeText(snapshot: CampaignSnapshot, previouslyOn?: string | null) {
  return [
    snapshot.state.sceneState.title,
    snapshot.state.sceneState.summary,
    snapshot.state.sceneState.atmosphere,
    previouslyOn ?? snapshot.previouslyOn ?? "",
    ...snapshot.recentMessages.map((message) => message.content),
    ...snapshot.memories.map((entry) => entry.summary),
  ]
    .join(" ")
    .toLowerCase();
}

function buildRecentSceneTrail(locations: string[], currentLocation: string) {
  const seen = new Set<string>();
  const trail: string[] = [];

  for (let index = locations.length - 1; index >= 0; index -= 1) {
    const location = locations[index];
    if (!location || location === currentLocation || seen.has(location)) {
      continue;
    }

    seen.add(location);
    trail.push(location);

    if (trail.length >= 8) {
      break;
    }
  }

  return trail.reverse();
}

function normalizeTurnFacts(value: unknown, playerAction: string): TurnFacts | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const raw = value as Record<string, unknown>;
  const discoveries = Array.isArray(raw.discoveries)
    ? raw.discoveries.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];
  const healthDelta = Number.isFinite(Number(raw.healthDelta)) ? Math.trunc(Number(raw.healthDelta)) : 0;

  if (typeof raw.action !== "string" || !raw.action.trim()) {
    return null;
  }

  return {
    action: raw.action.trim() || playerAction,
    roll: typeof raw.roll === "string" && raw.roll.trim() ? raw.roll.trim() : undefined,
    healthDelta,
    discoveries,
    sceneChanged: Boolean(raw.sceneChanged),
  };
}

function formatCheckRoll(result: CheckResult) {
  return `${result.stat} ${result.outcome} (${result.total})`;
}

function hasRollbackData(resultJson: unknown) {
  return Boolean(
    resultJson &&
      typeof resultJson === "object" &&
      !Array.isArray(resultJson) &&
      "rollback" in (resultJson as Record<string, unknown>),
  );
}

function extractTurnFacts(resultJson: unknown, playerAction: string): TurnFacts {
  if (resultJson && typeof resultJson === "object" && !Array.isArray(resultJson)) {
    const record = resultJson as Record<string, unknown>;
    const normalized = normalizeTurnFacts(record.turnFacts, playerAction);

    if (normalized) {
      return normalized;
    }

    const rawCheck = record.checkResult;
    if (rawCheck && typeof rawCheck === "object" && !Array.isArray(rawCheck)) {
      const parsed = rawCheck as CheckResult;
      return {
        action: playerAction,
        roll: formatCheckRoll(parsed),
        healthDelta: 0,
        discoveries: [],
        sceneChanged: false,
      };
    }
  }

  return {
    action: playerAction,
    healthDelta: 0,
    discoveries: [],
    sceneChanged: false,
  };
}

function formatTurnLedgerEntry(turnNumber: number, facts: TurnFacts) {
  const roll = facts.roll ?? "none";
  const discoveries = facts.discoveries.length ? facts.discoveries.join(", ") : "none";

  return `[Turn ${turnNumber}] Action: "${facts.action}" | Roll: ${roll} | HP: ${facts.healthDelta} | Discoveries: ${discoveries} | SceneChanged: ${facts.sceneChanged ? "yes" : "no"}`;
}

export function buildRecentTurnLedger(turnCount: number, recentResolvedTurns: RecentResolvedTurn[]) {
  const orderedTurns = [...recentResolvedTurns].reverse();

  return orderedTurns.map((turn, index) =>
    formatTurnLedgerEntry(
      Math.max(turnCount - orderedTurns.length + index + 1, 1),
      extractTurnFacts(turn.resultJson, turn.playerAction),
    ),
  );
}

async function sanitizePromptSceneSummary(summary: string) {
  const normalized = summary.trim();
  const audit = auditSceneSnapshot(normalized);

  if (!audit.shouldCompress) {
    return normalized;
  }

  return dmClient.compressSceneSnapshot(normalized);
}

function isExactPhraseInKnowledgeText(knowledgeText: string, value: string) {
  const trimmed = value.trim().toLowerCase();

  if (!trimmed) {
    return false;
  }

  return new RegExp(`\\b${escapeRegExp(trimmed)}\\b`, "i").test(knowledgeText);
}

function isLegacyNameInKnowledgeText(knowledgeText: string, value: string) {
  if (isExactPhraseInKnowledgeText(knowledgeText, value)) {
    return true;
  }

  const stopwords = new Set([
    "the",
    "a",
    "an",
    "of",
    "and",
    "lord",
    "lady",
    "sir",
    "master",
    "mistress",
    "high",
  ]);
  const tokens = value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4 && !stopwords.has(token));

  return tokens.some((token) => new RegExp(`\\b${escapeRegExp(token)}\\b`, "i").test(knowledgeText));
}

function toPlayerQuest(quest: QuestRecord): PlayerVisibleQuestRecord {
  return {
    id: quest.id,
    title: quest.title,
    summary: quest.summary,
    stage: quest.stage,
    maxStage: quest.maxStage,
    status: quest.status,
  };
}

function toPlayerNpc(npc: NpcRecord, knowledgeText: string): PlayerVisibleNpcRecord {
  return {
    id: npc.id,
    name: npc.name,
    role: isExactPhraseInKnowledgeText(knowledgeText, npc.role) ? npc.role : null,
    notes: null,
    isCompanion: npc.isCompanion,
  };
}

function toPlayerClue(clue: Clue): PlayerVisibleClue {
  return {
    id: clue.id,
    text: clue.text,
    source: clue.source,
    status: clue.status,
    discoveredAtTurn: clue.discoveredAtTurn,
  };
}

export async function getRecentMessages(sessionId: string) {
  const messages = await prisma.message.findMany({
    where: { sessionId },
    orderBy: { createdAt: "desc" },
    take: 30,
  });

  return orderRecentMessages(messages.map(toMessage));
}

export function orderRecentMessages<T extends { createdAt: string }>(messages: T[], take = 30) {
  return [...messages]
    .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime())
    .slice(-take);
}

async function getRecentResolvedTurns(sessionId: string, take = 4): Promise<RecentResolvedTurn[]> {
  const turns = await prisma.turn.findMany({
    where: {
      sessionId,
      status: "resolved",
    },
    orderBy: { updatedAt: "desc" },
    take,
    select: {
      id: true,
      playerAction: true,
      resultJson: true,
    },
  });

  return turns.map((turn) => ({
    id: turn.id,
    playerAction: turn.playerAction,
    resultJson: turn.resultJson,
  }));
}

export async function backfillLegacyDiscoveries(campaignId: string) {
  const snapshot = await getCampaignSnapshot(campaignId);

  if (!snapshot) {
    return false;
  }

  const hasProgressBeyondFreshStart =
    snapshot.state.turnCount > 0 || snapshot.memories.length > 0 || snapshot.recentMessages.length > 1;

  if (!hasProgressBeyondFreshStart) {
    return false;
  }

  const knowledgeText = buildPlayerKnowledgeText(snapshot);
  const questIdsToDiscover = snapshot.quests
    .filter(
      (quest) =>
        quest.discoveredAtTurn === null && isExactPhraseInKnowledgeText(knowledgeText, quest.title),
    )
    .map((quest) => quest.id);
  const npcIdsToDiscover = snapshot.npcs
    .filter(
      (npc) =>
        npc.discoveredAtTurn === null && isLegacyNameInKnowledgeText(knowledgeText, npc.name),
    )
    .map((npc) => npc.id);

  if (!questIdsToDiscover.length && !npcIdsToDiscover.length) {
    return false;
  }

  await prisma.$transaction([
    ...questIdsToDiscover.map((questId) =>
      prisma.quest.updateMany({
        where: {
          id: questId,
          discoveredAtTurn: null,
        },
        data: {
          discoveredAtTurn: 0,
        },
      }),
    ),
    ...npcIdsToDiscover.map((npcId) =>
      prisma.nPC.updateMany({
        where: {
          id: npcId,
          discoveredAtTurn: null,
        },
        data: {
          discoveredAtTurn: 0,
        },
      }),
    ),
  ]);

  return true;
}

export async function backfillLegacySceneSummary(campaignId: string) {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: {
      id: true,
      stateJson: true,
      module: {
        select: {
          publicSynopsis: true,
          secretEngine: true,
        },
      },
    },
  });

  if (!campaign) {
    return false;
  }

  const setup = parseGeneratedCampaignSetup(
    campaign.module?.publicSynopsis,
    campaign.module?.secretEngine,
  );
  const state = hydrateCampaignState(campaign.stateJson, setup.secretEngine.keyLocations);
  const audit = auditSceneSnapshot(state.sceneState.summary);

  if (!audit.shouldCompress) {
    return false;
  }

  const compressed = await dmClient.compressSceneSnapshot(state.sceneState.summary);
  if (!compressed || compressed === state.sceneState.summary) {
    return false;
  }

  await prisma.campaign.update({
    where: { id: campaignId },
    data: {
      stateJson: {
        ...(state as object),
        sceneState: {
          ...state.sceneState,
          summary: compressed,
        },
      },
    },
  });

  return true;
}

export async function getCampaignSnapshot(
  campaignId: string,
  previouslyOn: string | null = null,
): Promise<CampaignSnapshot | null> {
  const campaign = await getCampaignAggregate(campaignId);

  if (!campaign) {
    return null;
  }

  if (!campaign.characterInstance) {
    throw new Error("Campaign is missing its character instance.");
  }

  const session = campaign.sessions[0];
  const [recentMessages, recentResolvedTurns] = session
    ? await Promise.all([
        getRecentMessages(session.id),
        getRecentResolvedTurns(session.id),
      ])
    : [[], []];
  const setup = toGeneratedCampaignSetup(campaign.module);
  const blueprint = buildCampaignBlueprintFromSetup(setup);
  const state = hydrateCampaignState(campaign.stateJson, blueprint.keyLocations);
  const latestResolvedTurn = recentResolvedTurns[0] ?? null;

  return {
    campaignId: campaign.id,
    sessionId: session?.id ?? "",
    title: setup.publicSynopsis.title,
    premise: setup.publicSynopsis.premise,
    tone: setup.publicSynopsis.tone,
    setting: setup.publicSynopsis.setting,
    blueprint,
    state,
    character: toCharacter(campaign.template, campaign.characterInstance),
    quests: campaign.quests.map(toQuest),
    arcs: campaign.arcs.map(toArc),
    npcs: campaign.npcs.map(toNpc),
    clues: campaign.clues.map(toClue),
    memories: campaign.memories.map(toMemory),
    recentMessages,
    recentResolvedTurns,
    previouslyOn,
    latestResolvedTurnId: latestResolvedTurn?.id ?? null,
    canRetryLatestTurn: hasRollbackData(latestResolvedTurn?.resultJson),
  };
}

export function toPlayerCampaignSnapshot(
  snapshot: CampaignSnapshot,
  previouslyOn: string | null = snapshot.previouslyOn,
): PlayerCampaignSnapshot {
  const knowledgeText = buildPlayerKnowledgeText(snapshot, previouslyOn);
  const suggestedActions =
    snapshot.state.turnCount === 0 ? [] : snapshot.state.sceneState.suggestedActions;
  const visibleQuests = snapshot.quests
    .filter((quest) => quest.discoveredAtTurn !== null)
    .map(toPlayerQuest);
  const visibleNpcs = snapshot.npcs
    .filter((npc) => npc.discoveredAtTurn !== null)
    .map((npc) => toPlayerNpc(npc, knowledgeText));
  const visibleClues = snapshot.clues
    .filter((clue) => clue.status === "discovered")
    .map(toPlayerClue);
  const knownKeyLocations: PlayerVisibleKeyLocation[] = snapshot.blueprint.keyLocations
    .filter((location) => snapshot.state.discoveredKeyLocationNames.includes(location.name))
    .map((location) => ({
      name: location.name,
      role: location.role,
    }));

  return {
    campaignId: snapshot.campaignId,
    sessionId: snapshot.sessionId,
    title: snapshot.title,
    premise: snapshot.premise,
    tone: snapshot.tone,
    setting: snapshot.setting,
    knownKeyLocations,
    knownSceneLocations: snapshot.state.discoveredSceneLocations,
    state: {
      turnCount: snapshot.state.turnCount,
      sceneState: {
        ...snapshot.state.sceneState,
        suggestedActions,
      },
    },
    character: snapshot.character,
    quests: visibleQuests,
    npcs: visibleNpcs,
    clues: visibleClues,
    memories: snapshot.memories,
    recentMessages: snapshot.recentMessages,
    previouslyOn,
    latestResolvedTurnId: snapshot.latestResolvedTurnId,
    canRetryLatestTurn: snapshot.canRetryLatestTurn,
  };
}

export async function getPromptContext(snapshot: CampaignSnapshot): Promise<PromptContext> {
  const activeArc = snapshot.arcs.find((arc) => arc.id === snapshot.state.activeArcId);
  const staleClues = getStaleClues(snapshot.clues, snapshot.state.turnCount);
  const promptSceneSummary = await sanitizePromptSceneSummary(snapshot.state.sceneState.summary);
  const narrativeSummary =
    snapshot.memories.find((entry) => entry.type === "session_summary")?.summary ?? null;
  const activeQuests: QuestRecord[] = [];
  const hiddenQuests: QuestRecord[] = [];
  const hiddenNpcs: NpcRecord[] = [];
  const discoveredClues: Clue[] = [];
  const clueWindow: Clue[] = [];
  const discoveryCandidates = {
    quests: [] as PromptContext["discoveryCandidates"]["quests"],
    npcs: [] as PromptContext["discoveryCandidates"]["npcs"],
  };
  const discoveredClueIds = new Set<string>();
  let companion: NpcRecord | null = null;

  for (const quest of snapshot.quests) {
    if (quest.discoveredAtTurn === null) {
      hiddenQuests.push(quest);
      if (quest.status === "active") {
        discoveryCandidates.quests.push({
          id: quest.id,
          title: quest.title,
        });
      }
      continue;
    }

    if (quest.status === "active") {
      activeQuests.push(quest);
    }
  }

  for (const npc of snapshot.npcs) {
    if (npc.discoveredAtTurn === null) {
      hiddenNpcs.push(npc);
      discoveryCandidates.npcs.push({
        id: npc.id,
        name: npc.name,
        role: npc.role,
      });
      continue;
    }

    if (!companion && npc.isCompanion) {
      companion = npc;
    }
  }

  for (const clue of snapshot.clues) {
    if (clue.status === "hidden" || clue.status === "discovered") {
      clueWindow.push(clue);
    }

    if (clue.status === "discovered") {
      discoveredClues.push(clue);
      discoveredClueIds.add(clue.id);
    }
  }

  const activeRevealIds = new Set(snapshot.state.activeRevealIds);
  const readyArcIds = new Set(
    snapshot.arcs.filter((arc) => arc.status !== "locked").map((arc) => arc.id),
  );
  const eligibleRevealIds = snapshot.blueprint.hiddenReveals
    .filter((reveal) => {
      const allCluesFound = reveal.requiredClues.every((clueId) => discoveredClueIds.has(clueId));
      const arcReady = reveal.requiredArcIds.every((arcId) => readyArcIds.has(arcId));

      return allCluesFound && arcReady && !activeRevealIds.has(reveal.id);
    })
    .map((reveal) => reveal.id);
  const recentTurnLedger = buildRecentTurnLedger(
    snapshot.state.turnCount,
    snapshot.recentResolvedTurns,
  );
  const recentTurnThreshold = snapshot.state.turnCount - 8;
  const discoveredKeyLocations = snapshot.blueprint.keyLocations.filter((location) =>
    snapshot.state.discoveredKeyLocationNames.includes(location.name),
  );
  const recentSceneTrail = buildRecentSceneTrail(
    snapshot.state.discoveredSceneLocations,
    snapshot.state.sceneState.location,
  );

  const arcPacingHint = activeArc
    ? activeArc.currentTurn / activeArc.expectedTurns >= 0.8
      ? `ARC ENDING SOON: ${activeArc.title} should conclude within 2-3 turns.`
      : null
    : null;

  return {
    scene: snapshot.state.sceneState,
    inventory: toPromptInventory(snapshot.character.inventory),
    keyLocations: snapshot.blueprint.keyLocations,
    discoveredKeyLocations,
    recentSceneTrail,
    promptSceneSummary,
    activeArc,
    activeQuests,
    hiddenQuests,
    recentTurnLedger,
    narrativeSummary,
    relevantClues: clueWindow.filter(
      (clue) =>
        clue.status === "hidden" ||
        (clue.status === "discovered" &&
          clue.discoveredAtTurn !== null &&
          clue.discoveredAtTurn >= recentTurnThreshold),
    ),
    staleClues,
    eligibleRevealIds,
    discoveredClues,
    companion,
    hiddenNpcs,
    discoveryCandidates,
    villainClock: snapshot.state.villainClock,
    tensionScore: snapshot.state.tensionScore,
    arcPacingHint,
  };
}

export function toStoredTemplateSeed(template: CharacterTemplate) {
  return {
    ...template,
    stats: toCharacterStats(template),
  };
}

export type RepositorySnapshot = Awaited<ReturnType<typeof getCampaignSnapshot>>;
