import { z } from "zod";
import { MAX_STARTER_ITEMS, normalizeItemNameList } from "@/lib/game/item-utils";
import type {
  CampaignCharacter,
  CharacterCommodityStack,
  CharacterInstance,
  CharacterTemplate,
  CharacterTemplateDraft,
  ItemInstance,
} from "@/lib/game/types";

const statSchema = z.coerce.number().int().min(-5).max(10);

const nullableTrimmedString = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((value) => {
    if (typeof value !== "string") {
      return null;
    }

    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  });

const starterItemsSchema = z
  .array(z.string())
  .optional()
  .default([])
  .transform((value) => normalizeItemNameList(value))
  .refine(
    (value) => value.length <= MAX_STARTER_ITEMS,
    `No more than ${MAX_STARTER_ITEMS} starter items are allowed.`,
  );

export const characterTemplateDraftSchema = z.object({
  name: z.string().trim().min(1, "Name is required."),
  archetype: z.string().trim().min(1, "Archetype is required."),
  strength: statSchema,
  dexterity: statSchema,
  constitution: statSchema,
  intelligence: statSchema,
  wisdom: statSchema,
  charisma: statSchema,
  maxHealth: z.coerce.number().int().min(1).max(99),
  backstory: nullableTrimmedString,
  starterItems: starterItemsSchema,
});

export const characterGenerateRequestSchema = z.object({
  prompt: z.string().trim().min(1, "Prompt is required."),
});

export type CharacterTemplateDraftInput = z.infer<typeof characterTemplateDraftSchema>;

export function cloneInventory(items: ItemInstance[]): ItemInstance[] {
  return structuredClone(items);
}

export function cloneCommodityStacks(stacks: CharacterCommodityStack[]): CharacterCommodityStack[] {
  return structuredClone(stacks);
}

export function toCharacterStats(character: Pick<
  CharacterTemplateDraft,
  "strength" | "dexterity" | "constitution" | "intelligence" | "wisdom" | "charisma"
>) {
  return {
    strength: character.strength,
    dexterity: character.dexterity,
    constitution: character.constitution,
    intelligence: character.intelligence,
    wisdom: character.wisdom,
    charisma: character.charisma,
  };
}

export function toCampaignCharacter(
  template: CharacterTemplate,
  instance: CharacterInstance,
): CampaignCharacter {
  return {
    ...template,
    instanceId: instance.id,
    templateId: instance.templateId,
    stats: toCharacterStats(template),
    health: instance.health,
    gold: instance.gold,
    inventory: cloneInventory(instance.inventory),
    commodityStacks: cloneCommodityStacks(instance.commodityStacks),
  };
}

export function toCampaignSeedCharacter(
  template: CharacterTemplateDraft & { id?: string },
): CampaignCharacter {
  const templateId = template.id ?? "template_draft";

  return {
    ...template,
    id: templateId,
    instanceId: `instance_${templateId}`,
    templateId,
    stats: toCharacterStats(template),
    health: template.maxHealth,
    gold: 0,
    inventory: [],
    commodityStacks: [],
  };
}
