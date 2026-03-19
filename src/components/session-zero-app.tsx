"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type {
  AdventureModuleSummary,
  CharacterTemplateSummary,
  GeneratedCampaignSetup,
} from "@/lib/game/types";

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

function CharacterCard({
  character,
  selected,
  onSelect,
  onDelete,
  deleting,
}: {
  character: CharacterTemplateSummary;
  selected: boolean;
  onSelect: () => void;
  onDelete: () => void;
  deleting: boolean;
}) {
  return (
    <div
      className={[
        "rounded-3xl border p-5 transition-colors",
        selected
          ? "border-zinc-600 bg-black"
          : "border-zinc-800 bg-black hover:border-zinc-700",
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-3">
        <button type="button" onClick={onSelect} className="min-w-0 flex-1 text-left">
          <p className="text-[0.68rem] uppercase tracking-[0.22em] text-zinc-500">Character Template</p>
          <h2 className="mt-3 text-xl font-semibold text-white">{character.name}</h2>
          <p className="mt-1 text-sm text-zinc-400">{character.archetype}</p>
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={deleting}
          className="button-press shrink-0 rounded-full border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-red-200 hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {deleting ? "Deleting..." : "Delete"}
        </button>
      </div>
      <button type="button" onClick={onSelect} className="mt-4 block w-full text-left">
        <div className="grid grid-cols-4 gap-2 text-xs text-zinc-300">
          <span>STR {character.strength}</span>
          <span>DEX {character.dexterity}</span>
          <span>CON {character.constitution}</span>
          <span>INT {character.intelligence}</span>
          <span>WIS {character.wisdom}</span>
          <span>CHA {character.charisma}</span>
          <span>HP {character.maxHealth}</span>
        </div>
        {character.backstory ? (
          <p className="mt-4 line-clamp-3 text-sm leading-6 text-zinc-400">{character.backstory}</p>
        ) : null}
      </button>
    </div>
  );
}

function ModuleCard({
  module,
  selected,
  onSelect,
  onDelete,
  deleting,
}: {
  module: AdventureModuleSummary;
  selected: boolean;
  onSelect: () => void;
  onDelete: () => void;
  deleting: boolean;
}) {
  return (
    <div
      className={[
        "rounded-3xl border p-5 text-left transition-colors",
        selected
          ? "border-zinc-600 bg-black"
          : "border-zinc-800 bg-black hover:border-zinc-700",
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-3">
        <button type="button" onClick={onSelect} className="min-w-0 flex-1 text-left">
          <p className="text-[0.68rem] uppercase tracking-[0.22em] text-zinc-500">Adventure Module</p>
          <h2 className="mt-3 text-xl font-semibold text-white">{module.title}</h2>
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={deleting}
          className="button-press shrink-0 rounded-full border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-red-200 hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {deleting ? "Deleting..." : "Delete"}
        </button>
      </div>
      <button type="button" onClick={onSelect} className="mt-2 block w-full text-left">
        <p className="line-clamp-3 text-sm leading-7 text-zinc-400">{module.premise}</p>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div>
            <p className="text-[0.68rem] uppercase tracking-[0.18em] text-zinc-500">Setting</p>
            <p className="mt-2 text-sm text-zinc-300">{module.setting}</p>
          </div>
          <div>
            <p className="text-[0.68rem] uppercase tracking-[0.18em] text-zinc-500">Tone</p>
            <p className="mt-2 text-sm text-zinc-300">{module.tone}</p>
          </div>
        </div>
        <p className="mt-4 text-sm leading-6 text-zinc-500">
          The opening scene is generated at launch based on the character entering this module.
        </p>
        <p className="mt-4 text-xs leading-6 text-zinc-500">
          Active campaigns linked: {module.campaignCount}
        </p>
      </button>
    </div>
  );
}

export function SessionZeroApp() {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [followUpPrompt, setFollowUpPrompt] = useState("");
  const [modules, setModules] = useState<AdventureModuleSummary[]>([]);
  const [modulesLoading, setModulesLoading] = useState(true);
  const [characters, setCharacters] = useState<CharacterTemplateSummary[]>([]);
  const [charactersLoading, setCharactersLoading] = useState(true);
  const [deletingModuleId, setDeletingModuleId] = useState<string | null>(null);
  const [deletingTemplateId, setDeletingTemplateId] = useState<string | null>(null);
  const [selectedModuleId, setSelectedModuleId] = useState<string | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [draft, setDraft] = useState<GeneratedCampaignSetup | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [savingModule, setSavingModule] = useState(false);
  const [continuing, setContinuing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedModule = modules.find((module) => module.id === selectedModuleId) ?? null;
  const selectedCharacter =
    characters.find((character) => character.id === selectedTemplateId) ?? null;

  useEffect(() => {
    let active = true;

    async function loadLibrary() {
      setModulesLoading(true);
      setCharactersLoading(true);

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
          throw new Error(modulesData.error ?? "Failed to load adventure modules.");
        }

        if (!charactersResponse.ok) {
          throw new Error(charactersData.error ?? "Failed to load characters.");
        }

        if (!active) {
          return;
        }

        const nextModules = modulesData.modules ?? [];
        const nextCharacters = charactersData.characters ?? [];
        setModules(nextModules);
        setCharacters(nextCharacters);
        setSelectedModuleId((current) => current ?? nextModules[0]?.id ?? null);
        setSelectedTemplateId((current) => current ?? nextCharacters[0]?.id ?? null);
      } catch (loadError) {
        if (!active) {
          return;
        }

        setError(
          loadError instanceof Error ? loadError.message : "Failed to load campaign launcher data.",
        );
      } finally {
        if (active) {
          setModulesLoading(false);
          setCharactersLoading(false);
        }
      }
    }

    void loadLibrary();

    return () => {
      active = false;
    };
  }, []);

  function updateDraft(updater: (current: GeneratedCampaignSetup) => GeneratedCampaignSetup) {
    setDraft((current) => (current ? updater(current) : current));
  }

  async function deleteModule(module: AdventureModuleSummary) {
    const confirmed = window.confirm(
      `Delete ${module.title}? Deleting this module will also delete ${module.campaignCount} active campaign${module.campaignCount === 1 ? "" : "s"}.`,
    );

    if (!confirmed || deletingModuleId) {
      return;
    }

    setDeletingModuleId(module.id);
    setError(null);

    try {
      const response = await fetch(`/api/modules/${module.id}`, {
        method: "DELETE",
      });

      const data = (await response.json()) as {
        moduleId?: string;
        campaignCount?: number;
        error?: string;
      };

      if (!response.ok || !data.moduleId) {
        throw new Error(data.error ?? "Failed to delete adventure module.");
      }

      setModules((current) => {
        const next = current.filter((entry) => entry.id !== module.id);

        if (selectedModuleId === module.id) {
          setSelectedModuleId(next[0]?.id ?? null);
        }

        return next;
      });
    } catch (deleteError) {
      setError(
        deleteError instanceof Error ? deleteError.message : "Failed to delete adventure module.",
      );
    } finally {
      setDeletingModuleId(null);
    }
  }

  async function deleteCharacter(template: CharacterTemplateSummary) {
    const confirmed = window.confirm(
      `Delete ${template.name}? Any campaigns using this character will also be deleted.`,
    );

    if (!confirmed || deletingTemplateId) {
      return;
    }

    setDeletingTemplateId(template.id);
    setError(null);

    try {
      const response = await fetch(`/api/characters/${template.id}`, {
        method: "DELETE",
      });

      const data = (await response.json()) as {
        templateId?: string;
        error?: string;
      };

      if (!response.ok || !data.templateId) {
        throw new Error(data.error ?? "Failed to delete character.");
      }

      setCharacters((current) => {
        const next = current.filter((entry) => entry.id !== template.id);

        if (selectedTemplateId === template.id) {
          setSelectedTemplateId(next[0]?.id ?? null);
        }

        return next;
      });
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Failed to delete character.");
    } finally {
      setDeletingTemplateId(null);
    }
  }

  function updateVillain(field: "name" | "motive" | "progressClock", value: string | number) {
    updateDraft((current) => ({
      ...current,
      secretEngine: {
        ...current.secretEngine,
        villain: {
          ...current.secretEngine.villain,
          [field]: value,
        },
      },
    }));
  }

  function updateArc(index: number, field: "title" | "summary" | "expectedTurns", value: string) {
    updateDraft((current) => ({
      ...current,
      secretEngine: {
        ...current.secretEngine,
        arcs: current.secretEngine.arcs.map((arc, arcIndex) =>
          arcIndex === index
            ? {
                ...arc,
                [field]:
                  field === "expectedTurns"
                    ? Math.max(1, Number.parseInt(value || "1", 10) || 1)
                    : value,
              }
            : arc,
        ),
      },
    }));
  }

  function updateReveal(index: number, field: "title" | "truth", value: string) {
    updateDraft((current) => ({
      ...current,
      secretEngine: {
        ...current.secretEngine,
        reveals: current.secretEngine.reveals.map((reveal, revealIndex) =>
          revealIndex === index ? { ...reveal, [field]: value } : reveal,
        ),
      },
    }));
  }

  function updateQuest(index: number, field: "title" | "summary", value: string) {
    updateDraft((current) => ({
      ...current,
      secretEngine: {
        ...current.secretEngine,
        quests: current.secretEngine.quests.map((quest, questIndex) =>
          questIndex === index ? { ...quest, [field]: value } : quest,
        ),
      },
    }));
  }

  function updateNpc(
    index: number,
    field: "name" | "role" | "notes" | "personalHook" | "status",
    value: string,
  ) {
    updateDraft((current) => ({
      ...current,
      secretEngine: {
        ...current.secretEngine,
        npcs: current.secretEngine.npcs.map((npc, npcIndex) =>
          npcIndex === index
            ? {
                ...npc,
                [field]: field === "personalHook" ? value || null : value,
              }
            : npc,
        ),
      },
    }));
  }

  function updateClue(
    index: number,
    field: "text" | "source" | "linkedRevealTitle",
    value: string,
  ) {
    updateDraft((current) => ({
      ...current,
      secretEngine: {
        ...current.secretEngine,
        clues: current.secretEngine.clues.map((clue, clueIndex) =>
          clueIndex === index ? { ...clue, [field]: value } : clue,
        ),
      },
    }));
  }

  function updateKeyLocation(
    index: number,
    field: "name" | "role" | "isPublic",
    value: string | boolean,
  ) {
    updateDraft((current) => ({
      ...current,
      secretEngine: {
        ...current.secretEngine,
        keyLocations: current.secretEngine.keyLocations.map((location, locationIndex) =>
          locationIndex === index
            ? {
                ...location,
                [field]: value,
              }
            : location,
        ),
      },
    }));
  }

  async function generateDraft(nextPrompt: string, previousDraft?: GeneratedCampaignSetup) {
    setDrafting(true);
    setError(null);

    try {
      const response = await fetch("/api/campaigns/draft", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          basePrompt: previousDraft ? prompt : undefined,
          prompt: nextPrompt,
          previousDraft,
        }),
      });

      const data = (await response.json()) as {
        draft?: GeneratedCampaignSetup;
        error?: string;
      };

      if (!response.ok || !data.draft) {
        throw new Error(data.error ?? "Failed to generate an adventure module draft.");
      }

      setDraft(data.draft);
      setShowAdvanced(false);
      setFollowUpPrompt("");
    } catch (draftError) {
      setError(
        draftError instanceof Error ? draftError.message : "Failed to generate module draft.",
      );
    } finally {
      setDrafting(false);
    }
  }

  async function saveDraftAsModule() {
    if (!draft || savingModule) {
      return;
    }

    setSavingModule(true);
    setError(null);

    try {
      const response = await fetch("/api/modules/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          draft,
        }),
      });

      const data = (await response.json()) as {
        moduleId?: string;
        module?: AdventureModuleSummary;
        error?: string;
      };

      if (!response.ok || !data.moduleId || !data.module) {
        throw new Error(data.error ?? "Failed to save adventure module.");
      }

      setModules((current) => [data.module!, ...current.filter((entry) => entry.id !== data.moduleId)]);
      setSelectedModuleId(data.moduleId);
      setDraft(null);
      setShowAdvanced(false);
      setFollowUpPrompt("");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save module.");
    } finally {
      setSavingModule(false);
    }
  }

  async function continueToCampaignSetup() {
    if (!selectedModule || !selectedCharacter || continuing) {
      return;
    }

    setContinuing(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        moduleId: selectedModule.id,
        templateId: selectedCharacter.id,
      });
      router.push(`/campaigns/create?${params.toString()}`);
    } catch (launchError) {
      setError(
        launchError instanceof Error
          ? launchError.message
          : "Failed to continue to campaign setup.",
      );
    } finally {
      setContinuing(false);
    }
  }

  if (draft) {
    const { publicSynopsis, secretEngine } = draft;

    return (
      <main className="h-screen overflow-y-scroll bg-black pb-20 text-zinc-50 md:pb-12">
        <div className="mx-auto w-full max-w-5xl px-6 py-12">
          <header className="rounded-[2rem] border border-zinc-800 bg-zinc-950 p-8">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-[0.68rem] uppercase tracking-[0.28em] text-zinc-500">Draft Module</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="button-press rounded-full border border-zinc-800 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-200 hover:bg-black"
                  onClick={() => router.push("/")}
                >
                  Home
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
            <h1 className="mt-4 text-4xl font-semibold tracking-tight text-white">{publicSynopsis.title}</h1>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-zinc-300">{publicSynopsis.premise}</p>
            <div className="mt-8 grid gap-4 md:grid-cols-2">
              <section className="rounded-3xl border border-zinc-800 bg-black p-5">
                <h2 className="text-sm uppercase tracking-[0.22em] text-zinc-500">Setting</h2>
                <p className="mt-3 text-sm leading-7 text-zinc-200">{publicSynopsis.setting}</p>
              </section>
              <section className="rounded-3xl border border-zinc-800 bg-black p-5">
                <h2 className="text-sm uppercase tracking-[0.22em] text-zinc-500">Tone</h2>
                <p className="mt-3 text-sm leading-7 text-zinc-200">{publicSynopsis.tone}</p>
              </section>
            </div>
            <p className="mt-6 text-sm leading-7 text-zinc-500">
              Opening scenes are generated when a specific character launches a campaign from this
              module.
            </p>
            <button
              className="mt-6 text-sm text-zinc-400 underline decoration-zinc-700 underline-offset-4 transition-colors hover:text-zinc-200"
              onClick={() => setShowAdvanced((current) => !current)}
              type="button"
            >
              {showAdvanced ? "Hide Advanced Options" : "Show Advanced Options (Warning: Contains Spoilers)"}
            </button>
          </header>

          {showAdvanced ? (
            <section className="mt-8 rounded-[2rem] border border-zinc-800 bg-zinc-950 p-8">
              <p className="text-[0.68rem] uppercase tracking-[0.28em] text-zinc-500">The DM Screen</p>

              <div className="mt-6 rounded-3xl border border-zinc-800 bg-black p-5">
                <h2 className="text-lg font-semibold text-white">Villain</h2>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <FieldShell label="Name">
                    <input
                      className={inputClassName()}
                      value={secretEngine.villain.name}
                      onChange={(event) => updateVillain("name", event.target.value)}
                    />
                  </FieldShell>
                  <FieldShell label="Progress Clock">
                    <input
                      className={inputClassName()}
                      value={String(secretEngine.villain.progressClock)}
                      onChange={(event) =>
                        updateVillain(
                          "progressClock",
                          Number.parseInt(event.target.value || "0", 10) || 0,
                        )
                      }
                      inputMode="numeric"
                    />
                  </FieldShell>
                </div>
                <FieldShell label="Motive">
                  <textarea
                    className={`${inputClassName(true)} mt-4`}
                    value={secretEngine.villain.motive}
                    onChange={(event) => updateVillain("motive", event.target.value)}
                  />
                </FieldShell>
              </div>

              <section className="mt-6 space-y-4">
                <h2 className="text-lg font-semibold text-white">Arcs</h2>
                {secretEngine.arcs.map((arc, index) => (
                  <article
                    key={`arc-${index}-${arc.title}`}
                    className="rounded-3xl border border-zinc-800 bg-black p-5"
                  >
                    <FieldShell label={`Arc ${index + 1} Title`}>
                      <input
                        className={inputClassName()}
                        value={arc.title}
                        onChange={(event) => updateArc(index, "title", event.target.value)}
                      />
                    </FieldShell>
                    <FieldShell label="Summary">
                      <textarea
                        className={`${inputClassName(true)} mt-4`}
                        value={arc.summary}
                        onChange={(event) => updateArc(index, "summary", event.target.value)}
                      />
                    </FieldShell>
                  </article>
                ))}
              </section>

              <section className="mt-6 space-y-4">
                <h2 className="text-lg font-semibold text-white">Reveals</h2>
                {secretEngine.reveals.map((reveal, index) => (
                  <article
                    key={`reveal-${index}-${reveal.title}`}
                    className="rounded-3xl border border-zinc-800 bg-black p-5"
                  >
                    <FieldShell label={`Reveal ${index + 1} Title`}>
                      <input
                        className={inputClassName()}
                        value={reveal.title}
                        onChange={(event) => updateReveal(index, "title", event.target.value)}
                      />
                    </FieldShell>
                    <FieldShell label="Truth">
                      <textarea
                        className={`${inputClassName(true)} mt-4`}
                        value={reveal.truth}
                        onChange={(event) => updateReveal(index, "truth", event.target.value)}
                      />
                    </FieldShell>
                    <p className="mt-4 text-xs leading-6 text-zinc-500">
                      Required clues: {reveal.requiredClueTitles.join(", ") || "None"}
                    </p>
                    <p className="mt-2 text-xs leading-6 text-zinc-500">
                      Required arcs: {reveal.requiredArcTitles.join(", ") || "None"}
                    </p>
                  </article>
                ))}
              </section>

              <section className="mt-6 space-y-4">
                <h2 className="text-lg font-semibold text-white">Quests</h2>
                {secretEngine.quests.map((quest, index) => (
                  <article
                    key={`quest-${index}-${quest.title}`}
                    className="rounded-3xl border border-zinc-800 bg-black p-5"
                  >
                    <FieldShell label={`Quest ${index + 1} Title`}>
                      <input
                        className={inputClassName()}
                        value={quest.title}
                        onChange={(event) => updateQuest(index, "title", event.target.value)}
                      />
                    </FieldShell>
                    <FieldShell label="Summary">
                      <textarea
                        className={`${inputClassName(true)} mt-4`}
                        value={quest.summary}
                        onChange={(event) => updateQuest(index, "summary", event.target.value)}
                      />
                    </FieldShell>
                  </article>
                ))}
              </section>

              <section className="mt-6 space-y-4">
                <h2 className="text-lg font-semibold text-white">NPCs</h2>
                {secretEngine.npcs.map((npc, index) => (
                  <article
                    key={`npc-${index}-${npc.name}`}
                    className="rounded-3xl border border-zinc-800 bg-black p-5"
                  >
                    <div className="grid gap-4 md:grid-cols-2">
                      <FieldShell label="Name">
                        <input
                          className={inputClassName()}
                          value={npc.name}
                          onChange={(event) => updateNpc(index, "name", event.target.value)}
                        />
                      </FieldShell>
                      <FieldShell label="Role">
                        <input
                          className={inputClassName()}
                          value={npc.role}
                          onChange={(event) => updateNpc(index, "role", event.target.value)}
                        />
                      </FieldShell>
                    </div>
                    <FieldShell label="Notes">
                      <textarea
                        className={`${inputClassName(true)} mt-4`}
                        value={npc.notes}
                        onChange={(event) => updateNpc(index, "notes", event.target.value)}
                      />
                    </FieldShell>
                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                      <FieldShell label="Personal Hook">
                        <input
                          className={inputClassName()}
                          value={npc.personalHook ?? ""}
                          onChange={(event) => updateNpc(index, "personalHook", event.target.value)}
                        />
                      </FieldShell>
                      <FieldShell label="Status">
                        <input
                          className={inputClassName()}
                          value={npc.status ?? ""}
                          onChange={(event) => updateNpc(index, "status", event.target.value)}
                        />
                      </FieldShell>
                    </div>
                  </article>
                ))}
              </section>

              <section className="mt-6 space-y-4">
                <h2 className="text-lg font-semibold text-white">Clues</h2>
                {secretEngine.clues.map((clue, index) => (
                  <article
                    key={`clue-${index}-${clue.text}`}
                    className="rounded-3xl border border-zinc-800 bg-black p-5"
                  >
                    <FieldShell label="Clue Text">
                      <textarea
                        className={inputClassName(true)}
                        value={clue.text}
                        onChange={(event) => updateClue(index, "text", event.target.value)}
                      />
                    </FieldShell>
                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                      <FieldShell label="Source">
                        <input
                          className={inputClassName()}
                          value={clue.source}
                          onChange={(event) => updateClue(index, "source", event.target.value)}
                        />
                      </FieldShell>
                      <FieldShell label="Linked Reveal Title">
                        <input
                          className={inputClassName()}
                          value={clue.linkedRevealTitle}
                          onChange={(event) =>
                            updateClue(index, "linkedRevealTitle", event.target.value)
                          }
                        />
                      </FieldShell>
                    </div>
                  </article>
                ))}
              </section>

              <section className="mt-6 space-y-4">
                <h2 className="text-lg font-semibold text-white">Key Locations</h2>
                {secretEngine.keyLocations.map((location, index) => (
                  <article
                    key={`key-location-${index}-${location.name}`}
                    className="rounded-3xl border border-zinc-800 bg-black p-5"
                  >
                    <div className="grid gap-4 md:grid-cols-2">
                      <FieldShell label="Name">
                        <input
                          className={inputClassName()}
                          value={location.name}
                          onChange={(event) => updateKeyLocation(index, "name", event.target.value)}
                        />
                      </FieldShell>
                      <FieldShell label="Role">
                        <input
                          className={inputClassName()}
                          value={location.role}
                          onChange={(event) => updateKeyLocation(index, "role", event.target.value)}
                        />
                      </FieldShell>
                    </div>
                    <label className="mt-4 flex items-center gap-3 text-sm text-zinc-300">
                      <input
                        type="checkbox"
                        checked={location.isPublic}
                        onChange={(event) =>
                          updateKeyLocation(index, "isPublic", event.target.checked)
                        }
                      />
                      Public from the start
                    </label>
                  </article>
                ))}
              </section>
            </section>
          ) : null}
        </div>

        <div className="sticky bottom-0 z-20 border-t border-zinc-800 bg-black/95 backdrop-blur">
          <div className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-4 sm:px-6 md:flex-row md:items-end">
            <div className="min-w-0 flex-1">
              <FieldShell label="Refine This Draft">
                <input
                  className={inputClassName()}
                  value={followUpPrompt}
                  onChange={(event) => setFollowUpPrompt(event.target.value)}
                  placeholder="Tweak this module..."
                />
              </FieldShell>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap md:shrink-0 md:justify-end">
              <button
                className="button-press w-full rounded-full border border-zinc-700 px-5 py-3 text-sm font-semibold text-zinc-100 hover:bg-zinc-900 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                onClick={() => void generateDraft(followUpPrompt, draft)}
                disabled={drafting || savingModule || !followUpPrompt.trim()}
              >
                {drafting ? "Updating..." : "Update"}
              </button>
              <button
                className="button-press w-full rounded-full border border-zinc-700 px-5 py-3 text-sm font-semibold text-zinc-100 hover:bg-zinc-900 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                onClick={() => {
                  setDraft(null);
                  setShowAdvanced(false);
                  setFollowUpPrompt("");
                }}
                disabled={drafting || savingModule}
              >
                Back to Library
              </button>
              <button
                className="button-press w-full rounded-full bg-white px-5 py-3 text-sm font-semibold text-black hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                onClick={() => void saveDraftAsModule()}
                disabled={drafting || savingModule}
              >
                {savingModule ? "Saving Module..." : "Save Module"}
              </button>
            </div>
          </div>
          {error ? <p className="mx-auto max-w-5xl px-6 pb-4 text-sm text-red-400">{error}</p> : null}
        </div>
      </main>
    );
  }

  return (
    <main className="h-screen overflow-y-scroll bg-black text-zinc-50">
      <div className="mx-auto max-w-6xl px-6 py-16">
        <section className="rounded-[2rem] border border-zinc-800 bg-zinc-950 p-8 shadow-[0_0_0_1px_rgba(24,24,27,0.4)]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[0.68rem] uppercase tracking-[0.28em] text-zinc-500">Session Zero</p>
              <h1 className="mt-4 text-4xl font-semibold tracking-tight text-white">
                Launch the next adventure.
              </h1>
              <p className="mt-4 max-w-3xl text-sm leading-7 text-zinc-400">
                Save a reusable world module first, choose the hero stepping into it next, then
                start a fresh campaign from that combination.
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                className="button-press rounded-full border border-zinc-800 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-200 hover:bg-black"
                onClick={() => router.push("/")}
              >
                Home
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

          <section className="mt-10">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[0.68rem] uppercase tracking-[0.24em] text-zinc-500">
                  Step 1: Choose or Draft Module
                </p>
                <p className="mt-2 text-sm text-zinc-400">
                  Saved modules are replay-only in v1. Draft a new one if you want to revise the world.
                </p>
              </div>
            </div>

            <div className="mt-6 grid gap-6 lg:grid-cols-[1.35fr,0.95fr]">
              <div>
                {modulesLoading ? (
                  <div className="rounded-3xl border border-zinc-800 bg-black p-6 text-sm text-zinc-400">
                    Loading saved modules...
                  </div>
                ) : modules.length ? (
                  <div className="grid gap-4">
                    {modules.map((module) => (
                      <ModuleCard
                        key={module.id}
                        module={module}
                        selected={module.id === selectedModuleId}
                        onSelect={() => setSelectedModuleId(module.id)}
                        onDelete={() => void deleteModule(module)}
                        deleting={deletingModuleId === module.id}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="rounded-3xl border border-zinc-800 bg-black p-6 text-sm leading-7 text-zinc-400">
                    No reusable modules yet. Draft one below to seed your library.
                  </div>
                )}
              </div>

              <div className="rounded-3xl border border-zinc-800 bg-black p-6">
                <p className="text-[0.68rem] uppercase tracking-[0.22em] text-zinc-500">Draft New Module</p>
                <p className="mt-3 text-sm leading-7 text-zinc-400">
                  Describe the world, tone, or rule constraints you want. The first pass stays
                  spoiler-safe, then you can open the DM screen and save the result into your module library.
                </p>
                <p className="mt-3 text-sm leading-7 text-zinc-500">
                  Drafts are character-agnostic by default. Choose the hero only when you launch a
                  specific campaign from a saved module.
                </p>
                <FieldShell label="Module Brief">
                  <textarea
                    className={`${inputClassName(true)} mt-6 min-h-48`}
                    value={prompt}
                    onChange={(event) => setPrompt(event.target.value)}
                    placeholder="Describe the world, tone, or special constraints..."
                  />
                </FieldShell>
                <button
                  className="button-press mt-6 rounded-full bg-white px-6 py-3 text-sm font-semibold tracking-wide text-black hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={() => void generateDraft(prompt)}
                  disabled={drafting || !prompt.trim()}
                >
                  {drafting ? "Drafting Module..." : "Draft Module"}
                </button>
                {selectedModule ? (
                  <div className="mt-6 rounded-3xl border border-zinc-800 bg-zinc-950 p-5">
                    <p className="text-[0.68rem] uppercase tracking-[0.22em] text-zinc-500">Selected Module</p>
                    <h2 className="mt-3 text-2xl font-semibold text-white">{selectedModule.title}</h2>
                    <p className="mt-3 text-sm leading-7 text-zinc-300">{selectedModule.premise}</p>
                    <div className="mt-4 grid gap-3 text-sm text-zinc-400 md:grid-cols-2">
                      <p>{selectedModule.setting}</p>
                      <p>{selectedModule.tone}</p>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </section>

          <section className="mt-10">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[0.68rem] uppercase tracking-[0.24em] text-zinc-500">
                  Step 2: Choose Character
                </p>
                <p className="mt-2 text-sm text-zinc-400">
                  Pick the template that will enter the selected module.
                </p>
              </div>
            </div>

            {charactersLoading ? (
              <div className="mt-6 rounded-3xl border border-zinc-800 bg-black p-6 text-sm text-zinc-400">
                Loading saved characters...
              </div>
            ) : characters.length ? (
              <div className="mt-6 grid gap-4 md:grid-cols-2">
                {characters.map((character) => (
                  <CharacterCard
                    key={character.id}
                    character={character}
                    selected={character.id === selectedTemplateId}
                    onSelect={() => setSelectedTemplateId(character.id)}
                    onDelete={() => void deleteCharacter(character)}
                    deleting={deletingTemplateId === character.id}
                  />
                ))}
              </div>
            ) : (
              <div className="mt-6 rounded-3xl border border-zinc-800 bg-black p-6">
                <p className="text-sm leading-7 text-zinc-400">
                  You can draft modules without a hero, but you need at least one saved character before you can launch.
                </p>
                <button
                  type="button"
                  className="button-press mt-4 rounded-full bg-white px-5 py-3 text-sm font-semibold text-black hover:bg-zinc-200"
                  onClick={() => router.push("/characters")}
                >
                  Build Your First Character
                </button>
              </div>
            )}
          </section>

          <section className="mt-10 rounded-3xl border border-zinc-800 bg-black p-6">
            <p className="text-[0.68rem] uppercase tracking-[0.24em] text-zinc-500">Step 3: Campaign Setup</p>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <div className="rounded-3xl border border-zinc-800 bg-zinc-950 p-5">
                <p className="text-[0.68rem] uppercase tracking-[0.18em] text-zinc-500">Module</p>
                <h2 className="mt-3 text-xl font-semibold text-white">
                  {selectedModule?.title ?? "Choose a module"}
                </h2>
                <p className="mt-3 text-sm leading-7 text-zinc-400">
                  {selectedModule?.premise ??
                    "Pick a saved module or draft a new one before continuing to campaign setup."}
                </p>
              </div>
              <div className="rounded-3xl border border-zinc-800 bg-zinc-950 p-5">
                <p className="text-[0.68rem] uppercase tracking-[0.18em] text-zinc-500">Character</p>
                <h2 className="mt-3 text-xl font-semibold text-white">
                  {selectedCharacter?.name ?? "Choose a character"}
                </h2>
                <p className="mt-3 text-sm leading-7 text-zinc-400">
                  {selectedCharacter
                    ? `${selectedCharacter.archetype} with ${selectedCharacter.maxHealth} max health.`
                    : "Select the character template that should enter this module."}
                </p>
              </div>
            </div>
            <button
              className="button-press mt-6 rounded-full bg-white px-6 py-3 text-sm font-semibold tracking-wide text-black hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-60"
              onClick={() => void continueToCampaignSetup()}
              disabled={continuing || !selectedModule || !selectedCharacter}
            >
              {continuing ? "Opening Campaign Setup..." : "Continue to Campaign Setup"}
            </button>
          </section>

          {error ? <p className="mt-6 text-sm text-red-400">{error}</p> : null}
        </section>
      </div>
    </main>
  );
}
