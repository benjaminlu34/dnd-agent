import assert from "node:assert/strict";
import test from "node:test";
import type {
  CampaignSnapshot,
  ExecuteCombatToolCall,
  ExecuteConverseToolCall,
  ExecuteFreeformToolCall,
  ExecuteInvestigateToolCall,
  ExecuteObserveToolCall,
  ExecuteRestToolCall,
  ExecuteSceneInteractionToolCall,
  ExecuteTradeToolCall,
  ExecuteTravelToolCall,
  RouterClassification,
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
      charisma: 0,
      maxHealth: 12,
      backstory: null,
      starterItems: [],
      stats: {
        strength: 1,
        dexterity: 2,
        constitution: 1,
        intelligence: 0,
        wisdom: 2,
        charisma: 0,
      },
      health: 12,
      gold: 0,
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
        dominantActivities: ["gate inspections", "portering", "fish hauling"],
        classTexture: "Rain-soaked laborers and tired watch patrols.",
        publicHazards: ["slick stones", "crowded carts"],
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
        id: "npc_guide",
        name: "Tarin Ash",
        role: "guide",
        summary: "Local guide.",
        description: "Quick-footed guide.",
        socialLayer: "anchor",
        isNarrativelyHydrated: true,
        factionId: null,
        factionName: null,
        currentLocationId: "loc_gate",
        approval: 2,
        approvalBand: "warm",
        isCompanion: true,
        state: "active",
        threatLevel: 1,
      },
    ],
    knownFactions: [
      {
        id: "fac_watch",
        name: "Watch",
        type: "military",
        summary: "City watch.",
        agenda: "Hold the city.",
        pressureClock: 3,
      },
    ],
    factionRelations: [],
    localInformation: [
      {
        id: "info_1",
        title: "The watch is stretched thin",
        summary: "The watch is reacting instead of controlling.",
        accessibility: "public",
        truthfulness: "true",
        locationId: "loc_gate",
        locationName: "Ash Gate",
        factionId: "fac_watch",
        factionName: "Watch",
        sourceNpcId: null,
        sourceNpcName: null,
        isDiscovered: true,
        expiresAtTime: null,
      },
    ],
    discoveredInformation: [
      {
        id: "info_1",
        title: "The watch is stretched thin",
        summary: "The watch is reacting instead of controlling.",
        accessibility: "public",
        truthfulness: "true",
        locationId: "loc_gate",
        locationName: "Ash Gate",
        factionId: "fac_watch",
        factionName: "Watch",
        sourceNpcId: null,
        sourceNpcName: null,
        isDiscovered: true,
        expiresAtTime: null,
      },
    ],
    connectedLeads: [],
    temporaryActors: [],
    memories: [],
    activePressures: [],
    recentWorldShifts: [],
    activeThreads: [],
    recentMessages: [],
    canRetryLatestTurn: false,
  };
}

function createMarketFacts(): TurnFetchToolResult[] {
  return [
    {
      type: "fetch_market_prices",
      result: [
        {
          marketPriceId: "mp_spice_gate",
          commodityId: "commodity_spice",
          commodityName: "Spice",
          baseValue: 5,
          modifier: 1,
          price: 5,
          stock: 10,
          legalStatus: "legal",
          vendorNpcId: null,
          vendorNpcName: null,
          locationId: "loc_gate",
          locationName: "Ash Gate",
          restockTime: null,
        },
      ],
    },
  ];
}

function createRouterClassification(
  authorizedCommitments: RouterClassification["authorizedCommitments"],
): RouterClassification {
  return {
    profile: "local",
    confidence: "high",
    authorizedCommitments,
    reason: "test fixture",
  };
}

test("validateTurnCommand enforces travel adjacency and exact route time", () => {
  const command: ExecuteTravelToolCall = {
    type: "execute_travel",
    routeEdgeId: "edge_gate_market",
    targetLocationId: "loc_market",
    narration: "You head to the market.",
    suggestedActions: ["Observe the market"],
    timeMode: "travel",
    citedEntities: {
      npcIds: [],
      locationIds: ["loc_gate", "loc_market"],
      factionIds: [],
      commodityIds: [],
      informationIds: [],
    },
  };

  const validated = validateTurnCommand({
    snapshot: createSnapshot(),
    command,
  });

  assert.equal(validated.type, "execute_travel");
  assert.equal(validated.timeElapsed, 15);
});

