import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import type {
  CampaignRuntimeState,
  NpcRoutineCondition,
  NpcState,
  SimulationInverse,
  SimulationPayload,
  StateCommitLogEntry,
  TurnCausalityCodeName,
  TurnCausalityCode,
} from "@/lib/game/types";

export const MAX_CASCADE_DEPTH = 3;

const npcRoutineConditionSchema: z.ZodType<NpcRoutineCondition> = z.lazy(() =>
  z.discriminatedUnion("type", [
    z.object({
      type: z.literal("location_state"),
      locationId: z.string().trim().min(1),
      state: z.string().trim().min(1),
    }),
    z.object({
      type: z.literal("faction_at_war"),
      factionId: z.string().trim().min(1),
    }),
    z.object({
      type: z.literal("actor_state"),
      actorId: z.string().trim().min(1),
      state: z.enum(["active", "wounded", "incapacitated", "dead"]),
    }),
    z.object({
      type: z.literal("npc_state"),
      npcId: z.string().trim().min(1),
      state: z.enum(["active", "wounded", "incapacitated", "dead"]),
    }),
    z.object({
      type: z.literal("time_range"),
      minMinutes: z.number().int().min(0),
      maxMinutes: z.number().int().min(0),
    }),
    z.object({
      type: z.literal("player_in_location"),
      locationId: z.string().trim().min(1),
    }),
    z.object({
      type: z.literal("and"),
      conditions: z.array(npcRoutineConditionSchema).min(1),
    }),
    z.object({
      type: z.literal("or"),
      conditions: z.array(npcRoutineConditionSchema).min(1),
    }),
  ]),
);

const simulationPayloadSchema: z.ZodType<SimulationPayload> = z.lazy(() =>
  z.discriminatedUnion("type", [
    z.object({
      type: z.literal("change_location_state"),
      locationId: z.string().trim().min(1),
      newState: z.string().trim().min(1),
    }),
    z.object({
      type: z.literal("change_faction_control"),
      locationId: z.string().trim().min(1),
      factionId: z.string().trim().min(1).nullable(),
    }),
    z.object({
      type: z.literal("change_actor_state"),
      actorId: z.string().trim().min(1),
      newState: z.enum(["active", "wounded", "incapacitated", "dead"]),
    }),
    z.object({
      type: z.literal("change_npc_state"),
      npcId: z.string().trim().min(1),
      newState: z.enum(["active", "wounded", "incapacitated", "dead"]),
    }),
    z.object({
      type: z.literal("change_faction_resources"),
      factionId: z.string().trim().min(1),
      delta: z.object({
        gold: z.number().int().optional(),
        military: z.number().int().optional(),
        influence: z.number().int().optional(),
        information: z.number().int().optional(),
      }),
    }),
    z.object({
      type: z.literal("spawn_world_event"),
      event: z.object({
        locationId: z.string().trim().min(1).nullable(),
        triggerTime: z.number().int(),
        description: z.string().trim().min(1),
        triggerCondition: npcRoutineConditionSchema.nullish(),
        payload: z.lazy(() =>
          z.discriminatedUnion("type", [
            z.object({
              type: z.literal("change_location_state"),
              locationId: z.string().trim().min(1),
              newState: z.string().trim().min(1),
            }),
            z.object({
              type: z.literal("change_faction_control"),
              locationId: z.string().trim().min(1),
              factionId: z.string().trim().min(1).nullable(),
            }),
            z.object({
              type: z.literal("change_actor_state"),
              actorId: z.string().trim().min(1),
              newState: z.enum(["active", "wounded", "incapacitated", "dead"]),
            }),
            z.object({
              type: z.literal("change_npc_state"),
              npcId: z.string().trim().min(1),
              newState: z.enum(["active", "wounded", "incapacitated", "dead"]),
            }),
            z.object({
              type: z.literal("change_faction_resources"),
              factionId: z.string().trim().min(1),
              delta: z.object({
                gold: z.number().int().optional(),
                military: z.number().int().optional(),
                influence: z.number().int().optional(),
                information: z.number().int().optional(),
              }),
            }),
            z.object({
              type: z.literal("spawn_information"),
              information: z.object({
                title: z.string().trim().min(1),
                summary: z.string().trim().min(1),
                content: z.string().trim().min(1),
                truthfulness: z.enum(["true", "partial", "false", "outdated"]),
                accessibility: z.enum(["public", "guarded", "secret"]),
                locationId: z.string().trim().min(1).nullable(),
                factionId: z.string().trim().min(1).nullable(),
                sourceNpcId: z.string().trim().min(1).nullable(),
                expiresAtTime: z.number().int().nullable().optional(),
              }),
            }),
            z.object({
              type: z.literal("cancel_faction_move"),
              factionMoveId: z.string().trim().min(1),
              reason: z.string().trim().min(1),
            }),
            z.object({
              type: z.literal("change_route_status"),
              edgeId: z.string().trim().min(1),
              newStatus: z.string().trim().min(1),
            }),
            z.object({
              type: z.literal("change_market_price"),
              marketPriceId: z.string().trim().min(1),
              newModifier: z.number().positive(),
            }),
            z.object({
              type: z.literal("transfer_location_control"),
              locationId: z.string().trim().min(1),
              fromFactionId: z.string().trim().min(1).nullable(),
              toFactionId: z.string().trim().min(1).nullable(),
            }),
            z.object({
              type: z.literal("change_actor_location"),
              actorId: z.string().trim().min(1),
              newLocationId: z.string().trim().min(1),
            }),
            z.object({
              type: z.literal("change_npc_location"),
              npcId: z.string().trim().min(1),
              newLocationId: z.string().trim().min(1),
            }),
          ]),
        ),
      }),
    }),
    z.object({
      type: z.literal("spawn_information"),
      information: z.object({
        title: z.string().trim().min(1),
        summary: z.string().trim().min(1),
        content: z.string().trim().min(1),
        truthfulness: z.enum(["true", "partial", "false", "outdated"]),
        accessibility: z.enum(["public", "guarded", "secret"]),
        locationId: z.string().trim().min(1).nullable(),
        factionId: z.string().trim().min(1).nullable(),
        sourceNpcId: z.string().trim().min(1).nullable(),
        expiresAtTime: z.number().int().nullable().optional(),
      }),
    }),
    z.object({
      type: z.literal("cancel_faction_move"),
      factionMoveId: z.string().trim().min(1),
      reason: z.string().trim().min(1),
    }),
    z.object({
      type: z.literal("change_route_status"),
      edgeId: z.string().trim().min(1),
      newStatus: z.string().trim().min(1),
    }),
    z.object({
      type: z.literal("change_market_price"),
      marketPriceId: z.string().trim().min(1),
      newModifier: z.number().positive(),
    }),
    z.object({
      type: z.literal("transfer_location_control"),
      locationId: z.string().trim().min(1),
      fromFactionId: z.string().trim().min(1).nullable(),
      toFactionId: z.string().trim().min(1).nullable(),
    }),
    z.object({
      type: z.literal("change_actor_location"),
      actorId: z.string().trim().min(1),
      newLocationId: z.string().trim().min(1),
    }),
    z.object({
      type: z.literal("change_npc_location"),
      npcId: z.string().trim().min(1),
      newLocationId: z.string().trim().min(1),
    }),
  ]),
);

