import assert from "node:assert/strict";
import test from "node:test";
import {
  auditRenderedNarration,
  validateBeatPlan,
} from "../ai/narration-audit";

test("validateBeatPlan accepts direct key item handling through pronoun actions", () => {
  const result = validateBeatPlan({
    mode: "triage",
    playerAction: "I hide it beneath the bed before anyone comes upstairs.",
    actionResolution: "You slide the ledger beneath the mattress and pull the blanket smooth over it.",
    suggestedActionGoals: [
      { goal: "stay hidden until the hallway settles", target: null },
      { goal: "leave before dawn", target: null },
    ],
    requiresCheck: false,
  });

  assert.equal(result.highestSeverity, "clean");
  assert.deepEqual(result.directlyHandledItems, ["ledger"]);
});

test("validateBeatPlan blocks irrelevant key item surfacing", () => {
  const result = validateBeatPlan({
    mode: "triage",
    playerAction: "I bar the door and listen for footsteps on the stairs.",
    actionResolution: "You set the ledger on the table and listen for movement beyond the door.",
    suggestedActionGoals: [
      { goal: "check the stairs for the source of the noise", target: null },
      { goal: "fortify the room", target: null },
    ],
    requiresCheck: false,
  });

  assert.equal(result.highestSeverity, "block");
  assert.ok(result.issues.some((issue) => issue.code === "irrelevant_key_item"));
});

test("auditRenderedNarration warns on repeated key items in the same beat", () => {
  const result = auditRenderedNarration({
    mode: "resolution",
    narration:
      "The ledger thumps against the chair leg, and the ledger's clasp clicks softly as you set it down.",
    playerAction: "I set the ledger down long enough to listen at the door.",
    actionResolution: "You set the ledger down beside the chair and go still as the hallway creaks.",
    directlyHandledItems: ["ledger"],
    suggestedActions: [
      "Listen at the door more carefully",
      "Hide the ledger before anyone comes upstairs",
    ],
  });

  assert.equal(result.highestSeverity, "warn");
  assert.ok(result.issues.some((issue) => issue.code === "repeated_key_item"));
});

test("auditRenderedNarration blocks contradictions with the validated beat", () => {
  const result = auditRenderedNarration({
    mode: "triage",
    narration: "You linger at the corner and wait for the room to settle.",
    playerAction: "I spring the ambush the moment he clears the corner.",
    actionResolution: "You catch the veteran enforcer by the collar and drive him into the stacked crates.",
    directlyHandledItems: [],
    suggestedActions: [
      "Pin him before he can shout",
      "Search him for orders",
    ],
  });

  assert.equal(result.highestSeverity, "block");
  assert.ok(result.issues.some((issue) => issue.code === "beat_contradiction"));
});