test("validateTurnCommand rejects freeform without intendedMechanicalOutcome", () => {
  const command: ExecuteFreeformToolCall = {
    type: "execute_freeform",
    actionDescription: "Kick the brazier into the alley",
    timeMode: "exploration",
    challengeApproach: "force",
    durationMagnitude: "brief",
    intendedMechanicalOutcome: "",
    narration: "You lunge for the brazier.",
    suggestedActions: ["Press forward"],
    citedEntities: {
      npcIds: [],
      locationIds: ["loc_gate"],
      factionIds: [],
      commodityIds: [],
      informationIds: [],
    },
  };

  assert.throws(
    () =>
      validateTurnCommand({
        snapshot: createSnapshot(),
        command,
      }),
    /intendedMechanicalOutcome/,
  );
});

test("validateTurnCommand accepts converse actions aimed at an unnamed local", () => {
  const command: ExecuteConverseToolCall = {
    type: "execute_converse",
    interlocutor: "nearest porter",
    topic: "what happened at the gate",
    narration: "A nearby porter lowers his voice and tells you the watch has been overwhelmed since dawn.",
    suggestedActions: ["Ask who started the trouble"],
    timeMode: "exploration",
    durationMagnitude: "brief",
    citedEntities: {
      npcIds: [],
      locationIds: ["loc_gate"],
      factionIds: ["fac_watch"],
      commodityIds: [],
      informationIds: ["info_1"],
    },
  };

  const validated = validateTurnCommand({
    snapshot: createSnapshot(),
    command,
  });

  assert.equal(validated.type, "execute_converse");
  assert.equal(validated.interlocutor, "nearest porter");
  assert.equal(validated.npcId, undefined);
});

test("validateTurnCommand rejects unnamed locals that collide with a present NPC name", () => {
  const command: ExecuteConverseToolCall = {
    type: "execute_converse",
    interlocutor: "  tarin   ash ",
    topic: "what happened at the gate",
    narration: "You hail the same name without actually targeting the guide.",
    suggestedActions: ["Be more specific"],
    timeMode: "exploration",
    durationMagnitude: "brief",
    citedEntities: {
      npcIds: [],
      locationIds: ["loc_gate"],
      factionIds: [],
      commodityIds: [],
      informationIds: [],
    },
  };

  assert.throws(
    () =>
      validateTurnCommand({
        snapshot: createSnapshot(),
        command,
      }),
    /present NPC's name/,
  );
});

test("validateTurnCommand rejects direct actions against pending promoted NPCs without fetched detail", () => {
  const snapshot = createSnapshot();
  snapshot.presentNpcs.push({
    id: "npc_local_bartender",
    name: "Dock Bartender",
    role: "bartender",
    summary: "A recurring local behind the dockside taproom.",
    description: "A recurring local known as the bartender.",
    socialLayer: "promoted_local",
    isNarrativelyHydrated: false,
    factionId: null,
    factionName: null,
    currentLocationId: "loc_gate",
    approval: 0,
    approvalBand: "neutral",
    isCompanion: false,
    state: "active",
    threatLevel: 1,
  });

  const command: ExecuteCombatToolCall = {
    type: "execute_combat",
    targetNpcId: "npc_local_bartender",
    approach: "subdue",
    narration: "You lunge over the bar and try to pin the bartender down.",
    suggestedActions: ["Demand answers"],
    timeMode: "combat",
    durationMagnitude: "brief",
    citedEntities: {
      npcIds: ["npc_local_bartender"],
      locationIds: ["loc_gate"],
      factionIds: [],
      commodityIds: [],
      informationIds: [],
    },
  };

  assert.throws(
    () =>
      validateTurnCommand({
        snapshot,
        command,
        fetchedFacts: [],
      }),
    /must be fetched/,
  );
});

