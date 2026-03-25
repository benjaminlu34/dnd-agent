import { z } from "zod";
import type {
  CampaignRuntimeState,
  FactionResourcePool,
  TurnCausalityCode,
  TurnCausalityCodeName,
  TurnNarrationBounds,
  TurnResultPayload,
} from "@/lib/game/types";

const campaignRuntimeStateSchema = z.object({
  currentLocationId: z.string().trim().min(1),
  globalTime: z.number().int().min(0),
  pendingTurnId: z.string().trim().min(1).nullable(),
  lastActionSummary: z.string().trim().min(1).nullable(),
  customTitle: z.string().trim().min(1).nullable().optional(),
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
  "NPC_APPROVAL_CHANGED",
  "INFORMATION_DISCOVERED",
  "NPC_STATE_CHANGED",
  "CHARACTER_HEALTH_CHANGED",
  "ROUTE_STATUS_CHANGED",
  "LOCATION_STATE_CHANGED",
  "LOCATION_CONTROL_CHANGED",
  "FACTION_RESOURCES_CHANGED",
  "WORLD_EVENT_CANCELLED",
  "WORLD_EVENT_PROCESSED",
  "FACTION_MOVE_CANCELLED",
  "FACTION_MOVE_EXECUTED",
  "MARKET_PRICE_CHANGED",
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
});

const turnResultPayloadSchema: z.ZodType<TurnResultPayload> = z.object({
  stateVersionAfter: z.number().int().nullable(),
  changeCodes: z.array(turnCausalityCodeSchema),
  reasonCodes: z.array(turnCausalityCodeSchema),
  whatChanged: z.array(z.string()),
  why: z.array(z.string()),
  warnings: z.array(z.string()),
  narrationBounds: turnNarrationBoundsSchema.optional().nullable(),
  checkResult: z
    .object({
      stat: z.enum(["strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma"]),
      mode: z.enum(["normal", "advantage", "disadvantage"]),
      reason: z.string(),
      rolls: z.tuple([z.number().int(), z.number().int()]),
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
      createdTemporaryActorIds: z.array(z.string()),
      createdCommodityStackIds: z.array(z.string()),
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

export function toTurnResultPayloadJson(payload: TurnResultPayload) {
  return cloneJson({
    schemaVersion: 2,
    data: payload,
  });
}

export function parseTurnResultPayloadJson(value: unknown): TurnResultPayload | null {
  if (value == null) {
    return null;
  }

  const versioned = versionedTurnResultSchema.safeParse(value);
  if (versioned.success) {
    return versioned.data.data;
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
    checkResult: legacy.data.checkResult ?? null,
    rollback: legacy.data.rollback ?? null,
    clarification: null,
    error: null,
  });
}
