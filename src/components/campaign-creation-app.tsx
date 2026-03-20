"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type {
  AdventureModuleDetail,
  CharacterTemplate,
  GeneratedCampaignOpening,
} from "@/lib/game/types";
import { backOrPush } from "@/lib/ui/navigation";

function fieldClassName(multiline = false) {
  return [
    "w-full rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-sm text-zinc-100 outline-none transition-colors",
    "placeholder:text-zinc-600 focus:border-zinc-700 focus:bg-zinc-950",
    multiline ? "min-h-24 resize-y leading-7" : "",
  ].join(" ");
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
  const [selectedEntryPointId, setSelectedEntryPointId] = useState<string | null>(null);
  const [draft, setDraft] = useState<GeneratedCampaignOpening | null>(null);
  const [loadingContext, setLoadingContext] = useState(true);
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

  const generateDraft = useCallback(
    async (prompt?: string, previousDraft?: GeneratedCampaignOpening) => {
      if (!moduleId || !templateId || !selectedEntryPointId) {
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
            entryPointId: selectedEntryPointId,
            prompt: prompt?.trim() || undefined,
            previousDraft: previousDraft ? normalizeOpeningDraft(previousDraft) : undefined,
          }),
        });
        const data = (await response.json()) as {
          draft?: GeneratedCampaignOpening;
          error?: string;
        };

        if (!response.ok || !data.draft) {
          throw new Error(data.error ?? "Failed to generate opening draft.");
        }

        setDraft(data.draft);
        setFollowUpPrompt("");
      } catch (draftError) {
        setError(draftError instanceof Error ? draftError.message : "Failed to generate opening.");
      } finally {
        setGenerating(false);
      }
    },
    [moduleId, templateId, selectedEntryPointId],
  );

  useEffect(() => {
    setDraft(null);
  }, [selectedEntryPointId]);

  useEffect(() => {
    if (!module || !character || !selectedEntryPointId || draft || generating) {
      return;
    }

    void generateDraft();
  }, [character, draft, generateDraft, generating, module, selectedEntryPointId]);

  async function startCampaign() {
    if (!moduleId || !templateId || !selectedEntryPointId || !draft || launching) {
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
          entryPointId: selectedEntryPointId,
          opening: normalizeOpeningDraft(draft),
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
                Pick an entry point, shape the opening draft, and launch a spatial campaign rooted
                in the selected start location.
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
                <p className="ui-label">Entry Points</p>
                <div className="mt-4 space-y-3">
                  {module.entryPoints.map((entryPoint) => (
                    <button
                      key={entryPoint.id}
                      type="button"
                      onClick={() => setSelectedEntryPointId(entryPoint.id)}
                      className={[
                        "w-full rounded-2xl border p-4 text-left transition-colors",
                        selectedEntryPointId === entryPoint.id
                          ? "border-zinc-500 bg-black"
                          : "border-zinc-800 bg-black hover:border-zinc-700",
                      ].join(" ")}
                    >
                      <h3 className="ui-title text-base">{entryPoint.title}</h3>
                      <p className="ui-body mt-2">{entryPoint.summary}</p>
                      <p className="ui-label mt-3">
                        {entryPoint.locationName}
                      </p>
                    </button>
                  ))}
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
                    {draft?.scene.title ?? "Generating entry-point opening..."}
                  </h2>
                </div>
                <button
                  type="button"
                  className="button-press ui-button-secondary rounded-full px-4 py-2 text-sm font-semibold disabled:opacity-60"
                  onClick={() => void generateDraft(followUpPrompt, draft ?? undefined)}
                  disabled={!selectedEntryPointId || generating}
                >
                  {generating ? "Generating..." : "Regenerate"}
                </button>
              </div>

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
                disabled={!draft || !selectedEntryPointId || launching}
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
