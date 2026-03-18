import type {
  AdventureModule as PrismaAdventureModule,
  Arc,
  CharacterInstance as PrismaCharacterInstance,
  Prisma,
  CharacterTemplate as PrismaCharacterTemplate,
  Clue as PrismaClue,
  MemoryEntry,
  Message,
  NPC,
  Quest,
} from "@prisma/client";
import {
  normalizeInventory,
  toCampaignCharacter,
  toCharacterStats,
} from "@/lib/game/characters";
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
  Clue,
  ClueStatus,
  GeneratedCampaignOpening,
  GeneratedCampaignSetup,
  MemoryRecord,
  NpcRecord,
  PlayerCampaignSnapshot,
  PlayerVisibleClue,
  PlayerVisibleNpcRecord,
  PlayerVisibleQuestRecord,
  QuestRecord,
  QuestStatus,
  StoryMessage,
} from "@/lib/game/types";
import {
  parseCampaignState,
  parseGeneratedCampaignSetup,
} from "@/lib/game/serialization";
import { getStaleClues } from "@/lib/game/reveals";
import {
  createDefaultAdventureModuleSetup,
  createDefaultCharacterTemplate,
} from "@/lib/game/starter-data";
import { dmClient } from "@/lib/ai/provider";
import { prisma } from "@/lib/prisma";

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
    agility: template.agility,
    intellect: template.intellect,
    charisma: template.charisma,
    vitality: template.vitality,
    maxHealth: template.maxHealth,
    backstory: template.backstory,
  };
}

function toTemplateSummary(template: PrismaCharacterTemplate): CharacterTemplateSummary {
  return {
    ...toTemplateRecord(template),
    createdAt: template.createdAt.toISOString(),
    updatedAt: template.updatedAt.toISOString(),
  };
}

function toInstanceRecord(instance: PrismaCharacterInstance): CharacterInstance {
  return {
    id: instance.id,
    templateId: instance.templateId,
    health: instance.health,
    gold: instance.gold,
    inventory: normalizeInventory(instance.inventory),
  };
}

function toCharacter(
  template: PrismaCharacterTemplate,
  instance: PrismaCharacterInstance,
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
  const quests = buildQuestRecordsFromSetup(setup);
  const arcs = buildArcRecordsFromBlueprint(blueprint);
  const npcs = buildNpcRecordsFromSetup(setup);
  const clues = buildClueRecordsFromSetup(setup, blueprint);

  return {
    setup,
    blueprint,
    state,
    quests,
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
  const { state, quests, arcs, npcs, clues, template } = buildCampaignCreationData(input);

  return tx.campaign.create({
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
          inventory: [],
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
      ...(quests.length
        ? {
            quests: {
              createMany: {
                data: quests.map((quest) => ({
                  id: quest.id,
                  title: quest.title,
                  summary: quest.summary,
                  stage: quest.stage,
                  maxStage: quest.maxStage,
                  status: quest.status,
                  rewardGold: quest.rewardGold,
                  rewardItem: quest.rewardItem,
                  discoveredAtTurn: quest.discoveredAtTurn,
                })),
              },
            },
          }
        : {}),
      ...(arcs.length
        ? {
            arcs: {
              createMany: {
                data: arcs.map((arc) => ({
                  id: arc.id,
                  title: arc.title,
                  summary: arc.summary,
                  status: arc.status,
                  expectedTurns: arc.expectedTurns,
                  currentTurn: arc.currentTurn,
                  orderIndex: arc.orderIndex,
                })),
              },
            },
          }
        : {}),
      ...(npcs.length
        ? {
            npcs: {
              createMany: {
                data: npcs.map((npc) => ({
                  id: npc.id,
                  name: npc.name,
                  role: npc.role,
                  status: npc.status,
                  isCompanion: npc.isCompanion,
                  approval: npc.approval,
                  personalHook: npc.personalHook,
                  notes: npc.notes,
                  discoveredAtTurn: npc.discoveredAtTurn,
                })),
              },
            },
          }
        : {}),
      ...(clues.length
        ? {
            clues: {
              createMany: {
                data: clues.map((clue) => ({
                  id: clue.id,
                  linkedRevealId: clue.linkedRevealId,
                  text: clue.text,
                  source: clue.source,
                  status: clue.status,
                  discoveredAtTurn: clue.discoveredAtTurn,
                })),
              },
            },
          }
        : {}),
    },
    select: { id: true },
  });
}

