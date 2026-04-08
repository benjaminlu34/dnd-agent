import { flattenCurrencyToCp } from "@/lib/game/currency";
import { canonicalizeNpcIdAgainstCandidates } from "@/lib/game/npc-identity";
import type {
  CampaignSnapshot,
  ExecuteFastForwardCommand,
  MechanicsMutation,
  PendingCheck,
  ResolveMechanicsResponse,
  RouterDecision,
  TimeMode,
  TurnActionToolCall,
  TurnFetchToolResult,
  ValidatedTurnCommand,
} from "@/lib/game/types";

export const TIME_MODE_BOUNDS: Record<TimeMode, { min: number; max: number }> = {
  combat: { min: 1, max: 10 },
  exploration: { min: 5, max: 240 },
  travel: { min: 0, max: 0 },
  rest: { min: 0, max: 0 },
  downtime: { min: 60, max: 2880 },
};

const REST_DURATIONS = {
  light_rest: 360,
  full_rest: 480,
} as const;

const DURATION_MAGNITUDE_MINUTES: Record<
  Exclude<TimeMode, "travel" | "rest">,
  Record<string, number>
> = {
  combat: {
    instant: 1,
    brief: 3,
    standard: 5,
    extended: 8,
    long: 10,
  },
  exploration: {
    instant: 5,
    brief: 10,
    standard: 20,
    extended: 45,
    long: 90,
  },
  downtime: {
    instant: 60,
    brief: 120,
    standard: 240,
    extended: 480,
    long: 720,
  },
};

function normalizedSuggestedActions(actions: string[] | undefined) {
  return Array.from(new Set((actions ?? []).map((entry) => entry.trim()).filter(Boolean))).slice(
    0,
    4,
  );
}

function requestedDurationMinutes(command: ResolveMechanicsResponse) {
  for (const mutation of command.mutations) {
    if (mutation.type === "advance_time" && typeof mutation.durationMinutes === "number") {
      return mutation.durationMinutes;
    }
  }

  return null;
}

const FAST_FORWARD_MAX_MINUTES = 7 * 1440;

function shouldUseShortLocalDowntimeDuration(command: ResolveMechanicsResponse) {
  if (command.timeMode !== "downtime") {
    return false;
  }

  return command.mutations.some((mutation) =>
    mutation.type === "set_player_scene_focus"
    || mutation.type === "record_actor_interaction"
    || mutation.type === "record_local_interaction"
    || mutation.type === "record_npc_interaction"
    || mutation.type === "spawn_temporary_actor"
    || mutation.type === "set_scene_actor_presence"
    || mutation.type === "set_follow_state",
  );
}

function deriveTimeElapsed(command: ResolveMechanicsResponse, snapshot: CampaignSnapshot) {
  const explicitDuration = requestedDurationMinutes(command);
  if (explicitDuration != null) {
    return explicitDuration;
  }

  const arrivalMutation = command.mutations.find((mutation) => mutation.type === "arrive_at_destination");
  if (arrivalMutation?.type === "arrive_at_destination") {
    return arrivalMutation.authoredTimeElapsedMinutes;
  }

  const turnBackMutation = command.mutations.find((mutation) => mutation.type === "turn_back_travel");
  if (turnBackMutation?.type === "turn_back_travel") {
    return turnBackMutation.authoredTimeElapsedMinutes;
  }

  if (command.mutations.some((mutation) => mutation.type === "move_player")) {
    return 0;
  }

  const restoreMutation = command.mutations.find((mutation) => mutation.type === "restore_health");
  if (command.timeMode === "rest" && restoreMutation?.type === "restore_health") {
    if (restoreMutation.mode === "light_rest") {
      return REST_DURATIONS.light_rest;
    }
    if (restoreMutation.mode === "full_rest") {
      return REST_DURATIONS.full_rest;
    }
  }

  if (command.timeMode === "travel" || command.timeMode === "rest") {
    return 0;
  }

  const durationMode =
    shouldUseShortLocalDowntimeDuration(command)
      ? "exploration"
      : command.timeMode;
  const magnitude = command.durationMagnitude ?? "standard";
  const minutes = DURATION_MAGNITUDE_MINUTES[durationMode]?.[magnitude];
  if (!minutes) {
    throw new Error(`Unknown duration magnitude ${magnitude} for ${durationMode}.`);
  }

  return minutes;
}

