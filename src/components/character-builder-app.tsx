"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { compileCharacterFramework } from "@/lib/game/character-framework";
import { MAX_STARTER_ITEMS } from "@/lib/game/item-utils";
import type {
  AdventureModuleDetail,
  AdventureModuleSummary,
  CharacterConcept,
  CharacterConceptDraft,
  CharacterFrameworkValue,
  CharacterConceptSummary,
  CharacterTemplate,
  CharacterTemplateDraft,
} from "@/lib/game/types";
import { backOrPush } from "@/lib/ui/navigation";

type BuilderSurfaceMode = "concept" | "template" | "adapt";

type CharacterBuilderAppProps = {
  initialCharacter?: CharacterTemplate | null;
  mode?: "create" | "edit";
};

type CollectionsResponse = {
  concepts?: CharacterConceptSummary[];
  modules?: AdventureModuleSummary[];
  error?: string;
};

type ConceptResponse = {
  concept?: CharacterConcept;
  conceptId?: string;
  error?: string;
};

type ModuleResponse = {
  module?: AdventureModuleDetail;
  error?: string;
};

type ModuleFrameworkRegenerateResponse = {
  module?: AdventureModuleDetail;
  source?: "openrouter";
  error?: string;
};

type TemplateSaveResponse = {
  templateId?: string;
  error?: string;
};

type CharacterGenerationResponse = {
  concept?: CharacterConceptDraft;
  character?: CharacterTemplateDraft;
  templateDraft?: CharacterTemplateDraft;
  source?: "openrouter";
  error?: string;
};

const emptyConceptDraft: CharacterConceptDraft = {
  name: "",
  appearance: null,
  backstory: "",
  drivingGoal: "",
  starterItems: [],
};

function fieldClassName(multiline = false) {
  return [
    "w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-100 outline-none transition-colors",
    "placeholder:text-zinc-600 focus:border-zinc-600 focus:bg-black",
    multiline ? "min-h-32 resize-y leading-6" : "",
  ].join(" ");
}

function sectionClassName(emphasis = false) {
  return [
    "border p-5 md:p-6",
    emphasis
      ? "border-zinc-700 bg-zinc-950"
      : "border-zinc-900 bg-zinc-950/80",
  ].join(" ");
}

function normalizeStarterItemsText(value: string) {
  const seen = new Set<string>();
  const items: string[] = [];

  for (const rawEntry of value.split(/[\n,]+/)) {
    const trimmed = rawEntry.trim().replace(/\s+/g, " ");
    if (!trimmed) {
      continue;
    }
    const normalized = trimmed.toLowerCase();
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    items.push(trimmed);
    if (items.length >= MAX_STARTER_ITEMS) {
      break;
    }
  }

  return items;
}

function starterItemsText(items: string[]) {
  return items.join("\n");
}

function modeLabel(mode: BuilderSurfaceMode) {
  if (mode === "concept") return "Standalone concept";
  if (mode === "adapt") return "Adapt concept";
  return "Direct template";
}

function BuilderField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string | null;
  children: ReactNode;
}) {
  return (
    <label className="block space-y-2">
      <div className="space-y-1">
        <span className="text-sm font-medium text-zinc-200">{label}</span>
        {hint ? <p className="text-xs leading-relaxed text-zinc-500">{hint}</p> : null}
      </div>
      {children}
    </label>
  );
}

function createTemplateDraft(
  module: AdventureModuleDetail,
  seed?: Partial<CharacterTemplateDraft>,
): CharacterTemplateDraft {
  const compiled = compileCharacterFramework(module.characterFramework!);
  return {
    moduleId: module.id,
    sourceConceptId: seed?.sourceConceptId ?? null,
    frameworkVersion: compiled.framework.frameworkVersion,
    frameworkValues: structuredClone(seed?.frameworkValues ?? {}),
    name: seed?.name ?? "",
    appearance: seed?.appearance ?? null,
    backstory: seed?.backstory ?? null,
    drivingGoal: seed?.drivingGoal ?? null,
    vitality: seed?.vitality ?? seed?.maxHealth ?? compiled.framework.baseVitality,
    starterItems: [...(seed?.starterItems ?? [])],
  };
}

function builderModeFromQuery(value: string | null): BuilderSurfaceMode {
  return value === "concept" || value === "adapt" ? value : "template";
}

