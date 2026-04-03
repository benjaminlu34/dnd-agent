import assert from "node:assert/strict";
import test from "node:test";
import { engineTestUtils } from "./engine";
import { toTurnResultPayloadJson } from "./json-contracts";
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
      health: 12,
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
      {
        id: "temp_dockhand",
        profileNpcId: null,
        isAnonymous: true,
        label: "dockhand",
        displayLabel: "dockhand",
        currentLocationId: "loc_gate",
        state: "active",
        threatLevel: 1,
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
        inventory: [],
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
): Extract<ValidatedTurnCommand, { type: "resolve_mechanics" }> {
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

test("promoted npc hydration falls back when draft attaches the local to a new named npc", () => {
  const sanitized = engineTestUtils.sanitizePromotedNpcHydrationDraft({
    draft: {
      name: "Elias Thorn",
      summary: "Elias Thorn examines silks at Vesper Darksbane's stall while discussing guild politics.",
      description:
        "Elias Thorn lingers at Vesper Darksbane's stall, chatting about trade routes and prices.",
      factionId: null,
      information: [
        {
          title: "Guild Price Fixing",
          summary: "Rumors of a price cartel.",
          content: "Textile merchants may be colluding on silk prices.",
          truthfulness: "partial",
          accessibility: "guarded",
          locationId: "loc_gate",
          factionId: null,
        },
      ],
    },
    currentName: "Customer",
    currentRole: "customer",
    currentLocationId: "loc_gate",
    localFactionIds: new Set<string>(),
    allowNarrativeHydration: true,
    allowRenameFromGenericRoleLabel: true,
    fallbackSummary: "Engaged in sales conversation with a present customer at the stall.",
    fallbackDescription:
      "Engaged in sales conversation with a present customer at the stall. The player has already spoken with them about finer weave and sales conversation.",
    fallbackFactionId: null,
    localNpcNames: ["Vesper Darksbane", "Marric Stillwater"],
    priorFactText:
      "Engaged in sales conversation with a present customer at the stall. The player has already spoken with them about finer weave and sales conversation.",
  });

  assert.equal(sanitized.name, "Elias Thorn");
  assert.equal(
    sanitized.summary,
    "Engaged in sales conversation with a present customer at the stall.",
  );
  assert.match(sanitized.description, /present customer at the stall/i);
  assert.deepEqual(sanitized.information, []);
});

test("promoted npc hydration preserves named-local references already grounded in prior facts", () => {
  const sanitized = engineTestUtils.sanitizePromotedNpcHydrationDraft({
    draft: {
      name: "Elias Thorn",
      summary: "Elias Thorn waits at Vesper Darksbane's stall for the noon caravan.",
      description:
        "Elias Thorn keeps returning to Vesper Darksbane's stall because the caravan books are handled there.",
      factionId: null,
      information: [],
    },
    currentName: "Customer",
    currentRole: "customer",
    currentLocationId: "loc_gate",
    localFactionIds: new Set<string>(),
    allowNarrativeHydration: true,
    allowRenameFromGenericRoleLabel: true,
    fallbackSummary: "A customer near Vesper Darksbane's stall asks after the noon caravan.",
    fallbackDescription:
      "A customer near Vesper Darksbane's stall asks after the noon caravan. The player has already crossed paths with them there.",
    fallbackFactionId: null,
    localNpcNames: ["Vesper Darksbane", "Marric Stillwater"],
    priorFactText:
      "A customer near Vesper Darksbane's stall asks after the noon caravan. The player has already crossed paths with them there.",
  });

  assert.equal(
    sanitized.summary,
    "Elias Thorn waits at Vesper Darksbane's stall for the noon caravan.",
  );
});

test("appendMessageToTurnRollback records post-commit narration for undo", () => {
  const updated = engineTestUtils.appendMessageToTurnRollback(
    toTurnResultPayloadJson({
      stateVersionAfter: 2,
      changeCodes: [],
      reasonCodes: [],
      whatChanged: ["You completed the sale."],
      why: [],
      warnings: [],
      narrationBounds: null,
      checkResult: null,
      clarification: null,
      error: null,
      rollback: {
        previousState: createSnapshot().state,
        previousSessionTurnCount: 1,
        createdMessageIds: ["msg_action"],
        createdMemoryIds: [],
        createdMemoryLinkIds: [],
        discoveredInformation: [],
        simulationInverses: [],
        processedEventIds: [],
        cancelledMoveIds: [],
        createdWorldEventIds: [],
        createdFactionMoveIds: [],
        createdScheduleJobIds: [],
        createdTemporaryActorIds: [],
        createdCommodityStackIds: [],
        createdWorldObjectIds: [],
      },
    }),
    "msg_narration",
  );

  assert.ok(updated?.rollback);
  assert.deepEqual(updated?.rollback.createdMessageIds, ["msg_action", "msg_narration"]);
});

test("rollbackSupportsActorUndo blocks legacy rollback payloads without actor markers", () => {
  assert.equal(
    engineTestUtils.rollbackSupportsActorUndo({
      schemaVersion: 2,
      data: {
        rollback: {
          createdTemporaryActorIds: [],
        },
      },
    }),
    false,
  );
  assert.equal(
    engineTestUtils.rollbackSupportsActorUndo({
      schemaVersion: 2,
      data: {
        rollback: {
          createdActorIds: [],
          createdTemporaryActorIds: [],
        },
      },
    }),
    true,
  );
});

test("legacyNarrationMessageIdsForUndo selects the latest missing assistant narration", async () => {
  const calls: Array<{ where: unknown; orderBy: unknown }> = [];
  const ids = await engineTestUtils.legacyNarrationMessageIdsForUndo({
    tx: {
      message: {
        findFirst: async (args: { where: unknown; orderBy: unknown }) => {
          calls.push(args);
          return { id: "msg_narration" };
        },
      },
    } as never,
    sessionId: "sess_1",
    turnId: "turn_1",
    turnCreatedAt: new Date("2026-04-02T10:00:00.000Z"),
    rollbackMessageIds: ["msg_action"],
  });

  assert.deepEqual(ids, ["msg_narration"]);
  assert.deepEqual(calls[0]?.where, {
    sessionId: "sess_1",
    role: "assistant",
    kind: "narration",
    id: { notIn: ["msg_action"] },
    createdAt: {
      gte: new Date("2026-04-02T10:00:00.000Z"),
    },
  });
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
      { type: "adjust_currency", delta: { sp: -3 }, reason: "guard fee", phase: "immediate" },
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
      ["mutation", "adjust_currency", "applied", "currency_adjusted"],
      ["mutation", "advance_time", "applied", "time_advanced"],
      ["mutation", "adjust_relationship", "rejected", "check_failed"],
    ],
  );
  assert.equal(evaluated.nextState.globalTime, 485);
  assert.equal(evaluated.stateCommitLog[1]?.metadata?.appliedDeltaCp, -30);
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
          inventory: [],
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
          socialOutcome: "complies",
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
      { type: "adjust_currency", delta: { sp: -2 }, reason: "small fee", phase: "immediate" },
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
      ["mutation", "adjust_currency", "applied", "currency_adjusted"],
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
      { type: "adjust_currency", delta: { gp: 1, sp: 2 }, reason: "guard bribe backfires into a tip", phase: "conditional" },
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
      ["mutation", "adjust_currency", "applied", "currency_adjusted"],
      ["mutation", "adjust_relationship", "applied", "relationship_adjusted"],
    ],
  );
  assert.deepEqual(evaluated.stateCommitLog[2]?.metadata?.delta, { gp: 1, sp: 2 });
  assert.equal(evaluated.stateCommitLog[2]?.metadata?.appliedDeltaCp, 120);
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
        socialOutcome: "shares_fact",
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
          inventory: [],
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
          socialOutcome: "accepts",
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

