"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type {
  AdventureModuleSummary,
  CharacterTemplateSummary,
  GeneratedWorldModule,
} from "@/lib/game/types";

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

export function SessionZeroApp() {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [modules, setModules] = useState<AdventureModuleSummary[]>([]);
  const [characters, setCharacters] = useState<CharacterTemplateSummary[]>([]);
  const [selectedModuleId, setSelectedModuleId] = useState<string | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [draft, setDraft] = useState<GeneratedWorldModule | null>(null);
  const [loading, setLoading] = useState(true);
  const [drafting, setDrafting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedModule = modules.find((module) => module.id === selectedModuleId) ?? null;

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

  async function generateDraft() {
    if (!prompt.trim() || drafting) {
      return;
    }

    setDrafting(true);
    setError(null);

    try {
      const response = await fetch("/api/campaigns/draft", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ prompt, previousDraft: draft ?? undefined }),
      });

      const data = (await response.json()) as {
        draft?: GeneratedWorldModule;
        error?: string;
      };

      if (!response.ok || !data.draft) {
        throw new Error(data.error ?? "Failed to generate module draft.");
      }

      setDraft(data.draft);
    } catch (draftError) {
      setError(draftError instanceof Error ? draftError.message : "Failed to generate module draft.");
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
        body: JSON.stringify({ draft }),
      });

      const data = (await response.json()) as {
        moduleId?: string;
        module?: AdventureModuleSummary;
        error?: string;
      };

      if (!response.ok || !data.moduleId || !data.module) {
        throw new Error(data.error ?? "Failed to save module.");
      }

      setModules((current) => [data.module!, ...current.filter((entry) => entry.id !== data.moduleId)]);
      setSelectedModuleId(data.moduleId);
      setDraft(null);
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
    <main className="app-shell">
      <div className="app-frame max-w-6xl">
        <header className="app-hero p-8">
          <p className="ui-label">Session Zero</p>
          <h1 className="ui-title mt-4 text-4xl md:text-5xl">
            Build an open-world campaign launch.
          </h1>
          <p className="ui-body mt-3 max-w-3xl">
            Generate a spatial module, save it to your library, choose a protagonist, and move into
            entry-point selection and opening generation.
          </p>
        </header>

        {error ? <p className="mt-6 text-sm text-red-400">{error}</p> : null}

        <section className="mt-8 grid gap-8 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="app-section p-6">
            <FieldShell label="Module Prompt">
              <textarea
                className={fieldClassName(true)}
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="A storm-battered trade city where three factions are quietly preparing for open conflict..."
              />
            </FieldShell>
            <div className="mt-4 flex gap-3">
              <button
                type="button"
                className="button-press ui-button-primary rounded-full px-5 py-3 text-sm font-semibold disabled:opacity-60"
                onClick={() => void generateDraft()}
                disabled={drafting}
              >
                {drafting ? "Generating..." : draft ? "Regenerate Draft" : "Generate Draft"}
              </button>
              {draft ? (
                <button
                  type="button"
                  className="button-press ui-button-secondary rounded-full px-5 py-3 text-sm font-semibold disabled:opacity-60"
                  onClick={() => void saveDraft()}
                  disabled={saving}
                >
                  {saving ? "Saving..." : "Save Module"}
                </button>
              ) : null}
            </div>

            {draft ? (
              <div className="mt-8 space-y-6">
                <div>
                  <p className="ui-label">Draft Title</p>
                  <h2 className="ui-title mt-2 text-2xl">{draft.title}</h2>
                  <p className="ui-body mt-3">{draft.premise}</p>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="rounded-2xl border border-zinc-800 p-4">
                    <p className="ui-label">Locations</p>
                    <p className="ui-title mt-2 text-2xl">{draft.locations.length}</p>
                  </div>
                  <div className="rounded-2xl border border-zinc-800 p-4">
                    <p className="ui-label">Entry Points</p>
                    <p className="ui-title mt-2 text-2xl">{draft.entryPoints.length}</p>
                  </div>
                </div>
                <div>
                  <p className="ui-label">Entry Points</p>
                  <div className="mt-3 grid gap-4 md:grid-cols-2">
                    {draft.entryPoints.map((entryPoint) => {
                      const location = draft.locations.find((locationEntry) => locationEntry.id === entryPoint.startLocationId);
                      return (
                        <article key={entryPoint.id} className="rounded-2xl border border-zinc-800 p-4">
                          <h3 className="ui-title text-lg">{entryPoint.title}</h3>
                          <p className="ui-body mt-2">{entryPoint.summary}</p>
                          <p className="ui-label mt-3">
                            Starts at {location?.name ?? entryPoint.startLocationId}
                          </p>
                        </article>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          <div className="space-y-8">
            <section className="app-section p-6">
              <p className="ui-label">Saved Modules</p>
              {loading ? (
                <p className="mt-4 text-sm text-zinc-400">Loading modules...</p>
              ) : modules.length ? (
                <div className="mt-4 space-y-3">
                  {modules.map((module) => (
                    <button
                      key={module.id}
                      type="button"
                      onClick={() => setSelectedModuleId(module.id)}
                      className={[
                        "w-full rounded-2xl border p-4 text-left transition-colors",
                        selectedModuleId === module.id
                          ? "border-zinc-500 bg-black"
                          : "border-zinc-800 bg-black hover:border-zinc-700",
                      ].join(" ")}
                    >
                      <h3 className="ui-title text-base">{module.title}</h3>
                      <p className="ui-body mt-2">{module.premise}</p>
                      <p className="ui-label mt-3">
                        {module.entryPointCount} entry points
                      </p>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="mt-4 text-sm text-zinc-400">No modules saved yet.</p>
              )}
            </section>

            <section className="app-section p-6">
              <p className="ui-label">Character Templates</p>
              {loading ? (
                <p className="mt-4 text-sm text-zinc-400">Loading characters...</p>
              ) : characters.length ? (
                <div className="mt-4 space-y-3">
                  {characters.map((character) => (
                    <button
                      key={character.id}
                      type="button"
                      onClick={() => setSelectedTemplateId(character.id)}
                      className={[
                        "w-full rounded-2xl border p-4 text-left transition-colors",
                        selectedTemplateId === character.id
                          ? "border-zinc-500 bg-black"
                          : "border-zinc-800 bg-black hover:border-zinc-700",
                      ].join(" ")}
                    >
                      <h3 className="ui-title text-base">{character.name}</h3>
                      <p className="ui-body mt-1">{character.archetype}</p>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="mt-4 text-sm text-zinc-400">Create a character template first.</p>
              )}
            </section>

            <section className="app-section p-6">
              <p className="ui-label">Launch</p>
              <p className="ui-body mt-3">
                Continue to choose an entry point and generate the opening from the selected module.
              </p>
              <button
                type="button"
                className="button-press ui-button-primary mt-4 rounded-full px-5 py-3 text-sm font-semibold disabled:opacity-60"
                disabled={!selectedModule || !selectedTemplateId}
                onClick={continueToCampaignCreation}
              >
                Continue To Launch
              </button>
            </section>
          </div>
        </section>
      </div>
    </main>
  );
}
