import assert from "node:assert/strict";
import test from "node:test";
import {
  createStarterArcs,
  createStarterBlueprint,
  createStarterCharacter,
  createStarterClues,
  createStarterNpcs,
  createStarterQuests,
  createStarterState,
} from "./starter-data";
import { validateDelta } from "./validation";

function createValidationFixture() {
  const blueprint = createStarterBlueprint();
  const state = createStarterState(blueprint);
  const character = createStarterCharacter();
  const quests = createStarterQuests();
  const arcs = createStarterArcs();
  const clues = createStarterClues();
  const npcs = createStarterNpcs();

  return {
    blueprint,
    state,
    character,
    quests,
    arcs,
    clues,
    npcs,
  };
}

test("validateDelta accepts valid updates with indexed lookups", () => {
  const fixture = createValidationFixture();
  const result = validateDelta({
    ...fixture,
    proposedDelta: {
      activeArcId: fixture.arcs[0].id,
      healthDelta: -2,
      rewardQuestId: fixture.quests[0].id,
      questAdvancements: [
        {
          questId: fixture.quests[0].id,
          nextStage: 1,
          status: "completed",
        },
      ],
      questDiscoveries: [fixture.quests[0].id],
      clueDiscoveries: fixture.clues.map((clue) => clue.id),
      revealTriggers: [fixture.blueprint.hiddenReveals[0]!.id],
      arcAdvancements: [
        {
          arcId: fixture.arcs[0].id,
          currentTurnDelta: 1,
          status: "active",
        },
      ],
      npcApprovalChanges: [
        {
          npcId: fixture.npcs[0].id,
          approvalDelta: 2,
          reason: "Shared the danger.",
        },
      ],
      npcDiscoveries: [fixture.npcs[1].id],
    },
  });

  assert.deepEqual(result.warnings, []);
  assert.equal(result.nextState.turnCount, fixture.state.turnCount + 1);
  assert.equal(result.nextState.activeArcId, fixture.arcs[0].id);
  assert.equal(result.nextCharacter.health, fixture.character.health - 2);
  assert.equal(result.nextCharacter.gold, fixture.character.gold + fixture.quests[0]!.rewardGold);
  assert.deepEqual(result.nextCharacter.inventory, [
    ...fixture.character.inventory,
    fixture.quests[0]!.rewardItem!,
  ]);
  assert.deepEqual(result.acceptedQuestAdvancements, [
    {
      questId: fixture.quests[0]!.id,
      nextStage: 1,
      status: "completed",
    },
  ]);
  assert.deepEqual(result.acceptedQuestDiscoveries, [fixture.quests[0]!.id]);
  assert.deepEqual(result.acceptedClueDiscoveries, fixture.clues.map((clue) => clue.id));
  assert.deepEqual(result.acceptedRevealTriggers, [fixture.blueprint.hiddenReveals[0]!.id]);
  assert.deepEqual(result.acceptedArcAdvancements, [
    {
      arcId: fixture.arcs[0]!.id,
      currentTurnDelta: 1,
      status: "active",
    },
  ]);
  assert.deepEqual(result.acceptedNpcChanges, [
    {
      npcId: fixture.npcs[0]!.id,
      approvalDelta: 2,
      reason: "Shared the danger.",
    },
  ]);
  assert.deepEqual(result.acceptedNpcDiscoveries, [fixture.npcs[1]!.id]);
  assert.deepEqual(result.nextState.activeRevealIds, [fixture.blueprint.hiddenReveals[0]!.id]);
  assert.deepEqual(result.nextState.discoveredSceneLocations, fixture.state.discoveredSceneLocations);
  assert.deepEqual(
    result.nextState.discoveredKeyLocationNames,
    fixture.state.discoveredKeyLocationNames,
  );
});

