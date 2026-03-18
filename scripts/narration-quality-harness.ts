import { auditNarration } from "../src/lib/ai/narration-audit";
import { dmClient } from "../src/lib/ai/provider";
import { LocalDungeonMaster } from "../src/lib/ai/local-provider";
import {
  createDefaultAdventureModuleSetup,
  createDefaultCharacterTemplate,
  createStarterArcs,
  createStarterBlueprint,
  createStarterClues,
  createStarterNpcs,
  createStarterQuests,
  createStarterState,
} from "../src/lib/game/starter-data";
import { getStaleClues } from "../src/lib/game/reveals";
import type { CheckResult, PromptContext } from "../src/lib/game/types";

type HarnessProvider = {
  generateCampaignOpening: typeof dmClient.generateCampaignOpening;
  triageTurn: typeof dmClient.triageTurn;
  resolveTurn: typeof dmClient.resolveTurn;
};

function buildPromptContext(): PromptContext {
  const blueprint = createStarterBlueprint();
  const state = createStarterState(blueprint);
  const arcs = createStarterArcs();
  const clues = createStarterClues();

  return {
    scene: state.sceneState,
    activeArc: arcs[0],
    activeQuests: [],
    hiddenQuests: createStarterQuests(),
    unresolvedHooks: state.hooks,
    recentCanon: [
      "DM: The ledger thumps against your ribs while fog slides over the dock lamps.",
      "Player: I vanish up the wall and prepare an ambush from the roofline.",
      "DM: The ledger weighs in your satchel as the pursuers pause below.",
    ],
    relevantClues: clues,
    staleClues: getStaleClues(clues, state.turnCount),
    eligibleRevealIds: [],
    eligibleRevealTexts: [],
    companion: null,
    hiddenNpcs: createStarterNpcs(),
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

async function runProviderChecks(name: string, provider: HarnessProvider, failures: string[]) {
  const character = { ...createDefaultCharacterTemplate(), id: "harness_template" };
  const opening = await provider.generateCampaignOpening({
    setup: createDefaultAdventureModuleSetup(),
    character,
  });
  const openingAudit = auditNarration({
    mode: "opening",
    narration: opening.narration,
  });
  assertCase(
    !openingAudit.issues.some((issue) =>
      ["opening_recap", "player_psychology", "editorial_closer"].includes(issue.code),
    ),
    `${name}: opening narration triggered audit issues (${openingAudit.issues.map((issue) => issue.code).join(", ") || "none"}).`,
    failures,
  );

  const blueprint = createStarterBlueprint();
  const promptContext = buildPromptContext();
  const ambushAction = "I tail the veteran enforcer and spring the ambush the moment he clears the corner.";
  const triage = await provider.triageTurn({
    blueprint,
    promptContext,
    playerAction: ambushAction,
  });

  if (!triage.requiresCheck && triage.narration) {
    const triageAudit = auditNarration({
      mode: "triage",
      narration: triage.narration,
      playerAction: ambushAction,
      recentCanon: promptContext.recentCanon,
    });
    assertCase(
      !triageAudit.issues.some((issue) => issue.code === "action_deferral"),
      `${name}: ambush narration still deferred the declared action.`,
      failures,
    );
  }

  const observationAction =
    "While he pauses at the junction, I study the enforcer's footing and look for the easier opening.";
  const checkResult: CheckResult = {
    stat: "intellect",
    mode: "normal",
    reason: "Sizing up the target",
    rolls: [12, 12],
    modifier: 1,
    total: 13,
    outcome: "success",
    consequences: ["You spot the weak side of the veteran's route."],
  };
  const resolution = await provider.resolveTurn({
    blueprint,
    promptContext,
    playerAction: observationAction,
    checkResult,
  });
  const resolutionAudit = auditNarration({
    mode: "resolution",
    narration: resolution.narration,
    playerAction: observationAction,
    recentCanon: promptContext.recentCanon,
  });
  assertCase(
    !resolutionAudit.issues.some((issue) =>
      ["summary_ending", "player_psychology", "editorial_closer"].includes(issue.code),
    ),
    `${name}: observation resolution triggered audit issues (${resolutionAudit.issues.map((issue) => issue.code).join(", ") || "none"}).`,
    failures,
  );
  assertCase(
    resolution.suggestedActions.every(
      (action) => action.trim().toLowerCase() !== observationAction.trim().toLowerCase(),
    ),
    `${name}: observation resolution repeated the exact player action in suggested actions.`,
    failures,
  );
}

async function main() {
  const failures: string[] = [];

  const staticCases = [
    {
      label: "psychological feel should fail",
      result: auditNarration({
        mode: "triage",
        narration: "You feel confident knowing you have handled worse.",
        playerAction: "I draw my dagger.",
      }),
      expectIssue: "player_psychology",
    },
    {
      label: "physical feel should pass",
      result: auditNarration({
        mode: "triage",
        narration: "You feel the cold through your coat as the rain whips off the harbor.",
        playerAction: "I wait by the rail.",
      }),
      expectIssue: null,
    },
    {
      label: "editorial closer should fail",
      result: auditNarration({
        mode: "resolution",
        narration:
          "The enforcer staggers into the fish crates and curses. The night is always watching.",
        playerAction: "I shove him into the crates.",
      }),
      expectIssue: "editorial_closer",
    },
    {
      label: "repeated key item should fail",
      result: auditNarration({
        mode: "triage",
        narration: "The ledger weighs at your side again as the guard closes in.",
        playerAction: "I draw the guard away from the alley.",
        recentCanon: [
          "DM: The ledger weighs in your satchel while the docks close around you.",
          "DM: The ledger presses against your ribs as the bell tolls.",
        ],
      }),
      expectIssue: "repeated_key_item",
    },
  ];

  for (const testCase of staticCases) {
    const codes = testCase.result.issues.map((issue) => issue.code);
    if (testCase.expectIssue) {
      assertCase(
        codes.includes(testCase.expectIssue as never),
        `Static case failed: ${testCase.label}.`,
        failures,
      );
    } else {
      assertCase(codes.length === 0, `Static case failed: ${testCase.label}.`, failures);
    }
  }

  await runProviderChecks("local", new LocalDungeonMaster(), failures);

  if (process.env.OPENROUTER_API_KEY) {
    await runProviderChecks("openrouter", dmClient, failures);
  }

  console.log(
    JSON.stringify(
      {
        provider: process.env.OPENROUTER_API_KEY ? "local+openrouter" : "local",
        staticCases: staticCases.length,
        failures,
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
