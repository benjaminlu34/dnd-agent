import assert from "node:assert/strict";
import test from "node:test";
import type {
  CampaignSnapshot,
  ResolveMechanicsResponse,
  RouterDecision,
  TurnFetchToolResult,
} from "./types";
import { validateTurnCommand } from "./validation";

function createSnapshot(): CampaignSnapshot {
  return {
    campaignId: "camp_1",
    sessionId: "sess_1",
    sessionTurnCount: 0,
    stateVersion: 0,
    generatedThroughDay: 2,
    moduleId: "mod_1",
    selectedEntryPointId: "entry_1",
    title: "Harbor of Knives",
    premise: "A harbor city on edge.",
    tone: "Tense",
    setting: "Rain-dark port",
    state: {
      currentLocationId: "loc_gate",
      globalTime: 480,
      pendingTurnId: null,
      lastActionSummary: null,
      sceneFocus: null,
      sceneActorFocuses: {},
      sceneAspects: {},
      characterState: {
        conditions: [],
        activeCompanions: [],
      },
    },
    character: {
      id: "char_1",
      instanceId: "inst_1",
      templateId: "char_1",
      name: "Rowan",
      archetype: "Scout",
      strength: 1,
      dexterity: 2,
      constitution: 1,
      intelligence: 0,
      wisdom: 2,
      charisma: 1,
      maxHealth: 12,
      backstory: null,
      starterItems: [],
      stats: {
        strength: 1,
        dexterity: 2,
        constitution: 1,
        intelligence: 0,
        wisdom: 2,
        charisma: 1,
      },
      health: 6,
      currencyCp: 1000,
      inventory: [],
      commodityStacks: [],
    },
    assetItems: [],
    assetCommodityStacks: [],
    worldObjects: [],
    currentLocation: {
      id: "loc_gate",
      name: "Ash Gate",
      type: "district",
      summary: "Arrival district.",
      description: null,
      localTexture: {
        dominantActivities: ["gate inspections"],
        classTexture: "Rain-soaked laborers.",
        publicHazards: ["slick stones"],
      },
      state: "active",
      controllingFactionId: "fac_watch",
      controllingFactionName: "Watch",
      tags: [],
    },
    adjacentRoutes: [
      {
        id: "edge_gate_market",
        targetLocationId: "loc_market",
        targetLocationName: "Lantern Market",
        travelTimeMinutes: 15,
        dangerLevel: 2,
        currentStatus: "open",
        description: null,
      },
    ],
    presentNpcs: [
      {
        id: "npc_guard",
        name: "Gate Guard",
        role: "guard",
        summary: "A wary watch guard.",
        description: "Helm tucked under one arm.",
        socialLayer: "anchor",
        isNarrativelyHydrated: true,
        factionId: "fac_watch",
        factionName: "Watch",
        currentLocationId: "loc_gate",
        approval: 0,
        approvalBand: "neutral",
        isCompanion: false,
        state: "active",
        threatLevel: 2,
      },
    ],
    actors: [
      {
        id: "actor_npc_guard",
        profileNpcId: "npc_guard",
        isAnonymous: false,
        label: "Gate Guard",
        displayLabel: "Gate Guard",
        currentLocationId: "loc_gate",
        state: "active",
        threatLevel: 2,
        interactionCount: 1,
        firstSeenAtTurn: 0,
        lastSeenAtTurn: 0,
        lastSeenAtTime: 480,
        recentTopics: [],
        lastSummary: "A wary watch guard.",
        holdsInventory: false,
        affectedWorldState: false,
        isInMemoryGraph: false,
        promotedNpcId: "npc_guard",
        inventory: [],
      },
    ],
    knownNpcLocationIds: {
      npc_guard: "loc_gate",
    },
    knownFactions: [],
    factionRelations: [],
    activeThreads: [],
    activePressures: [],
    localInformation: [],
    discoveredInformation: [],
    connectedLeads: [],
    temporaryActors: [],
    memories: [],
    recentWorldShifts: [],
    recentMessages: [],
    canRetryLatestTurn: false,
    latestRetryableTurnId: null,
  };
}

