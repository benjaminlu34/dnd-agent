import OpenAI from "openai";
import { env } from "@/lib/env";
import {
  buildDungeonMasterSystemPrompt,
  buildOutcomeUserPrompt,
  buildTriageUserPrompt,
  isResolveDecision,
  isTriageDecision,
  resolutionTool,
  triageTool,
} from "@/lib/game/prompts";
import {
  createStarterArcs,
  createStarterBlueprint,
  createStarterClues,
  createStarterNpcs,
  createStarterQuests,
  createStarterState,
} from "@/lib/game/starter-data";
import type {
  CampaignBlueprint,
  CharacterSheet,
  CheckOutcome,
  CheckResult,
  GeneratedCampaignSetup,
  PromptContext,
  ProposedStateDelta,
  ResolveDecision,
  Stat,
  TriageDecision,
} from "@/lib/game/types";

type StreamCallbacks = {
  onNarration?: (chunk: string) => void;
};

type OpenRouterToolResult = {
  text: string;
  toolInput: unknown;
};

type TurnAIPayload = {
  blueprint: CampaignBlueprint;
  promptContext: PromptContext;
  playerAction: string;
};

const campaignSetupTool = {
  name: "generate_campaign_setup",
  description: "Create a fresh starting campaign setup for a solo fantasy RPG.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      title: { type: "string" },
      premise: { type: "string" },
      tone: { type: "string" },
      setting: { type: "string" },
      villain: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          motive: { type: "string" },
          progressClock: { type: "number" },
        },
        required: ["name", "motive", "progressClock"],
      },
      openingScene: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          summary: { type: "string" },
          location: { type: "string" },
          atmosphere: { type: "string" },
          activeThreat: { type: "string" },
          suggestedActions: {
            type: "array",
            items: { type: "string" },
          },
        },
        required: [
          "title",
          "summary",
          "location",
          "atmosphere",
          "activeThreat",
          "suggestedActions",
        ],
      },
      hooks: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: { text: { type: "string" } },
          required: ["text"],
        },
      },
      arcs: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            title: { type: "string" },
            summary: { type: "string" },
            expectedTurns: { type: "number" },
          },
          required: ["title", "summary", "expectedTurns"],
        },
      },
      reveals: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            title: { type: "string" },
            truth: { type: "string" },
            requiredClueTitles: { type: "array", items: { type: "string" } },
            requiredArcTitles: { type: "array", items: { type: "string" } },
          },
          required: ["title", "truth", "requiredClueTitles", "requiredArcTitles"],
        },
      },
      subplotSeeds: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            title: { type: "string" },
            hook: { type: "string" },
          },
          required: ["title", "hook"],
        },
      },
      quests: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            title: { type: "string" },
            summary: { type: "string" },
            maxStage: { type: "number" },
            rewardGold: { type: "number" },
            rewardItem: { type: "string" },
          },
          required: ["title", "summary", "maxStage", "rewardGold"],
        },
      },
      npcs: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: { type: "string" },
            role: { type: "string" },
            notes: { type: "string" },
            isCompanion: { type: "boolean" },
            approval: { type: "number" },
            personalHook: { type: "string" },
            status: { type: "string" },
          },
          required: ["name", "role", "notes"],
        },
      },
      clues: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            text: { type: "string" },
            source: { type: "string" },
            linkedRevealTitle: { type: "string" },
          },
          required: ["text", "source", "linkedRevealTitle"],
        },
      },
      locations: {
        type: "array",
        items: { type: "string" },
      },
    },
    required: [
      "title",
      "premise",
      "tone",
      "setting",
      "villain",
      "openingScene",
      "hooks",
      "arcs",
      "reveals",
      "subplotSeeds",
      "quests",
      "npcs",
      "clues",
      "locations",
    ],
  },
};

function toFunctionTool(
  tool: typeof triageTool | typeof resolutionTool | typeof campaignSetupTool,
) {
  return {
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema,
    },
  };
}

