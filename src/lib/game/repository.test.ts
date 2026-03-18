import assert from "node:assert/strict";
import test from "node:test";
import type { CampaignSnapshot, RecentResolvedTurn } from "./types";
import {
  createStarterArcs,
  createStarterBlueprint,
  createStarterCharacter,
  createStarterClues,
  createStarterNpcs,
  createStarterQuests,
  createStarterState,
} from "./starter-data";
import {
  buildRecentTurnLedger,
  getPromptContext,
  orderRecentMessages,
  toPlayerCampaignSnapshot,
} from "./repository";

function createSnapshot(overrides: Partial<CampaignSnapshot> = {}): CampaignSnapshot {
  const blueprint = createStarterBlueprint();
  const state = createStarterState(blueprint, {
    openingScene: {
      title: "Ash Market at Dusk",
      summary: "You stand in a crowded market while soot drifts from the shuttered smithy.",
      location: "Briar Glen",
      atmosphere: "Tense and watchful",
      suggestedActions: [
        "Inspect the soot trail",
        "Question the bell-warden",
      ],
    },
  });

  return {
    campaignId: "campaign_test",
    sessionId: "session_test",
    title: "Ashen Bell of Briar Glen",
    premise: blueprint.premise,
    tone: blueprint.tone,
    setting: blueprint.setting,
    blueprint,
    state: {
      ...state,
      turnCount: 6,
    },
    character: createStarterCharacter(),
    quests: createStarterQuests(),
    arcs: createStarterArcs(),
    npcs: createStarterNpcs(),
    clues: createStarterClues(),
    memories: [],
    recentMessages: [],
    recentResolvedTurns: [],
    previouslyOn: null,
    latestResolvedTurnId: null,
    canRetryLatestTurn: false,
    ...overrides,
  };
}

test("buildRecentTurnLedger preserves stored turn facts and legacy check fallback", () => {
  const recentResolvedTurns: RecentResolvedTurn[] = [
    {
      id: "turn_6",
      playerAction: "I slip behind the boarded smithy and listen at the rear door.",
      resultJson: {
        rollback: {},
        turnFacts: {
          action: "I slip behind the boarded smithy and listen at the rear door.",
          roll: "none",
          healthDelta: 0,
          discoveries: ["clue_warm_cinders"],
          sceneChanged: false,
        },
      },
    },
    {
      id: "turn_5",
      playerAction: "I inspect the eclipse notice for hidden marks.",
      resultJson: {
        checkResult: {
          stat: "intelligence",
          mode: "normal",
          reason: "Inspecting the notice",
          rolls: [12, 12],
          modifier: 1,
          total: 13,
          outcome: "success",
        },
      },
    },
  ];

  assert.deepEqual(buildRecentTurnLedger(6, recentResolvedTurns), [
    '[Turn 5] Action: "I inspect the eclipse notice for hidden marks." | Roll: intelligence success (13) | HP: 0 | Discoveries: none | SceneChanged: no',
    '[Turn 6] Action: "I slip behind the boarded smithy and listen at the rear door." | Roll: none | HP: 0 | Discoveries: clue_warm_cinders | SceneChanged: no',
  ]);
});

