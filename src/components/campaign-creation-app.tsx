"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type {
  AdventureModuleDetail,
  CharacterTemplate,
  GeneratedCampaignOpening,
  PreparedCampaignLaunch,
  ResolvedLaunchEntry,
} from "@/lib/game/types";
import { backOrPush } from "@/lib/ui/navigation";

function fieldClassName(multiline = false) {
  return [
    "w-full rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-sm text-zinc-100 outline-none transition-colors",
    "placeholder:text-zinc-600 focus:border-zinc-700 focus:bg-zinc-950",
    multiline ? "min-h-24 resize-y leading-7" : "",
  ].join(" ");
}

type LaunchMode = "stock" | "custom";

export function CampaignCreationApp({
  moduleId,
  templateId,
}: {
  moduleId: string | null;
  templateId: string | null;
}) {
  const router = useRouter();
  const [module, setModule] = useState<AdventureModuleDetail | null>(null);
  const [character, setCharacter] = useState<CharacterTemplate | null>(null);
  const [launchMode, setLaunchMode] = useState<LaunchMode>("stock");
  const [selectedEntryPointId, setSelectedEntryPointId] = useState<string | null>(null);
  const [customEntryPrompt, setCustomEntryPrompt] = useState("");
  const [customEntryPoint, setCustomEntryPoint] = useState<ResolvedLaunchEntry | null>(null);
  const [draft, setDraft] = useState<GeneratedCampaignOpening | null>(null);
  const [preparedLaunch, setPreparedLaunch] = useState<PreparedCampaignLaunch | null>(null);
  const [loadingContext, setLoadingContext] = useState(true);
  const [resolvingCustomEntry, setResolvingCustomEntry] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [followUpPrompt, setFollowUpPrompt] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function loadContext() {
      if (!moduleId || !templateId) {
        setLoadingContext(false);
        setError("Choose a module and character before creating a campaign.");
        return;
      }

      setLoadingContext(true);
      setError(null);

      try {
        const [moduleResponse, characterResponse] = await Promise.all([
          fetch(`/api/modules/${moduleId}`),
          fetch(`/api/characters/${templateId}`),
        ]);
        const moduleData = (await moduleResponse.json()) as {
          module?: AdventureModuleDetail;
          error?: string;
        };
        const characterData = (await characterResponse.json()) as {
          character?: CharacterTemplate;
          error?: string;
        };

        if (!moduleResponse.ok) {
          throw new Error(moduleData.error ?? "Failed to load module.");
        }

        if (!characterResponse.ok) {
          throw new Error(characterData.error ?? "Failed to load character.");
        }

        if (!active) {
          return;
        }

        setModule(moduleData.module ?? null);
        setCharacter(characterData.character ?? null);
        setSelectedEntryPointId(moduleData.module?.entryPoints[0]?.id ?? null);
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load launch context.");
        }
      } finally {
        if (active) {
          setLoadingContext(false);
        }
      }
    }

    void loadContext();

    return () => {
      active = false;
    };
  }, [moduleId, templateId]);

  function normalizeOpeningDraft(input: GeneratedCampaignOpening) {
    return {
      ...input,
      narration: input.narration.trim(),
      activeThreat: input.activeThreat.trim(),
      scene: {
        ...input.scene,
        title: input.scene.title.trim(),
        summary: input.scene.summary.trim(),
        location: input.scene.location.trim(),
        atmosphere: input.scene.atmosphere.trim(),
        suggestedActions: input.scene.suggestedActions.map((action) => action.trim()).filter(Boolean).slice(0, 4),
      },
    };
  }

  const hasActiveLaunchSelection =
    launchMode === "custom" ? Boolean(customEntryPoint) : Boolean(selectedEntryPointId);

  const generateDraft = useCallback(
    async (prompt?: string, previousDraft?: GeneratedCampaignOpening) => {
      if (!moduleId || !templateId) {
        return;
      }

      const launchSelection =
        launchMode === "custom"
          ? customEntryPoint
            ? { customEntryPoint }
            : null
          : selectedEntryPointId
            ? { entryPointId: selectedEntryPointId }
            : null;

      if (!launchSelection) {
        return;
      }

      setGenerating(true);
      setError(null);

      try {
        const response = await fetch("/api/campaigns/opening-draft", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            moduleId,
            templateId,
            ...launchSelection,
            prompt: prompt?.trim() || undefined,
            previousDraft: previousDraft ? normalizeOpeningDraft(previousDraft) : undefined,
          }),
        });
        const data = (await response.json()) as {
          draft?: GeneratedCampaignOpening;
          preparedLaunch?: PreparedCampaignLaunch;
          error?: string;
        };

        if (!response.ok || !data.draft || !data.preparedLaunch) {
          throw new Error(data.error ?? "Failed to generate opening draft.");
        }

        setDraft(data.draft);
        setPreparedLaunch(data.preparedLaunch);
        setFollowUpPrompt("");
      } catch (draftError) {
        setError(draftError instanceof Error ? draftError.message : "Failed to generate opening.");
      } finally {
        setGenerating(false);
      }
    },
    [customEntryPoint, launchMode, moduleId, selectedEntryPointId, templateId],
  );

  async function resolveCustomEntry() {
    if (!moduleId || !templateId || !customEntryPrompt.trim() || resolvingCustomEntry) {
      return;
    }

    setResolvingCustomEntry(true);
    setError(null);

    try {
      const response = await fetch("/api/campaigns/custom-entry", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          moduleId,
          templateId,
          prompt: customEntryPrompt.trim(),
        }),
      });
      const data = (await response.json()) as {
        entryPoint?: ResolvedLaunchEntry;
        error?: string;
      };

      if (!response.ok || !data.entryPoint) {
        throw new Error(data.error ?? "Failed to resolve custom entry.");
      }

      setLaunchMode("custom");
      setCustomEntryPoint(data.entryPoint);
      setDraft(null);
      setPreparedLaunch(null);
    } catch (resolveError) {
      setError(resolveError instanceof Error ? resolveError.message : "Failed to resolve custom entry.");
    } finally {
      setResolvingCustomEntry(false);
    }
  }

  useEffect(() => {
    setDraft(null);
    setPreparedLaunch(null);
  }, [launchMode, selectedEntryPointId, customEntryPoint?.id]);

  useEffect(() => {
    if (!module || !character || !hasActiveLaunchSelection || draft || generating) {
      return;
    }

    void generateDraft();
  }, [character, draft, generateDraft, generating, hasActiveLaunchSelection, module]);

  async function startCampaign() {
    if (!moduleId || !templateId || !draft || !preparedLaunch || launching) {
      return;
    }

    const launchSelection =
      launchMode === "custom"
        ? customEntryPoint
          ? { customEntryPoint }
          : null
        : selectedEntryPointId
          ? { entryPointId: selectedEntryPointId }
          : null;

    if (!launchSelection) {
      return;
    }

    setLaunching(true);
    setError(null);

    try {
      const response = await fetch("/api/campaigns/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          moduleId,
          templateId,
          ...launchSelection,
          opening: normalizeOpeningDraft(draft),
          preparedLaunch,
        }),
      });
      const data = (await response.json()) as { campaignId?: string; error?: string };

      if (!response.ok || !data.campaignId) {
        throw new Error(data.error ?? "Failed to create campaign.");
      }

      router.push(`/play/${data.campaignId}`);
    } catch (launchError) {
      setError(launchError instanceof Error ? launchError.message : "Failed to create campaign.");
    } finally {
      setLaunching(false);
    }
  }

  return (
    <main className="app-shell">
      <div className="app-frame max-w-6xl">
        <header className="app-hero p-8">
          <p className="ui-label">Campaign Launch</p>
          <div className="mt-4 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h1 className="ui-title text-4xl md:text-5xl">Choose your way into the world.</h1>
              <p className="ui-body mt-3 max-w-3xl">
                Pick a generated entry or ground your own custom arrival, then shape the opening
                draft before launch.
              </p>
            </div>
            <button
              type="button"
              className="button-press ui-button-secondary rounded-full px-5 py-3 text-sm font-semibold"
              onClick={() => backOrPush(router, "/campaigns/new", "/campaigns")}
            >
              Back to Session Zero
            </button>
          </div>
        </header>

        {error ? <p className="mt-6 text-sm text-red-400">{error}</p> : null}

        {loadingContext ? (
          <div className="mt-8 rounded-[2rem] border border-zinc-800 bg-zinc-950 p-8 text-sm text-zinc-400">
            Loading launch context...
          </div>
        ) : module && character ? (
          <section className="mt-8 grid gap-8 lg:grid-cols-[0.85fr_1.15fr]">
            <aside className="space-y-8">
              <div className="app-section p-6">
                <p className="ui-label">Module</p>
                <h2 className="ui-title mt-3 text-2xl">{module.title}</h2>
                <p className="ui-body mt-3">{module.premise}</p>
              </div>

              <div className="app-section p-6">
                <div className="flex items-center justify-between gap-3">
                  <p className="ui-label">Entry Points</p>
                  <span className="ui-label text-zinc-500">
                    {launchMode === "custom" ? "Custom" : "Generated"}
                  </span>
                </div>
                <div className="mt-4 space-y-3">
                  {module.entryPoints.map((entryPoint) => (
                    <button
                      key={entryPoint.id}
                      type="button"
                      onClick={() => {
                        setLaunchMode("stock");
                        setSelectedEntryPointId(entryPoint.id);
                      }}
                      className={[
                        "w-full rounded-2xl border p-4 text-left transition-colors",
                        launchMode === "stock" && selectedEntryPointId === entryPoint.id
                          ? "border-zinc-500 bg-black"
                          : "border-zinc-800 bg-black hover:border-zinc-700",
                      ].join(" ")}
                    >
                      <h3 className="ui-title text-base">{entryPoint.title}</h3>
                      <p className="ui-body mt-2">{entryPoint.summary}</p>
                      <p className="ui-label mt-3">{entryPoint.locationName}</p>
                    </button>
                  ))}
                  <div
                    className={[
                      "rounded-2xl border p-4 transition-colors",
                      launchMode === "custom"
                        ? "border-zinc-500 bg-black"
                        : "border-zinc-800 bg-black",
                    ].join(" ")}
                  >
                    <button
                      type="button"
                      className="w-full text-left"
                      onClick={() => setLaunchMode("custom")}
                    >
                      <h3 className="ui-title text-base">Custom Entry</h3>
                      <p className="ui-body mt-2">
                        Describe how you want to arrive, and the system will ground it into the
                        existing world without inventing new canon.
                      </p>
                    </button>
                    <div className="mt-4 space-y-3">
                      <textarea
                        className={fieldClassName(true)}
                        value={customEntryPrompt}
                        onChange={(event) => setCustomEntryPrompt(event.target.value)}
                        placeholder="I want to enter quietly at dawn as a courier, trying to avoid watch attention while looking for the first crack in the city’s routine..."
                      />
                      <button
                        type="button"
                        className="button-press ui-button-secondary rounded-full px-4 py-2 text-sm font-semibold disabled:opacity-60"
                        onClick={() => void resolveCustomEntry()}
                        disabled={!customEntryPrompt.trim() || resolvingCustomEntry}
                      >
                        {resolvingCustomEntry
                          ? "Resolving..."
                          : customEntryPoint
                            ? "Re-resolve Entry"
                            : "Resolve Entry"}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <div className="app-section p-6">
                <p className="ui-label">Character</p>
                <h3 className="ui-title mt-3 text-xl">{character.name}</h3>
                <p className="ui-body mt-1">{character.archetype}</p>
                {character.backstory ? (
                  <p className="ui-body mt-3">{character.backstory}</p>
                ) : null}
              </div>
            </aside>

            <div className="app-section p-6">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="ui-label">Opening Draft</p>
                  <h2 className="ui-title mt-2 text-2xl">
                    {draft?.scene.title
                      ?? (launchMode === "custom" && !customEntryPoint
                        ? "Resolve a custom entry to preview the opening."
                        : "Generating entry-point opening...")}
                  </h2>
                </div>
                <button
                  type="button"
                  className="button-press ui-button-secondary rounded-full px-4 py-2 text-sm font-semibold disabled:opacity-60"
                  onClick={() => void generateDraft(followUpPrompt, draft ?? undefined)}
                  disabled={!hasActiveLaunchSelection || generating}
                >
                  {generating ? "Generating..." : "Regenerate"}
                </button>
              </div>

              {launchMode === "custom" && customEntryPoint ? (
                <div className="mt-6 rounded-2xl border border-zinc-800 p-4">
                  <p className="ui-label">Resolved Custom Entry</p>
                  <h3 className="ui-title mt-3 text-xl">{customEntryPoint.title}</h3>
                  <p className="ui-body mt-2">{customEntryPoint.summary}</p>
                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <div className="rounded-2xl border border-zinc-800 p-4">
                      <p className="ui-label">Start Location</p>
                      <p className="ui-body mt-2 text-zinc-300">{customEntryPoint.startLocationId}</p>
                    </div>
                    <div className="rounded-2xl border border-zinc-800 p-4">
                      <p className="ui-label">Scene Anchor</p>
                      <p className="ui-body mt-2 text-zinc-300">
                        {customEntryPoint.localContactNpcId
                          ?? customEntryPoint.localContactTemporaryActorLabel
                          ?? "No immediate contact required"}
                      </p>
                    </div>
                  </div>
                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <div className="rounded-2xl border border-zinc-800 p-4">
                      <p className="ui-label">Routine Path</p>
                      <p className="ui-body mt-2 text-zinc-300">{customEntryPoint.mundaneActionPath}</p>
                    </div>
                    <div className="rounded-2xl border border-zinc-800 p-4">
                      <p className="ui-label">World In Motion</p>
                      <p className="ui-body mt-2 text-zinc-300">{customEntryPoint.evidenceWorldAlreadyMoving}</p>
                    </div>
                  </div>
                  {customEntryPoint.temporaryLocalActors.length ? (
                    <div className="mt-4 rounded-2xl border border-zinc-800 p-4">
                      <p className="ui-label">Unnamed Locals</p>
                      <div className="mt-3 space-y-2">
                        {customEntryPoint.temporaryLocalActors.map((actor) => (
                          <div key={actor.label}>
                            <p className="ui-title text-sm">{actor.label}</p>
                            <p className="ui-body mt-1 text-zinc-300">{actor.summary}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <div className="rounded-2xl border border-zinc-800 p-4">
                      <p className="ui-label">Immediate Situation</p>
                      <p className="ui-body mt-2 text-zinc-300">{customEntryPoint.immediatePressure}</p>
                    </div>
                    <div className="rounded-2xl border border-zinc-800 p-4">
                      <p className="ui-label">Open Thread</p>
                      <p className="ui-body mt-2 text-zinc-300">{customEntryPoint.publicLead}</p>
                    </div>
                  </div>
                </div>
              ) : null}

              <div className="mt-6">
                <textarea
                  className={fieldClassName(true)}
                  value={followUpPrompt}
                  onChange={(event) => setFollowUpPrompt(event.target.value)}
                  placeholder="Lean harder into the market panic, or make the opening feel more suspicious and covert..."
                />
              </div>

              {draft ? (
                <div className="mt-8 space-y-6">
                  <div>
                    <p className="ui-label">Narration</p>
                    <p className="ui-body mt-3 whitespace-pre-wrap text-zinc-200">{draft.narration}</p>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="rounded-2xl border border-zinc-800 p-4">
                      <p className="ui-label">Active Threat</p>
                      <p className="ui-body mt-2 text-zinc-300">{draft.activeThreat}</p>
                    </div>
                    <div className="rounded-2xl border border-zinc-800 p-4">
                      <p className="ui-label">Location</p>
                      <p className="ui-body mt-2 text-zinc-300">{draft.scene.location}</p>
                    </div>
                  </div>
                  <div className="rounded-2xl border border-zinc-800 p-4">
                    <p className="ui-label">Scene Summary</p>
                    <p className="ui-body mt-2 text-zinc-300">{draft.scene.summary}</p>
                  </div>
                  <div className="rounded-2xl border border-zinc-800 p-4">
                    <p className="ui-label">Atmosphere</p>
                    <p className="ui-body mt-2 text-zinc-300">{draft.scene.atmosphere}</p>
                  </div>
                  <div className="rounded-2xl border border-zinc-800 p-4">
                    <p className="ui-label">Suggested Actions</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {draft.scene.suggestedActions.map((action) => (
                        <span
                          key={action}
                          className="rounded-full border border-zinc-700 px-3 py-1 text-xs text-zinc-200"
                        >
                          {action}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}

              <button
                type="button"
                className="button-press ui-button-primary mt-8 rounded-full px-5 py-3 text-sm font-semibold disabled:opacity-60"
                onClick={() => void startCampaign()}
                disabled={!draft || !preparedLaunch || !hasActiveLaunchSelection || launching}
              >
                {launching ? "Launching..." : "Launch Campaign"}
              </button>
            </div>
          </section>
        ) : (
          <div className="app-section mt-8 p-8 text-sm text-zinc-400">
            Missing module or character context.
          </div>
        )}
      </div>
    </main>
  );
}
