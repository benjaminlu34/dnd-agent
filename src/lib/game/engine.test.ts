import assert from "node:assert/strict";
import test from "node:test";
import { engineTestUtils } from "./engine";

test("promoted temporary actor identity preserves meaningful role phrases", () => {
  assert.equal(
    engineTestUtils.toPromotedTemporaryActorRole("nearest harvester"),
    "harvester",
  );
  assert.equal(
    engineTestUtils.toPromotedTemporaryActorRole("old man near the well"),
    "old man",
  );
  assert.equal(
    engineTestUtils.toPromotedTemporaryActorRole("guard captain's assistant"),
    "guard captain's assistant",
  );
});

test("promoted temporary actor names preserve the seed identity instead of collapsing to one word", () => {
  assert.equal(
    engineTestUtils.toPromotedTemporaryActorName("old man near the well"),
    "Old Man",
  );
  assert.equal(
    engineTestUtils.toPromotedTemporaryActorName("dock repairer"),
    "Dock Repairer",
  );
});
