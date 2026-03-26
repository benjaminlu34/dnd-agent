import assert from "node:assert/strict";
import test from "node:test";
import { engineTestUtils } from "./engine";
import type {
  CampaignSnapshot,
  ResolveMechanicsResponse,
  RouterDecision,
  ValidatedTurnCommand,
} from "./types";

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
      health: 12,
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
    temporaryActors: [
      {
        id: "temp_dockhand",
        label: "dockhand",
        currentLocationId: "loc_gate",
        interactionCount: 1,
        firstSeenAtTurn: 0,
        lastSeenAtTurn: 0,
        lastSeenAtTime: 480,
        recentTopics: [],
        lastSummary: "A dockhand keeps watch by the gate.",
        holdsInventory: false,
        affectedWorldState: false,
        isInMemoryGraph: false,
        promotedNpcId: null,
      },
    ],
    memories: [],
    recentWorldShifts: [],
    recentMessages: [],
    canRetryLatestTurn: false,
    latestRetryableTurnId: null,
  };
}

function createRouterDecision(
  authorizedVectors: RouterDecision["authorizedVectors"],
): RouterDecision {
  return {
    profile: "local",
    confidence: "high",
    authorizedVectors,
    requiredPrerequisites: [],
    reason: "test",
  };
}

function createValidatedCommand(
  checkOutcome: "success" | "partial" | "failure",
  mutations: ResolveMechanicsResponse["mutations"],
): Exclude<ValidatedTurnCommand, { type: "request_clarification" }> {
  return {
    type: "resolve_mechanics",
    timeMode: "exploration",
    suggestedActions: ["Keep moving"],
    mutations,
    warnings: [],
    timeElapsed: 5,
    checkResult: {
      stat: "charisma",
      mode: "normal",
      reason: "Intimidate the guard",
      rolls: [8, 14],
      modifier: 1,
      total: checkOutcome === "success" ? 15 : checkOutcome === "partial" ? 10 : 5,
      dc: 12,
      outcome: checkOutcome,
    },
  };
}

test("promoted temporary actor identity preserves meaningful role phrases", () => {
  assert.equal(engineTestUtils.toPromotedTemporaryActorRole("nearest harvester"), "harvester");
  assert.equal(engineTestUtils.toPromotedTemporaryActorRole("old man near the well"), "old man");
  assert.equal(
    engineTestUtils.toPromotedTemporaryActorRole("guard captain's assistant"),
    "guard captain's assistant",
  );
});

test("promoted temporary actor names preserve the seed identity instead of collapsing to one word", () => {
  assert.equal(engineTestUtils.toPromotedTemporaryActorName("old man near the well"), "Old Man");
  assert.equal(engineTestUtils.toPromotedTemporaryActorName("dock repairer"), "Dock Repairer");
});

test("request hash includes session and version so request identity matches the full submission", () => {
  const baseHash = engineTestUtils.requestHashForSubmission({
    campaignId: "camp_1",
    sessionId: "sess_1",
    expectedStateVersion: 7,
    playerAction: "Wait here for an hour",
    turnMode: "player_input",
  });

  assert.notEqual(
    baseHash,
    engineTestUtils.requestHashForSubmission({
      campaignId: "camp_1",
      sessionId: "sess_2",
      expectedStateVersion: 7,
      playerAction: "Wait here for an hour",
      turnMode: "player_input",
    }),
  );

  assert.notEqual(
    baseHash,
    engineTestUtils.requestHashForSubmission({
      campaignId: "camp_1",
      sessionId: "sess_1",
      expectedStateVersion: 8,
      playerAction: "Wait here for an hour",
      turnMode: "player_input",
    }),
  );
});

test("request hash changes when observe mode changes the submission identity", () => {
  const playerInputHash = engineTestUtils.requestHashForSubmission({
    campaignId: "camp_1",
    sessionId: "sess_1",
    expectedStateVersion: 7,
    playerAction: "Observe",
    turnMode: "player_input",
  });

  const observeHash = engineTestUtils.requestHashForSubmission({
    campaignId: "camp_1",
    sessionId: "sess_1",
    expectedStateVersion: 7,
    playerAction: "Observe",
    turnMode: "observe",
  });

  assert.notEqual(playerInputHash, observeHash);
});

