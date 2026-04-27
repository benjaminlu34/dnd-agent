import { z } from "zod";
import type { Prisma } from "@prisma/client";
import type {
  CampaignRuntimeState,
  FactionResourcePool,
  SceneAspectDuration,
  StateCommitLogEntry,
  TurnCausalityCode,
  TurnCausalityCodeName,
  TurnNarrationBounds,
  TurnResultPayload,
} from "@/lib/game/types";
import { SOCIAL_OUTCOMES } from "@/lib/game/types";

const sceneAspectDurationValues = ["scene", "permanent"] as const satisfies readonly SceneAspectDuration[];
const socialOutcomeSchema = z.enum(SOCIAL_OUTCOMES);

const sceneAspectSchema = z.object({
  label: z.string().trim().min(1),
  state: z.string().trim().min(1),
  duration: z.enum(sceneAspectDurationValues),
  focusKey: z.string().trim().min(1).nullish().default(null),
});

const rawCampaignRuntimeStateSchema = z.object({
  currentLocationId: z.string().trim().min(1).nullable(),
  activeJourneyId: z.string().trim().min(1).nullable().optional(),
  globalTime: z.number().int().min(0),
  pendingTurnId: z.string().trim().min(1).nullable(),
  lastActionSummary: z.string().trim().min(1).nullable(),
  characterState: z.object({
    conditions: z.array(z.string().trim().min(1)).default([]),
    activeCompanions: z.array(z.string().trim().min(1)).default([]),
    maxVitality: z.number().int().positive().nullish().default(null),
    progression: z.object({
      trackValues: z.record(z.string(), z.number()).default({}),
    }).optional(),
  }).nullish().default({ conditions: [], activeCompanions: [], maxVitality: null }),
  sceneFocus: z.object({
    key: z.string().trim().min(1),
    label: z.string().trim().min(1),
  }).nullish().default(null),
  sceneActorFocuses: z.record(z.string(), z.string().trim().min(1).nullable()).optional().default({}),
  sceneAspects: z.record(z.string(), sceneAspectSchema).optional().default({}),
  sceneObjectStates: z.record(z.string(), z.string()).optional().default({}),
  customTitle: z.string().trim().min(1).nullable().optional(),
});

const campaignRuntimeStateSchema: z.ZodType<CampaignRuntimeState> = rawCampaignRuntimeStateSchema.transform((value) => {
  const normalizedAspects = Object.keys(value.sceneAspects).length
    ? value.sceneAspects
    : Object.fromEntries(
        Object.entries(value.sceneObjectStates).map(([key, state]) => [
          key,
          {
            label: key.replace(/[_-]+/g, " ").trim() || key,
            state,
            duration: "permanent" as const,
            focusKey: null,
          },
        ]),
      );

  return {
    currentLocationId: value.currentLocationId ?? null,
    activeJourneyId: value.activeJourneyId ?? null,
    globalTime: value.globalTime,
    pendingTurnId: value.pendingTurnId,
    lastActionSummary: value.lastActionSummary,
    characterState: {
      conditions: value.characterState?.conditions ?? [],
      activeCompanions: value.characterState?.activeCompanions ?? [],
      maxVitality: value.characterState?.maxVitality ?? null,
      ...(value.characterState?.progression
        ? {
            progression: {
              trackValues: value.characterState.progression.trackValues,
            },
          }
        : {}),
    },
    sceneFocus: value.sceneFocus ?? null,
    sceneActorFocuses: value.sceneActorFocuses ?? {},
    sceneAspects: normalizedAspects,
    customTitle: value.customTitle ?? null,
  } satisfies CampaignRuntimeState;
});

const factionResourcesSchema = z.object({
  gold: z.number().int(),
  military: z.number().int(),
  influence: z.number().int(),
  information: z.number().int(),
});

const turnCausalityCodeNameValues = [
  "TIME_ADVANCED",
  "LOCATION_CHANGED",
  "SCENE_FOCUS_CHANGED",
  "ACTOR_STATE_CHANGED",
  "ACTOR_LOCATION_CHANGED",
  "NPC_APPROVAL_CHANGED",
  "INFORMATION_DISCOVERED",
  "INFORMATION_ADDED",
  "INFORMATION_EXPIRED",
  "SCENE_OBJECT_STATE_CHANGED",
  "NPC_STATE_CHANGED",
  "NPC_LOCATION_CHANGED",
  "CHARACTER_HEALTH_CHANGED",
  "ROUTE_STATUS_CHANGED",
  "LOCATION_STATE_CHANGED",
  "LOCATION_CONTROL_CHANGED",
  "FACTION_RESOURCES_CHANGED",
  "WORLD_EVENT_SPAWNED",
  "WORLD_EVENT_CANCELLED",
  "WORLD_EVENT_PROCESSED",
  "FACTION_MOVE_CANCELLED",
  "FACTION_MOVE_EXECUTED",
  "MARKET_PRICE_CHANGED",
  "MARKET_RESTOCKED",
  "MEMORY_RECORDED",
  "SCHEDULE_JOB_ENQUEUED",
  "PLAYER_ACTION",
  "PLAYER_TRAVEL",
  "PLAYER_WAIT",
  "PLAYER_REST",
  "PLAYER_TRADE",
  "PLAYER_COMBAT",
  "PLAYER_CONVERSATION",
  "PLAYER_SCENE_INTERACTION",
  "PLAYER_INVESTIGATION",
  "PLAYER_OBSERVATION",
  "MODEL_DISCOVERY_INTENT",
  "RELATIONSHIP_SHIFT",
  "SIMULATION_TICK",
  "HORIZON_CAP",
    "JOURNEY_STARTED",
    "JOURNEY_ARRIVED",
    "JOURNEY_ABORTED",
    "JOURNEY_REVERSED",
    "AUTHORED_DISCOVERY_REQUESTED",
    "FALLBACK_DISCOVERY_REQUESTED",
    "AUTHORED_DISCOVERY_REVEALED",
    "FALLBACK_DISCOVERY_REVEALED",
  "SCHEDULE_BUFFER_ROLLED",
  "INVALIDATED_EVENT",
] as const satisfies readonly TurnCausalityCodeName[];

