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
      ["mutation", "advance_time", "applied", "time_advanced"],
      ["mutation", "adjust_relationship", "rejected", "check_failed"],
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
          firstSeenAtTurn: 0,
          recentTopics: [],
          lastSummary: "A young apprentice waiting for instructions.",
          holdsInventory: false,
          affectedWorldState: false,
          isInMemoryGraph: false,
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

  assert.deepEqual(
    evaluated.stateCommitLog.map((entry) => [entry.kind, entry.mutationType, entry.status, entry.reasonCode]),
    [
      ["check", null, "applied", "check_partial"],
      ["mutation", "adjust_gold", "applied", "gold_adjusted"],
      ["mutation", "advance_time", "applied", "time_advanced"],
      ["mutation", "adjust_relationship", "rejected", "check_partial_blocked"],
    ],
  );
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

  assert.deepEqual(
    evaluated.stateCommitLog.map((entry) => [entry.kind, entry.mutationType, entry.status, entry.reasonCode]),
    [
      ["check", null, "applied", "check_success"],
      ["mutation", "advance_time", "applied", "time_advanced"],
      ["mutation", "adjust_gold", "applied", "gold_adjusted"],
      ["mutation", "adjust_relationship", "applied", "relationship_adjusted"],
    ],
  );
  assert.equal(evaluated.stateCommitLog[2]?.metadata?.delta, 50);
  assert.equal(evaluated.stateCommitLog[3]?.metadata?.delta, 2);
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
        type: "spawn_scene_aspect",
        aspectName: "gate winch",
        state: "jammed open",
        duration: "scene",
        reason: "The player jams the mechanism.",
      },
    ]),
    fetchedFacts: [],
    routerDecision: createRouterDecision(["investigate"]),
  });

  assert.equal(evaluated.nextState.sceneAspects.gate_winch?.state, "jammed open");
  assert.equal(evaluated.nextState.sceneAspects.gate_winch?.duration, "scene");
  assert.equal(evaluated.stateCommitLog[1]?.reasonCode, "scene_aspect_spawned");
});

test("temporary actor spawn handles can be referenced later in the same turn", () => {
  const evaluated = engineTestUtils.evaluateResolvedCommand({
    snapshot: createSnapshot(),
    command: {
      type: "resolve_mechanics",
      timeMode: "exploration",
      suggestedActions: ["Keep talking"],
      mutations: [
        {
          type: "spawn_temporary_actor",
          spawnKey: "apprentice",
          role: "apprentice",
          summary: "A young apprentice hovers near the gate with ink on their cuffs.",
          apparentDisposition: "eager but anxious",
          reason: "The player calls for a plausible helper.",
        },
        {
          type: "record_local_interaction",
          localEntityId: "spawn:apprentice",
          interactionSummary: "You send the apprentice to fetch the runeforger.",
          topic: "runeforger",
        },
      ],
      warnings: [],
      timeElapsed: 10,
    },
    fetchedFacts: [],
    routerDecision: createRouterDecision(["converse"]),
  });

  assert.equal(evaluated.stateCommitLog[0]?.reasonCode, "temporary_actor_spawned");
  assert.equal(evaluated.stateCommitLog[1]?.reasonCode, "local_interaction_recorded");
});

