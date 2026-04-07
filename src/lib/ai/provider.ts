import { appendFileSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import path from "node:path";
import OpenAI from "openai";
import { z } from "zod";
import { env } from "@/lib/env";
import {
  currencyDenominationsSchema,
} from "@/lib/game/currency";
import { characterFrameworkSchema, compileCharacterFramework } from "@/lib/game/character-framework";
import {
  buildCharacterTemplateDraftSchema,
  characterConceptDraftSchema,
  characterTemplateDraftSchema,
} from "@/lib/game/characters";
import { MAX_STARTER_ITEMS, normalizeItemNameList } from "@/lib/game/item-utils";
import { canonicalizeNpcIdAgainstCandidates } from "@/lib/game/npc-identity";
import {
  customResolvedLaunchEntryDraftSchema,
  generatedCampaignOpeningSchema,
  generatedEconomyMaterialLifeInputSchema,
  generatedKnowledgeThreadsInputSchema,
  generatedKnowledgeWebInputSchema,
  promptIntentProfileSchema,
  generatedRegionalLifeSchema,
  generatedSocialLayerInputSchema,
  generatedWorldBibleSchema,
  generatedWorldSpineSchema,
  normalizeCustomResolvedLaunchEntryDraft,
  worldSpineLocationSchema,
} from "@/lib/game/session-zero";
import type {
  CampaignCharacter,
  CheckResult,
  CharacterFramework,
  CharacterTemplate,
  CharacterTemplateDraft,
  CharacterConceptDraft,
  GeneratedDailySchedule,
  GeneratedCampaignOpening,
  CheckpointableWorldGenerationStageName,
  GeneratedEconomyMaterialLifeStage,
  GeneratedKnowledgeThreadsStage,
  GeneratedKnowledgeWebStage,
  GeneratedWorldModuleDraft,
  GeneratedWorldModule,
  ForbiddenDetailMode,
  LocalTextureSummary,
  OpenWorldGenerationCheckpoint,
  OpenWorldGenerationArtifacts,
  PromptIntentProfile,
  PromotedNpcHydrationDraft,
  PromptTextureMode,
  PromptContextProfile,
  ResolvedLaunchEntry,
  ResolveMechanicsResponse,
  RouterAuthorizedVector,
  RouterDecision,
  ScaleProfile,
  SpatialPromptContext,
  TurnActionToolCall,
  TurnFetchToolResult,
  TurnMode,
  TurnModelToolCall,
  TurnRouterContext,
  TurnResolution,
  StateCommitLog,
  WorldGenerationScalePlan,
  WorldScaleTier,
  WorldGenerationStageName,
} from "@/lib/game/types";
import { SOCIAL_OUTCOMES } from "@/lib/game/types";
import {
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
import {
  buildWorldGenerationScalePlan,
  WORLD_BIBLE_SCALE_MINIMUMS,
} from "@/lib/game/world-scale";
import { wait } from "@/lib/utils";

type CampaignOpeningInput = {
  module: GeneratedWorldModule;
  character: CharacterTemplate;
  entryPoint: ResolvedLaunchEntry;
  artifacts?: OpenWorldGenerationArtifacts | null;
  prompt?: string;
  previousDraft?: GeneratedCampaignOpening;
};

type StartingLocalNpcDraft = Omit<GeneratedWorldModule["npcs"][number], "id">;

type CustomEntryResolutionInput = {
  module: GeneratedWorldModule;
  character: CharacterTemplate;
  prompt: string;
  correctionNotes?: string | null;
  interpretedIntent?: {
    activityFrame: "routine_work" | "private_project" | "travel_prep" | "urgent_hook" | "unclear";
    socialAnchorPreference: "solitary" | "ambient_locals" | "named_contact" | "unclear";
    informationLeadPreference: "none" | "ambient_public" | "named_hook" | "unclear";
    notes: string;
  } | null;
};

type ObjectiveLaunchEntryResolutionInput = {
  module: GeneratedWorldModule;
  character: CharacterTemplate;
  prompt?: string;
  correctionNotes?: string | null;
};

type StartingLocalHydrationInput = {
  module: GeneratedWorldModule;
  character: CharacterTemplate;
  entryPoint: ResolvedLaunchEntry;
  opening: GeneratedCampaignOpening;
  nearbyLocationIds: string[];
};

type PromotedNpcHydrationInput = {
  npc: {
    id: string;
    name: string;
    role: string;
    summary: string;
    description: string;
  };
  location: {
    id: string;
    name: string;
    type: string;
    summary: string;
    state: string;
    localTexture: LocalTextureSummary | null;
  };
  localFactions: Array<{
    id: string;
    name: string;
    type: string;
    summary: string;
    agenda: string;
  }>;
  localNpcs: Array<{
    id: string;
    name: string;
    role: string;
    factionId: string | null;
  }>;
  localInformation: Array<{
    id: string;
    title: string;
    summary: string;
    truthfulness: string;
    accessibility: string;
    factionId: string | null;
  }>;
  nearbyRoutes: Array<{
    id: string;
    targetLocationName: string;
    travelTimeMinutes: number;
    currentStatus: string;
  }>;
  temporaryActor: {
    label: string;
    interactionCount: number;
    recentTopics: string[];
    lastSummary: string | null;
  };
  allowRenameFromGenericRoleLabel?: boolean;
};

type TurnInput = {
  promptContext: SpatialPromptContext;
  routerDecision: RouterDecision;
  character: CampaignCharacter;
  playerAction: string;
  turnMode: TurnMode;
  fetchedFacts: TurnFetchToolResult[];
  signal?: AbortSignal;
};

type ResolvedTurnNarrationInput = {
  playerAction: string;
  promptContext: SpatialPromptContext;
  fetchedFacts: TurnFetchToolResult[];
  stateCommitLog: StateCommitLog;
  narrationBounds?: {
    committedAdvanceMinutes: number;
    isFastForward?: boolean;
    interruptionReason?: string | null;
  } | null;
  checkResult?: CheckResult | null;
  suggestedActions: string[];
  narrationHint?: {
    unresolvedTargetPhrases?: string[];
  } | null;
  signal?: AbortSignal;
};

type ResolvedTurnSuggestedActionsInput = {
  playerAction: string;
  promptContext: SpatialPromptContext;
  fetchedFacts: TurnFetchToolResult[];
  stateCommitLog: StateCommitLog;
  checkResult?: CheckResult | null;
  candidateSuggestedActions: string[];
  signal?: AbortSignal;
};

type DailyWorldScheduleInput = {
  campaign: {
    id: string;
    title: string;
    premise: string;
    tone: string;
    setting: string;
    currentLocationId: string;
    dayStartTime: number;
    locations: Array<{
      id: string;
      name: string;
      type: string;
      state: string;
      controllingFactionId: string | null;
    }>;
    factions: Array<{
      id: string;
      name: string;
      type: string;
      agenda: string;
      pressureClock: number;
      resources: unknown;
    }>;
    npcs: Array<{
      id: string;
      name: string;
      role: string;
      factionId: string | null;
      currentLocationId: string | null;
      state: string;
      threatLevel: number;
    }>;
    discoveredInformation: Array<{
      id: string;
      title: string;
      summary: string;
      truthfulness: string;
      locationId: string | null;
      factionId: string | null;
    }>;
  };
};

type TurnIntentClassificationInput = {
  playerAction: string;
  turnMode: TurnMode;
  context: TurnRouterContext;
  signal?: AbortSignal;
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
const NARRATION_LOG_FILE = path.join(WORLD_GEN_LOG_DIR, "narration.log");

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

function appendNarrationLog(message: string) {
  try {
    mkdirSync(WORLD_GEN_LOG_DIR, { recursive: true });
    appendFileSync(NARRATION_LOG_FILE, `${message}\n`, "utf8");
  } catch {
    // Ignore log write failures so narration can continue.
  }
}

export function logBackendDiagnostic(stage: string, details: Record<string, unknown>) {
  const timestamp = new Date().toISOString();
  const message = [
    `[backend.debug] ${timestamp}`,
    `stage=${stage}`,
    JSON.stringify(details, null, 2),
    "--- end ---",
  ].join("\n");

  appendNarrationLog(message);
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
  appendNarrationLog(message);
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
  appendNarrationLog(message);
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
  appendNarrationLog(message);
}

function logNarrationDebug(stage: string, details: Record<string, unknown>) {
  const timestamp = new Date().toISOString();
  const message = [
    `[narration.debug] ${timestamp}`,
    `stage=${stage}`,
    JSON.stringify(details, null, 2),
    "--- end ---",
  ].join("\n");

  appendNarrationLog(message);
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
  correctionNotes?: string[];
};

const DEFAULT_MAX_WORLD_STAGE_ATTEMPTS = 3;
const WORLD_STAGE_MAX_ATTEMPTS: Partial<Record<WorldGenerationStageName, number>> = {
  world_bible: 5,
  world_spine: 5,
};
const MAX_TURN_ATTEMPTS = 3;
const MAX_ROUTER_ATTEMPTS = 2;
const WORLD_SPINE_LOCATION_BATCH_SIZE = 3;
const WORLD_BIBLE_MIN_EXPLANATION_THREADS = 0;
const WORLD_SPINE_LOCATION_CHOICES = [9, 12, 15, 18] as const;
const WORLD_SPINE_LOCATION_CHOICES_TEXT = WORLD_SPINE_LOCATION_CHOICES.join(", ");
const WORLD_SPINE_MAX_RELATIONS = 28;
const WORLD_GEN_MAX_INFORMATION_NODES = 22;
const WORLD_GEN_MAX_INFORMATION_LINKS = 28;
const WORLD_GEN_TARGET_COMMODITIES = 8;
const WORLD_GEN_MAX_MARKET_PRICES = 10;
const CURRENT_PROMPT_ARCHITECTURE_VERSION = 3;
const DEFAULT_PROMPT_INTENT_PROFILE: PromptIntentProfile = {
  primaryTextureModes: ["institutional"],
  primaryCausalLogic: "mixed",
  magicIntegration: "subdued",
  socialEmphasis: "mixed",
  confidence: "low",
};

function getMaxWorldStageAttempts(stage: WorldGenerationStageName) {
  return WORLD_STAGE_MAX_ATTEMPTS[stage] ?? DEFAULT_MAX_WORLD_STAGE_ATTEMPTS;
}

const WORLD_GENERATION_STAGE_ORDER: CheckpointableWorldGenerationStageName[] = [
  "prompt_intent",
  "world_bible",
  "world_spine",
  "regional_life",
  "social_cast",
  "knowledge_web",
  "knowledge_threads",
  "economy_material_life",
  "final_world",
];

const WORLD_GENERATION_STAGE_DIRECT_DEPENDENTS: Record<
  CheckpointableWorldGenerationStageName,
  CheckpointableWorldGenerationStageName[]
> = {
  prompt_intent: [
    "world_bible",
    "world_spine",
    "regional_life",
    "social_cast",
    "knowledge_web",
    "knowledge_threads",
    "economy_material_life",
    "final_world",
  ],
  world_bible: [
    "world_spine",
  ],
  world_spine: [
    "regional_life",
    "social_cast",
    "knowledge_web",
    "knowledge_threads",
    "economy_material_life",
    "final_world",
  ],
  regional_life: ["social_cast", "knowledge_web", "economy_material_life", "final_world"],
  social_cast: ["knowledge_web", "economy_material_life", "final_world"],
  knowledge_web: ["knowledge_threads", "final_world"],
  knowledge_threads: ["final_world"],
  economy_material_life: ["final_world"],
  final_world: [],
};

function getWorldGenerationDependentStages(stage: CheckpointableWorldGenerationStageName) {
  const visited = new Set<CheckpointableWorldGenerationStageName>();
  const stack = [...WORLD_GENERATION_STAGE_DIRECT_DEPENDENTS[stage]];

  while (stack.length > 0) {
    const nextStage = stack.pop();
    if (!nextStage || visited.has(nextStage)) {
      continue;
    }

    visited.add(nextStage);
    stack.push(...WORLD_GENERATION_STAGE_DIRECT_DEPENDENTS[nextStage]);
  }

  return [...visited];
}

function createEmptyWorldGenerationIdMaps(): OpenWorldGenerationArtifacts["idMaps"] {
  return {
    factions: {},
    locations: {},
    edges: {},
    factionRelations: {},
    npcs: {},
    information: {},
    commodities: {},
  };
}

function createFreshWorldGenerationCheckpoint(input: {
  prompt: string;
  scaleTier: WorldScaleTier;
  model: string;
}): OpenWorldGenerationCheckpoint {
  return {
    prompt: input.prompt,
    model: input.model,
    createdAt: new Date().toISOString(),
    scaleTier: input.scaleTier,
    scalePlan: buildWorldGenerationScalePlan(input.scaleTier),
    promptArchitectureVersion: CURRENT_PROMPT_ARCHITECTURE_VERSION,
    generationStatus: "running",
    failedStage: null,
    completedStages: [],
    lastGenerationError: null,
    stageArtifacts: {},
    attempts: [],
    validationReports: [],
    idMaps: createEmptyWorldGenerationIdMaps(),
    stageSummaries: {},
  };
}

function invalidateWorldGenerationCheckpointFromStage(
  checkpoint: OpenWorldGenerationCheckpoint,
  stage: CheckpointableWorldGenerationStageName,
) {
  const invalidatedStages = new Set<CheckpointableWorldGenerationStageName>([
    stage,
    ...getWorldGenerationDependentStages(stage),
  ]);

  for (const dependentStage of invalidatedStages) {
    delete checkpoint.stageArtifacts[dependentStage];
    delete checkpoint.stageSummaries[dependentStage];
  }

  checkpoint.attempts = checkpoint.attempts.filter(
    (attempt) =>
      !(invalidatedStages.has(attempt.stage as CheckpointableWorldGenerationStageName)),
  );
  checkpoint.validationReports = checkpoint.validationReports.filter(
    (report) =>
      !(invalidatedStages.has(report.stage as CheckpointableWorldGenerationStageName)),
  );
  checkpoint.generationStatus = "running";
  checkpoint.failedStage = null;
  checkpoint.lastGenerationError = null;

  logOpenRouterResponse("world.checkpoint_invalidation", {
    fromStage: stage,
    invalidatedStages: [...invalidatedStages],
  });
}

function normalizeWorldGenerationResumeCheckpoint(input: {
  resumeCheckpoint: OpenWorldGenerationCheckpoint | null | undefined;
  prompt: string;
  scaleTier: WorldScaleTier;
  model: string;
}) {
  if (!input.resumeCheckpoint) {
    logOpenRouterResponse("world.checkpoint_resume", {
      action: "fresh_start",
      reason: "no_resume_checkpoint",
      scaleTier: input.scaleTier,
    });
    return createFreshWorldGenerationCheckpoint(input);
  }

  if (
    input.resumeCheckpoint.prompt !== input.prompt
    || input.resumeCheckpoint.scaleTier !== input.scaleTier
  ) {
    logOpenRouterResponse("world.checkpoint_resume", {
      action: "fresh_start",
      reason: "prompt_or_scale_mismatch",
      priorScaleTier: input.resumeCheckpoint.scaleTier,
      nextScaleTier: input.scaleTier,
    });
    return createFreshWorldGenerationCheckpoint(input);
  }

  const checkpoint = structuredClone(input.resumeCheckpoint);
  checkpoint.scalePlan = buildWorldGenerationScalePlan(checkpoint.scaleTier);
  checkpoint.idMaps = checkpoint.idMaps ?? createEmptyWorldGenerationIdMaps();
  checkpoint.stageSummaries = checkpoint.stageSummaries ?? {};
  checkpoint.attempts = checkpoint.attempts ?? [];
  checkpoint.validationReports = checkpoint.validationReports ?? [];
  checkpoint.stageArtifacts = checkpoint.stageArtifacts ?? {};

  const hasCurrentPromptArchitecture =
    checkpoint.promptArchitectureVersion === CURRENT_PROMPT_ARCHITECTURE_VERSION;
  if (!hasCurrentPromptArchitecture) {
    invalidateWorldGenerationCheckpointFromStage(checkpoint, "prompt_intent");
    checkpoint.promptIntentProfile = undefined;
    checkpoint.promptArchitectureVersion = CURRENT_PROMPT_ARCHITECTURE_VERSION;
    logOpenRouterResponse("world.checkpoint_resume", {
      action: "invalidate_for_prompt_architecture",
      previousPromptArchitectureVersion: input.resumeCheckpoint.promptArchitectureVersion ?? null,
      nextPromptArchitectureVersion: CURRENT_PROMPT_ARCHITECTURE_VERSION,
    });
  }

  let firstMissingStage: CheckpointableWorldGenerationStageName | null = null;
  const continuityInvalidatedStages = new Set<CheckpointableWorldGenerationStageName>();
  for (const stage of WORLD_GENERATION_STAGE_ORDER) {
    const hasArtifact = checkpoint.stageArtifacts[stage] !== undefined;
    if (!hasArtifact && !firstMissingStage) {
      firstMissingStage = stage;
    }
    if (hasArtifact && firstMissingStage) {
      invalidateWorldGenerationCheckpointFromStage(checkpoint, stage);
      continuityInvalidatedStages.add(stage);
    }
  }

  checkpoint.completedStages = WORLD_GENERATION_STAGE_ORDER.filter(
    (stage) => checkpoint.stageArtifacts[stage] !== undefined,
  );
  checkpoint.failedStage =
    checkpoint.generationStatus === "failed" || checkpoint.generationStatus === "stopped"
      ? checkpoint.failedStage ?? firstMissingStage
      : null;

  logOpenRouterResponse("world.checkpoint_resume", {
    action: "resume_normalized",
    generationStatus: checkpoint.generationStatus,
    failedStage: checkpoint.failedStage,
    completedStages: checkpoint.completedStages,
    firstMissingStage,
    continuityInvalidatedStages: [...continuityInvalidatedStages],
    hasPromptIntentProfile: Boolean(checkpoint.promptIntentProfile),
  });
  return checkpoint;
}

type WorldBibleContextScope =
  | "world_spine"
  | "regional_life"
  | "social_cast"
  | "knowledge_web"
  | "knowledge_threads"
  | "economy_material_life";
const REGIONAL_LIFE_BATCH_SIZE = 3;
const SOCIAL_CAST_BATCH_SIZE = 3;

function formatForbiddenDetailMode(mode: ForbiddenDetailMode) {
  switch (mode) {
    case "single_room":
      return "single rooms or interior-only spaces";
    case "single_business":
      return "single businesses, stalls, or routine storefronts";
    case "single_street_address":
      return "single street addresses, alleys, or named corners";
    case "micro_neighborhood":
      return "micro-neighborhood fragments inside a larger place";
    case "full_geographic_enumeration":
      return "full geographic enumeration of every subregion or continent";
    case "cosmological_abstraction":
      return "abstract cosmology disconnected from daily systems";
  }
}

function describeScaleProfile(profile: ScaleProfile, role: string) {
  return {
    role,
    sourceScale: profile.sourceScale,
    targetSemanticScale: profile.targetSemanticScale,
    detailMode: profile.detailMode,
    forbiddenDetailModes: profile.forbiddenDetailModes,
    launchableOutput: profile.launchableOutput,
    expectsChildDescent: profile.expectsChildDescent,
  };
}

function buildScaleProfilePromptLines(profile: ScaleProfile) {
  return [
    `This stage is operating at ${profile.sourceScale} source scale and should produce ${profile.targetSemanticScale} outputs.`,
    `Preferred detail mode: ${profile.detailMode}.`,
    profile.forbiddenDetailModes.length
      ? `Do not drift into ${profile.forbiddenDetailModes.map(formatForbiddenDetailMode).join(", ")}.`
      : null,
  ].filter((line): line is string => Boolean(line));
}

function buildScaleTextureBalanceLines(scaleTier: WorldScaleTier) {
  switch (scaleTier) {
    case "settlement":
      return [
        "Do not define the entire settlement only through coercion, shortage, decay, or surveillance.",
        "Let some texture come from pride, craft, food, ceremony, neighborhood habit, hospitality, beauty, local prestige, or ordinary competence.",
      ];
    case "regional":
      return [
        "Do not define the entire region only through tolls, checkpoints, quotas, shortages, or breakdown.",
        "Across the region, allow some places to matter because they are prosperous, fertile, ceremonially central, socially magnetic, craft-proud, or reliably connective, not only because they are stressed.",
      ];
    case "world":
      return [
        "Do not define the whole world only through civilizational crisis, decay, or coercive infrastructure.",
        "At world scale, let some connective texture come from abundance, prestige, ritual centrality, admired craft, stable exchange, agricultural reliability, or shared public rhythm, not only from hazard and shortage.",
      ];
  }
}

function buildPresentTenseScaleGuideLines() {
  return [
    "Generated output should feel present-tense and ongoing, not frozen into static background description.",
    "Present-tense scale guide:",
    "- settlement: routines, upkeep, habits, local frictions, neighborhood rhythms, and ordinary adaptation.",
    "- regional: circulation, jurisdiction, migration, seasonal dependence, route logic, territorial coordination, and repeated public patterns.",
    "- world: civilizational adaptation, shared systems, ideological drift, macro exchange, ritual calendars, ecological dependence, and public rhythms.",
    "Do not force every place, faction, or NPC to revolve around a ceremony, convoy, inspection, emergency, or discrete event.",
  ];
}

function buildWorldSpineTextureBalanceLines(scaleTier: WorldScaleTier) {
  switch (scaleTier) {
    case "settlement":
      return [
        "Across the full settlement spine, keep a mix of civic, commercial, residential, ceremonial, workmanlike, and pressure-heavy places rather than making every node feel distressed.",
        "Some settlement nodes should matter because they are socially central, prosperous, festive, prestigious, or habitually busy, not only because they are dangerous or collapsing.",
      ];
    case "regional":
      return [
        "Across the full regional spine, keep a mix of stable market towns, fertile or reliable belts, ritual centers, commercially connective corridors, contested borderlands, and genuinely dangerous frontiers.",
        "Some regional nodes should matter because they are prosperous, ceremonially central, craft-famous, agriculturally dependable, or politically prestigious, not only because they are under acute burden.",
      ];
    case "world":
      return [
        "Across the full world spine, keep a mix of stability profiles: some prosperous or orderly core regions, some sacred or ritual-central geographies, some commercially flourishing corridors, some contested borderlands, and some dangerous or collapsing frontiers.",
        "Some world-scale locations should be important because they are prosperous, orderly, fertile, ritually central, commercially dominant, or legally prestigious, even if they still contain tensions.",
        "Distinctiveness at world scale can come from abundance, ritual centrality, legal prestige, agricultural reliability, trade density, or strategic centrality, not only from hazard or collapse.",
      ];
  }
}

function buildRegionalLifeTextureBalanceLines(scaleTier: WorldScaleTier) {
  switch (scaleTier) {
    case "settlement":
      return [
        "Use everydayTexture, gossip, ordinaryKnowledge, and reasonsToLinger to show habits, craft, humor, hospitality, leisure, beauty, or social rhythm alongside pressure.",
        "Not every entry needs a looming shortage, raid, or administrative burden; some should simply show how local life works when people are competent, proud, or enjoying a routine.",
        "Across a batch, vary what daily life is organized around: some places may center exchange, craft, devotion, prestige, service, neighborhood habit, or ordinary sociability rather than every location revolving around inspection, extraction, rationing, checkpointing, or institutional failure.",
      ];
    case "regional":
      return [
        "Use everydayTexture, gossip, ordinaryKnowledge, and reasonsToLinger to show foodways, forest or river custom, seasonal rhythm, local pride, ceremonial life, and craft identity alongside pressure.",
        "Not every entry needs a looming shortage, toll dispute, or failure mode; some should simply show how regional life works when roads hold, fairs gather, crews know their work, or local custom is functioning.",
        "Across a batch, vary what daily life is organized around: some places may center exchange, hospitality, ritual, craft production, teaching, prestige, or seasonal custom rather than every location revolving around enforcement, extraction, or systemic strain.",
      ];
    case "world":
      return [
        "At world scale, use region-level routines, customs, admired practices, seasonal rhythms, and public prestige to keep the lived texture broader than pure crisis reporting.",
        "Not every entry needs a looming shortage or breakdown; some should simply show how world-scale public life works when systems, rituals, or exchange networks are functioning as intended.",
        "Across a batch, vary what public life is organized around: some entries may be most legible through trade, pilgrimage, ceremony, learning, abundance, or prestige rather than every region reading like administration under stress.",
      ];
  }
}

function buildRegionalLifeCritiqueInstructions() {
  return {
    system: [
      "You are a strict structured critique pass for regional-life batches.",
      "Judge batch-level variety in organizing logic and lived texture, not prose flair alone.",
      "Distinct locations can be shaped by trade, craft, hospitality, devotion, prestige, leisure, domestic routine, hazard adaptation, neighborhood custom, public service, learning, or pressure.",
      "Do not penalize danger, ritual, administration, or scarcity when appropriate; only flag them when they monopolize what daily life is for several entries or erase other meaningful reasons people gather, linger, work, trade, celebrate, or take pride there.",
    ],
    finalInstruction: [
      "Return revise only if several entries flatten away from the prompt's intended texture into the same narrow house style.",
      "Flag only clear over-concentration, scale drift, or texture loss, not isolated examples of pressure or ceremony.",
      "Prefer accept when locations differ meaningfully in what organizes daily life, even if several still contain danger, ritual, or institutional pressure.",
      "Flag when multiple entries in the batch all read primarily like inspection points, extraction zones, ration systems, checkpoint corridors, containment sites, or failure-response systems despite different nouns.",
      "Flag when a location's publicActivity, localPressure, everydayTexture, reasonsToLinger, and routineSeeds all orbit the same single burden with little evidence of commerce, craft, sociability, devotion, hospitality, beauty, learning, neighborhood custom, or another distinct social logic.",
      "Correction notes should tell the generator how to diversify organizing logics across the batch without discarding prompt-native pressure.",
    ],
  };
}

function buildRegionalLifeFallbackCorrectionNotes() {
  return [
    "Diversify the organizing logic across the batch instead of rewriting every location around the same kind of inspection, extraction, rationing, checkpoint, containment, or institutional failure pattern.",
    "Keep prompt-native pressure, but let some locations be primarily legible through trade, craft, hospitality, devotion, prestige, leisure, neighborhood routine, beauty, or ordinary service rather than pure crisis administration.",
    "For each flagged location, ask what residents would still notice, do, buy, repair, celebrate, avoid, or take pride in on an ordinary day even if the current pressure eased, then make that part of the entry's core identity.",
    "Use localPressure as one dimension rather than the whole identity; everydayTexture, reasonsToLinger, gossip, and routineSeeds should reveal at least one meaningful non-pressure social rhythm.",
    "Across the batch, vary what organizes life so the locations do not all feel like versions of the same bureaucracy, ritual enforcement loop, hazard-processing site, or resource triage system.",
  ];
}

function buildSocialCastTextureBalanceLines(scaleTier: WorldScaleTier) {
  switch (scaleTier) {
    case "settlement":
      return [
        "Not every NPC should read as a clerk, inspector, or enforcer; include artisans, hosts, ferrymen, shrine workers, teachers, healers, performers, signal keepers, and other public-facing locals when the setting supports them.",
        "Not every NPC's concern needs to be a crisis, debt, or threat; some can be about keeping a routine going, preparing a fair, defending a craft standard, or maintaining hospitality and reputation.",
      ];
    case "regional":
      return [
        "Not every NPC should read as a clerk, inspector, or enforcer; include ferrymen, sawyers, shrine stewards, caravan hands, innkeepers of major staging posts, healers, brokers, signal keepers, ritual workers, and other public-facing regional roles when the setting supports them.",
        "Not every NPC's concern needs to be a crisis, inspection, or bottleneck; some can be about seasonal preparation, public ceremony, route reputation, teaching, hosting, or preserving a local standard of work.",
      ];
    case "world":
      return [
        "Not every NPC should read as a registrar or checkpoint official; include navigators, ritual marshals, market conveners, convoy organizers, heralds, archivists, and other public-facing macro-regional roles when the setting supports them.",
        "Not every NPC's concern needs to be a crisis, quota, or emergency; some can be about keeping large public systems dignified, reliable, ceremonial, or widely trusted.",
      ];
  }
}

function buildKnowledgeTextureBalanceLines(scaleTier: WorldScaleTier) {
  switch (scaleTier) {
    case "settlement":
      return [
        "Not every information node should expose failure, scandal, or threat; some can reveal admired local practice, useful custom, seasonal opportunity, neighborhood reputation, or practical know-how.",
        "Some information should simply teach how the place works, who does reliable work, what custom outsiders misunderstand, or where ordinary people go when they need help.",
      ];
    case "regional":
      return [
        "Not every information node should expose failure, scandal, or threat; some can reveal valued routes, regional custom, food or craft prestige, seasonal opportunity, or admired local competence.",
        "Some information should simply teach how the region works: which crossings are dependable, which fairs matter, which rituals create temporary peace, who keeps good weights, or what work people trust.",
      ];
    case "world":
      return [
        "Not every information node should expose failure, scandal, or collapse; some can reveal prized exchange systems, revered routes, public ritual knowledge, famous craft, or world-spanning habits people rely on.",
        "Some information should simply teach how the wider world works: what institutions are trusted, what routes are dependable, what practices people admire, and what public systems keep life moving.",
      ];
  }
}

function buildEconomyTextureBalanceLines(scaleTier: WorldScaleTier) {
  switch (scaleTier) {
    case "settlement":
      return [
        "Let some commodities and trade identities signal abundance, local pride, everyday comfort, or craft specialization, not only scarcity and illicit pressure.",
      ];
    case "regional":
      return [
        "Let some commodities and trade identities signal staple abundance, valued regional craft, seasonal fairs, or reliable exchange, not only scarcity, monopoly, and contraband.",
      ];
    case "world":
      return [
        "Let some commodities and trade identities signal world-spanning staple reliability, admired craft traditions, festival demand, or prestigious exchange, not only scarcity, monopoly, and illicit trade.",
      ];
  }
}

function buildWorldBibleMotionLines() {
  return [
    "widespreadBurdens, presentScars, and sharedRealities should imply ongoing response or adaptation, not just static conditions.",
    "Good kinds of motion include maintenance cycles, seasonal rhythms, recurring rites, slow administrative churn, migration pressure, reputation effects, and long-running repair, containment, or accommodation.",
    "Do not mistake present-tense for high drama: a calm or prosperous setting can still feel active through upkeep, repetition, competence, and ordinary adjustment.",
  ];
}

function buildWorldSpineLocationSuccessLines(input: {
  scaleTier: WorldScaleTier;
  worldSpineScaleProfile: ScaleProfile;
  worldSpineLocationTarget: number;
}) {
  return [
    ...buildScaleProfilePromptLines(input.worldSpineScaleProfile),
    "Generate locations only for this batch.",
    "Every location should feel present-tense, inhabited, and already in use at its own scale.",
    "Show ongoing use, dependence, adaptation, authority, reputation, labor, ritual, ecology, or circulation as appropriate, not just static description.",
    "Locations must feel distinct because of work, terrain, law, trade, hazard, ritual, custom, prestige, abundance, public life, household pattern, court protocol, magical maintenance, or traversal texture, not vague grandeur.",
    ...buildWorldSpineTextureBalanceLines(input.scaleTier),
    "Not every location needs an active failure mode, looming danger, or collapsing system to be important; some can be legible because they are trusted, prosperous, ceremonially central, well-run, habitually busy, intimate, revered, or simply necessary.",
    "Do not require every location to hinge on a convoy, inspection, emergency, or event-like public disruption.",
    "Use only the provided faction keys when naming a controlling faction.",
    "Each controlled location must visibly express who profits, patronizes, governs, reveres, guards, organizes life there, or depends on it.",
    `This world should finish with ${input.worldSpineLocationTarget} total locations, returned in batches of ${WORLD_SPINE_LOCATION_BATCH_SIZE}.`,
    "Every generated key must be 40 characters or fewer.",
    "Apply the container test before finalizing any location: it must name and describe a map-usable place people can move through, return to, orient by, and organize activity around at the current scale, not just the most famous building, room, business, landmark, institution, or scenic focal point inside it.",
    "If a concept begins with a hall, hostel, council chamber, embassy, market building, temple, pump house, archive, inn, gate, tower, fort, compound, ruin, or other named site, widen the output to the surrounding ward, quarter, district, harbor edge, corridor, frontier, basin, marches, or other larger container that daily life spills across.",
    "Name locations as containers first. Favor names that read like districts, wards, quarters, corridors, harbors, basins, frontiers, belts, marches, precincts, or other place-containers over names that read like a single hall, house, shop, chamber, court, shrine, tower, office, or compound.",
    "Set usageProfile to everyday for routine public/work/travel nodes residents regularly rely on, or special for ceremonial, remote, risky, prestigious, private, or otherwise non-routine destinations.",
    "Use usageProfile as composition guidance, not a quota target.",
    "Preserve the prompt's specific imagery and avoid generic city, ruin, or temple reskins.",
    input.scaleTier === "world"
      ? [
          "At world scale, avoid naming a node after one landmark, one route segment, one shrine, one ruin, one island, or one hazard pocket. Name and describe the larger macro-region, corridor world, sacred geography, maritime sphere, frontier expanse, or polity that contains and lives with that focal point.",
          "At world scale, locations must be macro containers such as regions, civilizations, frontier expanses, oceanic corridors, pilgrimage belts, sacred geographies, maritime worlds, or macro-polities rather than taverns, streets, or single buildings.",
          "Use this container test: every world-scale location must be something large populations can inhabit, cross, administer, tax, defend, ritualize, trade through, or otherwise organize life around at continental scale.",
          "If a concept is mainly a scar, weather system, landmark, chokepoint, hazard, route, shrine, court, or wonder, output the larger marches, basin, coast, corridor world, ritual belt, dominion, or region organized around living with, crossing, exploiting, revering, or adapting to it.",
          "Do not make every world-scale location a crisis zone, extraction frontier, or decaying chokepoint.",
        ].join(" ")
      : input.scaleTier === "regional"
        ? [
            "At regional scale, avoid naming a node after one hall, enclave, market building, ritual site, embassy compound, archive, mine, or fort unless the name clearly refers to the wider territory people cross and depend on.",
            "At regional scale, if a concept starts as one notable site, institution, ceremonial focus, ruin, industrial facility, court, archive, or military installation, widen it into the broader district, belt, corridor, marches, hinterland, or surrounding territory around it.",
            "Do not output a single compound, shrine, grove, yard, camp, court, archive, mint, barracks, or isolated ruin as a top-level regional spine node unless it is clearly framed as the larger surrounding territory people travel through, maintain, contest, inhabit, or govern across.",
          ].join(" ")
        : [
            "At settlement scale, avoid naming a node after one hall, hostel, inn, temple, council chamber, tower, embassy building, pump house, guild office, or market stall unless the name clearly refers to the broader ward, quarter, precinct, plaza network, harbor edge, bridgehead, or civic zone around it.",
            "A valid settlement node should still function as a local map container: a district, ward, quarter, harbor edge, bazaar belt, gate approach, civic precinct, rooftop neighborhood, or other local area people can navigate across rather than just enter.",
          ].join(" "),
    "Keep descriptions concise enough for structured output, but leave room for a distinctive sensory, social, ritual, ecological, or systemic detail when it makes the location more memorable.",
  ];
}

function buildWorldBibleCritiqueInstructions() {
  return {
    system: [
      "You are a strict structured critique pass for generated world-bible payloads.",
      "Judge whether the payload preserves the prompt's intended texture and scale without collapsing into generic sourcebook language or house style.",
      "Look for abstraction, generic titles, inertness, scale drift, repetition, and flattening away from the prompt's causal logic and social texture.",
      "Flag when burdens, scars, or shared realities feel frozen in description instead of showing ongoing maintenance, adaptation, seasonal rhythm, recurring practice, containment, migration, reputation, or other present-tense response.",
      "Do not punish calm, quiet, stable, prosperous, or low-drama worlds merely for lacking an emergency.",
      "If the payload is already specific and grounded, return accept with empty arrays.",
    ],
    finalInstruction: [
      "Extract abstract terms from widespreadBurdens or presentScars when they read like analytic labels rather than lived conditions.",
      "Extract generic capitalized titles from presentScars or everydayLife.institutions when they read like placeholder powers rather than specific local institutions.",
      "If scale_tier is world, flag street-level or tavern-level detail in groundLevelReality, widespreadBurdens, presentScars, or sharedRealities as local-detail bleed.",
      "Flag any widespreadBurdens or presentScars that read like a waiting-for-a-hero plot hook instead of a living systemic reality.",
      "Flag when several world-bible fields feel inert or purely static overall, but do not require overt drama, emergencies, or scripted events to count as active.",
      "Flag explanationThreads only when they feel slot-filled or mechanically templated instead of arising from the world's own tensions, or when they seem invented solely to satisfy the schema.",
      "Return revise only for clear material problems that make the payload noticeably narrow, inert, or generic overall, not for one otherwise isolated weak spot.",
      "A single weak explanationThreads entry should not by itself force revise if the rest of the payload is strong.",
      "Include targeted correctionNotes when you return revise.",
    ],
  };
}

function buildWorldSpineScaleCritiqueInstructions(scaleTier: WorldScaleTier) {
  const sharedFinal = [
    "Do not penalize a location merely for being stable, prosperous, ceremonially important, fertile, quiet, or socially central rather than crisis-driven.",
    "Flag postcard-like locations that feel inert, scenic, or static overall instead of inhabited, used, or organized around an ongoing public reality at the stated scale.",
    "Do not require event hooks, emergencies, or dramatic situations to make a location count as active.",
    "Flag locations whose main identity is still a timed event, recurring queue, rotating market, single ceremony, one-off incident aftermath, or one special venue rather than the broader place organized around it.",
  ];

  switch (scaleTier) {
    case "settlement":
      return {
        system: [
          "You are a strict structured critique pass for settlement-scale world spine locations.",
          "Judge semantic scale and lived present-tense inhabitation, not prose flair.",
          "A valid settlement-scale spine location should read like a district, ward, quarter, harbor, civic hub, chokepoint, or other major urban/local sub-place people navigate between.",
          "Reject locations whose name or framing still centers a single building, hall, hostel, temple, chamber, tower, compound, or standalone establishment instead of the broader local container around it.",
          "Flag locations that read like a single room, single business, private interior, stall, counter, scene prop, or scenic postcard with no ongoing public use or local adaptation.",
          "Flag locations whose primary shape is still a queue, market-night, auction ground, ritual time window, sanctuary compound, single-community enclave, single-function corridor, or single-incident site rather than a mixed or clearly navigable local container.",
          "Do not invent new locations. Evaluate only the provided ones.",
        ],
        finalInstruction: [
          "Return accept if every location reads like a valid district, ward, civic hub, chokepoint, or other settlement-scale navigable place.",
          "Return revise if any location reads like a room, business, stall, private interior, scenic vignette, or tiny scene fragment rather than a map-usable local place.",
          ...sharedFinal,
          "For each flagged location, explain the scale or inertness problem concretely.",
          "Correction notes should tell the generator how to widen, animate, or right-size the location without discarding its core concept.",
        ],
      };
    case "regional":
      return {
        system: [
          "You are a strict structured critique pass for regional-scale world spine locations.",
          "Judge semantic scale and lived present-tense inhabitation, not prose flair.",
          "A valid regional-scale spine location should read like a city, frontier, pass, basin, coast, corridor, marches, stronghold-territory, or other territorial place people travel between across a region.",
          "Reject locations whose name or framing still centers a single building, enclave, embassy, market hall, archive, ritual site, industrial facility, or isolated compound instead of the wider territorial container around it.",
          "If a concept begins as one notable site, institution, ruin, ceremonial focus, industrial facility, or military installation, it is valid only when widened into the broader district, belt, corridor, marches, hinterland, or surrounding territory organized around that site.",
          "Flag locations that read like a single room, single business, tiny neighborhood fragment, isolated compound, scenic postcard, or conversely like a whole world, total cosmology, or full civilizational sphere.",
          "Flag locations whose primary shape is still a timed event zone, single ceremonial venue, isolated research camp, one special enclave, or one-incident scar rather than a territorial container people repeatedly cross, inhabit, maintain, or contest.",
          "Do not invent new locations. Evaluate only the provided ones.",
        ],
        finalInstruction: [
          "Return accept if every location reads like a valid city, frontier, route zone, pass, basin, coast, corridor, or regional territory.",
          "Return revise if any location still reads like a room, business, street fragment, isolated compound, scenic backdrop, or one notable site rather than a regional map container people travel through, inhabit, depend on, or govern across.",
          ...sharedFinal,
          "For each flagged location, explain the scale or inertness problem concretely.",
          "Correction notes should tell the generator how to widen or narrow the location into a proper regional container without discarding its core concept.",
        ],
      };
    case "world":
      return {
        system: [
          "You are a strict structured critique pass for world-scale world spine locations.",
          "Judge semantic scale and lived present-tense inhabitation, not prose flair.",
          "A valid world-scale spine location should read like a macro container: a region, civilization, frontier, dominion, archipelago, corridor world, basin-region, marches, sacred geography, pilgrimage belt, maritime world, or macro-polity.",
          "Reject locations whose name or framing still centers a single landmark, route segment, wonder, crater, shrine, ruin, island, or hazard pocket instead of the wider macro container around it.",
          "Flag locations that read like a single site, encounter area, scenic sub-zone, one-off hazard pocket, postcard wonder, or adventure destination rather than a macro container people can inhabit, cross, trade through, ritualize, or organize life around.",
          "Flag locations whose primary shape is still a timed pilgrimage stop, single ceremonial venue, one ruin complex, or one special enclave rather than the larger macro geography organized around it.",
          "Do not invent new locations. Evaluate only the provided ones.",
        ],
        finalInstruction: [
          "Return accept if every location reads like a valid world-scale macro container such as a region, civilization, frontier, corridor world, pilgrimage belt, sacred geography, maritime world, or macro-polity.",
          "Return revise if any location still reads like only a local site, scenic hazard pocket, named route, crater rim, single grove, single ruin, postcard wonder, or encounter area rather than a map-scale container people organize life around.",
          ...sharedFinal,
          "For each flagged location, explain the scale or inertness problem concretely.",
          "Correction notes should tell the generator how to widen the flagged location into a macro container without discarding its core concept.",
        ],
      };
  }
}

function buildSocialCastScaleCritiqueInstructions(scaleTier: WorldScaleTier) {
  const sharedFinal = [
    "Return revise as well if the batch becomes monotonous because too many NPCs repeat the same clerk, registrar, inspector, or checkpoint-official shape when the setting should support more varied public-facing work.",
    "Return revise if an NPC reads like only a job shell with no private stake, bias, loyalty, resentment, embarrassment, backlog, reputational risk, or other personal pressure inside their public role.",
    "Do not require secrets, schemes, or quest hooks; a quiet private stake is enough.",
  ];

  switch (scaleTier) {
    case "settlement":
      return {
        system: [
          "You are a strict structured critique pass for settlement-scale social cast batches.",
          "Judge semantic anchoring, social embedding, and private stakes, not prose flair.",
          "At settlement scale, NPCs should be anchored to public-facing local systems such as ward offices, gatehouses, shrine queues, workshops, household audiences, market fronts, rehearsal circles, harbor crossings, granary lines, or repair crews.",
          "Do not penalize an NPC merely for being anchored through hospitality, craft, ceremony, ferrying, healing, or teaching rather than coercive administration.",
          "Flag NPCs that drift into purely private rooms, decorative scene furniture, implausibly world-spanning public roles, or pure job-function shells.",
          "Do not invent new NPCs. Evaluate only the provided ones.",
        ],
        finalInstruction: [
          "Return accept if every NPC remains plausibly anchored to a settlement-scale public system and feels like a person already living inside it.",
          "Return revise if any NPC description, current concern, or public contact surface implies only a private room, decorative prop, or scale-mismatched grand institution instead of a usable local public interface.",
          ...sharedFinal,
          "For each flagged NPC, explain the drift concretely.",
          "Correction notes should tell the generator how to keep the same NPC role while anchoring it to the right local public system and giving it a human private stake.",
        ],
      };
    case "regional":
      return {
        system: [
          "You are a strict structured critique pass for regional-scale social cast batches.",
          "Judge semantic anchoring, social embedding, and private stakes, not prose flair.",
          "At regional scale, NPCs should be anchored to territorial public systems such as caravan depots, relay stations, ferry offices, border rituals, convoy routes, court circuits, shrine networks, or route-maintenance bodies.",
          "Do not penalize an NPC merely for being anchored through hospitality, craft, ceremony, transport, brokerage, or public ritual rather than coercive administration.",
          "Flag NPCs that drift into tiny local-address detail, whole-world authority unrelated to the provided regional locations, or pure job-function shells.",
          "Do not invent new NPCs. Evaluate only the provided ones.",
        ],
        finalInstruction: [
          "Return accept if every NPC remains plausibly anchored to a regional public system or territorial route network and feels like a person already living inside it.",
          "Return revise if any NPC description, current concern, or public contact surface implies only a tiny local address or an implausibly whole-world institution instead of a regional public interface.",
          ...sharedFinal,
          "For each flagged NPC, explain the drift concretely.",
          "Correction notes should tell the generator how to keep the same NPC role while anchoring it to the right regional public system and giving it a human private stake.",
        ],
      };
    case "world":
      return {
        system: [
          "You are a strict structured critique pass for world-scale social cast batches.",
          "Judge semantic anchoring, social embedding, and private stakes, not prose flair.",
          "At world scale, NPCs should be anchored to macro regions or civilizations and should meet the public through macro-regional offices, courts, registries, shrines, ports, convoy systems, audiences, salons, message circuits, or trade interfaces.",
          "Do not penalize an NPC merely for being anchored through ceremony, convoy organization, navigation, heraldry, archiving, or exchange rather than coercive administration.",
          "Flag NPCs that drift into taverns, rooms, alleys, stalls, shops, other unmapped local-address detail, or pure job-function shells.",
          "Do not invent new NPCs. Evaluate only the provided ones.",
        ],
        finalInstruction: [
          "Return accept if every NPC remains plausibly anchored at world scale and feels like a person already living inside that public system.",
          "Return revise if any NPC description, current concern, or public contact surface implies a local address, small business, room, alley, or other micro-geography instead of a macro-regional public system.",
          ...sharedFinal,
          "For each flagged NPC, explain the drift concretely.",
          "Correction notes should tell the generator how to keep the same NPC role while widening the public interface to a region-scale institution or system and giving it a human private stake.",
        ],
      };
  }
}

function buildKnowledgeWebCritiqueInstructions() {
  return {
    system: [
      "You are a strict structured critique pass for knowledge-web batches.",
      "Judge whether the information layer preserves varied lived texture instead of turning every node into inert encyclopedia text, scandal, failure, administrative friction, or threat.",
      "Good knowledge should feel like an entry point into something already happening: a routine, service pattern, labor rhythm, ritual threshold, repeated gathering, workaround, common misunderstanding, or social chokepoint already in use.",
      "Actionable knowledge can be observational, participatory, or socially useful; it does not need to be alarming, transactional, or crisis-driven to count.",
    ],
    finalInstruction: [
      "Return revise only for clear flattening away from the prompt's intended texture into the same failure, scandal, administrative, inert-fact, or crisis pattern.",
      "Do not penalize actionable leads; penalize sameness, excessive threat stacking, encyclopedia-like static fact dumps, or missing prompt-native knowledge texture.",
      "Flag batches where discoverHow collapses too narrowly into procedural instruction sheets instead of allowing observation, attendance, participation, service, etiquette, timing, performance, shared routine, or other prompt-native access paths.",
      "Do not require high drama or imminent danger for knowledge to count as active.",
    ],
  };
}

function buildWorldSpineBatchFinalInstructionLines(input: {
  scaleTier: WorldScaleTier;
  batchIndex: number;
  batchCount: number;
}) {
  return [
    `Generate exactly ${WORLD_SPINE_LOCATION_BATCH_SIZE} new locations for batch ${input.batchIndex + 1} of ${input.batchCount}.`,
    "Use only known faction keys in controllingFactionKey.",
    "Do not repeat or rename any existing location shown above.",
    "Keep a legible mix of everyday and special locations across the full spine, but do not force a quota.",
    input.scaleTier === "world"
      ? "Generate major world locations, not individual businesses, ordinary rooms, or routine storefronts."
      : input.scaleTier === "regional"
        ? "Generate major regional locations, not individual businesses, ordinary rooms, or routine storefronts."
        : "Generate major local locations, not individual businesses, ordinary rooms, or routine storefronts.",
    "If recent batches skew too routine, use this batch to introduce ceremonial, prestigious, hidden, remote, risky, ecologically strange, or otherwise non-routine locations people approach for a specific reason, but keep them as valid current-scale containers rather than event slots, queue-scenes, rotating markets, single landmarks, compounds, sanctuaries, or one-incident aftermaths.",
    "If a location is special because of an auction, queue, bell, ritual, archive, ruin, sanctuary, or market-night, name the broader ward, quarter, corridor, harbor edge, district, territory, or macro-region organized around that recurring activity rather than the timed activity or landmark by itself.",
    "If recent batches skew too exceptional, use this batch to restore some routine public, work, travel, or socially central anchors.",
  ];
}

function buildStageTruncationRecoveryIssues(stage: WorldGenerationStageName) {
  return [
    "Your previous response was cut off before the structured payload finished.",
    "Return a complete replacement payload.",
    "Use shorter descriptions so the full JSON fits in one response.",
    "If the stage uses keys, keep every key under 40 characters.",
    ...(stage === "world_bible"
      ? [
          "For world_bible, meet the schema minimums, keep fields concise and specific, and stay within the stated output budget.",
          "Do not satisfy missing counts by enumerating all subregions, continents, or map geography.",
        ]
      : []),
    ...(stage === "knowledge_web"
      ? [
          "For knowledge_web, return the minimum viable payload: keep meaningful knowledge presence for every location, stay compact, and avoid unnecessary extra nodes.",
          "Keep title, summary, content, actionLead, and discoverHow to very short phrases.",
          "Keep information links sparse.",
        ]
      : []),
  ];
}

function worldBibleScaleInstructions(scaleTier: WorldScaleTier) {
  switch (scaleTier) {
    case "settlement":
      return [
        "This is settlement scale. Focus on local systems, routines, civic friction, neighborhood custom, and immediately legible street-level reality.",
        "groundLevelReality must describe objective street, district, or neighborhood truth, not a traveler arriving from outside.",
        "widespreadBurdens should stay local to the settlement's lived systems, relationships, rituals, institutions, or environments rather than broad civilizational claims, and should imply how people keep working around them now.",
        "presentScars should show visible old damage through ongoing repair, containment, accommodation, reputation effects, or altered local habit rather than frozen backstory.",
        "sharedRealities should be recurring local habits, signs, rites, atmospheres, currencies, symbols, interfaces, or neighborhood-level routines that residents actively keep up or adapt to.",
      ];
    case "regional":
      return [
        "This is regional scale. Focus on repeated public systems, territorial custom, exchange patterns, ritual geographies, weather exposure, and shared realities across towns, courts, frontier hubs, or ceremonial belts.",
        "groundLevelReality must describe territory-level truth through routes, institutions, practices, ecologies, rituals, customs, or exchange patterns residents actually live under.",
        "widespreadBurdens should describe pressures people feel across multiple settlements or routes in the region, along with the circulation, migration, timing, or administrative adaptation they provoke.",
        "presentScars should show old ruptures through long-running repair, containment, accommodation, migration pressure, territorial memory, or changed route logic rather than inert history.",
        "sharedRealities should capture systems and habits repeated across the region rather than only one city block, especially seasonal dependence, route custom, public timing, and repeated coordination patterns.",
      ];
    case "world":
      return [
        "This is world scale. Do not list every continent or subregion. Define the civilizational connective tissue that multiple cultures live under.",
        "groundLevelReality must describe objective civilizational truth through shared systems, infrastructures, rituals, routes, cosmologies, customs, environments, or public realities, not outsider narration.",
        "widespreadBurdens should be systemic frictions that manifest differently across cultures while sharing the same root condition when burdens are appropriate to the prompt, and should imply civilizational adaptation rather than static suffering.",
        "presentScars should show old ruptures through long-running repair, containment, accommodation, institutional drift, migration pressure, or reputation effects that still shape public life now.",
        "sharedRealities should be connective constants shared across major civilizations, ports, faiths, courts, corridors, rituals, currencies, environments, or public systems, with evidence that people actively maintain, inherit, or adapt them in the present.",
      ];
  }
}

function buildScaleAwareWorldBibleBudget(
  scaleTier: WorldScaleTier,
  minimumExplanationThreads: number,
) {
  const base = buildWorldBibleOutputBudget(scaleTier, minimumExplanationThreads);
  return {
    ...base,
    scaleTier,
    expectedMinimums: WORLD_BIBLE_SCALE_MINIMUMS[scaleTier],
  };
}

const WORLD_SCALE_MICRO_DETAIL_TERMS = [
  "tavern",
  "inn",
  "alley",
  "street",
  "stall",
  "shop",
  "room",
  "bakery",
  "warehouse",
  "counter",
  "desk",
  "apartment",
  "suite",
] as const;

function hasWorldScaleMicroDetail(text: string) {
  const tokens = new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean),
  );
  return WORLD_SCALE_MICRO_DETAIL_TERMS.some((term) => tokens.has(term));
}

function buildWorldScaleWorldSpineCorrectionNotes(
  flaggedLocations: z.infer<typeof worldSpineLocationSchema>[],
) {
  const flaggedNames = flaggedLocations.map((location) => location.name);
  const quotedNames = flaggedNames.map((name) => `"${name}"`).join(", ");

  return [
    "At world scale, world_spine locations must be macro containers such as regions, civilizations, frontiers, maritime worlds, pilgrimage belts, trade corridors, sacred geographies, oceanic corridors, or macro-polities rather than taverns, streets, shops, or single buildings.",
    flaggedNames.length > 0
      ? `Revise these locations so they become macro containers instead of local special sites: ${quotedNames}.`
      : "Revise any flagged locations so they become macro containers instead of local special sites.",
    "Use this container test: a valid world-scale location must be something large populations can inhabit, cross, administer, tax, defend, ritualize, trade through, or otherwise organize life around at continental scale.",
    "Keep the core idea, but widen the scale: turn a singular shrine, blight zone, fortress, tavern, ruin, or named route into a larger frontier, basin-region, dominion, coast, marches, archipelago, corridor world, pilgrimage belt, or sacred geography that contains many local sites within it.",
    "If the concept is primarily a phenomenon, hazard, scar, landmark, or route, rewrite it as the broader region, borderlands, marches, coast, basin, corridor, or ritual belt organized around living with, crossing, exploiting, or revering that condition.",
    "Name and summarize each location like a map label, macro system, or civilization-scale geography, not like an encounter area or one-off adventure site.",
    "Descriptions should emphasize span, movement, trade, populations, border pressure, ritual traffic, governance, or competing powers rather than room-level or site-level detail.",
  ];
}

function buildWorldSpineScaleFallbackCorrectionNotes(
  scaleTier: WorldScaleTier,
  flaggedLocations: z.infer<typeof worldSpineLocationSchema>[],
) {
  if (scaleTier === "world") {
    return buildWorldScaleWorldSpineCorrectionNotes(flaggedLocations);
  }

  const flaggedNames = flaggedLocations.map((location) => location.name);
  const quotedNames = flaggedNames.map((name) => `"${name}"`).join(", ");

  if (scaleTier === "regional") {
    return [
      "At regional scale, world_spine locations must read like cities, frontiers, coasts, basins, corridors, marches, territorial strongholds, or other region-scale places people travel through, inhabit, depend on, or govern across.",
      flaggedNames.length > 0
        ? `Revise these locations so they become proper regional containers instead of isolated sites or tiny fragments: ${quotedNames}.`
        : "Revise any flagged locations so they become proper regional containers instead of isolated sites or tiny fragments.",
      "Keep the core concept, but widen or right-size it into the broader district, belt, corridor, marches, hinterland, route zone, or surrounding territory organized around that place.",
      "If the current name reads like a building, enclave, hall, facility, or isolated site, rename it to the larger container people actually traverse and orient by.",
      "Do not output a single room, business, compound, shrine, grove, mint, barracks, archive, scenic backdrop, or tiny neighborhood fragment as a top-level regional spine node.",
    ];
  }

  return [
    "At settlement scale, world_spine locations must read like districts, wards, quarters, civic hubs, harbors, chokepoints, or other local places residents can navigate between.",
    flaggedNames.length > 0
      ? `Revise these locations so they become usable settlement-scale places instead of rooms, stalls, or tiny scene fragments: ${quotedNames}.`
      : "Revise any flagged locations so they become usable settlement-scale places instead of rooms, stalls, or tiny scene fragments.",
    "Keep the core concept, but widen or right-size it into a district, ward, market front, harbor edge, civic yard, or other local place with ongoing public use.",
    "If the current concept is mainly a queue, auction, market-night, bell, sanctuary, one recurring ritual, one special venue, or the aftermath of one incident, rename and rewrite it as the surrounding neighborhood, precinct, quarter, or corridor people navigate through every day.",
    "If the current name reads like a hall, hostel, temple, pump house, chamber, tower, office, or single establishment, rename it to the surrounding ward, quarter, precinct, approach, or neighborhood that contains it.",
    "Do not output a private interior, single counter, single shop stall, decorative vignette, single-community compound, or event-shaped scene as a top-level settlement spine node.",
  ];
}

function buildSocialCastScaleFallbackCorrectionNotes(scaleTier: WorldScaleTier) {
  switch (scaleTier) {
    case "world":
      return [
        "At world scale, anchor NPCs to regions or civilizations and define their public contact surface as a macro-regional office, court, audience, shrine circuit, salon, message network, convoy interface, registry, port authority, or trade interface rather than a tavern, shop, alley, stall, or room.",
      ];
    case "regional":
      return [
        "At regional scale, anchor NPCs to territorial public systems such as ferry offices, caravan depots, court circuits, shrine networks, relay stations, route-maintenance bodies, or other regional interfaces rather than tiny local addresses.",
        "Keep the same NPC role, but give it a human private stake inside that regional role instead of leaving it as a pure job shell.",
      ];
    case "settlement":
      return [
        "At settlement scale, anchor NPCs to local public interfaces such as wards, shrine queues, workshops, harbor crossings, household audiences, market fronts, or service points rather than private interiors or decorative scene props.",
        "Keep the same NPC role, but give it a human private stake inside that local role instead of leaving it as a pure job shell.",
      ];
  }
}

function scaleLabel(scaleTier: WorldScaleTier) {
  switch (scaleTier) {
    case "settlement":
      return "Settlement-scale";
    case "regional":
      return "Regional-scale";
    case "world":
      return "World-scale";
  }
}

function validateScaleAwareWorldSpine(
  scaleTier: WorldScaleTier,
  locations: z.infer<typeof worldSpineLocationSchema>[],
): StageValidation {
  if (scaleTier !== "world") {
    return { category: "coherence", issues: [] };
  }

  const flaggedLocations = locations.filter((location) => {
    const surface = `${location.name} ${location.summary} ${location.description}`;
    return hasWorldScaleMicroDetail(surface);
  });
  const issues = flaggedLocations.map(
    (location) =>
      `World-scale location ${location.name} reads too micro-geographic for a macro region/civilization/frontier node.`,
  );

  return {
    category: "coherence",
    issues,
    correctionNotes: issues.length ? buildWorldScaleWorldSpineCorrectionNotes(flaggedLocations) : undefined,
  };
}

function validateScaleAwareSocialCast(
  scaleTier: WorldScaleTier,
  npcs: z.infer<typeof generatedSocialLayerInputSchema>["npcs"],
): StageValidation {
  if (scaleTier !== "world") {
    return { category: "immersion", issues: [] };
  }

  const issues = npcs.flatMap((npc) => {
    const surface = `${npc.description} ${npc.publicContactSurface} ${npc.currentConcern}`;
    return hasWorldScaleMicroDetail(surface)
      ? [
          `World-scale NPC ${npc.name} drifts into micro-address detail in description or publicContactSurface.`,
        ]
      : [];
  });

  return {
    category: "immersion",
    issues,
    correctionNotes: issues.length
      ? [
          "At world scale, anchor NPCs to regions or civilizations and define their public contact surface as a macro-regional office, court, shrine circuit, message network, convoy interface, salon, audience, port authority, registry, or trade interface rather than a tavern, shop, alley, or room.",
        ]
      : undefined,
  };
}

async function critiqueWorldSpineScaleWithModel(input: {
  prompt: string;
  promptIntentProfile: PromptIntentProfile;
  scaleTier: WorldScaleTier;
  locations: z.infer<typeof worldSpineLocationSchema>[];
}): Promise<StageValidation> {
  const fallbackWorldSpineCritique = () =>
    validateScaleAwareWorldSpine(input.scaleTier, input.locations);

  const critiqueModel = env.openRouterPlannerModel.trim() || env.openRouterModel;
  if (!critiqueModel) {
    return fallbackWorldSpineCritique();
  }

  try {
    const instructions = buildWorldSpineScaleCritiqueInstructions(input.scaleTier);

    const response = await runCompletion({
      model: critiqueModel,
      temperature: 0.1,
      maxTokens: 900,
      system: instructions.system.join("\n"),
      user: [
        ...buildCritiqueContextBlocks(input),
        formatPromptBlock("locations", input.locations),
        formatFinalInstruction(instructions.finalInstruction),
      ].join("\n\n"),
      tools: [worldSpineScaleCritiqueTool],
    });

    const parsed = worldSpineScaleCritiqueSchema.safeParse(response?.input);
    if (!parsed.success) {
      return fallbackWorldSpineCritique();
    }

    if (parsed.data.verdict === "accept") {
      return { category: "coherence", issues: [] };
    }

    const flaggedLocations = input.locations.filter((location) =>
      parsed.data.fieldIssues.some((issue) => issue.locationName === location.name),
    );

    return {
      category: "coherence",
      issues: parsed.data.fieldIssues.map(
        (issue) => `${scaleLabel(input.scaleTier)} location ${issue.locationName} ${issue.issue}.`,
      ),
      correctionNotes: parsed.data.correctionNotes.length
        ? parsed.data.correctionNotes
        : buildWorldSpineScaleFallbackCorrectionNotes(input.scaleTier, flaggedLocations),
    };
  } catch (error) {
    logOpenRouterResponse("world_spine.critique_error", {
      message: error instanceof Error ? error.message : String(error),
    });
    return fallbackWorldSpineCritique();
  }
}

async function critiqueSocialCastScaleWithModel(input: {
  prompt: string;
  promptIntentProfile: PromptIntentProfile;
  scaleTier: WorldScaleTier;
  npcs: z.infer<typeof generatedSocialLayerInputSchema>["npcs"];
}): Promise<StageValidation> {
  const fallbackSocialCastCritique = () =>
    validateScaleAwareSocialCast(input.scaleTier, input.npcs);

  const critiqueModel = env.openRouterPlannerModel.trim() || env.openRouterModel;
  if (!critiqueModel) {
    return fallbackSocialCastCritique();
  }

  try {
    const instructions = buildSocialCastScaleCritiqueInstructions(input.scaleTier);

    const response = await runCompletion({
      model: critiqueModel,
      temperature: 0.1,
      maxTokens: 900,
      system: instructions.system.join("\n"),
      user: [
        ...buildCritiqueContextBlocks(input),
        formatPromptBlock("npcs", input.npcs),
        formatFinalInstruction(instructions.finalInstruction),
      ].join("\n\n"),
      tools: [socialCastScaleCritiqueTool],
    });

    const parsed = socialCastScaleCritiqueSchema.safeParse(response?.input);
    if (!parsed.success) {
      return fallbackSocialCastCritique();
    }

    if (parsed.data.verdict === "accept") {
      return { category: "immersion", issues: [] };
    }

    return {
      category: "immersion",
      issues: parsed.data.fieldIssues.map(
        (issue) => `${scaleLabel(input.scaleTier)} NPC ${issue.npcName} ${issue.issue}.`,
      ),
      correctionNotes: parsed.data.correctionNotes.length
        ? parsed.data.correctionNotes
        : buildSocialCastScaleFallbackCorrectionNotes(input.scaleTier),
    };
  } catch (error) {
    logOpenRouterResponse("social_cast.critique_error", {
      message: error instanceof Error ? error.message : String(error),
    });
    return fallbackSocialCastCritique();
  }
}

async function critiqueRegionalLifeWithModel(input: {
  prompt: string;
  promptIntentProfile: PromptIntentProfile;
  scaleTier: WorldScaleTier;
  locations: RegionalLifeDraft["locations"];
}): Promise<StageValidation> {
  const critiqueModel = env.openRouterPlannerModel.trim() || env.openRouterModel;
  if (!critiqueModel) {
    return { category: "immersion", issues: [] };
  }

  try {
    const instructions = buildRegionalLifeCritiqueInstructions();
    const response = await runCompletion({
      model: critiqueModel,
      temperature: 0.1,
      maxTokens: 900,
      system: instructions.system.join("\n"),
      user: [
        ...buildCritiqueContextBlocks(input),
        formatPromptBlock("locations", input.locations),
        formatFinalInstruction(instructions.finalInstruction),
      ].join("\n\n"),
      tools: [regionalLifeCritiqueTool],
    });

    const parsed = regionalLifeCritiqueSchema.safeParse(response?.input);
    if (!parsed.success || parsed.data.verdict === "accept") {
      return { category: "immersion", issues: [] };
    }

    return {
      category: "immersion",
      issues: parsed.data.fieldIssues.map(
        (issue) => `${scaleLabel(input.scaleTier)} regional life ${issue.locationId} ${issue.issue}.`,
      ),
      correctionNotes: parsed.data.correctionNotes.length
        ? parsed.data.correctionNotes
        : buildRegionalLifeFallbackCorrectionNotes(),
    };
  } catch (error) {
    logOpenRouterResponse("regional_life.critique_error", {
      message: error instanceof Error ? error.message : String(error),
    });
    return { category: "immersion", issues: [] };
  }
}

async function critiqueKnowledgeWebWithModel(input: {
  prompt: string;
  promptIntentProfile: PromptIntentProfile;
  scaleTier: WorldScaleTier;
  information: z.infer<typeof generatedKnowledgeWebInputSchema>["information"];
}): Promise<StageValidation> {
  const critiqueModel = env.openRouterPlannerModel.trim() || env.openRouterModel;
  if (!critiqueModel) {
    return { category: "immersion", issues: [] };
  }

  try {
    const instructions = buildKnowledgeWebCritiqueInstructions();
    const response = await runCompletion({
      model: critiqueModel,
      temperature: 0.1,
      maxTokens: 900,
      system: instructions.system.join("\n"),
      user: [
        ...buildCritiqueContextBlocks(input),
        formatPromptBlock("information", input.information),
        formatFinalInstruction(instructions.finalInstruction),
      ].join("\n\n"),
      tools: [knowledgeWebCritiqueTool],
    });

    const parsed = knowledgeWebCritiqueSchema.safeParse(response?.input);
    if (!parsed.success || parsed.data.verdict === "accept") {
      return { category: "immersion", issues: [] };
    }

    return {
      category: "immersion",
      issues: parsed.data.fieldIssues.map(
        (issue) => `${scaleLabel(input.scaleTier)} information '${issue.title}' ${issue.issue}.`,
      ),
      correctionNotes: parsed.data.correctionNotes,
    };
  } catch (error) {
    logOpenRouterResponse("knowledge_web.critique_error", {
      message: error instanceof Error ? error.message : String(error),
    });
    return { category: "immersion", issues: [] };
  }
}

async function critiqueKnowledgeThreadsWithModel(input: {
  prompt: string;
  promptIntentProfile: PromptIntentProfile;
  scaleTier: WorldScaleTier;
  knowledgeNetworks: z.infer<typeof generatedKnowledgeThreadsInputSchema>["knowledgeNetworks"];
  pressureSeeds: z.infer<typeof generatedKnowledgeThreadsInputSchema>["pressureSeeds"];
}): Promise<StageValidation> {
  const critiqueModel = env.openRouterPlannerModel.trim() || env.openRouterModel;
  if (!critiqueModel) {
    return { category: "immersion", issues: [] };
  }

  try {
    const response = await runCompletion({
      model: critiqueModel,
      temperature: 0.1,
      maxTokens: 900,
      system: [
        "You are a strict structured critique pass for knowledge-thread batches.",
        "Judge whether the worldview layer preserves contested beliefs, explanations, rumors, doctrine, or social meaning rather than collapsing only into pressure.",
      ].join("\n"),
      user: [
        ...buildCritiqueContextBlocks(input),
        formatPromptBlock("knowledge_networks", input.knowledgeNetworks),
        formatPromptBlock("pressure_seeds", input.pressureSeeds),
        formatFinalInstruction([
          "Return revise only if the worldview layer feels flattened away from the prompt's intent or if pressure seeds overwhelm the belief and explanation layer.",
        ]),
      ].join("\n\n"),
      tools: [knowledgeThreadsCritiqueTool],
    });

    const parsed = knowledgeThreadsCritiqueSchema.safeParse(response?.input);
    if (!parsed.success || parsed.data.verdict === "accept") {
      return { category: "immersion", issues: [] };
    }

    return {
      category: "immersion",
      issues: parsed.data.fieldIssues.map(
        (issue) => `${scaleLabel(input.scaleTier)} ${issue.field} ${issue.issue}.`,
      ),
      correctionNotes: parsed.data.correctionNotes,
    };
  } catch (error) {
    logOpenRouterResponse("knowledge_threads.critique_error", {
      message: error instanceof Error ? error.message : String(error),
    });
    return { category: "immersion", issues: [] };
  }
}

async function critiqueEconomyMaterialLifeWithModel(input: {
  prompt: string;
  promptIntentProfile: PromptIntentProfile;
  scaleTier: WorldScaleTier;
  locationTradeIdentity: z.infer<typeof generatedEconomyMaterialLifeInputSchema>["locationTradeIdentity"];
  commodities: z.infer<typeof generatedEconomyMaterialLifeInputSchema>["commodities"];
}): Promise<StageValidation> {
  const critiqueModel = env.openRouterPlannerModel.trim() || env.openRouterModel;
  if (!critiqueModel) {
    return { category: "immersion", issues: [] };
  }

  try {
    const response = await runCompletion({
      model: critiqueModel,
      temperature: 0.1,
      maxTokens: 900,
      system: [
        "You are a strict structured critique pass for economy-and-material-life batches.",
        "Judge whether the output preserves varied material texture instead of making every place feel defined only by scarcity, contraband, monopoly, or collapse.",
      ].join("\n"),
      user: [
        ...buildCritiqueContextBlocks(input),
        formatPromptBlock("location_trade_identity", input.locationTradeIdentity),
        formatPromptBlock("commodities", input.commodities),
        formatFinalInstruction([
          "Return revise only for clear flattening into scarcity/contraband language, house style, or scale-mismatched localism.",
          "Do not penalize real pressure, abundance, prestige, ritual upkeep, comfort, or display when they fit the prompt; penalize monotony and contradiction with the requested scale.",
        ]),
      ].join("\n\n"),
      tools: [economyMaterialLifeCritiqueTool],
    });

    const parsed = economyMaterialLifeCritiqueSchema.safeParse(response?.input);
    if (!parsed.success || parsed.data.verdict === "accept") {
      return { category: "immersion", issues: [] };
    }

    return {
      category: "immersion",
      issues: parsed.data.fieldIssues.map(
        (issue) => `${scaleLabel(input.scaleTier)} trade identity ${issue.locationId} ${issue.issue}.`,
      ),
      correctionNotes: parsed.data.correctionNotes,
    };
  } catch (error) {
    logOpenRouterResponse("economy_material_life.critique_error", {
      message: error instanceof Error ? error.message : String(error),
    });
    return { category: "immersion", issues: [] };
  }
}

function createStructuredTool(
  name: string,
  description: string,
  schema: z.ZodTypeAny,
): StructuredTool {
  try {
    return {
      name,
      description,
      input_schema: z.toJSONSchema(schema),
    };
  } catch (error) {
    console.error(`Failed to create JSON schema for tool ${name}:`, error);
    throw error;
  }
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
  scope: WorldBibleContextScope,
) {
  const burdenLimit =
    scope === "world_spine" || scope === "knowledge_web"
      ? Math.min(6, worldBible.widespreadBurdens.length)
      : scope === "social_cast"
        ? Math.min(4, worldBible.widespreadBurdens.length)
        : 3;
  const scarLimit =
    scope === "knowledge_web" || scope === "knowledge_threads"
      ? Math.min(3, worldBible.presentScars.length)
      : scope === "social_cast"
        ? Math.min(1, worldBible.presentScars.length)
      : scope === "world_spine"
        ? Math.min(2, worldBible.presentScars.length)
        : 0;
  const detailLimit =
    scope === "world_spine"
      ? Math.min(6, worldBible.sharedRealities.length)
      : scope === "knowledge_web" || scope === "knowledge_threads"
        ? Math.min(6, worldBible.sharedRealities.length)
        : scope === "social_cast"
          ? Math.min(5, worldBible.sharedRealities.length)
          : 4;
  const explanationLimit =
    scope === "knowledge_web" || scope === "knowledge_threads"
      ? Math.min(3, worldBible.explanationThreads.length)
      : 0;

  return {
    title: worldBible.title,
    premise: worldBible.premise,
    setting: worldBible.setting,
    groundLevelReality: worldBible.groundLevelReality,
    widespreadBurdens: worldBible.widespreadBurdens.slice(0, burdenLimit),
    presentScars: worldBible.presentScars.slice(0, scarLimit),
    sharedRealities: worldBible.sharedRealities.slice(0, detailLimit),
    competingExplanations: worldBible.explanationThreads.slice(0, explanationLimit).map((thread) => ({
      key: thread.key,
      phenomenon: thread.phenomenon,
      prevailingTheories: thread.prevailingTheories,
      actionableSecret: thread.actionableSecret,
    })),
    everydayLife: {
      survival: worldBible.everydayLife.survival,
      institutions:
        scope === "world_spine"
          ? worldBible.everydayLife.institutions
          : worldBible.everydayLife.institutions.slice(0, 4),
      fears:
        scope === "world_spine"
          ? worldBible.everydayLife.fears
          : worldBible.everydayLife.fears.slice(0, 3),
      wants:
        scope === "world_spine"
          ? worldBible.everydayLife.wants
          : worldBible.everydayLife.wants.slice(0, 3),
      trade:
        scope === "world_spine" || scope === "economy_material_life"
          ? worldBible.everydayLife.trade
          : worldBible.everydayLife.trade.slice(0, 4),
      gossip:
        scope === "world_spine" || scope === "social_cast"
          ? worldBible.everydayLife.gossip
          : worldBible.everydayLife.gossip.slice(0, 3),
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
  usageProfile?: "everyday" | "special";
}) {
  return location.usageProfile === "everyday";
}

function validateKnowledgeWebStage(input: {
  information: z.infer<typeof generatedKnowledgeWebInputSchema>["information"];
  lockedLocations: Array<{ id: string; name: string }>;
  lockedFactions: Array<{ id: string }>;
  lockedNpcs: Array<{ id: string; currentLocationId: string }>;
}): string[] {
  const issues: string[] = [];
  const locationIds = new Set(input.lockedLocations.map((location) => location.id));
  const factionIds = new Set(input.lockedFactions.map((faction) => faction.id));
  const npcIds = new Set(input.lockedNpcs.map((npc) => npc.id));
  const npcLocationMap = new Map(input.lockedNpcs.map((npc) => [npc.id, npc.currentLocationId]));

  for (const information of input.information) {
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

  for (const location of input.lockedLocations) {
    const hasKnowledgePresence = input.information.some((information) =>
      information.locationId === location.id
      || (information.sourceNpcId ? npcLocationMap.get(information.sourceNpcId) === location.id : false),
    );

    if (!hasKnowledgePresence) {
      issues.push(`Location ${location.name} needs meaningful knowledge presence.`);
    }
  }

  if (
    input.information.length > 0
    && input.information.every((information) => information.accessibility === "secret")
  ) {
    issues.push("Knowledge web should expose at least some non-secret knowledge surfaces.");
  }

  return issues;
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

function unscopedEntityId(value: string) {
  const trimmed = value.trim();
  const parts = trimmed.split(":");
  return parts.length >= 3 ? parts.slice(2).join(":") : trimmed;
}

function normalizeScopedEntityId(value: string, entitySegment: string, entityPrefix: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return trimmed;
  }

  const expectedSegment = `:${entitySegment}:`;
  if (trimmed.includes(expectedSegment)) {
    return trimmed;
  }

  const parts = trimmed.split(":");
  if (parts.length === 2 && parts[1]?.startsWith(`${entityPrefix}_`)) {
    return `${parts[0]}:${entitySegment}:${parts[1]}`;
  }

  return trimmed;
}

function sanitizeCitationIds(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => {
      const normalized = entry.toLowerCase();
      return normalized !== "" && normalized !== "none" && normalized !== "null";
    });
}

function idsReferToSameEntity(left: string | null | undefined, right: string | null | undefined) {
  if (!left || !right) {
    return false;
  }

  return left === right || unscopedEntityId(left) === unscopedEntityId(right);
}

function buildUnscopedIdLookup(ids: string[]) {
  return new Map(ids.map((id) => [unscopedEntityId(id), id]));
}

function normalizeScheduleEntityId(
  value: string,
  lookups: {
    locations: Map<string, string>;
    factions: Map<string, string>;
    npcs: Map<string, string>;
    information: Map<string, string>;
  },
) {
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes(":")) {
    return trimmed;
  }

  if (trimmed.startsWith("loc_")) {
    return lookups.locations.get(trimmed) ?? trimmed;
  }
  if (trimmed.startsWith("fac_")) {
    return lookups.factions.get(trimmed) ?? trimmed;
  }
  if (trimmed.startsWith("npc_")) {
    return lookups.npcs.get(trimmed) ?? trimmed;
  }
  if (trimmed.startsWith("info_")) {
    return lookups.information.get(trimmed) ?? trimmed;
  }

  return trimmed;
}

function normalizeSchedulePayloadIds(
  value: unknown,
  lookups: {
    locations: Map<string, string>;
    factions: Map<string, string>;
    npcs: Map<string, string>;
    information: Map<string, string>;
  },
): unknown {
  if (typeof value === "string") {
    return normalizeScheduleEntityId(value, lookups);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => normalizeSchedulePayloadIds(entry, lookups));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
      key,
      normalizeSchedulePayloadIds(entry, lookups),
    ]),
  );
}

function formatCorrectionNotes(input: {
  stage: WorldGenerationStageName;
  category: StageValidation["category"];
  issues: string[];
  userPrompt: string;
  promptIntentProfile: PromptIntentProfile;
}) {
  return [
    `<correction stage="${input.stage}" category="${input.category}">`,
    "Return a complete replacement payload.",
    "Preserve strong world-specific material when possible.",
    "Preserve the prompt's intended texture, causal logic, and social emphasis instead of snapping back to house style.",
    "Make the world feel already underway through present-tense, ongoing, humanly motivated detail rather than by adding dramatic new situations.",
    "Do not make the retry more questy or more event-scripted just to show activity.",
    `Original prompt: ${input.userPrompt.trim()}`,
    `Prompt intent profile: ${JSON.stringify(input.promptIntentProfile)}`,
    "Fix these violations exactly:",
    ...input.issues.map((issue, index) => `${index + 1}. ${issue}`),
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
    currentConcern?: string | null;
    publicContactSurface?: string | null;
  }>,
) {
  return npcs.map((npc) =>
    [
      npc.id,
      `${npc.name} (${npc.role})`,
      `at=${npc.currentLocationId}`,
      npc.factionId ? `faction=${npc.factionId}` : "",
      npc.currentConcern ? `concern=${npc.currentConcern}` : "",
      npc.publicContactSurface ? `surface=${npc.publicContactSurface}` : "",
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

const WORLD_GEN_SCALE_GUIDE = [
  "Entity routing guide:",
  "Use location nodes only for places that deserve geography: they require meaningful transit time, mechanical isolation, access control, or physical risk to enter.",
  "World spine locations should be major navigable places appropriate to the chosen scale: districts, wards, and civic hubs at settlement scale; cities, frontier points, passes, and territorial corridors at regional scale; and at world scale, macro containers such as regions, civilizations, frontier expanses, maritime worlds, pilgrimage belts, trade corridors, sacred geographies, and macro-polities that people live under or move across at continental scale.",
  "Do not mint bakeries, stalls, ordinary taverns, warehouses, routine storefronts, or individual rooms as location nodes unless the place is unusually isolated, fortified, hidden, or risky to reach.",
  "Micro-geography and scene furniture should stay inside the parent place as narrative space or world objects rather than becoming travel topology.",
  "If you ever create a minor location node, justify it through travel, barriers, secrecy, or danger from its parent place.",
];

const WORLD_GEN_ANTI_PATTERNS = [
  "Do not default to chosen ones, ancient evils, prophecy, dark lords, or vague magical corruption unless the prompt clearly calls for them.",
  "Do not create ornamental NPCs, empty postcard locations, or generic stock-setting filler.",
  "Do not solve missing structure by inventing extra ids, keys, factions, or locations outside the provided context.",
  "Do not use vague phrases when a concrete person, place, practice, object, relationship, ritual, institution, conflict, environment, or system would be clearer.",
  "Do not write burdens, scars, rituals, courts, marvels, or mysteries as plot hooks waiting for a hero; describe living present-tense realities instead.",
  "Do not spend precious detail budget on orbital mechanics, tectonics, cosmology, or other deep realism unless it visibly changes lived life at the chosen scale.",
  "Do not present factions as morally monolithic or internally unanimous.",
  "Do not over-explain mysteries into dead canon when uncertainty would create stronger actionable leads.",
  "Do not flatten the prompt into a single house style or substitute generic genre framing for the user's actual nouns and texture.",
  "Do not collapse every place, faction, or NPC into the same administrative, scarcity, checkpoint, or crisis genre when the prompt supports a broader social texture.",
  "Do not force every place, faction, or NPC to revolve around a ceremony, convoy, inspection, emergency, or discrete event just to make the world feel active.",
];

function formatPromptTextureMode(mode: PromptTextureMode) {
  switch (mode) {
    case "institutional":
      return "institutional";
    case "magical_everyday":
      return "magical-everyday";
    case "ritual_ceremonial":
      return "ritual-ceremonial";
    case "courtly_status":
      return "courtly-status";
    case "domestic_intimate":
      return "domestic-intimate";
    case "frontier_survival":
      return "frontier-survival";
    case "mercantile_exchange":
      return "mercantile-exchange";
    case "occult_scholastic":
      return "occult-scholastic";
    case "criminal_shadow":
      return "criminal-shadow";
    case "pastoral_seasonal":
      return "pastoral-seasonal";
    case "surreal":
      return "surreal";
    case "mythic":
      return "mythic";
  }
}

function buildWorldGenCraftScaffold(input: {
  stage: WorldGenerationStageName;
  scaleTier: WorldScaleTier;
}) {
  const principles = [
    "You are constructing an objective world-generation payload that must stay usable for later play without flattening the prompt's intended texture.",
    "Make the prompt's own logic lived-in at the chosen scale.",
    "Express reality through people, places, practices, objects, relationships, rituals, institutions, conflicts, environments, or systems appropriate to the setting.",
    "Preserve distinctive nouns, imagery, and social texture from the prompt instead of renaming the world into generic substitutes.",
    "Keep outputs specific, legible, and playable without forcing every setting through the same bureaucratic, material, or scarcity-first worldview.",
    "Leave procedural gaps for play: mysteries should reveal the next clue, contact, routine, leverage point, or practical advantage rather than a total authorial answer.",
    "Be concise but vivid. Favor strong concrete detail over abstract labels, placeholders, or sourcebook mush.",
    "Scale correctness outranks flavor when they conflict directly.",
  ];

  const successCriteria = [
    "Keep the chosen scale semantically correct.",
    "Avoid generic names, placeholder filler, and default hero-hook framing.",
    "Preserve prompt nouns whenever possible.",
    "Make texture readable through ordinary lived contact, not outsider narration.",
  ];

  return [
    ...principles,
    ...buildPresentTenseScaleGuideLines(),
    ...WORLD_GEN_SCALE_GUIDE,
    "Forbidden patterns:",
    ...WORLD_GEN_ANTI_PATTERNS.map((line) => `- ${line}`),
    "Craft checks:",
    ...successCriteria.map((line) => `- ${line}`),
    `Current stage: ${input.stage}.`,
    `Chosen source scale: ${input.scaleTier}.`,
  ].join("\n");
}

function buildWorldGenIntentGuardrails(
  promptIntentProfile: PromptIntentProfile,
  userPrompt: string,
  stage: WorldGenerationStageName,
  scaleTier: WorldScaleTier,
) {
  const textureModes = promptIntentProfile.primaryTextureModes.map(formatPromptTextureMode).join(", ");
  const lines = [
    "Prompt intent guardrails:",
    `- Preserve the prompt's dominant texture modes: ${textureModes}.`,
    `- Preserve the prompt's causal logic: ${promptIntentProfile.primaryCausalLogic}.`,
    `- Preserve the prompt's magic integration level: ${promptIntentProfile.magicIntegration}.`,
    `- Preserve the prompt's social emphasis: ${promptIntentProfile.socialEmphasis}.`,
  ];

  if (promptIntentProfile.confidence === "low") {
    lines.push(
      "- Confidence is low. Use neutral craft scaffolding, preserve prompt nouns, and do not guess a stronger worldview than the prompt clearly provides.",
    );
  }

  if (promptIntentProfile.primaryCausalLogic !== "material") {
    lines.push(
      "- Do not normalize mythic, ritual, surreal, or mixed causal logic back into permits, tolls, shortages, inspections, repair burdens, or administrative bottlenecks unless the prompt itself asks for them.",
    );
  }

  if (
    promptIntentProfile.primaryTextureModes.some((mode) =>
      ["courtly_status", "domestic_intimate", "ritual_ceremonial", "magical_everyday", "mythic", "surreal"].includes(mode),
    )
  ) {
    lines.push(
      "- Preserve courtly, domestic, ritual, magical-everyday, mythic, or surreal textures where present instead of translating them into a default civic-material frame.",
    );
  }

  if (stage === "world_spine") {
    lines.push(
      "- In world_spine, shape anchors, connectors, thresholds, power centers, hazard belts, ritual geographies, and traversal texture according to the prompt intent, not only civic bottlenecks.",
    );
  }

  if (stage === "social_cast") {
    lines.push(
      "- In social_cast, ordinary public interfaces may be households, audiences, salons, shrines, workshops, rehearsals, ritual thresholds, convoy marshaling points, message circuits, courts, or service counters depending on the setting.",
    );
  }

  if (stage === "knowledge_web") {
    lines.push(
      "- In knowledge_web, meaningful knowledge may live in etiquette, symbolism, ritual timing, omens, domestic routines, court protocol, performance, household access, or practical observation, not only public procedure.",
    );
  }

  if (stage === "economy_material_life") {
    lines.push(
      "- In economy_material_life, a place may be defined by abundance, comfort, prestige, rite, magical upkeep, seasonal rhythm, dependence, display, or scarcity as prompted.",
    );
  }

  lines.push(
    `- Original prompt reference: ${userPrompt.trim()}`,
    `- Keep outputs appropriate to ${scaleTier} scale while honoring the prompt's intended texture.`,
  );

  return lines.join("\n");
}

function buildWorldGenSystemPrompt(input: {
  stage: WorldGenerationStageName;
  scaleTier: WorldScaleTier;
  userPrompt: string;
  promptIntentProfile?: PromptIntentProfile;
  successLines: string[];
}) {
  return [
    buildWorldGenCraftScaffold({
      stage: input.stage,
      scaleTier: input.scaleTier,
    }),
    ...(input.promptIntentProfile
      ? [
          buildWorldGenIntentGuardrails(
            input.promptIntentProfile,
            input.userPrompt,
            input.stage,
            input.scaleTier,
          ),
        ]
      : []),
    "Success criteria:",
    ...input.successLines.map((line) => `- ${line}`),
  ].join("\n");
}

function buildPromptIntentInferenceRubricLines() {
  return [
    "Texture mode examples: institutional = councils, ministries, registries, courts, guilds, bureaucracy, public procedure, or formal administration.",
    "Texture mode examples: magical_everyday = magic embedded in routine labor, transport, trade, agriculture, utilities, maintenance, medicine, public safety, or ordinary adaptation.",
    "Texture mode examples: ritual_ceremonial = repeated rites, festivals, processions, oath forms, observances, sacred timing, formal offerings, or publicly legible symbolic practice.",
    "Texture mode examples: courtly_status = rank display, etiquette, patronage, regalia, audience ritual, prestige anxiety, succession manners, or status competition.",
    "Texture mode examples: domestic_intimate = households, kinship, caregiving, courtship, family obligations, cohabitation, hearth routines, or private emotional dependency.",
    "Texture mode examples: mercantile_exchange = trade routes, bargaining, tariffs, markets, contracts, merchant rivalry, logistics, debt, or commercial interdependence.",
    "Texture mode examples: criminal_shadow = smuggling, illicit brokerage, hidden coercion, black markets, extortion, covert violence, underworld favors, or deniable operations.",
    "Texture mode examples: occult_scholastic = archives, forbidden study, interpreters, scholars, translators, codices, esoteric investigation, or learned secrecy.",
    "Texture mode examples: frontier_survival = scarce shelter, exposure, extraction risk, rough logistics, contested margins, improvised safety, or harsh environmental adaptation.",
    "Texture mode examples: pastoral_seasonal = herding, planting, harvest rhythms, weather dependence, local husbandry, village custom, or seasonal subsistence patterns.",
    "Texture mode examples: mythic = legendary causality, divine precedent, heroic inheritance, sacred fate, or reality interpreted through mythic exemplars.",
    "Texture mode examples: surreal = dream logic, unstable identity, impossible space, uncanny transformation, or reality behaving with deliberate strangeness.",
    "Do not choose domestic_intimate merely because a prompt asks for everyday life, ordinary routines, or a lived-in setting; reserve it for prompts where household, kinship, intimacy, or private domestic obligations are central.",
    "Prefer magical_everyday when magic operates as routine infrastructure or ordinary practice rather than isolated spectacle.",
    "Prefer ritual_ceremonial when public formality, observance, procession, oath, or symbolic timing is one of the prompt's strongest surface textures.",
    "Prefer courtly_status when hierarchy, etiquette, patronage, regalia, or prestige display drives the social feel.",
    "For socialEmphasis, choose public_systems when civic order, institutions, markets, or formal public interfaces dominate; choose private_networks when family, household, patronage, secrecy, or personal ties dominate; choose mixed when both clearly matter.",
    "For magicIntegration, choose subdued when magic is rare or peripheral, integrated when it shapes normal life and institutions, and spectacular when it dominates the prompt's visible scale and awe.",
  ];
}

function buildWorldGenerationBasePrompt(input: {
  prompt: string;
  promptIntentProfile?: PromptIntentProfile;
  previousDraft?: GeneratedWorldModule;
  correctionNotes?: string | null;
  scaleTier?: WorldScaleTier;
  scalePlan?: WorldGenerationScalePlan;
}) {
  return [
    formatPromptBlock("prompt", input.prompt),
    input.promptIntentProfile
      ? formatPromptBlock("prompt_intent_profile", input.promptIntentProfile)
      : "",
    input.scaleTier ? formatPromptBlock("scale_tier", input.scaleTier) : "",
    input.scalePlan ? formatPromptBlock("scale_plan", input.scalePlan) : "",
    input.previousDraft
      ? formatPromptBlock("previous_draft_summary", summarizeWorld(input.previousDraft))
      : "",
    input.correctionNotes ? input.correctionNotes : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function buildCritiqueContextBlocks(input: {
  prompt: string;
  promptIntentProfile: PromptIntentProfile;
  scaleTier: WorldScaleTier;
}) {
  return [
    formatPromptBlock("original_prompt", input.prompt),
    formatPromptBlock("prompt_intent_profile", input.promptIntentProfile),
    formatPromptBlock("scale_tier", input.scaleTier),
  ];
}

async function critiqueWorldBibleWithModel(input: {
  prompt: string;
  promptIntentProfile: PromptIntentProfile;
  scaleTier: WorldScaleTier;
  worldBible: z.infer<typeof generatedWorldBibleSchema>;
}): Promise<StageValidation> {
  const fallbackWorldBibleCritique = (): StageValidation => {
    const issues: string[] = [];
    const correctionNotes: string[] = [];
    const shouldStayConservative =
      input.promptIntentProfile.confidence === "low"
      || input.promptIntentProfile.primaryCausalLogic !== "material";

    const detailedBurdens = input.worldBible.widespreadBurdens.filter(
      (entry) => entry.trim().split(/\s+/).filter(Boolean).length >= 6,
    ).length;
    if (!shouldStayConservative && detailedBurdens < 4) {
      issues.push(
        "Too many widespreadBurdens are still terse abstractions instead of lived conditions.",
      );
      correctionNotes.push(
        "Rewrite widespreadBurdens as concrete lived conditions using the prompt's own logic rather than abstract labels.",
      );
    }

    const socialDetails = input.worldBible.sharedRealities.filter(
      (entry) => entry.trim().split(/\s+/).filter(Boolean).length >= 4,
    ).length;
    if (socialDetails < 2) {
      issues.push(
        "sharedRealities needs more lived specificity.",
      );
      correctionNotes.push(
        "Add more sharedRealities that show recurring habits, symbols, rituals, institutions, routines, environments, or systems people actually encounter.",
      );
    }

    const groundedGossip = input.worldBible.everydayLife.gossip.filter(
      (entry) => entry.trim().split(/\s+/).filter(Boolean).length >= 6,
    ).length;
    if (groundedGossip < 2) {
      issues.push("Gossip is too abstract to feel like resident talk.");
      correctionNotes.push(
        "Rewrite gossip so residents talk about a specific person, place, practice, object, relationship, institution, or embarrassment.",
      );
    }

    const hasSpecificInstitutionName = input.worldBible.everydayLife.institutions.some(
      (entry) => entry.trim().split(/\s+/).filter(Boolean).length >= 3,
    );
    if (!hasSpecificInstitutionName) {
      issues.push("Institution naming is too generic to anchor the place socially.");
      correctionNotes.push(
        "Make at least one everydayLife institution a specific local organization, court, household structure, rite, workshop, order, or public system rather than a broad generic title.",
      );
    }

    return {
      category: "immersion",
      issues,
      correctionNotes,
    };
  };

  const critiqueModel = env.openRouterPlannerModel.trim() || env.openRouterModel;
  if (!critiqueModel) {
    return fallbackWorldBibleCritique();
  }

  try {
    const instructions = buildWorldBibleCritiqueInstructions();
    const response = await runCompletion({
      model: critiqueModel,
      temperature: 0.1,
      maxTokens: 1000,
      system: instructions.system.join("\n"),
      user: [
        ...buildCritiqueContextBlocks(input),
        formatPromptBlock("world_bible", input.worldBible),
        formatFinalInstruction(instructions.finalInstruction),
      ].join("\n\n"),
      tools: [worldBibleCritiqueTool],
    });

    const parsed = worldBibleCritiqueSchema.safeParse(response?.input);
    if (!parsed.success) {
      return fallbackWorldBibleCritique();
    }

    if (parsed.data.verdict === "accept") {
      return {
        category: "immersion",
        issues: [],
      };
    }

    const nonExplanationFieldIssues = parsed.data.fieldIssues.filter(
      (entry) => entry.field !== "explanationThreads",
    );
    if (
      parsed.data.abstractTerms.length === 0 &&
      parsed.data.genericTitles.length === 0 &&
      nonExplanationFieldIssues.length === 0
    ) {
      return {
        category: "immersion",
        issues: [],
      };
    }

    const fieldIssueFields = new Set(parsed.data.fieldIssues.map((entry) => entry.field));
    const extractedIssues = [
      ...parsed.data.abstractTerms
        .filter((entry) => !fieldIssueFields.has(entry.field))
        .map((entry) => `${entry.field} uses abstract term '${entry.term}'.`),
      ...(parsed.data.genericTitles.length >= 4
        ? [
            `${parsed.data.genericTitles[0]?.field ?? "everydayLife.institutions"} uses too many generic institution titles.`,
          ]
        : []),
      ...parsed.data.fieldIssues.map(
        (entry) => `${entry.field}: ${entry.issue} (${entry.offendingText})`,
      ),
    ];

    return {
      category: "immersion",
      issues: extractedIssues,
      correctionNotes: parsed.data.correctionNotes,
    };
  } catch (error) {
    logOpenRouterResponse("world_bible.critique_error", {
      message: error instanceof Error ? error.message : String(error),
    });

    return fallbackWorldBibleCritique();
  }
}

function buildWorldBibleOutputBudget(
  scaleTier: WorldScaleTier,
  minimumExplanationThreads: number,
) {
  const minimums = WORLD_BIBLE_SCALE_MINIMUMS[scaleTier];
  return {
    title: "2 to 5 words",
    premise: "1 to 2 short sentences",
    tone: "2 to 4 words used only as a UI-facing shorthand; avoid genre labels",
    setting: "3 to 10 words of geographic, material, or civilizational shorthand",
    groundLevelReality:
      "3 to 5 short sentences proving the world's scale from below through routes, labor, infrastructure, trade, weather, ritual, or upkeep as residents experience them now",
    widespreadBurdens:
      `at least ${minimums.burdens} short sentences; name a burden, chokepoint, or dependency and show who pays the cost now and how people adapt, accommodate, or work around it at the chosen scale`,
    presentScars:
      `at least ${minimums.scars} short sentences; name an old rupture and the visible present scar it left behind, including the ongoing repair, containment, accommodation, or reputation effect it still causes at the chosen scale`,
    sharedRealities:
      `at least ${minimums.sharedRealities} short anchors; recurring social, infrastructural, monetary, ritual, material, celebratory, or craft realities people actively encounter, maintain, or adapt to at the chosen scale`,
    explanationThreads: {
      count:
        minimumExplanationThreads > 0
          ? `at least ${minimumExplanationThreads}; add more only if the setting genuinely needs them`
          : "0 or more; include them only when the setting genuinely contains phenomena people do not agree about",
      phenomenon: "2 to 6 words",
      prevailingTheories: "2 to 3 short clauses per thread",
      actionableSecret: "1 to 2 short sentences",
    },
    everydayLife: {
      survival: "1 to 2 short sentences",
      institutions:
        "at least 4 specific local organizations, offices, rituals, or public systems; 2 to 8 words each",
      fears: "at least 3 concrete routine dangers or anxieties; 2 to 6 words each",
      wants: "at least 3 concrete wants, comforts, or leverage points; 2 to 6 words each",
      trade: "at least 3 concrete goods, services, craft specialisms, or recurring material dependencies people rely on; 2 to 8 words each",
      gossip: "at least 3 short sentences; each should name or imply a person, place, or institution",
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

function normalizeUniqueStringList(value: unknown, maxItems: number) {
  const entries = normalizeStringList(value);
  if (!Array.isArray(entries)) {
    return value;
  }

  const normalizedEntries: string[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    const normalizedEntry = entry.toLowerCase();
    if (seen.has(normalizedEntry)) {
      continue;
    }

    seen.add(normalizedEntry);
    normalizedEntries.push(entry);

    if (normalizedEntries.length >= maxItems) {
      break;
    }
  }

  return normalizedEntries;
}

function normalizeSocialCastInput(input: unknown, expectedNpcs: number) {
  if (!input || typeof input !== "object") {
    return input;
  }

  const draft = input as Record<string, unknown>;
  if (!Array.isArray(draft.npcs)) {
    return input;
  }

  return {
    ...draft,
    npcs: draft.npcs.slice(0, expectedNpcs).map((npc) => {
      if (!npc || typeof npc !== "object") {
        return npc;
      }

      const normalizedNpc = { ...(npc as Record<string, unknown>) };
      normalizedNpc.bridgeLocationIds = normalizeUniqueStringList(normalizedNpc.bridgeLocationIds, 2);
      normalizedNpc.bridgeFactionIds = normalizeUniqueStringList(normalizedNpc.bridgeFactionIds, 2);

      if (typeof normalizedNpc.factionId === "string" && !normalizedNpc.factionId.trim()) {
        normalizedNpc.factionId = null;
      }

      if (normalizedNpc.ties && typeof normalizedNpc.ties === "object") {
        const normalizedTies = { ...(normalizedNpc.ties as Record<string, unknown>) };
        normalizedTies.locationIds = normalizeUniqueStringList(normalizedTies.locationIds, 2);
        normalizedTies.factionIds = normalizeUniqueStringList(normalizedTies.factionIds, 2);
        normalizedTies.economyHooks = normalizeUniqueStringList(normalizedTies.economyHooks, 2);
        normalizedTies.informationHooks = normalizeUniqueStringList(normalizedTies.informationHooks, 2);
        normalizedNpc.ties = normalizedTies;
      }

      return normalizedNpc;
    }),
  };
}

function formatReservedNamesBlock(
  tag: string,
  label: string,
  values: Iterable<string>,
) {
  const reserved = uniqueNames(
    [...values]
      .map((value) => value.trim())
      .filter(Boolean),
  ).sort();

  if (!reserved.length) {
    return null;
  }

  return formatPromptBlock(tag, `${label}: ${reserved.join(", ")}`);
}

class WorldGenerationStoppedError extends Error {
  constructor(message = "World generation stopped by user request.") {
    super(message);
    this.name = "WorldGenerationStoppedError";
  }
}

export function isWorldGenerationStoppedError(error: unknown): error is Error {
  return error instanceof WorldGenerationStoppedError;
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
  prompt,
  promptIntentProfile,
  validate,
  summarize,
  normalizeInput,
  shouldStop,
}: {
  stage: WorldGenerationStageName;
  system: string;
  buildUser: (correctionNotes: string | null) => string;
  schema: z.ZodType<T>;
  tool: StructuredTool;
  attempts: OpenWorldGenerationArtifacts["attempts"];
  validationReports: OpenWorldGenerationArtifacts["validationReports"];
  stageSummaries: OpenWorldGenerationArtifacts["stageSummaries"];
  prompt?: string;
  promptIntentProfile?: PromptIntentProfile;
  validate?: (parsed: T) => StageValidation[] | Promise<StageValidation[]>;
  summarize?: (parsed: T) => string;
  normalizeInput?: (input: unknown) => unknown;
  shouldStop?: () => boolean;
}): Promise<T> {
  let correctionNotes: string | null = null;
  const maxAttempts = getMaxWorldStageAttempts(stage);
  const resolvedPrompt = prompt ?? "";
  const resolvedPromptIntentProfile = promptIntentProfile ?? DEFAULT_PROMPT_INTENT_PROFILE;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (shouldStop?.()) {
      throw new WorldGenerationStoppedError();
    }

    logOpenRouterResponse(`${stage}.attempt`, {
      stage,
      attempt,
      maxAttempts,
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

    if (shouldStop?.()) {
      throw new WorldGenerationStoppedError();
    }

    logOpenRouterResponse(`${stage}.raw_input`, {
      attempt,
      finishReason: response?.finishReason ?? null,
      likelyTruncated: response?.likelyTruncated ?? false,
      preview: toPreview(response?.input),
    });

    const normalizedInput = normalizeInput ? normalizeInput(response?.input) : response?.input;
    const parsed = schema.safeParse(normalizedInput);

    if (response?.likelyTruncated && !parsed.success) {
      const issues = buildStageTruncationRecoveryIssues(stage);

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

      if (attempt === maxAttempts) {
        throw new Error(`${stage} response was truncated before the structured payload completed.`);
      }

      correctionNotes = formatCorrectionNotes({
        stage,
        category: "schema",
        issues,
        userPrompt: resolvedPrompt,
        promptIntentProfile: resolvedPromptIntentProfile,
      });
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

      if (attempt === maxAttempts) {
        throw new Error(`${stage} returned invalid structured data: ${parsed.error.message}`);
      }

      correctionNotes = formatCorrectionNotes({
        stage,
        category: "schema",
        issues: describeZodIssues(parsed.error.issues).split("\n"),
        userPrompt: resolvedPrompt,
        promptIntentProfile: resolvedPromptIntentProfile,
      });
      continue;
    }

    const validations = validate ? await validate(parsed.data) : [];
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
      if (attempt === maxAttempts) {
        throw new Error(
          `${stage} ${failedValidation.category} failed: ${failedValidation.issues.join("; ")}`,
        );
      }

      correctionNotes = failedValidation.correctionNotes?.length
        ? failedValidation.correctionNotes.join("\n")
        : formatCorrectionNotes({
          stage,
          category: failedValidation.category,
          issues: failedValidation.issues,
          userPrompt: resolvedPrompt,
          promptIntentProfile: resolvedPromptIntentProfile,
        });
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
    `Supply conditions: ${tradeIdentity.supplyConditions.toLowerCase()}.`,
    `Material life: ${tradeIdentity.materialLife.toLowerCase()}.`,
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
  "Define the wide but lived-in objective reality for an open-world campaign module.",
  generatedWorldBibleSchema,
);

const promptIntentTool = createStructuredTool(
  "infer_world_prompt_intent",
  "Infer the prompt's dominant texture, causal logic, magic integration, social emphasis, and confidence without inventing extra world details.",
  promptIntentProfileSchema,
);

const worldBibleCritiqueFieldSchema = z.enum([
  "groundLevelReality",
  "widespreadBurdens",
  "presentScars",
  "sharedRealities",
  "explanationThreads",
  "everydayLife.institutions",
  "everydayLife.gossip",
]);

const worldBibleCritiqueSchema = z.object({
  verdict: z.enum(["accept", "revise"]),
  abstractTerms: z
    .array(
      z.object({
        field: worldBibleCritiqueFieldSchema,
        term: z.string().trim().min(1),
      }),
    )
    .max(12),
  genericTitles: z
    .array(
      z.object({
        field: worldBibleCritiqueFieldSchema,
        title: z.string().trim().min(1),
      }),
    )
    .max(12),
  fieldIssues: z
    .array(
      z.object({
        field: worldBibleCritiqueFieldSchema,
        issue: z.string().trim().min(1),
        offendingText: z.string().trim().min(1),
      }),
    )
    .max(8),
  correctionNotes: z.array(z.string().trim().min(1)).max(6),
});

const worldSpineScaleCritiqueSchema = z.object({
  verdict: z.enum(["accept", "revise"]),
  fieldIssues: z
    .array(
      z.object({
        locationName: z.string().trim().min(1),
        issue: z.string().trim().min(1),
        offendingText: z.string().trim().min(1),
      }),
    )
    .max(8),
  correctionNotes: z.array(z.string().trim().min(1)).max(6),
});

const socialCastScaleCritiqueSchema = z.object({
  verdict: z.enum(["accept", "revise"]),
  fieldIssues: z
    .array(
      z.object({
        npcName: z.string().trim().min(1),
        issue: z.string().trim().min(1),
        offendingText: z.string().trim().min(1),
      }),
    )
    .max(8),
  correctionNotes: z.array(z.string().trim().min(1)).max(6),
});

const regionalLifeCritiqueSchema = z.object({
  verdict: z.enum(["accept", "revise"]),
  fieldIssues: z.array(
    z.object({
      locationId: z.string().trim().min(1),
      issue: z.string().trim().min(1),
      offendingText: z.string().trim().min(1),
    }),
  ).max(8),
  correctionNotes: z.array(z.string().trim().min(1)).max(6),
});

const knowledgeWebCritiqueSchema = z.object({
  verdict: z.enum(["accept", "revise"]),
  fieldIssues: z.array(
    z.object({
      title: z.string().trim().min(1),
      issue: z.string().trim().min(1),
      offendingText: z.string().trim().min(1),
    }),
  ).max(10),
  correctionNotes: z.array(z.string().trim().min(1)).max(6),
});

const knowledgeThreadsCritiqueSchema = z.object({
  verdict: z.enum(["accept", "revise"]),
  fieldIssues: z.array(
    z.object({
      field: z.enum(["knowledgeNetworks", "pressureSeeds"]),
      issue: z.string().trim().min(1),
      offendingText: z.string().trim().min(1),
    }),
  ).max(8),
  correctionNotes: z.array(z.string().trim().min(1)).max(6),
});

const economyMaterialLifeCritiqueSchema = z.object({
  verdict: z.enum(["accept", "revise"]),
  fieldIssues: z.array(
    z.object({
      locationId: z.string().trim().min(1),
      issue: z.string().trim().min(1),
      offendingText: z.string().trim().min(1),
    }),
  ).max(10),
  correctionNotes: z.array(z.string().trim().min(1)).max(6),
});

const worldSpineFactionsSchema = z.object({
  factions: generatedWorldSpineSchema.shape.factions,
});

const worldSpineLocationPlanSchema = z.object({
  locationCount: z.union([z.literal(9), z.literal(12), z.literal(15), z.literal(18)]),
});

function normalizeWorldSpineLocationPlanInput(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return input;
  }

  const candidate = input as Record<string, unknown>;
  const rawLocationCount = candidate.locationCount;
  if (typeof rawLocationCount !== "string") {
    return input;
  }

  const trimmed = rawLocationCount.trim();
  if (!/^\d+$/.test(trimmed)) {
    return input;
  }

  return {
    ...candidate,
    locationCount: Number(trimmed),
  };
}

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
  `Choose how many world spine locations to generate. Must be one of ${WORLD_SPINE_LOCATION_CHOICES_TEXT}.`,
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

const worldBibleCritiqueTool = createStructuredTool(
  "critique_world_bible",
  "Critique whether a generated world bible feels like a lived-in place instead of a generic campaign setting.",
  worldBibleCritiqueSchema,
);

const worldSpineScaleCritiqueTool = createStructuredTool(
  "critique_world_spine_scale",
  "Critique whether world-scale spine locations read like macro regions or civilizations instead of local sites.",
  worldSpineScaleCritiqueSchema,
);

const socialCastScaleCritiqueTool = createStructuredTool(
  "critique_social_cast_scale",
  "Critique whether world-scale social cast NPCs stay anchored to macro-regional public systems rather than local addresses.",
  socialCastScaleCritiqueSchema,
);

const regionalLifeCritiqueTool = createStructuredTool(
  "critique_regional_life_texture",
  "Critique whether regional life outputs are varied and lived-in rather than collapsing into one scarcity-administration house style.",
  regionalLifeCritiqueSchema,
);

const knowledgeWebCritiqueTool = createStructuredTool(
  "critique_knowledge_web_texture",
  "Critique whether information nodes preserve varied lived texture instead of only failure, scandal, and administrative pressure.",
  knowledgeWebCritiqueSchema,
);

const knowledgeThreadsCritiqueTool = createStructuredTool(
  "critique_knowledge_threads_texture",
  "Critique whether worldview clusters preserve contested beliefs and social meaning rather than collapsing only into pressure.",
  knowledgeThreadsCritiqueSchema,
);

const economyMaterialLifeCritiqueTool = createStructuredTool(
  "critique_economy_material_life_texture",
  "Critique whether economy and trade identity outputs preserve varied material texture instead of only scarcity and contraband pressure.",
  economyMaterialLifeCritiqueSchema,
);

const regionalLifeTool = createStructuredTool(
  "generate_regional_life",
  "Generate regional daily life, pressures, hazards, and ordinary knowledge for each location.",
  generatedRegionalLifeSchema,
);

const socialCastTool = createStructuredTool(
  "generate_social_cast",
  "Generate socially grounded NPCs who belong to the world and interface with the public through ordinary routines and systems.",
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

const openingTool = {
  name: "generate_campaign_opening",
  description: "Generate the opening scene for a chosen entry point.",
  input_schema: z.toJSONSchema(generatedCampaignOpeningSchema),
};

const openingRewriteIntentSchema = z.object({
  canonicalScope: z.enum(["opening_only", "wants_entry_change", "unclear"]),
  tensionDirection: z.enum(["calmer", "tenser", "same"]),
  confrontationCarryForward: z.enum(["remove", "preserve", "unclear"]),
  notes: z.string().trim().min(1),
});

const openingRewriteIntentTool = createStructuredTool(
  "interpret_opening_rewrite",
  "Interpret what a player's opening-scene rewrite prompt is actually trying to change.",
  openingRewriteIntentSchema,
);

const customEntryIntentSchema = z.object({
  activityFrame: z.enum(["routine_work", "private_project", "travel_prep", "urgent_hook", "unclear"]),
  socialAnchorPreference: z.enum(["solitary", "ambient_locals", "named_contact", "unclear"]),
  informationLeadPreference: z.enum(["none", "ambient_public", "named_hook", "unclear"]),
  notes: z.string().trim().min(1),
});

const customEntryIntentTool = createStructuredTool(
  "interpret_custom_entry_intent",
  "Interpret the desired shape of a player-authored custom entry before resolving it into world data.",
  customEntryIntentSchema,
);

const customEntryResolutionTool = createStructuredTool(
  "resolve_custom_entry_point",
  "Resolve a player-authored custom entry into an existing grounded launch entry using only provided ids.",
  customResolvedLaunchEntryDraftSchema,
);

const promotedNpcHydrationSchema = z.object({
  name: z.string().trim().min(1).nullable().optional().default(null),
  summary: z.string().trim().min(1),
  description: z.string().trim().min(1),
  factionId: z.string().trim().min(1).nullable(),
  information: z.array(
    z.object({
      title: z.string().trim().min(1),
      summary: z.string().trim().min(1),
      content: z.string().trim().min(1),
      truthfulness: z.enum(["true", "partial", "false", "outdated"]),
      accessibility: z.enum(["public", "guarded", "secret"]),
      locationId: z.string().trim().min(1).nullable(),
      factionId: z.string().trim().min(1).nullable(),
    }),
  ).max(2),
});

const promotedNpcHydrationTool = {
  name: "hydrate_promoted_npc",
  description: "Hydrate a recurring local NPC with grounded identity, summary, description, and optional local leads.",
  input_schema: z.toJSONSchema(promotedNpcHydrationSchema),
};

const startingLocalNpcSchema = z.object({
  name: z.string().trim().min(1),
  role: z.string().trim().min(1),
  tags: z.array(z.string().trim().min(1)).max(6).default([]),
  summary: z.string().trim().min(1),
  description: z.string().trim().min(1),
  factionId: z.string().trim().min(1).nullable(),
  currentLocationId: z.string().trim().min(1),
  approval: z.number().int().min(-5).max(5),
  isCompanion: z.literal(false).default(false),
});

const startingLocalHydrationSchema = z.object({
  npcs: z.array(startingLocalNpcSchema).min(2).max(6),
});

const startingLocalHydrationTool = {
  name: "generate_starting_local_npcs",
  description: "Generate ordinary persistent locals around a campaign's starting region.",
  input_schema: z.toJSONSchema(startingLocalHydrationSchema),
};

const dailyWorldScheduleSchema = z.object({
  worldEvents: z.array(
    z.object({
      locationId: z.string().trim().min(1).nullable(),
      triggerTime: z.number().int(),
      description: z.string().trim().min(1),
      triggerCondition: z.record(z.string(), z.unknown()).nullable().optional(),
      payload: z.record(z.string(), z.unknown()),
      cascadeDepth: z.number().int().min(0).max(3).optional(),
    }),
  ).max(12),
  factionMoves: z.array(
    z.object({
      factionId: z.string().trim().min(1),
      scheduledAtTime: z.number().int(),
      description: z.string().trim().min(1),
      payload: z.record(z.string(), z.unknown()),
      cascadeDepth: z.number().int().min(0).max(3).optional(),
    }),
  ).max(8),
});

const dailyWorldScheduleTool = {
  name: "generate_daily_world_schedule",
  description: "Generate the next in-world day of world events and faction moves for the living world.",
  input_schema: z.toJSONSchema(dailyWorldScheduleSchema),
};

const requestClarificationSchema = z.object({
  type: z.literal("request_clarification"),
  question: z.string().trim().min(1),
  options: z.array(z.string().trim().min(1)).max(4),
});

const requestClarificationTool = createStructuredTool(
  "request_clarification",
  "Ask the player to clarify when the action cannot be safely mapped.",
  requestClarificationSchema.omit({ type: true }),
);

const requiredPrerequisiteSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("market_prices"),
    locationId: z.string().trim().min(1),
  }),
  z.object({
    type: z.literal("npc_detail"),
    npcId: z.string().trim().min(1),
  }),
  z.object({
    type: z.literal("faction_intel"),
    factionId: z.string().trim().min(1),
  }),
  z.object({
    type: z.literal("information_detail"),
    informationId: z.string().trim().min(1),
  }),
  z.object({
    type: z.literal("information_connections"),
    informationIds: z.array(z.string().trim().min(1)).min(1).max(4),
  }),
  z.object({
    type: z.literal("relationship_history"),
    npcId: z.string().trim().min(1),
  }),
]);

const routerClarificationSchema = z.object({
  needed: z.boolean().default(false),
  blocker: z
    .enum(["missing_target", "missing_item", "missing_destination", "unclear_intent"])
    .nullable()
    .default(null),
  question: z.string().trim().min(1).max(180).nullable().default(null),
  options: z.array(z.string().trim().min(1).max(80)).max(4).default([]),
}).optional().default({
  needed: false,
  blocker: null,
  question: null,
  options: [],
});

const routerResolvedReferentSchema = z.object({
  phrase: z.string().trim().min(1).max(80),
  targetRef: z.string().trim().min(1).max(120).refine(
    (value) => !value.startsWith("spawn:"),
    "resolved referents must not use spawn handles",
  ),
  targetKind: z.enum(["scene_actor", "known_npc", "inventory_item", "world_object", "route", "information", "location"]),
  confidence: z.enum(["high", "medium"]),
});

const routerUnresolvedReferentSchema = z.object({
  phrase: z.string().trim().min(1).max(80),
  intendedKind: z.enum(["temporary_actor", "environmental_item", "scene_aspect"]),
  confidence: z.enum(["high", "medium"]),
});

const routerImpliedDestinationFocusSchema = z.object({
  key: z.string().trim().min(1).max(80),
  label: z.string().trim().min(1).max(120),
});

  const routerAttentionSchema = z.object({
  primaryIntent: z.string().trim().min(1).max(160),
  resolvedReferents: z.array(routerResolvedReferentSchema).max(6).default([]),
  unresolvedReferents: z.array(routerUnresolvedReferentSchema).max(6).default([]),
  impliedDestinationFocus: z.preprocess(
    (value) => (value === null ? undefined : value),
    routerImpliedDestinationFocusSchema.nullable().optional().default(null),
  ),
  mustCheck: z.array(
    z.enum(["sceneActors", "knownNpcs", "sceneAspects", "worldObjects", "inventory", "routes", "currency", "fetchedFacts", "recentTurnLedger"]),
  ).max(7).default([]),
}).optional().default({
  primaryIntent: "Resolve the player action conservatively from grounded context.",
  resolvedReferents: [],
  unresolvedReferents: [],
  impliedDestinationFocus: null,
  mustCheck: [],
});

const ROUTER_REASON_MAX_CHARS = 360;

const routerDecisionSchema = z.object({
  profile: z.enum(["local", "full"]),
  confidence: z.enum(["high", "low"]),
  authorizedVectors: z
    .array(z.enum(["economy_light", "economy_strict", "violence", "converse", "investigate"]))
    .max(5)
    .default([]),
  requiredPrerequisites: z.array(requiredPrerequisiteSchema).max(3).default([]),
  reason: z.string().trim().min(1).max(ROUTER_REASON_MAX_CHARS),
  clarification: routerClarificationSchema,
  attention: routerAttentionSchema,
});

const LEGACY_APPROACH_IDS = [
  "force",
  "finesse",
  "endure",
  "analyze",
  "notice",
  "influence",
] as const;

function buildApproachIdSchema(approachIds?: string[]) {
  const ids = Array.from(new Set(
    (approachIds?.length ? approachIds : [...LEGACY_APPROACH_IDS])
      .map((value) => value.trim())
      .filter(Boolean),
  ));

  if (ids.length === 0) {
    return z.string().trim().min(1);
  }

  const [firstId, ...restIds] = ids;
  return z.enum([firstId, ...restIds]);
}

function buildCheckIntentSchema(approachIds?: string[]) {
  const approachIdSchema = buildApproachIdSchema(approachIds);
  if (approachIds?.length) {
    return z.discriminatedUnion("type", [
      z.object({
        type: z.literal("challenge"),
        reason: z.string().trim().min(1).max(240),
        approachId: approachIdSchema,
        citedNpcId: z.string().trim().min(1).optional(),
        mode: z.enum(["normal", "advantage", "disadvantage"]).optional(),
      }),
      z.object({
        type: z.literal("combat"),
        reason: z.string().trim().min(1).max(240),
        targetNpcId: z.string().trim().min(1),
        approachId: approachIdSchema,
        mode: z.enum(["normal", "advantage", "disadvantage"]).optional(),
      }),
    ]);
  }

  return z.discriminatedUnion("type", [
    z.object({
      type: z.literal("challenge"),
      reason: z.string().trim().min(1).max(240),
      approachId: approachIdSchema.optional(),
      challengeApproach: buildApproachIdSchema().optional(),
      citedNpcId: z.string().trim().min(1).optional(),
      mode: z.enum(["normal", "advantage", "disadvantage"]).optional(),
    }),
    z.object({
      type: z.literal("combat"),
      reason: z.string().trim().min(1).max(240),
      targetNpcId: z.string().trim().min(1),
      approachId: approachIdSchema.optional(),
      approach: z.enum(["attack", "subdue", "assassinate"]).optional(),
      mode: z.enum(["normal", "advantage", "disadvantage"]).optional(),
    }),
  ]);
}

const assetHolderSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("player"),
  }),
  z.object({
    kind: z.literal("actor"),
    actorId: z.string().trim().min(1),
  }),
  z.object({
    kind: z.literal("npc"),
    npcId: z.string().trim().min(1),
  }),
  z.object({
    kind: z.literal("temporary_actor"),
    actorId: z.string().trim().min(1),
  }),
  z.object({
    kind: z.literal("world_object"),
    objectId: z.string().trim().min(1),
  }),
  z.object({
    kind: z.literal("scene"),
    locationId: z.string().trim().min(1),
    focusKey: z.string().trim().min(1).nullable().optional(),
  }),
]);

const mechanicsMutationSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("advance_time"),
    durationMinutes: z.number().int().positive().max(2880).optional(),
    phase: z.enum(["immediate", "conditional"]).optional(),
  }),
  z.object({
    type: z.literal("start_journey"),
    edgeId: z.string().trim().min(1),
    destinationLocationId: z.string().trim().min(1),
    phase: z.enum(["immediate", "conditional"]).optional(),
  }),
  z.object({
    type: z.literal("move_player"),
    targetLocationId: z.string().trim().min(1),
    relocationReason: z.enum([
      "teleportation",
      "magical_portal",
      "trap_relocation",
      "forced_transport",
    ]),
    phase: z.enum(["immediate", "conditional"]).optional(),
  }),
  z.object({
    type: z.literal("arrive_at_destination"),
    authoredTimeElapsedMinutes: z.number().int().min(0).max(2880),
    phase: z.enum(["immediate", "conditional"]).optional(),
  }),
  z.object({
    type: z.literal("turn_back_travel"),
    authoredTimeElapsedMinutes: z.number().int().min(0).max(2880),
    phase: z.enum(["immediate", "conditional"]).optional(),
  }),
  z.object({
    type: z.literal("resolve_discovery_hook"),
    hookAlias: z.string().trim().min(1).max(120),
    reason: z.string().trim().min(1).max(160),
    phase: z.enum(["immediate", "conditional"]).optional(),
  }),
  z.object({
    type: z.literal("force_reveal_discovery"),
    targetAlias: z.string().trim().min(1).max(120),
    reason: z.string().trim().min(1).max(160),
    phase: z.enum(["immediate", "conditional"]).optional(),
  }),
  z.object({
    type: z.literal("adjust_currency"),
    delta: currencyDenominationsSchema,
    reason: z.string().trim().min(1).max(120),
    phase: z.enum(["immediate", "conditional"]).optional(),
  }),
  z.object({
    type: z.literal("record_actor_interaction"),
    actorId: z.string().trim().min(1),
    interactionSummary: z.string().trim().min(1).max(240),
    topic: z.string().trim().min(1).max(80).optional(),
    socialOutcome: z.enum(SOCIAL_OUTCOMES),
    phase: z.enum(["immediate", "conditional"]).optional(),
  }),
  z.object({
    type: z.literal("record_local_interaction"),
    localEntityId: z.string().trim().min(1),
    interactionSummary: z.string().trim().min(1).max(240),
    topic: z.string().trim().min(1).max(80).optional(),
    socialOutcome: z.enum(SOCIAL_OUTCOMES),
    phase: z.enum(["immediate", "conditional"]).optional(),
  }),
  z.object({
    type: z.literal("record_npc_interaction"),
    npcId: z.string().trim().min(1),
    interactionSummary: z.string().trim().min(1).max(240),
    topic: z.string().trim().min(1).max(80).optional(),
    socialOutcome: z.enum(SOCIAL_OUTCOMES),
    phase: z.enum(["immediate", "conditional"]).optional(),
  }),
  z.object({
    type: z.literal("spawn_scene_aspect"),
    aspectName: z.string().trim().min(1).max(80),
    state: z.string().trim().min(1).max(160),
    duration: z.enum(["scene", "permanent"]),
    reason: z.string().trim().min(1).max(120),
    phase: z.enum(["immediate", "conditional"]).optional(),
  }),
  z.object({
    type: z.literal("spawn_temporary_actor"),
    spawnKey: z.string().trim().min(1).max(60),
    role: z.string().trim().min(1).max(80),
    summary: z.string().trim().min(1).max(240),
    apparentDisposition: z.string().trim().min(1).max(80),
    reason: z.string().trim().min(1).max(120),
    phase: z.enum(["immediate", "conditional"]).optional(),
  }),
  z.object({
    type: z.literal("spawn_world_object"),
    spawnKey: z.string().trim().min(1).max(60),
    name: z.string().trim().min(1).max(120),
    holder: assetHolderSchema,
    storageCapacity: z.number().int().positive().max(999).optional(),
    securityIsLocked: z.boolean().optional(),
    securityKeyItemTemplateId: z.string().trim().min(1).optional(),
    concealmentIsHidden: z.boolean().optional(),
    vehicleIsHitched: z.boolean().optional(),
    reason: z.string().trim().min(1).max(120),
    phase: z.enum(["immediate", "conditional"]).optional(),
  }),
  z.object({
    type: z.literal("spawn_environmental_item"),
    spawnKey: z.string().trim().min(1).max(60),
    itemName: z.string().trim().min(1).max(80),
    description: z.string().trim().min(1).max(240),
    quantity: z.number().int().positive().max(12),
    holder: assetHolderSchema,
    reason: z.string().trim().min(1).max(120),
    phase: z.enum(["immediate", "conditional"]).optional(),
  }),
  z.object({
    type: z.literal("spawn_fiat_item"),
    spawnKey: z.string().trim().min(1).max(60),
    itemName: z.string().trim().min(1).max(80),
    description: z.string().trim().min(1).max(240),
    quantity: z.number().int().positive().max(12),
    holder: assetHolderSchema,
    reason: z.string().trim().min(1).max(120),
    phase: z.enum(["immediate", "conditional"]).optional(),
  }),
  z.object({
    type: z.literal("commit_market_trade"),
    action: z.enum(["buy", "sell"]),
    marketPriceId: z.string().trim().min(1),
    commodityId: z.string().trim().min(1),
    quantity: z.number().int().positive(),
    phase: z.enum(["immediate", "conditional"]).optional(),
  }),
  z.object({
    type: z.literal("transfer_assets"),
    source: assetHolderSchema,
    destination: assetHolderSchema,
    currencyAmount: currencyDenominationsSchema.refine((value) => Object.values(value).every((entry) => (entry ?? 0) > 0), {
      message: "Transfer currency amounts must be positive.",
    }).optional(),
    itemInstanceIds: z.array(z.string().trim().min(1)).max(12).optional(),
    worldObjectIds: z.array(z.string().trim().min(1)).max(8).optional(),
    templateTransfers: z.array(
      z.object({
        templateId: z.string().trim().min(1),
        quantity: z.number().int().positive(),
      }),
    ).max(8).optional(),
    commodityTransfers: z.array(
      z.object({
        commodityId: z.string().trim().min(1),
        quantity: z.number().int().positive(),
      }),
    ).max(8).optional(),
    npcTransferMode: z.enum(["willing", "stealth", "force"]).optional(),
    reason: z.string().trim().min(1).max(120),
    phase: z.enum(["immediate", "conditional"]).optional(),
  }),
  z.object({
    type: z.literal("adjust_inventory"),
    itemId: z.string().trim().min(1),
    quantity: z.number().int().positive(),
    action: z.enum(["add", "remove"]),
    reason: z.string().trim().min(1).max(120),
    phase: z.enum(["immediate", "conditional"]).optional(),
  }),
  z.object({
    type: z.literal("adjust_relationship"),
    npcId: z.string().trim().min(1),
    delta: z.number().int(),
    reason: z.string().trim().min(1).max(120),
    phase: z.enum(["immediate", "conditional"]).optional(),
  }),
  z.object({
    type: z.literal("discover_information"),
    informationId: z.string().trim().min(1),
    phase: z.enum(["immediate", "conditional"]).optional(),
  }),
  z.object({
    type: z.literal("set_actor_state"),
    actorId: z.string().trim().min(1),
    newState: z.enum(["active", "wounded", "incapacitated", "dead"]),
    phase: z.enum(["immediate", "conditional"]).optional(),
  }),
  z.object({
    type: z.literal("set_npc_state"),
    npcId: z.string().trim().min(1),
    newState: z.enum(["active", "wounded", "incapacitated", "dead"]),
    phase: z.enum(["immediate", "conditional"]).optional(),
  }),
  z.object({
    type: z.literal("set_player_scene_focus"),
    focusKey: z.string().trim().min(1).max(80),
    label: z.string().trim().min(1).max(120),
    reason: z.string().trim().min(1).max(120),
    phase: z.enum(["immediate", "conditional"]).optional(),
  }),
  z.object({
    type: z.literal("set_scene_actor_presence"),
    actorRef: z.string().trim().min(1),
    newLocationId: z.string().trim().min(1).nullable(),
    reason: z.string().trim().min(1).max(120),
    phase: z.enum(["immediate", "conditional"]).optional(),
  }),
  z.object({
    type: z.literal("update_world_object_state"),
    objectId: z.string().trim().min(1),
    isLocked: z.boolean().optional(),
    isHidden: z.boolean().optional(),
    isHitched: z.boolean().optional(),
    reason: z.string().trim().min(1).max(120),
    phase: z.enum(["immediate", "conditional"]).optional(),
  }),
  z.object({
    type: z.literal("update_item_state"),
    instanceId: z.string().trim().min(1),
    isEquipped: z.boolean().optional(),
    chargesDelta: z.number().int().optional(),
    propertiesPatch: z.record(z.string(), z.string()).optional(),
    reason: z.string().trim().min(1).max(120),
    phase: z.enum(["immediate", "conditional"]).optional(),
  }),
  z.object({
    type: z.literal("update_character_state"),
    conditionsAdded: z.array(z.string().trim().min(1).max(80)).max(8).optional(),
    conditionsRemoved: z.array(z.string().trim().min(1).max(80)).max(8).optional(),
    reason: z.string().trim().min(1).max(120),
    phase: z.enum(["immediate", "conditional"]).optional(),
  }),
  z.object({
    type: z.literal("update_scene_object"),
    objectId: z.string().trim().min(1),
    newState: z.string().trim().min(1).max(120),
    reason: z.string().trim().min(1).max(120),
    phase: z.enum(["immediate", "conditional"]).optional(),
  }),
  z.object({
    type: z.literal("set_follow_state"),
    actorRef: z.string().trim().min(1),
    isFollowing: z.boolean(),
    reason: z.string().trim().min(1).max(120),
    phase: z.enum(["immediate", "conditional"]).optional(),
  }),
  z.object({
    type: z.literal("restore_health"),
    mode: z.enum(["light_rest", "full_rest", "amount"]),
    amount: z.number().int().positive().optional(),
    phase: z.enum(["immediate", "conditional"]).optional(),
  }),
]);

function buildResolveMechanicsSchema(approachIds?: string[]) {
  return z.object({
    type: z.literal("resolve_mechanics"),
    timeMode: z.enum(["combat", "exploration", "travel", "rest", "downtime"]),
    durationMagnitude: z.enum(["instant", "brief", "standard", "extended", "long"]).optional(),
    suggestedActions: z.array(z.string().trim().min(1)).max(4).default([]),
    memorySummary: z.string().trim().min(1).max(240).optional(),
    checkIntent: z.preprocess(
      (value) => (value === null ? undefined : value),
      buildCheckIntentSchema(approachIds).optional(),
    ),
    mutations: z.array(mechanicsMutationSchema).max(8).default([]),
  });
}

const executeFastForwardSchema = z.object({
  type: z.literal("execute_fast_forward"),
  requestedDurationMinutes: z.number().int().positive(),
  routineSummary: z.string().trim().min(1).max(240),
  recurringActivities: z.array(z.string().trim().min(1).max(160)).max(6).default([]),
  intendedOutcomes: z.array(z.string().trim().min(1).max(160)).max(6).default([]),
  resourceCosts: z.object({
    currencyCp: z.number().int().positive().optional(),
    itemRemovals: z.array(z.object({
      templateId: z.string().trim().min(1),
      quantity: z.number().int().positive(),
    })).max(8).optional(),
  }).optional(),
  warnings: z.array(z.string().trim().min(1)).max(6).optional(),
  memorySummary: z.string().trim().min(1).max(240).optional(),
});

function buildTurnActionSchemas(approachIds?: string[]) {
  const resolveMechanicsSchema = buildResolveMechanicsSchema(approachIds);
  const turnActionToolCallSchema = z.discriminatedUnion("type", [
    requestClarificationSchema,
    resolveMechanicsSchema,
    executeFastForwardSchema,
  ]);

  return {
    resolveMechanicsSchema,
    turnActionToolCallSchema,
    resolveMechanicsTool: createStructuredTool(
      "resolve_mechanics",
      "Return the bounded mechanical plan for this turn using only engine-validated mutations.",
      resolveMechanicsSchema.omit({ type: true }),
    ),
  };
}

const defaultTurnActionSchemas = buildTurnActionSchemas();
const resolveMechanicsSchema = defaultTurnActionSchemas.resolveMechanicsSchema;
const turnActionToolCallSchema = defaultTurnActionSchemas.turnActionToolCallSchema;
const resolveMechanicsTool = defaultTurnActionSchemas.resolveMechanicsTool;

const executeFastForwardTool = createStructuredTool(
  "execute_fast_forward",
  [
    "Use only when the player explicitly asks to compress multiple days or weeks into a routine montage.",
    "Do not use for a single evening, a single day of downtime, or any scene-by-scene interaction.",
    "Do not use during combat, active pursuit, or unstable tactical play.",
    "Provide aggregate upkeep only; do not include scene mutations.",
  ].join(" "),
  executeFastForwardSchema.omit({ type: true }),
);

const classifyTurnIntentTool = createStructuredTool(
  "classify_turn_intent",
  "Choose prompt scope, authorization vectors, and deterministic prerequisite fetches for the turn.",
  routerDecisionSchema,
);

const resolvedTurnNarrationSchema = z.object({
  narration: z.string().trim().min(1).max(1500),
});

const resolvedTurnNarrationTool = createStructuredTool(
  "narrate_resolved_turn",
  "Generate player-facing Dungeon Master narration using only the committed state log and the player's action.",
  resolvedTurnNarrationSchema,
);

const resolvedTurnSuggestedActionsSchema = z.object({
  suggestedActions: z.array(z.string().trim().min(1)).max(4).default([]),
});

const resolvedTurnSuggestedActionsTool = createStructuredTool(
  "suggest_resolved_turn_actions",
  "Generate up to four grounded next-action suggestions using only committed outcomes and current authoritative state.",
  resolvedTurnSuggestedActionsSchema,
);

const ROUTER_MUST_CHECK_DEPRIORITY: RouterDecision["attention"]["mustCheck"] = [
  "recentTurnLedger",
  "routes",
  "currency",
  "fetchedFacts",
  "inventory",
  "worldObjects",
  "sceneAspects",
  "knownNpcs",
  "sceneActors",
];

function clampRouterMustCheck(
  values: readonly RouterDecision["attention"]["mustCheck"][number][],
): RouterDecision["attention"]["mustCheck"] {
  const deduped = Array.from(new Set(values));
  if (deduped.length <= 7) {
    return deduped as RouterDecision["attention"]["mustCheck"];
  }

  const prioritized = [...deduped].sort((left, right) => {
    const leftRank = ROUTER_MUST_CHECK_DEPRIORITY.indexOf(left);
    const rightRank = ROUTER_MUST_CHECK_DEPRIORITY.indexOf(right);
    return leftRank - rightRank;
  });
  const dropped = new Set(prioritized.slice(0, Math.max(0, prioritized.length - 7)));
  return deduped.filter((entry) => !dropped.has(entry)) as RouterDecision["attention"]["mustCheck"];
}

function normalizeRouterDecisionInput(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  const record = value as Record<string, unknown>;
  const attentionRaw =
    record.attention && typeof record.attention === "object" && !Array.isArray(record.attention)
      ? { ...(record.attention as Record<string, unknown>) }
      : null;

  if (!attentionRaw || !Array.isArray(attentionRaw.mustCheck)) {
    return value;
  }

  const mustCheck = attentionRaw.mustCheck
    .filter((entry): entry is RouterDecision["attention"]["mustCheck"][number] => typeof entry === "string")
    .filter((entry): entry is RouterDecision["attention"]["mustCheck"][number] =>
      ["sceneActors", "knownNpcs", "sceneAspects", "worldObjects", "inventory", "routes", "currency", "fetchedFacts", "recentTurnLedger"].includes(entry),
    );

  attentionRaw.mustCheck = clampRouterMustCheck(mustCheck);
  return {
    ...record,
    attention: attentionRaw,
  };
}

function isPlaceholderResolvedTargetRef(entry: {
  targetRef: string;
  targetKind: RouterDecision["attention"]["resolvedReferents"][number]["targetKind"];
}) {
  const normalized = entry.targetRef.trim().toLowerCase();
  switch (entry.targetKind) {
    case "scene_actor":
      return ["scene_actor", "temporary_actor", "actor", "npc", "person", "customer"].includes(normalized);
    case "known_npc":
      return ["known_npc", "npc", "person", "named_npc"].includes(normalized);
    case "inventory_item":
      return ["inventory_item", "item", "inventory", "object"].includes(normalized);
    case "world_object":
      return ["world_object", "object"].includes(normalized);
    case "route":
      return ["route", "path", "destination"].includes(normalized);
    case "information":
      return ["information", "clue", "fact"].includes(normalized);
    case "location":
      return ["location", "place", "destination"].includes(normalized);
    default:
      return false;
  }
}

function normalizeSceneActorRef(
  context: TurnRouterContext | undefined,
  targetRef: string,
): string {
  const normalized = targetRef.trim();
  if (!context) {
    return normalized;
  }

  const sceneActor = context.sceneActors.find((actor) => {
    if (actor.actorRef === normalized) {
      return true;
    }
    if (normalized.startsWith("actor:")) {
      const actorId = normalized.slice("actor:".length).trim();
      return actor.actorId === actorId;
    }
    if (normalized.startsWith("npc:")) {
      const npcId = normalized.slice("npc:".length).trim();
      return actor.profileNpcId === npcId;
    }
    if (normalized.startsWith("temp:")) {
      const actorId = normalized.slice("temp:".length).trim();
      return actor.actorId === actorId;
    }
    return actor.actorRef === `actor:${normalized}`
      || actor.actorRef === `npc:${normalized}`
      || actor.actorRef === `temp:${normalized}`
      || actor.actorId === normalized
      || actor.profileNpcId === normalized;
  });
  return sceneActor?.actorRef ?? normalized;
}

function normalizeKnownNpcId(
  context: TurnRouterContext | undefined,
  targetRef: string,
  phrase?: string,
): string {
  const normalized = targetRef.trim();
  const candidatePool = [
    ...(context?.knownNearbyNpcs ?? []),
    ...(context?.sceneActors
      .filter((actor): actor is typeof actor & { profileNpcId: string } =>
        actor.kind === "npc" && typeof actor.profileNpcId === "string")
      .map((actor) => ({
        id: actor.profileNpcId,
        name: actor.displayLabel,
        role: actor.role,
      })) ?? []),
  ];

  if (!context) {
    return normalized.startsWith("npc:") ? normalized.slice("npc:".length).trim() : normalized;
  }

  return canonicalizeNpcIdAgainstCandidates({
    rawNpcId: normalized,
    candidates: candidatePool,
    phrase,
  });
}

function sceneActorMatchesExplicitPhrase(actor: TurnRouterContext["sceneActors"][number], phrase: string): boolean {
  const normalizedPhrase = phrase.trim().toLowerCase();
  if (!normalizedPhrase) {
    return false;
  }

  return actor.displayLabel.trim().toLowerCase() === normalizedPhrase || actor.role.trim().toLowerCase() === normalizedPhrase;
}

function isGroundedResolvedReferent(
  context: TurnRouterContext | undefined,
  entry: {
    targetRef: string;
    targetKind: RouterDecision["attention"]["resolvedReferents"][number]["targetKind"];
  },
): boolean {
  if (!context) {
    return true;
  }

  switch (entry.targetKind) {
    case "scene_actor":
      return context.sceneActors.some((actor) => actor.actorRef === entry.targetRef);
    case "known_npc":
      return (context.knownNearbyNpcs ?? []).some((npc) => npc.id === entry.targetRef)
        || context.sceneActors.some((actor) => actor.kind === "npc" && actor.profileNpcId === entry.targetRef);
    case "world_object":
      return context.worldObjects.some((object) => object.id === entry.targetRef);
    case "inventory_item":
      return context.inventory.some((item) => item.templateId === entry.targetRef || (item.instanceIds ?? []).includes(entry.targetRef));
    case "route":
      return context.adjacentRoutes.some((route) => route.id === entry.targetRef);
    case "information":
      return context.discoveredInformation.some((information) => information.id === entry.targetRef);
    case "location":
      return context.currentLocation?.id === entry.targetRef;
    default:
      return true;
  }
}

function looksLikeActorishTargetRef(targetRef: string): boolean {
  const normalized = targetRef.trim().toLowerCase();
  return normalized.startsWith("temp:")
    || normalized.startsWith("temp_")
    || normalized.startsWith("npc:")
    || normalized.startsWith("npc_")
    || normalized.startsWith("actor:")
    || normalized.startsWith("actor_");
}

function canonicalizeRouterNpcPrerequisiteId(
  context: TurnRouterContext | undefined,
  npcId: string,
): string | null {
  const normalized = npcId.trim();
  if (!context) {
    return normalized.startsWith("npc:") ? normalized.slice("npc:".length).trim() : normalized;
  }

  if (normalized.startsWith("temp:")) {
    return null;
  }

  if (normalized.startsWith("actor:")) {
    const actorId = normalized.slice("actor:".length).trim();
    const sceneActor = context.sceneActors.find((actor) => actor.actorRef === `actor:${actorId}` || actor.actorId === actorId);
    return typeof sceneActor?.profileNpcId === "string" ? sceneActor.profileNpcId : null;
  }

  if (normalized.startsWith("npc:")) {
    return normalized.slice("npc:".length).trim();
  }

  const sceneActor = context.sceneActors.find((actor) =>
    actor.actorRef === `actor:${normalized}`
    || actor.actorRef === `npc:${normalized}`
    || actor.actorRef === normalized
    || actor.actorId === normalized
    || actor.profileNpcId === normalized);
  if (typeof sceneActor?.profileNpcId === "string") {
    return sceneActor.profileNpcId;
  }
  if (sceneActor?.kind === "temporary_actor") {
    return null;
  }

  const knownNpcId = normalizeKnownNpcId(context, normalized);
  if ((context.knownNearbyNpcs ?? []).some((npc) => npc.id === knownNpcId)) {
    return knownNpcId;
  }

  return normalized;
}

function normalizeRouterDecision(value: RouterDecision, context?: TurnRouterContext): RouterDecision {
  const dedupedVectors = Array.from(new Set(value.authorizedVectors));
  const seenPrerequisites = new Set<string>();
  const requiredPrerequisites: RouterDecision["requiredPrerequisites"] = [];
  for (const entry of value.requiredPrerequisites) {
    if (entry.type === "npc_detail" || entry.type === "relationship_history") {
      const canonicalNpcId = canonicalizeRouterNpcPrerequisiteId(context, entry.npcId);
      if (!canonicalNpcId) {
        continue;
      }
      const normalizedEntry = { ...entry, npcId: canonicalNpcId };
      const key = `${normalizedEntry.type}:${normalizedEntry.npcId}`;
      if (seenPrerequisites.has(key)) {
        continue;
      }
      seenPrerequisites.add(key);
      requiredPrerequisites.push(normalizedEntry);
      continue;
    }

    const key =
      entry.type === "information_connections"
        ? `${entry.type}:${entry.informationIds.join(",")}`
        : `${entry.type}:${Object.values(entry).slice(1).join(",")}`;
    if (seenPrerequisites.has(key)) {
      continue;
    }
    seenPrerequisites.add(key);
    requiredPrerequisites.push(entry);
  }
  const clarification = value.clarification?.needed
    ? {
        needed: true,
        blocker: value.clarification.blocker ?? "unclear_intent",
        question: value.clarification.question?.trim() || null,
        options: Array.from(new Set((value.clarification.options ?? []).map((entry) => entry.trim()).filter(Boolean))).slice(0, 4),
      }
    : {
        needed: false,
        blocker: null,
        question: null,
        options: [],
      };
  if (!clarification.question || clarification.options.length === 0) {
    clarification.needed = false;
    clarification.blocker = null;
    clarification.question = null;
    clarification.options = [];
  }
  const resolvedReferents: RouterDecision["attention"]["resolvedReferents"] = [];
  const unresolvedReferents: RouterDecision["attention"]["unresolvedReferents"] = [];
  const seenUnresolved = new Set<string>();

  for (const entry of value.attention?.unresolvedReferents ?? []) {
    const normalized = {
      phrase: entry.phrase.trim(),
      intendedKind: entry.intendedKind,
      confidence: entry.confidence,
    };
    const key = `${normalized.intendedKind}:${normalized.phrase.toLowerCase()}`;
    if (!seenUnresolved.has(key)) {
      unresolvedReferents.push(normalized);
      seenUnresolved.add(key);
    }
  }

  for (const entry of value.attention?.resolvedReferents ?? []) {
    const normalizedTargetRef =
      entry.targetKind === "known_npc"
        ? normalizeKnownNpcId(context, entry.targetRef, entry.phrase)
        : normalizeSceneActorRef(context, entry.targetRef);
    const normalizedEntry = {
      phrase: entry.phrase.trim(),
      targetRef: normalizedTargetRef,
      targetKind: entry.targetKind,
      confidence: entry.confidence,
    };

    if (normalizedEntry.targetRef.startsWith("spawn:")) {
      continue;
    }

    if (isPlaceholderResolvedTargetRef(normalizedEntry)) {
      if (normalizedEntry.targetKind === "scene_actor") {
        const key = `temporary_actor:${normalizedEntry.phrase.toLowerCase()}`;
        if (!seenUnresolved.has(key)) {
          unresolvedReferents.push({
            phrase: normalizedEntry.phrase,
            intendedKind: "temporary_actor",
            confidence: normalizedEntry.confidence,
          });
          seenUnresolved.add(key);
        }
      }
      continue;
    }

    if (normalizedEntry.targetKind === "scene_actor" && context) {
      const exactTempMatches = context.sceneActors.filter((actor) =>
        actor.kind === "temporary_actor" && sceneActorMatchesExplicitPhrase(actor, normalizedEntry.phrase),
      );
      const currentActor = context.sceneActors.find((actor) => actor.actorRef === normalizedEntry.targetRef);
      const currentActorMatchesPhrase = currentActor ? sceneActorMatchesExplicitPhrase(currentActor, normalizedEntry.phrase) : false;
      if (exactTempMatches.length === 1 && !currentActorMatchesPhrase) {
        normalizedEntry.targetRef = exactTempMatches[0]!.actorRef;
      }
      if (!currentActor) {
        const exactKnownNpcMatches = (context.knownNearbyNpcs ?? []).filter((npc) =>
          npc.name.trim().toLowerCase() === normalizedEntry.phrase.trim().toLowerCase(),
        );
        if (exactKnownNpcMatches.length === 1) {
          normalizedEntry.targetKind = "known_npc";
          normalizedEntry.targetRef = exactKnownNpcMatches[0]!.id;
        }
      }
    }

    if (!isGroundedResolvedReferent(context, normalizedEntry)) {
      if (normalizedEntry.targetKind === "scene_actor" || looksLikeActorishTargetRef(normalizedEntry.targetRef)) {
        const key = `temporary_actor:${normalizedEntry.phrase.toLowerCase()}`;
        if (!seenUnresolved.has(key)) {
          unresolvedReferents.push({
            phrase: normalizedEntry.phrase,
            intendedKind: "temporary_actor",
            confidence: normalizedEntry.confidence,
          });
          seenUnresolved.add(key);
        }
        continue;
      }

      if (normalizedEntry.targetKind === "world_object") {
        const key = `environmental_item:${normalizedEntry.phrase.toLowerCase()}`;
        if (!seenUnresolved.has(key)) {
          unresolvedReferents.push({
            phrase: normalizedEntry.phrase,
            intendedKind: "environmental_item",
            confidence: normalizedEntry.confidence,
          });
          seenUnresolved.add(key);
        }
        continue;
      }

      continue;
    }

    resolvedReferents.push(normalizedEntry);
  }
  const impliedDestinationFocus = value.attention?.impliedDestinationFocus
    ? {
        key: value.attention.impliedDestinationFocus.key.trim(),
        label: value.attention.impliedDestinationFocus.label.trim(),
      }
    : null;
  const mustCheck = clampRouterMustCheck(value.attention?.mustCheck ?? []);
  return {
    profile: value.profile,
    confidence: value.confidence,
    authorizedVectors: dedupedVectors,
    requiredPrerequisites,
    reason: value.reason.trim(),
    clarification,
    attention: {
      primaryIntent:
        value.attention?.primaryIntent?.trim()
        || "Resolve the player action conservatively from grounded context.",
      resolvedReferents,
      unresolvedReferents,
      impliedDestinationFocus:
        impliedDestinationFocus?.key && impliedDestinationFocus.label
          ? impliedDestinationFocus
          : null,
      mustCheck,
    },
  };
}

function inferFallbackPrimaryIntent(playerAction: string) {
  const normalized = playerAction.trim();
  if (!normalized) {
    return "Resolve the player action conservatively from grounded context.";
  }
  return `Resolve this player intent conservatively: ${normalized.slice(0, 140)}`;
}

function compactPromptText(value: string | null | undefined, maxLength = 120) {
  if (!value) {
    return "";
  }
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function formatApproachSummary(approaches: SpatialPromptContext["approaches"] | TurnRouterContext["approaches"]) {
  return (approaches ?? []).map((approach) => ({
    id: approach.id,
    label: approach.label,
    fieldId: approach.fieldId,
    description: approach.description ?? null,
  }));
}

function formatRouterSceneActorLine(actor: TurnRouterContext["sceneActors"][number]) {
  const label = compactPromptText(actor.displayLabel, 80) || "Unknown actor";
  const role = compactPromptText(actor.role, 60);
  const summary = compactPromptText(actor.lastSummary, 90);
  const actorTags = (actor.tags ?? []).length ? ` tags:${(actor.tags ?? []).join("/")}` : "";
  const detailHint =
    actor.detailFetchHint?.type === "fetch_npc_detail"
      ? " detail-fetch(name/identity available)"
      : "";
  return `${label}${role ? ` (${role})` : ""} [${actor.actorRef}, ${actor.kind}${detailHint}${actorTags}]${summary ? ` - ${summary}` : ""}`;
}

function formatRouterRouteLine(route: TurnRouterContext["adjacentRoutes"][number]) {
  return `${compactPromptText(route.targetLocationName, 80)} (${route.travelTimeMinutes}m, ${route.currentStatus}, danger ${route.dangerLevel}) [${route.id}]`;
}

function formatPromptRouteLine(route: SpatialPromptContext["adjacentRoutes"][number]) {
  const visibility = route.visibility ? `, ${route.visibility}` : "";
  const known = route.isKnown ? ", known" : "";
  const gated = route.accessRequirementText ? `, gate: ${compactPromptText(route.accessRequirementText, 70)}` : "";
  return `${compactPromptText(route.targetLocationName, 80)} (${route.travelTimeMinutes}m, ${route.currentStatus}${visibility}${known}, danger ${route.dangerLevel}${gated}) [${route.id}]`;
}

function formatPromptLocationLeadLine(lead: NonNullable<SpatialPromptContext["locationLeads"]>[number]) {
  return `${compactPromptText(lead.name, 80)} (${lead.type}, ${lead.discoveryState}) [${lead.locationId}] - ${compactPromptText(lead.summary, 110)}`;
}

function formatPromptDiscoveryHookLine(hook: NonNullable<SpatialPromptContext["discoveryHooks"]>[number]) {
  return `${hook.kind}:${hook.hookAlias} -> ${compactPromptText(hook.label, 80)} (${compactPromptText(hook.reason, 100)})`;
}

function formatPromptLatentTargetLine(target: NonNullable<SpatialPromptContext["latentTargets"]>[number]) {
  return `${target.kind}:${target.targetAlias} -> ${compactPromptText(target.label, 80)}`;
}

function formatRouterInventoryLine(item: TurnRouterContext["inventory"][number]) {
  const ids = item.instanceIds?.length ? ` instanceIds ${item.instanceIds.slice(0, 3).join(",")}` : "";
  const tags = item.stateTags?.length ? ` ${item.stateTags.join("/")}` : "";
  return `${compactPromptText(item.name, 80)} (qty ${item.quantity}${tags ? `, ${tags}` : ""}) [${item.templateId}${ids ? `;${ids}` : ""}]`;
}

function formatRouterWorldObjectLine(object: TurnRouterContext["worldObjects"][number]) {
  const tags: string[] = [];
  if (object.isLocked) {
    tags.push("locked");
  }
  if (object.requiredKeyTemplateId) {
    tags.push(`key:${object.requiredKeyTemplateId}`);
  }
  if (object.isHidden) {
    tags.push("hidden");
  }
  return `${compactPromptText(object.name, 80)} [${object.id}]${tags.length ? ` {${tags.join(", ")}}` : ""} - ${compactPromptText(object.summary, 120)}`;
}

function formatRouterSceneAspectLine(aspect: TurnRouterContext["sceneAspects"][number]) {
  const label = compactPromptText(aspect.label, 80) || aspect.key;
  const state = compactPromptText(aspect.state, 100);
  return `${label}${state ? `: ${state}` : ""} (${aspect.duration}) [${aspect.key}]`;
}

function formatRouterKnownNpcLine(npc: NonNullable<TurnRouterContext["knownNearbyNpcs"]>[number]) {
  const label = compactPromptText(npc.name, 80) || "Unknown NPC";
  const role = compactPromptText(npc.role, 60);
  const summary = compactPromptText(npc.summary, 100);
  const tags = (npc.tags ?? []).length ? ` tags:${(npc.tags ?? []).join("/")}` : "";
  const detailHint = npc.requiresDetailFetch ? " detail-fetch(name/identity available)" : "";
  return `${label}${role ? ` (${role})` : ""} [${npc.id}, known-npc, nearby-not-present-at-this-focus${detailHint}${tags}]${summary ? ` - ${summary}` : ""}`;
}

function formatRouterLocationLeadLine(lead: NonNullable<TurnRouterContext["locationLeads"]>[number]) {
  return `${compactPromptText(lead.name, 80)} (${lead.type}, ${lead.discoveryState}) [${lead.locationId}] - ${compactPromptText(lead.summary, 100)}`;
}

function formatRouterContextForModel(context: TurnRouterContext) {
  const sceneFocusLabel = context.sceneFocus?.label?.trim() || null;
  const currentLocationLabel = context.currentLocation?.name ?? "the road between locations";
  const currentLocationSummary = context.currentLocation
    ? `${context.currentLocation.name} (${context.currentLocation.type}, state: ${context.currentLocation.state})`
    : "Journey in progress";
  const activeJourneySummary = context.activeJourney
    ? `${context.activeJourney.originLocationName} -> ${context.activeJourney.destinationLocationName} (${context.activeJourney.elapsedMinutes}/${context.activeJourney.totalDurationMinutes}m, ${context.activeJourney.remainingMinutes}m remaining) [${context.activeJourney.edgeId}]`
    : null;
  return {
    locationOrientation: sceneFocusLabel
      ? `You are in ${currentLocationLabel}. Your current focus/position is: ${sceneFocusLabel}.`
      : `You are in ${currentLocationLabel}.`,
    currentLocation: currentLocationSummary,
    currency: context.currency,
    mechanicsProfile: {
      approaches: formatApproachSummary(context.approaches),
      currencyProfile: context.currencyProfile ?? null,
      presentationProfile: context.presentationProfile ?? null,
    },
    authoritativeState: {
      sceneActors: context.sceneActors.slice(0, 8).map(formatRouterSceneActorLine),
      knownNearbyNpcs: (context.knownNearbyNpcs ?? []).slice(0, 8).map(formatRouterKnownNpcLine),
      inventory: context.inventory.slice(0, 8).map(formatRouterInventoryLine),
      worldObjects: context.worldObjects.slice(0, 8).map(formatRouterWorldObjectLine),
      sceneAspects: context.sceneAspects.slice(0, 8).map(formatRouterSceneAspectLine),
      routes: context.adjacentRoutes.slice(0, 6).map(formatRouterRouteLine),
      locationLeads: (context.locationLeads ?? []).slice(0, 6).map(formatRouterLocationLeadLine),
      activeJourney: activeJourneySummary,
    },
    recentLocalEvents: context.recentLocalEvents
      .slice(0, 2)
      .map((event) => compactPromptText(event.description, 110)),
    recentGroundedHistory: context.recentTurnLedger
      .slice(-2)
      .map((entry) => compactPromptText(entry, 110)),
    discoveredInformation: context.discoveredInformation
      .slice(0, 3)
      .map((information) => `${compactPromptText(information.title, 80)} [${information.id}]`),
    activePressures: context.activePressures
      .slice(0, 2)
      .map((pressure) => `${compactPromptText(pressure.label, 80)} - ${compactPromptText(pressure.summary, 90)}`),
    activeThreads: context.activeThreads
      .slice(0, 2)
      .map((thread) => compactPromptText(thread.summary, 100)),
  };
}

function inferFallbackMustCheck(
  _playerAction: string,
  _context?: TurnRouterContext,
): RouterDecision["attention"]["mustCheck"] {
  return [
    "sceneActors",
    "inventory",
    "sceneAspects",
    "recentTurnLedger",
  ];
}

function fallbackRouterDecision(
  reason: string,
  playerAction = "",
  context?: TurnRouterContext,
): RouterDecision {
  return {
    profile: context?.sceneFocus ? "local" : "full",
    confidence: "low",
    authorizedVectors: [],
    requiredPrerequisites: [],
    reason,
    clarification: {
      needed: false,
      blocker: null,
      question: null,
      options: [],
    },
    attention: {
      primaryIntent: inferFallbackPrimaryIntent(playerAction),
      resolvedReferents: [],
      unresolvedReferents: [],
      impliedDestinationFocus: null,
      mustCheck: inferFallbackMustCheck(playerAction, context),
    },
  };
}

function zodIssuesToText(issues: z.ZodIssue[]) {
  return issues
    .map((issue) => `${issue.path.length ? issue.path.join(".") : "<root>"}: ${issue.message}`)
    .join("; ");
}

function selectPromptContextProfile(decision: RouterDecision): PromptContextProfile {
  return decision.profile === "local" ? "local" : decision.confidence === "high" ? decision.profile : "full";
}

function buildRouterConstraintsBlock(decision: RouterDecision) {
  return {
    profile: decision.profile,
    profileConfidence: decision.confidence,
    authorizedVectors: decision.authorizedVectors,
    requiredPrerequisites: decision.requiredPrerequisites,
    reason: decision.reason,
  };
}

function buildAttentionPacketBlock(decision: RouterDecision) {
  return {
    primaryIntent: decision.attention.primaryIntent,
    resolvedReferents: decision.attention.resolvedReferents,
    unresolvedReferents: decision.attention.unresolvedReferents,
    impliedDestinationFocus: decision.attention.impliedDestinationFocus,
    mustCheck: decision.attention.mustCheck,
  };
}

function normalizeLooseCheckIntentInput(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  const record = value as Record<string, unknown>;
  const type = typeof record.type === "string" ? record.type : null;
  const hasChallengeShape =
    typeof record.reason === "string"
    && typeof record.challengeApproach === "string";
  const hasCombatShape =
    typeof record.reason === "string"
    && typeof record.targetNpcId === "string"
    && typeof record.approach === "string";

  if ((type === "checkIntent" || type == null) && hasChallengeShape) {
    return {
      ...record,
      type: "challenge",
    };
  }

  if ((type === "checkIntent" || type == null) && hasCombatShape) {
    return {
      ...record,
      type: "combat",
    };
  }

  return value;
}

function normalizeFinalActionToolCallInput(command: unknown): unknown {
  if (!command || typeof command !== "object" || Array.isArray(command)) {
    return command;
  }

  const record = { ...(command as Record<string, unknown>) };
  if (record.type !== "resolve_mechanics") {
    return record;
  }

  const rawMutations = Array.isArray(record.mutations) ? record.mutations : [];
  let extractedCheckIntent = normalizeLooseCheckIntentInput(record.checkIntent);
  const normalizedMutations = rawMutations.filter((mutation) => {
    const candidate = normalizeLooseCheckIntentInput(mutation);
    if (
      extractedCheckIntent == null
      && candidate
      && typeof candidate === "object"
      && !Array.isArray(candidate)
    ) {
      const candidateRecord = candidate as Record<string, unknown>;
      if (candidateRecord.type === "challenge" || candidateRecord.type === "combat") {
        extractedCheckIntent = candidate;
        return false;
      }
    }

    return true;
  });

  return {
    ...record,
    checkIntent: extractedCheckIntent,
    mutations: normalizedMutations,
  };
}

function parseFinalActionToolCall(command: unknown, approachIds?: string[]) {
  return buildTurnActionSchemas(approachIds).turnActionToolCallSchema.safeParse(
    normalizeFinalActionToolCallInput(command),
  );
}

function extractToolInput(response: OpenAI.Chat.Completions.ChatCompletion) {
  const firstChoice = Array.isArray(response?.choices) ? response.choices[0] : undefined;

  if (!firstChoice) {
    logOpenRouterResponse("raw_completion", {
      hasToolCall: false,
      finishReason: null,
      likelyTruncated: false,
      toolName: null,
      rawToolArgumentsPreview: null,
      messageContentPreview: null,
      choiceCount: Array.isArray(response?.choices) ? response.choices.length : null,
      responseKeys:
        response && typeof response === "object"
          ? Object.keys(response as unknown as Record<string, unknown>)
          : null,
    });

    throw new Error("OpenRouter completion returned no choices.");
  }

  const toolCall = firstChoice.message?.tool_calls?.[0];
  const content = extractMessageText(firstChoice.message?.content ?? "");
  const finishReason = firstChoice.finish_reason ?? null;
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
      rawText: content,
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
    rawText: content,
    finishReason,
    likelyTruncated,
  };
}

function isObservePermittedFinalTool(command: TurnModelToolCall | null) {
  return (
    command?.type === "resolve_mechanics"
    || command?.type === "request_clarification"
  );
}

function isObserveMechanicsPayloadSafe(command: ResolveMechanicsResponse) {
  if (command.timeMode === "combat" || command.timeMode === "travel" || command.timeMode === "rest") {
    return false;
  }

  return command.mutations.every((mutation) =>
    mutation.type === "advance_time" || mutation.type === "discover_information",
  );
}

function buildTurnSystemPrompt(turnMode: TurnMode) {
  return turnMode === "observe"
    ? [
        "You are the mechanical planner for a passive observation turn in a simulated world.",
        "Return exactly one structured payload using resolve_mechanics, execute_fast_forward, or request_clarification.",
        "Do not output narration or any freeform prose.",
        "If you use resolve_mechanics, always include top-level timeMode, suggestedActions, and mutations.",
        "Use execute_fast_forward only when the player explicitly asks to compress multiple days into a routine montage; never use it for a single scene or ordinary short observation.",
        "timeMode must be exactly one of: combat, exploration, travel, rest, downtime.",
        "Use exploration for passive noticing, investigation, searching, or cautious local movement within the current scene.",
        "Use downtime for routine work, crafting, errands, waiting, or other non-travel non-combat activity.",
        "Do not treat internal thoughts, mutters to yourself, or naming an item as dialogue with another character unless the words are explicitly addressed to them.",
        "Giving a present subordinate or ally a routine instruction to fetch someone, pass along a message, or help with ordinary work is usually a grounded local interaction, not a social challenge.",
        "The router has already chosen scope and prerequisite fetches. Do not ask for more fetches.",
        "Before choosing mutations, classify the action into exactly one semantic lane: FLAVOR, MANIFEST, or KNOWLEDGE.",
        "FLAVOR covers trivial atmospheric actions like checking pockets, sitting down, lighting a pipe, routine self-checks, and passive atmosphere. FLAVOR resolves through advance_time only. Do not use checkIntent, spawn mutations, or discover_information in FLAVOR.",
        "MANIFEST covers plausible immediate local developments implied by the player, including searching a room, hearing a sound, addressing a plausible generic role, or shifting within the same scene. Prefer set_player_scene_focus, spawn_scene_aspect, and spawn_temporary_actor. Same-turn chaining is encouraged: spawn first, then reference it with spawn:<key>.",
        "KNOWLEDGE covers recalling or surfacing already-grounded facts. KNOWLEDGE resolves through discover_information only when the informationId is already grounded.",
        "discover_information is for grounded knowledge only. Never use it for look around, search, listen, investigate the room, or other immediate sensory scene investigation.",
        "If the player implies a plausible local detail that is not yet grounded, prefer bounded manifestation over rejection.",
        "If the action is purely atmospheric, stay in FLAVOR and do not escalate it into mechanics.",
        "Use only bounded mutations. The engine will validate, filter, and commit them.",
        "When checkIntent is present, use approachId exactly as listed in mechanicsProfile.approaches. Do not invent legacy challengeApproach labels or combat-only aliases when module approaches are provided.",
        "Mark resource costs, fees, and other upfront expenditures as phase immediate.",
        "Mark success-only rewards or outcomes as phase conditional.",
        "Advance the scene or world only through passive observation or waiting.",
        "Do not create combat, market trade, or deliberate social escalation in observe mode.",
        "Use sceneActors.actorRef values exactly only for actorRef fields such as set_scene_actor_presence and set_follow_state.",
        "Prefer record_actor_interaction and set_actor_state for embodied mechanics when a grounded actorId is available in sceneActors.",
        "For npcId, citedNpcId, and targetNpcId fields, use the bare NPC id without the npc: prefix.",
        "Every record_local_interaction, record_actor_interaction, and record_npc_interaction mutation must include socialOutcome.",
        "Choose the most specific valid socialOutcome available; do not default to acknowledges if the NPC accepts, declines, hesitates, redirects, asks a question, shares a fact, resists, withdraws, counteroffers, or agrees conditionally.",
        "acknowledges is the only low-intensity fallback outcome and must not silently imply agreement.",
        "interactionSummary is the single grounded detail field and should state the concrete result when relevant.",
        "If socialOutcome is acknowledges, hesitates, withholds, asks_question, redirects, resists, or withdraws, interactionSummary must stay unresolved and must not close a decision, agreement, invitation, or emotional resolution.",
        "Do not describe physical movement, arrivals, departures, returns, repositioning, or new blocking in interactionSummary. Use set_scene_actor_presence, set_player_scene_focus, start_journey, or move_player to manifest physical progression.",
        "Fetched npc_detail for a named NPC is sufficient grounding for identity, memory, and bare npc ids, but it is not physical presence.",
        "Use record_actor_interaction for grounded named NPCs, creatures, and anonymous locals already manifested in sceneActors.",
        "Use record_npc_interaction only as a compatibility fallback when an embodied actorId is unavailable.",
        "If a named NPC is only in knownNearbyNpcs or fetched_facts, treat them as nearby-but-offscreen: you may search for them, move toward them, call for them, or fetch details about them, but do not commit direct same-scene dialogue until they are present in sceneActors or moved in with explicit scene mutations.",
        "Do not spawn a duplicate temporary actor just to stand in for a fetched named NPC.",
        "Living creatures such as mounts, familiars, pets, and animal companions are actors, not world objects. Do not use spawn_world_object for a horse, dog, owl, raven, or similar living companion.",
        "Never use record_local_interaction with npc:, actor:, or named sceneActors. It is only for unnamed temporary locals referenced as temp:..., spawn:..., or raw temporary-actor ids.",
        "Never invent temp: ids. temp: refs are only for temporary actors already grounded in sceneActors; if the person is new, spawn_temporary_actor first and then reference spawn:<key>.",
        "If an owned or familiar animal is present but not yet grounded, manifest it as a temporary actor first. If a grounded NPC companion or tagged beast is already present, use that actor and prefer set_follow_state or set_scene_actor_presence over creating a prop.",
        "If the player reaches for a plausible unlisted local, improvised item, or environmental condition, spawn it first before interacting with it only when the noun is a fresh generic local role or a new same-scene manifestation implied by the current action.",
        "Use spawn_temporary_actor before record_local_interaction when the local is not already listed in sceneActors.",
        "If the player addresses a generic person like someone, passerby, customer, shopper, stranger, or interested local, keep them generic: do not redirect them to a named scene actor; spawn_temporary_actor first if the action engages them.",
        "If the player is looting, pickpocketing, frisking, searching a body's belongings, or otherwise acting on a grounded NPC's custody, request npc_detail first so you can see their grounded held items and commodity stacks.",
        "Use spawn_world_object for durable props like lockboxes, carts, hidden nooks, and other persistent storage or fixtures.",
        "Respect context.authoritativeState.worldObjects mechanical state such as isLocked and requiredKeyTemplateId. Do not narrate a locked object opening unless the turn actually unlocks it or the correct key is grounded.",
        "Use spawn_environmental_item before adjust_inventory when the item is plausible in the environment but not already grounded in inventory.",
        "spawn_environmental_item requires an explicit valid holder and may place the item into the player, scene, temporary actor, NPC, or world object.",
        "Use spawn_fiat_item to instantiate bespoke narrative goods directly into a valid holder when the deal creates or reveals goods that are not already grounded in inventory or fetched market prices.",
        "Use spawn_scene_aspect for smoke, damage, noise, weather spillover, improvised cover, and other grounded scene conditions.",
        "In MANIFEST, do not instantiate value: no free wealth, trade goods, valuables, or mechanically advantageous loot.",
        "In MANIFEST, do not instantiate authority: spawned actors must be ordinary generic locals, never rulers, generals, guildmasters, or specific named plot contacts.",
        "In MANIFEST, do not instantiate confirmed plot outcomes: ambiguous threats or signs must appear as ambiguous scene aspects, not confirmed enemies, traps, or secrets.",
        "Default manifestation pattern: sensory uncertainty becomes an ambiguous spawn_scene_aspect such as Rustling Bushes, Unsettled Desk, Fresh Tracks, or Movement in the Alley.",
        "Default manifestation pattern: plausible generic nearby people become spawn_temporary_actor such as stablehand, customer, porter, or watch patrol.",
        "Default manifestation pattern: intra-location repositioning becomes set_player_scene_focus.",
        "Self-directed downtime work may use adjust_inventory, spawn_environmental_item, and spawn_scene_aspect for grounded byproducts, consumed materials, and scene conditions.",
        "Currency uses signed base-unit deltas. Read naming and display cues from mechanicsProfile.currencyProfile when present, but encode adjust_currency.delta as a single integer base-unit change.",
        "Use adjust_currency for incidental payments, rewards, bribes, tips, fees, and other non-market currency movement.",
        "If economy_light is active and a bespoke trade is actually agreed upon, resolve it immediately with composed asset mutations such as adjust_currency plus spawn_fiat_item and/or transfer_assets. Do not rely on record_actor_interaction or record_npc_interaction alone to finalize the trade.",
        "If an offer is still on the table but not yet accepted, you may track it with a scene-duration spawn_scene_aspect such as pending_trade_offer instead of finalizing the exchange early.",
        "Use transfer_assets for non-market stashing, dropping, storing, retrieving, feeding, lending, or handing over items, commodities, or currency between the player, world objects, scenes, temporary actors, and willing NPCs.",
        "If the player gives, feeds, hands over, drops off, retrieves, stores, or takes a concrete item, include the matching asset mutation. record_local_interaction, record_actor_interaction, and record_npc_interaction alone never finalize custody or consumption.",
        "When fetched npc_detail exposes grounded held items or commodity stacks on an NPC, use transfer_assets from that NPC holder for looting, stealing, or taking those assets. Do not replace grounded NPC-held goods with spawn_fiat_item.",
        "Use update_world_object_state to lock, hide, or hitch a durable world object.",
        "Use update_item_state for equipping, changing charges, or toggling durable item state like lit/unlit.",
        "For adjust_inventory, use the inventory line's main template/stack id. Reserve instanceIds for update_item_state or transfer_assets.itemInstanceIds when a specific physical copy matters.",
        "Keeping an item on your own person still counts as inventory. Pockets, sleeves, belts, boots, packs, and similar on-body storage should not use adjust_inventory or transfer_assets unless the item actually leaves the player's custody.",
        "If you spawn a new item and another holder ends the turn with it, either spawn_fiat_item directly into that holder or immediately pair the spawn with a transfer_assets mutation. Do not leave the item in player custody while narrating that someone else now has it.",
        "Use update_character_state for track-only conditions like disguised, poisoned, or exhausted.",
        "Use set_follow_state when someone starts or stops following the player through location and focus changes.",
        "Use set_player_scene_focus for self-directed movement within the current location, like stepping back into the forge, crossing to the workbench, or moving from the street to the stall front.",
        "When using set_player_scene_focus, the label must describe a spatial sub-location or zone, like The Back Room, The Workbench, Alleyway, or Stall Front, never a portable object like Coin Purse or Sword.",
        "Use set_scene_actor_presence whenever someone leaves the current scene or returns during the turn.",
        "Use set_scene_actor_presence only for an actor's own departure or return. Never use it to simulate the player arriving somewhere.",
        "Same-turn spatial isolation rule: if your mutation array includes set_player_scene_focus, the prior focus cast is left behind unless the new focus is clearly the same venue or social space. Stepping deeper into the same shop, house, stall, forge, or office usually keeps the existing cast available.",
        "After set_player_scene_focus, any later interaction in the same turn must target an actor already valid in the new focus or a newly spawned actor referenced via spawn:<key>.",
        "Use record_local_interaction only when the player explicitly engages another person. Do not use it for solo errands, checking your own gear, retrieving your own belongings, or internal repositioning.",
        "Review the attention_packet before planning mutations.",
        "If attention_packet.resolvedReferents supplies a grounded ref, use that exact ref instead of inventing or guessing ids.",
        "If attention_packet.mustCheck lists inventory, do not remove or consume an item unless it is grounded in context.authoritativeState.inventory or fetched_facts.",
        "If attention_packet.mustCheck lists sceneActors, do not target a named actor through record_local_interaction.",
        "If attention_packet.resolvedReferents includes a known_npc or fetched_facts includes npc_detail for a named person the player is seeking, keep the turn anchored to that NPC instead of spawning a generic local stand-in.",
        "A known_npc or fetched named NPC can anchor search, contact, and movement decisions, but not direct record_actor_interaction unless that NPC is present in sceneActors or explicitly brought into the scene this turn.",
        "If a known nearby named NPC arrives or is called over this turn, use set_scene_actor_presence with that grounded actor:<actorId> sceneActors.actorRef; use npc:<npcId> only as a compatibility fallback and do not invent a temp: ref or spawn a duplicate stand-in for them.",
        "If attention_packet.mustCheck lists sceneAspects or routes, verify those surfaces before depending on them in mutations.",
        "Only scene actors, world objects, inventory, routes, and scene aspects already grounded in context are valid direct interaction targets.",
        "recentTurnLedger contains grounded prior outcomes only. It is memory, not target authority.",
        "If attention_packet.unresolvedReferents names a missing person, stale narrated figure, or otherwise ungrounded target, do not redirect the action to another grounded actor and do not spawn that target automatically.",
        "If attention_packet.unresolvedReferents names a generic local person, do not remap them onto a named scene actor; spawn a temporary actor first if the player is actually engaging them.",
        "If attention_packet.unresolvedReferents names a fresh generic role or same-scene uncertainty introduced by the current action, you may manifest it first. Otherwise resolve the turn as a graceful miss, a failed reach, or a search attempt without retargeting anyone else.",
        "TRIVIAL ACTIONS: Checking personal inventory, reviewing known information, or looking around a safe room requires ZERO checks. You must omit checkIntent entirely for these actions.",
        "ID HALLUCINATION BAN: You are strictly forbidden from using discover_information unless the exact informationId is explicitly provided in fetched_facts or attention_packet.resolvedReferents. Do not invent placeholder IDs.",
        "Only include checkIntent when success or failure meaningfully changes which mutations can happen. If the turn is routine and should simply create a local interaction or consume time, omit checkIntent.",
        "checkIntent is a top-level field on resolve_mechanics, not a mutation. Never put an entry with type checkIntent inside mutations.",
        "If a check is needed, set top-level checkIntent and list only the success-state mutations. The engine will reject them on failure.",
        "For notice/analyze/search/listen turns that use checkIntent, any newly noticed actor, clue, item, or scene detail must be phase conditional so the roll gates whether it appears.",
        "Never use placeholder ids like none, null, unknown, or n/a for citedNpcId, targetNpcId, localEntityId, or spawn references. Omit the field instead when there is no real id.",
        "Use advance_time for passive waiting or observation windows.",
        "Suggested actions should stay short and concrete.",
        "Use request_clarification only if the world state is too invalid to produce any passive progression.",
      ].join("\n")
    : [
        "You are the mechanical planner for a simulated world turn.",
        "Return exactly one structured payload using resolve_mechanics, execute_fast_forward, or request_clarification.",
        "Do not output narration or any freeform prose.",
        "If you use resolve_mechanics, always include top-level timeMode, suggestedActions, and mutations.",
        "Use execute_fast_forward only when the player explicitly asks to compress multiple days or weeks into a routine montage.",
        "Do not use execute_fast_forward for one evening, one day of normal downtime, or any turn where the player expects scene-by-scene interaction.",
        "Do not use execute_fast_forward during combat, active pursuit, or unstable tactical play.",
        "execute_fast_forward carries aggregate upkeep only. It must not contain scene mutations, item transfers, or other step-by-step mechanics.",
        "timeMode must be exactly one of: combat, exploration, travel, rest, downtime.",
        "Use combat for an active fight or immediate violence.",
        "Use travel only for route movement between known adjacent locations.",
        "Use rest for sleep, recovery, or explicit healing downtime.",
        "Use exploration for investigation, searching, scouting, talking within the current scene, or cautious local movement.",
        "Use downtime for crafting, routine work, commissioning help, shopping, administration, or other settled non-travel activity.",
        "Do not treat internal thoughts, mutters to yourself, or naming an item as dialogue with another character unless the words are explicitly addressed to them.",
        "Giving a present subordinate or ally a routine instruction to fetch someone, pass along a message, or help with ordinary work is usually a grounded local interaction, not a social challenge.",
        "The router has already chosen scope and prerequisite fetches. Do not ask for more fetches.",
        "Obey the router_constraints block. If a vector is not authorized, do not rely on it.",
        "Before choosing mutations, classify the action into exactly one semantic lane: FLAVOR, MANIFEST, or KNOWLEDGE.",
        "FLAVOR covers trivial atmospheric actions like checking pockets, sitting down, lighting a pipe, routine self-checks, and passive atmosphere. FLAVOR resolves through advance_time only. Do not use checkIntent, spawn mutations, or discover_information in FLAVOR.",
        "MANIFEST covers plausible immediate local developments implied by the player, including searching a room, hearing a sound, addressing a plausible generic role, or shifting within the same scene. Prefer set_player_scene_focus, spawn_scene_aspect, and spawn_temporary_actor. Same-turn chaining is encouraged: spawn first, then reference it with spawn:<key>.",
        "KNOWLEDGE covers recalling known lore, surfacing a specific fetched record, or connecting already-grounded clues. KNOWLEDGE resolves through discover_information only when the informationId is already grounded.",
        "discover_information is for grounded knowledge only. Never use it for look around, search, listen, investigate the room, or other immediate sensory scene investigation.",
        "If the player implies a plausible local detail that is not yet grounded, prefer bounded manifestation over rejection.",
        "If the action is purely atmospheric, stay in FLAVOR and do not escalate it into mechanics.",
        "Use only bounded mutations. The engine will validate, filter, and commit them deterministically.",
        "Only include checkIntent when success or failure meaningfully changes which mutations can happen. If the turn is routine and should simply create a local interaction, spend time, or ask a subordinate to fetch someone, omit checkIntent.",
        "checkIntent is a top-level field on resolve_mechanics, not a mutation. Never put an entry with type checkIntent inside mutations.",
        "If a check is needed, set top-level checkIntent and list only the success-state mutations. The engine will reject them automatically on failure or partial success.",
        "Only set citedNpcId when the player is directly engaging that NPC on-screen this turn.",
        "When checkIntent is present, use approachId exactly as listed in mechanicsProfile.approaches. Do not invent legacy challengeApproach labels or combat-only aliases when module approaches are provided.",
        "For notice/analyze/search/listen turns that use checkIntent, any newly noticed actor, clue, item, or scene detail must be phase conditional so the roll gates whether it appears.",
        "Never use placeholder ids like none, null, unknown, or n/a for citedNpcId, targetNpcId, localEntityId, or spawn references. Omit the field instead when there is no real id.",
        "Mark resource costs, fees, and other upfront expenditures as phase immediate.",
        "Mark success-only rewards or outcomes as phase conditional.",
        "Use commit_market_trade only for strict commodity trade backed by fetched market prices.",
        "Currency uses signed base-unit deltas. Read naming and display cues from mechanicsProfile.currencyProfile when present, but encode adjust_currency.delta as a single integer base-unit change.",
        "Use adjust_currency for incidental payments, rewards, bribes, tips, fees, or other non-market currency movement.",
        "Use start_journey for ordinary physical route travel to a known adjacent location.",
        "Use move_player only for teleportation, magical portals, trap relocation, or forced transport.",
        "Use record_local_interaction for current-scene unnamed locals instead of adjust_relationship.",
        "Use record_actor_interaction for ordinary same-scene dialogue with a grounded embodied actor when the exchange matters but no relationship shift is required.",
        "Use record_npc_interaction only as a compatibility fallback when no grounded actorId is available.",
        "Every record_local_interaction, record_actor_interaction, and record_npc_interaction mutation must include socialOutcome.",
        "Choose the most specific valid socialOutcome available; do not default to acknowledges if the NPC accepts, declines, hesitates, redirects, asks a question, shares a fact, resists, withdraws, counteroffers, or agrees conditionally.",
        "acknowledges is the only low-intensity fallback outcome and must not silently imply agreement.",
        "interactionSummary is the single grounded detail field and should state the concrete result when relevant.",
        "If socialOutcome is acknowledges, hesitates, withholds, asks_question, redirects, resists, or withdraws, interactionSummary must stay unresolved and must not close a decision, agreement, invitation, or emotional resolution.",
        "Do not describe physical movement, arrivals, departures, returns, repositioning, or new blocking in interactionSummary. Use set_scene_actor_presence, set_player_scene_focus, start_journey, or move_player to manifest physical progression.",
        "Use sceneActors.actorRef values exactly only for actorRef fields such as set_scene_actor_presence and set_follow_state.",
        "Prefer record_actor_interaction and set_actor_state for embodied mechanics when a grounded actorId is available in sceneActors.",
        "For npcId, citedNpcId, and targetNpcId fields, use the bare NPC id without the npc: prefix.",
        "Fetched npc_detail for a named NPC is sufficient grounding for identity, memory, and bare npc ids, but it is not physical presence.",
        "Use record_actor_interaction for grounded named NPCs and other embodied scene actors who are immediate scene actors now or are explicitly brought into the scene this turn.",
        "Use record_npc_interaction only as a compatibility fallback when an embodied actorId is unavailable.",
        "If a named NPC is only in knownNearbyNpcs or fetched_facts, treat them as nearby-but-offscreen: you may search for them, move toward them, call for them, or fetch details about them, but do not commit direct same-scene dialogue until they are present in sceneActors or moved in with explicit scene mutations.",
        "Do not spawn a duplicate temporary actor just to stand in for a fetched named NPC.",
        "Living creatures such as mounts, familiars, pets, and animal companions are actors, not world objects. Do not use spawn_world_object for a horse, dog, owl, raven, or similar living companion.",
        "Never use record_local_interaction with npc:, actor:, or named sceneActors. It is only for unnamed temporary locals referenced as temp:..., spawn:..., or raw temporary-actor ids.",
        "Never invent temp: ids. temp: refs are only for temporary actors already grounded in sceneActors; if the person is new, spawn_temporary_actor first and then reference spawn:<key>.",
        "If an owned or familiar animal is present but not yet grounded, manifest it as a temporary actor first. If a grounded NPC companion or tagged beast is already present, use that actor and prefer set_follow_state or set_scene_actor_presence over creating a prop.",
        "When speaking to a named on-screen NPC, use record_actor_interaction for ordinary dialogue, use adjust_relationship only for meaningful social shifts, and use checkIntent only when success or failure would materially change what can happen.",
        "If the player reaches for a plausible unlisted local, improvised item, or environmental condition, spawn it first before interacting with it only when the noun is a fresh generic local role or a new same-scene manifestation implied by the current action.",
        "Use spawn_temporary_actor before record_local_interaction when the local is not already listed in sceneActors.",
        "If the player addresses a generic person like someone, passerby, customer, shopper, stranger, or interested local, keep them generic: do not redirect them to a named scene actor; spawn_temporary_actor first if the action engages them.",
        "If the player is looting, pickpocketing, frisking, searching a body's belongings, or otherwise acting on a grounded NPC's custody, request npc_detail first so you can see their grounded held items and commodity stacks.",
        "Use spawn_world_object for durable props like lockboxes, carts, hidden nooks, and other persistent storage or fixtures.",
        "Respect context.authoritativeState.worldObjects mechanical state such as isLocked and requiredKeyTemplateId. Do not narrate a locked object opening unless the turn actually unlocks it or the correct key is grounded.",
        "Use spawn_environmental_item before adjust_inventory when the item is plausible in the environment but not already grounded in inventory.",
        "spawn_environmental_item requires an explicit valid holder and may place the item into the player, scene, temporary actor, NPC, or world object.",
        "Use spawn_fiat_item to instantiate bespoke narrative goods directly into a valid holder when the deal creates or reveals goods that are not already grounded in inventory or fetched market prices.",
        "Use spawn_scene_aspect for smoke, damage, noise, weather spillover, improvised cover, and other grounded scene conditions.",
        "In MANIFEST, do not instantiate value: no free wealth, trade goods, valuables, or mechanically advantageous loot.",
        "In MANIFEST, do not instantiate authority: spawned actors must be ordinary generic locals, never rulers, generals, guildmasters, or specific named plot contacts.",
        "In MANIFEST, do not instantiate confirmed plot outcomes: ambiguous threats or signs must appear as ambiguous scene aspects, not confirmed enemies, traps, or secrets.",
        "Default manifestation pattern: sensory uncertainty becomes an ambiguous spawn_scene_aspect such as Rustling Bushes, Unsettled Desk, Fresh Tracks, or Movement in the Alley.",
        "Default manifestation pattern: plausible generic nearby people become spawn_temporary_actor such as stablehand, customer, porter, or watch patrol.",
        "Default manifestation pattern: intra-location repositioning becomes set_player_scene_focus.",
        "Self-directed downtime work may use adjust_inventory, spawn_environmental_item, and spawn_scene_aspect for grounded byproducts, consumed materials, and scene conditions.",
        "If economy_light is active and a bespoke trade is actually agreed upon, resolve it immediately with composed asset mutations such as adjust_currency plus spawn_fiat_item and/or transfer_assets. Do not rely on record_actor_interaction or record_npc_interaction alone to finalize the trade.",
        "If an offer is still on the table but not yet accepted, you may track it with a scene-duration spawn_scene_aspect such as pending_trade_offer instead of finalizing the exchange early.",
        "Use transfer_assets only for non-market custody changes. Do not use it for buying or selling from fetched market prices.",
        "Use transfer_assets under economy_light for stash/drop/store/retrieve, under converse for willing NPC or temporary-actor exchange, under investigate for stealthy NPC-source transfers, and under violence for forceful NPC-source transfers.",
        "If the player gives, feeds, hands over, drops off, retrieves, stores, or takes a concrete item, include the matching asset mutation. record_local_interaction, record_actor_interaction, and record_npc_interaction alone never finalize custody or consumption.",
        "When fetched npc_detail exposes grounded held items or commodity stacks on an NPC, use transfer_assets from that NPC holder for looting, stealing, or taking those assets. Do not replace grounded NPC-held goods with spawn_fiat_item.",
        "Use update_world_object_state to lock, hide, or hitch a durable world object.",
        "Use update_item_state for equipping, changing charges, or toggling durable item state like lit/unlit.",
        "For adjust_inventory, use the inventory line's main template/stack id. Reserve instanceIds for update_item_state or transfer_assets.itemInstanceIds when a specific physical copy matters.",
        "Keeping an item on your own person still counts as inventory. Pockets, sleeves, belts, boots, packs, and similar on-body storage should not use adjust_inventory or transfer_assets unless the item actually leaves the player's custody.",
        "If you spawn a new item and another holder ends the turn with it, either spawn_fiat_item directly into that holder or immediately pair the spawn with a transfer_assets mutation. Do not leave the item in player custody while narrating that someone else now has it.",
        "Use update_character_state for track-only conditions like disguised, poisoned, or exhausted.",
        "Use set_follow_state when someone starts or stops following the player through location and focus changes.",
        "Use adjust_inventory for gaining, losing, consuming, or handing over grounded inventory items.",
        "Use set_actor_state only for direct violence, subdual, or comparable physical outcomes.",
        "Use adjust_relationship for meaningful social shifts with a present NPC.",
        "Use discover_information only for specific known information ids grounded in context or fetched facts.",
        "Use set_player_scene_focus for self-directed movement within the current location, like heading back to the forge, moving to the workbench, or stepping from the street to a nearby shopfront.",
        "When using set_player_scene_focus, the label must describe a spatial sub-location or zone, like The Back Room, The Workbench, Alleyway, or Stall Front, never a portable object like Coin Purse or Sword.",
        "Use set_scene_actor_presence whenever someone leaves the current scene or returns during the turn.",
        "If a helper, subordinate, or named scene actor leaves on an errand or comes back later in the turn, represent that mechanically with set_scene_actor_presence.",
        "Use set_scene_actor_presence only for an actor's own departure or return. Never use it to simulate the player arriving somewhere.",
        "Same-turn spatial isolation rule: if your mutation array includes set_player_scene_focus, the prior focus cast is left behind unless the new focus is clearly the same venue or social space. Stepping deeper into the same shop, house, stall, forge, or office usually keeps the existing cast available.",
        "After set_player_scene_focus, any later interaction in the same turn must target an actor already valid in the new focus or a newly spawned actor referenced via spawn:<key>.",
        "Use record_local_interaction only when the player explicitly engages another person. Do not use it for solo errands, checking your own gear, retrieving your own belongings, or internal repositioning.",
        "Review the attention_packet before planning mutations.",
        "If attention_packet.resolvedReferents supplies a grounded ref, use that exact ref instead of inventing or guessing ids.",
        "If attention_packet.mustCheck lists inventory, do not remove or consume an item unless it is grounded in context.authoritativeState.inventory or fetched_facts.",
        "If attention_packet.mustCheck lists sceneActors, do not target a named actor through record_local_interaction.",
        "If attention_packet.resolvedReferents includes a known_npc or fetched_facts includes npc_detail for a named person the player is seeking, keep the turn anchored to that NPC instead of spawning a generic local stand-in.",
        "A known_npc or fetched named NPC can anchor search, contact, and movement decisions, but not direct record_actor_interaction unless that NPC is present in sceneActors or explicitly brought into the scene this turn.",
        "If a known nearby named NPC arrives or is called over this turn, use set_scene_actor_presence with that grounded actor:<actorId> sceneActors.actorRef; use npc:<npcId> only as a compatibility fallback and do not invent a temp: ref or spawn a duplicate stand-in for them.",
        "If attention_packet.mustCheck lists sceneAspects or routes, verify those surfaces before depending on them in mutations.",
        "Only scene actors, world objects, inventory, routes, and scene aspects already grounded in context are valid direct interaction targets.",
        "recentTurnLedger contains grounded prior outcomes only. It is memory, not target authority.",
        "If attention_packet.unresolvedReferents names a missing person, stale narrated figure, or otherwise ungrounded target, do not redirect the action to another grounded actor and do not spawn that target automatically.",
        "If attention_packet.unresolvedReferents names a generic local person, do not remap them onto a named scene actor; spawn a temporary actor first if the player is actually engaging them.",
        "If attention_packet.unresolvedReferents names a fresh generic role or same-scene uncertainty introduced by the current action, you may manifest it first. Otherwise resolve the turn as a graceful miss, a failed reach, or a search attempt without retargeting anyone else.",
        "If a present scene actor line includes detail-fetch(name/identity available) and the player asks what to call them, who they are, or another identity-seeking follow-up, request npc_detail for that actor and keep the interaction anchored to them instead of drifting to another bystander.",
        "TRIVIAL ACTIONS: Checking personal inventory, reviewing known information, or looking around a safe room requires ZERO checks. You must omit checkIntent entirely for these actions.",
        "ID HALLUCINATION BAN: You are strictly forbidden from using discover_information unless the exact informationId is explicitly provided in fetched_facts or attention_packet.resolvedReferents. Do not invent placeholder IDs.",
        "Use restore_health for rest recovery or explicit healing outcomes the engine should apply.",
        "Use advance_time when the action necessarily consumes time. Suggested actions should stay short and concrete.",
        "Preserve the player's commitment level. Do not upgrade browsing or approach into stronger mechanics unless the wording clearly commits to them.",
        "Use request_clarification only if the action is too ambiguous, impossible to map safely, or missing a required target.",
      ].join("\n");
}

const NARRATION_TRANSIENT_RETRY_DELAYS_MS = [500, 1000, 2000] as const;

function isTransientNarrationModelError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  const errorRecord = error as Error & {
    status?: unknown;
    code?: unknown;
    type?: unknown;
  };
  const message = error.message.toLowerCase();
  const name = error.name.toLowerCase();
  const code = typeof errorRecord.code === "string" ? errorRecord.code.toLowerCase() : "";
  const type = typeof errorRecord.type === "string" ? errorRecord.type.toLowerCase() : "";
  const status = typeof errorRecord.status === "number" ? errorRecord.status : null;

  if (status === 408 || status === 429 || (status !== null && status >= 500)) {
    return true;
  }

  return (
    name.includes("abort")
    || code.includes("abort")
    || code.includes("timeout")
    || type.includes("timeout")
    || message.includes("aborted")
    || message.includes("timeout")
    || message.includes("timed out")
    || message.includes("network")
    || message.includes("socket hang up")
    || message.includes("connection reset")
    || message.includes("econnreset")
    || message.includes("fetch failed")
  );
}

function buildTurnActionCorrectionNotes(input: {
  likelyTruncated: boolean;
  validationIssues: string | null;
}) {
  if (input.likelyTruncated) {
    return [
      "Your previous reply did not match the final action schema.",
      "The previous payload was cut off. Return a much shorter complete replacement payload.",
      "If you use resolve_mechanics, include top-level timeMode, suggestedActions, and mutations.",
      "If you use execute_fast_forward, include requestedDurationMinutes, routineSummary, recurringActivities, and intendedOutcomes.",
      "Do not include assistant prose before the tool call.",
    ].join("\n");
  }

  const notes = [
    "Your previous reply did not match the final action schema.",
    `Return a complete replacement payload that matches one final action schema exactly. Validation issues: ${input.validationIssues ?? "unknown"}`,
  ];

  if ((input.validationIssues ?? "").includes("timeMode")) {
    notes.push(
      "For resolve_mechanics, always include top-level timeMode as exactly one of: combat, exploration, travel, rest, downtime.",
      "Choose timeMode before writing mutations. Use downtime for crafting, routine work, errands, or commissioning help. Use exploration for investigation, searching, talking within the current scene, or cautious local movement.",
    );
  }

  if ((input.validationIssues ?? "").includes("requestedDurationMinutes")) {
    notes.push(
      "For execute_fast_forward, always include a positive requestedDurationMinutes.",
      "Use execute_fast_forward only for explicit multi-day or multi-week routine montages, not scene-scale actions.",
    );
  }

  if ((input.validationIssues ?? "").includes("suggestedActions")) {
    notes.push("suggestedActions must be an array of at most 4 short concrete strings. Use [] if none are appropriate.");
  }

  if ((input.validationIssues ?? "").includes("mutations.") && (input.validationIssues ?? "").includes("type: Invalid input")) {
    notes.push("Only real mutation types may appear inside mutations. checkIntent belongs at the top level of resolve_mechanics, never inside mutations.");
  }

  notes.push("Do not include assistant prose before the tool call.");
  return notes.join("\n");
}

function buildTurnRouterSystemPrompt(correctionNotes?: string | null) {
  const base = [
    "You classify player intent for a simulated world turn.",
    "Return exactly one structured payload using the provided tool.",
    "Choose profile=local only when the action can be resolved from immediate same-scene context alone.",
    "Choose profile=full whenever the action depends on prior clues, rumors, factions, active pressures, broader world state, travel, strategy, or you are unsure.",
    "authorizedVectors should contain only the commitment vectors the player's wording clearly authorizes on this turn.",
    "economy_light covers incidental spending plus bespoke haggling, bartering, discounts, and negotiated deals over ungrounded goods or services.",
    "economy_strict covers only commodity trades that depend on authoritative fetched market prices.",
    "violence covers direct attack, subdual, assassination, or clear threat-of-harm escalation.",
    "converse covers explicit questioning, negotiation, persuasion, or socially consequential dialogue.",
    "investigate covers explicit searching, clue-seeking, examination, tracking, or analysis.",
    "Internal thoughts, mutters to yourself, and naming an item are not converse.",
    "Directing a present subordinate or ally to pass along a message or fetch someone is a local in-scene action, not automatically persuasion with the off-screen target.",
    "requiredPrerequisites must list every authoritative fetch the mechanics pass will need before it can safely resolve the turn.",
    "Use market_prices before strict commodity trade, npc_detail before detailed interaction with a present NPC that needs it, and relationship_history only when prior rapport materially matters.",
    "If the player is looting, pickpocketing, frisking, searching a body's belongings, or otherwise needs grounded custody detail from a present NPC, include npc_detail for that actor.",
    "Confidence governs profile only. authorizedVectors and requiredPrerequisites should still reflect the best conservative reading even when confidence is low.",
    "Use clarification only for hard blockers where a best-effort interpretation would be materially unreliable.",
    "When the player haggles, barters, negotiates price, or proposes bespoke terms, include economy_light alongside converse.",
    "Reserve economy_strict for fetched market-price transactions, not bespoke stall haggling.",
    "Do not generate gameplay policy, strategy notes, or prohibitions for the mechanics model.",
    "Map player nouns to existing grounded refs when possible.",
    "Do not invent new ids or spawn handles.",
    "router_context.knownNearbyNpcs lists authoritative named NPCs in the current location who are not immediate scene actors at this focus. They are valid known_npc referents and valid npc_detail or relationship_history fetch targets, but they are not immediate actorRef targets unless later manifested into the scene.",
    "Fetched npc_detail grounds identity and memory for a named NPC, but it does not make them physically present in sceneActors.",
    "routes strictly means macro-travel leaving the current location node for another adjacent location.",
    "Movement within the same city, district, building, shop, or worksite is intra-location focus, not routes.",
    "Phrases like back to the forge, into the market, over to the bench, or to the tavern inside the same place should not add routes to mustCheck.",
    "When the player strongly implies movement into a clear sub-location within the current macro-location, emit attention.impliedDestinationFocus with a concise key and label such as back_room/The Back Room, yard/Yard, stable_entrance/Stable Entrance, workbench/Workbench, stall_front/Stall Front, or alleyway/Alleyway.",
    "Do not emit impliedDestinationFocus for macro travel between location nodes or vague attention shifts with no clear sub-location.",
    "If no grounded ref exists but the noun is plausible, emit it in unresolvedReferents instead of resolvedReferents.",
    "resolvedReferents.targetRef must be an actual grounded ref from router_context, such as actor:... for scene actors, a known NPC id from knownNearbyNpcs, a real inventory id, a world object id, a route id, an information id, or a location id.",
    "Never use schema words like temporary_actor, scene_actor, inventory_item, world_object, route, information, or location as targetRef values.",
    "Only the authoritative current-state surfaces in router_context are valid interaction targets. recentGroundedHistory is memory, not authority.",
    "Never remap an unresolved pronoun or stale narrated referent onto a different grounded actor just to satisfy the schema.",
    "If the player explicitly names or clearly searches for someone listed in knownNearbyNpcs, resolve them as known_npc and request npc_detail when needed instead of downgrading them to an unresolved temporary actor.",
    "If the player seems to mean someone who is not in authoritativeState.sceneActors, authoritativeState.knownNearbyNpcs, or authoritativeState.worldObjects, keep that referent unresolved instead of guessing.",
    "Generic people like someone, passerby, customer, shopper, stranger, or interested local should remain unresolved temporary_actor referents unless the authoritative state already identifies them.",
    "Animals, mounts, familiars, pets, and other living creatures are actors, not world objects. If they are not already grounded in sceneActors, keep them unresolved as temporary_actor referents rather than resolving them as world objects.",
    "Do not remap a generic or unresolved person onto a named scene actor merely because one is present in the scene.",
    "If the player's noun exactly matches a present temporary actor's local role label, such as baker, guard, customer, or merchant, keep the referent anchored to that temp actor instead of drifting to a fetchable named NPC in the same scene.",
    "If one present scene actor is already the clear conversational counterpart from the grounded scene summaries, keep polite follow-ups like sir, ma'am, or what can I call you anchored to that actor instead of redirecting to another named bystander.",
    "If a present scene actor is marked detail-fetch(name/identity available) and the player asks for their name, title, identity, or what to call them, include npc_detail for that actor.",
    "If the player calls for, looks for, or tries to contact a named person listed in knownNearbyNpcs, request npc_detail for that exact NPC rather than spawning a duplicate generic stand-in.",
    "Never request npc_detail for temp: actors or unnamed temporary locals. npc_detail is only for grounded named NPC ids.",
    "Treat recentNarrativeProse as style continuity only, not evidence of who is present, what they carry, or what objects can be manipulated now.",
  ].join("\n");

  return correctionNotes ? `${base}\n${correctionNotes}` : base;
}

function formatSpatialPromptContext(context: SpatialPromptContext) {
  const sceneFocusLabel = context.sceneFocus?.label?.trim() || null;
  const currentLocationLabel = context.currentLocation?.name ?? "the road between locations";
  const activeJourneyLine = context.activeJourney
    ? `${context.activeJourney.originLocationName} -> ${context.activeJourney.destinationLocationName} (${context.activeJourney.elapsedMinutes}/${context.activeJourney.totalDurationMinutes}m, ${context.activeJourney.remainingMinutes}m remaining) [${context.activeJourney.edgeId}]`
    : null;
  return {
    locationOrientation: sceneFocusLabel
      ? `You are in ${currentLocationLabel}. Your current focus/position is: ${sceneFocusLabel}.`
      : `You are in ${currentLocationLabel}.`,
    promptRequestId: context.promptRequestId ?? null,
    mechanicsProfile: {
      approaches: formatApproachSummary(context.approaches),
      currencyProfile: context.currencyProfile ?? null,
      presentationProfile: context.presentationProfile ?? null,
    },
    authoritativeState: {
      currentLocation: context.currentLocation,
      sceneFocus: context.sceneFocus,
      routes: context.adjacentRoutes.map(formatPromptRouteLine),
      locationLeads: (context.locationLeads ?? []).map(formatPromptLocationLeadLine),
      activeJourney: activeJourneyLine,
      discoveryHooks: (context.discoveryHooks ?? []).map(formatPromptDiscoveryHookLine),
      latentTargets: (context.latentTargets ?? []).map(formatPromptLatentTargetLine),
      sceneActors: context.sceneActors,
      inventory: context.inventory,
      currency: context.currency,
      worldObjects: context.worldObjects,
      sceneAspects: context.sceneAspects,
    },
    recentLocalEvents: context.recentLocalEvents,
    recentGroundedHistory: context.recentTurnLedger,
    recentNarrativeProse: (context.recentNarrativeProse ?? []).slice(-2),
    discoveredInformation: context.discoveredInformation,
    activePressures: context.activePressures,
    recentWorldShifts: context.recentWorldShifts,
    activeThreads: context.activeThreads,
    localTexture: context.localTexture,
    globalTime: context.globalTime,
    timeOfDay: context.timeOfDay,
    dayCount: context.dayCount,
  };
}

function buildTurnUserPrompt(input: {
  playerAction: string;
  promptContext: SpatialPromptContext;
  character: CampaignCharacter;
  fetchedFacts: TurnFetchToolResult[];
  routerDecision: RouterDecision;
}) {
  return [
    formatPromptBlock("attention_packet", buildAttentionPacketBlock(input.routerDecision)),
    formatPromptBlock("action", input.playerAction),
    formatPromptBlock("router_constraints", buildRouterConstraintsBlock(input.routerDecision)),
    formatPromptBlock("context", formatSpatialPromptContext(input.promptContext)),
    formatPromptBlock("character", {
      name: input.character.name,
      drivingGoal: input.character.drivingGoal ?? null,
      vitality: {
        current: input.character.health,
        max: input.character.maxVitality ?? input.character.maxHealth ?? input.character.health,
        label: input.character.presentationProfile?.vitalityLabel ?? "Vitality",
      },
      approaches: formatApproachSummary(input.character.approaches),
      approachModifiers: input.character.stats,
      frameworkValues: input.character.frameworkValues,
      currency: {
        totalBaseUnits: input.character.currencyCp,
        profile: input.character.currencyProfile ?? null,
      },
    }),
    formatPromptBlock("fetched_facts", input.fetchedFacts),
  ].join("\n\n");
}

function isAppliedArrivalMutation(entry: StateCommitLog[number], currentLocationId: string | null) {
  if (entry.status !== "applied") {
    return false;
  }

  if (entry.metadata?.arrivesInCurrentScene === true) {
    return true;
  }

  return entry.mutationType === "set_scene_actor_presence" && entry.metadata?.newLocationId === currentLocationId;
}

function sanitizeNarrationMetadata(entry: StateCommitLog[number]) {
  if (!entry.metadata) {
    return null;
  }

  if (entry.status === "rejected" || entry.status === "noop") {
    return null;
  }

  const metadata = entry.metadata;
  const sanitized: Record<string, unknown> = {};

  if (typeof metadata.actorRef === "string") {
    sanitized.actorRef = metadata.actorRef;
  }
  if (typeof metadata.newLocationId === "string" || metadata.newLocationId === null) {
    sanitized.newLocationId = metadata.newLocationId;
  }
  if (typeof metadata.arrivesInCurrentScene === "boolean") {
    sanitized.arrivesInCurrentScene = metadata.arrivesInCurrentScene;
  }
  if (typeof metadata.aspectKey === "string") {
    sanitized.aspectKey = metadata.aspectKey;
  }
  if (typeof metadata.objectId === "string") {
    sanitized.objectId = metadata.objectId;
  }
  if (typeof metadata.state === "string") {
    sanitized.state = metadata.state;
  }
  if (typeof metadata.itemId === "string") {
    sanitized.itemId = metadata.itemId;
  }
  if (typeof metadata.informationId === "string") {
    sanitized.informationId = metadata.informationId;
  }
  if (typeof metadata.npcId === "string") {
    sanitized.npcId = metadata.npcId;
  }
  if (typeof metadata.localEntityId === "string") {
    sanitized.localEntityId = metadata.localEntityId;
  }
  if (typeof metadata.topic === "string") {
    sanitized.topic = metadata.topic;
  }
  if (typeof metadata.socialOutcome === "string") {
    sanitized.socialOutcome = metadata.socialOutcome;
  }
  if (typeof metadata.phase === "string") {
    sanitized.phase = metadata.phase;
  }
  if (typeof metadata.focusKey === "string") {
    sanitized.focusKey = metadata.focusKey;
  }
  if (typeof metadata.label === "string") {
    sanitized.label = metadata.label;
  }

  return Object.keys(sanitized).length ? sanitized : null;
}

function buildSanitizedNarrationCommitLog(stateCommitLog: StateCommitLog) {
  return stateCommitLog.map((entry) => ({
    kind: entry.kind,
    mutationType: entry.mutationType ?? null,
    status: entry.status,
    reasonCode: entry.reasonCode,
    summary: entry.summary,
    metadata: sanitizeNarrationMetadata(entry),
  }));
}

function buildResolvedNarrationConstraints(input: ResolvedTurnNarrationInput) {
  const sanitizedCommitLog = buildSanitizedNarrationCommitLog(input.stateCommitLog);
  const appliedMutations = sanitizedCommitLog.filter(
    (entry) => entry.status === "applied" && entry.kind === "mutation" && entry.mutationType,
  );
  const rejectedMutations = sanitizedCommitLog.filter(
    (entry) => entry.status === "rejected" && entry.kind === "mutation" && entry.mutationType,
  );
  const timeOnlyTurn =
    appliedMutations.length > 0
    && appliedMutations.every((entry) => entry.mutationType === "advance_time");
  const appliedNonTimeMutations = appliedMutations.filter((entry) => entry.mutationType !== "advance_time");
  const rejectedNonTimeMutations = rejectedMutations.filter((entry) => entry.mutationType !== "advance_time");
  const hasRejectedInvalidTargetAttempt = rejectedNonTimeMutations.some(
    (entry) =>
      (
        entry.mutationType === "record_local_interaction"
        || entry.mutationType === "record_actor_interaction"
        || entry.mutationType === "record_npc_interaction"
        || entry.mutationType === "set_scene_actor_presence"
      )
      && entry.reasonCode === "invalid_target",
  );
  const hasRejectedSemanticAttempt = rejectedNonTimeMutations.some(
    (entry) =>
      (
        entry.mutationType === "record_local_interaction"
        || entry.mutationType === "record_actor_interaction"
        || entry.mutationType === "record_npc_interaction"
        || entry.mutationType === "set_scene_actor_presence"
      )
      && entry.reasonCode === "invalid_semantics",
  );
  const waitingForArrival =
    /\bwait\b/i.test(input.playerAction)
    && /\b(for|until|til)\b/i.test(input.playerAction)
    && /\b(arrive|arrives|arrival|return|returns|come|comes)\b/i.test(input.playerAction);
  const unresolvedTargetMentions = (input.narrationHint?.unresolvedTargetPhrases ?? []).filter(Boolean);

  return {
    timeOnlyTurn,
    waitingForArrival,
    rejectedOutcomeOnly:
      rejectedNonTimeMutations.length > 0 && appliedNonTimeMutations.length === 0,
    rejectedInteractionOnly:
      rejectedNonTimeMutations.length > 0
      && appliedNonTimeMutations.length === 0
      && rejectedNonTimeMutations.every(
        (entry) =>
          entry.mutationType === "record_local_interaction"
          || entry.mutationType === "record_actor_interaction"
          || entry.mutationType === "record_npc_interaction"
          || entry.mutationType === "set_scene_actor_presence",
      ),
    rejectedMutationTypes: rejectedNonTimeMutations.map((entry) => entry.mutationType),
    hasRejectedInvalidTargetAttempt,
    hasRejectedSemanticAttempt,
    hasAppliedManifestedAspect: appliedNonTimeMutations.some((entry) => entry.mutationType === "spawn_scene_aspect"),
    hasAppliedManifestedActor: appliedNonTimeMutations.some((entry) => entry.mutationType === "spawn_temporary_actor"),
    hasRejectedKnowledgeAttempt: rejectedNonTimeMutations.some((entry) => entry.mutationType === "discover_information"),
    unresolvedTargetFailure: unresolvedTargetMentions.length > 0,
    unresolvedTargetMentions,
    hasArrivalCommit: sanitizedCommitLog.some((entry) =>
      isAppliedArrivalMutation(entry, input.promptContext.currentLocation?.id ?? null),
    ),
  };
}

function narrationViolatesResolvedConstraints(
  input: ResolvedTurnNarrationInput,
  narration: string,
) {
  const constraints = buildResolvedNarrationConstraints(input);
  const normalizedNarration = narration.toLowerCase();
  const unquotedNarration = narration
    .replace(/"[^"]*"/g, " ")
    .replace(/“[^”]*”/g, " ")
    .replace(/‘[^’]*’/g, " ");

  if (constraints.rejectedInteractionOnly && /["“”'‘’]/.test(narration)) {
    return "Rejected interaction-only turns must not invent quoted dialogue.";
  }

  if (
    !constraints.timeOnlyTurn
    && /\b(?:time passes for \d+ minutes?|(?:one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|thirty|forty|forty-five|forty five|sixty|\d+)\s+minutes?\s+pass)\b/i.test(narration)
  ) {
    return "Mixed turns must absorb elapsed time naturally instead of explicitly saying how many minutes pass.";
  }

  if (
    constraints.hasAppliedManifestedActor
    && /\b(?:enters?|entered|has entered|had entered)\s+the\s+scene\b/i.test(normalizedNarration)
  ) {
    return "Spawned actors must be narrated naturally, not with engine-summary phrasing like enters the scene.";
  }

  if (
    constraints.unresolvedTargetFailure
    && (/["“”'‘’]/.test(narration) || /\b(?:replies?|says|said|answers?|answered|asks?|asked)\b/i.test(narration))
  ) {
    return "Unresolved-target turns must not invent a clean spoken exchange with a substituted actor.";
  }

  if (
    /\b(?:me|my|mine|we|us|our|ours)\b/i.test(unquotedNarration)
    || /\bi(?:\b|['’](?:m|d|ll|ve))\b/i.test(unquotedNarration)
  ) {
    return "Narration must not mirror the player's first-person wording or use I/me/my/we/our outside quoted dialogue.";
  }

  if (
    !/\b(?:you|your|yours|yourself)\b/i.test(unquotedNarration)
  ) {
    return "Narration must address the player in second person with you/your phrasing.";
  }

  return null;
}

function buildResolvedTurnNarrationPrompt(input: ResolvedTurnNarrationInput) {
  const sanitizedCommitLog = buildSanitizedNarrationCommitLog(input.stateCommitLog);
  const fastForwardConstraint =
    input.narrationBounds?.isFastForward
      ? [
          `The player executed a fast-forward routine covering ${input.narrationBounds.committedAdvanceMinutes} committed minutes.`,
          "Do not narrate minute-by-minute.",
          "Summarize the recurring activities in 2-4 sentences using montage language.",
          input.narrationBounds.interruptionReason
            ? `Pivot sharply on the final sentence to this interruption: ${input.narrationBounds.interruptionReason}`
            : "Conclude by noting that the time passes without a sharp interruption.",
        ].join(" ")
      : null;
  const system = [
    "**Role**",
    "You are the Dungeon Master's prose voice for a resolved turn in a living world.",
    "",
    "**Core Job**",
    "The world has already decided what happened. Your job is to take the committed mutations, authoritative state, fetched facts, and player action and render them into compact, second-person prose that feels alive and trustworthy.",
    "The truth constraints below are the walls of the room. Craft lives inside those walls.",
    "Address the player as you/your. Do not mirror the player's first-person wording as I/my/we/our.",
    "Licensed texture means sensory surface detail, ordinary object specificity, micro-gestures, tone of voice, small role-appropriate habits, and environmental atmosphere directly supported by the committed log, authoritative state, or fetched facts.",
    "Licensed texture never adds new actors, new interactables, new agreements, prices, discoveries, hidden causes, or other unsupported state.",
    "",
    "**Truth Constraints**",
    "Narrate only what is grounded in the committed state_commit_log, the player's action, the provided spatial context, and the fetched facts; never invent successful outcomes, prices, discoveries, travel, social shifts, or unsupported NPC reactions.",
    "Preserve failure honestly: rejected or failed actions must remain visibly failed in-world. Make failure legible, but only name a specific cause if it is supported by the committed log, fetched facts, or authoritative context. If rejectedOutcomeOnly is true, do not narrate rejected outcomes as if they happened. If rejectedInteractionOnly is true, the attempt may stall or go unanswered, but do not invent direct replies, completed errands, or offscreen returns.",
    "Keep committed uncertainty intact: only context.authoritativeState.sceneActors and context.authoritativeState.worldObjects are stable immediate interaction targets. recentNarrativeProse is continuity only, not authority. Unresolved targets must stay unresolved and may not be substituted — if unresolvedTargetFailure is true, the intended target is gone, unreachable, or lost. Arrivals and returns only happened if the committed log makes them explicit; if the player waited for one that did not commit, say it has not happened yet. Ambiguous scene aspects stay ambiguous — narrate only the visible condition, not the hidden cause. Spawned actors are noticed naturally, not announced.",
    "Do not visually place, quote, or otherwise present a named NPC as being in the room unless they are listed in context.authoritativeState.sceneActors or an applied set_scene_actor_presence entry brought them in this turn.",
    "For applied record_local_interaction, record_actor_interaction, and record_npc_interaction entries, state_commit_log.metadata.socialOutcome is immutable truth. Reflect it exactly. Do not soften declines into acceptance, withholds into full answers, counteroffers into closed deals, or acknowledges into agreement.",
    "Do not render acknowledges, hesitates, withholds, asks_question, redirects, resists, or withdraws as acceptance, invitation, agreement, or emotionally closed dialogue. Quoted dialogue may not close the beat unless the committed outcome itself is a closure state.",
    "Do not narrate completed item custody changes, consumption, gifting, feeding, storage, or item use by another holder unless state_commit_log includes the applied asset mutation that makes it true.",
    "If state_commit_log includes a rejected record_local_interaction or set_scene_actor_presence with reasonCode invalid_target, narrate that the player looked for or attempted that contact but could not find or reach them. Do not narrate a successful encounter.",
    "If state_commit_log includes a rejected record_local_interaction or set_scene_actor_presence with reasonCode invalid_semantics, narrate the player as unable to complete that intent through another person or presence change, without inventing that it happened anyway.",
    "If a discover_information mutation was rejected, do not convert that into an authoritative negative fact unless the applied state log independently proves it. If rejectedMutationTypes only cover item or scene changes, do not invent completed crafting outputs, item transfers, or scene transformations that the log rejected.",
    "If the applied log only advances time, narrate only the passage and any grounded atmosphere shift; if advance_time accompanies another mutation, absorb elapsed time naturally and do not explicitly count minutes unless the exact duration materially matters. Do not use elapsed time as a prompt to generate journey or travel description.",
    fastForwardConstraint ? `If narrationBounds.isFastForward is true: ${fastForwardConstraint}` : null,
    "Quoted dialogue must be grounded by a committed interaction, a committed check result, fetched facts, or explicit player speech that is visibly answered in the committed log.",
    "",
    "**Craft Rules**",
    "Never open by paraphrasing the player's action. Begin sentence one with the world's reaction, the immediate consequence, or the sensory shift of the moment.",
    "If the player offers a flavorful hook, preference, tease, compliment, habit, or invitation, answer it with one grounded specific instead of abstract summary.",
    "Include at least one concrete sensory, physical, or character detail per turn when the committed log supports non-trivial narration; on truly thin turns, one short sentence of legible absence, pause, or passage is enough.",
    "Prefer one specific noun, gesture, smell, texture, or sound over placeholders like standard choice, fresh items, or a response.",
    "When a grounded local NPC is involved, allow one small human detail such as a habit, preference, mannerism, tone, or opinion.",
    "Only use quoted dialogue if the player_action included spoken words, or the committed interaction is clearly social or interpersonal. Otherwise, a concrete gesture, object action, or physical cue is often stronger.",
    "Add one fresh grounded detail, clarified consequence, or emotional or sensory shift beyond the player's own wording, but do not invent forward plot motion.",
    "Prefer one tight paragraph for ordinary turns. Use more length only when mutation complexity genuinely requires it.",
    "Grounded does not mean bland. Favor compact, specific, characterful prose over generic transactional summary.",
    "",
    "**Turn-Type Heuristics**",
    "- Local interaction: Cash in player hooks, add one human or sensory beat, and use a short quoted line only when speech is clearly licensed.",
    "- Movement / repositioning: Narrate arrival, not the journey. Absorb elapsed time in one grounded detail of the destination or immediate transition; do not invent atmosphere for the path between.",
    "- Investigation / search: Narrate the act of looking and make absence tangible without turning failure into authoritative certainty.",
    "- Tense / suspicious: Imply through behavior, spacing, sound, or motion rather than explaining motives.",
    "- Self-directed / equipment / inventory: Focus on tactile, visual, or material detail and keep the beat intimate and brief.",
    "- Failure / unavailable target: Make the miss, silence, or absence immediate and legible; never substitute another target.",
    "",
    "**Anti-Patterns and Better Alternatives**",
    "Instead of generic agreement beats like they nod, they smile, or they agree, show agreement through a concrete action, object, or short licensed line.",
    "Instead of placeholders like standard choice, fresh items, a response, or their offer, name one specific thing or surface detail.",
    "Instead of filler like the market bustles around you, use one local sensory or physical detail that matters now.",
    "Instead of engine-speak like enters the scene, changes state, or time passes, rewrite the event as natural scene prose.",
    "Instead of opening with the player's action, begin with what happens next.",
    "Instead of ending on flat logistics, end on a living image, gesture, atmosphere beat, or grounded human detail when the turn supports it.",
    "Instead of mirroring the player's first-person voice, rewrite the beat in second person.",
    "",
    "**Style Examples**",
    "Example 1 - Routine local interaction: The worker glances up from the bench, rubs sawdust from one thumb, and angles the straighter of the two pieces toward you. \"Take this one,\" he says. \"It'll hold longer.\" The grain is warm from his hands.",
    "Example 2 - Suspicious or uncertain observation: Across the room, a chair leg scrapes once and then goes still. The conversation around it never quite breaks, but one voice drops out for a beat too long. When you look directly that way, all you catch is a sleeve disappearing behind a post.",
    "Example 3 - Self-directed item handling: You turn the key over in your palm. Its teeth catch the light, still warm from your pocket, and leave a faint smear of oil on your thumb. The small weight feels heavier now that the lock it once opened is gone.",
    "Example 4 - Missed or unavailable contact: The doorway stands open, but whoever was there a moment ago is gone. A half-finished tool on the step and the still-swinging latch are the only signs you were not quite quick enough.",
    "",
    "**Output Instructions**",
    "Return exactly one structured payload using the provided tool. The narration field must contain only the player-facing DM prose in second person using you/your, with no engine language, no meta commentary, no mirrored first-person phrasing, and no restated action summary.",
  ].join("\n");

  const user = [
    formatPromptBlock("player_action", input.playerAction),
    formatPromptBlock("narration_constraints", buildResolvedNarrationConstraints(input)),
    formatPromptBlock("context", formatSpatialPromptContext(input.promptContext)),
    formatPromptBlock("fetched_facts", input.fetchedFacts),
    formatPromptBlock("state_commit_log", sanitizedCommitLog),
    formatPromptBlock("check_result", input.checkResult ?? null),
    formatPromptBlock("suggested_actions", input.suggestedActions),
  ].join("\n\n");

  return { system, user };
}

function buildResolvedTurnSuggestedActionsPrompt(input: ResolvedTurnSuggestedActionsInput) {
  const sanitizedCommitLog = buildSanitizedNarrationCommitLog(input.stateCommitLog);
  const system = [
    "**Role**",
    "You generate immediate next-action suggestions after a resolved turn in a living world.",
    "",
    "**Core Job**",
    "Use the committed outcomes and current authoritative context to suggest what the player could reasonably do next.",
    "Return zero to four short concrete action strings. If nothing clearly grounded stands out, return an empty array.",
    "",
    "**Truth Constraints**",
    "Treat state_commit_log and context as authoritative. fetched_facts may add grounded detail, but may not override committed outcomes.",
    "candidate_suggested_actions are weak hints only. Ignore any candidate that is stale, redundant, contradicted by the committed state, or no longer immediately available.",
    "Never suggest re-finding, re-locating, or asking directions to a place already established in the current sceneFocus or currentLocation.",
    "Never suggest interacting with a person who is not a current grounded scene actor unless the suggestion is explicitly about finding or reaching them from the current state.",
    "Never suggest finalizing, collecting, or closing a payment or deal that the committed log already resolved.",
    "Never suggest repeating the exact action the player just completed unless the committed state clearly leaves it unfinished.",
    "Prefer nearby, scene-local follow-through. When in doubt, choose the action that fits the current room, actor, object, pressure, or unresolved consequence.",
    "",
    "**Style Rules**",
    "Each suggestion must be a short imperative or action fragment, not a question and not meta commentary.",
    "Prefer concrete next moves like Inspect the ledger, Ask about the missing crate, or Step into the back room.",
    "Avoid vague filler like Keep going, Continue, Do more, or See what happens.",
    "If the turn ended in a clear refusal, miss, or blocked attempt, suggest a grounded alternative approach or a nearby follow-up instead of pretending success.",
    "",
    "**Output Instructions**",
    "Return exactly one structured payload using the provided tool.",
  ].join("\n");

  const user = [
    formatPromptBlock("player_action", input.playerAction),
    formatPromptBlock("context", formatSpatialPromptContext(input.promptContext)),
    formatPromptBlock("fetched_facts", input.fetchedFacts),
    formatPromptBlock("state_commit_log", sanitizedCommitLog),
    formatPromptBlock("check_result", input.checkResult ?? null),
    formatPromptBlock("candidate_suggested_actions", input.candidateSuggestedActions),
  ].join("\n\n");

  return { system, user };
}

async function runCompletion(options: {
  system: string;
  user: string;
  tools?: Array<{ name: string; description: string; input_schema: Record<string, unknown> }>;
  maxTokens?: number;
  model?: string;
  temperature?: number;
  signal?: AbortSignal;
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

  const selectedModel = options.model?.trim() || env.openRouterModel;

  function normalizeResponseError(response: unknown) {
    if (!response || typeof response !== "object") {
      return null;
    }

    const responseRecord = response as Record<string, unknown>;
    const errorValue = responseRecord.error;
    if (!errorValue || typeof errorValue !== "object") {
      return null;
    }

    const errorRecord = errorValue as Record<string, unknown>;
    const message =
      typeof errorRecord.message === "string"
        ? errorRecord.message
        : "OpenRouter returned an error payload without choices.";
    const status =
      typeof errorRecord.status_code === "number"
        ? errorRecord.status_code
        : typeof errorRecord.code === "number"
          ? errorRecord.code
          : null;
    const error = new Error(message) as Error & {
      status?: number;
      code?: string | number;
      type?: string;
    };
    if (status != null) {
      error.status = status;
    }
    if (typeof errorRecord.code === "string" || typeof errorRecord.code === "number") {
      error.code = errorRecord.code;
    }
    if (typeof errorRecord.type === "string") {
      error.type = errorRecord.type;
    }
    return error;
  }

  for (const [attemptIndex, { apiKey, keyIndex }] of orderedApiKeys.entries()) {
    const client = createClient(apiKey);

    logOpenRouterRequest({
      model: selectedModel,
      system: options.system,
      user: options.user,
      tools: options.tools,
    });

    try {
      const response = await client.chat.completions.create(
        {
          model: selectedModel,
          temperature: options.temperature ?? 0.7,
          max_tokens: options.maxTokens ?? 8000,
          messages: [
            { role: "system", content: options.system },
            { role: "user", content: options.user },
          ],
          tools: options.tools?.map(toFunctionTool),
          tool_choice: options.tools?.length ? "auto" : undefined,
        },
        options.signal ? { signal: options.signal } : undefined,
      );

      const normalizedResponseError = normalizeResponseError(response);
      if (normalizedResponseError) {
        throw normalizedResponseError;
      }

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

function normalizeIntentSurfaceText(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function findCustomEntryIntentConflicts(input: {
  intent: z.infer<typeof customEntryIntentSchema>;
  resolvedDraft: z.infer<typeof customResolvedLaunchEntryDraftSchema>;
  validInformation: Array<{
    id: string;
    title: string;
    sourceNpcId: string | null;
  }>;
  validNpcs: Array<{
    id: string;
    name: string;
  }>;
}) {
  const issues: string[] = [];
  const normalizedPublicLead = normalizeIntentSurfaceText(input.resolvedDraft.publicLead);
  const chosenInformation = input.validInformation.filter((information) =>
    input.resolvedDraft.initialInformationIds.includes(information.id),
  );

  if (
    input.intent.socialAnchorPreference !== "named_contact"
    && input.resolvedDraft.localContactNpcId
  ) {
    issues.push(
      "This request reads as self-directed or ambient, so do not hinge the opening on a named NPC contact.",
    );
  }

  if (
    input.intent.socialAnchorPreference === "ambient_locals"
    && !input.resolvedDraft.temporaryLocalActors.length
    && !input.resolvedDraft.localContactTemporaryActorLabel
  ) {
    issues.push(
      "Prefer ambient unnamed locals or ordinary passersby for scene texture instead of centering a named contact.",
    );
  }

  if (
    input.intent.informationLeadPreference === "none"
    && input.resolvedDraft.initialInformationIds.length > 0
  ) {
    issues.push(
      "Do not seed a formal information hook here; keep the opening grounded in routine action and visible local motion.",
    );
  }

  if (
    input.intent.informationLeadPreference === "ambient_public"
    && chosenInformation.some((information) => information.sourceNpcId)
  ) {
    issues.push(
      "If you include starting information, keep it ambient and public rather than tied to a named NPC briefing or faction hook.",
    );
  }

  if (
    input.intent.informationLeadPreference !== "named_hook"
    && input.validNpcs.some((npc) => normalizedPublicLead.includes(normalizeIntentSurfaceText(npc.name)))
  ) {
    issues.push(
      "The public lead should describe observable street life or local motion, not a named NPC handing out the opening hook.",
    );
  }

  return issues;
}

function buildCustomEntryIntentCorrectionNotes(input: {
  priorCorrectionNotes?: string | null;
  intent: z.infer<typeof customEntryIntentSchema>;
  issues: string[];
}) {
  return [
    input.priorCorrectionNotes?.trim() || null,
    "The previous custom-entry attempt drifted away from the player's intended opening shape.",
    `Interpreted intent to preserve: ${input.intent.notes}`,
    ...input.issues,
    "Keep the start self-directed, ordinary, and locally playable unless the player clearly asked for a named quest contact.",
  ].filter((value): value is string => Boolean(value)).join("\n");
}

function summarizeLaunchResolutionLocations(module: GeneratedWorldModule) {
  return module.locations.map((location) => ({
    id: location.id,
    name: location.name,
    type: location.type,
  }));
}

function summarizeLaunchResolutionNpcs(module: GeneratedWorldModule) {
  return module.npcs.map((npc) => ({
    id: npc.id,
    name: npc.name,
    role: npc.role,
    currentLocationId: npc.currentLocationId,
  }));
}

function summarizeLaunchResolutionInformation(module: GeneratedWorldModule) {
  return module.information.map((information) => ({
    id: information.id,
    title: information.title,
    summary: information.summary,
    accessibility: information.accessibility,
    locationId: information.locationId,
    factionId: information.factionId,
    sourceNpcId: information.sourceNpcId,
  }));
}

class DungeonMasterClient {
  async interpretOpeningRewriteIntent(input: {
    prompt: string;
    previousDraft: GeneratedCampaignOpening;
    entryPoint: ResolvedLaunchEntry;
  }): Promise<z.infer<typeof openingRewriteIntentSchema> | null> {
    try {
      const response = await runCompletion({
        system: [
          "Interpret what the player is trying to change when they ask to rewrite an opening scene.",
          "Distinguish between changes to prose/tone within the same entry versus requests that really want a different entry setup or start location.",
          "Treat creative phrasing semantically, not literally.",
          "If the player is steering away from prior conflict, interruption, confrontation, or urgent hooks, mark confrontationCarryForward as remove even if they do not use those exact words.",
          "If the player wants a calmer, more routine, more domestic, more ordinary, or more slice-of-life opening, mark tensionDirection as calmer.",
          "Return only the structured interpretation payload.",
        ].join("\n"),
        user: [
          formatPromptBlock("rewrite_prompt", input.prompt),
          formatPromptBlock("current_entry_point", {
            title: input.entryPoint.title,
            summary: input.entryPoint.summary,
            immediatePressure: input.entryPoint.immediatePressure,
            publicLead: input.entryPoint.publicLead,
            startLocationId: input.entryPoint.startLocationId,
          }),
          formatPromptBlock("previous_draft", input.previousDraft),
        ].join("\n\n"),
        tools: [openingRewriteIntentTool],
        maxTokens: 500,
      });

      const parsed = openingRewriteIntentSchema.safeParse(response?.input);
      if (!parsed.success) {
        logOpenRouterResponse("opening_rewrite_intent.schema_failure", {
          issues: parsed.error.issues,
          inputPreview: toPreview(response?.input),
        });
        return null;
      }

      logOpenRouterResponse("opening_rewrite_intent.success", {
        preview: toPreview(parsed.data),
      });
      return parsed.data;
    } catch (error) {
      logOpenRouterResponse("opening_rewrite_intent.error", {
        message: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  async interpretCustomEntryIntent(input: {
    prompt: string;
    character: CharacterTemplate;
  }): Promise<z.infer<typeof customEntryIntentSchema> | null> {
    try {
      const response = await runCompletion({
        system: [
          "Interpret the shape of the opening the player actually wants from a custom-entry prompt.",
          "Reason semantically about routine, privacy, daily work, ambient locals, social scale, and whether the player is asking for a named contact or explicit hook.",
          "If the prompt is centered on ordinary work, home life, craft, errands, or a personal project, prefer activityFrame routine_work or private_project.",
          "If the prompt does not ask for a specific named NPC to approach, prefer socialAnchorPreference ambient_locals or solitary over named_contact.",
          "If the prompt already supplies enough lived circumstance to act on, prefer informationLeadPreference none or ambient_public over named_hook.",
          "Return only the structured interpretation payload.",
        ].join("\n"),
        user: [
          formatPromptBlock("player_request", input.prompt),
          formatPromptBlock("character", {
            name: input.character.name,
            archetype: input.character.archetype,
            backstory: input.character.backstory,
          }),
        ].join("\n\n"),
        tools: [customEntryIntentTool],
        maxTokens: 500,
      });

      const parsed = customEntryIntentSchema.safeParse(response?.input);
      if (!parsed.success) {
        logOpenRouterResponse("custom_entry_intent.schema_failure", {
          issues: parsed.error.issues,
          inputPreview: toPreview(response?.input),
        });
        return null;
      }

      logOpenRouterResponse("custom_entry_intent.success", {
        preview: toPreview(parsed.data),
      });
      return parsed.data;
    } catch (error) {
      logOpenRouterResponse("custom_entry_intent.error", {
        message: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

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

  async generateCharacterConcept(prompt: string): Promise<{ concept: CharacterConceptDraft; source: "openrouter" }> {
    const conceptTool = createStructuredTool(
      "generate_character_concept",
      "Generate one narrative-only character concept with no mechanics, no stats, and no module assumptions.",
      characterConceptDraftSchema,
    );

    try {

      const response = await runCompletion({
        system: [
          "You create standalone solo-RPG character concepts.",
          "Return only narrative fields. Do not invent mechanics, framework values, approaches, or vitality numbers.",
          `starterItems must contain at most ${MAX_STARTER_ITEMS} specific, mundane items.`,
        ].join("\n"),
        user: prompt,
        tools: [conceptTool],
      });

      const parsed = characterConceptDraftSchema.safeParse(response?.input);
      if (!parsed.success) {
        throw new Error(`Character concept generation returned invalid structured data: ${parsed.error.message}`);
      }

      return { concept: parsed.data, source: "openrouter" };
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : "Character concept generation failed.");
    }
  }

  async generateModuleCharacterTemplate(input: {
    prompt: string;
    module: GeneratedWorldModule;
    sourceConcept?: CharacterConceptDraft | null;
  }): Promise<{ character: CharacterTemplateDraft; source: "openrouter" }> {
    const compiledFramework = compileCharacterFramework(input.module.characterFramework!);
    const templateSchema = buildCharacterTemplateDraftSchema(compiledFramework);
    const templateTool = createStructuredTool(
      "generate_module_character_template",
      "Generate one playable module-bound character template that strictly matches the provided framework.",
      templateSchema,
    );

    try {
      const response = await runCompletion({
        system: [
          "You create playable solo-RPG protagonists bound to a specific module framework.",
          "Always return frameworkVersion exactly as provided.",
          "frameworkValues must strictly satisfy the provided field ids and allowed values.",
          "Do not invent extra framework fields or rename ids.",
          "Keep the character grounded in the module's tone and setting.",
        ].join("\n"),
        user: [
          formatPromptBlock("prompt", input.prompt),
          formatPromptBlock("module", {
            title: input.module.title,
            premise: input.module.premise,
            tone: input.module.tone,
            setting: input.module.setting,
          }),
          formatPromptBlock("character_framework", compiledFramework.framework),
          formatPromptBlock("source_concept", input.sourceConcept ?? null),
        ].join("\n\n"),
        tools: [templateTool],
      });

      const parsed = templateSchema.safeParse(response?.input);
      if (!parsed.success) {
        throw new Error(`Module character generation returned invalid structured data: ${parsed.error.message}`);
      }

      return { character: parsed.data, source: "openrouter" };
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : "Module character generation failed.");
    }
  }

  async generateCharacterFrameworkForModule(input: {
    module: GeneratedWorldModule;
    guidance?: string | null;
  }): Promise<{ framework: CharacterFramework; source: "openrouter" }> {
    const frameworkTool = createStructuredTool(
      "generate_character_framework",
      "Generate one module-native character framework for a solo RPG module.",
      characterFrameworkSchema,
    );

    try {
      const response = await runCompletion({
        system: [
          "You design character creation frameworks for reusable solo-RPG modules.",
          "Return exactly one characterFramework object.",
          "The framework must feel native to the module's setting, pressures, and daily life instead of falling back to generic fantasy stats.",
          "Use stable ids and concise player-facing labels.",
          "Include a small set of approaches mapped directly to numeric fields.",
          "Numeric fields should represent the module's actual style of action, survival, trade, social leverage, perception, craft, ritual, or movement as appropriate.",
          "Choice and text fields are allowed when they materially improve character creation, but keep the framework compact and practical.",
          "baseVitality, vitalityLabel, currencyProfile, and presentationProfile must match the module's tone and economy.",
          "Do not use the legacy fallback labels Force, Finesse, Endure, Analyze, Notice, or Influence unless the module genuinely demands that exact vocabulary.",
        ].join("\n"),
        user: [
          formatPromptBlock("module_summary", summarizeWorld(input.module)),
          formatPromptBlock("module_details", {
            locations: input.module.locations.map((location) => ({
              id: location.id,
              name: location.name,
              type: location.type,
              summary: location.summary,
              state: location.state,
            })),
            factions: input.module.factions.map((faction) => ({
              id: faction.id,
              name: faction.name,
              type: faction.type,
              summary: faction.summary,
              agenda: faction.agenda,
            })),
            npcs: input.module.npcs.map((npc) => ({
              id: npc.id,
              name: npc.name,
              role: npc.role,
              summary: npc.summary,
            })),
            commodities: input.module.commodities.map((commodity) => ({
              id: commodity.id,
              name: commodity.name,
              baseValue: commodity.baseValue,
              tags: commodity.tags,
            })),
            entryPoints: input.module.entryPoints,
          }),
          formatPromptBlock("framework_guidance", input.guidance?.trim() || null),
          formatFinalInstruction([
            "Build a framework players can use to create protagonists who make sense in this world immediately.",
            "Prefer module-native approach labels over generic RPG stat names.",
            "Use frameworkVersion as a stable slug-like version string for this module framework.",
            "Keep approach ids and field ids machine-stable and lowercase snake_case or lowercase words.",
            "If the module has a core metaphysical, magical, social, or economic substrate that shapes ordinary life, the framework must represent it directly instead of burying it inside generic utility labels.",
          ]),
        ].join("\n\n"),
        tools: [frameworkTool],
      });

      const parsed = characterFrameworkSchema.safeParse(response?.input);
      if (!parsed.success) {
        throw new Error(`Character framework generation returned invalid structured data: ${parsed.error.message}`);
      }

      return { framework: parsed.data, source: "openrouter" };
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : "Character framework generation failed.");
    }
  }

  async generateWorldModule(input: {
    prompt: string;
    scaleTier: WorldScaleTier;
    previousDraft?: GeneratedWorldModule;
    resumeCheckpoint?: OpenWorldGenerationCheckpoint | null;
    onCheckpoint?: (checkpoint: OpenWorldGenerationCheckpoint) => void;
    onProgress?: (update: WorldGenerationProgressUpdate) => void;
    shouldStop?: () => boolean;
  }): Promise<GeneratedWorldModuleDraft> {
    startWorldGenerationLog();
    let currentStage: WorldGenerationStageName | null = null;
    let persistCheckpointForFailure:
      | ((
        status: OpenWorldGenerationCheckpoint["generationStatus"],
        failedStage: OpenWorldGenerationCheckpoint["failedStage"],
        lastGenerationError: string | null,
      ) => void)
      | null = null;

    try {
      const checkpoint = normalizeWorldGenerationResumeCheckpoint({
        resumeCheckpoint: input.resumeCheckpoint,
        prompt: input.prompt,
        scaleTier: input.scaleTier,
        model: env.openRouterModel,
      });
      const scalePlan = buildWorldGenerationScalePlan(input.scaleTier);
      const attempts: OpenWorldGenerationArtifacts["attempts"] = checkpoint.attempts.slice();
      const validationReports: OpenWorldGenerationArtifacts["validationReports"] = checkpoint.validationReports.slice();
      const stageSummaries: OpenWorldGenerationArtifacts["stageSummaries"] = {
        ...checkpoint.stageSummaries,
      };
      const idMaps: OpenWorldGenerationArtifacts["idMaps"] = {
        factions: { ...checkpoint.idMaps.factions },
        locations: { ...checkpoint.idMaps.locations },
        edges: { ...checkpoint.idMaps.edges },
        factionRelations: { ...checkpoint.idMaps.factionRelations },
        npcs: { ...checkpoint.idMaps.npcs },
        information: { ...checkpoint.idMaps.information },
        commodities: { ...checkpoint.idMaps.commodities },
      };
      const notifyProgress = (update: WorldGenerationProgressUpdate) => {
        if (update.status === "running") {
          currentStage = update.stage;
        }
        logWorldGenerationProgress(update);
        input.onProgress?.(update);
      };
      const throwIfStopRequested = () => {
        if (input.shouldStop?.()) {
          throw new WorldGenerationStoppedError();
        }
      };

      const persistCheckpoint = (
        status: OpenWorldGenerationCheckpoint["generationStatus"],
        failedStage: OpenWorldGenerationCheckpoint["failedStage"],
        lastGenerationError: string | null,
      ) => {
        checkpoint.generationStatus = status;
        checkpoint.failedStage = failedStage;
        checkpoint.lastGenerationError = lastGenerationError;
        checkpoint.scalePlan = scalePlan;
        checkpoint.promptIntentProfile = checkpoint.stageArtifacts.prompt_intent ?? checkpoint.promptIntentProfile;
        checkpoint.promptArchitectureVersion = CURRENT_PROMPT_ARCHITECTURE_VERSION;
        checkpoint.attempts = attempts.slice();
        checkpoint.validationReports = validationReports.slice();
        checkpoint.idMaps = {
          factions: { ...idMaps.factions },
          locations: { ...idMaps.locations },
          edges: { ...idMaps.edges },
          factionRelations: { ...idMaps.factionRelations },
          npcs: { ...idMaps.npcs },
          information: { ...idMaps.information },
          commodities: { ...idMaps.commodities },
        };
        checkpoint.stageSummaries = { ...stageSummaries };
        checkpoint.completedStages = WORLD_GENERATION_STAGE_ORDER.filter(
          (stage) => checkpoint.stageArtifacts[stage] !== undefined,
        );
        input.onCheckpoint?.(structuredClone(checkpoint));
      };
      persistCheckpointForFailure = persistCheckpoint;
      persistCheckpoint("running", null, null);
      throwIfStopRequested();

      const markStageCompleted = <TStage extends CheckpointableWorldGenerationStageName>(
        stage: TStage,
        artifact: OpenWorldGenerationCheckpoint["stageArtifacts"][TStage],
      ) => {
        checkpoint.stageArtifacts[stage] = artifact;
        persistCheckpoint("running", null, null);
      };

      const markResumedStageComplete = (
        stage: CheckpointableWorldGenerationStageName,
        message: string,
      ) => {
        stageSummaries[stage] = message;
        notifyProgress({ stage, status: "complete", message });
      };

      let promptIntentProfile = checkpoint.stageArtifacts.prompt_intent ?? checkpoint.promptIntentProfile;
      if (promptIntentProfile) {
        logOpenRouterResponse("prompt_intent.resume", {
          source: checkpoint.stageArtifacts.prompt_intent ? "stage_artifact" : "checkpoint_metadata",
          profile: promptIntentProfile,
        });
        markResumedStageComplete(
          "prompt_intent",
          stageSummaries.prompt_intent
            ?? `Intent locked: ${promptIntentProfile.primaryTextureModes.join(", ")} texture with ${promptIntentProfile.primaryCausalLogic} causal logic.`,
        );
      } else {
        notifyProgress({
          stage: "prompt_intent",
          status: "running",
          message: getWorldGenerationStageRunningMessage("prompt_intent"),
        });
        promptIntentProfile = await runStructuredStage({
          stage: "prompt_intent",
          system: buildWorldGenSystemPrompt({
            stage: "prompt_intent",
            scaleTier: input.scaleTier,
            userPrompt: input.prompt,
            successLines: [
              "Infer only the prompt's generation intent, not the world itself.",
              "Identify the dominant texture modes most needed to preserve the prompt's feel.",
              "Set confidence to low when the prompt could support multiple readings or when the causal logic is unclear.",
              "Low confidence means neutral craft scaffolding and prompt noun preservation, not guessing a stronger worldview.",
              "Do not invent extra setting lore, factions, geography, or conflicts.",
              ...buildPromptIntentInferenceRubricLines(),
            ],
          }),
          buildUser: (correctionNotes) =>
            [
              buildWorldGenerationBasePrompt({
                prompt: input.prompt,
                scaleTier: input.scaleTier,
                scalePlan,
                previousDraft: input.previousDraft,
                correctionNotes,
              }),
              formatFinalInstruction([
                "Infer only the prompt intent profile.",
                "Choose 1 to 4 primaryTextureModes.",
                "Use low confidence whenever the prompt does not clearly force a stronger reading.",
              ]),
            ].join("\n\n"),
          schema: promptIntentProfileSchema,
          tool: promptIntentTool,
          attempts,
          validationReports,
          stageSummaries,
          prompt: input.prompt,
          shouldStop: input.shouldStop,
          summarize: (parsed) =>
            `Intent locked: ${parsed.primaryTextureModes.join(", ")} texture with ${parsed.primaryCausalLogic} causal logic.`,
        });
        checkpoint.promptIntentProfile = promptIntentProfile;
        markStageCompleted("prompt_intent", promptIntentProfile);
        logOpenRouterResponse("prompt_intent.locked", {
          profile: promptIntentProfile,
        });
        notifyProgress({
          stage: "prompt_intent",
          status: "complete",
          message: stageSummaries.prompt_intent,
        });
      }
      if (!promptIntentProfile) {
        promptIntentProfile = DEFAULT_PROMPT_INTENT_PROFILE;
      }

      let worldBible = checkpoint.stageArtifacts.world_bible;
      if (worldBible) {
        markResumedStageComplete(
          "world_bible",
          stageSummaries.world_bible
            ?? `${worldBible.title}: ${worldBible.widespreadBurdens.length} widespread burdens, ${worldBible.explanationThreads.length} explanation threads.`,
        );
      } else {
        notifyProgress({
          stage: "world_bible",
          status: "running",
          message: getWorldGenerationStageRunningMessage("world_bible"),
        });
        worldBible = await runStructuredStage({
        stage: "world_bible",
        system: buildWorldGenSystemPrompt({
          stage: "world_bible",
          scaleTier: input.scaleTier,
          userPrompt: input.prompt,
          promptIntentProfile,
          successLines: [
            ...buildScaleProfilePromptLines(scalePlan.worldBibleScale),
            ...worldBibleScaleInstructions(input.scaleTier),
            ...buildScaleTextureBalanceLines(input.scaleTier),
            ...buildWorldBibleMotionLines(),
            "Define the world objectively without assuming a protagonist or arrival setup.",
            "Cover the required burdens, scars, shared realities, and competing explanations, but add more only when each addition introduces genuinely new texture, contradiction, or scale clarity.",
            "Do not enumerate all geography, continents, or subregions just to prove scale.",
            "Preserve the prompt's dominant texture and causal logic instead of defaulting to tolls, permits, shortages, inspections, or repair burdens.",
            "Let widespreadBurdens, presentScars, and sharedRealities use the prompt's own worldview: material, mythic, ritual, surreal, courtly, domestic, magical-everyday, or mixed as appropriate.",
            "Use explanationThreads for competing explanations, beliefs, doctrines, rumors, theories, or myths only where the setting genuinely benefits from them.",
            "If the best explanationThreads candidate feels generic or templated, omit explanationThreads rather than forcing one.",
            "Everyday life must explain how ordinary people secure survival, belonging, access, or continuity in prompt-native terms.",
            "Name everydayLife institutions as specific local bodies, courts, households, rites, workshops, orders, companies, customs, or offices rather than generic labels.",
            "Gossip should sound like something residents might actually repeat about a person, place, practice, object, institution, or embarrassment.",
            "groundLevelReality should describe objective sensory, physical, social, or ritual truth rather than framing an arrival.",
            "Keep list fields terse, but allow groundLevelReality, survival, and actionableSecret enough room to feel evocative within the stated output budget.",
            "setting may be brief geographic, material, ceremonial, or civilizational shorthand if it helps orient downstream stages.",
            "tone is optional UI-facing shorthand and should never be a generic genre label.",
            "If the prompt does not name the world explicitly, derive an understated title from prompt language rather than inventing melodramatic branding.",
          ],
        }),
        buildUser: (correctionNotes) =>
          [
            buildWorldGenerationBasePrompt({
              prompt: input.prompt,
              promptIntentProfile,
              scaleTier: input.scaleTier,
              scalePlan,
              previousDraft: input.previousDraft,
              correctionNotes,
            }),
            formatPromptBlock(
              "output_budget",
              buildScaleAwareWorldBibleBudget(input.scaleTier, WORLD_BIBLE_MIN_EXPLANATION_THREADS),
            ),
            formatFinalInstruction([
              "Return the objective world-bible payload only.",
              `Meet the schema minimums for widespreadBurdens, presentScars, sharedRealities, institutions, fears, wants, trade, and gossip.`,
              "ExplanationThreads may be empty when the setting does not center on unresolved contested phenomena.",
              "Add more items only when they introduce genuinely new texture, pressure, contradiction, or local specificity.",
              "Make widespreadBurdens, presentScars, and sharedRealities feel already underway through ongoing upkeep, adaptation, repetition, timing, or accommodation rather than inert background description.",
              "Keep list fields concise and specific, but let groundLevelReality, survival, gossip, widespreadBurdens, presentScars, and actionableSecret use brief evocative prose within the output budget.",
              "Do not generate locations, NPCs, commodities, or entry points yet.",
            ]),
          ].join("\n\n"),
        schema: generatedWorldBibleSchema,
        tool: worldBibleTool,
        attempts,
        validationReports,
        stageSummaries,
        prompt: input.prompt,
        promptIntentProfile,
        shouldStop: input.shouldStop,
        validate: async (parsed) => [
          {
            category: "immersion",
            issues: validateWorldBible(parsed, {
              minimumExplanationThreads: WORLD_BIBLE_MIN_EXPLANATION_THREADS,
              scaleTier: input.scaleTier,
            }).issues,
          },
          await critiqueWorldBibleWithModel({
            prompt: input.prompt,
            promptIntentProfile,
            scaleTier: input.scaleTier,
            worldBible: parsed,
          }),
        ],
        summarize: (parsed) =>
          `${parsed.title}: ${parsed.widespreadBurdens.length} widespread burdens, ${parsed.explanationThreads.length} explanation threads.`,
        });
        markStageCompleted("world_bible", worldBible);
        notifyProgress({
          stage: "world_bible",
          status: "complete",
          message: stageSummaries.world_bible,
        });
      }

      const worldSpineScaleProfile = scalePlan.worldSpineScale;
      const regionalLifeScaleProfile = scalePlan.regionalLifeScale;
      const socialCastScaleProfile = scalePlan.socialCastScale;
      const knowledgeScaleProfile = scalePlan.knowledgeScale;
      const worldSpineWorldContext = summarizeWorldBibleForPrompt(worldBible, "world_spine");
      const regionalLifeWorldContext = summarizeWorldBibleForPrompt(worldBible, "regional_life");
      const socialCastWorldContext = summarizeWorldBibleForPrompt(worldBible, "social_cast");
      const knowledgeWebWorldContext = summarizeWorldBibleForPrompt(worldBible, "knowledge_web");
      const knowledgeThreadsWorldContext = summarizeWorldBibleForPrompt(worldBible, "knowledge_threads");
      const economyWorldContext = summarizeWorldBibleForPrompt(worldBible, "economy_material_life");

      let worldSpine = checkpoint.stageArtifacts.world_spine;
      if (worldSpine) {
        markResumedStageComplete(
          "world_spine",
          stageSummaries.world_spine
            ?? `${worldSpine.locations.length} locations, ${worldSpine.factions.length} factions, ${worldSpine.edges.length} routes.`,
        );
      } else {
        notifyProgress({
          stage: "world_spine",
          status: "running",
          message: getWorldGenerationStageRunningMessage("world_spine"),
        });
      const worldSpineFactions = await runStructuredStage({
        stage: "world_spine",
        system: buildWorldGenSystemPrompt({
          stage: "world_spine",
          scaleTier: input.scaleTier,
          userPrompt: input.prompt,
          promptIntentProfile,
          successLines: [
            ...buildScaleProfilePromptLines(worldSpineScaleProfile),
            "Generate factions only.",
            "Every faction must have a visible agenda, a public footprint, and pressure that affects ordinary people.",
            "Agendas and public footprints should imply what the faction is currently pushing, maintaining, protecting, contesting, or exploiting, but this should read as active posture rather than a scripted plot beat.",
            "Every faction should depend on patronage, ritual duty, prestige, household ties, magical upkeep, ecology, secrecy, obligation, memory, route control, labor, trade, law, territory, or another prompt-native dependency it cannot fully secure alone.",
            "Assume internal disagreement, brittle coalition management, or competing methods inside each faction rather than perfect unity.",
            "Do not force institutional bottleneck conflict as the universal default.",
            "Use concise lowercase underscore keys because the engine will assign canonical ids later.",
            "Every generated key must be 40 characters or fewer.",
            "Use as many factions as the setting genuinely needs within the allowed schema bounds rather than forcing minimal coverage.",
            "Reuse and sharpen the prompt's specific nouns instead of replacing them with generic organizations.",
          ],
        }),
        buildUser: (correctionNotes) =>
          [
            buildWorldGenerationBasePrompt({
              prompt: input.prompt,
              promptIntentProfile,
              scaleTier: input.scaleTier,
              scalePlan,
              previousDraft: input.previousDraft,
              correctionNotes,
            }),
            formatPromptBlock("world_context", worldSpineWorldContext),
            formatPromptBlock("stage_scale_profile", describeScaleProfile(worldSpineScaleProfile, "world_spine")),
            formatFinalInstruction("Generate only factions for this world spine."),
          ].join("\n\n"),
        schema: worldSpineFactionsSchema,
        tool: worldSpineFactionsTool,
        attempts,
        validationReports,
        stageSummaries,
        prompt: input.prompt,
        promptIntentProfile,
        shouldStop: input.shouldStop,
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
        system: buildWorldGenSystemPrompt({
          stage: "world_spine",
          scaleTier: input.scaleTier,
          userPrompt: input.prompt,
          promptIntentProfile,
          successLines: [
            ...buildScaleProfilePromptLines(worldSpineScaleProfile),
            "Choose how many total locations the world spine should have.",
            `Return only a locationCount value of ${WORLD_SPINE_LOCATION_CHOICES_TEXT}.`,
            "Choose the count that gives the setting enough room for distinct anchors, connectors, thresholds, power centers, hazard belts, ritual geographies, and traversal texture.",
            "Prefer 12, 15, or 18 when the prompt supports multiple districts, frontiers, ceremonial systems, magical infrastructures, courtly centers, sacred belts, or competing power centers rather than collapsing them together.",
          ],
        }),
        buildUser: (correctionNotes) =>
          [
            buildWorldGenerationBasePrompt({
              prompt: input.prompt,
              promptIntentProfile,
              scaleTier: input.scaleTier,
              scalePlan,
              previousDraft: input.previousDraft,
              correctionNotes,
            }),
            formatPromptBlock("world_context", worldSpineWorldContext),
            formatPromptBlock("stage_scale_profile", describeScaleProfile(worldSpineScaleProfile, "world_spine")),
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
            formatFinalInstruction(`Return only locationCount: ${WORLD_SPINE_LOCATION_CHOICES_TEXT}.`),
          ].join("\n\n"),
        schema: worldSpineLocationPlanSchema,
        tool: worldSpineLocationPlanTool,
        attempts,
        validationReports,
        stageSummaries,
        prompt: input.prompt,
        promptIntentProfile,
        normalizeInput: normalizeWorldSpineLocationPlanInput,
        shouldStop: input.shouldStop,
        summarize: (parsed) => `${parsed.locationCount} planned world spine locations.`,
      });

      const worldSpineLocationTarget = worldSpineLocationPlan.locationCount;
      const worldSpineLocationBatchCount = Math.ceil(
        worldSpineLocationTarget / WORLD_SPINE_LOCATION_BATCH_SIZE,
      );
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

        const worldSpineLocationBatch = await runStructuredStage({
          stage: "world_spine",
          system: buildWorldGenSystemPrompt({
            stage: "world_spine",
            scaleTier: input.scaleTier,
            userPrompt: input.prompt,
            promptIntentProfile,
          successLines: [
            ...buildWorldSpineLocationSuccessLines({
              scaleTier: input.scaleTier,
              worldSpineScaleProfile,
              worldSpineLocationTarget,
            }),
          ],
        }),
          buildUser: (correctionNotes) =>
            [
              buildWorldGenerationBasePrompt({
                prompt: input.prompt,
                promptIntentProfile,
                scaleTier: input.scaleTier,
                scalePlan,
                previousDraft: input.previousDraft,
                correctionNotes,
              }),
              formatPromptBlock("world_context", worldSpineWorldContext),
              formatPromptBlock("stage_scale_profile", describeScaleProfile(worldSpineScaleProfile, "world_spine")),
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
                alreadyGeneratedLocationCount: priorLocations.length,
                alreadyGeneratedEverydayUseCount: priorEverydayCount,
                remainingLocationsAfterThisBatch: remainingAfterThisBatch,
              }),
              formatFinalInstruction(
                buildWorldSpineBatchFinalInstructionLines({
                  scaleTier: input.scaleTier,
                  batchIndex,
                  batchCount: worldSpineLocationBatchCount,
                }),
              ),
            ]
              .filter(Boolean)
              .join("\n\n"),
          schema: worldSpineLocationBatchSchema,
          tool: worldSpineLocationBatchTool,
          attempts,
          validationReports,
          stageSummaries,
          prompt: input.prompt,
          promptIntentProfile,
          shouldStop: input.shouldStop,
          validate: async (parsed) => {
            const issues = findDuplicateStrings(parsed.locations.map((location) => location.key)).map(
              (key) => `Location key ${key} is duplicated within this batch.`,
            );
            const factionKeys = new Set(worldSpineFactions.factions.map((faction) => faction.key));
            const priorLocationKeys = new Set(priorLocations.map((location) => location.key));

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

            const scaleValidation = await critiqueWorldSpineScaleWithModel({
              prompt: input.prompt,
              promptIntentProfile,
              scaleTier: input.scaleTier,
              locations: parsed.locations,
            });
            return [
              { category: "coherence", issues },
              scaleValidation,
            ];
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

      const worldSpineEdges = await runStructuredStage({
        stage: "world_spine",
        system: buildWorldGenSystemPrompt({
          stage: "world_spine",
          scaleTier: input.scaleTier,
          userPrompt: input.prompt,
          promptIntentProfile,
          successLines: [
            ...buildScaleProfilePromptLines(worldSpineScaleProfile),
            "Generate only travel edges.",
            "The location graph must stay connected and feel well-interlinked rather than like a single-file route.",
            "Prefer loops, alternate routes, and a few connective hubs over long linear chains.",
            "Indirect reachability is enough: locations can connect through intermediate routes, and hidden or remote places do not need direct links to every major hub.",
            "Every edge must include a concrete travel texture, threshold, ritual timing, terrain condition, weather issue, convoy rule, customs practice, hazard, or territorial pressure appropriate to the setting.",
            "Use only the provided location keys.",
            "Use concise lowercase underscore keys and keep the network legible enough for a playable open world.",
            "Always use very short edge keys such as route_1, route_2, route_3; do not build keys from full location names.",
            "Every generated key must be 40 characters or fewer. Abbreviate if necessary.",
            "Keep edge descriptions to one tight sentence each.",
          ],
        }),
        buildUser: (correctionNotes) =>
          [
            buildWorldGenerationBasePrompt({
              prompt: input.prompt,
              promptIntentProfile,
              scaleTier: input.scaleTier,
              scalePlan,
              previousDraft: input.previousDraft,
              correctionNotes,
            }),
            formatPromptBlock("world_context", worldSpineWorldContext),
            formatPromptBlock("stage_scale_profile", describeScaleProfile(worldSpineScaleProfile, "world_spine")),
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
        prompt: input.prompt,
        promptIntentProfile,
        shouldStop: input.shouldStop,
        validate: async (parsed) => {
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

      const maxWorldSpineRelations = WORLD_SPINE_MAX_RELATIONS;
      const targetWorldSpineRelations = Math.min(
        24,
        Math.max(10, worldSpineFactions.factions.length * 2),
      );

      const worldSpineRelations = await runStructuredStage({
        stage: "world_spine",
        system: buildWorldGenSystemPrompt({
          stage: "world_spine",
          scaleTier: input.scaleTier,
          userPrompt: input.prompt,
          promptIntentProfile,
          successLines: [
            ...buildScaleProfilePromptLines(worldSpineScaleProfile),
            "Generate only faction relations.",
            "Relations must reflect trade dependence, territorial disputes, labor leverage, doctrine clashes, patronage, ritual duty, prestige rivalry, household ties, magical upkeep, ecology, secrecy, obligation, memory, route control, or other prompt-native tensions.",
            "Relation summaries should describe current leverage, active tension, or practical dependence, not just a static stance label.",
            "Do not prefer institutional bottleneck conflict as the universal default.",
            `Return only the important faction relations needed to understand the political map; avoid padding and do not produce a full pair-by-pair matrix.`,
            "Use only the provided faction keys.",
            "Use concise lowercase underscore keys and keep the political map readable.",
            "Every generated key must be 40 characters or fewer.",
            "Keep each relation summary to one tight sentence.",
          ],
        }),
        buildUser: (correctionNotes) =>
          [
            buildWorldGenerationBasePrompt({
              prompt: input.prompt,
              promptIntentProfile,
              scaleTier: input.scaleTier,
              scalePlan,
              previousDraft: input.previousDraft,
              correctionNotes,
            }),
            formatPromptBlock("world_context", worldSpineWorldContext),
            formatPromptBlock("stage_scale_profile", describeScaleProfile(worldSpineScaleProfile, "world_spine")),
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
              `Generate only the most important faction relations using the provided faction keys. Aim for roughly ${targetWorldSpineRelations} if the setting supports it, but prioritize distinct and consequential relations over hitting a number exactly, and do not generate a full pair-by-pair matrix.`,
            ),
          ].join("\n\n"),
        schema: worldSpineRelationsOnlySchema,
        tool: worldSpineRelationsTool,
        attempts,
        validationReports,
        stageSummaries,
        prompt: input.prompt,
        promptIntentProfile,
        normalizeInput: (input) => normalizeWorldSpineRelationsInput(input, maxWorldSpineRelations),
        shouldStop: input.shouldStop,
        validate: async (parsed) => {
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

        const worldSpineDraft = {
          locations: worldSpineLocations.locations,
          edges: worldSpineEdges.edges,
          factions: worldSpineFactions.factions,
          factionRelations: worldSpineRelations.factionRelations,
        };

        const worldSpineParsed = generatedWorldSpineSchema.safeParse(worldSpineDraft);
        if (!worldSpineParsed.success) {
          throw new Error(`world_spine returned invalid structured data: ${worldSpineParsed.error.message}`);
        }

        const worldSpineValidation = validateWorldSpine(worldSpineParsed.data, {
          scaleTier: input.scaleTier,
        });
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
        const worldSpineScaleValidation = await critiqueWorldSpineScaleWithModel({
          prompt: input.prompt,
          promptIntentProfile,
          scaleTier: input.scaleTier,
          locations: worldSpineParsed.data.locations,
        });
        validationReports.push({
          stage: "world_spine",
          attempt: attempts.filter((attempt) => attempt.stage === "world_spine").length,
          ok: worldSpineScaleValidation.issues.length === 0,
          category: worldSpineScaleValidation.category,
          issues: worldSpineScaleValidation.issues,
        });
        if (worldSpineScaleValidation.issues.length > 0) {
          throw new Error(`world_spine scale-aware validation failed: ${worldSpineScaleValidation.issues.join("; ")}`);
        }
        worldSpine = worldSpineParsed.data;
        stageSummaries.world_spine =
          `${worldSpine.locations.length} locations, ${worldSpine.factions.length} factions, ${worldSpine.edges.length} routes.`;
        markStageCompleted("world_spine", worldSpine);
        notifyProgress({
          stage: "world_spine",
          status: "complete",
          message: stageSummaries.world_spine,
        });
      }

      idMaps.factions = assignCanonicalIds(worldSpine.factions.map((faction) => faction.key), "fac");
      idMaps.locations = assignCanonicalIds(worldSpine.locations.map((location) => location.key), "loc");
      idMaps.edges = assignCanonicalIds(worldSpine.edges.map((edge) => edge.key), "edge");
      idMaps.factionRelations = assignCanonicalIds(
        worldSpine.factionRelations.map((relation) => relation.key),
        "rel",
      );

      const lockedLocations = worldSpine.locations.map((location) => ({
        key: location.key,
        id: idMaps.locations[location.key],
        name: location.name,
        type: location.type,
        summary: location.summary,
        localIdentity: location.localIdentity,
        controlStatus: location.controlStatus,
      }));
      const lockedFactions = worldSpine.factions.map((faction) => ({
        key: faction.key,
        id: idMaps.factions[faction.key],
        name: faction.name,
        type: faction.type,
        agenda: faction.agenda,
        publicFootprint: faction.publicFootprint,
      }));

      let regionalLife = checkpoint.stageArtifacts.regional_life;
      if (regionalLife) {
        markResumedStageComplete(
          "regional_life",
          stageSummaries.regional_life
            ?? `${regionalLife.locations.length} regional life profiles.`,
        );
      } else {
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
          system: buildWorldGenSystemPrompt({
            stage: "regional_life",
            scaleTier: input.scaleTier,
            userPrompt: input.prompt,
            promptIntentProfile,
            successLines: [
              ...buildScaleProfilePromptLines(regionalLifeScaleProfile),
              "Generate the lived-in regional layer for each locked location in this batch.",
              "Each location needs public activity, local pressure, everyday texture, hazards, ordinary knowledge, and reasons a resident stays or leaves.",
              "People may revere, celebrate, inherit, enact, enjoy, misunderstand, endure, fear, exploit, or build around the world's structures depending on prompt intent.",
              "Across the batch, vary the main organizing logic of daily life; do not make every location primarily a checkpoint, extraction site, ration system, inspection loop, containment zone, or institutional failure point.",
              "Use localPressure as one dimension, not the whole identity. everydayTexture, reasonsToLinger, ordinaryKnowledge, gossip, and routineSeeds should reveal at least one meaningful social rhythm, exchange pattern, craft practice, hospitality pattern, devotional habit, prestige economy, leisure use, or local custom beyond the immediate burden.",
              "When a location is dangerous or heavily governed, counterbalance with what people still trade, enjoy, maintain, admire, celebrate, teach, repair, or take pride in there.",
              ...buildRegionalLifeTextureBalanceLines(input.scaleTier),
              input.scaleTier === "world"
                ? "At world scale, each locked location is a macro-region or civilization. Describe region-level public life, not taverns, rooms, or street-corner interiors."
                : "Match the locked location's scale and do not shrink it into room-level detail.",
              "dominantActivities, publicHazards, ordinaryKnowledge, institutions, gossip, reasonsToLinger, routineSeeds, and eventSeeds must all be arrays of short strings.",
              "eventSeeds are optional; only include them when a location genuinely wants a discrete event-shaped prompt rather than a calmer ongoing rhythm.",
              `Return exactly ${locationBatch.length} records, one per location id in the batch.`,
            ],
          }),
          buildUser: (correctionNotes) =>
            [
              buildWorldGenerationBasePrompt({
                prompt: input.prompt,
                promptIntentProfile,
                scaleTier: input.scaleTier,
                scalePlan,
                previousDraft: input.previousDraft,
                correctionNotes,
              }),
              formatPromptBlock("world_context", regionalLifeWorldContext),
              formatPromptBlock("stage_scale_profile", describeScaleProfile(regionalLifeScaleProfile, "regional_life")),
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
          prompt: input.prompt,
          promptIntentProfile,
          normalizeInput: (input) => normalizeRegionalLifeInput(input, locationBatch.length),
          shouldStop: input.shouldStop,
          validate: async (parsed) => [
            {
              category: "immersion",
              issues: validateRegionalLife(parsed, locationBatch.map((location) => location.id)).issues,
            },
            await critiqueRegionalLifeWithModel({
              prompt: input.prompt,
              promptIntentProfile,
              scaleTier: input.scaleTier,
              locations: parsed.locations,
            }),
          ],
          summarize: (parsed) =>
            `Batch ${batchIndex + 1}/${regionalLifeBatches.length}: ${parsed.locations.length} regional life profiles.`,
        });

          regionalLifeBatchResults.push(regionalLifeBatch.locations);
        }

        regionalLife = {
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
        markStageCompleted("regional_life", regionalLife);
        notifyProgress({
          stage: "regional_life",
          status: "complete",
          message: stageSummaries.regional_life,
        });
      }

      let socialLayer = checkpoint.stageArtifacts.social_cast;
      if (socialLayer) {
        markResumedStageComplete(
          "social_cast",
          stageSummaries.social_cast ?? `${socialLayer.npcs.length} NPCs.`,
        );
      } else {
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
        const reservedFullNamesBlock = formatReservedNamesBlock(
          "reserved_npc_full_names",
          "These full names are already taken in earlier batches and may not be reused",
          priorNpcNames,
        );
        const reservedFirstNamesBlock = formatReservedNamesBlock(
          "reserved_npc_first_names",
          "These first names are already taken in earlier batches and may not be reused",
          priorFirstNames,
        );

        const socialBatch = await runStructuredStage({
          stage: "social_cast",
          system: buildWorldGenSystemPrompt({
            stage: "social_cast",
            scaleTier: input.scaleTier,
            userPrompt: input.prompt,
            promptIntentProfile,
            successLines: [
              ...buildScaleProfilePromptLines(socialCastScaleProfile),
              "Generate systemic NPCs for this world map batch.",
              "Every NPC must be socially embedded, already part of something underway, and carrying at least one private stake inside a public-facing role.",
              "Every NPC must have a mundane routine, a current concern tied to a local obligation, opportunity, hazard, relationship, faction pressure, or dependency, and a public-facing role in an ongoing system.",
              "currentConcern should usually arise from obligation, reputational risk, resentment, favoritism, quiet loyalty, embarrassment, backlog pressure, seasonal timing, public expectation, limited ambition, interpersonal conflict inside an existing system, or another human pressure inside the NPC's role.",
              "Favor socially embedded locals over colorful eccentrics.",
              ...buildSocialCastTextureBalanceLines(input.scaleTier),
              "Let some NPCs be anchors of competence, hospitality, ritual continuity, trusted local practice, or public dignity instead of making every public-facing role a pressure valve for failure.",
              "NPCs must not read like pure role shells.",
              "Every NPC's first name must be unique across the whole world.",
              "publicContactSurface should name the ordinary interface where the public encounters this NPC, such as a household audience, salon, shrine queue, workshop threshold, rehearsal room, convoy marshalling point, message circuit, court audience, communal service point, ferry landing, hiring board, or service counter.",
              "Use only the exact provided ids in factionId, currentLocationId, ties.locationIds, bridgeLocationIds, and bridgeFactionIds; never use faction keys, location keys, or names in those fields.",
              "Every factionId and bridgeFactionId must match a provided fac_* id exactly.",
              input.scaleTier === "world"
                ? "Locations represent entire regions or civilizations. Assign NPCs to those macro locations only. Do not invent taverns, rooms, alleys, shops, or unmapped addresses."
                : "Keep NPC placement aligned to the provided locations and do not invent unmapped local addresses.",
              "Keep summary, description, currentConcern, and publicContactSurface to one tight sentence each.",
              "Keep ties compact: 1 to 2 locationIds, 0 to 2 factionIds, 1 to 2 economyHooks, 1 to 2 informationHooks, and only 0 to 2 bridge ids when truly useful.",
              "Do not reuse any exact NPC name shown from earlier batches.",
              "If correction notes mention duplicate names, keep the same NPC concepts and only rename the duplicated NPCs.",
              "If correction notes mention invalid ids or wrong anchors, keep the same NPC concepts where possible and fix only the referenced ids, anchors, and names.",
              "Do not require secrets, schemes, or overt quest hooks; a quiet private stake is enough.",
              "Do not create ornamental quest-givers or pleas for a hero.",
              `Return exactly ${locationBatch.length} NPCs, one anchored in each location in the batch.`,
            ],
          }),
          buildUser: (correctionNotes) =>
            [
              buildWorldGenerationBasePrompt({
                prompt: input.prompt,
                promptIntentProfile,
                scaleTier: input.scaleTier,
                scalePlan,
                previousDraft: input.previousDraft,
                correctionNotes,
              }),
              formatPromptBlock("world_context", socialCastWorldContext),
              formatPromptBlock("stage_scale_profile", describeScaleProfile(socialCastScaleProfile, "social_cast")),
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
              ...(reservedFullNamesBlock ? [reservedFullNamesBlock] : []),
              ...(reservedFirstNamesBlock ? [reservedFirstNamesBlock] : []),
              formatFinalInstruction([
                "Use only the provided location ids and faction ids.",
                "For structured fields, use ids like loc_* and fac_* exactly as shown above, never the key= values.",
                "Treat any reserved_npc_full_names and reserved_npc_first_names blocks as hard ban lists.",
                `Return exactly ${locationBatch.length} NPCs for this batch, with one currentLocationId per batch location.`,
              ]),
            ].join("\n\n"),
          schema: socialBatchSchema,
          tool: socialBatchTool,
          attempts,
          validationReports,
          stageSummaries,
          prompt: input.prompt,
          promptIntentProfile,
          normalizeInput: (input) => normalizeSocialCastInput(input, locationBatch.length),
          shouldStop: input.shouldStop,
          validate: async (parsed) => {
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

            return [
              { category: "immersion", issues },
              await critiqueSocialCastScaleWithModel({
                prompt: input.prompt,
                promptIntentProfile,
                scaleTier: input.scaleTier,
                npcs: parsed.npcs,
              }),
            ];
          },
          summarize: (parsed) =>
            `Batch ${batchIndex + 1}/${socialCastBatches.length}: ${parsed.npcs.length} anchored NPCs.`,
        });

          socialCastBatchResults.push(socialBatch.npcs);
        }

        const socialCastInput: z.infer<typeof generatedSocialLayerInputSchema> = {
          npcs: socialCastBatchResults.flat(),
        };

        const socialNpcIds = assignIndexedIds(
          socialCastInput.npcs,
          "npc",
          (npc, index) => `${npc.name}_${npc.role}_${index + 1}`,
        );

        idMaps.npcs = Object.fromEntries(
          socialCastInput.npcs.map((npc, index) => [`npc_${index + 1}`, socialNpcIds[index]]),
        );

        socialLayer = {
          npcs: socialCastInput.npcs.map((npc, index) => ({
            id: socialNpcIds[index],
            name: npc.name,
            role: npc.role,
            tags: npc.tags,
            summary: npc.summary,
            description: npc.description,
            factionId: npc.factionId,
            currentLocationId: npc.currentLocationId,
            approval: npc.approval,
            isCompanion: npc.isCompanion,
            currentConcern: npc.currentConcern,
            publicContactSurface: npc.publicContactSurface,
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
          { scaleTier: input.scaleTier },
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
        stageSummaries.social_cast =
          `${socialCastInput.npcs.length} NPCs across ${socialCastBatches.length} batches.`;
        markStageCompleted("social_cast", socialLayer);
        notifyProgress({
          stage: "social_cast",
          status: "complete",
          message: stageSummaries.social_cast,
        });
      }

      const lockedNpcs = socialLayer.npcs.map((npc) => ({
        id: npc.id,
        name: npc.name,
        role: npc.role,
        currentLocationId: npc.currentLocationId,
        factionId: npc.factionId,
        currentConcern: npc.currentConcern,
        publicContactSurface: npc.publicContactSurface,
      }));
      const targetInformationNodeCount = Math.min(
        lockedLocations.length + 4,
        WORLD_GEN_MAX_INFORMATION_NODES,
      );
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

      let knowledgeWebInput: GeneratedKnowledgeWebStage = checkpoint.stageArtifacts.knowledge_web
        ?? { information: [], informationLinks: [] };
      if (checkpoint.stageArtifacts.knowledge_web) {
        markResumedStageComplete(
          "knowledge_web",
          stageSummaries.knowledge_web
            ?? `${knowledgeWebInput.information.length} information nodes with ${knowledgeWebInput.informationLinks.length} links.`,
        );
      } else {
        notifyProgress({
          stage: "knowledge_web",
          status: "running",
          message: getWorldGenerationStageRunningMessage("knowledge_web"),
        });
        knowledgeWebInput = await runStructuredStage({
        stage: "knowledge_web",
        system: buildWorldGenSystemPrompt({
          stage: "knowledge_web",
          scaleTier: input.scaleTier,
          userPrompt: input.prompt,
          promptIntentProfile,
          successLines: [
            ...buildScaleProfilePromptLines(knowledgeScaleProfile),
            "Generate the actionable information ecology for the locked world.",
            "Treat information nodes as entry points into things already happening, not just facts about places.",
            "Tie every information node to a present-day witness, route, record, object, custom, service, practice, opportunity, dependency, etiquette, symbol, performance, omen, dispute, repeated gathering, labor rhythm, workaround, ritual threshold, timing window, or social chokepoint rather than remote lore for its own sake.",
            ...buildKnowledgeTextureBalanceLines(input.scaleTier),
            "Not every information node needs a shortage, threat, deadline, scandal, or institutional failure; many should simply reveal how a place works, what people trust, what they admire, how they gather, what practical routine outsiders can learn from, or what ritual or protocol matters.",
            "Keep each node focused.",
            "Meaningful knowledge presence may be actionable, observational, participatory, ceremonial, symbolic, domestic, or procedural depending on the setting.",
            "Guarded information should imply what relationship, status, repeated presence, service, craft familiarity, leverage, etiquette, or timing is required; do not default every access path to a transaction.",
            "Secrets should resolve to concrete places, ledgers, caches, devices, routes, hidden actors, rites, or symbolic keys rather than pure metaphysics.",
            "actionLead and discoverHow should move play to the next clue, contact, routine, vantage point, participation point, leverage point, ritual threshold, timing window, or protocol step, not deliver a complete final answer.",
            "discoverHow should emphasize how someone enters, watches, joins, times, or understands an existing process rather than reading like a full procedural instruction sheet.",
            "Keep every field concise: title, summary, content, actionLead, and discoverHow should all be short phrases or one tight sentence at most.",
            "Every location needs meaningful knowledge presence. It should be actionable where appropriate, but may also be observational, ceremonial, symbolic, domestic, or socially informative when that better fits the setting.",
            `Keep the network legible: cover every location, build a genuinely connected web, and stay within schema limits of ${WORLD_GEN_MAX_INFORMATION_NODES} information nodes and ${WORLD_GEN_MAX_INFORMATION_LINKS} information links.`,
            "Prefer one information node per location unless an extra node adds real investigative or social texture.",
            "If any factions are listed as currently unanchored, use information nodes to give them a visible public role, dispute, ritual presence, market function, admired service, household influence, protocol role, or territorial pressure in the world.",
          ],
        }),
        buildUser: (correctionNotes) =>
          [
            buildWorldGenerationBasePrompt({
              prompt: input.prompt,
              promptIntentProfile,
              scaleTier: input.scaleTier,
              scalePlan,
              previousDraft: input.previousDraft,
              correctionNotes,
            }),
            formatPromptBlock("world_context", knowledgeWebWorldContext),
            formatPromptBlock("stage_scale_profile", describeScaleProfile(knowledgeScaleProfile, "knowledge_web")),
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
                    "Return the cleanest payload that fixes the cited issues without flattening the world's distinctive details.",
                    "Aim for roughly one information node per location unless a cited correction or strong texture reason requires more.",
                    "Keep title, summary, content, actionLead, and discoverHow extremely short.",
                    "Make the world feel already underway rather than adding dramatic new situations.",
                    `Keep information links sparse and no higher than ${Math.min(lockedLocations.length + 4, 20)} total.`,
                  ]),
                ]
              : []),
            formatFinalInstruction([
              "Use only the provided ids for locations, factions, and NPCs.",
              "Use unique keys for information nodes and information links.",
              `Ensure every location is represented by at least one meaningful information node, either tied directly to that location or spoken/embodied by an NPC anchored there. Keep the total compact and no higher than ${targetInformationNodeCount} information nodes or ${WORLD_GEN_MAX_INFORMATION_LINKS} information links.`,
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
        prompt: input.prompt,
        promptIntentProfile,
        shouldStop: input.shouldStop,
        validate: async (parsed) => {
          const issues = validateKnowledgeWebStage({
            information: parsed.information,
            lockedLocations: lockedLocations.map((location) => ({
              id: location.id,
              name: location.name,
            })),
            lockedFactions: lockedFactions.map((faction) => ({ id: faction.id })),
            lockedNpcs: lockedNpcs.map((npc) => ({
              id: npc.id,
              currentLocationId: npc.currentLocationId,
            })),
          });

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
              locationKind: "spine",
              parentLocationId: null,
              discoveryState: "revealed",
              justificationForNode: null,
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
              visibility: "public",
              accessRequirementText: null,
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
            npcs: socialLayer.npcs.map((npc) => ({
              id: npc.id,
              name: npc.name,
              role: npc.role,
              tags: npc.tags,
              summary: npc.summary,
              description: `${npc.description} Current concern: ${npc.currentConcern}. Public contact surface: ${npc.publicContactSurface}.`,
              factionId: npc.factionId,
              currentLocationId: npc.currentLocationId,
              approval: npc.approval,
              isCompanion: npc.isCompanion,
            })),
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
            await critiqueKnowledgeWebWithModel({
              prompt: input.prompt,
              promptIntentProfile,
              scaleTier: input.scaleTier,
              information: parsed.information,
            }),
          ];
        },
        summarize: (parsed) =>
          `${parsed.information.length} information nodes with ${parsed.informationLinks.length} links.`,
        });
        markStageCompleted("knowledge_web", knowledgeWebInput);
        notifyProgress({
          stage: "knowledge_web",
          status: "complete",
          message: stageSummaries.knowledge_web,
        });
      }

      let knowledgeThreadsInput: GeneratedKnowledgeThreadsStage = checkpoint.stageArtifacts.knowledge_threads
        ?? { knowledgeNetworks: [], pressureSeeds: [] };
      if (checkpoint.stageArtifacts.knowledge_threads) {
        markResumedStageComplete(
          "knowledge_threads",
          stageSummaries.knowledge_threads
            ?? `${knowledgeThreadsInput.knowledgeNetworks.length} worldview clusters and ${knowledgeThreadsInput.pressureSeeds.length} pressure seeds.`,
        );
      } else {
        notifyProgress({
          stage: "knowledge_threads",
          status: "running",
          message: getWorldGenerationStageRunningMessage("knowledge_threads"),
        });
        knowledgeThreadsInput = await runStructuredStage({
        stage: "knowledge_threads",
        system: buildWorldGenSystemPrompt({
          stage: "knowledge_threads",
          scaleTier: input.scaleTier,
          userPrompt: input.prompt,
          promptIntentProfile,
          successLines: [
            ...buildScaleProfilePromptLines(knowledgeScaleProfile),
            "Generate a compact worldview layer, with optional pressure seeds, using the existing information web.",
            "Do not reduce every cluster to institutional breakdown; some may organize around custom, prestige, admired craft, ritual timing, shared memory, contested public identity, etiquette, cosmology, household practice, or surreal patterning.",
            "Use knowledgeNetworks for compact clusters of public beliefs, competing explanations, rumors, doctrines, theories, or myths that connect back to the existing information web instead of inventing new lore objects.",
            "For linkedInformationKeys, copy only exact information_web keys; never use human-readable titles or world-bible explanation labels.",
            "Pressure seeds may be omitted when the worldview layer is already strong; when present, they should name a locked location or faction and describe a near-term pressure that can move play.",
            "Keep hiddenTruths partial enough to preserve uncertainty; they should sharpen direction and stakes without mathematically closing the world's deepest mysteries.",
            "Keep hiddenTruth and pressure text to one tight sentence each.",
            "Keep it compact. Return only the major worldview clusters and the most actionable near-term pressures; do not pad.",
          ],
        }),
        buildUser: (correctionNotes) => {
          return [
            buildWorldGenerationBasePrompt({
              prompt: input.prompt,
              promptIntentProfile,
              scaleTier: input.scaleTier,
              scalePlan,
              previousDraft: input.previousDraft,
              correctionNotes,
            }),
            formatPromptBlock("world_context", knowledgeThreadsWorldContext),
            formatPromptBlock("stage_scale_profile", describeScaleProfile(knowledgeScaleProfile, "knowledge_threads")),
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
              "Return only as many knowledgeNetworks and pressureSeeds as the world genuinely needs while staying compact and within schema bounds. It is valid to return zero pressureSeeds if the worldview layer is stronger without them.",
            ]),
          ].join("\n\n");
        },
        schema: generatedKnowledgeThreadsInputSchema,
        tool: knowledgeThreadsTool,
        attempts,
        validationReports,
        stageSummaries,
        prompt: input.prompt,
        promptIntentProfile,
        shouldStop: input.shouldStop,
        validate: async (parsed) => {
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

          return [
            { category: "playability", issues },
            await critiqueKnowledgeThreadsWithModel({
              prompt: input.prompt,
              promptIntentProfile,
              scaleTier: input.scaleTier,
              knowledgeNetworks: parsed.knowledgeNetworks,
              pressureSeeds: parsed.pressureSeeds,
            }),
          ];
        },
        summarize: (parsed) =>
          `${parsed.knowledgeNetworks.length} worldview clusters and ${parsed.pressureSeeds.length} pressure seeds.`,
        });
        markStageCompleted("knowledge_threads", knowledgeThreadsInput);
        notifyProgress({
          stage: "knowledge_threads",
          status: "complete",
          message: stageSummaries.knowledge_threads,
        });
      }

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
          locationKind: "spine",
          parentLocationId: null,
          discoveryState: "revealed",
          justificationForNode: null,
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
          visibility: "public",
          accessRequirementText: null,
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
        npcs: socialLayer.npcs.map((npc) => ({
          id: npc.id,
          name: npc.name,
          role: npc.role,
          tags: npc.tags,
          summary: npc.summary,
          description: `${npc.description} Current concern: ${npc.currentConcern}. Public contact surface: ${npc.publicContactSurface}.`,
          factionId: npc.factionId,
          currentLocationId: npc.currentLocationId,
          approval: npc.approval,
          isCompanion: npc.isCompanion,
        })),
        information: knowledgeLayer.information,
        informationLinks: knowledgeLayer.informationLinks,
        commodities: [],
        marketPrices: [],
        entryPoints: [],
      };

      const targetCommodityCount = Math.min(
        WORLD_GEN_TARGET_COMMODITIES,
        Math.max(6, Math.ceil(lockedLocations.length / 2)),
      );
      const targetMarketPriceCount = Math.min(WORLD_GEN_MAX_MARKET_PRICES, lockedLocations.length);
      let economyMaterialLifeInput: GeneratedEconomyMaterialLifeStage = checkpoint.stageArtifacts.economy_material_life
        ?? { commodities: [], marketPrices: [], locationTradeIdentity: [] };
      if (checkpoint.stageArtifacts.economy_material_life) {
        markResumedStageComplete(
          "economy_material_life",
          stageSummaries.economy_material_life
            ?? `${economyMaterialLifeInput.commodities.length} commodities and ${economyMaterialLifeInput.marketPrices.length} market prices.`,
        );
      } else {
        notifyProgress({
          stage: "economy_material_life",
          status: "running",
          message: getWorldGenerationStageRunningMessage("economy_material_life"),
        });
        economyMaterialLifeInput = await runStructuredStage({
          stage: "economy_material_life",
          system: buildWorldGenSystemPrompt({
            stage: "economy_material_life",
            scaleTier: input.scaleTier,
            userPrompt: input.prompt,
            promptIntentProfile,
            successLines: [
              ...buildScaleProfilePromptLines(knowledgeScaleProfile),
              "Generate commodities, market prices, and location-level material life for the locked world.",
              `Keep the economy compact: no more than ${targetCommodityCount} commodities and no more than ${targetMarketPriceCount} market prices.`,
              `Return one locationTradeIdentity entry for every locked location (${lockedLocations.length} total).`,
              "Include staple goods and raw materials. Add controlled or illicit trade pressure only where the setting genuinely supports it.",
              ...buildEconomyTextureBalanceLines(input.scaleTier),
              "No generic treasure filler or ornamental adventuring gear; focus on bulk goods, infrastructure, consumables, and daily necessities.",
              "Every commodity should imply scarcity, transport strain, upkeep demand, seasonality, social prestige, ritual use, staple reliability, market leverage, comfort, display, abundance, or magical maintenance as prompted.",
              "Let market presence reveal who maintains critical systems, who pays hidden costs, where supply lines are brittle, which goods or crafts are locally admired, what rites or comforts define a place, and what forms of dependence or display matter.",
              input.scaleTier === "world"
                ? "At world scale, locationTradeIdentity should describe regional material life and supply conditions at macro scale, not literal street-corner commerce."
                : "At settlement or regional scale, locationTradeIdentity may describe street-level, market, dockside, roadside, household, or neighborhood-facing material life where appropriate.",
              "Every major location should have a trade identity or a deliberate reason for lacking one.",
              "Keep every field terse: one short sentence or short phrase, not a paragraph.",
            ],
          }),
          buildUser: (correctionNotes) =>
            [
              buildWorldGenerationBasePrompt({
                prompt: input.prompt,
                promptIntentProfile,
                scaleTier: input.scaleTier,
                scalePlan,
                previousDraft: input.previousDraft,
                correctionNotes,
              }),
              formatPromptBlock("world_context", economyWorldContext),
              formatPromptBlock("stage_scale_profile", describeScaleProfile(knowledgeScaleProfile, "economy_material_life")),
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
          prompt: input.prompt,
          promptIntentProfile,
          normalizeInput: (input) =>
            normalizeEconomyMaterialLifeInput(input, targetCommodityCount, targetMarketPriceCount),
          shouldStop: input.shouldStop,
          validate: async (parsed) => {
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

            return [
              { category: "immersion", issues },
              await critiqueEconomyMaterialLifeWithModel({
                prompt: input.prompt,
                promptIntentProfile,
                scaleTier: input.scaleTier,
                locationTradeIdentity: parsed.locationTradeIdentity,
                commodities: parsed.commodities,
              }),
            ];
          },
          summarize: (parsed) =>
            `${parsed.commodities.length} commodities and ${parsed.marketPrices.length} market prices.`,
        });
        markStageCompleted("economy_material_life", economyMaterialLifeInput);
      }

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

      const draft: GeneratedWorldModule = {
        ...spineModule,
        entryPoints: [],
      };

      notifyProgress({
        stage: "final_world",
        status: "running",
        message: getWorldGenerationStageRunningMessage("final_world"),
      });

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

      stageSummaries.final_world = `${draft.locations.length} places, ${draft.npcs.length} NPCs, and ${draft.information.length} information surfaces are ready.`;
      checkpoint.stageArtifacts.final_world = draft;
      persistCheckpoint("ready", null, null);
      notifyProgress({
        stage: "final_world",
        status: "complete",
        message: stageSummaries.final_world,
      });

      const artifacts: OpenWorldGenerationArtifacts = {
        prompt: input.prompt,
        model: env.openRouterModel,
        createdAt: new Date().toISOString(),
        scaleTier: input.scaleTier,
        scalePlan,
        promptIntentProfile,
        promptArchitectureVersion: CURRENT_PROMPT_ARCHITECTURE_VERSION,
        worldBible,
        worldSpine,
        regionalLife,
        socialLayer,
        knowledgeEconomy,
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
      const message = error instanceof Error ? error.message : "World generation failed.";
      const checkpointStatus =
        error instanceof WorldGenerationStoppedError ? "stopped" : "failed";
      persistCheckpointForFailure?.(
        checkpointStatus,
        currentStage && WORLD_GENERATION_STAGE_ORDER.includes(
          currentStage as CheckpointableWorldGenerationStageName,
        )
          ? (currentStage as CheckpointableWorldGenerationStageName)
          : null,
        message,
      );
      logOpenRouterResponse("world.error", {
        message: error instanceof Error ? error.message : String(error),
      });
      if (error instanceof WorldGenerationStoppedError) {
        throw error;
      }
      throw new Error(message);
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
    const temporaryLocals = input.entryPoint.temporaryLocalActors;
    const rewriteIntent = input.prompt?.trim() && input.previousDraft
      ? await this.interpretOpeningRewriteIntent({
          prompt: input.prompt,
          previousDraft: input.previousDraft,
          entryPoint: input.entryPoint,
        })
      : null;
    const shouldDeintensifyRewrite =
      rewriteIntent?.tensionDirection === "calmer"
      || rewriteIntent?.confrontationCarryForward === "remove";
    const system = [
      "Write the opening scene for a chosen entry point in an open-world solo RPG.",
      "Stay inside the selected entry-point bubble and do not invent off-screen mechanical facts.",
      "Open on immediate lived circumstance, sensory detail, and a situation a normal person can act on right now.",
      "The opening does not need to be grand, exceptional, or high drama. Ordinary work, travel, errands, routine obligations, or a quiet departure are all valid starts.",
      "Immediate pressure may be mundane and local: being late, a shift starting, weather turning, a line forming, a supervisor watching, stock running short, a cart breaking down, or neighbors noticing something off.",
      "If the opening is peaceful or slice-of-life, set activeThreat to null instead of inventing danger.",
      "Do not force a quest-giver, crisis escalation, conspiracy reveal, or dramatic named-NPC confrontation if the launch entry is grounded in ordinary life.",
      "Do not inflate routine setup into paperwork drama just because the location contains guilds, officials, or formal procedure. Keep attention on bodies, tools, weather, movement, fatigue, nearby people, and actionable local texture unless the entry truly hinges on administration.",
      "When an entry includes public notices, manifests, queues, ledgers, or formal protocol, treat them as background texture or one practical constraint among others, not automatically the emotional center of the scene.",
      "Avoid prophecy, trailer voiceover, destiny framing, and broad setting-summary prose.",
      "Treat start_location as the authoritative physical setting for the scene.",
      "If the player prompt or custom entry text contains an unsupported place name that conflicts with start_location, ignore the unsupported place name and ground the scene at start_location.name.",
      "If the launch entry uses unnamed temporary locals instead of named NPCs, treat them as real scene participants and do not force a named contact into the opening.",
      "If the launch entry has no localContactNpcId, no localContactTemporaryActorLabel, and no temporary locals, preserve that solitude or privacy instead of inventing an immediate social interaction.",
      ...(rewriteIntent?.canonicalScope === "wants_entry_change"
        ? [
            "The player's rewrite intent partly points at changing the underlying entry setup or start location.",
            "Opening regeneration cannot change the canonical entry selection, so keep the same entry point but satisfy the requested mood and surface details as honestly as possible within that fixed setup.",
          ]
        : []),
      ...(shouldDeintensifyRewrite
        ? [
            "The rewrite intent is steering the scene toward a calmer, more routine mood.",
            "When revising away from a prior draft, remove leftover confrontation beats instead of preserving them by inertia.",
            "Avoid interruption framing like urgent knocks, demands, summons, alarms, grim arrivals, or sudden handoffs unless the rewrite explicitly asks to keep them.",
            "Prefer work rhythm, nearby passersby, small talk, craft decisions, observations, and ordinary choices as the playable affordances.",
          ]
        : []),
      "Scene summary must be 40 words or fewer.",
      "Return narration, activeThreat, a scene summary, and exact ids for the starting location, present NPCs, and cited information via the provided tool schema.",
    ].join("\n");
    const user = [
      formatPromptBlock("module_summary", summarizeWorld(input.module)),
      formatPromptBlock(
        "generation_artifacts",
        input.artifacts
            ? {
              worldBible: {
                groundLevelReality: input.artifacts.worldBible.groundLevelReality,
                sharedRealities: input.artifacts.worldBible.sharedRealities,
                competingExplanations: input.artifacts.worldBible.explanationThreads,
              },
              regionalLife: input.artifacts.regionalLife.locations.filter(
                (entry) => idsReferToSameEntity(entry.locationId, input.entryPoint.startLocationId),
              ),
              entryContext: {
                id: input.entryPoint.id,
                title: input.entryPoint.title,
                summary: input.entryPoint.summary,
                startLocationId: input.entryPoint.startLocationId,
                presentNpcIds: input.entryPoint.presentNpcIds,
                initialInformationIds: input.entryPoint.initialInformationIds,
                immediatePressure: input.entryPoint.immediatePressure,
                publicLead: input.entryPoint.publicLead,
                localContactNpcId: input.entryPoint.localContactNpcId,
                localContactTemporaryActorLabel: input.entryPoint.localContactTemporaryActorLabel,
                temporaryLocalActors: input.entryPoint.temporaryLocalActors,
                mundaneActionPath: input.entryPoint.mundaneActionPath,
                evidenceWorldAlreadyMoving: input.entryPoint.evidenceWorldAlreadyMoving,
                isCustom: input.entryPoint.isCustom,
              },
            }
          : null,
      ),
      formatPromptBlock("entry_point", input.entryPoint),
      formatPromptBlock("start_location", location),
      formatPromptBlock("present_npcs", presentNpcs),
      formatPromptBlock("temporary_locals", temporaryLocals),
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
      formatPromptBlock("rewrite_intent", rewriteIntent),
      formatPromptBlock("prompt", input.prompt ?? null),
      formatPromptBlock("previous_draft", input.previousDraft ?? null),
    ].join("\n\n");

    try {
      logNarrationDebug("opening.request", {
        system,
        user,
      });

      const response = await runCompletion({
        system,
        user,
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

  async resolveCustomEntryPoint(
    input: CustomEntryResolutionInput,
  ): Promise<z.infer<typeof customResolvedLaunchEntryDraftSchema>> {
    const locationOptions = summarizeLaunchResolutionLocations(input.module);
    const npcOptions = summarizeLaunchResolutionNpcs(input.module);
    const informationOptions = summarizeLaunchResolutionInformation(input.module);
    const interpretedIntent = input.interpretedIntent
      ?? await this.interpretCustomEntryIntent({
        prompt: input.prompt,
        character: input.character,
      });
    let correctionNotes = input.correctionNotes ?? null;

    try {
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        const response = await runCompletion({
          system: [
            "Resolve a player's desired campaign opening into a grounded launch entry for an open-world solo RPG.",
            "Treat the player's examples as signals about social scale, anonymity, routine, and tone, not as nouns you must mirror literally.",
            "A valid start may be ordinary and low-status: regular work, local routine, private obligations, travel preparation, or leaving a familiar place without spectacle.",
            "Do not bias toward dramatic intrigue, combat readiness, elite roles, or special destiny framing.",
            "If an interpreted_player_intent block is present, follow its desired opening shape over the nearest authored stock hook at that location.",
            "Use only the provided canonical ids exactly as written.",
            "Do not invent locations, NPCs, factions, information, or new ids.",
            "Do not move NPCs from their authored currentLocationId.",
            "Choose present NPCs only from the selected start location.",
            "A viable start needs immediate playable affordances, not necessarily an immediate person to interact with.",
            "Playable affordances may come from routine work, visible public movement, private obligations, environmental pressure, travel preparation, nearby named NPCs, or unnamed locals already implied by the place.",
            "You may include presentNpcIds even when the opening does not hinge on directly interacting with them.",
            "If no suitable named local is needed, you may leave presentNpcIds empty and instead seed temporary unnamed locals.",
            "If the opening is solitary or private, you may leave presentNpcIds empty and set both localContactNpcId and localContactTemporaryActorLabel to null.",
            "Use localContactNpcId only when the opening should hinge on a named NPC already authored in the world.",
            "Never set localContactTemporaryActorLabel when localContactNpcId is non-null.",
            "When the interpreted player intent is routine_work or private_project, prefer self-directed action, ordinary timing pressure, and local texture over named briefings.",
            "When the interpreted socialAnchorPreference is ambient_locals or solitary, prefer localContactNpcId null unless the player clearly asked for a specific named person.",
            "When the interpreted informationLeadPreference is none or ambient_public, prefer no initialInformationIds or only broad ambient public knowledge that does not depend on a named NPC briefing.",
            "A custom entry should feel distinct from an authored stock entry point, not like a paraphrase of the same hook with the serial numbers filed off.",
            "Do not simply inherit the exact named contact, pressure package, and public lead of a stock entry when a more routine or more player-authored interpretation is available.",
            "If the player premise is ordinary work or daily life, preserve that as the main affordance instead of escalating to the location's default crisis.",
            "You may use temporaryLocalActors for scene texture even when no single unnamed local is the opening hinge.",
            "Use localContactTemporaryActorLabel and temporaryLocalActors when the opening should hinge on unnamed locals or ordinary roles already implied by the place.",
            "If localContactNpcId is null, localContactTemporaryActorLabel must match one temporaryLocalActors label.",
            "Do not invent named NPCs to satisfy the request when unnamed locals are enough.",
            "initialInformationIds may include only public or guarded information, never secret information.",
            "If the player's request is unsupported, repair it into the nearest honest version the world can support.",
            "Once you choose startLocationId, every player-facing surface field must honestly reflect that exact place.",
            "Do not keep or echo unsupported player-supplied place names in the title, summary, immediatePressure, publicLead, mundaneActionPath, or evidenceWorldAlreadyMoving.",
            "If you map the request to Waterdeep, say Waterdeep. If you map it to Daggerford, say Daggerford. Do not preserve a conflicting place name just because the player used it.",
            "Keep title and summary concrete, local, and player-facing.",
            "Return only the structured launch entry payload.",
          ].join("\n"),
          user: [
            formatPromptBlock("module_summary", summarizeWorld(input.module)),
            formatPromptBlock("player_request", input.prompt),
            formatPromptBlock("interpreted_player_intent", interpretedIntent),
            formatPromptBlock("correction_notes", correctionNotes),
            formatPromptBlock("character", {
              name: input.character.name,
              archetype: input.character.archetype,
              backstory: input.character.backstory,
            }),
            formatPromptBlock("valid_locations", locationOptions),
            formatPromptBlock("valid_npcs", npcOptions),
            formatPromptBlock("valid_information", informationOptions),
          ].join("\n\n"),
          tools: [customEntryResolutionTool],
          maxTokens: 1400,
        });

        const normalizedInput = normalizeCustomResolvedLaunchEntryDraft(response?.input);
        if (normalizedInput !== response?.input) {
          logOpenRouterResponse("custom_entry.normalized_input", {
            preview: toPreview(normalizedInput),
          });
        }

        const parsed = customResolvedLaunchEntryDraftSchema.safeParse(normalizedInput);
        if (!parsed.success) {
          throw new Error(`Custom entry resolution returned invalid structured data: ${parsed.error.message}`);
        }

        if (interpretedIntent) {
          const intentConflicts = findCustomEntryIntentConflicts({
            intent: interpretedIntent,
            resolvedDraft: parsed.data,
            validInformation: informationOptions,
            validNpcs: npcOptions,
          });

          if (intentConflicts.length) {
            logOpenRouterResponse("custom_entry.intent_conflict", {
              attempt,
              preview: toPreview({
                interpretedIntent,
                intentConflicts,
                resolvedDraft: parsed.data,
              }),
            });

            if (attempt < 2) {
              correctionNotes = buildCustomEntryIntentCorrectionNotes({
                priorCorrectionNotes: correctionNotes,
                intent: interpretedIntent,
                issues: intentConflicts,
              });
              continue;
            }
          }
        }

        return parsed.data;
      }

      throw new Error("Custom entry resolution did not honor the interpreted player intent after retry.");
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : "Custom entry resolution failed.");
    }
  }

  async resolveObjectiveLaunchEntry(
    input: ObjectiveLaunchEntryResolutionInput,
  ): Promise<z.infer<typeof customResolvedLaunchEntryDraftSchema>> {
    const locationOptions = summarizeLaunchResolutionLocations(input.module);
    const npcOptions = summarizeLaunchResolutionNpcs(input.module);
    const informationOptions = summarizeLaunchResolutionInformation(input.module);
    let correctionNotes = input.correctionNotes ?? null;

    try {
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        const response = await runCompletion({
          system: [
            "Resolve one grounded campaign launch entry for a reusable open-world module.",
            "Choose an honest starting situation supported by the world as written, without assuming a protagonist destiny, quest hook, or cinematic inciting incident.",
            "This is campaign-time launch resolution, not module authoring. The entry should connect a specific character to an existing public surface in the world.",
            "Prefer grounded lived surfaces over heroic or conspiratorial setup: a shift beginning, a watch changing, goods changing hands, a route opening, a shared meal, a repair underway, a ritual threshold, a public board, a roadside pause, a weather turn, or an ordinary obligation coming due.",
            "Do not over-prefer clerks, inspectors, permits, manifests, filing windows, or checkpoint procedure when a more human and equally honest opening surface is available in the same place.",
            "Routine life may be social, physical, atmospheric, or practical, not only administrative.",
            "Use only the provided canonical ids exactly as written.",
            "Do not invent locations, NPCs, factions, information, or new ids.",
            "Do not move NPCs from their authored currentLocationId.",
            "Choose present NPCs only from the selected start location.",
            "A viable start needs immediate playable affordances, but those affordances may be routine, quiet, or low-stakes.",
            "If no named contact is necessary, leave localContactNpcId null and use temporaryLocalActors or localContactTemporaryActorLabel when ambient locals are enough.",
            "If the best honest opening is solitary or self-directed, presentNpcIds may be empty and both localContactNpcId and localContactTemporaryActorLabel may be null.",
            "public-facing information at the start may include only public or guarded information, never secret information.",
            "Keep title, summary, immediatePressure, publicLead, mundaneActionPath, and evidenceWorldAlreadyMoving concrete, grounded, and locally playable.",
            "If launch_guidance is absent, choose the most legible ordinary hinge for this character, favoring embodied circumstance over official procedure when both are equally supported.",
            "If launch_guidance is present, treat it as steering, but repair unsupported requests into the nearest honest version the world can support.",
            "Return only the structured launch entry payload.",
          ].join("\n"),
          user: [
            formatPromptBlock("module_summary", summarizeWorld(input.module)),
            formatPromptBlock("launch_guidance", input.prompt?.trim() || null),
            formatPromptBlock("correction_notes", correctionNotes),
            formatPromptBlock("character", {
              name: input.character.name,
              archetype: input.character.archetype,
              backstory: input.character.backstory,
            }),
            formatPromptBlock("valid_locations", locationOptions),
            formatPromptBlock("valid_npcs", npcOptions),
            formatPromptBlock("valid_information", informationOptions),
          ].join("\n\n"),
          tools: [customEntryResolutionTool],
          maxTokens: 1400,
        });

        const normalizedInput = normalizeCustomResolvedLaunchEntryDraft(response?.input);
        if (normalizedInput !== response?.input) {
          logOpenRouterResponse("objective_launch_entry.normalized_input", {
            preview: toPreview(normalizedInput),
          });
        }

        const parsed = customResolvedLaunchEntryDraftSchema.safeParse(normalizedInput);
        if (!parsed.success) {
          throw new Error(`Objective launch entry returned invalid structured data: ${parsed.error.message}`);
        }

        if (!parsed.data.presentNpcIds.length && !parsed.data.temporaryLocalActors.length) {
          if (attempt < 2) {
            correctionNotes = [
              correctionNotes,
              "The previous draft created too empty a launch surface.",
              "Give the character at least one visible public surface: a named local already at the start location, or ambient temporary locals who belong there.",
            ].filter(Boolean).join("\n");
            continue;
          }
        }

        return parsed.data;
      }

      throw new Error("Objective launch entry resolution exhausted retry attempts.");
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : "Objective launch entry resolution failed.");
    }
  }

  async generateStartingLocalNpcs(
    input: StartingLocalHydrationInput,
  ): Promise<StartingLocalNpcDraft[]> {
    const regionLocationIds = Array.from(
      new Set([input.entryPoint.startLocationId, ...input.nearbyLocationIds]),
    ).slice(0, 4);
    const regionLocations = input.module.locations.filter((location) =>
      regionLocationIds.includes(location.id),
    );
    const existingRegionNpcs = input.module.npcs.filter((npc) =>
      regionLocationIds.includes(npc.currentLocationId),
    );
    const existingNpcNames = new Set(
      input.module.npcs.map((npc) => npc.name.trim().toLowerCase()).filter(Boolean),
    );
    const anchoredFactionIds = new Set(
      [
        ...regionLocations
          .map((location) => location.controllingFactionId)
          .filter((factionId): factionId is string => Boolean(factionId)),
        ...existingRegionNpcs
          .map((npc) => npc.factionId)
          .filter((factionId): factionId is string => Boolean(factionId)),
      ].filter(Boolean),
    );
    const regionFactions = input.module.factions.filter((faction) => anchoredFactionIds.has(faction.id));
    const targetCount = Math.min(6, Math.max(3, regionLocations.length + 1));

    try {
      const response = await runCompletion({
        system: [
          "Generate ordinary persistent locals for the starting region of an open-world solo RPG campaign.",
          "These NPCs are not mythic movers, ornamental quest-givers, or quirky mascots. They are workers, wardens, clerks, haulers, brokers, patrols, repairers, vendors, and household-level operators who make the place feel inhabited.",
          "Tie every NPC to the immediate social surface around the starting location and nearby hops.",
          "If the launch entry already includes temporary unnamed locals, prefer resolving those social roles into persistent locals instead of inventing parallel duplicates for the same surface.",
          "Use only the exact provided location ids and faction ids.",
          "Do not duplicate or rename any existing NPCs already present in the region.",
          "At least two generated NPCs must live at the starting location.",
          "Keep summary and description to one tight sentence each.",
          `Return exactly ${targetCount} NPCs.`,
        ].join("\n"),
        user: [
          formatPromptBlock("module_summary", summarizeWorld(input.module)),
          formatPromptBlock("entry_point", input.entryPoint),
          formatPromptBlock("opening_scene", {
            activeThreat: input.opening.activeThreat,
            summary: input.opening.scene.summary,
            suggestedActions: input.opening.scene.suggestedActions,
          }),
          formatPromptBlock("temporary_locals", input.entryPoint.temporaryLocalActors),
          formatPromptBlock(
            "region_locations",
            summarizeLocationRefs(regionLocations, { includeKey: false }),
          ),
          formatPromptBlock("existing_region_npcs", summarizeNpcRefs(existingRegionNpcs)),
          formatPromptBlock("region_factions", summarizeFactionRefs(regionFactions, { includeKey: false })),
          formatPromptBlock("character", {
            name: input.character.name,
            archetype: input.character.archetype,
            backstory: input.character.backstory,
          }),
        ].join("\n\n"),
        tools: [startingLocalHydrationTool],
        maxTokens: 1400,
      });

      logOpenRouterResponse("starting_locals.raw_input", {
        preview: toPreview(response?.input),
      });

      const parsed = startingLocalHydrationSchema.safeParse(response?.input);
      if (!parsed.success) {
        logOpenRouterResponse("starting_locals.schema_failure", {
          issues: parsed.error.issues,
          inputPreview: toPreview(response?.input),
        });
        throw new Error(`Starting local hydration returned invalid structured data: ${parsed.error.message}`);
      }

      const issues: string[] = [];
      const seenNames = new Set<string>();
      let startingLocationCount = 0;

      for (const npc of parsed.data.npcs) {
        const normalizedName = npc.name.trim().toLowerCase();
        if (existingNpcNames.has(normalizedName)) {
          issues.push(`Generated local ${npc.name} duplicates an existing NPC name.`);
        }
        if (seenNames.has(normalizedName)) {
          issues.push(`Generated local ${npc.name} is duplicated within the hydration batch.`);
        }
        if (!regionLocationIds.includes(npc.currentLocationId)) {
          issues.push(`Generated local ${npc.name} uses an out-of-region location id.`);
        }
        if (npc.factionId && !anchoredFactionIds.has(npc.factionId)) {
          issues.push(`Generated local ${npc.name} uses an unknown region faction id.`);
        }
        if (npc.currentLocationId === input.entryPoint.startLocationId) {
          startingLocationCount += 1;
        }
        seenNames.add(normalizedName);
      }

      if (parsed.data.npcs.length !== targetCount) {
        issues.push(`Expected ${targetCount} starting locals but received ${parsed.data.npcs.length}.`);
      }

      if (startingLocationCount < 2) {
        issues.push("At least two generated locals must be anchored at the starting location.");
      }

      if (issues.length) {
        logOpenRouterResponse("starting_locals.validation_failure", {
          issues,
          inputPreview: toPreview(parsed.data),
        });
        throw new Error(`Starting local hydration failed validation: ${issues.join("; ")}`);
      }

      return parsed.data.npcs.map((npc) => ({
        ...npc,
        tags: npc.tags ?? [],
        isCompanion: false,
      }));
    } catch (error) {
      logOpenRouterResponse("starting_locals.error", {
        message: error instanceof Error ? error.message : String(error),
      });
      throw new Error(error instanceof Error ? error.message : "Starting local hydration failed.");
    }
  }

  async hydratePromotedNpc(input: PromotedNpcHydrationInput): Promise<PromotedNpcHydrationDraft> {
    try {
      const response = await runCompletion({
        system: [
          "Hydrate a recurring local in an open-world solo RPG.",
          "This NPC is already mechanically real. Your job is to make them narratively grounded without inventing new world entities.",
          "Treat npc.role, npc.summary, npc.description, temporary_actor_memory.label, temporary_actor_memory.recentTopics, and temporary_actor_memory.lastSummary as prior facts from earlier play.",
          "Refine and deepen those prior facts. Do not replace the NPC with a different occupation, social niche, or implied personality.",
          "If the label and prior summaries imply a specific kind of local, preserve that identity and make it feel more concrete rather than recasting them.",
          "Preserve the established crossing path from prior facts. If prior facts place the NPC at the player's stall, counter, bench, cart, shopfront, or work area, keep that locus instead of relocating them.",
          "Use local_npcs and local_information only as background context for concerns or optional leads. They do not license attaching this NPC to another named local's stall, shop, crew, employer, or conversation unless that named connection already appears in the prior facts.",
          "Do not make the NPC's main summary or description orbit another named local NPC unless that relationship is already grounded in npc.summary, npc.description, or temporary_actor_memory.lastSummary.",
          "If prior facts are thin, stay close to temporary_actor_memory.lastSummary instead of elaborating outward.",
          "If npc.name is only a generic role label matching npc.role, you may replace it with one ordinary grounded personal name that fits the location and role. Otherwise preserve the existing name.",
          "Use only the provided location id, local faction ids, nearby route names, and referenced local NPCs/information.",
          "Keep the NPC ordinary and socially legible: worker, fixer, clerk, guard, hauler, repairer, vendor, lookout, or another believable local role.",
          "Let the NPC's current concern grow naturally from the prior interaction topics or the local texture whenever possible.",
          "Write one tight summary sentence and one tight description paragraph that bakes in the NPC's current concern and how the player already crosses paths with them.",
          "If no listed faction fits naturally, return factionId as null.",
          "Return 0 to 2 information leads only when the prior facts already suggest a concrete local concern. Otherwise return none.",
          "Do not invent new named factions, locations, or commodities. Only invent a personal name when the current npc.name is a generic role label and the input explicitly allows that upgrade.",
        ].join("\n"),
        user: [
          formatPromptBlock("npc", input.npc),
          formatPromptBlock("identity_seed", {
            priorRole: input.npc.role,
            priorSummary: input.npc.summary,
            priorDescription: input.npc.description,
            originalLabel: input.temporaryActor.label,
            priorTopics: input.temporaryActor.recentTopics,
            priorLastSummary: input.temporaryActor.lastSummary,
            allowRenameFromGenericRoleLabel: input.allowRenameFromGenericRoleLabel ?? false,
          }),
          formatPromptBlock("location", input.location),
          formatPromptBlock("local_factions", input.localFactions),
          formatPromptBlock("local_npcs", input.localNpcs),
          formatPromptBlock("local_information", input.localInformation),
          formatPromptBlock("nearby_routes", input.nearbyRoutes),
          formatPromptBlock("temporary_actor_memory", input.temporaryActor),
        ].join("\n\n"),
        tools: [promotedNpcHydrationTool],
        maxTokens: 1200,
      });

      const parsed = promotedNpcHydrationSchema.safeParse(response?.input);
      if (!parsed.success) {
        throw new Error(`Promoted NPC hydration returned invalid structured data: ${parsed.error.message}`);
      }

      return parsed.data;
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : "Promoted NPC hydration failed.");
    }
  }

  async generateDailyWorldSchedule(input: DailyWorldScheduleInput): Promise<GeneratedDailySchedule> {
    try {
      const response = await runCompletion({
        system: [
          "Generate the next in-world day of world events and faction moves for a living solo RPG campaign.",
          "The world is alive, but outputs must stay compact and mechanically safe.",
          "Return only events and faction moves for the next 24 hours, using concise descriptions and minimal payloads.",
          "Favor reactions to current faction agendas, territory, NPC state, and already discovered player impact.",
          "Do not invent unknown ids. Use only ids present in the provided campaign state.",
          "Keep payloads small and typed.",
        ].join("\n"),
        user: formatPromptBlock("campaign_state", input.campaign),
        tools: [dailyWorldScheduleTool],
        maxTokens: 1800,
      });

      logOpenRouterResponse("daily_schedule.raw_input", {
        preview: toPreview(response?.input),
      });

      const parsed = dailyWorldScheduleSchema.safeParse(response?.input);
      if (!parsed.success) {
        logOpenRouterResponse("daily_schedule.schema_failure", {
          issues: parsed.error.issues,
          inputPreview: toPreview(response?.input),
        });
        throw new Error(`Daily schedule generation returned invalid structured data: ${parsed.error.message}`);
      }

      const scopedIdLookups = {
        locations: buildUnscopedIdLookup(input.campaign.locations.map((location) => location.id)),
        factions: buildUnscopedIdLookup(input.campaign.factions.map((faction) => faction.id)),
        npcs: buildUnscopedIdLookup(input.campaign.npcs.map((npc) => npc.id)),
        information: buildUnscopedIdLookup(
          input.campaign.discoveredInformation.map((information) => information.id),
        ),
      };

      return {
        worldEvents: parsed.data.worldEvents.map((event) => ({
          ...event,
          locationId: event.locationId
            ? normalizeScheduleEntityId(event.locationId, scopedIdLookups)
            : null,
          triggerCondition: (event.triggerCondition ?? null) as GeneratedDailySchedule["worldEvents"][number]["triggerCondition"],
          payload: normalizeSchedulePayloadIds(event.payload, scopedIdLookups) as GeneratedDailySchedule["worldEvents"][number]["payload"],
        })),
        factionMoves: parsed.data.factionMoves.map((move) => ({
          ...move,
          factionId: normalizeScheduleEntityId(move.factionId, scopedIdLookups),
          payload: normalizeSchedulePayloadIds(move.payload, scopedIdLookups) as GeneratedDailySchedule["factionMoves"][number]["payload"],
        })),
      } satisfies GeneratedDailySchedule;
    } catch (error) {
      logOpenRouterResponse("daily_schedule.error", {
        message: error instanceof Error ? error.message : String(error),
      });
      throw new Error(error instanceof Error ? error.message : "Daily schedule generation failed.");
    }
  }

  async classifyTurnIntent(input: TurnIntentClassificationInput): Promise<RouterDecision> {
    const plannerModel = env.openRouterPlannerModel.trim();
    if (!plannerModel) {
      return fallbackRouterDecision(
        "Planner model is unavailable, so the turn falls back to full context and no explicit vectors.",
        input.playerAction,
        input.context,
      );
    }

    try {
      const user = [
        formatPromptBlock("action", input.playerAction),
        formatPromptBlock("turn_mode", input.turnMode),
        formatPromptBlock("router_context", formatRouterContextForModel(input.context)),
      ].join("\n\n");

      let correctionNotes: string | null = null;
      for (let attempt = 1; attempt <= MAX_ROUTER_ATTEMPTS; attempt += 1) {
        const system = buildTurnRouterSystemPrompt(correctionNotes);
        logNarrationDebug("turn_router.request", {
          attempt,
          system,
          user,
          plannerModel,
        });

        const response = await runCompletion({
          system,
          user,
          tools: [classifyTurnIntentTool],
          model: plannerModel,
          temperature: 0.1,
          maxTokens: 650,
          signal: input.signal,
        });

        logNarrationDebug("turn_router.raw_input", {
          attempt,
          toolName: response?.name ?? null,
          finishReason: response?.finishReason ?? null,
          likelyTruncated: response?.likelyTruncated ?? false,
          inputPreview: toPreview(response?.input),
        });

        const normalizedInput = normalizeRouterDecisionInput(response?.input);
        const parsed = routerDecisionSchema.safeParse(normalizedInput);
        if (parsed.success) {
          return normalizeRouterDecision(parsed.data, input.context);
        }

        const issues = zodIssuesToText(parsed.error.issues);
        logNarrationDebug("turn_router.parse_failed", {
          attempt,
          issues,
          inputPreview: toPreview(normalizedInput),
        });
        correctionNotes = [
          "Your previous reply did not match the router schema.",
          response?.likelyTruncated
            ? "The previous payload was cut off. Return a much shorter complete replacement payload."
            : `Return a complete replacement payload that matches the router schema exactly. Validation issues: ${issues}`,
          "Return only the tool payload with profile, confidence, authorizedVectors, requiredPrerequisites, reason, clarification, and attention.",
        ].join("\n");
      }

      return fallbackRouterDecision(
        "Planner output was invalid, so the turn falls back to full context and no explicit vectors.",
        input.playerAction,
        input.context,
      );
    } catch (error) {
      logNarrationDebug("turn_router.error", {
        message: error instanceof Error ? error.message : String(error),
      });
      return fallbackRouterDecision(
        "Planner classification failed, so the turn falls back to full context and no explicit vectors.",
        input.playerAction,
        input.context,
      );
    }
  }

  async runTurn(input: TurnInput): Promise<TurnResolution> {
    try {
      const baseSystem = buildTurnSystemPrompt(input.turnMode);
      const approachIds = Array.from(new Set(
        (input.promptContext.approaches ?? input.character.approaches ?? [])
          .map((approach) => approach.id.trim())
          .filter(Boolean),
      ));
      const dynamicResolveMechanicsTool = buildTurnActionSchemas(approachIds).resolveMechanicsTool;

      let correctionNotes: string | null = null;
      let lastFailureSummary: string | null = null;

      for (let attempt = 1; attempt <= MAX_TURN_ATTEMPTS; attempt += 1) {
        logOpenRouterResponse("turn.attempt", {
          attempt,
          maxAttempts: MAX_TURN_ATTEMPTS,
          correctionNotes,
        });

        const user = buildTurnUserPrompt({
          playerAction: input.playerAction,
          promptContext: input.promptContext,
          character: input.character,
          fetchedFacts: input.fetchedFacts,
          routerDecision: input.routerDecision,
        });
        const system = correctionNotes ? `${baseSystem}\n${correctionNotes}` : baseSystem;

        logNarrationDebug("turn.request", {
          attempt,
          correctionNotes,
          system,
          user,
        });

        const response = await runCompletion({
          system,
          user,
          tools: [dynamicResolveMechanicsTool, executeFastForwardTool, requestClarificationTool],
          maxTokens: 1200,
          signal: input.signal,
        });

        const toolName = response?.name;
        const inputPayload = response?.input;
        const normalized =
          toolName && inputPayload && typeof inputPayload === "object" && !Array.isArray(inputPayload)
            ? { type: toolName, ...(inputPayload as Record<string, unknown>) }
            : null;

        logOpenRouterResponse("turn.raw_input", {
          attempt,
          toolName,
          finishReason: response?.finishReason ?? null,
          likelyTruncated: response?.likelyTruncated ?? false,
          inputPreview: toPreview(inputPayload),
        });
        logNarrationDebug("turn.raw_input", {
          attempt,
          toolName,
          finishReason: response?.finishReason ?? null,
          likelyTruncated: response?.likelyTruncated ?? false,
          inputPreview: toPreview(inputPayload),
        });

        if (normalized) {
          const parsedAction = parseFinalActionToolCall(normalized, approachIds);
          if (!parsedAction.success) {
            const validationIssues = zodIssuesToText(parsedAction.error.issues);
            lastFailureSummary = response?.likelyTruncated
              ? "The previous payload was cut off."
              : `Last validation issues: ${validationIssues}`;
            correctionNotes = buildTurnActionCorrectionNotes({
              likelyTruncated: response?.likelyTruncated ?? false,
              validationIssues,
            });
            continue;
          }

          if (input.turnMode === "observe" && !isObservePermittedFinalTool(parsedAction.data)) {
            correctionNotes = [
              "Observe mode is active.",
              "Return exactly one final action tool call using resolve_mechanics or request_clarification only.",
              "Use request_clarification only if the world state is too invalid to produce passive progression.",
              "Do not emit any combat, trade, travel, fast-forward montage, or deliberate social escalation in observe mode.",
              "Do not give the player character dialogue or chosen actions.",
            ].join("\n");
            continue;
          }

          if (
            parsedAction.data.type === "resolve_mechanics"
            && input.turnMode === "observe"
            && !isObserveMechanicsPayloadSafe(parsedAction.data)
          ) {
            correctionNotes = [
              "Observe mode may only wait, passively notice things, or request clarification.",
              "Remove any travel, combat, trade, relationship, or deliberate player-initiated mutations.",
            ].join("\n");
            continue;
          }

          logOpenRouterResponse("turn.success", {
            attempt,
            toolName,
            inputPreview: toPreview(parsedAction.data),
          });
          logNarrationDebug("turn.success", {
            attempt,
            toolName,
            inputPreview: toPreview(parsedAction.data),
            fetchedFactsPreview: toPreview(input.fetchedFacts),
          });
          return {
            command: parsedAction.data,
            fetchedFacts: input.fetchedFacts,
          };
        }

        lastFailureSummary = response?.likelyTruncated
          ? "The previous payload was cut off before a complete tool payload could be read."
          : "The model did not produce a complete valid tool payload.";
          correctionNotes = [
            "Your previous reply did not produce a complete valid tool payload.",
            response?.likelyTruncated
              ? "The previous payload was cut off. Return a complete replacement payload with fewer mutations."
              : "Return a complete replacement payload that exactly matches one tool schema.",
            "If you use resolve_mechanics, include top-level timeMode, suggestedActions, and mutations.",
            "If you use execute_fast_forward, include requestedDurationMinutes, routineSummary, recurringActivities, and intendedOutcomes.",
            "Do not include assistant prose before the tool call.",
          ].join("\n");
      }

      throw new Error(
        lastFailureSummary
          ? `Turn generation produced tool output, but none matched the final action schema after retries. ${lastFailureSummary}`
          : "Turn generation did not return a valid tool call after retries.",
      );
    } catch (error) {
      logOpenRouterResponse("turn.error", {
        message: error instanceof Error ? error.message : String(error),
      });
      logNarrationDebug("turn.error", {
        message: error instanceof Error ? error.message : String(error),
      });
      throw new Error(error instanceof Error ? error.message : "Turn generation failed.");
    }
  }

  async narrateResolvedTurn(input: ResolvedTurnNarrationInput): Promise<string> {
    try {
      let correctionNotes: string | null = null;

      for (let attempt = 1; attempt <= MAX_TURN_ATTEMPTS; attempt += 1) {
        const prompt = buildResolvedTurnNarrationPrompt(input);
        const system = [prompt.system, correctionNotes].filter((line): line is string => Boolean(line)).join("\n");
        const user = prompt.user;

        logNarrationDebug("resolved_turn_narration.request", {
          attempt,
          correctionNotes,
          system,
          user,
        });

        let response!: Awaited<ReturnType<typeof runCompletion>>;
        let lastTransientError: Error | null = null;

        for (let completionAttempt = 1; completionAttempt <= NARRATION_TRANSIENT_RETRY_DELAYS_MS.length; completionAttempt += 1) {
          try {
            response = await runCompletion({
              system,
              user,
              tools: [resolvedTurnNarrationTool],
              maxTokens: 900,
              signal: input.signal,
            });
            lastTransientError = null;
            break;
          } catch (error) {
            if (
              !isTransientNarrationModelError(error)
              || input.signal?.aborted
              || completionAttempt === NARRATION_TRANSIENT_RETRY_DELAYS_MS.length
            ) {
              throw error;
            }

            lastTransientError = error instanceof Error ? error : new Error(String(error));
            const backoffMs = NARRATION_TRANSIENT_RETRY_DELAYS_MS[completionAttempt - 1];
            logNarrationDebug("resolved_turn_narration.retry", {
              attempt,
              completionAttempt,
              backoffMs,
              message: error instanceof Error ? error.message : String(error),
            });
            await wait(backoffMs);
          }
        }

        if (!response) {
          throw lastTransientError ?? new Error("Resolved-turn narration completion failed.");
        }

        logNarrationDebug("resolved_turn_narration.raw_input", {
          attempt,
          toolName: response?.name ?? null,
          finishReason: response?.finishReason ?? null,
          likelyTruncated: response?.likelyTruncated ?? false,
          inputPreview: toPreview(response?.input),
        });

        const parsed = resolvedTurnNarrationSchema.safeParse(response?.input);
        if (!parsed.success) {
          const plainTextCandidate =
            response?.name == null && typeof response?.rawText === "string"
              ? response.rawText.trim()
              : "";
          if (plainTextCandidate && !response?.likelyTruncated) {
            const candidateParsed = resolvedTurnNarrationSchema.safeParse({
              narration: plainTextCandidate,
            });
            if (candidateParsed.success) {
              const violation = narrationViolatesResolvedConstraints(input, candidateParsed.data.narration);
              if (!violation) {
                logNarrationDebug("resolved_turn_narration.salvaged_plaintext", {
                  attempt,
                  preview: toPreview(candidateParsed.data.narration),
                });
                return candidateParsed.data.narration;
              }
            }
          }
          correctionNotes = [
            "Your previous reply did not match the narration schema.",
            response?.likelyTruncated
              ? "Return a much shorter complete replacement payload."
              : `Return a complete replacement payload. Validation issues: ${zodIssuesToText(parsed.error.issues)}`,
          ].join("\n");
          continue;
        }

        const narration = parsed.data.narration.trim();
        const violation = narrationViolatesResolvedConstraints(input, narration);
        if (violation) {
          correctionNotes = [
            "Your previous reply violated the narration grounding rules.",
            violation,
            "Return a complete replacement payload grounded only in committed outcomes.",
          ].join("\n");
          continue;
        }

        return narration;
      }

      throw new Error("Resolved-turn narration did not return a valid payload after retries.");
    } catch (error) {
      logNarrationDebug("resolved_turn_narration.error", {
        message: error instanceof Error ? error.message : String(error),
      });
      throw new Error(error instanceof Error ? error.message : "Resolved-turn narration failed.");
    }
  }

  async suggestResolvedTurnActions(input: ResolvedTurnSuggestedActionsInput): Promise<string[]> {
    try {
      let correctionNotes: string | null = null;

      for (let attempt = 1; attempt <= MAX_TURN_ATTEMPTS; attempt += 1) {
        const prompt = buildResolvedTurnSuggestedActionsPrompt(input);
        const system = [prompt.system, correctionNotes].filter((line): line is string => Boolean(line)).join("\n");
        const user = prompt.user;

        logNarrationDebug("resolved_turn_suggestions.request", {
          attempt,
          correctionNotes,
          system,
          user,
        });

        const response = await runCompletion({
          system,
          user,
          tools: [resolvedTurnSuggestedActionsTool],
          maxTokens: 300,
          signal: input.signal,
        });

        logNarrationDebug("resolved_turn_suggestions.raw_input", {
          attempt,
          toolName: response?.name ?? null,
          finishReason: response?.finishReason ?? null,
          likelyTruncated: response?.likelyTruncated ?? false,
          inputPreview: toPreview(response?.input),
        });

        const parsed = resolvedTurnSuggestedActionsSchema.safeParse(response?.input);
        if (!parsed.success) {
          correctionNotes = [
            "Your previous reply did not match the suggested-actions schema.",
            response?.likelyTruncated
              ? "Return a much shorter complete replacement payload."
              : `Return a complete replacement payload. Validation issues: ${zodIssuesToText(parsed.error.issues)}`,
          ].join("\n");
          continue;
        }

        return Array.from(
          new Set(parsed.data.suggestedActions.map((entry) => entry.trim()).filter(Boolean)),
        ).slice(0, 4);
      }

      throw new Error("Resolved-turn suggestion generation did not return a valid payload after retries.");
    } catch (error) {
      logNarrationDebug("resolved_turn_suggestions.error", {
        message: error instanceof Error ? error.message : String(error),
      });
      throw new Error(error instanceof Error ? error.message : "Resolved-turn suggestion generation failed.");
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
  CURRENT_PROMPT_ARCHITECTURE_VERSION,
  buildPresentTenseScaleGuideLines,
  buildPromptIntentInferenceRubricLines,
  buildRegionalLifeTextureBalanceLines,
  buildRegionalLifeCritiqueInstructions,
  buildRegionalLifeFallbackCorrectionNotes,
  buildTurnRouterSystemPrompt,
  buildTurnActionCorrectionNotes,
  buildTurnSystemPrompt,
  buildTurnUserPrompt,
  buildWorldGenCraftScaffold,
  buildWorldGenIntentGuardrails,
  buildWorldGenSystemPrompt,
  buildWorldBibleCritiqueInstructions,
  buildWorldSpineLocationSuccessLines,
  buildWorldSpineBatchFinalInstructionLines,
  buildWorldSpineScaleFallbackCorrectionNotes,
  buildWorldSpineScaleCritiqueInstructions,
  buildSocialCastScaleFallbackCorrectionNotes,
  buildSocialCastScaleCritiqueInstructions,
  buildKnowledgeWebCritiqueInstructions,
  buildStageTruncationRecoveryIssues,
  buildResolvedNarrationConstraints,
  buildResolvedTurnNarrationPrompt,
  buildResolvedTurnSuggestedActionsPrompt,
  buildRouterConstraintsBlock,
  buildAttentionPacketBlock,
  buildCustomEntryIntentCorrectionNotes,
  extractToolInput,
  findCustomEntryIntentConflicts,
  isObservePermittedFinalTool,
  isObserveMechanicsPayloadSafe,
  narrationViolatesResolvedConstraints,
  normalizeSocialCastInput,
  normalizeScheduleEntityId,
  normalizeSchedulePayloadIds,
  normalizeRouterDecision,
  normalizeWorldGenerationResumeCheckpoint,
  formatRouterContextForModel,
  fallbackRouterDecision,
  parseFinalActionToolCall,
  selectPromptContextProfile,
  summarizeWorldBibleForPrompt,
  validateKnowledgeWebStage,
};
