"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Plus } from "lucide-react";
import type { CharacterTemplateSummary } from "@/lib/game/types";

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
      className="group relative flex h-[320px] cursor-pointer flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/50 p-5 transition-[border-color,transform] duration-200 hover:scale-[1.02] hover:border-zinc-400"
    >
      <span className="pointer-events-none absolute right-4 top-4 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
        <ArrowUpRight className="h-4 w-4 text-white" strokeWidth={1.7} />
      </span>

      <div className="min-w-0 pr-8">
          <p className="text-[0.68rem] uppercase tracking-[0.22em] text-zinc-500">Character Template</p>
          <h2 className="mt-3 truncate text-xl font-medium tracking-tight text-zinc-100 transition-colors group-hover:text-white">
            {character.name}
          </h2>
        <p className="mt-1 text-xs uppercase tracking-widest text-zinc-500 italic">{character.archetype}</p>
      </div>

      <div className="my-3 grid grid-cols-5 gap-1 border-y border-zinc-800/50 py-3">
        {[
          ["STR", character.strength],
          ["AGI", character.agility],
          ["INT", character.intellect],
          ["CHA", character.charisma],
          ["VIT", character.vitality],
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
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-zinc-950/80 to-transparent" />
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
          MAX HP {character.maxHealth}
        </span>
      </div>
    </article>
  );
}

export function CharactersLibraryApp() {
  const router = useRouter();
  const [characters, setCharacters] = useState<CharacterTemplateSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingTemplateId, setDeletingTemplateId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function loadCharacters() {
      setLoading(true);

      try {
        const response = await fetch("/api/characters");
        const data = (await response.json()) as {
          characters?: CharacterTemplateSummary[];
          error?: string;
        };

        if (!response.ok) {
          throw new Error(data.error ?? "Failed to load characters.");
        }

        if (active) {
          setCharacters(data.characters ?? []);
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

  return (
    <main className="h-screen overflow-y-auto bg-black text-zinc-50">
      <div className="mx-auto w-full max-w-6xl px-4 py-8">
        <header className="rounded-[2rem] border border-zinc-800 bg-zinc-950 p-8">
          <p className="text-[0.68rem] uppercase tracking-[0.28em] text-zinc-500">Character Library</p>
          <div className="mt-4 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <button
                type="button"
                className="button-press text-xs uppercase tracking-[0.22em] text-zinc-500 transition-colors hover:text-zinc-200"
                onClick={() => router.push("/")}
              >
                Home
              </button>
              <h1 className="text-4xl font-semibold tracking-tight text-white">Manage your cast.</h1>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-zinc-400">
                Save reusable character templates, prune old ones, and head into Session Zero with the right protagonist.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                className="button-press rounded-md border border-zinc-800 bg-transparent px-4 py-2 text-sm font-medium text-zinc-500 shadow-sm transition-colors hover:bg-zinc-900 hover:text-zinc-200"
                onClick={() => router.push("/campaigns/new")}
              >
                Draft New Campaign
              </button>
              <button
                type="button"
                className="button-press inline-flex items-center gap-2 rounded-md bg-white px-4 py-2 text-sm font-medium text-black shadow-[0_0_20px_rgba(255,255,255,0.1)] transition-colors hover:bg-zinc-200"
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
          {loading ? (
            <div className="rounded-[2rem] border border-zinc-800 bg-zinc-950 p-8 text-sm text-zinc-400">
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
            <div className="flex flex-col items-center justify-center rounded-[2rem] border border-zinc-800 bg-zinc-950 p-10 text-center">
              <p className="text-[0.68rem] uppercase tracking-[0.22em] text-zinc-500">Empty Library</p>
              <h2 className="mt-4 text-3xl font-medium tracking-tight text-zinc-100">
                Every saga needs a hero
              </h2>
              <p className="mt-3 max-w-xl text-sm leading-7 text-zinc-500">
                Draft a character template and give your next campaign someone worth following into the dark.
              </p>
              <button
                type="button"
                className="button-press mt-6 rounded-full bg-white px-5 py-3 text-sm font-semibold text-black hover:bg-zinc-200"
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
