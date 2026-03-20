import OpenAI from "openai";
import { z } from "zod";
import { env } from "@/lib/env";
import { characterTemplateDraftSchema } from "@/lib/game/characters";
import { MAX_STARTER_ITEMS, normalizeItemNameList } from "@/lib/game/item-utils";
import { generatedCampaignOpeningSchema, generatedWorldModuleSchema } from "@/lib/game/session-zero";
import type {
  CampaignCharacter,
  CharacterTemplate,
  CharacterTemplateDraft,
  GeneratedCampaignOpening,
  GeneratedWorldModule,
  OpenWorldEntryPoint,
  SpatialPromptContext,
  TurnActionToolCall,
} from "@/lib/game/types";
import {
  validateWorldModuleCoherence,
  validateWorldModulePlayability,
} from "@/lib/game/world-validation";

type CampaignOpeningInput = {
  module: GeneratedWorldModule;
  character: CharacterTemplate;
  entryPoint: OpenWorldEntryPoint;
  prompt?: string;
  previousDraft?: GeneratedCampaignOpening;
};

type TurnInput = {
  promptContext: SpatialPromptContext;
  character: CampaignCharacter;
  playerAction: string;
};

function toFunctionTool(tool: {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}) {
  return {
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema,
    },
  };
}

function safeParseJson(value: unknown): unknown {
  if (typeof value !== "string") {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    const firstBrace = value.indexOf("{");
    const lastBrace = value.lastIndexOf("}");

    if (firstBrace >= 0 && lastBrace > firstBrace) {
      try {
        return JSON.parse(value.slice(firstBrace, lastBrace + 1));
      } catch {
        return null;
      }
    }
  }

  return null;
}

function createClient() {
  const apiKey = env.openRouterApiKey || env.openRouterApiKey2;

  if (!apiKey) {
    return null;
  }

  return new OpenAI({
    apiKey,
    baseURL: "https://openrouter.ai/api/v1",
    defaultHeaders: {
      "HTTP-Referer": env.appUrl,
      "X-Title": env.openRouterSiteName,
    },
  });
}

function missingAiConfigurationError() {
  return new Error(
    "AI generation is unavailable. Set OPENROUTER_API_KEY or OPENROUTER_API_KEY_2. Deterministic fallback has been disabled for story quality.",
  );
}

function summarizeWorld(module: GeneratedWorldModule) {
  return {
    title: module.title,
    premise: module.premise,
    tone: module.tone,
    setting: module.setting,
    locations: module.locations.map((location) => ({
      id: location.id,
      name: location.name,
      type: location.type,
      state: location.state,
      summary: location.summary,
    })),
    factions: module.factions.map((faction) => ({
      id: faction.id,
      name: faction.name,
      type: faction.type,
      agenda: faction.agenda,
    })),
    entryPoints: module.entryPoints,
  };
}

function normalizeCharacterToolInput(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return input;
  }

  const record = input as Record<string, unknown>;

  return {
    ...record,
    backstory: typeof record.backstory === "string" ? record.backstory : null,
    starterItems: normalizeItemNameList(
      Array.isArray(record.starterItems)
        ? record.starterItems.filter((item): item is string => typeof item === "string")
        : [],
      { maxItems: MAX_STARTER_ITEMS },
    ),
  };
}

const characterTool = {
  name: "generate_character_template",
  description: "Generate one grounded but vivid solo RPG protagonist.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      name: { type: "string", minLength: 1 },
      archetype: { type: "string", minLength: 1 },
      strength: { type: "number", minimum: -5, maximum: 10 },
      dexterity: { type: "number", minimum: -5, maximum: 10 },
      constitution: { type: "number", minimum: -5, maximum: 10 },
      intelligence: { type: "number", minimum: -5, maximum: 10 },
      wisdom: { type: "number", minimum: -5, maximum: 10 },
      charisma: { type: "number", minimum: -5, maximum: 10 },
      maxHealth: { type: "number", minimum: 1, maximum: 99 },
      backstory: { type: ["string", "null"] },
      starterItems: {
        type: "array",
        items: { type: "string" },
      },
    },
    required: [
      "name",
      "archetype",
      "strength",
      "dexterity",
      "constitution",
      "intelligence",
      "wisdom",
      "charisma",
      "maxHealth",
      "backstory",
      "starterItems",
    ],
  },
};

const moduleTool = {
  name: "generate_open_world_module",
  description: "Generate an open-world module for a solo fantasy campaign.",
  input_schema: z.toJSONSchema(generatedWorldModuleSchema),
};

const openingTool = {
  name: "generate_campaign_opening",
  description: "Generate the opening scene for a chosen entry point.",
  input_schema: z.toJSONSchema(generatedCampaignOpeningSchema),
};