function configuredApproachIds(snapshot: CampaignSnapshot) {
  const configuredApproaches = snapshot.character.approaches
    ?.map((approach) => approach.id.trim())
    .filter(Boolean);

  return configuredApproaches ?? [];
}

function defaultApproachId(snapshot: CampaignSnapshot) {
  return configuredApproachIds(snapshot)[0] ?? "force";
}

function normalizeCheckIntentApproachId(
  checkIntent: ResolveMechanicsResponse["checkIntent"],
  snapshot: CampaignSnapshot,
) {
  if (!checkIntent) {
    return null;
  }

  const validApproachIds = configuredApproachIds(snapshot);

  if (typeof checkIntent.approachId === "string" && checkIntent.approachId.trim()) {
    const approachId = checkIntent.approachId.trim();
    return validApproachIds.length === 0 || validApproachIds.includes(approachId)
      ? approachId
      : null;
  }

  if (checkIntent.type === "challenge" && typeof checkIntent.challengeApproach === "string") {
    const challengeApproach = checkIntent.challengeApproach.trim();
    return validApproachIds.length === 0 || validApproachIds.includes(challengeApproach)
      ? challengeApproach
      : null;
  }

  if (checkIntent.type === "combat") {
    if (validApproachIds.length === 0) {
      if (checkIntent.approach === "assassinate") {
        return "finesse";
      }
      if (checkIntent.approach === "attack" || checkIntent.approach === "subdue") {
        return "force";
      }
    }
    if (typeof checkIntent.approach === "string" && validApproachIds.includes(checkIntent.approach)) {
      return checkIntent.approach;
    }
  }

  return null;
}

function legacyStatForApproachId(approachId: string) {
  switch (approachId) {
    case "force":
      return "strength";
    case "finesse":
      return "dexterity";
    case "endure":
      return "constitution";
    case "analyze":
      return "intelligence";
    case "notice":
      return "wisdom";
    case "influence":
      return "charisma";
    default:
      return approachId;
  }
}

function resolveCheckModifier(snapshot: CampaignSnapshot, approachId: string) {
  const fieldId = snapshot.character.approaches?.find((approach) => approach.id === approachId)?.fieldId;
  if (fieldId) {
    const value = snapshot.character.frameworkValues?.[fieldId];
    if (typeof value === "number" && Number.isFinite(value)) {
      return Math.trunc(value);
    }
  }

  const directStat = snapshot.character.stats?.[approachId];
  if (typeof directStat === "number" && Number.isFinite(directStat)) {
    return Math.trunc(directStat);
  }

  const legacyStat = snapshot.character.approaches?.length
    ? approachId
    : legacyStatForApproachId(approachId);
  const legacyValue = snapshot.character.stats?.[legacyStat];
  return typeof legacyValue === "number" && Number.isFinite(legacyValue)
    ? Math.trunc(legacyValue)
    : 0;
}

function findFetchedNpc(
  fetchedFacts: TurnFetchToolResult[],
  npcId: string | undefined,
) {
  if (!npcId) {
    return null;
  }

  for (const fact of fetchedFacts) {
    if (fact.type === "fetch_npc_detail" && fact.result.id === npcId) {
      return fact.result;
    }
  }

  return null;
}

function findPresentNpc(snapshot: CampaignSnapshot, npcId: string | undefined) {
  if (!npcId) {
    return null;
  }

  return snapshot.presentNpcs.find((npc) => npc.id === npcId) ?? null;
}

