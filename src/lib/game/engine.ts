import { prisma } from "@/lib/prisma";
import { dmClient } from "@/lib/ai/provider";
import { rollCheck } from "@/lib/game/checks";
import {
  createStarterArcs,
  createStarterCharacter,
  createStarterClues,
  createStarterNpcs,
  createStarterQuests,
  createStarterState,
} from "@/lib/game/starter-data";
import { getCampaignSnapshot, getPromptContext } from "@/lib/game/repository";
import { validateDelta } from "@/lib/game/validation";
import type {
  CampaignSnapshot,
  CheckResult,
  PendingCheck,
  ProposedStateDelta,
} from "@/lib/game/types";

type TurnStream = {
  narration?: (chunk: string) => void;
  checkResult?: (result: CheckResult) => void;
};

export async function createAdventure() {
  const user = await prisma.user.upsert({
    where: { email: "solo@adventure.local" },
    update: {},
    create: {
      email: "solo@adventure.local",
      name: "Solo Adventurer",
    },
  });

  const blueprint = await dmClient.generateCampaignBlueprint();
  const character = createStarterCharacter();
  const state = createStarterState(blueprint);
  const quests = createStarterQuests();
  const arcs = createStarterArcs();
  const npcs = createStarterNpcs();
  const clues = createStarterClues();
  const createdCharacter = await prisma.character.create({
    data: {
      userId: user.id,
      name: character.name,
      archetype: character.archetype,
      strength: character.stats.strength,
      agility: character.stats.agility,
      intellect: character.stats.intellect,
      charisma: character.stats.charisma,
      vitality: character.stats.vitality,
      maxHealth: character.maxHealth,
      health: character.health,
    },
  });

  const campaign = await prisma.campaign.create({
    data: {
      userId: user.id,
      characterId: createdCharacter.id,
      title: "Eclipse Over Briar Glen",
      premise: blueprint.premise,
      tone: blueprint.tone,
      setting: blueprint.setting,
      blueprint,
      stateJson: state,
      sessions: {
        create: {
          title: "Session 1",
          status: "active",
          messages: {
            create: {
              role: "assistant",
              kind: "narration",
              content: state.sceneState.summary,
            },
          },
        },
      },
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
          })),
        },
      },
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
          })),
        },
      },
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
    },
    include: {
      sessions: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });

  return getCampaignSnapshot(campaign.id);
}
function companionInterjection(snapshot: CampaignSnapshot, proposedDelta: ProposedStateDelta) {
  const companion = snapshot.npcs.find((npc) => npc.isCompanion);

  if (!companion) {
    return null;
  }

  const failureSpike = (proposedDelta.tensionDelta ?? 0) >= 10;
  const highTension = snapshot.state.tensionScore >= 70;
  const companionBeat = proposedDelta.memorySummary?.toLowerCase().includes("lark");
  const randomPresence = companion.approval >= 3 && Math.random() < 0.15;

  if (failureSpike || highTension || companionBeat || randomPresence) {
    return `${companion.name} murmurs, "We keep moving, but not carelessly."`;
  }

  return null;
}