test("router-selected local profile only applies at high confidence", () => {
  assert.equal(
    engineTestUtils.promptContextProfileForRouter({
      profile: "local",
      confidence: "high",
      authorizedVectors: [],
      requiredPrerequisites: [],
      reason: "same-scene action",
    }),
    "local",
  );

  assert.equal(
    engineTestUtils.promptContextProfileForRouter({
      profile: "local",
      confidence: "low",
      authorizedVectors: ["converse"],
      requiredPrerequisites: [],
      reason: "uncertain broader context dependency",
    }),
    "full",
  );
});

test("observe mode router bypass authorizes investigate but not travel or trade", () => {
  assert.deepEqual(
    engineTestUtils.routerDecisionForTurnMode({
      turnMode: "observe",
      explicitTravel: false,
    }).authorizedVectors,
    ["investigate"],
  );

  assert.deepEqual(
    engineTestUtils.routerDecisionForTurnMode({
      turnMode: "player_input",
      explicitTravel: true,
    }).authorizedVectors,
    [],
  );
});

test("failed checks still apply immediate costs but block conditional rewards", () => {
  const evaluated = engineTestUtils.evaluateResolvedCommand({
    snapshot: createSnapshot(),
    command: createValidatedCommand("failure", [
      { type: "adjust_gold", delta: -3, reason: "guard fee", phase: "immediate" },
      { type: "adjust_relationship", npcId: "npc_guard", delta: 2, reason: "push the guard", phase: "conditional" },
      { type: "advance_time", durationMinutes: 5 },
    ]),
    fetchedFacts: [],
    routerDecision: createRouterDecision(["economy_strict", "converse"]),
  });

  assert.deepEqual(
    evaluated.stateCommitLog.map((entry) => [entry.kind, entry.mutationType, entry.status, entry.reasonCode]),
    [
      ["check", null, "applied", "check_failure"],
      ["mutation", "adjust_gold", "applied", "gold_adjusted"],
      ["mutation", "adjust_relationship", "rejected", "check_failed"],
      ["mutation", "advance_time", "applied", "time_advanced"],
    ],
  );
  assert.equal(evaluated.nextState.globalTime, 485);
  assert.equal(evaluated.stateCommitLog[1]?.metadata?.delta, -3);
});

test("unscoped router fallback does not reject routine local interactions", () => {
  const evaluated = engineTestUtils.evaluateResolvedCommand({
    snapshot: {
      ...createSnapshot(),
      temporaryActors: [
        {
          id: "temp_apprentice",
          label: "apprentice",
          currentLocationId: "loc_gate",
          promotedNpcId: null,
          interactionCount: 0,
          recentTopics: [],
          lastSummary: "A young apprentice waiting for instructions.",
          lastSeenAtTurn: 0,
          lastSeenAtTime: 480,
        },
      ],
    },
    command: {
      type: "resolve_mechanics",
      timeMode: "downtime",
      suggestedActions: ["Wait for the apprentice"],
      mutations: [
        {
          type: "record_local_interaction",
          localEntityId: "temp_apprentice",
          interactionSummary: "You send the apprentice to find the runeforger.",
          topic: "runeforger",
        },
        {
          type: "advance_time",
          durationMinutes: 15,
        },
      ],
      warnings: [],
      timeElapsed: 15,
    },
    fetchedFacts: [],
    routerDecision: {
      profile: "full",
      confidence: "low",
      authorizedVectors: [],
      requiredPrerequisites: [],
      reason: "Planner output was invalid, so the turn falls back to full context and no explicit vectors.",
    },
  });

  assert.equal(evaluated.stateCommitLog[0]?.reasonCode, "local_interaction_recorded");
  assert.equal(evaluated.stateCommitLog[0]?.status, "applied");
  assert.equal(evaluated.stateCommitLog[1]?.reasonCode, "time_advanced");
});