export async function ensureDefaultCharacterTemplate() {
  const user = await ensureLocalUser();
  const defaultTemplate = createDefaultCharacterTemplate();
  const existing = await prisma.characterTemplate.findFirst({
    where: {
      userId: user.id,
      name: defaultTemplate.name,
      archetype: defaultTemplate.archetype,
    },
    orderBy: { createdAt: "asc" },
  });

  if (existing) {
    return existing;
  }

  return prisma.characterTemplate.create({
    data: {
      userId: user.id,
      name: defaultTemplate.name,
      archetype: defaultTemplate.archetype,
      strength: defaultTemplate.strength,
      agility: defaultTemplate.agility,
      intellect: defaultTemplate.intellect,
      charisma: defaultTemplate.charisma,
      vitality: defaultTemplate.vitality,
      maxHealth: defaultTemplate.maxHealth,
      backstory: defaultTemplate.backstory,
    },
  });
}

export async function ensureDefaultAdventureModule() {
  const user = await ensureLocalUser();
  const defaultModule = createDefaultAdventureModuleSetup();
  const existing = await prisma.adventureModule.findFirst({
    where: {
      userId: user.id,
      title: defaultModule.publicSynopsis.title,
    },
    orderBy: { createdAt: "asc" },
  });

  if (existing) {
    return existing;
  }

  return prisma.adventureModule.create({
    data: {
      userId: user.id,
      title: defaultModule.publicSynopsis.title,
      publicSynopsis: defaultModule.publicSynopsis,
      secretEngine: defaultModule.secretEngine,
    },
  });
}

