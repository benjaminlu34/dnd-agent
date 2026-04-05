"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Plus } from "lucide-react";
import type { CharacterConceptSummary, CharacterTemplateSummary } from "@/lib/game/types";
import { backOrPush } from "@/lib/ui/navigation";

function LibraryCharacterCard({
  character,
  deleting,
  onEdit,
  onDelete,
}: {
  character: CharacterTemplateSummary;
  deleting: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <article
      role="button"
      tabIndex={0}
      onClick={onEdit}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onEdit();
        }
      }}
      className="group relative flex min-h-[320px] cursor-pointer flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/40 p-6 transition-all hover:border-zinc-700 hover:bg-zinc-900/40"
    >
      <span className="pointer-events-none absolute right-4 top-4 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
        <ArrowUpRight className="h-4 w-4 text-white" strokeWidth={1.7} />
      </span>

      <div className="min-w-0 pr-8">
          <p className="text-[10px] font-medium uppercase tracking-widest text-zinc-500">
            Character Template
          </p>
          <h2 className="mt-3 truncate text-xl font-medium tracking-tight text-zinc-100 transition-colors group-hover:text-white">
            {character.name}
          </h2>
        <p className="mt-1 text-[10px] uppercase tracking-widest text-zinc-500">
          {character.archetype}
        </p>
      </div>

      <div className="my-5 grid grid-cols-5 gap-2 border-y border-zinc-800/50 py-4">
        {[
          ["VIT", character.vitality],
          ["MODULE", (character.moduleId ?? "module").slice(0, 6)],
          ["FRAME", (character.frameworkVersion ?? "frame").slice(0, 6)],
          ["GOAL", (character.drivingGoal ?? "Unset").slice(0, 6)],
          ["SRC", character.sourceConceptId ? "Concept" : "Direct"]
        ].map(([label, value]) => (
          <div key={String(label)} className="flex flex-col items-center">
            <span className="text-[10px] text-zinc-600">{label}</span>
            <span className="font-mono text-sm text-zinc-200">{value}</span>
          </div>
        ))}
      </div>

      <div className="relative min-h-[2.25rem]">
        <p className="line-clamp-2 text-xs leading-relaxed text-zinc-500 italic">
          {character.backstory || "No backstory recorded yet."}
        </p>
      </div>

      <div className="mt-auto flex items-center justify-between gap-3 pt-4">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onDelete();
          }}
          disabled={deleting}
          className="button-press shrink-0 rounded-full border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-red-200 hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {deleting ? "Deleting..." : "Delete"}
        </button>
        <span className="rounded-full border border-zinc-800 px-2 py-0.5 text-[10px] text-zinc-600">
          {character.vitality} VIT
        </span>
      </div>
    </article>
  );
}

function LibraryConceptCard({
  concept,
  deleting,
  onEdit,
  onAdapt,
  onDelete,
}: {
  concept: CharacterConceptSummary;
  deleting: boolean;
  onEdit: () => void;
  onAdapt: () => void;
  onDelete: () => void;
}) {
  return (
    <article className="relative flex min-h-[260px] flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/20 p-6">
      <div className="pr-8">
        <p className="text-[10px] font-medium uppercase tracking-widest text-zinc-500">
          Character Concept
        </p>
        <h2 className="mt-3 truncate text-xl font-medium tracking-tight text-zinc-100">
          {concept.name}
        </h2>
        <p className="mt-2 text-xs leading-relaxed text-zinc-500 italic">
          {concept.drivingGoal || "No driving goal recorded yet."}
        </p>
      </div>

      <p className="mt-5 line-clamp-3 text-sm leading-relaxed text-zinc-400">
        {concept.backstory || "No backstory recorded yet."}
      </p>

      <div className="mt-auto flex flex-wrap items-center gap-3 pt-6">
        <button
          type="button"
          onClick={onEdit}
          className="button-press rounded-full border border-zinc-800 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-200 hover:bg-zinc-900"
        >
          Edit Concept
        </button>
        <button
          type="button"
          onClick={onAdapt}
          className="button-press rounded-full border border-zinc-800 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-200 hover:bg-zinc-900"
        >
          Adapt to Module
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={deleting}
          className="button-press rounded-full border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-red-200 hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {deleting ? "Deleting..." : "Delete"}
        </button>
      </div>
    </article>
  );
}

