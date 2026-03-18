import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeRendererDecision,
  normalizeTurnRenderAuditDecision,
  validateTurnRenderAuditDecision,
} from "../ai/provider";

test("normalizeTurnRenderAuditDecision keeps clean audit payloads", () => {
  const decision = normalizeTurnRenderAuditDecision({
    severity: "clean",
    issues: [],
    repairInstructions: [],
  });

  assert.deepEqual(decision, {
    severity: "clean",
    issues: [],
    repairInstructions: [],
  });
  assert.deepEqual(validateTurnRenderAuditDecision(decision), {
    valid: true,
    error: null,
  });
});

test("normalizeTurnRenderAuditDecision keeps unknown issue codes without crashing", () => {
  const decision = normalizeTurnRenderAuditDecision({
    severity: "warn",
    issues: [
      {
        code: "semantic_drift",
        rationale: "The narration drifts away from the validated beat.",
        evidence: "It introduces a new lead.",
      },
    ],
    repairInstructions: [],
  });

  assert.equal(decision?.issues[0]?.code, "semantic_drift");
  assert.deepEqual(validateTurnRenderAuditDecision(decision), {
    valid: true,
    error: null,
  });
});

test("validateTurnRenderAuditDecision rejects block payloads without repair instructions", () => {
  const decision = normalizeTurnRenderAuditDecision({
    severity: "block",
    issues: [
      {
        code: "beat_drift",
        rationale: "The narration no longer depicts the validated beat.",
        evidence: null,
      },
    ],
    repairInstructions: [],
  });

  assert.deepEqual(validateTurnRenderAuditDecision(decision), {
    valid: false,
    error: "AI render audit must include repairInstructions for block severity.",
  });
});

test("normalizeTurnRenderAuditDecision rejects malformed payloads safely", () => {
  const decision = normalizeTurnRenderAuditDecision({
    severity: "warn",
    issues: "not-an-array",
    repairInstructions: [],
  });

  assert.deepEqual(decision, {
    severity: "warn",
    issues: [],
    repairInstructions: [],
  });
  assert.deepEqual(validateTurnRenderAuditDecision(decision), {
    valid: false,
    error: "AI render audit must include at least one issue for warn or block severity.",
  });
});

test("normalizeRendererDecision strips suggested actions footers into structured actions", () => {
  const decision = normalizeRendererDecision(
    null,
    [
      "You wake to the bell tower's clang and sit up in the safehouse room.",
      "",
      "Suggested actions:",
      "- Leave the safehouse",
      "- Inspect the ledger",
    ].join("\n"),
  );

  assert.equal(
    decision?.narration,
    "You wake to the bell tower's clang and sit up in the safehouse room.",
  );
  assert.deepEqual(decision?.suggestedActions, [
    "Leave the safehouse",
    "Inspect the ledger",
  ]);
});

test("normalizeRendererDecision rejects literal structured meta leaks", () => {
  const decision = normalizeRendererDecision(
    null,
    "proposedDelta.sceneSnapshot: You are awake in the safehouse room above the tavern.",
  );

  assert.equal(decision, null);
});
