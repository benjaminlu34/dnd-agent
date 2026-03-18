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
    location: "Briar Glen",
    atmosphere: "Tense and watchful",
    suggestedActions: ["Inspect the soot trail", "Question the bell-warden"],
  },
};

test("buildCampaignStateFromSetup initializes knownLocations from public setting and opening location only", () => {
  const setup = createDefaultAdventureModuleSetup();
  const state = buildCampaignStateFromSetup(setup, opening);

  assert.deepEqual(state.knownLocations, [
    setup.publicSynopsis.setting,
    opening.scene.location,
  ]);
  assert.deepEqual(state.locations, setup.secretEngine.locations);
});

test("buildCampaignStateFromSetup dedupes repeated public setting and opening location", () => {
  const setup = {
    ...createDefaultAdventureModuleSetup(),
    publicSynopsis: {
      ...createDefaultAdventureModuleSetup().publicSynopsis,
      setting: opening.scene.location,
    },
  };
  const state = buildCampaignStateFromSetup(setup, opening);

  assert.deepEqual(state.knownLocations, [opening.scene.location]);
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
