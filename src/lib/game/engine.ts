import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { dmClient } from "@/lib/ai/provider";
import { FetchSynchronizationError } from "@/lib/game/errors";
import {
  fetchFactionIntel,
  fetchInformationConnections,
  fetchInformationDetail,
  fetchMarketPrices,
  fetchNpcDetail,
  fetchRelationshipHistory,
  getCampaignSnapshot,
  getPromptContext,
} from "@/lib/game/repository";
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
  LocalTextureSummary,
  PromotedNpcHydrationDraft,
  RequestClarificationToolCall,
  TurnFetchToolCall,
  TurnFetchToolResult,
  TurnResolution,
  TurnRollbackData,
  ValidatedTurnCommand,
} from "@/lib/game/types";
import { validateTurnCommand, TIME_MODE_BOUNDS } from "@/lib/game/validation";
import { env } from "@/lib/env";

type TurnStream = {
  narration?: (chunk: string) => void;
  checkResult?: (result: CheckResult) => void;
};

function dedupeStrings(values: string[]) {
  return Array.from(new Set(values.map((entry) => entry.trim()).filter(Boolean)));
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
    discoveredInformation: [],
    simulationInverses: [],
    processedEventIds: [],
    cancelledMoveIds: [],
    createdWorldEventIds: [],
    createdFactionMoveIds: [],
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
      hydrationClaimedAt: true,
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

  const [location, localNpcs, localInformation, temporaryActor, nearbyEdges] = await Promise.all([
    prisma.locationNode.findFirst({
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
    }),
    prisma.nPC.findMany({
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
    }),
    prisma.information.findMany({
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
    }),
    prisma.temporaryActor.findFirst({
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
    }),
    prisma.locationEdge.findMany({
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
    }),
  ]);

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
    await tx.nPC.update({
      where: { id: npc.id },
      data: {
        summary: draft.summary,
        description: draft.description,
        factionId: draft.factionId,
        isNarrativelyHydrated: true,
        hydrationClaimedAt: null,
      },
    });

    if (draft.information.length) {
      await tx.information.createMany({
        data: draft.information.map((lead) => ({
          id: `info_${randomUUID()}`,
          campaignId: input.campaignId,
          title: lead.title,
          summary: lead.summary,
          content: lead.content,
          truthfulness: lead.truthfulness,
          accessibility: lead.accessibility,
          locationId: lead.locationId,
          factionId: lead.factionId,
          sourceNpcId: npc.id,
        })),
      });
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
      hydrationClaimedAt: null,
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

async function applyPlayerActionEffects(input: {
  tx: Prisma.TransactionClient;
  snapshot: CampaignSnapshot;
  command: Exclude<ValidatedTurnCommand, RequestClarificationToolCall>;
  fetchedFacts: TurnFetchToolResult[];
  rollback: TurnRollbackData;
  nextTurnCount: number;
}) {
  const affectedFactionIds = new Set<string>();

  if (input.command.type === "execute_converse" && input.command.npcId && typeof input.command.approvalDelta === "number") {
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
            increment: input.command.approvalDelta,
          },
        },
      });
      if (npc.factionId) {
        affectedFactionIds.add(npc.factionId);
      }
    }
  }

  if ("discoverInformationIds" in input.command) {
    await applyInformationDiscoveries({
      tx: input.tx,
      snapshot: input.snapshot,
      ids: input.command.discoverInformationIds,
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

  return Array.from(affectedFactionIds);
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
  let generatedDays = 0;
  let firstWindow = true;

  while (windowStart < input.nextState.globalTime) {
    if (!firstWindow && windowStart % 1440 === 0 && generatedDays < 7) {
      await ensureDailyScheduleGenerated({
        tx: input.tx,
        snapshot: input.snapshot,
        dayStartTime: windowStart,
        rollback: input.rollback,
      });
      generatedDays += 1;
    }

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

async function commitResolvedTurn(input: {
  snapshot: CampaignSnapshot;
  sessionId: string;
  turnId: string;
  playerAction: string;
  command: Exclude<ValidatedTurnCommand, RequestClarificationToolCall>;
  fetchedFacts: TurnFetchToolResult[];
}) {
  const { snapshot, sessionId, turnId, playerAction, command, fetchedFacts } = input;
  const nextState = nextStateFromCommand(snapshot, command);
  const nextTurnCount = snapshot.sessionTurnCount + 1;
  const rollback = emptyRollback(snapshot);

  await prisma.$transaction(async (tx) => {
    const initialAffectedFactionIds = await applyPlayerActionEffects({
      tx,
      snapshot,
      command,
      fetchedFacts,
      rollback,
      nextTurnCount,
    });

    await runTemporalSimulation({
      tx,
      snapshot,
      nextState,
      rollback,
      initialAffectedFactionIds,
    });

    await tx.campaign.update({
      where: { id: snapshot.campaignId },
      data: {
        stateJson: nextState,
      },
    });

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

    if ("memorySummary" in command && command.memorySummary?.trim()) {
      const memory = await tx.memoryEntry.create({
        data: {
          campaignId: snapshot.campaignId,
          sessionId,
          type: "turn_memory",
          summary: command.memorySummary.trim(),
        },
      });
      rollback.createdMemoryIds.push(memory.id);
    }

    await tx.turn.update({
      where: { id: turnId },
      data: {
        status: "resolved",
        toolCallJson: toPrismaJsonValue(command),
        resultJson: toPrismaJsonValue({
          state: nextState,
          warnings: command.warnings,
          checkResult: command.checkResult ?? null,
          rollback,
        }),
      },
    });
  });
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
      const lockExpiry = new Date(Date.now() - 2 * 60 * 1000);
      const claimAttempt = await prisma.nPC.updateMany({
        where: {
          id: result.id,
          campaignId: snapshot.campaignId,
          socialLayer: "promoted_local",
          isNarrativelyHydrated: false,
          OR: [{ hydrationClaimedAt: null }, { hydrationClaimedAt: { lt: lockExpiry } }],
        },
        data: {
          hydrationClaimedAt: new Date(),
        },
      });

      if (claimAttempt.count === 1) {
        try {
          await hydratePromotedNpcRecord({
            campaignId: snapshot.campaignId,
            npcId: result.id,
          });
        } catch (error) {
          await prisma.nPC.updateMany({
            where: {
              id: result.id,
              campaignId: snapshot.campaignId,
              isNarrativelyHydrated: false,
            },
            data: {
              hydrationClaimedAt: null,
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
};

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

  const resolution: TurnResolution = await dmClient.runTurn({
    promptContext,
    character: snapshot.character,
    playerAction: input.playerAction,
    executeFetchTool: (call) => executeFetchTool(snapshot, call),
  });

  const validated = validateTurnCommand({
    snapshot,
    command: resolution.command,
    fetchedFacts: resolution.fetchedFacts,
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
    fetchedFacts: resolution.fetchedFacts,
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

  const resultJson =
    turn.resultJson && typeof turn.resultJson === "object" && !Array.isArray(turn.resultJson)
      ? (turn.resultJson as Record<string, unknown>)
      : null;
  const rollback =
    resultJson && resultJson.rollback && typeof resultJson.rollback === "object"
      ? (resultJson.rollback as TurnRollbackData)
      : null;

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
        stateJson: rollback.previousState as unknown as Prisma.JsonObject,
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
