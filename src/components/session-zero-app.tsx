"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type {
  AdventureModuleSummary,
  CharacterTemplateSummary,
  OpenWorldGenerationArtifacts,
  GeneratedWorldModule,
  ProgressionFramework,
  ProgressionTrackDefinition,
  WorldScaleTier,
} from "@/lib/game/types";
import {
  WORLD_GENERATION_PROGRESS_STAGES,
  getWorldGenerationStageStep,
  type DraftGenerationProgress,
} from "@/lib/game/world-generation-progress";

const DRAFT_PROGRESS_STORAGE_KEY = "session-zero:draft-progress";

type StoredDraftProgressState = {
  progressId: string;
  prompt: string;
  scaleTier: WorldScaleTier;
};

function fieldClassName(multiline = false) {
  return [
    "w-full rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-sm text-zinc-100 outline-none transition-colors",
    "placeholder:text-zinc-600 focus:border-zinc-700 focus:bg-zinc-950",
    multiline ? "min-h-28 resize-y leading-7" : "",
  ].join(" ");
}

function FieldShell({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-2">
      <span className="ui-label">{label}</span>
      {children}
    </label>
  );
}

function stepSectionClassName(isActive: boolean) {
  return [
    "rounded-xl border p-8 transition-colors",
    isActive
      ? "border-zinc-700 bg-zinc-950/50 shadow-[0_0_30px_rgba(255,255,255,0.02)]"
      : "border-zinc-800 bg-zinc-950/20",
  ].join(" ");
}

function slugifyTrackId(value: string, fallback: string) {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 72);

  return slug || fallback;
}

function uniqueTrackId(base: string, tracks: ProgressionTrackDefinition[], currentIndex?: number) {
  const used = new Set(
    tracks
      .filter((_, index) => index !== currentIndex)
      .map((track) => track.id),
  );
  if (!used.has(base)) {
    return base;
  }

  for (let suffix = 2; suffix < 100; suffix += 1) {
    const candidate = `${base}_${suffix}`;
    if (!used.has(candidate)) {
      return candidate;
    }
  }

  return `${base}_${Date.now()}`;
}

function numberInputValue(value: number | null | undefined) {
  return value == null ? "" : String(value);
}

