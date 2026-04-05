import { z } from "zod";
import {
  buildDefaultCharacterFramework,
  compileCharacterFramework,
  type CompiledCharacterFramework,
} from "@/lib/game/character-framework";
import { MAX_STARTER_ITEMS, normalizeItemNameList } from "@/lib/game/item-utils";
import type {
  CampaignCharacter,
  CharacterCommodityStack,
  CharacterConceptDraft,
  CharacterFramework,
  CharacterInstance,
  CharacterTemplate,
  CharacterTemplateDraft,
  ItemInstance,
} from "@/lib/game/types";

const nullableTrimmedString = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((value) => {
    if (typeof value !== "string") {
      return null;
    }

    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  });

const requiredTrimmedString = z.string().trim().min(1);

const starterItemsSchema = z
  .array(z.string())
  .optional()
  .default([])
  .transform((value) => normalizeItemNameList(value))
  .refine(
    (value) => value.length <= MAX_STARTER_ITEMS,
    `No more than ${MAX_STARTER_ITEMS} starter items are allowed.`,
  );

export const characterConceptDraftSchema: z.ZodType<CharacterConceptDraft> = z.object({
  name: requiredTrimmedString,
  appearance: nullableTrimmedString,
  backstory: requiredTrimmedString,
  drivingGoal: requiredTrimmedString,
  starterItems: starterItemsSchema,
});

export const characterConceptGenerateRequestSchema = z.object({
  prompt: requiredTrimmedString,
});

const legacyFramework = compileCharacterFramework(buildDefaultCharacterFramework("legacy"));
const legacyStatSchema = z.coerce.number().int().min(-5).max(10);

export const characterTemplateGenerateRequestSchema = z.object({
  prompt: requiredTrimmedString,
  moduleId: requiredTrimmedString.optional(),
  conceptId: requiredTrimmedString.optional(),
});

const characterTemplateNarrativeSchema = z.object({
  moduleId: requiredTrimmedString,
  sourceConceptId: z.string().trim().min(1).nullable().optional(),
  frameworkVersion: requiredTrimmedString,
  name: requiredTrimmedString,
  appearance: nullableTrimmedString,
  backstory: requiredTrimmedString,
  drivingGoal: requiredTrimmedString,
  vitality: z.coerce.number().int().positive().max(999),
  starterItems: starterItemsSchema,
});

export function buildCharacterTemplateDraftSchema(
  framework: CharacterFramework | CompiledCharacterFramework,
) {
  const compiled =
    "valuesSchema" in framework
      ? framework
      : compileCharacterFramework(framework);

  return characterTemplateNarrativeSchema.extend({
    frameworkVersion: z.literal(compiled.framework.frameworkVersion),
    frameworkValues: compiled.valuesSchema,
  }) satisfies z.ZodType<CharacterTemplateDraft>;
}

export const characterTemplateDraftSchema = z.object({
  name: requiredTrimmedString,
  archetype: requiredTrimmedString,
  strength: legacyStatSchema,
  dexterity: legacyStatSchema,
  constitution: legacyStatSchema,
  intelligence: legacyStatSchema,
  wisdom: legacyStatSchema,
  charisma: legacyStatSchema,
  maxHealth: z.coerce.number().int().min(1).max(99),
  backstory: nullableTrimmedString,
  starterItems: starterItemsSchema,
});
export const characterGenerateRequestSchema = characterConceptGenerateRequestSchema;

export const characterAdaptRequestSchema = z.object({
  conceptId: requiredTrimmedString,
  moduleId: requiredTrimmedString,
  prompt: z.string().trim().optional(),
});

export function cloneInventory(items: ItemInstance[]): ItemInstance[] {
  return structuredClone(items);
}

export function cloneCommodityStacks(stacks: CharacterCommodityStack[]): CharacterCommodityStack[] {
  return structuredClone(stacks);
}

export function toCharacterStats(template: {
  frameworkValues: CharacterTemplate["frameworkValues"];
}, framework: CharacterFramework | CompiledCharacterFramework = legacyFramework) {
  const compiled =
    "valuesSchema" in framework
      ? framework
      : compileCharacterFramework(framework);
  const values = compiled.valuesSchema.parse(template.frameworkValues);

  return Object.fromEntries(
    compiled.approaches.map((approach) => [approach.id, compiled.getModifier(values, approach.id)]),
  );
}

export function toCampaignCharacter(
  template: CharacterTemplate,
  instance: CharacterInstance,
  framework: CharacterFramework | CompiledCharacterFramework,
  runtimeMaxVitality?: number | null,
): CampaignCharacter {
  const compiled =
    "valuesSchema" in framework
      ? framework
      : compileCharacterFramework(framework);

  const frameworkValues = compiled.valuesSchema.parse(instance.frameworkValues);
  const stats = toCharacterStats({ frameworkValues }, compiled);
  const vitality = runtimeMaxVitality ?? template.vitality ?? template.maxHealth ?? compiled.framework.baseVitality;

  return {
    ...template,
    frameworkValues,
    instanceId: instance.id,
    templateId: instance.templateId,
    maxVitality: vitality,
    maxHealth: vitality,
    approaches: compiled.approaches,
    currencyProfile: compiled.framework.currencyProfile,
    presentationProfile: compiled.framework.presentationProfile,
    stats,
    health: instance.health,
    currencyCp: instance.currencyCp,
    inventory: cloneInventory(instance.inventory),
    commodityStacks: cloneCommodityStacks(instance.commodityStacks),
  };
}

export function toCampaignSeedCharacter(
  template: CharacterTemplateDraft & { id?: string },
  framework: CharacterFramework | CompiledCharacterFramework,
): CampaignCharacter {
  const compiled =
    "valuesSchema" in framework
      ? framework
      : compileCharacterFramework(framework);
  const templateId = template.id ?? "template_draft";
  const frameworkValues = compiled.valuesSchema.parse(template.frameworkValues ?? compiled.blankValues);
  const stats = toCharacterStats({ frameworkValues }, compiled);
  const vitality = template.vitality ?? template.maxHealth ?? compiled.framework.baseVitality;

  return {
    ...template,
    id: templateId,
    frameworkValues,
    instanceId: `instance_${templateId}`,
    templateId,
    maxVitality: vitality,
    maxHealth: vitality,
    approaches: compiled.approaches,
    currencyProfile: compiled.framework.currencyProfile,
    presentationProfile: compiled.framework.presentationProfile,
    stats,
    health: vitality,
    currencyCp: 0,
    inventory: [],
    commodityStacks: [],
  };
}