export async function listCharacterTemplates(): Promise<CharacterTemplateSummary[]> {
  const user = await ensureLocalUser();
  const templates = await prisma.characterTemplate.findMany({
    where: { userId: user.id },
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
  const opening = await dmClient.generateCampaignOpening({
    setup,
    character: templateRecord,
  });

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

export async function createCharacterTemplate(input: CharacterTemplateDraft) {
  const user = await ensureLocalUser();

  return prisma.characterTemplate.create({
    data: {
      userId: user.id,
      name: input.name,
      archetype: input.archetype,
      strength: input.strength,
      agility: input.agility,
      intellect: input.intellect,
      charisma: input.charisma,
      vitality: input.vitality,
      maxHealth: input.maxHealth,
      backstory: input.backstory,
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
      agility: input.agility,
      intellect: input.intellect,
      charisma: input.charisma,
      vitality: input.vitality,
      maxHealth: input.maxHealth,
      backstory: input.backstory,
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
      characterInstance: true,
      sessions: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
      quests: {
        orderBy: { createdAt: "asc" },
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

function toQuest(quest: Quest): QuestRecord {
  return {
    id: quest.id,
    title: quest.title,
    summary: quest.summary,
    stage: quest.stage,
    maxStage: quest.maxStage,
    status: quest.status as QuestStatus,
    rewardGold: quest.rewardGold,
    rewardItem: quest.rewardItem,
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
    orderBy: { createdAt: "asc" },
    take: 30,
  });

  return messages.map(toMessage);
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
  const recentMessages = session ? await getRecentMessages(session.id) : [];
  const setup = toGeneratedCampaignSetup(campaign.module);
  const blueprint = buildCampaignBlueprintFromSetup(setup);
  const latestResolvedTurn = session
    ? await prisma.turn.findFirst({
        where: {
          sessionId: session.id,
          status: "resolved",
        },
        orderBy: { updatedAt: "desc" },
        select: { id: true, resultJson: true },
      })
    : null;

  return {
    campaignId: campaign.id,
    sessionId: session?.id ?? "",
    title: setup.publicSynopsis.title,
    premise: setup.publicSynopsis.premise,
    tone: setup.publicSynopsis.tone,
    setting: setup.publicSynopsis.setting,
    blueprint,
    state: parseCampaignState(campaign.stateJson),
    character: toCharacter(campaign.template, campaign.characterInstance),
    quests: campaign.quests.map(toQuest),
    arcs: campaign.arcs.map(toArc),
    npcs: campaign.npcs.map(toNpc),
    clues: campaign.clues.map(toClue),
    memories: campaign.memories.map(toMemory),
    recentMessages,
    previouslyOn,
    latestResolvedTurnId: latestResolvedTurn?.id ?? null,
    canRetryLatestTurn:
      Boolean(
        latestResolvedTurn &&
          latestResolvedTurn.resultJson &&
          typeof latestResolvedTurn.resultJson === "object" &&
          "rollback" in (latestResolvedTurn.resultJson as Record<string, unknown>),
      ),
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

  return {
    campaignId: snapshot.campaignId,
    sessionId: snapshot.sessionId,
    title: snapshot.title,
    premise: snapshot.premise,
    tone: snapshot.tone,
    setting: snapshot.setting,
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

export function getPromptContext(snapshot: CampaignSnapshot) {
  const activeArc = snapshot.arcs.find((arc) => arc.id === snapshot.state.activeArcId);
  const unresolvedHooks = snapshot.state.hooks.filter((hook) => hook.status === "open");
  const recentCanon = snapshot.recentMessages
    .filter((message) => message.kind !== "warning")
    .slice(-6)
    .map((message) => {
      const speaker =
        message.role === "assistant"
          ? "DM"
          : message.role === "user"
            ? "Player"
            : message.kind === "check"
              ? "Check"
              : "System";

      return `${speaker}: ${message.content}`;
    });
  const clueWindow = snapshot.clues.filter(
    (clue) => clue.status === "hidden" || clue.status === "discovered",
  );
  const staleClues = getStaleClues(snapshot.clues, snapshot.state.turnCount);
  const companion =
    snapshot.npcs.find(
      (npc) => npc.isCompanion && npc.discoveredAtTurn !== null,
    ) ?? null;
  const eligibleRevealIds = snapshot.blueprint.hiddenReveals
    .filter((reveal) => {
      const allCluesFound = reveal.requiredClues.every((clueId) =>
        snapshot.clues.some((clue) => clue.id === clueId && clue.status === "discovered"),
      );
      const arcReady = reveal.requiredArcIds.every((arcId) =>
        snapshot.arcs.some((arc) => arc.id === arcId && arc.status !== "locked"),
      );

      return allCluesFound && arcReady && !snapshot.state.activeRevealIds.includes(reveal.id);
    })
    .map((reveal) => reveal.id);

  const eligibleRevealTexts = snapshot.blueprint.hiddenReveals
    .filter((reveal) => eligibleRevealIds.includes(reveal.id))
    .map((reveal) => `${reveal.title}: ${reveal.truth}`);

  const arcPacingHint = activeArc
    ? activeArc.currentTurn / activeArc.expectedTurns >= 0.8
      ? `ARC ENDING SOON: ${activeArc.title} should conclude within 2-3 turns.`
      : null
    : null;

  return {
    scene: snapshot.state.sceneState,
    activeArc,
    activeQuests: snapshot.quests.filter(
      (quest) => quest.status === "active" && quest.discoveredAtTurn !== null,
    ),
    hiddenQuests: snapshot.quests.filter((quest) => quest.discoveredAtTurn === null),
    unresolvedHooks,
    recentCanon,
    relevantClues: clueWindow,
    staleClues,
    eligibleRevealIds,
    eligibleRevealTexts,
    companion,
    hiddenNpcs: snapshot.npcs.filter((npc) => npc.discoveredAtTurn === null),
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
