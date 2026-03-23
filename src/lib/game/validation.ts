import { rollCheck } from "@/lib/game/checks";
import type {
  CampaignSnapshot,
  CitedEntities,
  ExecuteFreeformToolCall,
  TimeMode,
  TurnActionToolCall,
  ValidatedTurnCommand,
} from "@/lib/game/types";

export const TIME_MODE_BOUNDS: Record<TimeMode, { min: number; max: number }> = {
  combat: { min: 1, max: 10 },
  exploration: { min: 5, max: 240 },
  travel: { min: 0, max: 0 },
  rest: { min: 0, max: 0 },
  downtime: { min: 60, max: 2880 },
};

function normalizedSuggestedActions(actions: string[] | undefined) {
  return Array.from(
    new Set((actions ?? []).map((entry) => entry.trim()).filter(Boolean)),
  ).slice(0, 4);
}

function getAllowedEntities(snapshot: CampaignSnapshot) {
  const locationIds = new Set<string>([
    snapshot.currentLocation.id,
    ...snapshot.adjacentRoutes.map((route) => route.targetLocationId),
  ]);
  const npcIds = new Set(snapshot.presentNpcs.map((npc) => npc.id));
  const factionIds = new Set(snapshot.knownFactions.map((faction) => faction.id));
  const informationIds = new Set(
    snapshot.localInformation
      .map((information) => information.id)
      .concat(snapshot.discoveredInformation.map((information) => information.id))
      .concat(snapshot.connectedLeads.map((lead) => lead.information.id)),
  );

  return { locationIds, npcIds, factionIds, informationIds };
}

function assertCitedEntities(
  citedEntities: CitedEntities,
  snapshot: CampaignSnapshot,
  warnings: string[],
) {
  const allowed = getAllowedEntities(snapshot);

  for (const npcId of citedEntities.npcIds) {
    if (!allowed.npcIds.has(npcId)) {
      throw new Error(`Hallucinated NPC citation: ${npcId}.`);
    }
  }

  for (const locationId of citedEntities.locationIds) {
    if (!allowed.locationIds.has(locationId)) {
      throw new Error(`Hallucinated location citation: ${locationId}.`);
    }
  }

  for (const factionId of citedEntities.factionIds) {
    if (!allowed.factionIds.has(factionId)) {
      throw new Error(`Hallucinated faction citation: ${factionId}.`);
    }
  }

  for (const informationId of citedEntities.informationIds) {
    if (!allowed.informationIds.has(informationId)) {
      throw new Error(`Hallucinated information citation: ${informationId}.`);
    }
  }

  if (citedEntities.commodityIds.length) {
    warnings.push("Commodity citations are currently ignored because trading is deferred.");
  }
}

function assertTime(command: Exclude<TurnActionToolCall, { type: "request_clarification" }>, snapshot: CampaignSnapshot) {
  const bounds = TIME_MODE_BOUNDS[command.timeMode];

  if (!bounds) {
    throw new Error(`Unknown time mode: ${String(command.timeMode)}.`);
  }

  if (command.type === "execute_travel") {
    const route = snapshot.adjacentRoutes.find((entry) => entry.id === command.routeEdgeId);

    if (!route) {
      throw new Error("Travel route is not adjacent to the player's current location.");
    }

    if (route.targetLocationId !== command.targetLocationId) {
      throw new Error("Travel target does not match the selected route.");
    }

    if (command.timeElapsed !== route.travelTimeMinutes) {
      throw new Error("Travel time must be derived from the route travelTimeMinutes.");
    }

    return;
  }

  if (command.timeElapsed < bounds.min || command.timeElapsed > bounds.max) {
    throw new Error(
      `${command.type} produced ${command.timeElapsed} minutes, outside ${command.timeMode} bounds.`,
    );
  }
}

function validateInteractionTarget(snapshot: CampaignSnapshot, command: TurnActionToolCall) {
  if (command.type === "execute_converse") {
    if (command.npcId) {
      if (!snapshot.presentNpcs.some((npc) => npc.id === command.npcId)) {
        throw new Error("Cannot converse with an NPC who is not present.");
      }
    } else if (!command.interlocutor.trim()) {
      throw new Error("Converse actions without npcId must name the local interlocutor.");
    }
  }

  if (command.type === "execute_investigate" && command.targetType === "npc") {
    if (!snapshot.presentNpcs.some((npc) => npc.id === command.targetId)) {
      throw new Error("Cannot investigate an NPC who is not present.");
    }
  }

  if (command.type === "execute_observe" && command.targetType === "npc") {
    if (!snapshot.presentNpcs.some((npc) => npc.id === command.targetId)) {
      throw new Error("Cannot observe an NPC who is not present.");
    }
  }
}

function validateInformationDiscoveries(snapshot: CampaignSnapshot, ids: string[] | undefined) {
  if (!ids?.length) {
    return;
  }

  const accessibleIds = new Set(
    snapshot.localInformation.map((entry) => entry.id).concat(
      snapshot.discoveredInformation.map((entry) => entry.id),
      snapshot.connectedLeads.map((lead) => lead.information.id),
    ),
  );

  for (const id of ids) {
    if (!accessibleIds.has(id)) {
      throw new Error(`Information ${id} is outside the local/discovered bubble.`);
    }
  }
}

function validateFreeform(command: ExecuteFreeformToolCall) {
  if (!command.statToCheck) {
    throw new Error("execute_freeform requires statToCheck.");
  }

  if (!command.intendedMechanicalOutcome.trim()) {
    throw new Error("execute_freeform requires intendedMechanicalOutcome.");
  }

  if (command.estimatedTimeElapsedMinutes !== command.timeElapsed) {
    throw new Error("execute_freeform estimatedTimeElapsedMinutes must match timeElapsed in pass 1.");
  }
}

export function validateTurnCommand(input: {
  snapshot: CampaignSnapshot;
  command: TurnActionToolCall;
}): ValidatedTurnCommand {
  const { snapshot, command } = input;

  if (command.type === "request_clarification") {
    return {
      ...command,
      options: command.options.map((entry) => entry.trim()).filter(Boolean).slice(0, 4),
      question: command.question.trim(),
    };
  }

  const warnings: string[] = [];
  validateInteractionTarget(snapshot, command);
  validateInformationDiscoveries(snapshot, "discoverInformationIds" in command ? command.discoverInformationIds : undefined);
  assertTime(command, snapshot);
  assertCitedEntities(command.citedEntities, snapshot, warnings);

  const suggestedActions = normalizedSuggestedActions(command.suggestedActions);
  if (!suggestedActions.length) {
    warnings.push("Tool call returned no suggested actions; engine provided none.");
  }

  if (command.type === "execute_freeform") {
    validateFreeform(command);
    const checkResult = rollCheck({
      stat: command.statToCheck,
      mode: "normal",
      reason: command.actionDescription,
      character: snapshot.character,
    });

    return {
      ...command,
      suggestedActions,
      warnings,
      checkResult,
    };
  }

  return {
    ...command,
    suggestedActions,
    warnings,
  };
}
