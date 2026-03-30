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

test("extractToolInput preserves plain text when no tool wrapper is returned", () => {
  const response = {
    choices: [
      {
        finish_reason: "stop",
        message: {
          content: "The baker dusts off his hands and points out the morning buns still warm from the oven.",
        },
      },
    ],
  } as never;

  const extracted = aiProviderTestUtils.extractToolInput(response);

  assert.equal(extracted.name, null);
  assert.equal(extracted.input, null);
  assert.match(extracted.rawText ?? "", /morning buns still warm/i);
});

test("normalizeRouterDecision caps mustCheck to seven entries and drops least authoritative overflow", () => {
  const normalized = aiProviderTestUtils.normalizeRouterDecision({
    profile: "local",
    confidence: "high",
    authorizedVectors: ["converse"],
    requiredPrerequisites: [],
    reason: "Talk to the baker.",
    clarification: {
      needed: false,
      blocker: null,
      question: null,
      options: [],
    },
    attention: {
      primaryIntent: "Ask the baker what's fresh this morning.",
      resolvedReferents: [],
      unresolvedReferents: [],
      impliedDestinationFocus: null,
      mustCheck: [
        "sceneActors",
        "sceneAspects",
        "worldObjects",
        "inventory",
        "routes",
        "gold",
        "fetchedFacts",
        "recentTurnLedger",
      ],
    },
  });

  assert.equal(normalized.attention.mustCheck.length, 7);
  assert.deepEqual(normalized.attention.mustCheck, [
    "sceneActors",
    "sceneAspects",
    "worldObjects",
    "inventory",
    "routes",
    "gold",
    "fetchedFacts",
  ]);
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

test("parseFinalActionToolCall normalizes null checkIntent to omission", () => {
  const parsed = aiProviderTestUtils.parseFinalActionToolCall({
    type: "resolve_mechanics",
    timeMode: "downtime",
    suggestedActions: ["Check coin purse"],
    checkIntent: null,
    mutations: [
      {
        type: "advance_time",
        durationMinutes: 5,
        phase: "immediate",
      },
      {
        type: "set_player_scene_focus",
        focusKey: "back_room",
        label: "The Back Room",
        reason: "Checking stored belongings",
        phase: "immediate",
      },
    ],
  });

  assert.equal(parsed.success, true);
  if (!parsed.success) {
    return;
  }
  assert.equal(parsed.data.type, "resolve_mechanics");
  if (parsed.data.type !== "resolve_mechanics") {
    return;
  }
  assert.equal(parsed.data.checkIntent, undefined);
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
  assert.match(prompt, /classify the action into exactly one semantic lane: FLAVOR, MANIFEST, or KNOWLEDGE/);
  assert.match(prompt, /FLAVOR resolves through advance_time only/);
  assert.match(prompt, /MANIFEST covers plausible immediate local developments implied by the player/);
  assert.match(prompt, /Same-turn chaining is encouraged: spawn first, then reference it with spawn:<key>/);
  assert.match(prompt, /discover_information is for grounded knowledge only\. Never use it for look around, search, listen, investigate the room/);
  assert.match(prompt, /If the player implies a plausible local detail that is not yet grounded, prefer bounded manifestation over rejection/);
  assert.match(prompt, /In MANIFEST, do not instantiate value/);
  assert.match(prompt, /spawned actors must be ordinary generic locals/);
  assert.match(prompt, /ambiguous threats or signs must appear as ambiguous scene aspects/);
  assert.match(prompt, /Same-turn spatial isolation rule/);
  assert.match(prompt, /must target an actor already valid in the new focus or a newly spawned actor referenced via spawn:<key>/);
  assert.match(prompt, /always include top-level timeMode, suggestedActions, and mutations/);
  assert.match(prompt, /timeMode must be exactly one of: combat, exploration, travel, rest, downtime/);
  assert.match(prompt, /Use downtime for crafting, routine work, commissioning help/);
  assert.match(prompt, /Use exploration for investigation, searching, scouting, talking within the current scene/);
  assert.match(prompt, /Do not treat internal thoughts, mutters to yourself, or naming an item as dialogue/);
  assert.match(prompt, /Giving a present subordinate or ally a routine instruction to fetch someone/);
  assert.match(prompt, /Only include checkIntent when success or failure meaningfully changes which mutations can happen/);
  assert.match(prompt, /Only set citedNpcId when the player is directly engaging that NPC on-screen this turn/);
  assert.match(prompt, /For notice\/analyze\/search\/listen turns that use checkIntent, any newly noticed actor, clue, item, or scene detail must be phase conditional/);
  assert.match(prompt, /Never use placeholder ids like none, null, unknown, or n\/a for citedNpcId, targetNpcId, localEntityId, or spawn references/);
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
  assert.match(prompt, /Use set_player_scene_focus for self-directed movement within the current location/);
  assert.match(prompt, /label must describe a spatial sub-location or zone/);
  assert.match(prompt, /never a portable object like Coin Purse or Sword/);
  assert.match(prompt, /Never use it to simulate the player arriving somewhere/);
  assert.match(prompt, /Do not use it for solo errands, checking your own gear, retrieving your own belongings/);
  assert.match(prompt, /TRIVIAL ACTIONS: Checking personal inventory, reviewing known information, or looking around a safe room requires ZERO checks/);
  assert.match(prompt, /ID HALLUCINATION BAN: You are strictly forbidden from using discover_information unless the exact informationId is explicitly provided/);
  assert.match(prompt, /Use adjust_inventory for gaining, losing, consuming, or handing over grounded inventory items/);
  assert.match(prompt, /Self-directed downtime work may use adjust_inventory, spawn_environmental_item, and spawn_scene_aspect/);
  assert.match(prompt, /Use spawn_scene_aspect for smoke, damage, noise/);
});

test("buildTurnRouterSystemPrompt distinguishes self-talk from on-screen social commitment", () => {
  const prompt = aiProviderTestUtils.buildTurnRouterSystemPrompt();

  assert.match(prompt, /Internal thoughts, mutters to yourself, and naming an item are not converse/);
  assert.match(prompt, /Directing a present subordinate or ally to pass along a message or fetch someone is a local in-scene action/);
  assert.match(prompt, /Use clarification only for hard blockers/);
  assert.match(prompt, /Do not invent new ids or spawn handles/);
  assert.match(prompt, /routes strictly means macro-travel leaving the current location node/);
  assert.match(prompt, /back to the forge, into the market, over to the bench/);
  assert.match(prompt, /emit attention\.impliedDestinationFocus/);
  assert.match(prompt, /Do not emit impliedDestinationFocus for macro travel between location nodes/);
  assert.match(prompt, /unresolvedReferents/);
  assert.match(prompt, /Never remap an unresolved pronoun or stale narrated referent onto a different grounded actor/);
  assert.match(prompt, /recentGroundedHistory is memory, not authority/);
});

test("fallbackRouterDecision stays local when scene focus is active", () => {
  const decision = aiProviderTestUtils.fallbackRouterDecision(
    "Router crashed during micro-scene action.",
    "I check on the mare.",
    {
      currentLocation: {
        id: "loc_city",
        name: "Waterdeep",
        type: "city",
        summary: "A vast city.",
        state: "busy",
      },
      sceneFocus: {
        key: "stable_entrance",
        label: "Stable Entrance",
      },
      adjacentRoutes: [],
      sceneActors: [],
      recentLocalEvents: [],
      recentTurnLedger: [],
      discoveredInformation: [],
      activePressures: [],
      activeThreads: [],
      inventory: [],
      worldObjects: [],
      sceneAspects: [],
      gold: 7,
    },
  );

  assert.equal(decision.profile, "local");
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
      recentNarrativeProse: [],
      recentLocalEvents: [],
      recentTurnLedger: [],
      discoveredInformation: [],
      activePressures: [],
      recentWorldShifts: [],
      activeThreads: [],
      inventory: [],
      worldObjects: [],
      sceneFocus: null,
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
    narrationHint: null,
  });

  assert.match(prompt.user, /context/);
  assert.match(prompt.user, /Blackwater Docks/);
  assert.match(prompt.user, /fetched_facts/);
  assert.match(prompt.user, /Pier Nine Closure/);
  assert.match(prompt.system, /If a spawned scene aspect is ambiguous, narrate only the sensory detail/);
  assert.match(prompt.system, /If a temporary actor was spawned, narrate them as stepping into view/);
  assert.match(prompt.system, /If a discover_information mutation was rejected, do not convert that into an authoritative negative fact/);
  assert.match(prompt.system, /do not explicitly count minutes unless the exact duration materially matters/i);
  assert.match(prompt.system, /Do not echo engine-summary phrasing like enters the scene, changes state, or time passes for 5 minutes/i);
  assert.match(prompt.system, /recentNarrativeProse is conversational continuity only/);
  assert.match(prompt.user, /authoritativeState/);
  assert.match(prompt.user, /recentGroundedHistory/);
});

