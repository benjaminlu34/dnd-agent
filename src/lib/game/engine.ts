import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { dmClient, logBackendDiagnostic } from "@/lib/ai/provider";
import { renderWhatChanged, renderWhy } from "@/lib/game/causality";
import { parseTurnResultPayloadJson, toCampaignRuntimeStateJson, toTurnResultPayloadJson } from "@/lib/game/json-contracts";
import {
  FetchSynchronizationError,
  InvalidExpectedStateVersionError,
  StateConflictError,
  TurnAbandonedError,
  TurnLockedError,
} from "@/lib/game/errors";
import {
  fetchFactionIntel,
  fetchInformationConnections,
  fetchInformationDetail,
  fetchMarketPrices,
  fetchNpcDetail,
  fetchRelationshipHistory,
  getMissedTurnDigests,
  getPromptContext,
  getTurnRouterContext,
  getTurnSnapshot,
  toPlayerCampaignSnapshot,
} from "@/lib/game/repository";
import { wakeScheduleGenerationJobs } from "@/lib/game/schedule-jobs";
import {
  MAX_CASCADE_DEPTH,
  applySimulationInverse,
  parseNpcRoutineCondition,
  parseSimulationPayload,
  runSimulationTick,
} from "@/lib/game/simulation";
import type {
  CampaignRuntimeState,
  CampaignSnapshot,
  CheckResult,
  InfrastructureFailureCode,
  LocalTextureSummary,
  PromotedNpcHydrationDraft,
  RequestClarificationToolCall,
  RouterClassification,
  RetryRequiredResponse,
  StateConflictResponse,
  TurnCausalityCode,
  TurnFetchToolCall,
  TurnFetchToolResult,
  TurnMode,
  TurnResolution,
  TurnRollbackData,
  TurnResultPayload,
  TurnSubmissionRequest,
  ValidatedTurnCommand,
} from "@/lib/game/types";
import { validateTurnCommand, TIME_MODE_BOUNDS } from "@/lib/game/validation";
import { env } from "@/lib/env";

type TurnStream = {
  narration?: (chunk: string) => void;
  checkResult?: (result: CheckResult) => void;
};

const TURN_LOCK_TTL_MS = 120_000;
const TURN_INTERNAL_DEADLINE_MS = 115_000;
const HYDRATION_CLAIM_TTL_MS = 120_000;

const activeTurnControllers = new Map<string, AbortController>();
const activeCommitTurnKeys = new Set<string>();

function activeTurnKey(campaignId: string, requestId: string) {
  return `${campaignId}:${requestId}`;
}

function requestHashForSubmission(input: {
  campaignId: string;
  sessionId: string;
  expectedStateVersion: number;
  playerAction: string;
  intent?: TurnSubmissionRequest["intent"];
  turnMode: TurnMode;
}) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        campaignId: input.campaignId,
        sessionId: input.sessionId,
        expectedStateVersion: input.expectedStateVersion,
        action: input.playerAction.trim(),
        intent: input.intent ?? null,
        turnMode: input.turnMode,
      }),
    )
    .digest("hex");
}

function dedupeStrings(values: string[]) {
  return Array.from(new Set(values.map((entry) => entry.trim()).filter(Boolean)));
}

function dayNumberForTime(globalTime: number) {
  return Math.floor(globalTime / 1440) + 1;
}

function safeCommittedWindowEnd(snapshot: CampaignSnapshot) {
  return snapshot.generatedThroughDay * 1440 - 1;
}

function availableAdvanceMinutes(snapshot: CampaignSnapshot) {
  return Math.max(0, safeCommittedWindowEnd(snapshot) - snapshot.state.globalTime);
}

function extractRequestedAdvanceMinutes(playerAction: string) {
  const normalized = playerAction.toLowerCase();
  const match = normalized.match(/(\d+)\s*(minute|minutes|hour|hours|day|days)/);
  if (!match) {
    if (/\buntil (dawn|morning)\b/.test(normalized)) {
      return 480;
    }
    if (/\buntil (evening|night)\b/.test(normalized)) {
      return 720;
    }
    return null;
  }

  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }

  switch (match[2]) {
    case "minute":
    case "minutes":
      return value;
    case "hour":
    case "hours":
      return value * 60;
    case "day":
    case "days":
      return value * 1440;
    default:
      return null;
  }
}

function buildNarrationOverride(input: {
  playerAction: string;
  snapshot: CampaignSnapshot;
}) {
  const requestedAdvanceMinutes = extractRequestedAdvanceMinutes(input.playerAction);
  const availableMinutes = availableAdvanceMinutes(input.snapshot);
  if (requestedAdvanceMinutes == null || requestedAdvanceMinutes <= availableMinutes) {
    return {
      playerActionForModel: input.playerAction,
      overrideText: null,
      requestedAdvanceMinutes,
      availableAdvanceMinutes: availableMinutes,
    };
  }

  const overrideText =
    `System override: if this action becomes a wait, sleep, rest, or other time skip, the narration may cover at most ${availableMinutes} minutes because the world is only committed through minute ${safeCommittedWindowEnd(input.snapshot)}.`;

  return {
    playerActionForModel: `${input.playerAction}\n\n${overrideText}`,
    overrideText,
    requestedAdvanceMinutes,
    availableAdvanceMinutes: availableMinutes,
  };
}

function applyCommittedTimeWindow(input: {
  snapshot: CampaignSnapshot;
  command: Exclude<ValidatedTurnCommand, RequestClarificationToolCall>;
  overrideText: string | null;
  requestedAdvanceMinutes: number | null;
}) {
  const availableMinutes = availableAdvanceMinutes(input.snapshot);
  const committedAdvanceMinutes = Math.min(input.command.timeElapsed, availableMinutes);

  return {
    ...input.command,
    timeElapsed: committedAdvanceMinutes,
    narrationBounds: {
      requestedAdvanceMinutes: input.requestedAdvanceMinutes ?? input.command.timeElapsed,
      committedAdvanceMinutes,
      availableAdvanceMinutes: availableMinutes,
      wasCapped: committedAdvanceMinutes < input.command.timeElapsed,
      overrideText: input.overrideText,
    },
  } satisfies Exclude<ValidatedTurnCommand, RequestClarificationToolCall>;
}

function promptContextProfileForRouter(classification: RouterClassification) {
  return classification.confidence === "high" ? classification.profile : "full";
}

function isRepairableTurnValidationError(message: string) {
  return (
    /intent_overcommit_(trade|combat|investigate|converse)/i.test(message)
    || /narration_voice_first_person/i.test(message)
    || /narration_parroting_player_action/i.test(message)
    || /narration_too_thin/i.test(message)
    || /execute_freeform cannot replace typed combat or trade actions/i.test(message)
    || /execute_scene_interaction cannot replace typed trade or combat actions/i.test(message)
    || /execute_scene_interaction cannot replace explicit conversation or negotiation/i.test(message)
    || /execute_scene_interaction cannot replace explicit investigation/i.test(message)
    || /Approaching a present NPC within the current scene is not execute_travel/i.test(message)
  );
}

async function cleanupTurnLock(input: {
  campaignId: string;
  requestId: string;
}) {
  await prisma.campaign.updateMany({
    where: {
      id: input.campaignId,
      turnLockRequestId: input.requestId,
    },
    data: {
      turnLockRequestId: null,
      turnLockSessionId: null,
      turnLockExpiresAt: null,
    },
  });
}

async function enqueueFutureScheduleBuffer(input: {
  tx: Prisma.TransactionClient;
  snapshot: CampaignSnapshot;
  nextState: CampaignRuntimeState;
  turnId: string;
  rollback: TurnRollbackData;
}) {
  const previousDay = dayNumberForTime(input.snapshot.state.globalTime);
  const nextDay = dayNumberForTime(input.nextState.globalTime);
  if (nextDay <= previousDay) {
    return [];
  }

  const queuedDay = nextDay + 1;
  const existing = await input.tx.scheduleGenerationJob.findUnique({
    where: {
      campaignId_dayNumber: {
        campaignId: input.snapshot.campaignId,
        dayNumber: queuedDay,
      },
    },
    select: { id: true },
  });

  if (existing) {
    return [];
  }

  const job = await input.tx.scheduleGenerationJob.create({
    data: {
      campaignId: input.snapshot.campaignId,
      queuedByTurnId: input.turnId,
      dayNumber: queuedDay,
      dayStartTime: (queuedDay - 1) * 1440,
      status: "pending",
      attempts: 0,
    },
  });
  input.rollback.createdScheduleJobIds.push(job.id);
  recordCreated(input.rollback, "scheduleGenerationJob", job.id);

  return [
    {
      code: "SCHEDULE_JOB_ENQUEUED",
      entityType: "schedule_job",
      targetId: job.id,
      metadata: { dayNumber: queuedDay, label: `Day ${queuedDay}` },
    } satisfies TurnCausalityCode,
  ];
}

function normalizeTemporaryActorLabel(label: string) {
  return label.trim().replace(/\s+/g, " ");
}

function toPromotedTemporaryActorDescriptor(label: string) {
  const cleaned = normalizeTemporaryActorLabel(label)
    .replace(/^(the same|the|a|an|this|that|nearest|nearby|local|same)\s+/i, "")
    .replace(/\b(?:near|by|at|outside|inside|behind|beside|under|over|around|from)\b.*$/i, "")
    .replace(/[.,;:!?]+$/g, "")
    .trim();

  return cleaned || "unnamed local";
}

function toPromotedTemporaryActorName(label: string) {
  const value = toPromotedTemporaryActorDescriptor(label);
  return value.replace(/\b\w/g, (character) => character.toUpperCase());
}

function toPromotedTemporaryActorRole(label: string) {
  return toPromotedTemporaryActorDescriptor(label).toLowerCase();
}

function buildPromotedTemporaryActorSeedText(input: {
  actor: {
    label: string;
    recentTopics: string[];
    lastSummary: string | null;
  };
  role: string;
  locationName: string;
}) {
  const topicTrail = dedupeStrings(input.actor.recentTopics).slice(-2);
  const topicPhrase = topicTrail.length
    ? ` The player has already spoken with them about ${topicTrail.join(" and ")}.`
    : "";
  const fallbackBase =
    `A recurring ${input.role} around ${input.locationName}, known in play as ${input.actor.label}.`;

  return {
    summary: input.actor.lastSummary?.trim() || fallbackBase,
    description:
      input.actor.lastSummary?.trim()
        ? `${input.actor.lastSummary.trim()}${topicPhrase}`
        : `${fallbackBase}${topicPhrase}`,
  };
}

function shouldPromoteTemporaryActor(input: {
  interactionCount: number;
  holdsInventory: boolean;
  affectedWorldState: boolean;
  isInMemoryGraph: boolean;
  promotedNpcId: string | null;
}) {
  if (input.promotedNpcId) {
    return false;
  }

  return (
    input.interactionCount >= 2 ||
    input.holdsInventory ||
    input.affectedWorldState ||
    input.isInMemoryGraph
  );
}

function nextStateFromCommand(
  snapshot: CampaignSnapshot,
  command: Exclude<ValidatedTurnCommand, RequestClarificationToolCall>,
): CampaignRuntimeState {
  const locationId =
    command.type === "execute_travel" ? command.targetLocationId : snapshot.state.currentLocationId;

  return {
    currentLocationId: locationId,
    globalTime: snapshot.state.globalTime + command.timeElapsed,
    pendingTurnId: null,
    lastActionSummary:
      command.type === "execute_freeform"
        ? command.intendedMechanicalOutcome
        : command.narration,
  };
}

function recordInverse(
  rollback: TurnRollbackData,
  table: string,
  id: string,
  field: string,
  previousValue: unknown,
) {
  rollback.simulationInverses.push({
    table,
    id,
    field,
    previousValue,
    operation: "update",
  });
}

