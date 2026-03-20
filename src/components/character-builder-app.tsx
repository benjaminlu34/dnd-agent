"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { MAX_STARTER_ITEMS } from "@/lib/game/item-utils";
import type { CharacterTemplate } from "@/lib/game/types";
import { backOrPush } from "@/lib/ui/navigation";

type CharacterFormValues = {
  name: string;
  archetype: string;
  strength: number;
  dexterity: number;
  constitution: number;
  intelligence: number;
  wisdom: number;
  charisma: number;
  maxHealth: number;
  backstory: string;
  starterItems: string[];
};

type CharacterGenerationResponse = {
  character?: CharacterFormValues & { backstory?: string | null; starterItems?: string[] };
  source?: "openrouter";
  error?: string;
};

const defaultValues: CharacterFormValues = {
  name: "",
  archetype: "",
  strength: 1,
  dexterity: 1,
  constitution: 1,
  intelligence: 1,
  wisdom: 1,
  charisma: 1,
  maxHealth: 12,
  backstory: "",
  starterItems: [],
};

function fieldClassName(multiline = false) {
  return [
    "w-full rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-sm text-zinc-100 outline-none transition-colors",
    "placeholder:text-zinc-600 focus:border-zinc-700 focus:bg-zinc-950",
    multiline ? "min-h-32 resize-y leading-7" : "",
  ].join(" ");
}