test("buildResolvedTurnNarrationPrompt teaches failed invalid-target attempts as failed searches", () => {
  const prompt = aiProviderTestUtils.buildResolvedTurnNarrationPrompt({
    playerAction: "I look for the stable master and check on the mare.",
    promptContext: {
      currentLocation: {
        id: "loc_stable",
        name: "Waterdeep",
        type: "city",
        summary: "A sprawling city.",
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
      worldObjects: [],
      sceneFocus: {
        key: "stable_entrance",
        label: "Stable Entrance",
      },
      sceneAspects: {},
      localTexture: null,
      globalTime: 600,
      timeOfDay: "morning",
      dayCount: 1,
    },
    fetchedFacts: [],
    stateCommitLog: [
      {
        kind: "mutation",
        mutationType: "record_local_interaction",
        status: "rejected",
        reasonCode: "invalid_target",
        summary: "That unnamed local is not available here.",
        metadata: {
          localEntityId: "temp:stable_master",
        },
      },
      {
        kind: "mutation",
        mutationType: "advance_time",
        status: "applied",
        reasonCode: "time_advanced",
        summary: "Five minutes pass.",
        metadata: {
          durationMinutes: 5,
        },
      },
    ],
    checkResult: null,
    suggestedActions: [],
  });

  assert.match(prompt.system, /invalid_target/);
  assert.match(prompt.system, /looked for or attempted that contact but could not find or reach them/);
  assert.match(prompt.user, /record_local_interaction/);
  assert.match(prompt.user, /invalid_target/);
});

test("buildTurnUserPrompt includes attention packet before the main action block", () => {
  const prompt = aiProviderTestUtils.buildTurnUserPrompt({
    playerAction: "Ask Mira Brightstone for bread.",
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
      worldObjects: [],
      sceneFocus: {
        key: "forge",
        label: "The Forge",
      },
      sceneAspects: {},
      localTexture: null,
      globalTime: 540,
      timeOfDay: "morning",
      dayCount: 1,
    },
    fetchedFacts: [],
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
      gold: 3,
      inventory: [],
      commodityStacks: [],
    },
    routerDecision: {
      profile: "local",
      confidence: "high",
      authorizedVectors: ["economy_light"],
      requiredPrerequisites: [],
      reason: "A simple named-NPC purchase request.",
      clarification: {
        needed: false,
        blocker: null,
        question: null,
        options: [],
      },
      attention: {
        primaryIntent: "Buy bread from the named baker in scene.",
        resolvedReferents: [
          {
            phrase: "Mira Brightstone",
            targetRef: "npc:npc_mira",
            targetKind: "scene_actor",
            confidence: "high",
          },
        ],
        unresolvedReferents: [],
        impliedDestinationFocus: null,
        mustCheck: ["sceneActors", "gold"],
      },
    },
  });

  assert.ok(prompt.indexOf("<attention_packet>") < prompt.indexOf("<action>"));
  assert.match(prompt, /targetRef: npc:npc_mira/);
  assert.match(prompt, /mustCheck:/);
  assert.match(prompt, /You are in Lantern Market\. Your current focus\/position is: The Forge\./);
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
      worldObjects: [],
      sceneFocus: null,
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
      worldObjects: [],
      sceneFocus: null,
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
  assert.doesNotMatch(prompt.user, /localEntityId: npc:npc_mira/);
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
        worldObjects: [],
        sceneFocus: null,
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

test("narrationViolatesResolvedConstraints rejects explicit minute counts on mixed turns", () => {
  const violation = aiProviderTestUtils.narrationViolatesResolvedConstraints(
    {
      playerAction: "I hurry back to my stall and draw my dagger.",
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
        worldObjects: [],
        sceneFocus: null,
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
          mutationType: "update_item_state",
          status: "applied",
          reasonCode: "item_state_updated",
          summary: "Dusk & Dawn changes state.",
          metadata: {},
        },
      ],
      checkResult: null,
      suggestedActions: [],
    },
    "You hurry back toward your stall, hand dropping to Dawn as five minutes pass in the crush of the market.",
  );

  assert.match(violation ?? "", /absorb elapsed time naturally/i);
});

