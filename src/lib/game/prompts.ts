import type {
  CampaignBlueprint,
  CheckResult,
  Clue,
  NpcRecord,
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

function formatHiddenQuestState(quests: QuestRecord[]) {
  if (quests.length === 0) {
    return "None";
  }

  return quests.map((quest) => `- ${quest.id}: ${quest.title} - ${quest.summary}`).join("\n");
}

function formatHiddenNpcState(npcs: NpcRecord[]) {
  if (npcs.length === 0) {
    return "None";
  }

  return npcs
    .map((npc) => `- ${npc.id}: ${npc.name} (${npc.role}) - ${npc.notes}`)
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
    "Do not expose hidden motives, secret identities, unrevealed chapter structure, or backstage quest scaffolding before the fiction earns it.",
    "When introducing a person, faction, or lead for the first time, show them through action, dialogue, or visible detail instead of dossier-style explanation.",
    "When a hidden NPC is clearly encountered or introduced in the narration, include their ID in proposedDelta.npcDiscoveries.",
    "When a hidden quest becomes explicitly logged as a player-facing objective, include its ID in proposedDelta.questDiscoveries.",
    "Do not mark NPCs or quests discovered before the narration actually earns that knowledge.",
    "Let clues surface naturally. Do not make every clue perfectly convenient or fully explained on arrival.",
    "Preserve some ambiguity when appropriate.",
    "Avoid markdown styling such as bold, italics, bullet lists, or headers in narration unless the player is literally reading a sign, inscription, or document.",
    "Even when showing written text in the world, keep it short and plain.",
    "If a roll is required, output no narration and only request the check in the tool payload.",
    "If no roll is required, narrate immediately and include that exact prose in the tool payload field narration.",
    "Eligible reveals may be used at most once and only if dramatically appropriate.",
    "Suggested actions should be short, concrete, and phrased like natural next moves in the fiction.",
    "Suggested actions must reflect the immediate current moment, not the opening scene or stale earlier options.",
    "Replace stale suggested actions as the story moves. Do not repeat the same suggestions turn after turn unless the situation is truly unchanged.",
    "Use healthDelta (negative for damage, positive for healing) to reflect physical consequences.",
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

HIDDEN QUESTS AVAILABLE TO DISCOVER
${formatHiddenQuestState(promptContext.hiddenQuests)}

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

HIDDEN NPCS AVAILABLE TO DISCOVER
${formatHiddenNpcState(promptContext.hiddenNpcs)}

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
Return 2-4 suggested actions that fit this exact moment and would feel different if the scene has progressed.
If no check is required, include the narration text in the top-level tool field narration.
If a check is required, set narration to null.
If a hidden NPC is encountered or a hidden quest is logged, record that in proposedDelta using the exact entity IDs.
Use healthDelta (negative for damage, positive for healing) to reflect physical consequences.
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

HIDDEN QUESTS AVAILABLE TO DISCOVER
${formatHiddenQuestState(promptContext.hiddenQuests)}

ELIGIBLE REVEALS
${formatList(promptContext.eligibleRevealTexts)}

HIDDEN NPCS AVAILABLE TO DISCOVER
${formatHiddenNpcState(promptContext.hiddenNpcs)}

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
Return 2-4 suggested actions that follow from this exact resolved outcome, not from the earlier opening scene.
Include the narration text in the top-level tool field narration.
If a hidden NPC is encountered or a hidden quest is logged in this outcome, record that in proposedDelta using the exact entity IDs.
Use healthDelta (negative for damage, positive for healing) to reflect physical consequences.
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
      narration: {
        type: ["string", "null"],
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
    required: ["requiresCheck", "narration", "suggestedActions", "proposedDelta"],
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
