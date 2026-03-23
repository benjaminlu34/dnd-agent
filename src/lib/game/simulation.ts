import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import type {
  CampaignRuntimeState,
  NpcRoutineCondition,
  NpcState,
  SimulationInverse,
  SimulationPayload,
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
    case "npc_state": {
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

async function applyNpcStateChange(input: {
  tx: Prisma.TransactionClient;
  npcId: string;
  newState: NpcState;
  inverses: SimulationInverse[];
  changedNpcStateIds: Set<string>;
}) {
  const npc = await input.tx.nPC.findUnique({
    where: { id: input.npcId },
    select: { id: true, state: true },
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
        select: { id: true, state: true },
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
      return;
    }
    case "change_faction_control": {
      const location = await tx.locationNode.findUnique({
        where: { id: payload.locationId },
        select: { id: true, controllingFactionId: true },
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
      return;
    }
    case "change_npc_state":
      await applyNpcStateChange({
        tx,
        npcId: payload.npcId,
        newState: payload.newState,
        inverses,
        changedNpcStateIds,
      });
      return;
    case "change_faction_resources": {
      const faction = await tx.faction.findUnique({
        where: { id: payload.factionId },
        select: { id: true, resources: true },
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
      return;
    }
    case "change_market_price": {
      const price = await tx.marketPrice.findUnique({
        where: { id: payload.marketPriceId },
        select: { id: true, modifier: true },
      });

      if (!price || price.modifier === payload.newModifier) {
        return;
      }

      recordInverse(inverses, "marketPrice", price.id, "modifier", price.modifier);
      await tx.marketPrice.update({
        where: { id: price.id },
        data: { modifier: payload.newModifier },
      });
      return;
    }
    case "transfer_location_control": {
      const location = await tx.locationNode.findUnique({
        where: { id: payload.locationId },
        select: { id: true, controllingFactionId: true },
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
      return;
    }
    case "change_npc_location": {
      const npc = await tx.nPC.findUnique({
        where: { id: payload.npcId },
        select: { id: true, currentLocationId: true, factionId: true },
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
      return;
    }
  }
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
    if (routine.npc.state === "dead" || routine.npc.currentLocationId === routine.targetLocationId) {
      continue;
    }

    recordInverse(inverses, "nPC", routine.npc.id, "currentLocationId", routine.npc.currentLocationId);
    await tx.nPC.update({
      where: { id: routine.npc.id },
      data: { currentLocationId: routine.targetLocationId },
    });
    unexpectedNpcMoves += 1;
    if (routine.npc.factionId) {
      affectedFactionIds.add(routine.npc.factionId);
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

    const parsedCondition = event.triggerCondition
      ? parseNpcRoutineCondition(event.triggerCondition)
      : null;
    if (parsedCondition && !parsedCondition.success) {
      console.warn(`[sim.tick] Unknown event trigger condition for ${event.id}; treated as false.`);
      continue;
    }

    const isSatisfied = await evaluateNpcRoutineCondition({
      tx,
      condition: parsedCondition?.data ?? null,
      campaignId,
      playerState,
    });

    if (!isSatisfied) {
      continue;
    }

    const parsedPayload = parseSimulationPayload(event.payload);
    if (!parsedPayload.success) {
      throw new Error(`Invalid world event payload for ${event.id}: ${parsedPayload.error.message}`);
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
    });

    recordInverse(inverses, "worldEvent", event.id, "isProcessed", event.isProcessed);
    await tx.worldEvent.update({
      where: { id: event.id },
      data: { isProcessed: true },
    });
    processedEventIds.push(event.id);
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
      throw new Error(`Invalid faction move payload for ${move.id}: ${parsedPayload.error.message}`);
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
    });

    recordInverse(inverses, "factionMove", move.id, "isExecuted", move.isExecuted);
    await tx.factionMove.update({
      where: { id: move.id },
      data: { isExecuted: true },
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
          cancellationReason: "Superseded by fresh faction reaction.",
        },
      });
      cancelledMoveIds.push(move.id);
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
      case "temporaryActor":
        await tx.temporaryActor.delete({ where: { id: inverse.id } });
        return;
      case "characterCommodityStack":
        await tx.characterCommodityStack.delete({ where: { id: inverse.id } });
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
