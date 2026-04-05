-- Character rows and active campaigns are disposable test data in this workspace.
TRUNCATE TABLE "Campaign" CASCADE;
TRUNCATE TABLE "CharacterTemplate" CASCADE;

CREATE TABLE "CharacterConcept" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "appearance" TEXT,
  "backstory" TEXT NOT NULL,
  "drivingGoal" TEXT NOT NULL,
  "starterItems" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CharacterConcept_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "AdventureModule"
  ADD COLUMN "characterFrameworkJson" JSONB;

UPDATE "AdventureModule"
SET "characterFrameworkJson" = COALESCE(
  "openWorldTemplateJson"::jsonb -> 'characterFramework',
  '{
    "frameworkVersion": "legacy-2d6-migrated",
    "fields": [
      {"id":"force","label":"Force","type":"numeric","min":-2,"max":3,"defaultValue":0,"maxModifier":3},
      {"id":"finesse","label":"Finesse","type":"numeric","min":-2,"max":3,"defaultValue":0,"maxModifier":3},
      {"id":"endure","label":"Endure","type":"numeric","min":-2,"max":3,"defaultValue":0,"maxModifier":3},
      {"id":"analyze","label":"Analyze","type":"numeric","min":-2,"max":3,"defaultValue":0,"maxModifier":3},
      {"id":"notice","label":"Notice","type":"numeric","min":-2,"max":3,"defaultValue":0,"maxModifier":3},
      {"id":"influence","label":"Influence","type":"numeric","min":-2,"max":3,"defaultValue":0,"maxModifier":3}
    ],
    "approaches": [
      {"id":"force","label":"Force","fieldId":"force"},
      {"id":"finesse","label":"Finesse","fieldId":"finesse"},
      {"id":"endure","label":"Endure","fieldId":"endure"},
      {"id":"analyze","label":"Analyze","fieldId":"analyze"},
      {"id":"notice","label":"Notice","fieldId":"notice"},
      {"id":"influence","label":"Influence","fieldId":"influence"}
    ],
    "baseVitality": 12,
    "vitalityLabel": "Vitality",
    "currencyProfile": {
      "unitName": "copper piece",
      "unitLabel": "Copper Pieces",
      "shortLabel": "cp",
      "precision": 0
    },
    "presentationProfile": {
      "vitalityLabel": "Vitality",
      "approachLabel": "Approach",
      "conceptLabel": "Concept",
      "templateLabel": "Playable Character"
    }
  }'::jsonb
);

ALTER TABLE "AdventureModule"
  ALTER COLUMN "characterFrameworkJson" SET NOT NULL;

ALTER TABLE "CharacterTemplate"
  ADD COLUMN "moduleId" TEXT,
  ADD COLUMN "sourceConceptId" TEXT,
  ADD COLUMN "frameworkVersion" TEXT,
  ADD COLUMN "frameworkValues" JSONB,
  ADD COLUMN "appearance" TEXT,
  ADD COLUMN "drivingGoal" TEXT,
  ADD COLUMN "vitality" INTEGER;

ALTER TABLE "CharacterInstance"
  ADD COLUMN "frameworkValues" JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE "CharacterTemplate"
  DROP COLUMN "archetype",
  DROP COLUMN "strength",
  DROP COLUMN "dexterity",
  DROP COLUMN "constitution",
  DROP COLUMN "intelligence",
  DROP COLUMN "wisdom",
  DROP COLUMN "charisma",
  DROP COLUMN "maxHealth";

ALTER TABLE "CharacterTemplate"
  ALTER COLUMN "backstory" SET NOT NULL,
  ALTER COLUMN "moduleId" SET NOT NULL,
  ALTER COLUMN "frameworkVersion" SET NOT NULL,
  ALTER COLUMN "frameworkValues" SET NOT NULL,
  ALTER COLUMN "drivingGoal" SET NOT NULL,
  ALTER COLUMN "vitality" SET NOT NULL;

CREATE INDEX "CharacterTemplate_userId_updatedAt_idx" ON "CharacterTemplate"("userId", "updatedAt");
CREATE INDEX "CharacterTemplate_moduleId_updatedAt_idx" ON "CharacterTemplate"("moduleId", "updatedAt");
CREATE INDEX "CharacterTemplate_sourceConceptId_idx" ON "CharacterTemplate"("sourceConceptId");

ALTER TABLE "CharacterConcept"
  ADD CONSTRAINT "CharacterConcept_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CharacterTemplate"
  ADD CONSTRAINT "CharacterTemplate_moduleId_fkey"
  FOREIGN KEY ("moduleId") REFERENCES "AdventureModule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CharacterTemplate"
  ADD CONSTRAINT "CharacterTemplate_sourceConceptId_fkey"
  FOREIGN KEY ("sourceConceptId") REFERENCES "CharacterConcept"("id") ON DELETE SET NULL ON UPDATE CASCADE;
