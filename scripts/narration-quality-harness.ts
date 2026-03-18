import {
  auditNarration,
  auditRenderedNarration,
  validateBeatPlan,
} from "../src/lib/ai/narration-audit";
import { dmClient } from "../src/lib/ai/provider";
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
  const quests = createStarterQuests();
  const npcs = createStarterNpcs();

  return {
    scene: state.sceneState,
    promptSceneSummary:
      "You are on the dockside roofline above a narrow alley while two enforcers search below and the nearest veteran is approaching the junction.",
    activeArc: arcs[0],
    activeQuests: [],
    hiddenQuests: quests,
    recentTurnLedger: [
      '[Turn 2] Action: "I vanish up the wall and prepare an ambush from the roofline." | Roll: agility success (13) | HP: 0 | Discoveries: none | SceneChanged: yes',
    ],
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
    isInvestigative: true,
  });
  const resolutionAudit = auditNarration({
    mode: "resolution",
    narration: resolution.narration,
    playerAction: observationAction,
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
      label: "repeated key item within narration should fail",
      result: auditNarration({
        mode: "triage",
        narration: "The ledger thumps against the chair leg, and the ledger's clasp clicks softly as you set it down.",
        playerAction: "I draw the guard away from the alley.",
      }),
      expectIssue: "repeated_key_item",
    },
    {
      label: "single key item mention without action relevance should fail",
      result: auditNarration({
        mode: "triage",
        narration: "You set the ledger on the table and listen to the tavern below.",
        playerAction: "I bar the door and listen for footsteps on the stairs.",
      }),
      expectIssue: "repeated_key_item",
    },
    {
      label: "single key item mention with direct action relevance should pass",
      result: auditNarration({
        mode: "triage",
        narration: "You slide the ledger beneath the mattress and pull the blanket smooth over it.",
        playerAction: "I hide it beneath the bed before anyone comes upstairs.",
      }),
      expectIssue: null,
    },
  ];

  const beatCases = [
    {
      label: "planner should block irrelevant key item surfacing",
      result: validateBeatPlan({
        mode: "triage",
        playerAction: "I bar the door and listen for footsteps on the stairs.",
        actionResolution: "You set the ledger on the table and listen for movement beyond the door.",
        suggestedActionGoals: [
          { goal: "fortify the room", target: null },
          { goal: "check the stairwell", target: null },
        ],
        requiresCheck: false,
      }),
      expectSeverity: "block",
      expectIssue: "irrelevant_key_item",
    },
    {
      label: "planner should accept direct handling through pronoun actions",
      result: validateBeatPlan({
        mode: "triage",
        playerAction: "I hide it beneath the bed before anyone comes upstairs.",
        actionResolution: "You slide the ledger beneath the mattress and smooth the blanket over it.",
        suggestedActionGoals: [
          { goal: "wait for the hallway to settle", target: null },
          { goal: "leave before dawn", target: null },
        ],
        requiresCheck: false,
      }),
      expectSeverity: "clean",
      expectIssue: null,
    },
    {
      label: "renderer should block contradictions with the beat plan",
      result: auditRenderedNarration({
        mode: "triage",
        narration: "You wait in the dark and plan your next move.",
        playerAction: "I spring the ambush the moment he clears the corner.",
        actionResolution: "You catch the veteran by the collar and slam him into the stacked crates.",
        directlyHandledItems: [],
        suggestedActions: [
          "Pin him before he can shout",
          "Search him for orders",
        ],
      }),
      expectSeverity: "block",
      expectIssue: "beat_contradiction",
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

  for (const testCase of beatCases) {
    assertCase(
      testCase.result.highestSeverity === testCase.expectSeverity,
      `Beat case failed: ${testCase.label}.`,
      failures,
    );
    const codes = testCase.result.issues.map((issue) => issue.code);
    if (testCase.expectIssue) {
      assertCase(
        codes.includes(testCase.expectIssue as never),
        `Beat case failed: ${testCase.label}.`,
        failures,
      );
    }
  }

  if (process.env.OPENROUTER_API_KEY) {
    await runProviderChecks("openrouter", dmClient, failures);
  }

  console.log(
    JSON.stringify(
      {
        provider: process.env.OPENROUTER_API_KEY ? "openrouter" : "not_configured",
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
