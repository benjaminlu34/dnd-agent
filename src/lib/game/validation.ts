import type {
  CampaignSnapshot,
  ChallengeApproach,
  MechanicsMutation,
  PendingCheck,
  ResolveMechanicsResponse,
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

function deriveTimeElapsed(command: ResolveMechanicsResponse, snapshot: CampaignSnapshot) {
  const explicitDuration = requestedDurationMinutes(command);
  if (explicitDuration != null) {
    return explicitDuration;
  }

  const moveMutation = command.mutations.find((mutation) => mutation.type === "move_player");
  if (moveMutation?.type === "move_player") {
    const route = snapshot.adjacentRoutes.find((entry) => entry.id === moveMutation.routeEdgeId);
    if (route && route.targetLocationId === moveMutation.targetLocationId) {
      return route.travelTimeMinutes;
    }
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

  const magnitude = command.durationMagnitude ?? "standard";
  const minutes = DURATION_MAGNITUDE_MINUTES[command.timeMode]?.[magnitude];
  if (!minutes) {
    throw new Error(`Unknown duration magnitude ${magnitude} for ${command.timeMode}.`);
  }

  return minutes;
}

function statForChallengeApproach(challengeApproach: ChallengeApproach) {
  switch (challengeApproach) {
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
  }
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

function isValidLocalInteractionTarget(snapshot: CampaignSnapshot, localEntityId: string) {
  const normalized = localEntityId.trim();
  if (!normalized) {
    return false;
  }
  if (normalized.startsWith("spawn:") || normalized.startsWith("temp:")) {
    return true;
  }
  if (normalized.startsWith("npc:")) {
    return false;
  }
  if (Object.hasOwn(snapshot.knownNpcLocationIds, normalized)) {
    return false;
  }

  return snapshot.temporaryActors.some((actor) => actor.id === normalized);
}

function normalizePlayerActionText(playerAction: string | undefined) {
  return (playerAction ?? "").trim().toLowerCase();
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

function mutationPhaseForCheckStakes(mutation: MechanicsMutation): "immediate" | "conditional" {
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
    const stat = checkIntent.approach === "assassinate" ? "dexterity" : "strength";
    const dc = 7 + Math.max(1, target?.threatLevel ?? 2);

    return {
      stat,
      mode: checkIntent.mode ?? "normal",
      reason: checkIntent.reason,
      modifier: snapshot.character.stats[stat],
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
        : checkIntent.challengeApproach === "analyze" || checkIntent.challengeApproach === "notice"
          ? 8
          : 7;

  const stat = statForChallengeApproach(checkIntent.challengeApproach);
  return {
    stat,
    mode: checkIntent.mode ?? "normal",
    reason: checkIntent.reason,
    modifier: snapshot.character.stats[stat],
    dc,
  };
}

export function validateTurnCommand(input: {
  snapshot: CampaignSnapshot;
  command: TurnActionToolCall;
  fetchedFacts?: TurnFetchToolResult[];
  playerAction?: string;
}): ValidatedTurnCommand {
  const { snapshot, command, fetchedFacts = [], playerAction } = input;

  if (command.type === "request_clarification") {
    return {
      ...command,
      options: command.options.map((entry) => entry.trim()).filter(Boolean).slice(0, 4),
      question: command.question.trim(),
    };
  }

  const warnings: string[] = [];
  for (const warning of command.warnings ?? []) {
    const normalized = warning.trim();
    if (normalized) {
      warnings.push(normalized);
    }
  }
  const suggestedActions = normalizedSuggestedActions(command.suggestedActions);
  if (!suggestedActions.length) {
    warnings.push("Mechanics response returned no suggested actions; engine provided none.");
  }

  const mutations = command.mutations.filter((mutation) => {
    if (mutation.type !== "record_local_interaction") {
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

  return {
    ...command,
    mutations,
    suggestedActions,
    warnings: Array.from(new Set(warnings)),
    timeElapsed: deriveTimeElapsed({ ...command, mutations }, snapshot),
    pendingCheck: derivePendingCheck(snapshot, { ...command, mutations }, fetchedFacts),
    checkResult: undefined,
  };
}
