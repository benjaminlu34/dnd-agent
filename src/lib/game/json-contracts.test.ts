import assert from "node:assert/strict";
import test from "node:test";
import {
  approvalBandForValue,
  parseCampaignRuntimeStateJson,
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
    stateCommitLog: [
      {
        kind: "mutation" as const,
        mutationType: "record_npc_interaction" as const,
        status: "applied" as const,
        reasonCode: "npc_interaction_recorded",
        summary: "Tarn declines the bath and chooses the cot instead.",
        metadata: {
          npcId: "npc_tarn",
          topic: "lodging",
          socialOutcome: "declines",
          phase: "immediate",
        },
      },
    ],
    narrationBounds: {
      requestedAdvanceMinutes: 4320,
      committedAdvanceMinutes: 2880,
      availableAdvanceMinutes: 2880,
      wasCapped: true,
      overrideText: null,
      isFastForward: true,
      interruptionReason: "A rider comes in hard from the north road.",
    },
    pendingCheck: null,
    checkResult: null,
    rollback: null,
    clarification: null,
    error: null,
  };

  assert.deepEqual(parseTurnResultPayloadJson(toTurnResultPayloadJson(payload)), payload);
});

test("parseTurnResultPayloadJson rejects invalid socialOutcome metadata", () => {
  assert.equal(
    parseTurnResultPayloadJson({
      schemaVersion: 2,
      data: {
        stateVersionAfter: 4,
        changeCodes: [],
        reasonCodes: [],
        whatChanged: [],
        why: [],
        warnings: [],
        stateCommitLog: [
          {
            kind: "mutation",
            mutationType: "record_local_interaction",
            status: "applied",
            reasonCode: "local_interaction_recorded",
            summary: "The porter gives a neutral shrug.",
            metadata: {
              localEntityId: "temp:temp_porter",
              socialOutcome: "neutral",
            },
          },
        ],
        narrationBounds: null,
        pendingCheck: null,
        checkResult: null,
        rollback: null,
        clarification: null,
        error: null,
      },
    }),
    null,
  );
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
    pendingCheck: null,
    checkResult: null,
    rollback: null,
    clarification: null,
    error: null,
  });
});

test("parseCampaignRuntimeStateJson normalizes legacy scene object state into permanent scene aspects", () => {
  const parsed = parseCampaignRuntimeStateJson({
    currentLocationId: "loc_gate",
    globalTime: 480,
    pendingTurnId: null,
    lastActionSummary: null,
    sceneObjectStates: {
      gate_winch: "jammed open",
    },
  });

  assert.deepEqual(parsed.sceneAspects, {
    gate_winch: {
      label: "gate winch",
      state: "jammed open",
      duration: "permanent",
      focusKey: null,
    },
  });
  assert.equal(parsed.sceneFocus, null);
  assert.deepEqual(parsed.characterState, {
    conditions: [],
    activeCompanions: [],
  });
});

test("parseCampaignRuntimeStateJson defaults missing scene-aspect focus keys to null", () => {
  const parsed = parseCampaignRuntimeStateJson({
    currentLocationId: "loc_gate",
    globalTime: 480,
    pendingTurnId: null,
    lastActionSummary: null,
    sceneAspects: {
      forge_smoke: {
        label: "forge smoke",
        state: "hanging low",
        duration: "scene",
      },
    },
  });

  assert.equal(parsed.sceneAspects.forge_smoke?.focusKey, null);
});