test("record_npc_interaction applies for ordinary dialogue with a present named npc", () => {
  const evaluated = engineTestUtils.evaluateResolvedCommand({
    snapshot: createSnapshot(),
    command: {
      type: "resolve_mechanics",
      timeMode: "exploration",
      suggestedActions: ["Ask another question"],
      mutations: [
        {
          type: "record_npc_interaction",
          npcId: "npc_guard",
          interactionSummary: "You keep the guard talking and ask what to call him.",
          topic: "identity",
          socialOutcome: "asks_question",
        },
      ],
      warnings: [],
      timeElapsed: 5,
    },
    fetchedFacts: [],
    routerDecision: createRouterDecision(["converse"]),
    playerAction: "\"What can I call you, sir?\" I ask the guard politely.",
  });

  assert.deepEqual(
    evaluated.stateCommitLog.map((entry) => [entry.mutationType, entry.status, entry.reasonCode]),
    [["record_npc_interaction", "applied", "npc_interaction_recorded"]],
  );
  assert.deepEqual(evaluated.stateCommitLog[0]?.metadata, {
    npcId: "npc_guard",
    topic: "identity",
    socialOutcome: "asks_question",
    phase: "immediate",
  });
});

test("interaction commit logs carry socialOutcome metadata for narration and memory", () => {
  const evaluated = engineTestUtils.evaluateResolvedCommand({
    snapshot: createSnapshot(),
    command: {
      type: "resolve_mechanics",
      timeMode: "exploration",
      suggestedActions: ["Ask what happened"],
      mutations: [
        {
          type: "record_local_interaction",
          localEntityId: "temp:temp_dockhand",
          interactionSummary: "The dockhand refuses to say more and looks back toward the pier.",
          topic: "pier closure",
          socialOutcome: "withholds",
        },
      ],
      warnings: [],
      timeElapsed: 5,
    },
    fetchedFacts: [],
    routerDecision: createRouterDecision(["converse"]),
  });

  assert.deepEqual(evaluated.stateCommitLog[0]?.metadata, {
    localEntityId: "temp:temp_dockhand",
    topic: "pier closure",
    socialOutcome: "withholds",
    phase: "immediate",
    interactionCount: 2,
  });
});

test("socially high-friction interaction outcomes classify memories as conflict", () => {
  const memoryKind = engineTestUtils.determineMemoryKind({
    command: {
      type: "resolve_mechanics",
      timeMode: "exploration",
      suggestedActions: [],
      mutations: [],
      warnings: [],
      timeElapsed: 5,
    },
    stateCommitLog: [
      {
        kind: "mutation",
        mutationType: "record_npc_interaction",
        status: "applied",
        reasonCode: "npc_interaction_recorded",
        summary: "Tarn declines the offer and keeps his distance.",
        metadata: {
          npcId: "npc_guard",
          topic: "lodging",
          socialOutcome: "declines",
          phase: "immediate",
        },
      },
    ],
  });

  assert.equal(memoryKind, "conflict");
});

test("low-friction acknowledgement interactions stay out of conflict memory by default", () => {
  const memoryKind = engineTestUtils.determineMemoryKind({
    command: {
      type: "resolve_mechanics",
      timeMode: "exploration",
      suggestedActions: [],
      mutations: [],
      warnings: [],
      timeElapsed: 5,
    },
    stateCommitLog: [
      {
        kind: "mutation",
        mutationType: "record_npc_interaction",
        status: "applied",
        reasonCode: "npc_interaction_recorded",
        summary: "The guard acknowledges the question with a brief nod.",
        metadata: {
          npcId: "npc_guard",
          topic: "identity",
          socialOutcome: "acknowledges",
          phase: "immediate",
        },
      },
    ],
  });

  assert.equal(memoryKind, "world_change");
});

test("fast-forward turns stay salient as world_change memories", () => {
  const memoryKind = engineTestUtils.determineMemoryKind({
    command: {
      type: "execute_fast_forward",
      requestedDurationMinutes: 2880,
      routineSummary: "You settle into a steady routine around the stable.",
      recurringActivities: ["feed Safra", "sweep the yard"],
      intendedOutcomes: ["stay inconspicuous"],
      warnings: [],
      timeElapsed: 2880,
      narrationBounds: {
        requestedAdvanceMinutes: 2880,
        committedAdvanceMinutes: 2880,
        availableAdvanceMinutes: 2880,
        wasCapped: false,
        overrideText: null,
        isFastForward: true,
        interruptionReason: null,
      },
      narrationHint: null,
      pendingCheck: undefined,
      checkResult: undefined,
    },
    stateCommitLog: [
      {
        kind: "mutation",
        mutationType: "advance_time",
        status: "applied",
        reasonCode: "fast_forward_executed",
        summary: "You settle into a steady routine around the stable.",
        metadata: {
          isFastForward: true,
        },
      },
    ],
  });

  assert.equal(memoryKind, "world_change");
});