function canonicalizeNpcIdForTurn(
  snapshot: CampaignSnapshot,
  fetchedFacts: TurnFetchToolResult[],
  npcId: string,
) {
  const trimmed = npcId.trim();
  if (!trimmed) {
    return trimmed;
  }
  const candidates = [
    ...snapshot.presentNpcs.map((npc) => ({ id: npc.id, name: npc.name })),
    ...fetchedFacts
      .filter((fact) => fact.type === "fetch_npc_detail")
      .map((fact) => ({ id: fact.result.id, name: fact.result.name })),
    ...Object.keys(snapshot.knownNpcLocationIds).map((id) => ({ id })),
  ];

  return canonicalizeNpcIdAgainstCandidates({
    rawNpcId: trimmed,
    candidates,
  });
}

function canonicalizeInventoryItemIdForTurn(
  snapshot: CampaignSnapshot,
  itemId: string,
) {
  const trimmed = itemId.trim();
  if (!trimmed || trimmed.startsWith("spawn:")) {
    return trimmed;
  }

  const inventoryItem = snapshot.character.inventory.find((item) => item.id === trimmed);
  if (inventoryItem) {
    return inventoryItem.templateId;
  }

  return trimmed;
}

function isValidLocalInteractionTarget(snapshot: CampaignSnapshot, localEntityId: string) {
  const normalized = localEntityId.trim();
  if (!normalized) {
    return false;
  }
  if (normalized.startsWith("spawn:")) {
    return true;
  }
  if (normalized.startsWith("temp:")) {
    const temporaryActorId = normalized.slice("temp:".length).trim();
    return temporaryActorId
      ? snapshot.temporaryActors.some((actor) => actor.id === temporaryActorId)
      : false;
  }
  if (normalized.startsWith("npc:")) {
    return false;
  }
  if (Object.hasOwn(snapshot.knownNpcLocationIds, normalized)) {
    return false;
  }

  return snapshot.temporaryActors.some((actor) => actor.id === normalized);
}

function isValidNpcInteractionTarget(
  snapshot: CampaignSnapshot,
  fetchedFacts: TurnFetchToolResult[],
  npcId: string,
) {
  const normalized = npcId.trim();
  if (!normalized) {
    return false;
  }

  return findPresentNpc(snapshot, normalized) != null || findFetchedNpc(fetchedFacts, normalized) != null;
}

function isValidActorInteractionTarget(snapshot: CampaignSnapshot, actorId: string) {
  const normalized = actorId.trim();
  if (!normalized) {
    return false;
  }

  if (!snapshot.currentLocation) {
    return false;
  }

  const currentLocationId = snapshot.currentLocation.id;
  return (snapshot.actors ?? []).some(
    (actor) => actor.id === normalized && actor.currentLocationId === currentLocationId,
  );
}

function normalizeLocalInteractionTargetForTurn(
  mutations: readonly MechanicsMutation[],
  localEntityId: string,
) {
  const normalized = localEntityId.trim();
  if (!normalized || normalized.includes(":")) {
    return normalized;
  }

  return mutations.some(
    (mutation) => mutation.type === "spawn_temporary_actor" && mutation.spawnKey === normalized,
  )
    ? `spawn:${normalized}`
    : normalized;
}

function normalizePlayerActionText(playerAction: string | undefined) {
  return (playerAction ?? "").trim().toLowerCase();
}

function resolvedSceneActorRefs(routerDecision: RouterDecision | undefined) {
  return new Set(
    (routerDecision?.attention.resolvedReferents ?? [])
      .flatMap((entry) => {
        if (entry.targetKind === "scene_actor") {
          return [entry.targetRef];
        }
        if (entry.targetKind === "known_npc") {
          const npcId = entry.targetRef.startsWith("npc:")
            ? entry.targetRef.slice("npc:".length).trim()
            : entry.targetRef;
          return npcId ? [`npc:${npcId}`] : [];
        }
        return [];
      }),
  );
}

function unresolvedTemporaryActorPhrases(routerDecision: RouterDecision | undefined) {
  return (routerDecision?.attention.unresolvedReferents ?? [])
    .filter((entry) => entry.intendedKind === "temporary_actor")
    .map((entry) => entry.phrase.trim())
    .filter(Boolean);
}