test("validateDelta preserves rejection semantics for invalid and duplicate updates", () => {
  const fixture = createValidationFixture();
  const result = validateDelta({
    ...fixture,
    proposedDelta: {
      activeArcId: "arc_missing",
      goldChange: 10,
      inventoryChanges: {
        add: ["forbidden relic"],
      },
      questAdvancements: [
        {
          questId: fixture.quests[0]!.id,
          nextStage: fixture.quests[0]!.stage + 2,
        },
        {
          questId: "quest_missing",
          nextStage: 1,
        },
      ],
      questDiscoveries: [fixture.quests[0]!.id, fixture.quests[0]!.id, "quest_missing"],
      clueDiscoveries: ["clue_missing"],
      revealTriggers: [fixture.blueprint.hiddenReveals[0]!.id, "reveal_missing"],
      arcAdvancements: [
        {
          arcId: "arc_missing",
          currentTurnDelta: 1,
        },
      ],
      npcApprovalChanges: [
        {
          npcId: "npc_missing",
          approvalDelta: 1,
          reason: "No such NPC.",
        },
      ],
      npcDiscoveries: [fixture.npcs[0]!.id, fixture.npcs[0]!.id, "npc_missing"],
    },
  });

  assert.equal(result.nextState.activeArcId, fixture.state.activeArcId);
  assert.deepEqual(result.acceptedQuestAdvancements, []);
  assert.deepEqual(result.acceptedQuestDiscoveries, [fixture.quests[0]!.id]);
  assert.deepEqual(result.acceptedClueDiscoveries, []);
  assert.deepEqual(result.acceptedRevealTriggers, []);
  assert.deepEqual(result.acceptedArcAdvancements, []);
  assert.deepEqual(result.acceptedNpcChanges, []);
  assert.deepEqual(result.acceptedNpcDiscoveries, [fixture.npcs[0]!.id]);
  assert.equal(result.awardedGold, 0);
  assert.deepEqual(result.acceptedInventoryChanges, { add: [], remove: [] });
  assert.ok(
    result.warnings.some((warning) => warning.includes("Rejected active arc update for unknown arc arc_missing.")),
  );
  assert.ok(
    result.warnings.some((warning) => warning.includes("Rejected invalid quest stage jump")),
  );
  assert.ok(
    result.warnings.some((warning) => warning.includes("Rejected quest advancement for unknown quest quest_missing.")),
  );
  assert.ok(
    result.warnings.some((warning) => warning.includes("Rejected unknown quest discovery quest_missing.")),
  );
  assert.ok(
    result.warnings.some((warning) => warning.includes("Rejected gold gain without a validated quest reward source.")),
  );
  assert.ok(
    result.warnings.some((warning) => warning.includes("Rejected direct inventory mutation.")),
  );
  assert.ok(
    result.warnings.some((warning) => warning.includes("Rejected unknown clue discovery clue_missing.")),
  );
  assert.ok(
    result.warnings.some((warning) => warning.includes("Rejected premature reveal")),
  );
  assert.ok(
    result.warnings.some((warning) => warning.includes("Rejected unknown reveal reveal_missing.")),
  );
  assert.ok(
    result.warnings.some((warning) => warning.includes("Rejected arc update for unknown arc arc_missing.")),
  );
  assert.ok(
    result.warnings.some((warning) => warning.includes("Rejected NPC approval change for npc_missing.")),
  );
  assert.ok(
    result.warnings.some((warning) => warning.includes("Rejected unknown NPC discovery npc_missing.")),
  );
});

test("validateDelta records a newly discovered scene location once", () => {
  const fixture = createValidationFixture();
  const result = validateDelta({
    ...fixture,
    proposedDelta: {
      sceneLocation: "Old Smithy",
    },
  });

  assert.equal(result.nextState.sceneState.location, "Old Smithy");
  assert.deepEqual(result.nextState.discoveredSceneLocations, [
    ...fixture.state.discoveredSceneLocations,
    "Old Smithy",
  ]);
});

test("validateDelta reuses established scene locations without duplicating discovered scene entries", () => {
  const fixture = createValidationFixture();
  const result = validateDelta({
    ...fixture,
    proposedDelta: {
      sceneTitle: "Ash Market Under Watch",
      sceneLocation: fixture.state.discoveredSceneLocations[0],
    },
  });

  assert.equal(result.nextState.sceneState.location, fixture.state.discoveredSceneLocations[0]);
  assert.deepEqual(result.nextState.discoveredSceneLocations, fixture.state.discoveredSceneLocations);
});

test("validateDelta accepts normalized key-anchor matches and rewrites them to the canonical display name", () => {
  const fixture = createValidationFixture();
  const result = validateDelta({
    ...fixture,
    proposedDelta: {
      sceneKeyLocation: " ash market ",
      keyLocationDiscoveries: ["old smithy "],
    },
  });

  assert.equal(result.nextState.sceneState.keyLocationName, "Ash Market");
  assert.deepEqual(result.nextState.discoveredKeyLocationNames, ["Ash Market", "Old Smithy"]);
});

test("validateDelta rejects unknown key anchors", () => {
  const fixture = createValidationFixture();
  const result = validateDelta({
    ...fixture,
    proposedDelta: {
      sceneKeyLocation: "Unknown Dock",
      keyLocationDiscoveries: ["Missing Shrine"],
    },
  });

  assert.equal(result.nextState.sceneState.keyLocationName, fixture.state.sceneState.keyLocationName);
  assert.ok(
    result.warnings.some((warning) => warning.includes("Rejected unknown scene key location Unknown Dock.")),
  );
  assert.ok(
    result.warnings.some((warning) => warning.includes("Rejected unknown key location discovery Missing Shrine.")),
  );
});