function isGeneratedCampaignSetup(value: unknown): value is GeneratedCampaignSetup {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<GeneratedCampaignSetup>;
  return Boolean(
    candidate.title &&
      candidate.premise &&
      candidate.setting &&
      candidate.tone &&
      candidate.villain &&
      candidate.openingScene &&
      Array.isArray(candidate.arcs) &&
      Array.isArray(candidate.quests) &&
      Array.isArray(candidate.npcs) &&
      Array.isArray(candidate.clues),
  );
}

function createMockCampaignSetup(): GeneratedCampaignSetup {
  const blueprint = createStarterBlueprint();
  const state = createStarterState(blueprint);
  const quests = createStarterQuests();
  const npcs = createStarterNpcs();
  const clues = createStarterClues();
  const arcs = createStarterArcs();

  return {
    title: "Eclipse Over Briar Glen",
    premise: blueprint.premise,
    tone: blueprint.tone,
    setting: blueprint.setting,
    villain: blueprint.villain,
    openingScene: {
      title: state.sceneState.title,
      summary: state.sceneState.summary,
      location: state.sceneState.location,
      atmosphere: state.sceneState.atmosphere,
      activeThreat: state.worldState.activeThreat,
      suggestedActions: state.sceneState.suggestedActions,
    },
    hooks: blueprint.initialHooks.map((hook) => ({ text: hook.text })),
    arcs: arcs.map((arc) => ({
      title: arc.title,
      summary: arc.summary,
      expectedTurns: arc.expectedTurns,
    })),
    reveals: blueprint.hiddenReveals.map((reveal) => ({
      title: reveal.title,
      truth: reveal.truth,
      requiredClueTitles: reveal.requiredClues
        .map((id) => clues.find((clue) => clue.id === id)?.text)
        .filter((value): value is string => Boolean(value)),
      requiredArcTitles: reveal.requiredArcIds
        .map((id) => arcs.find((arc) => arc.id === id)?.title)
        .filter((value): value is string => Boolean(value)),
    })),
    subplotSeeds: blueprint.subplotSeeds,
    quests: quests.map((quest) => ({
      title: quest.title,
      summary: quest.summary,
      maxStage: quest.maxStage,
      rewardGold: quest.rewardGold,
      rewardItem: quest.rewardItem,
    })),
    npcs: npcs.map((npc) => ({
      name: npc.name,
      role: npc.role,
      notes: npc.notes,
      isCompanion: npc.isCompanion,
      approval: npc.approval,
      personalHook: npc.personalHook,
      status: npc.status,
    })),
    clues: clues.map((clue) => ({
      text: clue.text,
      source: clue.source,
      linkedRevealTitle:
        blueprint.hiddenReveals.find((reveal) => reveal.id === clue.linkedRevealId)?.title ??
        "Hidden Truth",
    })),
    locations: state.locations,
  };
}

function stripCodeFences(value: string) {
  return value
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function extractMessageText(content: unknown) {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }

        if (
          part &&
          typeof part === "object" &&
          "type" in part &&
          "text" in part &&
          (part as { type?: unknown }).type === "text"
        ) {
          return String((part as { text: unknown }).text ?? "");
        }

        return "";
      })
      .join("");
  }

  return "";
}

function safeParseJson(value: string): unknown {
  const trimmed = stripCodeFences(value);

  try {
    return JSON.parse(trimmed);
  } catch {
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");

    if (firstBrace >= 0 && lastBrace > firstBrace) {
      try {
        return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
      } catch {
        return null;
      }
    }

    return null;
  }
}

