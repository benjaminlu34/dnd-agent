import assert from "node:assert/strict";
import test from "node:test";
import { aiProviderTestUtils } from "../ai/provider";

test("extractToolInput flags clipped resolve_mechanics payloads as likely truncated", () => {
  const response = {
    choices: [
      {
        finish_reason: "tool_calls",
        message: {
          tool_calls: [
            {
              type: "function",
              function: {
                name: "resolve_mechanics",
                arguments:
                  "{\"timeMode\":\"exploration\",\"suggestedActions\":[\"Keep talking\"],\"mutations\":[{\"type\":\"adjust_relationship\",\"npcId\":\"npc_guard\",\"delta\":1,\"reason\":\"steady pressure\"}]",
              },
            },
          ],
          content: "",
        },
      },
    ],
  } as never;

  const extracted = aiProviderTestUtils.extractToolInput(response);

  assert.equal(extracted.name, "resolve_mechanics");
  assert.equal(extracted.likelyTruncated, true);
});

test("parseFinalActionToolCall accepts resolve_mechanics payloads", () => {
  const parsed = aiProviderTestUtils.parseFinalActionToolCall({
    type: "resolve_mechanics",
    timeMode: "exploration",
    suggestedActions: ["Keep talking"],
    checkIntent: {
      type: "challenge",
      reason: "Lean on the guard",
      challengeApproach: "influence",
    },
    mutations: [
      {
        type: "adjust_relationship",
        npcId: "npc_guard",
        delta: 1,
        reason: "The guard relents a little.",
        phase: "conditional",
      },
      {
        type: "advance_time",
        durationMinutes: 5,
        phase: "immediate",
      },
    ],
  });

  assert.equal(parsed.success, true);
});

test("parseFinalActionToolCall rejects removed legacy monolithic action payloads", () => {
  const parsed = aiProviderTestUtils.parseFinalActionToolCall({
    type: "execute_converse",
    interlocutor: "Gate Guard",
    topic: "gate trouble",
  });

  assert.equal(parsed.success, false);
});

test("buildTurnSystemPrompt hard-locks observe mode to resolve_mechanics or clarification", () => {
  const prompt = aiProviderTestUtils.buildTurnSystemPrompt("observe");

  assert.match(prompt, /resolve_mechanics or request_clarification/);
  assert.match(prompt, /Do not output narration or any freeform prose/);
  assert.match(prompt, /Do not create combat, market trade, or deliberate social escalation in observe mode/);
});

test("buildTurnSystemPrompt for player turns encodes router and check-gating rules", () => {
  const prompt = aiProviderTestUtils.buildTurnSystemPrompt("player_input");

  assert.match(prompt, /Obey the router_constraints block/);
  assert.match(prompt, /always include top-level timeMode, suggestedActions, and mutations/);
  assert.match(prompt, /timeMode must be exactly one of: combat, exploration, travel, rest, downtime/);
  assert.match(prompt, /Use downtime for crafting, routine work, commissioning help/);
  assert.match(prompt, /Use exploration for investigation, searching, scouting, talking within the current scene/);
  assert.match(prompt, /Do not treat internal thoughts, mutters to yourself, or naming an item as dialogue/);
  assert.match(prompt, /Giving a present subordinate or ally a routine instruction to fetch someone/);
  assert.match(prompt, /Only include checkIntent when success or failure meaningfully changes which mutations can happen/);
  assert.match(prompt, /Only set citedNpcId when the player is directly engaging that NPC on-screen this turn/);
  assert.match(prompt, /Use only bounded mutations/);
  assert.match(prompt, /The engine will reject them automatically on failure or partial success/);
  assert.match(prompt, /Mark resource costs, fees, and other upfront expenditures as phase immediate/);
  assert.match(prompt, /Mark success-only rewards or outcomes as phase conditional/);
  assert.match(prompt, /Use commit_market_trade only for strict commodity trade backed by fetched market prices/);
  assert.match(prompt, /Use sceneActors.actorRef values exactly when targeting on-screen actors/);
  assert.match(prompt, /Use record_local_interaction for current-scene unnamed locals instead of adjust_relationship/);
  assert.match(prompt, /Never use record_local_interaction with npc: refs or named sceneActors/);
  assert.match(prompt, /When speaking to a named on-screen NPC/);
  assert.match(prompt, /Use spawn_temporary_actor before record_local_interaction/);
  assert.match(prompt, /Use spawn_environmental_item before adjust_inventory/);
  assert.match(prompt, /Use set_scene_actor_presence whenever someone leaves the current scene/);
  assert.match(prompt, /comes back later in the turn, represent that mechanically with set_scene_actor_presence/);
  assert.match(prompt, /Use adjust_inventory for gaining, losing, consuming, or handing over grounded inventory items/);
  assert.match(prompt, /Self-directed downtime work may use adjust_inventory, spawn_environmental_item, and spawn_scene_aspect/);
  assert.match(prompt, /Use spawn_scene_aspect for smoke, damage, noise/);
});