async function commitValidatedTurn(input: {
  snapshot: CampaignSnapshot;
  sessionId: string;
  turnId: string;
  playerAction: string;
  validated: ReturnType<typeof validateDelta>;
  warnings: string[];
  narration?: string;
  checkResult?: CheckResult;
}) {
  const { snapshot, validated, sessionId, playerAction, narration, warnings, checkResult, turnId } = input;

  const companionLine = companionInterjection(snapshot, {
    tensionDelta: validated.nextState.tensionScore - snapshot.state.tensionScore,
    memorySummary: validated.memorySummary,
  });

  await prisma.$transaction(async (tx) => {
    await tx.campaign.update({
      where: { id: snapshot.campaignId },
      data: {
        stateJson: validated.nextState,
      },
    });

    for (const questUpdate of validated.acceptedQuestAdvancements ?? []) {
      await tx.quest.update({
        where: { id: questUpdate.questId },
        data: {
          stage: questUpdate.nextStage,
          status: questUpdate.status,
        },
      });
    }

    for (const clueId of validated.acceptedClueDiscoveries) {
      await tx.clue.update({
        where: { id: clueId },
        data: {
          status: "discovered",
          discoveredAtTurn: validated.nextState.turnCount,
        },
      });
    }

    for (const arcUpdate of validated.acceptedArcAdvancements ?? []) {
      const arc = snapshot.arcs.find((entry) => entry.id === arcUpdate.arcId);
      if (!arc) continue;

      await tx.arc.update({
        where: { id: arcUpdate.arcId },
        data: {
          currentTurn: arc.currentTurn + (arcUpdate.currentTurnDelta ?? 0),
          status: arcUpdate.status,
        },
      });
    }

    for (const npcChange of validated.acceptedNpcChanges ?? []) {
      const npc = snapshot.npcs.find((entry) => entry.id === npcChange.npcId);
      if (!npc) continue;

      await tx.nPC.update({
        where: { id: npcChange.npcId },
        data: {
          approval: npc.approval + npcChange.approvalDelta,
        },
      });
    }

    await tx.session.update({
      where: { id: sessionId },
      data: {
        turnCount: validated.nextState.turnCount,
      },
    });

    await tx.turn.update({
      where: { id: turnId },
      data: {
        status: "resolved",
        resultJson: checkResult ? checkResult : undefined,
      },
    });

    await tx.message.create({
      data: {
        sessionId,
        role: "user",
        kind: "action",
        content: playerAction,
      },
    });

    if (checkResult) {
      await tx.message.create({
        data: {
          sessionId,
          role: "system",
          kind: "check",
          content: `${checkResult.stat} ${checkResult.outcome} (${checkResult.total})`,
          payload: checkResult,
        },
      });
    }

    if (narration) {
      await tx.message.create({
        data: {
          sessionId,
          role: "assistant",
          kind: "narration",
          content: companionLine ? `${narration}\n\n${companionLine}` : narration,
        },
      });
    }

    for (const warning of warnings) {
      await tx.message.create({
        data: {
          sessionId,
          role: "system",
          kind: "warning",
          content: warning,
        },
      });
    }

    if (validated.memorySummary) {
      await tx.memoryEntry.create({
        data: {
          campaignId: snapshot.campaignId,
          sessionId,
          type: "turn_memory",
          summary: validated.memorySummary,
        },
      });
    }
  });
}

export async function triageTurn(input: {
  campaignId: string;
  sessionId: string;
  playerAction: string;
  slowPath?: boolean;
  stream?: TurnStream;
}) {
  const snapshot = await getCampaignSnapshot(input.campaignId);

  if (!snapshot) {
    throw new Error("Campaign not found.");
  }

  const promptContext = getPromptContext(snapshot);
  let streamedNarration = "";
  const turn = await prisma.turn.create({
    data: {
      campaignId: input.campaignId,
      sessionId: input.sessionId,
      playerAction: input.playerAction,
      slowPathRequested: Boolean(input.slowPath),
      status: "triaging",
    },
  });

  const decision = await dmClient.triageTurn(
    {
      blueprint: snapshot.blueprint,
      promptContext,
      playerAction: input.playerAction,
    },
    {
      onNarration: (chunk) => {
        streamedNarration += chunk;
        input.stream?.narration?.(chunk);
      },
    },
  );

  if (decision.requiresCheck && decision.check) {
    await prisma.turn.update({
      where: { id: turn.id },
      data: {
        status: "pending_check",
        pendingCheckJson: decision.check,
      },
    });

    await prisma.campaign.update({
      where: { id: input.campaignId },
      data: {
        stateJson: {
          ...(snapshot.state as object),
          pendingTurnId: turn.id,
        },
      },
    });

    return {
      type: "check_required" as const,
      turnId: turn.id,
      check: decision.check,
      suggestedActions: decision.suggestedActions,
    };
  }

  const validated = validateDelta({
    blueprint: snapshot.blueprint,
    state: snapshot.state,
    quests: snapshot.quests,
    arcs: snapshot.arcs,
    clues: snapshot.clues,
    npcs: snapshot.npcs,
    proposedDelta: decision.proposedDelta,
  });

  await commitValidatedTurn({
    snapshot,
    sessionId: input.sessionId,
    turnId: turn.id,
    playerAction: input.playerAction,
    validated,
    warnings: validated.warnings,
    narration: streamedNarration.trim() || decision.proposedDelta.sceneSummary,
  });

  return {
    type: "resolved" as const,
    turnId: turn.id,
    validated,
    suggestedActions: decision.suggestedActions,
  };
}

