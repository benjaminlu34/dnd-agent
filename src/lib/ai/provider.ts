import { appendFileSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import path from "node:path";
import OpenAI from "openai";
import { z } from "zod";
import { env } from "@/lib/env";
import { characterTemplateDraftSchema } from "@/lib/game/characters";
import { MAX_STARTER_ITEMS, normalizeItemNameList } from "@/lib/game/item-utils";
import {
  generatedCampaignOpeningSchema,
  generatedEconomyMaterialLifeInputSchema,
  generatedEntryContextsInputSchema,
  generatedKnowledgeThreadsInputSchema,
  generatedKnowledgeWebInputSchema,
  generatedRegionalLifeSchema,
  generatedSocialLayerInputSchema,
  generatedWorldBibleSchema,
  generatedWorldSpineSchema,
  worldSpineLocationSchema,
} from "@/lib/game/session-zero";
import type {
  CampaignCharacter,
  CharacterTemplate,
  CharacterTemplateDraft,
  GeneratedCampaignOpening,
  GeneratedWorldModuleDraft,
  GeneratedWorldModule,
  OpenWorldGenerationArtifacts,
  OpenWorldEntryPoint,
  SpatialPromptContext,
  TurnActionToolCall,
  WorldGenerationStageName,
} from "@/lib/game/types";
import {
  validateEntryContexts,
  validateFactionFootprints,
  validateKnowledgeEconomy,
  validateRegionalLife,
  validateSocialLayer,
  validateWorldBible,
  validateWorldModuleCoherence,
  validateWorldModuleImmersion,
  validateWorldModulePlayability,
  validateWorldSpine,
} from "@/lib/game/world-validation";
import {
  getWorldGenerationStageRunningMessage,
  type WorldGenerationProgressUpdate,
} from "@/lib/game/world-generation-progress";

type CampaignOpeningInput = {
  module: GeneratedWorldModule;
  character: CharacterTemplate;
  entryPoint: OpenWorldEntryPoint;
  artifacts?: OpenWorldGenerationArtifacts | null;
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

  const trimmed = value
    .replace(/^<tool_call>\s*/i, "")
    .replace(/\s*<\/tool_call>\s*$/i, "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  const tryParse = (candidate: string) => {
    try {
      return JSON.parse(candidate);
    } catch {
      return null;
    }
  };

  const normalizeLiteralControlChars = (candidate: string) => {
    let normalized = "";
    let inString = false;
    let escaped = false;

    for (const char of candidate) {
      if (escaped) {
        normalized += char;
        escaped = false;
        continue;
      }

      if (char === "\\") {
        normalized += char;
        escaped = true;
        continue;
      }

      if (char === '"') {
        normalized += char;
        inString = !inString;
        continue;
      }

      if (inString) {
        if (char === "\n") {
          normalized += "\\n";
          continue;
        }
        if (char === "\r") {
          normalized += "\\r";
          continue;
        }
        if (char === "\t") {
          normalized += "\\t";
          continue;
        }
      }

      normalized += char;
    }

    return normalized;
  };

  const stripTrailingCommas = (candidate: string) => candidate.replace(/,\s*([}\]])/g, "$1");

  const closeUnclosedJsonStructures = (candidate: string) => {
    const stack: string[] = [];
    let inString = false;
    let escaped = false;

    for (const char of candidate) {
      if (escaped) {
        escaped = false;
        continue;
      }

      if (char === "\\") {
        escaped = true;
        continue;
      }

      if (char === '"') {
        inString = !inString;
        continue;
      }

      if (inString) {
        continue;
      }

      if (char === "{" || char === "[") {
        stack.push(char);
        continue;
      }

      if (char === "}" && stack.at(-1) === "{") {
        stack.pop();
        continue;
      }

      if (char === "]" && stack.at(-1) === "[") {
        stack.pop();
      }
    }

    let repaired = candidate;
    if (escaped) {
      repaired += "\\";
    }
    if (inString) {
      repaired += '"';
    }

    while (stack.length) {
      const opener = stack.pop();
      repaired += opener === "{" ? "}" : "]";
    }

    return repaired === candidate ? null : repaired;
  };

  const extractBalancedJsonCandidates = (candidate: string) => {
    const results: string[] = [];
    const stack: string[] = [];
    let inString = false;
    let escaped = false;
    let start = -1;

    for (let index = 0; index < candidate.length; index += 1) {
      const char = candidate[index];

      if (escaped) {
        escaped = false;
        continue;
      }

      if (char === "\\") {
        escaped = true;
        continue;
      }

      if (char === '"') {
        inString = !inString;
        continue;
      }

      if (inString) {
        continue;
      }

      if (char === "{" || char === "[") {
        if (stack.length === 0) {
          start = index;
        }
        stack.push(char);
        continue;
      }

      if (char === "}" || char === "]") {
        const expected = char === "}" ? "{" : "[";
        if (stack.at(-1) === expected) {
          stack.pop();
          if (stack.length === 0 && start >= 0) {
            results.push(candidate.slice(start, index + 1));
            start = -1;
          }
        }
      }
    }

    return results;
  };

  const candidates = [
    trimmed,
    normalizeLiteralControlChars(trimmed),
    stripTrailingCommas(trimmed),
    stripTrailingCommas(normalizeLiteralControlChars(trimmed)),
    closeUnclosedJsonStructures(trimmed),
    closeUnclosedJsonStructures(normalizeLiteralControlChars(trimmed)),
    closeUnclosedJsonStructures(stripTrailingCommas(trimmed)),
    closeUnclosedJsonStructures(stripTrailingCommas(normalizeLiteralControlChars(trimmed))),
    ...extractBalancedJsonCandidates(trimmed),
    ...extractBalancedJsonCandidates(normalizeLiteralControlChars(trimmed)),
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    const parsed =
      tryParse(candidate) ??
      tryParse(stripTrailingCommas(candidate)) ??
      tryParse(normalizeLiteralControlChars(candidate)) ??
      tryParse(stripTrailingCommas(normalizeLiteralControlChars(candidate)));

    if (parsed != null) {
      return parsed;
    }
  }

  return null;
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

function unwrapStructuredPayload(value: unknown): unknown {
  if (!value) {
    return null;
  }

  if (typeof value === "string") {
    const parsed = safeParseJson(value);
    return parsed == null ? null : unwrapStructuredPayload(parsed);
  }

  if (typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;

  for (const key of ["arguments", "input", "toolInput", "payload", "result"]) {
    if (record[key] != null) {
      const nested = unwrapStructuredPayload(record[key]);
      if (nested != null) {
        return nested;
      }
    }
  }

  return record;
}

function hasUnclosedJsonStructure(value: string) {
  let inString = false;
  let escaped = false;
  const stack: string[] = [];

  for (const char of value) {
    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (char === "{" || char === "[") {
      stack.push(char);
      continue;
    }

    if (char === "}" && stack.at(-1) === "{") {
      stack.pop();
      continue;
    }

    if (char === "]" && stack.at(-1) === "[") {
      stack.pop();
    }
  }

  return inString || stack.length > 0;
}

function isLikelyTruncatedStructuredPayload(value: unknown) {
  if (typeof value !== "string") {
    return false;
  }

  const trimmed = value
    .replace(/^<tool_call>\s*/i, "")
    .replace(/\s*<\/tool_call>\s*$/i, "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  if (!trimmed) {
    return false;
  }

  if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) {
    return false;
  }

  return hasUnclosedJsonStructure(trimmed);
}

function getOpenRouterApiKeys() {
  return [...new Set([env.openRouterApiKey, env.openRouterApiKey2, env.openRouterApiKey3].filter(Boolean))];
}

function createClient(apiKey: string) {
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

const WORLD_GEN_LOG_DIR = path.resolve(process.cwd(), "world_gen_logs");
const WORLD_GEN_LOG_FILE = path.join(WORLD_GEN_LOG_DIR, "latest.log");

let activeWorldGenLogFile: string | null = null;
let preferredOpenRouterKeyIndex = 0;

function appendWorldGenerationLog(message: string) {
  if (!activeWorldGenLogFile) {
    return;
  }

  try {
    appendFileSync(activeWorldGenLogFile, `${message}\n`, "utf8");
  } catch {
    // Ignore log write failures so generation itself can continue.
  }
}

function startWorldGenerationLog() {
  mkdirSync(WORLD_GEN_LOG_DIR, { recursive: true });

  if (existsSync(WORLD_GEN_LOG_FILE)) {
    unlinkSync(WORLD_GEN_LOG_FILE);
  }

  activeWorldGenLogFile = WORLD_GEN_LOG_FILE;
}

function stopWorldGenerationLog() {
  activeWorldGenLogFile = null;
}

function logWorldGenerationProgress(update: WorldGenerationProgressUpdate) {
  const timestamp = new Date().toISOString();
  const message = [
    `[world.progress] ${timestamp}`,
    JSON.stringify(update, null, 2),
    "--- end ---",
  ].join("\n");

  console.info(message);
  appendWorldGenerationLog(message);
}

function logOpenRouterRequest(options: {
  model: string;
  system: string;
  user: string;
  tools?: Array<{ name: string; description: string; input_schema: Record<string, unknown> }>;
}) {
  const timestamp = new Date().toISOString();
  const toolNames = (options.tools ?? []).map((tool) => tool.name);
  const message = [
    `[openrouter.request] ${timestamp}`,
    `model=${options.model}`,
    `tools=${toolNames.length ? toolNames.join(", ") : "none"}`,
    "--- system ---",
    options.system,
    "--- user ---",
    options.user,
    "--- end ---",
  ].join("\n");

  console.info(message);
  appendWorldGenerationLog(message);
}

function logOpenRouterResponse(stage: string, details: Record<string, unknown>) {
  const timestamp = new Date().toISOString();
  const message = [
    `[openrouter.response] ${timestamp}`,
    `stage=${stage}`,
    JSON.stringify(details, null, 2),
    "--- end ---",
  ].join("\n");

  console.info(message);
  appendWorldGenerationLog(message);
}

function toPreview(value: unknown, maxLength = 1200) {
  if (value == null) {
    return null;
  }

  const text =
    typeof value === "string"
      ? value
      : (() => {
          try {
            return JSON.stringify(value, null, 2);
          } catch {
            return String(value);
          }
        })();

  return text.length > maxLength ? `${text.slice(0, maxLength)}\n...[truncated]` : text;
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

function describeZodIssues(issues: Array<{ path: PropertyKey[]; message: string }>) {
  return issues
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("\n");
}

type RegionalLifeDraft = z.infer<typeof generatedRegionalLifeSchema>;

type StructuredTool = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
};

type StageValidation = {
  category: "schema" | "coherence" | "playability" | "immersion";
  issues: string[];
};

const MAX_WORLD_STAGE_ATTEMPTS = 3;
const MAX_TURN_ATTEMPTS = 3;
const WORLD_SPINE_LOCATION_BATCH_SIZE = 3;
const REGIONAL_LIFE_BATCH_SIZE = 3;
const SOCIAL_CAST_BATCH_SIZE = 3;

function createStructuredTool(
  name: string,
  description: string,
  schema: z.ZodTypeAny,
): StructuredTool {
  return {
    name,
    description,
    input_schema: z.toJSONSchema(schema),
  };
}

function slugify(value: string, maxLength = 40) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_{2,}/g, "_")
    .slice(0, maxLength);
}

function assignCanonicalIds(keys: string[], prefix: string, maxSlugLength = 40) {
  const used = new Set<string>();
  const idMap: Record<string, string> = {};

  for (const key of keys) {
    const base = `${prefix}_${slugify(key, maxSlugLength) || "entry"}`;
    let candidate = base;
    let suffix = 2;
    while (used.has(candidate)) {
      candidate = `${base}_${suffix}`;
      suffix += 1;
    }
    used.add(candidate);
    idMap[key] = candidate;
  }

  return idMap;
}

function assignIndexedIds<T>(
  items: T[],
  prefix: string,
  getLabel: (item: T, index: number) => string,
  maxSlugLength = 24,
) {
  const used = new Set<string>();

  return items.map((item, index) => {
    const base = `${prefix}_${slugify(getLabel(item, index), maxSlugLength) || `${prefix}_${index + 1}`}`;
    let candidate = base;
    let suffix = 2;
    while (used.has(candidate)) {
      candidate = `${base}_${suffix}`;
      suffix += 1;
    }
    used.add(candidate);
    return candidate;
  });
}

function uniqueNames(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function firstNameOf(name: string) {
  return name.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
}

type WorldPromptProfile = {
  explanationStyle: "folkloric" | "speculative" | "grounded";
  minimumExplanationThreads: number;
};

function inferWorldPromptProfile(prompt: string): WorldPromptProfile {
  const normalized = prompt.toLowerCase();
  const folkloricSignals = [
    "myth",
    "legend",
    "folklore",
    "god",
    "gods",
    "divine",
    "curse",
    "sacred",
    "spirit",
    "spirits",
    "ritual",
    "cult",
    "oracle",
    "prophecy",
  ];
  const speculativeSignals = [
    "machine",
    "engine",
    "artifact",
    "experiment",
    "theory",
    "scientific",
    "science",
    "technology",
    "device",
    "system",
    "simulation",
    "containment",
    "laboratory",
  ];
  const folkloreScore = folkloricSignals.filter((signal) => normalized.includes(signal)).length;
  const speculativeScore = speculativeSignals.filter((signal) => normalized.includes(signal)).length;
  const wantsDenseCompetingExplanations =
    /\bevery culture\b/.test(normalized) ||
    /\bdifferent myths?\b/.test(normalized) ||
    /\bcompeting beliefs?\b/.test(normalized) ||
    /\bcontradictory\b/.test(normalized) ||
    /\bpartially true\b/.test(normalized);

  let explanationStyle: WorldPromptProfile["explanationStyle"] = "grounded";

  if (folkloreScore >= speculativeScore + 1) {
    explanationStyle = "folkloric";
  } else if (speculativeScore >= folkloreScore + 1) {
    explanationStyle = "speculative";
  }

  return {
    explanationStyle,
    minimumExplanationThreads: wantsDenseCompetingExplanations ? 4 : 2,
  };
}

function findDuplicateStrings(values: string[]) {
  const counts = new Map<string, number>();

  for (const value of values.filter(Boolean)) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([value]) => value);
}