function createRouterDecision(
  overrides: Partial<RouterDecision> = {},
): RouterDecision {
  const attentionOverrides = overrides.attention ?? {};
  const { attention: _ignoredAttention, ...routerOverrides } = overrides;
  return {
    profile: "local",
    confidence: "high",
    authorizedVectors: ["investigate"],
    requiredPrerequisites: [],
    reason: "test",
    clarification: {
      needed: false,
      blocker: null,
      question: null,
      options: [],
    },
    ...routerOverrides,
    attention: {
      primaryIntent: "Test routing.",
      resolvedReferents: [],
      unresolvedReferents: [],
      impliedDestinationFocus: null,
      mustCheck: [],
      ...attentionOverrides,
    },
  };
}

test("validateTurnCommand trims clarification options", () => {
  const validated = validateTurnCommand({
    snapshot: createSnapshot(),
    command: {
      type: "request_clarification",
      question: "  Which guard do you mean? ",
      options: [" front gate ", "", "captain", "harbor watch", "extra"],
    },
  });

  assert.equal(validated.type, "request_clarification");
  assert.equal(validated.question, "Which guard do you mean?");
  assert.deepEqual(validated.options, ["front gate", "captain", "harbor watch", "extra"]);
});

test("validateTurnCommand treats move_player as instant relocation time", () => {
  const validated = validateTurnCommand({
    snapshot: createSnapshot(),
    command: {
      type: "resolve_mechanics",
      timeMode: "travel",
      suggestedActions: ["Look around"],
      mutations: [
        {
          type: "move_player",
          targetLocationId: "loc_market",
          relocationReason: "teleportation",
        },
      ],
    },
  });

  assert.equal(validated.type, "resolve_mechanics");
  assert.equal(validated.timeElapsed, 0);
});

test("validateTurnCommand derives explicit advance_time duration", () => {
  const validated = validateTurnCommand({
    snapshot: createSnapshot(),
    command: {
      type: "resolve_mechanics",
      timeMode: "exploration",
      suggestedActions: ["Keep listening"],
      mutations: [{ type: "advance_time", durationMinutes: 25 }],
    },
  });

  assert.equal(validated.type, "resolve_mechanics");
  assert.equal(validated.timeElapsed, 25);
});

test("validateTurnCommand normalizes execute_fast_forward payloads", () => {
  const snapshot = createSnapshot();
  snapshot.character.inventory = [
    {
      id: "iteminst_oats_1",
      characterInstanceId: "inst_1",
      templateId: "item_oats",
      template: {
        id: "item_oats",
        campaignId: "camp_1",
        name: "Feed Oats",
        description: null,
        value: 1,
        weight: 1,
        rarity: "common",
        tags: [],
      },
      isIdentified: true,
      charges: null,
      properties: null,
    },
  ];

  const validated = validateTurnCommand({
    snapshot,
    command: {
      type: "execute_fast_forward",
      requestedDurationMinutes: 8 * 1440,
      routineSummary: "You settle into a week of stable work.",
      recurringActivities: ["feed the horses", "sweep the tack room", "help repair harnesses", "rub Safra down", "haul water", "patch blankets", "chat with stablehands"],
      intendedOutcomes: ["earn trust", "save money", "keep Safra settled", "stay inconspicuous", "learn the gossip", "restock", "find work"],
      resourceCosts: {
        itemRemovals: [
          {
            templateId: "iteminst_oats_1",
            quantity: 1,
          },
        ],
      },
    },
  });

  assert.equal(validated.type, "execute_fast_forward");
  if (validated.type !== "execute_fast_forward") {
    return;
  }
  assert.equal(validated.requestedDurationMinutes, 7 * 1440);
  assert.equal(validated.timeElapsed, 7 * 1440);
  assert.match(validated.warnings[0] ?? "", /7 days maximum/i);
  assert.equal(validated.resourceCosts?.itemRemovals?.[0]?.templateId, "item_oats");
  assert.equal(validated.recurringActivities.length, 6);
  assert.equal(validated.intendedOutcomes.length, 6);
  assert.equal(validated.pendingCheck, undefined);
  assert.equal(validated.checkResult, undefined);
});

