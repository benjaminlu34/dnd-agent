import type {
  CampaignBlueprint,
  CheckResult,
  Clue,
  PromptContext,
  ResolveDecision,
  TriageDecision,
} from "@/lib/game/types";

function formatList(items: string[]) {
  if (items.length === 0) {
    return "None";
  }

  return items.map((item) => `- ${item}`).join("\n");
}

function formatDiscoveredClues(clues: Clue[]) {
  if (clues.length === 0) {
    return "None";
  }

  return clues
    .map(
      (clue) =>
        `- ${clue.text} (${clue.status}${clue.discoveredAtTurn ? `, turn ${clue.discoveredAtTurn}` : ""})`,
    )
    .join("\n");
}

function formatQuestState(quests: PromptContext["activeQuests"]) {
  if (quests.length === 0) {
    return "None";
  }

  return quests
    .map(
      (quest) =>
        `- ${quest.title}: stage ${quest.stage}/${quest.maxStage}, ${quest.status}. ${quest.summary}`,
    )
    .join("\n");
}

function formatDiscoveryCandidates(
  candidates: PromptContext["discoveryCandidates"],
  isInvestigative: boolean,
) {
  if (!isInvestigative) {
    return "Omit hidden candidates from this resolution because the turn is not investigative.";
  }

  const questLines = candidates.quests.length
    ? candidates.quests.map((quest) => `- quest:${quest.id} -> ${quest.title}`)
    : ["- quests: none"];
  const npcLines = candidates.npcs.length
    ? candidates.npcs.map((npc) => `- npc:${npc.id} -> ${npc.name} (${npc.role})`)
    : ["- npcs: none"];

  return [...questLines, ...npcLines].join("\n");
}

function formatRecentTurnLedger(entries: string[]) {
  if (entries.length === 0) {
    return "None";
  }

  return entries.map((entry) => `- ${entry}`).join("\n");
}

export function buildDungeonMasterSystemPrompt() {
  return [
    "You are a strict DM for a deterministic solo fantasy RPG.",
    "Never invent items, gold, quest stages, clues, reveals, NPCs, or facts outside the provided state.",
    "The engine and database are authoritative. You only narrate and propose structured intents.",
    "Treat previously narrated events as canon. Do not retcon, replace, or casually contradict established details.",
    "Keep the prose vivid, specific, grounded in the current scene, and concise.",
    "Prefer 1-5 paragraphs instead of long monologues.",
    "Narration and scene state are separate: narration is the player-facing prose for this beat, while proposedDelta.sceneSnapshot is only a short current-state note when the tactical picture materially changes.",
    "Do not paste the full narration into proposedDelta.sceneSnapshot.",
    "proposedDelta.sceneSnapshot must be exactly one factual sentence about physical position, threat, or opportunity.",
    "proposedDelta.sceneSnapshot must not use metaphors, atmospheric flourish, emotional language, or recap prose.",
    "Do not summarize the lesson or explain the meaning of events to the player.",
    "Avoid lines like 'you learn', 'you realize', 'it is clear', or 'you have learned something useful' unless the character is explicitly thinking them.",
    "Do not narrate the player's feelings, motives, confidence, certainty, or interior monologue unless the player explicitly stated them.",
    "Physical sensation is fine when it is concrete and external-facing, such as cold, pain, weight, smell, vibration, or impact.",
    "Show consequences through concrete details, dialogue, behavior, and sensory observation.",
    "Do not expose hidden motives, secret identities, unrevealed chapter structure, or backstage quest scaffolding before the fiction earns it.",
    "When introducing a person, faction, or lead for the first time, show them through action, dialogue, or visible detail instead of dossier-style explanation.",
    "When a hidden NPC is clearly encountered or introduced in the narration, include their ID in proposedDelta.npcDiscoveries.",
    "When a hidden quest becomes explicitly logged as a player-facing objective, include its ID in proposedDelta.questDiscoveries.",
    "Do not mark NPCs or quests discovered before the narration actually earns that knowledge.",
    "Let clues surface naturally. Do not make every clue perfectly convenient or fully explained on arrival.",
    "Preserve some ambiguity when appropriate.",
    "Do not open with backstory recap, internal monologue, or thematic framing before the player has a playable present-tense problem.",
    "Do not repeat a key item or MacGuffin unless it is directly handled, threatened, revealed, or causally relevant in this beat.",
    "Avoid markdown styling such as bold, italics, bullet lists, or headers in narration unless the player is literally reading a sign, inscription, or document.",
    "Even when showing written text in the world, keep it short and plain.",
    "If a roll is required, output no narration and only request the check in the tool payload.",
    "If no roll is required, narrate immediately and include that exact prose in the tool payload field narration.",
    "If the player declares a concrete action, either resolve it immediately in the narration or request a check. Do not turn the declared action back into setup.",
    "After resolving an action, suggested actions must follow from the new state and must not reopen abandoned menu options from the previous beat.",
    "Eligible reveals may be used at most once and only if dramatically appropriate.",
    "Suggested actions should be short, concrete, and phrased like natural next moves in the fiction.",
    "Suggested actions must reflect the immediate current moment, not the opening scene or stale earlier options.",
    "Replace stale suggested actions as the story moves. Do not repeat the same suggestions turn after turn unless the situation is truly unchanged.",
    "Use healthDelta (negative for damage, positive for healing) to reflect physical consequences.",
    "If you set proposedDelta.sceneLocation, reuse the exact established location name unless the player has explicitly traveled into a newly discovered area.",
  ].join("\n");
}

