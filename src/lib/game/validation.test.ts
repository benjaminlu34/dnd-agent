import assert from "node:assert/strict";
import test from "node:test";
import type {
  CampaignSnapshot,
  ResolveMechanicsResponse,
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
      sceneAspects: {},
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
      gold: 10,
      inventory: [],
      commodityStacks: [],
    },
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

test("validateTurnCommand derives travel time from move_player mutations", () => {
  const validated = validateTurnCommand({
    snapshot: createSnapshot(),
    command: {
      type: "resolve_mechanics",
      timeMode: "travel",
      suggestedActions: ["Look around"],
      mutations: [
        {
          type: "move_player",
          routeEdgeId: "edge_gate_market",
          targetLocationId: "loc_market",
        },
      ],
    },
  });

  assert.equal(validated.type, "resolve_mechanics");
  assert.equal(validated.timeElapsed, 15);
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

test("validateTurnCommand can use fetched npc detail to derive pending combat check dc", () => {
  const fetchedFacts: TurnFetchToolResult[] = [
    {
      type: "fetch_npc_detail",
      result: {
        ...createSnapshot().presentNpcs[0],
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

test("validateTurnCommand warns when no suggested actions are provided", () => {
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
  assert.deepEqual(validated.warnings, [
    "Mechanics response returned no suggested actions; engine provided none.",
  ]);
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
        },
      ],
    },
  });

  assert.equal(validated.type, "resolve_mechanics");
  assert.equal(validated.mutations.length, 1);
  assert.equal(validated.mutations[0]?.type, "record_local_interaction");
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
          routeEdgeId: "edge_gate_market",
          targetLocationId: "loc_market",
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
