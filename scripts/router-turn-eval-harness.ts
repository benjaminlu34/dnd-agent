import "./load-env";
import { dmClient } from "../src/lib/ai/provider";
import { validateTurnCommand } from "../src/lib/game/validation";
import type {
  CampaignCharacter,
  RequestClarificationToolCall,
  ResolveMechanicsResponse,
  RouterDecision,
  SpatialPromptContext,
  StateCommitLog,
  TurnFetchToolResult,
  TurnRouterContext,
} from "../src/lib/game/types";

function assertOpenRouterConfigured() {
  if (!process.env.OPENROUTER_API_KEY && !process.env.OPENROUTER_API_KEY_2) {
    throw new Error(
      "router-turn-eval-harness requires OPENROUTER_API_KEY or OPENROUTER_API_KEY_2. Local fallback providers are not supported.",
    );
  }
}

const baseCharacter: CampaignCharacter = {
  id: "char_eval",
  templateId: "char_eval",
  instanceId: "inst_eval",
  name: "Thurik Stoneanvil",
  archetype: "Smith",
  strength: 2,
  dexterity: 1,
  constitution: 2,
  intelligence: 1,
  wisdom: 1,
  charisma: 0,
  stats: {
    strength: 2,
    dexterity: 1,
    constitution: 2,
    intelligence: 1,
    wisdom: 1,
    charisma: 0,
  },
  health: 12,
  maxHealth: 12,
  gold: 3,
  inventory: [],
  commodityStacks: [],
  backstory: "A smith used to making practical calls under pressure.",
  starterItems: [],
};

const basePromptContext: SpatialPromptContext = {
  currentLocation: {
    id: "loc_smithy",
    name: "Anvil & Ember Smithy",
    type: "shop",
    summary: "A hot forge, a crowded bench, and open doors to the waking street.",
    state: "active",
  },
  adjacentRoutes: [
    {
      id: "edge_smithy_market",
      targetLocationId: "loc_market",
      targetLocationName: "Trades Ward Market",
      travelTimeMinutes: 10,
      dangerLevel: 1,
      currentStatus: "open",
      description: null,
    },
  ],
  sceneActors: [
    {
      actorRef: "npc:npc_mira",
      kind: "npc",
      displayLabel: "Mira Brightstone",
      role: "baker",
      detailFetchHint: null,
      lastSummary: "A practical baker with warm loaves under cloth.",
    },
    {
      actorRef: "temp:temp_apprentice",
      kind: "temporary_actor",
      displayLabel: "apprentice",
      role: "apprentice",
      detailFetchHint: null,
      lastSummary: "A young apprentice waits near the coal bin for instructions.",
    },
  ],
  recentLocalEvents: [],
  recentTurnLedger: [],
  discoveredInformation: [],
  activePressures: [],
  recentWorldShifts: [],
  activeThreads: [],
  inventory: [
    {
      kind: "item",
      id: "item_scrap_iron",
      name: "Scrap Iron",
      description: "Bent offcuts stacked beneath the bench.",
      quantity: 2,
    },
  ],
  sceneAspects: {
    forge_heat: {
      label: "forge heat",
      state: "The forge is already burning hot.",
      duration: "scene",
    },
  },
  localTexture: null,
  globalTime: 480,
  timeOfDay: "morning",
  dayCount: 1,
};

const baseRouterContext: TurnRouterContext = {
  currentLocation: basePromptContext.currentLocation,
  adjacentRoutes: basePromptContext.adjacentRoutes,
  sceneActors: basePromptContext.sceneActors,
  recentLocalEvents: [],
  recentTurnLedger: [],
  discoveredInformation: [],
  activePressures: [],
  activeThreads: [],
  inventory: [
    {
      templateId: "item_scrap_iron",
      name: "Scrap Iron",
      quantity: 2,
    },
  ],
  sceneAspects: [
    {
      key: "forge_heat",
      label: "forge heat",
      state: "The forge is already burning hot.",
      duration: "scene",
    },
  ],
  gold: 3,
};

type EvalFixture = {
  id: string;
  action: string;
  routerContext?: TurnRouterContext;
  promptContext?: SpatialPromptContext;
  fetchedFacts?: TurnFetchToolResult[];
  expectClarification?: boolean;
  expectNamedNpcReuse?: boolean;
  expectNonTimeMutation?: boolean;
  expectNoNamedNpcLocalInteraction?: boolean;
  syntheticNarrationLog?: StateCommitLog;
  expectNoQuotedNarrationOnRejectedOnly?: boolean;
};

