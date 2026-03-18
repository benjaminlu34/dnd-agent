import OpenAI from "openai";
import { LocalDungeonMaster } from "@/lib/ai/local-provider";
import { env } from "@/lib/env";
import { characterTemplateDraftSchema, toCampaignSeedCharacter } from "@/lib/game/characters";
import {
  buildDungeonMasterSystemPrompt,
  buildOutcomeUserPrompt,
  buildTriageUserPrompt,
  isResolveDecision,
  isTriageDecision,
  resolutionTool,
  triageTool,
} from "@/lib/game/prompts";
import { createDefaultCharacterTemplate } from "@/lib/game/starter-data";
import { generatedCampaignSetupSchema } from "@/lib/game/session-zero";
import type {
  CampaignBlueprint,
  CampaignCharacter,
  CharacterTemplateDraft,
  CheckResult,
  GeneratedCampaignSetup,
  PromptContext,
  ProposedStateDelta,
  ResolveDecision,
  Stat,
  TriageDecision,
} from "@/lib/game/types";

type CampaignSetupGenerationInput = {
  basePrompt?: string;
  prompt?: string;
  previousDraft?: GeneratedCampaignSetup;
};

type StreamCallbacks = {
  onNarration?: (chunk: string) => void;
};

export type CharacterGenerationResult = {
  character: CharacterTemplateDraft;
  source: "openrouter" | "local_fallback";
  warning?: string;
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

function toStatModifier(value: number) {
  if (value <= 4 && value >= -5) {
    return value;
  }

  return Math.max(-5, Math.min(10, Math.floor((value - 10) / 2)));
}

function normalizeGeneratedCharacterDraft(value: unknown): CharacterTemplateDraft | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const raw = value as Record<string, unknown>;
  const normalized = {
    name: typeof raw.name === "string" ? raw.name.trim() : "",
    archetype: typeof raw.archetype === "string" ? raw.archetype.trim() : "",
    strength: toStatModifier(Number(raw.strength ?? 0)),
    agility: toStatModifier(Number(raw.agility ?? 0)),
    intellect: toStatModifier(Number(raw.intellect ?? 0)),
    charisma: toStatModifier(Number(raw.charisma ?? 0)),
    vitality: toStatModifier(Number(raw.vitality ?? 0)),
    maxHealth: Math.max(
      1,
      Math.min(
        99,
        Number(raw.maxHealth ?? 0) > 18
          ? Math.round(Number(raw.maxHealth ?? 0) / 5)
          : Math.round(Number(raw.maxHealth ?? 0)),
      ),
    ),
    backstory:
      typeof raw.backstory === "string" && raw.backstory.trim()
        ? raw.backstory.trim()
        : null,
  };

  const parsed = characterTemplateDraftSchema.safeParse(normalized);
  return parsed.success ? parsed.data : null;
}

const campaignSetupTool = {
  name: "generate_campaign_setup",
  description: "Create a fresh starting campaign setup for a solo fantasy RPG.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      publicSynopsis: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          premise: { type: "string" },
          tone: { type: "string" },
          setting: { type: "string" },
          openingScene: {
            type: "object",
            additionalProperties: false,
            properties: {
              title: { type: "string" },
              location: { type: "string" },
              overview: { type: "string" },
            },
            required: ["title", "location", "overview"],
          },
        },
        required: ["title", "premise", "tone", "setting", "openingScene"],
      },
      secretEngine: {
        type: "object",
        additionalProperties: false,
        properties: {
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
          "villain",
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
    },
    required: ["publicSynopsis", "secretEngine"],
  },
};

const generateCharacterTool = {
  name: "generate_character_template",
  description: "Create a playable fantasy RPG character template from a loose prompt.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      name: { type: "string" },
      archetype: { type: "string" },
      strength: { type: "number", minimum: -5, maximum: 4 },
      agility: { type: "number", minimum: -5, maximum: 4 },
      intellect: { type: "number", minimum: -5, maximum: 4 },
      charisma: { type: "number", minimum: -5, maximum: 4 },
      vitality: { type: "number", minimum: -5, maximum: 4 },
      maxHealth: { type: "number", minimum: 8, maximum: 18 },
      backstory: { type: "string" },
    },
    required: [
      "name",
      "archetype",
      "strength",
      "agility",
      "intellect",
      "charisma",
      "vitality",
      "maxHealth",
      "backstory",
    ],
  },
};