test("reused offscene temporary actors can be brought back and referenced later in the same turn", () => {
  const evaluated = engineTestUtils.evaluateResolvedCommand({
    snapshot: {
      ...createSnapshot(),
      temporaryActors: [
        {
          id: "temp_apprentice",
          label: "apprentice",
          currentLocationId: null,
          interactionCount: 1,
          firstSeenAtTurn: 0,
          lastSeenAtTurn: 0,
          lastSeenAtTime: 480,
          recentTopics: [],
          lastSummary: "A young apprentice hovers near the gate. Apparent disposition: eager but anxious.",
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
      suggestedActions: ["Bring the apprentice back"],
      mutations: [
        {
          type: "spawn_temporary_actor",
          spawnKey: "apprentice",
          role: "apprentice",
          summary: "A young apprentice hovers near the gate.",
          apparentDisposition: "eager but anxious",
          reason: "The player calls for the same helper to return.",
        },
        {
          type: "record_local_interaction",
          localEntityId: "spawn:apprentice",
          interactionSummary: "You send the apprentice to fetch the runeforger.",
          topic: "runeforger",
        },
      ],
      warnings: [],
      timeElapsed: 10,
    },
    fetchedFacts: [],
    routerDecision: createRouterDecision(["converse"]),
  });

  assert.equal(evaluated.stateCommitLog[0]?.reasonCode, "temporary_actor_reused");
  assert.match(evaluated.stateCommitLog[0]?.summary ?? "", /arrives in the scene/i);
  assert.equal(evaluated.stateCommitLog[0]?.metadata?.arrivesInCurrentScene, true);
  assert.equal(evaluated.stateCommitLog[1]?.reasonCode, "local_interaction_recorded");
});

test("offscene npc refs can be returned to the scene by prefixed actorRef", () => {
  const evaluated = engineTestUtils.evaluateResolvedCommand({
    snapshot: {
      ...createSnapshot(),
      presentNpcs: [],
      knownNpcLocationIds: {
        npc_guard: null,
      },
    },
    command: {
      type: "resolve_mechanics",
      timeMode: "downtime",
      suggestedActions: ["Wait for the guard"],
      mutations: [
        {
          type: "set_scene_actor_presence",
          actorRef: "npc:npc_guard",
          newLocationId: "loc_gate",
          reason: "The guard returns to the gate.",
        },
      ],
      warnings: [],
      timeElapsed: 10,
    },
    fetchedFacts: [],
    routerDecision: createRouterDecision(["converse"]),
  });

  assert.equal(evaluated.stateCommitLog[0]?.status, "applied");
  assert.equal(evaluated.stateCommitLog[0]?.reasonCode, "scene_actor_presence_updated");
  assert.equal(evaluated.stateCommitLog[0]?.metadata?.arrivesInCurrentScene, true);
});

test("temporary actor reuse prefers the most recently seen matching actor", () => {
  const evaluated = engineTestUtils.evaluateResolvedCommand({
    snapshot: {
      ...createSnapshot(),
      temporaryActors: [
        {
          id: "temp_older",
          label: "apprentice",
          currentLocationId: "loc_gate",
          interactionCount: 1,
          firstSeenAtTurn: 0,
          lastSeenAtTurn: 2,
          lastSeenAtTime: 500,
          recentTopics: [],
          lastSummary: "A young apprentice waits by the gate. Apparent disposition: eager but anxious.",
          holdsInventory: false,
          affectedWorldState: false,
          isInMemoryGraph: false,
          promotedNpcId: null,
        },
        {
          id: "temp_newer",
          label: "apprentice",
          currentLocationId: "loc_gate",
          interactionCount: 1,
          firstSeenAtTurn: 0,
          lastSeenAtTurn: 4,
          lastSeenAtTime: 540,
          recentTopics: [],
          lastSummary: "A young apprentice waits by the gate. Apparent disposition: eager but anxious.",
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
      suggestedActions: ["Call for the apprentice"],
      mutations: [
        {
          type: "spawn_temporary_actor",
          spawnKey: "apprentice",
          role: "apprentice",
          summary: "A young apprentice waits by the gate.",
          apparentDisposition: "eager but anxious",
          reason: "The player calls for the same helper again.",
        },
      ],
      warnings: [],
      timeElapsed: 10,
    },
    fetchedFacts: [],
    routerDecision: createRouterDecision(["converse"]),
  });

  assert.equal(evaluated.stateCommitLog[0]?.reasonCode, "temporary_actor_reused");
  assert.equal(evaluated.stateCommitLog[0]?.metadata?.actorRef, "temp:temp_newer");
});

test("environmental item spawn handles can be referenced later in the same turn", () => {
  const evaluated = engineTestUtils.evaluateResolvedCommand({
    snapshot: createSnapshot(),
    command: {
      type: "resolve_mechanics",
      timeMode: "exploration",
      suggestedActions: ["Use the crate"],
      mutations: [
        {
          type: "spawn_environmental_item",
          spawnKey: "crate",
          itemName: "Loose Crate Lid",
          description: "A rough plank lid lying beside a split shipping crate.",
          quantity: 1,
          reason: "The player grabs improvised cover.",
        },
        {
          type: "adjust_inventory",
          itemId: "spawn:crate",
          quantity: 1,
          action: "remove",
          reason: "You wedge it in place as cover.",
        },
      ],
      warnings: [],
      timeElapsed: 5,
    },
    fetchedFacts: [],
    routerDecision: createRouterDecision(["investigate"]),
  });

  assert.equal(evaluated.stateCommitLog[0]?.reasonCode, "environmental_item_spawned");
  assert.equal(evaluated.stateCommitLog[1]?.reasonCode, "inventory_adjusted");
});

test("forward spawn references reject cleanly", () => {
  const evaluated = engineTestUtils.evaluateResolvedCommand({
    snapshot: createSnapshot(),
    command: {
      type: "resolve_mechanics",
      timeMode: "exploration",
      suggestedActions: ["Wait"],
      mutations: [
        {
          type: "record_local_interaction",
          localEntityId: "spawn:apprentice",
          interactionSummary: "You ask the apprentice to wait.",
        },
        {
          type: "spawn_temporary_actor",
          spawnKey: "apprentice",
          role: "apprentice",
          summary: "A young helper lingers nearby.",
          apparentDisposition: "alert",
          reason: "The player calls over a helper.",
        },
      ],
      warnings: [],
      timeElapsed: 5,
    },
    fetchedFacts: [],
    routerDecision: createRouterDecision(["converse"]),
  });

  assert.equal(evaluated.stateCommitLog[0]?.status, "rejected");
  assert.equal(evaluated.stateCommitLog[0]?.reasonCode, "invalid_target");
});

test("spawn namespaces do not cross-resolve", () => {
  const evaluated = engineTestUtils.evaluateResolvedCommand({
    snapshot: createSnapshot(),
    command: {
      type: "resolve_mechanics",
      timeMode: "exploration",
      suggestedActions: ["Keep moving"],
      mutations: [
        {
          type: "spawn_temporary_actor",
          spawnKey: "shared",
          role: "apprentice",
          summary: "A runner slips through the checkpoint.",
          apparentDisposition: "out of breath",
          reason: "A plausible helper appears.",
        },
        {
          type: "adjust_inventory",
          itemId: "spawn:shared",
          quantity: 1,
          action: "add",
          reason: "Attempt to treat an actor handle as an item handle.",
        },
      ],
      warnings: [],
      timeElapsed: 5,
    },
    fetchedFacts: [],
    routerDecision: createRouterDecision(["converse", "investigate"]),
  });

  assert.equal(evaluated.stateCommitLog[1]?.status, "rejected");
  assert.equal(evaluated.stateCommitLog[1]?.reasonCode, "invalid_target");
});

test("scene-duration aspects clear only on successful travel", () => {
  const snapshot = {
    ...createSnapshot(),
    state: {
      ...createSnapshot().state,
      sceneAspects: {
        gate_smoke: {
          label: "gate smoke",
          state: "hanging thick in the archway",
          duration: "scene",
        },
        charter_notice: {
          label: "charter notice",
          state: "nailed to the post",
          duration: "permanent",
        },
      },
    },
  } as CampaignSnapshot;

  const moved = engineTestUtils.evaluateResolvedCommand({
    snapshot,
    command: createValidatedCommand("success", [
      { type: "move_player", routeEdgeId: "edge_gate_market", targetLocationId: "loc_market" },
    ]),
    fetchedFacts: [],
    routerDecision: createRouterDecision(["investigate"]),
  });

  assert.equal(moved.nextState.sceneAspects.gate_smoke, undefined);
  assert.equal(moved.nextState.sceneAspects.charter_notice?.state, "nailed to the post");

  const blocked = engineTestUtils.evaluateResolvedCommand({
    snapshot: {
      ...snapshot,
      adjacentRoutes: [
        {
          ...snapshot.adjacentRoutes[0],
          currentStatus: "blocked",
        },
      ],
    },
    command: createValidatedCommand("success", [
      { type: "move_player", routeEdgeId: "edge_gate_market", targetLocationId: "loc_market" },
    ]),
    fetchedFacts: [],
    routerDecision: createRouterDecision(["investigate"]),
  });

  assert.equal(blocked.nextState.sceneAspects.gate_smoke?.state, "hanging thick in the archway");
});

test("scene actor presence updates remove temporary actors from projected availability", () => {
  const evaluated = engineTestUtils.evaluateResolvedCommand({
    snapshot: createSnapshot(),
    command: {
      type: "resolve_mechanics",
      timeMode: "downtime",
      suggestedActions: ["Wait"],
      mutations: [
        {
          type: "set_scene_actor_presence",
          actorRef: "temp:temp_dockhand",
          newLocationId: null,
          reason: "You send the dockhand away on an errand.",
        },
        {
          type: "record_local_interaction",
          localEntityId: "temp:temp_dockhand",
          interactionSummary: "You call the dockhand back immediately.",
        },
      ],
      warnings: [],
      timeElapsed: 10,
    },
    fetchedFacts: [],
    routerDecision: createRouterDecision(["converse"]),
  });

  assert.equal(evaluated.stateCommitLog[0]?.reasonCode, "scene_actor_presence_updated");
  assert.equal(evaluated.stateCommitLog[1]?.status, "rejected");
  assert.equal(evaluated.stateCommitLog[1]?.reasonCode, "invalid_target");
});

test("wait fallback narration explicitly marks non-arrival when nothing comes back", () => {
  const narration = engineTestUtils.deterministicNarrationFallback({
    playerAction: "Wait until the apprentice returns.",
    stateCommitLog: [
      {
        kind: "mutation",
        mutationType: "advance_time",
        status: "applied",
        reasonCode: "time_advanced",
        summary: "Time passes for 30 minutes.",
        metadata: null,
      },
    ],
    checkResult: null,
  });

  assert.match(narration, /has not happened yet/i);
});

test("wait fallback still marks non-arrival when a departure happened instead", () => {
  const narration = engineTestUtils.deterministicNarrationFallback({
    playerAction: "Wait until the apprentice returns.",
    stateCommitLog: [
      {
        kind: "mutation",
        mutationType: "set_scene_actor_presence",
        status: "applied",
        reasonCode: "scene_actor_presence_updated",
        summary: "The dockhand leaves the scene.",
        metadata: {
          actorRef: "temp:temp_dockhand",
          newLocationId: null,
          arrivesInCurrentScene: false,
        },
      },
    ],
    checkResult: null,
  });

  assert.match(narration, /has not happened yet/i);
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
