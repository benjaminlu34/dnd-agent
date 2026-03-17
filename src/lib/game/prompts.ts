import type {
  CampaignBlueprint,
  CheckResult,
  Clue,
  PromptContext,
  QuestRecord,
  ResolveDecision,
  TriageDecision,
} from "@/lib/game/types";

function formatList(items: string[]) {
  if (items.length === 0) {
    return "None";
  }

  return items.map((item) => `- ${item}`).join("\n");
}

function formatRelevantClues(clues: Clue[]) {
  if (clues.length === 0) {
    return "None";
  }

  return clues
    .map((clue) => `- ${clue.text} (${clue.status}${clue.discoveredAtTurn ? `, turn ${clue.discoveredAtTurn}` : ""})`)
    .join("\n");
}

function formatQuestState(quests: QuestRecord[]) {
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

function formatRecentCanon(entries: string[]) {
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
    "Prefer 1-3 short paragraphs instead of long monologues.",
    "Do not summarize the lesson or explain the meaning of events to the player.",
    "Avoid lines like 'you learn', 'you realize', 'it is clear', or 'you have learned something useful' unless the character is explicitly thinking them.",
    "Show consequences through concrete details, dialogue, behavior, and sensory observation.",
    "Let clues surface naturally. Do not make every clue perfectly convenient or fully explained on arrival.",
    "Preserve some ambiguity when appropriate.",
    "Avoid markdown styling such as bold, italics, bullet lists, or headers in narration unless the player is literally reading a sign, inscription, or document.",
    "Even when showing written text in the world, keep it short and plain.",
    "If a roll is required, output no narration and only request the check in the tool payload.",
    "If no roll is required, narrate immediately and then submit the tool payload.",
    "Eligible reveals may be used at most once and only if dramatically appropriate.",
    "Suggested actions should be short, concrete, and phrased like natural next moves in the fiction.",
  ].join("\n");
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
Villain: ${blueprint.villain.name} - ${blueprint.villain.motive}

CURRENT SCENE
Title: ${promptContext.scene.title}
Location: ${promptContext.scene.location}
Summary: ${promptContext.scene.summary}
Atmosphere: ${promptContext.scene.atmosphere}

RECENT CANON
${formatRecentCanon(promptContext.recentCanon)}

ACTIVE ARC
${promptContext.activeArc ? `${promptContext.activeArc.title}: ${promptContext.activeArc.summary}` : "None"}

ACTIVE QUESTS
${formatQuestState(promptContext.activeQuests)}

UNRESOLVED HOOKS
${formatList(promptContext.unresolvedHooks.map((hook) => hook.text))}

RELEVANT CLUES
${formatRelevantClues(promptContext.relevantClues)}

STALE CLUES
${formatList(promptContext.staleClues.map((clue) => clue.text))}

ELIGIBLE REVEALS (you MAY reveal one this turn if dramatically appropriate)
${formatList(promptContext.eligibleRevealTexts)}

COMPANION
${promptContext.companion ? `${promptContext.companion.name}: approval ${promptContext.companion.approval}, ${promptContext.companion.notes}` : "None"}

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
End on a concrete image, line of dialogue, or new pressure.
`;
}

export function buildOutcomeUserPrompt(input: {
  blueprint: CampaignBlueprint;
  promptContext: PromptContext;
  playerAction: string;
  checkResult: CheckResult;
}) {
  const { blueprint, promptContext, playerAction, checkResult } = input;

  return `
CAMPAIGN
Premise: ${blueprint.premise}
Tone: ${blueprint.tone}
Setting: ${blueprint.setting}

CURRENT SCENE
${promptContext.scene.title} - ${promptContext.scene.summary}

RECENT CANON
${formatRecentCanon(promptContext.recentCanon)}

ACTIVE QUESTS
${formatQuestState(promptContext.activeQuests)}

ELIGIBLE REVEALS
${formatList(promptContext.eligibleRevealTexts)}

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
End on the sharpest new opening, risk, or image.
`;
}

export const triageTool = {
  name: "submit_turn_triage",
  description: "Return the structured result for a player turn triage.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      requiresCheck: { type: "boolean" },
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
        additionalProperties: true,
      },
    },
    required: ["requiresCheck", "suggestedActions", "proposedDelta"],
  },
};

export const resolutionTool = {
  name: "submit_turn_resolution",
  description: "Return the structured result for a resolved turn after an authoritative check result.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      suggestedActions: {
        type: "array",
        items: { type: "string" },
      },
      proposedDelta: {
        type: "object",
        additionalProperties: true,
      },
    },
    required: ["suggestedActions", "proposedDelta"],
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
