import "./load-env";
import {
  buildOutcomeUserPrompt,
  buildTriageUserPrompt,
} from "../src/lib/game/prompts";
import {
  createStarterArcs,
  createStarterBlueprint,
  createStarterClues,
  createStarterNpcs,
  createStarterQuests,
  createStarterState,
} from "../src/lib/game/starter-data";
import type { PromptContext } from "../src/lib/game/types";

function buildPromptContext(): PromptContext {
  const blueprint = createStarterBlueprint();
  const state = createStarterState(blueprint);
  const arcs = createStarterArcs();
  const clues = createStarterClues();
  const quests = createStarterQuests();
  const npcs = createStarterNpcs();

  return {
    scene: state.sceneState,
    keyLocations: blueprint.keyLocations,
    discoveredKeyLocations: blueprint.keyLocations.filter((location) =>
      state.discoveredKeyLocationNames.includes(location.name),
    ),
    recentSceneTrail: [],
    promptSceneSummary:
      "You are in the bell square facing a boarded smithy while townsfolk hang back and a single watcher studies the notice post.",
    activeArc: arcs[0],
    activeQuests: [],
    hiddenQuests: quests,
    recentTurnLedger: [
      '[Turn 5] Action: "I inspect the notice post for tampering." | Roll: intelligence success (13) | HP: 0 | Discoveries: clue_red_notice | SceneChanged: yes',
      '[Turn 6] Action: "I circle the boarded smithy and listen at the rear door." | Roll: none | HP: 0 | Discoveries: none | SceneChanged: no',
    ],
    narrativeSummary:
      "Previously, you traced tampering at the notice post and confirmed someone has been moving around the boarded smithy after dark.",
    relevantClues: clues,
    staleClues: [],
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

function assertCase(condition: boolean, message: string, failures: string[]) {
  if (!condition) {
    failures.push(message);
  }
}

async function main() {
  const blueprint = createStarterBlueprint();
  const promptContext = buildPromptContext();
  const failures: string[] = [];

  const triagePrompt = buildTriageUserPrompt({
    blueprint,
    promptContext,
    playerAction: "I question the blacksmith's apprentice about who boarded the shop.",
  });

  const resolvePrompt = buildOutcomeUserPrompt({
    blueprint,
    promptContext,
    playerAction: "I inspect the smithy's rear door for signs of forced entry.",
    checkResult: {
      stat: "intelligence",
      mode: "normal",
      reason: "Inspecting the rear door",
      rolls: [12, 12],
      modifier: 1,
      total: 13,
      outcome: "success",
      consequences: ["You spot recent pry marks under the latch."],
    },
    isInvestigative: true,
  });

  assertCase(
    triagePrompt.includes("RECENT TURN LEDGER") && !triagePrompt.includes("RECENT CANON"),
    "Triage prompt still uses RECENT CANON instead of RECENT TURN LEDGER.",
    failures,
  );
  assertCase(
    !triagePrompt.includes("Villain:") && !triagePrompt.includes("UNRESOLVED HOOKS"),
    "Triage prompt still includes global narrative noise.",
    failures,
  );
  assertCase(
    !triagePrompt.includes("DM:") && !triagePrompt.includes("The amulet weighs"),
    "Triage prompt still leaks raw assistant narration.",
    failures,
  );
  assertCase(
    triagePrompt.includes("quest:") && triagePrompt.includes("npc:"),
    "Triage prompt is missing compact discovery candidates.",
    failures,
  );
  assertCase(
    triagePrompt.includes("NARRATIVE CONTEXT"),
    "Triage prompt is missing the narrative summary block.",
    failures,
  );
  assertCase(
    resolvePrompt.includes("DISCOVERY CANDIDATES") &&
      !resolvePrompt.includes("ELIGIBLE REVEALS") &&
      !resolvePrompt.includes("HIDDEN QUESTS AVAILABLE TO DISCOVER"),
    "Resolve prompt still includes old reveal or hidden-summary sections.",
    failures,
  );
  assertCase(
    resolvePrompt.includes("NARRATIVE CONTEXT"),
    "Resolve prompt is missing the narrative summary block.",
    failures,
  );

  console.log(
    JSON.stringify(
      {
        failures,
        triagePromptPreview: triagePrompt.slice(0, 500),
        resolvePromptPreview: resolvePrompt.slice(0, 500),
      },
      null,
      2,
    ),
  );

  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
