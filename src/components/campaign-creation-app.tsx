"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type {
  CharacterTemplate,
  GeneratedCampaignOpening,
} from "@/lib/game/types";

type CampaignModulePreview = {
  id: string;
  title: string;
  premise: string;
  tone: string;
  setting: string;
  createdAt: string;
  updatedAt: string;
};

function FieldShell({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-2">
      <span className="text-[0.68rem] uppercase tracking-[0.24em] text-zinc-500">{label}</span>
      {children}
    </label>
  );
}

function inputClassName(multiline = false) {
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

  const [module, setModule] = useState<CampaignModulePreview | null>(null);
  const [character, setCharacter] = useState<CharacterTemplate | null>(null);
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
          module?: CampaignModulePreview;
          error?: string;
        };
        const characterData = (await characterResponse.json()) as {
          character?: CharacterTemplate;
          error?: string;
        };

        if (!moduleResponse.ok) {
          throw new Error(moduleData.error ?? "Failed to load adventure module.");
        }

        if (!characterResponse.ok) {
          throw new Error(characterData.error ?? "Failed to load character template.");
        }

        if (!active) {
          return;
        }

        setModule(moduleData.module ?? null);
        setCharacter(characterData.character ?? null);
      } catch (loadError) {
        if (!active) {
          return;
        }

        setError(
          loadError instanceof Error
            ? loadError.message
            : "Failed to load campaign creation context.",
        );
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

  function updateDraft(updater: (current: GeneratedCampaignOpening) => GeneratedCampaignOpening) {
    setDraft((current) => (current ? updater(current) : current));
  }

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

  const generateDraft = useCallback(async (prompt?: string, previousDraft?: GeneratedCampaignOpening) => {
    if (!moduleId || !templateId) {
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
          prompt: prompt?.trim() || undefined,
          previousDraft: previousDraft ? normalizeOpeningDraft(previousDraft) : undefined,
        }),
      });
      const data = (await response.json()) as {
        draft?: GeneratedCampaignOpening;
        error?: string;
      };

      if (!response.ok || !data.draft) {
        throw new Error(data.error ?? "Failed to generate campaign opening draft.");
      }

      setDraft(data.draft);
      setFollowUpPrompt("");
    } catch (draftError) {
      setError(
        draftError instanceof Error
          ? draftError.message
          : "Failed to generate campaign opening draft.",
      );
    } finally {
      setGenerating(false);
    }
  }, [moduleId, templateId]);

  useEffect(() => {
    if (!moduleId || !templateId || !module || !character || draft || generating) {
      return;
    }

    void generateDraft();
  }, [character, draft, generateDraft, generating, module, moduleId, templateId]);

  async function startCampaign() {
    if (!moduleId || !templateId || !draft || launching) {
      return;
    }

    const opening = normalizeOpeningDraft(draft);

    if (!opening.scene.suggestedActions.length) {
      setError("Add at least one suggested action before starting the campaign.");
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
          opening,
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

  function addSuggestedAction() {
    updateDraft((current) =>
      current.scene.suggestedActions.length >= 4
        ? current
        : {
            ...current,
            scene: {
              ...current.scene,
              suggestedActions: [...current.scene.suggestedActions, ""],
            },
          },
    );
  }

  function updateSuggestedAction(index: number, value: string) {
    updateDraft((current) => ({
      ...current,
      scene: {
        ...current.scene,
        suggestedActions: current.scene.suggestedActions.map((entry, actionIndex) =>
          actionIndex === index ? value : entry,
        ),
      },
    }));
  }

  function removeSuggestedAction(index: number) {
    updateDraft((current) =>
      current.scene.suggestedActions.length <= 1
        ? current
        : {
            ...current,
            scene: {
              ...current.scene,
              suggestedActions: current.scene.suggestedActions.filter(
                (_, actionIndex) => actionIndex !== index,
              ),
            },
          },
    );
  }

  if (!moduleId || !templateId) {
    return (
      <main className="min-h-screen bg-black px-6 py-16 text-zinc-50">
        <div className="mx-auto max-w-3xl rounded-[2rem] border border-zinc-800 bg-zinc-950 p-8">
          <p className="text-[0.68rem] uppercase tracking-[0.28em] text-zinc-500">Campaign Setup</p>
          <h1 className="mt-4 text-3xl font-semibold text-white">Missing launch context.</h1>
          <p className="mt-4 text-sm leading-7 text-zinc-400">
            Choose a module and a character first, then come back here to shape the opening scenario.
          </p>
          <button
            type="button"
            className="button-press mt-6 rounded-full bg-white px-5 py-3 text-sm font-semibold text-black hover:bg-zinc-200"
            onClick={() => router.push("/campaigns/new")}
          >
            Back to Selection
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="h-screen overflow-y-scroll bg-black pb-20 text-zinc-50 md:pb-12">
      <div className="mx-auto w-full max-w-6xl px-6 py-12">
        <section className="rounded-[2rem] border border-zinc-800 bg-zinc-950 p-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[0.68rem] uppercase tracking-[0.28em] text-zinc-500">Campaign Setup</p>
              <h1 className="mt-4 text-4xl font-semibold tracking-tight text-white">
                Shape the first real scenario.
              </h1>
              <p className="mt-4 max-w-3xl text-sm leading-7 text-zinc-400">
                Pair the selected hero with the chosen module, refine the starting situation, then
                begin the actual campaign when the opening feels right.
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                className="button-press rounded-full border border-zinc-800 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-200 hover:bg-black"
                onClick={() => router.push("/campaigns/new")}
              >
                Back to Selection
              </button>
              <button
                type="button"
                className="button-press rounded-full border border-zinc-800 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-200 hover:bg-black"
                onClick={() => router.push("/characters")}
              >
                Character Library
              </button>
            </div>
          </div>

          {loadingContext ? (
            <div className="mt-10 rounded-3xl border border-zinc-800 bg-black p-6 text-sm text-zinc-400">
              Loading selected module and character...
            </div>
          ) : module && character ? (
            <div className="mt-10 grid gap-4 md:grid-cols-2">
              <div className="rounded-3xl border border-zinc-800 bg-black p-5">
                <p className="text-[0.68rem] uppercase tracking-[0.18em] text-zinc-500">Module</p>
                <h2 className="mt-3 text-2xl font-semibold text-white">{module.title}</h2>
                <p className="mt-3 text-sm leading-7 text-zinc-300">{module.premise}</p>
                <div className="mt-4 grid gap-3 text-sm text-zinc-400 md:grid-cols-2">
                  <p>{module.setting}</p>
                  <p>{module.tone}</p>
                </div>
              </div>
              <div className="rounded-3xl border border-zinc-800 bg-black p-5">
                <p className="text-[0.68rem] uppercase tracking-[0.18em] text-zinc-500">Character</p>
                <h2 className="mt-3 text-2xl font-semibold text-white">{character.name}</h2>
                <p className="mt-2 text-sm text-zinc-400">{character.archetype}</p>
                <div className="mt-4 grid grid-cols-3 gap-2 text-xs text-zinc-300">
                  <span>STR {character.strength}</span>
                  <span>AGI {character.agility}</span>
                  <span>INT {character.intellect}</span>
                  <span>CHA {character.charisma}</span>
                  <span>VIT {character.vitality}</span>
                  <span>HP {character.maxHealth}</span>
                </div>
                {character.backstory ? (
                  <p className="mt-4 text-sm leading-7 text-zinc-400">{character.backstory}</p>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="mt-10 rounded-3xl border border-zinc-800 bg-black p-6">
              <p className="text-sm leading-7 text-zinc-400">
                {error ?? "The selected module or character could not be loaded."}
              </p>
              <button
                type="button"
                className="button-press mt-4 rounded-full bg-white px-5 py-3 text-sm font-semibold text-black hover:bg-zinc-200"
                onClick={() => router.push("/campaigns/new")}
              >
                Back to Selection
              </button>
            </div>
          )}

          {module && character ? (
            <>
              <div className="mt-8 rounded-3xl border border-zinc-800 bg-black p-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-[0.68rem] uppercase tracking-[0.22em] text-zinc-500">Opening Draft</p>
                    <p className="mt-2 text-sm text-zinc-400">
                      This draft is temporary until you start the campaign.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="button-press rounded-full border border-zinc-700 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-200 hover:bg-zinc-900 disabled:cursor-not-allowed disabled:opacity-60"
                    onClick={() => void generateDraft()}
                    disabled={generating}
                  >
                    {generating ? "Generating..." : "Regenerate"}
                  </button>
                </div>

                {draft ? (
                  <div className="mt-6 space-y-6">
                    <FieldShell label="Narration">
                      <textarea
                        className={inputClassName(true)}
                        value={draft.narration}
                        onChange={(event) =>
                          updateDraft((current) => ({
                            ...current,
                            narration: event.target.value,
                          }))
                        }
                      />
                    </FieldShell>

                    <div className="grid gap-4 md:grid-cols-2">
                      <FieldShell label="Scene Title">
                        <input
                          className={inputClassName()}
                          value={draft.scene.title}
                          onChange={(event) =>
                            updateDraft((current) => ({
                              ...current,
                              scene: {
                                ...current.scene,
                                title: event.target.value,
                              },
                            }))
                          }
                        />
                      </FieldShell>
                      <FieldShell label="Location">
                        <input
                          className={inputClassName()}
                          value={draft.scene.location}
                          onChange={(event) =>
                            updateDraft((current) => ({
                              ...current,
                              scene: {
                                ...current.scene,
                                location: event.target.value,
                              },
                            }))
                          }
                        />
                      </FieldShell>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <FieldShell label="Atmosphere">
                        <input
                          className={inputClassName()}
                          value={draft.scene.atmosphere}
                          onChange={(event) =>
                            updateDraft((current) => ({
                              ...current,
                              scene: {
                                ...current.scene,
                                atmosphere: event.target.value,
                              },
                            }))
                          }
                        />
                      </FieldShell>
                      <FieldShell label="Active Threat">
                        <textarea
                          className={inputClassName(true)}
                          value={draft.activeThreat}
                          onChange={(event) =>
                            updateDraft((current) => ({
                              ...current,
                              activeThreat: event.target.value,
                            }))
                          }
                        />
                      </FieldShell>
                    </div>

                    <FieldShell label="Scene Summary">
                      <textarea
                        className={inputClassName(true)}
                        value={draft.scene.summary}
                        onChange={(event) =>
                          updateDraft((current) => ({
                            ...current,
                            scene: {
                              ...current.scene,
                              summary: event.target.value,
                            },
                          }))
                        }
                      />
                    </FieldShell>

                    <section className="space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-[0.68rem] uppercase tracking-[0.24em] text-zinc-500">
                          Suggested Actions
                        </p>
                        <button
                          type="button"
                          className="button-press rounded-full border border-zinc-700 px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-200 hover:bg-zinc-900 disabled:cursor-not-allowed disabled:opacity-60"
                          onClick={addSuggestedAction}
                          disabled={draft.scene.suggestedActions.length >= 4}
                        >
                          Add Action
                        </button>
                      </div>
                      {draft.scene.suggestedActions.map((action, index) => (
                        <div key={`suggested-action-${index}`} className="flex gap-3">
                          <input
                            className={inputClassName()}
                            value={action}
                            onChange={(event) => updateSuggestedAction(index, event.target.value)}
                          />
                          <button
                            type="button"
                            className="button-press rounded-full border border-zinc-700 px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-200 hover:bg-zinc-900 disabled:cursor-not-allowed disabled:opacity-60"
                            onClick={() => removeSuggestedAction(index)}
                            disabled={draft.scene.suggestedActions.length <= 1}
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </section>
                  </div>
                ) : (
                  <div className="mt-6 rounded-3xl border border-zinc-800 bg-zinc-950 p-6 text-sm text-zinc-400">
                    {generating ? "Generating the first campaign scenario..." : "Preparing a starting scenario draft..."}
                  </div>
                )}
              </div>

              <div className="mt-8 rounded-3xl border border-zinc-800 bg-black p-6">
                <FieldShell label="Refine This Opening">
                  <input
                    className={inputClassName()}
                    value={followUpPrompt}
                    onChange={(event) => setFollowUpPrompt(event.target.value)}
                    placeholder="Adjust the scenario for this hero..."
                  />
                </FieldShell>
                <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                  <button
                    type="button"
                    className="button-press rounded-full border border-zinc-700 px-5 py-3 text-sm font-semibold text-zinc-100 hover:bg-zinc-900 disabled:cursor-not-allowed disabled:opacity-60"
                    onClick={() => void generateDraft(followUpPrompt, draft ?? undefined)}
                    disabled={generating || !followUpPrompt.trim()}
                  >
                    {generating ? "Updating..." : "Update"}
                  </button>
                  <button
                    type="button"
                    className="button-press rounded-full bg-white px-5 py-3 text-sm font-semibold text-black hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-60"
                    onClick={() => void startCampaign()}
                    disabled={launching || generating || !draft}
                  >
                    {launching ? "Starting Campaign..." : "Start Campaign"}
                  </button>
                </div>
              </div>
            </>
          ) : null}

          {error ? <p className="mt-6 text-sm text-red-400">{error}</p> : null}
        </section>
      </div>
    </main>
  );
}
