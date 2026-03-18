import OpenAI from "openai";
import {
  auditNarration,
  auditSceneSnapshot,
  buildNarrationRetryInstructions,
  type NarrationAuditIssue,
} from "@/lib/ai/narration-audit";
import { LocalDungeonMaster } from "@/lib/ai/local-provider";
import { env } from "@/lib/env";
import { characterTemplateDraftSchema } from "@/lib/game/characters";
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
  generatedCampaignOpeningSchema,
  generatedCampaignSetupSchema,
} from "@/lib/game/session-zero";
import type {
  CampaignBlueprint,
  CharacterTemplate,
  CharacterTemplateDraft,
  CheckResult,
  GeneratedCampaignOpening,
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
  isInvestigative?: boolean;
};

type CampaignOpeningInput = {
  setup: GeneratedCampaignSetup;
  character: CharacterTemplate;
  prompt?: string;
  previousDraft?: GeneratedCampaignOpening;
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
        },
        required: ["title", "premise", "tone", "setting"],
      },
      secretEngine: {
        type: "object",
        additionalProperties: false,
        properties: {
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

const campaignOpeningTool = {
  name: "generate_campaign_opening",
  description: "Create the runtime opening for a specific hero entering a reusable adventure module.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      narration: { type: "string" },
      activeThreat: { type: "string" },
      scene: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          summary: {
            type: "string",
            description:
              "One factual 1-2 sentence tactical snapshot of the current scene state. No metaphors, atmospheric flourish, emotional language, or recap prose.",
          },
          location: { type: "string" },
          atmosphere: { type: "string" },
          suggestedActions: {
            type: "array",
            items: { type: "string" },
          },
        },
        required: ["title", "summary", "location", "atmosphere", "suggestedActions"],
      },
    },
    required: ["narration", "activeThreat", "scene"],
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
    | typeof campaignOpeningTool
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