const actionTools = [
  {
    name: "execute_travel",
    description: "Travel along a known adjacent route.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        routeEdgeId: { type: "string" },
        targetLocationId: { type: "string" },
        narration: { type: "string" },
        suggestedActions: { type: "array", items: { type: "string" } },
        timeMode: { type: "string", enum: ["travel"] },
        timeElapsed: { type: "number" },
        citedEntities: {
          type: "object",
          additionalProperties: false,
          properties: {
            npcIds: { type: "array", items: { type: "string" } },
            locationIds: { type: "array", items: { type: "string" } },
            factionIds: { type: "array", items: { type: "string" } },
            commodityIds: { type: "array", items: { type: "string" } },
            informationIds: { type: "array", items: { type: "string" } },
          },
          required: ["npcIds", "locationIds", "factionIds", "commodityIds", "informationIds"],
        },
      },
      required: [
        "routeEdgeId",
        "targetLocationId",
        "narration",
        "suggestedActions",
        "timeMode",
        "timeElapsed",
        "citedEntities",
      ],
    },
  },
  {
    name: "execute_converse",
    description: "Speak with a present NPC about a specific topic.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        npcId: { type: "string" },
        topic: { type: "string" },
        approvalDelta: { type: "number" },
        discoverInformationIds: { type: "array", items: { type: "string" } },
        memorySummary: { type: "string" },
        narration: { type: "string" },
        suggestedActions: { type: "array", items: { type: "string" } },
        timeMode: { type: "string", enum: ["exploration", "downtime", "combat"] },
        timeElapsed: { type: "number" },
        citedEntities: {
          type: "object",
          additionalProperties: false,
          properties: {
            npcIds: { type: "array", items: { type: "string" } },
            locationIds: { type: "array", items: { type: "string" } },
            factionIds: { type: "array", items: { type: "string" } },
            commodityIds: { type: "array", items: { type: "string" } },
            informationIds: { type: "array", items: { type: "string" } },
          },
          required: ["npcIds", "locationIds", "factionIds", "commodityIds", "informationIds"],
        },
      },
      required: ["npcId", "topic", "narration", "suggestedActions", "timeMode", "timeElapsed", "citedEntities"],
    },
  },
  {
    name: "execute_investigate",
    description: "Investigate a location, NPC, route, or information lead.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        targetType: { type: "string", enum: ["location", "npc", "route", "information"] },
        targetId: { type: "string" },
        method: { type: "string" },
        discoverInformationIds: { type: "array", items: { type: "string" } },
        memorySummary: { type: "string" },
        narration: { type: "string" },
        suggestedActions: { type: "array", items: { type: "string" } },
        timeMode: { type: "string", enum: ["exploration", "downtime", "combat"] },
        timeElapsed: { type: "number" },
        citedEntities: {
          type: "object",
          additionalProperties: false,
          properties: {
            npcIds: { type: "array", items: { type: "string" } },
            locationIds: { type: "array", items: { type: "string" } },
            factionIds: { type: "array", items: { type: "string" } },
            commodityIds: { type: "array", items: { type: "string" } },
            informationIds: { type: "array", items: { type: "string" } },
          },
          required: ["npcIds", "locationIds", "factionIds", "commodityIds", "informationIds"],
        },
      },
      required: [
        "targetType",
        "targetId",
        "method",
        "narration",
        "suggestedActions",
        "timeMode",
        "timeElapsed",
        "citedEntities",
      ],
    },
  },
  {
    name: "execute_observe",
    description: "Observe a place, route, faction presence, or NPC.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        targetType: { type: "string", enum: ["location", "npc", "route", "faction"] },
        targetId: { type: "string" },
        discoverInformationIds: { type: "array", items: { type: "string" } },
        memorySummary: { type: "string" },
        narration: { type: "string" },
        suggestedActions: { type: "array", items: { type: "string" } },
        timeMode: { type: "string", enum: ["exploration", "downtime", "combat"] },
        timeElapsed: { type: "number" },
        citedEntities: {
          type: "object",
          additionalProperties: false,
          properties: {
            npcIds: { type: "array", items: { type: "string" } },
            locationIds: { type: "array", items: { type: "string" } },
            factionIds: { type: "array", items: { type: "string" } },
            commodityIds: { type: "array", items: { type: "string" } },
            informationIds: { type: "array", items: { type: "string" } },
          },
          required: ["npcIds", "locationIds", "factionIds", "commodityIds", "informationIds"],
        },
      },
      required: [
        "targetType",
        "targetId",
        "narration",
        "suggestedActions",
        "timeMode",
        "timeElapsed",
        "citedEntities",
      ],
    },
  },
  {
    name: "execute_wait",
    description: "Wait and let time pass.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        durationMinutes: { type: "number" },
        memorySummary: { type: "string" },
        narration: { type: "string" },
        suggestedActions: { type: "array", items: { type: "string" } },
        timeMode: { type: "string", enum: ["exploration", "downtime"] },
        timeElapsed: { type: "number" },
        citedEntities: {
          type: "object",
          additionalProperties: false,
          properties: {
            npcIds: { type: "array", items: { type: "string" } },
            locationIds: { type: "array", items: { type: "string" } },
            factionIds: { type: "array", items: { type: "string" } },
            commodityIds: { type: "array", items: { type: "string" } },
            informationIds: { type: "array", items: { type: "string" } },
          },
          required: ["npcIds", "locationIds", "factionIds", "commodityIds", "informationIds"],
        },
      },
      required: [
        "durationMinutes",
        "narration",
        "suggestedActions",
        "timeMode",
        "timeElapsed",
        "citedEntities",
      ],
    },
  },
  {
    name: "execute_freeform",
    description: "Handle a creative action outside the standard typed tools.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        actionDescription: { type: "string" },
        statToCheck: {
          type: "string",
          enum: ["strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma"],
        },
        timeMode: { type: "string", enum: ["combat", "exploration", "downtime"] },
        estimatedTimeElapsedMinutes: { type: "number" },
        timeElapsed: { type: "number" },
        intendedMechanicalOutcome: { type: "string" },
        dc: { type: "number" },
        failureConsequence: { type: "string" },
        memorySummary: { type: "string" },
        narration: { type: "string" },
        suggestedActions: { type: "array", items: { type: "string" } },
        citedEntities: {
          type: "object",
          additionalProperties: false,
          properties: {
            npcIds: { type: "array", items: { type: "string" } },
            locationIds: { type: "array", items: { type: "string" } },
            factionIds: { type: "array", items: { type: "string" } },
            commodityIds: { type: "array", items: { type: "string" } },
            informationIds: { type: "array", items: { type: "string" } },
          },
          required: ["npcIds", "locationIds", "factionIds", "commodityIds", "informationIds"],
        },
      },
      required: [
        "actionDescription",
        "statToCheck",
        "timeMode",
        "estimatedTimeElapsedMinutes",
        "timeElapsed",
        "intendedMechanicalOutcome",
        "narration",
        "suggestedActions",
        "citedEntities",
      ],
    },
  },
  {
    name: "request_clarification",
    description: "Ask for clarification when the player's intent cannot be safely mapped.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        question: { type: "string" },
        options: {
          type: "array",
          items: { type: "string" },
        },
      },
      required: ["question", "options"],
    },
  },
];