export function buildTurnPlannerSystemPrompt() {
  return [
    buildDungeonMasterSystemPrompt(),
    "You are planning the beat, not writing the final player-facing prose.",
    "Return only structured planner output through the tool call.",
    "actionResolution must be a short external-facing mechanical summary of what actually happens in this beat.",
    "suggestedActionGoals must be short next-beat intents, not polished player-facing action text.",
    "Do not include narration in planner output.",
  ].join("\n");
}

export function buildTurnRendererSystemPrompt() {
  return [
    buildDungeonMasterSystemPrompt(),
    "You are rendering from a validated beat plan that is already authoritative.",
    "Do not invent or alter outcomes, discoveries, checks, state changes, or item handling.",
    "Use the supplied actionResolution as the truth of what happened in this beat.",
    "Render only player-facing narration and suggested actions through the tool call.",
    "suggestedActions must sound natural in-fiction, but must stay faithful to the supplied suggestedActionGoals.",
  ].join("\n");
}

function buildSharedTurnContext(input: {
  blueprint: CampaignBlueprint;
  promptContext: PromptContext;
}) {
  const { blueprint, promptContext } = input;

  return `
CAMPAIGN
Premise: ${blueprint.premise}
Tone: ${blueprint.tone}
Setting: ${blueprint.setting}

CURRENT SCENE
Title: ${promptContext.scene.title}
Location: ${promptContext.scene.location}
Summary: ${promptContext.promptSceneSummary}
Atmosphere: ${promptContext.scene.atmosphere}

RECENT TURN LEDGER
${formatRecentTurnLedger(promptContext.recentTurnLedger)}

ACTIVE ARC
${promptContext.activeArc ? `${promptContext.activeArc.title}: ${promptContext.activeArc.summary}` : "None"}

ACTIVE QUESTS
${formatQuestState(promptContext.activeQuests)}

DISCOVERED CLUES
${formatDiscoveredClues(promptContext.discoveredClues)}

COMPANION
${promptContext.companion ? `${promptContext.companion.name}: approval ${promptContext.companion.approval}` : "None"}
`;
}

