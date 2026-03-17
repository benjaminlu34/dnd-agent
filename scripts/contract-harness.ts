import { dmClient } from "../src/lib/ai/provider";
import {
  createStarterArcs,
  createStarterBlueprint,
  createStarterClues,
  createStarterNpcs,
  createStarterQuests,
  createStarterState,
} from "../src/lib/game/starter-data";
import { getStaleClues } from "../src/lib/game/reveals";
import { rollCheck } from "../src/lib/game/checks";
import type { CharacterSheet, PromptContext } from "../src/lib/game/types";

const character: CharacterSheet = {
  id: "harness_char",
  templateId: "harness_char",
  instanceId: "harness_instance",
  name: "Harness Hero",
  archetype: "Test Pilgrim",
  strength: 1,
  agility: 1,
  intellect: 1,
  charisma: 0,
  vitality: 1,
  stats: {
    strength: 1,
    agility: 1,
    intellect: 1,
    charisma: 0,
    vitality: 1,
  },
  health: 12,
  maxHealth: 12,
  gold: 0,
  inventory: [],
  backstory: "A contract harness protagonist built to sanity-check the DM outputs.",
};

const actions = [
  "Inspect the eclipse notice for hidden script",
  "Question the bell-warden about the missing blacksmith",
  "Force the boarded smithy door",
  "Sneak through the alley behind the square",
  "Call on Lark to watch the roofline",
];

function buildPromptContext(): PromptContext {
  const blueprint = createStarterBlueprint();
  const state = createStarterState(blueprint);
  const arcs = createStarterArcs();
  const clues = createStarterClues();

  return {
    scene: state.sceneState,
    activeArc: arcs[0],
    activeQuests: createStarterQuests(),
    unresolvedHooks: state.hooks,
    recentCanon: [
      "DM: Wind rattles brass prayer bells while the market square clears around a blood-red notice.",
      "Player: Inspect the eclipse notice carefully.",
    ],
    relevantClues: clues,
    staleClues: getStaleClues(clues, state.turnCount),
    eligibleRevealIds: [],
    eligibleRevealTexts: [],
    companion: createStarterNpcs().find((npc) => npc.isCompanion) ?? null,
    villainClock: state.villainClock,
    tensionScore: state.tensionScore,
    arcPacingHint: null,
  };
}

async function main() {
  const blueprint = createStarterBlueprint();
  const promptContext = buildPromptContext();
  let malformed = 0;
  let checks = 0;

  for (let index = 0; index < 30; index += 1) {
    const action = actions[index % actions.length]!;

    const triage = await dmClient.triageTurn({
      blueprint,
      promptContext,
      playerAction: action,
    });

    if (!triage || typeof triage.requiresCheck !== "boolean") {
      malformed += 1;
      continue;
    }

    if (triage.requiresCheck && triage.check) {
      checks += 1;
      const result = rollCheck({
        stat: triage.check.stat,
        mode: triage.check.mode,
        reason: triage.check.reason,
        character,
      });

      const resolution = await dmClient.resolveTurn({
        blueprint,
        promptContext,
        playerAction: action,
        checkResult: result,
      });

      if (!resolution || !Array.isArray(resolution.suggestedActions)) {
        malformed += 1;
      }
    }
  }

  console.log(
    JSON.stringify(
      {
        runs: 30,
        malformedPayloads: malformed,
        checks,
        provider: process.env.OPENROUTER_API_KEY ? "openrouter" : "local",
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
