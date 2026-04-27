import assert from "node:assert/strict";
import test from "node:test";
import { aiProviderTestUtils } from "../ai/provider";

const TEST_CURRENCY = { totalCp: 300, formatted: "3 gp" } as const;
const TEST_RICH_CURRENCY = { totalCp: 700, formatted: "7 gp" } as const;

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
        "currency",
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
    "currency",
    "fetchedFacts",
  ]);
});

test("normalizeRouterDecision prefers an exact temporary-role match over a named NPC for explicit local-role nouns", () => {
  const normalized = aiProviderTestUtils.normalizeRouterDecision(
    {
      profile: "local",
      confidence: "high",
      authorizedVectors: ["converse"],
      requiredPrerequisites: [],
      reason: "The player addresses the baker at the counter.",
      clarification: {
        needed: false,
        blocker: null,
        question: null,
        options: [],
      },
      attention: {
        primaryIntent: "Order from the baker.",
        resolvedReferents: [
          {
            phrase: "baker",
            targetRef: "npc:npc_lira",
            targetKind: "scene_actor",
            confidence: "high",
          },
        ],
        unresolvedReferents: [],
        impliedDestinationFocus: null,
        mustCheck: ["sceneActors"],
      },
    },
    {
      currentLocation: {
        id: "loc_bakery",
        name: "Copper Oven",
        type: "shop",
        summary: "A hot bakery crowded with the morning rush.",
        state: "active",
      },
      sceneFocus: {
        key: "counter",
        label: "Bakery Counter",
      },
      adjacentRoutes: [],
      sceneActors: [
        {
          actorRef: "npc:npc_lira",
          kind: "npc",
          displayLabel: "Lira Thornwood",
          role: "baker's apprentice",
          detailFetchHint: {
            type: "fetch_npc_detail",
            npcId: "npc_lira",
          },
          lastSummary: "The apprentice keeps the order slips tucked under her thumb.",
        },
        {
          actorRef: "temp:tactor_baker",
          kind: "temporary_actor",
          displayLabel: "baker",
          role: "baker",
          detailFetchHint: null,
          lastSummary: "The baker is working the ovens behind the counter.",
        },
      ],
      recentLocalEvents: [],
      recentTurnLedger: [],
      discoveredInformation: [],
      activePressures: [],
      activeThreads: [],
      inventory: [],
      worldObjects: [],
      sceneAspects: [],
      currency: TEST_CURRENCY,
    },
  );

  assert.equal(normalized.attention.resolvedReferents[0]?.targetRef, "temp:tactor_baker");
});

test("normalizeRouterDecision strips invalid npc_detail prerequisites for temporary actors while preserving named NPC fetches", () => {
  const normalized = aiProviderTestUtils.normalizeRouterDecision(
    {
      profile: "local",
      confidence: "high",
      authorizedVectors: ["converse"],
      requiredPrerequisites: [
        {
          type: "npc_detail",
          npcId: "temp:tactor_baker",
        },
        {
          type: "npc_detail",
          npcId: "npc:npc_lira",
        },
        {
          type: "relationship_history",
          npcId: "temp:tactor_baker",
        },
      ],
      reason: "The turn needs named-NPC detail only.",
      clarification: {
        needed: false,
        blocker: null,
        question: null,
        options: [],
      },
      attention: {
        primaryIntent: "Ask who runs the bakery.",
        resolvedReferents: [],
        unresolvedReferents: [],
        impliedDestinationFocus: null,
        mustCheck: ["sceneActors", "fetchedFacts"],
      },
    },
    {
      currentLocation: {
        id: "loc_bakery",
        name: "Copper Oven",
        type: "shop",
        summary: "A hot bakery crowded with the morning rush.",
        state: "active",
      },
      sceneFocus: null,
      adjacentRoutes: [],
      sceneActors: [
        {
          actorRef: "npc:npc_lira",
          kind: "npc",
          displayLabel: "Lira Thornwood",
          role: "baker's apprentice",
          detailFetchHint: {
            type: "fetch_npc_detail",
            npcId: "npc_lira",
          },
          lastSummary: "She keeps the order slips tucked under her thumb.",
        },
        {
          actorRef: "temp:tactor_baker",
          kind: "temporary_actor",
          displayLabel: "baker",
          role: "baker",
          detailFetchHint: null,
          lastSummary: "The baker is working the ovens behind the counter.",
        },
      ],
      recentLocalEvents: [],
      recentTurnLedger: [],
      discoveredInformation: [],
      activePressures: [],
      activeThreads: [],
      inventory: [],
      worldObjects: [],
      sceneAspects: [],
      currency: TEST_CURRENCY,
    },
  );

  assert.deepEqual(normalized.requiredPrerequisites, [
    {
      type: "npc_detail",
      npcId: "npc_lira",
    },
  ]);
});

