"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { GeneratedCampaignSetup } from "@/lib/game/types";

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

export function SessionZeroApp() {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [followUpPrompt, setFollowUpPrompt] = useState("");
  const [draft, setDraft] = useState<GeneratedCampaignSetup | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateDraft(updater: (current: GeneratedCampaignSetup) => GeneratedCampaignSetup) {
    setDraft((current) => (current ? updater(current) : current));
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
                  field === "expectedTurns" ? Math.max(1, Number.parseInt(value || "1", 10) || 1) : value,
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

  function updateNpc(index: number, field: "name" | "role" | "notes" | "personalHook" | "status", value: string) {
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

  function updateClue(index: number, field: "text" | "source" | "linkedRevealTitle", value: string) {
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

  function updateLocation(index: number, value: string) {
    updateDraft((current) => ({
      ...current,
      secretEngine: {
        ...current.secretEngine,
        locations: current.secretEngine.locations.map((location, locationIndex) =>
          locationIndex === index ? value : location,
        ),
      },
    }));
  }

  async function generateDraft(nextPrompt: string, previousDraft?: GeneratedCampaignSetup) {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/campaigns/draft", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt: nextPrompt,
          previousDraft,
        }),
      });

      const data = (await response.json()) as {
        draft?: GeneratedCampaignSetup;
        error?: string;
      };

      if (!response.ok || !data.draft) {
        throw new Error(data.error ?? "Failed to generate a campaign draft.");
      }

      setDraft(data.draft);
      setShowAdvanced(false);
      setFollowUpPrompt("");
    } catch (draftError) {
      setError(draftError instanceof Error ? draftError.message : "Failed to generate campaign draft.");
    } finally {
      setLoading(false);
    }
  }

  async function confirmDraft() {
    if (!draft || saving) {
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const response = await fetch("/api/campaigns/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ draft }),
      });

      const data = (await response.json()) as { campaignId?: string; error?: string };

      if (!response.ok || !data.campaignId) {
        throw new Error(data.error ?? "Failed to create campaign.");
      }

      router.push(`/play/${data.campaignId}`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to create campaign.");
    } finally {
      setSaving(false);
    }
  }

  if (!draft) {
    return (
      <main className="min-h-screen bg-black text-zinc-50">
        <div className="mx-auto flex min-h-screen max-w-5xl items-center px-6 py-16">
          <section className="mx-auto w-full max-w-xl rounded-[2rem] border border-zinc-800 bg-zinc-950 p-8 shadow-[0_0_0_1px_rgba(24,24,27,0.4)]">
            <p className="text-[0.68rem] uppercase tracking-[0.28em] text-zinc-500">Session Zero</p>
            <h1 className="mt-4 text-4xl font-semibold tracking-tight text-white">Shape the next adventure.</h1>
            <p className="mt-4 text-sm leading-7 text-zinc-400">
              Describe the world, tone, or rule constraints you want. The first pass stays spoiler-safe. You can
              reveal the deeper machinery only if you want to tune it.
            </p>

            <FieldShell label="Campaign Premise">
              <textarea
                className={`${inputClassName(true)} mt-6 min-h-48`}
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="Describe the world, tone, or rule constraints..."
              />
            </FieldShell>

            <button
              className="button-press mt-6 rounded-full bg-white px-6 py-3 text-sm font-semibold tracking-wide text-black hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-60"
              onClick={() => void generateDraft(prompt)}
              disabled={loading || !prompt.trim()}
            >
              {loading ? "Drafting Campaign..." : "Draft Campaign"}
            </button>

            {error ? <p className="mt-4 text-sm text-red-400">{error}</p> : null}
          </section>
        </div>
      </main>
    );
  }

  const { publicSynopsis, secretEngine } = draft;

  return (
    <main className="min-h-screen bg-black pb-40 text-zinc-50">
      <div className="mx-auto w-full max-w-5xl px-6 py-12">
        <header className="rounded-[2rem] border border-zinc-800 bg-zinc-950 p-8">
          <p className="text-[0.68rem] uppercase tracking-[0.28em] text-zinc-500">The Pitch</p>
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
          <section className="mt-6 rounded-3xl border border-zinc-800 bg-black p-5">
            <h2 className="text-sm uppercase tracking-[0.22em] text-zinc-500">Opening Scene</h2>
            <h3 className="mt-3 text-xl font-semibold text-white">{publicSynopsis.openingScene.title}</h3>
            <p className="mt-2 text-sm text-zinc-500">{publicSynopsis.openingScene.location}</p>
            <p className="mt-4 text-sm leading-7 text-zinc-200">{publicSynopsis.openingScene.summary}</p>
            <p className="mt-4 text-sm leading-7 text-zinc-400">{publicSynopsis.openingScene.atmosphere}</p>
            <div className="mt-5 rounded-2xl border border-zinc-800 bg-zinc-950 p-4">
              <p className="text-[0.68rem] uppercase tracking-[0.22em] text-zinc-500">Starting Hook</p>
              <p className="mt-2 text-sm leading-7 text-zinc-200">{publicSynopsis.openingScene.activeThreat}</p>
            </div>
          </section>
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
                    onChange={(event) => updateVillain("progressClock", Number.parseInt(event.target.value || "0", 10) || 0)}
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
                <article key={`arc-${index}-${arc.title}`} className="rounded-3xl border border-zinc-800 bg-black p-5">
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
                <article key={`reveal-${index}-${reveal.title}`} className="rounded-3xl border border-zinc-800 bg-black p-5">
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
                <article key={`quest-${index}-${quest.title}`} className="rounded-3xl border border-zinc-800 bg-black p-5">
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
                <article key={`npc-${index}-${npc.name}`} className="rounded-3xl border border-zinc-800 bg-black p-5">
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
                <article key={`clue-${index}-${clue.text}`} className="rounded-3xl border border-zinc-800 bg-black p-5">
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
                        onChange={(event) => updateClue(index, "linkedRevealTitle", event.target.value)}
                      />
                    </FieldShell>
                  </div>
                </article>
              ))}
            </section>

            <section className="mt-6 space-y-4">
              <h2 className="text-lg font-semibold text-white">Locations</h2>
              {secretEngine.locations.map((location, index) => (
                <FieldShell key={`location-${index}-${location}`} label={`Location ${index + 1}`}>
                  <input
                    className={inputClassName()}
                    value={location}
                    onChange={(event) => updateLocation(index, event.target.value)}
                  />
                </FieldShell>
              ))}
            </section>
          </section>
        ) : null}
      </div>

      <div className="fixed inset-x-0 bottom-0 border-t border-zinc-800 bg-black/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl flex-col gap-4 px-6 py-4 md:flex-row md:items-end">
          <FieldShell label="Refine This Draft">
            <input
              className={inputClassName()}
              value={followUpPrompt}
              onChange={(event) => setFollowUpPrompt(event.target.value)}
              placeholder="Tweak this draft..."
            />
          </FieldShell>
          <div className="flex shrink-0 gap-3">
            <button
              className="button-press rounded-full border border-zinc-700 px-5 py-3 text-sm font-semibold text-zinc-100 hover:bg-zinc-900 disabled:cursor-not-allowed disabled:opacity-60"
              onClick={() => void generateDraft(followUpPrompt, draft)}
              disabled={loading || saving || !followUpPrompt.trim()}
            >
              {loading ? "Updating..." : "Update"}
            </button>
            <button
              className="button-press rounded-full bg-white px-5 py-3 text-sm font-semibold text-black hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-60"
              onClick={() => void confirmDraft()}
              disabled={loading || saving}
            >
              {saving ? "Starting Adventure..." : "Confirm & Start Adventure"}
            </button>
          </div>
        </div>
        {error ? <p className="mx-auto max-w-5xl px-6 pb-4 text-sm text-red-400">{error}</p> : null}
      </div>
    </main>
  );
}