function minuteOfDay(globalTime: number) {
  return ((globalTime % 1440) + 1440) % 1440;
}

function triggerFallsWithinWindow(previousTime: number, newTime: number, triggerTimeMinutes: number) {
  const previousMinute = minuteOfDay(previousTime);
  const newMinute = minuteOfDay(newTime);

  if (newTime - previousTime >= 1440) {
    return true;
  }

  if (previousMinute < newMinute) {
    return triggerTimeMinutes > previousMinute && triggerTimeMinutes <= newMinute;
  }

  if (previousMinute > newMinute) {
    return triggerTimeMinutes > previousMinute || triggerTimeMinutes <= newMinute;
  }

  return false;
}

function recordInverse(
  inverses: SimulationInverse[],
  table: string,
  id: string,
  field: string,
  previousValue: unknown,
) {
  inverses.push({
    table,
    id,
    field,
    previousValue,
    operation: "update",
  });
}

function recordCreated(
  inverses: SimulationInverse[],
  table: string,
  id: string,
) {
  inverses.push({
    table,
    id,
    field: "id",
    previousValue: null,
    operation: "delete_created",
  });
}

type SimulationOutcomeBucket = {
  stateCommitLog: StateCommitLogEntry[];
  changeCodes: TurnCausalityCode[];
};

function recordSimulationOutcome(input: {
  outcomes: SimulationOutcomeBucket;
  changeCode: TurnCausalityCodeName;
  summary: string;
  reasonCode: string;
  entityType: TurnCausalityCode["entityType"];
  targetId: string | null;
  label?: string;
  metadata?: Record<string, unknown> | null;
}) {
  const metadata = {
    label: input.label ?? input.summary,
    entityType: input.entityType,
    targetId: input.targetId,
    ...(input.metadata ?? {}),
  } as Record<string, unknown>;

  input.outcomes.stateCommitLog.push({
    kind: "simulation",
    mutationType: null,
    status: "applied",
    reasonCode: input.reasonCode,
    summary: input.summary,
    metadata,
  });
  input.outcomes.changeCodes.push({
    code: input.changeCode,
    entityType: input.entityType,
    targetId: input.targetId,
    metadata,
  });
}

export function parseNpcRoutineCondition(value: unknown) {
  return npcRoutineConditionSchema.safeParse(value);
}

export function parseSimulationPayload(value: unknown) {
  return simulationPayloadSchema.safeParse(value);
}

export async function evaluateNpcRoutineCondition(input: {
  tx: Prisma.TransactionClient;
  condition: NpcRoutineCondition | null;
  campaignId: string;
  playerState: CampaignRuntimeState;
}): Promise<boolean> {
  const { tx, condition, campaignId, playerState } = input;

  if (!condition) {
    return true;
  }

  switch (condition.type) {
    case "location_state": {
      const location = await tx.locationNode.findUnique({
        where: { id: condition.locationId },
        select: { state: true, campaignId: true },
      });
      return Boolean(location && location.campaignId === campaignId && location.state === condition.state);
    }
    case "faction_at_war": {
      const relation = await tx.factionRelation.findFirst({
        where: {
          campaignId,
          OR: [
            { factionAId: condition.factionId, stance: "war" },
            { factionBId: condition.factionId, stance: "war" },
          ],
        },
        select: { id: true },
      });
      return Boolean(relation);
    }
    case "actor_state": {
      const actor = await tx.actor.findUnique({
        where: { id: condition.actorId },
        select: { state: true, campaignId: true },
      });
      return Boolean(actor && actor.campaignId === campaignId && actor.state === condition.state);
    }
    case "npc_state": {
      const actor = await tx.actor.findFirst({
        where: {
          campaignId,
          profileNpcId: condition.npcId,
        },
        select: { state: true },
      });
      if (actor) {
        return actor.state === condition.state;
      }
      const npc = await tx.nPC.findUnique({
        where: { id: condition.npcId },
        select: { state: true, campaignId: true },
      });
      return Boolean(npc && npc.campaignId === campaignId && npc.state === condition.state);
    }
    case "time_range": {
      const now = minuteOfDay(playerState.globalTime);
      return now >= condition.minMinutes && now <= condition.maxMinutes;
    }
    case "player_in_location":
      return playerState.currentLocationId === condition.locationId;
    case "and": {
      for (const nested of condition.conditions) {
        if (!(await evaluateNpcRoutineCondition({ tx, condition: nested, campaignId, playerState }))) {
          return false;
        }
      }
      return true;
    }
    case "or": {
      for (const nested of condition.conditions) {
        if (await evaluateNpcRoutineCondition({ tx, condition: nested, campaignId, playerState })) {
          return true;
        }
      }
      return false;
    }
    default:
      return false;
  }
}

async function applyActorStateChange(input: {
  tx: Prisma.TransactionClient;
  actorId: string;
  newState: NpcState;
  inverses: SimulationInverse[];
  changedNpcStateIds: Set<string>;
  outcomes: SimulationOutcomeBucket;
}) {
  const actor = await input.tx.actor.findUnique({
    where: { id: input.actorId },
    select: { id: true, state: true, profileNpcId: true, displayLabel: true },
  });

  if (!actor || actor.state === input.newState) {
    return;
  }

  recordInverse(input.inverses, "actor", actor.id, "state", actor.state);
  await input.tx.actor.update({
    where: { id: actor.id },
    data: { state: input.newState },
  });
  if (actor.profileNpcId) {
    const npc = await input.tx.nPC.findUnique({
      where: { id: actor.profileNpcId },
      select: { id: true, state: true },
    });
    if (npc && npc.state !== input.newState) {
      recordInverse(input.inverses, "nPC", npc.id, "state", npc.state);
      await input.tx.nPC.update({
        where: { id: npc.id },
        data: { state: input.newState },
      });
      input.changedNpcStateIds.add(npc.id);
    }
  }
  recordSimulationOutcome({
    outcomes: input.outcomes,
    changeCode: "ACTOR_STATE_CHANGED",
    summary: `${actor.displayLabel} becomes ${input.newState}.`,
    reasonCode: "actor_state_changed",
    entityType: "actor",
    targetId: actor.id,
    label: actor.displayLabel,
    metadata: {
      actorId: actor.id,
      profileNpcId: actor.profileNpcId,
      previousState: actor.state,
      newState: input.newState,
    },
  });
}