export function CharacterBuilderApp({
  initialCharacter = null,
  mode = "create",
}: CharacterBuilderAppProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedMode = builderModeFromQuery(searchParams.get("mode"));
  const requestedConceptId = searchParams.get("conceptId");
  const requestedModuleId = searchParams.get("moduleId");

  const [builderMode, setBuilderMode] = useState<BuilderSurfaceMode>(
    mode === "edit" ? "template" : requestedMode,
  );
  const [modules, setModules] = useState<AdventureModuleSummary[]>([]);
  const [concepts, setConcepts] = useState<CharacterConceptSummary[]>([]);
  const [selectedModuleId, setSelectedModuleId] = useState(initialCharacter?.moduleId ?? requestedModuleId ?? "");
  const [selectedConceptId, setSelectedConceptId] = useState(requestedConceptId ?? "");
  const [selectedModule, setSelectedModule] = useState<AdventureModuleDetail | null>(null);
  const [selectedConcept, setSelectedConcept] = useState<CharacterConcept | null>(null);
  const [conceptDraft, setConceptDraft] = useState<CharacterConceptDraft>(emptyConceptDraft);
  const [templateDraft, setTemplateDraft] = useState<CharacterTemplateDraft | null>(
    initialCharacter
      ? {
          moduleId: initialCharacter.moduleId ?? "",
          sourceConceptId: initialCharacter.sourceConceptId ?? null,
          frameworkVersion: initialCharacter.frameworkVersion ?? "",
          frameworkValues: structuredClone(initialCharacter.frameworkValues ?? {}),
          name: initialCharacter.name,
          appearance: initialCharacter.appearance ?? null,
          backstory: initialCharacter.backstory ?? null,
          drivingGoal: initialCharacter.drivingGoal ?? null,
          vitality: initialCharacter.vitality ?? initialCharacter.maxHealth ?? 1,
          starterItems: [...initialCharacter.starterItems],
        }
      : null,
  );
  const [generationPrompt, setGenerationPrompt] = useState("");
  const [loadingCollections, setLoadingCollections] = useState(true);
  const [loadingModule, setLoadingModule] = useState(false);
  const [loadingConcept, setLoadingConcept] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [regeneratingFramework, setRegeneratingFramework] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [generationSource, setGenerationSource] = useState<"openrouter" | null>(null);
  const [frameworkPrompt, setFrameworkPrompt] = useState("");

  const compiledFramework = useMemo(
    () => (selectedModule?.characterFramework ? compileCharacterFramework(selectedModule.characterFramework) : null),
    [selectedModule],
  );

  useEffect(() => {
    if (!initialCharacter) {
      return;
    }
    setBuilderMode("template");
    setSelectedModuleId(initialCharacter.moduleId ?? "");
  }, [initialCharacter]);

  useEffect(() => {
    if (builderMode === "adapt") {
      return;
    }

    setTemplateDraft((current) => (
      current?.sourceConceptId
        ? { ...current, sourceConceptId: null }
        : current
    ));
  }, [builderMode]);

  useEffect(() => {
    let active = true;

    async function loadCollections() {
      setLoadingCollections(true);

      try {
        const [charactersResponse, modulesResponse] = await Promise.all([
          fetch("/api/characters"),
          fetch("/api/modules"),
        ]);
        const charactersData = (await charactersResponse.json()) as CollectionsResponse;
        const modulesData = (await modulesResponse.json()) as CollectionsResponse;

        if (!charactersResponse.ok) {
          throw new Error(charactersData.error ?? "Failed to load character data.");
        }
        if (!modulesResponse.ok) {
          throw new Error(modulesData.error ?? "Failed to load modules.");
        }

        if (!active) {
          return;
        }

        setConcepts(charactersData.concepts ?? []);
        setModules(modulesData.modules ?? []);
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load character tools.");
        }
      } finally {
        if (active) {
          setLoadingCollections(false);
        }
      }
    }

    void loadCollections();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!selectedModuleId) {
      setSelectedModule(null);
      if (mode === "create" && builderMode !== "concept") {
        setTemplateDraft(null);
      }
      return;
    }

    let active = true;
    setLoadingModule(true);

    async function loadModule() {
      try {
        const response = await fetch(`/api/modules/${selectedModuleId}`);
        const data = (await response.json()) as ModuleResponse;

        if (!response.ok || !data.module) {
          throw new Error(data.error ?? "Failed to load the selected module.");
        }

        if (!active) {
          return;
        }

        setSelectedModule(data.module);
        setTemplateDraft((current) => {
          if (mode === "edit" && current) {
            return createTemplateDraft(data.module!, current);
          }

          if (current?.moduleId === data.module!.id) {
            return createTemplateDraft(data.module!, current);
          }

          if (builderMode === "adapt" && selectedConcept) {
            return createTemplateDraft(data.module!, {
              name: selectedConcept.name,
              appearance: selectedConcept.appearance,
              backstory: selectedConcept.backstory,
              drivingGoal: selectedConcept.drivingGoal,
              starterItems: selectedConcept.starterItems,
              sourceConceptId: selectedConcept.id,
            });
          }

          return createTemplateDraft(data.module!, current ?? undefined);
        });
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load the selected module.");
        }
      } finally {
        if (active) {
          setLoadingModule(false);
        }
      }
    }

    void loadModule();

    return () => {
      active = false;
    };
  }, [builderMode, mode, selectedConcept, selectedModuleId]);

  useEffect(() => {
    if (!selectedConceptId) {
      setSelectedConcept(null);
      if (builderMode === "concept") {
        setConceptDraft(emptyConceptDraft);
      }
      return;
    }

    let active = true;
    setLoadingConcept(true);

    async function loadConcept() {
      try {
        const response = await fetch(`/api/characters/concepts/${selectedConceptId}`);
        const data = (await response.json()) as ConceptResponse;

        if (!response.ok || !data.concept) {
          throw new Error(data.error ?? "Failed to load the selected concept.");
        }

        if (!active) {
          return;
        }

        setSelectedConcept(data.concept);

        if (builderMode === "concept") {
          setConceptDraft({
            name: data.concept.name,
            appearance: data.concept.appearance,
            backstory: data.concept.backstory,
            drivingGoal: data.concept.drivingGoal,
            starterItems: [...data.concept.starterItems],
          });
        }

        if (builderMode === "adapt" && selectedModule) {
          setTemplateDraft((current) =>
            current?.sourceConceptId === data.concept!.id
              ? current
              : createTemplateDraft(selectedModule, {
                  name: data.concept!.name,
                  appearance: data.concept!.appearance,
                  backstory: data.concept!.backstory,
                  drivingGoal: data.concept!.drivingGoal,
                  starterItems: data.concept!.starterItems,
                  sourceConceptId: data.concept!.id,
                }),
          );
        }
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load the selected concept.");
        }
      } finally {
        if (active) {
          setLoadingConcept(false);
        }
      }
    }

    void loadConcept();

    return () => {
      active = false;
    };
  }, [builderMode, selectedConceptId, selectedModule]);

  function setTemplateField<K extends keyof CharacterTemplateDraft>(field: K, value: CharacterTemplateDraft[K]) {
    setTemplateDraft((current) => (current ? { ...current, [field]: value } : current));
  }

  function setFrameworkValue(fieldId: string, value: CharacterFrameworkValue) {
    setTemplateDraft((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        frameworkValues: {
          ...(current.frameworkValues ?? {}),
          [fieldId]: value,
        },
      };
    });
  }

  function clearFrameworkValue(fieldId: string) {
    setTemplateDraft((current) => {
      if (!current) {
        return current;
      }

      const nextValues = { ...(current.frameworkValues ?? {}) };
      delete nextValues[fieldId];

      return {
        ...current,
        frameworkValues: nextValues,
      };
    });
  }

  async function handleGenerate() {
    if (!generationPrompt.trim() || generating) {
      return;
    }

    setGenerating(true);
    setError(null);
    setNotice(null);

    try {
      if (builderMode === "concept") {
        const response = await fetch("/api/characters/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: generationPrompt }),
        });
        const data = (await response.json()) as CharacterGenerationResponse;

        if (!response.ok || !data.concept) {
          throw new Error(data.error ?? "Failed to generate a character concept.");
        }

        setConceptDraft(data.concept);
        setGenerationSource(data.source ?? null);
        return;
      }

      if (!selectedModuleId) {
        throw new Error("Choose a module before generating a playable character.");
      }

      const endpoint = builderMode === "adapt" ? "/api/characters/adapt" : "/api/characters/generate";
      const payload =
        builderMode === "adapt"
          ? { conceptId: selectedConceptId, moduleId: selectedModuleId, prompt: generationPrompt }
          : { prompt: generationPrompt, moduleId: selectedModuleId };

      if (builderMode === "adapt" && !selectedConceptId) {
        throw new Error("Choose a concept before adapting it into a module.");
      }

      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await response.json()) as CharacterGenerationResponse;
      const generatedTemplate = data.templateDraft ?? data.character;

      if (!response.ok || !generatedTemplate) {
        throw new Error(data.error ?? "Failed to generate a playable character.");
      }

      setTemplateDraft({
        ...generatedTemplate,
        moduleId: selectedModuleId,
        sourceConceptId:
          builderMode === "adapt"
            ? (generatedTemplate.sourceConceptId ?? (selectedConceptId || null))
            : null,
        frameworkVersion: compiledFramework?.framework.frameworkVersion ?? generatedTemplate.frameworkVersion,
      });
      setGenerationSource(data.source ?? null);
    } catch (generationError) {
      setGenerationSource(null);
      setError(
        generationError instanceof Error ? generationError.message : "Failed to generate character data.",
      );
    } finally {
      setGenerating(false);
    }
  }

  async function handleRegenerateFramework() {
    if (!selectedModuleId || !frameworkPrompt.trim() || regeneratingFramework) {
      return;
    }

    setRegeneratingFramework(true);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch(`/api/modules/${selectedModuleId}/framework`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: frameworkPrompt }),
      });
      const data = (await response.json()) as ModuleFrameworkRegenerateResponse;

      if (!response.ok || !data.module) {
        throw new Error(data.error ?? "Failed to regenerate module framework.");
      }

      setSelectedModule(data.module);
      setTemplateDraft((current) => createTemplateDraft(data.module!, current ?? undefined));
      setNotice("Module framework regenerated. Review the updated fields before saving a template.");
    } catch (frameworkError) {
      setError(
        frameworkError instanceof Error ? frameworkError.message : "Failed to regenerate module framework.",
      );
    } finally {
      setRegeneratingFramework(false);
    }
  }

