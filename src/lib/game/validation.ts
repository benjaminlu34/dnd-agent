import { rollCheck } from "@/lib/game/checks";
import type {
  CampaignSnapshot,
  CitedEntities,
  ExecuteCombatToolCall,
  ExecuteFreeformToolCall,
  TimeMode,
  TurnActionToolCall,
  TurnFetchToolResult,
  ValidatedTurnCommand,
  WorldFidelityIssue,
} from "@/lib/game/types";

export const TIME_MODE_BOUNDS: Record<TimeMode, { min: number; max: number }> = {
  combat: { min: 1, max: 10 },
  exploration: { min: 5, max: 240 },
  travel: { min: 0, max: 0 },
  rest: { min: 0, max: 0 },
  downtime: { min: 60, max: 2880 },
};

const REST_DURATIONS = {
  light: 360,
  full: 480,
} as const;

function normalizeLooseText(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function normalizedEntityId(value: string) {
  const trimmed = value.trim();
  const parts = trimmed.split(":");
  return parts.length >= 3 ? parts.slice(2).join(":") : trimmed;
}

function idsReferToSameEntity(left: string | null | undefined, right: string | null | undefined) {
  if (!left || !right) {
    return false;
  }

  return left === right || normalizedEntityId(left) === normalizedEntityId(right);
}

function normalizedSuggestedActions(actions: string[] | undefined) {
  return Array.from(new Set((actions ?? []).map((entry) => entry.trim()).filter(Boolean))).slice(
    0,
    4,
  );
}

function findPresentNpc(snapshot: CampaignSnapshot, npcId: string) {
  return snapshot.presentNpcs.find((npc) => idsReferToSameEntity(npc.id, npcId)) ?? null;
}

function npcRequiresDetailFetch(snapshot: CampaignSnapshot, npcId: string) {
  const npc = findPresentNpc(snapshot, npcId);
  if (!npc) {
    return null;
  }

  return npc.socialLayer === "promoted_local" && !npc.isNarrativelyHydrated ? npc : null;
}

function hasHydratedNpcDetailFact(fetchedFacts: TurnFetchToolResult[], npcId: string) {
  return fetchedFacts.some(
    (fact) =>
      fact.type === "fetch_npc_detail"
      && idsReferToSameEntity(fact.result.id, npcId)
      && fact.result.isNarrativelyHydrated,
  );
}

function assertNpcDetailFetchedIfRequired(
  snapshot: CampaignSnapshot,
  npcId: string,
  fetchedFacts: TurnFetchToolResult[],
) {
  const npc = npcRequiresDetailFetch(snapshot, npcId);
  if (npc && !hasHydratedNpcDetailFact(fetchedFacts, npc.id)) {
    throw new Error(`NPC detail must be fetched before acting on ${npc.name}.`);
  }
}

function fetchedMarketPrices(fetchedFacts: TurnFetchToolResult[]) {
  return fetchedFacts.flatMap((fact) =>
    fact.type === "fetch_market_prices" ? fact.result : [],
  );
}

function getAllowedEntities(snapshot: CampaignSnapshot, fetchedFacts: TurnFetchToolResult[]) {
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
  const commodityIds = new Set<string>();

  for (const fact of fetchedFacts) {
    if (fact.type === "fetch_npc_detail") {
      npcIds.add(fact.result.id);
      if (fact.result.currentLocationId) {
        locationIds.add(fact.result.currentLocationId);
      }
      if (fact.result.factionId) {
        factionIds.add(fact.result.factionId);
      }
      for (const information of fact.result.knownInformation) {
        informationIds.add(information.id);
      }
    }

    if (fact.type === "fetch_market_prices") {
      for (const price of fact.result) {
        commodityIds.add(price.commodityId);
        locationIds.add(price.locationId);
        if (price.vendorNpcId) {
          npcIds.add(price.vendorNpcId);
        }
      }
    }

    if (fact.type === "fetch_faction_intel") {
      factionIds.add(fact.result.id);
      for (const relation of fact.result.relations) {
        factionIds.add(relation.factionAId);
        factionIds.add(relation.factionBId);
      }
      for (const locationId of fact.result.controlledLocationIds) {
        locationIds.add(locationId);
      }
    }

    if (fact.type === "fetch_information_detail") {
      informationIds.add(fact.result.id);
      if (fact.result.locationId) {
        locationIds.add(fact.result.locationId);
      }
      if (fact.result.factionId) {
        factionIds.add(fact.result.factionId);
      }
      if (fact.result.sourceNpcId) {
        npcIds.add(fact.result.sourceNpcId);
      }
    }

    if (fact.type === "fetch_information_connections") {
      for (const lead of fact.result) {
        informationIds.add(lead.information.id);
        if (lead.information.locationId) {
          locationIds.add(lead.information.locationId);
        }
        if (lead.information.factionId) {
          factionIds.add(lead.information.factionId);
        }
        if (lead.information.sourceNpcId) {
          npcIds.add(lead.information.sourceNpcId);
        }
      }
    }

    if (fact.type === "fetch_relationship_history") {
      npcIds.add(fact.result.npcId);
    }
  }

  return { locationIds, npcIds, factionIds, informationIds, commodityIds };
}

function assertCitedEntities(
  citedEntities: CitedEntities,
  snapshot: CampaignSnapshot,
  fetchedFacts: TurnFetchToolResult[],
) {
  const allowed = getAllowedEntities(snapshot, fetchedFacts);

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

  for (const commodityId of citedEntities.commodityIds) {
    if (!allowed.commodityIds.has(commodityId)) {
      throw new Error(`Hallucinated commodity citation: ${commodityId}.`);
    }
  }
}

function assertTime(
  command: Exclude<TurnActionToolCall, { type: "request_clarification" }>,
  snapshot: CampaignSnapshot,
) {
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

  if (command.type === "execute_rest") {
    const requiredDuration = REST_DURATIONS[command.restType];
    if (command.timeElapsed !== requiredDuration) {
      throw new Error(`Rest time must be engine-owned at ${requiredDuration} minutes.`);
    }
    return;
  }

  if (command.type === "execute_wait" && command.timeElapsed !== command.durationMinutes) {
    throw new Error("Wait durationMinutes must match timeElapsed.");
  }

  if (command.timeElapsed < bounds.min || command.timeElapsed > bounds.max) {
    throw new Error(
      `${command.type} produced ${command.timeElapsed} minutes, outside ${command.timeMode} bounds.`,
    );
  }
}

function requireFetchedMarketPrice(command: {
  marketPriceId: string;
  commodityId: string;
}, fetchedFacts: TurnFetchToolResult[]) {
  const price = fetchedMarketPrices(fetchedFacts).find(
    (entry) =>
      entry.marketPriceId === command.marketPriceId && entry.commodityId === command.commodityId,
  );

  if (!price) {
    throw new Error("Trading requires fetched market detail for the selected commodity.");
  }

  return price;
}

function validateInteractionTarget(
  snapshot: CampaignSnapshot,
  command: TurnActionToolCall,
  fetchedFacts: TurnFetchToolResult[],
) {
  if (command.type === "execute_converse") {
    if (command.npcId) {
      if (!findPresentNpc(snapshot, command.npcId)) {
        throw new Error("Cannot converse with an NPC who is not present.");
      }
      assertNpcDetailFetchedIfRequired(snapshot, command.npcId, fetchedFacts);
    } else if (!command.interlocutor.trim()) {
      throw new Error("Converse actions without npcId must name the local interlocutor.");
    } else {
      const interlocutor = normalizeLooseText(command.interlocutor).toLowerCase();
      if (
        snapshot.presentNpcs.some(
          (npc) => normalizeLooseText(npc.name).toLowerCase() === interlocutor,
        )
      ) {
        throw new Error("Unnamed local labels cannot reuse a present NPC's name.");
      }
    }
  }

  if (command.type === "execute_investigate" && command.targetType === "npc") {
    if (!findPresentNpc(snapshot, command.targetId)) {
      throw new Error("Cannot investigate an NPC who is not present.");
    }
    assertNpcDetailFetchedIfRequired(snapshot, command.targetId, fetchedFacts);
  }

  if (command.type === "execute_observe" && command.targetType === "npc") {
    if (!findPresentNpc(snapshot, command.targetId)) {
      throw new Error("Cannot observe an NPC who is not present.");
    }
    assertNpcDetailFetchedIfRequired(snapshot, command.targetId, fetchedFacts);
  }

  if (command.type === "execute_combat") {
    const target = findPresentNpc(snapshot, command.targetNpcId);
    if (!target) {
      throw new Error("Combat target must be present.");
    }
    assertNpcDetailFetchedIfRequired(snapshot, command.targetNpcId, fetchedFacts);
    if (target.state === "dead") {
      throw new Error("Combat target is already dead.");
    }
  }

  if (command.type === "execute_trade") {
    const price = requireFetchedMarketPrice(command, fetchedFacts);
    if (price.locationId !== snapshot.currentLocation.id) {
      throw new Error("Market price is not for the current location.");
    }
    if (!Number.isInteger(command.quantity) || command.quantity <= 0) {
      throw new Error("Trade quantity must be a positive integer.");
    }

    if (command.action === "buy") {
      const totalCost = price.price * command.quantity;
      if (price.stock !== -1 && price.stock < command.quantity) {
        throw new Error("Insufficient stock for requested trade quantity.");
      }
      if (snapshot.character.gold < totalCost) {
        throw new Error("Insufficient gold for requested trade quantity.");
      }
    }

    if (command.action === "sell") {
      const owned = snapshot.character.commodityStacks.find(
        (stack) => stack.commodityId === command.commodityId,
      );

      if (!owned || owned.quantity < command.quantity) {
        throw new Error("Cannot sell more commodity than the player owns.");
      }
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

function looksLikeTypedCombatOrTrade(text: string) {
  const normalized = text.toLowerCase();
  return /(buy|sell|barter|trade|price|stock|kill|slay|murder|stab|attack|subdue|assassinate|knock out)/.test(
    normalized,
  );
}

function validateFreeform(command: ExecuteFreeformToolCall) {
  if (!command.statToCheck) {
    throw new Error("execute_freeform requires statToCheck.");
  }

  if (!command.intendedMechanicalOutcome.trim()) {
    throw new Error("execute_freeform requires intendedMechanicalOutcome.");
  }

  if (command.estimatedTimeElapsedMinutes !== command.timeElapsed) {
    throw new Error("execute_freeform estimatedTimeElapsedMinutes must match timeElapsed.");
  }

  if (looksLikeTypedCombatOrTrade(`${command.actionDescription} ${command.intendedMechanicalOutcome}`)) {
    throw new Error("execute_freeform cannot replace typed combat or trade actions.");
  }
}

function deriveCombatCheck(command: ExecuteCombatToolCall, snapshot: CampaignSnapshot) {
  const target = findPresentNpc(snapshot, command.targetNpcId);
  if (!target) {
    throw new Error("Combat target must be present.");
  }

  const stat = command.approach === "assassinate" ? "dexterity" : "strength";
  const dc = 7 + Math.max(1, target.threatLevel);

  return rollCheck({
    stat,
    mode: "normal",
    reason: `${command.approach} ${target.name}`,
    character: snapshot.character,
    dc,
  });
}

function extractQuotedGoldAmounts(narration: string) {
  return Array.from(narration.matchAll(/(\d+)\s+gold/gi)).map((match) => Number(match[1]));
}

function auditWorldFidelity(input: {
  snapshot: CampaignSnapshot;
  command: Exclude<TurnActionToolCall, { type: "request_clarification" }>;
  fetchedFacts: TurnFetchToolResult[];
}): WorldFidelityIssue[] {
  const { snapshot, command, fetchedFacts } = input;
  const issues: WorldFidelityIssue[] = [];

  if (command.type === "execute_trade") {
    const price = requireFetchedMarketPrice(command, fetchedFacts);
    if (!command.citedEntities.commodityIds.includes(command.commodityId)) {
      issues.push({
        code: "uncited_mechanical_entity",
        severity: "block",
        evidence: "Trade commands must cite the traded commodity.",
      });
    }

    const quotedGoldAmounts = extractQuotedGoldAmounts(command.narration);
    const total = price.price * command.quantity;
    if (quotedGoldAmounts.length > 0 && !quotedGoldAmounts.includes(total)) {
      issues.push({
        code: "invented_price",
        severity: "block",
        evidence: `Narration quoted a gold amount that did not match the authoritative total of ${total}.`,
      });
    }
  }

  if (command.type === "execute_combat" && !command.citedEntities.npcIds.includes(command.targetNpcId)) {
    issues.push({
      code: "uncited_mechanical_entity",
      severity: "block",
      evidence: "Combat commands must cite the target NPC.",
    });
  }

  if (command.type === "execute_travel" && !command.citedEntities.locationIds.includes(command.targetLocationId)) {
    issues.push({
      code: "uncited_mechanical_entity",
      severity: "block",
      evidence: "Travel commands must cite the destination location.",
    });
  }

  if (command.type === "execute_rest" && command.timeElapsed > 480) {
    issues.push({
      code: "temporal_inconsistency",
      severity: "block",
      evidence: "Rest duration exceeded the engine-owned maximum.",
    });
  }

  if (command.type === "execute_trade") {
    const price = requireFetchedMarketPrice(command, fetchedFacts);
    if (price.locationId !== snapshot.currentLocation.id) {
      issues.push({
        code: "spatial_inconsistency",
        severity: "block",
        evidence: "Trade attempted against a market outside the current location.",
      });
    }
  }

  return issues;
}

export function validateTurnCommand(input: {
  snapshot: CampaignSnapshot;
  command: TurnActionToolCall;
  fetchedFacts?: TurnFetchToolResult[];
}): ValidatedTurnCommand {
  const { snapshot, command, fetchedFacts = [] } = input;

  if (command.type === "request_clarification") {
    return {
      ...command,
      options: command.options.map((entry) => entry.trim()).filter(Boolean).slice(0, 4),
      question: command.question.trim(),
    };
  }

  const warnings: string[] = [];
  validateInteractionTarget(snapshot, command, fetchedFacts);
  validateInformationDiscoveries(
    snapshot,
    "discoverInformationIds" in command ? command.discoverInformationIds : undefined,
  );
  assertTime(command, snapshot);
  assertCitedEntities(command.citedEntities, snapshot, fetchedFacts);

  const fidelityIssues = auditWorldFidelity({
    snapshot,
    command,
    fetchedFacts,
  });
  const blockingIssue = fidelityIssues.find((issue) => issue.severity === "block");
  if (blockingIssue) {
    throw new Error(`${blockingIssue.code}: ${blockingIssue.evidence}`);
  }

  warnings.push(
    ...fidelityIssues
      .filter((issue) => issue.severity === "warn")
      .map((issue) => `${issue.code}: ${issue.evidence}`),
  );

  const suggestedActions = normalizedSuggestedActions(command.suggestedActions);
  if (!suggestedActions.length) {
    warnings.push("Tool call returned no suggested actions; engine provided none.");
  }

  if (command.type === "execute_combat") {
    return {
      ...command,
      suggestedActions,
      warnings,
      checkResult: deriveCombatCheck(command, snapshot),
    };
  }

  if (command.type === "execute_freeform") {
    validateFreeform(command);
    const checkResult = rollCheck({
      stat: command.statToCheck,
      mode: "normal",
      reason: command.actionDescription,
      character: snapshot.character,
      dc: command.dc,
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