export function CharactersLibraryApp() {
  const router = useRouter();
  const [characters, setCharacters] = useState<CharacterTemplateSummary[]>([]);
  const [concepts, setConcepts] = useState<CharacterConceptSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingTemplateId, setDeletingTemplateId] = useState<string | null>(null);
  const [deletingConceptId, setDeletingConceptId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function loadCharacters() {
      setLoading(true);

      try {
        const response = await fetch("/api/characters");
        const data = (await response.json()) as {
          characters?: CharacterTemplateSummary[];
          concepts?: CharacterConceptSummary[];
          error?: string;
        };

        if (!response.ok) {
          throw new Error(data.error ?? "Failed to load characters.");
        }

        if (active) {
          setCharacters(data.characters ?? []);
          setConcepts(data.concepts ?? []);
        }
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load characters.");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void loadCharacters();

    return () => {
      active = false;
    };
  }, []);

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

      const data = (await response.json()) as { templateId?: string; error?: string };

      if (!response.ok || !data.templateId) {
        throw new Error(data.error ?? "Failed to delete character.");
      }

      setCharacters((current) => current.filter((entry) => entry.id !== template.id));
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Failed to delete character.");
    } finally {
      setDeletingTemplateId(null);
    }
  }

  async function deleteConcept(concept: CharacterConceptSummary) {
    const confirmed = window.confirm(`Delete ${concept.name}?`);
    if (!confirmed || deletingConceptId) {
      return;
    }

    setDeletingConceptId(concept.id);
    setError(null);

    try {
      const response = await fetch(`/api/characters/concepts/${concept.id}`, {
        method: "DELETE",
      });
      const data = (await response.json()) as { conceptId?: string; error?: string };

      if (!response.ok || !data.conceptId) {
        throw new Error(data.error ?? "Failed to delete concept.");
      }

      setConcepts((current) => current.filter((entry) => entry.id !== concept.id));
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Failed to delete concept.");
    } finally {
      setDeletingConceptId(null);
    }
  }

  return (
    <main className="app-shell">
      <div className="app-frame max-w-6xl">
        <header className="app-hero p-8">
          <p className="text-[10px] font-medium uppercase tracking-widest text-zinc-500">
            Character Library
          </p>
          <div className="mt-4 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h1 className="text-4xl font-medium tracking-tight text-zinc-100 md:text-5xl">
                Manage your cast.
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-relaxed text-zinc-400">
                Save reusable character templates, prune old ones, and head into Session Zero with the right protagonist.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                className="button-press rounded-md border border-zinc-800 px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-900 hover:text-white"
                onClick={() => backOrPush(router, "/", "/")}
              >
                Back Home
              </button>
              <button
                type="button"
                className="button-press rounded-md border border-zinc-800 px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-900 hover:text-white"
                onClick={() => router.push("/campaigns/new")}
              >
                Draft New Campaign
              </button>
              <button
                type="button"
                className="button-press inline-flex items-center gap-2 rounded-md bg-white px-4 py-2 text-sm font-medium text-black transition-colors hover:bg-zinc-200"
                onClick={() => router.push("/characters/new")}
              >
                <Plus className="h-4 w-4" strokeWidth={1.8} />
                Draft New Character
              </button>
            </div>
          </div>
        </header>

        {error ? <p className="mt-6 text-sm text-red-400">{error}</p> : null}

        <section className="mt-8">
          {concepts.length ? (
            <div className="mb-8">
              <div className="mb-4">
                <p className="text-[10px] font-medium uppercase tracking-widest text-zinc-500">
                  Standalone Concepts
                </p>
                <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-500">
                  Narrative blueprints stay module-free until you adapt them into a playable template.
                </p>
              </div>
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                {concepts.map((concept) => (
                  <LibraryConceptCard
                    key={concept.id}
                    concept={concept}
                    deleting={deletingConceptId === concept.id}
                    onEdit={() => router.push(`/characters/new?mode=concept&conceptId=${concept.id}`)}
                    onAdapt={() => router.push(`/characters/new?mode=adapt&conceptId=${concept.id}`)}
                    onDelete={() => void deleteConcept(concept)}
                  />
                ))}
              </div>
            </div>
          ) : null}

          {loading ? (
            <div className="app-section p-8 text-sm text-zinc-400">
              Loading characters...
            </div>
          ) : characters.length ? (
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
              {characters.map((character) => (
                <LibraryCharacterCard
                  key={character.id}
                  character={character}
                  deleting={deletingTemplateId === character.id}
                  onEdit={() => router.push(`/characters/${character.id}/edit`)}
                  onDelete={() => void deleteCharacter(character)}
                />
              ))}
            </div>
          ) : (
            <div className="app-section flex flex-col items-center justify-center p-10 text-center">
              <p className="text-[10px] font-medium uppercase tracking-widest text-zinc-500">
                Empty Library
              </p>
              <h2 className="mt-4 text-3xl font-medium tracking-tight text-zinc-100">
                Every saga needs a hero
              </h2>
              <p className="mt-3 max-w-xl text-sm italic leading-relaxed text-zinc-600">
                Draft a character template and give your next campaign someone worth following into the dark.
              </p>
              <button
                type="button"
                className="button-press mt-6 rounded-full bg-white px-5 py-3 text-sm font-semibold text-black transition-colors hover:bg-zinc-200"
                onClick={() => router.push("/characters/new")}
              >
                Draft a New Character
              </button>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
