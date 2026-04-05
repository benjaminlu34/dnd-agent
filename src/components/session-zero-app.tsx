"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type {
  AdventureModuleSummary,
  CharacterTemplateSummary,
  OpenWorldGenerationArtifacts,
  GeneratedWorldModule,
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
  const progressStreamRef = useRef<EventSource | null>(null);

  const selectedModule = modules.find((module) => module.id === selectedModuleId) ?? null;
  const selectedCharacter =
    characters.find((character) => character.id === selectedTemplateId) ?? null;
  const activeStep = !selectedModuleId ? 1 : !selectedTemplateId ? 2 : 3;
  const totalGenerationStages = WORLD_GENERATION_PROGRESS_STAGES.length;
  const currentGenerationStage =
    draftProgress?.status === "complete"
      ? totalGenerationStages
      : getWorldGenerationStageStep(draftProgress?.stage ?? null);
  const generationProgressPercent =
    totalGenerationStages > 0 ? (currentGenerationStage / totalGenerationStages) * 100 : 0;

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

          if (payload.progress.status === "complete" || payload.progress.status === "error") {
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
    if (!draftProgressId || draft || draftProgress?.status !== "complete") {
      return;
    }

    let cancelled = false;
    const progressId = draftProgressId;

    async function recoverCompletedDraft() {
      try {
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

        if (cancelled) {
          return;
        }

        setDraft(data.draft);
        setDraftArtifacts(data.artifacts ?? null);
        setError(null);
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

  async function generateDraft() {
    if (!prompt.trim() || drafting) {
      return;
    }

    const progressId =
      draftProgress?.status === "error" && draftProgressId
        ? draftProgressId
        : crypto.randomUUID();
    setDrafting(true);
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
          previousDraft: draft ?? undefined,
          progressId,
        }),
      });

      const data = (await response.json()) as {
        draft?: GeneratedWorldModule;
        artifacts?: OpenWorldGenerationArtifacts;
        error?: string;
      };

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
      setError(draftError instanceof Error ? draftError.message : "Failed to generate module draft.");
      setDraftProgress((current) =>
        current
          ? {
              ...current,
              status: "error",
              label: "Generation Failed",
              message:
                draftError instanceof Error ? draftError.message : "Failed to generate module draft.",
              updatedAt: new Date().toISOString(),
              completedAt: new Date().toISOString(),
              error:
                draftError instanceof Error ? draftError.message : "Failed to generate module draft.",
            }
          : current,
      );
    } finally {
      setDrafting(false);
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
        body: JSON.stringify({ draft, artifacts: draftArtifacts ?? undefined }),
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
                disabled={drafting}
              >
                {drafting
                  ? "Generating..."
                  : draftProgress?.status === "error"
                    ? "Retry Draft"
                    : draft
                      ? "Regenerate Draft"
                      : "Generate Draft"}
              </button>
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
                      {module.entryPointCount} Entry Points
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
          ) : characters.length ? (
            <div className="mt-6 space-y-3">
              {characters.map((character) => (
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
                      {character.archetype}
                    </p>
                  </div>
                  <span className="text-[10px] font-medium uppercase tracking-widest text-zinc-500">
                    Max HP {character.maxHealth}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="mt-4 text-sm italic leading-relaxed text-zinc-600">
              Create a character template first.
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
