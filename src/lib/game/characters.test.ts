import assert from "node:assert/strict";
import test from "node:test";
import { compileCharacterFramework } from "./character-framework";
import { buildCharacterTemplateDraftSchema, characterTemplateDraftSchema, toCampaignCharacter } from "./characters";
import type { CharacterInstance, CharacterTemplate } from "./types";

test("characterTemplateDraftSchema trims starter items", () => {
  const parsed = characterTemplateDraftSchema.parse({
    name: "Rowan Vale",
    archetype: "Waymarked Wanderer",
    strength: 1,
    dexterity: 1,
    constitution: 1,
    intelligence: 1,
    wisdom: 1,
    charisma: 1,
    maxHealth: 12,
    backstory: "Road-worn and stubborn.",
    starterItems: [
      " weathered map case ",
      "camp knife",
      "Weathered   Map   Case",
    ],
  });

  assert.deepEqual(parsed.starterItems, [
    "weathered map case",
    "camp knife",
    "Weathered   Map   Case",
  ]);
});

test("characterTemplateDraftSchema rejects more than four unique starter items", () => {
  const parsed = characterTemplateDraftSchema.safeParse({
    name: "Rowan Vale",
    archetype: "Waymarked Wanderer",
    strength: 1,
    dexterity: 1,
    constitution: 1,
    intelligence: 1,
    wisdom: 1,
    charisma: 1,
    maxHealth: 12,
    backstory: "Road-worn and stubborn.",
    starterItems: [
      "map case",
      "camp knife",
      "bedroll",
      "flint kit",
      "chalk bundle",
    ],
  });

  assert.equal(parsed.success, false);
});

test("module-bound character template draft rejects blank sourceConceptId", () => {
  const framework = compileCharacterFramework({
    frameworkVersion: "salvage-crew-v1",
    fields: [
      { id: "grit", label: "Grit", type: "numeric", min: -2, max: 3, defaultValue: 0, maxModifier: 3 },
    ],
    approaches: [
      { id: "brace", label: "Brace", fieldId: "grit" },
    ],
    baseVitality: 10,
    vitalityLabel: "Vitality",
    currencyProfile: {
      unitName: "script",
      unitLabel: "Dock Script",
      shortLabel: "ds",
      precision: 0,
    },
    presentationProfile: {
      vitalityLabel: "Vitality",
      approachLabel: "Approach",
      conceptLabel: "Concept",
      templateLabel: "Playable Character",
    },
  });

  const schema = buildCharacterTemplateDraftSchema(framework);
  const parsed = schema.safeParse({
    moduleId: "mod_1",
    sourceConceptId: "   ",
    frameworkVersion: "salvage-crew-v1",
    frameworkValues: { grit: 1 },
    name: "Sable",
    appearance: null,
    backstory: "Former deck runner.",
    drivingGoal: "Pay off a dockside debt.",
    vitality: 12,
    starterItems: ["hook knife"],
  });

  assert.equal(parsed.success, false);
});

test("toCampaignCharacter reads framework modifiers from the runtime instance snapshot and honors runtime vitality", () => {
  const framework = compileCharacterFramework({
    frameworkVersion: "salvage-crew-v1",
    fields: [
      { id: "grit", label: "Grit", type: "numeric", min: -2, max: 3, defaultValue: 0, maxModifier: 3 },
      { id: "nerve", label: "Nerve", type: "numeric", min: -2, max: 3, defaultValue: 0, maxModifier: 3 },
    ],
    approaches: [
      { id: "brace", label: "Brace", fieldId: "grit" },
      { id: "bluff", label: "Bluff", fieldId: "nerve" },
    ],
    baseVitality: 10,
    vitalityLabel: "Vitality",
    currencyProfile: {
      unitName: "script",
      unitLabel: "Dock Script",
      shortLabel: "ds",
      precision: 0,
    },
    presentationProfile: {
      vitalityLabel: "Vitality",
      approachLabel: "Approach",
      conceptLabel: "Concept",
      templateLabel: "Playable Character",
    },
  });

  const template: CharacterTemplate = {
    id: "tpl_1",
    moduleId: "mod_1",
    sourceConceptId: null,
    frameworkVersion: "salvage-crew-v1",
    frameworkValues: {
      grit: 0,
      nerve: 1,
    },
    name: "Sable",
    appearance: null,
    backstory: "Former deck runner.",
    drivingGoal: "Pay off a dockside debt.",
    vitality: 14,
    starterItems: ["hook knife"],
  };

  const instance: CharacterInstance = {
    id: "inst_1",
    templateId: "tpl_1",
    health: 6,
    currencyCp: 42,
    frameworkValues: {
      grit: 3,
      nerve: -1,
    },
    inventory: [],
    commodityStacks: [],
  };

  const campaignCharacter = toCampaignCharacter(template, instance, framework, 11);

  assert.equal(campaignCharacter.stats?.brace, 3);
  assert.equal(campaignCharacter.stats?.bluff, -1);
  assert.equal(campaignCharacter.maxVitality, 11);
  assert.equal(campaignCharacter.health, 6);
});