test("narrationViolatesResolvedConstraints rejects engine-summary actor spawn phrasing", () => {
  const violation = aiProviderTestUtils.narrationViolatesResolvedConstraints(
    {
      playerAction: "I scan the market for the cloaked figure.",
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
        worldObjects: [],
        sceneFocus: null,
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
          mutationType: "spawn_temporary_actor",
          status: "applied",
          reasonCode: "temporary_actor_spawned",
          summary: "suspicious individual enters the scene.",
          metadata: {},
        },
      ],
      checkResult: null,
      suggestedActions: [],
    },
    "As you search the stalls, a suspicious individual has entered the scene and moves toward you through the crowd.",
  );

  assert.match(violation ?? "", /enters the scene/i);
});

test("buildResolvedTurnNarrationPrompt strips planner-intent metadata for the coin-purse regression turn", () => {
  const prompt = aiProviderTestUtils.buildResolvedTurnNarrationPrompt({
    playerAction: "I realize I did not bring my coin purse. I head back to the forge to get it and check on the horseshoe order.",
    promptContext: {
      currentLocation: {
        id: "loc_waterdeep",
        name: "Waterdeep",
        type: "city",
        summary: "A busy district with street traffic and workshops.",
        state: "active",
      },
      adjacentRoutes: [],
      sceneActors: [
        {
          actorRef: "npc:npc_bram",
          kind: "npc",
          displayLabel: "Bram Stoutshield",
          role: "forge assistant",
          detailFetchHint: null,
          lastSummary: "He usually keeps near the forge when business is brisk.",
        },
      ],
      recentLocalEvents: [],
      recentTurnLedger: [],
      discoveredInformation: [],
      activePressures: [],
      recentWorldShifts: [],
      activeThreads: [],
      inventory: [],
      worldObjects: [],
      sceneFocus: null,
      sceneAspects: {},
      localTexture: null,
      globalTime: 620,
      timeOfDay: "late morning",
      dayCount: 1,
    },
    fetchedFacts: [],
    stateCommitLog: [
      {
        kind: "mutation",
        mutationType: "advance_time",
        status: "applied",
        reasonCode: "time_advanced",
        summary: "Time passes for 10 minutes.",
        metadata: {
          durationMinutes: 10,
        },
      },
      {
        kind: "mutation",
        mutationType: "set_scene_actor_presence",
        status: "noop",
        reasonCode: "already_applied",
        summary: "Bram Stoutshield is already there.",
        metadata: {
          actorRef: "npc:npc_bram",
          newLocationId: "loc_waterdeep",
          arrivesInCurrentScene: true,
          reason: "Returns to the forge to retrieve coin purse and check the order.",
        },
      },
      {
        kind: "mutation",
        mutationType: "record_local_interaction",
        status: "rejected",
        reasonCode: "invalid_target",
        summary: "That unnamed local is not available here.",
        metadata: {
          localEntityId: "temp:forge_assistant",
          interactionSummary: "Returns to the forge to retrieve coin purse and check on the horseshoe order.",
        },
      },
    ],
    checkResult: null,
    suggestedActions: [],
  });

  assert.match(prompt.user, /rejectedOutcomeOnly: true/);
  assert.match(prompt.user, /rejectedInteractionOnly: true/);
  assert.doesNotMatch(prompt.user, /Returns to the forge to retrieve coin purse/);
  assert.doesNotMatch(prompt.user, /arrivesInCurrentScene: true/);
  assert.doesNotMatch(prompt.user, /localEntityId: temp:forge_assistant/);
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
    clarification: {
      needed: false,
      blocker: null,
      question: null,
      options: [],
    },
    attention: {
      primaryIntent: "Talk through the checkpoint.",
      resolvedReferents: [],
      unresolvedReferents: [],
      impliedDestinationFocus: null,
      mustCheck: ["sceneActors", "sceneActors", "recentTurnLedger"],
    },
  });

  assert.deepEqual(normalized.authorizedVectors, ["converse", "economy_light"]);
  assert.deepEqual(normalized.requiredPrerequisites, [
    { type: "npc_detail", npcId: "npc_guard" },
    { type: "relationship_history", npcId: "npc_guard" },
  ]);
  assert.equal(normalized.reason, "same-scene negotiation");
  assert.equal(normalized.attention.impliedDestinationFocus, null);
  assert.deepEqual(normalized.attention.mustCheck, ["sceneActors", "recentTurnLedger"]);
});