test("getPromptContext classifies snapshot data without extra turn queries", async () => {
  const recentResolvedTurns: RecentResolvedTurn[] = [
    {
      id: "turn_6",
      playerAction: "I question Mother Ysilde about the forge smoke.",
      resultJson: {
        rollback: {},
        turnFacts: {
          action: "I question Mother Ysilde about the forge smoke.",
          roll: undefined,
          healthDelta: 0,
          discoveries: ["npc_bellwarden"],
          sceneChanged: false,
        },
      },
    },
    {
      id: "turn_5",
      playerAction: "I study the fountain for the blacksmith's mark.",
      resultJson: {
        rollback: {},
        turnFacts: {
          action: "I study the fountain for the blacksmith's mark.",
          roll: "intelligence success (13)",
          healthDelta: 0,
          discoveries: ["clue_hammer_marks"],
          sceneChanged: true,
        },
      },
    },
  ];

  const snapshot = createSnapshot({
    quests: [
      {
        ...createStarterQuests()[0]!,
        id: "quest_known",
        discoveredAtTurn: 2,
      },
      {
        ...createStarterQuests()[0]!,
        id: "quest_hidden",
        title: "Find the hidden forge bell",
        discoveredAtTurn: null,
      },
    ],
    npcs: [
      {
        ...createStarterNpcs()[0]!,
        discoveredAtTurn: 1,
      },
      {
        ...createStarterNpcs()[1]!,
        id: "npc_hidden",
        name: "Silent Wren",
        role: "Informer",
        discoveredAtTurn: null,
      },
    ],
    clues: [
      {
        ...createStarterClues()[0]!,
        status: "discovered",
        discoveredAtTurn: 5,
      },
      createStarterClues()[1]!,
      createStarterClues()[2]!,
    ],
    recentResolvedTurns,
    latestResolvedTurnId: recentResolvedTurns[0]!.id,
    canRetryLatestTurn: true,
  });

  const context = await getPromptContext(snapshot);

  assert.deepEqual(context.activeQuests.map((quest) => quest.id), ["quest_known"]);
  assert.deepEqual(context.hiddenQuests.map((quest) => quest.id), ["quest_hidden"]);
  assert.equal(context.companion?.id, createStarterNpcs()[0]!.id);
  assert.deepEqual(context.hiddenNpcs.map((npc) => npc.id), ["npc_hidden"]);
  assert.deepEqual(context.discoveryCandidates.quests, [
    {
      id: "quest_hidden",
      title: "Find the hidden forge bell",
    },
  ]);
  assert.deepEqual(context.discoveryCandidates.npcs, [
    {
      id: "npc_hidden",
      name: "Silent Wren",
      role: "Informer",
    },
  ]);
  assert.deepEqual(context.discoveredClues.map((clue) => clue.id), ["clue_hammer_marks"]);
  assert.deepEqual(
    context.recentTurnLedger,
    buildRecentTurnLedger(snapshot.state.turnCount, recentResolvedTurns),
  );
  assert.equal(context.promptSceneSummary, snapshot.state.sceneState.summary);
});

test("recent transcript snapshots should keep the latest 30 messages in reading order", () => {
  const messages = Array.from({ length: 35 }, (_, index) => ({
    id: `message_${index + 1}`,
    role: "assistant" as const,
    kind: "narration" as const,
    content: `Message ${index + 1}`,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
  }));

  const latestThirty = orderRecentMessages(messages, 30);

  assert.deepEqual(
    latestThirty.map((message) => message.id),
    [
      "message_6",
      "message_7",
      "message_8",
      "message_9",
      "message_10",
      "message_11",
      "message_12",
      "message_13",
      "message_14",
      "message_15",
      "message_16",
      "message_17",
      "message_18",
      "message_19",
      "message_20",
      "message_21",
      "message_22",
      "message_23",
      "message_24",
      "message_25",
      "message_26",
      "message_27",
      "message_28",
      "message_29",
      "message_30",
      "message_31",
      "message_32",
      "message_33",
      "message_34",
      "message_35",
    ],
  );
});

test("toPlayerCampaignSnapshot exposes known locations without leaking hidden state locations", () => {
  const snapshot = createSnapshot({
    state: {
      ...createSnapshot().state,
      knownLocations: ["Briar Glen", "Old Smithy"],
      locations: ["Briar Glen", "Old Smithy", "Lantern Catacombs"],
    },
    npcs: [
      {
        ...createStarterNpcs()[0]!,
        discoveredAtTurn: 0,
      },
    ],
  });

  const playerSnapshot = toPlayerCampaignSnapshot(snapshot);

  assert.deepEqual(playerSnapshot.knownLocations, ["Briar Glen", "Old Smithy"]);
  assert.equal("locations" in playerSnapshot, false);
});
