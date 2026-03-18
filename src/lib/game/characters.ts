import { z } from "zod";
import type {
  CampaignCharacter,
  CharacterInstance,
  CharacterTemplate,
  CharacterTemplateDraft,
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
});

export const characterGenerateRequestSchema = z.object({
  prompt: z.string().trim().min(1, "Prompt is required."),
});

export type CharacterTemplateDraftInput = z.infer<typeof characterTemplateDraftSchema>;

export function normalizeInventory(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];
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
    inventory: instance.inventory,
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
  };
}