test("validateTurnCommand rejects fast-forward during active pursuit", () => {
  const snapshot = createSnapshot();
  snapshot.state.characterState.conditions = ["being_pursued"];

  const validated = validateTurnCommand({
    snapshot,
    command: {
      type: "execute_fast_forward",
      requestedDurationMinutes: 1440,
      routineSummary: "You try to lie low for the day.",
      recurringActivities: ["keep your head down"],
      intendedOutcomes: ["avoid notice"],
    },
  });

  assert.equal(validated.type, "request_clarification");
  if (validated.type !== "request_clarification") {
    return;
  }
  assert.match(validated.question, /cannot fast-forward time during active combat or pursuit/i);
  assert.deepEqual(validated.options, ["Attack", "Defend", "Flee", "Take cover"]);
});

test("validateTurnCommand derives rest duration from restore_health mutations", () => {
  const validated = validateTurnCommand({
    snapshot: createSnapshot(),
    command: {
      type: "resolve_mechanics",
      timeMode: "rest",
      suggestedActions: ["Wake up"],
      mutations: [{ type: "restore_health", mode: "full_rest" }],
    },
  });

  assert.equal(validated.type, "resolve_mechanics");
  assert.equal(validated.timeElapsed, 480);
});

test("validateTurnCommand derives pending challenge checks from checkIntent", () => {
  const validated = validateTurnCommand({
    snapshot: createSnapshot(),
    command: {
      type: "resolve_mechanics",
      timeMode: "exploration",
      suggestedActions: ["Press harder"],
      checkIntent: {
        type: "challenge",
        reason: "Lean on the guard",
        challengeApproach: "influence",
        citedNpcId: "npc_guard",
      },
      mutations: [{
        type: "adjust_relationship",
        npcId: "npc_guard",
        delta: 1,
        reason: "The guard softens.",
        phase: "conditional",
      }],
    },
  });

  assert.equal(validated.type, "resolve_mechanics");
  assert.equal(validated.pendingCheck?.stat, "charisma");
  assert.equal(validated.pendingCheck?.reason, "Lean on the guard");
  assert.equal(validated.pendingCheck?.dc, 9);
  assert.equal(validated.checkResult, undefined);
});

test("validateTurnCommand suppresses checks that have no success-gated stakes", () => {
  const validated = validateTurnCommand({
    snapshot: createSnapshot(),
    command: {
      type: "resolve_mechanics",
      timeMode: "downtime",
      suggestedActions: ["Wait for the apprentice"],
      checkIntent: {
        type: "challenge",
        reason: "Send the apprentice to find the runeforger",
        challengeApproach: "influence",
        citedNpcId: "npc_guard",
      },
      mutations: [
        {
          type: "advance_time",
          durationMinutes: 15,
        },
      ],
    },
  });

  assert.equal(validated.type, "resolve_mechanics");
  assert.equal(validated.pendingCheck, undefined);
  assert.equal(validated.checkResult, undefined);
});

test("validateTurnCommand promotes investigative manifestations to conditional stakes", () => {
  const validated = validateTurnCommand({
    snapshot: createSnapshot(),
    command: {
      type: "resolve_mechanics",
      timeMode: "exploration",
      suggestedActions: ["Scan the market"],
      checkIntent: {
        type: "challenge",
        reason: "Search the crowd for the cloaked figure",
        challengeApproach: "notice",
      },
      mutations: [
        {
          type: "advance_time",
          durationMinutes: 5,
        },
        {
          type: "spawn_scene_aspect",
          aspectName: "Market Crowd",
          state: "A jostling crowd creates cover and distraction.",
          duration: "scene",
          reason: "Crowds make scanning harder.",
        },
        {
          type: "spawn_temporary_actor",
          spawnKey: "cloaked_figure",
          role: "suspicious individual",
          summary: "A hooded figure threads through the crowd.",
          apparentDisposition: "wary",
          reason: "A successful scan spots the figure.",
        },
      ],
    },
  });

  assert.equal(validated.type, "resolve_mechanics");
  assert.equal(validated.pendingCheck?.stat, "wisdom");
  assert.equal(validated.pendingCheck?.reason, "Search the crowd for the cloaked figure");
  assert.equal(validated.mutations[1]?.phase, "conditional");
  assert.equal(validated.mutations[2]?.phase, "conditional");
});

