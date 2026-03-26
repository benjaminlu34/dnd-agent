import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { dmClient, logBackendDiagnostic } from "@/lib/ai/provider";
import { renderWhatChanged, renderWhy } from "@/lib/game/causality";
import { parseTurnResultPayloadJson, toCampaignRuntimeStateJson, toTurnResultPayloadJson } from "@/lib/game/json-contracts";
import {
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
  MechanicsMutation,
  NpcDetail,
  NpcSummary,
  PromotedNpcHydrationDraft,
  RequestClarificationToolCall,
  RelationshipHistory,
  ResolveMechanicsResponse,
  RouterDecision,
  RetryRequiredResponse,
  StateConflictResponse,
  StateCommitLog,
  StateCommitLogEntry,
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
import { normalizeItemName } from "@/lib/game/item-utils";
import { sceneActorIdentityClearlyMatches } from "@/lib/game/scene-identity";
import { env } from "@/lib/env";

type TurnStream = {
  narration?: (chunk: string) => void;
  warning?: (message: string) => void;
  checkResult?: (result: CheckResult) => void;
};

const TURN_LOCK_TTL_MS = 120_000;
const TURN_INTERNAL_DEADLINE_MS = 115_000;
const INCIDENTAL_GOLD_MAX = 50;

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

function normalizeWhitespace(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function tempActorRef(actorId: string) {
  return `temp:${actorId}`;
}

function npcActorRef(npcId: string) {
  return `npc:${npcId}`;
}

function isSpawnHandle(value: string) {
  return value.startsWith("spawn:");
}

function sceneAspectKeyFromName(aspectName: string) {
  const normalized = normalizeWhitespace(aspectName)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return normalized || `scene_aspect_${randomUUID()}`;
}

function normalizedDescription(value: string) {
  return normalizeWhitespace(value);
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

function promptContextProfileForRouter(decision: RouterDecision) {
  return decision.confidence === "high" ? decision.profile : "full";
}

function routerDecisionForTurnMode(input: {
  turnMode: TurnMode;
  explicitTravel: boolean;
}): RouterDecision {
  if (input.explicitTravel) {
    return {
      profile: "full",
      confidence: "low",
      authorizedVectors: [],
      requiredPrerequisites: [],
      reason: "Router classification skipped for explicitly committed travel.",
    };
  }

  if (input.turnMode === "observe") {
    return {
      profile: "full",
      confidence: "low",
      authorizedVectors: ["investigate"],
      requiredPrerequisites: [],
      reason: "Router classification skipped for observe mode.",
    };
  }

  throw new Error("Router fallback is only defined for observe mode or explicit travel.");
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

async function buildPromotedNpcHydrationPayload(input: {
  campaignId: string;
  baseResult: NpcDetail;
}) {
  const npc = input.baseResult;

  if (npc.isNarrativelyHydrated) {
    return null;
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

  return {
    npcId: npc.id,
    hydratedResult: {
      ...npc,
      summary: draft.summary,
      description: draft.description,
      factionId: draft.factionId,
      isNarrativelyHydrated: true,
    } satisfies NpcDetail,
    hydrationDraft: draft,
  };
}

async function persistPromotedNpcHydrationDraft(input: {
  tx: Prisma.TransactionClient;
  snapshot: CampaignSnapshot;
  npcId: string;
  hydrationDraft: PromotedNpcHydrationDraft;
  nextTurnCount: number;
  rollback: TurnRollbackData;
}) {
  const npc = await input.tx.nPC.findFirst({
    where: {
      id: input.npcId,
      campaignId: input.snapshot.campaignId,
    },
    select: {
      id: true,
      summary: true,
      description: true,
      factionId: true,
      isNarrativelyHydrated: true,
      hydrationClaimRequestId: true,
      hydrationClaimExpiresAt: true,
    },
  });

  if (!npc || npc.isNarrativelyHydrated) {
    return;
  }

  recordInverse(input.rollback, "nPC", npc.id, "summary", npc.summary);
  recordInverse(input.rollback, "nPC", npc.id, "description", npc.description);
  recordInverse(input.rollback, "nPC", npc.id, "factionId", npc.factionId);
  recordInverse(input.rollback, "nPC", npc.id, "isNarrativelyHydrated", npc.isNarrativelyHydrated);
  recordInverse(
    input.rollback,
    "nPC",
    npc.id,
    "hydrationClaimRequestId",
    npc.hydrationClaimRequestId,
  );
  recordInverse(
    input.rollback,
    "nPC",
    npc.id,
    "hydrationClaimExpiresAt",
    npc.hydrationClaimExpiresAt,
  );

  const updated = await input.tx.nPC.updateMany({
    where: {
      id: npc.id,
      campaignId: input.snapshot.campaignId,
      isNarrativelyHydrated: false,
    },
    data: {
      summary: input.hydrationDraft.summary,
      description: input.hydrationDraft.description,
      factionId: input.hydrationDraft.factionId,
      isNarrativelyHydrated: true,
      hydrationClaimRequestId: null,
      hydrationClaimExpiresAt: null,
    },
  });

  if (updated.count === 0) {
    return;
  }

  for (const information of input.hydrationDraft.information) {
    const informationId = `info_${randomUUID()}`;
    await input.tx.information.create({
      data: {
        id: informationId,
        campaignId: input.snapshot.campaignId,
        title: information.title,
        summary: information.summary,
        content: information.content,
        truthfulness: information.truthfulness,
        accessibility: information.accessibility,
        locationId: information.locationId,
        factionId: information.factionId,
        sourceNpcId: npc.id,
        isDiscovered: true,
        discoveredAtTurn: input.nextTurnCount,
        expiresAtTime: null,
      },
    });
    recordCreated(input.rollback, "information", informationId);
  }
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

type AppliedMutationRecord = {
  mutation: MechanicsMutation;
  entry: StateCommitLogEntry;
};

type ProjectedTemporaryActor = {
  id: string;
  label: string;
  currentLocationId: string | null;
  interactionCount: number;
  firstSeenAtTurn: number;
  lastSeenAtTurn: number;
  lastSeenAtTime: number;
  recentTopics: string[];
  lastSummary: string | null;
  holdsInventory: boolean;
  affectedWorldState: boolean;
  isInMemoryGraph: boolean;
  promotedNpcId: string | null;
};

function mutationPhaseForOrdering(mutation: MechanicsMutation): "immediate" | "conditional" {
  return mutationPhaseForEvaluation(mutation);
}

function orderedMutationsForProcessing(mutations: MechanicsMutation[]) {
  return ["immediate", "conditional"].flatMap((phase) =>
    mutations.filter((mutation) => mutationPhaseForOrdering(mutation) === phase),
  );
}

function resolveSpawnedTemporaryActorId(input: {
  actorRef: string;
  spawnedTemporaryActorIds: Map<string, string>;
}) {
  if (isSpawnHandle(input.actorRef)) {
    return input.spawnedTemporaryActorIds.get(input.actorRef.slice("spawn:".length)) ?? null;
  }

  if (input.actorRef.startsWith("temp:")) {
    return input.actorRef.slice("temp:".length);
  }

  return input.actorRef.trim() || null;
}

function resolveSceneActorTargetForEvaluation(input: {
  actorRef: string;
  spawnedTemporaryActorIds: Map<string, string>;
  projectedTemporaryActors: Map<string, ProjectedTemporaryActor>;
  projectedNpcLocationIds: Map<string, string | null>;
}) {
  if (isSpawnHandle(input.actorRef)) {
    const temporaryActorId = input.spawnedTemporaryActorIds.get(input.actorRef.slice("spawn:".length)) ?? null;
    return temporaryActorId ? { kind: "temporary_actor" as const, actorId: temporaryActorId } : null;
  }

  if (input.actorRef.startsWith("temp:")) {
    const actorId = input.actorRef.slice("temp:".length);
    return input.projectedTemporaryActors.has(actorId)
      ? { kind: "temporary_actor" as const, actorId }
      : null;
  }

  if (input.actorRef.startsWith("npc:")) {
    const actorId = input.actorRef.slice("npc:".length);
    return input.projectedNpcLocationIds.has(actorId)
      ? { kind: "npc" as const, actorId }
      : null;
  }

  if (input.projectedTemporaryActors.has(input.actorRef)) {
    return { kind: "temporary_actor" as const, actorId: input.actorRef };
  }

  if (input.projectedNpcLocationIds.has(input.actorRef)) {
    return { kind: "npc" as const, actorId: input.actorRef };
  }

  return null;
}

function resolveItemTemplateIdForEvaluation(input: {
  itemId: string;
  spawnedItemTemplateIds: Map<string, string>;
}) {
  if (!isSpawnHandle(input.itemId)) {
    return input.itemId;
  }

  return input.spawnedItemTemplateIds.get(input.itemId.slice("spawn:".length)) ?? null;
}

function knownInformationIds(snapshot: CampaignSnapshot, fetchedFacts: TurnFetchToolResult[]) {
  const ids = new Set<string>(
    snapshot.localInformation
      .map((information) => information.id)
      .concat(snapshot.discoveredInformation.map((information) => information.id))
      .concat(snapshot.connectedLeads.map((lead) => lead.information.id)),
  );

  for (const fact of fetchedFacts) {
    if (fact.type === "fetch_npc_detail") {
      for (const information of fact.result.knownInformation) {
        ids.add(information.id);
      }
    }
    if (fact.type === "fetch_information_detail") {
      ids.add(fact.result.id);
    }
    if (fact.type === "fetch_information_connections") {
      for (const lead of fact.result) {
        ids.add(lead.information.id);
      }
    }
  }

  return ids;
}

function knownNpc(snapshot: CampaignSnapshot, fetchedFacts: TurnFetchToolResult[], npcId: string) {
  const presentNpc = snapshot.presentNpcs.find((npc) => npc.id === npcId);
  if (presentNpc) {
    return presentNpc as NpcSummary;
  }

  for (const fact of fetchedFacts) {
    if (fact.type === "fetch_npc_detail" && fact.result.id === npcId) {
      return fact.result as NpcDetail;
    }
  }

  return null;
}

function findRelationshipHistoryNpc(fetchedFacts: TurnFetchToolResult[], npcId: string) {
  for (const fact of fetchedFacts) {
    if (fact.type === "fetch_relationship_history" && fact.result.npcId === npcId) {
      return fact.result as RelationshipHistory;
    }
  }

  return null;
}

function hasVector(decision: RouterDecision, vector: RouterDecision["authorizedVectors"][number]) {
  return decision.authorizedVectors.length === 0 || decision.authorizedVectors.includes(vector);
}

function hasAnyAuthorizedVector(decision: RouterDecision) {
  return decision.authorizedVectors.length > 0;
}

function isTraversableRoute(route: CampaignSnapshot["adjacentRoutes"][number]) {
  return route.currentStatus === "open";
}

function isRemovedInventoryProperties(value: Prisma.JsonValue | null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  return value.removedFromInventory === true;
}

function withRemovedInventoryMarker(value: Prisma.JsonValue | null): Prisma.InputJsonValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { removedFromInventory: true };
  }

  return {
    ...value,
    removedFromInventory: true,
  } satisfies Prisma.JsonObject;
}

function mutationPhaseForEvaluation(mutation: MechanicsMutation): "immediate" | "conditional" {
  if (mutation.phase) {
    return mutation.phase;
  }
  if (mutation.type === "advance_time") {
    return "immediate";
  }
  if (mutation.type === "adjust_gold" && mutation.delta < 0) {
    return "immediate";
  }
  if (mutation.type === "record_local_interaction") {
    return "immediate";
  }
  if (
    mutation.type === "spawn_scene_aspect"
    || mutation.type === "spawn_temporary_actor"
    || mutation.type === "spawn_environmental_item"
    || mutation.type === "set_scene_actor_presence"
  ) {
    return "immediate";
  }
  if (mutation.type === "adjust_inventory" && mutation.action === "remove") {
    return "immediate";
  }
  return "conditional";
}

function clampRelationshipDelta(delta: number) {
  return Math.max(-2, Math.min(2, delta));
}

function clampIncidentalGoldDelta(delta: number) {
  return delta > 0 ? Math.min(delta, INCIDENTAL_GOLD_MAX) : delta;
}

function evaluateResolvedCommand(input: {
  snapshot: CampaignSnapshot;
  command: Exclude<ValidatedTurnCommand, RequestClarificationToolCall>;
  fetchedFacts: TurnFetchToolResult[];
  routerDecision: RouterDecision;
  groundedItemIds?: string[];
}) {
  const stateCommitLog: StateCommitLog = [];
  const appliedMutations: AppliedMutationRecord[] = [];
  const projectedCommodityQuantities = new Map(
    input.snapshot.character.commodityStacks.map((stack) => [stack.commodityId, stack.quantity]),
  );
  const projectedMarketStock = new Map<string, number>();
  const projectedRelationshipDelta = new Map<string, number>();
  const projectedInventoryQuantities = new Map<string, number>();
  for (const item of input.snapshot.character.inventory) {
    if (isRemovedInventoryProperties(item.properties as Prisma.JsonValue | null)) {
      continue;
    }
    projectedInventoryQuantities.set(
      item.templateId,
      (projectedInventoryQuantities.get(item.templateId) ?? 0) + 1,
    );
  }
  const projectedTemporaryActors = new Map<string, ProjectedTemporaryActor>(
    input.snapshot.temporaryActors.map((actor) => [
      actor.id,
      {
        ...actor,
        recentTopics: [...actor.recentTopics],
      },
    ]),
  );
  const projectedNpcLocationIds = new Map(
    input.snapshot.presentNpcs.map((npc) => [npc.id, npc.currentLocationId]),
  );
  const spawnedTemporaryActorIds = new Map<string, string>();
  const spawnedItemTemplateIds = new Map<string, string>();
  const discoveredInformationIds = new Set<string>();
  let projectedGold = input.snapshot.character.gold;
  let projectedLocationId = input.snapshot.state.currentLocationId;
  let projectedHealth = input.snapshot.character.health;
  const projectedSceneAspects = structuredClone(input.snapshot.state.sceneAspects ?? {});
  const groundedItemIds = new Set(
    input.groundedItemIds
    ?? input.snapshot.character.inventory.map((item) => item.templateId),
  );
  let hasAppliedMove = false;
  const knownInformation = knownInformationIds(input.snapshot, input.fetchedFacts);
  const checkOutcome = input.command.checkResult?.outcome;

  if (input.command.checkResult) {
    stateCommitLog.push({
      kind: "check",
      mutationType: null,
      status: "applied",
      reasonCode: `check_${input.command.checkResult.outcome}`,
      summary: `${input.command.checkResult.stat.toUpperCase()} ${input.command.checkResult.outcome} (${input.command.checkResult.total})`,
      metadata: input.command.checkResult as unknown as Record<string, unknown>,
    });
  }

  for (const mutation of orderedMutationsForProcessing(input.command.mutations)) {
    const phase = mutationPhaseForEvaluation(mutation);

    if (
      mutation.type !== "advance_time"
      && input.command.checkResult
      && phase === "conditional"
      && checkOutcome !== "success"
    ) {
      stateCommitLog.push({
        kind: "mutation",
        mutationType: mutation.type,
        status: "rejected",
        reasonCode: checkOutcome === "partial" ? "check_partial_blocked" : "check_failed",
        summary: `The attempted ${mutation.type.replace(/_/g, " ")} does not take effect.`,
        metadata: { ...mutation, phase } as unknown as Record<string, unknown>,
      });
      continue;
    }

    if (mutation.type === "advance_time") {
      const appliedMutation = { ...mutation, phase } as MechanicsMutation;
      const entry = {
        kind: "mutation" as const,
        mutationType: mutation.type,
        status: "applied" as const,
        reasonCode: "time_advanced",
        summary:
          typeof mutation.durationMinutes === "number"
            ? `Time passes for ${mutation.durationMinutes} minutes.`
            : "Time passes.",
        metadata: { ...appliedMutation } as unknown as Record<string, unknown>,
      };
      stateCommitLog.push(entry);
      appliedMutations.push({ mutation: appliedMutation, entry });
      continue;
    }

    if (mutation.type === "move_player") {
      const route = input.snapshot.adjacentRoutes.find((entry) => entry.id === mutation.routeEdgeId);
      if (!route || route.targetLocationId !== mutation.targetLocationId) {
        stateCommitLog.push({
          kind: "mutation",
          mutationType: mutation.type,
          status: "rejected",
          reasonCode: "invalid_target",
          summary: "The requested travel route could not be applied.",
          metadata: { ...mutation, phase } as unknown as Record<string, unknown>,
        });
        continue;
      }
      if (!isTraversableRoute(route)) {
        stateCommitLog.push({
          kind: "mutation",
          mutationType: mutation.type,
          status: "rejected",
          reasonCode: "route_blocked",
          summary: `The route to ${route.targetLocationName} is currently blocked.`,
          metadata: {
            ...mutation,
            phase,
            currentStatus: route.currentStatus,
          } as unknown as Record<string, unknown>,
        });
        continue;
      }
      if (hasAppliedMove) {
        stateCommitLog.push({
          kind: "mutation",
          mutationType: mutation.type,
          status: "rejected",
          reasonCode: "conflicting_mutation",
          summary: "Only one location change can apply in a single turn.",
          metadata: { ...mutation, phase } as unknown as Record<string, unknown>,
        });
        continue;
      }
      projectedLocationId = mutation.targetLocationId;
      hasAppliedMove = true;
      for (const [aspectKey, aspect] of Object.entries(projectedSceneAspects)) {
        if (aspect.duration === "scene") {
          delete projectedSceneAspects[aspectKey];
        }
      }
      const appliedMutation = { ...mutation, phase } as MechanicsMutation;
      const entry = {
        kind: "mutation" as const,
        mutationType: mutation.type,
        status: "applied" as const,
        reasonCode: "moved_player",
        summary: `You travel to ${route.targetLocationName}.`,
        metadata: { ...appliedMutation } as unknown as Record<string, unknown>,
      };
      stateCommitLog.push(entry);
      appliedMutations.push({ mutation: appliedMutation, entry });
      continue;
    }

    if (mutation.type === "adjust_gold") {
      const appliedDelta = clampIncidentalGoldDelta(mutation.delta);
      const appliedMutation = { ...mutation, delta: appliedDelta, phase } as MechanicsMutation;
      const authorized =
        mutation.delta < 0
          ? hasVector(input.routerDecision, "economy_light") || hasVector(input.routerDecision, "economy_strict")
          : hasVector(input.routerDecision, "economy_light")
            || hasVector(input.routerDecision, "economy_strict")
            || hasVector(input.routerDecision, "converse")
            || hasVector(input.routerDecision, "violence")
            || hasVector(input.routerDecision, "investigate");
      if (!authorized) {
        stateCommitLog.push({
          kind: "mutation",
          mutationType: mutation.type,
          status: "rejected",
          reasonCode: "unauthorized_vector",
          summary: "The requested gold change is not authorized for this turn.",
          metadata: {
            ...mutation,
            delta: appliedDelta,
            requestedDelta: mutation.delta,
            appliedDelta,
            phase,
          } as unknown as Record<string, unknown>,
        });
        continue;
      }
      if (projectedGold + appliedDelta < 0) {
        stateCommitLog.push({
          kind: "mutation",
          mutationType: mutation.type,
          status: "rejected",
          reasonCode: "insufficient_gold",
          summary: "You do not have enough gold for that cost.",
          metadata: {
            ...mutation,
            delta: appliedDelta,
            requestedDelta: mutation.delta,
            appliedDelta,
            phase,
          } as unknown as Record<string, unknown>,
        });
        continue;
      }
      projectedGold += appliedDelta;
      const entry = {
        kind: "mutation" as const,
        mutationType: mutation.type,
        status: "applied" as const,
        reasonCode: "gold_adjusted",
        summary:
          appliedDelta >= 0
            ? `You gain ${appliedDelta} gold.`
            : `You spend ${Math.abs(appliedDelta)} gold.`,
        metadata: {
          ...mutation,
          delta: appliedDelta,
          requestedDelta: mutation.delta,
          appliedDelta,
          phase,
        },
      };
      stateCommitLog.push(entry);
      appliedMutations.push({ mutation: appliedMutation, entry });
      continue;
    }

    if (mutation.type === "spawn_scene_aspect") {
      if (!hasAnyAuthorizedVector(input.routerDecision)) {
        stateCommitLog.push({
          kind: "mutation",
          mutationType: mutation.type,
          status: "rejected",
          reasonCode: "unauthorized_vector",
          summary: "Scene-aspect changes are not authorized for this turn.",
          metadata: { ...mutation, phase } as unknown as Record<string, unknown>,
        });
        continue;
      }

      const aspectKey = sceneAspectKeyFromName(mutation.aspectName);
      const label = normalizeWhitespace(mutation.aspectName);
      const state = normalizeWhitespace(mutation.state);
      const existing = projectedSceneAspects[aspectKey] ?? null;

      if (
        existing
        && existing.label === label
        && existing.state === state
        && existing.duration === mutation.duration
      ) {
        stateCommitLog.push({
          kind: "mutation",
          mutationType: mutation.type,
          status: "noop",
          reasonCode: "already_applied",
          summary: `${label} is already ${state}.`,
          metadata: {
            ...mutation,
            aspectKey,
            phase,
          } as unknown as Record<string, unknown>,
        });
        continue;
      }

      projectedSceneAspects[aspectKey] = {
        label,
        state,
        duration: mutation.duration,
      };

      const entry = {
        kind: "mutation" as const,
        mutationType: mutation.type,
        status: "applied" as const,
        reasonCode: "scene_aspect_spawned",
        summary: `${label} shifts to ${state}.`,
        metadata: {
          ...mutation,
          aspectKey,
          phase,
        } as unknown as Record<string, unknown>,
      };
      stateCommitLog.push(entry);
      appliedMutations.push({ mutation: { ...mutation, phase } as MechanicsMutation, entry });
      continue;
    }

    if (mutation.type === "spawn_temporary_actor") {
      if (!hasVector(input.routerDecision, "converse") && !hasVector(input.routerDecision, "investigate")) {
        stateCommitLog.push({
          kind: "mutation",
          mutationType: mutation.type,
          status: "rejected",
          reasonCode: "unauthorized_vector",
          summary: "Temporary-local spawning is not authorized for this turn.",
          metadata: { ...mutation, phase } as unknown as Record<string, unknown>,
        });
        continue;
      }
      if (spawnedTemporaryActorIds.has(mutation.spawnKey)) {
        stateCommitLog.push({
          kind: "mutation",
          mutationType: mutation.type,
          status: "rejected",
          reasonCode: "duplicate_spawn_key",
          summary: "That temporary-actor spawn key was already used this turn.",
          metadata: { ...mutation, phase } as unknown as Record<string, unknown>,
        });
        continue;
      }

      const matchingActor = Array.from(projectedTemporaryActors.values()).find((actor) =>
        actor.promotedNpcId == null
        && actor.currentLocationId === projectedLocationId
        && sceneActorIdentityClearlyMatches({
          candidateRole: mutation.role,
          existingRole: actor.label,
          candidateSummary: `${normalizeWhitespace(mutation.summary)} ${normalizeWhitespace(mutation.apparentDisposition)}`,
          existingSummary: actor.lastSummary,
        })
      );

      const resolvedActorId = matchingActor?.id ?? `spawned_temp:${mutation.spawnKey}`;
      if (!matchingActor) {
        projectedTemporaryActors.set(resolvedActorId, {
          id: resolvedActorId,
          label: normalizeWhitespace(mutation.role),
          currentLocationId: projectedLocationId,
          interactionCount: 0,
          firstSeenAtTurn: input.snapshot.sessionTurnCount + 1,
          lastSeenAtTurn: input.snapshot.sessionTurnCount + 1,
          lastSeenAtTime: input.snapshot.state.globalTime + input.command.timeElapsed,
          recentTopics: [],
          lastSummary: `${normalizeWhitespace(mutation.summary)} Apparent disposition: ${normalizeWhitespace(mutation.apparentDisposition)}.`,
          holdsInventory: false,
          affectedWorldState: false,
          isInMemoryGraph: false,
          promotedNpcId: null,
        });
      }

      spawnedTemporaryActorIds.set(mutation.spawnKey, resolvedActorId);
      const entry = {
        kind: "mutation" as const,
        mutationType: mutation.type,
        status: "applied" as const,
        reasonCode: matchingActor ? "temporary_actor_reused" : "temporary_actor_spawned",
        summary: matchingActor
          ? `${matchingActor.label} is already part of the scene.`
          : `${normalizeWhitespace(mutation.role)} enters the scene.`,
        metadata: {
          ...mutation,
          actorRef: tempActorRef(resolvedActorId),
          reusedExisting: Boolean(matchingActor),
          phase,
        } as unknown as Record<string, unknown>,
      };
      stateCommitLog.push(entry);
      appliedMutations.push({ mutation: { ...mutation, phase } as MechanicsMutation, entry });
      continue;
    }

    if (mutation.type === "record_local_interaction") {
      if (!hasVector(input.routerDecision, "converse")) {
        stateCommitLog.push({
          kind: "mutation",
          mutationType: mutation.type,
          status: "rejected",
          reasonCode: "unauthorized_vector",
          summary: "Unnamed-local interaction is not authorized for this turn.",
          metadata: { ...mutation, phase } as unknown as Record<string, unknown>,
        });
        continue;
      }
      const actorId = resolveSpawnedTemporaryActorId({
        actorRef: mutation.localEntityId,
        spawnedTemporaryActorIds,
      });
      const actor = actorId ? projectedTemporaryActors.get(actorId) : null;
      if (!actor || actor.currentLocationId !== projectedLocationId || actor.promotedNpcId != null) {
        stateCommitLog.push({
          kind: "mutation",
          mutationType: mutation.type,
          status: "rejected",
          reasonCode: "invalid_target",
          summary: "That unnamed local is not available here.",
          metadata: { ...mutation, phase } as unknown as Record<string, unknown>,
        });
        continue;
      }
      const topic = mutation.topic?.trim() || undefined;
      actor.interactionCount += 1;
      actor.lastSummary = mutation.interactionSummary.trim();
      if (topic) {
        actor.recentTopics = dedupeStrings([...actor.recentTopics, topic]).slice(-4);
      }
      actor.lastSeenAtTurn = input.snapshot.sessionTurnCount + 1;
      actor.lastSeenAtTime = input.snapshot.state.globalTime + input.command.timeElapsed;
      const entry = {
        kind: "mutation" as const,
        mutationType: mutation.type,
        status: "applied" as const,
        reasonCode: "local_interaction_recorded",
        summary: actor.lastSummary || `You engage ${actor.label}.`,
        metadata: {
          ...mutation,
          localEntityId: tempActorRef(actor.id),
          phase,
          interactionCount: actor.interactionCount,
        } as unknown as Record<string, unknown>,
      };
      stateCommitLog.push(entry);
      appliedMutations.push({ mutation: { ...mutation, phase } as MechanicsMutation, entry });
      continue;
    }

    if (mutation.type === "set_scene_actor_presence") {
      if (
        !hasVector(input.routerDecision, "converse")
        && !hasVector(input.routerDecision, "investigate")
        && !hasVector(input.routerDecision, "violence")
      ) {
        stateCommitLog.push({
          kind: "mutation",
          mutationType: mutation.type,
          status: "rejected",
          reasonCode: "unauthorized_vector",
          summary: "Scene-presence changes are not authorized for this turn.",
          metadata: { ...mutation, phase } as unknown as Record<string, unknown>,
        });
        continue;
      }

      const target = resolveSceneActorTargetForEvaluation({
        actorRef: mutation.actorRef,
        spawnedTemporaryActorIds,
        projectedTemporaryActors,
        projectedNpcLocationIds,
      });
      if (!target) {
        stateCommitLog.push({
          kind: "mutation",
          mutationType: mutation.type,
          status: "rejected",
          reasonCode: "invalid_target",
          summary: "That scene actor is not available for a presence update.",
          metadata: { ...mutation, phase } as unknown as Record<string, unknown>,
        });
        continue;
      }

      if (target.kind === "temporary_actor") {
        const actor = projectedTemporaryActors.get(target.actorId);
        if (!actor || actor.promotedNpcId != null) {
          stateCommitLog.push({
            kind: "mutation",
            mutationType: mutation.type,
            status: "rejected",
            reasonCode: "invalid_target",
            summary: "That temporary actor is not available for a presence update.",
            metadata: { ...mutation, phase } as unknown as Record<string, unknown>,
          });
          continue;
        }
        if (actor.currentLocationId === mutation.newLocationId) {
          stateCommitLog.push({
            kind: "mutation",
            mutationType: mutation.type,
            status: "noop",
            reasonCode: "already_applied",
            summary:
              mutation.newLocationId == null
                ? `${actor.label} is already away from the scene.`
                : `${actor.label} is already there.`,
            metadata: {
              ...mutation,
              actorRef: tempActorRef(actor.id),
              phase,
            } as unknown as Record<string, unknown>,
          });
          continue;
        }

        actor.currentLocationId = mutation.newLocationId;
        const entry = {
          kind: "mutation" as const,
          mutationType: mutation.type,
          status: "applied" as const,
          reasonCode: "scene_actor_presence_updated",
          summary:
            mutation.newLocationId == null
              ? `${actor.label} leaves the scene.`
              : `${actor.label} arrives in the scene.`,
          metadata: {
            ...mutation,
            actorRef: tempActorRef(actor.id),
            phase,
          } as unknown as Record<string, unknown>,
        };
        stateCommitLog.push(entry);
        appliedMutations.push({ mutation: { ...mutation, phase } as MechanicsMutation, entry });
        continue;
      }

      const currentNpcLocation = projectedNpcLocationIds.get(target.actorId) ?? null;
      const npcLabel =
        input.snapshot.presentNpcs.find((npc) => npc.id === target.actorId)?.name
        ?? target.actorId;
      if (currentNpcLocation === mutation.newLocationId) {
        stateCommitLog.push({
          kind: "mutation",
          mutationType: mutation.type,
          status: "noop",
          reasonCode: "already_applied",
          summary:
            mutation.newLocationId == null
              ? `${npcLabel} is already away from the scene.`
              : `${npcLabel} is already there.`,
          metadata: {
            ...mutation,
            actorRef: npcActorRef(target.actorId),
            phase,
          } as unknown as Record<string, unknown>,
        });
        continue;
      }

      projectedNpcLocationIds.set(target.actorId, mutation.newLocationId);
      const entry = {
        kind: "mutation" as const,
        mutationType: mutation.type,
        status: "applied" as const,
        reasonCode: "scene_actor_presence_updated",
        summary:
          mutation.newLocationId == null
            ? `${npcLabel} leaves the scene.`
            : `${npcLabel} arrives in the scene.`,
        metadata: {
          ...mutation,
          actorRef: npcActorRef(target.actorId),
          phase,
        } as unknown as Record<string, unknown>,
      };
      stateCommitLog.push(entry);
      appliedMutations.push({ mutation: { ...mutation, phase } as MechanicsMutation, entry });
      continue;
    }

    if (mutation.type === "commit_market_trade") {
      if (!hasVector(input.routerDecision, "economy_strict")) {
        stateCommitLog.push({
          kind: "mutation",
          mutationType: mutation.type,
          status: "rejected",
          reasonCode: "unauthorized_vector",
          summary: "Commodity trade is not authorized for this turn.",
          metadata: { ...mutation, phase } as unknown as Record<string, unknown>,
        });
        continue;
      }
      const price = findFetchedMarketPrice(
        input.fetchedFacts,
        mutation.marketPriceId,
        mutation.commodityId,
      );
      if (!price) {
        stateCommitLog.push({
          kind: "mutation",
          mutationType: mutation.type,
          status: "rejected",
          reasonCode: "missing_prerequisite",
          summary: "Authoritative market prices were not fetched for that trade.",
          metadata: { ...mutation, phase } as unknown as Record<string, unknown>,
        });
        continue;
      }

      const stockKey = price.marketPriceId;
      const projectedStock = projectedMarketStock.get(stockKey) ?? price.stock;
      const total = price.price * mutation.quantity;
      const ownedQuantity = projectedCommodityQuantities.get(mutation.commodityId) ?? 0;

      if (mutation.action === "buy") {
        if (projectedStock !== -1 && projectedStock < mutation.quantity) {
          stateCommitLog.push({
            kind: "mutation",
            mutationType: mutation.type,
            status: "rejected",
            reasonCode: "insufficient_stock",
            summary: "The market does not have enough stock for that trade.",
            metadata: { ...mutation, phase } as unknown as Record<string, unknown>,
          });
          continue;
        }
        if (projectedGold < total) {
          stateCommitLog.push({
            kind: "mutation",
            mutationType: mutation.type,
            status: "rejected",
            reasonCode: "insufficient_gold",
            summary: "You do not have enough gold to complete that trade.",
            metadata: { ...mutation, phase } as unknown as Record<string, unknown>,
          });
          continue;
        }
        projectedGold -= total;
        projectedCommodityQuantities.set(mutation.commodityId, ownedQuantity + mutation.quantity);
        if (projectedStock !== -1) {
          projectedMarketStock.set(stockKey, projectedStock - mutation.quantity);
        }
      } else {
        if (ownedQuantity < mutation.quantity) {
          stateCommitLog.push({
            kind: "mutation",
            mutationType: mutation.type,
            status: "rejected",
            reasonCode: "insufficient_inventory",
            summary: "You cannot sell more of that commodity than you own.",
            metadata: { ...mutation, phase } as unknown as Record<string, unknown>,
          });
          continue;
        }
        projectedGold += total;
        projectedCommodityQuantities.set(mutation.commodityId, ownedQuantity - mutation.quantity);
        if (projectedStock !== -1) {
          projectedMarketStock.set(stockKey, projectedStock + mutation.quantity);
        }
      }

      const entry = {
        kind: "mutation" as const,
        mutationType: mutation.type,
        status: "applied" as const,
        reasonCode: "market_trade_committed",
        summary: `${mutation.action === "buy" ? "Buy" : "Sell"} ${mutation.quantity} commodity units for ${total} gold.`,
        metadata: {
          ...mutation,
          phase,
          total,
        },
      };
      stateCommitLog.push(entry);
      appliedMutations.push({ mutation: { ...mutation, phase } as MechanicsMutation, entry });
      continue;
    }

    if (mutation.type === "spawn_environmental_item") {
      if (!hasAnyAuthorizedVector(input.routerDecision)) {
        stateCommitLog.push({
          kind: "mutation",
          mutationType: mutation.type,
          status: "rejected",
          reasonCode: "unauthorized_vector",
          summary: "Environmental item spawning is not authorized for this turn.",
          metadata: { ...mutation, phase } as unknown as Record<string, unknown>,
        });
        continue;
      }
      if (spawnedItemTemplateIds.has(mutation.spawnKey)) {
        stateCommitLog.push({
          kind: "mutation",
          mutationType: mutation.type,
          status: "rejected",
          reasonCode: "duplicate_spawn_key",
          summary: "That item spawn key was already used this turn.",
          metadata: { ...mutation, phase } as unknown as Record<string, unknown>,
        });
        continue;
      }

      const resolvedTemplateId = `spawned_item_template:${mutation.spawnKey}`;
      spawnedItemTemplateIds.set(mutation.spawnKey, resolvedTemplateId);
      groundedItemIds.add(resolvedTemplateId);
      projectedInventoryQuantities.set(
        resolvedTemplateId,
        (projectedInventoryQuantities.get(resolvedTemplateId) ?? 0) + mutation.quantity,
      );
      const entry = {
        kind: "mutation" as const,
        mutationType: mutation.type,
        status: "applied" as const,
        reasonCode: "environmental_item_spawned",
        summary: `You secure ${mutation.quantity} ${normalizeWhitespace(mutation.itemName)}.`,
        metadata: {
          ...mutation,
          itemId: resolvedTemplateId,
          phase,
        } as unknown as Record<string, unknown>,
      };
      stateCommitLog.push(entry);
      appliedMutations.push({ mutation: { ...mutation, phase } as MechanicsMutation, entry });
      continue;
    }

    if (mutation.type === "adjust_inventory") {
      if (!hasAnyAuthorizedVector(input.routerDecision)) {
        stateCommitLog.push({
          kind: "mutation",
          mutationType: mutation.type,
          status: "rejected",
          reasonCode: "unauthorized_vector",
          summary: "Inventory changes are not authorized for this turn.",
          metadata: { ...mutation, phase } as unknown as Record<string, unknown>,
        });
        continue;
      }
      if (!Number.isInteger(mutation.quantity) || mutation.quantity <= 0) {
        stateCommitLog.push({
          kind: "mutation",
          mutationType: mutation.type,
          status: "rejected",
          reasonCode: "invalid_target",
          summary: "Inventory changes require a positive whole quantity.",
          metadata: { ...mutation, phase } as unknown as Record<string, unknown>,
        });
        continue;
      }

      const resolvedItemId = resolveItemTemplateIdForEvaluation({
        itemId: mutation.itemId,
        spawnedItemTemplateIds,
      });
      if (!resolvedItemId) {
        stateCommitLog.push({
          kind: "mutation",
          mutationType: mutation.type,
          status: "rejected",
          reasonCode: "invalid_target",
          summary: "That item is not grounded in the current turn context.",
          metadata: { ...mutation, phase } as unknown as Record<string, unknown>,
        });
        continue;
      }

      const ownedQuantity = projectedInventoryQuantities.get(resolvedItemId) ?? 0;
      if (mutation.action === "remove") {
        if (ownedQuantity < mutation.quantity) {
          stateCommitLog.push({
            kind: "mutation",
            mutationType: mutation.type,
            status: "rejected",
            reasonCode: "insufficient_inventory",
            summary: "You do not have enough of that item.",
            metadata: { ...mutation, phase } as unknown as Record<string, unknown>,
          });
          continue;
        }
        projectedInventoryQuantities.set(resolvedItemId, ownedQuantity - mutation.quantity);
      } else {
        if (!groundedItemIds.has(resolvedItemId)) {
          stateCommitLog.push({
            kind: "mutation",
            mutationType: mutation.type,
            status: "rejected",
            reasonCode: "invalid_target",
            summary: "That item is not grounded in the current turn context.",
            metadata: { ...mutation, phase } as unknown as Record<string, unknown>,
          });
          continue;
        }
        projectedInventoryQuantities.set(resolvedItemId, ownedQuantity + mutation.quantity);
      }

      const entry = {
        kind: "mutation" as const,
        mutationType: mutation.type,
        status: "applied" as const,
        reasonCode: "inventory_adjusted",
        summary:
          mutation.action === "add"
            ? `You gain ${mutation.quantity} item${mutation.quantity === 1 ? "" : "s"}.`
            : `You lose ${mutation.quantity} item${mutation.quantity === 1 ? "" : "s"}.`,
        metadata: {
          ...mutation,
          itemId: resolvedItemId,
          requestedItemId: mutation.itemId,
          phase,
        } as unknown as Record<string, unknown>,
      };
      stateCommitLog.push(entry);
      appliedMutations.push({ mutation: { ...mutation, phase } as MechanicsMutation, entry });
      continue;
    }

    if (mutation.type === "adjust_relationship") {
      const appliedDelta = clampRelationshipDelta(mutation.delta);
      const appliedMutation = { ...mutation, delta: appliedDelta, phase } as MechanicsMutation;
      if (!hasVector(input.routerDecision, "converse")) {
        stateCommitLog.push({
          kind: "mutation",
          mutationType: mutation.type,
          status: "rejected",
          reasonCode: "unauthorized_vector",
          summary: "Relationship shifts are not authorized for this turn.",
          metadata: {
            ...mutation,
            delta: appliedDelta,
            requestedDelta: mutation.delta,
            appliedDelta,
            phase,
          } as unknown as Record<string, unknown>,
        });
        continue;
      }
      const npc =
        knownNpc(input.snapshot, input.fetchedFacts, mutation.npcId)
        ?? findRelationshipHistoryNpc(input.fetchedFacts, mutation.npcId);
      const projectedNpcLocation = projectedNpcLocationIds.get(mutation.npcId);
      if (!npc) {
        stateCommitLog.push({
          kind: "mutation",
          mutationType: mutation.type,
          status: "rejected",
          reasonCode: "invalid_target",
          summary: "That relationship target is not available here.",
          metadata: {
            ...mutation,
            delta: appliedDelta,
            requestedDelta: mutation.delta,
            appliedDelta,
            phase,
          } as unknown as Record<string, unknown>,
        });
        continue;
      }
      if (projectedNpcLocationIds.has(mutation.npcId) && projectedNpcLocation !== projectedLocationId) {
        stateCommitLog.push({
          kind: "mutation",
          mutationType: mutation.type,
          status: "rejected",
          reasonCode: "invalid_target",
          summary: "That relationship target is no longer available here.",
          metadata: {
            ...mutation,
            delta: appliedDelta,
            requestedDelta: mutation.delta,
            appliedDelta,
            phase,
          } as unknown as Record<string, unknown>,
        });
        continue;
      }
      projectedRelationshipDelta.set(
        mutation.npcId,
        (projectedRelationshipDelta.get(mutation.npcId) ?? 0) + appliedDelta,
      );
      const entry = {
        kind: "mutation" as const,
        mutationType: mutation.type,
        status: "applied" as const,
        reasonCode: "relationship_adjusted",
        summary: `Your standing with ${"name" in npc ? npc.name : npc.npcName} shifts.`,
        metadata: {
          ...mutation,
          delta: appliedDelta,
          requestedDelta: mutation.delta,
          appliedDelta,
          phase,
        } as unknown as Record<string, unknown>,
      };
      stateCommitLog.push(entry);
      appliedMutations.push({ mutation: appliedMutation, entry });
      continue;
    }

    if (mutation.type === "update_scene_object") {
      if (!hasAnyAuthorizedVector(input.routerDecision)) {
        stateCommitLog.push({
          kind: "mutation",
          mutationType: mutation.type,
          status: "rejected",
          reasonCode: "unauthorized_vector",
          summary: "Scene-aspect changes are not authorized for this turn.",
          metadata: { ...mutation, phase } as unknown as Record<string, unknown>,
        });
        continue;
      }
      const aspectKey = sceneAspectKeyFromName(mutation.objectId);
      const label = normalizeWhitespace(mutation.objectId.replace(/[_-]+/g, " "));
      const state = normalizeWhitespace(mutation.newState);
      const existing = projectedSceneAspects[aspectKey] ?? null;
      if (existing && existing.label === label && existing.state === state) {
        stateCommitLog.push({
          kind: "mutation",
          mutationType: mutation.type,
          status: "noop",
          reasonCode: "already_applied",
          summary: `${label} is already ${state}.`,
          metadata: {
            ...mutation,
            aspectKey,
            phase,
          } as unknown as Record<string, unknown>,
        });
        continue;
      }
      projectedSceneAspects[aspectKey] = {
        label,
        state,
        duration: existing?.duration ?? "permanent",
      };
      const entry = {
        kind: "mutation" as const,
        mutationType: mutation.type,
        status: "applied" as const,
        reasonCode: "scene_aspect_spawned",
        summary: `${label} changes to ${state}.`,
        metadata: {
          ...mutation,
          aspectKey,
          phase,
        } as unknown as Record<string, unknown>,
      };
      stateCommitLog.push(entry);
      appliedMutations.push({ mutation: { ...mutation, phase } as MechanicsMutation, entry });
      continue;
    }

    if (mutation.type === "discover_information") {
      if (!hasVector(input.routerDecision, "investigate") && !hasVector(input.routerDecision, "converse")) {
        stateCommitLog.push({
          kind: "mutation",
          mutationType: mutation.type,
          status: "rejected",
          reasonCode: "unauthorized_vector",
          summary: "New discoveries are not authorized for this turn.",
          metadata: { ...mutation, phase } as unknown as Record<string, unknown>,
        });
        continue;
      }
      if (input.snapshot.discoveredInformation.some((information) => information.id === mutation.informationId)) {
        stateCommitLog.push({
          kind: "mutation",
          mutationType: mutation.type,
          status: "noop",
          reasonCode: "already_applied",
          summary: "That clue is already part of the campaign truth.",
          metadata: { ...mutation, phase } as unknown as Record<string, unknown>,
        });
        continue;
      }
      if (!knownInformation.has(mutation.informationId)) {
        stateCommitLog.push({
          kind: "mutation",
          mutationType: mutation.type,
          status: "rejected",
          reasonCode: "invalid_target",
          summary: "That information is not grounded in the current turn context.",
          metadata: { ...mutation, phase } as unknown as Record<string, unknown>,
        });
        continue;
      }
      if (discoveredInformationIds.has(mutation.informationId)) {
        stateCommitLog.push({
          kind: "mutation",
          mutationType: mutation.type,
          status: "noop",
          reasonCode: "already_applied",
          summary: "That discovery was already recorded this turn.",
          metadata: { ...mutation, phase } as unknown as Record<string, unknown>,
        });
        continue;
      }
      discoveredInformationIds.add(mutation.informationId);
      const entry = {
        kind: "mutation" as const,
        mutationType: mutation.type,
        status: "applied" as const,
        reasonCode: "information_discovered",
        summary: `You uncover information ${mutation.informationId}.`,
        metadata: { ...mutation, phase } as unknown as Record<string, unknown>,
      };
      stateCommitLog.push(entry);
      appliedMutations.push({ mutation: { ...mutation, phase } as MechanicsMutation, entry });
      continue;
    }

    if (mutation.type === "set_npc_state") {
      if (!hasVector(input.routerDecision, "violence")) {
        stateCommitLog.push({
          kind: "mutation",
          mutationType: mutation.type,
          status: "rejected",
          reasonCode: "unauthorized_vector",
          summary: "Violent state changes are not authorized for this turn.",
          metadata: { ...mutation, phase } as unknown as Record<string, unknown>,
        });
        continue;
      }
      const npc = knownNpc(input.snapshot, input.fetchedFacts, mutation.npcId);
      const projectedNpcLocation = projectedNpcLocationIds.get(mutation.npcId);
      if (!npc) {
        stateCommitLog.push({
          kind: "mutation",
          mutationType: mutation.type,
          status: "rejected",
          reasonCode: "invalid_target",
          summary: "That NPC target is not available here.",
          metadata: { ...mutation, phase } as unknown as Record<string, unknown>,
        });
        continue;
      }
      if (projectedNpcLocationIds.has(mutation.npcId) && projectedNpcLocation !== projectedLocationId) {
        stateCommitLog.push({
          kind: "mutation",
          mutationType: mutation.type,
          status: "rejected",
          reasonCode: "invalid_target",
          summary: "That NPC target is no longer available here.",
          metadata: { ...mutation, phase } as unknown as Record<string, unknown>,
        });
        continue;
      }
      if (npc.state === mutation.newState) {
        stateCommitLog.push({
          kind: "mutation",
          mutationType: mutation.type,
          status: "noop",
          reasonCode: "already_applied",
          summary: `${npc.name} is already ${mutation.newState}.`,
          metadata: { ...mutation, phase } as unknown as Record<string, unknown>,
        });
        continue;
      }
      const entry = {
        kind: "mutation" as const,
        mutationType: mutation.type,
        status: "applied" as const,
        reasonCode: "npc_state_changed",
        summary: `${npc.name} becomes ${mutation.newState}.`,
        metadata: { ...mutation, phase } as unknown as Record<string, unknown>,
      };
      stateCommitLog.push(entry);
      appliedMutations.push({ mutation: { ...mutation, phase } as MechanicsMutation, entry });
      continue;
    }

    if (mutation.type === "restore_health") {
      if (mutation.mode === "light_rest") {
        projectedHealth = Math.max(projectedHealth, Math.ceil(input.snapshot.character.maxHealth * 0.5));
      } else if (mutation.mode === "full_rest") {
        projectedHealth = input.snapshot.character.maxHealth;
      } else {
        projectedHealth = Math.min(input.snapshot.character.maxHealth, projectedHealth + (mutation.amount ?? 0));
      }
      const appliedMutation = { ...mutation, phase } as MechanicsMutation;
      const entry = {
        kind: "mutation" as const,
        mutationType: mutation.type,
        status: "applied" as const,
        reasonCode: "health_restored",
        summary:
          mutation.mode === "amount"
            ? `You recover ${mutation.amount ?? 0} health.`
            : "You regain your strength.",
        metadata: { ...appliedMutation } as unknown as Record<string, unknown>,
      };
      stateCommitLog.push(entry);
      appliedMutations.push({ mutation: appliedMutation, entry });
    }
  }

  return {
    stateCommitLog,
    appliedMutations,
    discoveredInformationIds: Array.from(discoveredInformationIds),
    nextState: {
      ...input.snapshot.state,
      currentLocationId: projectedLocationId,
      globalTime: input.snapshot.state.globalTime + input.command.timeElapsed,
      pendingTurnId: null,
      lastActionSummary:
        input.command.memorySummary
        ?? stateCommitLog.find((entry) => entry.status !== "noop")?.summary
        ?? "The situation changes.",
      sceneAspects: projectedSceneAspects,
    } satisfies CampaignRuntimeState,
  };
}

async function applyMarketTradeMutation(input: {
  tx: Prisma.TransactionClient;
  snapshot: CampaignSnapshot;
  mutation: Extract<MechanicsMutation, { type: "commit_market_trade" }>;
  fetchedFacts: TurnFetchToolResult[];
  rollback: TurnRollbackData;
}) {
  const price = findFetchedMarketPrice(
    input.fetchedFacts,
    input.mutation.marketPriceId,
    input.mutation.commodityId,
  );
  if (!price) {
    throw new Error("Trade commit missing fetched market price.");
  }

  const total = price.price * input.mutation.quantity;
  const characterInstance = await input.tx.characterInstance.findUnique({
    where: { campaignId: input.snapshot.campaignId },
    include: {
      commodityStacks: {
        where: { commodityId: input.mutation.commodityId },
      },
    },
  });
  if (!characterInstance) {
    throw new Error("Character instance not found.");
  }

  recordInverse(input.rollback, "characterInstance", characterInstance.id, "gold", characterInstance.gold);

  if (input.mutation.action === "buy") {
    await input.tx.characterInstance.update({
      where: { id: characterInstance.id },
      data: {
        gold: {
          decrement: total,
        },
      },
    });
  } else {
    await input.tx.characterInstance.update({
      where: { id: characterInstance.id },
      data: {
        gold: {
          increment: total,
        },
      },
    });
  }

  const marketPrice = await input.tx.marketPrice.findUnique({
    where: { id: input.mutation.marketPriceId },
    select: { id: true, stock: true },
  });
  if (marketPrice && marketPrice.stock !== -1) {
    recordInverse(input.rollback, "marketPrice", marketPrice.id, "stock", marketPrice.stock);
    await input.tx.marketPrice.update({
      where: { id: marketPrice.id },
      data: {
        stock: {
          [input.mutation.action === "buy" ? "decrement" : "increment"]: input.mutation.quantity,
        },
        ...(input.mutation.action === "buy"
          ? { restockTime: input.snapshot.state.globalTime + 720 }
          : {}),
      } as Prisma.MarketPriceUpdateInput,
    });
  }

  const existingStack = characterInstance.commodityStacks[0];
  if (input.mutation.action === "buy") {
    if (existingStack) {
      recordInverse(input.rollback, "characterCommodityStack", existingStack.id, "quantity", existingStack.quantity);
      await input.tx.characterCommodityStack.update({
        where: { id: existingStack.id },
        data: {
          quantity: {
            increment: input.mutation.quantity,
          },
        },
      });
    } else {
      const created = await input.tx.characterCommodityStack.create({
        data: {
          characterInstanceId: characterInstance.id,
          commodityId: input.mutation.commodityId,
          quantity: input.mutation.quantity,
        },
      });
      input.rollback.createdCommodityStackIds.push(created.id);
      recordCreated(input.rollback, "characterCommodityStack", created.id);
    }
    return;
  }

  if (!existingStack) {
    throw new Error("Commodity stack missing during sell.");
  }
  recordInverse(input.rollback, "characterCommodityStack", existingStack.id, "quantity", existingStack.quantity);
  await input.tx.characterCommodityStack.update({
    where: { id: existingStack.id },
    data: {
      quantity: {
        decrement: input.mutation.quantity,
      },
    },
  });
}

async function findReusableTemporaryActor(input: {
  tx: Prisma.TransactionClient;
  campaignId: string;
  currentLocationId: string;
  role: string;
  summary: string;
  apparentDisposition: string;
}) {
  const candidates = await input.tx.temporaryActor.findMany({
    where: {
      campaignId: input.campaignId,
      promotedNpcId: null,
      OR: [
        { currentLocationId: input.currentLocationId },
        { currentLocationId: null },
      ],
    },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    take: 20,
  });

  return candidates.find((actor) =>
    sceneActorIdentityClearlyMatches({
      candidateRole: input.role,
      existingRole: actor.label,
      candidateSummary: `${input.summary} ${input.apparentDisposition}`,
      existingSummary: actor.lastSummary,
    })
  ) ?? null;
}

async function findReusableEnvironmentalItemTemplate(input: {
  tx: Prisma.TransactionClient;
  campaignId: string;
  itemName: string;
  description: string;
}) {
  return input.tx.itemTemplate.findFirst({
    where: {
      campaignId: input.campaignId,
      name: input.itemName,
      description: input.description,
      value: 0,
      rarity: "improvised",
      tags: {
        hasEvery: ["spawned", "environmental", "ephemeral"],
      },
    },
    select: { id: true },
  });
}

async function applyResolvedMutations(input: {
  tx: Prisma.TransactionClient;
  snapshot: CampaignSnapshot;
  appliedMutations: AppliedMutationRecord[];
  fetchedFacts: TurnFetchToolResult[];
  rollback: TurnRollbackData;
  nextTurnCount: number;
  nextState: CampaignRuntimeState;
}) {
  const affectedFactionIds = new Set<string>();
  const discoveredInformationIds: string[] = [];
  const stateCommitLog: StateCommitLog = [];
  const spawnedTemporaryActorIds = new Map<string, string>();
  const spawnedItemTemplateIds = new Map<string, string>();
  let currentLocationId = input.snapshot.state.currentLocationId;

  for (const { mutation, entry } of input.appliedMutations) {
    if (mutation.type === "move_player") {
      currentLocationId = mutation.targetLocationId;
      continue;
    }

    if (mutation.type === "spawn_scene_aspect" || mutation.type === "update_scene_object") {
      continue;
    }

    if (mutation.type === "adjust_relationship") {
      const npc = await input.tx.nPC.findUnique({
        where: { id: mutation.npcId },
        select: { id: true, approval: true, factionId: true },
      });
      if (!npc) {
        continue;
      }
      recordInverse(input.rollback, "nPC", npc.id, "approval", npc.approval);
      await input.tx.nPC.update({
        where: { id: npc.id },
        data: {
          approval: {
            increment: mutation.delta,
          },
        },
      });
      if (npc.factionId) {
        affectedFactionIds.add(npc.factionId);
      }
      continue;
    }

    if (mutation.type === "adjust_gold") {
      const characterInstance = await input.tx.characterInstance.findUnique({
        where: { campaignId: input.snapshot.campaignId },
        select: { id: true, gold: true },
      });
      if (!characterInstance) {
        throw new Error("Character instance not found.");
      }
      recordInverse(input.rollback, "characterInstance", characterInstance.id, "gold", characterInstance.gold);
      await input.tx.characterInstance.update({
        where: { id: characterInstance.id },
        data: {
          gold: {
            increment: mutation.delta,
          },
        },
      });
      continue;
    }

    if (mutation.type === "spawn_temporary_actor") {
      if (spawnedTemporaryActorIds.has(mutation.spawnKey)) {
        throw new Error("Duplicate temporary-actor spawn key during commit.");
      }

      const reusableActor = await findReusableTemporaryActor({
        tx: input.tx,
        campaignId: input.snapshot.campaignId,
        currentLocationId,
        role: mutation.role,
        summary: normalizeWhitespace(mutation.summary),
        apparentDisposition: normalizeWhitespace(mutation.apparentDisposition),
      });
      const lastSummary = `${normalizeWhitespace(mutation.summary)} Apparent disposition: ${normalizeWhitespace(mutation.apparentDisposition)}.`;

      if (reusableActor) {
        const updateData: Prisma.TemporaryActorUpdateInput = {};
        if (reusableActor.currentLocationId !== currentLocationId) {
          recordInverse(input.rollback, "temporaryActor", reusableActor.id, "currentLocationId", reusableActor.currentLocationId);
          updateData.currentLocationId = currentLocationId;
        }
        if (reusableActor.lastSummary !== lastSummary) {
          recordInverse(input.rollback, "temporaryActor", reusableActor.id, "lastSummary", reusableActor.lastSummary);
          updateData.lastSummary = lastSummary;
        }
        if (reusableActor.lastSeenAtTurn !== input.nextTurnCount) {
          recordInverse(input.rollback, "temporaryActor", reusableActor.id, "lastSeenAtTurn", reusableActor.lastSeenAtTurn);
          updateData.lastSeenAtTurn = input.nextTurnCount;
        }
        if (reusableActor.lastSeenAtTime !== input.nextState.globalTime) {
          recordInverse(input.rollback, "temporaryActor", reusableActor.id, "lastSeenAtTime", reusableActor.lastSeenAtTime);
          updateData.lastSeenAtTime = input.nextState.globalTime;
        }
        if (Object.keys(updateData).length) {
          await input.tx.temporaryActor.update({
            where: { id: reusableActor.id },
            data: updateData,
          });
        }
        spawnedTemporaryActorIds.set(mutation.spawnKey, reusableActor.id);
        continue;
      }

      const actorId = `tactor_${randomUUID()}`;
      await input.tx.temporaryActor.create({
        data: {
          id: actorId,
          campaignId: input.snapshot.campaignId,
          label: normalizeWhitespace(mutation.role),
          currentLocationId,
          interactionCount: 0,
          firstSeenAtTurn: input.nextTurnCount,
          lastSeenAtTurn: input.nextTurnCount,
          lastSeenAtTime: input.nextState.globalTime,
          recentTopics: [],
          lastSummary,
          holdsInventory: false,
          affectedWorldState: false,
          isInMemoryGraph: false,
          promotedNpcId: null,
        },
      });
      recordCreated(input.rollback, "temporaryActor", actorId);
      input.rollback.createdTemporaryActorIds.push(actorId);
      spawnedTemporaryActorIds.set(mutation.spawnKey, actorId);
      continue;
    }

    if (mutation.type === "record_local_interaction") {
      const actorId = resolveSpawnedTemporaryActorId({
        actorRef: mutation.localEntityId,
        spawnedTemporaryActorIds,
      });
      if (!actorId) {
        throw new Error("Local interaction referenced an unresolved temporary actor.");
      }

      const actor = await input.tx.temporaryActor.findFirst({
        where: {
          id: actorId,
          campaignId: input.snapshot.campaignId,
          currentLocationId,
        },
        select: {
          id: true,
          label: true,
          currentLocationId: true,
          interactionCount: true,
          recentTopics: true,
          lastSummary: true,
          lastSeenAtTurn: true,
          lastSeenAtTime: true,
          holdsInventory: true,
          affectedWorldState: true,
          isInMemoryGraph: true,
          promotedNpcId: true,
        },
      });
      if (!actor) {
        continue;
      }

      const topic = mutation.topic?.trim() || null;
      const nextTopics = topic
        ? dedupeStrings([...actor.recentTopics, topic]).slice(-4)
        : actor.recentTopics;
      const nextInteractionCount = actor.interactionCount + 1;
      const nextSummary = mutation.interactionSummary.trim() || actor.lastSummary;

      recordInverse(input.rollback, "temporaryActor", actor.id, "interactionCount", actor.interactionCount);
      recordInverse(input.rollback, "temporaryActor", actor.id, "recentTopics", actor.recentTopics);
      recordInverse(input.rollback, "temporaryActor", actor.id, "lastSummary", actor.lastSummary);
      recordInverse(input.rollback, "temporaryActor", actor.id, "lastSeenAtTurn", actor.lastSeenAtTurn);
      recordInverse(input.rollback, "temporaryActor", actor.id, "lastSeenAtTime", actor.lastSeenAtTime);
      await input.tx.temporaryActor.update({
        where: { id: actor.id },
        data: {
          interactionCount: nextInteractionCount,
          recentTopics: nextTopics,
          lastSummary: nextSummary,
          lastSeenAtTurn: input.nextTurnCount,
          lastSeenAtTime: input.nextState.globalTime,
        },
      });

      if (
        shouldPromoteTemporaryActor({
          interactionCount: nextInteractionCount,
          holdsInventory: actor.holdsInventory,
          affectedWorldState: actor.affectedWorldState,
          isInMemoryGraph: actor.isInMemoryGraph,
          promotedNpcId: actor.promotedNpcId,
        })
      ) {
        const location = actor.currentLocationId
          ? await input.tx.locationNode.findUnique({
              where: { id: actor.currentLocationId },
              select: { name: true },
            })
          : null;
        const role = toPromotedTemporaryActorRole(actor.label);
        const name = toPromotedTemporaryActorName(actor.label);
        const seedText = buildPromotedTemporaryActorSeedText({
          actor: {
            label: actor.label,
            recentTopics: nextTopics,
            lastSummary: nextSummary,
          },
          role,
          locationName: location?.name ?? input.snapshot.currentLocation.name,
        });
        const promotedNpcId = `npc_${randomUUID()}`;
        await input.tx.nPC.create({
          data: {
            id: promotedNpcId,
            campaignId: input.snapshot.campaignId,
            name,
            role,
            summary: seedText.summary,
            description: seedText.description,
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
        stateCommitLog.push({
          kind: "mutation",
          mutationType: "record_local_interaction",
          status: "applied",
          reasonCode: "promoted_local_created",
          summary: `${name} steps forward as a remembered local presence.`,
          metadata: {
            localEntityId: tempActorRef(actor.id),
            promotedNpcId,
            promotedNpcName: name,
          },
        });
      }
      continue;
    }

    if (mutation.type === "set_scene_actor_presence") {
      const resolvedActorRef =
        typeof entry.metadata?.actorRef === "string" ? entry.metadata.actorRef : mutation.actorRef;
      if (!resolvedActorRef.startsWith("npc:")) {
        const actorId = resolveSpawnedTemporaryActorId({
          actorRef: resolvedActorRef,
          spawnedTemporaryActorIds,
        });
        if (!actorId) {
          throw new Error("Scene presence update referenced an unresolved temporary actor.");
        }
        const actor = await input.tx.temporaryActor.findUnique({
          where: { id: actorId },
          select: { id: true, currentLocationId: true, promotedNpcId: true },
        });
        if (!actor || actor.promotedNpcId) {
          continue;
        }
        if (actor.currentLocationId !== mutation.newLocationId) {
          recordInverse(input.rollback, "temporaryActor", actor.id, "currentLocationId", actor.currentLocationId);
          await input.tx.temporaryActor.update({
            where: { id: actor.id },
            data: {
              currentLocationId: mutation.newLocationId,
            },
          });
        }
        continue;
      }

      const npcId = resolvedActorRef.slice("npc:".length);
      const npc = await input.tx.nPC.findUnique({
        where: { id: npcId },
        select: { id: true, currentLocationId: true },
      });
      if (!npc) {
        continue;
      }
      if (npc.currentLocationId !== mutation.newLocationId) {
        recordInverse(input.rollback, "nPC", npc.id, "currentLocationId", npc.currentLocationId);
        await input.tx.nPC.update({
          where: { id: npc.id },
          data: {
            currentLocationId: mutation.newLocationId,
          },
        });
      }
      continue;
    }

    if (mutation.type === "commit_market_trade") {
      await applyMarketTradeMutation({
        tx: input.tx,
        snapshot: input.snapshot,
        mutation,
        fetchedFacts: input.fetchedFacts,
        rollback: input.rollback,
      });
      continue;
    }

    if (mutation.type === "spawn_environmental_item") {
      if (spawnedItemTemplateIds.has(mutation.spawnKey)) {
        throw new Error("Duplicate environmental-item spawn key during commit.");
      }

      const characterInstance = await input.tx.characterInstance.findUnique({
        where: { campaignId: input.snapshot.campaignId },
        select: { id: true },
      });
      if (!characterInstance) {
        throw new Error("Character instance not found.");
      }

      const itemName = normalizeItemName(mutation.itemName);
      const description = normalizedDescription(mutation.description);
      const reusableTemplate = await findReusableEnvironmentalItemTemplate({
        tx: input.tx,
        campaignId: input.snapshot.campaignId,
        itemName,
        description,
      });

      let templateId = reusableTemplate?.id ?? null;
      if (!templateId) {
        const createdTemplate = await input.tx.itemTemplate.create({
          data: {
            campaignId: input.snapshot.campaignId,
            name: itemName,
            description,
            value: 0,
            weight: 0,
            rarity: "improvised",
            tags: ["spawned", "environmental", "ephemeral"],
          },
          select: { id: true },
        });
        templateId = createdTemplate.id;
        recordCreated(input.rollback, "itemTemplate", templateId);
      }

      spawnedItemTemplateIds.set(mutation.spawnKey, templateId);
      for (let index = 0; index < mutation.quantity; index += 1) {
        const created = await input.tx.itemInstance.create({
          data: {
            characterInstanceId: characterInstance.id,
            templateId,
            isIdentified: true,
            charges: null,
            properties: Prisma.JsonNull,
          },
          select: { id: true },
        });
        recordCreated(input.rollback, "itemInstance", created.id);
      }
      continue;
    }

    if (mutation.type === "adjust_inventory") {
      const resolvedItemId = resolveItemTemplateIdForEvaluation({
        itemId: mutation.itemId,
        spawnedItemTemplateIds,
      });
      if (!resolvedItemId) {
        throw new Error("Inventory adjustment referenced an unresolved spawned item.");
      }

      const characterInstance = await input.tx.characterInstance.findUnique({
        where: { campaignId: input.snapshot.campaignId },
        include: {
          inventory: {
            where: { templateId: resolvedItemId },
            orderBy: { createdAt: "asc" },
          },
        },
      });
      if (!characterInstance) {
        throw new Error("Character instance not found.");
      }

      if (mutation.action === "remove") {
        const removableItems = characterInstance.inventory.filter(
          (item) => !isRemovedInventoryProperties(item.properties as Prisma.JsonValue | null),
        );
        if (removableItems.length < mutation.quantity) {
          throw new Error("Inventory removal exceeded owned quantity during commit.");
        }
        for (const item of removableItems.slice(0, mutation.quantity)) {
          recordInverse(input.rollback, "itemInstance", item.id, "properties", item.properties);
          await input.tx.itemInstance.update({
            where: { id: item.id },
            data: {
              properties: withRemovedInventoryMarker(item.properties),
            },
          });
        }
        continue;
      }

      const template = await input.tx.itemTemplate.findFirst({
        where: {
          id: resolvedItemId,
          campaignId: input.snapshot.campaignId,
        },
        select: { id: true },
      });
      if (!template) {
        throw new Error("Inventory addition referenced an unknown item template.");
      }

      for (let index = 0; index < mutation.quantity; index += 1) {
        const created = await input.tx.itemInstance.create({
          data: {
            characterInstanceId: characterInstance.id,
            templateId: template.id,
            isIdentified: true,
            charges: null,
            properties: Prisma.JsonNull,
          },
          select: { id: true },
        });
        recordCreated(input.rollback, "itemInstance", created.id);
      }
      continue;
    }

    if (mutation.type === "discover_information") {
      discoveredInformationIds.push(mutation.informationId);
      continue;
    }

    if (mutation.type === "set_npc_state") {
      const npc = await input.tx.nPC.findUnique({
        where: { id: mutation.npcId },
        select: { id: true, state: true, factionId: true, name: true },
      });
      if (!npc) {
        continue;
      }
      recordInverse(input.rollback, "nPC", npc.id, "state", npc.state);
      await input.tx.nPC.update({
        where: { id: npc.id },
        data: {
          state: mutation.newState,
        },
      });
      if (npc.factionId) {
        affectedFactionIds.add(npc.factionId);
        await createTestingMoveForFaction({
          tx: input.tx,
          campaignId: input.snapshot.campaignId,
          factionId: npc.factionId,
          scheduledAtTime: input.snapshot.state.globalTime + 30,
          description: `${npc.name}'s faction reacts to violence in the area.`,
          rollback: input.rollback,
        });
      }
      continue;
    }

    if (mutation.type === "restore_health") {
      const characterInstance = await input.tx.characterInstance.findUnique({
        where: { campaignId: input.snapshot.campaignId },
        select: { id: true, health: true },
      });
      if (!characterInstance) {
        throw new Error("Character instance not found.");
      }

      let restoredHealth = characterInstance.health;
      if (mutation.mode === "light_rest") {
        restoredHealth = Math.max(characterInstance.health, Math.ceil(input.snapshot.character.maxHealth * 0.5));
      } else if (mutation.mode === "full_rest") {
        restoredHealth = input.snapshot.character.maxHealth;
      } else {
        restoredHealth = Math.min(input.snapshot.character.maxHealth, characterInstance.health + (mutation.amount ?? 0));
      }

      if (restoredHealth !== characterInstance.health) {
        recordInverse(input.rollback, "characterInstance", characterInstance.id, "health", characterInstance.health);
        await input.tx.characterInstance.update({
          where: { id: characterInstance.id },
          data: {
            health: restoredHealth,
          },
        });
      }
    }
  }

  if (discoveredInformationIds.length) {
    await applyInformationDiscoveries({
      tx: input.tx,
      snapshot: input.snapshot,
      ids: discoveredInformationIds,
      nextTurnCount: input.nextTurnCount,
      rollback: input.rollback,
    });
  }

  return {
    affectedFactionIds: Array.from(affectedFactionIds),
    discoveredInformationIds,
    stateCommitLog,
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
}): Promise<{
  stateCommitLog: StateCommitLogEntry[];
  changeCodes: TurnCausalityCode[];
  reasonCodes: TurnCausalityCode[];
}> {
  const outcomes = {
    stateCommitLog: [] as StateCommitLogEntry[],
    changeCodes: [] as TurnCausalityCode[],
  };
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
      outcomes,
    });

    firstWindow = false;
    windowStart = chunkEnd;
  }

  const reasonCodes: TurnCausalityCode[] = outcomes.changeCodes.length
    ? [
        {
          code: "SIMULATION_TICK",
          entityType: "campaign",
          targetId: input.snapshot.campaignId,
          metadata: {
            label: "world simulation",
          },
        },
      ]
    : [];

  return {
    stateCommitLog: outcomes.stateCommitLog,
    changeCodes: outcomes.changeCodes,
    reasonCodes,
  };
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
  stateCommitLog: StateCommitLog;
  scheduleChangeCodes: TurnCausalityCode[];
}) {
  if (input.memoryKind !== "world_change") {
    return true;
  }

  return (
    input.stateCommitLog.some((entry) => entry.status === "applied" && entry.mutationType === "discover_information")
    || input.stateCommitLog.some((entry) => entry.status === "applied" && entry.kind === "simulation")
    || input.scheduleChangeCodes.length > 0
    || input.command.narrationBounds?.wasCapped === true
    || input.command.checkResult?.outcome === "failure"
  );
}

function determineMemoryKind(input: {
  command: Exclude<ValidatedTurnCommand, RequestClarificationToolCall>;
  stateCommitLog: StateCommitLog;
}) {
  if (input.stateCommitLog.some((entry) => entry.status === "applied" && entry.mutationType === "set_npc_state")) {
    return "conflict" as const;
  }
  if (input.stateCommitLog.some((entry) => entry.status === "applied" && entry.mutationType === "commit_market_trade")) {
    return "trade" as const;
  }
  if (input.stateCommitLog.some((entry) => entry.status === "applied" && entry.mutationType === "move_player")) {
    return "travel" as const;
  }
  if (input.stateCommitLog.some((entry) => entry.status === "applied" && entry.mutationType === "discover_information")) {
    return "discovery" as const;
  }
  if (input.stateCommitLog.some((entry) => entry.status === "applied" && entry.mutationType === "adjust_relationship")) {
    return "relationship_shift" as const;
  }

  const promiseText = input.command.memorySummary?.toLowerCase() ?? "";
  if (/\b(promise|promised|swear|swore|vow|vowed|agree|agreed|deal|owed|owe|return with|meet again)\b/.test(promiseText)) {
    return "promise" as const;
  }

  return "world_change" as const;
}

function buildSystemFallbackMemorySummary(input: {
  snapshot: CampaignSnapshot;
  command: Exclude<ValidatedTurnCommand, RequestClarificationToolCall>;
  memoryKind: ReturnType<typeof determineMemoryKind>;
  stateCommitLog: StateCommitLog;
}) {
  const locationName = input.snapshot.currentLocation.name;
  const firstApplied =
    input.stateCommitLog.find((entry) => entry.status === "applied" && entry.kind !== "check")
    ?? input.stateCommitLog.find((entry) => entry.status === "applied");

  switch (input.memoryKind) {
    case "conflict":
      return `Violence broke out in ${locationName}.`;
    case "promise":
      return `A new obligation took shape in ${locationName}.`;
    case "relationship_shift":
      return `A relationship shifted in ${locationName}.`;
    case "discovery":
      return input.stateCommitLog.filter((entry) => entry.status === "applied" && entry.mutationType === "discover_information").length === 1
        ? `You uncovered a new lead in ${locationName}.`
        : `You uncovered new information in ${locationName}.`;
    case "travel":
      return `You traveled onward from ${locationName}.`;
    case "trade":
      return `Trade shifted the scene in ${locationName}.`;
    case "world_change":
      if (input.command.narrationBounds?.wasCapped) {
        return `Time advanced only to the edge of the committed world window in ${locationName}.`;
      }
      return firstApplied?.summary ?? `The situation changed in ${locationName}.`;
  }
}

function collectMemoryEntityLinks(input: {
  snapshot: CampaignSnapshot;
  stateCommitLog: StateCommitLog;
  changeCodes: TurnCausalityCode[];
  reasonCodes: TurnCausalityCode[];
  affectedFactionIds: string[];
}) {
  const keys: string[] = [];
  const pushKey = (entityType: string, entityId: string | null | undefined) => {
    if (entityId) {
      keys.push(`${entityType}:${entityId}`);
    }
  };

  pushKey("location", input.snapshot.currentLocation.id);

  for (const entry of input.stateCommitLog) {
    if (!entry.metadata) {
      continue;
    }
    if (entry.mutationType === "move_player") {
      pushKey("location", typeof entry.metadata.targetLocationId === "string" ? entry.metadata.targetLocationId : null);
      pushKey("route", typeof entry.metadata.routeEdgeId === "string" ? entry.metadata.routeEdgeId : null);
    }
    if (entry.mutationType === "adjust_relationship" || entry.mutationType === "set_npc_state") {
      pushKey("npc", typeof entry.metadata.npcId === "string" ? entry.metadata.npcId : null);
    }
    if (entry.mutationType === "commit_market_trade") {
      pushKey("commodity", typeof entry.metadata.commodityId === "string" ? entry.metadata.commodityId : null);
    }
    if (entry.mutationType === "discover_information") {
      pushKey("information", typeof entry.metadata.informationId === "string" ? entry.metadata.informationId : null);
    }
    if (entry.mutationType === "spawn_scene_aspect" || entry.mutationType === "update_scene_object") {
      pushKey(
        "scene_object",
        typeof entry.metadata.aspectKey === "string"
          ? entry.metadata.aspectKey
          : typeof entry.metadata.objectId === "string"
            ? entry.metadata.objectId
            : null,
      );
    }
    if (entry.mutationType === "record_local_interaction") {
      pushKey("npc", typeof entry.metadata.promotedNpcId === "string" ? entry.metadata.promotedNpcId : null);
    }
    if (
      entry.mutationType === "set_scene_actor_presence"
      && typeof entry.metadata.actorRef === "string"
      && entry.metadata.actorRef.startsWith("npc:")
    ) {
      pushKey("npc", entry.metadata.actorRef.slice("npc:".length));
    }
    if (entry.kind === "simulation") {
      const entityType = entry.metadata?.entityType;
      const targetId = entry.metadata?.targetId;
      if (typeof entityType === "string" && typeof targetId === "string") {
        pushKey(entityType, targetId);
      }
    }
  }

  for (const factionId of input.affectedFactionIds) {
    pushKey("faction", factionId);
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
  stateCommitLog: StateCommitLog;
  nextState: CampaignRuntimeState;
  simulationChangeCodes: TurnCausalityCode[];
  simulationReasonCodes: TurnCausalityCode[];
  scheduleChangeCodes: TurnCausalityCode[];
}) {
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

  if (input.nextState.currentLocationId !== input.snapshot.state.currentLocationId) {
    changeCodes.push({
      code: "LOCATION_CHANGED",
      entityType: "location",
      targetId: input.nextState.currentLocationId,
      metadata: { label: input.nextState.currentLocationId },
    });
    reasonCodes.push({
      code: "PLAYER_TRAVEL",
      entityType: "location",
      targetId: input.nextState.currentLocationId,
      metadata: null,
    });
  }

  for (const entry of input.stateCommitLog) {
    if (entry.status !== "applied") {
      continue;
    }
    if (entry.mutationType === "adjust_relationship") {
      changeCodes.push({
        code: "NPC_APPROVAL_CHANGED",
        entityType: "npc",
        targetId: typeof entry.metadata?.npcId === "string" ? entry.metadata.npcId : null,
        delta: typeof entry.metadata?.delta === "number" ? entry.metadata.delta : null,
        metadata: null,
      });
      reasonCodes.push({
        code: "PLAYER_CONVERSATION",
        entityType: "npc",
        targetId: typeof entry.metadata?.npcId === "string" ? entry.metadata.npcId : null,
        metadata: null,
      });
    }
    if (entry.mutationType === "set_npc_state") {
      changeCodes.push({
        code: "NPC_STATE_CHANGED",
        entityType: "npc",
        targetId: typeof entry.metadata?.npcId === "string" ? entry.metadata.npcId : null,
        metadata: null,
      });
      reasonCodes.push({
        code: "PLAYER_COMBAT",
        entityType: "npc",
        targetId: typeof entry.metadata?.npcId === "string" ? entry.metadata.npcId : null,
        metadata: null,
      });
    }
    if (entry.mutationType === "commit_market_trade") {
      reasonCodes.push({
        code: "PLAYER_TRADE",
        entityType: "commodity",
        targetId: typeof entry.metadata?.commodityId === "string" ? entry.metadata.commodityId : null,
        metadata: null,
      });
    }
    if (entry.mutationType === "discover_information") {
      changeCodes.push({
        code: "INFORMATION_DISCOVERED",
        entityType: "information",
        targetId: typeof entry.metadata?.informationId === "string" ? entry.metadata.informationId : null,
        metadata: null,
      });
      reasonCodes.push({
        code: "PLAYER_INVESTIGATION",
        entityType: "information",
        targetId: typeof entry.metadata?.informationId === "string" ? entry.metadata.informationId : null,
        metadata: null,
      });
    }
    if (entry.mutationType === "spawn_scene_aspect" || entry.mutationType === "update_scene_object") {
      changeCodes.push({
        code: "SCENE_OBJECT_STATE_CHANGED",
        entityType: "scene_object",
        targetId:
          typeof entry.metadata?.aspectKey === "string"
            ? entry.metadata.aspectKey
            : typeof entry.metadata?.objectId === "string"
              ? entry.metadata.objectId
              : null,
        metadata: {
          state:
            typeof entry.metadata?.state === "string"
              ? entry.metadata.state
              : typeof entry.metadata?.newState === "string"
                ? entry.metadata.newState
                : null,
        },
      });
      reasonCodes.push({
        code: "PLAYER_SCENE_INTERACTION",
        entityType: "scene_object",
        targetId:
          typeof entry.metadata?.aspectKey === "string"
            ? entry.metadata.aspectKey
            : typeof entry.metadata?.objectId === "string"
              ? entry.metadata.objectId
              : null,
        metadata: null,
      });
    }
    if (entry.mutationType === "adjust_inventory" || entry.mutationType === "spawn_environmental_item") {
      reasonCodes.push({
        code: "PLAYER_ACTION",
        entityType: "character",
        targetId: input.snapshot.character.id,
        metadata: null,
      });
    }
    if (
      entry.mutationType === "set_scene_actor_presence"
      && typeof entry.metadata?.actorRef === "string"
      && entry.metadata.actorRef.startsWith("npc:")
    ) {
      changeCodes.push({
        code: "NPC_LOCATION_CHANGED",
        entityType: "npc",
        targetId: entry.metadata.actorRef.slice("npc:".length),
        metadata: null,
      });
    }
    if (entry.mutationType === "record_local_interaction") {
      reasonCodes.push({
        code: "PLAYER_CONVERSATION",
        entityType:
          typeof entry.metadata?.promotedNpcId === "string"
            ? "npc"
            : "campaign",
        targetId:
          typeof entry.metadata?.promotedNpcId === "string"
            ? entry.metadata.promotedNpcId
            : input.snapshot.campaignId,
        metadata: null,
      });
    }
    if (entry.mutationType === "restore_health") {
      changeCodes.push({
        code: "CHARACTER_HEALTH_CHANGED",
        entityType: "character",
        targetId: input.snapshot.character.id,
        metadata: null,
      });
      reasonCodes.push({
        code: input.command.timeMode === "rest" ? "PLAYER_REST" : "PLAYER_ACTION",
        entityType: "character",
        targetId: input.snapshot.character.id,
        metadata: null,
      });
    }
  }

  changeCodes.push(...input.simulationChangeCodes);
  if (input.simulationReasonCodes.length) {
    reasonCodes.push(...input.simulationReasonCodes);
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
    const onlyAdvancedTime = input.stateCommitLog.every((entry) =>
      entry.kind === "check"
      || entry.status === "noop"
      || (entry.status === "applied" && entry.mutationType === "advance_time"),
    );
    reasonCodes.push({
      code:
        onlyAdvancedTime
          ? "PLAYER_WAIT"
          : input.command.timeMode === "rest"
          ? "PLAYER_REST"
          : input.command.timeMode === "combat"
            ? "PLAYER_COMBAT"
            : "PLAYER_ACTION",
      entityType: "campaign",
      targetId: input.snapshot.campaignId,
      metadata: null,
    });
  }

  return {
    nextState: input.nextState,
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
  routerDecision: RouterDecision;
  groundedItemIds: string[];
}): Promise<{ resultPayload: TurnResultPayload; memoryEntryId: string | null }> {
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
    routerDecision,
  } = input;
  const nextTurnCount = snapshot.sessionTurnCount + 1;
  const rollback = emptyRollback(snapshot);
  let resultPayload: TurnResultPayload | null = null;
  let memoryEntryId: string | null = null;

  await prisma.$transaction(async (tx) => {
    const evaluated = evaluateResolvedCommand({
      snapshot,
      command,
      fetchedFacts,
      routerDecision,
      groundedItemIds: input.groundedItemIds,
    });

    const actionEffects = await applyResolvedMutations({
      tx,
      snapshot,
      appliedMutations: evaluated.appliedMutations,
      fetchedFacts,
      rollback,
      nextTurnCount,
      nextState: evaluated.nextState,
    });

    const simulationOutcome = await runTemporalSimulation({
      tx,
      snapshot,
      nextState: evaluated.nextState,
      rollback,
      initialAffectedFactionIds: actionEffects.affectedFactionIds,
    });

    const scheduleChangeCodes = await enqueueFutureScheduleBuffer({
      tx,
      snapshot,
      nextState: evaluated.nextState,
      turnId,
      rollback,
    });

    const stateCommitLog = [
      ...evaluated.stateCommitLog,
      ...actionEffects.stateCommitLog,
      ...simulationOutcome.stateCommitLog,
    ];

    const finalCausality = buildTurnCausality({
      snapshot,
      command,
      stateCommitLog,
      nextState: evaluated.nextState,
      simulationChangeCodes: simulationOutcome.changeCodes,
      simulationReasonCodes: simulationOutcome.reasonCodes,
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
        stateJson: toCampaignRuntimeStateJson(evaluated.nextState),
        turnLockRequestId: null,
        turnLockSessionId: null,
        turnLockExpiresAt: null,
      },
    });

    if (campaignUpdate.count === 0) {
      throw new StateConflictError("Campaign state changed before the turn could commit.", expectedStateVersion);
    }

    for (const fact of fetchedFacts) {
      if (fact.type !== "fetch_npc_detail" || !fact.hydrationDraft) {
        continue;
      }

      await persistPromotedNpcHydrationDraft({
        tx,
        snapshot,
        npcId: fact.result.id,
        hydrationDraft: fact.hydrationDraft,
        nextTurnCount,
        rollback,
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

    const memoryKind = determineMemoryKind({
      command,
      stateCommitLog,
    });
    const modelMemorySummary = normalizeMemorySummary(command.memorySummary);
    const shouldRecordMemory = modelMemorySummary != null || isSalientMemory({
      command,
      memoryKind,
      stateCommitLog,
      scheduleChangeCodes,
    });

    if (shouldRecordMemory) {
      const memorySummary = modelMemorySummary ?? buildSystemFallbackMemorySummary({
        snapshot,
        command,
        memoryKind,
        stateCommitLog,
      });
      const memoryEntityLinks = collectMemoryEntityLinks({
        snapshot,
        stateCommitLog,
        changeCodes: finalCausality.changeCodes,
        reasonCodes: finalCausality.reasonCodes,
        affectedFactionIds: actionEffects.affectedFactionIds,
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
          narrativeNote: null,
        },
      });
      rollback.createdMemoryIds.push(memory.id);
      memoryEntryId = memory.id;

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
      stateCommitLog,
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

  return {
    resultPayload,
    memoryEntryId,
  };
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
      try {
        const hydration = await buildPromotedNpcHydrationPayload({
          campaignId: snapshot.campaignId,
          baseResult: result,
        });

        if (hydration) {
          return {
            type: call.type,
            result: hydration.hydratedResult,
            hydrationDraft: hydration.hydrationDraft,
          };
        }
      } catch (error) {
        logBackendDiagnostic("turn.fetch.promoted_local_hydration_failed", {
          campaignId: snapshot.campaignId,
          npcId: result.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
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

async function executeRequiredPrerequisites(input: {
  snapshot: CampaignSnapshot;
  prerequisites: RouterDecision["requiredPrerequisites"];
}) {
  const fetchedFacts: TurnFetchToolResult[] = [];

  for (const prerequisite of input.prerequisites) {
    const call: TurnFetchToolCall =
      prerequisite.type === "market_prices"
        ? { type: "fetch_market_prices", locationId: prerequisite.locationId }
        : prerequisite.type === "npc_detail"
          ? { type: "fetch_npc_detail", npcId: prerequisite.npcId }
          : prerequisite.type === "faction_intel"
            ? { type: "fetch_faction_intel", factionId: prerequisite.factionId }
            : prerequisite.type === "information_detail"
              ? { type: "fetch_information_detail", informationId: prerequisite.informationId }
              : prerequisite.type === "information_connections"
                ? { type: "fetch_information_connections", informationIds: prerequisite.informationIds }
                : { type: "fetch_relationship_history", npcId: prerequisite.npcId };

    fetchedFacts.push(await executeFetchTool(input.snapshot, call));
  }

  return fetchedFacts;
}

function deterministicNarrationFallback(input: {
  playerAction: string;
  stateCommitLog: StateCommitLog;
  checkResult?: CheckResult | null;
}) {
  const applied = input.stateCommitLog
    .filter((entry) => entry.status === "applied" && (entry.kind === "mutation" || entry.kind === "simulation"))
    .map((entry) => entry.summary);
  const rejected = input.stateCommitLog
    .filter((entry) => entry.status === "rejected")
    .map((entry) => entry.summary);

  const sentences: string[] = [];
  if (applied.length) {
    sentences.push(applied.join(" "));
  } else if (input.checkResult?.outcome === "failure") {
    sentences.push("Your attempt does not take hold.");
  } else {
    sentences.push("The turn resolves without a lasting change.");
  }
  const waitedForArrival =
    /\bwait\b/i.test(input.playerAction)
    && /\b(for|until|til)\b/i.test(input.playerAction)
    && /\b(arrive|arrives|arrival|return|returns|come|comes)\b/i.test(input.playerAction);
  const hasArrivalCommit = input.stateCommitLog.some((entry) =>
    entry.status === "applied"
    && (entry.mutationType === "spawn_temporary_actor" || entry.mutationType === "set_scene_actor_presence"),
  );
  if (waitedForArrival && !hasArrivalCommit) {
    sentences.push("What you were waiting for has not happened yet.");
  }
  if (rejected.length) {
    sentences.push(rejected.join(" "));
  }

  return sentences.join(" ").trim();
}

async function persistResolvedTurnNarration(input: {
  sessionId: string;
  turnId: string;
  narration: string;
  suggestedActions: string[];
  fetchedFacts: TurnFetchToolResult[];
  checkResult: CheckResult | null;
  whatChanged: string[];
  why: string[];
  memoryEntryId: string | null;
}) {
  await prisma.message.create({
    data: {
      sessionId: input.sessionId,
      role: "assistant",
      kind: "narration",
      content: input.narration,
      payload: {
        suggestedActions: input.suggestedActions,
        fetchedFacts: input.fetchedFacts,
        checkResult: input.checkResult,
        whatChanged: input.whatChanged,
        why: input.why,
      } as unknown as Prisma.JsonObject,
    },
  });

  if (input.memoryEntryId) {
    await prisma.memoryEntry.update({
      where: { id: input.memoryEntryId },
      data: {
        narrativeNote: input.narration,
      },
    });
  }
}

export { TIME_MODE_BOUNDS };
export const engineTestUtils = {
  toPromotedTemporaryActorDescriptor,
  toPromotedTemporaryActorName,
  toPromotedTemporaryActorRole,
  requestHashForSubmission,
  promptContextProfileForRouter,
  routerDecisionForTurnMode,
  deterministicNarrationFallback,
  evaluateResolvedCommand,
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

    const routerDecision =
      turnMode === "observe"
        ? routerDecisionForTurnMode({
            turnMode,
            explicitTravel: false,
          })
        : intent?.type === "travel_route"
          ? routerDecisionForTurnMode({
              turnMode,
              explicitTravel: true,
            })
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
      profile: routerDecision.profile,
      confidence: routerDecision.confidence,
      authorizedVectors: routerDecision.authorizedVectors,
      requiredPrerequisites: routerDecision.requiredPrerequisites,
      reason: routerDecision.reason,
    });
    const promptContext = await getPromptContext(
      snapshot,
      promptContextProfileForRouter(routerDecision),
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
    let fetchedFacts: TurnFetchToolResult[] = [];
    if (intent?.type !== "travel_route") {
      fetchedFacts = await executeRequiredPrerequisites({
        snapshot,
        prerequisites: routerDecision.requiredPrerequisites,
      });
    }
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
            if (!isTraversableRoute(route)) {
              return {
                command: {
                  type: "resolve_mechanics",
                  timeMode: "travel",
                  suggestedActions: [],
                  warnings: [`The route to ${route.targetLocationName} is currently blocked.`],
                  memorySummary: `You attempt to set out for ${route.targetLocationName}, but the route is blocked.`,
                  mutations: [
                    {
                      type: "move_player",
                      routeEdgeId: route.id,
                      targetLocationId: route.targetLocationId,
                    },
                  ],
                },
                fetchedFacts: [],
              } satisfies TurnResolution;
            }

            return {
              command: {
                type: "resolve_mechanics",
                timeMode: "travel",
                suggestedActions: [],
                memorySummary: `You travel to ${route.targetLocationName}.`,
                mutations: [
                  {
                    type: "move_player",
                    routeEdgeId: route.id,
                    targetLocationId: route.targetLocationId,
                  },
                  {
                    type: "advance_time",
                    durationMinutes: route.travelTimeMinutes,
                  },
                ],
              },
              fetchedFacts: [],
            } satisfies TurnResolution;
          })()
        : await dmClient.runTurn({
            promptContext,
            routerDecision,
            character: snapshot.character,
            playerAction: narrationOverride.playerActionForModel,
            turnMode,
            fetchedFacts,
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

    const validated = validateTurnCommand({
      snapshot,
      command: resolution.command,
      fetchedFacts: resolution.fetchedFacts,
      playerAction,
    });

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

    for (const warning of committedCommand.warnings) {
      input.stream?.warning?.(warning);
    }

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
    const committed = await commitResolvedTurn({
      snapshot,
      sessionId: input.sessionId,
      turnId: turn.id,
      requestId: input.requestId,
      expectedStateVersion: input.expectedStateVersion,
      playerAction,
      turnMode,
      command: committedCommand,
      fetchedFacts: resolution.fetchedFacts,
      routerDecision,
      groundedItemIds: promptContext.inventory
        .filter((entry) => entry.kind === "item")
        .map((entry) => entry.id),
    });
    commitStarted = false;
    activeCommitTurnKeys.delete(turnKey);
    logBackendDiagnostic("turn.commit.success", {
      campaignId: input.campaignId,
      sessionId: input.sessionId,
      requestId: input.requestId,
      turnId: turn.id,
      stateVersionAfter: committed.resultPayload.stateVersionAfter,
      changeCount: committed.resultPayload.changeCodes.length,
      reasonCount: committed.resultPayload.reasonCodes.length,
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

    let narration: string;
    try {
      narration = await dmClient.narrateResolvedTurn({
        playerAction,
        promptContext,
        fetchedFacts: resolution.fetchedFacts,
        stateCommitLog: committed.resultPayload.stateCommitLog ?? [],
        checkResult: committed.resultPayload.checkResult ?? null,
        suggestedActions: dedupeStrings(committedCommand.suggestedActions),
        signal: abortController.signal,
      });
    } catch (error) {
      narration = deterministicNarrationFallback({
        playerAction,
        stateCommitLog: committed.resultPayload.stateCommitLog ?? [],
        checkResult: committed.resultPayload.checkResult ?? null,
      });
      logBackendDiagnostic("turn.narration.fallback", {
        campaignId: input.campaignId,
        requestId: input.requestId,
        turnId: turn.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    await persistResolvedTurnNarration({
      sessionId: input.sessionId,
      turnId: turn.id,
      narration,
      suggestedActions: dedupeStrings(committedCommand.suggestedActions),
      fetchedFacts: resolution.fetchedFacts,
      checkResult: committed.resultPayload.checkResult ?? null,
      whatChanged: committed.resultPayload.whatChanged,
      why: committed.resultPayload.why,
      memoryEntryId: committed.memoryEntryId,
    });
    input.stream?.narration?.(narration);

    return {
      type: "resolved" as const,
      turnId: turn.id,
      narration,
      suggestedActions: dedupeStrings(committedCommand.suggestedActions),
      warnings: committedCommand.warnings,
      checkResult: committedCommand.checkResult,
      result: committed.resultPayload,
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