test("validateTurnCommand allows direct NPC actions after hydrated fetch detail", () => {
  const snapshot = createSnapshot();
  snapshot.presentNpcs.push({
    id: "npc_local_bartender",
    name: "Dock Bartender",
    role: "bartender",
    summary: "A recurring local behind the dockside taproom.",
    description: "A recurring local known as the bartender.",
    socialLayer: "promoted_local",
    isNarrativelyHydrated: false,
    factionId: null,
    factionName: null,
    currentLocationId: "loc_gate",
    approval: 0,
    approvalBand: "neutral",
    isCompanion: false,
    state: "active",
    threatLevel: 1,
  });

  const command: ExecuteInvestigateToolCall = {
    type: "execute_investigate",
    targetType: "npc",
    targetId: "npc_local_bartender",
    method: "read his tells while he pours",
    narration: "You study the bartender's reactions while he keeps his hands busy on the taps.",
    suggestedActions: ["Press on the smuggling rumor"],
    timeMode: "exploration",
    durationMagnitude: "brief",
    citedEntities: {
      npcIds: ["npc_local_bartender"],
      locationIds: ["loc_gate"],
      factionIds: [],
      commodityIds: [],
      informationIds: [],
    },
  };
  const fetchedFacts: TurnFetchToolResult[] = [
    {
      type: "fetch_npc_detail",
      result: {
        ...snapshot.presentNpcs[1],
        isNarrativelyHydrated: true,
        knownInformation: [],
        relationshipHistory: [],
        temporaryActorId: "temp_1",
      },
    },
  ];

  const validated = validateTurnCommand({
    snapshot,
    command,
    fetchedFacts,
  });

  assert.equal(validated.type, "execute_investigate");
  assert.equal(validated.targetId, "npc_local_bartender");
});

test("validateTurnCommand rejects converse actions without npcId or interlocutor", () => {
  const command: ExecuteConverseToolCall = {
    type: "execute_converse",
    interlocutor: "   ",
    topic: "what happened at the gate",
    narration: "Silence follows your question.",
    suggestedActions: ["Ask someone else"],
    timeMode: "exploration",
    durationMagnitude: "brief",
    citedEntities: {
      npcIds: [],
      locationIds: ["loc_gate"],
      factionIds: [],
      commodityIds: [],
      informationIds: [],
    },
  };

  assert.throws(
    () =>
      validateTurnCommand({
        snapshot: createSnapshot(),
        command,
      }),
    /interlocutor/,
  );
});

test("validateTurnCommand enforces engine-owned rest duration even if a payload smuggles its own minutes", () => {
  const command = {
    type: "execute_rest",
    restType: "light",
    narration: "You try to squeeze in a short rest.",
    suggestedActions: ["Wake up early"],
    timeMode: "rest",
    timeElapsed: 120,
    citedEntities: {
      npcIds: [],
      locationIds: ["loc_gate"],
      factionIds: [],
      commodityIds: [],
      informationIds: [],
    },
  } as ExecuteRestToolCall & { timeElapsed: number };

  assert.throws(
    () =>
      validateTurnCommand({
        snapshot: createSnapshot(),
        command,
      }),
    /Rest time must be engine-owned/,
  );
});

test("validateTurnCommand rejects trade without fetched market detail", () => {
  const snapshot = createSnapshot();
  snapshot.character.gold = 20;

  const command: ExecuteTradeToolCall = {
    type: "execute_trade",
    action: "buy",
    marketPriceId: "mp_spice_gate",
    commodityId: "commodity_spice",
    quantity: 2,
    narration: "You buy two spice sacks for 10 gold.",
    suggestedActions: ["Ask who else is buying spice"],
    timeMode: "exploration",
    durationMagnitude: "brief",
    citedEntities: {
      npcIds: [],
      locationIds: ["loc_gate"],
      factionIds: [],
      commodityIds: [],
      informationIds: [],
    },
  };

  assert.throws(
    () =>
      validateTurnCommand({
        snapshot,
        command,
      }),
    /requires fetched market detail/,
  );
});

test("validateTurnCommand rejects trade commands that omit the traded commodity citation", () => {
  const snapshot = createSnapshot();
  snapshot.character.gold = 20;

  const command: ExecuteTradeToolCall = {
    type: "execute_trade",
    action: "buy",
    marketPriceId: "mp_spice_gate",
    commodityId: "commodity_spice",
    quantity: 2,
    narration: "You buy two spice sacks for 10 gold.",
    suggestedActions: ["Ask who else is buying spice"],
    timeMode: "exploration",
    durationMagnitude: "brief",
    citedEntities: {
      npcIds: [],
      locationIds: ["loc_gate"],
      factionIds: [],
      commodityIds: [],
      informationIds: [],
    },
  };

  assert.throws(
    () =>
      validateTurnCommand({
        snapshot,
        command,
        fetchedFacts: createMarketFacts(),
      }),
    /uncited_mechanical_entity/,
  );
});