async function applyNpcStateChange(input: {
  tx: Prisma.TransactionClient;
  npcId: string;
  newState: NpcState;
  inverses: SimulationInverse[];
  changedNpcStateIds: Set<string>;
  outcomes: SimulationOutcomeBucket;
}) {
  const embodiedActor = await input.tx.actor.findFirst({
    where: { profileNpcId: input.npcId },
    select: { id: true },
  });
  if (embodiedActor) {
    await applyActorStateChange({
      tx: input.tx,
      actorId: embodiedActor.id,
      newState: input.newState,
      inverses: input.inverses,
      changedNpcStateIds: input.changedNpcStateIds,
      outcomes: input.outcomes,
    });
    return;
  }
  const npc = await input.tx.nPC.findUnique({
    where: { id: input.npcId },
    select: { id: true, state: true, name: true },
  });

  if (!npc || npc.state === input.newState) {
    return;
  }

  recordInverse(input.inverses, "nPC", npc.id, "state", npc.state);
  await input.tx.nPC.update({
    where: { id: npc.id },
    data: { state: input.newState },
  });
  input.changedNpcStateIds.add(npc.id);
  recordSimulationOutcome({
    outcomes: input.outcomes,
    changeCode: "NPC_STATE_CHANGED",
    summary: `${npc.name} becomes ${input.newState}.`,
    reasonCode: "npc_state_changed",
    entityType: "npc",
    targetId: npc.id,
    label: npc.name,
    metadata: {
      npcId: npc.id,
      previousState: npc.state,
      newState: input.newState,
    },
  });
}