test("buildTurnRouterSystemPrompt distinguishes self-talk from on-screen social commitment", () => {
  const prompt = aiProviderTestUtils.buildTurnRouterSystemPrompt();

  assert.match(prompt, /Internal thoughts, mutters to yourself, and naming an item are not converse/);
  assert.match(prompt, /Directing a present subordinate or ally to pass along a message or fetch someone is a local in-scene action/);
});

test("buildTurnActionCorrectionNotes adds targeted timeMode recovery guidance", () => {
  const notes = aiProviderTestUtils.buildTurnActionCorrectionNotes({
    likelyTruncated: false,
    validationIssues:
      'timeMode: Invalid option: expected one of "combat"|"exploration"|"travel"|"rest"|"downtime"',
  });

  assert.match(notes, /Validation issues: timeMode/);
  assert.match(notes, /always include top-level timeMode as exactly one of: combat, exploration, travel, rest, downtime/);
  assert.match(notes, /Use downtime for crafting, routine work, errands, or commissioning help/);
  assert.match(notes, /Use exploration for investigation, searching, talking within the current scene/);
});

test("buildResolvedTurnNarrationPrompt includes prompt context and fetched facts", () => {
  const prompt = aiProviderTestUtils.buildResolvedTurnNarrationPrompt({
    playerAction: "Ask the dockhand what changed overnight.",
    promptContext: {
      currentLocation: {
        id: "loc_docks",
        name: "Blackwater Docks",
        type: "harbor",
        summary: "Rain-dark piers and tarred rope.",
        state: "tense",
      },
      adjacentRoutes: [],
      sceneActors: [
        {
          actorRef: "temp:temp_dockhand",
          kind: "temporary_actor",
          displayLabel: "dockhand",
          role: "dockhand",
          detailFetchHint: null,
          lastSummary: "He kept glancing toward the sealed pier.",
        },
      ],
      recentLocalEvents: [],
      recentTurnLedger: [],
      discoveredInformation: [],
      activePressures: [],
      recentWorldShifts: [],
      activeThreads: [],
      inventory: [],
      sceneAspects: {},
      localTexture: null,
      globalTime: 270,
      timeOfDay: "pre-dawn",
      dayCount: 3,
    },
    fetchedFacts: [
      {
        type: "fetch_information_detail",
        result: {
          id: "info_pier",
          title: "Pier Nine Closure",
          summary: "Pier Nine was sealed before dawn.",
          content: "Guild runners closed the pier after a late-night disturbance.",
          truthfulness: "verified",
          accessibility: "public",
          locationId: "loc_docks",
          locationName: "Blackwater Docks",
          factionId: "fac_harbor",
          factionName: "Harbor Guild",
          sourceNpcId: null,
          sourceNpcName: null,
          isDiscovered: true,
          expiresAtTime: null,
        },
      },
      {
        type: "fetch_npc_detail",
        result: {
          id: "npc_dockhand",
          name: "Night Dockhand",
          role: "dock worker",
          summary: "A tired laborer with tar on his sleeves.",
          description: "He keeps watching the cordoned pier.",
          socialLayer: "promoted_local",
          isNarrativelyHydrated: true,
          factionId: null,
          factionName: null,
          currentLocationId: "loc_docks",
          approval: 0,
          approvalBand: "neutral",
          isCompanion: false,
          state: "active",
          threatLevel: 0,
          knownInformation: [],
          relationshipHistory: [],
          temporaryActorId: "temp_dockhand",
        },
        hydrationDraft: {
          summary: "A dockhand drawn into the night's trouble.",
          description: "He smells of brine and lamp oil.",
          factionId: null,
          information: [],
        },
      },
    ],
    stateCommitLog: [],
    checkResult: null,
    suggestedActions: ["Press for specifics"],
  });

  assert.match(prompt.user, /context/);
  assert.match(prompt.user, /Blackwater Docks/);
  assert.match(prompt.user, /fetched_facts/);
  assert.match(prompt.user, /Pier Nine Closure/);
});

