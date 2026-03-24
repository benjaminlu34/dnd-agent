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