function recordCreated(rollback: TurnRollbackData, table: string, id: string) {
  rollback.simulationInverses.push({
    table,
    id,
    field: "id",
    previousValue: null,
    operation: "delete_created",
  });
}

function emptyRollback(snapshot: CampaignSnapshot): TurnRollbackData {
  return {
    previousState: structuredClone(snapshot.state),
    previousSessionTurnCount: snapshot.sessionTurnCount,
    createdMessageIds: [],
    createdMemoryIds: [],
    createdMemoryLinkIds: [],
    discoveredInformation: [],
    simulationInverses: [],
    processedEventIds: [],
    cancelledMoveIds: [],
    createdWorldEventIds: [],
    createdFactionMoveIds: [],
    createdScheduleJobIds: [],
    createdTemporaryActorIds: [],
    createdCommodityStackIds: [],
  };
}

function toPrismaJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function toLocalTextureSummary(value: Prisma.JsonValue | null): LocalTextureSummary | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const dominantActivities = Array.isArray(record.dominantActivities)
    ? record.dominantActivities
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter(Boolean)
        .slice(0, 3)
    : [];
  const publicHazards = Array.isArray(record.publicHazards)
    ? record.publicHazards
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter(Boolean)
        .slice(0, 2)
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

function trimToNull(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function sanitizePromotedNpcHydrationDraft(input: {
  draft: PromotedNpcHydrationDraft;
  currentLocationId: string;
  localFactionIds: Set<string>;
  fallbackSummary: string;
  fallbackDescription: string;
}) {
  const summary = trimToNull(input.draft.summary) ?? input.fallbackSummary;
  const description = trimToNull(input.draft.description) ?? input.fallbackDescription;
  const factionId =
    input.draft.factionId && input.localFactionIds.has(input.draft.factionId)
      ? input.draft.factionId
      : null;
  const information = input.draft.information.slice(0, 2).flatMap((lead) => {
    const title = trimToNull(lead.title);
    const summaryText = trimToNull(lead.summary);
    const content = trimToNull(lead.content);

    if (!title || !summaryText || !content) {
      return [];
    }

    if (lead.locationId && lead.locationId !== input.currentLocationId) {
      return [];
    }

    return [
      {
        title,
        summary: summaryText,
        content,
        truthfulness: lead.truthfulness,
        accessibility: lead.accessibility,
        locationId: input.currentLocationId,
        factionId:
          lead.factionId && input.localFactionIds.has(lead.factionId) ? lead.factionId : null,
      },
    ];
  });

  return {
    summary,
    description,
    factionId,
    information,
  };
}

async function hydratePromotedNpcRecord(input: {
  campaignId: string;
  npcId: string;
  claimRequestId: string;
}) {
  const npc = await prisma.nPC.findFirst({
    where: { id: input.npcId, campaignId: input.campaignId },
    select: {
      id: true,
      campaignId: true,
      name: true,
      role: true,
      summary: true,
      description: true,
      factionId: true,
      currentLocationId: true,
      isNarrativelyHydrated: true,
      hydrationClaimRequestId: true,
      hydrationClaimExpiresAt: true,
      socialLayer: true,
    },
  });

  if (!npc) {
    throw new Error("Promoted NPC not found.");
  }

  if (npc.isNarrativelyHydrated) {
    return;
  }

  if (!npc.currentLocationId) {
    throw new Error("Promoted NPC has no current location for hydration.");
  }

  const location = await prisma.locationNode.findFirst({
    where: { id: npc.currentLocationId, campaignId: input.campaignId },
    select: {
      id: true,
      name: true,
      type: true,
      summary: true,
      state: true,
      controllingFactionId: true,
      localTextureJson: true,
    },
  });
  const localNpcs = await prisma.nPC.findMany({
    where: {
      campaignId: input.campaignId,
      currentLocationId: npc.currentLocationId,
    },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      role: true,
      factionId: true,
    },
    take: 8,
  });
  const localInformation = await prisma.information.findMany({
    where: {
      campaignId: input.campaignId,
      locationId: npc.currentLocationId,
    },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      title: true,
      summary: true,
      truthfulness: true,
      accessibility: true,
      factionId: true,
    },
    take: 8,
  });
  const temporaryActor = await prisma.temporaryActor.findFirst({
    where: {
      campaignId: input.campaignId,
      promotedNpcId: npc.id,
    },
    select: {
      label: true,
      interactionCount: true,
      recentTopics: true,
      lastSummary: true,
    },
  });
  const nearbyEdges = await prisma.locationEdge.findMany({
    where: {
      campaignId: input.campaignId,
      OR: [{ sourceId: npc.currentLocationId }, { targetId: npc.currentLocationId }],
    },
    include: {
      source: {
        select: {
          id: true,
          name: true,
        },
      },
      target: {
        select: {
          id: true,
          name: true,
        },
      },
    },
    orderBy: [{ travelTimeMinutes: "asc" }, { dangerLevel: "asc" }],
    take: 6,
  });

  if (!location) {
    throw new Error("Promoted NPC location not found.");
  }

  const localFactionIds = new Set<string>();
  if (location.controllingFactionId) {
    localFactionIds.add(location.controllingFactionId);
  }
  for (const localNpc of localNpcs) {
    if (localNpc.factionId) {
      localFactionIds.add(localNpc.factionId);
    }
  }
  for (const information of localInformation) {
    if (information.factionId) {
      localFactionIds.add(information.factionId);
    }
  }

  const localFactions = localFactionIds.size
    ? await prisma.faction.findMany({
        where: {
          campaignId: input.campaignId,
          id: {
            in: Array.from(localFactionIds),
          },
        },
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          type: true,
          summary: true,
          agenda: true,
        },
      })
    : [];

  const draft = sanitizePromotedNpcHydrationDraft({
    draft: await dmClient.hydratePromotedNpc({
      npc: {
        id: npc.id,
        name: npc.name,
        role: npc.role,
        summary: npc.summary,
        description: npc.description,
      },
      location: {
        id: location.id,
        name: location.name,
        type: location.type,
        summary: location.summary,
        state: location.state,
        localTexture: toLocalTextureSummary(location.localTextureJson),
      },
      localFactions: localFactions.map((faction) => ({
        id: faction.id,
        name: faction.name,
        type: faction.type,
        summary: faction.summary,
        agenda: faction.agenda,
      })),
      localNpcs: localNpcs
        .filter((localNpc) => localNpc.id !== npc.id)
        .map((localNpc) => ({
          id: localNpc.id,
          name: localNpc.name,
          role: localNpc.role,
          factionId: localNpc.factionId,
        })),
      localInformation: localInformation.map((information) => ({
        id: information.id,
        title: information.title,
        summary: information.summary,
        truthfulness: information.truthfulness,
        accessibility: information.accessibility,
        factionId: information.factionId,
      })),
      nearbyRoutes: nearbyEdges.map((edge) => {
        const target = edge.sourceId === npc.currentLocationId ? edge.target : edge.source;
        return {
          id: edge.id,
          targetLocationName: target.name,
          travelTimeMinutes: edge.travelTimeMinutes,
          currentStatus: edge.currentStatus,
        };
      }),
      temporaryActor: {
        label: temporaryActor?.label ?? npc.role,
        interactionCount: temporaryActor?.interactionCount ?? 0,
        recentTopics: temporaryActor?.recentTopics ?? [],
        lastSummary: temporaryActor?.lastSummary ?? npc.summary,
      },
    }),
    currentLocationId: location.id,
    localFactionIds,
    fallbackSummary: npc.summary,
    fallbackDescription: npc.description,
  });

  await prisma.$transaction(async (tx) => {
    const finalized = await tx.nPC.updateMany({
      where: {
        id: npc.id,
        campaignId: input.campaignId,
        isNarrativelyHydrated: false,
        hydrationClaimRequestId: input.claimRequestId,
      },
      data: {
        summary: draft.summary,
        description: draft.description,
        factionId: draft.factionId,
        isNarrativelyHydrated: true,
        hydrationClaimRequestId: null,
        hydrationClaimExpiresAt: null,
      },
    });
    if (finalized.count === 0) {
      return;
    }
  });
}

function findFetchedMarketPrice(
  fetchedFacts: TurnFetchToolResult[],
  marketPriceId: string,
  commodityId: string,
) {
  for (const fact of fetchedFacts) {
    if (fact.type !== "fetch_market_prices") {
      continue;
    }

    const match = fact.result.find(
      (entry) => entry.marketPriceId === marketPriceId && entry.commodityId === commodityId,
    );
    if (match) {
      return match;
    }
  }

  return null;
}

async function createTestingMoveForFaction(input: {
  tx: Prisma.TransactionClient;
  campaignId: string;
  factionId: string;
  scheduledAtTime: number;
  description: string;
  rollback: TurnRollbackData;
}) {
  const moveId = `fmove_${randomUUID()}`;
  await input.tx.factionMove.create({
    data: {
      id: moveId,
      campaignId: input.campaignId,
      factionId: input.factionId,
      scheduledAtTime: input.scheduledAtTime,
      description: input.description,
      payload: {
        type: "change_faction_resources",
        factionId: input.factionId,
        delta: {
          information: 1,
        },
      },
      cascadeDepth: 1,
    },
  });
  input.rollback.createdFactionMoveIds.push(moveId);
  recordCreated(input.rollback, "factionMove", moveId);
}

async function trackUnnamedLocalInteraction(input: {
  tx: Prisma.TransactionClient;
  snapshot: CampaignSnapshot;
  command: Exclude<ValidatedTurnCommand, RequestClarificationToolCall>;
  rollback: TurnRollbackData;
}) {
  if (input.command.type !== "execute_converse" || input.command.npcId) {
    return;
  }

  const label = normalizeTemporaryActorLabel(input.command.interlocutor);
  const lastSeenAtTurn = input.snapshot.sessionTurnCount + 1;
  const lastSeenAtTime = input.snapshot.state.globalTime + input.command.timeElapsed;
  const nextLastSummary = input.command.memorySummary ?? input.command.narration;
  const nextIsInMemoryGraph = Boolean(input.command.memorySummary?.trim());
  let actor:
    | Prisma.TemporaryActorGetPayload<Record<string, never>>
    | null = null;

  const existing = await input.tx.temporaryActor.findUnique({
    where: {
      campaignId_currentLocationId_label: {
        campaignId: input.snapshot.campaignId,
        currentLocationId: input.snapshot.state.currentLocationId,
        label,
      },
    },
  });

  if (!existing) {
    actor = await input.tx.temporaryActor.create({
      data: {
        campaignId: input.snapshot.campaignId,
        label,
        currentLocationId: input.snapshot.state.currentLocationId,
        interactionCount: 1,
        firstSeenAtTurn: lastSeenAtTurn,
        lastSeenAtTurn,
        lastSeenAtTime,
        recentTopics: [input.command.topic],
        lastSummary: nextLastSummary,
        isInMemoryGraph: nextIsInMemoryGraph,
      },
    });

    input.rollback.createdTemporaryActorIds.push(actor.id);
    recordCreated(input.rollback, "temporaryActor", actor.id);
  } else {
    recordInverse(
      input.rollback,
      "temporaryActor",
      existing.id,
      "interactionCount",
      existing.interactionCount,
    );
    recordInverse(input.rollback, "temporaryActor", existing.id, "lastSeenAtTurn", existing.lastSeenAtTurn);
    recordInverse(input.rollback, "temporaryActor", existing.id, "lastSeenAtTime", existing.lastSeenAtTime);
    recordInverse(input.rollback, "temporaryActor", existing.id, "recentTopics", existing.recentTopics);
    recordInverse(input.rollback, "temporaryActor", existing.id, "lastSummary", existing.lastSummary);
    recordInverse(
      input.rollback,
      "temporaryActor",
      existing.id,
      "isInMemoryGraph",
      existing.isInMemoryGraph,
    );

    actor = await input.tx.temporaryActor.update({
      where: { id: existing.id },
      data: {
        interactionCount: {
          increment: 1,
        },
        lastSeenAtTurn,
        lastSeenAtTime,
        recentTopics: dedupeStrings([...existing.recentTopics, input.command.topic]).slice(-4),
        lastSummary: nextLastSummary,
        isInMemoryGraph: existing.isInMemoryGraph || nextIsInMemoryGraph,
      },
    });
  }

  if (!actor) {
    return;
  }

  if (
    !shouldPromoteTemporaryActor({
      interactionCount: actor.interactionCount,
      holdsInventory: actor.holdsInventory,
      affectedWorldState: actor.affectedWorldState,
      isInMemoryGraph: actor.isInMemoryGraph,
      promotedNpcId: actor.promotedNpcId,
    })
  ) {
    return;
  }

  const promotedNpcId = `npc_local_${randomUUID()}`;
  const promotedRole = toPromotedTemporaryActorRole(actor.label);
  const promotedSeed = buildPromotedTemporaryActorSeedText({
    actor,
    role: promotedRole,
    locationName: input.snapshot.currentLocation.name,
  });
  await input.tx.nPC.create({
    data: {
      id: promotedNpcId,
      campaignId: input.snapshot.campaignId,
      name: toPromotedTemporaryActorName(actor.label),
      role: promotedRole,
      summary: promotedSeed.summary,
      description: promotedSeed.description,
      socialLayer: "promoted_local",
      isNarrativelyHydrated: false,
      hydrationClaimRequestId: null,
      hydrationClaimExpiresAt: null,
      factionId: null,
      currentLocationId: actor.currentLocationId,
      approval: 0,
      isCompanion: false,
      state: "active",
      threatLevel: 1,
    },
  });
  recordCreated(input.rollback, "nPC", promotedNpcId);
  recordInverse(input.rollback, "temporaryActor", actor.id, "promotedNpcId", actor.promotedNpcId);

  await input.tx.temporaryActor.update({
    where: { id: actor.id },
    data: {
      promotedNpcId,
    },
  });
}