test("buildResolvedTurnNarrationPrompt does not treat departures as waited-for arrivals", () => {
  const prompt = aiProviderTestUtils.buildResolvedTurnNarrationPrompt({
    playerAction: "Wait until the apprentice returns.",
    promptContext: {
      currentLocation: {
        id: "loc_gate",
        name: "Ash Gate",
        type: "district",
        summary: "Rain-dark stone and watchfires.",
        state: "active",
      },
      adjacentRoutes: [],
      sceneActors: [],
      recentLocalEvents: [],
      recentTurnLedger: [],
      discoveredInformation: [],
      activePressures: [],
      recentWorldShifts: [],
      activeThreads: [],
      inventory: [],
      sceneAspects: {},
      localTexture: null,
      globalTime: 480,
      timeOfDay: "morning",
      dayCount: 1,
    },
    fetchedFacts: [],
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
    suggestedActions: [],
  });

  assert.match(prompt.user, /waitingForArrival: true/);
  assert.match(prompt.user, /hasArrivalCommit: false/);
});

test("buildResolvedTurnNarrationPrompt surfaces rejected-only interaction constraints", () => {
  const prompt = aiProviderTestUtils.buildResolvedTurnNarrationPrompt({
    playerAction: "I call over Mira Brightstone and ask for a loaf.",
    promptContext: {
      currentLocation: {
        id: "loc_market",
        name: "Lantern Market",
        type: "district",
        summary: "Rain-dark awnings and crowded stalls.",
        state: "busy",
      },
      adjacentRoutes: [],
      sceneActors: [
        {
          actorRef: "npc:npc_mira",
          kind: "npc",
          displayLabel: "Mira Brightstone",
          role: "baker",
          detailFetchHint: null,
          lastSummary: "She keeps bread warm under layered cloth.",
        },
      ],
      recentLocalEvents: [],
      recentTurnLedger: [],
      discoveredInformation: [],
      activePressures: [],
      recentWorldShifts: [],
      activeThreads: [],
      inventory: [],
      sceneAspects: {},
      localTexture: null,
      globalTime: 540,
      timeOfDay: "morning",
      dayCount: 1,
    },
    fetchedFacts: [],
    stateCommitLog: [
      {
        kind: "mutation",
        mutationType: "advance_time",
        status: "applied",
        reasonCode: "time_advanced",
        summary: "Time passes for 5 minutes.",
        metadata: {},
      },
      {
        kind: "mutation",
        mutationType: "record_local_interaction",
        status: "rejected",
        reasonCode: "invalid_target",
        summary: "That unnamed local is not available here.",
        metadata: {
          localEntityId: "npc:npc_mira",
        },
      },
    ],
    checkResult: null,
    suggestedActions: [],
  });

  assert.match(prompt.user, /rejectedOutcomeOnly: true/);
  assert.match(prompt.user, /rejectedInteractionOnly: true/);
  assert.match(prompt.user, /rejectedMutationTypes:\s+  - record_local_interaction/);
});