test("validateTurnCommand uses short exploration timing for local downtime repositioning", () => {
  const validated = validateTurnCommand({
    snapshot: createSnapshot(),
    command: {
      type: "resolve_mechanics",
      timeMode: "downtime",
      suggestedActions: ["Ask about the bread"],
      mutations: [
        {
          type: "spawn_temporary_actor",
          spawnKey: "baker",
          role: "baker",
          summary: "A baker tends fresh loaves under the awning.",
          apparentDisposition: "busy",
          reason: "You head over to the bakery stall.",
        },
        {
          type: "set_player_scene_focus",
          focusKey: "baker_stall",
          label: "Baker's Stall",
          reason: "You step over to the bakery counter.",
        },
      ],
    },
  });

  assert.equal(validated.type, "resolve_mechanics");
  assert.equal(validated.timeElapsed, 20);
});

test("validateTurnCommand can use fetched npc detail to derive pending combat check dc", () => {
  const fetchedFacts: TurnFetchToolResult[] = [
    {
      type: "fetch_npc_detail",
      result: {
        ...createSnapshot().presentNpcs[0],
        inventory: [],
        knownInformation: [],
        relationshipHistory: [],
        temporaryActorId: null,
      },
    },
  ];

  const validated = validateTurnCommand({
    snapshot: { ...createSnapshot(), presentNpcs: [] },
    fetchedFacts,
    command: {
      type: "resolve_mechanics",
      timeMode: "combat",
      suggestedActions: ["Strike again"],
      checkIntent: {
        type: "combat",
        reason: "Rush the guard",
        targetNpcId: "npc_guard",
        approach: "attack",
      },
      mutations: [{ type: "set_npc_state", npcId: "npc_guard", newState: "incapacitated" }],
    },
  });

  assert.equal(validated.type, "resolve_mechanics");
  assert.equal(validated.pendingCheck?.stat, "strength");
  assert.equal(validated.pendingCheck?.dc, 9);
  assert.equal(validated.checkResult, undefined);
});

test("validateTurnCommand does not warn when no suggested actions are provided", () => {
  const command: ResolveMechanicsResponse = {
    type: "resolve_mechanics",
    timeMode: "exploration",
    suggestedActions: [],
    mutations: [{ type: "advance_time", durationMinutes: 5 }],
  };

  const validated = validateTurnCommand({
    snapshot: createSnapshot(),
    command,
  });

  assert.equal(validated.type, "resolve_mechanics");
  assert.deepEqual(validated.warnings, []);
});

test("validateTurnCommand drops record_local_interaction targeting a named npc ref", () => {
  const validated = validateTurnCommand({
    snapshot: createSnapshot(),
    command: {
      type: "resolve_mechanics",
      timeMode: "exploration",
      suggestedActions: ["Buy breakfast"],
      mutations: [
        {
          type: "record_local_interaction",
          localEntityId: "npc:npc_guard",
          interactionSummary: "You buy breakfast from the guard.",
          socialOutcome: "accepts",
        },
        {
          type: "advance_time",
          durationMinutes: 10,
        },
      ],
    },
  });

  assert.equal(validated.type, "resolve_mechanics");
  assert.equal(validated.mutations.length, 1);
  assert.equal(validated.mutations[0]?.type, "advance_time");
  assert.match(
    validated.warnings.join("\n"),
    /record_local_interaction at an invalid local actor ref; mutation was dropped/i,
  );
});

test("validateTurnCommand preserves record_npc_interaction targeting a present named npc", () => {
  const validated = validateTurnCommand({
    snapshot: createSnapshot(),
    command: {
      type: "resolve_mechanics",
      timeMode: "exploration",
      suggestedActions: ["Keep talking"],
      mutations: [
        {
          type: "record_npc_interaction",
          npcId: "npc_guard",
          interactionSummary: "You keep the guard talking while you ask his name.",
          topic: "identity",
          socialOutcome: "asks_question",
        },
      ],
    },
  });

  assert.equal(validated.type, "resolve_mechanics");
  assert.deepEqual(validated.warnings, []);
  assert.deepEqual(validated.mutations, [
    {
      type: "record_npc_interaction",
      npcId: "npc_guard",
      interactionSummary: "You keep the guard talking while you ask his name.",
      topic: "identity",
      socialOutcome: "asks_question",
    },
  ]);
});