const fixtures: EvalFixture[] = [
  {
    id: "clarify_ambiguous_attack",
    action: "I attack him.",
    expectClarification: true,
  },
  {
    id: "clarify_underspecified_purchase",
    action: "I buy it from her.",
    expectClarification: true,
  },
  {
    id: "named_npc_grounding",
    action: "I call over Mira Brightstone and ask for a loaf before the rush.",
    expectNamedNpcReuse: true,
    expectNoNamedNpcLocalInteraction: true,
  },
  {
    id: "temporary_actor_grounding",
    action: "I tell the apprentice to fetch another scoop of coal.",
    expectNoNamedNpcLocalInteraction: true,
  },
  {
    id: "offscreen_return_helper",
    action: "I wait until the apprentice comes back from the coal yard.",
    expectNoNamedNpcLocalInteraction: true,
  },
  {
    id: "route_grounding",
    action: "I head to the Trades Ward Market.",
    expectNoNamedNpcLocalInteraction: true,
  },
  {
    id: "downtime_smithing",
    action: "I start hammering horseshoes to fill the orders due today.",
    expectNonTimeMutation: true,
  },
  {
    id: "spawn_environmental_item",
    action: "I grab a loose tong from the bench and use it to steady the iron.",
    expectNonTimeMutation: true,
  },
  {
    id: "spawn_scene_aspect",
    action: "I crack the vent and clear the thick forge smoke.",
    expectNonTimeMutation: true,
  },
  {
    id: "spawn_plausible_local",
    action: "A stableboy rushes in with a limping mare and I hear him out.",
    expectNonTimeMutation: true,
  },
  {
    id: "spawn_plausible_item",
    action: "I pick up a leather strap from the cluttered bench and lash the grip tight.",
    expectNonTimeMutation: true,
  },
  {
    id: "rejected_named_npc_narration",
    action: "I ask Mira Brightstone for a loaf.",
    syntheticNarrationLog: [
      {
        kind: "mutation",
        mutationType: "advance_time",
        status: "applied",
        reasonCode: "time_advanced",
        summary: "Time passes for 5 minutes.",
        metadata: {},
      },
      {
        kind: "mutation",
        mutationType: "record_local_interaction",
        status: "rejected",
        reasonCode: "invalid_target",
        summary: "That unnamed local is not available here.",
        metadata: {
          localEntityId: "npc:npc_mira",
        },
      },
    ],
    expectNoQuotedNarrationOnRejectedOnly: true,
  },
  {
    id: "failed_check_time_only_narration",
    action: "I try to force the sealed side chest open, then wait and listen.",
    syntheticNarrationLog: [
      {
        kind: "check",
        mutationType: null,
        status: "applied",
        reasonCode: "check_failure",
        summary: "STRENGTH failure (6)",
        metadata: {},
      },
      {
        kind: "mutation",
        mutationType: "advance_time",
        status: "applied",
        reasonCode: "time_advanced",
        summary: "Time passes for 10 minutes.",
        metadata: {},
      },
      {
        kind: "mutation",
        mutationType: "adjust_inventory",
        status: "rejected",
        reasonCode: "check_failed",
        summary: "You do not pry the chest open.",
        metadata: {},
      },
    ],
    expectNoQuotedNarrationOnRejectedOnly: true,
  },
  {
    id: "wait_non_arrival_narration",
    action: "I wait until the apprentice returns.",
    syntheticNarrationLog: [
      {
        kind: "mutation",
        mutationType: "advance_time",
        status: "applied",
        reasonCode: "time_advanced",
        summary: "Time passes for 20 minutes.",
        metadata: {},
      },
    ],
    expectNoQuotedNarrationOnRejectedOnly: true,
  },
];

