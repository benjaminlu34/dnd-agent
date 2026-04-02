import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { dmClient, logBackendDiagnostic } from "@/lib/ai/provider";
import { renderWhatChanged, renderWhy } from "@/lib/game/causality";
import {
  parseCampaignRuntimeStateJson,
  parseTurnResultPayloadJson,
  toCampaignRuntimeStateJson,
  toTurnResultPayloadJson,
} from "@/lib/game/json-contracts";
import {
  InvalidExpectedStateVersionError,
  StateConflictError,
  TurnAbandonedError,
  TurnLockedError,
} from "@/lib/game/errors";
import {
  fetchFactionIntelBulk,
  fetchInformationConnectionsBulk,
  fetchInformationDetailsBulk,
  fetchMarketPricesBulk,
  fetchNpcDetailsBulk,
  fetchRelationshipHistoriesBulk,
  getMissedTurnDigests,
  getPromptContext,
  getTurnRouterContext,
  getTurnSnapshot,
  toPlayerCampaignSnapshot,
} from "@/lib/game/repository";
import { canonicalizeNpcIdAgainstCandidates } from "@/lib/game/npc-identity";
import { wakeScheduleGenerationJobs } from "@/lib/game/schedule-jobs";
import {
  MAX_CASCADE_DEPTH,
  applySimulationInverse,
  parseNpcRoutineCondition,
  parseSimulationPayload,
  runSimulationTick,
} from "@/lib/game/simulation";
import type {
  AssetHolderRef,
  CampaignRuntimeState,
  CampaignSnapshot,
  CharacterCommodityStack,
  CheckResult,
  InfrastructureFailureCode,
  ItemInstance,
  LocalTextureSummary,
  MechanicsMutation,
  NpcDetail,
  NpcSummary,
  PendingCheck,
  PromotedNpcHydrationDraft,
  ResolvePendingCheckRequest,
  RequestClarificationToolCall,
  RelationshipHistory,
  ResolveMechanicsResponse,
  RouterDecision,
  RetryRequiredResponse,
  StateConflictResponse,
  StateCommitLog,
  StateCommitLogEntry,
  TurnCausalityCode,
  TurnFetchToolResult,
  TurnMode,
  TurnResolution,
  TurnRollbackData,
  TurnResultPayload,
  TurnSubmissionRequest,
  ValidatedTurnCommand,
  WorldObjectSummary,
} from "@/lib/game/types";
import {
  isLikelyProxyPlayerMovementAction,
  isLikelySoloErrandAction,
  routerSuggestsManifestationOverKnowledge,
  validateTurnCommand,
  TIME_MODE_BOUNDS,
} from "@/lib/game/validation";
import { buildCheckResult } from "@/lib/game/checks";
import {
  COPPER_PER_GOLD,
  flattenCurrencyToCp,
  formatCurrencyCompact,
} from "@/lib/game/currency";
import { normalizeItemName } from "@/lib/game/item-utils";
import { sceneActorIdentityClearlyMatches, sceneActorMatchesFocus } from "@/lib/game/scene-identity";
import { env } from "@/lib/env";

type TurnStream = {
  narration?: (chunk: string) => void;
  warning?: (message: string) => void;
  checkRequired?: (payload: { turnId: string; check: PendingCheck }) => void;
  checkResult?: (result: CheckResult) => void;
};

type ValidatedResolvedMechanicsCommand = Extract<ValidatedTurnCommand, { type: "resolve_mechanics" }>;
type ValidatedExecuteFastForwardCommand = Extract<ValidatedTurnCommand, { type: "execute_fast_forward" }>;
type ValidatedTurnActionCommand = Exclude<ValidatedTurnCommand, RequestClarificationToolCall>;

const TURN_LOCK_TTL_MS = 120_000;
const TURN_INTERNAL_DEADLINE_MS = 115_000;
const INCIDENTAL_CURRENCY_CP_MAX = 50 * COPPER_PER_GOLD;

const activeTurnControllers = new Map<string, AbortController>();
const activeCommitTurnKeys = new Set<string>();

type PendingCheckToolBundle = {
  type: "pending_check";
  command: ValidatedResolvedMechanicsCommand & {
    pendingCheck: PendingCheck;
    checkResult?: undefined;
  };
  fetchedFacts: TurnFetchToolResult[];
  routerDecision: RouterDecision;
  playerAction: string;
  turnMode: TurnMode;
  groundedItemIds: string[];
};

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
  command: ValidatedResolvedMechanicsCommand;
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
  } satisfies ValidatedResolvedMechanicsCommand;
}

function buildFastForwardNarrationBounds(input: {
  snapshot: CampaignSnapshot;
  requestedDurationMinutes: number;
  committedDurationMinutes: number;
  interruptionReason: string | null;
}) {
  return {
    requestedAdvanceMinutes: input.requestedDurationMinutes,
    committedAdvanceMinutes: input.committedDurationMinutes,
    availableAdvanceMinutes: availableAdvanceMinutes(input.snapshot),
    wasCapped: input.committedDurationMinutes < input.requestedDurationMinutes,
    overrideText: null,
    isFastForward: true,
    interruptionReason: input.interruptionReason,
  };
}

function countOwnedTemplateQuantity(snapshot: CampaignSnapshot, templateId: string) {
  return snapshot.character.inventory.filter(
    (item) =>
      item.templateId === templateId
      && !isArchivedInventoryProperties(item.properties as Prisma.JsonValue | null),
  ).length;
}

function labelForTemplateId(snapshot: CampaignSnapshot, templateId: string) {
  const item =
    snapshot.character.inventory.find((entry) => entry.templateId === templateId)
    ?? snapshot.assetItems.find((entry) => entry.templateId === templateId);
  return item?.template.name ?? "supplies";
}

function simulationPayloadTouchesLocation(payload: Prisma.JsonValue, locationId: string): boolean {
  const parsed = parseSimulationPayload(payload);
  if (!parsed.success) {
    return false;
  }

  switch (parsed.data.type) {
    case "change_location_state":
    case "change_faction_control":
    case "transfer_location_control":
      return parsed.data.locationId === locationId;
    case "spawn_world_event":
      return parsed.data.event.locationId === locationId;
    case "change_npc_location":
      return parsed.data.newLocationId === locationId;
    default:
      return false;
  }
}