async function applyInformationDiscoveries(input: {
  tx: Prisma.TransactionClient;
  snapshot: CampaignSnapshot;
  ids: string[] | undefined;
  nextTurnCount: number;
  rollback: TurnRollbackData;
}) {
  if (!input.ids?.length) {
    return;
  }

  const existing = await input.tx.information.findMany({
    where: {
      campaignId: input.snapshot.campaignId,
      id: {
        in: input.ids,
      },
    },
    select: {
      id: true,
      isDiscovered: true,
      discoveredAtTurn: true,
    },
  });

  for (const information of existing) {
    input.rollback.discoveredInformation.push({
      id: information.id,
      previousIsDiscovered: information.isDiscovered,
      previousDiscoveredAtTurn: information.discoveredAtTurn,
    });
  }

  await input.tx.information.updateMany({
    where: {
      campaignId: input.snapshot.campaignId,
      id: {
        in: input.ids,
      },
    },
    data: {
      isDiscovered: true,
      discoveredAtTurn: input.nextTurnCount,
    },
  });
}

async function applyTradeEffects(input: {
  tx: Prisma.TransactionClient;
  snapshot: CampaignSnapshot;
  command: Extract<ValidatedTurnCommand, { type: "execute_trade" }>;
  fetchedFacts: TurnFetchToolResult[];
  rollback: TurnRollbackData;
}) {
  const price = findFetchedMarketPrice(
    input.fetchedFacts,
    input.command.marketPriceId,
    input.command.commodityId,
  );

  if (!price) {
    throw new Error("Trade commit missing fetched market price.");
  }

  const total = price.price * input.command.quantity;
  const characterInstance = await input.tx.characterInstance.findUnique({
    where: { campaignId: input.snapshot.campaignId },
    include: {
      commodityStacks: {
        where: { commodityId: input.command.commodityId },
      },
    },
  });

  if (!characterInstance) {
    throw new Error("Character instance not found.");
  }

  recordInverse(input.rollback, "characterInstance", characterInstance.id, "gold", characterInstance.gold);

  if (input.command.action === "buy") {
    await input.tx.characterInstance.update({
      where: { id: characterInstance.id },
      data: {
        gold: {
          decrement: total,
        },
      },
    });

    const marketPrice = await input.tx.marketPrice.findUnique({
      where: { id: input.command.marketPriceId },
      select: { id: true, stock: true },
    });
    if (marketPrice && marketPrice.stock !== -1) {
      recordInverse(input.rollback, "marketPrice", marketPrice.id, "stock", marketPrice.stock);
      await input.tx.marketPrice.update({
        where: { id: marketPrice.id },
        data: {
          stock: {
            decrement: input.command.quantity,
          },
          restockTime: input.snapshot.state.globalTime + 720,
        },
      });
    }

    const existingStack = characterInstance.commodityStacks[0];
    if (existingStack) {
      recordInverse(
        input.rollback,
        "characterCommodityStack",
        existingStack.id,
        "quantity",
        existingStack.quantity,
      );
      await input.tx.characterCommodityStack.update({
        where: { id: existingStack.id },
        data: {
          quantity: {
            increment: input.command.quantity,
          },
        },
      });
    } else {
      const created = await input.tx.characterCommodityStack.create({
        data: {
          characterInstanceId: characterInstance.id,
          commodityId: input.command.commodityId,
          quantity: input.command.quantity,
        },
      });
      input.rollback.createdCommodityStackIds.push(created.id);
      recordCreated(input.rollback, "characterCommodityStack", created.id);
    }
    return;
  }

  await input.tx.characterInstance.update({
    where: { id: characterInstance.id },
    data: {
      gold: {
        increment: total,
      },
    },
  });

  const marketPrice = await input.tx.marketPrice.findUnique({
    where: { id: input.command.marketPriceId },
    select: { id: true, stock: true },
  });
  if (marketPrice && marketPrice.stock !== -1) {
    recordInverse(input.rollback, "marketPrice", marketPrice.id, "stock", marketPrice.stock);
    await input.tx.marketPrice.update({
      where: { id: marketPrice.id },
      data: {
        stock: {
          increment: input.command.quantity,
        },
      },
    });
  }

  const existingStack = characterInstance.commodityStacks[0];
  if (!existingStack) {
    throw new Error("Commodity stack missing during sell.");
  }

  recordInverse(
    input.rollback,
    "characterCommodityStack",
    existingStack.id,
    "quantity",
    existingStack.quantity,
  );
  await input.tx.characterCommodityStack.update({
    where: { id: existingStack.id },
    data: {
      quantity: {
        decrement: input.command.quantity,
      },
    },
  });
}

async function applyCombatEffects(input: {
  tx: Prisma.TransactionClient;
  snapshot: CampaignSnapshot;
  command: Extract<ValidatedTurnCommand, { type: "execute_combat" }>;
  rollback: TurnRollbackData;
}) {
  if (!input.command.checkResult || input.command.checkResult.outcome === "failure") {
    return [];
  }

  const target = await input.tx.nPC.findUnique({
    where: { id: input.command.targetNpcId },
    select: {
      id: true,
      state: true,
      factionId: true,
      name: true,
    },
  });

  if (!target) {
    throw new Error("Combat target not found.");
  }

  let nextState = target.state;
  if (input.command.approach === "attack") {
    nextState =
      target.state === "active"
        ? "wounded"
        : target.state === "wounded" || target.state === "incapacitated"
          ? "dead"
          : target.state;
  } else if (input.command.approach === "subdue") {
    nextState = target.state === "dead" ? "dead" : "incapacitated";
  } else if (input.command.approach === "assassinate") {
    nextState = "dead";
  }

  if (nextState !== target.state) {
    recordInverse(input.rollback, "nPC", target.id, "state", target.state);
    await input.tx.nPC.update({
      where: { id: target.id },
      data: {
        state: nextState,
      },
    });
  }

  if (!target.factionId) {
    return [];
  }

  await createTestingMoveForFaction({
    tx: input.tx,
    campaignId: input.snapshot.campaignId,
    factionId: target.factionId,
    scheduledAtTime: input.snapshot.state.globalTime + input.command.timeElapsed + 30,
    description: `${target.name}'s faction reacts to violence in the area.`,
    rollback: input.rollback,
  });

  return [target.factionId];
}

async function applyRestEffects(input: {
  tx: Prisma.TransactionClient;
  snapshot: CampaignSnapshot;
  command: Extract<ValidatedTurnCommand, { type: "execute_rest" }>;
  rollback: TurnRollbackData;
}) {
  const requiredDuration = input.command.restType === "full" ? 480 : 360;
  if (input.command.timeElapsed < requiredDuration) {
    return;
  }

  const characterInstance = await input.tx.characterInstance.findUnique({
    where: { campaignId: input.snapshot.campaignId },
    select: { id: true, health: true },
  });

  if (!characterInstance) {
    throw new Error("Character instance not found.");
  }

  const minimumLightRestHealth = Math.ceil(input.snapshot.character.maxHealth * 0.5);
  const restoredHealth =
    input.command.restType === "full"
      ? input.snapshot.character.maxHealth
      : Math.max(characterInstance.health, minimumLightRestHealth);

  if (restoredHealth === characterInstance.health) {
    return;
  }

  recordInverse(input.rollback, "characterInstance", characterInstance.id, "health", characterInstance.health);
  await input.tx.characterInstance.update({
    where: { id: characterInstance.id },
    data: {
      health: restoredHealth,
    },
  });
}

async function resolveDiscoveryIds(input: {
  tx: Prisma.TransactionClient;
  snapshot: CampaignSnapshot;
  command: Exclude<ValidatedTurnCommand, RequestClarificationToolCall>;
}) {
  const discoveryIntent =
    "discoveryIntent" in input.command && input.command.discoveryIntent
      ? input.command.discoveryIntent
      : "none";

  if (discoveryIntent === "none") {
    return [];
  }

  const locationIds = new Set<string>([input.snapshot.currentLocation.id]);
  const factionIds = new Set<string>();
  const npcIds = new Set<string>();

  if (input.command.type === "execute_converse" && input.command.npcId) {
    npcIds.add(input.command.npcId);
  }
  if (input.command.type === "execute_investigate" && input.command.targetType === "npc") {
    npcIds.add(input.command.targetId);
  }
  if (input.command.type === "execute_observe" && input.command.targetType === "npc") {
    npcIds.add(input.command.targetId);
  }
  if (input.command.type === "execute_observe" && input.command.targetType === "faction") {
    factionIds.add(input.command.targetId);
  }
  if (input.command.type === "execute_investigate" && input.command.targetType === "location") {
    locationIds.add(input.command.targetId);
  }

  for (const npc of input.snapshot.presentNpcs) {
    if (npc.factionId) {
      factionIds.add(npc.factionId);
    }
  }
  if (input.snapshot.currentLocation.controllingFactionId) {
    factionIds.add(input.snapshot.currentLocation.controllingFactionId);
  }

  const [locationKnowledge, factionKnowledge, npcKnowledge] = await Promise.all([
    input.tx.locationKnowledge.findMany({
      where: {
        campaignId: input.snapshot.campaignId,
        locationId: {
          in: Array.from(locationIds),
        },
      },
      select: { informationId: true },
    }),
    input.tx.factionKnowledge.findMany({
      where: {
        campaignId: input.snapshot.campaignId,
        factionId: {
          in: Array.from(factionIds),
        },
      },
      select: { informationId: true },
    }),
    input.tx.npcKnowledge.findMany({
      where: {
        campaignId: input.snapshot.campaignId,
        npcId: {
          in: Array.from(npcIds),
        },
        ...(discoveryIntent === "deep"
          ? {}
          : {
              shareability: {
                not: "private",
              },
            }),
      },
      select: { informationId: true },
    }),
  ]);

  const candidateIds = Array.from(
    new Set(
      [...locationKnowledge, ...factionKnowledge, ...npcKnowledge].map(
        (entry) => entry.informationId,
      ),
    ),
  );
  if (!candidateIds.length) {
    return [];
  }

  const candidates = await input.tx.information.findMany({
    where: {
      campaignId: input.snapshot.campaignId,
      id: {
        in: candidateIds,
      },
      isDiscovered: false,
    },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
  });

  const maxDiscoveries = discoveryIntent === "surface" ? 1 : 2;

  return candidates
    .filter((information) => {
      if (information.accessibility === "public") {
        return true;
      }
      if (information.accessibility === "guarded") {
        return true;
      }
      return discoveryIntent === "deep" || input.command.type === "execute_investigate";
    })
    .slice(0, maxDiscoveries)
    .map((information) => information.id);
}