test("deterministic narration fallback uses montage phrasing for fast-forward turns", () => {
  const narration = engineTestUtils.deterministicNarrationFallback({
    playerAction: "We spend the next several days helping around the stable until something changes.",
    stateCommitLog: [
      {
        kind: "mutation",
        mutationType: "advance_time",
        status: "applied",
        reasonCode: "fast_forward_executed",
        summary: "You settle into a quiet rhythm of mucking stalls and tending tack.",
        metadata: {
          isFastForward: true,
        },
      },
    ],
    narrationBounds: {
      isFastForward: true,
      interruptionReason: "A rider comes in hard from the north road.",
    },
  });

  assert.match(narration, /quiet rhythm of mucking stalls and tending tack/i);
  assert.match(narration, /rider comes in hard from the north road/i);
});

test("evaluation assigns canonical spawn ids and eliminates placeholder prefixes", () => {
  const evaluated = engineTestUtils.evaluateResolvedCommand({
    snapshot: createSnapshot(),
    command: {
      type: "resolve_mechanics",
      timeMode: "exploration",
      suggestedActions: ["Set things up"],
      mutations: [
        {
          type: "spawn_temporary_actor",
          spawnKey: "customer",
          role: "customer",
          summary: "A customer pauses at the stall with a measuring eye.",
          apparentDisposition: "cautious",
          reason: "A plausible buyer appears.",
        },
        {
          type: "record_local_interaction",
          localEntityId: "spawn:customer",
          interactionSummary: "The customer counters with a lower opening offer.",
          topic: "price",
          socialOutcome: "counteroffers",
        },
        {
          type: "spawn_world_object",
          spawnKey: "crate",
          name: "oak crate",
          holder: { kind: "scene", locationId: "loc_gate" },
          reason: "A crate is dragged into the lane.",
        },
        {
          type: "update_world_object_state",
          objectId: "spawn:crate",
          isLocked: true,
          reason: "The crate is quickly locked shut.",
        },
      ],
      warnings: [],
      timeElapsed: 5,
    },
    fetchedFacts: [],
    routerDecision: createRouterDecision(["converse", "investigate"]),
  });

  const spawnedActorId = evaluated.spawnedTemporaryActorIds.get("customer");
  const spawnedObjectId = evaluated.spawnedWorldObjectIds.get("crate");
  assert.match(spawnedActorId ?? "", /^tactor_/);
  assert.match(spawnedObjectId ?? "", /^wobj_/);
  assert.equal(
    evaluated.stateCommitLog[1]?.metadata?.localEntityId,
    spawnedActorId ? `temp:${spawnedActorId}` : null,
  );
  assert.equal(evaluated.stateCommitLog[2]?.metadata?.objectId, spawnedObjectId);
  assert.equal(evaluated.stateCommitLog[3]?.metadata?.objectId, spawnedObjectId);
  assert.ok(
    evaluated.stateCommitLog.every((entry) => JSON.stringify(entry).includes("spawned_world_object:") === false),
  );
  assert.ok(
    evaluated.stateCommitLog.every((entry) => JSON.stringify(entry).includes("spawned_temp:") === false),
  );
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

test("inventory removal accepts a grounded item instance id by normalizing it to the stack template", () => {
  const snapshot = {
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
  } as CampaignSnapshot;

  const evaluated = engineTestUtils.evaluateResolvedCommand({
    snapshot,
    command: createValidatedCommand("success", [
      { type: "adjust_inventory", itemId: "iteminst_roll_1", quantity: 1, action: "remove", reason: "You feed the roll to Safra." },
    ]),
    fetchedFacts: [],
    routerDecision: createRouterDecision(["investigate"]),
  });

  assert.deepEqual(
    evaluated.stateCommitLog.map((entry) => [entry.mutationType, entry.status, entry.reasonCode]),
    [
      [null, "applied", "check_success"],
      ["adjust_inventory", "applied", "inventory_adjusted"],
    ],
  );
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
          holder: { kind: "scene", locationId: "loc_gate", focusKey: "forge" },
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
          socialOutcome: "complies",
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
          inventory: [],
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
          socialOutcome: "complies",
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

test("actor-prefixed named actor refs can be returned to the scene", () => {
  const evaluated = engineTestUtils.evaluateResolvedCommand({
    snapshot: {
      ...createSnapshot(),
      presentNpcs: [],
      actors: [
        {
          ...createSnapshot().actors?.[0]!,
          currentLocationId: null,
        },
        createSnapshot().actors?.[1]!,
      ],
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
          actorRef: "actor:actor_npc_guard",
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
  assert.equal(evaluated.stateCommitLog[0]?.metadata?.actorRef, "actor:actor_npc_guard");
});

test("record_actor_interaction applies to anonymous scene actors", () => {
  const evaluated = engineTestUtils.evaluateResolvedCommand({
    snapshot: createSnapshot(),
    command: {
      type: "resolve_mechanics",
      timeMode: "exploration",
      suggestedActions: ["Keep talking"],
      mutations: [
        {
          type: "record_actor_interaction",
          actorId: "temp_dockhand",
          interactionSummary: "The dockhand shrugs and points toward the harbor office.",
          socialOutcome: "redirects",
          topic: "harbor office",
        },
      ],
      warnings: [],
      timeElapsed: 5,
    },
    fetchedFacts: [],
    routerDecision: createRouterDecision(["converse"]),
  });

  assert.equal(evaluated.stateCommitLog[0]?.status, "applied");
  assert.equal(evaluated.stateCommitLog[0]?.mutationType, "record_actor_interaction");
  assert.equal(evaluated.stateCommitLog[0]?.reasonCode, "actor_interaction_recorded");
  assert.equal(evaluated.stateCommitLog[0]?.metadata?.actorRef, "actor:temp_dockhand");
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
          inventory: [],
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
          inventory: [],
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
          holder: { kind: "player" },
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

test("scene-held environmental items stay out of player inventory and record holder metadata", () => {
  const evaluated = engineTestUtils.evaluateResolvedCommand({
    snapshot: createSnapshot(),
    command: {
      type: "resolve_mechanics",
      timeMode: "exploration",
      suggestedActions: ["Look over the bath area"],
      mutations: [
        {
          type: "spawn_environmental_item",
          spawnKey: "basin",
          itemName: "Wash Basin",
          description: "A copper basin set beside the hearth.",
          quantity: 1,
          holder: { kind: "scene", locationId: "loc_gate", focusKey: "bath_area" },
          reason: "The wash setup is plainly laid out nearby.",
        },
        {
          type: "adjust_inventory",
          itemId: "spawn:basin",
          quantity: 1,
          action: "remove",
          reason: "Try to pocket the basin without actually picking it up first.",
        },
      ],
      warnings: [],
      timeElapsed: 5,
    },
    fetchedFacts: [],
    routerDecision: createRouterDecision(["investigate"]),
  });

  assert.equal(evaluated.stateCommitLog[0]?.reasonCode, "environmental_item_spawned");
  assert.deepEqual(evaluated.stateCommitLog[0]?.metadata?.holder, {
    kind: "scene",
    locationId: "loc_gate",
    focusKey: "bath_area",
  });
  assert.equal(evaluated.stateCommitLog[0]?.summary, "Wash Basin becomes part of the scene.");
  assert.equal(evaluated.stateCommitLog[1]?.reasonCode, "insufficient_inventory");
});

test("environmental items can spawn directly into temporary actor custody", () => {
  const evaluated = engineTestUtils.evaluateResolvedCommand({
    snapshot: createSnapshot(),
    command: {
      type: "resolve_mechanics",
      timeMode: "exploration",
      suggestedActions: ["Pass over a cloth"],
      mutations: [
        {
          type: "spawn_environmental_item",
          spawnKey: "wash_cloth",
          itemName: "Wash Cloth",
          description: "A folded linen cloth lifted from the wash stand.",
          quantity: 1,
          holder: { kind: "temporary_actor", actorId: "temp_dockhand" },
          reason: "The dockhand already has the cloth in hand.",
        },
        {
          type: "transfer_assets",
          source: { kind: "temporary_actor", actorId: "temp_dockhand" },
          destination: { kind: "player" },
          templateTransfers: [{ templateId: "spawn:wash_cloth", quantity: 1 }],
          reason: "Take the cloth back from the dockhand.",
        },
      ],
      warnings: [],
      timeElapsed: 5,
    },
    fetchedFacts: [],
    routerDecision: createRouterDecision(["converse"]),
  });

  assert.equal(evaluated.stateCommitLog[0]?.reasonCode, "environmental_item_spawned");
  assert.deepEqual(evaluated.stateCommitLog[0]?.metadata?.holder, {
    kind: "temporary_actor",
    actorId: "temp_dockhand",
  });
  assert.equal(evaluated.stateCommitLog[1]?.reasonCode, "assets_transferred");
});

test("spawn_fiat_item can ground a bespoke traded item directly into player custody", () => {
  const evaluated = engineTestUtils.evaluateResolvedCommand({
    snapshot: createSnapshot(),
    command: {
      type: "resolve_mechanics",
      timeMode: "exploration",
      suggestedActions: ["Close the sale"],
      mutations: [
        {
          type: "adjust_currency",
          delta: { sp: -5 },
          reason: "Paid for bespoke silk.",
        },
        {
          type: "spawn_fiat_item",
          spawnKey: "silk_3_yards",
          itemName: "Fine Silk",
          description: "Three yards of shimmering blue silk.",
          quantity: 1,
          holder: { kind: "player" },
          reason: "Received from Elias Thorn.",
        },
      ],
      warnings: [],
      timeElapsed: 5,
    },
    fetchedFacts: [],
    routerDecision: createRouterDecision(["converse", "economy_light"]),
  });

  assert.deepEqual(
    evaluated.stateCommitLog
      .map((entry) => [entry.mutationType, entry.status, entry.reasonCode] as const)
      .sort((left, right) => left.join(":").localeCompare(right.join(":"))),
    [
      ["adjust_currency", "applied", "currency_adjusted"],
      ["spawn_fiat_item", "applied", "fiat_item_spawned"],
    ].sort((left, right) => left.join(":").localeCompare(right.join(":"))),
  );
});

test("spawn_fiat_item can ground a bespoke sold good directly into npc custody", () => {
  const evaluated = engineTestUtils.evaluateResolvedCommand({
    snapshot: createSnapshot(),
    command: {
      type: "resolve_mechanics",
      timeMode: "exploration",
      suggestedActions: ["Complete the sale"],
      mutations: [
        {
          type: "adjust_currency",
          delta: { gp: 19 },
          reason: "Elias pays for the cloth.",
        },
        {
          type: "spawn_fiat_item",
          spawnKey: "broadcloth_22ells",
          itemName: "Dalelands Wool Broadcloth",
          description: "Twenty-two ells of carefully mordanted broadcloth.",
          quantity: 1,
          holder: { kind: "npc", npcId: "npc_guard" },
          reason: "Delivered to the buyer.",
        },
      ],
      warnings: [],
      timeElapsed: 5,
    },
    fetchedFacts: [],
    routerDecision: createRouterDecision(["converse", "economy_light"]),
  });

  assert.deepEqual(
    evaluated.stateCommitLog
      .map((entry) => [entry.mutationType, entry.status, entry.reasonCode] as const)
      .sort((left, right) => left.join(":").localeCompare(right.join(":"))),
    [
      ["adjust_currency", "applied", "currency_adjusted"],
      ["spawn_fiat_item", "applied", "fiat_item_spawned"],
    ].sort((left, right) => left.join(":").localeCompare(right.join(":"))),
  );
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
          socialOutcome: "acknowledges",
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
      {
        type: "move_player",
        targetLocationId: "loc_market",
        relocationReason: "teleportation",
      },
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
      { type: "start_journey", edgeId: "edge_gate_market", destinationLocationId: "loc_market" },
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
          socialOutcome: "redirects",
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

test("deterministic narration fallback explains unresolved ghost-target attempts without substitution", () => {
  const narration = engineTestUtils.deterministicNarrationFallback({
    playerAction: "I grab their wrist before they can slip away.",
    stateCommitLog: [
      {
        kind: "mutation",
        mutationType: "advance_time",
        status: "applied",
        reasonCode: "time_advanced",
        summary: "Time passes for 2 minutes.",
        metadata: null,
      },
    ],
    checkResult: null,
    narrationHint: {
      unresolvedTargetPhrases: ["them"],
    },
  });

  assert.match(narration, /already gone from immediate reach/i);
  assert.doesNotMatch(narration, /Bren Thorn/i);
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
      {
        type: "move_player",
        targetLocationId: "loc_market",
        relocationReason: "magical_portal",
      },
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
          socialOutcome: "shares_fact",
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
          socialOutcome: "acknowledges",
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

test("same-turn focus changes keep named actors available within the same venue", () => {
  const evaluated = engineTestUtils.evaluateResolvedCommand({
    snapshot: {
      ...createSnapshot(),
      state: {
        ...createSnapshot().state,
        sceneFocus: {
          key: "thorn_oak_shop",
          label: "Thorn and Oak (Elias's Shop)",
        },
      },
      presentNpcs: [
        {
          id: "npc_guard",
          name: "Elias Thorn",
          role: "customer",
          summary: "Waiting inside Thorn and Oak for the arranged delivery.",
          description: "Ledger tucked beneath one arm.",
          socialLayer: "anchor",
          isNarrativelyHydrated: true,
          factionId: null,
          factionName: null,
          currentLocationId: "loc_gate",
          approval: 0,
          approvalBand: "neutral",
          isCompanion: false,
          state: "active",
          threatLevel: 0,
        },
      ],
    },
    command: {
      type: "resolve_mechanics",
      timeMode: "exploration",
      suggestedActions: ["Complete the sale"],
      mutations: [
        {
          type: "set_player_scene_focus",
          focusKey: "shop_interior",
          label: "Shop Interior",
          reason: "You step into the interior of the shop.",
        },
        {
          type: "record_npc_interaction",
          npcId: "npc_guard",
          interactionSummary: "You present the delivery and open the conversation.",
          socialOutcome: "acknowledges",
        },
      ],
      warnings: [],
      timeElapsed: 5,
    },
    fetchedFacts: [],
    routerDecision: createRouterDecision(["converse", "economy_light"]),
    playerAction: "I head into the shop interior and speak to Elias about the delivery.",
  });

  assert.deepEqual(
    evaluated.stateCommitLog.map((entry) => [entry.mutationType, entry.status, entry.reasonCode]),
    [
      ["set_player_scene_focus", "applied", "scene_focus_updated"],
      ["record_npc_interaction", "applied", "npc_interaction_recorded"],
    ],
  );
  assert.equal(evaluated.nextState.sceneActorFocuses["actor:actor_npc_guard"], "shop_interior");
});

test("same-turn focus changes do not pull unrelated named actors into the new venue focus", () => {
  const evaluated = engineTestUtils.evaluateResolvedCommand({
    snapshot: {
      ...createSnapshot(),
      state: {
        ...createSnapshot().state,
        sceneFocus: {
          key: "thorn_oak_shop",
          label: "Thorn and Oak (Elias's Shop)",
        },
      },
      presentNpcs: [
        {
          id: "npc_guard",
          name: "Gate Guard",
          role: "guard",
          summary: "Watching the street outside the neighboring warehouses.",
          description: "Rain beads on the guard's cloak.",
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
    },
    command: {
      type: "resolve_mechanics",
      timeMode: "exploration",
      suggestedActions: ["Look around the room"],
      mutations: [
        {
          type: "set_player_scene_focus",
          focusKey: "shop_interior",
          label: "Shop Interior",
          reason: "You step deeper into the shop.",
        },
        {
          type: "record_npc_interaction",
          npcId: "npc_guard",
          interactionSummary: "You ask the guard about the latest delivery.",
          socialOutcome: "asks_question",
        },
      ],
      warnings: [],
      timeElapsed: 5,
    },
    fetchedFacts: [],
    routerDecision: createRouterDecision(["converse"]),
    playerAction: "I head into the shop interior and ask the guard about the delivery.",
  });

  assert.deepEqual(
    evaluated.stateCommitLog.map((entry) => [entry.mutationType, entry.status, entry.reasonCode]),
    [
      ["set_player_scene_focus", "applied", "scene_focus_updated"],
      ["record_npc_interaction", "rejected", "invalid_semantics"],
    ],
  );
});

test("same-turn focus changes reject record_npc_interaction targeting a named actor from the prior focus", () => {
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
          type: "record_npc_interaction",
          npcId: "npc_guard",
          interactionSummary: "You keep talking to the guard from the back room.",
          socialOutcome: "resists",
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
      ["record_npc_interaction", "rejected", "invalid_semantics"],
    ],
  );
});

test("record_npc_interaction rejects a known npc who is not present in the immediate scene", () => {
  const evaluated = engineTestUtils.evaluateResolvedCommand({
    snapshot: {
      ...createSnapshot(),
      state: {
        ...createSnapshot().state,
        sceneFocus: {
          key: "shop_interior",
          label: "Shop Interior",
        },
      },
      presentNpcs: [
        {
          id: "npc_guard",
          name: "Elias Thorn",
          role: "merchant",
          summary: "A cloth merchant somewhere else in the district.",
          description: "Ledger tucked under one arm.",
          socialLayer: "anchor",
          isNarrativelyHydrated: true,
          factionId: null,
          factionName: null,
          currentLocationId: "loc_gate",
          approval: 0,
          approvalBand: "neutral",
          isCompanion: false,
          state: "active",
          threatLevel: 0,
        },
      ],
    },
    command: {
      type: "resolve_mechanics",
      timeMode: "exploration",
      suggestedActions: ["Look around the shop"],
      mutations: [
        {
          type: "record_npc_interaction",
          npcId: "npc_guard",
          interactionSummary: "You ask Elias about future orders.",
          socialOutcome: "asks_question",
        },
      ],
      warnings: [],
      timeElapsed: 10,
    },
    fetchedFacts: [
      {
        type: "fetch_npc_detail",
        result: {
          id: "npc_guard",
          name: "Elias Thorn",
          role: "merchant",
          summary: "Discusses trade terms in the market square.",
          description: "He is still out in the district.",
          socialLayer: "promoted_local",
          isNarrativelyHydrated: true,
          factionId: null,
          factionName: null,
          currentLocationId: "loc_gate",
          approval: 0,
          approvalBand: "neutral",
          isCompanion: false,
          state: "active",
          threatLevel: 0,
          inventory: [],
          knownInformation: [],
          relationshipHistory: [],
          temporaryActorId: null,
        },
      },
    ],
    routerDecision: createRouterDecision(["converse"]),
    playerAction: "I ask Elias if he wants to place another order.",
  });

  assert.deepEqual(
    evaluated.stateCommitLog.map((entry) => [entry.mutationType, entry.status, entry.reasonCode]),
    [["record_npc_interaction", "rejected", "invalid_target"]],
  );
});

test("record_npc_interaction applies when a known npc is explicitly brought into the scene first", () => {
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
      timeMode: "exploration",
      suggestedActions: ["Keep talking"],
      mutations: [
        {
          type: "set_scene_actor_presence",
          actorRef: "npc:npc_guard",
          newLocationId: "loc_gate",
          reason: "Elias steps into the shop to meet you.",
        },
        {
          type: "record_npc_interaction",
          npcId: "npc_guard",
          interactionSummary: "You ask Elias about future orders once he arrives.",
          socialOutcome: "shares_fact",
        },
      ],
      warnings: [],
      timeElapsed: 10,
    },
    fetchedFacts: [
      {
        type: "fetch_npc_detail",
        result: {
          id: "npc_guard",
          name: "Elias Thorn",
          role: "merchant",
          summary: "Known customer currently elsewhere in the city.",
          description: "He can be fetched into the scene when explicitly called over.",
          socialLayer: "promoted_local",
          isNarrativelyHydrated: true,
          factionId: null,
          factionName: null,
          currentLocationId: null,
          approval: 0,
          approvalBand: "neutral",
          isCompanion: false,
          state: "active",
          threatLevel: 0,
          inventory: [],
          knownInformation: [],
          relationshipHistory: [],
          temporaryActorId: null,
        },
      },
    ],
    routerDecision: createRouterDecision(["converse"]),
    playerAction: "I call Elias over and ask about future orders when he arrives.",
  });

  assert.deepEqual(
    evaluated.stateCommitLog.map((entry) => [entry.mutationType, entry.status, entry.reasonCode]),
    [
      ["set_scene_actor_presence", "applied", "scene_actor_presence_updated"],
      ["record_npc_interaction", "applied", "npc_interaction_recorded"],
    ],
  );
});

test("record_npc_interaction stays valid after explicit arrival and a same-venue focus change", () => {
  const evaluated = engineTestUtils.evaluateResolvedCommand({
    snapshot: {
      ...createSnapshot(),
      state: {
        ...createSnapshot().state,
        sceneFocus: {
          key: "thorn_oak_shop",
          label: "Thorn and Oak (Elias's Shop)",
        },
      },
      presentNpcs: [],
      knownNpcLocationIds: {
        npc_guard: null,
      },
    },
    command: {
      type: "resolve_mechanics",
      timeMode: "exploration",
      suggestedActions: ["Keep talking"],
      mutations: [
        {
          type: "set_scene_actor_presence",
          actorRef: "npc:npc_guard",
          newLocationId: "loc_gate",
          reason: "Elias steps into Thorn and Oak to meet you.",
        },
        {
          type: "set_player_scene_focus",
          focusKey: "shop_interior",
          label: "Shop Interior",
          reason: "You step deeper into the shop together.",
        },
        {
          type: "record_npc_interaction",
          npcId: "npc_guard",
          interactionSummary: "You ask Elias about future orders once you are both inside.",
          socialOutcome: "shares_fact",
        },
      ],
      warnings: [],
      timeElapsed: 10,
    },
    fetchedFacts: [
      {
        type: "fetch_npc_detail",
        result: {
          id: "npc_guard",
          name: "Elias Thorn",
          role: "merchant",
          summary: "Known customer currently elsewhere in the city.",
          description: "He can be fetched into the scene when explicitly called over.",
          socialLayer: "promoted_local",
          isNarrativelyHydrated: true,
          factionId: null,
          factionName: null,
          currentLocationId: null,
          approval: 0,
          approvalBand: "neutral",
          isCompanion: false,
          state: "active",
          threatLevel: 0,
          inventory: [],
          knownInformation: [],
          relationshipHistory: [],
          temporaryActorId: null,
        },
      },
    ],
    routerDecision: createRouterDecision(["converse"]),
    playerAction: "I call Elias over, step into the shop interior, and ask about future orders.",
  });

  assert.deepEqual(
    evaluated.stateCommitLog.map((entry) => [entry.mutationType, entry.status, entry.reasonCode]),
    [
      ["set_scene_actor_presence", "applied", "scene_actor_presence_updated"],
      ["set_player_scene_focus", "applied", "scene_focus_updated"],
      ["record_npc_interaction", "applied", "npc_interaction_recorded"],
    ],
  );
  assert.equal(evaluated.nextState.sceneActorFocuses["actor:actor_npc_guard"], "shop_interior");
});

test("record_npc_interaction stays valid after explicit arrival from an unfocused scene", () => {
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
      timeMode: "exploration",
      suggestedActions: ["Keep talking"],
      mutations: [
        {
          type: "set_scene_actor_presence",
          actorRef: "npc:npc_guard",
          newLocationId: "loc_gate",
          reason: "Elias steps over when you call him.",
        },
        {
          type: "set_player_scene_focus",
          focusKey: "shop_interior",
          label: "Shop Interior",
          reason: "You step into the shop interior with him.",
        },
        {
          type: "record_npc_interaction",
          npcId: "npc_guard",
          interactionSummary: "You ask Elias about future orders once you are both inside.",
          socialOutcome: "shares_fact",
        },
      ],
      warnings: [],
      timeElapsed: 10,
    },
    fetchedFacts: [
      {
        type: "fetch_npc_detail",
        result: {
          id: "npc_guard",
          name: "Elias Thorn",
          role: "merchant",
          summary: "Known customer currently elsewhere in the city.",
          description: "He can be fetched into the scene when explicitly called over.",
          socialLayer: "promoted_local",
          isNarrativelyHydrated: true,
          factionId: null,
          factionName: null,
          currentLocationId: null,
          approval: 0,
          approvalBand: "neutral",
          isCompanion: false,
          state: "active",
          threatLevel: 0,
          inventory: [],
          knownInformation: [],
          relationshipHistory: [],
          temporaryActorId: null,
        },
      },
    ],
    routerDecision: createRouterDecision(["converse"]),
    playerAction: "I call Elias over, head into the shop interior, and ask about future orders.",
  });

  assert.deepEqual(
    evaluated.stateCommitLog.map((entry) => [entry.mutationType, entry.status, entry.reasonCode]),
    [
      ["set_scene_actor_presence", "applied", "scene_actor_presence_updated"],
      ["set_player_scene_focus", "applied", "scene_focus_updated"],
      ["record_npc_interaction", "applied", "npc_interaction_recorded"],
    ],
  );
});

test("candidateSuggestedActionsForCommittedCommand keeps mechanics suggestions and drops fast-forward suggestions", () => {
  const mechanicsActions = engineTestUtils.candidateSuggestedActionsForCommittedCommand({
    type: "resolve_mechanics",
    timeMode: "exploration",
    suggestedActions: ["Browse the shelves", "Browse the shelves", "Ask Elias about the ledger"],
    mutations: [],
    warnings: [],
    timeElapsed: 5,
  });
  const fastForwardActions = engineTestUtils.candidateSuggestedActionsForCommittedCommand({
    type: "execute_fast_forward",
    requestedDurationMinutes: 1440,
    routineSummary: "You work the stall through the day.",
    recurringActivities: ["Sell cloth"],
    intendedOutcomes: ["Earn coin"],
    warnings: [],
    memorySummary: "You keep the stall open all day.",
    timeElapsed: 1440,
  });

  assert.deepEqual(mechanicsActions, [
    "Browse the shelves",
    "Ask Elias about the ledger",
  ]);
  assert.deepEqual(fastForwardActions, []);
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
          inventory: [],
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
          socialOutcome: "acknowledges",
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

test("engine rejects npc interaction summaries that imply movement without actor presence support", () => {
  const evaluated = engineTestUtils.evaluateResolvedCommand({
    snapshot: createSnapshot(),
    command: {
      type: "resolve_mechanics",
      timeMode: "exploration",
      suggestedActions: ["See what the guard does"],
      mutations: [
        {
          type: "record_npc_interaction",
          npcId: "npc_guard",
          interactionSummary: "The guard approaches and answers in a low voice.",
          socialOutcome: "shares_fact",
        },
      ],
      warnings: [],
      timeElapsed: 5,
    },
    fetchedFacts: [],
    routerDecision: createRouterDecision(["converse"]),
    playerAction: "I ask the guard what he knows.",
  });

  assert.equal(evaluated.stateCommitLog[0]?.reasonCode, "invalid_semantics");
});

test("engine accepts actor interaction movement summaries when actor presence support is provided with actor refs", () => {
  const snapshot = createSnapshot();
  snapshot.temporaryActors = snapshot.temporaryActors.map((actor) =>
    actor.id === "temp_dockhand"
      ? { ...actor, currentLocationId: null }
      : actor);

  const evaluated = engineTestUtils.evaluateResolvedCommand({
    snapshot,
    command: {
      type: "resolve_mechanics",
      timeMode: "exploration",
      suggestedActions: ["See what the dockhand does"],
      mutations: [
        {
          type: "set_scene_actor_presence",
          actorRef: "actor:temp_dockhand",
          newLocationId: "loc_gate",
          reason: "The dockhand walks back over.",
        },
        {
          type: "record_actor_interaction",
          actorId: "temp_dockhand",
          interactionSummary: "The dockhand approaches and points you toward the harbor office.",
          socialOutcome: "redirects",
          topic: "harbor office",
        },
      ],
      warnings: [],
      timeElapsed: 5,
    },
    fetchedFacts: [],
    routerDecision: createRouterDecision(["converse"]),
    playerAction: "I wave the dockhand over and ask where the harbor office is.",
  });

  assert.deepEqual(
    evaluated.stateCommitLog.map((entry) => [entry.mutationType, entry.status, entry.reasonCode]),
    [
      ["set_scene_actor_presence", "applied", "scene_actor_presence_updated"],
      ["record_actor_interaction", "applied", "actor_interaction_recorded"],
    ],
  );
});

test("engine rejects player-relocation language in interaction summaries without player movement support", () => {
  const evaluated = engineTestUtils.evaluateResolvedCommand({
    snapshot: createSnapshot(),
    command: {
      type: "resolve_mechanics",
      timeMode: "exploration",
      suggestedActions: ["Keep talking"],
      mutations: [
        {
          type: "record_npc_interaction",
          npcId: "npc_guard",
          interactionSummary: "You step closer and keep the guard talking.",
          socialOutcome: "hesitates",
        },
      ],
      warnings: [],
      timeElapsed: 5,
    },
    fetchedFacts: [],
    routerDecision: createRouterDecision(["converse"]),
    playerAction: "I keep talking to the guard.",
  });

  assert.equal(evaluated.stateCommitLog[0]?.reasonCode, "invalid_semantics");
});

test("set_player_scene_focus does not justify NPC staging language in interaction summaries", () => {
  const evaluated = engineTestUtils.evaluateResolvedCommand({
    snapshot: createSnapshot(),
    command: {
      type: "resolve_mechanics",
      timeMode: "exploration",
      suggestedActions: ["Head to the doorway"],
      mutations: [
        {
          type: "set_player_scene_focus",
          focusKey: "doorway",
          label: "Doorway",
          reason: "You shift toward the doorway.",
        },
        {
          type: "record_npc_interaction",
          npcId: "npc_guard",
          interactionSummary: "The guard stands by the doorway and keeps watch on you.",
          socialOutcome: "resists",
        },
      ],
      warnings: [],
      timeElapsed: 5,
    },
    fetchedFacts: [],
    routerDecision: createRouterDecision(["converse"]),
    playerAction: "I shift toward the doorway and keep talking to the guard.",
  });

  assert.deepEqual(
    evaluated.stateCommitLog.map((entry) => [entry.mutationType, entry.status, entry.reasonCode]),
    [
      ["set_player_scene_focus", "applied", "scene_focus_updated"],
      ["record_npc_interaction", "rejected", "invalid_semantics"],
    ],
  );
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

test("blocked routes reject start_journey deterministically", () => {
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
      { type: "start_journey", edgeId: "edge_gate_market", destinationLocationId: "loc_market" },
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
        targetLocationId: "loc_market",
        relocationReason: "forced_transport",
      },
    ]),
    fetchedFacts: [],
    routerDecision: createRouterDecision(["converse", "investigate"]),
  });

  assert.deepEqual(evaluated.nextState.characterState.activeCompanions, ["actor:actor_npc_guard"]);
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
      storedCurrencyCp: 0,
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
      storedCurrencyCp: 0,
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
      storedCurrencyCp: 0,
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
        currencyAmount: { sp: 2 },
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
      storedCurrencyCp: 0,
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

test("transfer_assets can hand grounded items to a temporary actor", () => {
  const snapshot = structuredClone(createSnapshot());
  snapshot.assetItems = [
    {
      id: "iteminst_roll_1",
      characterInstanceId: snapshot.character.instanceId,
      npcId: null,
      temporaryActorId: null,
      worldObjectId: null,
      sceneLocationId: null,
      sceneFocusKey: null,
      templateId: "item_honey_roll",
      template: {
        id: "item_honey_roll",
        campaignId: snapshot.campaignId,
        name: "Honey-wheat roll",
        description: "A sweet roll glazed with honey.",
        value: 1,
        weight: 0.1,
        rarity: "common",
        tags: [],
      },
      isIdentified: true,
      charges: null,
      properties: null,
    },
  ];
  snapshot.character.inventory = structuredClone(snapshot.assetItems);

  const evaluated = engineTestUtils.evaluateResolvedCommand({
    snapshot,
    command: createValidatedCommand("success", [
      {
        type: "transfer_assets",
        source: { kind: "player" },
        destination: { kind: "temporary_actor", actorId: "temp_dockhand" },
        templateTransfers: [{ templateId: "item_honey_roll", quantity: 1 }],
        reason: "Pass the roll to the dockhand.",
      },
    ]),
    fetchedFacts: [],
    routerDecision: createRouterDecision(["converse"]),
  });

  assert.equal(evaluated.stateCommitLog[1]?.reasonCode, "assets_transferred");
  assert.equal(evaluated.stateCommitLog[1]?.status, "applied");
});

test("spawned environmental items can be transferred to a temporary actor in the same turn", () => {
  const snapshot = structuredClone(createSnapshot());

  const evaluated = engineTestUtils.evaluateResolvedCommand({
    snapshot,
    command: createValidatedCommand("success", [
      {
        type: "spawn_environmental_item",
        spawnKey: "wash_cloth",
        itemName: "Wash Cloth",
        description: "A folded linen wash cloth from the basin stand.",
        quantity: 1,
        holder: { kind: "player" },
        reason: "Take a clean cloth from the wash stand.",
      },
      {
        type: "transfer_assets",
        source: { kind: "player" },
        destination: { kind: "temporary_actor", actorId: "temp_dockhand" },
        templateTransfers: [{ templateId: "spawn:wash_cloth", quantity: 1 }],
        reason: "Hand the cloth to the dockhand.",
      },
    ]),
    fetchedFacts: [],
    routerDecision: createRouterDecision(["converse", "investigate"]),
  });

  assert.equal(evaluated.stateCommitLog[1]?.reasonCode, "environmental_item_spawned");
  assert.equal(evaluated.stateCommitLog[2]?.reasonCode, "assets_transferred");
  assert.equal(evaluated.stateCommitLog[2]?.status, "applied");
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

test("deterministic narration fallback does not echo raw rejected mutation summaries", () => {
  const narration = engineTestUtils.deterministicNarrationFallback({
    playerAction: "Take off the ring and tuck it away.",
    stateCommitLog: [
      {
        kind: "mutation",
        mutationType: "update_item_state",
        status: "applied",
        reasonCode: "item_state_updated",
        summary: "Silver signet ring with hidden poisoned needle changes state.",
        metadata: null,
      },
      {
        kind: "mutation",
        mutationType: "adjust_inventory",
        status: "rejected",
        reasonCode: "unauthorized_vector",
        summary: "Inventory changes are not authorized for this turn.",
        metadata: null,
      },
    ],
    checkResult: null,
  });

  assert.match(narration, /adjust silver signet ring with hidden poisoned needle/i);
  assert.doesNotMatch(narration, /Inventory changes are not authorized for this turn/i);
});

test("deterministic narration fallback softens time plus local interaction summaries", () => {
  const narration = engineTestUtils.deterministicNarrationFallback({
    playerAction: "I step inside and ask the baker what's fresh this morning.",
    stateCommitLog: [
      {
        kind: "mutation",
        mutationType: "advance_time",
        status: "applied",
        reasonCode: "time_advanced",
        summary: "Time passes for 5 minutes.",
        metadata: null,
      },
      {
        kind: "mutation",
        mutationType: "record_local_interaction",
        status: "applied",
        reasonCode: "local_interaction_recorded",
        summary: "Asked the baker what's fresh this morning",
        metadata: null,
      },
    ],
    checkResult: null,
  });

  assert.match(narration, /you asked the baker what's fresh this morning/i);
  assert.doesNotMatch(narration, /Time passes for 5 minutes/i);
});

test("deterministic narration fallback preserves socially negative interaction outcomes verbatim", () => {
  const narration = engineTestUtils.deterministicNarrationFallback({
    playerAction: "I offer Tarn the bath again.",
    stateCommitLog: [
      {
        kind: "mutation",
        mutationType: "record_npc_interaction",
        status: "applied",
        reasonCode: "npc_interaction_recorded",
        summary: "Tarn declines the bath and chooses the cot instead.",
        metadata: {
          npcId: "npc_tarn",
          topic: "lodging",
          socialOutcome: "declines",
          phase: "immediate",
        },
      },
    ],
    checkResult: null,
  });

  assert.match(narration, /declines the bath/i);
  assert.doesNotMatch(narration, /accept/i);
});

test("deterministic narration fallback ignores raw closure language for soft social outcomes", () => {
  const narration = engineTestUtils.deterministicNarrationFallback({
    playerAction: "I wait for Tarn's answer.",
    stateCommitLog: [
      {
        kind: "mutation",
        mutationType: "record_npc_interaction",
        status: "applied",
        reasonCode: "npc_interaction_recorded",
        summary: "Tarn agrees to stay and tells you to remain with her.",
        metadata: {
          npcId: "npc_tarn",
          topic: "shelter",
          socialOutcome: "acknowledges",
          phase: "immediate",
        },
      },
    ],
    checkResult: null,
  });

  assert.match(narration, /no commitment is made/i);
  assert.doesNotMatch(narration, /agrees to stay/i);
  assert.doesNotMatch(narration, /remain with her/i);
});
