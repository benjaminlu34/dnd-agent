import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultAdventureModuleSetup, createStarterBlueprint, createStarterState } from "./starter-data";
import { hydrateCampaignState, parseCampaignState, parseGeneratedCampaignSetup } from "./serialization";

test("parseCampaignState backfills new discovery arrays from the current scene for legacy saves", () => {
  const blueprint = createStarterBlueprint();
  const state = createStarterState(blueprint);
  const legacyState = {
    ...state,
    discoveredSceneLocations: undefined,
    discoveredKeyLocationNames: undefined,
  };

  const parsed = parseCampaignState(legacyState);

  assert.deepEqual(parsed.discoveredSceneLocations, []);
  assert.deepEqual(parsed.discoveredKeyLocationNames, []);
});

test("parseCampaignState ignores malformed discovered location entries", () => {
  const blueprint = createStarterBlueprint();
  const state = createStarterState(blueprint);
  const parsed = parseCampaignState({
    ...state,
    discoveredSceneLocations: ["Ash Market fountain", " ", "Old Smithy", "Ash Market fountain", 42],
    discoveredKeyLocationNames: ["Ash Market", " ", "Old Smithy", "Ash Market", 42],
  });

  assert.deepEqual(parsed.discoveredSceneLocations, ["Ash Market fountain", "Old Smithy"]);
  assert.deepEqual(parsed.discoveredKeyLocationNames, ["Ash Market", "Old Smithy"]);
});

test("hydrateCampaignState migrates legacy knownLocations into scene and key discoveries", () => {
  const blueprint = createStarterBlueprint();
  const state = createStarterState(blueprint);
  const parsed = hydrateCampaignState(
    {
      ...state,
      sceneState: {
        ...state.sceneState,
        keyLocationName: null,
      },
      discoveredSceneLocations: undefined,
      discoveredKeyLocationNames: undefined,
      knownLocations: ["Ash Market", "Old Smithy", "Back alley"],
    },
    blueprint.keyLocations,
  );

  assert.deepEqual(parsed.discoveredSceneLocations, ["Back alley", state.sceneState.location]);
  assert.deepEqual(parsed.discoveredKeyLocationNames, [
    "Ash Market",
    "Old Smithy",
    "Shattered Observatory",
  ]);
  assert.equal(parsed.sceneState.keyLocationName, null);
});

test("parseGeneratedCampaignSetup normalizes legacy locations into key locations", () => {
  const setup = createDefaultAdventureModuleSetup();
  const parsed = parseGeneratedCampaignSetup(setup.publicSynopsis, {
    ...setup.secretEngine,
    keyLocations: undefined,
    locations: ["Ash Market", "Old Smithy"],
  });

  assert.deepEqual(parsed.secretEngine.keyLocations, [
    {
      name: "Ash Market",
      role: "Important campaign anchor",
      isPublic: false,
    },
    {
      name: "Old Smithy",
      role: "Important campaign anchor",
      isPublic: false,
    },
  ]);
});

test("parseCampaignState preserves valid discovery arrays", () => {
  const blueprint = createStarterBlueprint();
  const state = createStarterState(blueprint);
  const parsed = parseCampaignState({
    ...state,
    discoveredSceneLocations: ["Ash Market fountain", "Old Smithy"],
    discoveredKeyLocationNames: ["Ash Market", "Old Smithy"],
  });

  assert.deepEqual(parsed.discoveredSceneLocations, ["Ash Market fountain", "Old Smithy"]);
  assert.deepEqual(parsed.discoveredKeyLocationNames, ["Ash Market", "Old Smithy"]);
});