async function applyPlayerActionEffects(input: {
  tx: Prisma.TransactionClient;
  snapshot: CampaignSnapshot;
  command: Exclude<ValidatedTurnCommand, RequestClarificationToolCall>;
  fetchedFacts: TurnFetchToolResult[];
  rollback: TurnRollbackData;
  nextTurnCount: number;
}) {
  const affectedFactionIds = new Set<string>();

  if (input.command.type === "execute_converse" && input.command.npcId && typeof input.command.relationshipDelta === "number") {
    const npc = await input.tx.nPC.findUnique({
      where: { id: input.command.npcId },
      select: { id: true, approval: true, factionId: true },
    });

    if (npc) {
      recordInverse(input.rollback, "nPC", npc.id, "approval", npc.approval);
      await input.tx.nPC.update({
        where: { id: npc.id },
        data: {
          approval: {
            increment: input.command.relationshipDelta,
          },
        },
      });
      if (npc.factionId) {
        affectedFactionIds.add(npc.factionId);
      }
    }
  }

  const discoverInformationIds = await resolveDiscoveryIds({
    tx: input.tx,
    snapshot: input.snapshot,
    command: input.command,
  });

  if (discoverInformationIds.length) {
    await applyInformationDiscoveries({
      tx: input.tx,
      snapshot: input.snapshot,
      ids: discoverInformationIds,
      nextTurnCount: input.nextTurnCount,
      rollback: input.rollback,
    });
  }

  await trackUnnamedLocalInteraction({
    tx: input.tx,
    snapshot: input.snapshot,
    command: input.command,
    rollback: input.rollback,
  });

  if (input.command.type === "execute_trade") {
    await applyTradeEffects({
      tx: input.tx,
      snapshot: input.snapshot,
      command: input.command,
      fetchedFacts: input.fetchedFacts,
      rollback: input.rollback,
    });
  }

  if (input.command.type === "execute_combat") {
    const combatFactions = await applyCombatEffects({
      tx: input.tx,
      snapshot: input.snapshot,
      command: input.command,
      rollback: input.rollback,
    });
    for (const factionId of combatFactions) {
      affectedFactionIds.add(factionId);
    }
  }

  if (input.command.type === "execute_rest") {
    await applyRestEffects({
      tx: input.tx,
      snapshot: input.snapshot,
      command: input.command,
      rollback: input.rollback,
    });
  }

  return {
    affectedFactionIds: Array.from(affectedFactionIds),
    discoveredInformationIds: discoverInformationIds,
  };
}

async function createMessage(input: {
  tx: Prisma.TransactionClient;
  sessionId: string;
  role: "user" | "assistant" | "system";
  kind: "action" | "narration" | "warning" | "summary";
  content: string;
  payload?: Prisma.JsonObject | null;
  rollback: TurnRollbackData;
}) {
  const message = await input.tx.message.create({
    data: {
      sessionId: input.sessionId,
      role: input.role,
      kind: input.kind,
      content: input.content,
      payload: input.payload ?? undefined,
    },
  });
  input.rollback.createdMessageIds.push(message.id);
  return message;
}

async function ensureDailyScheduleGenerated(input: {
  tx: Prisma.TransactionClient;
  snapshot: CampaignSnapshot;
  dayStartTime: number;
  rollback: TurnRollbackData;
}) {
  const dayEndTime = input.dayStartTime + 1439;
  const existingCount = await input.tx.worldEvent.count({
    where: {
      campaignId: input.snapshot.campaignId,
      triggerTime: {
        gte: input.dayStartTime,
        lte: dayEndTime,
      },
    },
  });

  if (existingCount > 0) {
    return;
  }

  const [locations, factions, npcs, information] = await Promise.all([
    input.tx.locationNode.findMany({
      where: { campaignId: input.snapshot.campaignId },
      orderBy: { name: "asc" },
    }),
    input.tx.faction.findMany({
      where: { campaignId: input.snapshot.campaignId },
      orderBy: { name: "asc" },
    }),
    input.tx.nPC.findMany({
      where: { campaignId: input.snapshot.campaignId },
      orderBy: { name: "asc" },
    }),
    input.tx.information.findMany({
      where: {
        campaignId: input.snapshot.campaignId,
        isDiscovered: true,
      },
      orderBy: { updatedAt: "desc" },
      take: 12,
    }),
  ]);

  const schedule = await dmClient.generateDailyWorldSchedule({
    campaign: {
      id: input.snapshot.campaignId,
      title: input.snapshot.title,
      premise: input.snapshot.premise,
      tone: input.snapshot.tone,
      setting: input.snapshot.setting,
      currentLocationId: input.snapshot.state.currentLocationId,
      dayStartTime: input.dayStartTime,
      locations: locations.map((location) => ({
        id: location.id,
        name: location.name,
        type: location.type,
        state: location.state,
        controllingFactionId: location.controllingFactionId,
      })),
      factions: factions.map((faction) => ({
        id: faction.id,
        name: faction.name,
        type: faction.type,
        agenda: faction.agenda,
        pressureClock: faction.pressureClock,
        resources: faction.resources,
      })),
      npcs: npcs.map((npc) => ({
        id: npc.id,
        name: npc.name,
        role: npc.role,
        factionId: npc.factionId,
        currentLocationId: npc.currentLocationId,
        state: npc.state,
        threatLevel: npc.threatLevel,
      })),
      discoveredInformation: information.map((entry) => ({
        id: entry.id,
        title: entry.title,
        summary: entry.summary,
        truthfulness: entry.truthfulness,
        locationId: entry.locationId,
        factionId: entry.factionId,
      })),
    },
  });

  for (const event of schedule.worldEvents) {
    const parsedCondition = event.triggerCondition
      ? parseNpcRoutineCondition(event.triggerCondition)
      : null;
    if (parsedCondition && !parsedCondition.success) {
      throw new Error(`Generated invalid world-event condition: ${parsedCondition.error.message}`);
    }

    const parsedPayload = parseSimulationPayload(event.payload);
    if (!parsedPayload.success) {
      throw new Error(`Generated invalid world-event payload: ${parsedPayload.error.message}`);
    }

    const worldEventId = `wevt_${randomUUID()}`;
    await input.tx.worldEvent.create({
      data: {
        id: worldEventId,
        campaignId: input.snapshot.campaignId,
        locationId: event.locationId,
        triggerTime: event.triggerTime,
        triggerCondition: event.triggerCondition
          ? (event.triggerCondition as unknown as Prisma.JsonObject)
          : Prisma.JsonNull,
        description: event.description,
        payload: parsedPayload.data as unknown as Prisma.JsonObject,
        cascadeDepth: Math.min(event.cascadeDepth ?? 0, MAX_CASCADE_DEPTH),
      },
    });
    input.rollback.createdWorldEventIds.push(worldEventId);
    recordCreated(input.rollback, "worldEvent", worldEventId);
  }

  for (const move of schedule.factionMoves) {
    const parsedPayload = parseSimulationPayload(move.payload);
    if (!parsedPayload.success) {
      throw new Error(`Generated invalid faction-move payload: ${parsedPayload.error.message}`);
    }

    const factionMoveId = `fmove_${randomUUID()}`;
    await input.tx.factionMove.create({
      data: {
        id: factionMoveId,
        campaignId: input.snapshot.campaignId,
        factionId: move.factionId,
        scheduledAtTime: move.scheduledAtTime,
        description: move.description,
        payload: parsedPayload.data as unknown as Prisma.JsonObject,
        cascadeDepth: Math.min(move.cascadeDepth ?? 0, MAX_CASCADE_DEPTH),
      },
    });
    input.rollback.createdFactionMoveIds.push(factionMoveId);
    recordCreated(input.rollback, "factionMove", factionMoveId);
  }
}

async function runTemporalSimulation(input: {
  tx: Prisma.TransactionClient;
  snapshot: CampaignSnapshot;
  nextState: CampaignRuntimeState;
  rollback: TurnRollbackData;
  initialAffectedFactionIds: string[];
}) {
  let windowStart = input.snapshot.state.globalTime;
  let firstWindow = true;

  while (windowStart < input.nextState.globalTime) {
    const chunkEnd = Math.min(
      input.nextState.globalTime,
      (Math.floor(windowStart / 1440) + 1) * 1440,
    );

    await runSimulationTick({
      tx: input.tx,
      campaignId: input.snapshot.campaignId,
      playerState: {
        ...input.nextState,
        globalTime: chunkEnd,
      },
      previousTime: windowStart,
      newTime: chunkEnd,
      inverses: input.rollback.simulationInverses,
      processedEventIds: input.rollback.processedEventIds,
      cancelledMoveIds: input.rollback.cancelledMoveIds,
      createdWorldEventIds: input.rollback.createdWorldEventIds,
      createdFactionMoveIds: input.rollback.createdFactionMoveIds,
      initialAffectedFactionIds: firstWindow ? input.initialAffectedFactionIds : [],
    });

    firstWindow = false;
    windowStart = chunkEnd;
  }
}

function determineMemoryKind(command: Exclude<ValidatedTurnCommand, RequestClarificationToolCall>) {
  if (command.type === "execute_combat") {
    return "conflict" as const;
  }
  if (command.type === "execute_trade") {
    return "trade" as const;
  }
  if (command.type === "execute_travel") {
    return "travel" as const;
  }
  if ("discoverInformationIds" in command && command.discoverInformationIds?.length) {
    return "discovery" as const;
  }
  if (command.type === "execute_converse" && (command.relationshipDelta ?? 0) !== 0) {
    return "relationship_shift" as const;
  }

  const promiseText = [
    "memorySummary" in command ? command.memorySummary : null,
    command.narration,
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" ")
    .toLowerCase();
  if (/\b(promise|promised|swear|swore|vow|vowed|agree|agreed|deal|owed|owe|return with|meet again)\b/.test(promiseText)) {
    return "promise" as const;
  }

  return "world_change" as const;
}

function normalizeMemorySummary(value: string | undefined) {
  if (!value) {
    return null;
  }

  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length < 8 || normalized.length > 240) {
    return null;
  }

  return normalized;
}

function isSalientMemory(input: {
  command: Exclude<ValidatedTurnCommand, RequestClarificationToolCall>;
  memoryKind: ReturnType<typeof determineMemoryKind>;
  discoveredInformationIds: string[];
  scheduleChangeCodes: TurnCausalityCode[];
}) {
  if (input.memoryKind !== "world_change") {
    return true;
  }

  return (
    input.discoveredInformationIds.length > 0
    || input.scheduleChangeCodes.length > 0
    || input.command.narrationBounds?.wasCapped === true
    || input.command.checkResult?.outcome === "failure"
  );
}

