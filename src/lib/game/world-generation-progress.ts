import type { WorldGenerationStageName } from "@/lib/game/types";

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
  world_bible: {
    label: "Shaping the Setting",
    running: "Defining the world, its tone, and the forces that shape everyday life.",
  },
  world_spine: {
    label: "Placing Factions and Landmarks",
    running: "Laying out the major places, routes, and groups that hold the setting together.",
  },
  regional_life: {
    label: "Adding Daily Life",
    running: "Filling each location with routine pressures, hazards, and ordinary texture.",
  },
  social_cast: {
    label: "Introducing Locals",
    running: "Creating the people you are most likely to deal with early on.",
  },
  knowledge_web: {
    label: "Weaving Rumors and Leads",
    running: "Connecting clues, rumors, and practical leads players can act on.",
  },
  knowledge_threads: {
    label: "Linking Hidden Tensions",
    running: "Tying public beliefs, hidden truths, and pressure points back into the playable world.",
  },
  economy_material_life: {
    label: "Setting Trade and Scarcity",
    running: "Working out what people buy, hoard, tax, and struggle to get.",
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

export function createDraftGenerationProgress(id: string) {
  cleanupStaleProgressEntries();

  const now = new Date().toISOString();
  const progress: DraftGenerationProgress = {
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