export function buildTriageUserPrompt(input: {
  blueprint: CampaignBlueprint;
  promptContext: PromptContext;
  playerAction: string;
}) {
  const { blueprint, promptContext, playerAction } = input;

  return `
CAMPAIGN
Premise: ${blueprint.premise}
Tone: ${blueprint.tone}
Setting: ${blueprint.setting}

CURRENT SCENE
Title: ${promptContext.scene.title}
Location: ${promptContext.scene.location}
Summary: ${promptContext.promptSceneSummary}
Atmosphere: ${promptContext.scene.atmosphere}

RECENT TURN LEDGER
${formatRecentTurnLedger(promptContext.recentTurnLedger)}

ACTIVE ARC
${promptContext.activeArc ? `${promptContext.activeArc.title}: ${promptContext.activeArc.summary}` : "None"}

ACTIVE QUESTS
${formatQuestState(promptContext.activeQuests)}

DISCOVERED CLUES
${formatDiscoveredClues(promptContext.discoveredClues)}

COMPANION
${promptContext.companion ? `${promptContext.companion.name}: approval ${promptContext.companion.approval}` : "None"}

DISCOVERY CANDIDATES
Compact IDs only. These are the only hidden quests or NPCs you may discover, and only if the fiction directly earns it.
${formatDiscoveryCandidates(promptContext.discoveryCandidates, true)}

PACING
Villain progress: ${promptContext.villainClock}/${blueprint.villain.progressClock}
Current tension: ${promptContext.tensionScore}/100
${promptContext.arcPacingHint ?? "No arc pacing warning."}

PLAYER ACTION
${playerAction}

Decide whether the action needs a check. Checks are only for meaningful uncertainty, danger, or resistance.
If no check is needed, narrate only the immediate development that follows from the action.
Do not restage the whole scene.
Do not over-explain what the player has learned.
Do not narrate the player's emotions, confidence, certainty, or internal realization unless they explicitly stated it.
If the action is concrete and no check is required, resolve it instead of ending on preparation, suspense, or a renewed menu of possibilities.
End on a concrete image, line of dialogue, or new pressure.
Return 2-4 suggested actions that fit this exact moment and would feel different if the scene has progressed.
If no check is required, include the narration text in the top-level tool field narration.
If a check is required, set narration to null.
Set isInvestigative to true only if the player's primary action is searching, studying, observing, interrogating, following a lead, looting, or otherwise trying to uncover hidden information.
If the tactical picture materially changes, include a one-sentence present-tense update in proposedDelta.sceneSnapshot. Do not copy the full narration there. If the scene state has not materially changed, omit sceneSnapshot.
proposedDelta.sceneSnapshot must be one factual sentence with no metaphors, emotional language, or atmospheric flourish.
If the scene has moved, set proposedDelta.sceneLocation to the current location name and reuse previously established names exactly unless the player explicitly reached a newly discovered area.
If a hidden NPC is encountered or a hidden quest is logged, record that in proposedDelta using the exact entity IDs.
Use healthDelta (negative for damage, positive for healing) to reflect physical consequences.
`;
}

export function buildTriagePlannerUserPrompt(input: {
  blueprint: CampaignBlueprint;
  promptContext: PromptContext;
  playerAction: string;
}) {
  const { promptContext, playerAction } = input;

  return `
${buildSharedTurnContext(input)}

DISCOVERY CANDIDATES
Compact IDs only. These are the only hidden quests or NPCs you may discover, and only if the fiction directly earns it.
${formatDiscoveryCandidates(promptContext.discoveryCandidates, true)}

PACING
Villain progress: ${promptContext.villainClock}/${input.blueprint.villain.progressClock}
Current tension: ${promptContext.tensionScore}/100
${promptContext.arcPacingHint ?? "No arc pacing warning."}

PLAYER ACTION
${playerAction}

Plan the immediate beat only.
Decide whether the action needs a check. Checks are only for meaningful uncertainty, danger, or resistance.
If a check is required, output requiresCheck true, provide the check payload, leave proposedDelta empty or minimal, and still explain the unresolved beat mechanically in actionResolution.
If no check is required, resolve the declared action itself in actionResolution. Do not restage the whole scene or defer into suspense.
actionResolution must be 1-2 short sentences of concrete external outcome, not polished narration.
suggestedActionGoals must be 2-4 short intent summaries for the next beat, not final player-facing menu copy.
If the tactical picture materially changes, include a one-sentence factual proposedDelta.sceneSnapshot. If it does not materially change, omit it.
If a hidden NPC is encountered or a hidden quest is logged, record it in proposedDelta using exact IDs.
Use healthDelta (negative for damage, positive for healing) for physical consequences.
`;
}