export async function applySimulationPayload(input: {
  tx: Prisma.TransactionClient;
  campaignId: string;
  payload: SimulationPayload;
  inverses: SimulationInverse[];
  createdWorldEventIds: string[];
  createdFactionMoveIds: string[];
  affectedFactionIds: Set<string>;
  changedLocationIds: Set<string>;
  changedNpcStateIds: Set<string>;
  outcomes: SimulationOutcomeBucket;
}): Promise<void> {
  const {
    tx,
    campaignId,
    payload,
    inverses,
    createdWorldEventIds,
    affectedFactionIds,
    changedLocationIds,
    changedNpcStateIds,
  } = input;

  switch (payload.type) {
    case "change_location_state": {
      const location = await tx.locationNode.findUnique({
        where: { id: payload.locationId },
        select: { id: true, state: true, name: true },
      });

      if (!location || location.state === payload.newState) {
        return;
      }

      recordInverse(inverses, "locationNode", location.id, "state", location.state);
      await tx.locationNode.update({
        where: { id: location.id },
        data: { state: payload.newState },
      });
      changedLocationIds.add(location.id);
      recordSimulationOutcome({
        outcomes: input.outcomes,
        changeCode: "LOCATION_STATE_CHANGED",
        summary: `${location.name} changes state to ${payload.newState}.`,
        reasonCode: "location_state_changed",
        entityType: "location",
        targetId: location.id,
        label: location.name,
        metadata: {
          locationId: location.id,
          previousState: location.state,
          newState: payload.newState,
        },
      });
      return;
    }
    case "change_faction_control": {
      const location = await tx.locationNode.findUnique({
        where: { id: payload.locationId },
        select: { id: true, controllingFactionId: true, name: true },
      });

      if (!location || location.controllingFactionId === payload.factionId) {
        return;
      }

      recordInverse(
        inverses,
        "locationNode",
        location.id,
        "controllingFactionId",
        location.controllingFactionId,
      );
      await tx.locationNode.update({
        where: { id: location.id },
        data: { controllingFactionId: payload.factionId },
      });
      if (location.controllingFactionId) {
        affectedFactionIds.add(location.controllingFactionId);
      }
      if (payload.factionId) {
        affectedFactionIds.add(payload.factionId);
      }
      changedLocationIds.add(location.id);
      recordSimulationOutcome({
        outcomes: input.outcomes,
        changeCode: "LOCATION_CONTROL_CHANGED",
        summary: payload.factionId
          ? `${location.name} shifts under the control of ${payload.factionId}.`
          : `${location.name} becomes uncontrolled.`,
        reasonCode: "location_control_changed",
        entityType: "location",
        targetId: location.id,
        label: location.name,
        metadata: {
          locationId: location.id,
          previousFactionId: location.controllingFactionId,
          newFactionId: payload.factionId,
        },
      });
      return;
    }
    case "change_actor_state":
      await applyActorStateChange({
        tx,
        actorId: payload.actorId,
        newState: payload.newState,
        inverses,
        changedNpcStateIds,
        outcomes: input.outcomes,
      });
      return;
    case "change_npc_state":
      await applyNpcStateChange({
        tx,
        npcId: payload.npcId,
        newState: payload.newState,
        inverses,
        changedNpcStateIds,
        outcomes: input.outcomes,
      });
      return;
    case "change_faction_resources": {
      const faction = await tx.faction.findUnique({
        where: { id: payload.factionId },
        select: { id: true, resources: true, name: true },
      });

      if (!faction || !faction.resources || typeof faction.resources !== "object" || Array.isArray(faction.resources)) {
        return;
      }

      const currentResources = faction.resources as Record<string, number>;
      const nextResources = {
        gold: currentResources.gold ?? 0,
        military: currentResources.military ?? 0,
        influence: currentResources.influence ?? 0,
        information: currentResources.information ?? 0,
      };

      for (const [key, value] of Object.entries(payload.delta)) {
        nextResources[key as keyof typeof nextResources] += value ?? 0;
      }

      recordInverse(inverses, "faction", faction.id, "resources", faction.resources);
      await tx.faction.update({
        where: { id: faction.id },
        data: {
          resources: nextResources as unknown as Prisma.JsonObject,
        },
      });
      affectedFactionIds.add(faction.id);
      recordSimulationOutcome({
        outcomes: input.outcomes,
        changeCode: "FACTION_RESOURCES_CHANGED",
        summary: `${faction.name} adjusts its resources.`,
        reasonCode: "faction_resources_changed",
        entityType: "faction",
        targetId: faction.id,
        label: faction.name,
        metadata: {
          factionId: faction.id,
          previousResources: faction.resources,
          nextResources,
        },
      });
      return;
    }
    case "spawn_world_event": {
      const eventId = `wevt_${randomUUID()}`;
      await tx.worldEvent.create({
        data: {
          id: eventId,
          campaignId,
          locationId: payload.event.locationId,
          triggerTime: payload.event.triggerTime,
          triggerCondition: payload.event.triggerCondition ?? Prisma.JsonNull,
          description: payload.event.description,
          payload: payload.event.payload as unknown as Prisma.JsonObject,
          isProcessed: false,
          isCancelled: false,
          cascadeDepth: 0,
        },
      });
      createdWorldEventIds.push(eventId);
      recordCreated(inverses, "worldEvent", eventId);
      recordSimulationOutcome({
        outcomes: input.outcomes,
        changeCode: "WORLD_EVENT_SPAWNED",
        summary: `${payload.event.description} is added to the world schedule.`,
        reasonCode: "world_event_spawned",
        entityType: "world_event",
        targetId: eventId,
        label: payload.event.description,
        metadata: {
          worldEventId: eventId,
          locationId: payload.event.locationId,
          triggerTime: payload.event.triggerTime,
        },
      });
      return;
    }
    case "spawn_information": {
      const informationId = `info_${randomUUID()}`;
      await tx.information.create({
        data: {
          id: informationId,
          campaignId,
          title: payload.information.title,
          summary: payload.information.summary,
          content: payload.information.content,
          truthfulness: payload.information.truthfulness,
          accessibility: payload.information.accessibility,
          locationId: payload.information.locationId,
          factionId: payload.information.factionId,
          sourceNpcId: payload.information.sourceNpcId,
          expiresAtTime: payload.information.expiresAtTime ?? null,
        },
      });
      recordCreated(inverses, "information", informationId);
      recordSimulationOutcome({
        outcomes: input.outcomes,
        changeCode: "INFORMATION_ADDED",
        summary: `${payload.information.title} enters the world as new information.`,
        reasonCode: "information_spawned",
        entityType: "information",
        targetId: informationId,
        label: payload.information.title,
        metadata: {
          informationId,
          truthfulness: payload.information.truthfulness,
          accessibility: payload.information.accessibility,
          locationId: payload.information.locationId,
          factionId: payload.information.factionId,
          sourceNpcId: payload.information.sourceNpcId,
          expiresAtTime: payload.information.expiresAtTime ?? null,
        },
      });
      return;
    }
    case "cancel_faction_move": {
      const move = await tx.factionMove.findUnique({
        where: { id: payload.factionMoveId },
        select: { id: true, isCancelled: true, cancellationReason: true },
      });

      if (!move || move.isCancelled) {
        return;
      }

      recordInverse(inverses, "factionMove", move.id, "isCancelled", move.isCancelled);
      recordInverse(
        inverses,
        "factionMove",
        move.id,
        "cancellationReason",
        move.cancellationReason,
      );
      await tx.factionMove.update({
        where: { id: move.id },
        data: {
          isCancelled: true,
          cancellationReason: payload.reason,
        },
      });
      recordSimulationOutcome({
        outcomes: input.outcomes,
        changeCode: "FACTION_MOVE_CANCELLED",
        summary: `${move.id} is cancelled: ${payload.reason}.`,
        reasonCode: "faction_move_cancelled",
        entityType: "faction_move",
        targetId: move.id,
        label: move.id,
        metadata: {
          factionMoveId: move.id,
          reason: payload.reason,
        },
      });
      return;
    }
    case "change_route_status": {
      const edge = await tx.locationEdge.findUnique({
        where: { id: payload.edgeId },
        select: { id: true, currentStatus: true },
      });

      if (!edge || edge.currentStatus === payload.newStatus) {
        return;
      }

      recordInverse(inverses, "locationEdge", edge.id, "currentStatus", edge.currentStatus);
      await tx.locationEdge.update({
        where: { id: edge.id },
        data: { currentStatus: payload.newStatus },
      });
      recordSimulationOutcome({
        outcomes: input.outcomes,
        changeCode: "ROUTE_STATUS_CHANGED",
        summary: `Route ${edge.id} changes status to ${payload.newStatus}.`,
        reasonCode: "route_status_changed",
        entityType: "route",
        targetId: edge.id,
        label: edge.id,
        metadata: {
          edgeId: edge.id,
          previousStatus: edge.currentStatus,
          newStatus: payload.newStatus,
        },
      });
      return;
    }
    case "change_market_price": {
      const price = await tx.marketPrice.findUnique({
        where: { id: payload.marketPriceId },
        select: { id: true, modifier: true, commodityId: true, locationId: true },
      });

      if (!price || price.modifier === payload.newModifier) {
        return;
      }

      recordInverse(inverses, "marketPrice", price.id, "modifier", price.modifier);
      await tx.marketPrice.update({
        where: { id: price.id },
        data: { modifier: payload.newModifier },
      });
      recordSimulationOutcome({
        outcomes: input.outcomes,
        changeCode: "MARKET_PRICE_CHANGED",
        summary: `Market price ${price.id} changes.`,
        reasonCode: "market_price_changed",
        entityType: "commodity",
        targetId: price.commodityId,
        label: price.id,
        metadata: {
          marketPriceId: price.id,
          commodityId: price.commodityId,
          locationId: price.locationId,
          previousModifier: price.modifier,
          newModifier: payload.newModifier,
        },
      });
      return;
    }
    case "transfer_location_control": {
      const location = await tx.locationNode.findUnique({
        where: { id: payload.locationId },
        select: { id: true, controllingFactionId: true, name: true },
      });

      if (!location || location.controllingFactionId === payload.toFactionId) {
        return;
      }

      recordInverse(
        inverses,
        "locationNode",
        location.id,
        "controllingFactionId",
        location.controllingFactionId,
      );
      await tx.locationNode.update({
        where: { id: location.id },
        data: { controllingFactionId: payload.toFactionId },
      });
      if (payload.fromFactionId) {
        affectedFactionIds.add(payload.fromFactionId);
      }
      if (payload.toFactionId) {
        affectedFactionIds.add(payload.toFactionId);
      }
      changedLocationIds.add(location.id);
      recordSimulationOutcome({
        outcomes: input.outcomes,
        changeCode: "LOCATION_CONTROL_CHANGED",
        summary: payload.toFactionId
          ? `${location.name} transfers control to ${payload.toFactionId}.`
          : `${location.name} becomes uncontrolled.`,
        reasonCode: "location_control_transferred",
        entityType: "location",
        targetId: location.id,
        label: location.name,
        metadata: {
          locationId: location.id,
          previousFactionId: location.controllingFactionId,
          fromFactionId: payload.fromFactionId,
          toFactionId: payload.toFactionId,
        },
      });
      return;
    }
    case "change_actor_location": {
      const actor = await tx.actor.findUnique({
        where: { id: payload.actorId },
        select: { id: true, currentLocationId: true, profileNpcId: true, displayLabel: true },
      });

      if (!actor || actor.currentLocationId === payload.newLocationId) {
        return;
      }

      recordInverse(inverses, "actor", actor.id, "currentLocationId", actor.currentLocationId);
      await tx.actor.update({
        where: { id: actor.id },
        data: { currentLocationId: payload.newLocationId },
      });
      if (actor.profileNpcId) {
        const npc = await tx.nPC.findUnique({
          where: { id: actor.profileNpcId },
          select: { id: true, currentLocationId: true, factionId: true },
        });
        if (npc) {
          if (npc.currentLocationId !== payload.newLocationId) {
            recordInverse(inverses, "nPC", npc.id, "currentLocationId", npc.currentLocationId);
            await tx.nPC.update({
              where: { id: npc.id },
              data: { currentLocationId: payload.newLocationId },
            });
          }
          if (npc.factionId) {
            affectedFactionIds.add(npc.factionId);
          }
        }
      } else {
        const temporaryActor = await tx.temporaryActor.findUnique({
          where: { id: actor.id },
          select: { id: true, currentLocationId: true },
        });
        if (temporaryActor && temporaryActor.currentLocationId !== payload.newLocationId) {
          recordInverse(inverses, "temporaryActor", temporaryActor.id, "currentLocationId", temporaryActor.currentLocationId);
          await tx.temporaryActor.update({
            where: { id: temporaryActor.id },
            data: { currentLocationId: payload.newLocationId },
          });
        }
      }
      recordSimulationOutcome({
        outcomes: input.outcomes,
        changeCode: "ACTOR_LOCATION_CHANGED",
        summary: `${actor.displayLabel} moves to ${payload.newLocationId}.`,
        reasonCode: "actor_location_changed",
        entityType: "actor",
        targetId: actor.id,
        label: actor.displayLabel,
        metadata: {
          actorId: actor.id,
          profileNpcId: actor.profileNpcId,
          previousLocationId: actor.currentLocationId,
          newLocationId: payload.newLocationId,
        },
      });
      return;
    }
    case "change_npc_location": {
      const actor = await tx.actor.findFirst({
        where: {
          campaignId,
          profileNpcId: payload.npcId,
        },
        select: { id: true },
      });
      if (actor) {
        await applySimulationPayload({
          ...input,
          payload: {
            type: "change_actor_location",
            actorId: actor.id,
            newLocationId: payload.newLocationId,
          },
        });
        return;
      }
      const npc = await tx.nPC.findUnique({
        where: { id: payload.npcId },
        select: { id: true, currentLocationId: true, factionId: true, name: true },
      });

      if (!npc || npc.currentLocationId === payload.newLocationId) {
        return;
      }

      recordInverse(inverses, "nPC", npc.id, "currentLocationId", npc.currentLocationId);
      await tx.nPC.update({
        where: { id: npc.id },
        data: { currentLocationId: payload.newLocationId },
      });
      if (npc.factionId) {
        affectedFactionIds.add(npc.factionId);
      }
      recordSimulationOutcome({
        outcomes: input.outcomes,
        changeCode: "NPC_LOCATION_CHANGED",
        summary: `${npc.name} moves to ${payload.newLocationId}.`,
        reasonCode: "npc_location_changed",
        entityType: "npc",
        targetId: npc.id,
        label: npc.name,
        metadata: {
          npcId: npc.id,
          previousLocationId: npc.currentLocationId,
          newLocationId: payload.newLocationId,
        },
      });
      return;
    }
  }
}