test("validateTurnCommand drops record_actor_interaction targeting an offscene actor", () => {
  const snapshot = createSnapshot();
  snapshot.actors = [
    {
      ...snapshot.actors?.[0]!,
      currentLocationId: "loc_market",
    },
  ];

  const validated = validateTurnCommand({
    snapshot,
    command: {
      type: "resolve_mechanics",
      timeMode: "exploration",
      suggestedActions: ["Look around"],
      mutations: [
        {
          type: "record_actor_interaction",
          actorId: "actor_npc_guard",
          interactionSummary: "You talk to the guard.",
          socialOutcome: "acknowledges",
        },
      ],
    },
  });

  assert.equal(validated.type, "resolve_mechanics");
  assert.deepEqual(validated.mutations, []);
  assert.match(validated.warnings.join("\n"), /invalid or unavailable actor/i);
});

test("validateTurnCommand normalizes actorRef-form npc ids for named npc interaction and checks", () => {
  const validated = validateTurnCommand({
    snapshot: createSnapshot(),
    command: {
      type: "resolve_mechanics",
      timeMode: "exploration",
      suggestedActions: ["Keep talking"],
      checkIntent: {
        type: "challenge",
        reason: "Keeping the guard engaged.",
        challengeApproach: "influence",
        citedNpcId: "npc:npc_guard",
      },
      mutations: [
        {
          type: "record_npc_interaction",
          npcId: "npc:npc_guard",
          interactionSummary: "You keep the guard talking while you ask his name.",
          topic: "identity",
          socialOutcome: "asks_question",
        },
      ],
    },
  });

  assert.equal(validated.type, "resolve_mechanics");
  assert.deepEqual(validated.warnings, []);
  assert.deepEqual(validated.checkIntent, {
    type: "challenge",
    reason: "Keeping the guard engaged.",
    challengeApproach: "influence",
    citedNpcId: "npc_guard",
  });
  assert.deepEqual(validated.mutations, [
    {
      type: "record_npc_interaction",
      npcId: "npc_guard",
      interactionSummary: "You keep the guard talking while you ask his name.",
      topic: "identity",
      socialOutcome: "asks_question",
    },
  ]);
});

test("validateTurnCommand repairs uniquely matching bare npc ids missing the npc_ prefix", () => {
  const snapshot = {
    ...createSnapshot(),
    presentNpcs: [
      ...createSnapshot().presentNpcs,
      {
        id: "npc_57621607-d0fb-432a-9d21-7379a58f9d49",
        name: "Elias Thorn",
        role: "customer",
        summary: "A careful buyer.",
        description: "Merchant's mark on his sleeve.",
        socialLayer: "promoted_local" as const,
        isNarrativelyHydrated: true,
        factionId: null,
        factionName: null,
        currentLocationId: "loc_gate",
        approval: 0,
        approvalBand: "neutral" as const,
        isCompanion: false,
        state: "active" as const,
        threatLevel: 1,
      },
    ],
    knownNpcLocationIds: {
      ...createSnapshot().knownNpcLocationIds,
      "npc_57621607-d0fb-432a-9d21-7379a58f9d49": "loc_gate",
    },
  };

  const validated = validateTurnCommand({
    snapshot,
    command: {
      type: "resolve_mechanics",
      timeMode: "exploration",
      suggestedActions: ["Close the sale"],
      mutations: [
        {
          type: "record_npc_interaction",
          npcId: "57621607-d0fb-432a-9d21-7379a58f9d49",
          interactionSummary: "You close the sale with Elias and accept his down payment.",
          socialOutcome: "accepts",
          phase: "immediate",
        },
      ],
    },
  });

  assert.equal(validated.type, "resolve_mechanics");
  assert.deepEqual(validated.warnings, []);
  assert.deepEqual(validated.mutations, [
    {
      type: "record_npc_interaction",
      npcId: "npc_57621607-d0fb-432a-9d21-7379a58f9d49",
      interactionSummary: "You close the sale with Elias and accept his down payment.",
      socialOutcome: "accepts",
      phase: "immediate",
    },
  ]);
});