test("narrationViolatesResolvedConstraints rejects invented quoted replies on rejected-only interaction turns", () => {
  const violation = aiProviderTestUtils.narrationViolatesResolvedConstraints(
    {
      playerAction: "I ask Mira Brightstone for a loaf.",
      promptContext: {
        currentLocation: {
          id: "loc_market",
          name: "Lantern Market",
          type: "district",
          summary: "Rain-dark awnings and crowded stalls.",
          state: "busy",
        },
        adjacentRoutes: [],
        sceneActors: [],
        recentLocalEvents: [],
        recentTurnLedger: [],
        discoveredInformation: [],
        activePressures: [],
        recentWorldShifts: [],
        activeThreads: [],
        inventory: [],
        sceneAspects: {},
        localTexture: null,
        globalTime: 540,
        timeOfDay: "morning",
        dayCount: 1,
      },
      fetchedFacts: [],
      stateCommitLog: [
        {
          kind: "mutation",
          mutationType: "advance_time",
          status: "applied",
          reasonCode: "time_advanced",
          summary: "Time passes for 5 minutes.",
          metadata: {},
        },
        {
          kind: "mutation",
          mutationType: "record_local_interaction",
          status: "rejected",
          reasonCode: "invalid_target",
          summary: "That unnamed local is not available here.",
          metadata: {},
        },
      ],
      checkResult: null,
      suggestedActions: [],
    },
    'Mira glances over and says, "Take the heel and be quick about it."',
  );

  assert.match(violation ?? "", /must not invent quoted dialogue/i);
});

test("normalizeRouterDecision dedupes vectors and prerequisites", () => {
  const normalized = aiProviderTestUtils.normalizeRouterDecision({
    profile: "local",
    confidence: "high",
    authorizedVectors: ["converse", "converse", "economy_light"],
    requiredPrerequisites: [
      { type: "npc_detail", npcId: "npc_guard" },
      { type: "npc_detail", npcId: "npc_guard" },
      { type: "relationship_history", npcId: "npc_guard" },
    ],
    reason: "  same-scene negotiation  ",
  });

  assert.deepEqual(normalized.authorizedVectors, ["converse", "economy_light"]);
  assert.deepEqual(normalized.requiredPrerequisites, [
    { type: "npc_detail", npcId: "npc_guard" },
    { type: "relationship_history", npcId: "npc_guard" },
  ]);
  assert.equal(normalized.reason, "same-scene negotiation");
});

test("selectPromptContextProfile falls back to full when router confidence is low", () => {
  assert.equal(
    aiProviderTestUtils.selectPromptContextProfile({
      profile: "local",
      confidence: "low",
      authorizedVectors: ["converse"],
      requiredPrerequisites: [],
      reason: "uncertain",
    }),
    "full",
  );
});

test("observe mode only permits resolve_mechanics or clarification as final tools", () => {
  assert.equal(
    aiProviderTestUtils.isObservePermittedFinalTool({
      type: "resolve_mechanics",
      timeMode: "exploration",
      suggestedActions: ["Keep watching"],
      mutations: [{ type: "advance_time", durationMinutes: 10 }],
    }),
    true,
  );

  assert.equal(
    aiProviderTestUtils.isObservePermittedFinalTool({
      type: "request_clarification",
      question: "What should I passively focus on first?",
      options: ["The crowd", "The patrol"],
    }),
    true,
  );

  assert.equal(
    aiProviderTestUtils.isObservePermittedFinalTool({
      type: "fetch_npc_detail",
      npcId: "npc_guard",
    }),
    false,
  );
});

test("observe mechanics safety allows passive mutations but rejects active ones", () => {
  assert.equal(
    aiProviderTestUtils.isObserveMechanicsPayloadSafe({
      type: "resolve_mechanics",
      timeMode: "exploration",
      suggestedActions: ["Keep watching"],
      mutations: [
        { type: "advance_time", durationMinutes: 10 },
        { type: "discover_information", informationId: "info_1" },
      ],
    }),
    true,
  );

  assert.equal(
    aiProviderTestUtils.isObserveMechanicsPayloadSafe({
      type: "resolve_mechanics",
      timeMode: "exploration",
      suggestedActions: ["Approach the guard"],
      mutations: [{ type: "move_player", routeEdgeId: "edge_gate_market", targetLocationId: "loc_market" }],
    }),
    false,
  );
});
