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
    turnMode: "player_input",
  });

  assert.notEqual(
    baseHash,
    engineTestUtils.requestHashForSubmission({
      campaignId: "camp_1",
      sessionId: "sess_2",
      expectedStateVersion: 7,
      playerAction: "Wait here for an hour",
      turnMode: "player_input",
    }),
  );

  assert.notEqual(
    baseHash,
    engineTestUtils.requestHashForSubmission({
      campaignId: "camp_1",
      sessionId: "sess_1",
      expectedStateVersion: 8,
      playerAction: "Wait here for an hour",
      turnMode: "player_input",
    }),
  );
});

test("request hash changes when observe mode changes the submission identity", () => {
  const playerInputHash = engineTestUtils.requestHashForSubmission({
    campaignId: "camp_1",
    sessionId: "sess_1",
    expectedStateVersion: 7,
    playerAction: "Observe",
    turnMode: "player_input",
  });

  const observeHash = engineTestUtils.requestHashForSubmission({
    campaignId: "camp_1",
    sessionId: "sess_1",
    expectedStateVersion: 7,
    playerAction: "Observe",
    turnMode: "observe",
  });

  assert.notEqual(playerInputHash, observeHash);
});

test("router-selected local profile only applies at high confidence", () => {
  assert.equal(
    engineTestUtils.promptContextProfileForRouter({
      profile: "local",
      confidence: "high",
      authorizedCommitments: [],
      reason: "same-scene action",
    }),
    "local",
  );

  assert.equal(
    engineTestUtils.promptContextProfileForRouter({
      profile: "local",
      confidence: "low",
      authorizedCommitments: ["converse"],
      reason: "uncertain broader context dependency",
    }),
    "full",
  );
});

test("repairable validation errors are limited to router overcommit and scene-misroute cases", () => {
  assert.equal(engineTestUtils.isRepairableTurnValidationError("intent_overcommit_trade: trade is unauthorized"), true);
  assert.equal(
    engineTestUtils.isRepairableTurnValidationError(
      "narration_voice_first_person: Narration must be written in second person from the Dungeon Master perspective.",
    ),
    true,
  );
  assert.equal(
    engineTestUtils.isRepairableTurnValidationError(
      "narration_too_thin: Scene-forward narration should usually give at least two sentences with some concrete texture, not just a bare action summary.",
    ),
    true,
  );
  assert.equal(
    engineTestUtils.isRepairableTurnValidationError(
      "narration_parroting_player_action: Converse narration must advance past the player's own line with an NPC reply or visible reaction.",
    ),
    true,
  );
  assert.equal(
    engineTestUtils.isRepairableTurnValidationError(
      "execute_scene_interaction cannot replace explicit conversation or negotiation.",
    ),
    true,
  );
  assert.equal(engineTestUtils.isRepairableTurnValidationError("A cited commodity is required for execute_trade."), false);
});