test("normalizeRouterDecision fills missing clarification and strips invalid resolved spawn refs", () => {
  const normalized = aiProviderTestUtils.normalizeRouterDecision({
    profile: "full",
    confidence: "low",
    authorizedVectors: [],
    requiredPrerequisites: [],
    reason: "Need a conservative read.",
    attention: {
      primaryIntent: "Figure out what the player means.",
      resolvedReferents: [
        {
          phrase: "the helper",
          targetRef: "spawn:helper",
          targetKind: "scene_actor",
          confidence: "medium",
        },
        {
          phrase: "Mira",
          targetRef: "npc:npc_mira",
          targetKind: "scene_actor",
          confidence: "high",
        },
      ],
      unresolvedReferents: [],
      impliedDestinationFocus: null,
      mustCheck: ["gold", "gold", "inventory"],
    },
  } as never);

  assert.deepEqual(normalized.clarification, {
    needed: false,
    blocker: null,
    question: null,
    options: [],
  });
  assert.deepEqual(normalized.attention.resolvedReferents, [
    {
      phrase: "Mira",
      targetRef: "npc:npc_mira",
      targetKind: "scene_actor",
      confidence: "high",
    },
  ]);
  assert.equal(normalized.attention.impliedDestinationFocus, null);
  assert.deepEqual(normalized.attention.mustCheck, ["gold", "inventory"]);
});