test("partial checks reject requested mutations with check_partial_blocked", () => {
  const evaluated = engineTestUtils.evaluateResolvedCommand({
    snapshot: createSnapshot(),
    command: createValidatedCommand("partial", [
      { type: "adjust_gold", delta: -2, reason: "small fee", phase: "immediate" },
      { type: "adjust_relationship", npcId: "npc_guard", delta: 4, reason: "press too hard", phase: "conditional" },
      { type: "advance_time", durationMinutes: 5 },
    ]),
    fetchedFacts: [],
    routerDecision: createRouterDecision(["economy_strict", "converse"]),
  });

  assert.equal(evaluated.stateCommitLog[1]?.reasonCode, "gold_adjusted");
  assert.equal(evaluated.stateCommitLog[2]?.reasonCode, "check_partial_blocked");
  assert.equal(evaluated.stateCommitLog[2]?.status, "rejected");
  assert.equal(evaluated.nextState.globalTime, 485);
});

test("already discovered information becomes noop already_applied", () => {
  const snapshot = {
    ...createSnapshot(),
    discoveredInformation: [
      {
        id: "info_1",
        title: "A Hidden Note",
        summary: "A clue already entered the campaign record.",
        accessibility: "public",
        truthfulness: "verified",
        locationId: "loc_gate",
        locationName: "Ash Gate",
        factionId: null,
        factionName: null,
        sourceNpcId: null,
        sourceNpcName: null,
        isDiscovered: true,
        expiresAtTime: null,
      },
    ],
  } as CampaignSnapshot;

  const evaluated = engineTestUtils.evaluateResolvedCommand({
    snapshot,
    command: createValidatedCommand("success", [
      { type: "discover_information", informationId: "info_1" },
    ]),
    fetchedFacts: [],
    routerDecision: createRouterDecision(["investigate"]),
  });

  assert.deepEqual(
    evaluated.stateCommitLog.map((entry) => [entry.kind, entry.mutationType, entry.status, entry.reasonCode]),
    [
      ["check", null, "applied", "check_success"],
      ["mutation", "discover_information", "noop", "already_applied"],
    ],
  );
});

test("successful checks allow requested mutations to resolve normally", () => {
  const evaluated = engineTestUtils.evaluateResolvedCommand({
    snapshot: createSnapshot(),
    command: createValidatedCommand("success", [
      { type: "adjust_gold", delta: 120, reason: "guard bribe backfires into a tip", phase: "conditional" },
      { type: "adjust_relationship", npcId: "npc_guard", delta: 5, reason: "guard warms up", phase: "conditional" },
      { type: "advance_time", durationMinutes: 5 },
    ]),
    fetchedFacts: [],
    routerDecision: createRouterDecision(["economy_strict", "converse"]),
  });

  assert.equal(evaluated.stateCommitLog[1]?.reasonCode, "gold_adjusted");
  assert.equal(evaluated.stateCommitLog[1]?.status, "applied");
  assert.equal(evaluated.stateCommitLog[1]?.metadata?.delta, 50);
  assert.equal(evaluated.stateCommitLog[2]?.reasonCode, "relationship_adjusted");
  assert.equal(evaluated.stateCommitLog[2]?.metadata?.delta, 2);
  assert.equal(evaluated.nextState.globalTime, 485);
});

test("record_local_interaction applies on failed checks and updates temp-local state in evaluation", () => {
  const evaluated = engineTestUtils.evaluateResolvedCommand({
    snapshot: createSnapshot(),
    command: createValidatedCommand("failure", [
      {
        type: "record_local_interaction",
        localEntityId: "temp_dockhand",
        interactionSummary: "The dockhand finally answers and points toward the market stairs.",
        topic: "sealed stairs",
      },
    ]),
    fetchedFacts: [],
    routerDecision: createRouterDecision(["converse"]),
  });

  assert.equal(evaluated.stateCommitLog[1]?.mutationType, "record_local_interaction");
  assert.equal(evaluated.stateCommitLog[1]?.status, "applied");
  assert.equal(evaluated.stateCommitLog[1]?.reasonCode, "local_interaction_recorded");
});

