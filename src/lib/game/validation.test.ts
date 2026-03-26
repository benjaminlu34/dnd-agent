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
      sceneObjectStates: {},
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

test("validateTurnCommand rolls challenge checks from checkIntent", () => {
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
  assert.equal(validated.checkResult?.stat, "charisma");
  assert.equal(validated.checkResult?.reason, "Lean on the guard");
  assert.equal(validated.checkResult?.dc, 9);
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
  assert.equal(validated.checkResult, undefined);
});

test("validateTurnCommand can use fetched npc detail to derive combat check dc", () => {
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
  assert.equal(validated.checkResult?.stat, "strength");
  assert.equal(validated.checkResult?.dc, 9);
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