async function simulationPayloadInvalidationReason(input: {
  tx: Prisma.TransactionClient;
  campaignId: string;
  payload: SimulationPayload;
}): Promise<string | null> {
  const { tx, campaignId, payload } = input;

  switch (payload.type) {
    case "change_location_state":
    case "change_faction_control":
    case "transfer_location_control": {
      const location = await tx.locationNode.findFirst({
        where: { id: payload.locationId, campaignId },
        select: { id: true },
      });
      return location ? null : "Referenced location is no longer valid.";
    }
    case "change_actor_state":
    case "change_actor_location": {
      const actor = await tx.actor.findFirst({
        where: { id: payload.actorId, campaignId },
        select: { id: true, state: true },
      });
      if (!actor) {
        return "Referenced actor is no longer valid.";
      }
      if (actor.state === "dead" && payload.type === "change_actor_location") {
        return "Referenced actor is dead.";
      }
      return null;
    }
    case "change_npc_state":
    case "change_npc_location": {
      const npc = await tx.nPC.findFirst({
        where: { id: payload.npcId, campaignId },
        select: { id: true, state: true },
      });
      if (!npc) {
        return "Referenced NPC is no longer valid.";
      }
      if (npc.state === "dead" && payload.type === "change_npc_location") {
        return "Referenced NPC is dead.";
      }
      return null;
    }
    case "change_faction_resources": {
      const faction = await tx.faction.findFirst({
        where: { id: payload.factionId, campaignId },
        select: { id: true },
      });
      return faction ? null : "Referenced faction is no longer valid.";
    }
    case "spawn_world_event": {
      if (payload.event.locationId) {
        const location = await tx.locationNode.findFirst({
          where: { id: payload.event.locationId, campaignId },
          select: { id: true },
        });
        if (!location) {
          return "Referenced event location is no longer valid.";
        }
      }

      return simulationPayloadInvalidationReason({
        tx,
        campaignId,
        payload: payload.event.payload,
      });
    }
    case "spawn_information": {
      if (payload.information.locationId) {
        const location = await tx.locationNode.findFirst({
          where: { id: payload.information.locationId, campaignId },
          select: { id: true },
        });
        if (!location) {
          return "Referenced information location is no longer valid.";
        }
      }
      if (payload.information.factionId) {
        const faction = await tx.faction.findFirst({
          where: { id: payload.information.factionId, campaignId },
          select: { id: true },
        });
        if (!faction) {
          return "Referenced information faction is no longer valid.";
        }
      }
      if (payload.information.sourceNpcId) {
        const npc = await tx.nPC.findFirst({
          where: { id: payload.information.sourceNpcId, campaignId },
          select: { id: true, state: true },
        });
        if (!npc) {
          return "Referenced source NPC is no longer valid.";
        }
        if (npc.state === "dead") {
          return "Referenced source NPC is dead.";
        }
      }
      return null;
    }
    case "cancel_faction_move": {
      const move = await tx.factionMove.findFirst({
        where: { id: payload.factionMoveId, campaignId },
        select: { id: true },
      });
      return move ? null : "Referenced faction move is no longer valid.";
    }
    case "change_route_status": {
      const edge = await tx.locationEdge.findFirst({
        where: { id: payload.edgeId, campaignId },
        select: { id: true },
      });
      return edge ? null : "Referenced route is no longer valid.";
    }
    case "change_market_price": {
      const price = await tx.marketPrice.findFirst({
        where: { id: payload.marketPriceId, campaignId },
        select: { id: true },
      });
      return price ? null : "Referenced market price is no longer valid.";
    }
  }
}

async function cancelWorldEvent(input: {
  tx: Prisma.TransactionClient;
  eventId: string;
  isCancelled: boolean;
  cancellationReason: string | null;
  inverses: SimulationInverse[];
  reason: string;
  outcomes: SimulationOutcomeBucket;
  entityLabel: string;
}) {
  recordInverse(input.inverses, "worldEvent", input.eventId, "isCancelled", input.isCancelled);
  recordInverse(
    input.inverses,
    "worldEvent",
    input.eventId,
    "cancellationReason",
    input.cancellationReason,
  );
  await input.tx.worldEvent.update({
    where: { id: input.eventId },
    data: {
      isCancelled: true,
      cancellationReason: input.reason,
    },
  });
  recordSimulationOutcome({
    outcomes: input.outcomes,
    changeCode: "WORLD_EVENT_CANCELLED",
    summary: `${input.entityLabel} is cancelled: ${input.reason}.`,
    reasonCode: "world_event_cancelled",
    entityType: "world_event",
    targetId: input.eventId,
    label: input.entityLabel,
    metadata: {
      worldEventId: input.eventId,
      cancellationReason: input.reason,
    },
  });
}