test("validateTurnCommand accepts trade commands when market facts and commodity citations are present", () => {
  const snapshot = createSnapshot();
  snapshot.character.gold = 20;

  const command: ExecuteTradeToolCall = {
    type: "execute_trade",
    action: "buy",
    marketPriceId: "mp_spice_gate",
    commodityId: "commodity_spice",
    quantity: 2,
    narration: "You buy two spice sacks for 10 gold.",
    suggestedActions: ["Ask who else is buying spice"],
    timeMode: "exploration",
    durationMagnitude: "brief",
    citedEntities: {
      npcIds: [],
      locationIds: ["loc_gate"],
      factionIds: [],
      commodityIds: ["commodity_spice"],
      informationIds: [],
    },
  };

  const validated = validateTurnCommand({
    snapshot,
    command,
    fetchedFacts: createMarketFacts(),
  });

  assert.equal(validated.type, "execute_trade");
  assert.equal(validated.quantity, 2);
});

test("validateTurnCommand rejects freeform calls that are really typed trade or combat actions", () => {
  const command: ExecuteFreeformToolCall = {
    type: "execute_freeform",
    actionDescription: "Buy the spice sacks from the stall",
    timeMode: "exploration",
    challengeApproach: "influence",
    durationMagnitude: "brief",
    intendedMechanicalOutcome: "Purchase the spice and leave with the goods.",
    narration: "You start haggling for the spice sacks.",
    suggestedActions: ["Try a formal trade instead"],
    citedEntities: {
      npcIds: [],
      locationIds: ["loc_gate"],
      factionIds: [],
      commodityIds: [],
      informationIds: [],
    },
  };

  assert.throws(
    () =>
      validateTurnCommand({
        snapshot: createSnapshot(),
        command,
      }),
    /cannot replace typed combat or trade actions/,
  );
});

test("validateTurnCommand rejects travel commands that are really same-scene NPC approaches", () => {
  const command: ExecuteTravelToolCall = {
    type: "execute_travel",
    routeEdgeId: "edge_gate_market",
    targetLocationId: "loc_market",
    narration: "You walk over to Tarin and ask what changed at the gate.",
    suggestedActions: ["Ask what changed"],
    timeMode: "travel",
    citedEntities: {
      npcIds: ["npc_guide"],
      locationIds: ["loc_gate"],
      factionIds: [],
      commodityIds: [],
      informationIds: [],
    },
  };

  assert.throws(
    () =>
      validateTurnCommand({
        snapshot: createSnapshot(),
        command,
      }),
    /not execute_travel/,
  );
});

test("validateTurnCommand accepts low-commitment scene interaction with a present NPC", () => {
  const command: ExecuteSceneInteractionToolCall = {
    type: "execute_scene_interaction",
    targetType: "npc",
    targetId: "npc_guide",
    approach: "step over and see what Tarin is focused on",
    narration: "You drift over to Tarin's side and take in what has his attention. Rain beads on his cloak while carts rumble through the gate behind him.",
    suggestedActions: ["Ask what changed", "Keep watching the gate"],
    timeMode: "exploration",
    durationMagnitude: "brief",
    citedEntities: {
      npcIds: ["npc_guide"],
      locationIds: ["loc_gate"],
      factionIds: [],
      commodityIds: [],
      informationIds: [],
    },
  };

  const validated = validateTurnCommand({
    snapshot: createSnapshot(),
    command,
  });

  assert.equal(validated.type, "execute_scene_interaction");
  assert.equal(validated.timeElapsed, 10);
  assert.equal(validated.checkResult, undefined);
});

test("validateTurnCommand rejects scene interaction that encodes an explicit conversation", () => {
  const command: ExecuteSceneInteractionToolCall = {
    type: "execute_scene_interaction",
    targetType: "npc",
    targetId: "npc_guide",
    approach: "ask Tarin what changed at the gate",
    narration: "You ask Tarin what changed at the gate.",
    suggestedActions: ["Listen closely"],
    timeMode: "exploration",
    citedEntities: {
      npcIds: ["npc_guide"],
      locationIds: ["loc_gate"],
      factionIds: [],
      commodityIds: [],
      informationIds: [],
    },
  };

  assert.throws(
    () =>
      validateTurnCommand({
        snapshot: createSnapshot(),
        command,
      }),
    /cannot replace explicit conversation or negotiation/,
  );
});