const turnCausalityCodeSchema: z.ZodType<TurnCausalityCode> = z.object({
  code: z.enum(turnCausalityCodeNameValues),
  entityType: z.enum([
    "campaign",
    "character",
    "session",
    "location",
    "route",
    "scene_object",
    "world_object",
    "actor",
    "npc",
    "faction",
    "information",
    "commodity",
    "world_event",
    "faction_move",
    "schedule_job",
    "memory",
  ]),
  targetId: z.string().trim().min(1).nullable(),
  delta: z.number().optional().nullable(),
  minutes: z.number().int().optional().nullable(),
  metadata: z.record(z.string(), z.unknown()).optional().nullable(),
});

const turnNarrationBoundsSchema: z.ZodType<TurnNarrationBounds> = z.object({
  requestedAdvanceMinutes: z.number().int().nullable(),
  committedAdvanceMinutes: z.number().int().min(0),
  availableAdvanceMinutes: z.number().int().min(0),
  wasCapped: z.boolean(),
  overrideText: z.string().trim().min(1).nullable(),
  isFastForward: z.boolean().optional(),
  interruptionReason: z.string().trim().min(1).nullable().optional(),
});

const stateCommitLogEntrySchema: z.ZodType<StateCommitLogEntry> = z.object({
  kind: z.enum(["check", "mutation", "simulation"]),
  mutationType: z
    .enum([
      "advance_time",
      "start_journey",
      "move_player",
      "arrive_at_destination",
      "turn_back_travel",
      "resolve_discovery_hook",
      "force_reveal_discovery",
      "adjust_currency",
      "record_actor_interaction",
      "record_local_interaction",
      "record_npc_interaction",
      "spawn_scene_aspect",
      "spawn_temporary_actor",
      "spawn_world_object",
      "spawn_environmental_item",
      "spawn_fiat_item",
      "commit_market_trade",
      "transfer_assets",
      "adjust_inventory",
      "adjust_relationship",
      "discover_information",
      "set_actor_state",
      "set_npc_state",
      "set_player_scene_focus",
      "set_scene_actor_presence",
      "update_world_object_state",
      "update_item_state",
      "update_character_state",
      "update_character_progression_track",
      "update_scene_object",
      "set_follow_state",
      "restore_health",
    ])
    .optional()
    .nullable(),
  status: z.enum(["applied", "rejected", "noop"]),
  reasonCode: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  metadata: z.record(z.string(), z.unknown()).superRefine((value, ctx) => {
    if (!value) {
      return;
    }

    if ("socialOutcome" in value && value.socialOutcome !== undefined) {
      const parsed = socialOutcomeSchema.safeParse(value.socialOutcome);
      if (!parsed.success) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Invalid socialOutcome in state commit log metadata.",
        });
      }
    }
  }).optional().nullable(),
});

