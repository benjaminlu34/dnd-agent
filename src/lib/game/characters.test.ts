import assert from "node:assert/strict";
import test from "node:test";
import { characterTemplateDraftSchema } from "./characters";

test("characterTemplateDraftSchema normalizes starter items", () => {
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
      "",
    ],
  });

  assert.deepEqual(parsed.starterItems, ["weathered map case", "camp knife"]);
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
