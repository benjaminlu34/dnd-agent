import assert from "node:assert/strict";
import test from "node:test";
import { createStarterBlueprint, createStarterState } from "./starter-data";
import { parseCampaignState } from "./serialization";

test("parseCampaignState backfills knownLocations from the current scene for legacy saves", () => {
  const blueprint = createStarterBlueprint();
  const state = createStarterState(blueprint);
  const legacyState = {
    ...state,
    knownLocations: undefined,
  };

  const parsed = parseCampaignState(legacyState);

  assert.deepEqual(parsed.knownLocations, [state.sceneState.location]);
});

test("parseCampaignState ignores malformed knownLocations entries", () => {
  const blueprint = createStarterBlueprint();
  const state = createStarterState(blueprint);
  const parsed = parseCampaignState({
    ...state,
    knownLocations: ["Briar Glen", " ", "Old Smithy", "Briar Glen", 42],
  });

  assert.deepEqual(parsed.knownLocations, ["Briar Glen", "Old Smithy"]);
});

test("parseCampaignState preserves valid knownLocations arrays", () => {
  const blueprint = createStarterBlueprint();
  const state = createStarterState(blueprint);
  const parsed = parseCampaignState({
    ...state,
    knownLocations: ["Briar Glen", "Old Smithy"],
  });

  assert.deepEqual(parsed.knownLocations, ["Briar Glen", "Old Smithy"]);
});
