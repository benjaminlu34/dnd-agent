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

test("request hash includes session and version so request identity matches the full submission", () => {
  const baseHash = engineTestUtils.requestHashForSubmission({
    campaignId: "camp_1",
    sessionId: "sess_1",
    expectedStateVersion: 7,
    playerAction: "Wait here for an hour",
  });

  assert.notEqual(
    baseHash,
    engineTestUtils.requestHashForSubmission({
      campaignId: "camp_1",
      sessionId: "sess_2",
      expectedStateVersion: 7,
      playerAction: "Wait here for an hour",
    }),
  );

  assert.notEqual(
    baseHash,
    engineTestUtils.requestHashForSubmission({
      campaignId: "camp_1",
      sessionId: "sess_1",
      expectedStateVersion: 8,
      playerAction: "Wait here for an hour",
    }),
  );
});