test("validateTurnCommand normalizes grounded inventory instance ids for adjust_inventory", () => {
  const validated = validateTurnCommand({
    snapshot: {
      ...createSnapshot(),
      character: {
        ...createSnapshot().character,
        inventory: [
          {
            id: "iteminst_roll_1",
            characterInstanceId: "inst_1",
            templateId: "item_honey_roll",
            template: {
              id: "item_honey_roll",
              campaignId: "camp_1",
              name: "Honey-wheat roll",
              description: "A sticky sweet roll glazed with honey.",
              value: 5,
              weight: 1,
              rarity: "common",
              tags: [],
            },
            isIdentified: true,
            charges: null,
            properties: null,
          },
        ],
      },
    },
    command: {
      type: "resolve_mechanics",
      timeMode: "exploration",
      suggestedActions: ["Finish the roll"],
      mutations: [
        {
          type: "adjust_inventory",
          itemId: "iteminst_roll_1",
          quantity: 1,
          action: "remove",
          reason: "You finish the roll.",
          phase: "immediate",
        },
      ],
    },
  });

  assert.equal(validated.type, "resolve_mechanics");
  assert.deepEqual(validated.warnings, []);
  assert.deepEqual(validated.mutations, [
    {
      type: "adjust_inventory",
      itemId: "item_honey_roll",
      quantity: 1,
      action: "remove",
      reason: "You finish the roll.",
      phase: "immediate",
    },
  ]);
});

test("validateTurnCommand preserves record_local_interaction targeting a raw temporary actor id", () => {
  const validated = validateTurnCommand({
    snapshot: {
      ...createSnapshot(),
      temporaryActors: [
        {
          id: "temp_apprentice",
          label: "apprentice",
          currentLocationId: "loc_gate",
          interactionCount: 0,
          firstSeenAtTurn: 0,
          lastSeenAtTurn: 0,
          lastSeenAtTime: 480,
          recentTopics: [],
          lastSummary: "A young apprentice waiting for instructions.",
          holdsInventory: false,
          affectedWorldState: false,
          isInMemoryGraph: false,
          promotedNpcId: null,
          inventory: [],
        },
      ],
    },
    command: {
      type: "resolve_mechanics",
      timeMode: "downtime",
      suggestedActions: ["Send the apprentice"],
      mutations: [
        {
          type: "record_local_interaction",
          localEntityId: "temp_apprentice",
          interactionSummary: "You send the apprentice to find the runeforger.",
          socialOutcome: "complies",
        },
      ],
    },
  });

  assert.equal(validated.type, "resolve_mechanics");
  assert.equal(validated.mutations.length, 1);
  assert.equal(validated.mutations[0]?.type, "record_local_interaction");
});

test("validateTurnCommand preserves record_local_interaction targeting an existing temp-prefixed actor ref", () => {
  const validated = validateTurnCommand({
    snapshot: {
      ...createSnapshot(),
      temporaryActors: [
        {
          id: "temp_apprentice",
          label: "apprentice",
          currentLocationId: "loc_gate",
          interactionCount: 0,
          firstSeenAtTurn: 0,
          lastSeenAtTurn: 0,
          lastSeenAtTime: 480,
          recentTopics: [],
          lastSummary: "A young apprentice waiting for instructions.",
          holdsInventory: false,
          affectedWorldState: false,
          isInMemoryGraph: false,
          promotedNpcId: null,
          inventory: [],
        },
      ],
    },
    command: {
      type: "resolve_mechanics",
      timeMode: "downtime",
      suggestedActions: ["Send the apprentice"],
      mutations: [
        {
          type: "record_local_interaction",
          localEntityId: "temp:temp_apprentice",
          interactionSummary: "You send the apprentice to find the runeforger.",
          socialOutcome: "complies",
        },
      ],
    },
  });

  assert.equal(validated.type, "resolve_mechanics");
  assert.equal(validated.mutations.length, 1);
  assert.equal(validated.mutations[0]?.type, "record_local_interaction");
});

test("validateTurnCommand normalizes bare same-turn spawn keys for record_local_interaction", () => {
  const validated = validateTurnCommand({
    snapshot: createSnapshot(),
    command: {
      type: "resolve_mechanics",
      timeMode: "exploration",
      suggestedActions: ["Discuss pricing"],
      mutations: [
        {
          type: "spawn_temporary_actor",
          spawnKey: "customer_1",
          role: "customer",
          summary: "A curious shopper eyeing the velvet.",
          apparentDisposition: "interested",
          reason: "Customer pauses at the stall.",
        },
        {
          type: "record_local_interaction",
          localEntityId: "customer_1",
          interactionSummary: "You open with a velvet sales pitch.",
          socialOutcome: "acknowledges",
        },
      ],
    },
  });

  assert.equal(validated.type, "resolve_mechanics");
  assert.equal(validated.mutations.length, 2);
  assert.deepEqual(validated.warnings, []);
  assert.deepEqual(validated.mutations[1], {
    type: "record_local_interaction",
    localEntityId: "spawn:customer_1",
    interactionSummary: "You open with a velvet sales pitch.",
    socialOutcome: "acknowledges",
  });
});