export async function resolvePendingCheck(input: {
  turnId: string;
  stream?: TurnStream;
}) {
  const turn = await prisma.turn.findUnique({
    where: { id: input.turnId },
    include: {
      campaign: true,
      session: true,
    },
  });

  if (!turn || turn.status !== "pending_check" || !turn.pendingCheckJson) {
    throw new Error("Pending turn not found.");
  }

  const snapshot = await getCampaignSnapshot(turn.campaignId);

  if (!snapshot) {
    throw new Error("Campaign not found.");
  }

  const pendingCheck = turn.pendingCheckJson as PendingCheck;
  const checkResult = rollCheck({
    stat: pendingCheck.stat,
    mode: pendingCheck.mode,
    reason: pendingCheck.reason,
    character: snapshot.character,
  });
  input.stream?.checkResult?.(checkResult);

  const promptContext = getPromptContext(snapshot);
  let streamedNarration = "";
  const decision = await dmClient.resolveTurn(
    {
      blueprint: snapshot.blueprint,
      promptContext,
      playerAction: turn.playerAction,
      checkResult,
    },
    {
      onNarration: (chunk) => {
        streamedNarration += chunk;
        input.stream?.narration?.(chunk);
      },
    },
  );

  const validated = validateDelta({
    blueprint: snapshot.blueprint,
    state: snapshot.state,
    quests: snapshot.quests,
    arcs: snapshot.arcs,
    clues: snapshot.clues,
    npcs: snapshot.npcs,
    proposedDelta: decision.proposedDelta,
  });

  await commitValidatedTurn({
    snapshot,
    sessionId: turn.sessionId,
    turnId: turn.id,
    playerAction: turn.playerAction,
    validated,
    warnings: validated.warnings,
    narration: streamedNarration.trim() || decision.proposedDelta.sceneSummary,
    checkResult,
  });

  return {
    checkResult,
    validated,
    suggestedActions: decision.suggestedActions,
  };
}

export async function summarizeSession(sessionId: string) {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: {
      campaign: true,
      messages: {
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!session) {
    throw new Error("Session not found.");
  }

  const summary = await dmClient.summarizeSession(
    session.messages.map((message) => `${message.role}: ${message.content}`),
  );

  await prisma.$transaction([
    prisma.session.update({
      where: { id: session.id },
      data: { summary },
    }),
    prisma.memoryEntry.create({
      data: {
        campaignId: session.campaignId,
        sessionId: session.id,
        type: "session_summary",
        summary,
      },
    }),
    prisma.message.create({
      data: {
        sessionId: session.id,
        role: "system",
        kind: "summary",
        content: summary,
      },
    }),
  ]);

  return summary;
}

export async function maybeGeneratePreviouslyOn(campaignId: string) {
  const snapshot = await getCampaignSnapshot(campaignId);

  if (!snapshot || !snapshot.sessionId) {
    return null;
  }

  const lastMessage = snapshot.recentMessages.at(-1);
  const lastSummary = snapshot.memories.find((entry) => entry.type === "session_summary");

  if (!lastMessage || !lastSummary) {
    return null;
  }

  const thirtyMinutes = 30 * 60 * 1000;
  const isStale = Date.now() - new Date(lastMessage.createdAt).getTime() > thirtyMinutes;

  if (!isStale) {
    return null;
  }

  return dmClient.generatePreviouslyOn(
    lastSummary.summary,
    snapshot.state.sceneState.title,
    snapshot.clues.filter((clue) => clue.status !== "resolved").map((clue) => clue.text),
  );
}