export function buildOutcomeUserPrompt(input: {
  blueprint: CampaignBlueprint;
  promptContext: PromptContext;
  playerAction: string;
  checkResult: CheckResult;
  isInvestigative: boolean;
}) {
  const { blueprint, promptContext, playerAction, checkResult, isInvestigative } = input;

  return `
CAMPAIGN
Premise: ${blueprint.premise}
Tone: ${blueprint.tone}
Setting: ${blueprint.setting}

CURRENT SCENE
Title: ${promptContext.scene.title}
Location: ${promptContext.scene.location}
Summary: ${promptContext.promptSceneSummary}
Atmosphere: ${promptContext.scene.atmosphere}

RECENT TURN LEDGER
${formatRecentTurnLedger(promptContext.recentTurnLedger)}

ACTIVE QUESTS
${formatQuestState(promptContext.activeQuests)}

DISCOVERED CLUES
${formatDiscoveredClues(promptContext.discoveredClues)}

DISCOVERY CANDIDATES
Only use these if the action is investigative and the resolved fiction directly earns the discovery.
${formatDiscoveryCandidates(promptContext.discoveryCandidates, isInvestigative)}

PLAYER ACTION
${playerAction}

AUTHORITATIVE CHECK RESULT
Stat: ${checkResult.stat}
Mode: ${checkResult.mode}
Reason: ${checkResult.reason}
Rolls: ${checkResult.rolls[0]}, ${checkResult.rolls[1]}
Modifier: ${checkResult.modifier}
Total: ${checkResult.total}
Outcome: ${checkResult.outcome}
Consequences: ${formatList(checkResult.consequences ?? [])}

Narrate the resolved outcome in a way that matches the exact result above. Then submit the structured tool payload.
Keep the outcome continuity-safe and focused on the immediate result.
Do not rewrite earlier scene details unless the new outcome genuinely reveals something hidden.
Do not explain the scene's meaning after narrating it.
Do not narrate the player's emotions, confidence, certainty, or internal realization unless they explicitly stated it.
Resolve the declared action itself. Do not end on preparation, suspense, or a fresh menu of options that ignores what just happened.
End on the sharpest new opening, risk, or image.
Return 2-4 suggested actions that follow from this exact resolved outcome, not from the earlier opening scene.
Include the narration text in the top-level tool field narration.
If the tactical picture materially changes, include a one-sentence present-tense update in proposedDelta.sceneSnapshot. Do not copy the full narration there. If the scene state has not materially changed, omit sceneSnapshot.
proposedDelta.sceneSnapshot must be one factual sentence with no metaphors, emotional language, or atmospheric flourish.
If the scene has moved, set proposedDelta.sceneLocation to the current location name and reuse previously established names exactly unless the player explicitly reached a newly discovered area.
If a hidden NPC is encountered or a hidden quest is logged in this outcome, record that in proposedDelta using the exact entity IDs.
Use healthDelta (negative for damage, positive for healing) to reflect physical consequences.
`;
}

export function buildResolutionPlannerUserPrompt(input: {
  blueprint: CampaignBlueprint;
  promptContext: PromptContext;
  playerAction: string;
  checkResult: CheckResult;
  isInvestigative: boolean;
}) {
  const { promptContext, playerAction, checkResult, isInvestigative } = input;

  return `
${buildSharedTurnContext(input)}

DISCOVERY CANDIDATES
Only use these if the turn is investigative and the resolved fiction directly earns the discovery.
${formatDiscoveryCandidates(promptContext.discoveryCandidates, isInvestigative)}

PLAYER ACTION
${playerAction}

AUTHORITATIVE CHECK RESULT
Stat: ${checkResult.stat}
Mode: ${checkResult.mode}
Reason: ${checkResult.reason}
Rolls: ${checkResult.rolls[0]}, ${checkResult.rolls[1]}
Modifier: ${checkResult.modifier}
Total: ${checkResult.total}
Outcome: ${checkResult.outcome}
Consequences: ${formatList(checkResult.consequences ?? [])}

Plan the resolved beat only.
actionResolution must match the exact outcome above and describe the concrete external result in 1-2 short sentences.
Do not write polished narration here.
Use suggestedActionGoals for 2-4 short intent summaries that follow from this exact resolved outcome.
If the tactical picture materially changes, include a factual proposedDelta.sceneSnapshot. Otherwise omit it.
If a hidden NPC is encountered or a hidden quest is logged in this outcome, record it in proposedDelta using exact IDs.
Use healthDelta (negative for damage, positive for healing) for physical consequences.
`;
}