function toFunctionTool(
  tool:
    | typeof triageTool
    | typeof resolutionTool
    | typeof campaignSetupTool
    | typeof generateCharacterTool,
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
  return generatedCampaignSetupSchema.safeParse(value).success;
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

const localDungeonMaster = new LocalDungeonMaster();

class OpenRouterDungeonMaster {
  private fallback = localDungeonMaster;

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

  async generateCampaignSetup(
    character: CampaignCharacter,
    input: CampaignSetupGenerationInput = {},
  ) {
    const seedCharacter = character ?? toCampaignSeedCharacter(createDefaultCharacterTemplate());
    const hasPreviousDraft = Boolean(input.previousDraft);
    const revisionPrompt = input.prompt?.trim() ?? "";
    const basePrompt = input.basePrompt?.trim() ?? "";
    const baseMessages = [
      {
        role: "system" as const,
        content: [
          "You are generating a fresh starting campaign setup for a solo fantasy RPG.",
          "Create a cohesive opening campaign with 2 arcs, 1-2 quests, 2-4 NPCs, 3-5 clues, 1-2 reveals, and 3 opening suggested actions.",
          "Make it immediately playable.",
          "Keep titles and summaries clear, concrete, and gameable.",
          "Keep all output inside publicSynopsis and secretEngine.",
          "publicSynopsis is spoiler-safe and must not reveal secretEngine truths, motives, or hidden reveals.",
          "publicSynopsis.openingScene is only a high-level preview for the player-facing pitch.",
          "publicSynopsis.openingScene.overview must stay descriptive and atmospheric, with no explicit player choices, no branching options, and no DM-style scene instructions.",
          "Place the full playable opener, immediate pressure, and suggested actions in secretEngine.openingScene.",
          "When revising an existing draft, treat the revision request as authoritative.",
          "If the revision conflicts with the previous draft or the original brief, the revision wins and conflicting details must be replaced, not blended.",
          "Use the previous draft as reference material to preserve what still fits, not as canon that must survive unchanged.",
          "Keep the JSON schema and item counts stable, but rewrite titles, summaries, hooks, clues, threats, and opening beats as needed to satisfy the revised brief cleanly.",
          "Ensure clue-to-reveal and reveal-to-arc references line up as closely as possible by title.",
          "Do not reuse Briar Glen, Abbess Veyra, the Silver Bell, or other starter campaign names.",
        ].join("\n"),
      },
      {
        role: "user" as const,
        content: [
          `Generate a campaign for this character: ${seedCharacter.name}, ${seedCharacter.archetype}.`,
          `Stats: strength ${seedCharacter.stats.strength}, agility ${seedCharacter.stats.agility}, intellect ${seedCharacter.stats.intellect}, charisma ${seedCharacter.stats.charisma}, vitality ${seedCharacter.stats.vitality}.`,
          "Lean toward mystery, momentum, and memorable places over lore dumps.",
          revisionPrompt
            ? hasPreviousDraft
              ? [
                  "You are revising an existing campaign draft.",
                  basePrompt ? `Original player brief: ${basePrompt}` : "Original player brief: not provided.",
                  `Revision request: ${revisionPrompt}`,
                  "Build a fresh full draft that satisfies the revised brief.",
                  "Do not compromise between conflicting directions. The revision request overrides older assumptions, pacing, scene beats, and threat timing.",
                  "Use the previous draft only to keep strong material that still fits the revised brief.",
                  "If the revised brief changes pacing or tone, rewrite the opening scene, active threat, hooks, quests, clues, and related summaries so they all point in the new direction.",
                  "Return the full updated JSON, not a partial patch.",
                  "Reference draft JSON:",
                  JSON.stringify(input.previousDraft),
                ].join("\n")
              : `Player prompt: ${revisionPrompt}`
            : "Create a fresh campaign draft.",
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

    try {
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

      const parsed = safeParseJson(
        extractMessageText(fallbackResponse.choices[0]?.message?.content),
      );

      if (isGeneratedCampaignSetup(parsed)) {
        return parsed;
      }
    } catch {
      // Fall back to the local deterministic provider below.
    }

    return this.fallback.generateCampaignSetup(seedCharacter, input);
  }

  async generateCharacter(prompt: string): Promise<CharacterGenerationResult> {
    const trimmedPrompt = prompt.trim();
    let fallbackWarning: string | undefined;

    try {
      const response = await this.client.chat.completions.create({
        model: env.openRouterModel,
        messages: [
          {
            role: "system",
            content: [
              "You create grounded but vivid solo fantasy RPG protagonists.",
              "Return one playable character template.",
              "If the user provides an exact name, archetype, or backstory, preserve those values exactly.",
              "IMPORTANT: stats are small modifiers, not D20 ability scores. Use integers in the range -2 to +3.",
              "IMPORTANT: maxHealth should usually be between 8 and 18.",
              "Keep stats plausible, varied, and coherent with the concept.",
              "Backstory should be concise, specific, and campaign-friendly.",
            ].join("\n"),
          },
          {
            role: "user",
            content: `Create a character from this prompt: ${trimmedPrompt}`,
          },
        ],
        tools: [toFunctionTool(generateCharacterTool)],
        tool_choice: "auto",
        temperature: 0.8,
      });

      const toolCall = response.choices[0]?.message?.tool_calls?.[0];
      const args =
        toolCall && toolCall.type === "function" ? toolCall.function.arguments ?? "" : "";
      const parsed = args
        ? safeParseJson(args)
        : safeParseJson(extractMessageText(response.choices[0]?.message?.content));

      const normalized = normalizeGeneratedCharacterDraft(parsed);
      if (normalized) {
        return {
          character: normalized,
          source: "openrouter",
        };
      }
      fallbackWarning = "OpenRouter returned a character payload that did not match the expected schema.";
      console.warn("[character.generate] OpenRouter tool response failed schema validation.");
    } catch (error) {
      fallbackWarning =
        error instanceof Error
          ? `OpenRouter tool generation failed: ${error.message}`
          : "OpenRouter tool generation failed.";
      console.warn("[character.generate] OpenRouter tool generation failed.", error);
    }

    try {
      const fallbackResponse = await this.client.chat.completions.create({
        model: env.openRouterModel,
        messages: [
          {
            role: "system",
            content: [
              "Return only a valid JSON object.",
              "Do not include markdown, explanations, or code fences.",
              `JSON schema: ${JSON.stringify(generateCharacterTool.input_schema)}`,
            ].join("\n"),
          },
          {
            role: "user",
            content: `Create a character from this prompt: ${trimmedPrompt}`,
          },
        ],
        temperature: 0.8,
      });

      const parsed = safeParseJson(
        extractMessageText(fallbackResponse.choices[0]?.message?.content),
      );

      const normalized = normalizeGeneratedCharacterDraft(parsed);
      if (normalized) {
        return {
          character: normalized,
          source: "openrouter",
        };
      }
      fallbackWarning =
        "OpenRouter raw JSON response did not match the expected schema. Used local fallback instead.";
      console.warn("[character.generate] OpenRouter raw JSON response failed schema validation.");
    } catch (error) {
      fallbackWarning =
        error instanceof Error
          ? `OpenRouter raw JSON generation failed: ${error.message}`
          : "OpenRouter raw JSON generation failed.";
      console.warn("[character.generate] OpenRouter raw JSON generation failed.", error);
    }

    const character = await this.fallback.generateCharacter(trimmedPrompt);
    return {
      character,
      source: "local_fallback",
      warning: fallbackWarning ?? "Generated with local fallback instead of OpenRouter.",
    };
  }

  async triageTurn(input: TurnAIPayload, callbacks?: StreamCallbacks): Promise<TriageDecision> {
    try {
      const result = await this.runStream({
        prompt: buildTriageUserPrompt(input),
        tool: triageTool,
        onNarration: callbacks?.onNarration,
      });

      const normalized = normalizeTriageDecision(result.toolInput, input, result.text);
      if (isTriageDecision(normalized)) {
        return normalized;
      }
    } catch {
      // Fall back to the local deterministic provider below.
    }

    return this.fallback.triageTurn(input, callbacks);
  }

  async resolveTurn(
    input: TurnAIPayload & { checkResult: CheckResult },
    callbacks?: StreamCallbacks,
  ): Promise<ResolveDecision> {
    try {
      const result = await this.runStream({
        prompt: buildOutcomeUserPrompt(input),
        tool: resolutionTool,
        onNarration: callbacks?.onNarration,
      });

      const normalized = normalizeResolveDecision(result.toolInput, result.text);
      if (isResolveDecision(normalized)) {
        return normalized;
      }
    } catch {
      // Fall back to the local deterministic provider below.
    }

    return this.fallback.resolveTurn(input, callbacks);
  }

  async summarizeSession(messages: string[]) {
    try {
      const response = await this.client.chat.completions.create({
        model: env.openRouterModel,
        messages: [
          {
            role: "system",
            content: [
              "Write a short player-facing session recap for a solo RPG journal.",
              "Use only facts explicitly present in the transcript.",
              "Do not infer hidden motives, secret identities, unrevealed clues, or backstage plot structure.",
              "Keep it concrete, show-not-tell, and limited to 2-3 sentences.",
            ].join("\n"),
          },
          {
            role: "user",
            content: `Summarize this session in 2-3 sentences for future prompt context:\n${messages.join("\n")}`,
          },
        ],
      });

      return (
        response.choices[0]?.message?.content ??
        this.fallback.summarizeSession(messages)
      );
    } catch {
      return this.fallback.summarizeSession(messages);
    }
  }

  async generatePreviouslyOn(summary: string, scene: string, clueText: string[]) {
    try {
      const response = await this.client.chat.completions.create({
        model: env.openRouterModel,
        messages: [
          {
            role: "system",
            content: [
              "Write a player-facing 'Previously on...' recap for a solo RPG.",
              "Use only facts already established in play.",
              "Do not infer hidden motives, secret roles, unseen clues, or unrevealed structure.",
              "Keep it to two sentences, concrete, and atmospheric rather than explanatory.",
            ].join("\n"),
          },
          {
            role: "user",
            content: `Previous session summary: ${summary}\nCurrent scene: ${scene}\nDiscovered clues still hanging in the air: ${clueText.join(", ") || "none"}\n\nWrite a dramatic two-sentence "Previously on..." recap.`,
          },
        ],
      });

      return (
        response.choices[0]?.message?.content ??
        this.fallback.generatePreviouslyOn(summary, scene, clueText)
      );
    } catch {
      return this.fallback.generatePreviouslyOn(summary, scene, clueText);
    }
  }
}

export const dmClient = env.openRouterApiKey
  ? new OpenRouterDungeonMaster()
  : localDungeonMaster;