function targetedActorRefForMutation(mutation: MechanicsMutation): string | null {
  switch (mutation.type) {
    case "record_actor_interaction":
      return `actor:${mutation.actorId}`;
    case "record_local_interaction":
      return mutation.localEntityId.trim();
    case "record_npc_interaction":
      return `npc:${mutation.npcId}`;
    case "adjust_relationship":
      return `npc:${mutation.npcId}`;
    case "set_actor_state":
      return `actor:${mutation.actorId}`;
    case "set_npc_state":
      return `npc:${mutation.npcId}`;
    case "set_scene_actor_presence":
      return mutation.actorRef.trim();
    case "set_follow_state":
      return mutation.actorRef.trim();
    default:
      return null;
  }
}

function mutationWouldSubstituteUnresolvedActor(input: {
  mutation: MechanicsMutation;
  resolvedActorRefs: Set<string>;
  unresolvedPhrases: string[];
}) {
  if (input.unresolvedPhrases.length === 0) {
    return false;
  }

  const actorRef = targetedActorRefForMutation(input.mutation);
  if (!actorRef) {
    return false;
  }

  if (actorRef.startsWith("spawn:") || actorRef.startsWith("temp:")) {
    return false;
  }

  if (actorRef.startsWith("actor:") || actorRef.startsWith("npc:")) {
    return !input.resolvedActorRefs.has(actorRef);
  }

  return false;
}

export function isLikelySoloErrandAction(playerAction: string | undefined) {
  const normalized = normalizePlayerActionText(playerAction);
  if (!normalized) {
    return false;
  }

  const soloErrandSignals = [
    /\b(head|go|return|step|move|walk|make my way)\b/,
    /\b(check|inspect|retrieve|get|grab|look through|search through|sort through)\b/,
    /\b(my|mine|coin purse|pack|bag|bench|belongings|gear|tools)\b/,
  ];
  const explicitInterpersonalSignals = [
    /\b(ask|tell|speak|talk|greet|hail|call over|hear .* out|buy .* from|sell .* to|trade with)\b/,
  ];

  return soloErrandSignals.every((pattern) => pattern.test(normalized))
    && !explicitInterpersonalSignals.some((pattern) => pattern.test(normalized));
}

export function isLikelyProxyPlayerMovementAction(playerAction: string | undefined) {
  const normalized = normalizePlayerActionText(playerAction);
  if (!normalized) {
    return false;
  }

  const playerMovementSignals = [
    /\b(i|me|my)\b/,
    /\b(head|go|return|step|move|walk|make my way|back to)\b/,
  ];
  const actorDirectionSignals = [
    /\b(send|dismiss|order|tell|ask|beckon|wave|call)\b/,
  ];

  return playerMovementSignals.every((pattern) => pattern.test(normalized))
    && !actorDirectionSignals.some((pattern) => pattern.test(normalized));
}

export function routerSuggestsManifestationOverKnowledge(routerDecision: RouterDecision | undefined) {
  if (!routerDecision) {
    return false;
  }

  if (routerDecision.profile !== "local") {
    return false;
  }

  if (!routerDecision.authorizedVectors.includes("investigate")) {
    return false;
  }

  if (routerDecision.attention.resolvedReferents.some((entry) => entry.targetKind === "information")) {
    return false;
  }

  return (
    routerDecision.attention.impliedDestinationFocus != null
    || routerDecision.attention.mustCheck.includes("sceneActors")
    || routerDecision.attention.mustCheck.includes("sceneAspects")
  );
}

