import assert from "node:assert/strict";
import test from "node:test";

import { sceneActorMatchesFocus } from "./scene-identity";

test("sceneActorMatchesFocus treats bakery focus as matching a nearby baker", () => {
  const matches = sceneActorMatchesFocus({
    actor: {
      displayLabel: "baker",
      role: "baker",
      lastSummary: "Sliding fresh loaves into a display cart.",
      focusKey: null,
    },
    sceneFocus: {
      key: "bakery",
      label: "The nearest bakery",
    },
  });

  assert.equal(matches, true);
});

test("sceneActorMatchesFocus treats armory focus as matching an armored guard nearby", () => {
  const matches = sceneActorMatchesFocus({
    actor: {
      displayLabel: "gate guard",
      role: "armorer",
      lastSummary: "Checking buckles and shield straps near the gate.",
      focusKey: null,
    },
    sceneFocus: {
      key: "armory",
      label: "The armory alcove",
    },
  });

  assert.equal(matches, true);
});
