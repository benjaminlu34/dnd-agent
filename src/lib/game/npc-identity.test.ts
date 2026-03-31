import assert from "node:assert/strict";
import test from "node:test";
import { canonicalizeNpcIdAgainstCandidates } from "./npc-identity";

test("canonicalizeNpcIdAgainstCandidates repairs malformed scoped ids by unique final-segment match", () => {
  const canonical = canonicalizeNpcIdAgainstCandidates({
    rawNpcId: "camp_16e23ba8-ef87-4b6e-a3c3-9c78afcf784f:npc:npc_local_5",
    candidates: [
      {
        id: "camp_16e23ba8-ef87-4b6e-a7c3-9c78afcf784f:npc:npc_local_5",
        name: "Tarn Blackthorn",
      },
      {
        id: "camp_16e23ba8-ef87-4b6e-a7c3-9c78afcf784f:npc:npc_local_2",
        name: "Lira Thornwood",
      },
    ],
  });

  assert.equal(
    canonical,
    "camp_16e23ba8-ef87-4b6e-a7c3-9c78afcf784f:npc:npc_local_5",
  );
});

test("canonicalizeNpcIdAgainstCandidates prefers exact name matches when ids are absent", () => {
  const canonical = canonicalizeNpcIdAgainstCandidates({
    rawNpcId: "Tarn Blackthorn",
    candidates: [
      {
        id: "camp_16e23ba8-ef87-4b6e-a7c3-9c78afcf784f:npc:npc_local_5",
        name: "Tarn Blackthorn",
      },
    ],
  });

  assert.equal(
    canonical,
    "camp_16e23ba8-ef87-4b6e-a7c3-9c78afcf784f:npc:npc_local_5",
  );
});