function BuilderField({
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

type CharacterBuilderAppProps = {
  initialCharacter?: CharacterTemplate | null;
  mode?: "create" | "edit";
};

export function CharacterBuilderApp({
  initialCharacter = null,
  mode = "create",
}: CharacterBuilderAppProps) {
  const router = useRouter();
  const [generationPrompt, setGenerationPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generationSource, setGenerationSource] = useState<"openrouter" | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors },
  } = useForm<CharacterFormValues>({
    defaultValues,
  });

  useEffect(() => {
    if (!initialCharacter) {
      reset(defaultValues);
      return;
    }

    reset({
      name: initialCharacter.name,
      archetype: initialCharacter.archetype,
      strength: initialCharacter.strength,
      dexterity: initialCharacter.dexterity,
      constitution: initialCharacter.constitution,
      intelligence: initialCharacter.intelligence,
      wisdom: initialCharacter.wisdom,
      charisma: initialCharacter.charisma,
      maxHealth: initialCharacter.maxHealth,
      backstory: initialCharacter.backstory ?? "",
      starterItems: initialCharacter.starterItems,
    });
  }, [initialCharacter, reset]);

  const values = watch();
  const starterItems = values.starterItems ?? [];

  function adjustNumberField(field: keyof Pick<
    CharacterFormValues,
    | "strength"
    | "dexterity"
    | "constitution"
    | "intelligence"
    | "wisdom"
    | "charisma"
    | "maxHealth"
  >, delta: number) {
    const current = Number(values[field] ?? 0);
    const nextValue =
      field === "maxHealth"
        ? Math.max(1, Math.min(99, current + delta))
        : Math.max(-5, Math.min(10, current + delta));
    setValue(field, nextValue, { shouldDirty: true, shouldValidate: true });
  }

  async function handleGenerate() {
    if (!generationPrompt.trim() || generating) {
      return;
    }

    setGenerating(true);
    setError(null);

    try {
      const response = await fetch("/api/characters/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ prompt: generationPrompt }),
      });

      const data = (await response.json()) as CharacterGenerationResponse;

      if (!response.ok || !data.character) {
        throw new Error(data.error ?? "Failed to generate character.");
      }

      reset({
        ...data.character,
        backstory: data.character.backstory ?? "",
        starterItems: data.character.starterItems ?? [],
      });
      setGenerationSource(data.source ?? null);
    } catch (generationError) {
      setGenerationSource(null);
      setError(
        generationError instanceof Error ? generationError.message : "Failed to generate character.",
      );
    } finally {
      setGenerating(false);
    }
  }

  const onSubmit = handleSubmit(async (formValues) => {
    if (saving) {
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const endpoint = mode === "edit" && initialCharacter
        ? `/api/characters/${initialCharacter.id}`
        : "/api/characters/create";
      const result = await fetch(endpoint, {
        method: mode === "edit" && initialCharacter ? "PATCH" : "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(formValues),
      });

      const data = (await result.json()) as { templateId?: string; error?: string };

      if (!result.ok || !data.templateId) {
        throw new Error(data.error ?? "Failed to save character.");
      }

      router.push(mode === "edit" ? "/characters" : "/campaigns/new");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save character.");
    } finally {
      setSaving(false);
    }
  });

  const numericFields: Array<{
    name: keyof Pick<
      CharacterFormValues,
      | "strength"
      | "dexterity"
      | "constitution"
      | "intelligence"
      | "wisdom"
      | "charisma"
      | "maxHealth"
    >;
    label: string;
  }> = [
    { name: "strength", label: "Strength" },
    { name: "dexterity", label: "Dexterity" },
    { name: "constitution", label: "Constitution" },
    { name: "intelligence", label: "Intelligence" },
    { name: "wisdom", label: "Wisdom" },
    { name: "charisma", label: "Charisma" },
    { name: "maxHealth", label: "Max Health" },
  ];

  function addStarterItem() {
    if (starterItems.length >= MAX_STARTER_ITEMS) {
      return;
    }

    setValue("starterItems", [...starterItems, ""], {
      shouldDirty: true,
      shouldValidate: true,
    });
  }

  function removeStarterItem(index: number) {
    setValue(
      "starterItems",
      starterItems.filter((_, itemIndex) => itemIndex !== index),
      {
        shouldDirty: true,
        shouldValidate: true,
      },
    );
  }

  return (
    <main className="app-shell">
      <div className="app-frame max-w-6xl">
        <header className="app-hero p-8">
          <p className="text-[0.68rem] uppercase tracking-[0.28em] text-zinc-500">
            {mode === "edit" ? "Character Workshop" : "Character Forge"}
          </p>
          <div className="mt-4 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h1 className="font-display text-4xl font-semibold tracking-tight text-white md:text-5xl">
                {mode === "edit" ? "Refine the hero." : "Build the hero first."}
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-zinc-400">
                {mode === "edit"
                  ? "Adjust the template, retune the stats, or rewrite the backstory before the next campaign."
                  : "Create a reusable character template for future campaigns, or let the AI sketch one out and tune it by hand."}
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                className="button-press rounded-full border border-zinc-800 px-5 py-3 text-sm font-semibold text-zinc-100 hover:bg-black"
                onClick={() =>
                  backOrPush(router, mode === "edit" ? "/" : "/characters", "/characters")
                }
              >
                {mode === "edit" ? "Home" : "Character Library"}
              </button>
              <button
                type="button"
                className="button-press rounded-full border border-zinc-800 px-5 py-3 text-sm font-semibold text-zinc-100 hover:bg-black"
                onClick={() =>
                  backOrPush(router, mode === "edit" ? "/characters" : "/campaigns/new", "/campaigns")
                }
              >
                {mode === "edit" ? "Back to Library" : "Back to Session Zero"}
              </button>
            </div>
          </div>
        </header>

        <section className="app-section mt-8 p-8">
          <p className="text-[0.68rem] uppercase tracking-[0.24em] text-zinc-500">AI Assist</p>
          <div className="mt-4 flex flex-col gap-4 lg:flex-row">
            <textarea
              className={`${fieldClassName(true)} max-h-40 min-h-24 overflow-y-auto lg:min-h-[3.5rem]`}
              value={generationPrompt}
              onChange={(event) => setGenerationPrompt(event.target.value)}
              placeholder="A grumpy dwarven blacksmith with a saint's relic hidden in his forge..."
            />
            <button
              type="button"
              className="button-press shrink-0 rounded-full bg-white px-5 py-3 text-sm font-semibold text-black hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-60"
              onClick={() => void handleGenerate()}
              disabled={generating || !generationPrompt.trim()}
            >
              {generating ? "Generating..." : "Auto-Generate with AI"}
            </button>
          </div>
          {generationSource ? (
            <div className="mt-4 flex flex-col gap-2 text-sm">
              <p className="text-zinc-400">
                Generation source:{" "}
                <span className="font-medium text-zinc-100">
                  OpenRouter AI
                </span>
              </p>
            </div>
          ) : null}
        </section>

        <form onSubmit={(event) => void onSubmit(event)} className="mt-8 grid gap-8 lg:grid-cols-[1.35fr,0.95fr]">
          <section className="app-section p-8">
            <p className="text-[0.68rem] uppercase tracking-[0.24em] text-zinc-500">Character Sheet</p>
            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <BuilderField label="Name">
                <input
                  className={fieldClassName()}
                  {...register("name", { required: "Name is required." })}
                />
              </BuilderField>
              <BuilderField label="Archetype">
                <input
                  className={fieldClassName()}
                  {...register("archetype", { required: "Archetype is required." })}
                />
              </BuilderField>
            </div>

            <BuilderField label="Backstory">
              <textarea className={`${fieldClassName(true)} mt-4`} {...register("backstory")} />
            </BuilderField>

            <div className="mt-6 rounded-3xl border border-zinc-800 bg-black p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[0.68rem] uppercase tracking-[0.22em] text-zinc-500">
                    Starter Items
                  </p>
                  <p className="mt-2 text-sm text-zinc-500">
                    Add up to {MAX_STARTER_ITEMS} simple item names. They become the character&apos;s opening gear when a campaign starts.
                  </p>
                </div>
                <button
                  type="button"
                  className="button-press rounded-full border border-zinc-800 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-200 hover:bg-zinc-950 disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={addStarterItem}
                  disabled={starterItems.length >= MAX_STARTER_ITEMS}
                >
                  Add Item
                </button>
              </div>

              <div className="mt-4 space-y-3">
                {starterItems.length ? starterItems.map((_, index) => (
                  <div key={`starter-item-${index}`} className="flex items-center gap-3">
                    <input
                      className={fieldClassName()}
                      placeholder="weathered field journal"
                      {...register(`starterItems.${index}` as const)}
                    />
                    <button
                      type="button"
                      className="button-press rounded-full border border-zinc-800 px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-300 hover:bg-zinc-950"
                      onClick={() => removeStarterItem(index)}
                    >
                      Remove
                    </button>
                  </div>
                )) : (
                  <p className="text-sm text-zinc-600">
                    No starter items yet.
                  </p>
                )}
              </div>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              {numericFields.map((field) => (
                <div key={field.name} className="rounded-3xl border border-zinc-800 bg-black p-4">
                  <p className="text-[0.68rem] uppercase tracking-[0.22em] text-zinc-500">{field.label}</p>
                  <div className="mt-4 flex items-center gap-3">
                    <button
                      type="button"
                      className="button-press rounded-full border border-zinc-800 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-950"
                      onClick={() => adjustNumberField(field.name, -1)}
                    >
                      -
                    </button>
                    <input
                      type="number"
                      className={`${fieldClassName()} text-center`}
                      {...register(field.name, { valueAsNumber: true })}
                    />
                    <button
                      type="button"
                      className="button-press rounded-full border border-zinc-800 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-950"
                      onClick={() => adjustNumberField(field.name, 1)}
                    >
                      +
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {(errors.name || errors.archetype) ? (
              <p className="mt-4 text-sm text-red-400">
                {errors.name?.message ?? errors.archetype?.message}
              </p>
            ) : null}

            {error ? <p className="mt-4 text-sm text-red-400">{error}</p> : null}

            <button
              type="submit"
              className="button-press mt-8 rounded-full bg-white px-6 py-3 text-sm font-semibold text-black hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={saving}
            >
              {saving
                ? mode === "edit"
                  ? "Saving Changes..."
                  : "Saving Character..."
                : mode === "edit"
                  ? "Save Changes"
                  : "Save Character"}
            </button>
          </section>

          <aside className="app-section p-8">
            <p className="text-[0.68rem] uppercase tracking-[0.24em] text-zinc-500">Preview</p>
            <h2 className="font-display mt-4 text-3xl font-semibold text-white">{values.name || "Unnamed Wanderer"}</h2>
            <p className="mt-2 text-sm text-zinc-400">{values.archetype || "Choose an archetype"}</p>
            <div className="mt-6 grid grid-cols-2 gap-3">
              {numericFields.map((field) => (
                <div key={`preview-${field.name}`} className="rounded-2xl border border-zinc-800 bg-black px-4 py-3">
                  <p className="text-[0.65rem] uppercase tracking-[0.18em] text-zinc-500">{field.label}</p>
                  <p className="mt-2 text-lg font-medium text-zinc-100">{values[field.name]}</p>
                </div>
              ))}
            </div>
            <div className="mt-6 rounded-3xl border border-zinc-800 bg-black p-5">
              <p className="text-[0.68rem] uppercase tracking-[0.22em] text-zinc-500">Backstory</p>
              <p className="mt-3 text-sm leading-7 text-zinc-400">
                {values.backstory || "Give them a scar, a vow, a debt, or a mystery worth chasing."}
              </p>
            </div>
            <div className="mt-6 rounded-3xl border border-zinc-800 bg-black p-5">
              <p className="text-[0.68rem] uppercase tracking-[0.22em] text-zinc-500">Starter Items</p>
              {starterItems.length ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {starterItems.map((item, index) => (
                    <span
                      key={`preview-item-${index}`}
                      className="rounded-full border border-zinc-800 px-3 py-1 text-xs text-zinc-300"
                    >
                      {item || "Unnamed item"}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-sm text-zinc-500">
                  Add a few memorable bits of gear to start the campaign with.
                </p>
              )}
            </div>
          </aside>
        </form>
      </div>
    </main>
  );
}
