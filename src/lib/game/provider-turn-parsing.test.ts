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
      description: null,
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
        factionId: null,
        factionName: null,
        currentLocationId: "loc_gate",
        approval: 2,
        isCompanion: false,
      },
    ],
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
      },
    ],
    connectedLeads: [],
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
    inventory: [],
    memories: [],
    recentMessages: [],
    discoveredInformationIds: ["info_1"],
    globalTime: 480,
    timeOfDay: "morning",
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
                  "{\"npcId\":\"npc_guide\",\"topic\":\"gate trouble\",\"narration\":\"Tarin points toward the market and mutters that the watch is overwhelmed.\",\"suggestedActions\":[\"Ask who is in charge\"],\"timeMode\":\"exploration\",\"timeElapsed\":5,\"citedEntities\":{\"npcIds\":[\"npc_guide\"],\"locationIds\":[\"loc_gate\"],\"factionIds\":[\"fac_watch\"],\"commodityIds\":[],\"informationIds\":[\"info_1\"]}",
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
      timeElapsed: 5,
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