async function cancelFactionMove(input: {
  tx: Prisma.TransactionClient;
  moveId: string;
  isCancelled: boolean;
  cancellationReason: string | null;
  inverses: SimulationInverse[];
  cancelledMoveIds?: string[];
  reason: string;
  outcomes: SimulationOutcomeBucket;
  entityLabel: string;
}) {
  recordInverse(input.inverses, "factionMove", input.moveId, "isCancelled", input.isCancelled);
  recordInverse(
    input.inverses,
    "factionMove",
    input.moveId,
    "cancellationReason",
    input.cancellationReason,
  );
  await input.tx.factionMove.update({
    where: { id: input.moveId },
    data: {
      isCancelled: true,
      cancellationReason: input.reason,
    },
  });
  input.cancelledMoveIds?.push(input.moveId);
  recordSimulationOutcome({
    outcomes: input.outcomes,
    changeCode: "FACTION_MOVE_CANCELLED",
    summary: `${input.entityLabel} is cancelled: ${input.reason}.`,
    reasonCode: "faction_move_cancelled",
    entityType: "faction_move",
    targetId: input.moveId,
    label: input.entityLabel,
    metadata: {
      factionMoveId: input.moveId,
      cancellationReason: input.reason,
    },
  });
}

export async function runSimulationTick(input: {
  tx: Prisma.TransactionClient;
  campaignId: string;
  playerState: CampaignRuntimeState;
  previousTime: number;
  newTime: number;
  inverses: SimulationInverse[];
  processedEventIds: string[];
  cancelledMoveIds: string[];
  createdWorldEventIds: string[];
  createdFactionMoveIds: string[];
  initialAffectedFactionIds?: string[];
  outcomes: SimulationOutcomeBucket;
}) {
  const {
    tx,
    campaignId,
    playerState,
    previousTime,
    newTime,
    inverses,
    processedEventIds,
    cancelledMoveIds,
    createdWorldEventIds,
    createdFactionMoveIds,
  } = input;
  const affectedFactionIds = new Set<string>(input.initialAffectedFactionIds ?? []);
  const changedLocationIds = new Set<string>();
  const changedNpcStateIds = new Set<string>();
  let unexpectedNpcMoves = 0;

  const routines = await tx.npcRoutine.findMany({
    where: { campaignId },
    include: {
      npc: true,
    },
    orderBy: [{ npcId: "asc" }, { priority: "desc" }, { triggerTimeMinutes: "asc" }],
  });
  const routineActors = await tx.actor.findMany({
    where: {
      campaignId,
      profileNpcId: {
        in: Array.from(new Set(routines.map((routine) => routine.npcId))),
      },
    },
    select: {
      id: true,
      profileNpcId: true,
      currentLocationId: true,
      state: true,
      displayLabel: true,
    },
  });
  const actorByNpcId = new Map(
    routineActors
      .filter((actor): actor is typeof actor & { profileNpcId: string } => actor.profileNpcId != null)
      .map((actor) => [actor.profileNpcId, actor]),
  );

  const routineByNpc = new Map<string, typeof routines[number]>();
  for (const routine of routines) {
    if (!triggerFallsWithinWindow(previousTime, newTime, routine.triggerTimeMinutes)) {
      continue;
    }

    const parsedCondition = routine.triggerCondition
      ? parseNpcRoutineCondition(routine.triggerCondition)
      : null;
    const condition =
      parsedCondition && parsedCondition.success ? parsedCondition.data : null;

    if (parsedCondition && !parsedCondition.success) {
      console.warn(`[sim.tick] Unknown routine condition for ${routine.id}; treated as false.`);
      continue;
    }

    const isSatisfied = await evaluateNpcRoutineCondition({
      tx,
      condition,
      campaignId,
      playerState,
    });

    if (!isSatisfied) {
      continue;
    }

    if (!routineByNpc.has(routine.npcId)) {
      routineByNpc.set(routine.npcId, routine);
    }
  }

  for (const routine of routineByNpc.values()) {
    const actor = actorByNpcId.get(routine.npcId);
    const currentState = actor?.state ?? routine.npc.state;
    const currentLocationId = actor?.currentLocationId ?? routine.npc.currentLocationId;
    if (currentState === "dead" || currentLocationId === routine.targetLocationId) {
      continue;
    }

    const previousLocationId = currentLocationId;
    if (actor) {
      await applySimulationPayload({
        tx,
        campaignId,
        payload: {
          type: "change_actor_location",
          actorId: actor.id,
          newLocationId: routine.targetLocationId,
        },
        inverses,
        createdWorldEventIds,
        createdFactionMoveIds,
        affectedFactionIds,
        changedLocationIds,
        changedNpcStateIds,
        outcomes: input.outcomes,
      });
    } else {
      recordInverse(inverses, "nPC", routine.npc.id, "currentLocationId", previousLocationId);
      await tx.nPC.update({
        where: { id: routine.npc.id },
        data: { currentLocationId: routine.targetLocationId },
      });
    }
    unexpectedNpcMoves += 1;
    if (routine.npc.factionId) {
      affectedFactionIds.add(routine.npc.factionId);
    }
    if (!actor) {
      recordSimulationOutcome({
        outcomes: input.outcomes,
        changeCode: "NPC_LOCATION_CHANGED",
        summary: `${routine.npc.name} moves to ${routine.targetLocationId}.`,
        reasonCode: "npc_routine_moved",
        entityType: "npc",
        targetId: routine.npc.id,
        label: routine.npc.name,
        metadata: {
          npcId: routine.npc.id,
          previousLocationId,
          newLocationId: routine.targetLocationId,
          routineId: routine.id,
        },
      });
    }
  }

  const dueEvents = await tx.worldEvent.findMany({
    where: {
      campaignId,
      triggerTime: {
        gt: previousTime,
        lte: newTime,
      },
      isProcessed: false,
      isCancelled: false,
    },
    orderBy: [{ triggerTime: "asc" }, { createdAt: "asc" }],
  });

  for (const event of dueEvents) {
    if (event.cascadeDepth >= MAX_CASCADE_DEPTH) {
      console.warn(`[sim.tick] Cascade depth limit reached at event ${event.id}.`);
      continue;
    }

    if (event.locationId) {
      const location = await tx.locationNode.findFirst({
        where: { id: event.locationId, campaignId },
        select: { id: true },
      });
      if (!location) {
        await cancelWorldEvent({
          tx,
          eventId: event.id,
          isCancelled: event.isCancelled,
          cancellationReason: event.cancellationReason,
          inverses,
          reason: "Referenced location is no longer valid.",
          outcomes: input.outcomes,
          entityLabel: event.description,
        });
        continue;
      }
    }

    const parsedCondition = event.triggerCondition
      ? parseNpcRoutineCondition(event.triggerCondition)
      : null;
      if (parsedCondition && !parsedCondition.success) {
        await cancelWorldEvent({
          tx,
          eventId: event.id,
          isCancelled: event.isCancelled,
          cancellationReason: event.cancellationReason,
          inverses,
          reason: "Trigger condition is no longer valid.",
          outcomes: input.outcomes,
          entityLabel: event.description,
        });
        continue;
      }

    const isSatisfied = await evaluateNpcRoutineCondition({
      tx,
      condition: parsedCondition?.data ?? null,
      campaignId,
      playerState,
    });

      if (!isSatisfied) {
        await cancelWorldEvent({
          tx,
          eventId: event.id,
          isCancelled: event.isCancelled,
          cancellationReason: event.cancellationReason,
          inverses,
          reason: "Trigger condition no longer holds at execution time.",
          outcomes: input.outcomes,
          entityLabel: event.description,
        });
        continue;
      }

    const parsedPayload = parseSimulationPayload(event.payload);
      if (!parsedPayload.success) {
        await cancelWorldEvent({
          tx,
          eventId: event.id,
          isCancelled: event.isCancelled,
          cancellationReason: event.cancellationReason,
          inverses,
          reason: `Event payload became invalid: ${parsedPayload.error.message}`,
          outcomes: input.outcomes,
          entityLabel: event.description,
        });
        continue;
      }

    const eventInvalidationReason = await simulationPayloadInvalidationReason({
      tx,
      campaignId,
      payload: parsedPayload.data,
    });
    if (eventInvalidationReason) {
      await cancelWorldEvent({
        tx,
        eventId: event.id,
        isCancelled: event.isCancelled,
        cancellationReason: event.cancellationReason,
        inverses,
        reason: eventInvalidationReason,
        outcomes: input.outcomes,
        entityLabel: event.description,
      });
      continue;
    }

    await applySimulationPayload({
      tx,
      campaignId,
      payload: parsedPayload.data,
      inverses,
      createdWorldEventIds,
      createdFactionMoveIds,
      affectedFactionIds,
      changedLocationIds,
      changedNpcStateIds,
      outcomes: input.outcomes,
    });

    recordInverse(inverses, "worldEvent", event.id, "isProcessed", event.isProcessed);
    await tx.worldEvent.update({
      where: { id: event.id },
      data: { isProcessed: true },
    });
    processedEventIds.push(event.id);
    recordSimulationOutcome({
      outcomes: input.outcomes,
      changeCode: "WORLD_EVENT_PROCESSED",
      summary: `${event.description} takes effect.`,
      reasonCode: "world_event_processed",
      entityType: "world_event",
      targetId: event.id,
      label: event.description,
      metadata: {
        worldEventId: event.id,
        triggerTime: event.triggerTime,
      },
    });
  }

  const dueMoves = await tx.factionMove.findMany({
    where: {
      campaignId,
      scheduledAtTime: {
        gt: previousTime,
        lte: newTime,
      },
      isExecuted: false,
      isCancelled: false,
    },
    include: {
      faction: true,
    },
    orderBy: [{ scheduledAtTime: "asc" }, { createdAt: "asc" }],
  });

  for (const move of dueMoves) {
    if (move.cascadeDepth >= MAX_CASCADE_DEPTH) {
      console.warn(`[sim.tick] Cascade depth limit reached at faction move ${move.id}.`);
      continue;
    }

    const parsedPayload = parseSimulationPayload(move.payload);
    if (!parsedPayload.success) {
      await cancelFactionMove({
        tx,
        moveId: move.id,
        isCancelled: move.isCancelled,
        cancellationReason: move.cancellationReason,
        inverses,
        cancelledMoveIds,
        reason: `Faction move payload became invalid: ${parsedPayload.error.message}`,
        outcomes: input.outcomes,
        entityLabel: move.description,
      });
      continue;
    }

    const moveInvalidationReason = await simulationPayloadInvalidationReason({
      tx,
      campaignId,
      payload: parsedPayload.data,
    });
    if (moveInvalidationReason) {
      await cancelFactionMove({
        tx,
        moveId: move.id,
        isCancelled: move.isCancelled,
        cancellationReason: move.cancellationReason,
        inverses,
        cancelledMoveIds,
        reason: moveInvalidationReason,
        outcomes: input.outcomes,
        entityLabel: move.description,
      });
      continue;
    }

    await applySimulationPayload({
      tx,
      campaignId,
      payload: parsedPayload.data,
      inverses,
      createdWorldEventIds,
      createdFactionMoveIds,
      affectedFactionIds,
      changedLocationIds,
      changedNpcStateIds,
      outcomes: input.outcomes,
    });

    recordInverse(inverses, "factionMove", move.id, "isExecuted", move.isExecuted);
    await tx.factionMove.update({
      where: { id: move.id },
      data: { isExecuted: true },
    });
    recordSimulationOutcome({
      outcomes: input.outcomes,
      changeCode: "FACTION_MOVE_EXECUTED",
      summary: `${move.description} takes effect.`,
      reasonCode: "faction_move_executed",
      entityType: "faction_move",
      targetId: move.id,
      label: move.description,
      metadata: {
        factionMoveId: move.id,
        scheduledAtTime: move.scheduledAtTime,
      },
    });
  }

  for (const factionId of affectedFactionIds) {
    const pendingMoves = await tx.factionMove.findMany({
      where: {
        campaignId,
        factionId,
        isExecuted: false,
        isCancelled: false,
      },
      orderBy: { scheduledAtTime: "asc" },
    });

    for (const move of pendingMoves) {
      await cancelFactionMove({
        tx,
        moveId: move.id,
        isCancelled: move.isCancelled,
        cancellationReason: move.cancellationReason,
        inverses,
        cancelledMoveIds,
        reason: "Superseded by fresh faction reaction.",
        outcomes: input.outcomes,
        entityLabel: move.description,
      });
    }

    const reactionMoveId = `fmove_${randomUUID()}`;
    await tx.factionMove.create({
      data: {
        id: reactionMoveId,
        campaignId,
        factionId,
        scheduledAtTime: newTime + 60,
        description: "The faction quietly reorganizes after recent upheaval.",
        payload: {
          type: "change_faction_resources",
          factionId,
          delta: {
            information: 1,
          },
        },
        cascadeDepth: 1,
      },
    });
    createdFactionMoveIds.push(reactionMoveId);
    recordCreated(inverses, "factionMove", reactionMoveId);
  }

  const expiringInformation = await tx.information.findMany({
    where: {
      campaignId,
      expiresAtTime: {
        lte: newTime,
      },
      truthfulness: {
        not: "outdated",
      },
    },
  });

  for (const information of expiringInformation) {
    recordInverse(inverses, "information", information.id, "truthfulness", information.truthfulness);
    await tx.information.update({
      where: { id: information.id },
      data: { truthfulness: "outdated" },
    });
    recordSimulationOutcome({
      outcomes: input.outcomes,
      changeCode: "INFORMATION_EXPIRED",
      summary: `${information.title} becomes outdated.`,
      reasonCode: "information_expired",
      entityType: "information",
      targetId: information.id,
      label: information.title,
      metadata: {
        informationId: information.id,
        previousTruthfulness: information.truthfulness,
      },
    });

    const links = await tx.informationLink.findMany({
      where: {
        campaignId,
        sourceId: information.id,
        linkType: {
          in: ["supports", "extends"],
        },
      },
    });

    for (const link of links) {
      const target = await tx.information.findUnique({
        where: { id: link.targetId },
        select: { id: true, truthfulness: true },
      });

      if (!target || target.truthfulness === "partial") {
        continue;
      }

      recordInverse(inverses, "information", target.id, "truthfulness", target.truthfulness);
      await tx.information.update({
        where: { id: target.id },
        data: { truthfulness: "partial" },
      });
    }
  }

  const restocks = await tx.marketPrice.findMany({
    where: {
      campaignId,
      restockTime: {
        lte: newTime,
      },
    },
  });

  for (const price of restocks) {
    recordInverse(inverses, "marketPrice", price.id, "stock", price.stock);
    recordInverse(inverses, "marketPrice", price.id, "restockTime", price.restockTime);
    await tx.marketPrice.update({
      where: { id: price.id },
      data: {
        stock: price.stock === -1 ? -1 : Math.max(price.stock, 5),
        restockTime: null,
      },
    });
    recordSimulationOutcome({
      outcomes: input.outcomes,
      changeCode: "MARKET_RESTOCKED",
      summary: `Market supply replenishes for ${price.id}.`,
      reasonCode: "market_restocked",
      entityType: "commodity",
      targetId: price.commodityId,
      label: price.id,
      metadata: {
        marketPriceId: price.id,
        commodityId: price.commodityId,
        locationId: price.locationId,
        previousStock: price.stock,
      },
    });
  }

  if (affectedFactionIds.size > 2 || changedLocationIds.size > 3 || unexpectedNpcMoves > 5) {
    console.warn("[sim.tick] Stability threshold exceeded. Possible cascade loop.");
  }
}