export function buildRendererUserPrompt(input: {
  mode: "triage" | "resolution";
  playerAction: string;
  promptContext: PromptContext;
  actionResolution: string;
  suggestedActionGoals: Array<{ goal: string; target: string | null }>;
}) {
  const goals = input.suggestedActionGoals.length
    ? input.suggestedActionGoals
        .map((goal, index) => `- Goal ${index + 1}: ${goal.goal}${goal.target ? ` | Target: ${goal.target}` : ""}`)
        .join("\n")
    : "None";

  return `
CURRENT SCENE
Title: ${input.promptContext.scene.title}
Location: ${input.promptContext.scene.location}
Summary: ${input.promptContext.promptSceneSummary}
Atmosphere: ${input.promptContext.scene.atmosphere}

MODE
${input.mode}

PLAYER ACTION
${input.playerAction}

VALIDATED ACTION RESOLUTION
${input.actionResolution}

VALIDATED SUGGESTED ACTION GOALS
${goals}

Render the beat faithfully from the validated actionResolution.
Do not invent new discoveries, state changes, checks, or twists.
Keep the narration concise, concrete, and player-facing.
End on a concrete image, pressure, or line of dialogue rather than explanation.
Return 2-4 suggestedActions that sound natural in fiction and stay faithful to the suggestedActionGoals.
`;
}

export const triagePlannerTool = {
  name: "plan_turn_triage",
  description: "Plan the structured semantic result for a player turn triage without writing final narration.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      requiresCheck: { type: "boolean" },
      isInvestigative: {
        type: "boolean",
        description:
          "True if the player's primary action is searching, studying, observing, interrogating, following a lead, looting, or otherwise trying to uncover hidden information.",
      },
      check: {
        type: "object",
        nullable: true,
        additionalProperties: false,
        properties: {
          stat: {
            type: "string",
            enum: ["strength", "agility", "intellect", "charisma", "vitality"],
          },
          mode: {
            type: "string",
            enum: ["normal", "advantage", "disadvantage"],
          },
          reason: { type: "string" },
        },
        required: ["stat", "mode", "reason"],
      },
      actionResolution: {
        type: "string",
      },
      suggestedActionGoals: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            goal: { type: "string" },
            target: { type: ["string", "null"] },
          },
          required: ["goal", "target"],
        },
      },
      proposedDelta: {
        type: "object",
        properties: {
          healthDelta: {
            type: "integer",
          },
          sceneSnapshot: {
            type: "string",
            description:
              "One factual sentence describing the updated physical or tactical state. No metaphors, atmospheric flourish, emotional language, or recap prose.",
          },
          sceneLocation: {
            type: "string",
            description:
              "The name of the current location. Must match previously established location names exactly unless the player has explicitly traveled to a newly discovered area.",
          },
          npcDiscoveries: {
            type: "array",
            items: { type: "string" },
          },
          questDiscoveries: {
            type: "array",
            items: { type: "string" },
          },
        },
        additionalProperties: true,
      },
    },
    required: [
      "requiresCheck",
      "isInvestigative",
      "actionResolution",
      "suggestedActionGoals",
      "proposedDelta",
    ],
  },
};