function chunkArray<T>(items: T[], size: number) {
  if (size <= 0) {
    return [items];
  }

  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function summarizeWorldBibleForPrompt(
  worldBible: z.infer<typeof generatedWorldBibleSchema>,
  profile: WorldPromptProfile,
) {
  return {
    title: worldBible.title,
    premise: worldBible.premise,
    tone: worldBible.tone,
    setting: worldBible.setting,
    worldOverview: worldBible.worldOverview,
    explanationStyle: profile.explanationStyle,
    systemicPressures: worldBible.systemicPressures.slice(0, 6),
    historicalFractures: worldBible.historicalFractures.slice(0, 6),
    competingExplanations: worldBible.explanationThreads.map((thread) => ({
      key: thread.key,
      phenomenon: thread.phenomenon,
      prevailingTheories: thread.prevailingTheories,
      actionableSecret: thread.actionableSecret,
    })),
    everydayLife: {
      survival: worldBible.everydayLife.survival,
      institutions: worldBible.everydayLife.institutions.slice(0, 5),
      fears: worldBible.everydayLife.fears.slice(0, 4),
      wants: worldBible.everydayLife.wants.slice(0, 4),
      trade: worldBible.everydayLife.trade.slice(0, 5),
      gossip: worldBible.everydayLife.gossip.slice(0, 4),
    },
  };
}

function summarizeRegionalLifeForPrompt(
  regionalLife: RegionalLifeDraft,
  locationIds?: string[],
) {
  const filterIds = locationIds ? new Set(locationIds) : null;

  return regionalLife.locations
    .filter((location) => (filterIds ? filterIds.has(location.locationId) : true))
    .map((location) => ({
      locationId: location.locationId,
      publicActivity: location.publicActivity,
      dominantActivities: location.dominantActivities.slice(0, 3),
      localPressure: location.localPressure,
      classTexture: location.classTexture,
      everydayTexture: location.everydayTexture,
      publicHazards: location.publicHazards.slice(0, 2),
      ordinaryKnowledge: location.ordinaryKnowledge.slice(0, 2),
      institutions: location.institutions.slice(0, 2),
      gossip: location.gossip.slice(0, 2),
      reasonsToLinger: location.reasonsToLinger.slice(0, 2),
      routineSeeds: location.routineSeeds.slice(0, 1),
      eventSeeds: location.eventSeeds.slice(0, 1),
    }));
}

function isEverydayUseWorldSpineLocation(location: {
  name: string;
  type: string;
  summary?: string;
  description?: string;
  tags?: string[];
}) {
  const haystack = [
    location.name,
    location.type,
    location.summary ?? "",
    location.description ?? "",
    ...(location.tags ?? []),
  ]
    .join(" ")
    .toLowerCase();

  const everydaySignals = [
    "market",
    "farm",
    "coop",
    "dock",
    "port",
    "harbor",
    "outpost",
    "checkpoint",
    "customs",
    "yard",
    "workshop",
    "forge",
    "guild",
    "camp",
    "settlement",
    "village",
    "town",
    "city",
    "platform",
    "station",
    "tower",
    "trade",
    "civic",
    "naval",
    "salvage",
    "anchor",
    "lamp",
    "tax",
    "route",
    "chokepoint",
  ];

  return everydaySignals.some((signal) => haystack.includes(signal));
}

function renderPromptValue(value: unknown, indent = 0): string {
  const pad = " ".repeat(indent);
  const childPad = " ".repeat(indent + 2);

  if (value == null) {
    return `${pad}null`;
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return `${pad}${String(value)}`;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return `${pad}- none`;
    }

    return value
      .map((item) => {
        if (
          item == null ||
          typeof item === "string" ||
          typeof item === "number" ||
          typeof item === "boolean"
        ) {
          return `${pad}- ${String(item)}`;
        }

        const rendered = renderPromptValue(item, indent + 2);
        return `${pad}-\n${rendered}`;
      })
      .join("\n");
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, entry]) => entry !== undefined);

    if (entries.length === 0) {
      return `${pad}(empty)`;
    }

    return entries
      .map(([key, entry]) => {
        if (
          entry == null ||
          typeof entry === "string" ||
          typeof entry === "number" ||
          typeof entry === "boolean"
        ) {
          return `${pad}${key}: ${String(entry)}`;
        }

        return `${pad}${key}:\n${renderPromptValue(entry, indent + 2)}`;
      })
      .join("\n");
  }

  return `${pad}${String(value)}`;
}

function formatPromptBlock(tag: string, value: unknown) {
  return [`<${tag}>`, renderPromptValue(value), `</${tag}>`].join("\n");
}

function formatFinalInstruction(lines: string | string[]) {
  const instructionLines = Array.isArray(lines) ? lines : [lines];
  return ["---", ...instructionLines].join("\n");
}

function formatCorrectionNotes(stage: WorldGenerationStageName, category: StageValidation["category"], issues: string[]) {
  return [
    `<correction stage="${stage}" category="${category}">`,
    "Return a complete replacement payload.",
    "Preserve strong world-specific material when possible.",
    "Fix these violations exactly:",
    ...issues.map((issue, index) => `${index + 1}. ${issue}`),
    "Do not introduce new ids, keys, or references unless the instructions explicitly require them.",
    "</correction>",
  ].join("\n");
}

function summarizeLocationRefs(
  locations: Array<{
    id?: string;
    key?: string;
    name: string;
    type: string;
    summary?: string;
    controlStatus?: string;
    controllingFactionKey?: string | null;
  }>,
  options?: {
    includeKey?: boolean;
  },
) {
  return locations.map((location) =>
    [
      location.id ?? location.key ?? location.name,
      options?.includeKey !== false && location.id && location.key ? `key=${location.key}` : "",
      location.name,
      location.type,
      location.controlStatus ? `control=${location.controlStatus}` : "",
      location.controllingFactionKey ? `controller=${location.controllingFactionKey}` : "",
      location.summary ? `summary=${location.summary}` : "",
    ]
      .filter(Boolean)
      .join(" | "),
  );
}

function summarizeFactionRefs(
  factions: Array<{
    id?: string;
    key?: string;
    name: string;
    type: string;
    agenda?: string;
    publicFootprint?: string;
  }>,
  options?: {
    includeKey?: boolean;
  },
) {
  return factions.map((faction) =>
    [
      faction.id ?? faction.key ?? faction.name,
      options?.includeKey !== false && faction.id && faction.key ? `key=${faction.key}` : "",
      faction.name,
      faction.type,
      faction.agenda ? `agenda=${faction.agenda}` : "",
      faction.publicFootprint ? `footprint=${faction.publicFootprint}` : "",
    ]
      .filter(Boolean)
      .join(" | "),
  );
}

function summarizeNpcRefs(
  npcs: Array<{
    id: string;
    name: string;
    role: string;
    currentLocationId: string;
    factionId: string | null;
  }>,
) {
  return npcs.map((npc) =>
    [
      npc.id,
      `${npc.name} (${npc.role})`,
      `at=${npc.currentLocationId}`,
      npc.factionId ? `faction=${npc.factionId}` : "",
    ]
      .filter(Boolean)
      .join(" | "),
  );
}

function summarizeInformationRefs(
  information: Array<{
    id: string;
    title: string;
    accessibility: string;
    locationId: string | null;
    sourceNpcId: string | null;
  }>,
) {
  return information.map((entry) =>
    [
      entry.id,
      entry.title,
      `access=${entry.accessibility}`,
      `loc=${entry.locationId ?? "none"}`,
      `source=${entry.sourceNpcId ?? "none"}`,
    ].join(" | "),
  );
}

function summarizeKnowledgeThreadInformationRefs(
  information: Array<{
    key: string;
    accessibility: string;
    locationId: string | null;
    factionId: string | null;
    knowledgeThread: string | null;
  }>,
) {
  return information.map((entry) =>
    [
      `key=${entry.key}`,
      `access=${entry.accessibility}`,
      entry.locationId ? `loc=${entry.locationId}` : "",
      entry.factionId ? `faction=${entry.factionId}` : "",
      entry.knowledgeThread ? `thread=${entry.knowledgeThread}` : "",
    ]
      .filter(Boolean)
      .join(" | "),
  );
}

function summarizeRegionalLifeRefs(regionalLife: RegionalLifeDraft) {
  return regionalLife.locations.map((location) =>
    [
      location.locationId,
      `activity=${location.publicActivity}`,
      `pressure=${location.localPressure}`,
      location.publicHazards[0] ? `hazard=${location.publicHazards[0]}` : "",
      location.ordinaryKnowledge[0] ? `known=${location.ordinaryKnowledge[0]}` : "",
    ]
      .filter(Boolean)
      .join(" | "),
  );
}

function summarizeSocialGravityRefs(
  socialGravity: Array<{
    npcId: string;
    importance: string;
    bridgeLocationIds: string[];
    bridgeFactionIds: string[];
  }>,
) {
  return socialGravity.map((entry) =>
    [
      entry.npcId,
      `importance=${entry.importance}`,
      entry.bridgeLocationIds.length ? `loc_bridges=${entry.bridgeLocationIds.join(",")}` : "",
      entry.bridgeFactionIds.length ? `faction_bridges=${entry.bridgeFactionIds.join(",")}` : "",
    ]
      .filter(Boolean)
      .join(" | "),
  );
}

const WORLD_GEN_PRINCIPLES = [
  "You are a simulation-first worldbuilder designing a reusable solo RPG setting.",
  "Prioritize concrete survival, work, trade, territory, debt, weather, and social obligations over abstract lore.",
  "Prefer political, economic, environmental, and territorial pressure over cosmic destiny.",
  "When the setting includes unusual infrastructure, ecology, or magic, define the upkeep, intake, repair burden, and failure modes only insofar as they shape daily life.",
  "Make every major detail usable at the table by tying it to a place, institution, job, route, resource, or conflict.",
  "Tie grand history, myth, and doctrine to present-day tolls, shortages, debts, hazards, monopolies, or chokepoints the player can actually touch.",
  "Give factions dependencies, internal strain, and vulnerabilities so no group feels perfectly unified or theatrically pure.",
  "Leave procedural gaps for play: mysteries should reveal the next clue, leverage point, or practical advantage, not a total authorial answer.",
  "Be concise. Every sentence should imply at least one playable cost, risk, opportunity, contact, or obstacle.",
  "Preserve the prompt's distinctive nouns, imagery, and social texture instead of replacing them with generic genre substitutes.",
  "Reuse exact nouns or noun phrases from the prompt whenever possible instead of renaming the setting into a new generic brand.",
];

const WORLD_GEN_ANTI_PATTERNS = [
  "Do not default to chosen ones, ancient evils, prophecy, dark lords, or vague magical corruption.",
  "Do not create ornamental NPCs, empty postcard locations, or generic stock-setting filler.",
  "Do not solve missing structure by inventing extra ids, keys, factions, or locations outside the provided context.",
  "Do not use vague phrases when a concrete profession, shortage, hazard, patrol, debt, toll, or route problem would be clearer.",
  "Do not spend precious detail budget on orbital mechanics, tectonics, cosmology, or other deep realism unless it visibly changes work, travel, supply, safety, or politics.",
  "Do not present factions as morally monolithic or internally unanimous.",
  "Do not over-explain mysteries into dead canon when uncertainty would create stronger actionable leads.",
  "Translate the prompt into concrete systemic pressures; if it implies magic, myth, technology, or politics, express those through lived constraints, hazards, institutions, shortages, and conflicts rather than forcing a genre-mismatched trope layer.",
];

function buildWorldGenSystemPrompt(lines: string[]) {
  return [
    ...WORLD_GEN_PRINCIPLES,
    "Forbidden patterns:",
    ...WORLD_GEN_ANTI_PATTERNS.map((line) => `- ${line}`),
    "Success criteria:",
    ...lines.map((line) => `- ${line}`),
  ].join("\n");
}