test("fallbackRouterDecision keeps a conservative non-empty attention packet", () => {
  const fallback = aiProviderTestUtils.fallbackRouterDecision(
    "Planner classification failed, so the turn falls back to full context and no explicit vectors.",
    "I head back to the forge to get my coin purse.",
    {
      currentLocation: {
        id: "loc_waterdeep",
        name: "Waterdeep",
        type: "city",
        summary: "A broad city node.",
        state: "active",
      },
      sceneFocus: null,
      adjacentRoutes: [
        {
          id: "route_neverwinter",
          targetLocationId: "loc_neverwinter",
          targetLocationName: "Neverwinter",
          travelTimeMinutes: 720,
          dangerLevel: 2,
          currentStatus: "open",
          description: "A long northern road.",
        },
      ],
      sceneActors: [],
      recentLocalEvents: [],
      recentTurnLedger: [],
      discoveredInformation: [],
      activePressures: [],
      activeThreads: [],
      inventory: [],
      worldObjects: [],
      sceneAspects: [],
      gold: 3,
    },
  );

  assert.match(fallback.attention.primaryIntent, /head back to the forge/i);
  assert.equal(fallback.profile, "full");
  assert.equal(fallback.attention.impliedDestinationFocus, null);
  assert.deepEqual(fallback.attention.mustCheck, [
    "sceneActors",
    "inventory",
    "sceneAspects",
    "recentTurnLedger",
  ]);
});

