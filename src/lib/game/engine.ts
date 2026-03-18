import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { dmClient, getTurnQualityMeta } from "@/lib/ai/provider";
import { rollCheck } from "@/lib/game/checks";
import {
  getCampaignSnapshot,
  getPromptContext,
} from "@/lib/game/repository";
import { validateDelta } from "@/lib/game/validation";
import type {
  CampaignSnapshot,
  CheckResult,
  PendingCheck,
  ProposedStateDelta,
  TurnFacts,
} from "@/lib/game/types";

type TurnStream = {
  narration?: (chunk: string) => void;
  checkResult?: (result: CheckResult) => void;
};

type TurnRollbackData = {
  previousState: CampaignSnapshot["state"];
  previousCharacter: Pick<CampaignSnapshot["character"], "health" | "gold" | "inventory">;
  previousSessionTurnCount: number;
  quests: {
    id: string;
    stage: number;
    status: string;
    discoveredAtTurn: number | null;
  }[];
  arcs: {
    id: string;
    currentTurn: number;
    status: string;
  }[];
  npcs: {
    id: string;
    approval: number;
    discoveredAtTurn: number | null;
  }[];
  clues: {
    id: string;
    status: string;
    discoveredAtTurn: number | null;
  }[];
  messageIds: string[];
  memoryEntryId: string | null;
};

const KEYWORD_STOPWORDS = new Set([
  "with",
  "from",
  "that",
  "this",
  "into",
  "your",
  "their",
  "about",
  "before",
  "after",
]);

function normalizeActionOptions(actions: string[]) {
  return Array.from(
    new Set(actions.map((action) => action.trim()).filter(Boolean)),
  ).slice(0, 4);
}

function dedupeWarnings(warnings: string[]) {
  return Array.from(new Set(warnings.map((warning) => warning.trim()).filter(Boolean)));
}

function keywordSet(value: string) {
  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 4 && !KEYWORD_STOPWORDS.has(token)),
  );
}

function hasStrongKeywordOverlap(left: string, right: string) {
  const a = keywordSet(left);
  const b = keywordSet(right);

  if (!a.size || !b.size) {
    return false;
  }

  let overlap = 0;
  for (const token of a) {
    if (b.has(token)) {
      overlap += 1;
    }
  }

  return overlap >= Math.min(2, Math.min(a.size, b.size));
}

function isGenericAction(action: string) {
  return /^(press forward before the moment closes|search for the hidden angle here|shift position and see what changes|press this lead before it goes cold|change your approach and test the room)$/i.test(
    action.trim(),
  );
}

function overlapRatio(a: string[], b: string[]) {
  if (!a.length || !b.length) {
    return 0;
  }

  const left = new Set(a.map((item) => item.toLowerCase()));
  const right = new Set(b.map((item) => item.toLowerCase()));
  let overlap = 0;

  for (const value of left) {
    if (right.has(value)) {
      overlap += 1;
    }
  }

  return overlap / Math.max(left.size, right.size);
}

function buildFallbackSuggestedActions(input: {
  currentActions: string[];
  playerAction: string;
  narration: string;
  companionName?: string | null;
}) {
  const narration = input.narration.toLowerCase();
  const companionAction = input.companionName
    ? `Ask ${input.companionName} what they make of it`
    : "Question the nearest witness";

  const options = (() => {
    if (/(figure|cloak|shadow|watcher|stranger|suspect|someone ahead)/.test(narration)) {
      return [
        "Follow the figure before they vanish",
        "Call out and force a reaction",
        companionAction,
        "Circle wide and cut off their escape",
      ];
    }

    if (/(door|gate|lock|window|threshold|barred)/.test(narration)) {
      return [
        "Inspect the barrier more carefully",
        "Listen for movement beyond it",
        "Try a subtler way through",
        companionAction,
      ];
    }

    if (/(notice|letter|ledger|map|journal|inscription|seal)/.test(narration)) {
      return [
        "Study the writing more closely",
        "Look for whoever left it here",
        "Compare it to what you already know",
        companionAction,
      ];
    }

    if (/(crowd|tavern|inn|market|room|patrons|onlookers)/.test(narration)) {
      return [
        "Read the room before acting",
        "Question someone nearby",
        "Slip after the most suspicious person",
        companionAction,
      ];
    }

    if (/(trail|tracks|soot|blood|mud|footprints)/.test(narration)) {
      return [
        "Follow the trail while it is fresh",
        "Inspect the traces for detail",
        "Hide your approach and move carefully",
        companionAction,
      ];
    }

    return [
      "Exploit the opening before the pressure settles",
      "Test the weakest point in the opposition",
      companionAction,
      "Reposition and force a clearer angle",
    ];
  })();

  const normalized = normalizeActionOptions(options).filter(
    (action) =>
      action.toLowerCase() !== input.playerAction.trim().toLowerCase() &&
      !hasStrongKeywordOverlap(action, input.playerAction) &&
      !isGenericAction(action),
  );

  if (overlapRatio(normalized, input.currentActions) >= 0.75) {
    return normalizeActionOptions([
      "Exploit the opening before it closes",
      companionAction,
      "Force a reaction from the nearest pressure point",
      "Shift to a stronger position before they recover",
    ]);
  }

  return normalized;
}