function mutationPhaseForCheckStakes(mutation: MechanicsMutation): "immediate" | "conditional" {
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
  if (mutation.type === "record_actor_interaction") {
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

function hasMeaningfulCheckStakes(command: ResolveMechanicsResponse) {
  return command.mutations.some((mutation) => {
    if (mutationPhaseForCheckStakes(mutation) !== "conditional") {
      return false;
    }

    return mutation.type !== "advance_time";
  });
}

function canAutoPromoteMutationForInvestigativeCheck(mutation: MechanicsMutation) {
  if (mutation.phase) {
    return false;
  }

  return (
    mutation.type === "spawn_scene_aspect"
    || mutation.type === "spawn_temporary_actor"
    || mutation.type === "spawn_environmental_item"
    || mutation.type === "spawn_fiat_item"
  );
}

function normalizeMutationsForPendingCheck(
  snapshot: CampaignSnapshot,
  command: ResolveMechanicsResponse,
) {
  const checkIntent = command.checkIntent;
  if (!checkIntent || checkIntent.type !== "challenge") {
    return command.mutations;
  }

  if ((snapshot.character.approaches ?? []).length > 0) {
    return command.mutations;
  }

  const approachId = normalizeCheckIntentApproachId(checkIntent, snapshot);
  if (approachId !== "notice" && approachId !== "analyze") {
    return command.mutations;
  }

  if (hasMeaningfulCheckStakes(command)) {
    return command.mutations;
  }

  let promotedAny = false;
  const mutations = command.mutations.map((mutation) => {
    if (!canAutoPromoteMutationForInvestigativeCheck(mutation)) {
      return mutation;
    }
    promotedAny = true;
    return {
      ...mutation,
      phase: "conditional",
    } satisfies MechanicsMutation;
  });

  return promotedAny ? mutations : command.mutations;
}

function derivePendingCheck(
  snapshot: CampaignSnapshot,
  command: ResolveMechanicsResponse,
  fetchedFacts: TurnFetchToolResult[],
): PendingCheck | undefined {
  const checkIntent = command.checkIntent;
  if (!checkIntent) {
    return undefined;
  }

  // Checks should gate meaningful success-state mutations. If the planner only
  // produced routine immediate actions, treat the turn as no-roll instead of
  // inventing stakes in validation.
  if (!hasMeaningfulCheckStakes(command)) {
    return undefined;
  }

  if (checkIntent.type === "combat") {
    const target =
      findPresentNpc(snapshot, checkIntent.targetNpcId)
      ?? findFetchedNpc(fetchedFacts, checkIntent.targetNpcId);
    const approachId = normalizeCheckIntentApproachId(checkIntent, snapshot) ?? defaultApproachId(snapshot);
    const dc = 7 + Math.max(1, target?.threatLevel ?? 2);

    return {
      approachId,
      stat: snapshot.character.approaches?.length ? approachId : legacyStatForApproachId(approachId),
      mode: checkIntent.mode ?? "normal",
      reason: checkIntent.reason,
      modifier: resolveCheckModifier(snapshot, approachId),
      dc,
    };
  }

  const citedNpc =
    findPresentNpc(snapshot, checkIntent.citedNpcId)
    ?? findFetchedNpc(fetchedFacts, checkIntent.citedNpcId);
  const dc =
    citedNpc
      ? 7 + Math.max(1, citedNpc.threatLevel)
      : command.timeMode === "combat"
        ? 9
        : 7;

  const approachId = normalizeCheckIntentApproachId(checkIntent, snapshot) ?? defaultApproachId(snapshot);
  return {
    approachId,
    stat: snapshot.character.approaches?.length ? approachId : legacyStatForApproachId(approachId),
    mode: checkIntent.mode ?? "normal",
    reason: checkIntent.reason,
    modifier: resolveCheckModifier(snapshot, approachId),
    dc,
  };
}

export function validateTurnCommand(input: {
  snapshot: CampaignSnapshot;
  command: TurnActionToolCall;
  fetchedFacts?: TurnFetchToolResult[];
  playerAction?: string;
  routerDecision?: RouterDecision;
}): ValidatedTurnCommand {
  const { snapshot, command, fetchedFacts = [], playerAction, routerDecision } = input;

  if (command.type === "request_clarification") {
    return {
      ...command,
      options: command.options.map((entry) => entry.trim()).filter(Boolean).slice(0, 4),
      question: command.question.trim(),
    };
  }

  if (command.type === "execute_fast_forward") {
    const warnings = Array.from(new Set(
      (command.warnings ?? [])
        .map((warning) => warning.trim())
        .filter(Boolean),
    ));
    const requestedDurationMinutes = Number.isFinite(command.requestedDurationMinutes)
      ? Math.trunc(command.requestedDurationMinutes)
      : 0;

    if (requestedDurationMinutes <= 0) {
      return {
        type: "request_clarification",
        question: "I couldn't determine how long you wanted to maintain that routine. How much time would you like to pass?",
        options: ["A few hours", "A couple days", "A week"],
      };
    }

    if (
      snapshot.state.characterState.conditions.includes("in_combat")
      || snapshot.state.characterState.conditions.includes("being_pursued")
    ) {
      return {
        type: "request_clarification",
        question: "You cannot fast-forward time during active combat or pursuit. What would you like to do right now?",
        options: ["Attack", "Defend", "Flee", "Take cover"],
      };
    }

    const cappedDurationMinutes = Math.min(requestedDurationMinutes, FAST_FORWARD_MAX_MINUTES);
    if (cappedDurationMinutes !== requestedDurationMinutes) {
      warnings.push("Duration capped at 7 days maximum.");
    }

    const normalizedItemRemovals = command.resourceCosts?.itemRemovals?.map((entry) => ({
      templateId: canonicalizeInventoryItemIdForTurn(snapshot, entry.templateId),
      quantity: entry.quantity,
    }));

    return {
      ...command,
      requestedDurationMinutes: cappedDurationMinutes,
      recurringActivities: command.recurringActivities.slice(0, 6),
      intendedOutcomes: command.intendedOutcomes.slice(0, 6),
      resourceCosts:
        command.resourceCosts
          ? {
              ...command.resourceCosts,
              itemRemovals: normalizedItemRemovals,
            } satisfies ExecuteFastForwardCommand["resourceCosts"]
          : undefined,
      warnings: Array.from(new Set(warnings)),
      narrationHint: null,
      narrationBounds: null,
      timeElapsed: cappedDurationMinutes,
      pendingCheck: undefined,
      checkResult: undefined,
    };
  }

  const warnings: string[] = [];
  const resolvedActorRefs = resolvedSceneActorRefs(routerDecision);
  const unresolvedActorPhrases = unresolvedTemporaryActorPhrases(routerDecision);
  for (const warning of command.warnings ?? []) {
    const normalized = warning.trim();
    if (normalized) {
      warnings.push(normalized);
    }
  }
  const suggestedActions = normalizedSuggestedActions(command.suggestedActions);
  const normalizedMutations = command.mutations.map((mutation) => {
    if (mutation.type === "record_local_interaction") {
      const normalizedLocalEntityId = normalizeLocalInteractionTargetForTurn(
        command.mutations,
        mutation.localEntityId,
      );
      if (normalizedLocalEntityId === mutation.localEntityId) {
        return mutation;
      }

      return {
        ...mutation,
        localEntityId: normalizedLocalEntityId,
      } satisfies MechanicsMutation;
    }

    if (
      mutation.type === "record_actor_interaction"
      || mutation.type === "set_actor_state"
    ) {
      return mutation;
    }

    if (
      mutation.type === "record_npc_interaction"
      || mutation.type === "adjust_relationship"
      || mutation.type === "set_npc_state"
    ) {
      const normalizedNpcId = canonicalizeNpcIdForTurn(snapshot, fetchedFacts, mutation.npcId);
      if (normalizedNpcId === mutation.npcId) {
        return mutation;
      }

      return {
        ...mutation,
        npcId: normalizedNpcId,
      } satisfies MechanicsMutation;
    }

    if (mutation.type === "adjust_inventory") {
      const normalizedItemId = canonicalizeInventoryItemIdForTurn(snapshot, mutation.itemId);
      if (normalizedItemId === mutation.itemId) {
        return mutation;
      }

      return {
        ...mutation,
        itemId: normalizedItemId,
      } satisfies MechanicsMutation;
    }

    return mutation;
  });
  const normalizedCheckIntent = command.checkIntent
    ? command.checkIntent.type === "challenge"
      ? {
          ...command.checkIntent,
          citedNpcId:
            command.checkIntent.citedNpcId == null
              ? undefined
              : canonicalizeNpcIdForTurn(snapshot, fetchedFacts, command.checkIntent.citedNpcId),
        }
      : {
          ...command.checkIntent,
          targetNpcId: canonicalizeNpcIdForTurn(snapshot, fetchedFacts, command.checkIntent.targetNpcId),
        }
    : undefined;

  const filteredMutations = normalizedMutations.filter((mutation) => {
    if (
      mutationWouldSubstituteUnresolvedActor({
        mutation,
        resolvedActorRefs,
        unresolvedPhrases: unresolvedActorPhrases,
      })
    ) {
      warnings.push(
        "Mechanics response tried to redirect an unresolved target onto a different grounded actor; the substituted interaction mutation was dropped.",
      );
      return false;
    }

    if (mutation.type === "record_npc_interaction") {
      if (isValidNpcInteractionTarget(snapshot, fetchedFacts, mutation.npcId)) {
        return true;
      }

      warnings.push(
        "Mechanics response targeted record_npc_interaction at an invalid or unavailable NPC; mutation was dropped.",
      );
      return false;
    }

    if (mutation.type === "record_actor_interaction" || mutation.type === "set_actor_state") {
      const actorId = mutation.type === "record_actor_interaction" ? mutation.actorId : mutation.actorId;
      if (isValidActorInteractionTarget(snapshot, actorId)) {
        return true;
      }

      warnings.push(
        `Mechanics response targeted ${mutation.type} at an invalid or unavailable actor; mutation was dropped.`,
      );
      return false;
    }

    if (mutation.type !== "record_local_interaction") {
      if (mutation.type === "discover_information" && routerSuggestsManifestationOverKnowledge(routerDecision)) {
        warnings.push(
          "Mechanics response appears to use discover_information where the router indicates local manifestation semantics; prefer manifested scene details or actors instead.",
        );
      }
      if (mutation.type === "set_scene_actor_presence" && isLikelyProxyPlayerMovementAction(playerAction)) {
        warnings.push(
          "Mechanics response appears to use set_scene_actor_presence as a proxy for player movement; engine will reject it semantically.",
        );
      }
      return true;
    }

    if (isValidLocalInteractionTarget(snapshot, mutation.localEntityId)) {
      if (isLikelySoloErrandAction(playerAction)) {
        warnings.push(
          "Mechanics response appears to use record_local_interaction for a self-directed errand; engine will reject it semantically.",
        );
      }
      return true;
    }

    warnings.push(
      "Mechanics response targeted record_local_interaction at an invalid local actor ref; mutation was dropped.",
    );
    return false;
  });
  const mutations = normalizeMutationsForPendingCheck(snapshot, {
    ...command,
    checkIntent: normalizedCheckIntent,
    mutations: filteredMutations,
  });
  const narrationHint =
    unresolvedActorPhrases.length > 0 && filteredMutations.length !== normalizedMutations.length
      ? {
          unresolvedTargetPhrases: unresolvedActorPhrases,
        }
      : null;

  return {
    ...command,
    checkIntent: normalizedCheckIntent,
    mutations,
    suggestedActions,
    warnings: Array.from(new Set(warnings)),
    narrationHint,
    timeElapsed: deriveTimeElapsed({ ...command, checkIntent: normalizedCheckIntent, mutations }, snapshot),
    pendingCheck: derivePendingCheck(
      snapshot,
      { ...command, checkIntent: normalizedCheckIntent, mutations },
      fetchedFacts,
    ),
    checkResult: undefined,
  };
}