const turnResultPayloadSchema: z.ZodType<TurnResultPayload> = z.object({
  stateVersionAfter: z.number().int().nullable(),
  changeCodes: z.array(turnCausalityCodeSchema),
  reasonCodes: z.array(turnCausalityCodeSchema),
  whatChanged: z.array(z.string()),
  why: z.array(z.string()),
  warnings: z.array(z.string()),
  stateCommitLog: z.array(stateCommitLogEntrySchema).optional().default([]),
  narrationBounds: turnNarrationBoundsSchema.optional().nullable(),
  pendingCheck: z
    .object({
      approachId: z.string(),
      stat: z.string().optional(),
      mode: z.enum(["normal", "advantage", "disadvantage"]),
      reason: z.string(),
      modifier: z.number().int(),
      dc: z.number().int().optional(),
    })
    .optional()
    .nullable(),
  checkResult: z
    .object({
      approachId: z.string(),
      stat: z.string().optional(),
      mode: z.enum(["normal", "advantage", "disadvantage"]),
      reason: z.string(),
      rolls: z.tuple([z.number().int(), z.number().int()]).optional(),
      rollPairs: z.array(z.tuple([z.number().int(), z.number().int()])),
      selectedRollPairIndex: z.number().int().nonnegative(),
      modifier: z.number().int(),
      total: z.number().int(),
      dc: z.number().int().optional(),
      outcome: z.enum(["success", "partial", "failure"]),
      consequences: z.array(z.string()).optional(),
    })
    .optional()
    .nullable(),
  rollback: z
    .object({
      previousState: campaignRuntimeStateSchema,
      previousSessionTurnCount: z.number().int(),
      createdMessageIds: z.array(z.string()),
      createdMemoryIds: z.array(z.string()),
      createdMemoryLinkIds: z.array(z.string()).default([]),
      discoveredInformation: z.array(
        z.object({
          id: z.string(),
          previousIsDiscovered: z.boolean(),
          previousDiscoveredAtTurn: z.number().int().nullable(),
        }),
      ),
      simulationInverses: z.array(
        z.object({
          table: z.string(),
          id: z.string(),
          field: z.string(),
          previousValue: z.unknown(),
          operation: z.enum(["update", "delete_created"]),
        }),
      ),
      processedEventIds: z.array(z.string()),
      cancelledMoveIds: z.array(z.string()),
      createdWorldEventIds: z.array(z.string()),
      createdFactionMoveIds: z.array(z.string()),
      createdScheduleJobIds: z.array(z.string()).default([]),
      createdActorIds: z.array(z.string()).default([]),
      createdTemporaryActorIds: z.array(z.string()),
      createdCommodityStackIds: z.array(z.string()),
      createdWorldObjectIds: z.array(z.string()).default([]),
    })
    .optional()
    .nullable(),
  clarification: z
    .object({
      question: z.string(),
      options: z.array(z.string()),
    })
    .optional()
    .nullable(),
  error: z
    .object({
      message: z.string(),
      code: z.string(),
    })
    .optional()
    .nullable(),
});

const versionedStateSchema = z.object({
  schemaVersion: z.literal(2),
  data: campaignRuntimeStateSchema,
});

const versionedFactionResourcesSchema = z.object({
  schemaVersion: z.literal(1),
  data: factionResourcesSchema,
});

const versionedTurnResultSchema = z.object({
  schemaVersion: z.literal(2),
  data: turnResultPayloadSchema,
});

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function approvalBandForValue(approval: number) {
  if (approval <= -3) {
    return "hostile" as const;
  }
  if (approval <= -1) {
    return "cold" as const;
  }
  if (approval >= 5) {
    return "trusted" as const;
  }
  if (approval >= 2) {
    return "warm" as const;
  }
  return "neutral" as const;
}

export function toCampaignRuntimeStateJson(state: CampaignRuntimeState) {
  return cloneJson({
    schemaVersion: 2,
    data: state,
  });
}

export function parseCampaignRuntimeStateJson(value: unknown): CampaignRuntimeState {
  const versioned = versionedStateSchema.safeParse(value);
  if (versioned.success) {
    return versioned.data.data;
  }

  return campaignRuntimeStateSchema.parse(value);
}

export function toFactionResourcesJson(resources: FactionResourcePool) {
  return cloneJson({
    schemaVersion: 1,
    data: resources,
  });
}

export function parseFactionResourcesJson(value: unknown): FactionResourcePool {
  const versioned = versionedFactionResourcesSchema.safeParse(value);
  if (versioned.success) {
    return versioned.data.data;
  }

  return factionResourcesSchema.parse(value);
}

export function toTurnResultPayloadJson(payload: TurnResultPayload): Prisma.InputJsonValue {
  return cloneJson({
    schemaVersion: 2,
    data: payload,
  }) as Prisma.InputJsonValue;
}

export function parseTurnResultPayloadJson(value: unknown): TurnResultPayload | null {
  if (value == null) {
    return null;
  }

  const versioned = versionedTurnResultSchema.safeParse(value);
  if (versioned.success) {
    return versioned.data.data;
  }

  if (
    typeof value === "object"
    && value !== null
    && !Array.isArray(value)
    && (
      "schemaVersion" in value
      || "stateVersionAfter" in value
      || "changeCodes" in value
      || "reasonCodes" in value
      || "stateCommitLog" in value
    )
  ) {
    return null;
  }

  const legacy = z
    .object({
      warnings: z.array(z.string()).default([]),
      checkResult: z.unknown().nullable().optional(),
      rollback: z.unknown().nullable().optional(),
    })
    .safeParse(value);

  if (!legacy.success) {
    return null;
  }

  return turnResultPayloadSchema.parse({
    stateVersionAfter: null,
    changeCodes: [],
    reasonCodes: [],
    whatChanged: [],
    why: [],
    warnings: legacy.data.warnings,
    stateCommitLog: [],
    pendingCheck: null,
    checkResult: legacy.data.checkResult ?? null,
    rollback: legacy.data.rollback ?? null,
    clarification: null,
    error: null,
  });
}
