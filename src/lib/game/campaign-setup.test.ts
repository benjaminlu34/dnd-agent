import assert from "node:assert/strict";
import test from "node:test";
import type { GeneratedCampaignOpening, GeneratedCampaignSetup } from "./types";
import {
  buildCampaignStateFromSetup,
  buildNpcRecordsFromSetup,
} from "./campaign-setup";
import { createDefaultAdventureModuleSetup } from "./starter-data";

const opening: GeneratedCampaignOpening = {
  narration: "The bells are ringing as the square begins to empty.",
  activeThreat: "Cult lantern-bearers are testing the town's edges.",
  scene: {
    title: "Ash Market at Dusk",
    summary: "Crowds thin around the fountain while soot drifts from the smithy.",
    location: "Ash Market fountain",
    keyLocationName: "Ash Market",
    atmosphere: "Tense and watchful",
    suggestedActions: ["Inspect the soot trail", "Question the bell-warden"],
  },
};

test("buildCampaignStateFromSetup seeds discovered scene and key locations", () => {
  const setup = createDefaultAdventureModuleSetup();
  const state = buildCampaignStateFromSetup(setup, opening);

  assert.deepEqual(state.discoveredSceneLocations, [opening.scene.location]);
  assert.deepEqual(
    state.discoveredKeyLocationNames,
    setup.secretEngine.keyLocations.filter((location) => location.isPublic).map((location) => location.name),
  );
});

test("buildCampaignStateFromSetup includes the opening anchor even if it is not public", () => {
  const setup = {
    ...createDefaultAdventureModuleSetup(),
    secretEngine: {
      ...createDefaultAdventureModuleSetup().secretEngine,
      keyLocations: createDefaultAdventureModuleSetup().secretEngine.keyLocations.map((location) =>
        location.name === "Ash Market" ? { ...location, isPublic: false } : location,
      ),
    },
  };
  const state = buildCampaignStateFromSetup(setup, opening);

  assert.deepEqual(state.discoveredKeyLocationNames, [
    "Old Smithy",
    "Shattered Observatory",
    "Ash Market",
  ]);
});

test("buildNpcRecordsFromSetup auto-discovers only companions and public-facing roles", () => {
  const setup: GeneratedCampaignSetup = {
    ...createDefaultAdventureModuleSetup(),
    secretEngine: {
      ...createDefaultAdventureModuleSetup().secretEngine,
      npcs: [
        {
          name: "Lark",
          role: "Companion",
          notes: "Ready to help.",
          isCompanion: true,
        },
        {
          name: "Mother Ysilde",
          role: "Bell-warden",
          notes: "Caretaker of the town square.",
        },
        {
          name: "Silent Wren",
          role: "Night sacristan",
          notes: "Knows more than they say.",
        },
        {
          name: "Toma",
          role: "Tea seller",
          notes: "Sees everyone pass by.",
        },
      ],
    },
  };

  const npcs = buildNpcRecordsFromSetup(setup);

  assert.equal(npcs[0]?.discoveredAtTurn, 0);
  assert.equal(npcs[1]?.discoveredAtTurn, 0);
  assert.equal(npcs[2]?.discoveredAtTurn, null);
  assert.equal(npcs[3]?.discoveredAtTurn, 0);
});