async function main() {
  assertOpenRouterConfigured();

  const results = [];
  const summary = {
    total: fixtures.length,
    clarificationMatches: 0,
    namedNpcGroundingMatches: 0,
    downtimeGroundingMatches: 0,
    invalidNamedNpcLocalInteractions: 0,
    rejectedNarrationLeaks: 0,
  };

  for (const fixture of fixtures) {
    const routerDecision = await dmClient.classifyTurnIntent({
      playerAction: fixture.action,
      turnMode: "player_input",
      context: fixture.routerContext ?? baseRouterContext,
    });

    const result: Record<string, unknown> = {
      id: fixture.id,
      action: fixture.action,
      clarificationNeeded: routerDecision.clarification.needed,
      mustCheck: routerDecision.attention.mustCheck,
      resolvedReferents: routerDecision.attention.resolvedReferents,
      unresolvedReferents: routerDecision.attention.unresolvedReferents,
    };

    if (fixture.expectClarification != null) {
      const match = routerDecision.clarification.needed === fixture.expectClarification;
      result.clarificationMatch = match;
      if (match) {
        summary.clarificationMatches += 1;
      }
    }

    if (!routerDecision.clarification.needed) {
      const resolution = await dmClient.runTurn({
        promptContext: fixture.promptContext ?? basePromptContext,
        routerDecision,
        character: baseCharacter,
        playerAction: fixture.action,
        turnMode: "player_input",
        fetchedFacts: fixture.fetchedFacts ?? [],
      });
      const command = resolution.command;
      result.commandType = command.type;

      if (command.type === "resolve_mechanics") {
        const hasInvalidNamedNpcLocalInteraction = command.mutations.some(
          (mutation) =>
            mutation.type === "record_local_interaction" && mutation.localEntityId.startsWith("npc:"),
        );
        result.hasInvalidNamedNpcLocalInteraction = hasInvalidNamedNpcLocalInteraction;
        if (hasInvalidNamedNpcLocalInteraction) {
          summary.invalidNamedNpcLocalInteractions += 1;
        }

        const hasNonTimeMutation = command.mutations.some((mutation) => mutation.type !== "advance_time");
        result.hasNonTimeMutation = hasNonTimeMutation;
        if (fixture.expectNonTimeMutation && hasNonTimeMutation) {
          summary.downtimeGroundingMatches += 1;
        }

        const reusesNamedNpc =
          fixture.expectNamedNpcReuse
          && routerDecision.attention.resolvedReferents.some(
            (entry) => entry.targetRef === "npc:npc_mira",
          );
        result.namedNpcGroundingMatch = Boolean(reusesNamedNpc);
        if (reusesNamedNpc) {
          summary.namedNpcGroundingMatches += 1;
        }

        const validated = validateTurnCommand({
          snapshot: {
            campaignId: "camp_eval",
            sessionId: "sess_eval",
            sessionTurnCount: 0,
            stateVersion: 0,
            generatedThroughDay: 1,
            moduleId: "mod_eval",
            selectedEntryPointId: "entry_eval",
            title: "Eval Campaign",
            premise: "Harness only.",
            tone: "Grounded",
            setting: "Waterdeep smithy",
            state: {
              currentLocationId: basePromptContext.currentLocation.id,
              globalTime: basePromptContext.globalTime,
              pendingTurnId: null,
              lastActionSummary: null,
              sceneAspects: basePromptContext.sceneAspects,
            },
            character: baseCharacter,
            currentLocation: {
              ...basePromptContext.currentLocation,
              description: null,
              localTexture: null,
              controllingFactionId: null,
              controllingFactionName: null,
              tags: [],
            },
            adjacentRoutes: basePromptContext.adjacentRoutes,
            presentNpcs: [
              {
                id: "npc_mira",
                name: "Mira Brightstone",
                role: "baker",
                summary: "A practical baker.",
                description: "She keeps bread warm under layered cloth.",
                socialLayer: "starting_local",
                isNarrativelyHydrated: true,
                factionId: null,
                factionName: null,
                currentLocationId: "loc_smithy",
                approval: 0,
                approvalBand: "neutral",
                isCompanion: false,
                state: "active",
                threatLevel: 0,
              },
            ],
            knownNpcLocationIds: {
              npc_mira: "loc_smithy",
            },
            knownFactions: [],
            factionRelations: [],
            localInformation: [],
            discoveredInformation: [],
            connectedLeads: [],
            temporaryActors: [
              {
                id: "temp_apprentice",
                label: "apprentice",
                currentLocationId: "loc_smithy",
                interactionCount: 0,
                firstSeenAtTurn: 0,
                lastSeenAtTurn: 0,
                lastSeenAtTime: basePromptContext.globalTime,
                recentTopics: [],
                lastSummary: "A young apprentice waits for instructions.",
                holdsInventory: false,
                affectedWorldState: false,
                isInMemoryGraph: false,
                promotedNpcId: null,
              },
            ],
            memories: [],
            activePressures: [],
            recentWorldShifts: [],
            activeThreads: [],
            recentMessages: [],
            canRetryLatestTurn: false,
            latestRetryableTurnId: null,
          },
          command,
          fetchedFacts: resolution.fetchedFacts,
          playerAction: fixture.action,
        });
        result.validationWarnings = validated.type === "resolve_mechanics" ? validated.warnings : [];
      }
    }

    if (fixture.syntheticNarrationLog) {
      const narration = await dmClient.narrateResolvedTurn({
        playerAction: fixture.action,
        promptContext: fixture.promptContext ?? basePromptContext,
        fetchedFacts: fixture.fetchedFacts ?? [],
        stateCommitLog: fixture.syntheticNarrationLog,
        checkResult: null,
        suggestedActions: [],
      });
      result.narration = narration;
      const hasQuotedDialogue = /["“”'‘’]/.test(narration);
      result.hasQuotedDialogue = hasQuotedDialogue;
      if (fixture.expectNoQuotedNarrationOnRejectedOnly && hasQuotedDialogue) {
        summary.rejectedNarrationLeaks += 1;
      }
    }

    results.push(result);
  }

  console.log(JSON.stringify({ summary, results }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