test("validateTurnCommand drops record_local_interaction targeting a fabricated temp-prefixed actor ref", () => {
  const validated = validateTurnCommand({
    snapshot: createSnapshot(),
    command: {
      type: "resolve_mechanics",
      timeMode: "exploration",
      suggestedActions: ["Call out to the crowd"],
      mutations: [
        {
          type: "record_local_interaction",
          localEntityId: "temp:stall_crowd",
          interactionSummary: "You call out to the interested crowd around your stall.",
          socialOutcome: "acknowledges",
        },
        {
          type: "advance_time",
          durationMinutes: 10,
        },
      ],
    },
  });

  assert.equal(validated.type, "resolve_mechanics");
  assert.equal(validated.mutations.length, 1);
  assert.equal(validated.mutations[0]?.type, "advance_time");
  assert.match(
    validated.warnings.join("\n"),
    /record_local_interaction at an invalid local actor ref; mutation was dropped/i,
  );
});

test("validateTurnCommand preserves explicit command warnings", () => {
  const validated = validateTurnCommand({
    snapshot: createSnapshot(),
    command: {
      type: "resolve_mechanics",
      timeMode: "travel",
      suggestedActions: ["Choose another route"],
      warnings: ["The north road is blocked."],
      mutations: [
        {
          type: "move_player",
          targetLocationId: "loc_market",
          relocationReason: "forced_transport",
        },
      ],
    },
  });

  assert.equal(validated.type, "resolve_mechanics");
  assert.deepEqual(validated.warnings, ["The north road is blocked."]);
});

test("validateTurnCommand warns when record_local_interaction reads like a solo errand", () => {
  const validated = validateTurnCommand({
    snapshot: {
      ...createSnapshot(),
      temporaryActors: [
        {
          id: "temp_apprentice",
          label: "apprentice",
          currentLocationId: "loc_gate",
          interactionCount: 0,
          firstSeenAtTurn: 0,
          lastSeenAtTurn: 0,
          lastSeenAtTime: 480,
          recentTopics: [],
          lastSummary: "A young apprentice waiting for instructions.",
          holdsInventory: false,
          affectedWorldState: false,
          isInMemoryGraph: false,
          promotedNpcId: null,
          inventory: [],
        },
      ],
    },
    command: {
      type: "resolve_mechanics",
      timeMode: "exploration",
      suggestedActions: ["Head back inside"],
      mutations: [
        {
          type: "record_local_interaction",
          localEntityId: "temp_apprentice",
          interactionSummary: "You head back to the forge and check your bench.",
          socialOutcome: "acknowledges",
        },
      ],
    },
    playerAction: "I head back to the forge and check my bench for the coin purse.",
  });

  assert.equal(validated.type, "resolve_mechanics");
  if (validated.type !== "resolve_mechanics") {
    return;
  }
  assert.match(
    validated.warnings.join("\n"),
    /record_local_interaction for a self-directed errand/i,
  );
});

test("validateTurnCommand warns when actor presence is used as player movement proxy", () => {
  const validated = validateTurnCommand({
    snapshot: createSnapshot(),
    command: {
      type: "resolve_mechanics",
      timeMode: "exploration",
      suggestedActions: ["Head back inside"],
      mutations: [
        {
          type: "set_scene_actor_presence",
          actorRef: "npc:npc_guard",
          newLocationId: "loc_gate",
          reason: "Return to the gate.",
        },
      ],
    },
    playerAction: "I head back to the forge to get my coin purse.",
  });

  assert.equal(validated.type, "resolve_mechanics");
  if (validated.type !== "resolve_mechanics") {
    return;
  }
  assert.match(
    validated.warnings.join("\n"),
    /set_scene_actor_presence as a proxy for player movement/i,
  );
});

