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
      sceneFocus: null,
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
      health: 12,
      gold: 10,
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
    clarification: {
      needed: false,
      blocker: null,
      question: null,
      options: [],
    },
    attention: {
      primaryIntent: "Test routing.",
      resolvedReferents: [],
      unresolvedReferents: [],
      impliedDestinationFocus: null,
      mustCheck: [],
    },
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

test("router-selected local profile stays local for micro-scene routing even at low confidence", () => {
  assert.equal(
    engineTestUtils.promptContextProfileForRouter({
      profile: "local",
      confidence: "high",
      authorizedVectors: [],
      requiredPrerequisites: [],
      reason: "same-scene action",
      clarification: {
        needed: false,
        blocker: null,
        question: null,
        options: [],
      },
      attention: {
        primaryIntent: "Same-scene action.",
        resolvedReferents: [],
        unresolvedReferents: [],
        impliedDestinationFocus: null,
        mustCheck: [],
      },
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
      clarification: {
        needed: false,
        blocker: null,
        question: null,
        options: [],
      },
      attention: {
        primaryIntent: "Uncertain broader context dependency.",
        resolvedReferents: [],
        unresolvedReferents: [],
        impliedDestinationFocus: null,
        mustCheck: [],
      },
    }),
    "local",
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
      clarification: {
        needed: false,
        blocker: null,
        question: null,
        options: [],
      },
      attention: {
        primaryIntent: "Fallback routine interaction.",
        resolvedReferents: [],
        unresolvedReferents: [],
        impliedDestinationFocus: null,
        mustCheck: [],
      },
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

test("grounded knowledge discoveries still apply when backed by fetched facts", () => {
  const evaluated = engineTestUtils.evaluateResolvedCommand({
    snapshot: createSnapshot(),
    command: {
      type: "resolve_mechanics",
      timeMode: "exploration",
      suggestedActions: ["Review the clue"],
      mutations: [
        { type: "discover_information", informationId: "info_smuggler_ledger" },
      ],
      warnings: [],
      timeElapsed: 5,
    },
    fetchedFacts: [
      {
        type: "fetch_information_detail",
        result: {
          id: "info_smuggler_ledger",
          title: "Smuggler Ledger",
          summary: "A ledger ties tonight's cargo to the harbor syndicate.",
          content: "The ledger ties tonight's cargo to the harbor syndicate.",
          truthfulness: "verified",
          accessibility: "guarded",
          locationId: "loc_gate",
          locationName: "Ash Gate",
          factionId: null,
          factionName: null,
          sourceNpcId: null,
          sourceNpcName: null,
          isDiscovered: false,
          expiresAtTime: null,
        },
      },
    ],
    routerDecision: createRouterDecision(["investigate"]),
    playerAction: "I connect the ledger entry to what I already know.",
  });

  assert.deepEqual(
    evaluated.stateCommitLog.map((entry) => [entry.kind, entry.mutationType, entry.status, entry.reasonCode]),
    [
      ["mutation", "discover_information", "applied", "information_discovered"],
    ],
  );
});

test("local sensory investigation rejects discover_information and points toward manifestation semantics", () => {
  const evaluated = engineTestUtils.evaluateResolvedCommand({
    snapshot: {
      ...createSnapshot(),
      localInformation: [
        {
          id: "info_rustle",
          title: "The Rustle",
          summary: "Something moved in the alley.",
          accessibility: "public",
          truthfulness: "uncertain",
          locationId: "loc_gate",
          locationName: "Ash Gate",
          factionId: null,
          factionName: null,
          sourceNpcId: null,
          sourceNpcName: null,
          isDiscovered: false,
          expiresAtTime: null,
        },
      ],
    },
    command: {
      type: "resolve_mechanics",
      timeMode: "exploration",
      suggestedActions: ["Check the alley"],
      mutations: [
        { type: "discover_information", informationId: "info_rustle" },
      ],
      warnings: [],
      timeElapsed: 5,
    },
    fetchedFacts: [],
    routerDecision: {
      ...createRouterDecision(["investigate"]),
      attention: {
        primaryIntent: "Investigate the nearby noise.",
        resolvedReferents: [],
        unresolvedReferents: [],
        impliedDestinationFocus: null,
        mustCheck: ["sceneAspects"],
      },
    },
    playerAction: "I investigate the noise in the alley.",
  });

  assert.deepEqual(
    evaluated.stateCommitLog.map((entry) => [entry.mutationType, entry.status, entry.reasonCode]),
    [
      ["discover_information", "rejected", "invalid_semantics"],
    ],
  );
  assert.match(evaluated.stateCommitLog[0]?.summary ?? "", /manifest/i);
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

test("record_local_interaction is authorized on economy_light turns", () => {
  const evaluated = engineTestUtils.evaluateResolvedCommand({
    snapshot: {
      ...createSnapshot(),
      temporaryActors: [
        {
          id: "temp_baker_boy",
          label: "baker's boy",
          currentLocationId: "loc_gate",
          interactionCount: 0,
          firstSeenAtTurn: 0,
          lastSeenAtTurn: 0,
          lastSeenAtTime: 480,
          recentTopics: [],
          lastSummary: "A baker's boy hurries past with a basket of fresh bread.",
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
      suggestedActions: ["Buy breakfast"],
      mutations: [
        {
          type: "record_local_interaction",
          localEntityId: "temp:temp_baker_boy",
          interactionSummary: "You stop the baker's boy and buy a quick breakfast.",
          topic: "breakfast",
        },
      ],
      warnings: [],
      timeElapsed: 10,
    },
    fetchedFacts: [],
    routerDecision: createRouterDecision(["economy_light"]),
  });

  assert.equal(evaluated.stateCommitLog[0]?.reasonCode, "local_interaction_recorded");
  assert.equal(evaluated.stateCommitLog[0]?.status, "applied");
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

test("grounded downtime mutations apply even when the router authorizes no explicit vectors", () => {
  const evaluated = engineTestUtils.evaluateResolvedCommand({
    snapshot: {
      ...createSnapshot(),
      character: {
        ...createSnapshot().character,
        inventory: [
          {
            id: "iteminst_scrap",
            characterInstanceId: "inst_1",
            templateId: "item_scrap_iron",
            template: {
              id: "item_scrap_iron",
              campaignId: "camp_1",
              name: "Scrap Iron",
              description: "Bent offcuts from an earlier job.",
              value: 0,
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
      timeMode: "downtime",
      suggestedActions: ["Keep hammering"],
      mutations: [
        {
          type: "adjust_inventory",
          itemId: "item_scrap_iron",
          quantity: 1,
          action: "remove",
          reason: "You work the scrap into usable stock.",
        },
        {
          type: "spawn_environmental_item",
          spawnKey: "horseshoes",
          itemName: "Horseshoe Set",
          description: "Freshly worked shoes cooling beside the anvil.",
          quantity: 1,
          reason: "Routine smithing produces a finished order.",
        },
        {
          type: "spawn_scene_aspect",
          aspectName: "forging activity",
          state: "The anvil rings and the forge throws a steady spray of sparks.",
          duration: "scene",
          reason: "Routine work fills the smithy with heat and noise.",
        },
      ],
      warnings: [],
      timeElapsed: 120,
    },
    fetchedFacts: [],
    routerDecision: createRouterDecision([]),
  });

  assert.deepEqual(
    evaluated.stateCommitLog.map((entry) => [entry.mutationType, entry.status, entry.reasonCode]),
    [
      ["adjust_inventory", "applied", "inventory_adjusted"],
      ["spawn_environmental_item", "applied", "environmental_item_spawned"],
      ["spawn_scene_aspect", "applied", "scene_aspect_spawned"],
    ],
  );
  assert.equal(evaluated.nextState.sceneAspects.forging_activity?.duration, "scene");
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

test("set_player_scene_focus updates intra-location focus and clears on macro travel", () => {
  const focused = engineTestUtils.evaluateResolvedCommand({
    snapshot: createSnapshot(),
    command: {
      type: "resolve_mechanics",
      timeMode: "exploration",
      suggestedActions: ["Check the workbench"],
      mutations: [
        {
          type: "set_player_scene_focus",
          focusKey: "forge_workbench",
          label: "The Forge Workbench",
          reason: "You head back to your bench.",
        },
      ],
      warnings: [],
      timeElapsed: 5,
    },
    fetchedFacts: [],
    routerDecision: createRouterDecision([]),
    playerAction: "I head back to the forge workbench.",
  });

  assert.deepEqual(focused.nextState.sceneFocus, {
    key: "forge_workbench",
    label: "The Forge Workbench",
  });
  assert.equal(focused.stateCommitLog[0]?.reasonCode, "scene_focus_updated");

  const moved = engineTestUtils.evaluateResolvedCommand({
    snapshot: {
      ...createSnapshot(),
      state: {
        ...createSnapshot().state,
        sceneFocus: {
          key: "forge_workbench",
          label: "The Forge Workbench",
        },
      },
    },
    command: createValidatedCommand("success", [
      { type: "move_player", routeEdgeId: "edge_gate_market", targetLocationId: "loc_market" },
    ]),
    fetchedFacts: [],
    routerDecision: createRouterDecision(["investigate"]),
  });

  assert.equal(moved.nextState.sceneFocus, null);
});

test("spawn_scene_aspect inherits the current scene focus for later context filtering", () => {
  const evaluated = engineTestUtils.evaluateResolvedCommand({
    snapshot: {
      ...createSnapshot(),
      state: {
        ...createSnapshot().state,
        sceneFocus: {
          key: "stable_entrance",
          label: "Stable Entrance",
        },
      },
    },
    command: {
      type: "resolve_mechanics",
      timeMode: "exploration",
      suggestedActions: ["Look over the straw"],
      mutations: [
        {
          type: "spawn_scene_aspect",
          aspectName: "fresh straw",
          state: "spread across the stable floor",
          duration: "scene",
          reason: "You notice the stable was freshly bedded.",
        },
      ],
      warnings: [],
      timeElapsed: 5,
    },
    fetchedFacts: [],
    routerDecision: createRouterDecision(["investigate"]),
    playerAction: "I look over the stable entrance.",
  });

  assert.equal(evaluated.nextState.sceneAspects.fresh_straw?.focusKey, "stable_entrance");
});

test("same-turn focus changes reject interactions with stale prior-focus actors", () => {
  const baseSnapshot = createSnapshot();
  const evaluated = engineTestUtils.evaluateResolvedCommand({
    snapshot: {
      ...baseSnapshot,
      state: {
        ...baseSnapshot.state,
        sceneFocus: {
          key: "gate_arch",
          label: "Gate Arch",
        },
      },
    },
    command: {
      type: "resolve_mechanics",
      timeMode: "exploration",
      suggestedActions: ["Check the back room"],
      mutations: [
        {
          type: "set_player_scene_focus",
          focusKey: "back_room",
          label: "Back Room",
          reason: "You step into the back room.",
        },
        {
          type: "record_local_interaction",
          localEntityId: "temp:temp_dockhand",
          interactionSummary: "You ask the dockhand what he saw.",
        },
      ],
      warnings: [],
      timeElapsed: 5,
    },
    fetchedFacts: [],
    routerDecision: createRouterDecision(["converse", "investigate"]),
    playerAction: "I go to the back room and ask the dockhand what he saw.",
  });

  assert.deepEqual(
    evaluated.stateCommitLog.map((entry) => [entry.mutationType, entry.status, entry.reasonCode]),
    [
      ["set_player_scene_focus", "applied", "scene_focus_updated"],
      ["record_local_interaction", "rejected", "invalid_semantics"],
    ],
  );
});

test("same-turn focus changes can interact with actors manifested into the new focus", () => {
  const evaluated = engineTestUtils.evaluateResolvedCommand({
    snapshot: createSnapshot(),
    command: {
      type: "resolve_mechanics",
      timeMode: "exploration",
      suggestedActions: ["See who's back there"],
      mutations: [
        {
          type: "set_player_scene_focus",
          focusKey: "back_room",
          label: "Back Room",
          reason: "You step into the back room.",
        },
        {
          type: "spawn_temporary_actor",
          spawnKey: "customer",
          role: "customer",
          summary: "A curious customer is already peering over the shelves.",
          apparentDisposition: "interested",
          reason: "A plausible local notices you.",
        },
        {
          type: "record_local_interaction",
          localEntityId: "spawn:customer",
          interactionSummary: "You answer the customer's first question.",
        },
      ],
      warnings: [],
      timeElapsed: 5,
    },
    fetchedFacts: [],
    routerDecision: createRouterDecision(["converse"]),
    playerAction: "I head to the back room and answer the interested customer there.",
  });

  assert.deepEqual(
    evaluated.stateCommitLog.map((entry) => [entry.mutationType, entry.status, entry.reasonCode]),
    [
      ["set_player_scene_focus", "applied", "scene_focus_updated"],
      ["spawn_temporary_actor", "applied", "temporary_actor_spawned"],
      ["record_local_interaction", "applied", "local_interaction_recorded"],
    ],
  );
});

test("same-turn focus changes reject named-actor targeting from the prior focus", () => {
  const evaluated = engineTestUtils.evaluateResolvedCommand({
    snapshot: createSnapshot(),
    command: {
      type: "resolve_mechanics",
      timeMode: "exploration",
      suggestedActions: ["Find someone nearby"],
      mutations: [
        {
          type: "set_player_scene_focus",
          focusKey: "back_room",
          label: "Back Room",
          reason: "You step into the back room.",
        },
        {
          type: "adjust_relationship",
          npcId: "npc_guard",
          delta: 1,
          reason: "You smooth things over with the guard.",
        },
      ],
      warnings: [],
      timeElapsed: 5,
    },
    fetchedFacts: [],
    routerDecision: createRouterDecision(["converse"]),
    playerAction: "I go into the back room and keep talking to the guard.",
  });

  assert.deepEqual(
    evaluated.stateCommitLog.map((entry) => [entry.mutationType, entry.status, entry.reasonCode]),
    [
      ["set_player_scene_focus", "applied", "scene_focus_updated"],
      ["adjust_relationship", "rejected", "invalid_semantics"],
    ],
  );
});

test("engine rejects record_local_interaction used for a solo errand with invalid_semantics", () => {
  const evaluated = engineTestUtils.evaluateResolvedCommand({
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
      suggestedActions: ["Check the bench"],
      mutations: [
        {
          type: "record_local_interaction",
          localEntityId: "temp_apprentice",
          interactionSummary: "You head back to the forge and check your bench.",
        },
      ],
      warnings: [],
      timeElapsed: 5,
    },
    fetchedFacts: [],
    routerDecision: createRouterDecision(["converse"]),
    playerAction: "I head back to the forge and check my bench for the coin purse.",
  });

  assert.equal(evaluated.stateCommitLog[0]?.reasonCode, "invalid_semantics");
});

test("engine rejects set_scene_actor_presence used as player movement proxy with invalid_semantics", () => {
  const evaluated = engineTestUtils.evaluateResolvedCommand({
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
          reason: "Return to the forge.",
        },
      ],
      warnings: [],
      timeElapsed: 5,
    },
    fetchedFacts: [],
    routerDecision: createRouterDecision(["converse"]),
    playerAction: "I head back to the forge to get my coin purse.",
  });

  assert.equal(evaluated.stateCommitLog[0]?.reasonCode, "invalid_semantics");
});

test("noop scene actor presence entries do not carry arrival metadata", () => {
  const evaluated = engineTestUtils.evaluateResolvedCommand({
    snapshot: createSnapshot(),
    command: {
      type: "resolve_mechanics",
      timeMode: "exploration",
      suggestedActions: ["Keep watch"],
      mutations: [
        {
          type: "set_scene_actor_presence",
          actorRef: "npc:npc_guard",
          newLocationId: "loc_gate",
          reason: "The guard remains posted.",
        },
      ],
      warnings: [],
      timeElapsed: 5,
    },
    fetchedFacts: [],
    routerDecision: createRouterDecision(["converse"]),
    playerAction: "I wait by the gate.",
  });

  assert.equal(evaluated.stateCommitLog[0]?.status, "noop");
  assert.equal(evaluated.stateCommitLog[0]?.metadata?.arrivesInCurrentScene, undefined);
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

test("set_follow_state persists companion refs into next runtime state", () => {
  const evaluated = engineTestUtils.evaluateResolvedCommand({
    snapshot: createSnapshot(),
    command: createValidatedCommand("success", [
      {
        type: "set_follow_state",
        actorRef: "npc:npc_guard",
        isFollowing: true,
        reason: "The guard agrees to escort me.",
      },
      {
        type: "move_player",
        routeEdgeId: "edge_gate_market",
        targetLocationId: "loc_market",
      },
    ]),
    fetchedFacts: [],
    routerDecision: createRouterDecision(["converse", "investigate"]),
  });

  assert.deepEqual(evaluated.nextState.characterState.activeCompanions, ["npc:npc_guard"]);
  assert.equal(evaluated.nextState.currentLocationId, "loc_market");
});

test("transfer_assets can move a portable world object into storage", () => {
  const snapshot = structuredClone(createSnapshot());
  snapshot.worldObjects = [
    {
      id: "obj_lockbox",
      name: "Lockbox",
      characterInstanceId: snapshot.character.instanceId,
      npcId: null,
      parentWorldObjectId: null,
      sceneLocationId: null,
      sceneFocusKey: null,
      storedGold: 0,
      storageCapacity: 10,
      securityIsLocked: false,
      securityKeyItemTemplateId: null,
      concealmentIsHidden: false,
      vehicleIsHitched: false,
      properties: null,
    },
    {
      id: "obj_nook",
      name: "Fireplace Nook",
      characterInstanceId: null,
      npcId: null,
      parentWorldObjectId: null,
      sceneLocationId: "loc_gate",
      sceneFocusKey: null,
      storedGold: 0,
      storageCapacity: 20,
      securityIsLocked: false,
      securityKeyItemTemplateId: null,
      concealmentIsHidden: true,
      vehicleIsHitched: false,
      properties: null,
    },
  ];

  const evaluated = engineTestUtils.evaluateResolvedCommand({
    snapshot,
    command: createValidatedCommand("success", [
      {
        type: "transfer_assets",
        source: { kind: "player" },
        destination: { kind: "world_object", objectId: "obj_nook" },
        worldObjectIds: ["obj_lockbox"],
        reason: "Place the lockbox into the hidden nook.",
      },
    ]),
    fetchedFacts: [],
    routerDecision: createRouterDecision(["economy_light"]),
  });

  assert.equal(evaluated.stateCommitLog[1]?.reasonCode, "assets_transferred");
  assert.equal(evaluated.stateCommitLog[1]?.status, "applied");
});

test("update_character_state adds and removes tracked conditions in next runtime state", () => {
  const snapshot = createSnapshot();
  snapshot.state.characterState.conditions = ["Exhausted"];

  const evaluated = engineTestUtils.evaluateResolvedCommand({
    snapshot,
    command: createValidatedCommand("success", [
      {
        type: "update_character_state",
        conditionsAdded: ["Disguised"],
        conditionsRemoved: ["Exhausted"],
        reason: "Change clothes and recover composure.",
      },
    ]),
    fetchedFacts: [],
    routerDecision: createRouterDecision(["economy_light"]),
  });

  assert.deepEqual(evaluated.nextState.characterState.conditions, ["Disguised"]);
});

test("transfer_assets rejects moving goods into locked storage", () => {
  const snapshot = structuredClone(createSnapshot());
  snapshot.worldObjects = [
    {
      id: "obj_locked_box",
      name: "Locked Box",
      characterInstanceId: null,
      npcId: null,
      parentWorldObjectId: null,
      sceneLocationId: "loc_gate",
      sceneFocusKey: null,
      storedGold: 0,
      storageCapacity: 10,
      securityIsLocked: true,
      securityKeyItemTemplateId: null,
      concealmentIsHidden: false,
      vehicleIsHitched: false,
      properties: null,
    },
  ];

  const evaluated = engineTestUtils.evaluateResolvedCommand({
    snapshot,
    command: createValidatedCommand("success", [
      {
        type: "transfer_assets",
        source: { kind: "player" },
        destination: { kind: "world_object", objectId: "obj_locked_box" },
        goldAmount: 2,
        reason: "Stash coins in the locked box.",
      },
    ]),
    fetchedFacts: [],
    routerDecision: createRouterDecision(["economy_light"]),
  });

  assert.equal(evaluated.stateCommitLog[1]?.reasonCode, "invalid_target");
  assert.equal(evaluated.stateCommitLog[1]?.status, "rejected");
});

test("transfer_assets supports commodity round-trips between player and world objects in one turn", () => {
  const snapshot = structuredClone(createSnapshot());
  snapshot.character.commodityStacks = [
    {
      id: "stack_player_iron",
      characterInstanceId: snapshot.character.instanceId,
      npcId: null,
      worldObjectId: null,
      sceneLocationId: null,
      sceneFocusKey: null,
      commodityId: "commodity_iron",
      quantity: 3,
      commodity: {
        id: "commodity_iron",
        campaignId: snapshot.campaignId,
        name: "Iron Ingots",
        baseValue: 4,
        tags: [],
      },
    },
  ];
  snapshot.assetCommodityStacks = structuredClone(snapshot.character.commodityStacks);
  snapshot.worldObjects = [
    {
      id: "obj_cart",
      name: "Handcart",
      characterInstanceId: null,
      npcId: null,
      parentWorldObjectId: null,
      sceneLocationId: "loc_gate",
      sceneFocusKey: null,
      storedGold: 0,
      storageCapacity: 50,
      securityIsLocked: false,
      securityKeyItemTemplateId: null,
      concealmentIsHidden: false,
      vehicleIsHitched: false,
      properties: null,
    },
  ];

  const evaluated = engineTestUtils.evaluateResolvedCommand({
    snapshot,
    command: createValidatedCommand("success", [
      {
        type: "transfer_assets",
        source: { kind: "player" },
        destination: { kind: "world_object", objectId: "obj_cart" },
        commodityTransfers: [{ commodityId: "commodity_iron", quantity: 2 }],
        reason: "Load ingots into the cart.",
      },
      {
        type: "transfer_assets",
        source: { kind: "world_object", objectId: "obj_cart" },
        destination: { kind: "player" },
        commodityTransfers: [{ commodityId: "commodity_iron", quantity: 1 }],
        reason: "Take one ingot back out.",
      },
    ]),
    fetchedFacts: [],
    routerDecision: createRouterDecision(["economy_light"]),
  });

  assert.equal(evaluated.stateCommitLog[1]?.reasonCode, "assets_transferred");
  assert.equal(evaluated.stateCommitLog[2]?.reasonCode, "assets_transferred");
});

test("transfer_assets enforces NPC transfer vector semantics for stealth and force", () => {
  const snapshot = structuredClone(createSnapshot());
  snapshot.assetItems = [
    {
      id: "iteminst_guard_key",
      characterInstanceId: null,
      npcId: "npc_guard",
      worldObjectId: null,
      sceneLocationId: null,
      sceneFocusKey: null,
      templateId: "item_key",
      template: {
        id: "item_key",
        campaignId: snapshot.campaignId,
        name: "Watch Key",
        description: "A heavy brass watch key.",
        value: 1,
        weight: 0,
        rarity: "common",
        tags: [],
      },
      isIdentified: true,
      charges: null,
      properties: null,
    },
  ];

  const stealthRejected = engineTestUtils.evaluateResolvedCommand({
    snapshot,
    command: createValidatedCommand("success", [
      {
        type: "transfer_assets",
        source: { kind: "npc", npcId: "npc_guard" },
        destination: { kind: "player" },
        itemInstanceIds: ["iteminst_guard_key"],
        npcTransferMode: "stealth",
        reason: "Palm the key.",
      },
    ]),
    fetchedFacts: [],
    routerDecision: createRouterDecision(["converse"]),
  });
  assert.equal(stealthRejected.stateCommitLog[1]?.reasonCode, "unauthorized_vector");

  const forceApplied = engineTestUtils.evaluateResolvedCommand({
    snapshot,
    command: createValidatedCommand("success", [
      {
        type: "transfer_assets",
        source: { kind: "npc", npcId: "npc_guard" },
        destination: { kind: "player" },
        itemInstanceIds: ["iteminst_guard_key"],
        npcTransferMode: "force",
        reason: "Rip the key away.",
      },
    ]),
    fetchedFacts: [],
    routerDecision: createRouterDecision(["violence"]),
  });
  assert.equal(forceApplied.stateCommitLog[1]?.reasonCode, "assets_transferred");
});

test("update_item_state accepts charge and property changes for owned instances", () => {
  const snapshot = structuredClone(createSnapshot());
  const lantern = {
    id: "iteminst_lantern",
    characterInstanceId: snapshot.character.instanceId,
    npcId: null,
    worldObjectId: null,
    sceneLocationId: null,
    sceneFocusKey: null,
    templateId: "item_lantern",
    template: {
      id: "item_lantern",
      campaignId: snapshot.campaignId,
      name: "Lantern",
      description: "A hooded lantern.",
      value: 5,
      weight: 1,
      rarity: "common",
      tags: [],
    },
    isIdentified: true,
    charges: 3,
    properties: null,
  };
  snapshot.character.inventory = [structuredClone(lantern)];
  snapshot.assetItems = [structuredClone(lantern)];

  const evaluated = engineTestUtils.evaluateResolvedCommand({
    snapshot,
    command: createValidatedCommand("success", [
      {
        type: "update_item_state",
        instanceId: "iteminst_lantern",
        chargesDelta: -1,
        propertiesPatch: { flame: "lit" },
        reason: "Light the lantern.",
      },
    ]),
    fetchedFacts: [],
    routerDecision: createRouterDecision(["economy_light"]),
  });

  assert.equal(evaluated.stateCommitLog[1]?.reasonCode, "item_state_updated");
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
