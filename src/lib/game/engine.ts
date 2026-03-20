import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { dmClient } from "@/lib/ai/provider";
import { getCampaignSnapshot, getPromptContext } from "@/lib/game/repository";
import type {
  CampaignRuntimeState,
  CampaignSnapshot,
  CheckResult,
  RequestClarificationToolCall,
  ValidatedTurnCommand,
} from "@/lib/game/types";
import { validateTurnCommand, TIME_MODE_BOUNDS } from "@/lib/game/validation";

type TurnStream = {
  narration?: (chunk: string) => void;
  checkResult?: (result: CheckResult) => void;
};

function dedupeStrings(values: string[]) {
  return Array.from(new Set(values.map((entry) => entry.trim()).filter(Boolean)));
}

function nextStateFromCommand(snapshot: CampaignSnapshot, command: Exclude<ValidatedTurnCommand, RequestClarificationToolCall>): CampaignRuntimeState {
  const discoveredInformationIds = new Set(snapshot.state.discoveredInformationIds);
  const locationId =
    command.type === "execute_travel" ? command.targetLocationId : snapshot.state.currentLocationId;

  const discoveredIds =
    "discoverInformationIds" in command ? command.discoverInformationIds ?? [] : [];
  for (const id of discoveredIds) {
    discoveredInformationIds.add(id);
  }

  return {
    currentLocationId: locationId,
    globalTime: snapshot.state.globalTime + command.timeElapsed,
    pendingTurnId: null,
    lastActionSummary:
      command.type === "execute_freeform"
        ? command.intendedMechanicalOutcome
        : command.narration,
    discoveredInformationIds: Array.from(discoveredInformationIds),
  };
}

async function commitResolvedTurn(input: {
  snapshot: CampaignSnapshot;
  sessionId: string;
  turnId: string;
  playerAction: string;
  command: Exclude<ValidatedTurnCommand, RequestClarificationToolCall>;
}) {
  const { snapshot, sessionId, turnId, playerAction, command } = input;
  const nextState = nextStateFromCommand(snapshot, command);
  const nextTurnCount = snapshot.recentMessages.filter((message) => message.kind === "action").length + 1;

  await prisma.$transaction(async (tx) => {
    await tx.campaign.update({
      where: { id: snapshot.campaignId },
      data: {
        stateJson: nextState,
      },
    });

    if (command.type === "execute_converse" && typeof command.approvalDelta === "number") {
      await tx.nPC.update({
        where: { id: command.npcId },
        data: {
          approval: {
            increment: command.approvalDelta,
          },
        },
      });
    }

    if ("discoverInformationIds" in command && command.discoverInformationIds?.length) {
      await tx.information.updateMany({
        where: {
          campaignId: snapshot.campaignId,
          id: {
            in: command.discoverInformationIds,
          },
        },
        data: {
          isDiscovered: true,
          discoveredAtTurn: nextTurnCount,
        },
      });
    }

    await tx.session.update({
      where: { id: sessionId },
      data: {
        turnCount: {
          increment: 1,
        },
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

    if (command.checkResult) {
      await tx.message.create({
        data: {
          sessionId,
          role: "system",
          kind: "warning",
          content: `${command.checkResult.stat.toUpperCase()} ${command.checkResult.outcome} (${command.checkResult.total})`,
          payload: command.checkResult,
        },
      });
    }

    await tx.message.create({
      data: {
        sessionId,
        role: "assistant",
        kind: "narration",
        content:
          command.type === "execute_freeform" && command.checkResult?.outcome === "failure"
            ? `${command.narration}\n\n${command.failureConsequence ?? "The attempt costs time and exposes a new complication."}`
            : command.narration,
        payload:
          command.type === "execute_freeform"
            ? ({
                intendedMechanicalOutcome: command.intendedMechanicalOutcome,
                checkResult: command.checkResult ?? null,
              } as Prisma.JsonObject)
            : undefined,
      },
    });

    for (const warning of command.warnings) {
      await tx.message.create({
        data: {
          sessionId,
          role: "system",
          kind: "warning",
          content: warning,
        },
      });
    }

    if ("memorySummary" in command && command.memorySummary?.trim()) {
      await tx.memoryEntry.create({
        data: {
          campaignId: snapshot.campaignId,
          sessionId,
          type: "turn_memory",
          summary: command.memorySummary.trim(),
        },
      });
    }

    await tx.turn.update({
      where: { id: turnId },
      data: {
        status: "resolved",
        toolCallJson: command as unknown as Prisma.JsonObject,
        resultJson: {
          state: nextState,
          warnings: command.warnings,
          checkResult: command.checkResult ?? null,
        },
      },
    });
  });
}

export { TIME_MODE_BOUNDS };

export async function triageTurn(input: {
  campaignId: string;
  sessionId: string;
  playerAction: string;
  stream?: TurnStream;
}) {
  const snapshot = await getCampaignSnapshot(input.campaignId);

  if (!snapshot) {
    throw new Error("Campaign not found.");
  }

  const promptContext = await getPromptContext(snapshot);
  const turn = await prisma.turn.create({
    data: {
      campaignId: snapshot.campaignId,
      sessionId: input.sessionId,
      playerAction: input.playerAction,
      status: "processing",
    },
  });

  const command = await dmClient.runTurn({
    promptContext,
    character: snapshot.character,
    playerAction: input.playerAction,
  });
  const validated = validateTurnCommand({
    snapshot,
    command,
  });

  if (validated.type === "request_clarification") {
    await prisma.turn.update({
      where: { id: turn.id },
      data: {
        status: "clarification_requested",
        toolCallJson: validated as unknown as Prisma.JsonObject,
      },
    });

    return {
      type: "clarification" as const,
      turnId: turn.id,
      question: validated.question,
      options: validated.options,
      warnings: [],
    };
  }

  input.stream?.narration?.(validated.narration);
  if (validated.checkResult) {
    input.stream?.checkResult?.(validated.checkResult);
  }

  await commitResolvedTurn({
    snapshot,
    sessionId: input.sessionId,
    turnId: turn.id,
    playerAction: input.playerAction,
    command: validated,
  });

  return {
    type: "resolved" as const,
    turnId: turn.id,
    narration: validated.narration,
    suggestedActions: dedupeStrings(validated.suggestedActions),
    warnings: validated.warnings,
    checkResult: validated.checkResult,
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

export async function maybeGeneratePreviouslyOn() {
  return null;
}

export async function cancelPendingTurn() {
  throw new Error("Pending-turn cancellation is not supported in the spatial turn loop.");
}

export async function resolvePendingCheck() {
  throw new Error("Separate pending checks are not used in the spatial turn loop.");
}

export async function revisePendingCheck() {
  throw new Error("Pending-turn editing is not supported in the spatial turn loop.");
}

export async function retryLastTurn() {
  throw new Error("Turn retry is not implemented in pass 1.");
}
