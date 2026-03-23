import assert from "node:assert/strict";
import test from "node:test";
import type {
  CampaignSnapshot,
  ExecuteCombatToolCall,
  ExecuteConverseToolCall,
  ExecuteFreeformToolCall,
  ExecuteInvestigateToolCall,
  ExecuteRestToolCall,
  ExecuteTradeToolCall,
  ExecuteTravelToolCall,
  TurnFetchToolResult,
} from "./types";
import { validateTurnCommand } from "./validation";

function createSnapshot(): CampaignSnapshot {
  return {
    campaignId: "camp_1",
    sessionId: "sess_1",
    sessionTurnCount: 0,
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

test("validateTurnCommand enforces travel adjacency and exact route time", () => {
  const command: ExecuteTravelToolCall = {
    type: "execute_travel",
    routeEdgeId: "edge_gate_market",
    targetLocationId: "loc_market",
    narration: "You head to the market.",
    suggestedActions: ["Observe the market"],
    timeMode: "travel",
    timeElapsed: 15,
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
    statToCheck: "strength",
    timeMode: "exploration",
    estimatedTimeElapsedMinutes: 10,
    timeElapsed: 10,
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
    timeElapsed: 5,
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
    timeElapsed: 5,
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
    timeElapsed: 3,
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
    timeElapsed: 5,
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
    timeElapsed: 5,
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

test("validateTurnCommand rejects rest durations that are not engine-owned", () => {
  const command: ExecuteRestToolCall = {
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
  };

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
    timeElapsed: 5,
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
    timeElapsed: 5,
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
    timeElapsed: 5,
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
    statToCheck: "charisma",
    timeMode: "exploration",
    estimatedTimeElapsedMinutes: 10,
    timeElapsed: 10,
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