test("validateTurnCommand rejects scene interaction that encodes explicit trade", () => {
  const command: ExecuteSceneInteractionToolCall = {
    type: "execute_scene_interaction",
    targetType: "location",
    targetId: "loc_gate",
    approach: "buy breakfast from the stall",
    narration: "You buy breakfast and tuck the loaf under your arm.",
    suggestedActions: ["Head back to the lane"],
    timeMode: "exploration",
    citedEntities: {
      npcIds: [],
      locationIds: ["loc_gate"],
      factionIds: [],
      commodityIds: [],
      informationIds: [],
    },
  };

  assert.throws(
    () =>
      validateTurnCommand({
        snapshot: createSnapshot(),
        command,
      }),
    /cannot replace typed trade or combat actions/,
  );
});

test("validateTurnCommand rejects first-person Dungeon Master narration", () => {
  const command: ExecuteSceneInteractionToolCall = {
    type: "execute_scene_interaction",
    targetType: "npc",
    targetId: "npc_guide",
    approach: "browse",
    narration: "I walk over to Tarin and look over his shoulder.",
    suggestedActions: ["Ask what changed"],
    timeMode: "exploration",
    citedEntities: {
      npcIds: ["npc_guide"],
      locationIds: ["loc_gate"],
      factionIds: [],
      commodityIds: [],
      informationIds: [],
    },
  };

  assert.throws(
    () =>
      validateTurnCommand({
        snapshot: createSnapshot(),
        command,
      }),
    /narration_voice_first_person/,
  );
});

test("validateTurnCommand rejects thin scene-forward narration", () => {
  const command: ExecuteSceneInteractionToolCall = {
    type: "execute_scene_interaction",
    targetType: "npc",
    targetId: "npc_guide",
    approach: "browse",
    narration: "You walk over to Tarin.",
    suggestedActions: ["Ask what changed"],
    timeMode: "exploration",
    citedEntities: {
      npcIds: ["npc_guide"],
      locationIds: ["loc_gate"],
      factionIds: [],
      commodityIds: [],
      informationIds: [],
    },
  };

  assert.throws(
    () =>
      validateTurnCommand({
        snapshot: createSnapshot(),
        command,
      }),
    /narration_too_thin/,
  );
});

test("validateTurnCommand rejects unauthorized trade based on router classification", () => {
  const snapshot = createSnapshot();
  snapshot.character.gold = 20;
  const command: ExecuteTradeToolCall = {
    type: "execute_trade",
    action: "buy",
    marketPriceId: "mp_spice_gate",
    commodityId: "commodity_spice",
    quantity: 2,
    narration: "You buy two spice sacks for 10 gold.",
    suggestedActions: ["Ask who else is buying spice"],
    timeMode: "exploration",
    citedEntities: {
      npcIds: [],
      locationIds: ["loc_gate"],
      factionIds: [],
      commodityIds: ["commodity_spice"],
      informationIds: [],
    },
  };

  assert.throws(
    () =>
      validateTurnCommand({
        snapshot,
        command,
        fetchedFacts: createMarketFacts(),
        routerClassification: createRouterClassification([]),
      }),
    /intent_overcommit_trade/,
  );
});

test("validateTurnCommand accepts authorized converse based on router classification", () => {
  const command: ExecuteConverseToolCall = {
    type: "execute_converse",
    npcId: "npc_guide",
    interlocutor: "Tarin Ash",
    topic: "what happened at the gate",
    narration: "Tarin lowers his voice and tells you the watch has been overwhelmed since dawn.",
    suggestedActions: ["Ask who moved first"],
    timeMode: "exploration",
    citedEntities: {
      npcIds: ["npc_guide"],
      locationIds: ["loc_gate"],
      factionIds: [],
      commodityIds: [],
      informationIds: [],
    },
  };

  const validated = validateTurnCommand({
    snapshot: createSnapshot(),
    command,
    routerClassification: createRouterClassification(["converse"]),
  });

  assert.equal(validated.type, "execute_converse");
});

test("validateTurnCommand rejects converse narration that only echoes the player's line", () => {
  const command: ExecuteConverseToolCall = {
    type: "execute_converse",
    npcId: "npc_guide",
    interlocutor: "Tarin Ash",
    topic: "greeting",
    narration: "You smile at Tarin. \"Hey Tarin, how've you been?\" you ask casually.",
    suggestedActions: ["Wait for his answer"],
    timeMode: "exploration",
    citedEntities: {
      npcIds: ["npc_guide"],
      locationIds: ["loc_gate"],
      factionIds: [],
      commodityIds: [],
      informationIds: [],
    },
  };

  assert.throws(
    () =>
      validateTurnCommand({
        snapshot: createSnapshot(),
        command,
        playerAction: "\"Hey Tarin, how've you been?\" I ask casually.",
      }),
    /narration_parroting_player_action/,
  );
});

