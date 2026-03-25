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
    temporaryActors: [],
    memories: [],
    recentWorldShifts: [],
    recentMessages: [],
    canRetryLatestTurn: false,
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

test("failed checks reject requested mutations but still allow advance_time", () => {
  const evaluated = engineTestUtils.evaluateResolvedCommand({
    snapshot: createSnapshot(),
    command: createValidatedCommand("failure", [
      { type: "adjust_gold", delta: 50, reason: "guard payoff" },
      { type: "advance_time", durationMinutes: 5 },
    ]),
    fetchedFacts: [],
    routerDecision: createRouterDecision(["converse"]),
  });

  assert.deepEqual(
    evaluated.stateCommitLog.map((entry) => [entry.kind, entry.mutationType, entry.status, entry.reasonCode]),
    [
      ["check", null, "applied", "check_failure"],
      ["mutation", "adjust_gold", "rejected", "check_failed"],
      ["mutation", "advance_time", "applied", "time_advanced"],
    ],
  );
  assert.equal(evaluated.nextState.globalTime, 485);
});

test("partial checks reject requested mutations with check_partial_blocked", () => {
  const evaluated = engineTestUtils.evaluateResolvedCommand({
    snapshot: createSnapshot(),
    command: createValidatedCommand("partial", [
      { type: "adjust_gold", delta: 10, reason: "shaken guard" },
      { type: "advance_time", durationMinutes: 5 },
    ]),
    fetchedFacts: [],
    routerDecision: createRouterDecision(["converse"]),
  });

  assert.equal(evaluated.stateCommitLog[1]?.reasonCode, "check_partial_blocked");
  assert.equal(evaluated.stateCommitLog[1]?.status, "rejected");
  assert.equal(evaluated.nextState.globalTime, 485);
});

test("successful checks allow requested mutations to resolve normally", () => {
  const evaluated = engineTestUtils.evaluateResolvedCommand({
    snapshot: createSnapshot(),
    command: createValidatedCommand("success", [
      { type: "adjust_gold", delta: 5, reason: "guard bribe backfires into a tip" },
      { type: "advance_time", durationMinutes: 5 },
    ]),
    fetchedFacts: [],
    routerDecision: createRouterDecision(["converse"]),
  });

  assert.equal(evaluated.stateCommitLog[1]?.reasonCode, "gold_adjusted");
  assert.equal(evaluated.stateCommitLog[1]?.status, "applied");
  assert.equal(evaluated.nextState.globalTime, 485);
});
