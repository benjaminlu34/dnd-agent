import assert from "node:assert/strict";
import test from "node:test";
import { aiProviderTestUtils } from "../ai/provider";
import type { SpatialPromptContext } from "./types";

function createPromptContext(): SpatialPromptContext {
  return {
    currentLocation: {
      id: "loc_gate",
      name: "Ash Gate",
      type: "district",
      summary: "Arrival district.",
      state: "active",
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
        requiresDetailFetch: false,
      },
    ],
    recentUnnamedLocals: [
      {
        label: "nearest harvester",
        interactionCount: 2,
        lastSummary: "A soaked harvester who keeps watch on the tide line.",
        lastSeenAtTurn: 3,
      },
    ],
    recentLocalEvents: [
      {
        locationId: "loc_gate",
        id: "event_gate_watch",
        description: "Watch patrols keep doubling back through the gate.",
        triggerTime: 470,
        minutesAgo: 10,
      },
    ],
    recentTurnLedger: [
      "A dockhand warned that the watch is overwhelmed.",
    ],
    discoveredInformation: [
      {
        id: "info_1",
        title: "The watch is stretched thin",
        summary: "The watch is reacting instead of controlling.",
        truthfulness: "true",
      },
    ],
    activePressures: [],
    recentWorldShifts: [],
    activeThreads: [],
    inventory: [],
    localTexture: {
      dominantActivities: ["barge loading", "watch patrols", "fish sorting"],
      classTexture: "Wet, crowded labor traffic under watch scrutiny.",
      publicHazards: ["slick cobbles", "pushy port traffic"],
    },
    globalTime: 480,
    timeOfDay: "morning",
    dayCount: 1,
  };
}

test("extractToolInput repairs a clipped tool payload well enough to normalize the turn", () => {
  const response = {
    choices: [
      {
        finish_reason: "tool_calls",
        message: {
          tool_calls: [
            {
              type: "function",
              function: {
                name: "execute_converse",
                arguments:
                  "{\"npcId\":\"npc_guide\",\"topic\":\"gate trouble\",\"narration\":\"Tarin points toward the market and mutters that the watch is overwhelmed.\",\"suggestedActions\":[\"Ask who is in charge\"],\"timeMode\":\"exploration\",\"durationMagnitude\":\"brief\",\"citedEntities\":{\"npcIds\":[\"npc_guide\"],\"locationIds\":[\"loc_gate\"],\"factionIds\":[\"fac_watch\"],\"commodityIds\":[],\"informationIds\":[\"info_1\"]}",
              },
            },
          ],
          content: "",
        },
      },
    ],
  } as never;

  const extracted = aiProviderTestUtils.extractToolInput(response);
  const normalized = aiProviderTestUtils.normalizeTurnToolCall({
    toolName: extracted.name,
    payload: extracted.input,
    promptContext: createPromptContext(),
  });

  assert.equal(extracted.likelyTruncated, true);
  assert.equal(normalized?.type, "execute_converse");
  assert.equal(normalized?.interlocutor, "Tarin Ash");
  assert.equal(normalized?.npcId, "npc_guide");
});

test("normalizeTurnToolCall preserves an unnamed local interlocutor", () => {
  const normalized = aiProviderTestUtils.normalizeTurnToolCall({
    toolName: "execute_converse",
    payload: {
      interlocutor: "nearest harvester",
      topic: "leviathan sightings",
      narration: "A soaked harvester says the shadows passed under the rafts at first light.",
      suggestedActions: ["Ask where the shadows went"],
      timeMode: "exploration",
      durationMagnitude: "brief",
      citedEntities: {
        npcIds: [],
        locationIds: ["loc_gate"],
        factionIds: [],
        commodityIds: [],
        informationIds: [],
      },
    },
    promptContext: createPromptContext(),
  });

  assert.equal(normalized?.type, "execute_converse");
  assert.equal(normalized?.interlocutor, "nearest harvester");
  assert.equal(normalized?.npcId, undefined);
});

test("normalizeTurnToolCall canonicalizes recent unnamed local labels", () => {
  const normalized = aiProviderTestUtils.normalizeTurnToolCall({
    toolName: "execute_converse",
    payload: {
      interlocutor: "  Nearest   Harvester  ",
      topic: "leviathan sightings",
      narration: "The same soaked worker jerks a thumb toward the outer pens.",
      suggestedActions: ["Ask what changed at dawn"],
      timeMode: "exploration",
      durationMagnitude: "brief",
      citedEntities: {
        npcIds: [],
        locationIds: ["loc_gate"],
        factionIds: [],
        commodityIds: [],
        informationIds: [],
      },
    },
    promptContext: createPromptContext(),
  });

  assert.equal(normalized?.type, "execute_converse");
  assert.equal(normalized?.interlocutor, "nearest harvester");
  assert.equal(normalized?.npcId, undefined);
});