test("inventory removal applies as an immediate cost while add stays blocked on failed checks", () => {
  const snapshot = {
    ...createSnapshot(),
    character: {
      ...createSnapshot().character,
      inventory: [
        {
          id: "iteminst_1",
          characterInstanceId: "inst_1",
          templateId: "item_rope",
          template: {
            id: "item_rope",
            campaignId: "camp_1",
            name: "Rope",
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
      ],
    },
  } as CampaignSnapshot;

  const evaluated = engineTestUtils.evaluateResolvedCommand({
    snapshot,
    command: createValidatedCommand("failure", [
      { type: "adjust_inventory", itemId: "item_rope", quantity: 1, action: "remove", reason: "The rope frays and snaps." },
      { type: "adjust_inventory", itemId: "item_rope", quantity: 1, action: "add", reason: "You pull up a spare line." },
    ]),
    fetchedFacts: [],
    routerDecision: createRouterDecision(["investigate"]),
  });

  assert.equal(evaluated.stateCommitLog[1]?.reasonCode, "inventory_adjusted");
  assert.equal(evaluated.stateCommitLog[1]?.status, "applied");
  assert.equal(evaluated.stateCommitLog[2]?.reasonCode, "check_failed");
  assert.equal(evaluated.stateCommitLog[2]?.status, "rejected");
});

test("inventory add accepts newly acquired grounded item types", () => {
  const evaluated = engineTestUtils.evaluateResolvedCommand({
    snapshot: createSnapshot(),
    command: createValidatedCommand("success", [
      { type: "adjust_inventory", itemId: "item_lantern", quantity: 1, action: "add", reason: "You take the lantern." },
    ]),
    fetchedFacts: [],
    routerDecision: createRouterDecision(["investigate"]),
    groundedItemIds: ["item_lantern"],
  });

  assert.equal(evaluated.stateCommitLog[1]?.reasonCode, "inventory_adjusted");
  assert.equal(evaluated.stateCommitLog[1]?.status, "applied");
});

test("scene-object mutations persist into next state", () => {
  const evaluated = engineTestUtils.evaluateResolvedCommand({
    snapshot: createSnapshot(),
    command: createValidatedCommand("success", [
      {
        type: "update_scene_object",
        objectId: "gate_winch",
        newState: "jammed open",
        reason: "The player jams the mechanism.",
      },
    ]),
    fetchedFacts: [],
    routerDecision: createRouterDecision(["investigate"]),
  });

  assert.equal(evaluated.nextState.sceneObjectStates.gate_winch, "jammed open");
  assert.equal(evaluated.stateCommitLog[1]?.reasonCode, "scene_object_updated");
});

test("blocked routes reject move_player deterministically", () => {
  const snapshot = {
    ...createSnapshot(),
    adjacentRoutes: [
      {
        ...createSnapshot().adjacentRoutes[0],
        currentStatus: "blocked",
      },
    ],
  } as CampaignSnapshot;

  const evaluated = engineTestUtils.evaluateResolvedCommand({
    snapshot,
    command: createValidatedCommand("success", [
      { type: "move_player", routeEdgeId: "edge_gate_market", targetLocationId: "loc_market" },
    ]),
    fetchedFacts: [],
    routerDecision: createRouterDecision(["investigate"]),
  });

  assert.equal(evaluated.stateCommitLog[1]?.reasonCode, "route_blocked");
  assert.equal(evaluated.nextState.currentLocationId, "loc_gate");
});

test("deterministic narration fallback includes simulation-originated commit log entries", () => {
  const narration = engineTestUtils.deterministicNarrationFallback({
    playerAction: "Wait and watch the road.",
    stateCommitLog: [
      {
        kind: "simulation",
        mutationType: null,
        status: "applied",
        reasonCode: "route_status_changed",
        summary: "North Road changes status to blocked.",
        metadata: {
          entityType: "route",
          targetId: "edge_gate_market",
          label: "North Road",
        },
      },
    ],
    checkResult: null,
  });

  assert.match(narration, /North Road changes status to blocked/);
});
