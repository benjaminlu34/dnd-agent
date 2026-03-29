-- AlterTable
ALTER TABLE "ItemInstance"
  ALTER COLUMN "characterInstanceId" DROP NOT NULL,
  ADD COLUMN "npcId" TEXT,
  ADD COLUMN "worldObjectId" TEXT,
  ADD COLUMN "sceneLocationId" TEXT,
  ADD COLUMN "sceneFocusKey" TEXT;

ALTER TABLE "CharacterCommodityStack"
  ALTER COLUMN "characterInstanceId" DROP NOT NULL,
  ADD COLUMN "npcId" TEXT,
  ADD COLUMN "worldObjectId" TEXT,
  ADD COLUMN "sceneLocationId" TEXT,
  ADD COLUMN "sceneFocusKey" TEXT;

-- CreateTable
CREATE TABLE "WorldObject" (
  "id" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "characterInstanceId" TEXT,
  "npcId" TEXT,
  "parentWorldObjectId" TEXT,
  "sceneLocationId" TEXT,
  "sceneFocusKey" TEXT,
  "storedGold" INTEGER NOT NULL DEFAULT 0,
  "storageCapacity" INTEGER,
  "securityIsLocked" BOOLEAN NOT NULL DEFAULT false,
  "securityKeyItemTemplateId" TEXT,
  "concealmentIsHidden" BOOLEAN NOT NULL DEFAULT false,
  "vehicleIsHitched" BOOLEAN NOT NULL DEFAULT false,
  "propertiesJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "WorldObject_pkey" PRIMARY KEY ("id")
);

-- ForeignKeys
ALTER TABLE "ItemInstance"
  ADD CONSTRAINT "ItemInstance_npcId_fkey"
    FOREIGN KEY ("npcId") REFERENCES "NPC"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ItemInstance_worldObjectId_fkey"
    FOREIGN KEY ("worldObjectId") REFERENCES "WorldObject"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ItemInstance_sceneLocationId_fkey"
    FOREIGN KEY ("sceneLocationId") REFERENCES "LocationNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CharacterCommodityStack"
  ADD CONSTRAINT "CharacterCommodityStack_npcId_fkey"
    FOREIGN KEY ("npcId") REFERENCES "NPC"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "CharacterCommodityStack_worldObjectId_fkey"
    FOREIGN KEY ("worldObjectId") REFERENCES "WorldObject"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "CharacterCommodityStack_sceneLocationId_fkey"
    FOREIGN KEY ("sceneLocationId") REFERENCES "LocationNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WorldObject"
  ADD CONSTRAINT "WorldObject_campaignId_fkey"
    FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "WorldObject_characterInstanceId_fkey"
    FOREIGN KEY ("characterInstanceId") REFERENCES "CharacterInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "WorldObject_npcId_fkey"
    FOREIGN KEY ("npcId") REFERENCES "NPC"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "WorldObject_parentWorldObjectId_fkey"
    FOREIGN KEY ("parentWorldObjectId") REFERENCES "WorldObject"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "WorldObject_sceneLocationId_fkey"
    FOREIGN KEY ("sceneLocationId") REFERENCES "LocationNode"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "WorldObject_securityKeyItemTemplateId_fkey"
    FOREIGN KEY ("securityKeyItemTemplateId") REFERENCES "ItemTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Indexes
CREATE INDEX "ItemInstance_npcId_idx" ON "ItemInstance"("npcId");
CREATE INDEX "ItemInstance_worldObjectId_idx" ON "ItemInstance"("worldObjectId");
CREATE INDEX "ItemInstance_sceneLocationId_idx" ON "ItemInstance"("sceneLocationId");

CREATE INDEX "CharacterCommodityStack_npcId_idx" ON "CharacterCommodityStack"("npcId");
CREATE INDEX "CharacterCommodityStack_worldObjectId_idx" ON "CharacterCommodityStack"("worldObjectId");
CREATE INDEX "CharacterCommodityStack_sceneLocationId_idx" ON "CharacterCommodityStack"("sceneLocationId");

CREATE INDEX "WorldObject_campaignId_idx" ON "WorldObject"("campaignId");
CREATE INDEX "WorldObject_characterInstanceId_idx" ON "WorldObject"("characterInstanceId");
CREATE INDEX "WorldObject_npcId_idx" ON "WorldObject"("npcId");
CREATE INDEX "WorldObject_parentWorldObjectId_idx" ON "WorldObject"("parentWorldObjectId");
CREATE INDEX "WorldObject_sceneLocationId_idx" ON "WorldObject"("sceneLocationId");

-- Holder-domain constraints
ALTER TABLE "ItemInstance"
  ADD CONSTRAINT "ItemInstance_exactly_one_holder_domain"
  CHECK (
    num_nonnulls("characterInstanceId", "npcId", "worldObjectId", "sceneLocationId") = 1
    AND ("sceneFocusKey" IS NULL OR "sceneLocationId" IS NOT NULL)
  );

ALTER TABLE "CharacterCommodityStack"
  ADD CONSTRAINT "CharacterCommodityStack_exactly_one_holder_domain"
  CHECK (
    num_nonnulls("characterInstanceId", "npcId", "worldObjectId", "sceneLocationId") = 1
    AND ("sceneFocusKey" IS NULL OR "sceneLocationId" IS NOT NULL)
  );

ALTER TABLE "WorldObject"
  ADD CONSTRAINT "WorldObject_exactly_one_holder_domain"
  CHECK (
    num_nonnulls("characterInstanceId", "npcId", "parentWorldObjectId", "sceneLocationId") = 1
    AND ("sceneFocusKey" IS NULL OR "sceneLocationId" IS NOT NULL)
  );

-- Commodity uniqueness per holder domain
DROP INDEX IF EXISTS "CharacterCommodityStack_characterInstanceId_commodityId_key";

CREATE UNIQUE INDEX "CharacterCommodityStack_player_holder_unique"
  ON "CharacterCommodityStack"("commodityId", "characterInstanceId")
  WHERE "characterInstanceId" IS NOT NULL;

CREATE UNIQUE INDEX "CharacterCommodityStack_npc_holder_unique"
  ON "CharacterCommodityStack"("commodityId", "npcId")
  WHERE "npcId" IS NOT NULL;

CREATE UNIQUE INDEX "CharacterCommodityStack_world_object_holder_unique"
  ON "CharacterCommodityStack"("commodityId", "worldObjectId")
  WHERE "worldObjectId" IS NOT NULL;

CREATE UNIQUE INDEX "CharacterCommodityStack_scene_holder_unique"
  ON "CharacterCommodityStack"("commodityId", "sceneLocationId", COALESCE("sceneFocusKey", ''))
  WHERE "sceneLocationId" IS NOT NULL;
