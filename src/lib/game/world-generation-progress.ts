import type {
  OpenWorldGenerationCheckpoint,
  WorldGenerationStageName,
} from "@/lib/game/types";

export type DraftGenerationProgressStatus = "queued" | "running" | "complete" | "error";

export type DraftGenerationProgress = {
  id: string;
  status: DraftGenerationProgressStatus;
  stage: WorldGenerationStageName | null;
  label: string;
  message: string;
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
  error: string | null;
};

export type WorldGenerationProgressUpdate = {
  stage: WorldGenerationStageName;
  status: "running" | "complete";
  message?: string;
};

const STALE_PROGRESS_MS = 1000 * 60 * 60;

export const WORLD_GENERATION_PROGRESS_STAGES: WorldGenerationStageName[] = [
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

const STAGE_COPY: Record<WorldGenerationStageName, { label: string; running: string }> = {
  prompt_intent: {
    label: "Reading the Prompt",
    running: "Identifying the setting's intended texture, causal logic, and social feel.",
  },
  world_bible: {
    label: "Shaping the Setting",
    running: "Defining the world, its tone, and the lived logic the prompt is asking for.",
  },
  world_spine: {
    label: "Placing Factions and Landmarks",
    running: "Laying out the major places, routes, and groups that hold the setting together.",
  },
  regional_life: {
    label: "Adding Daily Life",
    running: "Filling each location with ordinary texture, habits, tensions, and public life.",
  },
  social_cast: {
    label: "Introducing Locals",
    running: "Creating the people you are most likely to deal with through the world's ordinary interfaces.",
  },
  knowledge_web: {
    label: "Weaving Rumors and Leads",
    running: "Connecting clues, rumors, etiquette, routines, and leads players can act on.",
  },
  knowledge_threads: {
    label: "Linking Hidden Tensions",
    running: "Tying public beliefs, hidden truths, and pressure points back into the playable world.",
  },
  economy_material_life: {
    label: "Setting Material Life",
    running: "Working out what people rely on, prize, maintain, display, and struggle to get.",
  },
  entry_contexts: {
    label: "Preparing Starting Situations",
    running: "Framing grounded ways for a new character to enter the world.",
  },
  final_world: {
    label: "Polishing the Draft",
    running: "Checking the whole module and packaging the final draft.",
  },
};

function getProgressStore() {
  const globalState = globalThis as typeof globalThis & {
    __draftGenerationProgress__?: Map<string, DraftGenerationProgress>;
    __draftGenerationCheckpoint__?: Map<string, OpenWorldGenerationCheckpoint>;
    __draftGenerationProgressListeners__?: Map<string, Set<(progress: DraftGenerationProgress) => void>>;
  };

  if (!globalState.__draftGenerationProgress__) {
    globalState.__draftGenerationProgress__ = new Map<string, DraftGenerationProgress>();
  }

  if (!globalState.__draftGenerationProgressListeners__) {
    globalState.__draftGenerationProgressListeners__ = new Map<
      string,
      Set<(progress: DraftGenerationProgress) => void>
    >();
  }

  return globalState.__draftGenerationProgress__;
}

function getCheckpointStore() {
  const globalState = globalThis as typeof globalThis & {
    __draftGenerationCheckpoint__?: Map<string, OpenWorldGenerationCheckpoint>;
  };

  if (!globalState.__draftGenerationCheckpoint__) {
    globalState.__draftGenerationCheckpoint__ = new Map<string, OpenWorldGenerationCheckpoint>();
  }

  return globalState.__draftGenerationCheckpoint__;
}

function getProgressListenerStore() {
  const globalState = globalThis as typeof globalThis & {
    __draftGenerationProgressListeners__?: Map<string, Set<(progress: DraftGenerationProgress) => void>>;
  };

  if (!globalState.__draftGenerationProgressListeners__) {
    globalState.__draftGenerationProgressListeners__ = new Map<
      string,
      Set<(progress: DraftGenerationProgress) => void>
    >();
  }

  return globalState.__draftGenerationProgressListeners__;
}

function cleanupStaleProgressEntries() {
  const store = getProgressStore();
  const listeners = getProgressListenerStore();
  const cutoff = Date.now() - STALE_PROGRESS_MS;

  for (const [id, progress] of store.entries()) {
    if (new Date(progress.updatedAt).getTime() < cutoff) {
      store.delete(id);
      getCheckpointStore().delete(id);
      listeners.delete(id);
    }
  }
}

function publishDraftGenerationProgress(progress: DraftGenerationProgress) {
  const listeners = getProgressListenerStore().get(progress.id);

  if (!listeners?.size) {
    return;
  }

  for (const listener of listeners) {
    listener(progress);
  }
}

export function getWorldGenerationStageLabel(stage: WorldGenerationStageName) {
  return STAGE_COPY[stage].label;
}

export function getWorldGenerationStageRunningMessage(stage: WorldGenerationStageName) {
  return STAGE_COPY[stage].running;
}

export function getWorldGenerationStageStep(stage: WorldGenerationStageName | null) {
  if (!stage) {
    return 0;
  }

  const index = WORLD_GENERATION_PROGRESS_STAGES.indexOf(stage);
  return index >= 0 ? index + 1 : 0;
}

export function beginDraftGenerationProgress(id: string) {
  cleanupStaleProgressEntries();

  const now = new Date().toISOString();
  const existing = getProgressStore().get(id);
  const progress: DraftGenerationProgress = existing
    ? {
        ...existing,
        status: "queued",
        label: "Resuming Your Draft",
        message: "Picking up from the latest completed stage.",
        completedAt: null,
        error: null,
        updatedAt: now,
      }
    : {
        id,
        status: "queued",
        stage: null,
        label: "Starting Your Draft",
        message: "Getting the world generation process ready.",
        startedAt: now,
        updatedAt: now,
        completedAt: null,
        error: null,
      };

  getProgressStore().set(id, progress);
  publishDraftGenerationProgress(progress);
  return progress;
}

export function createDraftGenerationProgress(id: string) {
  return beginDraftGenerationProgress(id);
}

export function updateDraftGenerationProgress(id: string, update: Partial<DraftGenerationProgress>) {
  const store = getProgressStore();
  const existing = store.get(id);

  if (!existing) {
    return null;
  }

  const next: DraftGenerationProgress = {
    ...existing,
    ...update,
    updatedAt: new Date().toISOString(),
  };

  store.set(id, next);
  publishDraftGenerationProgress(next);
  return next;
}

export function markDraftGenerationStage(id: string, update: WorldGenerationProgressUpdate) {
  return updateDraftGenerationProgress(id, {
    status: "running",
    stage: update.stage,
    label: getWorldGenerationStageLabel(update.stage),
    message: update.message ?? getWorldGenerationStageRunningMessage(update.stage),
    completedAt: null,
    error: null,
  });
}

export function completeDraftGenerationProgress(id: string, message = "Your campaign draft is ready.") {
  return updateDraftGenerationProgress(id, {
    status: "complete",
    stage: "final_world",
    label: "Draft Ready",
    message,
    completedAt: new Date().toISOString(),
    error: null,
  });
}

export function failDraftGenerationProgress(id: string, error: string) {
  return updateDraftGenerationProgress(id, {
    status: "error",
    label: "Generation Failed",
    message: error,
    completedAt: new Date().toISOString(),
    error,
  });
}

export function getDraftGenerationProgress(id: string) {
  cleanupStaleProgressEntries();
  return getProgressStore().get(id) ?? null;
}

export function setDraftGenerationCheckpoint(id: string, checkpoint: OpenWorldGenerationCheckpoint) {
  cleanupStaleProgressEntries();
  getCheckpointStore().set(id, checkpoint);
}

export function getDraftGenerationCheckpoint(id: string) {
  cleanupStaleProgressEntries();
  return getCheckpointStore().get(id) ?? null;
}

export function findRecoverableDraftGenerationCheckpoint(progressId?: string | null) {
  cleanupStaleProgressEntries();

  if (progressId) {
    const checkpoint = getCheckpointStore().get(progressId) ?? null;
    const progress = getProgressStore().get(progressId) ?? null;

    if (
      checkpoint
      && checkpoint.generationStatus === "ready"
      && checkpoint.stageArtifacts.final_world
    ) {
      return { id: progressId, checkpoint, progress };
    }

    return null;
  }

  let latest: {
    id: string;
    checkpoint: OpenWorldGenerationCheckpoint;
    progress: DraftGenerationProgress | null;
    updatedAt: number;
  } | null = null;

  for (const [id, checkpoint] of getCheckpointStore().entries()) {
    if (
      checkpoint.generationStatus !== "ready"
      || !checkpoint.stageArtifacts.final_world
    ) {
      continue;
    }

    const progress = getProgressStore().get(id) ?? null;
    const updatedAt = progress
      ? new Date(progress.updatedAt).getTime()
      : new Date(checkpoint.createdAt).getTime();

    if (!latest || updatedAt > latest.updatedAt) {
      latest = { id, checkpoint, progress, updatedAt };
    }
  }

  if (!latest) {
    return null;
  }

  return {
    id: latest.id,
    checkpoint: latest.checkpoint,
    progress: latest.progress,
  };
}

export function subscribeToDraftGenerationProgress(
  id: string,
  listener: (progress: DraftGenerationProgress) => void,
) {
  cleanupStaleProgressEntries();

  const listeners = getProgressListenerStore();
  const current = listeners.get(id) ?? new Set<(progress: DraftGenerationProgress) => void>();
  current.add(listener);
  listeners.set(id, current);

  const existing = getDraftGenerationProgress(id);
  if (existing) {
    listener(existing);
  }

  return () => {
    const activeListeners = listeners.get(id);
    if (!activeListeners) {
      return;
    }

    activeListeners.delete(listener);
    if (activeListeners.size === 0) {
      listeners.delete(id);
    }
  };
}