test("fallbackRouterDecision includes routes only for clear macro-travel intent", () => {
  const fallback = aiProviderTestUtils.fallbackRouterDecision(
    "Planner classification failed, so the turn falls back to full context and no explicit vectors.",
    "I travel to Neverwinter before dusk.",
    {
      currentLocation: {
        id: "loc_waterdeep",
        name: "Waterdeep",
        type: "city",
        summary: "A broad city node.",
        state: "active",
      },
      sceneFocus: null,
      adjacentRoutes: [
        {
          id: "route_neverwinter",
          targetLocationId: "loc_neverwinter",
          targetLocationName: "Neverwinter",
          travelTimeMinutes: 720,
          dangerLevel: 2,
          currentStatus: "open",
          description: "A long northern road.",
        },
      ],
      sceneActors: [],
      recentLocalEvents: [],
      recentTurnLedger: [],
      discoveredInformation: [],
      activePressures: [],
      activeThreads: [],
      inventory: [],
      worldObjects: [],
      sceneAspects: [],
      gold: 3,
    },
  );

  assert.deepEqual(fallback.attention.mustCheck, [
    "sceneActors",
    "inventory",
    "sceneAspects",
    "recentTurnLedger",
  ]);
});

test("formatRouterContextForModel compacts router payload to skinny referent lists", () => {
  const rendered = aiProviderTestUtils.formatRouterContextForModel({
    currentLocation: {
      id: "loc_waterdeep",
      name: "Waterdeep",
      type: "city",
      summary: "A city of wards, guilds, and harbor trade.",
      state: "active",
    },
    sceneFocus: {
      key: "forge",
      label: "The Forge",
    },
    adjacentRoutes: [
      {
        id: "route_neverwinter",
        targetLocationId: "loc_neverwinter",
        targetLocationName: "Neverwinter",
        travelTimeMinutes: 720,
        dangerLevel: 2,
        currentStatus: "open",
        description: "A long northern road lined with caravanserais and patrol beacons.",
      },
    ],
    sceneActors: [
      {
        actorRef: "npc:npc_captain_thorne",
        kind: "npc",
        displayLabel: "Captain Thorne",
        role: "watch captain",
        detailFetchHint: {
          type: "fetch_npc_detail",
          npcId: "npc_captain_thorne",
        },
        lastSummary:
          "A veteran officer with a long backstory paragraph that should not dominate the router payload or encourage bloated prompts.",
      },
    ],
    recentLocalEvents: [
      {
        id: "event_1",
        description: "The street crowd thickened after dawn as carts and apprentices started competing for room near the ward gate.",
        locationId: "loc_waterdeep",
        triggerTime: 480,
        minutesAgo: 5,
      },
    ],
    recentTurnLedger: [
      "You finished a complicated exchange with the guild factor and then spent several minutes checking invoices around the stall fronts.",
    ],
    discoveredInformation: [
      {
        id: "info_1",
        title: "Guild Friction",
        summary: "A dispute is slowing charcoal deliveries.",
        truthfulness: "verified",
      },
    ],
    activePressures: [
      {
        entityType: "npc",
        entityId: "npc_captain_thorne",
        label: "Watch scrutiny",
        summary: "The city watch is paying closer attention to the ward after a smuggling rumor spread.",
      },
    ],
    activeThreads: [
      {
        memoryId: "mem_1",
        memoryKind: "promise",
        summary: "You promised to finish the horseshoe order before the afternoon merchant arrives.",
        isLongArcCandidate: false,
        primaryEntityType: "npc",
        primaryEntityId: "npc_merchant",
      },
    ],
    inventory: [
      {
        templateId: "item_coin_purse",
        name: "coin purse",
        quantity: 1,
      },
    ],
    worldObjects: [],
    sceneAspects: [
      {
        key: "forge_heat",
        label: "Forge Heat",
        state: "The forge is roaring hot and ready for another long work session.",
        duration: "scene",
      },
    ],
    gold: 3,
  });

  assert.equal(rendered.locationOrientation, "You are in Waterdeep. Your current focus/position is: The Forge.");
  assert.deepEqual(rendered.authoritativeState.inventory, ["coin purse (qty 1) [item_coin_purse]"]);
  assert.deepEqual(rendered.authoritativeState.routes, ["Neverwinter (720m, open, danger 2) [route_neverwinter]"]);
  assert.match(
    rendered.authoritativeState.sceneActors[0] ?? "",
    /Captain Thorne \(watch captain\) \[npc:npc_captain_thorne, npc detail-fetch\]/,
  );
  assert.doesNotMatch(rendered.authoritativeState.sceneActors[0] ?? "", /encourage bloated prompts/);
  assert.doesNotMatch(rendered.authoritativeState.routes[0] ?? "", /caravanserais/);
  assert.deepEqual(rendered.recentGroundedHistory, [
    "You finished a complicated exchange with the guild factor and then spent several minutes checking invoices aro",
  ]);
});