test("normalizeRouterDecision canonicalizes legacy npc scene refs onto actor-native sceneActors", () => {
  const normalized = aiProviderTestUtils.normalizeRouterDecision(
    {
      profile: "local",
      confidence: "high",
      authorizedVectors: ["converse"],
      requiredPrerequisites: [],
      reason: "The player addresses Mira directly.",
      clarification: {
        needed: false,
        blocker: null,
        question: null,
        options: [],
      },
      attention: {
        primaryIntent: "Talk to Mira.",
        resolvedReferents: [
          {
            phrase: "Mira",
            targetRef: "npc:npc_mira",
            targetKind: "scene_actor",
            confidence: "high",
          },
        ],
        unresolvedReferents: [],
        impliedDestinationFocus: null,
        mustCheck: ["sceneActors"],
      },
    },
    {
      currentLocation: {
        id: "loc_market",
        name: "Lantern Market",
        type: "district",
        summary: "Awning-covered stalls and morning foot traffic.",
        state: "busy",
      },
      sceneFocus: null,
      adjacentRoutes: [],
      sceneActors: [
        {
          actorRef: "actor:actor_npc_mira",
          actorId: "actor_npc_mira",
          profileNpcId: "npc_mira",
          kind: "npc",
          displayLabel: "Mira Brightstone",
          role: "baker",
          detailFetchHint: null,
          lastSummary: "She keeps bread warm beneath clean cloth.",
        },
      ],
      recentLocalEvents: [],
      recentTurnLedger: [],
      discoveredInformation: [],
      activePressures: [],
      activeThreads: [],
      inventory: [],
      worldObjects: [],
      sceneAspects: [],
      currency: TEST_CURRENCY,
    },
  );

  assert.equal(normalized.attention.resolvedReferents[0]?.targetRef, "actor:actor_npc_mira");
});

test("normalizeRouterDecision keeps explicit named offscreen locals bound as known_npc targets", () => {
  const normalized = aiProviderTestUtils.normalizeRouterDecision(
    {
      profile: "local",
      confidence: "high",
      authorizedVectors: ["investigate", "converse"],
      requiredPrerequisites: [
        {
          type: "npc_detail",
          npcId: "npc:camp_1:npc:tarn_blackthorn",
        },
      ],
      reason: "The player is explicitly looking for Tarn in the alley.",
      clarification: {
        needed: false,
        blocker: null,
        question: null,
        options: [],
      },
      attention: {
        primaryIntent: "Find Tarn Blackthorn without substituting another local.",
        resolvedReferents: [
          {
            phrase: "Tarn Blackthorn",
            targetRef: "Tarn Blackthorn",
            targetKind: "known_npc",
            confidence: "high",
          },
        ],
        unresolvedReferents: [],
        impliedDestinationFocus: {
          key: "deep_alley",
          label: "Deep Alley",
        },
        mustCheck: ["sceneActors", "knownNpcs", "fetchedFacts"],
      },
    },
    {
      currentLocation: {
        id: "loc_waterdeep",
        name: "Waterdeep",
        type: "city",
        summary: "A city of crowded wards and shadowed lanes.",
        state: "busy",
      },
      sceneFocus: {
        key: "deep_alley",
        label: "Deep Alley",
      },
      adjacentRoutes: [],
      sceneActors: [],
      knownNearbyNpcs: [
        {
          id: "camp_1:npc:tarn_blackthorn",
          name: "Tarn Blackthorn",
          role: "Street Urchin",
          summary: "A quick-fingered orphan who knows the Market Square's shadows.",
          requiresDetailFetch: false,
        },
      ],
      recentLocalEvents: [],
      recentTurnLedger: [],
      discoveredInformation: [],
      activePressures: [],
      activeThreads: [],
      inventory: [],
      worldObjects: [],
      sceneAspects: [],
      currency: TEST_CURRENCY,
    },
  );

  assert.deepEqual(normalized.requiredPrerequisites, [
    {
      type: "npc_detail",
      npcId: "camp_1:npc:tarn_blackthorn",
    },
  ]);
  assert.deepEqual(normalized.attention.resolvedReferents, [
    {
      phrase: "Tarn Blackthorn",
      targetRef: "camp_1:npc:tarn_blackthorn",
      targetKind: "known_npc",
      confidence: "high",
    },
  ]);
});