export const resolutionPlannerTool = {
  name: "plan_turn_resolution",
  description: "Plan the semantic result for a resolved turn after an authoritative check result.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      actionResolution: { type: "string" },
      suggestedActionGoals: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            goal: { type: "string" },
            target: { type: ["string", "null"] },
          },
          required: ["goal", "target"],
        },
      },
      proposedDelta: {
        type: "object",
        properties: {
          healthDelta: {
            type: "integer",
          },
          sceneSnapshot: {
            type: "string",
            description:
              "One factual sentence describing the updated physical or tactical state. No metaphors, atmospheric flourish, emotional language, or recap prose.",
          },
          sceneLocation: {
            type: "string",
            description:
              "The name of the current location. Must match previously established location names exactly unless the player has explicitly traveled to a newly discovered area.",
          },
          npcDiscoveries: {
            type: "array",
            items: { type: "string" },
          },
          questDiscoveries: {
            type: "array",
            items: { type: "string" },
          },
        },
        additionalProperties: true,
      },
    },
    required: ["actionResolution", "suggestedActionGoals", "proposedDelta"],
  },
};

export const rendererTool = {
  name: "render_turn_beat",
  description: "Render final player-facing narration and suggested actions from a validated beat plan.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      narration: { type: "string" },
      suggestedActions: {
        type: "array",
        items: { type: "string" },
      },
    },
    required: ["narration", "suggestedActions"],
  },
};

export const triageTool = {
  name: "submit_turn_triage",
  description: "Return the structured result for a player turn triage.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      requiresCheck: { type: "boolean" },
      narration: {
        type: ["string", "null"],
      },
      isInvestigative: {
        type: "boolean",
      },
      check: {
        type: "object",
        nullable: true,
        additionalProperties: false,
        properties: {
          stat: {
            type: "string",
            enum: ["strength", "agility", "intellect", "charisma", "vitality"],
          },
          mode: {
            type: "string",
            enum: ["normal", "advantage", "disadvantage"],
          },
          reason: { type: "string" },
        },
        required: ["stat", "mode", "reason"],
      },
      suggestedActions: {
        type: "array",
        items: { type: "string" },
      },
      proposedDelta: {
        type: "object",
        properties: {
          healthDelta: {
            type: "integer",
          },
          sceneSnapshot: {
            type: "string",
            description:
              "One factual sentence describing the updated physical or tactical state. No metaphors, atmospheric flourish, emotional language, or recap prose.",
          },
          sceneLocation: {
            type: "string",
            description:
              "The name of the current location. Must match previously established location names exactly unless the player has explicitly traveled to a newly discovered area.",
          },
          npcDiscoveries: {
            type: "array",
            items: { type: "string" },
          },
          questDiscoveries: {
            type: "array",
            items: { type: "string" },
          },
        },
        additionalProperties: true,
      },
    },
    required: ["requiresCheck", "narration", "isInvestigative", "suggestedActions", "proposedDelta"],
  },
};

export const resolutionTool = {
  name: "submit_turn_resolution",
  description: "Return the structured result for a resolved turn after an authoritative check result.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      narration: { type: "string" },
      suggestedActions: {
        type: "array",
        items: { type: "string" },
      },
      proposedDelta: {
        type: "object",
        properties: {
          healthDelta: {
            type: "integer",
          },
          sceneSnapshot: {
            type: "string",
            description:
              "One factual sentence describing the updated physical or tactical state. No metaphors, atmospheric flourish, emotional language, or recap prose.",
          },
          sceneLocation: {
            type: "string",
            description:
              "The name of the current location. Must match previously established location names exactly unless the player has explicitly traveled to a newly discovered area.",
          },
          npcDiscoveries: {
            type: "array",
            items: { type: "string" },
          },
          questDiscoveries: {
            type: "array",
            items: { type: "string" },
          },
        },
        additionalProperties: true,
      },
    },
    required: ["narration", "suggestedActions", "proposedDelta"],
  },
};

export function isTriageDecision(value: unknown): value is TriageDecision {
  if (!value || typeof value !== "object") {
    return false;
  }

  return "requiresCheck" in value && "suggestedActions" in value && "proposedDelta" in value;
}

export function isResolveDecision(value: unknown): value is ResolveDecision {
  if (!value || typeof value !== "object") {
    return false;
  }

  return "suggestedActions" in value && "proposedDelta" in value;
}