test("buildResolvedTurnNarrationPrompt surfaces unresolved target failures without substitution", () => {
  const prompt = aiProviderTestUtils.buildResolvedTurnNarrationPrompt({
    playerAction: "I grab their wrist before they slip away.",
    promptContext: {
      currentLocation: {
        id: "loc_market",
        name: "Lantern Market",
        type: "district",
        summary: "Rain-dark awnings and crowded stalls.",
        state: "busy",
      },
      sceneFocus: {
        key: "stall",
        label: "Your stall",
      },
      adjacentRoutes: [],
      sceneActors: [
        {
          actorRef: "npc:npc_guard",
          kind: "npc",
          displayLabel: "Bren Thorn",
          role: "market watchman",
          detailFetchHint: null,
          lastSummary: "A grizzled watchman keeps a patient eye on the market.",
        },
      ],
      recentNarrativeProse: [
        "[DM] A cloaked figure brushes past your stall and disappears into the crowd.",
      ],
      recentLocalEvents: [],
      recentTurnLedger: ["[DM] No cloaked figure is grounded at your stall."],
      discoveredInformation: [],
      activePressures: [],
      recentWorldShifts: [],
      activeThreads: [],
      inventory: [],
      worldObjects: [],
      sceneAspects: {},
      localTexture: null,
      globalTime: 540,
      timeOfDay: "morning",
      dayCount: 1,
    },
    fetchedFacts: [],
    stateCommitLog: [],
    checkResult: null,
    suggestedActions: [],
    narrationHint: {
      unresolvedTargetPhrases: ["they"],
    },
  });

  assert.match(prompt.user, /unresolvedTargetFailure: true/);
  assert.match(prompt.system, /Do not substitute another nearby person/);
});

test("selectPromptContextProfile keeps local micro-scene context even when router confidence is low", () => {
  assert.equal(
    aiProviderTestUtils.selectPromptContextProfile({
      profile: "local",
      confidence: "low",
      authorizedVectors: ["converse"],
      requiredPrerequisites: [],
      reason: "uncertain",
      clarification: {
        needed: false,
        blocker: null,
        question: null,
        options: [],
      },
      attention: {
        primaryIntent: "Uncertain local action.",
        resolvedReferents: [],
        unresolvedReferents: [],
        impliedDestinationFocus: null,
        mustCheck: [],
      },
    }),
    "local",
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
