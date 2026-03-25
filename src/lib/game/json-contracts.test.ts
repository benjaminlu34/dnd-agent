import assert from "node:assert/strict";
import test from "node:test";
import {
  approvalBandForValue,
  parseTurnResultPayloadJson,
  toTurnResultPayloadJson,
} from "./json-contracts";

test("approvalBandForValue maps numeric approval into explicit relationship bands", () => {
  assert.equal(approvalBandForValue(-4), "hostile");
  assert.equal(approvalBandForValue(-1), "cold");
  assert.equal(approvalBandForValue(0), "neutral");
  assert.equal(approvalBandForValue(3), "warm");
  assert.equal(approvalBandForValue(6), "trusted");
});

test("parseTurnResultPayloadJson round-trips the versioned structured result payload", () => {
  const payload = {
    stateVersionAfter: 4,
    changeCodes: [
      {
        code: "TIME_ADVANCED" as const,
        entityType: "campaign" as const,
        targetId: "camp_1",
        minutes: 15,
        metadata: null,
      },
    ],
    reasonCodes: [
      {
        code: "PLAYER_WAIT" as const,
        entityType: "campaign" as const,
        targetId: "camp_1",
        minutes: 15,
        metadata: null,
      },
    ],
    whatChanged: ["15 minutes passed."],
    why: ["Because you let time pass."],
    warnings: [],
    stateCommitLog: [],
    narrationBounds: null,
    checkResult: null,
    rollback: null,
    clarification: null,
    error: null,
  };

  assert.deepEqual(parseTurnResultPayloadJson(toTurnResultPayloadJson(payload)), payload);
});

test("parseTurnResultPayloadJson migrates legacy result payloads into the canonical structure", () => {
  const parsed = parseTurnResultPayloadJson({
    warnings: ["legacy warning"],
    checkResult: null,
    rollback: null,
  });

  assert.deepEqual(parsed, {
    stateVersionAfter: null,
    changeCodes: [],
    reasonCodes: [],
    whatChanged: [],
    why: [],
    warnings: ["legacy warning"],
    stateCommitLog: [],
    checkResult: null,
    rollback: null,
    clarification: null,
    error: null,
  });
});
