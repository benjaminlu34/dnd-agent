import "./load-env";
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
import type { CampaignCharacter, PromptContext } from "../src/lib/game/types";

const character: CampaignCharacter = {
  id: "harness_char",
  templateId: "harness_char",
  instanceId: "harness_instance",
  name: "Harness Hero",
  archetype: "Test Pilgrim",
  strength: 1,
  dexterity: 1,
  constitution: 1,
  intelligence: 1,
  wisdom: 1,
  charisma: 0,
  stats: {
    strength: 1,
    dexterity: 1,
    constitution: 1,
    intelligence: 1,
    wisdom: 1,
    charisma: 0,
  },
  health: 12,
  maxHealth: 12,
  gold: 0,
  inventory: [],
  backstory: "A contract harness protagonist built to sanity-check the DM outputs.",
  starterItems: [],
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
  const quests = createStarterQuests();
  const npcs = createStarterNpcs();

  return {
    scene: state.sceneState,
    inventory: [],
    keyLocations: blueprint.keyLocations,
    discoveredKeyLocations: blueprint.keyLocations.filter((location) =>
      state.discoveredKeyLocationNames.includes(location.name),
    ),
    recentSceneTrail: [],
    promptSceneSummary:
      "You are in the market square with a blood-red notice nailed to the post while townsfolk keep their distance.",
    activeArc: arcs[0],
    activeQuests: [],
    hiddenQuests: quests,
    recentTurnLedger: [
      '[Turn 1] Action: "Inspect the eclipse notice carefully." | Roll: none | HP: 0 | Discoveries: none | SceneChanged: no',
    ],
    narrativeSummary:
      "You arrived in the market square with the eclipse notice still fresh on the post and the town watching from a careful distance.",
    relevantClues: clues,
    staleClues: getStaleClues(clues, state.turnCount),
    eligibleRevealIds: [],
    discoveredClues: clues.filter((clue) => clue.status === "discovered"),
    companion: null,
    hiddenNpcs: npcs,
    discoveryCandidates: {
      quests: quests.map((quest) => ({
        id: quest.id,
        title: quest.title,
      })),
      npcs: npcs.map((npc) => ({
        id: npc.id,
        name: npc.name,
        role: npc.role,
      })),
    },
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
        isInvestigative: triage.isInvestigative,
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