function buildSystemFallbackMemorySummary(input: {
  snapshot: CampaignSnapshot;
  command: Exclude<ValidatedTurnCommand, RequestClarificationToolCall>;
  memoryKind: ReturnType<typeof determineMemoryKind>;
  discoveredInformationIds: string[];
}) {
  const locationName = input.snapshot.currentLocation.name;

  switch (input.memoryKind) {
    case "conflict":
      return input.command.type === "execute_combat"
        ? `Violence broke out with ${input.command.targetNpcId} in ${locationName}.`
        : `Conflict erupted in ${locationName}.`;
    case "promise":
      return `A new obligation took shape in ${locationName}.`;
    case "relationship_shift":
      return input.command.type === "execute_converse" && input.command.npcId
        ? `Your exchange with ${input.command.npcId} shifted the relationship in ${locationName}.`
        : `A relationship shifted in ${locationName}.`;
    case "discovery":
      return input.discoveredInformationIds.length === 1
        ? `You uncovered a new lead in ${locationName}.`
        : `You uncovered new information in ${locationName}.`;
    case "travel":
      return input.command.type === "execute_travel"
        ? `You traveled from ${locationName} to ${input.command.targetLocationId}.`
        : `You traveled onward from ${locationName}.`;
    case "trade":
      return input.command.type === "execute_trade"
        ? `You completed a trade involving ${input.command.commodityId} in ${locationName}.`
        : `Trade shifted the scene in ${locationName}.`;
    case "world_change":
      if (input.command.narrationBounds?.wasCapped) {
        return `Time advanced only to the edge of the committed world window in ${locationName}.`;
      }
      return `The situation changed in ${locationName}.`;
  }
}

function collectMemoryEntityLinks(input: {
  snapshot: CampaignSnapshot;
  command: Exclude<ValidatedTurnCommand, RequestClarificationToolCall>;
  changeCodes: TurnCausalityCode[];
  reasonCodes: TurnCausalityCode[];
  affectedFactionIds: string[];
  discoveredInformationIds: string[];
}) {
  const keys: string[] = [];
  const pushKey = (entityType: string, entityId: string | null | undefined) => {
    if (entityId) {
      keys.push(`${entityType}:${entityId}`);
    }
  };

  if (input.command.type === "execute_travel") {
    pushKey("location", input.command.targetLocationId);
    pushKey("route", input.command.routeEdgeId);
  } else {
    pushKey("location", input.snapshot.currentLocation.id);
  }

  if (input.command.type === "execute_converse" && input.command.npcId) {
    pushKey("npc", input.command.npcId);
  }
  if (input.command.type === "execute_combat") {
    pushKey("npc", input.command.targetNpcId);
  }
  if (input.command.type === "execute_trade") {
    pushKey("commodity", input.command.commodityId);
  }
  if (input.command.type === "execute_scene_interaction") {
    pushKey(input.command.targetType, input.command.targetId);
  }
  if (input.command.type === "execute_investigate" || input.command.type === "execute_observe") {
    pushKey(input.command.targetType === "route" ? "route" : input.command.targetType, input.command.targetId);
  }

  for (const factionId of input.affectedFactionIds) {
    pushKey("faction", factionId);
  }
  for (const informationId of input.discoveredInformationIds) {
    pushKey("information", informationId);
  }
  for (const code of [...input.changeCodes, ...input.reasonCodes]) {
    pushKey(code.entityType, code.targetId);
  }

  return dedupeStrings(keys).map((entry) => {
    const [entityType, ...entityIdParts] = entry.split(":");
    return {
      entityType,
      entityId: entityIdParts.join(":"),
    };
  });
}

function buildTurnCausality(input: {
  snapshot: CampaignSnapshot;
  command: Exclude<ValidatedTurnCommand, RequestClarificationToolCall>;
  discoveredInformationIds: string[];
  scheduleChangeCodes: TurnCausalityCode[];
}) {
  const nextState = nextStateFromCommand(input.snapshot, input.command);
  const changeCodes: TurnCausalityCode[] = [
    {
      code: "TIME_ADVANCED",
      entityType: "campaign",
      targetId: input.snapshot.campaignId,
      minutes: input.command.timeElapsed,
      metadata: null,
    },
  ];
  const reasonCodes: TurnCausalityCode[] = [];

  if (nextState.currentLocationId !== input.snapshot.state.currentLocationId) {
    changeCodes.push({
      code: "LOCATION_CHANGED",
      entityType: "location",
      targetId: nextState.currentLocationId,
      metadata: { label: nextState.currentLocationId },
    });
    reasonCodes.push({
      code: "PLAYER_TRAVEL",
      entityType: "location",
      targetId: nextState.currentLocationId,
      metadata: null,
    });
  }

  if (input.command.type === "execute_converse" && input.command.npcId && (input.command.relationshipDelta ?? 0) !== 0) {
    changeCodes.push({
      code: "NPC_APPROVAL_CHANGED",
      entityType: "npc",
      targetId: input.command.npcId,
      delta: input.command.relationshipDelta ?? 0,
      metadata: { label: input.command.interlocutor },
    });
    reasonCodes.push({
      code: "PLAYER_CONVERSATION",
      entityType: "npc",
      targetId: input.command.npcId,
      metadata: { label: input.command.interlocutor },
    });
  }

  if (input.command.type === "execute_combat") {
    reasonCodes.push({
      code: "PLAYER_COMBAT",
      entityType: "npc",
      targetId: input.command.targetNpcId,
      metadata: null,
    });
    changeCodes.push({
      code: "NPC_STATE_CHANGED",
      entityType: "npc",
      targetId: input.command.targetNpcId,
      metadata: null,
    });
  }

  if (input.command.type === "execute_trade") {
    reasonCodes.push({
      code: "PLAYER_TRADE",
      entityType: "commodity",
      targetId: input.command.commodityId,
      metadata: null,
    });
  }

  if (input.command.type === "execute_scene_interaction") {
    reasonCodes.push({
      code: "PLAYER_SCENE_INTERACTION",
      entityType: input.command.targetType,
      targetId: input.command.targetId,
      metadata: null,
    });
  }

  if (input.command.type === "execute_rest") {
    reasonCodes.push({
      code: "PLAYER_REST",
      entityType: "character",
      targetId: input.snapshot.character.id,
      minutes: input.command.timeElapsed,
      metadata: null,
    });
  }

  if (input.command.type === "execute_wait") {
    reasonCodes.push({
      code: "PLAYER_WAIT",
      entityType: "campaign",
      targetId: input.snapshot.campaignId,
      minutes: input.command.timeElapsed,
      metadata: null,
    });
  }

  if (input.command.type === "execute_investigate") {
    reasonCodes.push({
      code: "PLAYER_INVESTIGATION",
      entityType: input.command.targetType === "route" ? "route" : input.command.targetType,
      targetId: input.command.targetId,
      metadata: null,
    });
  }

  if (input.command.type === "execute_observe") {
    reasonCodes.push({
      code: "PLAYER_OBSERVATION",
      entityType: input.command.targetType === "route" ? "route" : input.command.targetType,
      targetId: input.command.targetId,
      metadata: null,
    });
  }

  for (const informationId of input.discoveredInformationIds) {
    changeCodes.push({
      code: "INFORMATION_DISCOVERED",
      entityType: "information",
      targetId: informationId,
      metadata: { label: informationId },
    });
  }

  if (input.command.narrationBounds?.wasCapped) {
    reasonCodes.push({
      code: "HORIZON_CAP",
      entityType: "campaign",
      targetId: input.snapshot.campaignId,
      minutes: input.command.narrationBounds.committedAdvanceMinutes,
      metadata: null,
    });
  }

  changeCodes.push(...input.scheduleChangeCodes);
  if (input.scheduleChangeCodes.length) {
    reasonCodes.push({
      code: "SCHEDULE_BUFFER_ROLLED",
      entityType: "campaign",
      targetId: input.snapshot.campaignId,
      metadata: null,
    });
  }

  if (!reasonCodes.length) {
    reasonCodes.push({
      code: "PLAYER_ACTION",
      entityType: "campaign",
      targetId: input.snapshot.campaignId,
      metadata: null,
    });
  }

  return {
    nextState,
    changeCodes,
    reasonCodes,
  };
}

async function commitResolvedTurn(input: {
  snapshot: CampaignSnapshot;
  sessionId: string;
  turnId: string;
  requestId: string;
  expectedStateVersion: number;
  playerAction: string;
  turnMode: TurnMode;
  command: Exclude<ValidatedTurnCommand, RequestClarificationToolCall>;
  fetchedFacts: TurnFetchToolResult[];
}): Promise<TurnResultPayload> {
  const {
    snapshot,
    sessionId,
    turnId,
    requestId,
    expectedStateVersion,
    playerAction,
    turnMode,
    command,
    fetchedFacts,
  } = input;
  const nextTurnCount = snapshot.sessionTurnCount + 1;
  const rollback = emptyRollback(snapshot);
  let resultPayload: TurnResultPayload | null = null;

  await prisma.$transaction(async (tx) => {
    const actionEffects = await applyPlayerActionEffects({
      tx,
      snapshot,
      command,
      fetchedFacts,
      rollback,
      nextTurnCount,
    });

    const causality = buildTurnCausality({
      snapshot,
      command,
      discoveredInformationIds: actionEffects.discoveredInformationIds,
      scheduleChangeCodes: [],
    });
    const nextState = causality.nextState;

    await runTemporalSimulation({
      tx,
      snapshot,
      nextState,
      rollback,
      initialAffectedFactionIds: actionEffects.affectedFactionIds,
    });

    const scheduleChangeCodes = await enqueueFutureScheduleBuffer({
      tx,
      snapshot,
      nextState,
      turnId,
      rollback,
    });

    const finalCausality = buildTurnCausality({
      snapshot,
      command,
      discoveredInformationIds: actionEffects.discoveredInformationIds,
      scheduleChangeCodes,
    });

    const campaignUpdate = await tx.campaign.updateMany({
      where: {
        id: snapshot.campaignId,
        stateVersion: expectedStateVersion,
        turnLockRequestId: requestId,
      },
      data: {
        stateVersion: {
          increment: 1,
        },
        stateJson: toCampaignRuntimeStateJson(nextState),
        turnLockRequestId: null,
        turnLockSessionId: null,
        turnLockExpiresAt: null,
      },
    });

    if (campaignUpdate.count === 0) {
      throw new StateConflictError("Campaign state changed before the turn could commit.", expectedStateVersion);
    }

    await tx.session.update({
      where: { id: sessionId },
      data: {
        turnCount: {
          increment: 1,
        },
      },
    });

    await createMessage({
      tx,
      sessionId,
      role: "user",
      kind: "action",
      content: playerAction,
      payload:
        turnMode === "observe"
          ? ({ turnMode: "observe" } as Prisma.JsonObject)
          : undefined,
      rollback,
    });

    if (command.checkResult) {
      await createMessage({
        tx,
        sessionId,
        role: "system",
        kind: "warning",
        content: `${command.checkResult.stat.toUpperCase()} ${command.checkResult.outcome} (${command.checkResult.total})`,
        payload: command.checkResult as unknown as Prisma.JsonObject,
        rollback,
      });
    }

    await createMessage({
      tx,
      sessionId,
      role: "assistant",
      kind: "narration",
      content:
        command.type === "execute_freeform" && command.checkResult?.outcome === "failure"
          ? `${command.narration}\n\n${command.failureConsequence ?? "The attempt costs time and exposes a new complication."}`
          : command.narration,
      payload: {
        suggestedActions: command.suggestedActions,
        fetchedFacts,
        checkResult: command.checkResult ?? null,
        whatChanged: renderWhatChanged(finalCausality.changeCodes),
        why: renderWhy(finalCausality.reasonCodes),
      } as unknown as Prisma.JsonObject,
      rollback,
    });

    for (const warning of command.warnings) {
      await createMessage({
        tx,
        sessionId,
        role: "system",
        kind: "warning",
        content: warning,
        rollback,
      });
    }

    const memoryKind = determineMemoryKind(command);
    const modelMemorySummary = "memorySummary" in command
      ? normalizeMemorySummary(command.memorySummary)
      : null;
    const shouldRecordMemory = modelMemorySummary != null || isSalientMemory({
      command,
      memoryKind,
      discoveredInformationIds: actionEffects.discoveredInformationIds,
      scheduleChangeCodes,
    });

    if (shouldRecordMemory) {
      const memorySummary = modelMemorySummary ?? buildSystemFallbackMemorySummary({
        snapshot,
        command,
        memoryKind,
        discoveredInformationIds: actionEffects.discoveredInformationIds,
      });
      const memoryEntityLinks = collectMemoryEntityLinks({
        snapshot,
        command,
        changeCodes: finalCausality.changeCodes,
        reasonCodes: finalCausality.reasonCodes,
        affectedFactionIds: actionEffects.affectedFactionIds,
        discoveredInformationIds: actionEffects.discoveredInformationIds,
      });

      if (!memorySummary) {
        throw new Error("A salient memory was selected without a usable summary.");
      }

      const memory = await tx.memoryEntry.create({
        data: {
          campaignId: snapshot.campaignId,
          sessionId,
          turnId,
          type: "turn_memory",
          memoryKind,
          isLongArcCandidate:
            memoryKind === "conflict"
            || memoryKind === "promise"
            || memoryKind === "relationship_shift",
          summary: memorySummary,
          summarySource: modelMemorySummary ? "model" : "system_fallback",
          narrativeNote: command.narration,
        },
      });
      rollback.createdMemoryIds.push(memory.id);

      for (const [index, entityLink] of memoryEntityLinks.entries()) {
        const link = await tx.memoryEntityLink.create({
          data: {
            memoryId: memory.id,
            campaignId: snapshot.campaignId,
            entityType: entityLink.entityType,
            entityId: entityLink.entityId,
            isPrimary: index === 0,
          },
        });
        rollback.createdMemoryLinkIds.push(link.id);
      }
    }

    resultPayload = {
      stateVersionAfter: expectedStateVersion + 1,
      changeCodes: finalCausality.changeCodes,
      reasonCodes: finalCausality.reasonCodes,
      whatChanged: renderWhatChanged(finalCausality.changeCodes),
      why: renderWhy(finalCausality.reasonCodes),
      warnings: command.warnings,
      narrationBounds: command.narrationBounds ?? null,
      checkResult: command.checkResult ?? null,
      rollback,
      clarification: null,
      error: null,
    };

    await tx.turn.update({
      where: { id: turnId },
      data: {
        status: "resolved",
        stateVersionAfter: expectedStateVersion + 1,
        toolCallJson: toPrismaJsonValue(command),
        resultJson: toPrismaJsonValue(toTurnResultPayloadJson(resultPayload)),
      },
    });
  });

  if (!resultPayload) {
    throw new Error("Resolved turn commit did not produce a result payload.");
  }

  return resultPayload;
}