function isGeneratedCampaignOpening(value: unknown): value is GeneratedCampaignOpening {
  return generatedCampaignOpeningSchema.safeParse(value).success;
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

function inferInvestigativeAction(playerAction: string) {
  return /(inspect|investigate|search|study|observe|watch|listen|track|follow|question|interrogate|ask|read|examine|loot|check|decipher)/i.test(
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

function extractNarrationValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function extractSceneSnapshotValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function hasFreshNarration(narration: string | null | undefined, text: string) {
  return Boolean(sanitizeNarration(text) || (typeof narration === "string" && narration.trim()));
}

function normalizeDiscoveryDelta(value: Record<string, unknown>) {
  const normalized = {
    ...value,
  } as ProposedStateDelta;

  if ("npcDiscoveries" in value || "npc_discoveries" in value) {
    normalized.npcDiscoveries = toStringArray(value.npcDiscoveries ?? value.npc_discoveries);
  }

  if ("questDiscoveries" in value || "quest_discoveries" in value) {
    normalized.questDiscoveries = toStringArray(value.questDiscoveries ?? value.quest_discoveries);
  }

  if ("healthDelta" in value || "health_delta" in value) {
    const raw = Number(value.healthDelta ?? value.health_delta);
    normalized.healthDelta = Number.isFinite(raw) ? Math.trunc(raw) : undefined;
  }

  const sceneSnapshot = extractSceneSnapshotValue(
    value.sceneSnapshot ?? value.scene_snapshot ?? value.sceneSummary ?? value.scene_summary,
  );
  if (sceneSnapshot) {
    normalized.sceneSnapshot = sceneSnapshot;
  }

  delete (normalized as Record<string, unknown>).sceneSummary;
  delete (normalized as Record<string, unknown>).scene_summary;

  return normalized;
}

function normalizeTriageDecision(
  raw: unknown,
  input: TurnAIPayload,
  text: string,
): TriageDecision {
  const payload = toObject(unwrapStructuredPayload(raw));
  const payloadNarration = extractNarrationValue(
    payload?.narration ?? payload?.sceneSnapshot ?? payload?.sceneSummary,
  );
  const suggestedActions = toStringArray(
    payload?.suggestedActions ??
      payload?.suggested_actions ??
      payload?.actions ??
      payload?.nextMoves,
  ).slice(0, 4);
  const proposedDelta = normalizeDiscoveryDelta(
    toObject(payload?.proposedDelta ?? payload?.proposed_delta ?? payload?.delta) ?? {},
  );
  const proposedDeltaWithActions =
    suggestedActions.length > 0 && !Array.isArray(proposedDelta.suggestedActions)
      ? {
          ...proposedDelta,
          suggestedActions,
        }
      : proposedDelta;
  const isInvestigative =
    typeof payload?.isInvestigative === "boolean"
      ? payload.isInvestigative
      : typeof payload?.is_investigative === "boolean"
        ? payload.is_investigative
        : inferInvestigativeAction(input.playerAction);
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
      narration: null,
      isInvestigative,
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
  const normalizedNarration = payloadNarration || narration;

  return {
    requiresCheck: false,
    narration: normalizedNarration || null,
    isInvestigative,
    suggestedActions,
    proposedDelta: proposedDeltaWithActions as ProposedStateDelta,
  };
}

function normalizeResolveDecision(raw: unknown, text: string): ResolveDecision {
  const payload = toObject(unwrapStructuredPayload(raw));
  const payloadNarration = extractNarrationValue(
    payload?.narration ?? payload?.sceneSnapshot ?? payload?.sceneSummary,
  );
  const suggestedActions = toStringArray(
    payload?.suggestedActions ??
      payload?.suggested_actions ??
      payload?.actions ??
      payload?.nextMoves,
  ).slice(0, 4);
  const proposedDelta = normalizeDiscoveryDelta(
    toObject(payload?.proposedDelta ?? payload?.proposed_delta ?? payload?.delta) ?? {},
  );
  const proposedDeltaWithActions =
    suggestedActions.length > 0 && !Array.isArray(proposedDelta.suggestedActions)
      ? {
          ...proposedDelta,
          suggestedActions,
        }
      : proposedDelta;
  const narration = sanitizeNarration(text);
  const normalizedNarration = payloadNarration || narration;

  return {
    narration: normalizedNarration,
    suggestedActions,
    proposedDelta: proposedDeltaWithActions as ProposedStateDelta,
  };
}

function buildTurnRetryPrompt(basePrompt: string, issues: NarrationAuditIssue[]) {
  return [
    basePrompt,
    "",
    "QUALITY CORRECTION",
    "Rewrite the narration and return a full replacement tool payload.",
    "Fix these specific issues:",
    buildNarrationRetryInstructions(issues),
  ].join("\n");
}

function chooseCleanerNarration<T extends { narration: string | null }>(
  original: { value: T; issues: NarrationAuditIssue[] },
  retried: { value: T; issues: NarrationAuditIssue[] },
) {
  if (retried.issues.length < original.issues.length) {
    return retried;
  }

  if (retried.issues.length > original.issues.length) {
    return original;
  }

  const originalLength = original.value.narration?.trim().length ?? 0;
  const retriedLength = retried.value.narration?.trim().length ?? 0;

  if (retriedLength > 0 && originalLength === 0) {
    return retried;
  }

  if (retriedLength > 0 && retriedLength <= originalLength * 1.35) {
    return retried;
  }

  return original;
}

function chooseCleanerOpening(
  original: { value: GeneratedCampaignOpening; issues: NarrationAuditIssue[] },
  retried: { value: GeneratedCampaignOpening; issues: NarrationAuditIssue[] },
) {
  if (retried.issues.length < original.issues.length) {
    return retried;
  }

  if (retried.issues.length > original.issues.length) {
    return original;
  }

  if (retried.value.narration.trim() && retried.value.narration.length <= original.value.narration.length * 1.35) {
    return retried;
  }

  return original;
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

  private async runToolRetry(input: {
    prompt: string;
    tool: typeof triageTool | typeof resolutionTool;
  }): Promise<OpenRouterToolResult> {
    const response = await this.client.chat.completions.create({
      model: env.openRouterModel,
      messages: [
        {
          role: "system",
          content: [
            buildDungeonMasterSystemPrompt(),
            "Return the narration inside the tool payload field narration.",
            "Do not rely on assistant text outside the tool call.",
          ].join("\n"),
        },
        {
          role: "user",
          content: input.prompt,
        },
      ],
      tools: [toFunctionTool(input.tool)],
      tool_choice: "auto",
      temperature: 0.65,
    });

    const message = response.choices[0]?.message;
    const toolCall = message?.tool_calls?.[0];
    const toolArguments =
      toolCall && toolCall.type === "function" ? toolCall.function.arguments ?? "" : "";
    const text = extractMessageText(message?.content);

    return {
      text,
      toolInput: toolArguments ? safeParseJson(toolArguments) : safeParseJson(text),
    };
  }

  private async retryCampaignOpening(
    input: CampaignOpeningInput,
    issues: NarrationAuditIssue[],
  ): Promise<GeneratedCampaignOpening | null> {
    const response = await this.client.chat.completions.create({
      model: env.openRouterModel,
      messages: [
        {
          role: "system",
          content: [
            "Write the opening narration for a new solo RPG campaign.",
            "Start in the immediate present external scene with a playable problem.",
            "Do not open with backstory recap, internal monologue, or thematic framing.",
            "Do not narrate the player's feelings, confidence, certainty, or private thoughts unless they explicitly stated them.",
            "Do not close with an editorial or thematic statement.",
            "Return structured output with narration, activeThreat, and scene details.",
            "scene.summary must be a short present-tense snapshot of the current tactical situation, not a recap of the whole setup.",
          ].join("\n"),
        },
        {
          role: "user",
          content: [
            `Character: ${input.character.name}, ${input.character.archetype}.`,
            `Backstory: ${input.character.backstory ?? "None provided."}`,
            `Public synopsis: ${JSON.stringify(input.setup.publicSynopsis)}`,
            `Secret engine: ${JSON.stringify(input.setup.secretEngine)}`,
            "Rewrite the opening from scratch and return the full updated structured opening.",
            "Fix these specific issues:",
            buildNarrationRetryInstructions(issues),
            input.previousDraft ? `Previous draft: ${JSON.stringify(input.previousDraft)}` : "",
            input.prompt?.trim() ? `Additional direction: ${input.prompt.trim()}` : "",
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
      tools: [toFunctionTool(campaignOpeningTool)],
      tool_choice: "auto",
      temperature: 0.65,
    });

    const toolCall = response.choices[0]?.message?.tool_calls?.[0];
    const args =
      toolCall && toolCall.type === "function" ? toolCall.function.arguments ?? "" : "";
    const parsed = args
      ? safeParseJson(args)
      : safeParseJson(extractMessageText(response.choices[0]?.message?.content));

    return isGeneratedCampaignOpening(parsed) ? parsed : null;
  }

  private async ensureOpeningSceneSummary(opening: GeneratedCampaignOpening) {
    const audit = auditSceneSnapshot(opening.scene.summary);

    if (!audit.shouldCompress) {
      return opening;
    }

    return {
      ...opening,
      scene: {
        ...opening.scene,
        summary: await this.compressSceneSnapshot(opening.scene.summary),
      },
    };
  }

  async compressSceneSnapshot(summary: string) {
    const normalized = stripCodeFences(summary).replace(/\s+/g, " ").trim();

    if (!normalized) {
      return "";
    }

    try {
      const compressionModel = env.openRouterCompressionModel || env.openRouterModel;
      const response = await this.client.chat.completions.create({
        model: compressionModel,
        messages: [
          {
            role: "system",
            content: [
              "Compress a scene summary into a factual tactical snapshot.",
              "Return only 1-2 short sentences.",
              "Keep only what is explicitly present in the input.",
              "Do not invent enemies, cover, objects, motives, or opportunities that are not stated.",
              "Do not use metaphors, thematic lines, emotional language, recap framing, or atmospheric flourish.",
              "Focus on who or what is physically present, the current pressure, and the immediate opening or threat.",
            ].join("\n"),
          },
          {
            role: "user",
            content: normalized,
          },
        ],
        temperature: 0,
        top_p: 1,
      });

      const compressed = extractMessageText(response.choices[0]?.message?.content)
        .replace(/\s+/g, " ")
        .trim();

      return compressed || this.fallback.compressSceneSnapshot(normalized);
    } catch {
      return this.fallback.compressSceneSnapshot(normalized);
    }
  }

  async generateCampaignSetup(
    input: CampaignSetupGenerationInput = {},
  ) {
    const hasPreviousDraft = Boolean(input.previousDraft);
    const revisionPrompt = input.prompt?.trim() ?? "";
    const basePrompt = input.basePrompt?.trim() ?? "";
    const baseMessages = [
      {
        role: "system" as const,
        content: [
          "You are generating a fresh reusable adventure module for a solo fantasy RPG.",
          "The module must be character-agnostic by default.",
          "Create a cohesive campaign framework with 2 arcs, 1-2 quests, 2-4 NPCs, 3-5 clues, and 1-2 reveals.",
          "Make it reusable across different heroes entering from very different perspectives.",
          "Keep titles and summaries clear, concrete, and gameable.",
          "Keep all output inside publicSynopsis and secretEngine.",
          "Do not write the premise, opener, or hook around a named protagonist, class, or build.",
          "Describe a world, situation, and immediate pressure that different heroes could enter from different perspectives.",
          "publicSynopsis is spoiler-safe and must not reveal secretEngine truths, motives, or hidden reveals.",
          "Do not create or describe a specific opening scene for the module.",
          "Do not include arrival beats, starting locations, suggested opening actions, or scene framing tied to a first session.",
          "The opening scene will be generated later at runtime when a specific character launches a campaign from this module.",
          "When revising an existing draft, treat the revision request as authoritative.",
          "If the revision conflicts with the previous draft or the original brief, the revision wins and conflicting details must be replaced, not blended.",
          "Use the previous draft as reference material to preserve what still fits, not as canon that must survive unchanged.",
          "Keep the JSON schema and item counts stable, but rewrite titles, summaries, hooks, clues, factions, and threats as needed to satisfy the revised brief cleanly.",
          "Ensure clue-to-reveal and reveal-to-arc references line up as closely as possible by title.",
          "Do not reuse Briar Glen, Abbess Veyra, the Silver Bell, or other starter campaign names.",
        ].join("\n"),
      },
      {
        role: "user" as const,
        content: [
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
                  "If the revised brief changes pacing or tone, rewrite the world pressure, hooks, quests, clues, and related summaries so they all point in the new direction.",
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

    return this.fallback.generateCampaignSetup(input);
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

  async generateCampaignOpening(input: CampaignOpeningInput) {
    const revisionPrompt = input.prompt?.trim() ?? "";
    const hasPreviousDraft = Boolean(input.previousDraft);

    try {
      const response = await this.client.chat.completions.create({
        model: env.openRouterModel,
        messages: [
          {
            role: "system",
            content: [
              "Write the opening narration for a new solo RPG campaign.",
              "The world/module is already defined. Your job is to frame this specific hero's entrance into it.",
              "Be character-specific, but do not rewrite module facts, secret truths, or core campaign pressure.",
              "Different heroes should plausibly enter the same module from very different angles.",
              "Generate the first actual playable scene for this hero.",
              "Keep it vivid, specific, player-facing, and grounded in present external action.",
              "Start in the immediate scene pressure, not with recap or internal monologue.",
              "Do not narrate the player's feelings, confidence, certainty, or private thoughts unless they explicitly stated them.",
              "Do not close with a thematic or editorial statement.",
              "Do not expose hidden motives, unrevealed truths, or backstage structure.",
              "Return structured output with narration, activeThreat, and scene details.",
              "scene.summary must be a short present-tense snapshot of the current tactical situation, not a recap of the whole setup.",
              "scene.suggestedActions must contain 2-4 concrete immediate actions the player could plausibly take.",
            ].join("\n"),
          },
          {
            role: "user",
            content: [
              `Character: ${input.character.name}, ${input.character.archetype}.`,
              `Backstory: ${input.character.backstory ?? "None provided."}`,
              `Public synopsis: ${JSON.stringify(input.setup.publicSynopsis)}`,
              `Secret engine: ${JSON.stringify(input.setup.secretEngine)}`,
              revisionPrompt
                ? hasPreviousDraft
                  ? [
                      `Revision request: ${revisionPrompt}`,
                      "Revise the previous opening draft for this same hero and module.",
                      "Preserve good material unless the revision conflicts with it.",
                      "Return the full updated structured opening draft, not a partial patch.",
                      `Previous draft: ${JSON.stringify(input.previousDraft)}`,
                    ].join("\n")
                  : `Create this hero's first entrance into the module as a concrete starting scene. Additional direction: ${revisionPrompt}`
                : "Create this hero's first entrance into the module as a concrete starting scene.",
            ].join("\n"),
          },
        ],
        tools: [toFunctionTool(campaignOpeningTool)],
        tool_choice: "auto",
        temperature: 0.9,
      });

      const toolCall = response.choices[0]?.message?.tool_calls?.[0];
      const args =
        toolCall && toolCall.type === "function" ? toolCall.function.arguments ?? "" : "";
      const parsed = args
        ? safeParseJson(args)
        : safeParseJson(extractMessageText(response.choices[0]?.message?.content));

      if (isGeneratedCampaignOpening(parsed)) {
        const normalizedOpening = await this.ensureOpeningSceneSummary(parsed);
        const openingAudit = auditNarration({
          mode: "opening",
          narration: normalizedOpening.narration,
        });
        if (!openingAudit.shouldRetry) {
          return normalizedOpening;
        }

        console.warn(
          `[dm.opening] Opening draft triggered narration audit: ${openingAudit.issues.map((issue) => issue.code).join(", ")}.`,
        );
        const retried = await this.retryCampaignOpening(input, openingAudit.issues);
        if (retried) {
          const normalizedRetry = await this.ensureOpeningSceneSummary(retried);
          const retriedAudit = auditNarration({
            mode: "opening",
            narration: normalizedRetry.narration,
          });
          const chosen = chooseCleanerOpening(
            { value: normalizedOpening, issues: openingAudit.issues },
            { value: normalizedRetry, issues: retriedAudit.issues },
          );
          if (chosen.issues.length === 0) {
            return chosen.value;
          }

          console.warn(
            `[dm.opening] OpenRouter opening still failed narration audit after retry: ${chosen.issues.map((issue) => issue.code).join(", ")}. Falling back to local opening.`,
          );
          return this.ensureOpeningSceneSummary(await this.fallback.generateCampaignOpening(input));
        }

        console.warn("[dm.opening] Retry did not return a valid opening. Falling back to local opening.");
        return this.ensureOpeningSceneSummary(await this.fallback.generateCampaignOpening(input));
      }
    } catch {
      // Fall through to raw-JSON generation or local fallback below.
    }

    try {
      const fallbackResponse = await this.client.chat.completions.create({
        model: env.openRouterModel,
        messages: [
          {
            role: "system",
            content: [
              "Generate the first actual playable scene for a hero entering a reusable solo RPG module.",
              "Return only a valid JSON object.",
              "Do not include markdown, explanations, or code fences.",
              "Start in the immediate external scene with a playable problem, not recap.",
              "Do not narrate the player's feelings, confidence, certainty, or private thoughts unless they explicitly stated them.",
              "Do not end with a thematic or editorial line.",
              "scene.summary must be a short present-tense snapshot, not a recap paragraph.",
              `JSON schema: ${JSON.stringify(campaignOpeningTool.input_schema)}`,
            ].join("\n"),
          },
          {
            role: "user",
            content: [
              `Character: ${input.character.name}, ${input.character.archetype}.`,
              `Backstory: ${input.character.backstory ?? "None provided."}`,
              `Public synopsis: ${JSON.stringify(input.setup.publicSynopsis)}`,
              `Secret engine: ${JSON.stringify(input.setup.secretEngine)}`,
              revisionPrompt
                ? hasPreviousDraft
                  ? [
                      `Revision request: ${revisionPrompt}`,
                      "Revise the previous opening draft for this same hero and module.",
                      `Previous draft: ${JSON.stringify(input.previousDraft)}`,
                    ].join("\n")
                  : `Additional direction: ${revisionPrompt}`
                : "",
            ].join("\n"),
          },
        ],
        temperature: 0.9,
      });

      const parsed = safeParseJson(
        extractMessageText(fallbackResponse.choices[0]?.message?.content),
      );

      if (isGeneratedCampaignOpening(parsed)) {
        const normalizedOpening = await this.ensureOpeningSceneSummary(parsed);
        const openingAudit = auditNarration({
          mode: "opening",
          narration: normalizedOpening.narration,
        });
        if (!openingAudit.shouldRetry) {
          return normalizedOpening;
        }

        console.warn(
          `[dm.opening] Raw JSON opening triggered narration audit: ${openingAudit.issues.map((issue) => issue.code).join(", ")}.`,
        );
        const retried = await this.retryCampaignOpening(input, openingAudit.issues);
        if (retried) {
          const normalizedRetry = await this.ensureOpeningSceneSummary(retried);
          const retriedAudit = auditNarration({
            mode: "opening",
            narration: normalizedRetry.narration,
          });
          const chosen = chooseCleanerOpening(
            { value: normalizedOpening, issues: openingAudit.issues },
            { value: normalizedRetry, issues: retriedAudit.issues },
          );
          if (chosen.issues.length === 0) {
            return chosen.value;
          }

          console.warn(
            `[dm.opening] Raw JSON opening still failed narration audit after retry: ${chosen.issues.map((issue) => issue.code).join(", ")}. Falling back to local opening.`,
          );
          return this.ensureOpeningSceneSummary(await this.fallback.generateCampaignOpening(input));
        }

        console.warn("[dm.opening] Retry did not return a valid opening. Falling back to local opening.");
        return this.ensureOpeningSceneSummary(await this.fallback.generateCampaignOpening(input));
      }
    } catch {
      // Fall back to the local provider below.
    }

    return this.ensureOpeningSceneSummary(await this.fallback.generateCampaignOpening(input));
  }

  async triageTurn(input: TurnAIPayload, callbacks?: StreamCallbacks): Promise<TriageDecision> {
    try {
      const basePrompt = buildTriageUserPrompt(input);
      const result = await this.runStream({
        prompt: basePrompt,
        tool: triageTool,
      });

      const normalized = normalizeTriageDecision(result.toolInput, input, result.text);
      if (isTriageDecision(normalized)) {
        if (!normalized.requiresCheck && !hasFreshNarration(normalized.narration, result.text)) {
          console.warn("[dm.triage] Streaming tool output had no narration. Retrying with required tool payload.");
          const retryResult = await this.runToolRetry({
            prompt: basePrompt,
            tool: triageTool,
          });
          const retried = normalizeTriageDecision(retryResult.toolInput, input, retryResult.text);
          if (isTriageDecision(retried) && (retried.requiresCheck || hasFreshNarration(retried.narration, retryResult.text))) {
            if (retried.narration?.trim()) {
              callbacks?.onNarration?.(retried.narration.trim());
            }
            return retried;
          }

          throw new Error("OpenRouter triage returned no fresh narration for a no-check turn.");
        }

        if (!normalized.requiresCheck && normalized.narration) {
          const audit = auditNarration({
            mode: "triage",
            narration: normalized.narration,
            playerAction: input.playerAction,
            recentTurnLedger: input.promptContext.recentTurnLedger,
          });

          if (audit.shouldRetry) {
            console.warn(
              `[dm.triage] Narration audit triggered retry: ${audit.issues.map((issue) => issue.code).join(", ")}.`,
            );
            const retryResult = await this.runToolRetry({
              prompt: buildTurnRetryPrompt(basePrompt, audit.issues),
              tool: triageTool,
            });
            const retried = normalizeTriageDecision(retryResult.toolInput, input, retryResult.text);

            if (isTriageDecision(retried) && !retried.requiresCheck && retried.narration) {
              const retriedAudit = auditNarration({
                mode: "triage",
                narration: retried.narration,
                playerAction: input.playerAction,
                recentTurnLedger: input.promptContext.recentTurnLedger,
              });
              const chosen = chooseCleanerNarration(
                { value: normalized, issues: audit.issues },
                { value: retried, issues: retriedAudit.issues },
              );

              if (retriedAudit.issues.length > 0 && chosen.value === normalized) {
                console.warn(
                  `[dm.triage] Retry still triggered narration audit: ${retriedAudit.issues.map((issue) => issue.code).join(", ")}.`,
                );
              }

              const chosenIssues = chosen.value === normalized ? audit.issues : retriedAudit.issues;
              if (chosenIssues.length > 0) {
                console.warn(
                  `[dm.triage] OpenRouter narration still failed audit after retry: ${chosenIssues.map((issue) => issue.code).join(", ")}. Falling back to local turn narration.`,
                );
                return this.fallback.triageTurn(input, callbacks);
              }

              if (chosen.value.narration?.trim()) {
                callbacks?.onNarration?.(chosen.value.narration.trim());
              }
              return chosen.value;
            }
          }
        }

        if (normalized.narration?.trim()) {
          callbacks?.onNarration?.(normalized.narration.trim());
        }
        return normalized;
      }
    } catch {
      // Fall back to the local deterministic provider below.
    }

    return this.fallback.triageTurn(input, callbacks);
  }

  async resolveTurn(
    input: TurnAIPayload & { checkResult: CheckResult; isInvestigative: boolean },
    callbacks?: StreamCallbacks,
  ): Promise<ResolveDecision> {
    try {
      const basePrompt = buildOutcomeUserPrompt(input);
      const result = await this.runStream({
        prompt: basePrompt,
        tool: resolutionTool,
      });

      const normalized = normalizeResolveDecision(result.toolInput, result.text);
      if (isResolveDecision(normalized)) {
        if (!hasFreshNarration(normalized.narration, result.text)) {
          console.warn("[dm.resolve] Streaming tool output had no narration. Retrying with required tool payload.");
          const retryResult = await this.runToolRetry({
            prompt: basePrompt,
            tool: resolutionTool,
          });
          const retried = normalizeResolveDecision(retryResult.toolInput, retryResult.text);
          if (isResolveDecision(retried) && hasFreshNarration(retried.narration, retryResult.text)) {
            if (retried.narration?.trim()) {
              callbacks?.onNarration?.(retried.narration.trim());
            }
            return retried;
          }

          throw new Error("OpenRouter resolution returned no fresh narration.");
        }

        const audit = auditNarration({
          mode: "resolution",
          narration: normalized.narration,
          playerAction: input.playerAction,
          recentTurnLedger: input.promptContext.recentTurnLedger,
        });

        if (audit.shouldRetry) {
          console.warn(
            `[dm.resolve] Narration audit triggered retry: ${audit.issues.map((issue) => issue.code).join(", ")}.`,
          );
          const retryResult = await this.runToolRetry({
            prompt: buildTurnRetryPrompt(basePrompt, audit.issues),
            tool: resolutionTool,
          });
          const retried = normalizeResolveDecision(retryResult.toolInput, retryResult.text);

          if (isResolveDecision(retried) && retried.narration) {
            const retriedAudit = auditNarration({
              mode: "resolution",
              narration: retried.narration,
              playerAction: input.playerAction,
              recentTurnLedger: input.promptContext.recentTurnLedger,
            });
            const chosen = chooseCleanerNarration(
              { value: normalized, issues: audit.issues },
              { value: retried, issues: retriedAudit.issues },
            );

            if (retriedAudit.issues.length > 0 && chosen.value === normalized) {
              console.warn(
                `[dm.resolve] Retry still triggered narration audit: ${retriedAudit.issues.map((issue) => issue.code).join(", ")}.`,
              );
            }

            const chosenIssues = chosen.value === normalized ? audit.issues : retriedAudit.issues;
            if (chosenIssues.length > 0) {
              console.warn(
                `[dm.resolve] OpenRouter narration still failed audit after retry: ${chosenIssues.map((issue) => issue.code).join(", ")}. Falling back to local turn narration.`,
              );
              return this.fallback.resolveTurn(input, callbacks);
            }

            if (chosen.value.narration?.trim()) {
              callbacks?.onNarration?.(chosen.value.narration.trim());
            }
            return chosen.value;
          }
        }

        if (normalized.narration.trim()) {
          callbacks?.onNarration?.(normalized.narration.trim());
        }
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