test("validateTurnCommand leaves routine freeform actions checkless by default", () => {
  const command: ExecuteFreeformToolCall = {
    type: "execute_freeform",
    actionDescription: "Arrange the spidersilk bolts neatly across the center of the stall",
    timeMode: "downtime",
    challengeApproach: "finesse",
    durationMagnitude: "brief",
    intendedMechanicalOutcome: "Present the newest fabric attractively for browsing customers.",
    narration: "You spread the spidersilk where the dawn light catches it best.",
    suggestedActions: ["Call out the new arrival"],
    citedEntities: {
      npcIds: [],
      locationIds: ["loc_gate"],
      factionIds: [],
      commodityIds: [],
      informationIds: [],
    },
  };

  const validated = validateTurnCommand({
    snapshot: createSnapshot(),
    command,
  });

  assert.equal(validated.type, "execute_freeform");
  assert.equal(validated.checkResult, undefined);
});

test("validateTurnCommand requires a failure consequence for freeform checks", () => {
  const command: ExecuteFreeformToolCall = {
    type: "execute_freeform",
    actionDescription: "Slip through the crowd and palm the ledger from the guard's belt",
    timeMode: "exploration",
    challengeApproach: "finesse",
    durationMagnitude: "brief",
    requiresCheck: true,
    intendedMechanicalOutcome: "Steal the ledger without drawing attention.",
    narration: "You drift with the crowd and reach for the ledger at the right moment.",
    suggestedActions: ["Break off before anyone notices"],
    citedEntities: {
      npcIds: [],
      locationIds: ["loc_gate"],
      factionIds: [],
      commodityIds: [],
      informationIds: [],
    },
  };

  assert.throws(
    () =>
      validateTurnCommand({
        snapshot: createSnapshot(),
        command,
      }),
    /requires failureConsequence/,
  );
});

test("validateTurnCommand rolls a freeform check when requiresCheck is true", () => {
  const command: ExecuteFreeformToolCall = {
    type: "execute_freeform",
    actionDescription: "Slip through the crowd and palm the ledger from the guard's belt",
    timeMode: "exploration",
    challengeApproach: "finesse",
    durationMagnitude: "brief",
    requiresCheck: true,
    intendedMechanicalOutcome: "Steal the ledger without drawing attention.",
    failureConsequence: "The guard catches the motion and raises the alarm.",
    narration: "You drift with the crowd and reach for the ledger at the right moment.",
    suggestedActions: ["Break off before anyone notices"],
    citedEntities: {
      npcIds: [],
      locationIds: ["loc_gate"],
      factionIds: [],
      commodityIds: [],
      informationIds: [],
    },
  };

  const validated = validateTurnCommand({
    snapshot: createSnapshot(),
    command,
  });

  assert.equal(validated.type, "execute_freeform");
  assert.ok(validated.checkResult);
  assert.equal(validated.checkResult?.stat, "dexterity");
});

test("validateTurnCommand caps suggested actions at four items", () => {
  const command: ExecuteObserveToolCall = {
    type: "execute_observe",
    targetType: "location",
    targetId: "loc_gate",
    narration: "You watch the gate traffic shift under the rain. Wet wheels hiss over the stones while the next patrol squeezes past a knot of carts.",
    suggestedActions: [
      "Ask Tarin what changed",
      "Watch the carts longer",
      "Follow the next patrol",
      "Check the market road",
      "Count the signal fires",
    ],
    timeMode: "exploration",
    citedEntities: {
      npcIds: [],
      locationIds: ["loc_gate"],
      factionIds: [],
      commodityIds: [],
      informationIds: [],
    },
  };

  const validated = validateTurnCommand({
    snapshot: createSnapshot(),
    command,
  });

  if (validated.type === "request_clarification") {
    assert.fail("Expected observe command to validate without clarification.");
  }
  assert.equal(validated.suggestedActions.length, 4);
  assert.deepEqual(validated.suggestedActions, [
    "Ask Tarin what changed",
    "Watch the carts longer",
    "Follow the next patrol",
    "Check the market road",
  ]);
});