function buildWorldGenerationBasePrompt(input: {
  prompt: string;
  previousDraft?: GeneratedWorldModule;
  correctionNotes?: string | null;
}) {
  return [
    formatPromptBlock("prompt", input.prompt),
    input.previousDraft
      ? formatPromptBlock("previous_draft_summary", summarizeWorld(input.previousDraft))
      : "",
    input.correctionNotes ? input.correctionNotes : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function buildWorldBibleOutputBudget(minimumExplanationThreads: number) {
  return {
    title: "2 to 5 words",
    premise: "1 to 2 short sentences",
    tone: "2 to 5 words",
    setting: "3 to 8 words",
    worldOverview: "3 to 4 short sentences max",
    systemicPressures: "at least 5 short phrases; add more only if each adds a distinct pressure",
    historicalFractures: "at least 5 short phrases; add more only if each adds a distinct fracture",
    immersionAnchors: "at least 6 short sensory anchors; avoid filler",
    explanationThreads: {
      count: `at least ${minimumExplanationThreads}; add more only if the setting genuinely needs them`,
      phenomenon: "2 to 6 words",
      prevailingTheories: "2 short sentences or clauses per thread",
      actionableSecret: "1 to 2 short sentences",
    },
    everydayLife: {
      survival: "1 to 2 short sentences",
      institutions: "at least 4 items, each 2 to 5 words",
      fears: "at least 3 items, each 2 to 5 words",
      wants: "at least 3 items, each 2 to 5 words",
      trade: "at least 3 items, each 2 to 5 words",
      gossip: "at least 3 items, each 4 to 10 words",
    },
  };
}

function normalizeEntryContextsInput(input: unknown) {
  if (!input || typeof input !== "object") {
    return input;
  }

  const draft = input as Record<string, unknown>;
  if (!Array.isArray(draft.entryPoints)) {
    return input;
  }

  return {
    ...draft,
    entryPoints: draft.entryPoints.slice(0, 3).map((entry) => {
      if (!entry || typeof entry !== "object") {
        return entry;
      }

      const normalizedEntry = { ...(entry as Record<string, unknown>) };
      const evidence =
        typeof normalizedEntry.evidenceWorldAlreadyMoving === "string"
          ? normalizedEntry.evidenceWorldAlreadyMoving.trim()
          : "";

      if (!evidence) {
        const immediatePressure =
          typeof normalizedEntry.immediatePressure === "string"
            ? normalizedEntry.immediatePressure.trim()
            : "";
        const summary =
          typeof normalizedEntry.summary === "string" ? normalizedEntry.summary.trim() : "";
        const fallbackSource = immediatePressure || summary || "local pressures are already shifting";
        const fallback =
          fallbackSource.charAt(0).toLowerCase() + fallbackSource.slice(1).replace(/\.$/, "");

        normalizedEntry.evidenceWorldAlreadyMoving =
          `People nearby are already reacting because ${fallback}.`;
      }

      return normalizedEntry;
    }),
  };
}

function normalizeWorldSpineRelationsInput(input: unknown, maxRelations: number) {
  if (!input || typeof input !== "object") {
    return input;
  }

  const draft = input as Record<string, unknown>;
  if (!Array.isArray(draft.factionRelations)) {
    return input;
  }

  return {
    ...draft,
    factionRelations: draft.factionRelations.slice(0, maxRelations),
  };
}

function normalizeEconomyMaterialLifeInput(
  input: unknown,
  maxCommodities: number,
  maxMarketPrices: number,
) {
  if (!input || typeof input !== "object") {
    return input;
  }

  const draft = input as Record<string, unknown>;
  const normalized: Record<string, unknown> = { ...draft };

  if (Array.isArray(draft.commodities)) {
    normalized.commodities = draft.commodities.slice(0, maxCommodities).map((commodity) => {
      if (!commodity || typeof commodity !== "object") {
        return commodity;
      }

      const normalizedCommodity = { ...(commodity as Record<string, unknown>) };
      if (typeof normalizedCommodity.baseValue === "number" && Number.isFinite(normalizedCommodity.baseValue)) {
        normalizedCommodity.baseValue = Math.round(normalizedCommodity.baseValue);
      }

      return normalizedCommodity;
    });
  }

  if (Array.isArray(draft.marketPrices)) {
    normalized.marketPrices = draft.marketPrices.slice(0, maxMarketPrices).map((price) => {
      if (!price || typeof price !== "object") {
        return price;
      }

      const normalizedPrice = { ...(price as Record<string, unknown>) };
      if (typeof normalizedPrice.stock === "number" && Number.isFinite(normalizedPrice.stock)) {
        normalizedPrice.stock = Math.round(normalizedPrice.stock);
      }

      return normalizedPrice;
    });
  }

  return normalized;
}

function normalizeStringList(value: unknown) {
  if (Array.isArray(value)) {
    return value
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  if (typeof value !== "string") {
    return value;
  }

  return value
    .split(/(?:\s*[;,]\s*|\n+|\s+\|\s+)/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeRegionalLifeInput(input: unknown, expectedLocations: number) {
  if (!input || typeof input !== "object") {
    return input;
  }

  const draft = input as Record<string, unknown>;
  if (!Array.isArray(draft.locations)) {
    return input;
  }

  return {
    ...draft,
    locations: draft.locations.slice(0, expectedLocations).map((location) => {
      if (!location || typeof location !== "object") {
        return location;
      }

      const normalizedLocation = { ...(location as Record<string, unknown>) };
      for (const key of [
        "dominantActivities",
        "publicHazards",
        "ordinaryKnowledge",
        "institutions",
        "gossip",
        "reasonsToLinger",
        "routineSeeds",
        "eventSeeds",
      ]) {
        normalizedLocation[key] = normalizeStringList(normalizedLocation[key]);
      }

      return normalizedLocation;
    }),
  };
}

async function runStructuredStage<T>({
  stage,
  system,
  buildUser,
  schema,
  tool,
  attempts,
  validationReports,
  stageSummaries,
  validate,
  summarize,
  normalizeInput,
}: {
  stage: WorldGenerationStageName;
  system: string;
  buildUser: (correctionNotes: string | null) => string;
  schema: z.ZodType<T>;
  tool: StructuredTool;
  attempts: OpenWorldGenerationArtifacts["attempts"];
  validationReports: OpenWorldGenerationArtifacts["validationReports"];
  stageSummaries: OpenWorldGenerationArtifacts["stageSummaries"];
  validate?: (parsed: T) => StageValidation[];
  summarize?: (parsed: T) => string;
  normalizeInput?: (input: unknown) => unknown;
}): Promise<T> {
  let correctionNotes: string | null = null;

  for (let attempt = 1; attempt <= MAX_WORLD_STAGE_ATTEMPTS; attempt += 1) {
    logOpenRouterResponse(`${stage}.attempt`, {
      stage,
      attempt,
      maxAttempts: MAX_WORLD_STAGE_ATTEMPTS,
      correctionNotes,
    });

    const user = buildUser(correctionNotes);
    const response = await runCompletion({
      system,
      user,
      tools: [tool],
    });

    attempts.push({
      stage,
      attempt,
      correctionNotes,
      completedAt: new Date().toISOString(),
    });

    logOpenRouterResponse(`${stage}.raw_input`, {
      attempt,
      finishReason: response?.finishReason ?? null,
      likelyTruncated: response?.likelyTruncated ?? false,
      preview: toPreview(response?.input),
    });

    const normalizedInput = normalizeInput ? normalizeInput(response?.input) : response?.input;
    const parsed = schema.safeParse(normalizedInput);

    if (response?.likelyTruncated && !parsed.success) {
      const issues = [
        "Your previous response was cut off before the structured payload finished.",
        "Return a complete replacement payload.",
        "Use shorter descriptions so the full JSON fits in one response.",
        "If the stage uses keys, keep every key under 40 characters.",
        ...(stage === "world_bible"
          ? [
              "For world_bible, meet the schema minimums, keep list items short, and keep prose fields within the stated output budget.",
            ]
          : []),
        ...(stage === "knowledge_web"
          ? [
              "For knowledge_web, return the minimum viable payload: one information node per location, no extras unless required to fix a cited issue.",
              "Keep title, summary, content, actionLead, and discoverHow to very short phrases.",
              "Keep information links sparse.",
            ]
          : []),
      ];

      validationReports.push({
        stage,
        attempt,
        ok: false,
        category: "schema",
        issues,
      });

      logOpenRouterResponse(`${stage}.truncation`, {
        attempt,
        finishReason: response.finishReason ?? null,
        issues,
      });

      if (attempt === MAX_WORLD_STAGE_ATTEMPTS) {
        throw new Error(`${stage} response was truncated before the structured payload completed.`);
      }

      correctionNotes = formatCorrectionNotes(stage, "schema", issues);
      continue;
    }

    if (response?.likelyTruncated && parsed.success) {
      logOpenRouterResponse(`${stage}.truncation_recovered`, {
        attempt,
        finishReason: response.finishReason ?? null,
        preview: toPreview(normalizedInput),
      });
    }

    if (!parsed.success) {
      const issues = describeZodIssues(parsed.error.issues).split("\n");
      validationReports.push({
        stage,
        attempt,
        ok: false,
        category: "schema",
        issues,
      });

      logOpenRouterResponse(`${stage}.schema_failure`, {
        attempt,
        issues: parsed.error.issues,
        inputPreview: toPreview(normalizedInput),
      });

      if (attempt === MAX_WORLD_STAGE_ATTEMPTS) {
        throw new Error(`${stage} returned invalid structured data: ${parsed.error.message}`);
      }

      correctionNotes = formatCorrectionNotes(
        stage,
        "schema",
        describeZodIssues(parsed.error.issues).split("\n"),
      );
      continue;
    }

    const validations = validate ? validate(parsed.data) : [];
    let failedValidation: StageValidation | null = null;

    for (const validation of validations) {
      const ok = validation.issues.length === 0;
      validationReports.push({
        stage,
        attempt,
        ok,
        category: validation.category,
        issues: validation.issues,
      });

      logOpenRouterResponse(`${stage}.${validation.category}`, {
        attempt,
        ok,
        issues: validation.issues,
        preview: toPreview(parsed.data),
      });

      if (!ok && !failedValidation) {
        failedValidation = validation;
      }
    }

    if (failedValidation) {
      if (attempt === MAX_WORLD_STAGE_ATTEMPTS) {
        throw new Error(
          `${stage} ${failedValidation.category} failed: ${failedValidation.issues.join("; ")}`,
        );
      }

      correctionNotes = [
        formatCorrectionNotes(stage, failedValidation.category, failedValidation.issues),
      ].join("\n");
      continue;
    }

    stageSummaries[stage] = summarize ? summarize(parsed.data) : `Completed ${stage}.`;

    logOpenRouterResponse(`${stage}.success`, {
      attempt,
      summary: stageSummaries[stage],
      preview: toPreview(parsed.data),
    });

    return parsed.data;
  }

  throw new Error(`${stage} exhausted retry attempts.`);
}

function enrichLocationDescription(
  description: string,
  regionalLife: RegionalLifeDraft["locations"][number] | undefined,
) {
  if (!regionalLife) {
    return description;
  }

  return [
    description,
    `Everyday life here turns around ${regionalLife.publicActivity.toLowerCase()}.`,
    `The local pressure is ${regionalLife.localPressure.toLowerCase()}.`,
    `Ordinary residents know ${regionalLife.ordinaryKnowledge[0]?.toLowerCase() ?? "more than they admit"}.`,
  ].join(" ");
}

function appendLocationTradeIdentity(
  description: string,
  tradeIdentity:
    | OpenWorldGenerationArtifacts["knowledgeEconomy"]["locationTradeIdentity"][number]
    | undefined,
) {
  if (!tradeIdentity) {
    return description;
  }

  const signatureGoods =
    tradeIdentity.signatureGoods.length > 0
      ? tradeIdentity.signatureGoods.join(", ").toLowerCase()
      : "no settled signature goods";

  return [
    description,
    `Trade identity: ${signatureGoods}.`,
    `Scarcity: ${tradeIdentity.scarcityNotes.toLowerCase()}.`,
    `Street economy: ${tradeIdentity.streetLevelEconomy.toLowerCase()}.`,
  ].join(" ");
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

const worldBibleTool = createStructuredTool(
  "generate_world_bible",
  "Generate the world bible for a living, open-world solo campaign module.",
  generatedWorldBibleSchema,
);

const worldSpineFactionsSchema = z.object({
  factions: generatedWorldSpineSchema.shape.factions,
});

const worldSpineLocationPlanSchema = z.object({
  locationCount: z.union([z.literal(9), z.literal(12), z.literal(15)]),
});

const worldSpineLocationsSchema = z.object({
  locations: generatedWorldSpineSchema.shape.locations,
});

const worldSpineConnectionsSchema = z.object({
  edges: generatedWorldSpineSchema.shape.edges,
  factionRelations: generatedWorldSpineSchema.shape.factionRelations,
});

const worldSpineEdgesSchema = z.object({
  edges: generatedWorldSpineSchema.shape.edges,
});

const worldSpineRelationsOnlySchema = z.object({
  factionRelations: generatedWorldSpineSchema.shape.factionRelations,
});

const worldSpineFactionsTool = createStructuredTool(
  "generate_world_spine_factions",
  "Generate the factions for the world spine.",
  worldSpineFactionsSchema,
);

const worldSpineLocationPlanTool = createStructuredTool(
  "generate_world_spine_location_plan",
  "Choose how many world spine locations to generate. Must be 9, 12, or 15.",
  worldSpineLocationPlanSchema,
);

const worldSpineLocationsTool = createStructuredTool(
  "generate_world_spine_locations",
  "Generate the locations for the world spine using known faction keys for control.",
  worldSpineLocationsSchema,
);

const worldSpineConnectionsTool = createStructuredTool(
  "generate_world_spine_connections",
  "Generate travel edges and faction relations for the world spine using known keys.",
  worldSpineConnectionsSchema,
);

const worldSpineEdgesTool = createStructuredTool(
  "generate_world_spine_edges",
  "Generate travel edges for the world spine using known location keys.",
  worldSpineEdgesSchema,
);

const worldSpineRelationsTool = createStructuredTool(
  "generate_world_spine_relations",
  "Generate faction relations for the world spine using known faction keys.",
  worldSpineRelationsOnlySchema,
);

const regionalLifeTool = createStructuredTool(
  "generate_regional_life",
  "Generate regional daily life, pressures, hazards, and ordinary knowledge for each location.",
  generatedRegionalLifeSchema,
);

const socialCastTool = createStructuredTool(
  "generate_social_cast",
  "Generate socially grounded NPCs who belong to the world and can cross paths with the player naturally.",
  generatedSocialLayerInputSchema,
);

const knowledgeWebTool = createStructuredTool(
  "generate_knowledge_web",
  "Generate layered information links and actionable leads for the world.",
  generatedKnowledgeWebInputSchema,
);

const knowledgeThreadsTool = createStructuredTool(
  "generate_knowledge_threads",
  "Generate knowledge networks and pressure seeds using known information keys and locked ids.",
  generatedKnowledgeThreadsInputSchema,
);

const economyMaterialLifeTool = createStructuredTool(
  "generate_economy_material_life",
  "Generate commodities, market prices, and local material life for each major location.",
  generatedEconomyMaterialLifeInputSchema,
);

const entryContextsTool = createStructuredTool(
  "generate_entry_contexts",
  "Generate grounded entry contexts that make the player feel like an arriving participant in a living world.",
  generatedEntryContextsInputSchema,
);

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
    description: "Speak with a named present NPC or an unnamed local person in the current scene about a specific topic.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        interlocutor: {
          type: "string",
          description: "Short label for who answers, such as a present NPC name or an unnamed local like 'nearest harvester'.",
        },
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
      required: ["interlocutor", "topic", "narration", "suggestedActions", "timeMode", "timeElapsed", "citedEntities"],
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
  const content = extractMessageText(response.choices[0]?.message?.content ?? "");
  const finishReason = response.choices[0]?.finish_reason ?? null;
  const rawToolArguments = toolCall?.type === "function" ? toolCall.function.arguments : null;
  const likelyTruncated = finishReason === "length"
    || isLikelyTruncatedStructuredPayload(rawToolArguments)
    || (!toolCall && isLikelyTruncatedStructuredPayload(content));

  logOpenRouterResponse("raw_completion", {
    hasToolCall: Boolean(toolCall),
    finishReason,
    likelyTruncated,
    toolName: toolCall?.type === "function" ? toolCall.function.name : null,
    rawToolArgumentsPreview:
      toolCall?.type === "function" ? toPreview(toolCall.function.arguments) : null,
    messageContentPreview: toPreview(content),
  });

  if (toolCall?.type === "function") {
    const input = unwrapStructuredPayload(toolCall.function.arguments);

    logOpenRouterResponse("parsed_tool_input", {
      toolName: toolCall.function.name,
      parsedInputPreview: toPreview(input),
    });

    return {
      name: toolCall.function.name,
      input,
      finishReason,
      likelyTruncated,
    };
  }

  const input = unwrapStructuredPayload(content);

  logOpenRouterResponse("parsed_message_input", {
    parsedInputPreview: toPreview(input),
  });

  return {
    name: null,
    input,
    finishReason,
    likelyTruncated,
  };
}

function normalizeTurnToolCall(input: {
  toolName: string | null;
  payload: unknown;
  promptContext: SpatialPromptContext;
}): TurnActionToolCall | null {
  const { toolName, payload, promptContext } = input;

  if (!toolName || !payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const record = payload as Record<string, unknown>;

  if (toolName === "execute_converse") {
    const npcId =
      typeof record.npcId === "string" && record.npcId.trim() ? record.npcId.trim() : undefined;
    const namedNpc = npcId
      ? promptContext.presentNpcs.find((npc) => npc.id === npcId) ?? null
      : null;
    const interlocutor =
      typeof record.interlocutor === "string" && record.interlocutor.trim()
        ? record.interlocutor.trim()
        : namedNpc?.name ?? "unnamed local";

    return {
      type: toolName,
      ...record,
      interlocutor,
      npcId,
      approvalDelta:
        npcId && typeof record.approvalDelta === "number" ? record.approvalDelta : undefined,
    } as TurnActionToolCall;
  }

  return {
    type: toolName,
    ...record,
  } as TurnActionToolCall;
}

async function runCompletion(options: {
  system: string;
  user: string;
  tools?: Array<{ name: string; description: string; input_schema: Record<string, unknown> }>;
  maxTokens?: number;
}) {
  const apiKeys = getOpenRouterApiKeys();

  if (!apiKeys.length) {
    throw missingAiConfigurationError();
  }

  let lastError: unknown = null;
  const normalizedPreferredIndex = preferredOpenRouterKeyIndex % apiKeys.length;
  const orderedApiKeys = apiKeys.map((_, offset) => {
    const index = (normalizedPreferredIndex + offset) % apiKeys.length;
    return {
      apiKey: apiKeys[index],
      keyIndex: index,
    };
  });

  for (const [attemptIndex, { apiKey, keyIndex }] of orderedApiKeys.entries()) {
    const client = createClient(apiKey);

    logOpenRouterRequest({
      model: env.openRouterModel,
      system: options.system,
      user: options.user,
      tools: options.tools,
    });

    try {
      const response = await client.chat.completions.create({
        model: env.openRouterModel,
        temperature: 0.7,
        max_tokens: options.maxTokens ?? 8000,
        messages: [
          { role: "system", content: options.system },
          { role: "user", content: options.user },
        ],
        tools: options.tools?.map(toFunctionTool),
        tool_choice: options.tools?.length ? "auto" : undefined,
      });

      preferredOpenRouterKeyIndex = keyIndex;

      if (attemptIndex > 0) {
        logOpenRouterResponse("completion.key_success", {
          keySlot: keyIndex + 1,
          message: "Completion succeeded after failing over to a secondary OpenRouter API key.",
        });
      }

      return extractToolInput(response);
    } catch (error) {
      lastError = error;
      const errorRecord = error as Record<string, unknown>;
      const status = typeof errorRecord.status === "number" ? errorRecord.status : null;
      const canFailOver = status === 429 && attemptIndex < orderedApiKeys.length - 1;

      logOpenRouterResponse("completion.error", {
        keySlot: keyIndex + 1,
        message: error instanceof Error ? error.message : String(error),
        name: error instanceof Error ? error.name : null,
        status,
        code: typeof errorRecord.code === "string" ? errorRecord.code : null,
        type: typeof errorRecord.type === "string" ? errorRecord.type : null,
        cause:
          error instanceof Error && error.cause
            ? String(error.cause)
            : null,
        willFailOver: canFailOver,
      });

      if (canFailOver) {
        preferredOpenRouterKeyIndex = orderedApiKeys[attemptIndex + 1]?.keyIndex ?? preferredOpenRouterKeyIndex;
        logOpenRouterResponse("completion.key_failover", {
          fromKeySlot: keyIndex + 1,
          toKeySlot: orderedApiKeys[attemptIndex + 1].keyIndex + 1,
          reason: "Received HTTP 429 from OpenRouter.",
        });
        continue;
      }

      throw error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export function getTurnQualityMeta() {
  return null;
}

class DungeonMasterClient {
  async generateCharacter(prompt: string): Promise<{ character: CharacterTemplateDraft; source: "openrouter" }> {
    try {
      const response = await runCompletion({
        system: [
          "You create grounded but vivid solo RPG protagonists for an open-world campaign.",
          "Return exactly one playable character template via the provided tool schema.",
          "Make the character specific, competent, and adventure-ready without becoming mythic or overpowered.",
          `starterItems must contain at most ${MAX_STARTER_ITEMS} specific, mundane items.`,
          "Stats are modifiers in the range -2 to +3, maxHealth is usually 8 to 18, and starter gear should feel specific and mundane.",
        ].join("\n"),
        user: prompt,
        tools: [characterTool],
      });

      const normalizedInput = normalizeCharacterToolInput(response?.input);

      logOpenRouterResponse("character.normalized_input", {
        preview: toPreview(normalizedInput),
      });

      const parsed = characterTemplateDraftSchema.safeParse(normalizedInput);
      if (!parsed.success) {
        logOpenRouterResponse("character.schema_failure", {
          issues: parsed.error.issues,
          inputPreview: toPreview(normalizedInput),
        });
        throw new Error(`Character generation returned invalid structured data: ${parsed.error.message}`);
      }

      logOpenRouterResponse("character.success", {
        preview: toPreview(parsed.data),
      });

      return { character: parsed.data, source: "openrouter" };
    } catch (error) {
      logOpenRouterResponse("character.error", {
        message: error instanceof Error ? error.message : String(error),
      });
      throw new Error(error instanceof Error ? error.message : "Character generation failed.");
    }
  }

  async generateWorldModule(input: {
    prompt: string;
    previousDraft?: GeneratedWorldModule;
    onProgress?: (update: WorldGenerationProgressUpdate) => void;
  }): Promise<GeneratedWorldModuleDraft> {
    startWorldGenerationLog();

    try {
      const attempts: OpenWorldGenerationArtifacts["attempts"] = [];
      const validationReports: OpenWorldGenerationArtifacts["validationReports"] = [];
      const stageSummaries: OpenWorldGenerationArtifacts["stageSummaries"] = {};
      const worldPromptProfile = inferWorldPromptProfile(input.prompt);
      const notifyProgress = (update: WorldGenerationProgressUpdate) => {
        logWorldGenerationProgress(update);
        input.onProgress?.(update);
      };

      notifyProgress({
        stage: "world_bible",
        status: "running",
        message: getWorldGenerationStageRunningMessage("world_bible"),
      });
      const worldBible = await runStructuredStage({
        stage: "world_bible",
        system: buildWorldGenSystemPrompt([
          "Generate a foundational world bible for an open-world solo campaign module.",
          `Cover the required pressures, fractures, anchors, and explanation threads, but add more only when each addition introduces genuinely new texture, conflict, or contradiction.`,
          "Systemic pressures must affect mundane survival, travel, work, shelter, communication, maintenance, law, debt, or access.",
          "If the prompt implies unusual habitats, vehicles, climate, industry, or magic, show what keeps them running and what residents fear will fail first.",
          "Historical fractures should be political, technological, territorial, or resource-driven.",
          "Historical fractures should cash out into current shortages, tolls, feuds, damaged infrastructure, legal burdens, or dangerous routes people deal with today.",
          "Use the explanationThreads field for competing explanations, beliefs, doctrines, rumors, theories, or myths as appropriate to the prompt.",
          worldPromptProfile.explanationStyle === "folkloric"
            ? "Let explanationThreads lean folkloric or religious when the prompt clearly invites that, but keep each one tied to lived institutions, places, or risks."
            : worldPromptProfile.explanationStyle === "speculative"
              ? "If the setting leans speculative or technological, let explanationThreads hold rival theories, doctrines, or official explanations instead of forcing folklore."
              : "If the setting leans practical or political, let explanationThreads hold rival beliefs, rumors, doctrines, or institutional explanations instead of forcing mythic lore.",
          "Each explanationThreads entry should name a phenomenon, show several prevailing theories, and point to an actionable secret.",
          "An actionable secret should open a next investigation step, bargaining edge, route, cache, ledger, witness, or practical advantage instead of fully solving the setting's deepest mystery.",
          "Everyday life must explain how ordinary people get food, water, safety, and social protection.",
          "Keep list fields terse, but allow worldOverview, survival, and actionableSecret enough room to feel evocative within the stated output budget.",
          "Avoid decorative filler; spend prose budget on usable atmosphere and concrete pressure.",
          "Do not genericize the setting title, premise nouns, or signature images from the prompt.",
          "If the prompt does not name the world explicitly, derive an understated title from prompt language rather than inventing melodramatic branding.",
        ]),
        buildUser: (correctionNotes) =>
          [
            buildWorldGenerationBasePrompt({
              prompt: input.prompt,
              previousDraft: input.previousDraft,
              correctionNotes,
            }),
            formatPromptBlock(
              "output_budget",
              buildWorldBibleOutputBudget(worldPromptProfile.minimumExplanationThreads),
            ),
            formatFinalInstruction([
              "Return the world bible only.",
              `Meet the schema minimums for systemicPressures, historicalFractures, immersionAnchors, explanationThreads, institutions, fears, wants, trade, and gossip.`,
              "Add more items only when they introduce genuinely new texture, pressure, or contradiction.",
              "Keep list items as short phrases, but let worldOverview, survival, and actionableSecret use brief evocative prose within the output budget.",
              "Do not generate locations, NPCs, commodities, or entry points yet.",
            ]),
          ].join("\n\n"),
        schema: generatedWorldBibleSchema,
        tool: worldBibleTool,
        attempts,
        validationReports,
        stageSummaries,
        validate: (parsed) => [
          {
            category: "immersion",
            issues: validateWorldBible(parsed, {
              minimumExplanationThreads: worldPromptProfile.minimumExplanationThreads,
            }).issues,
          },
        ],
        summarize: (parsed) =>
          `${parsed.title}: ${parsed.systemicPressures.length} systemic pressures, ${parsed.explanationThreads.length} explanation threads.`,
      });
      notifyProgress({
        stage: "world_bible",
        status: "complete",
        message: stageSummaries.world_bible,
      });

      const worldPromptContext = summarizeWorldBibleForPrompt(worldBible, worldPromptProfile);

      notifyProgress({
        stage: "world_spine",
        status: "running",
        message: getWorldGenerationStageRunningMessage("world_spine"),
      });
      const worldSpineFactions = await runStructuredStage({
        stage: "world_spine",
        system: buildWorldGenSystemPrompt([
          "Generate factions only.",
          "Every faction must have a visible agenda, a public footprint, and pressure that affects ordinary people.",
          "Every faction should depend on a local resource, route, labor pool, permit system, repair capacity, or information source it cannot fully secure alone.",
          "Assume internal disagreement, brittle coalition management, or competing methods inside each faction rather than perfect unity.",
          "Favor territorial, commercial, legal, religious, labor, corporate, civic, military, or salvage conflicts over destiny framing.",
          "Use concise lowercase underscore keys because the engine will assign canonical ids later.",
          "Every generated key must be 40 characters or fewer.",
          "Keep the world compact: 5 to 12 factions.",
          "At least half the factions should be civic, labor, commercial, military, or religious institutions that ordinary residents regularly deal with.",
          "Reuse and sharpen the prompt's specific nouns instead of replacing them with generic organizations.",
        ]),
        buildUser: (correctionNotes) =>
          [
            buildWorldGenerationBasePrompt({
              prompt: input.prompt,
              previousDraft: input.previousDraft,
              correctionNotes,
            }),
            formatPromptBlock("world_context", worldPromptContext),
            formatFinalInstruction("Generate only factions for this world spine."),
          ].join("\n\n"),
        schema: worldSpineFactionsSchema,
        tool: worldSpineFactionsTool,
        attempts,
        validationReports,
        stageSummaries,
        validate: (parsed) => [
          {
            category: "coherence",
            issues: findDuplicateStrings(parsed.factions.map((faction) => faction.key)).map(
              (key) => `Faction key ${key} is duplicated.`,
            ),
          },
        ],
        summarize: (parsed) => `${parsed.factions.length} factions with public agendas.`,
      });

      const worldSpineLocationPlan = await runStructuredStage({
        stage: "world_spine",
        system: buildWorldGenSystemPrompt([
          "Choose how many total locations the world spine should have.",
          "Return only a locationCount value of 9, 12, or 15.",
          "Pick the smallest count that still gives the setting enough room for distinct work sites, civic hubs, chokepoints, and hazards.",
          "Favor compactness unless the prompt clearly needs more distinct places.",
        ]),
        buildUser: (correctionNotes) =>
          [
            buildWorldGenerationBasePrompt({
              prompt: input.prompt,
              previousDraft: input.previousDraft,
              correctionNotes,
            }),
            formatPromptBlock("world_context", worldPromptContext),
            formatPromptBlock(
              "locked_factions",
              summarizeFactionRefs(
                worldSpineFactions.factions.map((faction) => ({
                  key: faction.key,
                  name: faction.name,
                  type: faction.type,
                  agenda: faction.agenda,
                  publicFootprint: faction.publicFootprint,
                })),
              ),
            ),
            formatFinalInstruction("Return only locationCount: 9, 12, or 15."),
          ].join("\n\n"),
        schema: worldSpineLocationPlanSchema,
        tool: worldSpineLocationPlanTool,
        attempts,
        validationReports,
        stageSummaries,
        summarize: (parsed) => `${parsed.locationCount} planned world spine locations.`,
      });

      const worldSpineLocationTarget = worldSpineLocationPlan.locationCount;
      const worldSpineLocationBatchCount = Math.ceil(
        worldSpineLocationTarget / WORLD_SPINE_LOCATION_BATCH_SIZE,
      );
      const worldSpineEverydayLocationTarget = Math.ceil(worldSpineLocationTarget / 2);
      const worldSpineLocationBatches: z.infer<typeof worldSpineLocationsSchema>["locations"][] = [];

      for (let batchIndex = 0; batchIndex < worldSpineLocationBatchCount; batchIndex += 1) {
        const worldSpineLocationBatchSchema = z.object({
          locations: z.array(worldSpineLocationSchema).length(WORLD_SPINE_LOCATION_BATCH_SIZE),
        });
        const worldSpineLocationBatchTool = createStructuredTool(
          worldSpineLocationsTool.name,
          worldSpineLocationsTool.description,
          worldSpineLocationBatchSchema,
        );

        const priorLocations = worldSpineLocationBatches.flat();
        const priorEverydayCount = priorLocations.filter((location) =>
          isEverydayUseWorldSpineLocation(location),
        ).length;
        const remainingAfterThisBatch =
          worldSpineLocationTarget - priorLocations.length - WORLD_SPINE_LOCATION_BATCH_SIZE;
        const minimumEverydayNeededThisBatch = Math.max(
          0,
          worldSpineEverydayLocationTarget - priorEverydayCount - remainingAfterThisBatch,
        );
        const suggestedNonEverydaySlotsThisBatch = Math.max(
          0,
          WORLD_SPINE_LOCATION_BATCH_SIZE - minimumEverydayNeededThisBatch,
        );

        const worldSpineLocationBatch = await runStructuredStage({
          stage: "world_spine",
          system: buildWorldGenSystemPrompt([
            "Generate locations only for this batch.",
            "Locations must feel distinct because of work, terrain, law, trade, hazard, or ritual, not vague grandeur.",
            "For unusual settlements or sites, imply what keeps the place supplied, repaired, guarded, or habitable and what breaks when that system slips.",
            "Use only the provided faction keys when naming a controlling faction.",
            "Each controlled location must visibly express who profits, patrols, or governs there.",
            `This world should finish with ${worldSpineLocationTarget} total locations, returned in batches of ${WORLD_SPINE_LOCATION_BATCH_SIZE}.`,
            "Every generated key must be 40 characters or fewer.",
            "At least half the final location set should be work sites, civic hubs, chokepoints, or settlements ordinary people actually use day to day.",
            "The rest should lean toward dangerous routes, sacred sites, remote hazards, vaults, monster territory, extraction zones, or other special-purpose places people approach for a reason rather than daily routine.",
            "Do not make every location a work site, civic hub, chokepoint, or settlement.",
            "Preserve the prompt's specific imagery and avoid generic city, ruin, or temple reskins.",
            "Keep descriptions short so the full structured payload fits in one response.",
          ]),
          buildUser: (correctionNotes) =>
            [
              buildWorldGenerationBasePrompt({
                prompt: input.prompt,
                previousDraft: input.previousDraft,
                correctionNotes,
              }),
              formatPromptBlock("world_context", worldPromptContext),
              formatPromptBlock(
                "locked_factions",
                summarizeFactionRefs(
                  worldSpineFactions.factions.map((faction) => ({
                    key: faction.key,
                    name: faction.name,
                    type: faction.type,
                    agenda: faction.agenda,
                    publicFootprint: faction.publicFootprint,
                  })),
                ),
              ),
              priorLocations.length
                ? formatPromptBlock(
                    "existing_locations",
                    summarizeLocationRefs(
                      priorLocations.map((location) => ({
                        key: location.key,
                        name: location.name,
                        type: location.type,
                        controlStatus: location.controlStatus,
                        controllingFactionKey: location.controllingFactionKey,
                        summary: location.summary,
                      })),
                    ),
                  )
                : "",
              formatPromptBlock("composition_tracker", {
                targetLocationCount: worldSpineLocationTarget,
                targetEverydayUseMinimum: worldSpineEverydayLocationTarget,
                alreadyGeneratedLocationCount: priorLocations.length,
                alreadyGeneratedEverydayUseCount: priorEverydayCount,
                minimumEverydayUseNeededThisBatch: minimumEverydayNeededThisBatch,
                suggestedNonEverydaySlotsThisBatch,
                remainingLocationsAfterThisBatch: remainingAfterThisBatch,
              }),
              formatFinalInstruction([
                `Generate exactly ${WORLD_SPINE_LOCATION_BATCH_SIZE} new locations for batch ${batchIndex + 1} of ${worldSpineLocationBatchCount}.`,
                "Use only known faction keys in controllingFactionKey.",
                "Do not repeat or rename any existing location shown above.",
                `Ensure at least ${minimumEverydayNeededThisBatch} of this batch's locations are work sites, civic hubs, chokepoints, or settlements ordinary people actually use day to day.`,
                suggestedNonEverydaySlotsThisBatch > 0
                  ? `Use the remaining ${suggestedNonEverydaySlotsThisBatch} slot(s) for dangerous, sacred, remote, hidden, or otherwise special-purpose locations people do not use in everyday routine.`
                  : "If this batch is forced to be fully everyday-use by the composition tracker, keep later batches available for stranger or more dangerous special-purpose sites.",
              ]),
            ]
              .filter(Boolean)
              .join("\n\n"),
          schema: worldSpineLocationBatchSchema,
          tool: worldSpineLocationBatchTool,
          attempts,
          validationReports,
          stageSummaries,
          validate: (parsed) => {
            const issues = findDuplicateStrings(parsed.locations.map((location) => location.key)).map(
              (key) => `Location key ${key} is duplicated within this batch.`,
            );
            const factionKeys = new Set(worldSpineFactions.factions.map((faction) => faction.key));
            const priorLocationKeys = new Set(priorLocations.map((location) => location.key));
            const batchEverydayCount = parsed.locations.filter((location) =>
              isEverydayUseWorldSpineLocation(location),
            ).length;

            parsed.locations.forEach((location) => {
              if (
                location.controllingFactionKey &&
                !factionKeys.has(location.controllingFactionKey)
              ) {
                issues.push(`Location ${location.name} uses unknown controller ${location.controllingFactionKey}.`);
              }
              if (priorLocationKeys.has(location.key)) {
                issues.push(`Location key ${location.key} was already used in a previous batch.`);
              }
            });

            if (batchEverydayCount < minimumEverydayNeededThisBatch) {
              issues.push(
                `This batch needs at least ${minimumEverydayNeededThisBatch} everyday-use locations to keep the final world composition on track.`,
              );
            }

            return [{ category: "coherence", issues }];
          },
          summarize: (parsed) =>
            `Location batch ${batchIndex + 1}/${worldSpineLocationBatchCount}: ${parsed.locations.length} locations.`,
        });

        worldSpineLocationBatches.push(worldSpineLocationBatch.locations);
      }

      const worldSpineLocations = {
        locations: worldSpineLocationBatches.flat(),
      };

      const worldSpineLocationsValidation = worldSpineLocationsSchema.safeParse(worldSpineLocations);
      if (!worldSpineLocationsValidation.success) {
        throw new Error(
          `world_spine locations returned invalid structured data: ${worldSpineLocationsValidation.error.message}`,
        );
      }

      const finalEverydayCount = worldSpineLocations.locations.filter((location) =>
        isEverydayUseWorldSpineLocation(location),
      ).length;
      if (finalEverydayCount < worldSpineEverydayLocationTarget) {
        throw new Error(
          `world_spine locations need at least ${worldSpineEverydayLocationTarget} everyday-use locations, received ${finalEverydayCount}.`,
        );
      }

      const worldSpineEdges = await runStructuredStage({
        stage: "world_spine",
        system: buildWorldGenSystemPrompt([
          "Generate only travel edges.",
          "The location graph must stay connected and feel well-interlinked rather than like a single-file route.",
          "Prefer loops, alternate routes, and a few connective hubs over long linear chains.",
          "Important civic hubs, markets, harbors, and major routes should help players branch into the wider map within a few moves.",
          "Indirect reachability is enough: locations can connect through intermediate routes, and hidden or remote places do not need direct links to every major hub.",
          "Every edge must include a physical travel constraint, danger, patrol, toll, weather issue, supply bottleneck, maintenance problem, or territorial pressure.",
          "Use only the provided location keys.",
          "Use concise lowercase underscore keys and keep the network compact enough for a small open world.",
          "Always use very short edge keys such as route_1, route_2, route_3; do not build keys from full location names.",
          "Every generated key must be 40 characters or fewer. Abbreviate if necessary.",
          "Keep edge descriptions to one tight sentence each.",
          "Prefer short keys like route_1, route_2, route_3.",
        ]),
        buildUser: (correctionNotes) =>
          [
            buildWorldGenerationBasePrompt({
              prompt: input.prompt,
              previousDraft: input.previousDraft,
              correctionNotes,
            }),
            formatPromptBlock("world_context", worldPromptContext),
            formatPromptBlock(
              "locked_locations",
              summarizeLocationRefs(
                worldSpineLocations.locations.map((location) => ({
                  key: location.key,
                  name: location.name,
                  type: location.type,
                  controlStatus: location.controlStatus,
                  controllingFactionKey: location.controllingFactionKey,
                  summary: location.summary,
                })),
              ),
            ),
            formatFinalInstruction("Generate only edges. Every location must be reachable from every other location."),
          ].join("\n\n"),
        schema: worldSpineEdgesSchema,
        tool: worldSpineEdgesTool,
        attempts,
        validationReports,
        stageSummaries,
        validate: (parsed) => {
          const issues = findDuplicateStrings(parsed.edges.map((edge) => edge.key)).map(
            (key) => `Edge key ${key} is duplicated.`,
          );
          const locationKeys = new Set(worldSpineLocations.locations.map((location) => location.key));
          const locationNames = new Map(
            worldSpineLocations.locations.map((location) => [location.key, location.name]),
          );

          parsed.edges.forEach((edge) => {
            if (!locationKeys.has(edge.sourceKey)) {
              issues.push(`Edge ${edge.key} uses unknown sourceKey ${edge.sourceKey}.`);
            }
            if (!locationKeys.has(edge.targetKey)) {
              issues.push(`Edge ${edge.key} uses unknown targetKey ${edge.targetKey}.`);
            }
          });

          if (locationKeys.size > 0 && issues.length === 0) {
            const adjacency = new Map<string, string[]>();
            locationKeys.forEach((key) => adjacency.set(key, []));

            parsed.edges.forEach((edge) => {
              if (adjacency.has(edge.sourceKey) && adjacency.has(edge.targetKey)) {
                adjacency.get(edge.sourceKey)?.push(edge.targetKey);
                adjacency.get(edge.targetKey)?.push(edge.sourceKey);
              }
            });

            const [startNode] = locationKeys;
            if (startNode) {
              const visited = new Set<string>([startNode]);
              const queue = [startNode];

              while (queue.length > 0) {
                const current = queue.shift();
                if (!current) {
                  continue;
                }

                for (const neighbor of adjacency.get(current) ?? []) {
                  if (!visited.has(neighbor)) {
                    visited.add(neighbor);
                    queue.push(neighbor);
                  }
                }
              }

              if (visited.size < locationKeys.size) {
                const missing = [...locationKeys].filter((key) => !visited.has(key));
                const missingLabels = missing.map(
                  (key) => `${key} (${locationNames.get(key) ?? "unknown location"})`,
                );
                issues.push(
                  `The location graph is disconnected. These locations cannot be reached from the rest of the map: ${missingLabels.join(", ")}. Generate additional travel edges that connect them through the network.`,
                );
              }
            }
          }

          return [{ category: "coherence", issues }];
        },
        summarize: (parsed) => `${parsed.edges.length} travel routes.`,
      });

      const maxWorldSpineRelations = 24;
      const targetWorldSpineRelations = Math.min(
        20,
        Math.max(10, worldSpineFactions.factions.length * 2),
      );

      const worldSpineRelations = await runStructuredStage({
        stage: "world_spine",
        system: buildWorldGenSystemPrompt([
          "Generate only faction relations.",
          "Relations must reflect trade dependence, territorial disputes, labor leverage, doctrine clashes, repair dependence, permit control, or naval rivalry.",
          `Return only the important faction relations needed to understand the political map; avoid padding and do not produce a full pair-by-pair matrix.`,
          "Choose only the most important relationships needed to understand the political map.",
          "Use only the provided faction keys.",
          "Use concise lowercase underscore keys and keep the political map readable.",
          "Every generated key must be 40 characters or fewer.",
          "Keep each relation summary to one tight sentence.",
          "Prefer short keys like rel_1, rel_2, rel_3.",
        ]),
        buildUser: (correctionNotes) =>
          [
            buildWorldGenerationBasePrompt({
              prompt: input.prompt,
              previousDraft: input.previousDraft,
              correctionNotes,
            }),
            formatPromptBlock("world_context", worldPromptContext),
            formatPromptBlock(
              "locked_factions",
              summarizeFactionRefs(
                worldSpineFactions.factions.map((faction) => ({
                  key: faction.key,
                  name: faction.name,
                  type: faction.type,
                  agenda: faction.agenda,
                  publicFootprint: faction.publicFootprint,
                })),
              ),
            ),
            formatFinalInstruction(
              `Generate only the most important faction relations using the provided faction keys. Aim for roughly ${targetWorldSpineRelations} if the setting supports it, but prefer fewer over padding and do not generate a full pair-by-pair matrix.`,
            ),
          ].join("\n\n"),
        schema: worldSpineRelationsOnlySchema,
        tool: worldSpineRelationsTool,
        attempts,
        validationReports,
        stageSummaries,
        normalizeInput: (input) => normalizeWorldSpineRelationsInput(input, maxWorldSpineRelations),
        validate: (parsed) => {
          const issues = findDuplicateStrings(parsed.factionRelations.map((relation) => relation.key)).map(
            (key) => `Faction relation key ${key} is duplicated.`,
          );
          const factionKeys = new Set(worldSpineFactions.factions.map((faction) => faction.key));

          parsed.factionRelations.forEach((relation) => {
            if (!factionKeys.has(relation.factionAKey) || !factionKeys.has(relation.factionBKey)) {
              issues.push(`Faction relation ${relation.key} references an unknown faction key.`);
            }
          });

          return [{ category: "coherence", issues }];
        },
        summarize: (parsed) => `${parsed.factionRelations.length} faction relations.`,
      });

      const worldSpine = {
        locations: worldSpineLocations.locations,
        edges: worldSpineEdges.edges,
        factions: worldSpineFactions.factions,
        factionRelations: worldSpineRelations.factionRelations,
      };

      const worldSpineParsed = generatedWorldSpineSchema.safeParse(worldSpine);
      if (!worldSpineParsed.success) {
        throw new Error(`world_spine returned invalid structured data: ${worldSpineParsed.error.message}`);
      }

      const worldSpineValidation = validateWorldSpine(worldSpineParsed.data);
      validationReports.push({
        stage: "world_spine",
        attempt: attempts.filter((attempt) => attempt.stage === "world_spine").length,
        ok: worldSpineValidation.ok,
        category: "coherence",
        issues: worldSpineValidation.issues,
      });
      if (!worldSpineValidation.ok) {
        throw new Error(`world_spine coherence failed: ${worldSpineValidation.issues.join("; ")}`);
      }
      stageSummaries.world_spine =
        `${worldSpineParsed.data.locations.length} locations, ${worldSpineParsed.data.factions.length} factions, ${worldSpineParsed.data.edges.length} routes.`;
      notifyProgress({
        stage: "world_spine",
        status: "complete",
        message: stageSummaries.world_spine,
      });

      const idMaps: OpenWorldGenerationArtifacts["idMaps"] = {
        factions: assignCanonicalIds(worldSpineParsed.data.factions.map((faction) => faction.key), "fac"),
        locations: assignCanonicalIds(worldSpineParsed.data.locations.map((location) => location.key), "loc"),
        edges: assignCanonicalIds(worldSpineParsed.data.edges.map((edge) => edge.key), "edge"),
        factionRelations: assignCanonicalIds(
          worldSpineParsed.data.factionRelations.map((relation) => relation.key),
          "rel",
        ),
        npcs: {},
        information: {},
        commodities: {},
      };

      const lockedLocations = worldSpineParsed.data.locations.map((location) => ({
        key: location.key,
        id: idMaps.locations[location.key],
        name: location.name,
        type: location.type,
        summary: location.summary,
        localIdentity: location.localIdentity,
        controlStatus: location.controlStatus,
      }));
      const lockedFactions = worldSpineParsed.data.factions.map((faction) => ({
        key: faction.key,
        id: idMaps.factions[faction.key],
        name: faction.name,
        type: faction.type,
        agenda: faction.agenda,
        publicFootprint: faction.publicFootprint,
      }));

      notifyProgress({
        stage: "regional_life",
        status: "running",
        message: getWorldGenerationStageRunningMessage("regional_life"),
      });
      const regionalLifeBatches = chunkArray(lockedLocations, REGIONAL_LIFE_BATCH_SIZE);
      const regionalLifeBatchResults: RegionalLifeDraft["locations"][] = [];

      for (const [batchIndex, locationBatch] of regionalLifeBatches.entries()) {
        const regionalLifeBatchSchema = generatedRegionalLifeSchema.extend({
          locations: generatedRegionalLifeSchema.shape.locations.length(locationBatch.length),
        });
        const regionalLifeBatchTool = createStructuredTool(
          regionalLifeTool.name,
          regionalLifeTool.description,
          regionalLifeBatchSchema,
        );

        const regionalLifeBatch = await runStructuredStage({
          stage: "regional_life",
          system: buildWorldGenSystemPrompt([
            "Generate the lived-in regional layer for each locked location in this batch.",
            "Each location needs public activity, local pressure, everyday texture, hazards, ordinary knowledge, and reasons a resident stays or leaves.",
            "Focus on workers, routines, institutions, rot, shortages, tolls, patrols, weather exposure, quotas, and upkeep burdens.",
            "If the world has grand history or myth, cash it out here as something residents pay, dodge, repair, fear, exploit, or gossip about today.",
            "dominantActivities, publicHazards, ordinaryKnowledge, institutions, gossip, reasonsToLinger, routineSeeds, and eventSeeds must all be arrays of short strings.",
            `Return exactly ${locationBatch.length} records, one per location id in the batch.`,
          ]),
          buildUser: (correctionNotes) =>
            [
              buildWorldGenerationBasePrompt({
                prompt: input.prompt,
                previousDraft: input.previousDraft,
                correctionNotes,
              }),
              formatPromptBlock("world_context", worldPromptContext),
              formatPromptBlock(
                "locked_locations_batch",
                summarizeLocationRefs(locationBatch, { includeKey: false }),
              ),
              formatFinalInstruction([
                "Use only the provided location ids.",
                `Return exactly ${locationBatch.length} regional life records for this batch.`,
              ]),
            ].join("\n\n"),
          schema: regionalLifeBatchSchema,
          tool: regionalLifeBatchTool,
          attempts,
          validationReports,
          stageSummaries,
          normalizeInput: (input) => normalizeRegionalLifeInput(input, locationBatch.length),
          validate: (parsed) => [
            {
              category: "immersion",
              issues: validateRegionalLife(parsed, locationBatch.map((location) => location.id)).issues,
            },
          ],
          summarize: (parsed) =>
            `Batch ${batchIndex + 1}/${regionalLifeBatches.length}: ${parsed.locations.length} regional life profiles.`,
        });

        regionalLifeBatchResults.push(regionalLifeBatch.locations);
      }

      const regionalLife: RegionalLifeDraft = {
        locations: regionalLifeBatchResults.flat(),
      };
      const regionalLifeValidation = validateRegionalLife(
        regionalLife,
        lockedLocations.map((location) => location.id),
      );
      validationReports.push({
        stage: "regional_life",
        attempt: attempts.filter((attempt) => attempt.stage === "regional_life").length,
        ok: regionalLifeValidation.ok,
        category: "immersion",
        issues: regionalLifeValidation.issues,
      });
      if (!regionalLifeValidation.ok) {
        throw new Error(`regional_life immersion failed: ${regionalLifeValidation.issues.join("; ")}`);
      }
      stageSummaries.regional_life =
        `${regionalLife.locations.length} regional life profiles across ${regionalLifeBatches.length} batches.`;
      notifyProgress({
        stage: "regional_life",
        status: "complete",
        message: stageSummaries.regional_life,
      });

      notifyProgress({
        stage: "social_cast",
        status: "running",
        message: getWorldGenerationStageRunningMessage("social_cast"),
      });
      const socialCastBatches = chunkArray(lockedLocations, SOCIAL_CAST_BATCH_SIZE);
      const socialCastBatchResults: z.infer<typeof generatedSocialLayerInputSchema>["npcs"][] = [];
      const regionalLifeDigest = summarizeRegionalLifeForPrompt(regionalLife);

      for (const [batchIndex, locationBatch] of socialCastBatches.entries()) {
        const socialBatchSchema = generatedSocialLayerInputSchema.extend({
          npcs: generatedSocialLayerInputSchema.shape.npcs.length(locationBatch.length),
        });
        const socialBatchTool = createStructuredTool(
          socialCastTool.name,
          socialCastTool.description,
          socialBatchSchema,
        );
        const priorNpcNames = new Set(
          socialCastBatchResults
            .flat()
            .map((npc) => npc.name.trim().toLowerCase())
            .filter(Boolean),
        );
        const priorFirstNames = new Set(
          socialCastBatchResults
            .flat()
            .map((npc) => firstNameOf(npc.name))
            .filter(Boolean),
        );

        const socialBatch = await runStructuredStage({
          stage: "social_cast",
          system: buildWorldGenSystemPrompt([
            "Generate systemic NPCs for this world map batch.",
            "Every NPC must have a mundane routine, a current concern tied to a local hazard, faction pressure, or commodity shortage, and a transactional or territorial reason to cross paths with the player.",
            "Current concerns should usually arise from a dependency, bottleneck, debt, quota, inspection, repair burden, permit, or local rivalry instead of free-floating angst.",
            "Favor workers, pilots, wardens, clerks, brokers, crew leads, and other routine social roles over colorful eccentrics.",
            "Use highly varied first-name sounds and syllable patterns so the cast does not cluster around a few repeated drowned-world name shapes.",
            "Every NPC's first name must be unique across the whole world.",
            "playerCrossPath should describe an ordinary deal, toll, patrol, dispute, inspection, delivery, rumor, work dependency, or bureaucratic snag instead of a cinematic mission pitch.",
            "Use only the exact provided ids in factionId, currentLocationId, ties.locationIds, bridgeLocationIds, and bridgeFactionIds; never use faction keys, location keys, or names in those fields.",
            "Every factionId and bridgeFactionId must match a provided fac_* id exactly.",
            "Keep summary, description, currentConcern, and playerCrossPath to one tight sentence each.",
            "Keep ties compact: 1 to 2 locationIds, 0 to 2 factionIds, 1 to 2 economyHooks, 1 to 2 informationHooks, and only 0 to 2 bridge ids when truly useful.",
            "Do not reuse any exact NPC name shown from earlier batches.",
            "If correction notes mention duplicate names, keep the same NPC concepts and only rename the duplicated NPCs.",
            "If correction notes mention invalid ids or wrong anchors, keep the same NPC concepts where possible and fix only the referenced ids, anchors, and names.",
            "Do not create ornamental quest-givers or pleas for a hero.",
            `Return exactly ${locationBatch.length} NPCs, one anchored in each location in the batch.`,
          ]),
          buildUser: (correctionNotes) =>
            [
              buildWorldGenerationBasePrompt({
                prompt: input.prompt,
                previousDraft: input.previousDraft,
                correctionNotes,
              }),
              formatPromptBlock("world_context", worldPromptContext),
              formatPromptBlock(
                "locked_locations_batch",
                summarizeLocationRefs(locationBatch, { includeKey: false }),
              ),
              formatPromptBlock(
                "locked_factions",
                summarizeFactionRefs(lockedFactions, { includeKey: false }),
              ),
              formatPromptBlock(
                "regional_life_digest",
                summarizeRegionalLifeRefs({
                  locations: regionalLife.locations.filter((entry) =>
                    locationBatch.some((location) => location.id === entry.locationId),
                  ),
                }),
              ),
              formatFinalInstruction([
                "Use only the provided location ids and faction ids.",
                "For structured fields, use ids like loc_* and fac_* exactly as shown above, never the key= values.",
                `Return exactly ${locationBatch.length} NPCs for this batch, with one currentLocationId per batch location.`,
              ]),
            ].join("\n\n"),
          schema: socialBatchSchema,
          tool: socialBatchTool,
          attempts,
          validationReports,
          stageSummaries,
          validate: (parsed) => {
            const issues: string[] = [];
            const locationIds = new Set(locationBatch.map((location) => location.id));
            const allLocationIds = new Set(lockedLocations.map((location) => location.id));
            const factionIds = new Set(lockedFactions.map((faction) => faction.id));
            const counts = new Map<string, number>();
            const batchNames = new Set<string>();
            const batchFirstNames = new Set<string>();

            for (const npc of parsed.npcs) {
              if (!locationIds.has(npc.currentLocationId)) {
                issues.push(`NPC ${npc.name} must use a currentLocationId from this batch.`);
              }
              if (npc.factionId && !factionIds.has(npc.factionId)) {
                issues.push(`NPC ${npc.name} must use a locked factionId.`);
              }
              for (const tiedLocationId of npc.ties.locationIds) {
                if (!allLocationIds.has(tiedLocationId)) {
                  issues.push(`NPC ${npc.name} ties reference unknown location ${tiedLocationId}.`);
                }
              }
              for (const bridgeLocationId of npc.bridgeLocationIds) {
                if (!allLocationIds.has(bridgeLocationId)) {
                  issues.push(`NPC ${npc.name} bridgeLocationIds reference unknown location ${bridgeLocationId}.`);
                }
              }
              for (const bridgeFactionId of npc.bridgeFactionIds) {
                if (!factionIds.has(bridgeFactionId)) {
                  issues.push(`NPC ${npc.name} bridgeFactionIds reference unknown faction ${bridgeFactionId}.`);
                }
              }

              const normalizedName = npc.name.trim().toLowerCase();
              if (priorNpcNames.has(normalizedName)) {
                issues.push(
                  `Rename ${npc.name}; this exact full name is already used in an earlier batch. Keep the same NPC's role, location, and concerns, and change only the name.`,
                );
              }
              if (batchNames.has(normalizedName)) {
                issues.push(
                  `Rename ${npc.name}; this exact full name is duplicated within this batch. Keep the same NPC's role, location, and concerns, and change only the name.`,
                );
              }
              if (normalizedName) {
                batchNames.add(normalizedName);
              }

              const normalizedFirstName = firstNameOf(npc.name);
              if (priorFirstNames.has(normalizedFirstName)) {
                issues.push(
                  `Rename ${npc.name}; the first name '${normalizedFirstName}' is already used in an earlier batch. Keep the same NPC's role, location, and concerns, and change only the name.`,
                );
              }
              if (batchFirstNames.has(normalizedFirstName)) {
                issues.push(
                  `Rename ${npc.name}; the first name '${normalizedFirstName}' is already duplicated within this batch. Keep the same NPC's role, location, and concerns, and change only the name.`,
                );
              }
              if (normalizedFirstName) {
                batchFirstNames.add(normalizedFirstName);
              }

              counts.set(npc.currentLocationId, (counts.get(npc.currentLocationId) ?? 0) + 1);
            }

            for (const location of locationBatch) {
              if ((counts.get(location.id) ?? 0) !== 1) {
                issues.push(`Batch social cast must include exactly one NPC anchored at ${location.id}.`);
              }
            }

            return [{ category: "immersion", issues }];
          },
          summarize: (parsed) =>
            `Batch ${batchIndex + 1}/${socialCastBatches.length}: ${parsed.npcs.length} anchored NPCs.`,
        });

        socialCastBatchResults.push(socialBatch.npcs);
      }

      const socialCastInput: z.infer<typeof generatedSocialLayerInputSchema> = {
        npcs: socialCastBatchResults.flat(),
      };
      stageSummaries.social_cast =
        `${socialCastInput.npcs.length} NPCs across ${socialCastBatches.length} batches.`;
      notifyProgress({
        stage: "social_cast",
        status: "complete",
        message: stageSummaries.social_cast,
      });

      const socialNpcIds = assignIndexedIds(
        socialCastInput.npcs,
        "npc",
        (npc, index) => `${npc.name}_${npc.role}_${index + 1}`,
      );

      idMaps.npcs = Object.fromEntries(
        socialCastInput.npcs.map((npc, index) => [`npc_${index + 1}`, socialNpcIds[index]]),
      );

      const socialLayer: OpenWorldGenerationArtifacts["socialLayer"] = {
        npcs: socialCastInput.npcs.map((npc, index) => ({
          id: socialNpcIds[index],
          name: npc.name,
          role: npc.role,
          summary: npc.summary,
          description: `${npc.description} Current concern: ${npc.currentConcern}. You might cross paths because ${npc.playerCrossPath.toLowerCase()}.`,
          factionId: npc.factionId,
          currentLocationId: npc.currentLocationId,
          approval: npc.approval,
          isCompanion: npc.isCompanion,
        })),
        socialGravity: socialCastInput.npcs.map((npc, index) => ({
          npcId: socialNpcIds[index],
          importance: npc.importance,
          bridgeLocationIds: npc.bridgeLocationIds,
          bridgeFactionIds: npc.bridgeFactionIds,
        })),
      };

      const socialValidation = validateSocialLayer(
        socialLayer,
        lockedLocations.map((location) => location.id),
      );
      validationReports.push({
        stage: "social_cast",
        attempt: attempts.filter((attempt) => attempt.stage === "social_cast").length,
        ok: socialValidation.ok,
        category: "immersion",
        issues: socialValidation.issues,
      });
      if (!socialValidation.ok) {
        throw new Error(`social_cast immersion failed: ${socialValidation.issues.join("; ")}`);
      }

      const lockedNpcs = socialLayer.npcs.map((npc) => ({
        id: npc.id,
        name: npc.name,
        role: npc.role,
        currentLocationId: npc.currentLocationId,
        factionId: npc.factionId,
      }));
      const targetInformationNodeCount = Math.min(lockedLocations.length + 3, 18);
      const initiallyAnchoredFactionIds = new Set<string>([
        ...worldSpine.locations
          .map((location) =>
            location.controllingFactionKey ? idMaps.factions[location.controllingFactionKey] : null,
          )
          .filter((factionId): factionId is string => Boolean(factionId)),
        ...socialLayer.npcs
          .map((npc) => npc.factionId)
          .filter((factionId): factionId is string => Boolean(factionId)),
      ]);
      const unanchoredFactionsForKnowledge = lockedFactions.filter(
        (faction) => !initiallyAnchoredFactionIds.has(faction.id),
      );

      notifyProgress({
        stage: "knowledge_web",
        status: "running",
        message: getWorldGenerationStageRunningMessage("knowledge_web"),
      });
      const knowledgeWebInput = await runStructuredStage({
        stage: "knowledge_web",
        system: buildWorldGenSystemPrompt([
          "Generate the playable information web for the locked world.",
          "Tie every information node to a present-day cost, hazard, dependency, witness, route, record, object, or local dispute rather than remote lore for its own sake.",
          "Public information must provide a physical location, route, object, document, or NPC lead.",
          "Guarded information must imply what leverage, payment, status, or relationship is required to obtain it.",
          "Secrets should resolve to concrete places, ledgers, caches, devices, routes, or hidden actors rather than pure metaphysics.",
          "actionLead and discoverHow should move play to the next clue or leverage point, not deliver a complete final answer.",
          "Keep every field concise: title, summary, content, actionLead, and discoverHow should all be short phrases or one tight sentence at most.",
          "Return at least one actionable information node for each locked location.",
          "Some locations may surface public leads while others rely on guarded leads; choose what fits the place instead of forcing the same access level everywhere.",
          "Keep the network compact: cover every location, build a genuinely connected web, and stay under 18 information nodes and 24 information links.",
          "Prefer one information node per location unless an extra node adds clear value.",
          "If any factions are listed as currently unanchored, use information nodes to give them a visible public role, dispute, permit system, repair burden, ritual presence, market function, or territorial pressure in the world.",
        ]),
        buildUser: (correctionNotes) =>
          [
            buildWorldGenerationBasePrompt({
              prompt: input.prompt,
              previousDraft: input.previousDraft,
              correctionNotes,
            }),
            formatPromptBlock("world_context", worldPromptContext),
            formatPromptBlock(
              "locked_locations",
              summarizeLocationRefs(lockedLocations, { includeKey: false }),
            ),
            formatPromptBlock(
              "locked_factions",
              summarizeFactionRefs(lockedFactions, { includeKey: false }),
            ),
            ...(unanchoredFactionsForKnowledge.length > 0
              ? [
                  formatPromptBlock(
                    "currently_unanchored_factions",
                    summarizeFactionRefs(unanchoredFactionsForKnowledge, { includeKey: false }),
                  ),
                ]
              : []),
            formatPromptBlock("locked_npcs", summarizeNpcRefs(lockedNpcs)),
            formatPromptBlock("regional_life_digest", summarizeRegionalLifeRefs(regionalLife)),
            ...(correctionNotes
              ? [
                  formatPromptBlock("retry_budget", [
                    "Return the minimum viable payload.",
                    "Use exactly one information node per location unless a cited correction requires more.",
                    "Keep title, summary, content, actionLead, and discoverHow extremely short.",
                    `Keep information links sparse and no higher than ${Math.min(lockedLocations.length + 2, 16)} total.`,
                  ]),
                ]
              : []),
            formatFinalInstruction([
              "Use only the provided ids for locations, factions, and NPCs.",
              "Use unique keys for information nodes and information links.",
              `Give every location at least one actionable information node. Keep the total compact and no higher than ${targetInformationNodeCount} information nodes or 24 information links.`,
              ...(unanchoredFactionsForKnowledge.length > 0
                ? [
                    "At least one information node must use each currently_unanchored_factions factionId so every faction leaves a visible mark on the world.",
                  ]
                : []),
            ]),
          ].join("\n\n"),
        schema: generatedKnowledgeWebInputSchema,
        tool: knowledgeWebTool,
        attempts,
        validationReports,
        stageSummaries,
        validate: (parsed) => {
          const issues: string[] = [];
          const locationIds = new Set(lockedLocations.map((location) => location.id));
          const factionIds = new Set(lockedFactions.map((faction) => faction.id));
          const npcIds = new Set(lockedNpcs.map((npc) => npc.id));

          for (const information of parsed.information) {
            if (information.locationId && !locationIds.has(information.locationId)) {
              issues.push(`Information ${information.title} must use a locked locationId.`);
            }
            if (information.factionId && !factionIds.has(information.factionId)) {
              issues.push(`Information ${information.title} must use a locked factionId.`);
            }
            if (information.sourceNpcId && !npcIds.has(information.sourceNpcId)) {
              issues.push(`Information ${information.title} must use a locked sourceNpcId.`);
            }
          }

          const accessibleInfoRatio =
            parsed.information.length === 0
              ? 1
              : parsed.information.filter((information) => information.accessibility === "public")
                  .length / parsed.information.length;

          if (accessibleInfoRatio < 0.3) {
            issues.push("At least 30% of information should be publicly accessible.");
          }

          for (const location of lockedLocations) {
            const hasLead = parsed.information.some(
              (information) =>
                information.locationId === location.id && information.actionLead.trim().length > 0,
            );

            if (!hasLead) {
              issues.push(`Location ${location.name} needs an actionable lead.`);
            }
          }

          const provisionalKnowledgeLayer = {
            information: parsed.information.map((information) => ({
              id: idMaps.information[information.key],
              title: information.title,
              summary: information.summary,
              content: `${information.content} Lead: ${information.actionLead}. Discovery path: ${information.discoverHow}.`,
              truthfulness: information.truthfulness,
              accessibility: information.accessibility,
              locationId: information.locationId,
              factionId: information.factionId,
              sourceNpcId: information.sourceNpcId,
            })),
            informationLinks: parsed.informationLinks.map((link) => ({
              id: `link_validation_${link.key}`,
              sourceId: idMaps.information[link.sourceKey],
              targetId: idMaps.information[link.targetKey],
              linkType: link.linkType,
            })),
          };

          const provisionalModule: GeneratedWorldModule = {
            title: worldBible.title,
            premise: worldBible.premise,
            tone: worldBible.tone,
            setting: worldBible.setting,
            locations: worldSpine.locations.map((location) => ({
              id: idMaps.locations[location.key],
              name: location.name,
              type: location.type,
              summary: location.summary,
              description: enrichLocationDescription(
                `${location.description} ${location.localIdentity}`,
                regionalLife.locations.find((entry) => entry.locationId === idMaps.locations[location.key]),
              ),
              state: location.state,
              controllingFactionId: location.controllingFactionKey
                ? idMaps.factions[location.controllingFactionKey]
                : null,
              tags: uniqueNames([...location.tags, location.controlStatus]),
            })),
            edges: worldSpine.edges.map((edge) => ({
              id: idMaps.edges[edge.key],
              sourceId: idMaps.locations[edge.sourceKey],
              targetId: idMaps.locations[edge.targetKey],
              travelTimeMinutes: edge.travelTimeMinutes,
              dangerLevel: edge.dangerLevel,
              currentStatus: edge.currentStatus,
              description: edge.description,
            })),
            factions: worldSpine.factions.map((faction) => ({
              id: idMaps.factions[faction.key],
              name: faction.name,
              type: faction.type,
              summary: `${faction.summary} ${faction.publicFootprint}`,
              agenda: faction.agenda,
              resources: faction.resources,
              pressureClock: faction.pressureClock,
            })),
            factionRelations: worldSpine.factionRelations.map((relation) => ({
              id: idMaps.factionRelations[relation.key],
              factionAId: idMaps.factions[relation.factionAKey],
              factionBId: idMaps.factions[relation.factionBKey],
              stance: relation.stance,
            })),
            npcs: socialLayer.npcs,
            information: provisionalKnowledgeLayer.information,
            informationLinks: provisionalKnowledgeLayer.informationLinks,
            commodities: [],
            marketPrices: [],
            entryPoints: [],
          };

          return [
            { category: "playability", issues },
            {
              category: "immersion",
              issues: validateFactionFootprints(provisionalModule).issues,
            },
          ];
        },
        summarize: (parsed) =>
          `${parsed.information.length} information nodes with ${parsed.informationLinks.length} links.`,
      });
      notifyProgress({
        stage: "knowledge_web",
        status: "complete",
        message: stageSummaries.knowledge_web,
      });

      notifyProgress({
        stage: "knowledge_threads",
        status: "running",
        message: getWorldGenerationStageRunningMessage("knowledge_threads"),
      });
      const knowledgeThreadsInput = await runStructuredStage({
        stage: "knowledge_threads",
        system: buildWorldGenSystemPrompt([
          "Generate a compact worldview-and-pressure layer using the existing information web.",
          "Use knowledgeNetworks for compact clusters of public beliefs, competing explanations, rumors, doctrines, theories, or myths that connect back to the existing information web instead of inventing new lore objects.",
          "For linkedInformationKeys, copy only exact information_web keys; never use human-readable titles or world-bible explanation labels.",
          "Pressure seeds should name a locked location or faction and describe a near-term pressure that can move play.",
          "Keep hiddenTruths partial enough to preserve uncertainty; they should sharpen direction and stakes without mathematically closing the world's deepest mysteries.",
          "Keep hiddenTruth and pressure text to one tight sentence each.",
          "Keep it compact. Return only the major worldview clusters and the most actionable near-term pressures; do not pad.",
        ]),
        buildUser: (correctionNotes) => {
          const { competingExplanations: _competingExplanations, ...knowledgeThreadsWorldContext } =
            worldPromptContext;

          return [
            buildWorldGenerationBasePrompt({
              prompt: input.prompt,
              previousDraft: input.previousDraft,
              correctionNotes,
            }),
            formatPromptBlock("world_context", knowledgeThreadsWorldContext),
            formatPromptBlock(
              "locked_locations",
              summarizeLocationRefs(lockedLocations, { includeKey: false }),
            ),
            formatPromptBlock(
              "locked_factions",
              summarizeFactionRefs(lockedFactions, { includeKey: false }),
            ),
            formatPromptBlock(
              "information_web",
              summarizeKnowledgeThreadInformationRefs(knowledgeWebInput.information),
            ),
            formatFinalInstruction([
              "CRITICAL: For linkedInformationKeys, use ONLY the exact lowercase underscore keys from key=... in information_web.",
              "Do not use capitalized titles, and do not use keys from world-context competing explanations or myths.",
              "Use only existing information keys and the provided location and faction ids.",
              "Use knowledgeNetworks for belief, rumor, doctrine, theory, or myth clusters as appropriate to the setting.",
              "Return only as many knowledgeNetworks and pressureSeeds as the world genuinely needs while staying compact and within schema bounds.",
            ]),
          ].join("\n\n");
        },
        schema: generatedKnowledgeThreadsInputSchema,
        tool: knowledgeThreadsTool,
        attempts,
        validationReports,
        stageSummaries,
        validate: (parsed) => {
          const issues: string[] = [];
          const informationKeys = new Set(knowledgeWebInput.information.map((information) => information.key));
          const locationIds = new Set(lockedLocations.map((location) => location.id));
          const factionIds = new Set(lockedFactions.map((faction) => faction.id));
          const invalidInformationKeys = new Set<string>();

          for (const cluster of parsed.knowledgeNetworks) {
            for (const informationKey of cluster.linkedInformationKeys) {
              if (!informationKeys.has(informationKey)) {
                invalidInformationKeys.add(informationKey);
              }
            }
          }

          if (invalidInformationKeys.size > 0) {
            issues.push(
              `linkedInformationKeys must use only information_web keys. Invalid values: ${[...invalidInformationKeys].join(", ")}.`,
            );
            issues.push(
              `Allowed information_web keys: ${[...informationKeys].join(", ")}.`,
            );
          }

          for (const seed of parsed.pressureSeeds) {
            if (seed.subjectType === "location" && !locationIds.has(seed.subjectId)) {
              issues.push(`Pressure seed ${seed.pressure} must use a locked location id.`);
            }
            if (seed.subjectType === "faction" && !factionIds.has(seed.subjectId)) {
              issues.push(`Pressure seed ${seed.pressure} must use a locked faction id.`);
            }
          }

          return [{ category: "playability", issues }];
        },
        summarize: (parsed) =>
          `${parsed.knowledgeNetworks.length} worldview clusters and ${parsed.pressureSeeds.length} pressure seeds.`,
      });
      notifyProgress({
        stage: "knowledge_threads",
        status: "complete",
        message: stageSummaries.knowledge_threads,
      });

      idMaps.information = assignCanonicalIds(
        knowledgeWebInput.information.map((information) => information.key),
        "info",
      );
      const informationLinkIds = assignCanonicalIds(
        knowledgeWebInput.informationLinks.map((link) => link.key),
        "link",
      );

      const knowledgeLayer = {
        information: knowledgeWebInput.information.map((information) => ({
          id: idMaps.information[information.key],
          title: information.title,
          summary: information.summary,
          content: `${information.content} Lead: ${information.actionLead}. Discovery path: ${information.discoverHow}.`,
          truthfulness: information.truthfulness,
          accessibility: information.accessibility,
          locationId: information.locationId,
          factionId: information.factionId,
          sourceNpcId: information.sourceNpcId,
        })),
        informationLinks: knowledgeWebInput.informationLinks.map((link) => ({
          id: informationLinkIds[link.key],
          sourceId: idMaps.information[link.sourceKey],
          targetId: idMaps.information[link.targetKey],
          linkType: link.linkType,
        })),
        knowledgeNetworks: knowledgeThreadsInput.knowledgeNetworks.map((cluster) => ({
          theme: cluster.theme,
          publicBeliefs: cluster.publicBeliefs,
          hiddenTruth: cluster.hiddenTruth,
          linkedInformationIds: cluster.linkedInformationKeys.map(
            (informationKey) => idMaps.information[informationKey],
          ),
          contradictionThemes: cluster.contradictionThemes,
        })),
        pressureSeeds: knowledgeThreadsInput.pressureSeeds,
      };

      const baseWorldModule: GeneratedWorldModule = {
        title: worldBible.title,
        premise: worldBible.premise,
        tone: worldBible.tone,
        setting: worldBible.setting,
        locations: worldSpine.locations.map((location) => ({
          id: idMaps.locations[location.key],
          name: location.name,
          type: location.type,
          summary: location.summary,
          description: enrichLocationDescription(
            `${location.description} ${location.localIdentity}`,
            regionalLife.locations.find((entry) => entry.locationId === idMaps.locations[location.key]),
          ),
          state: location.state,
          controllingFactionId: location.controllingFactionKey
            ? idMaps.factions[location.controllingFactionKey]
            : null,
          tags: uniqueNames([...location.tags, location.controlStatus]),
        })),
        edges: worldSpine.edges.map((edge) => ({
          id: idMaps.edges[edge.key],
          sourceId: idMaps.locations[edge.sourceKey],
          targetId: idMaps.locations[edge.targetKey],
          travelTimeMinutes: edge.travelTimeMinutes,
          dangerLevel: edge.dangerLevel,
          currentStatus: edge.currentStatus,
          description: edge.description,
        })),
        factions: worldSpine.factions.map((faction) => ({
          id: idMaps.factions[faction.key],
          name: faction.name,
          type: faction.type,
          summary: `${faction.summary} ${faction.publicFootprint}`,
          agenda: faction.agenda,
          resources: faction.resources,
          pressureClock: faction.pressureClock,
        })),
        factionRelations: worldSpine.factionRelations.map((relation) => ({
          id: idMaps.factionRelations[relation.key],
          factionAId: idMaps.factions[relation.factionAKey],
          factionBId: idMaps.factions[relation.factionBKey],
          stance: relation.stance,
        })),
        npcs: socialLayer.npcs,
        information: knowledgeLayer.information,
        informationLinks: knowledgeLayer.informationLinks,
        commodities: [],
        marketPrices: [],
        entryPoints: [],
      };

      notifyProgress({
        stage: "economy_material_life",
        status: "running",
        message: getWorldGenerationStageRunningMessage("economy_material_life"),
      });
      const targetCommodityCount = 6;
      const targetMarketPriceCount = Math.min(8, lockedLocations.length);
      const economyMaterialLifeInput = await runStructuredStage({
        stage: "economy_material_life",
        system: buildWorldGenSystemPrompt([
          "Generate commodities, market prices, and location-level material life for the locked world.",
          `Keep the economy compact: no more than ${targetCommodityCount} commodities and no more than ${targetMarketPriceCount} market prices.`,
          `Return one locationTradeIdentity entry for every locked location (${lockedLocations.length} total).`,
          "Include staple goods, raw materials, and at least one controlled or illicit trade pressure.",
          "No generic treasure filler or ornamental adventuring gear; focus on bulk goods, infrastructure, consumables, and daily necessities.",
          "Every commodity should imply scarcity, transport strain, monopoly pressure, hazard, spoilage, upkeep demand, or harvest quota.",
          "Let market presence reveal who maintains critical systems, who pays the hidden costs, and where supply lines are brittle.",
          "Every major location should have a trade identity or a deliberate reason for lacking one.",
          "Keep every field terse: one short sentence or short phrase, not a paragraph.",
        ]),
        buildUser: (correctionNotes) =>
          [
            buildWorldGenerationBasePrompt({
              prompt: input.prompt,
              previousDraft: input.previousDraft,
              correctionNotes,
            }),
            formatPromptBlock("world_context", worldPromptContext),
            formatPromptBlock(
              "locked_locations",
              summarizeLocationRefs(lockedLocations, { includeKey: false }),
            ),
            formatPromptBlock(
              "locked_factions",
              summarizeFactionRefs(lockedFactions, { includeKey: false }),
            ),
            formatPromptBlock("locked_npcs", summarizeNpcRefs(lockedNpcs)),
            formatPromptBlock("regional_life_digest", summarizeRegionalLifeRefs(regionalLife)),
            formatFinalInstruction(
              `Use only the provided location ids, faction ids, and NPC ids. Use unique commodity keys. Return one locationTradeIdentity entry per locked location, and keep the total no higher than ${targetCommodityCount} commodities and ${targetMarketPriceCount} marketPrices.`,
            ),
          ].join("\n\n"),
        schema: generatedEconomyMaterialLifeInputSchema,
        tool: economyMaterialLifeTool,
        attempts,
        validationReports,
        stageSummaries,
        normalizeInput: (input) =>
          normalizeEconomyMaterialLifeInput(input, targetCommodityCount, targetMarketPriceCount),
        validate: (parsed) => {
          const issues: string[] = [];
          const locationIds = new Set(lockedLocations.map((location) => location.id));
          const factionIds = new Set(lockedFactions.map((faction) => faction.id));
          const npcIds = new Set(lockedNpcs.map((npc) => npc.id));

          for (const commodity of parsed.commodities) {
            for (const factionId of commodity.profitFactionIds) {
              if (!factionIds.has(factionId)) {
                issues.push(`Commodity ${commodity.name} references unknown profit faction ${factionId}.`);
              }
            }
          }

          for (const price of parsed.marketPrices) {
            if (!locationIds.has(price.locationId)) {
              issues.push(`Market price for ${price.commodityKey} uses unknown location ${price.locationId}.`);
            }
            if (price.factionId && !factionIds.has(price.factionId)) {
              issues.push(`Market price for ${price.commodityKey} uses unknown faction ${price.factionId}.`);
            }
            if (price.vendorNpcId && !npcIds.has(price.vendorNpcId)) {
              issues.push(`Market price for ${price.commodityKey} uses unknown vendor ${price.vendorNpcId}.`);
            }
          }

          for (const location of lockedLocations) {
            if (!parsed.locationTradeIdentity.some((identity) => identity.locationId === location.id)) {
              issues.push(`Location ${location.name} needs a trade identity entry.`);
            }
          }

          return [{ category: "immersion", issues }];
        },
        summarize: (parsed) =>
          `${parsed.commodities.length} commodities and ${parsed.marketPrices.length} market prices.`,
      });

      idMaps.commodities = assignCanonicalIds(
        economyMaterialLifeInput.commodities.map((commodity) => commodity.key),
        "com",
      );

      const commodityIds = idMaps.commodities;
      const marketPriceIds = assignIndexedIds(
        economyMaterialLifeInput.marketPrices,
        "price",
        (price, index) => `${price.commodityKey}_${price.locationId}_${index + 1}`,
      );

      const knowledgeEconomy: OpenWorldGenerationArtifacts["knowledgeEconomy"] = {
        ...knowledgeLayer,
        commodities: economyMaterialLifeInput.commodities.map((commodity) => ({
          id: commodityIds[commodity.key],
          name: commodity.name,
          baseValue: commodity.baseValue,
          tags: uniqueNames([
            ...commodity.tags,
            commodity.everydayUse,
            commodity.scarcityDriver,
          ]),
        })),
        marketPrices: economyMaterialLifeInput.marketPrices.map((price, index) => ({
          id: marketPriceIds[index],
          commodityId: commodityIds[price.commodityKey],
          locationId: price.locationId,
          vendorNpcId: price.vendorNpcId,
          factionId: price.factionId,
          modifier: price.modifier,
          stock: price.stock,
          legalStatus: price.legalStatus,
        })),
        locationTradeIdentity: economyMaterialLifeInput.locationTradeIdentity,
      };

      const spineModule: GeneratedWorldModule = {
        ...baseWorldModule,
        locations: baseWorldModule.locations.map((location) => ({
          ...location,
          description: appendLocationTradeIdentity(
            location.description,
            knowledgeEconomy.locationTradeIdentity.find((identity) => identity.locationId === location.id),
          ),
        })),
        information: knowledgeEconomy.information,
        informationLinks: knowledgeEconomy.informationLinks,
        commodities: knowledgeEconomy.commodities,
        marketPrices: knowledgeEconomy.marketPrices,
      };

      const knowledgeEconomyValidation = validateKnowledgeEconomy(
        knowledgeEconomy,
        lockedLocations.map((location) => location.id),
      );
      validationReports.push({
        stage: "economy_material_life",
        attempt: attempts.filter((attempt) => attempt.stage === "economy_material_life").length,
        ok: knowledgeEconomyValidation.ok,
        category: "immersion",
        issues: knowledgeEconomyValidation.issues,
      });
      if (!knowledgeEconomyValidation.ok) {
        throw new Error(
          `economy_material_life immersion failed: ${knowledgeEconomyValidation.issues.join("; ")}`,
        );
      }
      notifyProgress({
        stage: "economy_material_life",
        status: "complete",
        message: stageSummaries.economy_material_life,
      });

      const lockedInformation = knowledgeEconomy.information.map((information) => ({
        id: information.id,
        title: information.title,
        accessibility: information.accessibility,
        locationId: information.locationId,
        sourceNpcId: information.sourceNpcId,
      }));

      notifyProgress({
        stage: "entry_contexts",
        status: "running",
        message: getWorldGenerationStageRunningMessage("entry_contexts"),
      });
      const entryContextsInput = await runStructuredStage({
        stage: "entry_contexts",
        system: buildWorldGenSystemPrompt([
          "Generate exactly 3 grounded entry contexts for the completed world.",
          "Each entry should begin with minor but immediate personal, commercial, legal, territorial, or administrative pressure.",
          "Let that immediate pressure be the local face of a bigger system: a shortage, fee, delayed repair, permit demand, labor dispute, patrol crack-down, or contested supply line.",
          "The player should arrive as another person navigating an ongoing society, not as a chosen savior.",
          "Public leads should point to someone, somewhere, or something the player can pursue immediately.",
          "mundaneActionPath should offer a practical next step through local people, work, routes, payments, or paperwork rather than a dramatic destiny hook.",
          "Prefer starting locations that connect to several nearby places within a few hops, so each opening has room to branch into the wider world.",
          "Avoid using only isolated edge locations as opening starts unless they still sit near multiple practical follow-up destinations.",
          "EVERY entry must include the evidenceWorldAlreadyMoving field.",
          "evidenceWorldAlreadyMoving must be a concrete sensory detail showing the world is already active before the player acts, such as guards loading crates, debt collectors arriving, bells sounding, crowds scattering, or workers already arguing over scarce supplies.",
        ]),
        buildUser: (correctionNotes) =>
          [
            buildWorldGenerationBasePrompt({
              prompt: input.prompt,
              previousDraft: input.previousDraft,
              correctionNotes,
            }),
            formatPromptBlock("world_context", worldPromptContext),
            formatPromptBlock(
              "locked_locations",
              summarizeLocationRefs(lockedLocations, { includeKey: false }),
            ),
            formatPromptBlock("locked_npcs", summarizeNpcRefs(lockedNpcs)),
            formatPromptBlock("locked_information", summarizeInformationRefs(lockedInformation)),
            formatPromptBlock("regional_life_digest", summarizeRegionalLifeRefs(regionalLife)),
            formatPromptBlock("social_gravity", summarizeSocialGravityRefs(socialLayer.socialGravity)),
            formatFinalInstruction([
              "Use only the provided ids for locations, NPCs, and information.",
              "Return exactly 3 entryPoints.",
              "Every entryPoint must include evidenceWorldAlreadyMoving as a non-empty sentence.",
            ]),
          ].join("\n\n"),
        schema: generatedEntryContextsInputSchema,
        tool: entryContextsTool,
        attempts,
        validationReports,
        stageSummaries,
        normalizeInput: normalizeEntryContextsInput,
        validate: (parsed) => {
          const issues: string[] = [];
          const locationIds = new Set(lockedLocations.map((location) => location.id));
          const npcIds = new Set(lockedNpcs.map((npc) => npc.id));
          const informationIds = new Set(lockedInformation.map((information) => information.id));

          for (const entry of parsed.entryPoints) {
            if (!locationIds.has(entry.startLocationId)) {
              issues.push(`Entry context ${entry.title} must use a locked startLocationId.`);
            }
            if (!npcIds.has(entry.localContactNpcId)) {
              issues.push(`Entry context ${entry.title} must use a locked localContactNpcId.`);
            }
            for (const npcId of entry.presentNpcIds) {
              if (!npcIds.has(npcId)) {
                issues.push(`Entry context ${entry.title} references unknown present NPC ${npcId}.`);
              }
            }
            for (const informationId of entry.initialInformationIds) {
              if (!informationIds.has(informationId)) {
                issues.push(
                  `Entry context ${entry.title} references unknown information ${informationId}.`,
                );
              }
            }
          }

          const provisionalEntryContexts = {
            entryPoints: parsed.entryPoints.map((entry, index) => ({
              id: `entry_validation_${index + 1}`,
              title: entry.title,
              summary: entry.summary,
              startLocationId: entry.startLocationId,
              presentNpcIds: entry.presentNpcIds,
              initialInformationIds: entry.initialInformationIds,
              immediatePressure: entry.immediatePressure,
              publicLead: entry.publicLead,
              localContactNpcId: entry.localContactNpcId,
              mundaneActionPath: entry.mundaneActionPath,
              evidenceWorldAlreadyMoving: entry.evidenceWorldAlreadyMoving,
            })),
          };

          const provisionalModule: GeneratedWorldModule = {
            ...spineModule,
            entryPoints: provisionalEntryContexts.entryPoints.map((entryPoint) => ({
              id: entryPoint.id,
              title: entryPoint.title,
              summary: entryPoint.summary,
              startLocationId: entryPoint.startLocationId,
              presentNpcIds: entryPoint.presentNpcIds,
              initialInformationIds: entryPoint.initialInformationIds,
            })),
          };

          return [
            {
              category: "playability",
              issues: [
                ...issues,
                ...validateEntryContexts(provisionalEntryContexts, provisionalModule).issues,
              ],
            },
          ];
        },
        summarize: (parsed) => `${parsed.entryPoints.length} entry contexts with pressure and public leads.`,
      });
      notifyProgress({
        stage: "entry_contexts",
        status: "complete",
        message: stageSummaries.entry_contexts,
      });

      const entryPointIds = assignIndexedIds(
        entryContextsInput.entryPoints,
        "entry",
        (entry, index) => `${entry.title}_${index + 1}`,
      );

      const entryContexts: OpenWorldGenerationArtifacts["entryContexts"] = {
        entryPoints: entryContextsInput.entryPoints.map((entry, index) => ({
          id: entryPointIds[index],
          title: entry.title,
          summary: entry.summary,
          startLocationId: entry.startLocationId,
          presentNpcIds: entry.presentNpcIds,
          initialInformationIds: entry.initialInformationIds,
          immediatePressure: entry.immediatePressure,
          publicLead: entry.publicLead,
          localContactNpcId: entry.localContactNpcId,
          mundaneActionPath: entry.mundaneActionPath,
          evidenceWorldAlreadyMoving: entry.evidenceWorldAlreadyMoving,
        })),
      };

      const draft: GeneratedWorldModule = {
        ...spineModule,
        entryPoints: entryContexts.entryPoints.map((entryPoint) => ({
          id: entryPoint.id,
          title: entryPoint.title,
          summary: `${entryPoint.summary} Immediate pressure: ${entryPoint.immediatePressure}. Public lead: ${entryPoint.publicLead}.`,
          startLocationId: entryPoint.startLocationId,
          presentNpcIds: entryPoint.presentNpcIds,
          initialInformationIds: entryPoint.initialInformationIds,
        })),
      };

      notifyProgress({
        stage: "final_world",
        status: "running",
        message: getWorldGenerationStageRunningMessage("final_world"),
      });

      const entryValidation = validateEntryContexts(entryContexts, draft);
      validationReports.push({
        stage: "entry_contexts",
        attempt: attempts.filter((attempt) => attempt.stage === "entry_contexts").length,
        ok: entryValidation.ok,
        category: "playability",
        issues: entryValidation.issues,
      });
      if (!entryValidation.ok) {
        throw new Error(`entry_contexts playability failed: ${entryValidation.issues.join("; ")}`);
      }

      const coherence = validateWorldModuleCoherence(draft);
      const playability = validateWorldModulePlayability(draft);
      const immersion = validateWorldModuleImmersion(draft);
      for (const [category, report] of [
        ["coherence", coherence],
        ["playability", playability],
        ["immersion", immersion],
      ] as const) {
        validationReports.push({
          stage: "final_world",
          attempt: 1,
          ok: report.ok,
          category,
          issues: report.issues,
        });
      }

      logOpenRouterResponse("world.validation", {
        coherenceOk: coherence.ok,
        coherenceIssues: coherence.issues,
        playabilityOk: playability.ok,
        playabilityIssues: playability.issues,
        immersionOk: immersion.ok,
        immersionIssues: immersion.issues,
        worldSummary: {
          title: draft.title,
          locations: draft.locations.length,
          factions: draft.factions.length,
          npcs: draft.npcs.length,
          information: draft.information.length,
          publicInformation: draft.information.filter((entry) => entry.accessibility === "public").length,
          entryPoints: draft.entryPoints.length,
        },
      });

      if (!coherence.ok || !playability.ok || !immersion.ok) {
        throw new Error(
          [
            !coherence.ok ? `World coherence failed: ${coherence.issues.join("; ")}` : "",
            !playability.ok ? `World playability failed: ${playability.issues.join("; ")}` : "",
            !immersion.ok ? `World immersion failed: ${immersion.issues.join("; ")}` : "",
          ]
            .filter(Boolean)
            .join(" | "),
        );
      }

      notifyProgress({
        stage: "final_world",
        status: "complete",
        message: `${draft.locations.length} places, ${draft.npcs.length} NPCs, and ${draft.entryPoints.length} opening situations are ready.`,
      });

      const artifacts: OpenWorldGenerationArtifacts = {
        prompt: input.prompt,
        model: env.openRouterModel,
        createdAt: new Date().toISOString(),
        worldBible,
        worldSpine,
        regionalLife,
        socialLayer,
        knowledgeEconomy,
        entryContexts,
        attempts,
        validationReports,
        idMaps,
        stageSummaries,
      };

      return {
        draft,
        artifacts,
      };
    } catch (error) {
      logOpenRouterResponse("world.error", {
        message: error instanceof Error ? error.message : String(error),
      });
      throw new Error(error instanceof Error ? error.message : "World generation failed.");
    } finally {
      stopWorldGenerationLog();
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
          "Open on immediate pressure, sensory detail, and a situation a normal person can act on right now.",
          "Avoid prophecy, trailer voiceover, destiny framing, and broad setting-summary prose.",
          "Scene summary must be 40 words or fewer.",
          "Return narration, an active threat, a scene summary, and exact ids for the starting location, present NPCs, and cited information via the provided tool schema.",
        ].join("\n"),
        user: [
          formatPromptBlock("module_summary", summarizeWorld(input.module)),
          formatPromptBlock(
            "generation_artifacts",
            input.artifacts
                ? {
                  worldBible: {
                    worldOverview: input.artifacts.worldBible.worldOverview,
                    immersionAnchors: input.artifacts.worldBible.immersionAnchors,
                    competingExplanations: input.artifacts.worldBible.explanationThreads,
                  },
                  regionalLife: input.artifacts.regionalLife.locations.filter(
                    (entry) => entry.locationId === input.entryPoint.startLocationId,
                  ),
                  entryContext: input.artifacts.entryContexts.entryPoints.find(
                    (entry) => entry.id === input.entryPoint.id,
                  ),
                }
              : null,
          ),
          formatPromptBlock("entry_point", input.entryPoint),
          formatPromptBlock("start_location", location),
          formatPromptBlock("present_npcs", presentNpcs),
          formatPromptBlock(
            "seeded_information",
            seededInformation.map((entry) => ({
              id: entry.id,
              title: entry.title,
              summary: entry.summary,
            })),
          ),
          formatPromptBlock("character", {
            name: input.character.name,
            archetype: input.character.archetype,
            backstory: input.character.backstory,
          }),
          formatPromptBlock("prompt", input.prompt ?? null),
          formatPromptBlock("previous_draft", input.previousDraft ?? null),
        ].join("\n\n"),
        tools: [openingTool],
      });

      logOpenRouterResponse("opening.raw_input", {
        preview: toPreview(response?.input),
      });

      const parsed = generatedCampaignOpeningSchema.safeParse(response?.input);
      if (!parsed.success) {
        logOpenRouterResponse("opening.schema_failure", {
          issues: parsed.error.issues,
          inputPreview: toPreview(response?.input),
        });
        throw new Error(`Opening generation returned invalid structured data: ${parsed.error.message}`);
      }

      logOpenRouterResponse("opening.success", {
        preview: toPreview(parsed.data),
      });

      return parsed.data;
    } catch (error) {
      logOpenRouterResponse("opening.error", {
        message: error instanceof Error ? error.message : String(error),
      });
      throw new Error(error instanceof Error ? error.message : "Opening generation failed.");
    }
  }

  async runTurn(input: TurnInput): Promise<TurnActionToolCall> {
    try {
      const baseSystem = [
        "You are the player's senses and action router in a simulated world.",
        "Use exactly one tool and return only the tool call.",
        "Do not invent named mechanical entities outside the provided context.",
        "Keep payloads compact: narration should be 1-3 sentences, topic/method/actionDescription should be short phrases, memorySummary should be one short sentence, and suggestedActions should contain at most 3 short actions.",
        "Every executable tool call must include timeMode, timeElapsed, narration, suggestedActions, and citedEntities.",
        "If the player talks to an unnamed local person or bystander implied by the scene, use execute_converse with a short generic interlocutor label such as 'nearest harvester' and leave npcId empty.",
        "Do not redirect an unnamed bystander interaction to a named NPC unless the player's action clearly points to that NPC.",
        "Tool routing hierarchy:",
        "1. Use execute_travel when the player clearly moves to a known adjacent node or route.",
        "2. Use execute_converse when the player addresses, questions, bargains with, or negotiates with a named NPC or an unnamed local speaker.",
        "3. Use execute_investigate when the player searches, examines closely, tracks evidence, or tries to uncover hidden information.",
        "4. Use execute_observe when the player is mainly looking, listening, waiting, or taking in the current scene.",
        "5. Use execute_freeform for a concrete action that does not fit the other tools but can still be resolved safely.",
        "6. Use request_clarification only if the action is too ambiguous, impossible to map, or missing a required target.",
      ].join("\n");
      const user = [
        formatPromptBlock("action", input.playerAction),
        formatPromptBlock("context", input.promptContext),
        formatPromptBlock("character", {
          name: input.character.name,
          archetype: input.character.archetype,
          stats: input.character.stats,
        }),
      ].join("\n\n");

      let correctionNotes: string | null = null;

      for (let attempt = 1; attempt <= MAX_TURN_ATTEMPTS; attempt += 1) {
        logOpenRouterResponse("turn.attempt", {
          attempt,
          maxAttempts: MAX_TURN_ATTEMPTS,
          correctionNotes,
        });

        const response = await runCompletion({
          system: correctionNotes ? `${baseSystem}\n${correctionNotes}` : baseSystem,
          user,
          tools: actionTools,
          maxTokens: 1400,
        });

        const toolName = response?.name;
        const inputPayload = response?.input;
        const normalized = normalizeTurnToolCall({
          toolName,
          payload: inputPayload,
          promptContext: input.promptContext,
        });

        logOpenRouterResponse("turn.raw_input", {
          attempt,
          toolName,
          finishReason: response?.finishReason ?? null,
          likelyTruncated: response?.likelyTruncated ?? false,
          inputPreview: toPreview(inputPayload),
        });

        if (normalized) {
          logOpenRouterResponse("turn.success", {
            attempt,
            toolName,
            inputPreview: toPreview(normalized),
          });
          return normalized;
        }

        correctionNotes = [
          "Your previous reply did not produce a complete valid tool payload.",
          response?.likelyTruncated
            ? "The previous payload was cut off. Return a complete replacement payload with much shorter narration."
            : "Return a complete replacement payload that exactly matches one tool schema.",
          "Do not include assistant prose before the tool call.",
          "If using execute_converse for an unnamed local, fill interlocutor with a short generic label and omit npcId.",
        ].join("\n");
      }

      throw new Error("Turn generation did not return a valid tool call after retries.");
    } catch (error) {
      logOpenRouterResponse("turn.error", {
        message: error instanceof Error ? error.message : String(error),
      });
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
export const aiProviderTestUtils = {
  extractToolInput,
  normalizeTurnToolCall,
};