function extractToolInput(response: OpenAI.Chat.Completions.ChatCompletion) {
  const toolCall = response.choices[0]?.message?.tool_calls?.[0];

  if (toolCall?.type === "function") {
    return {
      name: toolCall.function.name,
      input: safeParseJson(toolCall.function.arguments),
    };
  }

  return {
    name: null,
    input: safeParseJson(response.choices[0]?.message?.content ?? ""),
  };
}

async function runCompletion(options: {
  system: string;
  user: string;
  tools?: Array<{ name: string; description: string; input_schema: Record<string, unknown> }>;
}) {
  const client = createClient();

  if (!client) {
    throw missingAiConfigurationError();
  }

  const response = await client.chat.completions.create({
    model: env.openRouterModel,
    temperature: 0.7,
    messages: [
      { role: "system", content: options.system },
      { role: "user", content: options.user },
    ],
    tools: options.tools?.map(toFunctionTool),
    tool_choice: options.tools?.length ? "auto" : undefined,
  });

  return extractToolInput(response);
}

export function getTurnQualityMeta() {
  return null;
}

class DungeonMasterClient {
  async generateCharacter(prompt: string): Promise<{ character: CharacterTemplateDraft; source: "openrouter" }> {
    try {
      const response = await runCompletion({
        system: [
          "You create grounded but vivid solo fantasy protagonists for an open-world RPG.",
          "Return exactly one playable character template via the provided tool schema.",
          "Make the character specific, competent, and adventure-ready without becoming mythic or overpowered.",
          `starterItems must contain at most ${MAX_STARTER_ITEMS} specific, mundane items.`,
          "Stats are modifiers in the range -2 to +3, maxHealth is usually 8 to 18, and starter gear should feel specific and mundane.",
        ].join("\n"),
        user: prompt,
        tools: [characterTool],
      });

      const parsed = characterTemplateDraftSchema.safeParse(normalizeCharacterToolInput(response?.input));
      if (!parsed.success) {
        throw new Error(`Character generation returned invalid structured data: ${parsed.error.message}`);
      }

      return { character: parsed.data, source: "openrouter" };
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : "Character generation failed.");
    }
  }

  async generateWorldModule(input: {
    prompt: string;
    previousDraft?: GeneratedWorldModule;
  }): Promise<GeneratedWorldModule> {
    try {
      const response = await runCompletion({
        system: [
          "Generate a reusable open-world solo fantasy campaign module.",
          "Return a coherent graph with locations, edges, factions, relations, NPCs, information, commodities, market prices, and entry points via the provided tool schema.",
          "Favor specificity over generic fantasy wallpaper: every location should have pressure, every faction should want something concrete, and every entry point should drop the player into immediate motion.",
          "NPCs should feel socially useful, not ornamental; information nodes should expose actionable leads, not lore blobs.",
          "Avoid vague stakes, placeholder names, and repetitive symmetry unless the prompt clearly demands it.",
          "Do not write any timeline, world events, or simulation tick output.",
        ].join("\n"),
        user: [
          `Prompt: ${input.prompt}`,
          input.previousDraft
            ? `Previous draft to revise. Keep what works, fix what feels flat or repetitive, and materially improve specificity: ${JSON.stringify(summarizeWorld(input.previousDraft))}`
            : "",
        ]
          .filter(Boolean)
          .join("\n\n"),
        tools: [moduleTool],
      });

      const parsed = generatedWorldModuleSchema.safeParse(response?.input);
      if (!parsed.success) {
        throw new Error(`World generation returned invalid structured data: ${parsed.error.message}`);
      }

      const coherence = validateWorldModuleCoherence(parsed.data);
      const playability = validateWorldModulePlayability(parsed.data);

      if (!coherence.ok) {
        throw new Error(`World coherence failed: ${coherence.issues.join("; ")}`);
      }

      if (!playability.ok) {
        throw new Error(`World playability failed: ${playability.issues.join("; ")}`);
      }

      return parsed.data;
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : "World generation failed.");
    }
  }

  async generateCampaignOpening(input: CampaignOpeningInput): Promise<GeneratedCampaignOpening> {
    const location = input.module.locations.find((entry) => entry.id === input.entryPoint.startLocationId);
    const presentNpcs = input.module.npcs.filter((npc) => input.entryPoint.presentNpcIds.includes(npc.id));
    const seededInformation = input.module.information.filter((info) =>
      input.entryPoint.initialInformationIds.includes(info.id),
    );

    try {
      const response = await runCompletion({
        system: [
          "Write the opening scene for a chosen entry point in an open-world solo RPG.",
          "Stay inside the selected entry-point bubble and do not invent off-screen mechanical facts.",
          "Return narration, an active threat, a scene summary, and exact ids for the starting location, present NPCs, and cited information via the provided tool schema.",
          "Start with active pressure, sensory detail, and a socially legible situation the player can immediately act on.",
          "Make the opening feel like a live moment in a wider world, not a trailer voiceover or setting summary.",
        ].join("\n"),
        user: JSON.stringify({
          module: summarizeWorld(input.module),
          entryPoint: input.entryPoint,
          startLocation: location,
          presentNpcs,
          seededInformation: seededInformation.map((entry) => ({
            id: entry.id,
            title: entry.title,
            summary: entry.summary,
          })),
          character: {
            name: input.character.name,
            archetype: input.character.archetype,
            backstory: input.character.backstory,
          },
          prompt: input.prompt ?? null,
          previousDraft: input.previousDraft ?? null,
        }),
        tools: [openingTool],
      });

      const parsed = generatedCampaignOpeningSchema.safeParse(response?.input);
      if (!parsed.success) {
        throw new Error(`Opening generation returned invalid structured data: ${parsed.error.message}`);
      }

      return parsed.data;
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : "Opening generation failed.");
    }
  }

  async runTurn(input: TurnInput): Promise<TurnActionToolCall> {
    try {
      const response = await runCompletion({
        system: [
          "You are the player's senses in a simulated world.",
          "Use exactly one tool.",
          "Do not invent named mechanical entities outside the provided context.",
          "Every executable tool call must include timeMode, timeElapsed, narration, suggestedActions, and citedEntities.",
          "Use request_clarification if the action is too ambiguous to map safely.",
        ].join("\n"),
        user: JSON.stringify({
          action: input.playerAction,
          context: input.promptContext,
          character: {
            name: input.character.name,
            archetype: input.character.archetype,
            stats: input.character.stats,
          },
        }),
        tools: actionTools,
      });

      const toolName = response?.name;
      const inputPayload = response?.input;

      if (toolName && inputPayload && typeof inputPayload === "object") {
        return {
          type: toolName,
          ...(inputPayload as Record<string, unknown>),
        } as TurnActionToolCall;
      }

      throw new Error("Turn generation did not return a valid tool call.");
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : "Turn generation failed.");
    }
  }

  async summarizeSession(lines: string[]) {
    if (!lines.length) {
      return "No memorable events were recorded this session.";
    }

    return lines.slice(-8).join("\n");
  }
}

export const dmClient = new DungeonMasterClient();