async function executeFetchTool(
  snapshot: CampaignSnapshot,
  call: TurnFetchToolCall,
): Promise<TurnFetchToolResult> {
  if (call.type === "fetch_npc_detail") {
    const result = await fetchNpcDetail(snapshot.campaignId, call.npcId);
    if (!result) {
      throw new Error("NPC detail not found.");
    }

    if (result.socialLayer === "promoted_local" && !result.isNarrativelyHydrated) {
      const claimRequestId = `hydrate_${randomUUID()}`;
      const claimExpiry = new Date(Date.now() + HYDRATION_CLAIM_TTL_MS);
      const claimAttempt = await prisma.nPC.updateMany({
        where: {
          id: result.id,
          campaignId: snapshot.campaignId,
          socialLayer: "promoted_local",
          isNarrativelyHydrated: false,
          OR: [
            { hydrationClaimRequestId: null },
            { hydrationClaimExpiresAt: { lt: new Date() } },
          ],
        },
        data: {
          hydrationClaimRequestId: claimRequestId,
          hydrationClaimExpiresAt: claimExpiry,
        },
      });

      if (claimAttempt.count === 1) {
        try {
          await hydratePromotedNpcRecord({
            campaignId: snapshot.campaignId,
            npcId: result.id,
            claimRequestId,
          });
        } catch (error) {
          await prisma.nPC.updateMany({
            where: {
              id: result.id,
              campaignId: snapshot.campaignId,
              isNarrativelyHydrated: false,
              hydrationClaimRequestId: claimRequestId,
            },
            data: {
              hydrationClaimRequestId: null,
              hydrationClaimExpiresAt: null,
            },
          });
          throw error;
        }

        const hydratedResult = await fetchNpcDetail(snapshot.campaignId, result.id);
        if (!hydratedResult) {
          throw new Error("Hydrated NPC detail not found.");
        }

        return { type: call.type, result: hydratedResult };
      }

      const refreshed = await fetchNpcDetail(snapshot.campaignId, result.id);
      if (!refreshed) {
        throw new Error("NPC detail not found.");
      }
      if (!refreshed.isNarrativelyHydrated) {
        throw new FetchSynchronizationError(
          `${refreshed.name} is still synchronizing promoted NPC detail.`,
        );
      }

      return { type: call.type, result: refreshed };
    }

    return { type: call.type, result };
  }

  if (call.type === "fetch_market_prices") {
    return {
      type: call.type,
      result: await fetchMarketPrices(snapshot.campaignId, call.locationId),
    };
  }

  if (call.type === "fetch_faction_intel") {
    const result = await fetchFactionIntel(snapshot.campaignId, call.factionId);
    if (!result) {
      throw new Error("Faction intel not found.");
    }
    return { type: call.type, result };
  }

  if (call.type === "fetch_information_detail") {
    const result = await fetchInformationDetail(snapshot.campaignId, call.informationId);
    if (!result) {
      throw new Error("Information detail not found.");
    }
    return { type: call.type, result };
  }

  if (call.type === "fetch_information_connections") {
    return {
      type: call.type,
      result: await fetchInformationConnections(snapshot.campaignId, call.informationIds),
    };
  }

  const result = await fetchRelationshipHistory(snapshot.campaignId, call.npcId);
  if (!result) {
    throw new Error("Relationship history not found.");
  }
  return { type: call.type, result };
}

export { TIME_MODE_BOUNDS };
export const engineTestUtils = {
  toPromotedTemporaryActorDescriptor,
  toPromotedTemporaryActorName,
  toPromotedTemporaryActorRole,
  requestHashForSubmission,
  promptContextProfileForRouter,
  isRepairableTurnValidationError,
};

async function buildStateConflictPayload(input: {
  campaignId: string;
  sessionId: string;
  expectedStateVersion: number;
}): Promise<StateConflictResponse> {
  const latestSnapshot = await getTurnSnapshot(input.campaignId, input.sessionId);
  if (!latestSnapshot) {
    throw new Error("Campaign not found.");
  }

  return {
    error: "state_conflict",
    latestSnapshot: toPlayerCampaignSnapshot(latestSnapshot),
    latestStateVersion: latestSnapshot.stateVersion,
    missedTurnDigests: await getMissedTurnDigests(input.campaignId, input.expectedStateVersion),
  };
}

async function markTurnFailure(input: {
  turnId: string;
  status: string;
  infrastructureFailureCode?: InfrastructureFailureCode | null;
  message: string;
}) {
  await prisma.turn.update({
    where: { id: input.turnId },
    data: {
      status: input.status,
      infrastructureFailureCode: input.infrastructureFailureCode ?? null,
      resultJson: toPrismaJsonValue(toTurnResultPayloadJson({
        stateVersionAfter: null,
        changeCodes: [],
        reasonCodes: [],
        whatChanged: [],
        why: [],
        warnings: [],
        narrationBounds: null,
        checkResult: null,
        rollback: null,
        clarification: null,
        error: {
          message: input.message,
          code: input.infrastructureFailureCode ?? input.status,
        },
      })),
    },
  });
}

async function abandonTurnRequest(input: {
  campaignId: string;
  requestId: string;
  turnId: string;
  status: "timed_out" | "abandoned";
  infrastructureFailureCode: InfrastructureFailureCode;
  message: string;
}) {
  await markTurnFailure({
    turnId: input.turnId,
    status: input.status,
    infrastructureFailureCode: input.infrastructureFailureCode,
    message: input.message,
  });
  await cleanupTurnLock({
    campaignId: input.campaignId,
    requestId: input.requestId,
  });
}

async function abandonCancelledTurnIfOwned(input: {
  campaignId: string;
  sessionId: string;
  requestId: string;
  turnId: string;
  message: string;
}) {
  const campaign = await prisma.campaign.findUnique({
    where: { id: input.campaignId },
    select: {
      turnLockRequestId: true,
      turnLockSessionId: true,
    },
  });

  if (
    !campaign
    || campaign.turnLockRequestId !== input.requestId
    || campaign.turnLockSessionId !== input.sessionId
  ) {
    return;
  }

  const abandoned = await prisma.turn.updateMany({
    where: {
      id: input.turnId,
      campaignId: input.campaignId,
      sessionId: input.sessionId,
      requestId: input.requestId,
      status: "processing",
    },
    data: {
      status: "abandoned",
      infrastructureFailureCode: "TURN_CANCELLED",
      resultJson: toPrismaJsonValue(toTurnResultPayloadJson({
        stateVersionAfter: null,
        changeCodes: [],
        reasonCodes: [],
        whatChanged: [],
        why: [],
        warnings: [],
        narrationBounds: null,
        checkResult: null,
        rollback: null,
        clarification: null,
        error: {
          message: input.message,
          code: "TURN_CANCELLED",
        },
      })),
    },
  });

  if (abandoned.count === 1) {
    await cleanupTurnLock({
      campaignId: input.campaignId,
      requestId: input.requestId,
    });
  }
}

async function replayExistingTurn(input: {
  turn: Prisma.TurnGetPayload<Record<string, never>>;
  campaignId: string;
}) {
  const result = parseTurnResultPayloadJson(input.turn.resultJson);

  if (input.turn.status === "clarification_requested" && result?.clarification) {
    return {
      type: "clarification" as const,
      turnId: input.turn.id,
      question: result.clarification.question,
      options: result.clarification.options,
      warnings: result.warnings,
    };
  }

  if (input.turn.status === "conflicted") {
    return {
      type: "state_conflict" as const,
      payload: await buildStateConflictPayload({
        campaignId: input.campaignId,
        sessionId: input.turn.sessionId,
        expectedStateVersion: input.turn.stateVersionAfter ?? 0,
      }),
    };
  }

  if (input.turn.status === "resolved") {
    return {
      type: "resolved" as const,
      turnId: input.turn.id,
      narration: "",
      suggestedActions: [],
      warnings: result?.warnings ?? [],
      checkResult: result?.checkResult ?? undefined,
      result: result ?? {
        stateVersionAfter: input.turn.stateVersionAfter ?? null,
        changeCodes: [],
        reasonCodes: [],
        whatChanged: [],
        why: [],
        warnings: [],
        narrationBounds: null,
        checkResult: null,
        rollback: null,
        clarification: null,
        error: null,
      },
    };
  }

  return null;
}

function retryRequiredResultForTurn(
  turn: Prisma.TurnGetPayload<Record<string, never>>,
): RetryRequiredResponse {
  const result = parseTurnResultPayloadJson(turn.resultJson) ?? {
    stateVersionAfter: turn.stateVersionAfter ?? null,
    changeCodes: [],
    reasonCodes: [],
    whatChanged: [],
    why: [],
    warnings: [],
    narrationBounds: null,
    checkResult: null,
    rollback: null,
    clarification: null,
    error: {
      message: "This request previously ended in a retryable terminal state.",
      code: turn.status,
    },
  };

  return {
    error: "retry_with_new_request_id",
    retryWithNewRequestId: true,
    turnId: turn.id,
    previousStatus: turn.status,
    result,
  };
}

