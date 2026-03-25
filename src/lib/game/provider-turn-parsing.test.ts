import assert from "node:assert/strict";
import test from "node:test";
import { aiProviderTestUtils } from "../ai/provider";

test("extractToolInput flags clipped resolve_mechanics payloads as likely truncated", () => {
  const response = {
    choices: [
      {
        finish_reason: "tool_calls",
        message: {
          tool_calls: [
            {
              type: "function",
              function: {
                name: "resolve_mechanics",
                arguments:
                  "{\"timeMode\":\"exploration\",\"suggestedActions\":[\"Keep talking\"],\"mutations\":[{\"type\":\"adjust_relationship\",\"npcId\":\"npc_guard\",\"delta\":1,\"reason\":\"steady pressure\"}]",
              },
            },
          ],
          content: "",
        },
      },
    ],
  } as never;

  const extracted = aiProviderTestUtils.extractToolInput(response);

  assert.equal(extracted.name, "resolve_mechanics");
  assert.equal(extracted.likelyTruncated, true);
});

test("parseFinalActionToolCall accepts resolve_mechanics payloads", () => {
  const parsed = aiProviderTestUtils.parseFinalActionToolCall({
    type: "resolve_mechanics",
    timeMode: "exploration",
    suggestedActions: ["Keep talking"],
    checkIntent: {
      type: "challenge",
      reason: "Lean on the guard",
      challengeApproach: "influence",
    },
    mutations: [
      {
        type: "adjust_relationship",
        npcId: "npc_guard",
        delta: 1,
        reason: "The guard relents a little.",
      },
      {
        type: "advance_time",
        durationMinutes: 5,
      },
    ],
  });

  assert.equal(parsed.success, true);
});

test("parseFinalActionToolCall rejects removed legacy monolithic action payloads", () => {
  const parsed = aiProviderTestUtils.parseFinalActionToolCall({
    type: "execute_converse",
    interlocutor: "Gate Guard",
    topic: "gate trouble",
  });

  assert.equal(parsed.success, false);
});

test("buildTurnSystemPrompt hard-locks observe mode to resolve_mechanics or clarification", () => {
  const prompt = aiProviderTestUtils.buildTurnSystemPrompt("observe");

  assert.match(prompt, /resolve_mechanics or request_clarification/);
  assert.match(prompt, /Do not output narration or any freeform prose/);
  assert.match(prompt, /Do not create combat, market trade, or deliberate social escalation in observe mode/);
});

test("buildTurnSystemPrompt for player turns encodes router and check-gating rules", () => {
  const prompt = aiProviderTestUtils.buildTurnSystemPrompt("player_input");

  assert.match(prompt, /Obey the router_constraints block/);
  assert.match(prompt, /Use only bounded mutations/);
  assert.match(prompt, /The engine will reject them automatically on failure or partial success/);
  assert.match(prompt, /Use commit_market_trade only for strict commodity trade backed by fetched market prices/);
});

test("normalizeRouterDecision dedupes vectors and prerequisites", () => {
  const normalized = aiProviderTestUtils.normalizeRouterDecision({
    profile: "local",
    confidence: "high",
    authorizedVectors: ["converse", "converse", "economy_light"],
    requiredPrerequisites: [
      { type: "npc_detail", npcId: "npc_guard" },
      { type: "npc_detail", npcId: "npc_guard" },
      { type: "relationship_history", npcId: "npc_guard" },
    ],
    reason: "  same-scene negotiation  ",
  });

  assert.deepEqual(normalized.authorizedVectors, ["converse", "economy_light"]);
  assert.deepEqual(normalized.requiredPrerequisites, [
    { type: "npc_detail", npcId: "npc_guard" },
    { type: "relationship_history", npcId: "npc_guard" },
  ]);
  assert.equal(normalized.reason, "same-scene negotiation");
});

test("selectPromptContextProfile falls back to full when router confidence is low", () => {
  assert.equal(
    aiProviderTestUtils.selectPromptContextProfile({
      profile: "local",
      confidence: "low",
      authorizedVectors: ["converse"],
      requiredPrerequisites: [],
      reason: "uncertain",
    }),
    "full",
  );
});

test("observe mode only permits resolve_mechanics or clarification as final tools", () => {
  assert.equal(
    aiProviderTestUtils.isObservePermittedFinalTool({
      type: "resolve_mechanics",
      timeMode: "exploration",
      suggestedActions: ["Keep watching"],
      mutations: [{ type: "advance_time", durationMinutes: 10 }],
    }),
    true,
  );

  assert.equal(
    aiProviderTestUtils.isObservePermittedFinalTool({
      type: "request_clarification",
      question: "What should I passively focus on first?",
      options: ["The crowd", "The patrol"],
    }),
    true,
  );

  assert.equal(
    aiProviderTestUtils.isObservePermittedFinalTool({
      type: "fetch_npc_detail",
      npcId: "npc_guard",
    }),
    false,
  );
});

test("observe mechanics safety allows passive mutations but rejects active ones", () => {
  assert.equal(
    aiProviderTestUtils.isObserveMechanicsPayloadSafe({
      type: "resolve_mechanics",
      timeMode: "exploration",
      suggestedActions: ["Keep watching"],
      mutations: [
        { type: "advance_time", durationMinutes: 10 },
        { type: "discover_information", informationId: "info_1" },
      ],
    }),
    true,
  );

  assert.equal(
    aiProviderTestUtils.isObserveMechanicsPayloadSafe({
      type: "resolve_mechanics",
      timeMode: "exploration",
      suggestedActions: ["Approach the guard"],
      mutations: [{ type: "move_player", routeEdgeId: "edge_gate_market", targetLocationId: "loc_market" }],
    }),
    false,
  );
});