async function handleSave() {
    if (saving) {
      return;
    }

    setSaving(true);
    setError(null);
    setNotice(null);

    try {
      if (builderMode === "concept") {
        const editingConceptId = selectedConcept?.id ?? null;
        const endpoint = editingConceptId
          ? `/api/characters/concepts/${editingConceptId}`
          : "/api/characters/concepts/create";
        const response = await fetch(endpoint, {
          method: editingConceptId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(conceptDraft),
        });
        const data = (await response.json()) as ConceptResponse;

        if (!response.ok || !data.conceptId) {
          throw new Error(data.error ?? "Failed to save character concept.");
        }

        setSelectedConceptId(data.conceptId);
        setSelectedConcept({
          id: data.conceptId,
          ...conceptDraft,
        });
        setNotice(editingConceptId ? "Concept updated." : "Concept saved. You can adapt it into a module whenever you're ready.");
        return;
      }

      if (!templateDraft?.moduleId) {
        throw new Error("Choose a module before saving this playable character.");
      }

      let response: Response;
      let data: TemplateSaveResponse | null = null;

      if (mode === "edit" && initialCharacter) {
        response = await fetch(`/api/characters/${initialCharacter.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(templateDraft),
        });
        data = await response.json().catch(() => null) as TemplateSaveResponse | null;
      } else {
        const createEndpoints = ["/api/characters", "/api/characters/create"];
        let lastErrorMessage = "Failed to save character.";
        let resolved = false;

        response = new Response(null, { status: 500 });

        for (const endpoint of createEndpoints) {
          response = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(templateDraft),
          });
          data = await response.json().catch(() => null) as TemplateSaveResponse | null;

          if (response.ok && data?.templateId) {
            resolved = true;
            break;
          }

          if (response.status !== 404) {
            lastErrorMessage = data?.error ?? `Failed to save character (${response.status}).`;
            break;
          }

          lastErrorMessage = data?.error ?? `Character create endpoint not found at ${endpoint}.`;
        }

        if (!resolved && (!response.ok || !data?.templateId)) {
          throw new Error(lastErrorMessage);
        }
      }

      if (!response.ok || !data?.templateId) {
        throw new Error(data?.error ?? `Failed to save character (${response.status}).`);
      }

      router.push("/characters");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save character data.");
    } finally {
      setSaving(false);
    }
  }

  function renderFrameworkField() {
    if (!compiledFramework || !templateDraft) {
      return null;
    }

    return compiledFramework.uiFields.map((field) => {
      const currentValue = templateDraft.frameworkValues?.[field.id];

      if (field.type === "numeric") {
        return (
          <BuilderField
            key={field.id}
            label={field.label}
            hint={field.description}
          >
            <input
              type="number"
              min={field.min}
              max={field.max}
              value={typeof currentValue === "number" ? currentValue : ""}
              onChange={(event) => {
                if (event.target.value === "") {
                  clearFrameworkValue(field.id);
                  return;
                }

                setFrameworkValue(field.id, Number(event.target.value));
              }}
              className={fieldClassName()}
            />
          </BuilderField>
        );
      }

      if (field.type === "choice_single") {
        return (
          <BuilderField
            key={field.id}
            label={field.label}
            hint={field.description}
          >
            <select
              value={typeof currentValue === "string" ? currentValue : ""}
              onChange={(event) => {
                if (!event.target.value) {
                  clearFrameworkValue(field.id);
                  return;
                }

                setFrameworkValue(field.id, event.target.value);
              }}
              className={fieldClassName()}
            >
              <option value="">Select an option</option>
              {field.options?.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </BuilderField>
        );
      }

      if (field.type === "choice_multi") {
        const selectedValues = Array.isArray(currentValue) ? currentValue : [];
        return (
          <BuilderField
            key={field.id}
            label={field.label}
            hint={field.description}
          >
            <div className="space-y-2 border border-zinc-900 bg-black px-4 py-4">
              {field.options?.map((option) => {
                const checked = selectedValues.includes(option.id);
                return (
                  <label key={option.id} className="flex items-start gap-3 text-sm text-zinc-200">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(event) => {
                        const nextValues = event.target.checked
                          ? [...selectedValues, option.id]
                          : selectedValues.filter((value) => value !== option.id);
                        setFrameworkValue(field.id, nextValues);
                      }}
                      className="mt-1 h-4 w-4 rounded border-zinc-700 bg-black text-white"
                    />
                    <span>
                      <span className="block">{option.label}</span>
                      {option.description ? (
                        <span className="block text-xs leading-relaxed text-zinc-500">{option.description}</span>
                      ) : null}
                    </span>
                  </label>
                );
              })}
            </div>
          </BuilderField>
        );
      }

      return (
        <BuilderField
          key={field.id}
          label={field.label}
          hint={field.description}
        >
          {field.multiline ? (
            <textarea
              value={typeof currentValue === "string" ? currentValue : ""}
              onChange={(event) => {
                if (!event.target.value) {
                  clearFrameworkValue(field.id);
                  return;
                }

                setFrameworkValue(field.id, event.target.value);
              }}
              className={fieldClassName(true)}
            />
          ) : (
            <input
              type="text"
              value={typeof currentValue === "string" ? currentValue : ""}
              onChange={(event) => {
                if (!event.target.value) {
                  clearFrameworkValue(field.id);
                  return;
                }

                setFrameworkValue(field.id, event.target.value);
              }}
              className={fieldClassName()}
            />
          )}
        </BuilderField>
      );
    });
  }

  const pageTitle = mode === "edit"
    ? "Edit your playable character."
    : builderMode === "concept"
      ? "Shape a standalone character concept."
      : builderMode === "adapt"
        ? "Adapt a concept into a module."
        : "Build a module-bound protagonist.";

  const pageCopy = mode === "edit"
    ? "Update the library version. Active campaigns keep their own runtime snapshot."
    : builderMode === "concept"
      ? "Concepts stay narrative-only until you bind or adapt them into a module."
      : builderMode === "adapt"
        ? "Bring a saved concept through a module framework and turn it into a playable template."
        : "Playable characters now start inside a specific module framework and save as reusable templates.";

  const saveLabel = saving
    ? "Saving..."
    : builderMode === "concept"
      ? (selectedConcept ? "Update Concept" : "Save Concept")
      : mode === "edit"
        ? "Update Template"
        : "Save Template";

  return (
    <main className="min-h-screen bg-black text-zinc-100">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 md:px-6 md:py-8">
        <header className="border-b border-zinc-900 pb-4">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="max-w-3xl">
              <h1 className="text-2xl font-medium tracking-tight text-zinc-50 md:text-3xl">
                {pageTitle}
              </h1>
              <p className="mt-2 text-sm leading-6 text-zinc-400">{pageCopy}</p>
            </div>
            <button
              type="button"
              className="button-press rounded-lg border border-zinc-800 px-4 py-2 text-sm text-zinc-300 transition-colors hover:border-zinc-700 hover:bg-zinc-950 hover:text-zinc-100"
              onClick={() => backOrPush(router, "/characters", "/characters")}
            >
              Back to Library
            </button>
          </div>
        </header>

        {mode === "create" ? (
          <section className="flex flex-wrap gap-2 border-b border-zinc-900 pb-4">
            {([
              ["template", "Direct Template"],
              ["adapt", "Adapt Concept"],
              ["concept", "Standalone Concept"],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => {
                  setBuilderMode(value);
                  setError(null);
                  setNotice(null);
                }}
                className={[
                  "rounded-lg border px-3.5 py-2 text-sm transition-colors",
                  builderMode === value
                    ? "border-zinc-100 bg-zinc-100 text-black"
                    : "border-zinc-800 bg-transparent text-zinc-400 hover:border-zinc-700 hover:bg-zinc-950 hover:text-zinc-100",
                ].join(" ")}
              >
                {label}
              </button>
            ))}
          </section>
        ) : null}

        {error ? (
          <p className="border border-red-950 bg-red-950/30 px-4 py-3 text-sm text-red-300">{error}</p>
        ) : null}
        {notice ? (
          <p className="border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-zinc-300">{notice}</p>
        ) : null}

        <section className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
          <div className="space-y-6">
            <section className={sectionClassName(true)}>
              <div className="flex items-center justify-between gap-4 border-b border-zinc-900 pb-3">
                <h2 className="text-base font-medium text-zinc-100">Prompt draft</h2>
                <span className="text-xs text-zinc-500">{modeLabel(builderMode)}</span>
              </div>
              <p className="mt-4 text-sm leading-6 text-zinc-400">
                {builderMode === "concept"
                  ? "Describe the person, pressure, and shape of their life. The result stays narrative-only."
                  : builderMode === "adapt"
                    ? "Describe how the concept should translate into this module's framework, role, and pressure."
                    : "Describe the playable character you want in this module, and the framework draft will come back ready for review."}
              </p>
              <textarea
                value={generationPrompt}
                onChange={(event) => setGenerationPrompt(event.target.value)}
                placeholder={
                  builderMode === "concept"
                    ? "A former marsh courier who still sleeps in boots, trusts maps more than people, and wants one last chance to fix the family name."
                    : builderMode === "adapt"
                      ? "Keep the concept's stubborn fieldcraft, but tune them toward quiet salvage work, debt pressure, and the module's local economy."
                      : "A practical river smuggler turned volunteer guide who knows how to disappear in public and hates owing favors."
                }
                className={fieldClassName(true)}
              />
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  disabled={generating || !generationPrompt.trim()}
                  onClick={() => void handleGenerate()}
                  className="button-press rounded-lg bg-zinc-100 px-4 py-2.5 text-sm font-medium text-black transition-colors hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {generating ? "Generating..." : "Generate Draft"}
                </button>
                {generationSource ? (
                  <span className="text-xs text-zinc-500">Source: {generationSource}</span>
                ) : null}
              </div>
            </section>

            <section className={sectionClassName()}>
              <div className="border-b border-zinc-900 pb-3">
                <h2 className="text-base font-medium text-zinc-100">Setup</h2>
              </div>
              <div className="mt-4 space-y-5">
                {builderMode !== "concept" ? (
                  <BuilderField
                    label="Module"
                    hint="Playable templates are always bound to a module framework."
                  >
                    <select
                      value={selectedModuleId}
                      onChange={(event) => setSelectedModuleId(event.target.value)}
                      disabled={mode === "edit" || loadingCollections}
                      className={fieldClassName()}
                    >
                      <option value="">Select a module</option>
                      {modules.map((module) => (
                        <option key={module.id} value={module.id}>
                          {module.title}
                        </option>
                      ))}
                    </select>
                  </BuilderField>
                ) : null}

                {builderMode === "adapt" ? (
                  <BuilderField
                    label="Source Concept"
                    hint="Choose the narrative blueprint you want to reinterpret for this module."
                  >
                    <select
                      value={selectedConceptId}
                      onChange={(event) => setSelectedConceptId(event.target.value)}
                      disabled={loadingCollections}
                      className={fieldClassName()}
                    >
                      <option value="">Select a concept</option>
                      {concepts.map((concept) => (
                        <option key={concept.id} value={concept.id}>
                          {concept.name}
                        </option>
                      ))}
                    </select>
                  </BuilderField>
                ) : null}

                {compiledFramework ? (
                  <div className="border border-zinc-900 bg-black px-4 py-4 text-sm text-zinc-300">
                    <p className="font-medium text-zinc-100">
                      {compiledFramework.framework.presentationProfile.templateLabel}
                    </p>
                    <p className="mt-2 text-xs leading-relaxed text-zinc-400">
                      Version `{compiledFramework.framework.frameworkVersion}`. {compiledFramework.framework.presentationProfile.approachLabel}s:{" "}
                      {compiledFramework.approaches.map((approach) => approach.label).join(", ")}.
                    </p>
                    <p className="mt-2 text-xs leading-relaxed text-zinc-500">
                      Currency label: {compiledFramework.framework.currencyProfile.unitLabel} ({compiledFramework.framework.currencyProfile.shortLabel})
                    </p>
                  </div>
                ) : null}

                {builderMode !== "concept" && selectedModuleId ? (
                  <BuilderField
                    label="Framework Prompt"
                    hint="Describe how this module's character framework should feel. Use this to regenerate the active framework with your own direction."
                  >
                    <div className="space-y-3">
                      <textarea
                        value={frameworkPrompt}
                        onChange={(event) => setFrameworkPrompt(event.target.value)}
                        placeholder="Aether should be central. Include affinity, lineage pressure, and how characters channel, resist, or are marked by the setting's core forces."
                        className={fieldClassName(true)}
                      />
                      <button
                        type="button"
                        disabled={loadingModule || regeneratingFramework || !frameworkPrompt.trim()}
                        onClick={() => void handleRegenerateFramework()}
                        className="button-press rounded-lg border border-zinc-700 px-4 py-2.5 text-sm text-zinc-200 transition-colors hover:border-zinc-500 hover:bg-zinc-900 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {regeneratingFramework ? "Regenerating Framework..." : "Regenerate Framework"}
                      </button>
                    </div>
                  </BuilderField>
                ) : null}

                {builderMode === "adapt" && concepts.length === 0 && !loadingCollections ? (
                  <p className="text-sm leading-relaxed text-zinc-500">
                    No saved concepts yet. Switch to Standalone Concept to create one first.
                  </p>
                ) : null}
              </div>
            </section>
          </div>

          <div className="space-y-6">
            {builderMode === "concept" ? (
              <section className={sectionClassName()}>
                <div className="border-b border-zinc-900 pb-3">
                  <h2 className="text-base font-medium text-zinc-100">Narrative blueprint</h2>
                </div>
                <div className="mt-5 grid gap-5 md:grid-cols-2">
                  <BuilderField label="Name">
                    <input
                      type="text"
                      value={conceptDraft.name}
                      onChange={(event) => setConceptDraft((current) => ({ ...current, name: event.target.value }))}
                      className={fieldClassName()}
                    />
                  </BuilderField>
                  <BuilderField label="Appearance">
                    <input
                      type="text"
                      value={conceptDraft.appearance ?? ""}
                      onChange={(event) => setConceptDraft((current) => ({
                        ...current,
                        appearance: event.target.value.trim() ? event.target.value : null,
                      }))}
                      className={fieldClassName()}
                    />
                  </BuilderField>
                  <div className="md:col-span-2">
                    <BuilderField label="Backstory">
                      <textarea
                        value={conceptDraft.backstory ?? ""}
                        onChange={(event) => setConceptDraft((current) => ({ ...current, backstory: event.target.value }))}
                        className={fieldClassName(true)}
                      />
                    </BuilderField>
                  </div>
                  <div className="md:col-span-2">
                    <BuilderField label="Driving Goal">
                      <textarea
                        value={conceptDraft.drivingGoal ?? ""}
                        onChange={(event) => setConceptDraft((current) => ({ ...current, drivingGoal: event.target.value }))}
                        className={fieldClassName(true)}
                      />
                    </BuilderField>
                  </div>
                  <div className="md:col-span-2">
                    <BuilderField
                      label="Starter Items"
                      hint={`One item per line, up to ${MAX_STARTER_ITEMS}. Concepts keep starter items as narrative seed material only.`}
                    >
                      <textarea
                        value={starterItemsText(conceptDraft.starterItems)}
                        onChange={(event) => setConceptDraft((current) => ({
                          ...current,
                          starterItems: normalizeStarterItemsText(event.target.value),
                        }))}
                        className={fieldClassName(true)}
                      />
                    </BuilderField>
                  </div>
                </div>
              </section>
            ) : (
              <section className={sectionClassName()}>
                <div className="border-b border-zinc-900 pb-3">
                  <h2 className="text-base font-medium text-zinc-100">Playable template</h2>
                </div>
                {loadingModule ? (
                  <p className="mt-4 text-sm text-zinc-400">Loading module framework...</p>
                ) : !templateDraft ? (
                  <p className="mt-4 text-sm text-zinc-500">
                    Choose a module to begin shaping the playable template.
                  </p>
                ) : (
                  <div className="mt-5 grid gap-5 md:grid-cols-2">
                    <BuilderField label="Name">
                      <input
                        type="text"
                        value={templateDraft.name}
                        onChange={(event) => setTemplateField("name", event.target.value)}
                        className={fieldClassName()}
                      />
                    </BuilderField>
                    <BuilderField label="Appearance">
                      <input
                        type="text"
                        value={templateDraft.appearance ?? ""}
                        onChange={(event) => setTemplateField(
                          "appearance",
                          event.target.value.trim() ? event.target.value : null,
                        )}
                        className={fieldClassName()}
                      />
                    </BuilderField>
                    <div className="md:col-span-2">
                      <BuilderField label="Backstory">
                        <textarea
                          value={templateDraft.backstory ?? ""}
                          onChange={(event) => setTemplateField("backstory", event.target.value)}
                          className={fieldClassName(true)}
                        />
                      </BuilderField>
                    </div>
                    <div className="md:col-span-2">
                      <BuilderField label="Driving Goal">
                        <textarea
                          value={templateDraft.drivingGoal ?? ""}
                          onChange={(event) => setTemplateField("drivingGoal", event.target.value)}
                          className={fieldClassName(true)}
                        />
                      </BuilderField>
                    </div>
                    <BuilderField
                      label={compiledFramework?.framework.presentationProfile.vitalityLabel ?? "Vitality"}
                      hint="This value is snapshotted when a campaign launches."
                    >
                      <input
                        type="number"
                        min={1}
                        max={999}
                        value={templateDraft.vitality ?? 1}
                        onChange={(event) => setTemplateField("vitality", Number(event.target.value))}
                        className={fieldClassName()}
                      />
                    </BuilderField>
                    <div className="md:col-span-2">
                      <BuilderField
                        label="Starter Items"
                        hint={`One item per line, up to ${MAX_STARTER_ITEMS}.`}
                      >
                        <textarea
                          value={starterItemsText(templateDraft.starterItems)}
                          onChange={(event) => setTemplateField(
                            "starterItems",
                            normalizeStarterItemsText(event.target.value),
                          )}
                          className={fieldClassName(true)}
                        />
                      </BuilderField>
                    </div>
                    {renderFrameworkField()}
                  </div>
                )}
              </section>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={
                  saving
                  || (builderMode !== "concept" && (!templateDraft || !selectedModuleId))
                  || (builderMode === "adapt" && !selectedConceptId)
                }
                onClick={() => void handleSave()}
                className="button-press rounded-lg bg-zinc-100 px-4 py-2.5 text-sm font-medium text-black transition-colors hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saveLabel}
              </button>
              {loadingCollections || loadingConcept ? (
                <span className="text-sm text-zinc-500">Loading saved character data...</span>
              ) : null}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