function promptContextProfileForRouter(decision: RouterDecision) {
  return decision.profile === "local" ? "local" : decision.confidence === "high" ? decision.profile : "full";
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
      clarification: {
        needed: false,
        blocker: null,
        question: null,
        options: [],
      },
      attention: {
        primaryIntent: "Resolve the player action conservatively from grounded context.",
        resolvedReferents: [],
        unresolvedReferents: [],
        impliedDestinationFocus: null,
        mustCheck: [],
      },
    };
  }

  if (input.turnMode === "observe") {
    return {
      profile: "full",
      confidence: "low",
      authorizedVectors: ["investigate"],
      requiredPrerequisites: [],
      reason: "Router classification skipped for observe mode.",
      clarification: {
        needed: false,
        blocker: null,
        question: null,
        options: [],
      },
      attention: {
        primaryIntent: "Resolve the player action conservatively from grounded context.",
        resolvedReferents: [],
        unresolvedReferents: [],
        impliedDestinationFocus: null,
        mustCheck: [],
      },
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

function buildClarificationToolCall(input: {
  question: string;
  options: string[];
}): RequestClarificationToolCall {
  return {
    type: "request_clarification",
    question: input.question.trim(),
    options: dedupeStrings(input.options).slice(0, 4),
  };
}

function isPendingCheckToolBundle(value: unknown): value is PendingCheckToolBundle {
  if (!value || typeof value !== "object") {
    return false;
  }

  const bundle = value as Partial<PendingCheckToolBundle>;
  return bundle.type === "pending_check"
    && Boolean(bundle.command)
    && Array.isArray(bundle.fetchedFacts)
    && Boolean(bundle.routerDecision)
    && typeof bundle.playerAction === "string"
    && typeof bundle.turnMode === "string"
    && Array.isArray(bundle.groundedItemIds);
}

function normalizeSubmittedRolls(mode: PendingCheck["mode"], rolls: [number, number]): [number, number] {
  const first = Number(rolls[0]);
  const second = Number(rolls[1]);
  const valid = (value: number) => Number.isInteger(value) && value >= 2 && value <= 12;

  if (!valid(first) || !valid(second)) {
    throw new Error("Submitted rolls must be integer 2d6 totals between 2 and 12.");
  }

  if (mode === "normal") {
    return [first, first];
  }

  return [first, second];
}

async function persistClarificationRequest(input: {
  turnId: string;
  stateVersion: number;
  command: RequestClarificationToolCall;
}) {
  await prisma.turn.update({
    where: { id: input.turnId },
    data: {
      status: "clarification_requested",
      toolCallJson: toPrismaJsonValue(input.command),
      resultJson: toPrismaJsonValue(toTurnResultPayloadJson({
        stateVersionAfter: input.stateVersion,
        changeCodes: [],
        reasonCodes: [],
        whatChanged: [],
        why: [],
        warnings: [],
        narrationBounds: null,
        checkResult: null,
        rollback: null,
        clarification: {
          question: input.command.question,
          options: input.command.options,
        },
        error: null,
      })),
    },
  });
}

async function persistPendingCheckRequest(input: {
  campaignId: string;
  turnId: string;
  requestId: string;
  stateVersion: number;
  previousState: CampaignRuntimeState;
  bundle: PendingCheckToolBundle;
}) {
  await prisma.$transaction(async (tx) => {
    const campaignUpdate = await tx.campaign.updateMany({
      where: {
        id: input.campaignId,
        stateVersion: input.stateVersion,
        turnLockRequestId: input.requestId,
      },
      data: {
        stateJson: toCampaignRuntimeStateJson({
          ...input.previousState,
          pendingTurnId: input.turnId,
        }),
        turnLockRequestId: null,
        turnLockSessionId: null,
        turnLockExpiresAt: null,
      },
    });

    if (campaignUpdate.count === 0) {
      throw new StateConflictError("Campaign state changed before the pending roll could be stored.", input.stateVersion);
    }

    await tx.turn.update({
      where: { id: input.turnId },
      data: {
        status: "pending_check",
        toolCallJson: toPrismaJsonValue(input.bundle),
        resultJson: toPrismaJsonValue(toTurnResultPayloadJson({
          stateVersionAfter: input.stateVersion,
          changeCodes: [],
          reasonCodes: [],
          whatChanged: [],
          why: [],
          warnings: input.bundle.command.warnings,
          stateCommitLog: [],
          narrationBounds: input.bundle.command.narrationBounds ?? null,
          pendingCheck: input.bundle.command.pendingCheck,
          checkResult: null,
          rollback: null,
          clarification: null,
          error: null,
        })),
      },
    });
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
    createdWorldObjectIds: [],
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

function normalizeNpcIdentityLabel(value: string | null | undefined) {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^(the|a|an)\s+/i, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeComparableNpcText(value: string | null | undefined) {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function textMentionsLocalNpcName(text: string, npcName: string) {
  const normalizedText = normalizeComparableNpcText(text);
  const normalizedName = normalizeComparableNpcText(npcName);
  return Boolean(normalizedName) && normalizedText.includes(normalizedName);
}

function disallowedNamedLocalMentionsInHydration(input: {
  summary: string;
  description: string;
  localNpcNames: string[];
  priorFactText: string;
}) {
  const combinedDraftText = `${input.summary}\n${input.description}`;
  return input.localNpcNames.filter((npcName) =>
    textMentionsLocalNpcName(combinedDraftText, npcName)
    && !textMentionsLocalNpcName(input.priorFactText, npcName),
  );
}

function hasGenericNpcRoleLabelName(input: { name: string; role: string }) {
  const normalizedName = normalizeNpcIdentityLabel(input.name);
  const normalizedRole = normalizeNpcIdentityLabel(input.role);
  return Boolean(normalizedName) && Boolean(normalizedRole) && normalizedName === normalizedRole;
}

function sanitizePromotedNpcHydrationDraft(input: {
  draft: PromotedNpcHydrationDraft;
  currentName: string;
  currentRole: string;
  currentLocationId: string;
  localFactionIds: Set<string>;
  allowNarrativeHydration: boolean;
  allowRenameFromGenericRoleLabel: boolean;
  fallbackSummary: string;
  fallbackDescription: string;
  fallbackFactionId: string | null;
  localNpcNames: string[];
  priorFactText: string;
}) {
  const proposedName = trimToNull(input.draft.name);
  const canRename = Boolean(
    input.allowRenameFromGenericRoleLabel
      && proposedName
      && !hasGenericNpcRoleLabelName({ name: proposedName, role: input.currentRole }),
  );
  const name = canRename ? proposedName : input.currentName;
  const proposedSummary = trimToNull(input.draft.summary) ?? input.fallbackSummary;
  const proposedDescription = trimToNull(input.draft.description) ?? input.fallbackDescription;
  const disallowedNamedLocals = disallowedNamedLocalMentionsInHydration({
    summary: proposedSummary,
    description: proposedDescription,
    localNpcNames: input.localNpcNames,
    priorFactText: input.priorFactText,
  });
  const hydrationDriftedFromPriorGrounding = disallowedNamedLocals.length > 0;
  const summary = input.allowNarrativeHydration
    ? (hydrationDriftedFromPriorGrounding ? input.fallbackSummary : proposedSummary)
    : input.fallbackSummary;
  const description = input.allowNarrativeHydration
    ? (hydrationDriftedFromPriorGrounding ? input.fallbackDescription : proposedDescription)
    : input.fallbackDescription;
  const factionId = input.allowNarrativeHydration
    ? (hydrationDriftedFromPriorGrounding
        ? input.fallbackFactionId
        : (
        input.draft.factionId && input.localFactionIds.has(input.draft.factionId)
          ? input.draft.factionId
          : null
      ))
    : input.fallbackFactionId;
  const information = input.allowNarrativeHydration
    ? (hydrationDriftedFromPriorGrounding ? [] : input.draft.information.slice(0, 2).flatMap((lead) => {
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
      }))
    : [];

  return {
    name,
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
  const needsNarrativeHydration = npc.socialLayer === "promoted_local" && !npc.isNarrativelyHydrated;
  const needsIdentityHydration = hasGenericNpcRoleLabelName({ name: npc.name, role: npc.role });

  if (!needsNarrativeHydration && !needsIdentityHydration) {
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
      allowRenameFromGenericRoleLabel: needsIdentityHydration,
    }),
    currentName: npc.name,
    currentRole: npc.role,
    currentLocationId: location.id,
    localFactionIds,
      allowNarrativeHydration: needsNarrativeHydration,
      allowRenameFromGenericRoleLabel: needsIdentityHydration,
      fallbackSummary: npc.summary,
      fallbackDescription: npc.description,
      fallbackFactionId: npc.factionId,
      localNpcNames: localNpcs
        .filter((localNpc) => localNpc.id !== npc.id)
        .map((localNpc) => localNpc.name),
      priorFactText: [
        npc.summary,
        npc.description,
        temporaryActor?.lastSummary ?? null,
        ...(temporaryActor?.recentTopics ?? []),
      ].filter((entry): entry is string => Boolean(entry && entry.trim())).join("\n"),
    });

  return {
    npcId: npc.id,
    hydratedResult: {
      ...npc,
      name: draft.name ?? npc.name,
      summary: draft.summary,
      description: draft.description,
      factionId: draft.factionId,
      isNarrativelyHydrated: npc.isNarrativelyHydrated || needsNarrativeHydration,
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
  preserveCurrentSummary: boolean;
}) {
  const npc = await input.tx.nPC.findFirst({
    where: {
      id: input.npcId,
      campaignId: input.snapshot.campaignId,
    },
    select: {
      id: true,
      name: true,
      role: true,
      summary: true,
      description: true,
      factionId: true,
      isNarrativelyHydrated: true,
      hydrationClaimRequestId: true,
      hydrationClaimExpiresAt: true,
    },
  });

  if (!npc) {
    return;
  }

  const proposedName = trimToNull(input.hydrationDraft.name);
  const canRename = Boolean(
    hasGenericNpcRoleLabelName({ name: npc.name, role: npc.role })
      && proposedName
      && !hasGenericNpcRoleLabelName({ name: proposedName, role: npc.role }),
  );

  if (npc.isNarrativelyHydrated && !canRename) {
    return;
  }

  if (canRename) {
    recordInverse(input.rollback, "nPC", npc.id, "name", npc.name);
  }

  if (!npc.isNarrativelyHydrated) {
    if (!input.preserveCurrentSummary) {
      recordInverse(input.rollback, "nPC", npc.id, "summary", npc.summary);
    }
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
  }

  const data: Prisma.NPCUncheckedUpdateManyInput = {};
  if (canRename) {
    data.name = proposedName!;
  }
  if (!npc.isNarrativelyHydrated) {
    if (!input.preserveCurrentSummary) {
      data.summary = input.hydrationDraft.summary;
    }
    data.description = input.hydrationDraft.description;
    data.factionId = input.hydrationDraft.factionId;
    data.isNarrativelyHydrated = true;
    data.hydrationClaimRequestId = null;
    data.hydrationClaimExpiresAt = null;
  }

  if (Object.keys(data).length === 0) {
    return;
  }

  const updated = await input.tx.nPC.updateMany({
    where: {
      id: npc.id,
      campaignId: input.snapshot.campaignId,
    },
    data,
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

type EvaluatedResolvedCommand = {
  stateCommitLog: StateCommitLog;
  appliedMutations: AppliedMutationRecord[];
  discoveredInformationIds: string[];
  spawnedTemporaryActorIds: Map<string, string>;
  spawnedItemTemplateIds: Map<string, string>;
  spawnedItemInstanceIds: Map<string, string[]>;
  spawnedWorldObjectIds: Map<string, string>;
  nextState: CampaignRuntimeState;
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

function compareTemporaryActorReusePriority(
  left: Pick<ProjectedTemporaryActor, "id" | "lastSeenAtTurn" | "lastSeenAtTime">,
  right: Pick<ProjectedTemporaryActor, "id" | "lastSeenAtTurn" | "lastSeenAtTime">,
) {
  if (left.lastSeenAtTurn !== right.lastSeenAtTurn) {
    return right.lastSeenAtTurn - left.lastSeenAtTurn;
  }
  if (left.lastSeenAtTime !== right.lastSeenAtTime) {
    return right.lastSeenAtTime - left.lastSeenAtTime;
  }
  return left.id.localeCompare(right.id);
}

function mutationPhaseForOrdering(mutation: MechanicsMutation): "immediate" | "conditional" {
  return mutationPhaseForEvaluation(mutation);
}

function orderedMutationsForProcessing(mutations: MechanicsMutation[]) {
  return ["immediate", "conditional"].flatMap((phase) =>
    mutations.filter((mutation) => mutationPhaseForOrdering(mutation) === phase),
  );
}

const CONFLICT_INTERACTION_OUTCOMES = new Set([
  "declines",
  "agrees_conditionally",
  "counteroffers",
  "withholds",
  "resists",
  "withdraws",
]);

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

function resolveInventoryItemIdForEvaluation(input: {
  itemId: string;
  spawnedItemTemplateIds: Map<string, string>;
  characterInventory: CampaignSnapshot["character"]["inventory"];
  projectedItemInstances: Map<string, ItemInstance>;
}) {
  if (!isSpawnHandle(input.itemId)) {
    return (
      input.characterInventory.find((item) => item.id === input.itemId)?.templateId
      ?? input.projectedItemInstances.get(input.itemId)?.templateId
      ?? input.itemId
    );
  }

  return input.spawnedItemTemplateIds.get(input.itemId.slice("spawn:".length)) ?? null;
}

function resolveInventoryTemplateIdForCommit(input: {
  templateId: string;
  spawnedItemTemplateIds: Map<string, string>;
}) {
  if (input.templateId.startsWith("spawned_item_template:")) {
    return input.spawnedItemTemplateIds.get(input.templateId.slice("spawned_item_template:".length)) ?? null;
  }
  if (isSpawnHandle(input.templateId)) {
    return input.spawnedItemTemplateIds.get(input.templateId.slice("spawn:".length)) ?? null;
  }
  return input.templateId.trim() || null;
}

function isEvaluatedSpawnedItemTemplateId(value: string | null | undefined, spawnKey: string) {
  return value === `spawned_item_template:${spawnKey}`;
}

function resolveWorldObjectId(input: {
  objectId: string;
  spawnedWorldObjectIds: Map<string, string>;
}) {
  if (!isSpawnHandle(input.objectId)) {
    return input.objectId.trim() || null;
  }

  return input.spawnedWorldObjectIds.get(input.objectId.slice("spawn:".length)) ?? null;
}

function resolveCommittedWorldObjectId(input: {
  objectId: string;
  spawnedWorldObjectIds: Map<string, string>;
}) {
  if (input.objectId.startsWith("spawned_world_object:")) {
    return input.spawnedWorldObjectIds.get(input.objectId.slice("spawned_world_object:".length)) ?? null;
  }
  if (isSpawnHandle(input.objectId)) {
    return input.spawnedWorldObjectIds.get(input.objectId.slice("spawn:".length)) ?? null;
  }
  return input.objectId.trim() || null;
}

function normalizeHolderRef(holder: AssetHolderRef): AssetHolderRef {
  if (holder.kind !== "scene") {
    return holder;
  }

  return {
    kind: "scene",
    locationId: holder.locationId,
    focusKey: holder.focusKey ?? null,
  };
}

function holderKey(holder: AssetHolderRef) {
  switch (holder.kind) {
    case "player":
      return "player";
    case "npc":
      return `npc:${holder.npcId}`;
    case "temporary_actor":
      return `temporary_actor:${holder.actorId}`;
    case "world_object":
      return `world_object:${holder.objectId}`;
    case "scene":
      return `scene:${holder.locationId}:${holder.focusKey ?? ""}`;
  }
}

function holderRefsEqual(left: AssetHolderRef, right: AssetHolderRef) {
  return holderKey(normalizeHolderRef(left)) === holderKey(normalizeHolderRef(right));
}

function holderRefForItem(input: {
  item: ItemInstance;
  playerInstanceId: string;
}): AssetHolderRef {
  if (input.item.characterInstanceId === input.playerInstanceId) {
    return { kind: "player" };
  }
  if (input.item.npcId) {
    return { kind: "npc", npcId: input.item.npcId };
  }
  if (input.item.temporaryActorId) {
    return { kind: "temporary_actor", actorId: input.item.temporaryActorId };
  }
  if (input.item.worldObjectId) {
    return { kind: "world_object", objectId: input.item.worldObjectId };
  }
  return {
    kind: "scene",
    locationId: input.item.sceneLocationId ?? "",
    focusKey: input.item.sceneFocusKey ?? null,
  };
}

function holderRefForCommodityStack(input: {
  stack: CharacterCommodityStack;
  playerInstanceId: string;
}): AssetHolderRef {
  if (input.stack.characterInstanceId === input.playerInstanceId) {
    return { kind: "player" };
  }
  if (input.stack.npcId) {
    return { kind: "npc", npcId: input.stack.npcId };
  }
  if (input.stack.temporaryActorId) {
    return { kind: "temporary_actor", actorId: input.stack.temporaryActorId };
  }
  if (input.stack.worldObjectId) {
    return { kind: "world_object", objectId: input.stack.worldObjectId };
  }
  return {
    kind: "scene",
    locationId: input.stack.sceneLocationId ?? "",
    focusKey: input.stack.sceneFocusKey ?? null,
  };
}

function holderRefForWorldObject(input: {
  object: WorldObjectSummary;
  playerInstanceId: string;
}): AssetHolderRef {
  if (input.object.characterInstanceId === input.playerInstanceId) {
    return { kind: "player" };
  }
  if (input.object.npcId) {
    return { kind: "npc", npcId: input.object.npcId };
  }
  if (input.object.temporaryActorId) {
    return { kind: "temporary_actor", actorId: input.object.temporaryActorId };
  }
  if (input.object.parentWorldObjectId) {
    return { kind: "world_object", objectId: input.object.parentWorldObjectId };
  }
  return {
    kind: "scene",
    locationId: input.object.sceneLocationId ?? "",
    focusKey: input.object.sceneFocusKey ?? null,
  };
}

function canUseSceneHolder(holder: AssetHolderRef, currentLocationId: string) {
  return holder.kind !== "scene" || holder.locationId === currentLocationId;
}

const INTERACTION_SUMMARY_PLAYER_RELOCATION_PATTERNS = [
  /\byou\s+(?:step|steps|stepped|walk|walks|walked|move|moves|moved|cross|crosses|crossed|head|heads|headed|go|goes|went|enter|enters|entered|exit|exits|exited|leave|leaves|left|return|returns|returned)\b/i,
  /\byou\s+(?:come|comes|came)\s+back\b/i,
];

const INTERACTION_SUMMARY_ACTOR_MOVEMENT_PATTERNS = [
  /\barrives?\b/i,
  /\bcomes?\s+back\b/i,
  /\breturns?\s+(?:to|from|with|into|toward|towards|by)\b/i,
  /\bleaves?\b/i,
  /\bdeparts?\b/i,
  /\benters?\b/i,
  /\bexits?\b/i,
  /\bemerges?\b/i,
  /\bapproaches?\b/i,
  /\bwalks?\s+(?:in|off|over|away|back)\b/i,
  /\bsteps?\s+(?:away|closer|forward|back|over)\b/i,
  /\bcomes?\s+over\b/i,
  /\bmoves?\s+(?:closer|away|back|into|toward|towards)\b/i,
];

const INTERACTION_SUMMARY_ACTOR_STAGING_PATTERNS = [
  /\bstands?\s+(?:quietly\s+|silently\s+|waiting\s+|still\s+)?(?:by|beside|near|at)\b/i,
  /\bwaits?\s+by\b/i,
  /\bhovers?\s+near\b/i,
  /\blingers?\s+by\b/i,
  /\btakes?\s+position\b/i,
  /\bsettles?\s+by\b/i,
];

const SOFT_SOCIAL_OUTCOMES = new Set([
  "acknowledges",
  "hesitates",
  "withholds",
  "asks_question",
  "redirects",
  "resists",
  "withdraws",
]);

function objectParentId(object: WorldObjectSummary) {
  return object.parentWorldObjectId ?? null;
}

function wouldCreateObjectCycle(input: {
  objects: Map<string, WorldObjectSummary>;
  movingObjectId: string;
  destinationObjectId: string;
}) {
  if (input.movingObjectId === input.destinationObjectId) {
    return true;
  }

  let currentId: string | null = input.destinationObjectId;
  while (currentId) {
    if (currentId === input.movingObjectId) {
      return true;
    }
    currentId = objectParentId(input.objects.get(currentId) ?? { parentWorldObjectId: null } as WorldObjectSummary);
  }

  return false;
}

function wouldExceedObjectNestingLimit(input: {
  objects: Map<string, WorldObjectSummary>;
  destinationObjectId: string;
}) {
  const destination = input.objects.get(input.destinationObjectId);
  return Boolean(destination?.parentWorldObjectId);
}

function normalizeActorRef(actorRef: string) {
  if (actorRef.startsWith("npc:") || actorRef.startsWith("temp:")) {
    return actorRef;
  }
  return actorRef.trim() || actorRef;
}

function interactionSummaryMatchesAnyPattern(summary: string, patterns: readonly RegExp[]) {
  return patterns.some((pattern) => pattern.test(summary));
}

function normalizeActorRefForMovementSupport(input: {
  actorRef: string;
  spawnedTemporaryActorIds: Map<string, string>;
}) {
  const resolvedActorId = resolveSpawnedTemporaryActorId({
    actorRef: input.actorRef,
    spawnedTemporaryActorIds: input.spawnedTemporaryActorIds,
  });

  if (resolvedActorId && !input.actorRef.startsWith("npc:")) {
    return tempActorRef(resolvedActorId);
  }

  return normalizeActorRef(input.actorRef);
}

function commandSupportsActorPresence(input: {
  mutations: MechanicsMutation[];
  actorRef: string;
  spawnedTemporaryActorIds: Map<string, string>;
}) {
  return input.mutations.some((candidate) =>
    candidate.type === "set_scene_actor_presence"
    && normalizeActorRefForMovementSupport({
      actorRef: candidate.actorRef,
      spawnedTemporaryActorIds: input.spawnedTemporaryActorIds,
    }) === input.actorRef);
}

function commandSupportsPlayerRelocation(mutations: MechanicsMutation[]) {
  return mutations.some((candidate) =>
    candidate.type === "set_player_scene_focus" || candidate.type === "move_player");
}

function resolveSpawnItemHolderForEvaluation(input: {
  holder: AssetHolderRef;
  spawnedWorldObjectIds: Map<string, string>;
  projectedWorldObjects: Map<string, WorldObjectSummary>;
  projectedTemporaryActors: Map<string, TemporaryActorSummary>;
  projectedNpcLocationIds: Map<string, string>;
  presentNpcs: CampaignSnapshot["presentNpcs"];
  projectedLocationId: string;
}) {
  const holder =
    input.holder.kind === "world_object"
      ? (() => {
          const objectId = resolveWorldObjectId({
            objectId: input.holder.objectId,
            spawnedWorldObjectIds: input.spawnedWorldObjectIds,
          });
          return objectId ? ({ kind: "world_object", objectId } as const) : null;
        })()
      : normalizeHolderRef(input.holder);

  const holderIsValid =
    holder != null
    && canUseSceneHolder(holder, input.projectedLocationId)
    && (
      holder.kind === "player"
      || holder.kind === "scene"
      || (holder.kind === "world_object" && input.projectedWorldObjects.has(holder.objectId))
      || (
        holder.kind === "temporary_actor"
        && input.projectedTemporaryActors.get(holder.actorId)?.currentLocationId === input.projectedLocationId
      )
      || (
        holder.kind === "npc"
        && (
          input.presentNpcs.some((npc) => npc.id === holder.npcId)
          || input.projectedNpcLocationIds.get(holder.npcId) === input.projectedLocationId
        )
      )
    );

  return holderIsValid ? holder : null;
}

function resolveSpawnItemHolderForCommit(input: {
  holder: AssetHolderRef;
  spawnedWorldObjectIds: Map<string, string>;
}) {
  return input.holder.kind === "world_object"
    ? (() => {
        const objectId = resolveCommittedWorldObjectId({
          objectId: input.holder.objectId,
          spawnedWorldObjectIds: input.spawnedWorldObjectIds,
        });
        return objectId ? ({ kind: "world_object", objectId } as const) : null;
      })()
    : normalizeHolderRef(input.holder);
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

function groundedInformationIdsForDiscovery(input: {
  snapshot: CampaignSnapshot;
  fetchedFacts: TurnFetchToolResult[];
  routerDecision: RouterDecision;
}) {
  const ids = knownInformationIds(input.snapshot, input.fetchedFacts);
  for (const referent of input.routerDecision.attention.resolvedReferents) {
    if (referent.targetKind === "information") {
      ids.add(referent.targetRef);
    }
  }
  return ids;
}

function actorSummaryForFocusEvaluation(input: {
  snapshot: CampaignSnapshot;
  projectedTemporaryActors: Map<string, ProjectedTemporaryActor>;
  actorRef: string;
}) {
  if (input.actorRef.startsWith("temp:")) {
    const actor = input.projectedTemporaryActors.get(input.actorRef.slice("temp:".length));
    if (!actor) {
      return null;
    }
    return {
      displayLabel: actor.label,
      role: actor.label,
      focusKey: null,
      lastSummary: actor.lastSummary,
    };
  }

  if (input.actorRef.startsWith("npc:")) {
    const npc = input.snapshot.presentNpcs.find((entry) => entry.id === input.actorRef.slice("npc:".length));
    if (!npc) {
      return null;
    }
    return {
      displayLabel: npc.name,
      role: npc.role,
      focusKey: null,
      lastSummary: npc.summary,
    };
  }

  return null;
}

function targetWasLeftBehindByFocusShift(input: {
  snapshot: CampaignSnapshot;
  projectedTemporaryActors: Map<string, ProjectedTemporaryActor>;
  projectedSceneFocus: CampaignRuntimeState["sceneFocus"];
  focusChangedThisTurn: boolean;
  currentFocusActorRefs: Set<string>;
  actorRef: string;
}) {
  if (!input.focusChangedThisTurn || !input.projectedSceneFocus) {
    return false;
  }
  if (input.currentFocusActorRefs.has(input.actorRef)) {
    return false;
  }

  const actor = actorSummaryForFocusEvaluation({
    snapshot: input.snapshot,
    projectedTemporaryActors: input.projectedTemporaryActors,
    actorRef: input.actorRef,
  });
  if (!actor) {
    return false;
  }

  return !sceneActorMatchesFocus({
    actor,
    sceneFocus: input.projectedSceneFocus,
  });
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

function allowsGroundedDowntimeMutation(
  decision: RouterDecision,
  timeMode: ResolveMechanicsResponse["timeMode"],
) {
  return hasAnyAuthorizedVector(decision) || timeMode === "downtime";
}

function isTraversableRoute(route: CampaignSnapshot["adjacentRoutes"][number]) {
  return route.currentStatus === "open";
}

function isArchivedInventoryProperties(value: Prisma.JsonValue | null) {
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
  if (mutation.type === "adjust_currency" && flattenCurrencyToCp(mutation.delta) < 0) {
    return "immediate";
  }
  if (mutation.type === "record_local_interaction") {
    return "immediate";
  }
  if (mutation.type === "record_npc_interaction") {
    return "immediate";
  }
  if (
    mutation.type === "spawn_scene_aspect"
    || mutation.type === "spawn_temporary_actor"
    || mutation.type === "spawn_environmental_item"
    || mutation.type === "spawn_fiat_item"
    || mutation.type === "set_player_scene_focus"
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

function clampIncidentalCurrencyDelta(deltaCp: number) {
  return deltaCp > 0 ? Math.min(deltaCp, INCIDENTAL_CURRENCY_CP_MAX) : deltaCp;
}

function evaluateResolvedCommand(input: {
  snapshot: CampaignSnapshot;
  command: ValidatedResolvedMechanicsCommand;
  fetchedFacts: TurnFetchToolResult[];
  routerDecision: RouterDecision;
  groundedItemIds?: string[];
  playerAction?: string;
}): EvaluatedResolvedCommand {
  const stateCommitLog: StateCommitLog = [];
  const appliedMutations: AppliedMutationRecord[] = [];
  const projectedCommodityQuantities = new Map(
    input.snapshot.character.commodityStacks.map((stack) => [stack.commodityId, stack.quantity]),
  );
  const projectedMarketStock = new Map<string, number>();
  const projectedRelationshipDelta = new Map<string, number>();
  const projectedInventoryQuantities = new Map<string, number>();
  for (const item of input.snapshot.character.inventory) {
    if (isArchivedInventoryProperties(item.properties as Prisma.JsonValue | null)) {
      continue;
    }
    projectedInventoryQuantities.set(
      item.templateId,
      (projectedInventoryQuantities.get(item.templateId) ?? 0) + 1,
    );
  }
  const projectedWorldObjects = new Map<string, WorldObjectSummary>(
    input.snapshot.worldObjects.map((object) => [
      object.id,
      {
        ...object,
        properties: object.properties ? structuredClone(object.properties) : null,
      },
    ]),
  );
  const projectedItemInstances = new Map<string, ItemInstance>(
    input.snapshot.assetItems.map((item) => [
      item.id,
      {
        ...item,
        properties: item.properties ? structuredClone(item.properties) : null,
      },
    ]),
  );
  const projectedCommodityStackEntries = new Map<string, CharacterCommodityStack>(
    input.snapshot.assetCommodityStacks.map((stack) => [
      stack.id,
      {
        ...stack,
      },
    ]),
  );
  const projectedItemHolders = new Map<string, AssetHolderRef>();
  for (const item of projectedItemInstances.values()) {
    if (isArchivedInventoryProperties(item.properties as Prisma.JsonValue | null)) {
      continue;
    }
    projectedItemHolders.set(
      item.id,
      holderRefForItem({
        item,
        playerInstanceId: input.snapshot.character.instanceId,
      }),
    );
  }
  const projectedCommodityByHolder = new Map<string, Map<string, number>>();
  for (const stack of projectedCommodityStackEntries.values()) {
    const key = holderKey(
      holderRefForCommodityStack({
        stack,
        playerInstanceId: input.snapshot.character.instanceId,
      }),
    );
    const holderQuantities = projectedCommodityByHolder.get(key) ?? new Map<string, number>();
    holderQuantities.set(stack.commodityId, stack.quantity);
    projectedCommodityByHolder.set(key, holderQuantities);
  }
  const projectedConditions = new Set(input.snapshot.state.characterState.conditions);
  const projectedFollowers = new Set(
    input.snapshot.state.characterState.activeCompanions.map((entry) => normalizeActorRef(entry)),
  );
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
    Object.entries(input.snapshot.knownNpcLocationIds),
  );
  const spawnedTemporaryActorIds = new Map<string, string>();
  const spawnedItemTemplateIds = new Map<string, string>();
  const spawnedItemInstanceIds = new Map<string, string[]>();
  const spawnedWorldObjectIds = new Map<string, string>();
  const discoveredInformationIds = new Set<string>();
  let projectedCurrencyCp = input.snapshot.character.currencyCp;
  let projectedLocationId = input.snapshot.state.currentLocationId;
  let projectedSceneFocus = input.snapshot.state.sceneFocus ?? null;
  let focusChangedThisTurn = false;
  let projectedHealth = input.snapshot.character.health;
  const projectedSceneAspects = structuredClone(input.snapshot.state.sceneAspects ?? {});
  const groundedItemIds = new Set(
    input.groundedItemIds
    ?? input.snapshot.character.inventory.map((item) => item.templateId),
  );
  const currentFocusActorRefs = new Set<string>();
  let hasAppliedMove = false;
  const groundedInformation = groundedInformationIdsForDiscovery({
    snapshot: input.snapshot,
    fetchedFacts: input.fetchedFacts,
    routerDecision: input.routerDecision,
  });
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
      projectedSceneFocus = null;
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

    if (mutation.type === "set_player_scene_focus") {
      const focusKey = normalizeWhitespace(mutation.focusKey);
      const label = normalizeWhitespace(mutation.label);
      if (!focusKey || !label) {
        stateCommitLog.push({
          kind: "mutation",
          mutationType: mutation.type,
          status: "rejected",
          reasonCode: "invalid_target",
          summary: "That scene focus is not grounded enough to apply.",
          metadata: { ...mutation, phase } as unknown as Record<string, unknown>,
        });
        continue;
      }
      if (projectedSceneFocus?.key === focusKey && projectedSceneFocus.label === label) {
        stateCommitLog.push({
          kind: "mutation",
          mutationType: mutation.type,
          status: "noop",
          reasonCode: "already_applied",
          summary: `You are already focused on ${label}.`,
          metadata: {
            focusKey,
            label,
          } as unknown as Record<string, unknown>,
        });
        continue;
      }
      projectedSceneFocus = { key: focusKey, label };
      focusChangedThisTurn = true;
      currentFocusActorRefs.clear();
      const appliedMutation = { ...mutation, focusKey, label, phase } as MechanicsMutation;
      const entry = {
        kind: "mutation" as const,
        mutationType: mutation.type,
        status: "applied" as const,
        reasonCode: "scene_focus_updated",
        summary: `You reposition to ${label}.`,
        metadata: {
          focusKey,
          label,
          phase,
        } as unknown as Record<string, unknown>,
      };
      stateCommitLog.push(entry);
      appliedMutations.push({ mutation: appliedMutation, entry });
      continue;
    }

    if (mutation.type === "adjust_currency") {
      const requestedDeltaCp = flattenCurrencyToCp(mutation.delta);
      const appliedDeltaCp = clampIncidentalCurrencyDelta(requestedDeltaCp);
      const appliedMutation = {
        ...mutation,
        delta: {
          cp: appliedDeltaCp,
        },
        phase,
      } as MechanicsMutation;
      const authorized =
        requestedDeltaCp < 0
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
          summary: "The requested currency change is not authorized for this turn.",
          metadata: {
            ...mutation,
            requestedDeltaCp,
            appliedDeltaCp,
            phase,
          } as unknown as Record<string, unknown>,
        });
        continue;
      }
      if (projectedCurrencyCp + appliedDeltaCp < 0) {
        stateCommitLog.push({
          kind: "mutation",
          mutationType: mutation.type,
          status: "rejected",
          reasonCode: "insufficient_currency",
          summary: "You do not have enough currency for that cost.",
          metadata: {
            ...mutation,
            requestedDeltaCp,
            appliedDeltaCp,
            phase,
          } as unknown as Record<string, unknown>,
        });
        continue;
      }
      projectedCurrencyCp += appliedDeltaCp;
      const entry = {
        kind: "mutation" as const,
        mutationType: mutation.type,
        status: "applied" as const,
        reasonCode: "currency_adjusted",
        summary:
          appliedDeltaCp >= 0
            ? `You gain ${formatCurrencyCompact(appliedDeltaCp)}.`
            : `You spend ${formatCurrencyCompact(Math.abs(appliedDeltaCp))}.`,
        metadata: {
          ...mutation,
          requestedDeltaCp,
          appliedDeltaCp,
          phase,
        },
      };
      stateCommitLog.push(entry);
      appliedMutations.push({ mutation: appliedMutation, entry });
      continue;
    }

    if (mutation.type === "spawn_scene_aspect") {
      if (!allowsGroundedDowntimeMutation(input.routerDecision, input.command.timeMode)) {
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
      const focusKey = projectedSceneFocus?.key ?? null;
      const existing = projectedSceneAspects[aspectKey] ?? null;

      if (
        existing
        && existing.label === label
        && existing.state === state
        && existing.duration === mutation.duration
        && (existing.focusKey ?? null) === focusKey
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
        focusKey,
      };

      const entry = {
        kind: "mutation" as const,
        mutationType: mutation.type,
        status: "applied" as const,
        reasonCode: existing ? "scene_aspect_updated" : "scene_aspect_spawned",
        summary: `${label} shifts to ${state}.`,
        metadata: {
          ...mutation,
          aspectKey,
          focusKey,
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

      const normalizedRole = normalizeWhitespace(mutation.role);
      const normalizedSummary = normalizeWhitespace(mutation.summary);
      const normalizedDisposition = normalizeWhitespace(mutation.apparentDisposition);
      const lastSummary = `${normalizedSummary} Apparent disposition: ${normalizedDisposition}.`;
      const matchingActor = [...projectedTemporaryActors.values()]
        .sort(compareTemporaryActorReusePriority)
        .find((actor) =>
          actor.promotedNpcId == null
          && (actor.currentLocationId === projectedLocationId || actor.currentLocationId === null)
          && sceneActorIdentityClearlyMatches({
            candidateRole: normalizedRole,
            existingRole: actor.label,
            candidateSummary: `${normalizedSummary} ${normalizedDisposition}`,
            existingSummary: actor.lastSummary,
          })
        );

      const resolvedActorId = matchingActor?.id ?? `tactor_${randomUUID()}`;
      const wasOffscene = matchingActor?.currentLocationId == null;
      if (matchingActor) {
        matchingActor.currentLocationId = projectedLocationId;
        matchingActor.lastSummary = lastSummary;
        matchingActor.lastSeenAtTurn = input.snapshot.sessionTurnCount + 1;
        matchingActor.lastSeenAtTime = input.snapshot.state.globalTime + input.command.timeElapsed;
      } else {
        projectedTemporaryActors.set(resolvedActorId, {
          id: resolvedActorId,
          label: normalizedRole,
          currentLocationId: projectedLocationId,
          interactionCount: 0,
          firstSeenAtTurn: input.snapshot.sessionTurnCount + 1,
          lastSeenAtTurn: input.snapshot.sessionTurnCount + 1,
          lastSeenAtTime: input.snapshot.state.globalTime + input.command.timeElapsed,
          recentTopics: [],
          lastSummary,
          holdsInventory: false,
          affectedWorldState: false,
          isInMemoryGraph: false,
          promotedNpcId: null,
        });
      }

      spawnedTemporaryActorIds.set(mutation.spawnKey, resolvedActorId);
      currentFocusActorRefs.add(tempActorRef(resolvedActorId));
      const entry = {
        kind: "mutation" as const,
        mutationType: mutation.type,
        status: "applied" as const,
        reasonCode: matchingActor ? "temporary_actor_reused" : "temporary_actor_spawned",
        summary: matchingActor
          ? wasOffscene
            ? `${matchingActor.label} arrives in the scene.`
            : `${matchingActor.label} is already part of the scene.`
          : `${normalizedRole} enters the scene.`,
        metadata: {
          ...mutation,
          actorRef: tempActorRef(resolvedActorId),
          reusedExisting: Boolean(matchingActor),
          wasOffscene,
          arrivesInCurrentScene: !matchingActor || wasOffscene,
          phase,
        } as unknown as Record<string, unknown>,
      };
      stateCommitLog.push(entry);
      appliedMutations.push({ mutation: { ...mutation, phase } as MechanicsMutation, entry });
      continue;
    }

    if (mutation.type === "spawn_world_object") {
      if (
        !hasVector(input.routerDecision, "investigate")
        && !hasVector(input.routerDecision, "economy_light")
      ) {
        stateCommitLog.push({
          kind: "mutation",
          mutationType: mutation.type,
          status: "rejected",
          reasonCode: "unauthorized_vector",
          summary: "Durable world objects are not authorized for this turn.",
          metadata: { ...mutation, phase } as unknown as Record<string, unknown>,
        });
        continue;
      }
      if (spawnedWorldObjectIds.has(mutation.spawnKey)) {
        stateCommitLog.push({
          kind: "mutation",
          mutationType: mutation.type,
          status: "rejected",
          reasonCode: "duplicate_spawn_key",
          summary: "That world-object spawn key was already used this turn.",
          metadata: { ...mutation, phase } as unknown as Record<string, unknown>,
        });
        continue;
      }

      let resolvedHolder: AssetHolderRef;
      if (mutation.holder.kind === "world_object") {
        const objectId = resolveWorldObjectId({
          objectId: mutation.holder.objectId,
          spawnedWorldObjectIds,
        });
        if (!objectId || !projectedWorldObjects.has(objectId)) {
          stateCommitLog.push({
            kind: "mutation",
            mutationType: mutation.type,
            status: "rejected",
            reasonCode: "invalid_target",
            summary: "That destination container is not available for world-object placement.",
            metadata: { ...mutation, phase } as unknown as Record<string, unknown>,
          });
          continue;
        }
        if (wouldExceedObjectNestingLimit({ objects: projectedWorldObjects, destinationObjectId: objectId })) {
          stateCommitLog.push({
            kind: "mutation",
            mutationType: mutation.type,
            status: "rejected",
            reasonCode: "invalid_target",
            summary: "World-object nesting is limited to one level.",
            metadata: { ...mutation, phase } as unknown as Record<string, unknown>,
          });
          continue;
        }
        resolvedHolder = { kind: "world_object", objectId };
      } else {
        resolvedHolder = normalizeHolderRef(mutation.holder);
      }

      if (!canUseSceneHolder(resolvedHolder, projectedLocationId)) {
        stateCommitLog.push({
          kind: "mutation",
          mutationType: mutation.type,
          status: "rejected",
          reasonCode: "invalid_target",
          summary: "Scene-ground placement must stay in the current location.",
          metadata: { ...mutation, phase } as unknown as Record<string, unknown>,
        });
        continue;
      }
      if (
        (resolvedHolder.kind === "npc" && projectedNpcLocationIds.get(resolvedHolder.npcId) !== projectedLocationId)
        || (
          resolvedHolder.kind === "temporary_actor"
          && projectedTemporaryActors.get(resolvedHolder.actorId)?.currentLocationId !== projectedLocationId
        )
      ) {
        stateCommitLog.push({
          kind: "mutation",
          mutationType: mutation.type,
          status: "rejected",
          reasonCode: "invalid_target",
          summary: "That holder is not available for world-object placement here.",
          metadata: { ...mutation, phase } as unknown as Record<string, unknown>,
        });
        continue;
      }

      const objectId = `wobj_${randomUUID()}`;
      const object: WorldObjectSummary = {
        id: objectId,
        name: normalizeWhitespace(mutation.name),
        characterInstanceId: resolvedHolder.kind === "player" ? input.snapshot.character.instanceId : null,
        npcId: resolvedHolder.kind === "npc" ? resolvedHolder.npcId : null,
        temporaryActorId: resolvedHolder.kind === "temporary_actor" ? resolvedHolder.actorId : null,
        parentWorldObjectId:
          resolvedHolder.kind === "world_object" ? resolvedHolder.objectId : null,
        sceneLocationId: resolvedHolder.kind === "scene" ? resolvedHolder.locationId : null,
        sceneFocusKey: resolvedHolder.kind === "scene" ? resolvedHolder.focusKey ?? null : null,
        storedCurrencyCp: 0,
        storageCapacity: mutation.storageCapacity ?? null,
        securityIsLocked: mutation.securityIsLocked ?? false,
        securityKeyItemTemplateId: mutation.securityKeyItemTemplateId ?? null,
        concealmentIsHidden: mutation.concealmentIsHidden ?? false,
        vehicleIsHitched: mutation.vehicleIsHitched ?? false,
        properties: null,
      };
      projectedWorldObjects.set(objectId, object);
      spawnedWorldObjectIds.set(mutation.spawnKey, objectId);
      const entry = {
        kind: "mutation" as const,
        mutationType: mutation.type,
        status: "applied" as const,
        reasonCode: "world_object_spawned",
        summary: `${object.name} becomes part of the world.`,
        metadata: {
          ...mutation,
          objectId,
          holder: resolvedHolder,
          phase,
        } as unknown as Record<string, unknown>,
      };
      stateCommitLog.push(entry);
      appliedMutations.push({
        mutation: {
          ...mutation,
          holder: resolvedHolder,
          phase,
        } as MechanicsMutation,
        entry,
      });
      continue;
    }

    if (mutation.type === "record_local_interaction") {
      if (isLikelySoloErrandAction(input.playerAction)) {
        stateCommitLog.push({
          kind: "mutation",
          mutationType: mutation.type,
          status: "rejected",
          reasonCode: "invalid_semantics",
          summary: "That action reads as a self-directed errand rather than an interaction with another person.",
          metadata: { ...mutation, phase } as unknown as Record<string, unknown>,
        });
        continue;
      }
      if (
        !hasVector(input.routerDecision, "converse")
        && !hasVector(input.routerDecision, "economy_light")
        && !hasVector(input.routerDecision, "investigate")
      ) {
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
      if (targetWasLeftBehindByFocusShift({
        snapshot: input.snapshot,
        projectedTemporaryActors,
        projectedSceneFocus,
        focusChangedThisTurn,
        currentFocusActorRefs,
        actorRef: tempActorRef(actor.id),
      })) {
        stateCommitLog.push({
          kind: "mutation",
          mutationType: mutation.type,
          status: "rejected",
          reasonCode: "invalid_semantics",
          summary: "That local was left behind when you changed focus; manifest or move someone into the new focus first.",
          metadata: { ...mutation, phase } as unknown as Record<string, unknown>,
        });
        continue;
      }
      const interactionSummary = mutation.interactionSummary.trim();
      const targetActorRef = tempActorRef(actor.id);
      const impliesPlayerRelocation = interactionSummaryMatchesAnyPattern(
        interactionSummary,
        INTERACTION_SUMMARY_PLAYER_RELOCATION_PATTERNS,
      );
      const impliesActorMovement = interactionSummaryMatchesAnyPattern(
        interactionSummary,
        INTERACTION_SUMMARY_ACTOR_MOVEMENT_PATTERNS,
      );
      const impliesActorStaging = interactionSummaryMatchesAnyPattern(
        interactionSummary,
        INTERACTION_SUMMARY_ACTOR_STAGING_PATTERNS,
      );
      const supportsPlayerRelocation = commandSupportsPlayerRelocation(input.command.mutations);
      const supportsActorPresence = commandSupportsActorPresence({
        mutations: input.command.mutations,
        actorRef: targetActorRef,
        spawnedTemporaryActorIds,
      });
      if (impliesPlayerRelocation && !supportsPlayerRelocation) {
        stateCommitLog.push({
          kind: "mutation",
          mutationType: mutation.type,
          status: "rejected",
          reasonCode: "invalid_semantics",
          summary: "That interaction summary implies player movement. Use set_player_scene_focus or move_player to progress the physical scene.",
          metadata: { ...mutation, phase } as unknown as Record<string, unknown>,
        });
        continue;
      }
      if (impliesActorMovement && !supportsActorPresence) {
        stateCommitLog.push({
          kind: "mutation",
          mutationType: mutation.type,
          status: "rejected",
          reasonCode: "invalid_semantics",
          summary: "That interaction summary implies physical movement or arrival. Use set_scene_actor_presence to progress the physical scene.",
          metadata: { ...mutation, phase } as unknown as Record<string, unknown>,
        });
        continue;
      }
      if (impliesActorStaging) {
        stateCommitLog.push({
          kind: "mutation",
          mutationType: mutation.type,
          status: "rejected",
          reasonCode: "invalid_semantics",
          summary: "That interaction summary implies new physical staging or blocking. Manifest physical progression with explicit scene mutations instead.",
          metadata: { ...mutation, phase } as unknown as Record<string, unknown>,
        });
        continue;
      }
      const topic = mutation.topic?.trim() || undefined;
      actor.interactionCount += 1;
      actor.lastSummary = interactionSummary;
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
          localEntityId: tempActorRef(actor.id),
          topic: topic ?? null,
          socialOutcome: mutation.socialOutcome,
          phase,
          interactionCount: actor.interactionCount,
        } as unknown as Record<string, unknown>,
      };
      stateCommitLog.push(entry);
      appliedMutations.push({
        mutation: {
          ...mutation,
          localEntityId: tempActorRef(actor.id),
          topic,
          phase,
        } as MechanicsMutation,
        entry,
      });
      continue;
    }

    if (mutation.type === "record_npc_interaction") {
      if (
        !hasVector(input.routerDecision, "converse")
        && !hasVector(input.routerDecision, "economy_light")
        && !hasVector(input.routerDecision, "investigate")
      ) {
        stateCommitLog.push({
          kind: "mutation",
          mutationType: mutation.type,
          status: "rejected",
          reasonCode: "unauthorized_vector",
          summary: "Named-NPC interaction is not authorized for this turn.",
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
          summary: "That NPC is not available here.",
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
          summary: "That NPC is no longer available here.",
          metadata: { ...mutation, phase } as unknown as Record<string, unknown>,
        });
        continue;
      }
      if (targetWasLeftBehindByFocusShift({
        snapshot: input.snapshot,
        projectedTemporaryActors,
        projectedSceneFocus,
        focusChangedThisTurn,
        currentFocusActorRefs,
        actorRef: npcActorRef(mutation.npcId),
      })) {
        stateCommitLog.push({
          kind: "mutation",
          mutationType: mutation.type,
          status: "rejected",
          reasonCode: "invalid_semantics",
          summary: "That NPC was left behind when you changed focus; you cannot keep talking to them here without bringing them into the new focus.",
          metadata: { ...mutation, phase } as unknown as Record<string, unknown>,
        });
        continue;
      }
      const topic = mutation.topic?.trim() || undefined;
      const summary = mutation.interactionSummary.trim();
      const targetActorRef = npcActorRef(mutation.npcId);
      const impliesPlayerRelocation = interactionSummaryMatchesAnyPattern(
        summary,
        INTERACTION_SUMMARY_PLAYER_RELOCATION_PATTERNS,
      );
      const impliesActorMovement = interactionSummaryMatchesAnyPattern(
        summary,
        INTERACTION_SUMMARY_ACTOR_MOVEMENT_PATTERNS,
      );
      const impliesActorStaging = interactionSummaryMatchesAnyPattern(
        summary,
        INTERACTION_SUMMARY_ACTOR_STAGING_PATTERNS,
      );
      const supportsPlayerRelocation = commandSupportsPlayerRelocation(input.command.mutations);
      const supportsActorPresence = commandSupportsActorPresence({
        mutations: input.command.mutations,
        actorRef: targetActorRef,
        spawnedTemporaryActorIds,
      });
      if (impliesPlayerRelocation && !supportsPlayerRelocation) {
        stateCommitLog.push({
          kind: "mutation",
          mutationType: mutation.type,
          status: "rejected",
          reasonCode: "invalid_semantics",
          summary: "That interaction summary implies player movement. Use set_player_scene_focus or move_player to progress the physical scene.",
          metadata: { ...mutation, phase } as unknown as Record<string, unknown>,
        });
        continue;
      }
      if (impliesActorMovement && !supportsActorPresence) {
        stateCommitLog.push({
          kind: "mutation",
          mutationType: mutation.type,
          status: "rejected",
          reasonCode: "invalid_semantics",
          summary: "That interaction summary implies physical movement or arrival. Use set_scene_actor_presence to progress the physical scene.",
          metadata: { ...mutation, phase } as unknown as Record<string, unknown>,
        });
        continue;
      }
      if (impliesActorStaging) {
        stateCommitLog.push({
          kind: "mutation",
          mutationType: mutation.type,
          status: "rejected",
          reasonCode: "invalid_semantics",
          summary: "That interaction summary implies new physical staging or blocking. Manifest physical progression with explicit scene mutations instead.",
          metadata: { ...mutation, phase } as unknown as Record<string, unknown>,
        });
        continue;
      }
      const entry = {
        kind: "mutation" as const,
        mutationType: mutation.type,
        status: "applied" as const,
        reasonCode: "npc_interaction_recorded",
        summary: summary || `You engage ${npc.name}.`,
        metadata: {
          npcId: mutation.npcId,
          topic: topic ?? null,
          socialOutcome: mutation.socialOutcome,
          phase,
        } as unknown as Record<string, unknown>,
      };
      stateCommitLog.push(entry);
      appliedMutations.push({
        mutation: {
          ...mutation,
          topic,
          phase,
        } as MechanicsMutation,
        entry,
      });
      continue;
    }

    if (mutation.type === "set_scene_actor_presence") {
      if (isLikelyProxyPlayerMovementAction(input.playerAction)) {
        stateCommitLog.push({
          kind: "mutation",
          mutationType: mutation.type,
          status: "rejected",
          reasonCode: "invalid_semantics",
          summary: "That presence change reads like player movement, not an actor independently leaving or returning.",
          metadata: { ...mutation, phase } as unknown as Record<string, unknown>,
        });
        continue;
      }
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
        if (mutation.newLocationId === projectedLocationId) {
          currentFocusActorRefs.add(tempActorRef(actor.id));
        } else {
          currentFocusActorRefs.delete(tempActorRef(actor.id));
        }
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
            arrivesInCurrentScene: mutation.newLocationId === projectedLocationId,
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
      if (mutation.newLocationId === projectedLocationId) {
        currentFocusActorRefs.add(npcActorRef(target.actorId));
      } else {
        currentFocusActorRefs.delete(npcActorRef(target.actorId));
      }
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
          arrivesInCurrentScene: mutation.newLocationId === projectedLocationId,
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
        if (projectedCurrencyCp < total) {
          stateCommitLog.push({
            kind: "mutation",
            mutationType: mutation.type,
            status: "rejected",
            reasonCode: "insufficient_currency",
            summary: "You do not have enough currency to complete that trade.",
            metadata: { ...mutation, phase } as unknown as Record<string, unknown>,
          });
          continue;
        }
        projectedCurrencyCp -= total;
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
        projectedCurrencyCp += total;
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
        summary: `${mutation.action === "buy" ? "Buy" : "Sell"} ${mutation.quantity} commodity units for ${formatCurrencyCompact(total)}.`,
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

    if (mutation.type === "transfer_assets") {
      const source =
        mutation.source.kind === "world_object"
          ? (() => {
              const objectId = resolveWorldObjectId({
                objectId: mutation.source.objectId,
                spawnedWorldObjectIds,
              });
              return objectId ? ({ kind: "world_object", objectId } as const) : null;
            })()
          : normalizeHolderRef(mutation.source);
      const destination =
        mutation.destination.kind === "world_object"
          ? (() => {
              const objectId = resolveWorldObjectId({
                objectId: mutation.destination.objectId,
                spawnedWorldObjectIds,
              });
              return objectId ? ({ kind: "world_object", objectId } as const) : null;
            })()
          : normalizeHolderRef(mutation.destination);

      if (!source || !destination) {
        stateCommitLog.push({
          kind: "mutation",
          mutationType: mutation.type,
          status: "rejected",
          reasonCode: "invalid_target",
          summary: "That custody transfer references an unknown holder.",
          metadata: { ...mutation, phase } as unknown as Record<string, unknown>,
        });
        continue;
      }

      const transferMode = mutation.npcTransferMode ?? "willing";
      const sourceIsActor = source.kind === "npc" || source.kind === "temporary_actor";
      const destinationIsActor = destination.kind === "npc" || destination.kind === "temporary_actor";
      const authorized =
        sourceIsActor
          ? transferMode === "willing"
            ? hasVector(input.routerDecision, "converse")
            : transferMode === "stealth"
              ? hasVector(input.routerDecision, "investigate")
              : hasVector(input.routerDecision, "violence")
          : destinationIsActor
            ? hasVector(input.routerDecision, "converse")
            : hasVector(input.routerDecision, "economy_light");
      if (!authorized) {
        stateCommitLog.push({
          kind: "mutation",
          mutationType: mutation.type,
          status: "rejected",
          reasonCode: "unauthorized_vector",
          summary: "That custody transfer is not authorized for this turn.",
          metadata: {
            ...mutation,
            source,
            destination,
            transferMode,
            phase,
          } as unknown as Record<string, unknown>,
        });
        continue;
      }
      if (!canUseSceneHolder(source, projectedLocationId) || !canUseSceneHolder(destination, projectedLocationId)) {
        stateCommitLog.push({
          kind: "mutation",
          mutationType: mutation.type,
          status: "rejected",
          reasonCode: "invalid_target",
          summary: "Scene-ground transfers must stay in the current location.",
          metadata: { ...mutation, source, destination, phase } as unknown as Record<string, unknown>,
        });
        continue;
      }
      if (holderRefsEqual(source, destination)) {
        stateCommitLog.push({
          kind: "mutation",
          mutationType: mutation.type,
          status: "noop",
          reasonCode: "already_applied",
          summary: "Those assets are already in that custody location.",
          metadata: { ...mutation, source, destination, phase } as unknown as Record<string, unknown>,
        });
        continue;
      }

      const sourceObject = source.kind === "world_object" ? projectedWorldObjects.get(source.objectId) ?? null : null;
      const destinationObject =
        destination.kind === "world_object" ? projectedWorldObjects.get(destination.objectId) ?? null : null;
      const sourceTemporaryActor =
        source.kind === "temporary_actor" ? projectedTemporaryActors.get(source.actorId) ?? null : null;
      const destinationTemporaryActor =
        destination.kind === "temporary_actor" ? projectedTemporaryActors.get(destination.actorId) ?? null : null;
      if ((source.kind === "world_object" && !sourceObject) || (destination.kind === "world_object" && !destinationObject)) {
        stateCommitLog.push({
          kind: "mutation",
          mutationType: mutation.type,
          status: "rejected",
          reasonCode: "invalid_target",
          summary: "That world object is not available for transfer.",
          metadata: { ...mutation, source, destination, phase } as unknown as Record<string, unknown>,
        });
        continue;
      }
      if (
        (source.kind === "temporary_actor" && (!sourceTemporaryActor || sourceTemporaryActor.currentLocationId !== projectedLocationId))
        || (
          destination.kind === "temporary_actor"
          && (!destinationTemporaryActor || destinationTemporaryActor.currentLocationId !== projectedLocationId)
        )
      ) {
        stateCommitLog.push({
          kind: "mutation",
          mutationType: mutation.type,
          status: "rejected",
          reasonCode: "invalid_target",
          summary: "That temporary actor is not available for transfer here.",
          metadata: { ...mutation, source, destination, phase } as unknown as Record<string, unknown>,
        });
        continue;
      }
      if (sourceObject?.securityIsLocked || destinationObject?.securityIsLocked) {
        stateCommitLog.push({
          kind: "mutation",
          mutationType: mutation.type,
          status: "rejected",
          reasonCode: "invalid_target",
          summary: "Locked storage cannot be moved into or out of until it is unlocked.",
          metadata: { ...mutation, source, destination, phase } as unknown as Record<string, unknown>,
        });
        continue;
      }

      let transferRejected = false;
      const requestedWorldObjectIds = Array.from(new Set(mutation.worldObjectIds ?? []));
      const resolvedWorldObjectIds: string[] = [];
      for (const requestedObjectId of requestedWorldObjectIds) {
        const resolvedObjectId = resolveWorldObjectId({
          objectId: requestedObjectId,
          spawnedWorldObjectIds,
        });
        const object = resolvedObjectId ? projectedWorldObjects.get(resolvedObjectId) ?? null : null;
        if (!object || !holderRefsEqual(
          holderRefForWorldObject({
            object,
            playerInstanceId: input.snapshot.character.instanceId,
          }),
          source,
        )) {
          stateCommitLog.push({
            kind: "mutation",
            mutationType: mutation.type,
            status: "rejected",
            reasonCode: "invalid_target",
            summary: "A requested world object is not currently in the source holder.",
            metadata: { ...mutation, source, destination, phase } as unknown as Record<string, unknown>,
          });
          transferRejected = true;
          break;
        }
        if (!resolvedObjectId) {
          transferRejected = true;
          break;
        }
        if (destination.kind === "world_object") {
          if (wouldCreateObjectCycle({
            objects: projectedWorldObjects,
            movingObjectId: resolvedObjectId,
            destinationObjectId: destination.objectId,
          }) || wouldExceedObjectNestingLimit({
            objects: projectedWorldObjects,
            destinationObjectId: destination.objectId,
          })) {
            stateCommitLog.push({
              kind: "mutation",
              mutationType: mutation.type,
              status: "rejected",
              reasonCode: "invalid_target",
              summary: "That world-object move would create an invalid storage chain.",
              metadata: { ...mutation, source, destination, phase } as unknown as Record<string, unknown>,
            });
            transferRejected = true;
            break;
          }
        }
        resolvedWorldObjectIds.push(resolvedObjectId);
      }

      if (transferRejected || resolvedWorldObjectIds.length !== requestedWorldObjectIds.length) {
        continue;
      }

      const movedItemIds = new Set<string>();
      for (const itemId of mutation.itemInstanceIds ?? []) {
        const item = projectedItemInstances.get(itemId);
        const currentHolder = item ? projectedItemHolders.get(item.id) ?? null : null;
        if (!item || !currentHolder || !holderRefsEqual(currentHolder, source)) {
          stateCommitLog.push({
            kind: "mutation",
            mutationType: mutation.type,
            status: "rejected",
            reasonCode: "invalid_target",
            summary: "A requested item instance is not currently in the source holder.",
            metadata: { ...mutation, source, destination, phase } as unknown as Record<string, unknown>,
          });
          transferRejected = true;
          break;
        }
        movedItemIds.add(itemId);
      }
      if (transferRejected || movedItemIds.size !== (mutation.itemInstanceIds ?? []).length) {
        continue;
      }

      const resolvedTemplateTransfers: Array<{ templateId: string; quantity: number }> = [];
      for (const templateTransfer of mutation.templateTransfers ?? []) {
        const resolvedTemplateId = resolveInventoryItemIdForEvaluation({
          itemId: templateTransfer.templateId,
          spawnedItemTemplateIds,
          characterInventory: input.snapshot.character.inventory,
          projectedItemInstances,
        });
        if (!resolvedTemplateId) {
          stateCommitLog.push({
            kind: "mutation",
            mutationType: mutation.type,
            status: "rejected",
            reasonCode: "invalid_target",
            summary: "A requested item template is not grounded in the current turn context.",
            metadata: { ...mutation, source, destination, phase } as unknown as Record<string, unknown>,
          });
          transferRejected = true;
          break;
        }
        const matchingItems = Array.from(projectedItemInstances.values())
          .filter((item) => item.templateId === resolvedTemplateId)
          .filter((item) => {
            const currentHolder = projectedItemHolders.get(item.id);
            return currentHolder && holderRefsEqual(currentHolder, source) && !movedItemIds.has(item.id);
          })
          .slice(0, templateTransfer.quantity);
        if (matchingItems.length !== templateTransfer.quantity) {
          stateCommitLog.push({
            kind: "mutation",
            mutationType: mutation.type,
            status: "rejected",
            reasonCode: "insufficient_inventory",
            summary: "The source holder does not have enough of the requested item template.",
            metadata: { ...mutation, source, destination, phase } as unknown as Record<string, unknown>,
          });
          transferRejected = true;
          break;
        }
        for (const item of matchingItems) {
          movedItemIds.add(item.id);
        }
        resolvedTemplateTransfers.push({
          templateId: resolvedTemplateId,
          quantity: templateTransfer.quantity,
        });
      }
      if (transferRejected) {
        continue;
      }

      const sourceCommodityKey = holderKey(source);
      const destinationCommodityKey = holderKey(destination);
      for (const transfer of mutation.commodityTransfers ?? []) {
        const sourceQuantity =
          projectedCommodityByHolder.get(sourceCommodityKey)?.get(transfer.commodityId) ?? 0;
        if (sourceQuantity < transfer.quantity) {
          stateCommitLog.push({
            kind: "mutation",
            mutationType: mutation.type,
            status: "rejected",
            reasonCode: "insufficient_inventory",
            summary: "The source holder does not have enough of that commodity.",
            metadata: { ...mutation, source, destination, phase } as unknown as Record<string, unknown>,
          });
          transferRejected = true;
          break;
        }
      }
      if (transferRejected) {
        continue;
      }

      const transferCurrencyCp = mutation.currencyAmount ? flattenCurrencyToCp(mutation.currencyAmount) : 0;

      if (transferCurrencyCp > 0) {
        const playerToOrFromObject =
          (source.kind === "player" && destination.kind === "world_object")
          || (source.kind === "world_object" && destination.kind === "player");
        if (!playerToOrFromObject) {
          stateCommitLog.push({
            kind: "mutation",
            mutationType: mutation.type,
            status: "rejected",
            reasonCode: "invalid_target",
            summary: "Currency transfers currently require the player and a world object.",
            metadata: { ...mutation, source, destination, phase } as unknown as Record<string, unknown>,
          });
          continue;
        }
        const sourceCurrencyCp =
          source.kind === "player"
            ? projectedCurrencyCp
            : projectedWorldObjects.get(source.objectId)?.storedCurrencyCp ?? 0;
        if (sourceCurrencyCp < transferCurrencyCp) {
          stateCommitLog.push({
            kind: "mutation",
            mutationType: mutation.type,
            status: "rejected",
            reasonCode: "insufficient_currency",
            summary: "The source holder does not have enough currency.",
            metadata: { ...mutation, source, destination, phase } as unknown as Record<string, unknown>,
          });
          continue;
        }
      }

      for (const worldObjectId of resolvedWorldObjectIds) {
        const object = projectedWorldObjects.get(worldObjectId);
        if (!object) {
          continue;
        }
        object.characterInstanceId = destination.kind === "player" ? input.snapshot.character.instanceId : null;
        object.npcId = destination.kind === "npc" ? destination.npcId : null;
        object.temporaryActorId = destination.kind === "temporary_actor" ? destination.actorId : null;
        object.parentWorldObjectId = destination.kind === "world_object" ? destination.objectId : null;
        object.sceneLocationId = destination.kind === "scene" ? destination.locationId : null;
        object.sceneFocusKey = destination.kind === "scene" ? destination.focusKey ?? null : null;
      }

      for (const itemId of movedItemIds) {
        const item = projectedItemInstances.get(itemId);
        if (!item) {
          continue;
        }
        const previousHolder = projectedItemHolders.get(item.id);
        if (previousHolder?.kind === "player") {
          projectedInventoryQuantities.set(
            item.templateId,
            Math.max(0, (projectedInventoryQuantities.get(item.templateId) ?? 0) - 1),
          );
        }
        if (destination.kind === "player") {
          projectedInventoryQuantities.set(
            item.templateId,
            (projectedInventoryQuantities.get(item.templateId) ?? 0) + 1,
          );
        }
        projectedItemHolders.set(item.id, destination);
      }

      for (const transfer of mutation.commodityTransfers ?? []) {
        const sourceHolderQuantities = projectedCommodityByHolder.get(sourceCommodityKey) ?? new Map<string, number>();
        sourceHolderQuantities.set(
          transfer.commodityId,
          (sourceHolderQuantities.get(transfer.commodityId) ?? 0) - transfer.quantity,
        );
        projectedCommodityByHolder.set(sourceCommodityKey, sourceHolderQuantities);
        const destinationHolderQuantities =
          projectedCommodityByHolder.get(destinationCommodityKey) ?? new Map<string, number>();
        destinationHolderQuantities.set(
          transfer.commodityId,
          (destinationHolderQuantities.get(transfer.commodityId) ?? 0) + transfer.quantity,
        );
        projectedCommodityByHolder.set(destinationCommodityKey, destinationHolderQuantities);
        if (source.kind === "player" || destination.kind === "player") {
          projectedCommodityQuantities.set(
            transfer.commodityId,
            projectedCommodityByHolder.get("player")?.get(transfer.commodityId) ?? 0,
          );
        }
      }

      if (transferCurrencyCp > 0) {
        if (source.kind === "player") {
          projectedCurrencyCp -= transferCurrencyCp;
        } else if (source.kind === "world_object") {
          const object = projectedWorldObjects.get(source.objectId);
          if (object) {
            object.storedCurrencyCp -= transferCurrencyCp;
          }
        }
        if (destination.kind === "player") {
          projectedCurrencyCp += transferCurrencyCp;
        } else if (destination.kind === "world_object") {
          const object = projectedWorldObjects.get(destination.objectId);
          if (object) {
            object.storedCurrencyCp += transferCurrencyCp;
          }
        }
      }
      if (destination.kind === "temporary_actor") {
        const actor = projectedTemporaryActors.get(destination.actorId);
        if (actor) {
          actor.holdsInventory = true;
        }
      }

      const entry = {
        kind: "mutation" as const,
        mutationType: mutation.type,
        status: "applied" as const,
        reasonCode: "assets_transferred",
        summary: "Assets change custody.",
        metadata: {
          ...mutation,
          source,
          destination,
          itemInstanceIds: Array.from(movedItemIds),
          templateTransfers: resolvedTemplateTransfers,
          worldObjectIds: resolvedWorldObjectIds,
          phase,
        } as unknown as Record<string, unknown>,
      };
      stateCommitLog.push(entry);
      appliedMutations.push({
        mutation: {
          ...mutation,
          source,
          destination,
          itemInstanceIds: Array.from(movedItemIds),
          templateTransfers: resolvedTemplateTransfers,
          worldObjectIds: resolvedWorldObjectIds,
          npcTransferMode: sourceIsActor ? transferMode : mutation.npcTransferMode,
          phase,
        } as MechanicsMutation,
        entry,
      });
      continue;
    }

    if (mutation.type === "spawn_environmental_item") {
      if (!allowsGroundedDowntimeMutation(input.routerDecision, input.command.timeMode)) {
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

      const holder = resolveSpawnItemHolderForEvaluation({
        holder: mutation.holder,
        spawnedWorldObjectIds,
        projectedWorldObjects,
        projectedTemporaryActors,
        projectedNpcLocationIds,
        presentNpcs: input.snapshot.presentNpcs,
        projectedLocationId,
      });
      if (!holder) {
        stateCommitLog.push({
          kind: "mutation",
          mutationType: mutation.type,
          status: "rejected",
          reasonCode: "invalid_target",
          summary: "That environmental item spawn references an invalid holder.",
          metadata: { ...mutation, phase } as unknown as Record<string, unknown>,
        });
        continue;
      }

      const resolvedTemplateId = `spawned_item_template:${mutation.spawnKey}`;
      const spawnedInstanceIds = Array.from({ length: mutation.quantity }, () => `iteminst_${randomUUID()}`);
      spawnedItemTemplateIds.set(mutation.spawnKey, resolvedTemplateId);
      spawnedItemInstanceIds.set(mutation.spawnKey, [...spawnedInstanceIds]);
      if (holder.kind === "player") {
        groundedItemIds.add(resolvedTemplateId);
        projectedInventoryQuantities.set(
          resolvedTemplateId,
          (projectedInventoryQuantities.get(resolvedTemplateId) ?? 0) + mutation.quantity,
        );
      } else if (holder.kind === "temporary_actor") {
        const actor = projectedTemporaryActors.get(holder.actorId);
        if (actor) {
          actor.holdsInventory = true;
        }
      }
      for (const instanceId of spawnedInstanceIds) {
        const projectedItem: ItemInstance = {
          id: instanceId,
          characterInstanceId: holder.kind === "player" ? input.snapshot.character.instanceId : null,
          npcId: holder.kind === "npc" ? holder.npcId : null,
          temporaryActorId: holder.kind === "temporary_actor" ? holder.actorId : null,
          worldObjectId: holder.kind === "world_object" ? holder.objectId : null,
          sceneLocationId: holder.kind === "scene" ? holder.locationId : null,
          sceneFocusKey: holder.kind === "scene" ? holder.focusKey ?? null : null,
          templateId: resolvedTemplateId,
          template: {
            id: resolvedTemplateId,
            campaignId: input.snapshot.campaignId,
            name: normalizeItemName(mutation.itemName),
            description: normalizedDescription(mutation.description),
            value: 0,
            weight: 0,
            rarity: "improvised",
            tags: ["spawned", "environmental", "ephemeral"],
          },
          isIdentified: true,
          charges: null,
          properties: null,
        };
        projectedItemInstances.set(instanceId, projectedItem);
        projectedItemHolders.set(instanceId, holder);
      }
      const entry = {
        kind: "mutation" as const,
        mutationType: mutation.type,
        status: "applied" as const,
        reasonCode: "environmental_item_spawned",
        summary:
          holder.kind === "player"
            ? `You secure ${mutation.quantity} ${normalizeWhitespace(mutation.itemName)}.`
            : `${normalizeWhitespace(mutation.itemName)} becomes part of the scene.`,
        metadata: {
          ...mutation,
          holder,
          itemId: resolvedTemplateId,
          itemInstanceIds: spawnedInstanceIds,
          phase,
        } as unknown as Record<string, unknown>,
      };
      stateCommitLog.push(entry);
      appliedMutations.push({ mutation: { ...mutation, phase } as MechanicsMutation, entry });
      continue;
    }

    if (mutation.type === "spawn_fiat_item") {
      if (!allowsGroundedDowntimeMutation(input.routerDecision, input.command.timeMode)) {
        stateCommitLog.push({
          kind: "mutation",
          mutationType: mutation.type,
          status: "rejected",
          reasonCode: "unauthorized_vector",
          summary: "Fiat item spawning is not authorized for this turn.",
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

      const holder = resolveSpawnItemHolderForEvaluation({
        holder: mutation.holder,
        spawnedWorldObjectIds,
        projectedWorldObjects,
        projectedTemporaryActors,
        projectedNpcLocationIds,
        presentNpcs: input.snapshot.presentNpcs,
        projectedLocationId,
      });
      if (!holder) {
        stateCommitLog.push({
          kind: "mutation",
          mutationType: mutation.type,
          status: "rejected",
          reasonCode: "invalid_target",
          summary: "That fiat item spawn references an invalid holder.",
          metadata: { ...mutation, phase } as unknown as Record<string, unknown>,
        });
        continue;
      }

      const resolvedTemplateId = `spawned_item_template:${mutation.spawnKey}`;
      const spawnedInstanceIds = Array.from({ length: mutation.quantity }, () => `iteminst_${randomUUID()}`);
      spawnedItemTemplateIds.set(mutation.spawnKey, resolvedTemplateId);
      spawnedItemInstanceIds.set(mutation.spawnKey, [...spawnedInstanceIds]);
      if (holder.kind === "player") {
        groundedItemIds.add(resolvedTemplateId);
        projectedInventoryQuantities.set(
          resolvedTemplateId,
          (projectedInventoryQuantities.get(resolvedTemplateId) ?? 0) + mutation.quantity,
        );
      } else if (holder.kind === "temporary_actor") {
        const actor = projectedTemporaryActors.get(holder.actorId);
        if (actor) {
          actor.holdsInventory = true;
        }
      }
      for (const instanceId of spawnedInstanceIds) {
        const projectedItem: ItemInstance = {
          id: instanceId,
          characterInstanceId: holder.kind === "player" ? input.snapshot.character.instanceId : null,
          npcId: holder.kind === "npc" ? holder.npcId : null,
          temporaryActorId: holder.kind === "temporary_actor" ? holder.actorId : null,
          worldObjectId: holder.kind === "world_object" ? holder.objectId : null,
          sceneLocationId: holder.kind === "scene" ? holder.locationId : null,
          sceneFocusKey: holder.kind === "scene" ? holder.focusKey ?? null : null,
          templateId: resolvedTemplateId,
          template: {
            id: resolvedTemplateId,
            campaignId: input.snapshot.campaignId,
            name: normalizeItemName(mutation.itemName),
            description: normalizedDescription(mutation.description),
            value: 0,
            weight: 0,
            rarity: "improvised",
            tags: ["spawned", "fiat", "ephemeral"],
          },
          isIdentified: true,
          charges: null,
          properties: null,
        };
        projectedItemInstances.set(instanceId, projectedItem);
        projectedItemHolders.set(instanceId, holder);
      }
      const entry = {
        kind: "mutation" as const,
        mutationType: mutation.type,
        status: "applied" as const,
        reasonCode: "fiat_item_spawned",
        summary:
          holder.kind === "player"
            ? `You secure ${mutation.quantity} ${normalizeWhitespace(mutation.itemName)}.`
            : `${normalizeWhitespace(mutation.itemName)} enters the deal.`,
        metadata: {
          ...mutation,
          holder,
          itemId: resolvedTemplateId,
          itemInstanceIds: spawnedInstanceIds,
          phase,
        } as unknown as Record<string, unknown>,
      };
      stateCommitLog.push(entry);
      appliedMutations.push({
        mutation: { ...mutation, holder, phase } as MechanicsMutation,
        entry,
      });
      continue;
    }

    if (mutation.type === "adjust_inventory") {
      if (!allowsGroundedDowntimeMutation(input.routerDecision, input.command.timeMode)) {
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

      const resolvedItemId = resolveInventoryItemIdForEvaluation({
        itemId: mutation.itemId,
        spawnedItemTemplateIds,
        characterInventory: input.snapshot.character.inventory,
        projectedItemInstances,
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
      if (targetWasLeftBehindByFocusShift({
        snapshot: input.snapshot,
        projectedTemporaryActors,
        projectedSceneFocus,
        focusChangedThisTurn,
        currentFocusActorRefs,
        actorRef: npcActorRef(mutation.npcId),
      })) {
        stateCommitLog.push({
          kind: "mutation",
          mutationType: mutation.type,
          status: "rejected",
          reasonCode: "invalid_semantics",
          summary: "That person was left behind when you changed focus; move them or re-encounter them in the new focus first.",
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

    if (mutation.type === "update_world_object_state") {
      if (
        !hasVector(input.routerDecision, "investigate")
        && !hasVector(input.routerDecision, "economy_light")
      ) {
        stateCommitLog.push({
          kind: "mutation",
          mutationType: mutation.type,
          status: "rejected",
          reasonCode: "unauthorized_vector",
          summary: "World-object state changes are not authorized for this turn.",
          metadata: { ...mutation, phase } as unknown as Record<string, unknown>,
        });
        continue;
      }
      const objectId = resolveWorldObjectId({
        objectId: mutation.objectId,
        spawnedWorldObjectIds,
      });
      const object = objectId ? projectedWorldObjects.get(objectId) ?? null : null;
      if (!object) {
        stateCommitLog.push({
          kind: "mutation",
          mutationType: mutation.type,
          status: "rejected",
          reasonCode: "invalid_target",
          summary: "That world object is not available here.",
          metadata: { ...mutation, phase } as unknown as Record<string, unknown>,
        });
        continue;
      }

      const nextLocked = mutation.isLocked ?? object.securityIsLocked;
      const nextHidden = mutation.isHidden ?? object.concealmentIsHidden;
      const nextHitched = mutation.isHitched ?? object.vehicleIsHitched;
      if (
        nextLocked === object.securityIsLocked
        && nextHidden === object.concealmentIsHidden
        && nextHitched === object.vehicleIsHitched
      ) {
        stateCommitLog.push({
          kind: "mutation",
          mutationType: mutation.type,
          status: "noop",
          reasonCode: "already_applied",
          summary: `${object.name} is already in that state.`,
          metadata: { ...mutation, objectId, phase } as unknown as Record<string, unknown>,
        });
        continue;
      }

      object.securityIsLocked = nextLocked;
      object.concealmentIsHidden = nextHidden;
      object.vehicleIsHitched = nextHitched;
      const entry = {
        kind: "mutation" as const,
        mutationType: mutation.type,
        status: "applied" as const,
        reasonCode: "world_object_state_updated",
        summary: `${object.name} changes state.`,
        metadata: { ...mutation, objectId, phase } as unknown as Record<string, unknown>,
      };
      stateCommitLog.push(entry);
      appliedMutations.push({
        mutation: { ...mutation, objectId, phase } as MechanicsMutation,
        entry,
      });
      continue;
    }

    if (mutation.type === "update_item_state") {
      if (!hasVector(input.routerDecision, "economy_light")) {
        stateCommitLog.push({
          kind: "mutation",
          mutationType: mutation.type,
          status: "rejected",
          reasonCode: "unauthorized_vector",
          summary: "Item-state changes are not authorized for this turn.",
          metadata: { ...mutation, phase } as unknown as Record<string, unknown>,
        });
        continue;
      }
      const item = projectedItemInstances.get(mutation.instanceId) ?? null;
      if (!item) {
        stateCommitLog.push({
          kind: "mutation",
          mutationType: mutation.type,
          status: "rejected",
          reasonCode: "invalid_target",
          summary: "That item instance is not available.",
          metadata: { ...mutation, phase } as unknown as Record<string, unknown>,
        });
        continue;
      }
      const currentHolder = projectedItemHolders.get(item.id) ?? null;
      if (mutation.isEquipped != null && currentHolder?.kind !== "player") {
        stateCommitLog.push({
          kind: "mutation",
          mutationType: mutation.type,
          status: "rejected",
          reasonCode: "invalid_target",
          summary: "Only carried items can be equipped or unequipped.",
          metadata: { ...mutation, phase } as unknown as Record<string, unknown>,
        });
        continue;
      }

      const currentProperties =
        item.properties && typeof item.properties === "object" && !Array.isArray(item.properties)
          ? structuredClone(item.properties)
          : {};
      if (mutation.isEquipped != null) {
        currentProperties.equipped = mutation.isEquipped;
      }
      if (mutation.propertiesPatch) {
        for (const [key, value] of Object.entries(mutation.propertiesPatch)) {
          currentProperties[key] = value;
        }
      }
      const nextCharges =
        mutation.chargesDelta != null
          ? Math.max(0, (item.charges ?? 0) + mutation.chargesDelta)
          : item.charges;
      const changed =
        mutation.isEquipped != null
        || mutation.chargesDelta != null
        || Object.keys(mutation.propertiesPatch ?? {}).length > 0;
      if (!changed) {
        stateCommitLog.push({
          kind: "mutation",
          mutationType: mutation.type,
          status: "noop",
          reasonCode: "already_applied",
          summary: "That item already reflects the requested state.",
          metadata: { ...mutation, phase } as unknown as Record<string, unknown>,
        });
        continue;
      }

      item.properties = currentProperties;
      item.charges = nextCharges ?? null;
      const entry = {
        kind: "mutation" as const,
        mutationType: mutation.type,
        status: "applied" as const,
        reasonCode: "item_state_updated",
        summary: `${item.template.name} changes state.`,
        metadata: { ...mutation, phase } as unknown as Record<string, unknown>,
      };
      stateCommitLog.push(entry);
      appliedMutations.push({ mutation: { ...mutation, phase } as MechanicsMutation, entry });
      continue;
    }

    if (mutation.type === "update_character_state") {
      if (!hasVector(input.routerDecision, "economy_light")) {
        stateCommitLog.push({
          kind: "mutation",
          mutationType: mutation.type,
          status: "rejected",
          reasonCode: "unauthorized_vector",
          summary: "Character-state changes are not authorized for this turn.",
          metadata: { ...mutation, phase } as unknown as Record<string, unknown>,
        });
        continue;
      }
      for (const condition of mutation.conditionsRemoved ?? []) {
        projectedConditions.delete(condition);
      }
      for (const condition of mutation.conditionsAdded ?? []) {
        const normalized = normalizeWhitespace(condition);
        if (normalized) {
          projectedConditions.add(normalized);
        }
      }
      const entry = {
        kind: "mutation" as const,
        mutationType: mutation.type,
        status: "applied" as const,
        reasonCode: "character_state_updated",
        summary: "Your tracked conditions update.",
        metadata: { ...mutation, phase } as unknown as Record<string, unknown>,
      };
      stateCommitLog.push(entry);
      appliedMutations.push({ mutation: { ...mutation, phase } as MechanicsMutation, entry });
      continue;
    }

    if (mutation.type === "set_follow_state") {
      if (!hasVector(input.routerDecision, "converse")) {
        stateCommitLog.push({
          kind: "mutation",
          mutationType: mutation.type,
          status: "rejected",
          reasonCode: "unauthorized_vector",
          summary: "Follower-state changes are not authorized for this turn.",
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
          summary: "That follower target is not available.",
          metadata: { ...mutation, phase } as unknown as Record<string, unknown>,
        });
        continue;
      }
      const canonicalActorRef =
        target.kind === "npc" ? npcActorRef(target.actorId) : tempActorRef(target.actorId);
      if (mutation.isFollowing) {
        projectedFollowers.add(canonicalActorRef);
      } else {
        projectedFollowers.delete(canonicalActorRef);
      }
      const entry = {
        kind: "mutation" as const,
        mutationType: mutation.type,
        status: "applied" as const,
        reasonCode: "follow_state_updated",
        summary: mutation.isFollowing
          ? "A companion agrees to follow you."
          : "A companion stops following you.",
        metadata: {
          ...mutation,
          actorRef: canonicalActorRef,
          phase,
        } as unknown as Record<string, unknown>,
      };
      stateCommitLog.push(entry);
      appliedMutations.push({
        mutation: {
          ...mutation,
          actorRef: canonicalActorRef,
          phase,
        } as MechanicsMutation,
        entry,
      });
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
      const focusKey = existing?.focusKey ?? projectedSceneFocus?.key ?? null;
      if (existing && existing.label === label && existing.state === state && (existing.focusKey ?? null) === focusKey) {
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
        focusKey,
      };
      const entry = {
        kind: "mutation" as const,
        mutationType: mutation.type,
        status: "applied" as const,
        reasonCode: existing ? "scene_aspect_updated" : "scene_aspect_spawned",
        summary: `${label} changes to ${state}.`,
        metadata: {
          ...mutation,
          aspectKey,
          focusKey,
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
      if (routerSuggestsManifestationOverKnowledge(input.routerDecision)) {
        stateCommitLog.push({
          kind: "mutation",
          mutationType: mutation.type,
          status: "rejected",
          reasonCode: "invalid_semantics",
          summary: "The router marked this as a local manifestation turn, so use a manifested scene detail or nearby presence instead of discover_information.",
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
      if (!groundedInformation.has(mutation.informationId)) {
        stateCommitLog.push({
          kind: "mutation",
          mutationType: mutation.type,
          status: "rejected",
          reasonCode: "invalid_target",
          summary: "discover_information requires an information id already grounded in fetched facts or resolved clues.",
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
      if (targetWasLeftBehindByFocusShift({
        snapshot: input.snapshot,
        projectedTemporaryActors,
        projectedSceneFocus,
        focusChangedThisTurn,
        currentFocusActorRefs,
        actorRef: npcActorRef(mutation.npcId),
      })) {
        stateCommitLog.push({
          kind: "mutation",
          mutationType: mutation.type,
          status: "rejected",
          reasonCode: "invalid_semantics",
          summary: "That target was left behind when you changed focus; you cannot affect them here without bringing them into the new focus.",
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
    spawnedTemporaryActorIds,
    spawnedItemTemplateIds,
    spawnedItemInstanceIds,
    spawnedWorldObjectIds,
    nextState: {
      ...input.snapshot.state,
      currentLocationId: projectedLocationId,
      globalTime: input.snapshot.state.globalTime + input.command.timeElapsed,
      pendingTurnId: null,
      lastActionSummary:
        input.command.memorySummary
        ?? stateCommitLog.find((entry) => entry.status !== "noop")?.summary
        ?? "The situation changes.",
      sceneFocus: projectedSceneFocus,
      sceneAspects: projectedSceneAspects,
      characterState: {
        conditions: Array.from(projectedConditions),
        activeCompanions: Array.from(projectedFollowers),
      },
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

  recordInverse(input.rollback, "characterInstance", characterInstance.id, "currencyCp", characterInstance.currencyCp);

  if (input.mutation.action === "buy") {
    await input.tx.characterInstance.update({
      where: { id: characterInstance.id },
      data: {
        currencyCp: {
          decrement: total,
        },
      },
    });
  } else {
    await input.tx.characterInstance.update({
      where: { id: characterInstance.id },
      data: {
        currencyCp: {
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
    orderBy: [{ lastSeenAtTurn: "desc" }, { lastSeenAtTime: "desc" }, { id: "asc" }],
    take: 50,
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

async function findReusableFiatItemTemplate(input: {
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
        hasEvery: ["spawned", "fiat", "ephemeral"],
      },
    },
    select: { id: true },
  });
}

function itemHolderData(holder: AssetHolderRef, characterInstanceId: string) {
  switch (holder.kind) {
    case "player":
      return {
        characterInstanceId,
        npcId: null,
        temporaryActorId: null,
        worldObjectId: null,
        sceneLocationId: null,
        sceneFocusKey: null,
      } satisfies Prisma.ItemInstanceUncheckedUpdateInput;
    case "npc":
      return {
        characterInstanceId: null,
        npcId: holder.npcId,
        temporaryActorId: null,
        worldObjectId: null,
        sceneLocationId: null,
        sceneFocusKey: null,
      } satisfies Prisma.ItemInstanceUncheckedUpdateInput;
    case "temporary_actor":
      return {
        characterInstanceId: null,
        npcId: null,
        temporaryActorId: holder.actorId,
        worldObjectId: null,
        sceneLocationId: null,
        sceneFocusKey: null,
      } satisfies Prisma.ItemInstanceUncheckedUpdateInput;
    case "world_object":
      return {
        characterInstanceId: null,
        npcId: null,
        temporaryActorId: null,
        worldObjectId: holder.objectId,
        sceneLocationId: null,
        sceneFocusKey: null,
      } satisfies Prisma.ItemInstanceUncheckedUpdateInput;
    case "scene":
      return {
        characterInstanceId: null,
        npcId: null,
        temporaryActorId: null,
        worldObjectId: null,
        sceneLocationId: holder.locationId,
        sceneFocusKey: holder.focusKey ?? null,
      } satisfies Prisma.ItemInstanceUncheckedUpdateInput;
  }
}

function commodityHolderData(holder: AssetHolderRef, characterInstanceId: string) {
  switch (holder.kind) {
    case "player":
      return {
        characterInstanceId,
        npcId: null,
        temporaryActorId: null,
        worldObjectId: null,
        sceneLocationId: null,
        sceneFocusKey: null,
      } satisfies Prisma.CharacterCommodityStackUncheckedUpdateInput;
    case "npc":
      return {
        characterInstanceId: null,
        npcId: holder.npcId,
        temporaryActorId: null,
        worldObjectId: null,
        sceneLocationId: null,
        sceneFocusKey: null,
      } satisfies Prisma.CharacterCommodityStackUncheckedUpdateInput;
    case "temporary_actor":
      return {
        characterInstanceId: null,
        npcId: null,
        temporaryActorId: holder.actorId,
        worldObjectId: null,
        sceneLocationId: null,
        sceneFocusKey: null,
      } satisfies Prisma.CharacterCommodityStackUncheckedUpdateInput;
    case "world_object":
      return {
        characterInstanceId: null,
        npcId: null,
        temporaryActorId: null,
        worldObjectId: holder.objectId,
        sceneLocationId: null,
        sceneFocusKey: null,
      } satisfies Prisma.CharacterCommodityStackUncheckedUpdateInput;
    case "scene":
      return {
        characterInstanceId: null,
        npcId: null,
        temporaryActorId: null,
        worldObjectId: null,
        sceneLocationId: holder.locationId,
        sceneFocusKey: holder.focusKey ?? null,
      } satisfies Prisma.CharacterCommodityStackUncheckedUpdateInput;
  }
}

function worldObjectHolderData(holder: AssetHolderRef, characterInstanceId: string) {
  switch (holder.kind) {
    case "player":
      return {
        characterInstanceId,
        npcId: null,
        temporaryActorId: null,
        parentWorldObjectId: null,
        sceneLocationId: null,
        sceneFocusKey: null,
      } satisfies Prisma.WorldObjectUncheckedUpdateInput;
    case "npc":
      return {
        characterInstanceId: null,
        npcId: holder.npcId,
        temporaryActorId: null,
        parentWorldObjectId: null,
        sceneLocationId: null,
        sceneFocusKey: null,
      } satisfies Prisma.WorldObjectUncheckedUpdateInput;
    case "temporary_actor":
      return {
        characterInstanceId: null,
        npcId: null,
        temporaryActorId: holder.actorId,
        parentWorldObjectId: null,
        sceneLocationId: null,
        sceneFocusKey: null,
      } satisfies Prisma.WorldObjectUncheckedUpdateInput;
    case "world_object":
      return {
        characterInstanceId: null,
        npcId: null,
        temporaryActorId: null,
        parentWorldObjectId: holder.objectId,
        sceneLocationId: null,
        sceneFocusKey: null,
      } satisfies Prisma.WorldObjectUncheckedUpdateInput;
    case "scene":
      return {
        characterInstanceId: null,
        npcId: null,
        temporaryActorId: null,
        parentWorldObjectId: null,
        sceneLocationId: holder.locationId,
        sceneFocusKey: holder.focusKey ?? null,
      } satisfies Prisma.WorldObjectUncheckedUpdateInput;
  }
}

function itemHolderWhere(holder: AssetHolderRef, characterInstanceId: string): Prisma.ItemInstanceWhereInput {
  switch (holder.kind) {
    case "player":
      return { characterInstanceId };
    case "npc":
      return { npcId: holder.npcId };
    case "temporary_actor":
      return { temporaryActorId: holder.actorId };
    case "world_object":
      return { worldObjectId: holder.objectId };
    case "scene":
      return { sceneLocationId: holder.locationId, sceneFocusKey: holder.focusKey ?? null };
  }
}

function commodityHolderWhere(
  holder: AssetHolderRef,
  characterInstanceId: string,
): Prisma.CharacterCommodityStackWhereInput {
  switch (holder.kind) {
    case "player":
      return { characterInstanceId };
    case "npc":
      return { npcId: holder.npcId };
    case "temporary_actor":
      return { temporaryActorId: holder.actorId };
    case "world_object":
      return { worldObjectId: holder.objectId };
    case "scene":
      return { sceneLocationId: holder.locationId, sceneFocusKey: holder.focusKey ?? null };
  }
}

function worldObjectHolderWhere(
  holder: AssetHolderRef,
  characterInstanceId: string,
): Prisma.WorldObjectWhereInput {
  switch (holder.kind) {
    case "player":
      return { characterInstanceId };
    case "npc":
      return { npcId: holder.npcId };
    case "temporary_actor":
      return { temporaryActorId: holder.actorId };
    case "world_object":
      return { parentWorldObjectId: holder.objectId };
    case "scene":
      return { sceneLocationId: holder.locationId, sceneFocusKey: holder.focusKey ?? null };
  }
}

async function findCommodityStackByHolder(input: {
  tx: Prisma.TransactionClient;
  commodityId: string;
  holder: AssetHolderRef;
  characterInstanceId: string;
}) {
  return input.tx.characterCommodityStack.findFirst({
    where: {
      commodityId: input.commodityId,
      ...commodityHolderWhere(input.holder, input.characterInstanceId),
    },
    orderBy: { createdAt: "asc" },
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
  spawnedTemporaryActorIds: Map<string, string>;
  spawnedItemTemplateIds: Map<string, string>;
  spawnedItemInstanceIds: Map<string, string[]>;
  spawnedWorldObjectIds: Map<string, string>;
}) {
  const affectedFactionIds = new Set<string>();
  const discoveredInformationIds: string[] = [];
  const stateCommitLog: StateCommitLog = [];
  const spawnedTemporaryActorIds = new Map(input.spawnedTemporaryActorIds);
  const spawnedItemTemplateIds = new Map(input.spawnedItemTemplateIds);
  const spawnedItemInstanceIds = new Map(input.spawnedItemInstanceIds);
  const spawnedWorldObjectIds = new Map(input.spawnedWorldObjectIds);
  let currentLocationId = input.snapshot.state.currentLocationId;
  const characterInstance = await input.tx.characterInstance.findUnique({
    where: { campaignId: input.snapshot.campaignId },
    select: { id: true, currencyCp: true, health: true },
  });
  if (!characterInstance) {
    throw new Error("Character instance not found.");
  }

  for (const { mutation, entry } of input.appliedMutations) {
    if (mutation.type === "move_player") {
      currentLocationId = mutation.targetLocationId;
      continue;
    }

    if (
      mutation.type === "spawn_scene_aspect"
      || mutation.type === "update_scene_object"
      || mutation.type === "set_player_scene_focus"
    ) {
      continue;
    }

    if (mutation.type === "spawn_world_object") {
      const objectId = spawnedWorldObjectIds.get(mutation.spawnKey);
      if (!objectId) {
        throw new Error("World-object spawn is missing its evaluated canonical id.");
      }
      const holder =
        mutation.holder.kind === "world_object"
          ? (() => {
              const resolvedObjectId = resolveCommittedWorldObjectId({
                objectId: mutation.holder.objectId,
                spawnedWorldObjectIds,
              });
              if (!resolvedObjectId) {
                throw new Error("World-object spawn referenced an unresolved parent object.");
              }
              return { kind: "world_object", objectId: resolvedObjectId } as const;
            })()
          : mutation.holder;
      await input.tx.worldObject.create({
        data: {
          id: objectId,
          campaignId: input.snapshot.campaignId,
          name: normalizeWhitespace(mutation.name),
          storedCurrencyCp: 0,
          storageCapacity: mutation.storageCapacity ?? null,
          securityIsLocked: mutation.securityIsLocked ?? false,
          securityKeyItemTemplateId: mutation.securityKeyItemTemplateId ?? null,
          concealmentIsHidden: mutation.concealmentIsHidden ?? false,
          vehicleIsHitched: mutation.vehicleIsHitched ?? false,
          propertiesJson: Prisma.JsonNull,
          ...worldObjectHolderData(holder, characterInstance.id),
        },
      });
      recordCreated(input.rollback, "worldObject", objectId);
      input.rollback.createdWorldObjectIds.push(objectId);
      if (holder.kind === "temporary_actor") {
        const actor = await input.tx.temporaryActor.findUnique({
          where: { id: holder.actorId },
          select: { id: true, holdsInventory: true },
        });
        if (actor && !actor.holdsInventory) {
          recordInverse(input.rollback, "temporaryActor", actor.id, "holdsInventory", actor.holdsInventory);
          await input.tx.temporaryActor.update({
            where: { id: actor.id },
            data: { holdsInventory: true },
          });
        }
      }
      continue;
    }

    if (mutation.type === "update_world_object_state") {
      const objectId = resolveCommittedWorldObjectId({
        objectId: mutation.objectId,
        spawnedWorldObjectIds,
      });
      if (!objectId) {
        throw new Error("World-object state update referenced an unresolved object.");
      }
      const object = await input.tx.worldObject.findUnique({
        where: { id: objectId },
        select: {
          id: true,
          securityIsLocked: true,
          concealmentIsHidden: true,
          vehicleIsHitched: true,
          propertiesJson: true,
        },
      });
      if (!object) {
        continue;
      }
      if (mutation.isLocked != null && mutation.isLocked !== object.securityIsLocked) {
        recordInverse(input.rollback, "worldObject", object.id, "securityIsLocked", object.securityIsLocked);
      }
      if (mutation.isHidden != null && mutation.isHidden !== object.concealmentIsHidden) {
        recordInverse(
          input.rollback,
          "worldObject",
          object.id,
          "concealmentIsHidden",
          object.concealmentIsHidden,
        );
      }
      if (mutation.isHitched != null && mutation.isHitched !== object.vehicleIsHitched) {
        recordInverse(input.rollback, "worldObject", object.id, "vehicleIsHitched", object.vehicleIsHitched);
      }
      await input.tx.worldObject.update({
        where: { id: object.id },
        data: {
          ...(mutation.isLocked != null ? { securityIsLocked: mutation.isLocked } : {}),
          ...(mutation.isHidden != null ? { concealmentIsHidden: mutation.isHidden } : {}),
          ...(mutation.isHitched != null ? { vehicleIsHitched: mutation.isHitched } : {}),
        },
      });
      continue;
    }

    if (mutation.type === "update_item_state") {
      const item = await input.tx.itemInstance.findUnique({
        where: { id: mutation.instanceId },
        select: { id: true, charges: true, properties: true },
      });
      if (!item) {
        continue;
      }
      const currentProperties =
        item.properties && typeof item.properties === "object" && !Array.isArray(item.properties)
          ? structuredClone(item.properties)
          : {};
      const nextProperties = structuredClone(currentProperties) as Record<string, unknown>;
      if (mutation.isEquipped != null) {
        nextProperties.equipped = mutation.isEquipped;
      }
      if (mutation.propertiesPatch) {
        for (const [key, value] of Object.entries(mutation.propertiesPatch)) {
          nextProperties[key] = value;
        }
      }
      const nextCharges =
        mutation.chargesDelta != null
          ? Math.max(0, (item.charges ?? 0) + mutation.chargesDelta)
          : item.charges;
      if (JSON.stringify(nextProperties) !== JSON.stringify(currentProperties)) {
        recordInverse(input.rollback, "itemInstance", item.id, "properties", item.properties);
      }
      if (nextCharges !== item.charges) {
        recordInverse(input.rollback, "itemInstance", item.id, "charges", item.charges);
      }
      await input.tx.itemInstance.update({
        where: { id: item.id },
        data: {
          properties: nextProperties as Prisma.InputJsonValue,
          charges: nextCharges,
        },
      });
      continue;
    }

    if (mutation.type === "update_character_state" || mutation.type === "set_follow_state") {
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

    if (mutation.type === "adjust_currency") {
      const deltaCp = flattenCurrencyToCp(mutation.delta);
      const characterInstance = await input.tx.characterInstance.findUnique({
        where: { campaignId: input.snapshot.campaignId },
        select: { id: true, currencyCp: true },
      });
      if (!characterInstance) {
        throw new Error("Character instance not found.");
      }
      recordInverse(input.rollback, "characterInstance", characterInstance.id, "currencyCp", characterInstance.currencyCp);
      await input.tx.characterInstance.update({
        where: { id: characterInstance.id },
        data: {
          currencyCp: {
            increment: deltaCp,
          },
        },
      });
      continue;
    }

    if (mutation.type === "spawn_temporary_actor") {
      const actorId = spawnedTemporaryActorIds.get(mutation.spawnKey);
      if (!actorId) {
        throw new Error("Temporary-actor spawn is missing its evaluated canonical id.");
      }
      const lastSummary = `${normalizeWhitespace(mutation.summary)} Apparent disposition: ${normalizeWhitespace(mutation.apparentDisposition)}.`;
      const existingActor = input.snapshot.temporaryActors.find((actor) => actor.id === actorId) ?? null;

      if (existingActor) {
        const reusableActor = await input.tx.temporaryActor.findUnique({
          where: { id: actorId },
          select: {
            id: true,
            currentLocationId: true,
            lastSummary: true,
            lastSeenAtTurn: true,
            lastSeenAtTime: true,
          },
        });
        if (!reusableActor) {
          throw new Error("Evaluated temporary-actor reuse target no longer exists.");
        }
        const updateData: Prisma.TemporaryActorUncheckedUpdateInput = {};
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
        continue;
      }

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
            tags: [],
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

    if (mutation.type === "record_npc_interaction") {
      const npc = await input.tx.nPC.findFirst({
        where: {
          id: mutation.npcId,
          campaignId: input.snapshot.campaignId,
        },
        select: {
          id: true,
          name: true,
          role: true,
          summary: true,
          socialLayer: true,
          currentLocationId: true,
        },
      });
      if (!npc) {
        continue;
      }

      if (npc.socialLayer === "promoted_local" || hasGenericNpcRoleLabelName({ name: npc.name, role: npc.role })) {
        const nextSummary = mutation.interactionSummary.trim() || npc.summary;
        if (nextSummary && nextSummary !== npc.summary) {
          recordInverse(input.rollback, "nPC", npc.id, "summary", npc.summary);
          await input.tx.nPC.update({
            where: { id: npc.id },
            data: {
              summary: nextSummary,
            },
          });
        }
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

    if (mutation.type === "transfer_assets") {
      const source =
        mutation.source.kind === "world_object"
          ? (() => {
              const objectId = resolveCommittedWorldObjectId({
                objectId: mutation.source.objectId,
                spawnedWorldObjectIds,
              });
              if (!objectId) {
                throw new Error("Asset transfer referenced an unresolved source world object.");
              }
              return { kind: "world_object", objectId } as const;
            })()
          : mutation.source;
      const destination =
        mutation.destination.kind === "world_object"
          ? (() => {
              const objectId = resolveCommittedWorldObjectId({
                objectId: mutation.destination.objectId,
                spawnedWorldObjectIds,
              });
              if (!objectId) {
                throw new Error("Asset transfer referenced an unresolved destination world object.");
              }
              return { kind: "world_object", objectId } as const;
            })()
          : mutation.destination;

      const transferCurrencyCp = mutation.currencyAmount ? flattenCurrencyToCp(mutation.currencyAmount) : 0;

      if (transferCurrencyCp > 0) {
        if (source.kind === "player") {
          recordInverse(input.rollback, "characterInstance", characterInstance.id, "currencyCp", characterInstance.currencyCp);
          await input.tx.characterInstance.update({
            where: { id: characterInstance.id },
            data: {
              currencyCp: {
                decrement: transferCurrencyCp,
              },
            },
          });
          characterInstance.currencyCp -= transferCurrencyCp;
        } else if (source.kind === "world_object") {
          const sourceObject = await input.tx.worldObject.findUnique({
            where: { id: source.objectId },
            select: { id: true, storedCurrencyCp: true },
          });
          if (!sourceObject) {
            throw new Error("Currency transfer source world object not found.");
          }
          recordInverse(input.rollback, "worldObject", sourceObject.id, "storedCurrencyCp", sourceObject.storedCurrencyCp);
          await input.tx.worldObject.update({
            where: { id: sourceObject.id },
            data: {
              storedCurrencyCp: {
                decrement: transferCurrencyCp,
              },
            },
          });
        }

        if (destination.kind === "player") {
          if (!input.rollback.simulationInverses.some((entry) =>
            entry.table === "characterInstance" && entry.id === characterInstance.id && entry.field === "currencyCp")) {
            recordInverse(input.rollback, "characterInstance", characterInstance.id, "currencyCp", characterInstance.currencyCp);
          }
          await input.tx.characterInstance.update({
            where: { id: characterInstance.id },
            data: {
              currencyCp: {
                increment: transferCurrencyCp,
              },
            },
          });
          characterInstance.currencyCp += transferCurrencyCp;
        } else if (destination.kind === "world_object") {
          const destinationObject = await input.tx.worldObject.findUnique({
            where: { id: destination.objectId },
            select: { id: true, storedCurrencyCp: true },
          });
          if (!destinationObject) {
            throw new Error("Currency transfer destination world object not found.");
          }
          recordInverse(
            input.rollback,
            "worldObject",
            destinationObject.id,
            "storedCurrencyCp",
            destinationObject.storedCurrencyCp,
          );
          await input.tx.worldObject.update({
            where: { id: destinationObject.id },
            data: {
              storedCurrencyCp: {
                increment: transferCurrencyCp,
              },
            },
          });
        }
      }

      for (const itemId of mutation.itemInstanceIds ?? []) {
        const item = await input.tx.itemInstance.findUnique({
          where: { id: itemId },
          select: {
            id: true,
            characterInstanceId: true,
            npcId: true,
            temporaryActorId: true,
            worldObjectId: true,
            sceneLocationId: true,
            sceneFocusKey: true,
          },
        });
        if (!item) {
          throw new Error("Asset transfer item instance not found.");
        }
        recordInverse(input.rollback, "itemInstance", item.id, "characterInstanceId", item.characterInstanceId);
        recordInverse(input.rollback, "itemInstance", item.id, "npcId", item.npcId);
        recordInverse(input.rollback, "itemInstance", item.id, "temporaryActorId", item.temporaryActorId);
        recordInverse(input.rollback, "itemInstance", item.id, "worldObjectId", item.worldObjectId);
        recordInverse(input.rollback, "itemInstance", item.id, "sceneLocationId", item.sceneLocationId);
        recordInverse(input.rollback, "itemInstance", item.id, "sceneFocusKey", item.sceneFocusKey);
        await input.tx.itemInstance.update({
          where: { id: item.id },
          data: itemHolderData(destination, characterInstance.id),
        });
      }

      for (const templateTransfer of mutation.templateTransfers ?? []) {
        const resolvedTemplateId = resolveInventoryTemplateIdForCommit({
          templateId: templateTransfer.templateId,
          spawnedItemTemplateIds,
        });
        if (!resolvedTemplateId) {
          throw new Error("Asset transfer template id could not be resolved during commit.");
        }
        const templateItems = await input.tx.itemInstance.findMany({
          where: {
            templateId: resolvedTemplateId,
            ...itemHolderWhere(source, characterInstance.id),
          },
          orderBy: { createdAt: "asc" },
          take: templateTransfer.quantity,
        });
        if (templateItems.length !== templateTransfer.quantity) {
          throw new Error("Asset transfer template selection underflowed during commit.");
        }
        for (const item of templateItems) {
          recordInverse(input.rollback, "itemInstance", item.id, "characterInstanceId", item.characterInstanceId);
          recordInverse(input.rollback, "itemInstance", item.id, "npcId", item.npcId);
          recordInverse(input.rollback, "itemInstance", item.id, "temporaryActorId", item.temporaryActorId);
          recordInverse(input.rollback, "itemInstance", item.id, "worldObjectId", item.worldObjectId);
          recordInverse(input.rollback, "itemInstance", item.id, "sceneLocationId", item.sceneLocationId);
          recordInverse(input.rollback, "itemInstance", item.id, "sceneFocusKey", item.sceneFocusKey);
          await input.tx.itemInstance.update({
            where: { id: item.id },
            data: itemHolderData(destination, characterInstance.id),
          });
        }
      }

      for (const worldObjectId of mutation.worldObjectIds ?? []) {
        const resolvedWorldObjectId = resolveCommittedWorldObjectId({
          objectId: worldObjectId,
          spawnedWorldObjectIds,
        });
        if (!resolvedWorldObjectId) {
          throw new Error("Asset transfer world object not found.");
        }
        const object = await input.tx.worldObject.findUnique({
          where: { id: resolvedWorldObjectId },
          select: {
            id: true,
            characterInstanceId: true,
            npcId: true,
            temporaryActorId: true,
            parentWorldObjectId: true,
            sceneLocationId: true,
            sceneFocusKey: true,
          },
        });
        if (!object) {
          throw new Error("Asset transfer world object record not found.");
        }
        recordInverse(input.rollback, "worldObject", object.id, "characterInstanceId", object.characterInstanceId);
        recordInverse(input.rollback, "worldObject", object.id, "npcId", object.npcId);
        recordInverse(input.rollback, "worldObject", object.id, "temporaryActorId", object.temporaryActorId);
        recordInverse(input.rollback, "worldObject", object.id, "parentWorldObjectId", object.parentWorldObjectId);
        recordInverse(input.rollback, "worldObject", object.id, "sceneLocationId", object.sceneLocationId);
        recordInverse(input.rollback, "worldObject", object.id, "sceneFocusKey", object.sceneFocusKey);
        await input.tx.worldObject.update({
          where: { id: object.id },
          data: worldObjectHolderData(destination, characterInstance.id),
        });
      }

      for (const transfer of mutation.commodityTransfers ?? []) {
        const sourceStack = await findCommodityStackByHolder({
          tx: input.tx,
          commodityId: transfer.commodityId,
          holder: source,
          characterInstanceId: characterInstance.id,
        });
        if (!sourceStack) {
          throw new Error("Commodity transfer source stack not found.");
        }
        recordInverse(input.rollback, "characterCommodityStack", sourceStack.id, "quantity", sourceStack.quantity);
        await input.tx.characterCommodityStack.update({
          where: { id: sourceStack.id },
          data: {
            quantity: {
              decrement: transfer.quantity,
            },
          },
        });

        const destinationStack = await findCommodityStackByHolder({
          tx: input.tx,
          commodityId: transfer.commodityId,
          holder: destination,
          characterInstanceId: characterInstance.id,
        });
        if (destinationStack) {
          recordInverse(
            input.rollback,
            "characterCommodityStack",
            destinationStack.id,
            "quantity",
            destinationStack.quantity,
          );
          await input.tx.characterCommodityStack.update({
            where: { id: destinationStack.id },
            data: {
              quantity: {
                increment: transfer.quantity,
              },
            },
          });
        } else {
          const created = await input.tx.characterCommodityStack.create({
            data: {
              commodityId: transfer.commodityId,
              quantity: transfer.quantity,
              ...commodityHolderData(destination, characterInstance.id),
            },
          });
          input.rollback.createdCommodityStackIds.push(created.id);
          recordCreated(input.rollback, "characterCommodityStack", created.id);
        }
      }
      if (destination.kind === "temporary_actor") {
        const actor = await input.tx.temporaryActor.findUnique({
          where: { id: destination.actorId },
          select: { id: true, holdsInventory: true },
        });
        if (actor && !actor.holdsInventory) {
          recordInverse(input.rollback, "temporaryActor", actor.id, "holdsInventory", actor.holdsInventory);
          await input.tx.temporaryActor.update({
            where: { id: actor.id },
            data: { holdsInventory: true },
          });
        }
      }
      continue;
    }

    if (mutation.type === "spawn_environmental_item") {
      const existingTemplateId = spawnedItemTemplateIds.get(mutation.spawnKey) ?? null;
      const spawnedInstanceIds = spawnedItemInstanceIds.get(mutation.spawnKey) ?? [];
      if (existingTemplateId && !isEvaluatedSpawnedItemTemplateId(existingTemplateId, mutation.spawnKey)) {
        throw new Error("Duplicate environmental-item spawn key during commit.");
      }

      const characterInstance = await input.tx.characterInstance.findUnique({
        where: { campaignId: input.snapshot.campaignId },
        select: { id: true },
      });
      if (!characterInstance) {
        throw new Error("Character instance not found.");
      }

      const holder = resolveSpawnItemHolderForCommit({
        holder: mutation.holder,
        spawnedWorldObjectIds,
      });
      if (!holder) {
        throw new Error("Environmental item spawn referenced an unresolved holder.");
      }
      if (holder.kind === "world_object") {
        const object = await input.tx.worldObject.findUnique({
          where: { id: holder.objectId },
          select: { id: true },
        });
        if (!object) {
          throw new Error("Environmental item spawn referenced a missing world object.");
        }
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
      if (spawnedInstanceIds.length !== mutation.quantity) {
        throw new Error("Environmental item spawn lost its evaluated instance ids.");
      }
      for (const instanceId of spawnedInstanceIds) {
        const created = await input.tx.itemInstance.create({
          data: {
            id: instanceId,
            ...itemHolderData(holder, characterInstance.id),
            templateId,
            isIdentified: true,
            charges: null,
            properties: Prisma.JsonNull,
          },
          select: { id: true },
        });
        recordCreated(input.rollback, "itemInstance", created.id);
      }
      if (holder.kind === "temporary_actor") {
        const actor = await input.tx.temporaryActor.findUnique({
          where: { id: holder.actorId },
          select: { id: true, holdsInventory: true },
        });
        if (actor && !actor.holdsInventory) {
          recordInverse(input.rollback, "temporaryActor", actor.id, "holdsInventory", actor.holdsInventory);
          await input.tx.temporaryActor.update({
            where: { id: actor.id },
            data: { holdsInventory: true },
          });
        }
      }
      continue;
    }

    if (mutation.type === "spawn_fiat_item") {
      const existingTemplateId = spawnedItemTemplateIds.get(mutation.spawnKey) ?? null;
      const spawnedInstanceIds = spawnedItemInstanceIds.get(mutation.spawnKey) ?? [];
      if (existingTemplateId && !isEvaluatedSpawnedItemTemplateId(existingTemplateId, mutation.spawnKey)) {
        throw new Error("Duplicate fiat-item spawn key during commit.");
      }

      const characterInstance = await input.tx.characterInstance.findUnique({
        where: { campaignId: input.snapshot.campaignId },
        select: { id: true },
      });
      if (!characterInstance) {
        throw new Error("Character instance not found.");
      }

      const holder = resolveSpawnItemHolderForCommit({
        holder: mutation.holder,
        spawnedWorldObjectIds,
      });
      if (!holder) {
        throw new Error("Fiat item spawn referenced an unresolved holder.");
      }
      if (holder.kind === "world_object") {
        const object = await input.tx.worldObject.findUnique({
          where: { id: holder.objectId },
          select: { id: true },
        });
        if (!object) {
          throw new Error("Fiat item spawn referenced a missing world object.");
        }
      }

      const itemName = normalizeItemName(mutation.itemName);
      const description = normalizedDescription(mutation.description);
      const reusableTemplate = await findReusableFiatItemTemplate({
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
            tags: ["spawned", "fiat", "ephemeral"],
          },
          select: { id: true },
        });
        templateId = createdTemplate.id;
        recordCreated(input.rollback, "itemTemplate", templateId);
      }

      spawnedItemTemplateIds.set(mutation.spawnKey, templateId);
      if (spawnedInstanceIds.length !== mutation.quantity) {
        throw new Error("Fiat item spawn lost its evaluated instance ids.");
      }
      for (const instanceId of spawnedInstanceIds) {
        const created = await input.tx.itemInstance.create({
          data: {
            id: instanceId,
            ...itemHolderData(holder, characterInstance.id),
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
      const resolvedItemId = resolveInventoryItemIdForEvaluation({
        itemId: mutation.itemId,
        spawnedItemTemplateIds,
        characterInventory: input.snapshot.character.inventory,
        projectedItemInstances: new Map(
          input.snapshot.character.inventory.map((item) => [
            item.id,
            {
              ...item,
              properties: item.properties ? structuredClone(item.properties) : null,
            },
          ]),
        ),
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
          (item) => !isArchivedInventoryProperties(item.properties as Prisma.JsonValue | null),
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
        characterInstance.health = restoredHealth;
      }
    }
  }

  if (currentLocationId !== input.snapshot.state.currentLocationId) {
    for (const actorRef of input.nextState.characterState.activeCompanions) {
      const normalizedActorRef = normalizeActorRef(actorRef);
      if (normalizedActorRef.startsWith("npc:")) {
        const npcId = normalizedActorRef.slice("npc:".length);
        const npc = await input.tx.nPC.findUnique({
          where: { id: npcId },
          select: { id: true, currentLocationId: true },
        });
        if (npc && npc.currentLocationId !== currentLocationId) {
          recordInverse(input.rollback, "nPC", npc.id, "currentLocationId", npc.currentLocationId);
          await input.tx.nPC.update({
            where: { id: npc.id },
            data: {
              currentLocationId,
            },
          });
        }
        continue;
      }

      if (normalizedActorRef.startsWith("temp:")) {
        const actorId = normalizedActorRef.slice("temp:".length);
        const actor = await input.tx.temporaryActor.findUnique({
          where: { id: actorId },
          select: { id: true, currentLocationId: true, promotedNpcId: true },
        });
        if (actor && actor.promotedNpcId == null && actor.currentLocationId !== currentLocationId) {
          recordInverse(input.rollback, "temporaryActor", actor.id, "currentLocationId", actor.currentLocationId);
          await input.tx.temporaryActor.update({
            where: { id: actor.id },
            data: {
              currentLocationId,
            },
          });
        }
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
  mode?: "normal" | "fast_forward";
}): Promise<{
  stateCommitLog: StateCommitLogEntry[];
  changeCodes: TurnCausalityCode[];
  reasonCodes: TurnCausalityCode[];
}> {
  const outcomes = {
    stateCommitLog: [] as StateCommitLogEntry[],
    changeCodes: [] as TurnCausalityCode[],
  };
  const simulationMode = input.mode ?? "normal";
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

    if (simulationMode === "fast_forward") {
      // Fast-forward consumes only already committed schedules and simulation
      // payloads; it must not trigger JIT schedule generation for skipped days.
    }

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
  command: ValidatedTurnActionCommand;
  memoryKind: ReturnType<typeof determineMemoryKind>;
  stateCommitLog: StateCommitLog;
  scheduleChangeCodes: TurnCausalityCode[];
}) {
  if (input.command.type === "execute_fast_forward" && input.command.timeElapsed > 0) {
    return true;
  }

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
  command: ValidatedTurnActionCommand;
  stateCommitLog: StateCommitLog;
}) {
  if (input.stateCommitLog.some((entry) => entry.status === "applied" && entry.mutationType === "set_npc_state")) {
    return "conflict" as const;
  }
  if (input.stateCommitLog.some((entry) => entry.status === "applied" && entry.mutationType === "commit_market_trade")) {
    return "trade" as const;
  }
  if (
    input.stateCommitLog.some((entry) => entry.status === "applied" && entry.mutationType === "adjust_currency")
    && input.stateCommitLog.some((entry) => entry.status === "applied" && entry.mutationType === "spawn_fiat_item")
  ) {
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
  if (
    input.stateCommitLog.some((entry) =>
      entry.status === "applied"
      && (
        entry.mutationType === "record_npc_interaction"
        || entry.mutationType === "record_local_interaction"
      )
      && typeof entry.metadata?.socialOutcome === "string"
      && CONFLICT_INTERACTION_OUTCOMES.has(entry.metadata.socialOutcome)
    )
  ) {
    return "conflict" as const;
  }

  const promiseText = input.command.memorySummary?.toLowerCase() ?? "";
  if (/\b(promise|promised|swear|swore|vow|vowed|agree|agreed|deal|owed|owe|return with|meet again)\b/.test(promiseText)) {
    return "promise" as const;
  }

  return "world_change" as const;
}

function buildSystemFallbackMemorySummary(input: {
  snapshot: CampaignSnapshot;
  command: ValidatedTurnActionCommand;
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
      if (input.command.type === "execute_fast_forward") {
        return input.command.narrationBounds?.interruptionReason
          ? `You settled into a routine in ${locationName}, but outside events broke it.`
          : `You spent considerable time settled into a routine in ${locationName}.`;
      }
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
    const holder =
      typeof entry.metadata.holder === "object" && entry.metadata.holder !== null
        ? (entry.metadata.holder as Record<string, unknown>)
        : null;
    if (entry.mutationType === "move_player") {
      pushKey("location", typeof entry.metadata.targetLocationId === "string" ? entry.metadata.targetLocationId : null);
      pushKey("route", typeof entry.metadata.routeEdgeId === "string" ? entry.metadata.routeEdgeId : null);
    }
    if (entry.mutationType === "adjust_relationship" || entry.mutationType === "set_npc_state") {
      pushKey("npc", typeof entry.metadata.npcId === "string" ? entry.metadata.npcId : null);
    }
    if (entry.mutationType === "record_npc_interaction") {
      pushKey("npc", typeof entry.metadata.npcId === "string" ? entry.metadata.npcId : null);
    }
    if (
      entry.mutationType === "spawn_fiat_item"
      && typeof holder?.kind === "string"
      && holder.kind === "npc"
    ) {
      pushKey("npc", typeof holder.npcId === "string" ? holder.npcId : null);
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
    if (entry.mutationType === "set_player_scene_focus") {
      pushKey("scene_object", typeof entry.metadata.focusKey === "string" ? entry.metadata.focusKey : null);
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
  command: ValidatedTurnActionCommand;
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
  if (
    input.nextState.currentLocationId === input.snapshot.state.currentLocationId
    && (
      input.nextState.sceneFocus?.key !== input.snapshot.state.sceneFocus?.key
      || input.nextState.sceneFocus?.label !== input.snapshot.state.sceneFocus?.label
    )
  ) {
    changeCodes.push({
      code: "SCENE_FOCUS_CHANGED",
      entityType: "scene_object",
      targetId: input.nextState.sceneFocus?.key ?? null,
      metadata: {
        label: input.nextState.sceneFocus?.label ?? null,
      },
    });
    reasonCodes.push({
      code: "PLAYER_SCENE_INTERACTION",
      entityType: "scene_object",
      targetId: input.nextState.sceneFocus?.key ?? null,
      metadata: null,
    });
  }

  for (const entry of input.stateCommitLog) {
    if (entry.status !== "applied") {
      continue;
    }
    const holder =
      typeof entry.metadata?.holder === "object" && entry.metadata.holder !== null
        ? (entry.metadata.holder as Record<string, unknown>)
        : null;
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
    if (
      entry.mutationType === "adjust_inventory"
      || entry.mutationType === "spawn_environmental_item"
      || entry.mutationType === "spawn_fiat_item"
    ) {
      reasonCodes.push({
        code: entry.mutationType === "spawn_fiat_item" ? "PLAYER_TRADE" : "PLAYER_ACTION",
        entityType:
          entry.mutationType === "spawn_fiat_item"
          && typeof holder?.kind === "string"
          && holder.kind === "npc"
            ? "npc"
            : "character",
        targetId:
          entry.mutationType === "spawn_fiat_item"
          && typeof holder?.kind === "string"
          && holder.kind === "npc"
            ? (typeof holder.npcId === "string" ? holder.npcId : null)
            : input.snapshot.character.id,
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
    if (entry.mutationType === "record_npc_interaction") {
      reasonCodes.push({
        code: "PLAYER_CONVERSATION",
        entityType: "npc",
        targetId: typeof entry.metadata?.npcId === "string" ? entry.metadata.npcId : null,
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
        code: input.command.type === "resolve_mechanics" && input.command.timeMode === "rest"
          ? "PLAYER_REST"
          : "PLAYER_ACTION",
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
          : input.command.type === "resolve_mechanics" && input.command.timeMode === "rest"
          ? "PLAYER_REST"
          : input.command.type === "resolve_mechanics" && input.command.timeMode === "combat"
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
  command: ValidatedResolvedMechanicsCommand;
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
  const evaluated = evaluateResolvedCommand({
    snapshot,
    command,
    fetchedFacts,
    routerDecision,
    groundedItemIds: input.groundedItemIds,
    playerAction,
  });

  await prisma.$transaction(async (tx) => {
    const actionEffects = await applyResolvedMutations({
      tx,
      snapshot,
      appliedMutations: evaluated.appliedMutations,
      fetchedFacts,
      rollback,
      nextTurnCount,
      nextState: evaluated.nextState,
      spawnedTemporaryActorIds: evaluated.spawnedTemporaryActorIds,
      spawnedItemTemplateIds: evaluated.spawnedItemTemplateIds,
      spawnedItemInstanceIds: evaluated.spawnedItemInstanceIds,
      spawnedWorldObjectIds: evaluated.spawnedWorldObjectIds,
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

    const preserveHydrationSummaryNpcIds = new Set(
      stateCommitLog
        .filter(
          (entry) =>
            entry.kind === "mutation"
            && entry.status === "applied"
            && entry.mutationType === "record_npc_interaction"
            && typeof entry.metadata?.npcId === "string",
        )
        .map((entry) => entry.metadata?.npcId as string),
    );

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
        preserveCurrentSummary: preserveHydrationSummaryNpcIds.has(fact.result.id),
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
  }, {
    maxWait: 5000,
    timeout: 20000,
  });

  if (!resultPayload) {
    throw new Error("Resolved turn commit did not produce a result payload.");
  }

  return {
    resultPayload,
    memoryEntryId,
  };
}

async function commitFastForwardTurn(input: {
  snapshot: CampaignSnapshot;
  sessionId: string;
  turnId: string;
  requestId: string;
  expectedStateVersion: number;
  playerAction: string;
  turnMode: TurnMode;
  command: ValidatedExecuteFastForwardCommand;
  fetchedFacts: TurnFetchToolResult[];
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
  } = input;
  const nextTurnCount = snapshot.sessionTurnCount + 1;
  const rollback = emptyRollback(snapshot);
  let resultPayload: TurnResultPayload | null = null;
  let memoryEntryId: string | null = null;

  await prisma.$transaction(async (tx) => {
    const characterInstance = await tx.characterInstance.findUnique({
      where: { campaignId: snapshot.campaignId },
      include: {
        inventory: {
          orderBy: { createdAt: "asc" },
        },
      },
    });
    if (!characterInstance) {
      throw new Error("Character instance not found.");
    }

    const startTime = snapshot.state.globalTime;
    const requestedMinutes = command.requestedDurationMinutes;
    const worldWindowMinutes = availableAdvanceMinutes(snapshot);
    const hardCapMinutes = 7 * 1440;
    const initialMaxMinutes = Math.min(requestedMinutes, worldWindowMinutes, hardCapMinutes);

    let provisionalMinutes = initialMaxMinutes;
    let interruptionReason: string | null = null;
    let limitingResourceLabel: string | null = null;
    let maxAffordableRatio = 1;

    if (command.resourceCosts?.currencyCp && command.resourceCosts.currencyCp > 0) {
      const ratio = characterInstance.currencyCp / command.resourceCosts.currencyCp;
      if (ratio < maxAffordableRatio) {
        maxAffordableRatio = ratio;
        limitingResourceLabel = "funds";
      }
    }

    for (const entry of command.resourceCosts?.itemRemovals ?? []) {
      const available = characterInstance.inventory.filter(
        (item) =>
          item.templateId === entry.templateId
          && !isArchivedInventoryProperties(item.properties as Prisma.JsonValue | null),
      ).length;
      const ratio = available / entry.quantity;
      if (ratio < maxAffordableRatio) {
        maxAffordableRatio = ratio;
        limitingResourceLabel = labelForTemplateId(snapshot, entry.templateId);
      }
    }

    if (maxAffordableRatio < 1) {
      const rawAffordableMinutes = requestedMinutes * maxAffordableRatio;
      const resourceBoundMinutes = Math.floor(rawAffordableMinutes / 720) * 720;
      if (resourceBoundMinutes <= 0) {
        interruptionReason = `You do not have enough ${limitingResourceLabel ?? "supplies"} to begin this routine.`;
        provisionalMinutes = 0;
      } else {
        provisionalMinutes = Math.min(provisionalMinutes, resourceBoundMinutes);
        interruptionReason = `You maintained your routine for as long as possible, but ran out of ${limitingResourceLabel ?? "supplies"}.`;
      }
    }

    const provisionalEndTime = startTime + provisionalMinutes;
    let interruptAtTime: number | null = null;

    if (provisionalMinutes > 0) {
      const localWorldEvent = await tx.worldEvent.findFirst({
        where: {
          campaignId: snapshot.campaignId,
          locationId: snapshot.currentLocation.id,
          isProcessed: false,
          isCancelled: false,
          triggerTime: {
            gt: startTime,
            lte: provisionalEndTime,
          },
        },
        orderBy: [{ triggerTime: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          triggerTime: true,
          description: true,
        },
      });

      const factionMoveCandidates = await tx.factionMove.findMany({
        where: {
          campaignId: snapshot.campaignId,
          isExecuted: false,
          isCancelled: false,
          scheduledAtTime: {
            gt: startTime,
            lte: provisionalEndTime,
          },
        },
        orderBy: [{ scheduledAtTime: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          scheduledAtTime: true,
          description: true,
          payload: true,
        },
      });

      const localFactionMove = factionMoveCandidates.find((move) =>
        simulationPayloadTouchesLocation(move.payload as Prisma.JsonValue, snapshot.currentLocation.id),
      ) ?? null;

      if (
        localWorldEvent
        && (!localFactionMove || localWorldEvent.triggerTime <= localFactionMove.scheduledAtTime)
      ) {
        interruptAtTime = localWorldEvent.triggerTime;
        interruptionReason = localWorldEvent.description;
      } else if (localFactionMove) {
        interruptAtTime = localFactionMove.scheduledAtTime;
        interruptionReason = localFactionMove.description;
      }
    }

    const committedEndTime = interruptAtTime ?? provisionalEndTime;
    const committedMinutes = Math.max(0, committedEndTime - startTime);
    const nextState: CampaignRuntimeState = {
      ...snapshot.state,
      globalTime: committedEndTime,
      pendingTurnId: null,
      lastActionSummary: command.memorySummary ?? command.routineSummary,
    };

    const simulationOutcome = await runTemporalSimulation({
      tx,
      snapshot,
      nextState,
      rollback,
      initialAffectedFactionIds: [],
      mode: "fast_forward",
    });

    const actualCurrencyCost =
      command.resourceCosts?.currencyCp && committedMinutes > 0
        ? Math.ceil(command.resourceCosts.currencyCp * committedMinutes / requestedMinutes)
        : 0;
    if (actualCurrencyCost > characterInstance.currencyCp) {
      throw new Error("Fast-forward currency upkeep exceeded affordable committed duration.");
    }

    const actualItemRemovals = (command.resourceCosts?.itemRemovals ?? []).map((entry) => ({
      templateId: entry.templateId,
      quantity:
        committedMinutes > 0
          ? Math.ceil(entry.quantity * committedMinutes / requestedMinutes)
          : 0,
    })).filter((entry) => entry.quantity > 0);

    for (const removal of actualItemRemovals) {
      const availableItems = characterInstance.inventory.filter(
        (item) =>
          item.templateId === removal.templateId
          && !isArchivedInventoryProperties(item.properties as Prisma.JsonValue | null),
      );
      if (availableItems.length < removal.quantity) {
        throw new Error("Fast-forward item upkeep exceeded affordable committed duration.");
      }
    }

    const stateCommitLog: StateCommitLog = [{
      kind: "mutation",
      mutationType: "advance_time",
      status: "applied",
      reasonCode: "fast_forward_executed",
      summary: command.routineSummary,
      metadata: {
        isFastForward: true,
        requestedDurationMinutes: requestedMinutes,
        committedDurationMinutes: committedMinutes,
        interruptionReason,
      },
    }];

    if (actualCurrencyCost > 0) {
      recordInverse(rollback, "characterInstance", characterInstance.id, "currencyCp", characterInstance.currencyCp);
      await tx.characterInstance.update({
        where: { id: characterInstance.id },
        data: {
          currencyCp: {
            decrement: actualCurrencyCost,
          },
        },
      });
      characterInstance.currencyCp -= actualCurrencyCost;
      stateCommitLog.push({
        kind: "mutation",
        mutationType: "adjust_currency",
        status: "applied",
        reasonCode: "montage_upkeep_currency",
        summary: `You spend ${formatCurrencyCompact(actualCurrencyCost)} on routine upkeep.`,
        metadata: {
          deltaCp: -actualCurrencyCost,
        },
      });
    }

    for (const removal of actualItemRemovals) {
      const availableItems = characterInstance.inventory.filter(
        (item) =>
          item.templateId === removal.templateId
          && !isArchivedInventoryProperties(item.properties as Prisma.JsonValue | null),
      );
      for (const item of availableItems.slice(0, removal.quantity)) {
        recordInverse(rollback, "itemInstance", item.id, "properties", item.properties);
        await tx.itemInstance.update({
          where: { id: item.id },
          data: {
            properties: withRemovedInventoryMarker(item.properties),
          },
        });
        item.properties = withRemovedInventoryMarker(item.properties) as Prisma.JsonValue;
      }
      stateCommitLog.push({
        kind: "mutation",
        mutationType: "adjust_inventory",
        status: "applied",
        reasonCode: "montage_upkeep_item",
        summary: `${labelForTemplateId(snapshot, removal.templateId)} x${removal.quantity} are consumed by the routine.`,
        metadata: {
          itemId: removal.templateId,
          quantity: removal.quantity,
          action: "remove",
        },
      });
    }

    stateCommitLog.push(...simulationOutcome.stateCommitLog);

    const scheduleChangeCodes = await enqueueFutureScheduleBuffer({
      tx,
      snapshot,
      nextState,
      turnId,
      rollback,
    });

    const committedCommand: ValidatedExecuteFastForwardCommand = {
      ...command,
      timeElapsed: committedMinutes,
      narrationBounds: buildFastForwardNarrationBounds({
        snapshot,
        requestedDurationMinutes: requestedMinutes,
        committedDurationMinutes: committedMinutes,
        interruptionReason,
      }),
      warnings: command.warnings,
      pendingCheck: undefined,
      checkResult: undefined,
      narrationHint: null,
    };

    const finalCausality = buildTurnCausality({
      snapshot,
      command: committedCommand,
      stateCommitLog,
      nextState,
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
        stateJson: toCampaignRuntimeStateJson(nextState),
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
        preserveCurrentSummary: false,
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

    for (const warning of committedCommand.warnings) {
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
      command: committedCommand,
      stateCommitLog,
    });
    const modelMemorySummary = normalizeMemorySummary(committedCommand.memorySummary);
    const shouldRecordMemory = modelMemorySummary != null || isSalientMemory({
      command: committedCommand,
      memoryKind,
      stateCommitLog,
      scheduleChangeCodes,
    });

    if (shouldRecordMemory) {
      const memorySummary = modelMemorySummary ?? buildSystemFallbackMemorySummary({
        snapshot,
        command: committedCommand,
        memoryKind,
        stateCommitLog,
      });
      const memoryEntityLinks = collectMemoryEntityLinks({
        snapshot,
        stateCommitLog,
        changeCodes: finalCausality.changeCodes,
        reasonCodes: finalCausality.reasonCodes,
        affectedFactionIds: [],
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
      warnings: committedCommand.warnings,
      stateCommitLog,
      narrationBounds: committedCommand.narrationBounds ?? null,
      checkResult: null,
      rollback,
      clarification: null,
      error: null,
    };

    await tx.turn.update({
      where: { id: turnId },
      data: {
        status: "resolved",
        stateVersionAfter: expectedStateVersion + 1,
        toolCallJson: toPrismaJsonValue(committedCommand),
        resultJson: toPrismaJsonValue(toTurnResultPayloadJson(resultPayload)),
      },
    });
  });

  if (!resultPayload) {
    throw new Error("Fast-forward turn commit completed without a result payload.");
  }

  return {
    resultPayload,
    memoryEntryId,
  };
}

async function executeRequiredPrerequisites(input: {
  snapshot: CampaignSnapshot;
  prerequisites: RouterDecision["requiredPrerequisites"];
}) {
  if (!input.prerequisites.length) {
    return [];
  }

  const fetchedFacts: Array<TurnFetchToolResult | null> = new Array(input.prerequisites.length).fill(null);
  const canonicalNpcCandidates = [
    ...input.snapshot.presentNpcs.map((npc) => ({ id: npc.id, name: npc.name })),
    ...Object.keys(input.snapshot.knownNpcLocationIds).map((id) => ({ id })),
  ];
  const npcDetailRequests: Array<{ index: number; npcId: string }> = [];
  const marketPriceRequests: Array<{ index: number; locationId: string }> = [];
  const factionIntelRequests: Array<{ index: number; factionId: string }> = [];
  const informationDetailRequests: Array<{ index: number; informationId: string }> = [];
  const informationConnectionRequests: Array<{ index: number; key: string; informationIds: string[] }> = [];
  const relationshipHistoryRequests: Array<{ index: number; npcId: string }> = [];

  for (const [index, prerequisite] of input.prerequisites.entries()) {
    if (prerequisite.type === "npc_detail") {
      npcDetailRequests.push({
        index,
        npcId: canonicalizeNpcIdAgainstCandidates({
          rawNpcId: prerequisite.npcId,
          candidates: canonicalNpcCandidates,
        }),
      });
      continue;
    }
    if (prerequisite.type === "market_prices") {
      marketPriceRequests.push({ index, locationId: prerequisite.locationId });
      continue;
    }
    if (prerequisite.type === "faction_intel") {
      factionIntelRequests.push({ index, factionId: prerequisite.factionId });
      continue;
    }
    if (prerequisite.type === "information_detail") {
      informationDetailRequests.push({ index, informationId: prerequisite.informationId });
      continue;
    }
    if (prerequisite.type === "information_connections") {
      informationConnectionRequests.push({
        index,
        key: prerequisite.informationIds.join("\u0000"),
        informationIds: prerequisite.informationIds,
      });
      continue;
    }
    relationshipHistoryRequests.push({
      index,
      npcId: canonicalizeNpcIdAgainstCandidates({
        rawNpcId: prerequisite.npcId,
        candidates: canonicalNpcCandidates,
      }),
    });
  }

  const [
    npcDetailsById,
    marketPricesByLocationId,
    factionIntelById,
    informationDetailsById,
    informationConnectionsByKey,
    relationshipHistoriesByNpcId,
  ] = await Promise.all([
    fetchNpcDetailsBulk(
      input.snapshot.campaignId,
      npcDetailRequests.map((entry) => entry.npcId),
    ),
    fetchMarketPricesBulk(
      input.snapshot.campaignId,
      marketPriceRequests.map((entry) => entry.locationId),
    ),
    fetchFactionIntelBulk(
      input.snapshot.campaignId,
      factionIntelRequests.map((entry) => entry.factionId),
    ),
    fetchInformationDetailsBulk(
      input.snapshot.campaignId,
      informationDetailRequests.map((entry) => entry.informationId),
    ),
    fetchInformationConnectionsBulk({
      campaignId: input.snapshot.campaignId,
      groups: informationConnectionRequests.map((entry) => ({
        key: entry.key,
        informationIds: entry.informationIds,
      })),
    }),
    fetchRelationshipHistoriesBulk(
      input.snapshot.campaignId,
      relationshipHistoryRequests.map((entry) => entry.npcId),
    ),
  ]);

  for (const request of npcDetailRequests) {
    const result = npcDetailsById.get(request.npcId);
    if (!result) {
      throw new Error("NPC detail not found.");
    }

    if (
      (result.socialLayer === "promoted_local" && !result.isNarrativelyHydrated)
      || hasGenericNpcRoleLabelName({ name: result.name, role: result.role })
    ) {
      try {
        const hydration = await buildPromotedNpcHydrationPayload({
          campaignId: input.snapshot.campaignId,
          baseResult: result,
        });

        if (hydration) {
          fetchedFacts[request.index] = {
            type: "fetch_npc_detail",
            result: hydration.hydratedResult,
            hydrationDraft: hydration.hydrationDraft,
          };
          continue;
        }
      } catch (error) {
        logBackendDiagnostic("turn.fetch.promoted_local_hydration_failed", {
          campaignId: input.snapshot.campaignId,
          npcId: result.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    fetchedFacts[request.index] = {
      type: "fetch_npc_detail",
      result,
    };
  }

  for (const request of marketPriceRequests) {
    fetchedFacts[request.index] = {
      type: "fetch_market_prices",
      result: marketPricesByLocationId.get(request.locationId) ?? [],
    };
  }

  for (const request of factionIntelRequests) {
    const result = factionIntelById.get(request.factionId);
    if (!result) {
      throw new Error("Faction intel not found.");
    }
    fetchedFacts[request.index] = {
      type: "fetch_faction_intel",
      result,
    };
  }

  for (const request of informationDetailRequests) {
    const result = informationDetailsById.get(request.informationId);
    if (!result) {
      throw new Error("Information detail not found.");
    }
    fetchedFacts[request.index] = {
      type: "fetch_information_detail",
      result,
    };
  }

  for (const request of informationConnectionRequests) {
    fetchedFacts[request.index] = {
      type: "fetch_information_connections",
      result: informationConnectionsByKey.get(request.key) ?? [],
    };
  }

  for (const request of relationshipHistoryRequests) {
    const result = relationshipHistoriesByNpcId.get(request.npcId);
    if (!result) {
      throw new Error("Relationship history not found.");
    }
    fetchedFacts[request.index] = {
      type: "fetch_relationship_history",
      result,
    };
  }

  return fetchedFacts.filter((entry): entry is TurnFetchToolResult => entry != null);
}

function deterministicNarrationFallback(input: {
  playerAction: string;
  stateCommitLog: StateCommitLog;
  narrationBounds?: {
    isFastForward?: boolean;
    interruptionReason?: string | null;
  } | null;
  checkResult?: CheckResult | null;
  narrationHint?: {
    unresolvedTargetPhrases?: string[];
  } | null;
}) {
  const appliedEntries = input.stateCommitLog
    .filter((entry) => entry.status === "applied" && (entry.kind === "mutation" || entry.kind === "simulation"));
  const hasMeaningfulAppliedEntry = appliedEntries.some((entry) => entry.reasonCode !== "time_advanced");

  function summarizeAppliedEntry(entry: StateCommitLog[number]) {
    if (entry.status !== "applied") {
      return null;
    }
    if (entry.reasonCode === "time_advanced") {
      if (hasMeaningfulAppliedEntry) {
        return null;
      }
      const minutesMatch = entry.summary.match(/(\d+)\s+minutes?/i);
      if (minutesMatch) {
        const minutes = Number(minutesMatch[1]);
        if (Number.isFinite(minutes) && minutes <= 5) {
          return "A few minutes slip by.";
        }
      }
      return "Some time passes.";
    }
    if (
      (entry.reasonCode === "local_interaction_recorded" || entry.reasonCode === "npc_interaction_recorded")
      && entry.kind === "mutation"
    ) {
      const socialOutcome = typeof entry.metadata?.socialOutcome === "string"
        ? entry.metadata.socialOutcome
        : null;
      const topicPhrase = typeof entry.metadata?.topic === "string" && entry.metadata.topic.trim()
        ? ` regarding ${entry.metadata.topic.trim().toLowerCase()}`
        : "";
      if (socialOutcome && SOFT_SOCIAL_OUTCOMES.has(socialOutcome)) {
        switch (socialOutcome) {
          case "acknowledges":
            return `The exchange${topicPhrase} lands, but no commitment is made.`;
          case "hesitates":
            return `The answer${topicPhrase} remains unsettled.`;
          case "withholds":
            return `The full answer${topicPhrase} does not come.`;
          case "asks_question":
            return `The response${topicPhrase} turns back on you.`;
          case "redirects":
            return topicPhrase
              ? `The exchange${topicPhrase} shifts away from the original ask.`
              : "The exchange shifts away from the original ask.";
          case "resists":
            return topicPhrase ? `Pushback${topicPhrase} is clear.` : "Pushback is clear.";
          case "withdraws":
            return topicPhrase
              ? `The exchange${topicPhrase} pulls away rather than resolving.`
              : "The exchange pulls away rather than resolving.";
          default:
            break;
        }
      }
      const interactionSummary = entry.summary.trim().replace(/\.$/, "");
      if (!interactionSummary) {
        return "The exchange lands without a clear change.";
      }
      if (/^asked\b/i.test(interactionSummary)) {
        return `You ${interactionSummary.charAt(0).toLowerCase()}${interactionSummary.slice(1)}.`;
      }
      return `${interactionSummary}.`;
    }
    if (entry.reasonCode === "item_state_updated" && entry.kind === "mutation") {
      const itemName = entry.summary.replace(/ changes state\.$/, "");
      return itemName ? `You adjust ${itemName.toLowerCase()}.` : "You adjust your gear.";
    }
    if (entry.reasonCode === "world_object_state_updated" && entry.kind === "mutation") {
      const objectName = entry.summary.replace(/ changes state\.$/, "");
      return objectName ? `You adjust ${objectName.toLowerCase()}.` : "You adjust the object.";
    }
    return entry.summary;
  }

  const applied = appliedEntries
    .map(summarizeAppliedEntry)
    .filter((entry): entry is string => Boolean(entry));
  const hasRejectedEntries = input.stateCommitLog.some((entry) => entry.status === "rejected");

  const sentences: string[] = [];
  if (input.narrationBounds?.isFastForward) {
    const routineSummary =
      input.stateCommitLog.find(
        (entry) =>
          entry.status === "applied"
          && entry.mutationType === "advance_time"
          && entry.reasonCode === "fast_forward_executed",
      )?.summary
      ?? "You settle into a routine for a while.";
    sentences.push(routineSummary);
    if (input.narrationBounds.interruptionReason) {
      sentences.push(input.narrationBounds.interruptionReason);
    }
  } else if ((input.narrationHint?.unresolvedTargetPhrases?.length ?? 0) > 0) {
    const phrase = input.narrationHint?.unresolvedTargetPhrases?.[0] ?? "them";
    sentences.push(`You reach for ${phrase}, but the target is already gone from immediate reach.`);
  } else if (applied.length) {
    sentences.push(applied.join(" "));
  } else if (input.checkResult?.outcome === "failure") {
    sentences.push("Your attempt does not take hold.");
  } else if (hasRejectedEntries) {
    sentences.push("Part of your attempt does not take hold.");
  } else {
    sentences.push("The turn resolves without a lasting change.");
  }
  const waitedForArrival =
    /\bwait\b/i.test(input.playerAction)
    && /\b(for|until|til)\b/i.test(input.playerAction)
    && /\b(arrive|arrives|arrival|return|returns|come|comes)\b/i.test(input.playerAction);
  const hasArrivalCommit = input.stateCommitLog.some((entry) =>
    entry.status === "applied"
    && entry.metadata?.arrivesInCurrentScene === true,
  );
  if (waitedForArrival && !hasArrivalCommit) {
    sentences.push("What you were waiting for has not happened yet.");
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
  sanitizePromotedNpcHydrationDraft,
  requestHashForSubmission,
  promptContextProfileForRouter,
  routerDecisionForTurnMode,
  determineMemoryKind,
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

  if (input.turn.status === "pending_check" && result?.pendingCheck) {
    return {
      type: "check_required" as const,
      turnId: input.turn.id,
      check: result.pendingCheck,
      warnings: result.warnings,
    };
  }

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

    if (["resolved", "clarification_requested", "pending_check", "conflicted"].includes(existingTurn.status)) {
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
      stateJson: true,
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

  const pendingTurnId = parseCampaignRuntimeStateJson(campaign.stateJson).pendingTurnId;
  if (pendingTurnId) {
    const pendingTurn = await prisma.turn.findUnique({
      where: { id: pendingTurnId },
    });
    if (pendingTurn?.status === "pending_check") {
      const replay = await replayExistingTurn({
        turn: pendingTurn,
        campaignId: input.campaignId,
      });
      if (replay) {
        return replay;
      }
    }
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
      clarificationNeeded: routerDecision.clarification.needed,
      attentionMustCheck: routerDecision.attention.mustCheck,
      attentionResolvedReferentCount: routerDecision.attention.resolvedReferents.length,
    });
    if (turnMode === "player_input" && intent?.type !== "travel_route" && routerDecision.clarification.needed) {
      const clarificationCommand = buildClarificationToolCall({
        question: routerDecision.clarification.question ?? "Can you clarify what you mean?",
        options: routerDecision.clarification.options,
      });
      logBackendDiagnostic("turn.clarification_requested", {
        campaignId: input.campaignId,
        sessionId: input.sessionId,
        requestId: input.requestId,
        turnId: turn.id,
        source: "router",
        blocker: routerDecision.clarification.blocker,
      });
      await persistClarificationRequest({
        turnId: turn.id,
        stateVersion: snapshot.stateVersion,
        command: clarificationCommand,
      });
      await cleanupTurnLock({
        campaignId: input.campaignId,
        requestId: input.requestId,
      });

      return {
        type: "clarification" as const,
        turnId: turn.id,
        question: clarificationCommand.question,
        options: clarificationCommand.options,
        warnings: [],
      };
    }
    const promptContext = await getPromptContext(
      snapshot,
      promptContextProfileForRouter(routerDecision),
      routerDecision,
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
      routerDecision,
    });

    if (validated.type === "request_clarification") {
      logBackendDiagnostic("turn.clarification_requested", {
        campaignId: input.campaignId,
        sessionId: input.sessionId,
        requestId: input.requestId,
        turnId: turn.id,
        source: "model",
      });
      await persistClarificationRequest({
        turnId: turn.id,
        stateVersion: snapshot.stateVersion,
        command: validated,
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

    if (validated.pendingCheck) {
      const pendingBundle: PendingCheckToolBundle = {
        type: "pending_check",
        command: {
          ...validated,
          pendingCheck: validated.pendingCheck,
          checkResult: undefined,
        },
        fetchedFacts: resolution.fetchedFacts,
        routerDecision,
        playerAction,
        turnMode,
        groundedItemIds: promptContext.inventory
          .filter((entry) => entry.kind === "item")
          .map((entry) => entry.id),
      };
      logBackendDiagnostic("turn.check_requested", {
        campaignId: input.campaignId,
        sessionId: input.sessionId,
        requestId: input.requestId,
        turnId: turn.id,
        stat: validated.pendingCheck.stat,
        mode: validated.pendingCheck.mode,
        dc: validated.pendingCheck.dc ?? null,
      });
      await persistPendingCheckRequest({
        campaignId: input.campaignId,
        turnId: turn.id,
        requestId: input.requestId,
        stateVersion: snapshot.stateVersion,
        previousState: snapshot.state,
        bundle: pendingBundle,
      });
      input.stream?.checkRequired?.({
        turnId: turn.id,
        check: validated.pendingCheck,
      });

      return {
        type: "check_required" as const,
        turnId: turn.id,
        check: validated.pendingCheck,
        warnings: validated.warnings,
      };
    }

    const committedCommand =
      validated.type === "execute_fast_forward"
        ? validated
        : applyCommittedTimeWindow({
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
    const committed =
      committedCommand.type === "execute_fast_forward"
        ? await commitFastForwardTurn({
            snapshot,
            sessionId: input.sessionId,
            turnId: turn.id,
            requestId: input.requestId,
            expectedStateVersion: input.expectedStateVersion,
            playerAction,
            turnMode,
            command: committedCommand,
            fetchedFacts: resolution.fetchedFacts,
          })
        : await commitResolvedTurn({
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
        narrationBounds: committed.resultPayload.narrationBounds ?? null,
        checkResult: committed.resultPayload.checkResult ?? null,
        suggestedActions: dedupeStrings(committedCommand.suggestedActions),
        narrationHint: committedCommand.narrationHint ?? null,
        signal: abortController.signal,
      });
    } catch (error) {
      narration = deterministicNarrationFallback({
        playerAction,
        stateCommitLog: committed.resultPayload.stateCommitLog ?? [],
        narrationBounds: committed.resultPayload.narrationBounds ?? null,
        checkResult: committed.resultPayload.checkResult ?? null,
        narrationHint: committedCommand.narrationHint ?? null,
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

export async function resolvePendingCheck(input: ResolvePendingCheckRequest & {
  stream?: TurnStream;
}) {
  const pendingTurn = await prisma.turn.findUnique({
    where: { id: input.pendingTurnId },
  });

  if (!pendingTurn || pendingTurn.campaignId !== input.campaignId || pendingTurn.sessionId !== input.sessionId) {
    throw new Error("Pending check turn not found.");
  }

  if (pendingTurn.status !== "pending_check") {
    const replay = await replayExistingTurn({
      turn: pendingTurn,
      campaignId: input.campaignId,
    });
    if (replay) {
      return replay;
    }
    throw new Error("That turn is no longer waiting on a roll.");
  }

  if (!isPendingCheckToolBundle(pendingTurn.toolCallJson)) {
    throw new Error("Pending check turn is missing its stored resolution plan.");
  }

  const campaign = await prisma.campaign.findUnique({
    where: { id: input.campaignId },
    select: {
      stateVersion: true,
      stateJson: true,
    },
  });

  if (!campaign) {
    throw new Error("Campaign not found.");
  }

  const campaignState = parseCampaignRuntimeStateJson(campaign.stateJson);
  if (campaignState.pendingTurnId !== pendingTurn.id) {
    const replay = await replayExistingTurn({
      turn: pendingTurn,
      campaignId: input.campaignId,
    });
    if (replay) {
      return replay;
    }
    throw new Error("That pending roll is no longer active.");
  }

  const lockClaim = await prisma.campaign.updateMany({
    where: {
      id: input.campaignId,
      stateVersion: campaign.stateVersion,
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
    throw new TurnLockedError("Another turn already owns the campaign lock.");
  }

  try {
    const snapshot = await getTurnSnapshot(input.campaignId, input.sessionId);
    if (!snapshot) {
      throw new Error("Campaign session not found.");
    }
    if (snapshot.state.pendingTurnId !== pendingTurn.id) {
      throw new Error("The pending roll is no longer active.");
    }

    const bundle = pendingTurn.toolCallJson;
    const normalizedRolls = normalizeSubmittedRolls(bundle.command.pendingCheck.mode, input.rolls);
    const checkResult = buildCheckResult({
      ...bundle.command.pendingCheck,
      rolls: normalizedRolls,
    });
    input.stream?.checkResult?.(checkResult);

    const committedCommand = {
      ...bundle.command,
      pendingCheck: undefined,
      checkResult,
    };

    for (const warning of committedCommand.warnings) {
      input.stream?.warning?.(warning);
    }

    const committed = await commitResolvedTurn({
      snapshot,
      sessionId: input.sessionId,
      turnId: pendingTurn.id,
      requestId: input.requestId,
      expectedStateVersion: snapshot.stateVersion,
      playerAction: bundle.playerAction,
      turnMode: bundle.turnMode,
      command: committedCommand,
      fetchedFacts: bundle.fetchedFacts,
      routerDecision: bundle.routerDecision,
      groundedItemIds: bundle.groundedItemIds,
    });

    const promptContext = await getPromptContext(
      snapshot,
      promptContextProfileForRouter(bundle.routerDecision),
      bundle.routerDecision,
    );

    let narration: string;
    try {
      narration = await dmClient.narrateResolvedTurn({
        playerAction: bundle.playerAction,
        promptContext,
        fetchedFacts: bundle.fetchedFacts,
        stateCommitLog: committed.resultPayload.stateCommitLog ?? [],
        narrationBounds: committed.resultPayload.narrationBounds ?? null,
        checkResult: committed.resultPayload.checkResult ?? null,
        suggestedActions: dedupeStrings(committedCommand.suggestedActions),
      });
    } catch (error) {
      narration = deterministicNarrationFallback({
        playerAction: bundle.playerAction,
        stateCommitLog: committed.resultPayload.stateCommitLog ?? [],
        narrationBounds: committed.resultPayload.narrationBounds ?? null,
        checkResult: committed.resultPayload.checkResult ?? null,
        narrationHint: bundle.command.narrationHint ?? null,
      });
      logBackendDiagnostic("turn.narration.fallback", {
        campaignId: input.campaignId,
        requestId: input.requestId,
        turnId: pendingTurn.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    await persistResolvedTurnNarration({
      sessionId: input.sessionId,
      turnId: pendingTurn.id,
      narration,
      suggestedActions: dedupeStrings(committedCommand.suggestedActions),
      fetchedFacts: bundle.fetchedFacts,
      checkResult: committed.resultPayload.checkResult ?? null,
      whatChanged: committed.resultPayload.whatChanged,
      why: committed.resultPayload.why,
      memoryEntryId: committed.memoryEntryId,
    });
    input.stream?.narration?.(narration);

    return {
      type: "resolved" as const,
      turnId: pendingTurn.id,
      narration,
      suggestedActions: dedupeStrings(committedCommand.suggestedActions),
      warnings: committedCommand.warnings,
      checkResult: committedCommand.checkResult,
      result: committed.resultPayload,
    };
  } catch (error) {
    await cleanupTurnLock({
      campaignId: input.campaignId,
      requestId: input.requestId,
    }).catch(() => undefined);
    throw error;
  }
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
