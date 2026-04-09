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

function blockedLaunchCopy(launchBlockReason: AdventureModuleDetail["launchBlockReason"]) {
  if (launchBlockReason === "requires_region_materialization") {
    return {
      title: "This module still needs settlement descent.",
      body: "This descended module cannot launch yet because region-to-settlement materialization is still pending.",
    };
  }

  return {
    title: "This module still needs region descent.",
    body: "This world-scale module cannot launch directly until world-to-region descent is completed.",
  };
}

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
  const [regionSemanticKey, setRegionSemanticKey] = useState<string | null>(null);
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
        setRegionSemanticKey(moduleData.module?.regionSelectionOptions?.[0]?.semanticKey ?? null);
        setLaunchMode("stock");
        setSelectedEntryPointId(null);
        setCustomEntryPoint(null);
        setDraft(null);
        setPreparedLaunch(null);
        setFollowUpPrompt("");
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
      activeThreat: input.activeThreat?.trim() || null,
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

  const isWorldRegionDescentFlow = module?.launchBlockReason === "requires_world_descent";
  const isLaunchBlockedPendingFutureDescent = Boolean(
    module && !module.launchableDirectly && !isWorldRegionDescentFlow,
  );
  const blockedLaunchState = module ? blockedLaunchCopy(module.launchBlockReason) : null;
  const usesAutoLaunchResolution =
    !isWorldRegionDescentFlow
    && Boolean(module?.launchableDirectly)
    && (module?.entryPoints.length ?? 0) === 0
    && launchMode !== "custom";
  const hasActiveLaunchSelection =
    isWorldRegionDescentFlow
      ? Boolean(regionSemanticKey)
      : (
          usesAutoLaunchResolution
          || (launchMode === "custom" ? Boolean(customEntryPoint) : Boolean(selectedEntryPointId))
        );

  const generateDraft = useCallback(
    async (prompt?: string, previousDraft?: GeneratedCampaignOpening) => {
      if (!moduleId || !templateId || isWorldRegionDescentFlow || !module?.launchableDirectly) {
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

      if (!launchSelection && !usesAutoLaunchResolution) {
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
            ...(launchSelection ?? {}),
            prompt: prompt?.trim() || undefined,
            previousDraft: previousDraft ? normalizeOpeningDraft(previousDraft) : undefined,
            preparedLaunch: preparedLaunch ?? undefined,
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
    [
      customEntryPoint,
      isWorldRegionDescentFlow,
      launchMode,
      moduleId,
      preparedLaunch,
      selectedEntryPointId,
      templateId,
      module?.launchableDirectly,
      usesAutoLaunchResolution,
    ],
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
    if (
      !module
      || !character
      || !hasActiveLaunchSelection
      || draft
      || generating
      || isWorldRegionDescentFlow
      || !module.launchableDirectly
    ) {
      return;
    }

    void generateDraft();
  }, [character, draft, generateDraft, generating, hasActiveLaunchSelection, isWorldRegionDescentFlow, module]);

  async function startCampaign() {
    if (!moduleId || !templateId || launching) {
      return;
    }

    if (isWorldRegionDescentFlow) {
      if (!regionSemanticKey) {
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
            regionSemanticKey,
          }),
        });
        const data = (await response.json()) as {
          campaignId?: string;
          playable?: boolean;
          error?: string;
        };

        if (!response.ok || !data.campaignId) {
          throw new Error(data.error ?? "Failed to start world-to-region descent.");
        }

        router.push(data.playable === false ? "/campaigns" : `/play/${data.campaignId}`);
      } catch (launchError) {
        setError(launchError instanceof Error ? launchError.message : "Failed to start world-to-region descent.");
      } finally {
        setLaunching(false);
      }
      return;
    }

    if (!draft || !preparedLaunch) {
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

    if (!launchSelection && !usesAutoLaunchResolution) {
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
          ...(launchSelection ?? {}),
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
                <div className="mt-4 flex flex-wrap gap-2">
                  <span className="rounded-full border border-zinc-800 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-zinc-400">
                    {module.scaleTier}
                  </span>
                  <span className="rounded-full border border-zinc-800 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-zinc-400">
                    {module.launchableDirectly ? "launchable now" : "descent required"}
                  </span>
                </div>
              </div>

              <div className="app-section p-6">
                <div className="flex items-center justify-between gap-3">
                  <p className="ui-label">{isWorldRegionDescentFlow ? "Launch Region" : "Entry Points"}</p>
                  {!isWorldRegionDescentFlow && !isLaunchBlockedPendingFutureDescent ? (
                    <span className="ui-label text-zinc-500">
                      {launchMode === "custom" ? "Custom" : "Generated"}
                    </span>
                  ) : null}
                </div>
                <div className="mt-4 space-y-3">
                  {isWorldRegionDescentFlow ? (
                    <>
                      {module.regionSelectionOptions.map((region) => (
                        <button
                          key={region.semanticKey}
                          type="button"
                          onClick={() => setRegionSemanticKey(region.semanticKey)}
                          className={[
                            "w-full rounded-2xl border p-4 text-left transition-colors",
                            regionSemanticKey === region.semanticKey
                              ? "border-zinc-500 bg-black"
                              : "border-zinc-800 bg-black hover:border-zinc-700",
                          ].join(" ")}
                        >
                          <h3 className="ui-title text-base">{region.name}</h3>
                          <p className="ui-body mt-2">{region.summary}</p>
                        </button>
                      ))}
                      <div className="rounded-2xl border border-zinc-800 bg-black p-4">
                        <h3 className="ui-title text-base">World-to-Region Descent</h3>
                        <p className="ui-body mt-2">
                          Choose which macro region to materialize first. This creates region manifests
                          for the whole world, fully bundles the selected region, and stops before
                          settlement-local launch.
                        </p>
                      </div>
                    </>
                  ) : isLaunchBlockedPendingFutureDescent ? (
                    <div className="rounded-2xl border border-zinc-800 bg-black p-4">
                      <h3 className="ui-title text-base">Launch Deferred</h3>
                      <p className="ui-body mt-2">
                        {blockedLaunchState?.body
                          ?? "This module requires another descent stage before it can launch."}
                      </p>
                    </div>
                  ) : (
                    <>
                      {module.entryPoints.length > 0 ? (
                        module.entryPoints.map((entryPoint) => (
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
                        ))
                      ) : (
                        <div className="rounded-2xl border border-zinc-800 bg-black p-4">
                          <h3 className="ui-title text-base">Campaign-Time Opening</h3>
                          <p className="ui-body mt-2">
                            This module has no baked entry points. The opening hinge will be resolved from the
                            module and your character when you generate the campaign launch.
                          </p>
                        </div>
                      )}
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
                          onClick={() => module.launchableDirectly && setLaunchMode("custom")}
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
                            disabled={!module.launchableDirectly || !customEntryPrompt.trim() || resolvingCustomEntry}
                          >
                            {resolvingCustomEntry
                              ? "Resolving..."
                              : customEntryPoint
                                ? "Re-resolve Entry"
                                : "Resolve Entry"}
                          </button>
                        </div>
                      </div>
                    </>
                  )}
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
              {isWorldRegionDescentFlow ? (
                <>
                  <div className="rounded-2xl border border-zinc-800 bg-black/40 p-6">
                    <p className="ui-label">Region Descent</p>
                    <h2 className="ui-title mt-2 text-2xl">
                      Materialize the selected region and stop at the settlement boundary.
                    </h2>
                    <p className="ui-body mt-3 text-zinc-300">
                      This creates region manifests for the full world, bundles the selected region,
                      materializes world-owned travel out of it, and leaves the campaign in a
                      deliberate non-playable state until settlement descent exists.
                    </p>
                  </div>

                  <div className="mt-6 grid gap-4 md:grid-cols-2">
                    <div className="rounded-2xl border border-zinc-800 p-4">
                      <p className="ui-label">Commit Shape</p>
                      <p className="ui-body mt-2 text-zinc-300">
                        Atomic preload materialization. If any required launch-region artifact fails,
                        the descended runtime graph does not commit.
                      </p>
                    </div>
                    <div className="rounded-2xl border border-zinc-800 p-4">
                      <p className="ui-label">Campaign State</p>
                      <p className="ui-body mt-2 text-zinc-300">
                        The resulting campaign is stored as awaiting settlement descent, not launched
                        into live play.
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    className="button-press ui-button-primary mt-8 rounded-full px-5 py-3 text-sm font-semibold disabled:opacity-60"
                    onClick={() => void startCampaign()}
                    disabled={!hasActiveLaunchSelection || launching}
                  >
                    {launching ? "Materializing..." : "Materialize Region Graph"}
                  </button>
                </>
              ) : isLaunchBlockedPendingFutureDescent ? (
                <div className="rounded-2xl border border-zinc-800 bg-black/40 p-6">
                  <p className="ui-label">Launch Deferred</p>
                  <h2 className="ui-title mt-2 text-2xl">
                    {blockedLaunchState?.title ?? "This module requires another descent stage."}
                  </h2>
                  <p className="ui-body mt-3 text-zinc-300">
                    {blockedLaunchState?.body
                      ?? "This module requires another descent stage before it can launch."}
                  </p>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="ui-label">Opening Draft</p>
                      <h2 className="ui-title mt-2 text-2xl">
                        {draft?.scene.title
                          ?? (launchMode === "custom" && !customEntryPoint
                            ? "Resolve a custom entry to preview the opening."
                            : hasActiveLaunchSelection
                              ? "Generating entry-point opening..."
                              : module.entryPoints.length === 0
                                ? "A grounded opening will be resolved from the module and character."
                                : "Choose an entry point to preview the opening.")}
                      </h2>
                    </div>
                    <button
                      type="button"
                      className="button-press ui-button-secondary rounded-full px-4 py-2 text-sm font-semibold disabled:opacity-60"
                      onClick={() => void generateDraft(followUpPrompt, draft ?? undefined)}
                      disabled={!module.launchableDirectly || !hasActiveLaunchSelection || generating}
                    >
                      {generating ? "Generating..." : "Regenerate"}
                    </button>
                  </div>

                  {launchMode === "custom" && customEntryPoint ? (
                    <div className="mt-6 rounded-2xl border border-zinc-800 bg-black/40 p-4">
                      <p className="ui-label">Grounded From Your Prompt</p>
                      <p className="ui-body mt-2 text-zinc-300">
                        Your custom arrival has been grounded into{" "}
                        <span className="text-zinc-100">{customEntryPoint.title}</span>.
                      </p>
                      <div className="mt-4 grid gap-4 md:grid-cols-3">
                        <div className="rounded-2xl border border-zinc-800 p-4">
                          <p className="ui-label">Anchor</p>
                          <p className="ui-body mt-2 text-zinc-300">
                            {customEntryPoint.localContactTemporaryActorLabel
                              ?? (customEntryPoint.localContactNpcId ? "A named local contact" : "No immediate contact required")}
                          </p>
                        </div>
                        <div className="rounded-2xl border border-zinc-800 p-4">
                          <p className="ui-label">Pressure</p>
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
                    <p className="ui-label mb-3">Rewrite Notes</p>
                    <p className="ui-body mb-3 text-sm text-zinc-400">
                      This rewrites the opening draft only. To change the resolved entry, start
                      location, or arrival setup, use <span className="text-zinc-200">Re-resolve Entry</span>{" "}
                      above.
                    </p>
                    <textarea
                      className={fieldClassName(true)}
                      value={followUpPrompt}
                      onChange={(event) => setFollowUpPrompt(event.target.value)}
                      placeholder="Make the scene quieter, warmer, more routine, or more suspicious without changing where or how the campaign starts..."
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
                          <p className="ui-label">{draft.activeThreat ? "Active Threat" : "Immediate Pace"}</p>
                          <p className="ui-body mt-2 text-zinc-300">
                            {draft.activeThreat ?? "No immediate threat. The scene is grounded in daily routine."}
                          </p>
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
                    disabled={!module.launchableDirectly || !draft || !preparedLaunch || !hasActiveLaunchSelection || launching}
                  >
                    {launching ? "Launching..." : "Launch Campaign"}
                  </button>
                </>
              )}
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
