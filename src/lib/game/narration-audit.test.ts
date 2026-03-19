import assert from "node:assert/strict";
import test from "node:test";
import {
  auditRenderedNarration,
  auditRenderedNarrationStructure,
  validateBeatPlan,
} from "../ai/narration-audit";

test("validateBeatPlan accepts direct key item handling through pronoun actions", () => {
  const result = validateBeatPlan({
    mode: "triage",
    playerAction: "I hide it beneath the bed before anyone comes upstairs.",
    actionResolution: "You slide the amulet beneath the mattress and pull the blanket smooth over it.",
    suggestedActionGoals: [
      { goal: "stay hidden until the hallway settles", target: null },
      { goal: "leave before dawn", target: null },
    ],
    requiresCheck: false,
  });

  assert.equal(result.highestSeverity, "clean");
  assert.deepEqual(result.directlyHandledItems, ["amulet"]);
});

test("validateBeatPlan warns on irrelevant key item surfacing", () => {
  const result = validateBeatPlan({
    mode: "triage",
    playerAction: "I bar the door and listen for footsteps on the stairs.",
    actionResolution: "You set the amulet on the table and listen for movement beyond the door.",
    suggestedActionGoals: [
      { goal: "check the stairs for the source of the noise", target: null },
      { goal: "fortify the room", target: null },
    ],
    requiresCheck: false,
  });

  assert.equal(result.highestSeverity, "warn");
  assert.ok(result.issues.some((issue) => issue.code === "irrelevant_key_item"));
});

test("auditRenderedNarration warns on repeated key items in the same beat", () => {
  const result = auditRenderedNarration({
    mode: "resolution",
    narration:
      "The amulet thumps against the chair leg, and the amulet's clasp clicks softly as you set it down.",
    playerAction: "I set the amulet down long enough to listen at the door.",
    actionResolution: "You set the amulet down beside the chair and go still as the hallway creaks.",
    directlyHandledItems: ["amulet"],
    suggestedActions: [
      "Listen at the door more carefully",
      "Hide the amulet before anyone comes upstairs",
    ],
  });

  assert.equal(result.highestSeverity, "warn");
  assert.ok(result.issues.some((issue) => issue.code === "repeated_key_item"));
});

test("auditRenderedNarration warns on contradictions with the validated beat", () => {
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

  assert.equal(result.highestSeverity, "warn");
  assert.ok(result.issues.some((issue) => issue.code === "beat_contradiction"));
});

test("auditRenderedNarration blocks suggested actions leaking into narration", () => {
  const result = auditRenderedNarration({
    mode: "triage",
    narration:
      "You wake to the bell tower's clang and sit up in the safehouse room.\n\nSuggested actions:\n- Leave the safehouse\n- Inspect the amulet",
    playerAction: "Rest and recover your bearings",
    actionResolution: "You sleep for a few hours and recover your strength.",
    directlyHandledItems: [],
    suggestedActions: [
      "Leave the safehouse",
      "Inspect the amulet",
    ],
  });

  assert.equal(result.highestSeverity, "block");
  assert.ok(result.issues.some((issue) => issue.code === "suggested_actions_in_narration"));
});

test("auditRenderedNarrationStructure blocks suggested actions leaking into narration", () => {
  const result = auditRenderedNarrationStructure({
    narration:
      "You wake to the bell tower's clang and sit up in the safehouse room.\n\nSuggested actions:\n- Leave the safehouse\n- Inspect the amulet",
    suggestedActions: [],
  });

  assert.equal(result.highestSeverity, "block");
  assert.ok(result.issues.some((issue) => issue.code === "suggested_actions_in_narration"));
});