function chooseSuggestedActions(input: {
  currentActions: string[];
  candidateActions: string[];
  playerAction: string;
  narration: string;
  companionName?: string | null;
}) {
  const candidateActions = normalizeActionOptions(input.candidateActions).filter(
    (action) =>
      action.toLowerCase() !== input.playerAction.trim().toLowerCase() &&
      !hasStrongKeywordOverlap(action, input.playerAction) &&
      !isGenericAction(action),
  );

  if (candidateActions.length >= 2 && overlapRatio(candidateActions, input.currentActions) < 0.75) {
    return candidateActions;
  }

  return buildFallbackSuggestedActions(input);
}

function companionInterjection(snapshot: CampaignSnapshot, proposedDelta: ProposedStateDelta) {
  const companion = snapshot.npcs.find((npc) => npc.isCompanion && npc.discoveredAtTurn !== null);

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

function buildTurnFacts(input: {
  snapshot: CampaignSnapshot;
  playerAction: string;
  validated: ReturnType<typeof validateDelta>;
  checkResult?: CheckResult;
}): TurnFacts {
  const { snapshot, playerAction, validated, checkResult } = input;

  return {
    action: playerAction,
    roll: checkResult
      ? `${checkResult.stat} ${checkResult.outcome} (${checkResult.total})`
      : undefined,
    healthDelta: validated.healthDelta ?? 0,
    discoveries: [
      ...validated.acceptedQuestDiscoveries,
      ...validated.acceptedClueDiscoveries,
      ...validated.acceptedRevealTriggers,
      ...validated.acceptedNpcDiscoveries,
    ],
    sceneChanged:
      validated.nextState.sceneState.summary !== snapshot.state.sceneState.summary ||
      validated.nextState.sceneState.title !== snapshot.state.sceneState.title ||
      validated.nextState.sceneState.atmosphere !== snapshot.state.sceneState.atmosphere,
  };
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
  qualityMetadata?: Record<string, unknown>;
}) {
  const {
    snapshot,
    validated,
    sessionId,
    playerAction,
    narration,
    warnings,
    checkResult,
    turnId,
    qualityMetadata,
  } = input;
  const turnFacts = buildTurnFacts({
    snapshot,
    playerAction,
    validated,
    checkResult,
  });

  const companionLine = companionInterjection(snapshot, {
    tensionDelta: validated.nextState.tensionScore - snapshot.state.tensionScore,
    memorySummary: validated.memorySummary,
  });

  await prisma.$transaction(async (tx) => {
    const rollback: TurnRollbackData = {
      previousState: snapshot.state,
      previousCharacter: {
        health: snapshot.character.health,
        gold: snapshot.character.gold,
        inventory: snapshot.character.inventory,
      },
      previousSessionTurnCount: snapshot.state.turnCount,
      quests: snapshot.quests.map((quest) => ({
        id: quest.id,
        stage: quest.stage,
        status: quest.status,
        discoveredAtTurn: quest.discoveredAtTurn,
      })),
      arcs: snapshot.arcs.map((arc) => ({
        id: arc.id,
        currentTurn: arc.currentTurn,
        status: arc.status,
      })),
      npcs: snapshot.npcs.map((npc) => ({
        id: npc.id,
        approval: npc.approval,
        discoveredAtTurn: npc.discoveredAtTurn,
      })),
      clues: snapshot.clues.map((clue) => ({
        id: clue.id,
        status: clue.status,
        discoveredAtTurn: clue.discoveredAtTurn,
      })),
      messageIds: [],
      memoryEntryId: null,
    };

    await tx.campaign.update({
      where: { id: snapshot.campaignId },
      data: {
        stateJson: validated.nextState,
      },
    });

    await tx.characterInstance.update({
      where: { campaignId: snapshot.campaignId },
      data: {
        health: validated.nextCharacter.health,
        gold: validated.nextCharacter.gold,
        inventory: validated.nextCharacter.inventory,
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

    for (const questId of validated.acceptedQuestDiscoveries) {
      await tx.quest.updateMany({
        where: {
          id: questId,
          discoveredAtTurn: null,
        },
        data: {
          discoveredAtTurn: validated.nextState.turnCount,
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

    for (const npcId of validated.acceptedNpcDiscoveries) {
      await tx.nPC.updateMany({
        where: {
          id: npcId,
          discoveredAtTurn: null,
        },
        data: {
          discoveredAtTurn: validated.nextState.turnCount,
        },
      });
    }

    await tx.session.update({
      where: { id: sessionId },
      data: {
        turnCount: validated.nextState.turnCount,
      },
    });

    const userMessage = await tx.message.create({
      data: {
        sessionId,
        role: "user",
        kind: "action",
        content: playerAction,
      },
    });
    rollback.messageIds.push(userMessage.id);

    if (checkResult) {
      const checkMessage = await tx.message.create({
        data: {
          sessionId,
          role: "system",
          kind: "check",
          content: `${checkResult.stat} ${checkResult.outcome} (${checkResult.total})`,
          payload: checkResult,
        },
      });
      rollback.messageIds.push(checkMessage.id);
    }

    if (narration) {
      const narrationMessage = await tx.message.create({
        data: {
          sessionId,
          role: "assistant",
          kind: "narration",
          content: companionLine ? `${narration}\n\n${companionLine}` : narration,
        },
      });
      rollback.messageIds.push(narrationMessage.id);
    }

    for (const warning of warnings) {
      const warningMessage = await tx.message.create({
        data: {
          sessionId,
          role: "system",
          kind: "warning",
          content: warning,
        },
      });
      rollback.messageIds.push(warningMessage.id);
    }

    if (validated.memorySummary) {
      const memoryEntry = await tx.memoryEntry.create({
        data: {
          campaignId: snapshot.campaignId,
          sessionId,
          type: "turn_memory",
          summary: validated.memorySummary,
        },
      });
      rollback.memoryEntryId = memoryEntry.id;
    }

    await tx.turn.update({
      where: { id: turnId },
      data: {
        status: "resolved",
        resultJson: {
          rollback,
          ...(checkResult ? { checkResult } : {}),
          turnFacts,
          ...(qualityMetadata ? { aiQuality: qualityMetadata } : {}),
        } as Prisma.InputJsonValue,
      },
    });
  });
}

export async function cancelPendingTurn(turnId: string) {
  const turn = await prisma.turn.findUnique({
    where: { id: turnId },
    select: {
      id: true,
      campaignId: true,
      status: true,
    },
  });

  if (!turn || turn.status !== "pending_check") {
    throw new Error("Pending turn not found.");
  }

  const snapshot = await getCampaignSnapshot(turn.campaignId);

  if (!snapshot) {
    throw new Error("Campaign not found.");
  }

  await prisma.$transaction([
    prisma.turn.update({
      where: { id: turnId },
      data: {
        status: "cancelled",
        pendingCheckJson: undefined,
      },
    }),
    prisma.campaign.update({
      where: { id: turn.campaignId },
      data: {
        stateJson: {
          ...(snapshot.state as object),
          pendingTurnId: null,
        },
      },
    }),
  ]);
}

export async function revisePendingTurn(input: {
  turnId: string;
  playerAction: string;
}) {
  const turn = await prisma.turn.findUnique({
    where: { id: input.turnId },
    select: {
      id: true,
      status: true,
      pendingCheckJson: true,
    },
  });

  if (!turn || turn.status !== "pending_check" || !turn.pendingCheckJson) {
    throw new Error("Pending turn not found.");
  }

  const pendingCheck = turn.pendingCheckJson as PendingCheck;
  const revisedReason = input.playerAction.trim();

  if (!revisedReason) {
    throw new Error("Edited check text cannot be empty.");
  }

  const revisedCheck: PendingCheck = {
    ...pendingCheck,
    reason: revisedReason,
  };

  await prisma.turn.update({
    where: { id: input.turnId },
    data: {
      playerAction: revisedReason,
      pendingCheckJson: revisedCheck,
    },
  });

  return revisedCheck;
}

export async function retryLastTurn(turnId: string) {
  const turn = await prisma.turn.findUnique({
    where: { id: turnId },
    select: {
      id: true,
      campaignId: true,
      sessionId: true,
      status: true,
      createdAt: true,
      resultJson: true,
    },
  });

  if (!turn || turn.status !== "resolved") {
    throw new Error("Retry is only available for the latest resolved turn.");
  }

  const newerTurn = await prisma.turn.findFirst({
    where: {
      sessionId: turn.sessionId,
      createdAt: {
        gt: turn.createdAt,
      },
      status: {
        notIn: ["cancelled", "retried"],
      },
    },
    select: { id: true },
  });

  if (newerTurn) {
    throw new Error("Only the latest turn can be retried.");
  }

  const resultJson = (turn.resultJson as { rollback?: TurnRollbackData } | null) ?? null;
  const rollback = resultJson?.rollback;

  if (!rollback) {
    throw new Error("This turn cannot be retried.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.campaign.update({
      where: { id: turn.campaignId },
      data: {
        stateJson: rollback.previousState,
      },
    });

    await tx.characterInstance.update({
      where: { campaignId: turn.campaignId },
      data: {
        health: rollback.previousCharacter.health,
        gold: rollback.previousCharacter.gold,
        inventory: rollback.previousCharacter.inventory,
      },
    });

    await tx.session.update({
      where: { id: turn.sessionId },
      data: {
        turnCount: rollback.previousSessionTurnCount,
      },
    });

    for (const quest of rollback.quests) {
      await tx.quest.update({
        where: { id: quest.id },
        data: {
          stage: quest.stage,
          status: quest.status,
          discoveredAtTurn: quest.discoveredAtTurn,
        },
      });
    }

    for (const arc of rollback.arcs) {
      await tx.arc.update({
        where: { id: arc.id },
        data: {
          currentTurn: arc.currentTurn,
          status: arc.status,
        },
      });
    }

    for (const npc of rollback.npcs) {
      await tx.nPC.update({
        where: { id: npc.id },
        data: {
          approval: npc.approval,
          discoveredAtTurn: npc.discoveredAtTurn,
        },
      });
    }

    for (const clue of rollback.clues) {
      await tx.clue.update({
        where: { id: clue.id },
        data: {
          status: clue.status,
          discoveredAtTurn: clue.discoveredAtTurn,
        },
      });
    }

    if (rollback.messageIds.length) {
      await tx.message.deleteMany({
        where: {
          id: {
            in: rollback.messageIds,
          },
        },
      });
    }

    if (rollback.memoryEntryId) {
      await tx.memoryEntry.deleteMany({
        where: { id: rollback.memoryEntryId },
      });
    }

    await tx.turn.update({
      where: { id: turnId },
      data: {
        status: "retried",
      },
    });
  });

  return getCampaignSnapshot(turn.campaignId);
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

  const promptContext = await getPromptContext(snapshot);
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
  const qualityMeta = getTurnQualityMeta(decision);
  const providerWarnings = qualityMeta?.warnings ?? [];

  const narration = streamedNarration.trim() || decision.narration?.trim() || "";
  const narrationForActions = narration || snapshot.state.sceneState.summary;
  const suggestedActions = chooseSuggestedActions({
    currentActions: snapshot.state.sceneState.suggestedActions,
    candidateActions: decision.suggestedActions,
    playerAction: input.playerAction,
    narration: narrationForActions,
    companionName: promptContext.companion?.name,
  });
  const proposedDelta = {
    ...decision.proposedDelta,
    suggestedActions,
  };

  if (decision.requiresCheck && decision.check) {
    const pendingCheck: PendingCheck = {
      ...decision.check,
      isInvestigative: decision.isInvestigative,
    };

    await prisma.turn.update({
      where: { id: turn.id },
      data: {
        status: "pending_check",
        pendingCheckJson: pendingCheck,
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
      check: pendingCheck,
      suggestedActions,
      warnings: providerWarnings,
    };
  }

  const validated = validateDelta({
    blueprint: snapshot.blueprint,
    state: snapshot.state,
    character: snapshot.character,
    quests: snapshot.quests,
    arcs: snapshot.arcs,
    clues: snapshot.clues,
    npcs: snapshot.npcs,
    proposedDelta,
  });

  const combinedWarnings = dedupeWarnings([...validated.warnings, ...providerWarnings]);

  await commitValidatedTurn({
    snapshot,
    sessionId: input.sessionId,
    turnId: turn.id,
    playerAction: input.playerAction,
    validated,
    warnings: combinedWarnings,
    narration: narration || undefined,
    qualityMetadata: qualityMeta?.quality as Record<string, unknown> | undefined,
  });

  return {
    type: "resolved" as const,
    turnId: turn.id,
    validated,
    suggestedActions: validated.nextState.sceneState.suggestedActions,
    warnings: combinedWarnings,
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

  const promptContext = await getPromptContext(snapshot);
  let streamedNarration = "";
  const decision = await dmClient.resolveTurn(
    {
      blueprint: snapshot.blueprint,
      promptContext,
      playerAction: turn.playerAction,
      checkResult,
      isInvestigative: pendingCheck.isInvestigative,
    },
    {
      onNarration: (chunk) => {
        streamedNarration += chunk;
        input.stream?.narration?.(chunk);
      },
    },
  );
  const qualityMeta = getTurnQualityMeta(decision);
  const providerWarnings = qualityMeta?.warnings ?? [];

  const narration = streamedNarration.trim() || decision.narration.trim() || "";
  const narrationForActions = narration || snapshot.state.sceneState.summary;
  const suggestedActions = chooseSuggestedActions({
    currentActions: snapshot.state.sceneState.suggestedActions,
    candidateActions: decision.suggestedActions,
    playerAction: turn.playerAction,
    narration: narrationForActions,
    companionName: promptContext.companion?.name,
  });
  const proposedDelta = {
    ...decision.proposedDelta,
    suggestedActions,
  };

  const validated = validateDelta({
    blueprint: snapshot.blueprint,
    state: snapshot.state,
    character: snapshot.character,
    quests: snapshot.quests,
    arcs: snapshot.arcs,
    clues: snapshot.clues,
    npcs: snapshot.npcs,
    proposedDelta,
  });

  const combinedWarnings = dedupeWarnings([...validated.warnings, ...providerWarnings]);

  await commitValidatedTurn({
    snapshot,
    sessionId: turn.sessionId,
    turnId: turn.id,
    playerAction: turn.playerAction,
    validated,
    warnings: combinedWarnings,
    narration: narration || undefined,
    checkResult,
    qualityMetadata: qualityMeta?.quality as Record<string, unknown> | undefined,
  });

  return {
    checkResult,
    validated,
    suggestedActions: validated.nextState.sceneState.suggestedActions,
    warnings: combinedWarnings,
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

export async function maybeGeneratePreviouslyOn(snapshot: CampaignSnapshot | null) {
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

  return Promise.race([
    dmClient.generatePreviouslyOn(
      lastSummary.summary,
      snapshot.state.sceneState.title,
      snapshot.clues.filter((clue) => clue.status === "discovered").map((clue) => clue.text),
    ),
    new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), 1200);
    }),
  ]);
}