test("normalizeFetchToolCall repairs scoped fetch ids that drop the entity namespace segment", () => {
  const normalized = aiProviderTestUtils.normalizeModelToolCall({
    toolName: "fetch_npc_detail",
    payload: {
      npcId: "camp_94e2310a-8216-465e-b794-c51343e4eea1:npc_joren_kelp_market_overse",
    },
    promptContext: createPromptContext(),
  });

  assert.deepEqual(normalized, {
    type: "fetch_npc_detail",
    npcId: "camp_94e2310a-8216-465e-b794-c51343e4eea1:npc:npc_joren_kelp_market_overse",
  });
});

test("buildTurnSystemPrompt hard-locks observe mode to passive tools", () => {
  const prompt = aiProviderTestUtils.buildTurnSystemPrompt("observe");

  assert.match(prompt, /MUST invoke exactly one of execute_observe or execute_wait/);
  assert.match(prompt, /STRICTLY FORBIDDEN from invoking execute_combat, execute_converse, execute_trade, execute_freeform, execute_travel, execute_investigate, or execute_rest/);
  assert.match(prompt, /player character takes no chosen action and speaks no dialogue/);
  assert.match(prompt, /at most 4 short actions/);
});

test("buildTurnSystemPrompt distinguishes same-scene approach from travel", () => {
  const prompt = aiProviderTestUtils.buildTurnSystemPrompt("player_input");

  assert.match(prompt, /leaves the current location for a known adjacent node or route/);
  assert.match(prompt, /Walking across the current scene to a nearby stall, doorway, corner, or present NPC is not travel/);
  assert.match(prompt, /Never use execute_travel just because the player says 'walk over'/);
  assert.match(prompt, /named present NPC's stall, shop, table, cart, or post within the current location is not travel/);
});

test("same-scene approach to a present NPC is recognized as misrouted travel", () => {
  assert.equal(
    aiProviderTestUtils.isSameSceneNpcApproachMisroutedAsTravel(
      {
        type: "execute_travel",
        routeEdgeId: "edge_gate_market",
        targetLocationId: "loc_market",
        narration: "You head over to Tarin to ask what changed.",
        suggestedActions: ["Ask what changed"],
        timeMode: "travel",
        citedEntities: {
          npcIds: ["npc_guide"],
          locationIds: ["loc_gate"],
          factionIds: [],
          commodityIds: [],
          informationIds: [],
        },
      },
      createPromptContext(),
    ),
    true,
  );

  assert.equal(
    aiProviderTestUtils.isSameSceneNpcApproachMisroutedAsTravel(
      {
        type: "execute_travel",
        routeEdgeId: "edge_gate_market",
        targetLocationId: "loc_market",
        narration: "You set out for Lantern Market.",
        suggestedActions: ["Look for cover"],
        timeMode: "travel",
        citedEntities: {
          npcIds: [],
          locationIds: ["loc_gate", "loc_market"],
          factionIds: [],
          commodityIds: [],
          informationIds: [],
        },
      },
      createPromptContext(),
    ),
    false,
  );
});

test("observe mode only permits observe, wait, or clarification as final tools", () => {
  assert.equal(
    aiProviderTestUtils.isObservePermittedFinalTool({
      type: "execute_observe",
      targetType: "location",
      targetId: "loc_gate",
      narration: "You watch the gate traffic bunch and loosen.",
      suggestedActions: ["Ask the guide what changed"],
      timeMode: "exploration",
      citedEntities: {
        npcIds: [],
        locationIds: ["loc_gate"],
        factionIds: [],
        commodityIds: [],
        informationIds: [],
      },
    }),
    true,
  );

  assert.equal(
    aiProviderTestUtils.isObservePermittedFinalTool({
      type: "execute_wait",
      durationMinutes: 10,
      narration: "You wait while the patrol rotation changes.",
      suggestedActions: ["Follow the new patrol"],
      timeMode: "exploration",
      citedEntities: {
        npcIds: [],
        locationIds: ["loc_gate"],
        factionIds: [],
        commodityIds: [],
        informationIds: [],
      },
    }),
    true,
  );

  assert.equal(
    aiProviderTestUtils.isObservePermittedFinalTool({
      type: "request_clarification",
      question: "What should I passively focus on first?",
      options: ["The crowd", "The patrol", "The weather"],
    }),
    true,
  );

  assert.equal(
    aiProviderTestUtils.isObservePermittedFinalTool({
      type: "execute_freeform",
      actionDescription: "Climb onto a crate for a better view",
      timeMode: "exploration",
      challengeApproach: "notice",
      intendedMechanicalOutcome: "Spot the signal runner",
      narration: "You scramble up for a better view.",
      suggestedActions: ["Jump down"],
      citedEntities: {
        npcIds: [],
        locationIds: ["loc_gate"],
        factionIds: [],
        commodityIds: [],
        informationIds: [],
      },
    }),
    false,
  );
});