test("normalizeRouterDecision repairs malformed scoped known_npc ids against authoritative nearby candidates", () => {
  const normalized = aiProviderTestUtils.normalizeRouterDecision(
    {
      profile: "local",
      confidence: "high",
      authorizedVectors: ["converse"],
      requiredPrerequisites: [
        {
          type: "npc_detail",
          npcId: "camp_16e23ba8-ef87-4b6e-a3c3-9c78afcf784f:npc:npc_local_5",
        },
      ],
      reason: "Talk to Tarn.",
      clarification: {
        needed: false,
        blocker: null,
        question: null,
        options: [],
      },
      attention: {
        primaryIntent: "Offer Tarn food and reassurance.",
        resolvedReferents: [
          {
            phrase: "Tarn",
            targetRef: "camp_16e23ba8-ef87-4b6e-a3c3-9c78afcf784f:npc:npc_local_5",
            targetKind: "known_npc",
            confidence: "high",
          },
        ],
        unresolvedReferents: [],
        impliedDestinationFocus: null,
        mustCheck: ["knownNpcs", "fetchedFacts"],
      },
    },
    {
      currentLocation: {
        id: "loc_waterdeep",
        name: "Waterdeep",
        type: "city",
        summary: "A city of crowded wards and shadowed lanes.",
        state: "busy",
      },
      sceneFocus: {
        key: "deep_alley",
        label: "Deep Alley",
      },
      adjacentRoutes: [],
      sceneActors: [],
      knownNearbyNpcs: [
        {
          id: "camp_16e23ba8-ef87-4b6e-a7c3-9c78afcf784f:npc:npc_local_5",
          name: "Tarn Blackthorn",
          role: "Street Urchin",
          summary: "A quick-fingered orphan who knows the Market Square's shadows.",
          requiresDetailFetch: false,
        },
      ],
      recentLocalEvents: [],
      recentTurnLedger: [],
      discoveredInformation: [],
      activePressures: [],
      activeThreads: [],
      inventory: [],
      worldObjects: [],
      sceneAspects: [],
      currency: TEST_CURRENCY,
    },
  );

  assert.deepEqual(normalized.requiredPrerequisites, [
    {
      type: "npc_detail",
      npcId: "camp_16e23ba8-ef87-4b6e-a7c3-9c78afcf784f:npc:npc_local_5",
    },
  ]);
  assert.deepEqual(normalized.attention.resolvedReferents, [
    {
      phrase: "Tarn",
      targetRef: "camp_16e23ba8-ef87-4b6e-a7c3-9c78afcf784f:npc:npc_local_5",
      targetKind: "known_npc",
      confidence: "high",
    },
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

test("parseFinalActionToolCall accepts numeric character progression updates", () => {
  const parsed = aiProviderTestUtils.parseFinalActionToolCall({
    type: "resolve_mechanics",
    timeMode: "exploration",
    suggestedActions: ["Steady yourself"],
    mutations: [
      {
        type: "update_character_progression_track",
        trackId: "abyssal_assimilation",
        mode: "add",
        value: 2,
        reason: "Abyssal exposure deepens the alteration.",
      },
    ],
  });

  assert.equal(parsed.success, true);
});

test("parseFinalActionToolCall rejects invalid character progression update modes", () => {
  const parsed = aiProviderTestUtils.parseFinalActionToolCall({
    type: "resolve_mechanics",
    timeMode: "exploration",
    suggestedActions: ["Steady yourself"],
    mutations: [
      {
        type: "update_character_progression_track",
        trackId: "abyssal_assimilation",
        mode: "multiply",
        value: 2,
        reason: "Invalid arithmetic mode.",
      },
    ],
  });

  assert.equal(parsed.success, false);
});

test("parseFinalActionToolCall rejects negative character progression update values", () => {
  const parsed = aiProviderTestUtils.parseFinalActionToolCall({
    type: "resolve_mechanics",
    timeMode: "exploration",
    suggestedActions: ["Steady yourself"],
    mutations: [
      {
        type: "update_character_progression_track",
        trackId: "abyssal_assimilation",
        mode: "subtract",
        value: -2,
        reason: "Invalid negative progression amount.",
      },
    ],
  });

  assert.equal(parsed.success, false);
});

test("parseFinalActionToolCall rejects invalid dynamic approach ids", () => {
  const parsed = aiProviderTestUtils.parseFinalActionToolCall(
    {
      type: "resolve_mechanics",
      timeMode: "exploration",
      suggestedActions: ["Hold the bluff"],
      checkIntent: {
        type: "challenge",
        reason: "Keep your footing in the negotiation",
        approachId: "force",
      },
      mutations: [
        {
          type: "advance_time",
          durationMinutes: 5,
        },
      ],
    },
    ["sway", "scan"],
  );

  assert.equal(parsed.success, false);
});

test("parseFinalActionToolCall accepts execute_fast_forward payloads", () => {
  const parsed = aiProviderTestUtils.parseFinalActionToolCall({
    type: "execute_fast_forward",
    requestedDurationMinutes: 4320,
    routineSummary: "You settle into a quiet three-day routine at the stable.",
    recurringActivities: ["tend Safra", "help with tack repairs"],
    intendedOutcomes: ["earn the stablemaster's trust"],
    resourceCosts: {
      currencyCp: 45,
      itemRemovals: [
        {
          templateId: "item_oats",
          quantity: 1,
        },
      ],
    },
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

test("parseFinalActionToolCall hoists misplaced legacy checkIntent pseudo-mutations", () => {
  const parsed = aiProviderTestUtils.parseFinalActionToolCall({
    type: "resolve_mechanics",
    timeMode: "exploration",
    suggestedActions: ["Keep talking"],
    mutations: [
      {
        type: "checkIntent",
        reason: "Press the guard for an answer",
        challengeApproach: "influence",
        citedNpcId: "npc_guard",
        mode: "normal",
      },
      {
        type: "record_npc_interaction",
        npcId: "npc_guard",
        interactionSummary: "You hold the guard's attention while he weighs your request.",
        socialOutcome: "hesitates",
        phase: "conditional",
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
  assert.deepEqual(parsed.data.checkIntent, {
    type: "challenge",
    reason: "Press the guard for an answer",
    challengeApproach: "influence",
    citedNpcId: "npc_guard",
    mode: "normal",
  });
  assert.equal(parsed.data.mutations.length, 1);
  assert.equal(parsed.data.mutations[0]?.type, "record_npc_interaction");
  assert.equal(parsed.data.mutations[0]?.socialOutcome, "hesitates");
});

test("parseFinalActionToolCall rejects removed legacy monolithic action payloads", () => {
  const parsed = aiProviderTestUtils.parseFinalActionToolCall({
    type: "execute_converse",
    interlocutor: "Gate Guard",
    topic: "gate trouble",
  });

  assert.equal(parsed.success, false);
});

test("parseFinalActionToolCall rejects interaction mutations missing socialOutcome", () => {
  const parsed = aiProviderTestUtils.parseFinalActionToolCall({
    type: "resolve_mechanics",
    timeMode: "exploration",
    suggestedActions: ["Keep talking"],
    mutations: [
      {
        type: "record_npc_interaction",
        npcId: "npc_guard",
        interactionSummary: "You keep the guard talking while he considers the question.",
      },
    ],
  });

  assert.equal(parsed.success, false);
});

test("parseFinalActionToolCall rejects invalid socialOutcome values", () => {
  const parsed = aiProviderTestUtils.parseFinalActionToolCall({
    type: "resolve_mechanics",
    timeMode: "exploration",
    suggestedActions: ["Keep talking"],
    mutations: [
      {
        type: "record_local_interaction",
        localEntityId: "spawn:customer_1",
        interactionSummary: "The customer gives you a noncommittal shrug.",
        socialOutcome: "neutral",
      },
    ],
  });

  assert.equal(parsed.success, false);
});

test("parseFinalActionToolCall rejects environmental item spawns missing holder", () => {
  const parsed = aiProviderTestUtils.parseFinalActionToolCall({
    type: "resolve_mechanics",
    timeMode: "exploration",
    suggestedActions: ["Grab the basin"],
    mutations: [
      {
        type: "spawn_environmental_item",
        spawnKey: "wash_basin",
        itemName: "Wash Basin",
        description: "A copper basin by the bath.",
        quantity: 1,
        reason: "The basin is close at hand.",
      },
    ],
  });

  assert.equal(parsed.success, false);
});

test("buildTurnSystemPrompt hard-locks observe mode away from fast-forward output", () => {
  const prompt = aiProviderTestUtils.buildTurnSystemPrompt("observe");

  assert.match(prompt, /resolve_mechanics, execute_fast_forward, or request_clarification/);
  assert.match(prompt, /never use it for a single scene or ordinary short observation/i);
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
  assert.match(prompt, /checkIntent is a top-level field on resolve_mechanics, not a mutation/);
  assert.match(prompt, /Only set citedNpcId when the player is directly engaging that NPC on-screen this turn/);
  assert.match(prompt, /For notice\/analyze\/search\/listen turns that use checkIntent, any newly noticed actor, clue, item, or scene detail must be phase conditional/);
  assert.match(prompt, /Never use placeholder ids like none, null, unknown, or n\/a for citedNpcId, targetNpcId, localEntityId, or spawn references/);
  assert.match(prompt, /Use only bounded mutations/);
  assert.match(prompt, /The engine will reject them automatically on failure or partial success/);
  assert.match(prompt, /Mark resource costs, fees, and other upfront expenditures as phase immediate/);
  assert.match(prompt, /Mark success-only rewards or outcomes as phase conditional/);
  assert.match(prompt, /Use commit_market_trade only for strict commodity trade backed by fetched market prices/);
  assert.match(prompt, /Use spawn_fiat_item to instantiate bespoke narrative goods directly into a valid holder/);
  assert.match(prompt, /Use sceneActors\.actorRef values exactly only for actorRef fields/);
  assert.match(prompt, /For npcId, citedNpcId, and targetNpcId fields, use the bare NPC id without the npc: prefix/);
  assert.match(prompt, /Use record_local_interaction for current-scene unnamed locals instead of adjust_relationship/);
  assert.match(prompt, /Use record_actor_interaction for ordinary same-scene dialogue with a grounded embodied actor/);
  assert.match(prompt, /Fetched npc_detail for a named NPC is sufficient grounding for identity, memory, and bare npc ids, but it is not physical presence/i);
  assert.match(prompt, /Use record_actor_interaction for grounded named NPCs and other embodied scene actors who are immediate scene actors now or are explicitly brought into the scene this turn/i);
  assert.match(prompt, /nearby-but-offscreen/i);
  assert.match(prompt, /Every record_local_interaction, record_actor_interaction, and record_npc_interaction mutation must include socialOutcome/);
  assert.match(prompt, /Choose the most specific valid socialOutcome available/);
  assert.match(prompt, /acknowledges is the only low-intensity fallback outcome/i);
  assert.match(prompt, /interactionSummary must stay unresolved and must not close a decision, agreement, invitation, or emotional resolution/i);
  assert.match(prompt, /Do not describe physical movement, arrivals, departures, returns, repositioning, or new blocking in interactionSummary/i);
  assert.match(prompt, /Never use record_local_interaction with npc:, actor:, or named sceneActors/);
  assert.match(prompt, /Never invent temp: ids/i);
  assert.match(prompt, /When speaking to a named on-screen NPC, use record_actor_interaction for ordinary dialogue/);
  assert.match(prompt, /If economy_light is active and a bespoke trade is actually agreed upon, resolve it immediately with composed asset mutations/);
  assert.match(prompt, /Use execute_fast_forward only when the player explicitly asks to compress multiple days or weeks into a routine montage/);
  assert.match(prompt, /execute_fast_forward carries aggregate upkeep only\. It must not contain scene mutations/i);
  assert.match(prompt, /pending_trade_offer/);
  assert.match(prompt, /Use spawn_temporary_actor before record_local_interaction/);
  assert.match(prompt, /do not redirect them to a named scene actor; spawn_temporary_actor first/i);
  assert.match(prompt, /If the player is looting, pickpocketing, frisking, searching a body's belongings, or otherwise acting on a grounded NPC's custody, request npc_detail first/i);
  assert.match(prompt, /When fetched npc_detail exposes grounded held items or commodity stacks on an NPC, use transfer_assets from that NPC holder/i);
  assert.match(prompt, /willing NPC or temporary-actor exchange/i);
  assert.match(prompt, /record_local_interaction, record_actor_interaction, and record_npc_interaction alone never finalize custody or consumption/i);
  assert.match(prompt, /Do not leave the item in player custody while narrating that someone else now has it/i);
  assert.match(prompt, /asks what to call them, who they are, or another identity-seeking follow-up, request npc_detail for that actor/i);
  assert.match(prompt, /Use spawn_environmental_item before adjust_inventory/);
  assert.match(prompt, /spawn_environmental_item requires an explicit valid holder/i);
  assert.match(prompt, /Respect context\.authoritativeState\.worldObjects mechanical state such as isLocked and requiredKeyTemplateId/i);
  assert.match(prompt, /Use set_scene_actor_presence whenever someone leaves the current scene/);
  assert.match(prompt, /comes back later in the turn, represent that mechanically with set_scene_actor_presence/);
  assert.match(prompt, /Use set_player_scene_focus for self-directed movement within the current location/);
  assert.match(prompt, /same venue or social space/i);
  assert.match(prompt, /grounded actor:<actorId> sceneActors\.actorRef; use npc:<npcId> only as a compatibility fallback/i);
  assert.match(prompt, /label must describe a spatial sub-location or zone/);
  assert.match(prompt, /never a portable object like Coin Purse or Sword/);
  assert.match(prompt, /Never use it to simulate the player arriving somewhere/);
  assert.match(prompt, /Do not use it for solo errands, checking your own gear, retrieving your own belongings/);
  assert.match(prompt, /TRIVIAL ACTIONS: Checking personal inventory, reviewing known information, or looking around a safe room requires ZERO checks/);
  assert.match(prompt, /ID HALLUCINATION BAN: You are strictly forbidden from using discover_information unless the exact informationId is explicitly provided/);
  assert.match(prompt, /For adjust_inventory, use the inventory line's main template\/stack id/i);
  assert.match(prompt, /Use adjust_inventory for gaining, losing, consuming, or handing over grounded inventory items/);
  assert.match(prompt, /Self-directed downtime work may use adjust_inventory, spawn_environmental_item, and spawn_scene_aspect/);
  assert.match(prompt, /Use spawn_scene_aspect for smoke, damage, noise/);
  assert.ok(!/Fetched npc_detail for a named NPC is sufficient grounding for record_npc_interaction, adjust_relationship, and checkIntent npc ids even if that NPC is not currently listed in sceneActors/i.test(prompt));
});

test("buildTurnRouterSystemPrompt distinguishes self-talk from on-screen social commitment", () => {
  const prompt = aiProviderTestUtils.buildTurnRouterSystemPrompt();

  assert.match(prompt, /Internal thoughts, mutters to yourself, and naming an item are not converse/);
  assert.match(prompt, /Directing a present subordinate or ally to pass along a message or fetch someone is a local in-scene action/);
  assert.match(prompt, /economy_light covers .*character-progression changes/i);
  assert.match(prompt, /Use clarification only for hard blockers/);
  assert.match(prompt, /Do not invent new ids or spawn handles/);
  assert.match(prompt, /router_context\.knownNearbyNpcs lists authoritative named NPCs in the current location/i);
  assert.match(prompt, /Fetched npc_detail grounds identity and memory for a named NPC, but it does not make them physically present in sceneActors/i);
  assert.match(prompt, /not immediate scene actors at this focus/i);
  assert.match(prompt, /If the player explicitly names or clearly searches for someone listed in knownNearbyNpcs, resolve them as known_npc/i);
  assert.match(prompt, /Treat recentNarrativeProse as style continuity only, not evidence of who is present/i);
  assert.match(prompt, /routes strictly means macro-travel leaving the current location node/);
  assert.match(prompt, /back to the forge, into the market, over to the bench/);
  assert.match(prompt, /emit attention\.impliedDestinationFocus/);
  assert.match(prompt, /Do not emit impliedDestinationFocus for macro travel between location nodes/);
  assert.match(prompt, /unresolvedReferents/);
  assert.match(prompt, /resolvedReferents\.targetRef must be an actual grounded ref from router_context/i);
  assert.match(prompt, /Never use schema words like temporary_actor, scene_actor, inventory_item, world_object, route, information, or location as targetRef values/i);
  assert.match(prompt, /Never remap an unresolved pronoun or stale narrated referent onto a different grounded actor/);
  assert.match(prompt, /recentGroundedHistory is memory, not authority/);
  assert.match(prompt, /Generic people like someone, passerby, customer, shopper, stranger, or interested local should remain unresolved temporary_actor referents/i);
  assert.match(prompt, /Do not remap a generic or unresolved person onto a named scene actor merely because one is present/i);
  assert.match(prompt, /If the player's noun exactly matches a present temporary actor's local role label/i);
  assert.match(prompt, /If one present scene actor is already the clear conversational counterpart/i);
  assert.match(prompt, /If a present scene actor is marked detail-fetch\(name\/identity available\) and the player asks for their name/i);
  assert.match(prompt, /Never request npc_detail for temp: actors or unnamed temporary locals/i);
  assert.match(prompt, /If the player is looting, pickpocketing, frisking, searching a body's belongings, or otherwise needs grounded custody detail from a present NPC, include npc_detail for that actor/i);
  assert.match(prompt, /Treat recentNarrativeProse as style continuity only, not evidence of who is present, what they carry, or what objects can be manipulated now/i);
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
      currency: { totalCp: 700, formatted: "7 gp" },
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
          inventory: [
            {
              kind: "item",
              id: "item_hook",
              name: "Hook Knife",
              description: "A short hooked knife with a tar-dark handle.",
              quantity: 1,
              instanceIds: ["iteminst_hook_1"],
              stateTags: [],
            },
          ],
          knownInformation: [],
          relationshipHistory: [],
          temporaryActorId: "temp_dockhand",
        },
        hydrationDraft: {
          name: null,
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
  assert.match(prompt.system, /\*\*Role\*\*/);
  assert.match(prompt.system, /Dungeon Master's prose voice/i);
  assert.match(prompt.system, /Licensed texture means sensory surface detail/i);
  assert.match(prompt.system, /Licensed texture never adds new actors/i);
  assert.match(prompt.system, /Never open by paraphrasing the player's action/i);
  assert.match(prompt.system, /If the player offers a flavorful hook/i);
  assert.match(prompt.system, /Include at least one concrete sensory, physical, or character detail/i);
  assert.match(prompt.system, /on truly thin turns, one short sentence of legible absence, pause, or passage is enough/i);
  assert.match(prompt.system, /Only use quoted dialogue if the player_action included spoken words/i);
  assert.match(prompt.system, /\*\*Turn-Type Heuristics\*\*/);
  assert.match(prompt.system, /Narrate arrival, not the journey/i);
  assert.match(prompt.system, /- Investigation \/ search: Narrate the act of looking/i);
  assert.match(prompt.system, /\*\*Anti-Patterns and Better Alternatives\*\*/);
  assert.match(prompt.system, /Instead of placeholders like standard choice, fresh items, a response, or their offer/i);
  assert.match(prompt.system, /\*\*Style Examples\*\*/);
  assert.match(prompt.system, /Example 1 - Routine local interaction:/);
  assert.match(prompt.system, /recentNarrativeProse is continuity only, not authority/i);
  assert.match(prompt.system, /Do not visually place, quote, or otherwise present a named NPC as being in the room unless they are listed in context\.authoritativeState\.sceneActors/i);
  assert.match(prompt.system, /Do not use elapsed time as a prompt to generate journey or travel description/i);
  assert.match(prompt.user, /authoritativeState/);
  assert.match(prompt.user, /recentGroundedHistory/);
});

test("buildResolvedTurnSuggestedActionsPrompt treats candidate suggestions as weak hints", () => {
  const prompt = aiProviderTestUtils.buildResolvedTurnSuggestedActionsPrompt({
    playerAction: "I carry the cloth into Thorn and Oak and finish the delivery.",
    promptContext: {
      currentLocation: {
        id: "loc_market",
        name: "Caravan Market",
        type: "district",
        summary: "Trade stalls and narrow storefronts.",
        state: "active",
      },
      adjacentRoutes: [],
      sceneActors: [
        {
          actorRef: "npc:npc_elias",
          kind: "npc",
          displayLabel: "Elias Thorn",
          role: "merchant",
          detailFetchHint: null,
          lastSummary: "Standing near the counter with his ledger open.",
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
      sceneFocus: {
        key: "thorn_oak_shop",
        label: "Thorn and Oak (Elias's Shop)",
      },
      sceneAspects: {
        sale_completed: {
          label: "Sale Completed",
          state: "Daleland weave broadcloth delivered, payment received, agreement fulfilled",
          duration: "scene",
          focusKey: "thorn_oak_shop",
        },
      },
      localTexture: null,
      globalTime: 480,
      timeOfDay: "afternoon",
      dayCount: 1,
      currency: TEST_RICH_CURRENCY,
    },
    fetchedFacts: [],
    stateCommitLog: [
      {
        kind: "mutation",
        mutationType: "adjust_currency",
        status: "applied",
        reasonCode: "currency_adjusted",
        summary: "You gain 8 gp, 5 sp.",
        metadata: {
          delta: { gp: 8, sp: 5 },
        },
      },
      {
        kind: "mutation",
        mutationType: "spawn_scene_aspect",
        status: "applied",
        reasonCode: "scene_aspect_spawned",
        summary: "sale_completed shifts to delivered and fulfilled.",
        metadata: {
          aspectKey: "sale_completed",
          state: "Daleland weave broadcloth delivered, payment received, agreement fulfilled",
        },
      },
    ],
    checkResult: null,
    candidateSuggestedActions: [
      "Ask Elias Thorn for directions to his shop",
      "Finalize the sale and collect remaining payment",
      "Browse Elias's shop for other trade goods",
    ],
  });

  assert.match(prompt.system, /candidate_suggested_actions are weak hints only/i);
  assert.match(prompt.system, /Never suggest re-finding, re-locating, or asking directions/i);
  assert.match(prompt.system, /Never suggest finalizing, collecting, or closing a payment or deal that the committed log already resolved/i);
  assert.match(prompt.user, /candidate_suggested_actions/);
  assert.match(prompt.user, /Browse Elias's shop for other trade goods/);
});

test("buildResolvedTurnSuggestedActionsPrompt includes committed context and consequences", () => {
  const prompt = aiProviderTestUtils.buildResolvedTurnSuggestedActionsPrompt({
    playerAction: "I ask the dockhand what changed overnight.",
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
      currency: TEST_CURRENCY,
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
    ],
    stateCommitLog: [
      {
        kind: "mutation",
        mutationType: "record_npc_interaction",
        status: "applied",
        reasonCode: "npc_interaction_recorded",
        summary: "The dockhand acknowledges the question but keeps one eye on the sealed pier.",
        metadata: {
          npcId: "npc_dockhand",
          socialOutcome: "acknowledges",
        },
      },
    ],
    checkResult: null,
    candidateSuggestedActions: ["Press for specifics"],
  });

  assert.match(prompt.user, /Blackwater Docks/);
  assert.match(prompt.user, /Pier Nine Closure/);
  assert.match(prompt.user, /state_commit_log/);
  assert.match(prompt.system, /Prefer nearby, scene-local follow-through/i);
  assert.match(prompt.system, /Return zero to four short concrete action strings/i);
});

test("buildResolvedTurnNarrationPrompt teaches montage framing for fast-forward turns", () => {
  const prompt = aiProviderTestUtils.buildResolvedTurnNarrationPrompt({
    playerAction: "We spend the next several days helping around the stable until something changes.",
    promptContext: {
      currentLocation: {
        id: "loc_stable",
        name: "South Stable",
        type: "stable",
        summary: "Hay, leather, and the damp warmth of horses.",
        state: "steady",
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
      globalTime: 600,
      timeOfDay: "morning",
      dayCount: 3,
    },
    fetchedFacts: [],
    stateCommitLog: [
      {
        kind: "mutation",
        mutationType: "advance_time",
        status: "applied",
        reasonCode: "fast_forward_executed",
        summary: "You settle into a quiet routine among the stalls and tack room.",
        metadata: {
          isFastForward: true,
          requestedDurationMinutes: 4320,
          committedDurationMinutes: 2880,
          interruptionReason: "A rider comes in hard from the north road.",
        },
      },
    ],
    narrationBounds: {
      committedAdvanceMinutes: 2880,
      isFastForward: true,
      interruptionReason: "A rider comes in hard from the north road.",
    },
    checkResult: null,
    suggestedActions: [],
    narrationHint: null,
  });

  assert.match(prompt.system, /Do not narrate minute-by-minute/i);
  assert.match(prompt.system, /Summarize the recurring activities in 2-4 sentences using montage language/i);
  assert.match(prompt.system, /A rider comes in hard from the north road\./i);
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

test("buildResolvedTurnNarrationPrompt treats socialOutcome metadata as immutable narration truth", () => {
  const prompt = aiProviderTestUtils.buildResolvedTurnNarrationPrompt({
    playerAction: "I offer Tarn the warm bath again.",
    promptContext: {
      currentLocation: {
        id: "loc_inn",
        name: "The Hearthside",
        type: "inn",
        summary: "A warm common room and narrow sleeping loft.",
        state: "settled",
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
      globalTime: 600,
      timeOfDay: "night",
      dayCount: 1,
    },
    fetchedFacts: [],
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
    suggestedActions: [],
  });

  assert.match(prompt.system, /socialOutcome is immutable truth/i);
  assert.match(prompt.system, /Do not soften declines into acceptance/i);
  assert.match(prompt.system, /Do not render acknowledges, hesitates, withholds, asks_question, redirects, resists, or withdraws as acceptance, invitation, agreement, or emotionally closed dialogue/i);
  assert.match(prompt.user, /socialOutcome/);
  assert.match(prompt.user, /declines/);
  assert.match(prompt.system, /Do not narrate completed item custody changes, consumption, gifting, feeding, storage, or item use by another holder unless state_commit_log includes the applied asset mutation/i);
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
      progression: {
        tracks: [
          {
            id: "abyssal_assimilation",
            label: "Abyssal Assimilation",
            value: 7,
            summary: "How deeply the abyss has altered the character.",
          },
        ],
        worldStanding: {
          effectiveTierLabel: "Early Kindled",
          relativeStanding: "Above ordinary laborers, nearing trained junior delvers.",
        },
      },
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
      currencyCp: 300,
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
        mustCheck: ["sceneActors", "currency"],
      },
    },
  });

  assert.ok(prompt.indexOf("<attention_packet>") < prompt.indexOf("<action>"));
  assert.match(prompt, /targetRef: npc:npc_mira/);
  assert.match(prompt, /mustCheck:/);
  assert.match(prompt, /You are in Lantern Market\. Your current focus\/position is: The Forge\./);
  assert.match(prompt, /Abyssal Assimilation/);
  assert.match(prompt, /Above ordinary laborers/);
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

test("narrationViolatesResolvedConstraints rejects first-person mirrored narration", () => {
  const violation = aiProviderTestUtils.narrationViolatesResolvedConstraints(
    {
      playerAction: "I catch their eye and offer the velvet.",
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
          summary: "customer enters the scene.",
          metadata: {},
        },
      ],
      checkResult: null,
      suggestedActions: [],
    },
    'A figure pauses at my stall, and I hold up the velvet. "Looking for something finer?"',
  );

  assert.match(violation ?? "", /must not mirror the player's first-person wording/i);
});

test("narrationViolatesResolvedConstraints rejects prose that does not address the player in second person", () => {
  const violation = aiProviderTestUtils.narrationViolatesResolvedConstraints(
    {
      playerAction: "I wait at the stall.",
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
      ],
      checkResult: null,
      suggestedActions: [],
    },
    "The market noise settles into a steady hush.",
  );

  assert.match(violation ?? "", /must address the player in second person/i);
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

test("buildResolvedTurnNarrationPrompt explicitly forbids mirrored first-person narration", () => {
  const prompt = aiProviderTestUtils.buildResolvedTurnNarrationPrompt({
    playerAction: "I greet the worker and ask for the stronger piece.",
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
    stateCommitLog: [],
    checkResult: null,
    suggestedActions: [],
  });

  assert.match(prompt.system, /Address the player as you\/your/i);
  assert.match(prompt.system, /do not mirror the player's first-person wording/i);
  assert.match(prompt.system, /using you\/your/i);
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
      mustCheck: ["currency", "currency", "inventory"],
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
  assert.deepEqual(normalized.attention.mustCheck, ["currency", "inventory"]);
});

test("normalizeRouterDecision converts placeholder scene-actor refs into unresolved temporary actors and drops placeholder inventory refs", () => {
  const normalized = aiProviderTestUtils.normalizeRouterDecision({
    profile: "local",
    confidence: "high",
    authorizedVectors: ["converse"],
    requiredPrerequisites: [],
    reason: "Handle the curious customer conservatively.",
    clarification: {
      needed: false,
      blocker: null,
      question: null,
      options: [],
    },
    attention: {
      primaryIntent: "Engage a curious customer with a sales pitch.",
      resolvedReferents: [
        {
          phrase: "curious customer",
          targetRef: "temporary_actor",
          targetKind: "scene_actor",
          confidence: "high",
        },
        {
          phrase: "roll of velvet",
          targetRef: "inventory_item",
          targetKind: "inventory_item",
          confidence: "high",
        },
      ],
      unresolvedReferents: [],
      impliedDestinationFocus: null,
      mustCheck: ["sceneActors", "inventory"],
    },
  });

  assert.deepEqual(normalized.attention.resolvedReferents, []);
  assert.deepEqual(normalized.attention.unresolvedReferents, [
    {
      phrase: "curious customer",
      intendedKind: "temporary_actor",
      confidence: "high",
    },
  ]);
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
      currency: { totalCp: 300, formatted: "3 gp" },
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
      currency: { totalCp: 300, formatted: "3 gp" },
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
    progression: {
      tracks: [
        {
          id: "abyssal_assimilation",
          label: "Abyssal Assimilation",
          value: 30,
          summary: "How deeply the abyss has altered the character.",
        },
      ],
      worldStanding: {
        effectiveTierLabel: "Early Kindled",
        relativeStanding: "Above ordinary laborers, nearing trained junior delvers.",
      },
    },
    worldObjects: [
      {
        id: "wobj_lockbox",
        name: "Iron Lockbox",
        summary: "A compact iron lockbox sits beneath the bench.",
        isLocked: true,
        requiredKeyTemplateId: "item_lockbox_key",
        isHidden: false,
      },
    ],
    sceneAspects: [
      {
        key: "forge_heat",
        label: "Forge Heat",
        state: "The forge is roaring hot and ready for another long work session.",
        duration: "scene",
      },
    ],
    currency: { totalCp: 300, formatted: "3 gp" },
  });

  assert.equal(rendered.locationOrientation, "You are in Waterdeep. Your current focus/position is: The Forge.");
  assert.deepEqual(rendered.authoritativeState.inventory, ["coin purse (qty 1) [item_coin_purse]"]);
  assert.deepEqual(
    rendered.authoritativeState.worldObjects,
    ["Iron Lockbox [wobj_lockbox] {locked, key:item_lockbox_key} - A compact iron lockbox sits beneath the bench."],
  );
  assert.deepEqual(rendered.authoritativeState.routes, ["Neverwinter (720m, open, danger 2) [route_neverwinter]"]);
  assert.equal(rendered.authoritativeState.characterProgression?.tracks[0]?.label, "Abyssal Assimilation");
  assert.match(
    rendered.authoritativeState.sceneActors[0] ?? "",
    /Captain Thorne \(watch captain\) \[npc:npc_captain_thorne, npc detail-fetch\(name\/identity available\)\]/,
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
  assert.match(prompt.system, /Unresolved targets must stay unresolved and may not be substituted/i);
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
      mutations: [{
        type: "move_player",
        targetLocationId: "loc_market",
        relocationReason: "forced_transport",
      }],
    }),
    false,
  );
});