test("validateTurnCommand warns when discover_information is used for local sensory investigation", () => {
  const validated = validateTurnCommand({
    snapshot: createSnapshot(),
    command: {
      type: "resolve_mechanics",
      timeMode: "exploration",
      suggestedActions: ["Check the alley"],
      mutations: [
        {
          type: "discover_information",
          informationId: "info_rustle",
        },
      ],
    },
    playerAction: "I investigate the noise in the alley.",
    routerDecision: createRouterDecision({
      attention: {
        primaryIntent: "Investigate the nearby noise.",
        resolvedReferents: [],
        unresolvedReferents: [],
        impliedDestinationFocus: null,
        mustCheck: ["sceneAspects"],
      },
    }),
  });

  assert.equal(validated.type, "resolve_mechanics");
  if (validated.type !== "resolve_mechanics") {
    return;
  }
  assert.match(
    validated.warnings.join("\n"),
    /router indicates local manifestation semantics/i,
  );
});

test("validateTurnCommand drops substituted actor mutations when only an unresolved temporary actor was referenced", () => {
  const validated = validateTurnCommand({
    snapshot: createSnapshot(),
    command: {
      type: "resolve_mechanics",
      timeMode: "exploration",
      suggestedActions: ["Stay alert"],
      checkIntent: {
        type: "challenge",
        reason: "Friendly grab on a present target",
        challengeApproach: "influence",
        citedNpcId: "npc_guard",
      },
      mutations: [
        {
          type: "advance_time",
          durationMinutes: 2,
        },
        {
          type: "adjust_relationship",
          npcId: "npc_guard",
          delta: 1,
          reason: "Friendly greeting",
          phase: "conditional",
        },
      ],
    },
    playerAction: "While they reach over, I grab their wrist before they can slip away.",
    routerDecision: createRouterDecision({
      authorizedVectors: ["investigate"],
      attention: {
        primaryIntent: "React to the cloaked figure.",
        resolvedReferents: [],
        unresolvedReferents: [
          {
            phrase: "they",
            intendedKind: "temporary_actor",
            confidence: "high",
          },
        ],
        impliedDestinationFocus: null,
        mustCheck: ["sceneActors", "recentTurnLedger"],
      },
    }),
  });

  assert.equal(validated.type, "resolve_mechanics");
  if (validated.type !== "resolve_mechanics") {
    return;
  }

  assert.deepEqual(
    validated.mutations.map((mutation) => mutation.type),
    ["advance_time"],
  );
  assert.equal(validated.pendingCheck, undefined);
  assert.deepEqual(validated.narrationHint, {
    unresolvedTargetPhrases: ["they"],
  });
  assert.match(
    validated.warnings.join("\n"),
    /redirect an unresolved target onto a different grounded actor/i,
  );
});

test("validateTurnCommand drops actor-native substitutions when only an unresolved temporary actor was referenced", () => {
  const validated = validateTurnCommand({
    snapshot: createSnapshot(),
    command: {
      type: "resolve_mechanics",
      timeMode: "exploration",
      suggestedActions: ["Stay alert"],
      mutations: [
        {
          type: "record_actor_interaction",
          actorId: "actor_npc_guard",
          interactionSummary: "You catch their wrist before they slip away.",
          socialOutcome: "resists",
          topic: "escape",
        },
      ],
    },
    playerAction: "While they reach over, I grab their wrist before they can slip away.",
    routerDecision: createRouterDecision({
      authorizedVectors: ["investigate"],
      attention: {
        primaryIntent: "React to the cloaked figure.",
        resolvedReferents: [],
        unresolvedReferents: [
          {
            phrase: "they",
            intendedKind: "temporary_actor",
            confidence: "high",
          },
        ],
        impliedDestinationFocus: null,
        mustCheck: ["sceneActors", "recentTurnLedger"],
      },
    }),
  });

  assert.equal(validated.type, "resolve_mechanics");
  if (validated.type !== "resolve_mechanics") {
    return;
  }

  assert.deepEqual(validated.mutations, []);
  assert.deepEqual(validated.narrationHint, {
    unresolvedTargetPhrases: ["they"],
  });
  assert.match(
    validated.warnings.join("\n"),
    /redirect an unresolved target onto a different grounded actor/i,
  );
});