function unwrapStructuredPayload(value: unknown): unknown {
  if (!value) {
    return null;
  }

  if (typeof value === "string") {
    return safeParseJson(value);
  }

  if (typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const nestedKeys = ["arguments", "input", "toolInput", "payload", "result"];

  for (const key of nestedKeys) {
    if (record[key]) {
      const nested = unwrapStructuredPayload(record[key]);
      if (nested) {
        return nested;
      }
    }
  }

  return record;
}

function toStringArray(value: unknown) {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(/\n|•|-/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

function toObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function inferCheckStat(playerAction: string): Stat {
  const action = playerAction.toLowerCase();

  if (/(convince|persuade|bargain|charm|plead|bluff)/.test(action)) return "charisma";
  if (/(sneak|dart|dodge|slip|pick|steal|catch|reach|balance)/.test(action)) return "agility";
  if (/(study|recall|analyze|inspect|decipher|investigate|search|read)/.test(action)) return "intellect";
  if (/(endure|withstand|brace|push through|march|survive)/.test(action)) return "vitality";
  return "strength";
}

function inferRequiresCheck(playerAction: string) {
  return /(attack|strike|fight|break|force|sneak|convince|persuade|climb|leap|grab|pick|steal|chase|confront|threaten|wrestle|rush|dart|slip)/i.test(
    playerAction,
  );
}

function sanitizeNarration(text: string) {
  const cleaned = stripCodeFences(text)
    .replace(/^\s*(json|tool|result)\s*:?/i, "")
    .trim();

  if (!cleaned || /^[\[{]/.test(cleaned)) {
    return "";
  }

  return cleaned;
}

function normalizeTriageDecision(
  raw: unknown,
  input: TurnAIPayload,
  text: string,
): TriageDecision {
  const payload = toObject(unwrapStructuredPayload(raw));
  const suggestedActions = toStringArray(
    payload?.suggestedActions ??
      payload?.suggested_actions ??
      payload?.actions ??
      payload?.nextMoves,
  ).slice(0, 4);
  const proposedDelta =
    toObject(payload?.proposedDelta ?? payload?.proposed_delta ?? payload?.delta) ?? {};
  const proposedDeltaWithActions =
    suggestedActions.length > 0 && !Array.isArray(proposedDelta.suggestedActions)
      ? {
          ...proposedDelta,
          suggestedActions,
        }
      : proposedDelta;
  const requiresCheck =
    typeof payload?.requiresCheck === "boolean"
      ? payload.requiresCheck
      : typeof payload?.requires_check === "boolean"
        ? payload.requires_check
        : typeof payload?.requiresRoll === "boolean"
          ? payload.requiresRoll
          : typeof payload?.needsCheck === "boolean"
            ? payload.needsCheck
            : inferRequiresCheck(input.playerAction);

  if (requiresCheck) {
    const checkPayload = toObject(payload?.check ?? payload?.pendingCheck ?? payload?.roll);

    return {
      requiresCheck: true,
      check: {
        stat:
          checkPayload?.stat === "strength" ||
          checkPayload?.stat === "agility" ||
          checkPayload?.stat === "intellect" ||
          checkPayload?.stat === "charisma" ||
          checkPayload?.stat === "vitality"
            ? checkPayload.stat
            : inferCheckStat(input.playerAction),
        mode:
          checkPayload?.mode === "advantage" || checkPayload?.mode === "disadvantage"
            ? checkPayload.mode
            : "normal",
        reason:
          typeof checkPayload?.reason === "string" && checkPayload.reason.trim()
            ? checkPayload.reason.trim()
            : `Resolving: ${input.playerAction}`,
      },
      suggestedActions,
      proposedDelta: {},
    };
  }

  const narration = sanitizeNarration(text);

  return {
    requiresCheck: false,
    suggestedActions,
    proposedDelta: {
      ...(proposedDeltaWithActions as ProposedStateDelta),
      ...(narration && !(proposedDeltaWithActions as ProposedStateDelta).sceneSummary
        ? { sceneSummary: narration }
        : {}),
    },
  };
}

function normalizeResolveDecision(raw: unknown, text: string): ResolveDecision {
  const payload = toObject(unwrapStructuredPayload(raw));
  const suggestedActions = toStringArray(
    payload?.suggestedActions ??
      payload?.suggested_actions ??
      payload?.actions ??
      payload?.nextMoves,
  ).slice(0, 4);
  const proposedDelta =
    toObject(payload?.proposedDelta ?? payload?.proposed_delta ?? payload?.delta) ?? {};
  const proposedDeltaWithActions =
    suggestedActions.length > 0 && !Array.isArray(proposedDelta.suggestedActions)
      ? {
          ...proposedDelta,
          suggestedActions,
        }
      : proposedDelta;
  const narration = sanitizeNarration(text);

  return {
    suggestedActions,
    proposedDelta: {
      ...(proposedDeltaWithActions as ProposedStateDelta),
      ...(narration && !(proposedDeltaWithActions as ProposedStateDelta).sceneSummary
        ? { sceneSummary: narration }
        : {}),
    },
  };
}

class MockDungeonMaster {
  async generateCampaignSetup() {
    return createMockCampaignSetup();
  }

  async triageTurn(input: TurnAIPayload, callbacks?: StreamCallbacks): Promise<TriageDecision> {
    const action = input.playerAction.toLowerCase();
    const requiresCheck =
      /(attack|strike|fight|break|force|sneak|convince|persuade|climb|leap|grab)/.test(action);

    if (!requiresCheck) {
      const narration = `You press the moment forward in ${input.promptContext.scene.title.toLowerCase()}, and the town answers with one more unsettling detail tied to your goal.`;
      callbacks?.onNarration?.(narration);

      const clueToDiscover = input.promptContext.relevantClues.find(
        (clue) => clue.status === "hidden",
      );

      return {
        requiresCheck: false,
        suggestedActions: [
          "Press the advantage before the cult regroups",
          "Question someone who noticed the disturbance",
          "Follow the newest lead into the next district",
        ],
        proposedDelta: {
          sceneSummary: narration,
          tensionDelta: 4,
          villainClockDelta: 1,
          clueDiscoveries: clueToDiscover ? [clueToDiscover.id] : [],
          suggestedActions: [
            "Press the advantage before the cult regroups",
            "Question someone who noticed the disturbance",
            "Follow the newest lead into the next district",
          ],
          arcAdvancements: input.promptContext.activeArc
            ? [{ arcId: input.promptContext.activeArc.id, currentTurnDelta: 1 }]
            : [],
        },
      };
    }

    const stat =
      action.includes("convince") || action.includes("persuade")
        ? "charisma"
        : action.includes("sneak")
          ? "agility"
          : action.includes("climb") || action.includes("leap")
            ? "vitality"
            : "strength";

    return {
      requiresCheck: true,
      check: {
        stat,
        mode: "normal",
        reason: `Resolving: ${input.playerAction}`,
      },
      suggestedActions: [],
      proposedDelta: {},
    };
  }

  async resolveTurn(
    input: TurnAIPayload & { checkResult: CheckResult },
    callbacks?: StreamCallbacks,
  ): Promise<ResolveDecision> {
    const toneByOutcome: Record<CheckOutcome, string> = {
      success:
        "Your move lands cleanly, and the pressure in the scene briefly breaks in your favor.",
      partial:
        "You get forward motion, but the win comes with exposed nerves and a fresh complication.",
      failure:
        "The move backfires hard enough to sharpen the danger around you.",
    };

    const narration = `${toneByOutcome[input.checkResult.outcome]} ${input.promptContext.companion ? `${input.promptContext.companion.name} reacts under their breath as the scene shifts.` : ""}`.trim();
    callbacks?.onNarration?.(narration);

    const remainingHiddenClue = input.promptContext.relevantClues.find(
      (clue) => clue.status === "hidden",
    );
    const revealId = input.promptContext.eligibleRevealIds[0];

    return {
      suggestedActions: [
        "Push deeper while the opening lasts",
        "Regroup and read the room",
        "Question your companion about what just changed",
      ],
      proposedDelta: {
        sceneSummary: narration,
        tensionDelta: input.checkResult.outcome === "failure" ? 10 : 5,
        villainClockDelta: input.checkResult.outcome === "failure" ? 1 : 0,
        clueDiscoveries:
          input.checkResult.outcome !== "failure" && remainingHiddenClue
            ? [remainingHiddenClue.id]
            : [],
        revealTriggers: input.checkResult.outcome === "success" && revealId ? [revealId] : [],
        suggestedActions: [
          "Push deeper while the opening lasts",
          "Regroup and read the room",
          "Question your companion about what just changed",
        ],
        arcAdvancements: input.promptContext.activeArc
          ? [{ arcId: input.promptContext.activeArc.id, currentTurnDelta: 1 }]
          : [],
        npcApprovalChanges: input.promptContext.companion
          ? [
              {
                npcId: input.promptContext.companion.id,
                approvalDelta: input.checkResult.outcome === "failure" ? -1 : 1,
                reason: "Shared danger reshaped the bond.",
              },
            ]
          : [],
      },
    };
  }

  async summarizeSession(messages: string[]) {
    return `Previously on: ${messages.slice(-3).join(" ").slice(0, 220)}`;
  }

  async generatePreviouslyOn(summary: string, scene: string, clueText: string[]) {
    return `Previously on: ${summary} Now the story resumes in ${scene} with ${clueText[0] ?? "old secrets"} still unresolved.`;
  }
}

class OpenRouterDungeonMaster {
  private client = new OpenAI({
    apiKey: env.openRouterApiKey,
    baseURL: "https://openrouter.ai/api/v1",
    defaultHeaders: {
      "HTTP-Referer": env.appUrl,
      "X-Title": env.openRouterSiteName,
    },
  });

  private async runStream(input: {
    prompt: string;
    tool: typeof triageTool | typeof resolutionTool;
    onNarration?: (chunk: string) => void;
  }): Promise<OpenRouterToolResult> {
    const stream = await this.client.chat.completions.create({
      model: env.openRouterModel,
      messages: [
        {
          role: "system",
          content: buildDungeonMasterSystemPrompt(),
        },
        {
          role: "user",
          content: input.prompt,
        },
      ],
      tools: [toFunctionTool(input.tool)],
      tool_choice: "auto",
      stream: true,
      temperature: 0.65,
    });

    let text = "";
    let toolArguments = "";

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;

      if (delta?.content) {
        text += delta.content;
        input.onNarration?.(delta.content);
      }

      const toolCall = delta?.tool_calls?.[0];
      if (toolCall?.function?.arguments) {
        toolArguments += toolCall.function.arguments;
      }
    }

    return {
      text,
      toolInput: toolArguments ? safeParseJson(toolArguments) : safeParseJson(text),
    };
  }

  async generateCampaignSetup(character: CharacterSheet) {
    const baseMessages = [
      {
        role: "system" as const,
        content: [
          "You are generating a fresh starting campaign setup for a solo fantasy RPG.",
          "Create a cohesive opening campaign with 2 arcs, 1-2 quests, 2-4 NPCs, 3-5 clues, 1-2 reveals, and 3 opening suggested actions.",
          "Make it immediately playable.",
          "Keep titles and summaries clear, concrete, and gameable.",
          "Ensure clue-to-reveal and reveal-to-arc references line up exactly by title.",
          "Do not reuse Briar Glen, Abbess Veyra, the Silver Bell, or other starter campaign names.",
        ].join("\n"),
      },
      {
        role: "user" as const,
        content: [
          `Generate a campaign for this character: ${character.name}, ${character.archetype}.`,
          `Stats: strength ${character.stats.strength}, agility ${character.stats.agility}, intellect ${character.stats.intellect}, charisma ${character.stats.charisma}, vitality ${character.stats.vitality}.`,
          "Lean toward mystery, momentum, and memorable places over lore dumps.",
        ].join("\n"),
      },
    ];

    try {
      const response = await this.client.chat.completions.create({
        model: env.openRouterModel,
        messages: baseMessages,
        tools: [toFunctionTool(campaignSetupTool)],
        tool_choice: "auto",
        temperature: 0.75,
      });

      const toolCall = response.choices[0]?.message?.tool_calls?.[0];
      const args =
        toolCall && toolCall.type === "function" ? toolCall.function.arguments ?? "" : "";
      const parsed = args
        ? safeParseJson(args)
        : safeParseJson(extractMessageText(response.choices[0]?.message?.content));

      if (isGeneratedCampaignSetup(parsed)) {
        return parsed;
      }
    } catch {
      // Fall through to raw-JSON generation for providers that reject tool routing.
    }

    const fallbackResponse = await this.client.chat.completions.create({
      model: env.openRouterModel,
      messages: [
        ...baseMessages,
        {
          role: "system",
          content: [
            "Return only a valid JSON object.",
            "Do not include markdown, explanations, or code fences.",
            `JSON schema: ${JSON.stringify(campaignSetupTool.input_schema)}`,
          ].join("\n"),
        },
      ],
      temperature: 0.75,
    });

    const parsed = safeParseJson(extractMessageText(fallbackResponse.choices[0]?.message?.content));

    if (!isGeneratedCampaignSetup(parsed)) {
      throw new Error("Model returned an invalid campaign setup payload.");
    }

    return parsed;
  }

  async triageTurn(input: TurnAIPayload, callbacks?: StreamCallbacks): Promise<TriageDecision> {
    const result = await this.runStream({
      prompt: buildTriageUserPrompt(input),
      tool: triageTool,
      onNarration: callbacks?.onNarration,
    });

    const normalized = normalizeTriageDecision(result.toolInput, input, result.text);
    if (isTriageDecision(normalized)) {
      return normalized;
    }

    if (inferRequiresCheck(input.playerAction)) {
      return {
        requiresCheck: true,
        check: {
          stat: inferCheckStat(input.playerAction),
          mode: "normal",
          reason: `Resolving: ${input.playerAction}`,
        },
        suggestedActions: [],
        proposedDelta: {},
      };
    }

    return {
      requiresCheck: false,
      suggestedActions: [],
      proposedDelta: {},
    };
  }

  async resolveTurn(
    input: TurnAIPayload & { checkResult: CheckResult },
    callbacks?: StreamCallbacks,
  ): Promise<ResolveDecision> {
    const result = await this.runStream({
      prompt: buildOutcomeUserPrompt(input),
      tool: resolutionTool,
      onNarration: callbacks?.onNarration,
    });

    const normalized = normalizeResolveDecision(result.toolInput, result.text);
    return isResolveDecision(normalized)
      ? normalized
      : {
          suggestedActions: [],
          proposedDelta: {},
        };
  }

  async summarizeSession(messages: string[]) {
    const response = await this.client.chat.completions.create({
      model: env.openRouterModel,
      messages: [
        {
          role: "user",
          content: `Summarize this session in 2-3 sentences for future prompt context:\n${messages.join("\n")}`,
        },
      ],
    });

    return response.choices[0]?.message?.content ?? "The session summary could not be generated.";
  }

  async generatePreviouslyOn(summary: string, scene: string, clueText: string[]) {
    const response = await this.client.chat.completions.create({
      model: env.openRouterModel,
      messages: [
        {
          role: "user",
          content: `Previous session summary: ${summary}\nCurrent scene: ${scene}\nClues unresolved: ${clueText.join(", ") || "none"}\n\nWrite a dramatic two-sentence "Previously on..." recap.`,
        },
      ],
    });

    return response.choices[0]?.message?.content ?? `Previously on: ${summary}`;
  }
}

export const dmClient = env.openRouterApiKey
  ? new OpenRouterDungeonMaster()
  : new MockDungeonMaster();