export async function applySimulationInverse(
  tx: Prisma.TransactionClient,
  inverse: SimulationInverse,
) {
  if (inverse.operation === "delete_created") {
    switch (inverse.table) {
      case "worldEvent":
        await tx.worldEvent.delete({ where: { id: inverse.id } });
        return;
      case "factionMove":
        await tx.factionMove.delete({ where: { id: inverse.id } });
        return;
      case "information":
        await tx.information.delete({ where: { id: inverse.id } });
        return;
      case "nPC":
        await tx.nPC.delete({ where: { id: inverse.id } });
        return;
      case "actor":
        await tx.actor.delete({ where: { id: inverse.id } });
        return;
      case "temporaryActor":
        await tx.temporaryActor.delete({ where: { id: inverse.id } });
        return;
      case "itemInstance":
        await tx.itemInstance.delete({ where: { id: inverse.id } });
        return;
      case "itemTemplate":
        await tx.itemTemplate.delete({ where: { id: inverse.id } });
        return;
      case "characterCommodityStack":
        await tx.characterCommodityStack.delete({ where: { id: inverse.id } });
        return;
      case "worldObject":
        await tx.worldObject.delete({ where: { id: inverse.id } });
        return;
      case "scheduleGenerationJob":
        await tx.scheduleGenerationJob.delete({ where: { id: inverse.id } });
        return;
      default:
        return;
    }
  }

  switch (inverse.table) {
    case "campaign":
      await tx.campaign.update({
        where: { id: inverse.id },
        data: { [inverse.field]: inverse.previousValue } as never,
      });
      return;
    case "session":
      await tx.session.update({
        where: { id: inverse.id },
        data: { [inverse.field]: inverse.previousValue } as never,
      });
      return;
    case "characterInstance":
      await tx.characterInstance.update({
        where: { id: inverse.id },
        data: { [inverse.field]: inverse.previousValue } as never,
      });
      return;
    case "nPC":
      await tx.nPC.update({
        where: { id: inverse.id },
        data: { [inverse.field]: inverse.previousValue } as never,
      });
      return;
    case "actor":
      await tx.actor.update({
        where: { id: inverse.id },
        data: { [inverse.field]: inverse.previousValue } as never,
      });
      return;
    case "locationNode":
      await tx.locationNode.update({
        where: { id: inverse.id },
        data: { [inverse.field]: inverse.previousValue } as never,
      });
      return;
    case "locationEdge":
      await tx.locationEdge.update({
        where: { id: inverse.id },
        data: { [inverse.field]: inverse.previousValue } as never,
      });
      return;
    case "faction":
      await tx.faction.update({
        where: { id: inverse.id },
        data: { [inverse.field]: inverse.previousValue } as never,
      });
      return;
    case "information":
      await tx.information.update({
        where: { id: inverse.id },
        data: { [inverse.field]: inverse.previousValue } as never,
      });
      return;
    case "marketPrice":
      await tx.marketPrice.update({
        where: { id: inverse.id },
        data: { [inverse.field]: inverse.previousValue } as never,
      });
      return;
    case "worldEvent":
      await tx.worldEvent.update({
        where: { id: inverse.id },
        data: { [inverse.field]: inverse.previousValue } as never,
      });
      return;
    case "factionMove":
      await tx.factionMove.update({
        where: { id: inverse.id },
        data: { [inverse.field]: inverse.previousValue } as never,
      });
      return;
    case "temporaryActor":
      await tx.temporaryActor.update({
        where: { id: inverse.id },
        data: { [inverse.field]: inverse.previousValue } as never,
      });
      return;
    case "worldObject":
      await tx.worldObject.update({
        where: { id: inverse.id },
        data: { [inverse.field]: inverse.previousValue } as never,
      });
      return;
    case "itemInstance":
      await tx.itemInstance.update({
        where: { id: inverse.id },
        data: { [inverse.field]: inverse.previousValue } as never,
      });
      return;
    case "itemTemplate":
      await tx.itemTemplate.update({
        where: { id: inverse.id },
        data: { [inverse.field]: inverse.previousValue } as never,
      });
      return;
    case "characterCommodityStack":
      await tx.characterCommodityStack.update({
        where: { id: inverse.id },
        data: { [inverse.field]: inverse.previousValue } as never,
      });
      return;
    default:
      return;
  }
}
