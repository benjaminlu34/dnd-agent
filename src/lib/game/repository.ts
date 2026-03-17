import type {
  Arc,
  Clue as PrismaClue,
  MemoryEntry,
  Message,
  NPC,
  Quest,
} from "@prisma/client";
import type {
  ArcRecord,
  CampaignListItem,
  CampaignSnapshot,
  CharacterSheet,
  ClueStatus,
  Clue,
  MemoryRecord,
  NpcRecord,
  QuestStatus,
  QuestRecord,
  StoryMessage,
} from "@/lib/game/types";
import { parseBlueprint, parseCampaignState } from "@/lib/game/serialization";
import { getStaleClues } from "@/lib/game/reveals";
import { createSeededDummyCharacter } from "@/lib/game/starter-data";
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

export async function ensureSeedCharacter() {
  const user = await ensureLocalUser();
  const seeded = createSeededDummyCharacter();
  const existing = await prisma.character.findFirst({
    where: {
      userId: user.id,
      name: seeded.name,
      archetype: seeded.archetype,
    },
    orderBy: { createdAt: "asc" },
  });

  if (existing) {
    return existing;
  }

  return prisma.character.create({
    data: {
      userId: user.id,
      name: seeded.name,
      archetype: seeded.archetype,
      strength: seeded.stats.strength,
      agility: seeded.stats.agility,
      intellect: seeded.stats.intellect,
      charisma: seeded.stats.charisma,
      vitality: seeded.stats.vitality,
      maxHealth: seeded.maxHealth,
      health: seeded.health,
    },
  });
}

export async function getCampaignAggregate(campaignId: string) {
  return prisma.campaign.findUnique({
    where: { id: campaignId },
    include: {
      character: true,
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
      character: true,
      sessions: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });

  return campaigns.map((campaign) => ({
    id: campaign.id,
    title: campaign.title,
    premise: campaign.premise,
    setting: campaign.setting,
    tone: campaign.tone,
    characterName: campaign.character.name,
    characterArchetype: campaign.character.archetype,
    sessionTitle: campaign.sessions[0]?.title ?? null,
    turnCount: campaign.sessions[0]?.turnCount ?? 0,
    updatedAt: campaign.updatedAt.toISOString(),
    createdAt: campaign.createdAt.toISOString(),
  }));
}

function toCharacter(character: Awaited<ReturnType<typeof getCampaignAggregate>> extends infer T
  ? T extends { character: infer C }
    ? C
    : never
  : never): CharacterSheet {
  return {
    id: character.id,
    name: character.name,
    archetype: character.archetype,
    health: character.health,
    maxHealth: character.maxHealth,
    stats: {
      strength: character.strength,
      agility: character.agility,
      intellect: character.intellect,
      charisma: character.charisma,
      vitality: character.vitality,
    },
  };
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
  };
}

function toArc(arc: Arc): ArcRecord {
  return {
    id: arc.id,
    title: arc.title,
    summary: arc.summary,
    status: arc.status as ArcRecord["status"],
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

export async function getRecentMessages(sessionId: string) {
  const messages = await prisma.message.findMany({
    where: { sessionId },
    orderBy: { createdAt: "asc" },
    take: 30,
  });

  return messages.map(toMessage);
}

export async function getCampaignSnapshot(
  campaignId: string,
  previouslyOn: string | null = null,
): Promise<CampaignSnapshot | null> {
  const campaign = await getCampaignAggregate(campaignId);

  if (!campaign) {
    return null;
  }

  const session = campaign.sessions[0];
  const recentMessages = session ? await getRecentMessages(session.id) : [];
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
    title: campaign.title,
    premise: campaign.premise,
    tone: campaign.tone,
    setting: campaign.setting,
    blueprint: parseBlueprint(campaign.blueprint),
    state: parseCampaignState(campaign.stateJson),
    character: toCharacter(campaign.character),
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
  const companion = snapshot.npcs.find((npc) => npc.isCompanion) ?? null;
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
    activeQuests: snapshot.quests.filter((quest) => quest.status === "active"),
    unresolvedHooks,
    recentCanon,
    relevantClues: clueWindow,
    staleClues,
    eligibleRevealIds,
    eligibleRevealTexts,
    companion,
    villainClock: snapshot.state.villainClock,
    tensionScore: snapshot.state.tensionScore,
    arcPacingHint,
  };
}

export type RepositorySnapshot = Awaited<ReturnType<typeof getCampaignSnapshot>>;