function parseRequiredNumber(value: string, fallback = 0) {
  if (value.trim() === "") {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseOptionalNumber(value: string) {
  if (value.trim() === "") {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeProgressionFramework(
  framework: ProgressionFramework | null | undefined,
): ProgressionFramework | undefined {
  const tracks = (framework?.tracks ?? [])
    .map((track) => ({
      ...track,
      id: track.id.trim(),
      label: track.label.trim(),
      summary: track.summary.trim(),
      worldStandingScale: (track.worldStandingScale ?? [])
        .map((standing) => ({
          minValue: standing.minValue,
          relativeStanding: standing.relativeStanding.trim(),
          effectiveTierLabel: standing.effectiveTierLabel?.trim() || undefined,
        }))
        .filter((standing) => standing.relativeStanding.length > 0),
    }))
    .filter((track) => track.id.length > 0 && track.label.length > 0 && track.summary.length > 0);

  if (!tracks.length) {
    return undefined;
  }

  const primaryTrackId =
    framework?.primaryTrackId && tracks.some((track) => track.id === framework.primaryTrackId)
      ? framework.primaryTrackId
      : tracks[0]?.id ?? null;

  return {
    tracks,
    primaryTrackId,
  };
}

function normalizeDraftForSave(draft: GeneratedWorldModule): GeneratedWorldModule {
  return {
    ...draft,
    progressionFramework: normalizeProgressionFramework(draft.progressionFramework),
  };
}

export function SessionZeroApp() {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [scaleTier, setScaleTier] = useState<WorldScaleTier>("regional");
  const [modules, setModules] = useState<AdventureModuleSummary[]>([]);
  const [characters, setCharacters] = useState<CharacterTemplateSummary[]>([]);
  const [selectedModuleId, setSelectedModuleId] = useState<string | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [draft, setDraft] = useState<GeneratedWorldModule | null>(null);
  const [draftArtifacts, setDraftArtifacts] = useState<OpenWorldGenerationArtifacts | null>(null);
  const [loading, setLoading] = useState(true);
  const [drafting, setDrafting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftProgressId, setDraftProgressId] = useState<string | null>(null);
  const [draftProgressStreamRevision, setDraftProgressStreamRevision] = useState(0);
  const [draftProgress, setDraftProgress] = useState<DraftGenerationProgress | null>(null);
  const [stoppingDraft, setStoppingDraft] = useState(false);
  const progressStreamRef = useRef<EventSource | null>(null);

  const selectedModule = modules.find((module) => module.id === selectedModuleId) ?? null;
  const compatibleCharacters = selectedModuleId
    ? characters.filter((character) => character.moduleId === selectedModuleId)
    : characters;
  const selectedCharacter =
    compatibleCharacters.find((character) => character.id === selectedTemplateId) ?? null;
  const activeStep = !selectedModuleId ? 1 : !selectedTemplateId ? 2 : 3;
  const totalGenerationStages = WORLD_GENERATION_PROGRESS_STAGES.length;
  const isGenerationActive =
    draftProgress?.status === "queued" || draftProgress?.status === "running";
  const currentGenerationStage =
    draftProgress?.status === "complete"
      ? totalGenerationStages
      : getWorldGenerationStageStep(draftProgress?.stage ?? null);
  const generationProgressPercent =
    totalGenerationStages > 0 ? (currentGenerationStage / totalGenerationStages) * 100 : 0;
  const draftProgressionTracks = draft?.progressionFramework?.tracks ?? [];
  const draftPrimaryTrackId = draft?.progressionFramework?.primaryTrackId ?? draftProgressionTracks[0]?.id ?? null;

  function updateDraftProgression(
    updater: (framework: ProgressionFramework) => ProgressionFramework,
  ) {
    setDraft((current) => {
      if (!current) {
        return current;
      }

      const currentFramework = current.progressionFramework ?? {
        tracks: [],
        primaryTrackId: null,
      };
      const nextFramework = updater(currentFramework);

      return {
        ...current,
        progressionFramework: nextFramework.tracks.length ? nextFramework : undefined,
      };
    });
  }

  function addProgressionTrack() {
    updateDraftProgression((framework) => {
      const label = `Progression Track ${framework.tracks.length + 1}`;
      const id = uniqueTrackId(
        slugifyTrackId(label, `progression_track_${framework.tracks.length + 1}`),
        framework.tracks,
      );
      const track: ProgressionTrackDefinition = {
        id,
        label,
        summary: "What this long-term change means for the character.",
        min: 0,
        max: 100,
        defaultValue: 0,
        worldStandingScale: [],
      };

      return {
        tracks: [...framework.tracks, track],
        primaryTrackId: framework.primaryTrackId ?? id,
      };
    });
  }

  function removeProgressionTrack(trackIndex: number) {
    updateDraftProgression((framework) => {
      const removedTrack = framework.tracks[trackIndex];
      const tracks = framework.tracks.filter((_, index) => index !== trackIndex);
      return {
        tracks,
        primaryTrackId:
          removedTrack?.id === framework.primaryTrackId
            ? tracks[0]?.id ?? null
            : framework.primaryTrackId,
      };
    });
  }

  function updateProgressionTrack(
    trackIndex: number,
    updater: (track: ProgressionTrackDefinition, tracks: ProgressionTrackDefinition[]) => ProgressionTrackDefinition,
  ) {
    updateDraftProgression((framework) => {
      const previousTrack = framework.tracks[trackIndex];
      const tracks = framework.tracks.map((track, index) =>
        index === trackIndex ? updater(track, framework.tracks) : track,
      );
      const nextTrack = tracks[trackIndex];
      return {
        tracks,
        primaryTrackId:
          previousTrack?.id === framework.primaryTrackId
            ? nextTrack?.id ?? tracks[0]?.id ?? null
            : framework.primaryTrackId,
      };
    });
  }

  function updateProgressionTrackLabel(trackIndex: number, label: string) {
    updateProgressionTrack(trackIndex, (track, tracks) => {
      const baseId = slugifyTrackId(label, track.id || `progression_track_${trackIndex + 1}`);
      return {
        ...track,
        id: uniqueTrackId(baseId, tracks, trackIndex),
        label,
      };
    });
  }

  function addStandingBand(trackIndex: number) {
    updateProgressionTrack(trackIndex, (track) => ({
      ...track,
      worldStandingScale: [
        ...(track.worldStandingScale ?? []),
        {
          minValue: track.defaultValue,
          effectiveTierLabel: null,
          relativeStanding: "Describe how the world would read this level of progress.",
        },
      ],
    }));
  }

  function updateStandingBand(
    trackIndex: number,
    bandIndex: number,
    updater: (band: NonNullable<ProgressionTrackDefinition["worldStandingScale"]>[number]) => NonNullable<ProgressionTrackDefinition["worldStandingScale"]>[number],
  ) {
    updateProgressionTrack(trackIndex, (track) => ({
      ...track,
      worldStandingScale: (track.worldStandingScale ?? []).map((band, index) =>
        index === bandIndex ? updater(band) : band,
      ),
    }));
  }

  function removeStandingBand(trackIndex: number, bandIndex: number) {
    updateProgressionTrack(trackIndex, (track) => ({
      ...track,
      worldStandingScale: (track.worldStandingScale ?? []).filter((_, index) => index !== bandIndex),
    }));
  }

  async function recoverDraftFromCheckpoint(progressId: string) {
    const response = await fetch(
      `/api/campaigns/draft/recover?progressId=${encodeURIComponent(progressId)}`,
    );

    const data = (await response.json()) as {
      progressId?: string;
      draft?: GeneratedWorldModule;
      artifacts?: OpenWorldGenerationArtifacts;
      error?: string;
    };

    if (!response.ok || !data.draft) {
      throw new Error(data.error ?? "Failed to recover completed draft.");
    }

    return data;
  }

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const raw = window.sessionStorage.getItem(DRAFT_PROGRESS_STORAGE_KEY);
    if (!raw) {
      return;
    }

    try {
      const stored = JSON.parse(raw) as Partial<StoredDraftProgressState>;
      if (typeof stored.progressId === "string" && stored.progressId.length > 0) {
        setDraftProgressId(stored.progressId);
      }
      if (typeof stored.prompt === "string") {
        setPrompt(stored.prompt);
      }
      if (
        stored.scaleTier === "settlement"
        || stored.scaleTier === "regional"
        || stored.scaleTier === "world"
      ) {
        setScaleTier(stored.scaleTier);
      }
    } catch {
      window.sessionStorage.removeItem(DRAFT_PROGRESS_STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (!draftProgressId) {
      window.sessionStorage.removeItem(DRAFT_PROGRESS_STORAGE_KEY);
      return;
    }

    const payload: StoredDraftProgressState = {
      progressId: draftProgressId,
      prompt,
      scaleTier,
    };
    window.sessionStorage.setItem(DRAFT_PROGRESS_STORAGE_KEY, JSON.stringify(payload));
  }, [draftProgressId, prompt, scaleTier]);

  useEffect(() => {
    let active = true;

    async function loadLibrary() {
      setLoading(true);

      try {
        const [modulesResponse, charactersResponse] = await Promise.all([
          fetch("/api/modules"),
          fetch("/api/characters"),
        ]);

        const modulesData = (await modulesResponse.json()) as {
          modules?: AdventureModuleSummary[];
          error?: string;
        };
        const charactersData = (await charactersResponse.json()) as {
          characters?: CharacterTemplateSummary[];
          error?: string;
        };

        if (!modulesResponse.ok) {
          throw new Error(modulesData.error ?? "Failed to load modules.");
        }

        if (!charactersResponse.ok) {
          throw new Error(charactersData.error ?? "Failed to load characters.");
        }

        if (!active) {
          return;
        }

        setModules(modulesData.modules ?? []);
        setCharacters(charactersData.characters ?? []);
        setSelectedModuleId(modulesData.modules?.[0]?.id ?? null);
        setSelectedTemplateId(charactersData.characters?.[0]?.id ?? null);
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load launcher data.");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void loadLibrary();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (
      draftProgress?.status === "complete"
      || draftProgress?.status === "error"
      || draftProgress?.status === "stopped"
    ) {
      setStoppingDraft(false);
    }
  }, [draftProgress?.status]);

  useEffect(() => {
    if (!draftProgressId) {
      return;
    }

    const progressId = draftProgressId;
    const stream = new EventSource(
      `/api/campaigns/draft/progress?progressId=${encodeURIComponent(progressId)}`,
    );
    progressStreamRef.current = stream;

    stream.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as
          | { type: "connected"; progressId: string }
          | { type: "progress"; progress: DraftGenerationProgress };

        if (payload.type === "progress") {
          setDraftProgress(payload.progress);

          if (
            payload.progress.status === "complete"
            || payload.progress.status === "error"
            || payload.progress.status === "stopped"
          ) {
            stream.close();
            if (progressStreamRef.current === stream) {
              progressStreamRef.current = null;
            }
          }
        }
      } catch {
        // Ignore malformed stream payloads.
      }
    };

    stream.onerror = () => {
      stream.close();
      if (progressStreamRef.current === stream) {
        progressStreamRef.current = null;
      }
    };

    return () => {
      stream.close();
      if (progressStreamRef.current === stream) {
        progressStreamRef.current = null;
      }
    };
  }, [draftProgressId, draftProgressStreamRevision]);

  useEffect(() => {
    if (
      !draftProgressId
      || draft
      || (
        draftProgress?.status !== "complete"
        && draftProgress?.status !== "error"
        && draftProgress?.status !== "stopped"
      )
    ) {
      return;
    }

    let cancelled = false;
    const progressId = draftProgressId;

    async function recoverCompletedDraft() {
      try {
        const data = await recoverDraftFromCheckpoint(progressId);

        if (cancelled) {
          return;
        }

        setDraft(data.draft ?? null);
        setDraftArtifacts(data.artifacts ?? null);
        setError(null);
        setDraftProgress((current) =>
          current
            ? {
                ...current,
                status: "complete",
                stage: "final_world",
                label: "Draft Ready",
                message: "Your campaign draft is ready to review.",
                updatedAt: new Date().toISOString(),
                completedAt: current.completedAt ?? new Date().toISOString(),
                error: null,
                stopRequested: false,
              }
            : current,
        );
      } catch (recoveryError) {
        if (cancelled) {
          return;
        }

        setError(
          recoveryError instanceof Error
            ? recoveryError.message
            : "Failed to recover completed draft.",
        );
      }
    }

    void recoverCompletedDraft();

    return () => {
      cancelled = true;
    };
  }, [draftProgressId, draftProgress?.status, draft]);

  useEffect(() => {
    if (!selectedModuleId) {
      return;
    }

    if (selectedTemplateId && compatibleCharacters.some((character) => character.id === selectedTemplateId)) {
      return;
    }

    setSelectedTemplateId(compatibleCharacters[0]?.id ?? null);
  }, [compatibleCharacters, selectedModuleId, selectedTemplateId]);

  async function generateDraft() {
    if (!prompt.trim() || drafting || isGenerationActive) {
      return;
    }

    const progressId =
      (draftProgress?.status === "error" || draftProgress?.status === "stopped") && draftProgressId
        ? draftProgressId
        : crypto.randomUUID();
    setDrafting(true);
    setStoppingDraft(false);
    setError(null);
    setDraftProgressId(progressId);
    setDraftProgressStreamRevision((current) => current + 1);
    setDraftProgress({
      id: progressId,
      status: "queued",
      stage: null,
      label: "Starting Your Draft",
      message: "Getting the world generation process ready.",
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: null,
      error: null,
      stopRequested: false,
    });

    try {
      const response = await fetch("/api/campaigns/draft", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt,
          scaleTier,
          previousDraft: draft ? normalizeDraftForSave(draft) : undefined,
          progressId,
        }),
      });

      const data = (await response.json()) as {
        draft?: GeneratedWorldModule;
        artifacts?: OpenWorldGenerationArtifacts;
        stopped?: boolean;
        error?: string;
      };

      if (data.stopped) {
        setError(null);
        setDraftProgress((current) =>
          current
            ? {
                ...current,
                status: "stopped",
                label: "Generation Stopped",
                message: "Generation stopped. You can resume from the latest checkpoint whenever you want.",
                updatedAt: new Date().toISOString(),
                completedAt: new Date().toISOString(),
                error: null,
                stopRequested: false,
              }
            : current,
        );
        return;
      }

      if (!response.ok || !data.draft) {
        throw new Error(data.error ?? "Failed to generate module draft.");
      }

      setDraft(data.draft);
      setDraftArtifacts(data.artifacts ?? null);
      setDraftProgress((current) =>
        current
          ? {
              ...current,
              status: "complete",
              label: "Draft Ready",
              message: "Your campaign draft is ready to review.",
              updatedAt: new Date().toISOString(),
              completedAt: new Date().toISOString(),
              error: null,
            }
          : current,
      );
    } catch (draftError) {
      const message = draftError instanceof Error ? draftError.message : "Failed to generate module draft.";

      if (progressId) {
        try {
          const recovered = await recoverDraftFromCheckpoint(progressId);
          setDraft(recovered.draft ?? null);
          setDraftArtifacts(recovered.artifacts ?? null);
          setError(null);
          setDraftProgress((current) =>
            current
              ? {
                  ...current,
                  status: "complete",
                  stage: "final_world",
                  label: "Draft Ready",
                  message: "Your campaign draft is ready to review.",
                  updatedAt: new Date().toISOString(),
                  completedAt: new Date().toISOString(),
                  error: null,
                  stopRequested: false,
                }
              : current,
          );
          return;
        } catch {
          // Fall through to surface the original generation error when no ready checkpoint exists.
        }
      }

      setError(message);
      setDraftProgress((current) =>
        current
          ? {
              ...current,
              status: "error",
              label: "Generation Failed",
              message,
              updatedAt: new Date().toISOString(),
              completedAt: new Date().toISOString(),
              error: message,
            }
          : current,
      );
    } finally {
      setDrafting(false);
    }
  }

  async function stopDraftGeneration() {
    if (!draftProgressId || !isGenerationActive || stoppingDraft) {
      return;
    }

    setStoppingDraft(true);
    setError(null);
    setDraftProgress((current) =>
      current
        ? {
            ...current,
            label: "Stopping Generation",
            message: "Stopping after the current model response finishes.",
            stopRequested: true,
            updatedAt: new Date().toISOString(),
          }
        : current,
    );

    try {
      const response = await fetch("/api/campaigns/draft/stop", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          progressId: draftProgressId,
        }),
      });

      const data = (await response.json()) as {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(data.error ?? "Failed to stop draft generation.");
      }
    } catch (stopError) {
      setStoppingDraft(false);
      setError(stopError instanceof Error ? stopError.message : "Failed to stop draft generation.");
      setDraftProgress((current) =>
        current
          ? {
              ...current,
              stopRequested: false,
            }
          : current,
      );
    }
  }

  async function saveDraft() {
    if (!draft || saving) {
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const response = await fetch("/api/modules/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ draft: normalizeDraftForSave(draft), artifacts: draftArtifacts ?? undefined }),
      });

      const data = (await response.json()) as {
        moduleId?: string;
        module?: AdventureModuleSummary;
        error?: string;
        details?: {
          formErrors?: string[];
          fieldErrors?: Record<string, string[] | undefined>;
        };
      };

      if (!response.ok || !data.moduleId || !data.module) {
        const detailedError =
          data.details?.formErrors?.[0]
          ?? Object.values(data.details?.fieldErrors ?? {})
            .flat()
            .find((message): message is string => typeof message === "string" && message.length > 0);
        throw new Error(detailedError ?? data.error ?? "Failed to save module.");
      }

      setModules((current) => [data.module!, ...current.filter((entry) => entry.id !== data.moduleId)]);
      setSelectedModuleId(data.moduleId);
      setDraft(null);
      setDraftArtifacts(null);
      setDraftProgress(null);
      setDraftProgressId(null);
      if (typeof window !== "undefined") {
        window.sessionStorage.removeItem(DRAFT_PROGRESS_STORAGE_KEY);
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save module.");
    } finally {
      setSaving(false);
    }
  }

  function continueToCampaignCreation() {
    if (!selectedModuleId || !selectedTemplateId) {
      setError("Choose a module and character before continuing.");
      return;
    }

    router.push(`/campaigns/create?moduleId=${selectedModuleId}&templateId=${selectedTemplateId}`);
  }

  return (
    <main className="bg-black px-4 py-12 text-zinc-100">
      <div className="mx-auto max-w-4xl">
        <header className="mb-8">
          <p className="text-[10px] font-medium uppercase tracking-widest text-zinc-500">
            Session Zero
          </p>
          <div className="mt-4 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <h1 className="text-4xl font-medium tracking-tight text-zinc-100">
                Build an open-world campaign launch.
              </h1>
              <p className="mt-3 text-sm leading-relaxed text-zinc-400">
                Generate or choose a module, pick a protagonist, then move into the launch flow.
              </p>
            </div>
            <button
              type="button"
              className="button-press rounded-full border border-zinc-800 px-5 py-3 text-sm font-semibold text-zinc-300 transition-colors hover:bg-zinc-900 hover:text-white"
              onClick={() => router.push("/")}
            >
              Back Home
            </button>
          </div>
        </header>

        {error ? <p className="mb-6 text-sm text-red-400">{error}</p> : null}

        <section
          className={`mb-6 ${stepSectionClassName(activeStep === 1)}`}
        >
          <p className="text-[10px] font-medium uppercase tracking-widest text-zinc-500">
            Step 1
          </p>
          <h2 className="mt-3 text-2xl font-medium tracking-tight text-zinc-100">
            Generate or choose a module
          </h2>

          <div className="mt-6">
            <FieldShell label="Module Prompt">
              <textarea
                className={fieldClassName(true)}
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="A storm-battered trade city where three factions are quietly preparing for open conflict..."
              />
            </FieldShell>
            <div className="mt-4 max-w-sm">
              <FieldShell label="World Scale">
                <select
                  className={fieldClassName()}
                  value={scaleTier}
                  onChange={(event) => setScaleTier(event.target.value as WorldScaleTier)}
                >
                  <option value="settlement">Settlement</option>
                  <option value="regional">Regional</option>
                  <option value="world">World</option>
                </select>
              </FieldShell>
            </div>
            {draftProgress ? (
              <div className="mt-4 rounded-2xl border border-zinc-800 bg-zinc-950/80 px-4 py-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-[0.2em] text-zinc-500">
                      {draftProgress.status === "complete"
                        ? "Ready"
                        : draftProgress.status === "stopped"
                          ? "Stopped"
                        : draftProgress.status === "error"
                          ? "Issue"
                          : "In Progress"}
                    </p>
                    <p className="mt-2 text-sm font-semibold text-zinc-100">{draftProgress.label}</p>
                  </div>
                  <div
                    className={[
                      "h-2.5 w-2.5 rounded-full",
                      draftProgress.status === "error"
                        ? "bg-red-400"
                        : draftProgress.status === "stopped"
                          ? "bg-zinc-500"
                        : draftProgress.status === "complete"
                          ? "bg-emerald-400"
                          : "bg-amber-300",
                    ].join(" ")}
                  />
                </div>
                <div className="mt-3 flex items-center justify-between gap-4 text-xs text-zinc-500">
                  <span>
                    Stage {currentGenerationStage} of {totalGenerationStages}
                  </span>
                  <span>{Math.round(generationProgressPercent)}%</span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-zinc-900">
                  <div
                    className={[
                      "h-full rounded-full transition-[width] duration-500",
                      draftProgress.status === "error"
                        ? "bg-red-400"
                        : draftProgress.status === "stopped"
                          ? "bg-zinc-500"
                        : draftProgress.status === "complete"
                          ? "bg-emerald-400"
                          : "bg-zinc-200",
                    ].join(" ")}
                    style={{ width: `${generationProgressPercent}%` }}
                  />
                </div>
                <p className="mt-3 text-sm leading-relaxed text-zinc-400">{draftProgress.message}</p>
              </div>
            ) : null}
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                className="button-press rounded-full bg-white px-5 py-3 text-sm font-semibold text-black transition-colors hover:bg-zinc-200 disabled:opacity-60"
                onClick={() => void generateDraft()}
                disabled={drafting || isGenerationActive}
              >
                {drafting || isGenerationActive
                  ? "Generating..."
                  : draftProgress?.status === "error" || draftProgress?.status === "stopped"
                    ? "Resume Draft"
                    : draft
                      ? "Regenerate Draft"
                      : "Generate Draft"}
              </button>
              {draftProgressId && isGenerationActive ? (
                <button
                  type="button"
                  className="button-press rounded-full border border-zinc-800 px-5 py-3 text-sm font-semibold text-zinc-300 transition-colors hover:bg-zinc-900 hover:text-white disabled:opacity-60"
                  onClick={() => void stopDraftGeneration()}
                  disabled={stoppingDraft || Boolean(draftProgress?.stopRequested)}
                >
                  {stoppingDraft || draftProgress?.stopRequested ? "Stopping..." : "Stop Generating"}
                </button>
              ) : null}
              {draft ? (
                <button
                  type="button"
                  className="button-press rounded-full border border-zinc-800 px-5 py-3 text-sm font-semibold text-zinc-300 transition-colors hover:bg-zinc-900 hover:text-white disabled:opacity-60"
                  onClick={() => void saveDraft()}
                  disabled={saving}
                >
                  {saving ? "Saving..." : "Save Module"}
                </button>
              ) : null}
            </div>
          </div>

          {draft ? (
            <div className="mt-8 rounded-xl border border-zinc-800 bg-zinc-950 p-6">
              <p className="text-[10px] font-medium uppercase tracking-widest text-zinc-500">
                Generated Draft
              </p>
              <h3 className="mt-3 text-xl font-medium tracking-tight text-zinc-100">
                {draft.title}
              </h3>
              <p className="mt-3 text-sm leading-relaxed text-zinc-400">{draft.premise}</p>
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <div className="rounded-lg border border-zinc-800 p-4">
                  <p className="text-[10px] font-medium uppercase tracking-widest text-zinc-500">
                    Locations
                  </p>
                  <p className="mt-2 text-lg font-medium tracking-tight text-zinc-100">
                    {draft.locations.length}
                  </p>
                </div>
                <div className="rounded-lg border border-zinc-800 p-4">
                  <p className="text-[10px] font-medium uppercase tracking-widest text-zinc-500">
                    Entry Points
                  </p>
                  <p className="mt-2 text-lg font-medium tracking-tight text-zinc-100">
                    {draft.entryPoints.length}
                  </p>
                </div>
              </div>

              <div className="mt-6 rounded-lg border border-zinc-800 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-[10px] font-medium uppercase tracking-widest text-zinc-500">
                      Progression
                    </p>
                    <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                      Add long-term tracks when the campaign fantasy should change the character over time.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="button-press rounded-lg border border-zinc-700 px-3 py-2 text-xs font-semibold text-zinc-200 transition-colors hover:bg-zinc-900 disabled:opacity-60"
                    onClick={addProgressionTrack}
                    disabled={draftProgressionTracks.length >= 8}
                  >
                    Add Track
                  </button>
                </div>

                {draftProgressionTracks.length ? (
                  <div className="mt-5 space-y-4">
                    {draftProgressionTracks.map((track, trackIndex) => (
                      <div key={track.id} className="rounded-lg border border-zinc-800 bg-black/50 p-4">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="grid flex-1 gap-3 sm:grid-cols-[0.8fr_1.2fr]">
                            <FieldShell label="Track Name">
                              <input
                                className={fieldClassName()}
                                value={track.label}
                                onChange={(event) => updateProgressionTrackLabel(trackIndex, event.target.value)}
                                placeholder="Abyssal Assimilation"
                              />
                            </FieldShell>
                            <FieldShell label="Summary">
                              <input
                                className={fieldClassName()}
                                value={track.summary}
                                onChange={(event) =>
                                  updateProgressionTrack(trackIndex, (current) => ({
                                    ...current,
                                    summary: event.target.value,
                                  }))
                                }
                                placeholder="What this long-term change means in play."
                              />
                            </FieldShell>
                          </div>
                          <button
                            type="button"
                            className="button-press rounded-lg border border-zinc-800 px-3 py-2 text-xs font-semibold text-zinc-400 transition-colors hover:border-red-900 hover:text-red-300"
                            onClick={() => removeProgressionTrack(trackIndex)}
                          >
                            Remove
                          </button>
                        </div>

                        <div className="mt-3 grid gap-3 sm:grid-cols-4">
                          <FieldShell label="Min">
                            <input
                              className={fieldClassName()}
                              type="number"
                              value={numberInputValue(track.min)}
                              onChange={(event) =>
                                updateProgressionTrack(trackIndex, (current) => ({
                                  ...current,
                                  min: parseOptionalNumber(event.target.value),
                                }))
                              }
                            />
                          </FieldShell>
                          <FieldShell label="Max">
                            <input
                              className={fieldClassName()}
                              type="number"
                              value={numberInputValue(track.max)}
                              onChange={(event) =>
                                updateProgressionTrack(trackIndex, (current) => ({
                                  ...current,
                                  max: parseOptionalNumber(event.target.value),
                                }))
                              }
                            />
                          </FieldShell>
                          <FieldShell label="Default">
                            <input
                              className={fieldClassName()}
                              type="number"
                              value={numberInputValue(track.defaultValue)}
                              onChange={(event) =>
                                updateProgressionTrack(trackIndex, (current) => ({
                                  ...current,
                                  defaultValue: parseRequiredNumber(event.target.value, current.defaultValue),
                                }))
                              }
                            />
                          </FieldShell>
                          <label className="flex items-end gap-2 pb-3 text-sm text-zinc-300">
                            <input
                              type="radio"
                              checked={draftPrimaryTrackId === track.id}
                              onChange={() =>
                                updateDraftProgression((framework) => ({
                                  ...framework,
                                  primaryTrackId: track.id,
                                }))
                              }
                            />
                            Primary track
                          </label>
                        </div>

                        <div className="mt-4 border-t border-zinc-800 pt-4">
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-xs font-medium text-zinc-300">World standing bands</p>
                            <button
                              type="button"
                              className="button-press rounded-lg border border-zinc-800 px-3 py-2 text-xs font-semibold text-zinc-300 transition-colors hover:bg-zinc-900"
                              onClick={() => addStandingBand(trackIndex)}
                            >
                              Add Band
                            </button>
                          </div>

                          {(track.worldStandingScale ?? []).length ? (
                            <div className="mt-3 space-y-3">
                              {(track.worldStandingScale ?? []).map((band, bandIndex) => (
                                <div key={`${track.id}-${bandIndex}`} className="grid gap-3 rounded-lg border border-zinc-800 p-3 md:grid-cols-[7rem_10rem_1fr_auto]">
                                  <FieldShell label="At Value">
                                    <input
                                      className={fieldClassName()}
                                      type="number"
                                      value={numberInputValue(band.minValue)}
                                      onChange={(event) =>
                                        updateStandingBand(trackIndex, bandIndex, (current) => ({
                                          ...current,
                                          minValue: parseRequiredNumber(event.target.value, current.minValue),
                                        }))
                                      }
                                    />
                                  </FieldShell>
                                  <FieldShell label="Tier Label">
                                    <input
                                      className={fieldClassName()}
                                      value={band.effectiveTierLabel ?? ""}
                                      onChange={(event) =>
                                        updateStandingBand(trackIndex, bandIndex, (current) => ({
                                          ...current,
                                          effectiveTierLabel: event.target.value || null,
                                        }))
                                      }
                                      placeholder="Early Kindled"
                                    />
                                  </FieldShell>
                                  <FieldShell label="Relative Standing">
                                    <input
                                      className={fieldClassName()}
                                      value={band.relativeStanding}
                                      onChange={(event) =>
                                        updateStandingBand(trackIndex, bandIndex, (current) => ({
                                          ...current,
                                          relativeStanding: event.target.value,
                                        }))
                                      }
                                      placeholder="Above ordinary laborers, nearing trained delvers."
                                    />
                                  </FieldShell>
                                  <button
                                    type="button"
                                    className="button-press self-end rounded-lg border border-zinc-800 px-3 py-3 text-xs font-semibold text-zinc-400 transition-colors hover:border-red-900 hover:text-red-300"
                                    onClick={() => removeStandingBand(trackIndex, bandIndex)}
                                  >
                                    Remove
                                  </button>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="mt-3 text-sm leading-relaxed text-zinc-500">
                              Optional. Add bands if the world has a recognizable scale for this track.
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-4 text-sm leading-relaxed text-zinc-500">
                    No progression tracks yet. Leave this empty for grounded low-change campaigns, or add one to track corruption, favor, hunger, influence, mastery, debt, or another campaign-specific arc.
                  </p>
                )}
              </div>
            </div>
          ) : null}

          <div className="mt-8">
            <p className="text-[10px] font-medium uppercase tracking-widest text-zinc-500">
              Saved Modules
            </p>
            {loading ? (
              <p className="mt-4 text-sm leading-relaxed text-zinc-400">Loading modules...</p>
            ) : modules.length ? (
              <div className="mt-4 space-y-3">
                {modules.map((module) => (
                  <button
                    key={module.id}
                    type="button"
                    onClick={() => setSelectedModuleId(module.id)}
                    className={[
                      "flex w-full cursor-pointer items-center justify-between rounded-lg border p-4 text-left transition-colors",
                      selectedModuleId === module.id
                        ? "border-zinc-400 bg-zinc-900"
                        : "border-zinc-800 bg-transparent hover:border-zinc-700",
                    ].join(" ")}
                  >
                    <div>
                      <h3 className="text-base font-medium tracking-tight text-zinc-100">
                        {module.title}
                      </h3>
                      <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                        {module.premise}
                      </p>
                    </div>
                    <span className="ml-4 text-[10px] font-medium uppercase tracking-widest text-zinc-500">
                      {module.progressionFramework?.tracks.length
                        ? `${module.progressionFramework.tracks.length} Tracks`
                        : `${module.entryPointCount} Entry Points`}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="mt-4 text-sm italic leading-relaxed text-zinc-600">
                No saved modules yet.
              </p>
            )}
          </div>
        </section>

        <section
          className={`mb-6 ${stepSectionClassName(activeStep === 2)}`}
        >
          <p className="text-[10px] font-medium uppercase tracking-widest text-zinc-500">
            Step 2
          </p>
          <h2 className="mt-3 text-2xl font-medium tracking-tight text-zinc-100">
            Choose a protagonist
          </h2>

          {loading ? (
            <p className="mt-4 text-sm leading-relaxed text-zinc-400">Loading characters...</p>
          ) : compatibleCharacters.length ? (
            <div className="mt-6 space-y-3">
              {compatibleCharacters.map((character) => (
                <button
                  key={character.id}
                  type="button"
                  onClick={() => setSelectedTemplateId(character.id)}
                  className={[
                    "flex w-full cursor-pointer items-center justify-between rounded-lg border p-4 text-left transition-colors",
                    selectedTemplateId === character.id
                      ? "border-zinc-400 bg-zinc-900"
                      : "border-zinc-800 bg-transparent hover:border-zinc-700",
                  ].join(" ")}
                >
                  <div>
                    <h3 className="text-base font-medium tracking-tight text-zinc-100">
                      {character.name}
                    </h3>
                    <p className="mt-1 text-[10px] font-medium uppercase tracking-widest text-zinc-500">
                      {character.drivingGoal ?? "Playable template"}
                    </p>
                  </div>
                  <span className="text-[10px] font-medium uppercase tracking-widest text-zinc-500">
                    VIT {character.vitality ?? character.maxHealth}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="mt-4 text-sm italic leading-relaxed text-zinc-600">
              Create or adapt a module-bound character template for this module first.
            </p>
          )}
        </section>

        <section
          className={stepSectionClassName(activeStep === 3)}
        >
          <p className="text-[10px] font-medium uppercase tracking-widest text-zinc-500">
            Step 3
          </p>
          <h2 className="mt-3 text-2xl font-medium tracking-tight text-zinc-100">
            Review and launch
          </h2>

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg border border-zinc-800 p-4">
              <p className="text-[10px] font-medium uppercase tracking-widest text-zinc-500">
                Module
              </p>
              <p className="mt-2 text-base font-medium tracking-tight text-zinc-100">
                {selectedModule?.title ?? "No module selected"}
              </p>
            </div>
            <div className="rounded-lg border border-zinc-800 p-4">
              <p className="text-[10px] font-medium uppercase tracking-widest text-zinc-500">
                Character
              </p>
              <p className="mt-2 text-base font-medium tracking-tight text-zinc-100">
                {selectedCharacter?.name ?? "No character selected"}
              </p>
            </div>
          </div>

          <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              className="button-press rounded-full border border-zinc-800 px-5 py-3 text-sm font-semibold text-zinc-300 transition-colors hover:bg-zinc-900 hover:text-white"
              onClick={() => {
                if (selectedTemplateId) {
                  setSelectedTemplateId(null);
                  return;
                }

                if (selectedModuleId) {
                  setSelectedModuleId(null);
                }
              }}
            >
              Back
            </button>

            <button
              type="button"
              className="button-press rounded-full bg-white px-5 py-3 text-sm font-semibold text-black transition-colors hover:bg-zinc-200 disabled:opacity-60"
              disabled={!selectedModule || !selectedTemplateId}
              onClick={continueToCampaignCreation}
            >
              Launch Campaign
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}