export async function triageTurn(input: TurnSubmissionRequest & {
  stream?: TurnStream;
}) {
  const playerAction = input.action.trim();
  const intent = input.intent;
  const turnMode: TurnMode = input.mode === "observe" ? "observe" : "player_input";
  logBackendDiagnostic("turn.triage.start", {
    campaignId: input.campaignId,
    sessionId: input.sessionId,
    requestId: input.requestId,
    expectedStateVersion: input.expectedStateVersion,
    turnMode,
    intentType: intent?.type ?? null,
    playerActionPreview: playerAction.slice(0, 240),
  });
  const requestHash = requestHashForSubmission({
    campaignId: input.campaignId,
    sessionId: input.sessionId,
    expectedStateVersion: input.expectedStateVersion,
    playerAction,
    intent,
    turnMode,
  });
  const existingTurn = await prisma.turn.findUnique({
    where: {
      campaignId_requestId: {
        campaignId: input.campaignId,
        requestId: input.requestId,
      },
    },
  });

  if (existingTurn) {
    if (existingTurn.requestHash && existingTurn.requestHash !== requestHash) {
      logBackendDiagnostic("turn.triage.request_hash_conflict", {
        campaignId: input.campaignId,
        requestId: input.requestId,
        turnId: existingTurn.id,
      });
      throw new Error("requestId was reused with a different action payload.");
    }

    if (["resolved", "clarification_requested", "conflicted"].includes(existingTurn.status)) {
      const replay = await replayExistingTurn({
        turn: existingTurn,
        campaignId: input.campaignId,
      });
      if (replay) {
        return replay;
      }
    }

    if (
      [
        "timed_out",
        "failed_model",
        "failed_validation",
        "failed_infrastructure",
        "abandoned",
      ].includes(existingTurn.status)
    ) {
      logBackendDiagnostic("turn.triage.retry_required", {
        campaignId: input.campaignId,
        requestId: input.requestId,
        turnId: existingTurn.id,
        previousStatus: existingTurn.status,
      });
      return {
        type: "retry_required" as const,
        payload: retryRequiredResultForTurn(existingTurn),
      };
    }
  }

  const campaign = await prisma.campaign.findUnique({
    where: { id: input.campaignId },
    select: {
      id: true,
      stateVersion: true,
    },
  });

  if (!campaign) {
    throw new Error("Campaign not found.");
  }

  if (input.expectedStateVersion < campaign.stateVersion) {
    logBackendDiagnostic("turn.triage.state_conflict", {
      campaignId: input.campaignId,
      sessionId: input.sessionId,
      requestId: input.requestId,
      expectedStateVersion: input.expectedStateVersion,
      latestStateVersion: campaign.stateVersion,
      reason: "stale_client",
    });
    return {
      type: "state_conflict" as const,
      payload: await buildStateConflictPayload({
        campaignId: input.campaignId,
        sessionId: input.sessionId,
        expectedStateVersion: input.expectedStateVersion,
      }),
    };
  }

  if (input.expectedStateVersion > campaign.stateVersion) {
    logBackendDiagnostic("turn.triage.invalid_expected_state_version", {
      campaignId: input.campaignId,
      requestId: input.requestId,
      expectedStateVersion: input.expectedStateVersion,
      latestStateVersion: campaign.stateVersion,
    });
    throw new InvalidExpectedStateVersionError(
      `expectedStateVersion ${input.expectedStateVersion} is ahead of the campaign state ${campaign.stateVersion}.`,
      campaign.stateVersion,
    );
  }

  const lockClaim = await prisma.campaign.updateMany({
    where: {
      id: input.campaignId,
      stateVersion: input.expectedStateVersion,
      OR: [
        { turnLockRequestId: null },
        { turnLockRequestId: input.requestId },
        { turnLockExpiresAt: { lt: new Date() } },
      ],
    },
    data: {
      turnLockRequestId: input.requestId,
      turnLockSessionId: input.sessionId,
      turnLockExpiresAt: new Date(Date.now() + TURN_LOCK_TTL_MS),
    },
  });

  if (lockClaim.count === 0) {
    const latest = await prisma.campaign.findUnique({
      where: { id: input.campaignId },
      select: { stateVersion: true },
    });
    if (latest && latest.stateVersion > input.expectedStateVersion) {
      logBackendDiagnostic("turn.triage.state_conflict", {
        campaignId: input.campaignId,
        sessionId: input.sessionId,
        requestId: input.requestId,
        expectedStateVersion: input.expectedStateVersion,
        latestStateVersion: latest.stateVersion,
        reason: "lock_claim_revealed_newer_state",
      });
      return {
        type: "state_conflict" as const,
        payload: await buildStateConflictPayload({
          campaignId: input.campaignId,
          sessionId: input.sessionId,
          expectedStateVersion: input.expectedStateVersion,
        }),
      };
    }
    logBackendDiagnostic("turn.triage.lock_conflict", {
      campaignId: input.campaignId,
      sessionId: input.sessionId,
      requestId: input.requestId,
      expectedStateVersion: input.expectedStateVersion,
    });
    throw new TurnLockedError("Another turn already owns the campaign lock.");
  }
  logBackendDiagnostic("turn.triage.lock_claimed", {
    campaignId: input.campaignId,
    sessionId: input.sessionId,
    requestId: input.requestId,
    expectedStateVersion: input.expectedStateVersion,
  });

  const turn = existingTurn
    ? await prisma.turn.update({
        where: { id: existingTurn.id },
        data: {
          status: "processing",
          playerAction,
          requestHash,
          infrastructureFailureCode: null,
          resultJson: Prisma.JsonNull,
          toolCallJson: Prisma.JsonNull,
          stateVersionAfter: null,
        },
      })
    : await prisma.turn.create({
        data: {
          campaignId: input.campaignId,
          sessionId: input.sessionId,
          requestId: input.requestId,
          requestHash,
          playerAction,
          status: "processing",
        },
      });
  logBackendDiagnostic("turn.triage.turn_row_ready", {
    campaignId: input.campaignId,
    sessionId: input.sessionId,
    requestId: input.requestId,
    turnId: turn.id,
    reusedExistingTurn: Boolean(existingTurn),
  });

  const abortController = new AbortController();
  const turnKey = activeTurnKey(input.campaignId, input.requestId);
  activeTurnControllers.set(turnKey, abortController);
  const timeout = setTimeout(() => {
    abortController.abort("deadline_exceeded");
  }, TURN_INTERNAL_DEADLINE_MS);
  let commitStarted = false;

  try {
    const snapshot = await getTurnSnapshot(input.campaignId, input.sessionId);
    if (!snapshot) {
      throw new Error("Campaign session not found.");
    }
    logBackendDiagnostic("turn.snapshot.loaded", {
      campaignId: input.campaignId,
      sessionId: input.sessionId,
      requestId: input.requestId,
      turnId: turn.id,
      stateVersion: snapshot.stateVersion,
      locationId: snapshot.currentLocation.id,
      presentNpcCount: snapshot.presentNpcs.length,
      activePressureCount: snapshot.activePressures.length,
      activeThreadCount: snapshot.activeThreads.length,
    });

    const routerClassification =
      turnMode === "observe" || intent?.type === "travel_route"
        ? ({
            profile: "full",
            confidence: "low",
            authorizedCommitments: [],
            reason: "Router classification skipped for observe mode or explicitly committed travel.",
          } satisfies RouterClassification)
        : await dmClient.classifyTurnIntent({
            playerAction,
            turnMode,
            context: await getTurnRouterContext(snapshot),
            signal: abortController.signal,
          });
    logBackendDiagnostic("turn.router.resolved", {
      campaignId: input.campaignId,
      sessionId: input.sessionId,
      requestId: input.requestId,
      turnId: turn.id,
      profile: routerClassification.profile,
      confidence: routerClassification.confidence,
      authorizedCommitments: routerClassification.authorizedCommitments,
      reason: routerClassification.reason,
    });
    const promptContext = await getPromptContext(
      snapshot,
      promptContextProfileForRouter(routerClassification),
    );
    const narrationOverride =
      intent?.type === "travel_route"
        ? {
            playerActionForModel: playerAction,
            overrideText: null,
            requestedAdvanceMinutes: null,
            availableAdvanceMinutes: availableAdvanceMinutes(snapshot),
          }
        : buildNarrationOverride({
            playerAction,
            snapshot,
          });
    const resolution: TurnResolution =
      intent?.type === "travel_route"
        ? await (async () => {
            const route = snapshot.adjacentRoutes.find((entry) => entry.id === intent.routeEdgeId);
            if (!route) {
              throw new Error("Travel intent route is not adjacent to the player's current location.");
            }
            if (route.targetLocationId !== intent.targetLocationId) {
              throw new Error("Travel intent target does not match the selected route.");
            }

            return dmClient.runExplicitTravelTurn({
              promptContext,
              character: snapshot.character,
              playerAction,
              route,
              signal: abortController.signal,
            });
          })()
        : await dmClient.runTurn({
            promptContext,
            routerClassification,
            character: snapshot.character,
            playerAction: narrationOverride.playerActionForModel,
            turnMode,
            executeFetchTool: (call) => executeFetchTool(snapshot, call),
            signal: abortController.signal,
          });
    logBackendDiagnostic("turn.provider.resolved", {
      campaignId: input.campaignId,
      sessionId: input.sessionId,
      requestId: input.requestId,
      turnId: turn.id,
      commandType: resolution.command.type,
      fetchedFactCount: resolution.fetchedFacts.length,
    });

    if (abortController.signal.aborted && !commitStarted) {
      throw new TurnAbandonedError("Turn resolution was aborted before commit.");
    }

    let resolvedCommand = resolution.command;
    let validated: ValidatedTurnCommand;
    try {
      validated = validateTurnCommand({
        snapshot,
        command: resolvedCommand,
        fetchedFacts: resolution.fetchedFacts,
        routerClassification,
        playerAction,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        resolvedCommand.type !== "request_clarification"
        && isRepairableTurnValidationError(message)
      ) {
        logBackendDiagnostic("turn.repair.start", {
          campaignId: input.campaignId,
          sessionId: input.sessionId,
          requestId: input.requestId,
          turnId: turn.id,
          previousCommandType: resolvedCommand.type,
          validationError: message,
        });
        resolvedCommand = await dmClient.repairTurn({
          promptContext,
          routerClassification,
          character: snapshot.character,
          playerAction,
          turnMode,
          fetchedFacts: resolution.fetchedFacts,
          previousCommand: resolvedCommand,
          validationError: message,
          signal: abortController.signal,
        });
        logBackendDiagnostic("turn.repair.resolved", {
          campaignId: input.campaignId,
          sessionId: input.sessionId,
          requestId: input.requestId,
          turnId: turn.id,
          repairedCommandType: resolvedCommand.type,
        });
        validated = validateTurnCommand({
          snapshot,
          command: resolvedCommand,
          fetchedFacts: resolution.fetchedFacts,
          routerClassification,
          playerAction,
        });
      } else {
        throw error;
      }
    }

    if (validated.type === "request_clarification") {
      logBackendDiagnostic("turn.clarification_requested", {
        campaignId: input.campaignId,
        sessionId: input.sessionId,
        requestId: input.requestId,
        turnId: turn.id,
      });
      await prisma.turn.update({
        where: { id: turn.id },
        data: {
          status: "clarification_requested",
          toolCallJson: toPrismaJsonValue(validated),
          resultJson: toPrismaJsonValue(toTurnResultPayloadJson({
            stateVersionAfter: snapshot.stateVersion,
            changeCodes: [],
            reasonCodes: [],
            whatChanged: [],
            why: [],
            warnings: [],
            narrationBounds: null,
            checkResult: null,
            rollback: null,
            clarification: {
              question: validated.question,
              options: validated.options,
            },
            error: null,
          })),
        },
      });
      await cleanupTurnLock({
        campaignId: input.campaignId,
        requestId: input.requestId,
      });

      return {
        type: "clarification" as const,
        turnId: turn.id,
        question: validated.question,
        options: validated.options,
        warnings: [],
      };
    }

    const committedCommand = applyCommittedTimeWindow({
      snapshot,
      command: validated,
      overrideText: narrationOverride.overrideText,
      requestedAdvanceMinutes: narrationOverride.requestedAdvanceMinutes,
    });

    input.stream?.narration?.(committedCommand.narration);
    if (committedCommand.checkResult) {
      input.stream?.checkResult?.(committedCommand.checkResult);
    }

    commitStarted = true;
    activeCommitTurnKeys.add(turnKey);
    logBackendDiagnostic("turn.commit.start", {
      campaignId: input.campaignId,
      sessionId: input.sessionId,
      requestId: input.requestId,
      turnId: turn.id,
      commandType: committedCommand.type,
      expectedStateVersion: input.expectedStateVersion,
    });
    const resultPayload = await commitResolvedTurn({
      snapshot,
      sessionId: input.sessionId,
      turnId: turn.id,
      requestId: input.requestId,
      expectedStateVersion: input.expectedStateVersion,
      playerAction,
      turnMode,
      command: committedCommand,
      fetchedFacts: resolution.fetchedFacts,
    });
    commitStarted = false;
    activeCommitTurnKeys.delete(turnKey);
    logBackendDiagnostic("turn.commit.success", {
      campaignId: input.campaignId,
      sessionId: input.sessionId,
      requestId: input.requestId,
      turnId: turn.id,
      stateVersionAfter: resultPayload.stateVersionAfter,
      changeCount: resultPayload.changeCodes.length,
      reasonCount: resultPayload.reasonCodes.length,
    });
    void wakeScheduleGenerationJobs().catch((error) => {
      console.error("[schedule-jobs] Wake failed after commit.", error);
      logBackendDiagnostic("schedule_jobs.wake_failed_after_commit", {
        campaignId: input.campaignId,
        requestId: input.requestId,
        turnId: turn.id,
        error: error instanceof Error ? error.message : String(error),
      });
    });

    return {
      type: "resolved" as const,
      turnId: turn.id,
      narration: committedCommand.narration,
      suggestedActions: dedupeStrings(committedCommand.suggestedActions),
      warnings: committedCommand.warnings,
      checkResult: committedCommand.checkResult,
      result: resultPayload,
    };
  } catch (error) {
    if (error instanceof StateConflictError) {
      logBackendDiagnostic("turn.commit.state_conflict", {
        campaignId: input.campaignId,
        sessionId: input.sessionId,
        requestId: input.requestId,
        turnId: turn.id,
        message: error.message,
      });
      await prisma.turn.update({
        where: { id: turn.id },
        data: {
          status: "conflicted",
          stateVersionAfter: input.expectedStateVersion,
          resultJson: toPrismaJsonValue(toTurnResultPayloadJson({
            stateVersionAfter: null,
            changeCodes: [],
            reasonCodes: [],
            whatChanged: [],
            why: [],
            warnings: [],
            narrationBounds: null,
            checkResult: null,
            rollback: null,
            clarification: null,
            error: {
              message: error.message,
              code: "state_conflict",
            },
          })),
        },
      });
      await cleanupTurnLock({
        campaignId: input.campaignId,
        requestId: input.requestId,
      });

      return {
        type: "state_conflict" as const,
        payload: await buildStateConflictPayload({
          campaignId: input.campaignId,
          sessionId: input.sessionId,
          expectedStateVersion: input.expectedStateVersion,
        }),
      };
    }

    if (abortController.signal.aborted && !commitStarted) {
      if (abortController.signal.reason === "deadline_exceeded") {
        logBackendDiagnostic("turn.aborted.deadline_exceeded", {
          campaignId: input.campaignId,
          sessionId: input.sessionId,
          requestId: input.requestId,
          turnId: turn.id,
        });
        await abandonTurnRequest({
          campaignId: input.campaignId,
          requestId: input.requestId,
          turnId: turn.id,
          status: "timed_out",
          infrastructureFailureCode: "TURN_DEADLINE_EXCEEDED",
          message: "Turn resolution exceeded the internal deadline before commit.",
        });
      } else {
        logBackendDiagnostic("turn.aborted.cancelled", {
          campaignId: input.campaignId,
          sessionId: input.sessionId,
          requestId: input.requestId,
          turnId: turn.id,
        });
        await abandonCancelledTurnIfOwned({
          campaignId: input.campaignId,
          sessionId: input.sessionId,
          requestId: input.requestId,
          turnId: turn.id,
          message: "The turn request was cancelled before commit.",
        });
      }
      throw error;
    }

    const infrastructureFailureCode: InfrastructureFailureCode =
      error instanceof TurnLockedError
        ? "TURN_LOCK_CONFLICT"
        : error instanceof Error && /validation/i.test(error.message)
          ? "VALIDATION_ERROR"
          : error instanceof Error && /tool call|turn generation|completion/i.test(error.message)
            ? "MODEL_ERROR"
            : "INFRASTRUCTURE_ERROR";

    await markTurnFailure({
      turnId: turn.id,
      status:
        infrastructureFailureCode === "MODEL_ERROR"
          ? "failed_model"
          : infrastructureFailureCode === "VALIDATION_ERROR"
            ? "failed_validation"
            : "failed_infrastructure",
      infrastructureFailureCode,
      message: error instanceof Error ? error.message : "Turn processing failed.",
    });
    logBackendDiagnostic("turn.failed", {
      campaignId: input.campaignId,
      sessionId: input.sessionId,
      requestId: input.requestId,
      turnId: turn.id,
      infrastructureFailureCode,
      error: error instanceof Error ? error.message : String(error),
    });
    await cleanupTurnLock({
      campaignId: input.campaignId,
      requestId: input.requestId,
    });
    throw error;
  } finally {
    clearTimeout(timeout);
    activeCommitTurnKeys.delete(turnKey);
    activeTurnControllers.delete(turnKey);
  }
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

export async function cancelTurnRequest(input: {
  campaignId: string;
  sessionId: string;
  requestId: string;
}) {
  logBackendDiagnostic("turn.cancel.requested", {
    campaignId: input.campaignId,
    sessionId: input.sessionId,
    requestId: input.requestId,
  });
  const turn = await prisma.turn.findUnique({
    where: {
      campaignId_requestId: {
        campaignId: input.campaignId,
        requestId: input.requestId,
      },
    },
  });

  if (!turn) {
    return { ok: true };
  }

  if (turn.sessionId !== input.sessionId) {
    return { ok: true };
  }

  if (
    [
      "resolved",
      "clarification_requested",
      "conflicted",
      "timed_out",
      "failed_model",
      "failed_validation",
      "failed_infrastructure",
      "abandoned",
    ].includes(turn.status)
  ) {
    return { ok: true };
  }

  if (turn.status !== "processing") {
    return { ok: true };
  }

  if (activeCommitTurnKeys.has(activeTurnKey(input.campaignId, input.requestId))) {
    return { ok: true };
  }

  const controller = activeTurnControllers.get(activeTurnKey(input.campaignId, input.requestId));
  if (!controller) {
    return { ok: true };
  }

  controller.abort("cancelled");
  logBackendDiagnostic("turn.cancel.signal_sent", {
    campaignId: input.campaignId,
    sessionId: input.sessionId,
    requestId: input.requestId,
    turnId: turn.id,
  });

  const campaign = await prisma.campaign.findUnique({
    where: { id: input.campaignId },
    select: {
      turnLockRequestId: true,
      turnLockSessionId: true,
    },
  });

  if (
    !campaign
    || campaign.turnLockRequestId !== input.requestId
    || campaign.turnLockSessionId !== input.sessionId
  ) {
    return { ok: true };
  }

  const abandoned = await prisma.turn.updateMany({
    where: {
      id: turn.id,
      campaignId: input.campaignId,
      sessionId: input.sessionId,
      requestId: input.requestId,
      status: "processing",
    },
    data: {
      status: "abandoned",
      infrastructureFailureCode: "TURN_CANCELLED",
      resultJson: toPrismaJsonValue(toTurnResultPayloadJson({
        stateVersionAfter: null,
        changeCodes: [],
        reasonCodes: [],
        whatChanged: [],
        why: [],
        warnings: [],
        narrationBounds: null,
        checkResult: null,
        rollback: null,
        clarification: null,
        error: {
          message: "The turn request was cancelled.",
          code: "TURN_CANCELLED",
        },
      })),
    },
  });

  if (abandoned.count === 1) {
    logBackendDiagnostic("turn.cancel.abandoned", {
      campaignId: input.campaignId,
      sessionId: input.sessionId,
      requestId: input.requestId,
      turnId: turn.id,
    });
    await cleanupTurnLock({
      campaignId: input.campaignId,
      requestId: input.requestId,
    });
  }

  return { ok: true };
}

export async function cancelPendingTurn() {
  throw new Error("Use cancelTurnRequest with campaignId, sessionId, and requestId.");
}

export async function resolvePendingCheck() {
  throw new Error("Separate pending checks are not used in the spatial turn loop.");
}

export async function revisePendingCheck() {
  throw new Error("Pending-turn editing is not supported in the spatial turn loop.");
}

export async function retryLastTurn(turnId: string) {
  if (!env.enableTurnUndo) {
    throw new Error("Turn undo is disabled.");
  }

  const turn = await prisma.turn.findUnique({
    where: { id: turnId },
    include: {
      session: true,
    },
  });

  if (!turn) {
    throw new Error("Turn not found.");
  }

  if (turn.status !== "resolved") {
    throw new Error("Only resolved turns can be undone.");
  }

  const latestResolvedTurn = await prisma.turn.findFirst({
    where: {
      sessionId: turn.sessionId,
      status: "resolved",
    },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });

  if (!latestResolvedTurn || latestResolvedTurn.id !== turn.id) {
    throw new Error("Only the latest resolved turn can be undone.");
  }

  const rollback = parseTurnResultPayloadJson(turn.resultJson)?.rollback ?? null;

  if (!rollback) {
    throw new Error("Turn rollback data is missing.");
  }

  await prisma.$transaction(async (tx) => {
    if (rollback.createdMessageIds.length) {
      await tx.message.deleteMany({
        where: {
          id: {
            in: rollback.createdMessageIds,
          },
        },
      });
    }

    if (rollback.createdMemoryIds.length) {
      await tx.memoryEntry.deleteMany({
        where: {
          id: {
            in: rollback.createdMemoryIds,
          },
        },
      });
    }

    if (rollback.createdMemoryLinkIds.length) {
      await tx.memoryEntityLink.deleteMany({
        where: {
          id: {
            in: rollback.createdMemoryLinkIds,
          },
        },
      });
    }

    if (rollback.createdScheduleJobIds.length) {
      await tx.scheduleGenerationJob.deleteMany({
        where: {
          id: {
            in: rollback.createdScheduleJobIds,
          },
        },
      });
    }

    for (const discovery of rollback.discoveredInformation) {
      await tx.information.update({
        where: { id: discovery.id },
        data: {
          isDiscovered: discovery.previousIsDiscovered,
          discoveredAtTurn: discovery.previousDiscoveredAtTurn,
        },
      });
    }

    for (const inverse of [...rollback.simulationInverses].reverse()) {
      await applySimulationInverse(tx, inverse);
    }

    await tx.session.update({
      where: { id: turn.sessionId },
      data: {
        turnCount: rollback.previousSessionTurnCount,
      },
    });

    await tx.campaign.update({
      where: { id: turn.campaignId },
      data: {
        stateJson: toCampaignRuntimeStateJson(rollback.previousState),
      },
    });

    await tx.turn.update({
      where: { id: turn.id },
      data: {
        status: "undone",
      },
    });
  });
}
