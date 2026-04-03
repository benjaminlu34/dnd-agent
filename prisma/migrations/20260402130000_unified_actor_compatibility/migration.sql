-- CreateTable
CREATE TABLE "Actor" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "profileNpcId" TEXT,
    "isAnonymous" BOOLEAN NOT NULL DEFAULT false,
    "displayLabel" TEXT NOT NULL,
    "currentLocationId" TEXT,
    "state" TEXT NOT NULL DEFAULT 'active',
    "threatLevel" INTEGER NOT NULL DEFAULT 1,
    "interactionCount" INTEGER NOT NULL DEFAULT 0,
    "firstSeenAtTurn" INTEGER NOT NULL DEFAULT 0,
    "lastSeenAtTurn" INTEGER NOT NULL DEFAULT 0,
    "lastSeenAtTime" INTEGER NOT NULL DEFAULT 0,
    "recentTopics" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastSummary" TEXT,
    "holdsInventory" BOOLEAN NOT NULL DEFAULT false,
    "affectedWorldState" BOOLEAN NOT NULL DEFAULT false,
    "isInMemoryGraph" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Actor_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "CharacterCommodityStack" ADD COLUMN "actorId" TEXT;

-- AlterTable
ALTER TABLE "ItemInstance" ADD COLUMN "actorId" TEXT;

-- AlterTable
ALTER TABLE "WorldObject" ADD COLUMN "actorId" TEXT;

-- CreateIndex
CREATE INDEX "Actor_campaignId_profileNpcId_idx" ON "Actor"("campaignId", "profileNpcId");

-- CreateIndex
CREATE INDEX "Actor_campaignId_currentLocationId_idx" ON "Actor"("campaignId", "currentLocationId");

-- CreateIndex
CREATE INDEX "Actor_campaignId_lastSeenAtTurn_idx" ON "Actor"("campaignId", "lastSeenAtTurn");

-- CreateIndex
CREATE INDEX "Actor_campaignId_lastSeenAtTime_idx" ON "Actor"("campaignId", "lastSeenAtTime");

-- CreateIndex
CREATE INDEX "CharacterCommodityStack_actorId_idx" ON "CharacterCommodityStack"("actorId");

-- CreateIndex
CREATE INDEX "ItemInstance_actorId_idx" ON "ItemInstance"("actorId");

-- CreateIndex
CREATE INDEX "WorldObject_actorId_idx" ON "WorldObject"("actorId");

-- AddForeignKey
ALTER TABLE "Actor" ADD CONSTRAINT "Actor_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Actor" ADD CONSTRAINT "Actor_profileNpcId_fkey" FOREIGN KEY ("profileNpcId") REFERENCES "NPC"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Actor" ADD CONSTRAINT "Actor_currentLocationId_fkey" FOREIGN KEY ("currentLocationId") REFERENCES "LocationNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CharacterCommodityStack" ADD CONSTRAINT "CharacterCommodityStack_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Actor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemInstance" ADD CONSTRAINT "ItemInstance_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Actor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorldObject" ADD CONSTRAINT "WorldObject_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Actor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill anonymous and promoted temporary actors into Actor using the existing temporary actor identity.
INSERT INTO "Actor" (
    "id",
    "campaignId",
    "profileNpcId",
    "isAnonymous",
    "displayLabel",
    "currentLocationId",
    "state",
    "threatLevel",
    "interactionCount",
    "firstSeenAtTurn",
    "lastSeenAtTurn",
    "lastSeenAtTime",
    "recentTopics",
    "lastSummary",
    "holdsInventory",
    "affectedWorldState",
    "isInMemoryGraph",
    "createdAt",
    "updatedAt"
)
SELECT
    temp."id",
    temp."campaignId",
    temp."promotedNpcId",
    temp."promotedNpcId" IS NULL,
    COALESCE(npc."name", temp."label"),
    COALESCE(npc."currentLocationId", temp."currentLocationId"),
    COALESCE(npc."state", 'active'),
    COALESCE(npc."threatLevel", 1),
    temp."interactionCount",
    temp."firstSeenAtTurn",
    temp."lastSeenAtTurn",
    temp."lastSeenAtTime",
    COALESCE(temp."recentTopics", ARRAY[]::TEXT[]),
    COALESCE(temp."lastSummary", npc."summary"),
    temp."holdsInventory",
    temp."affectedWorldState",
    temp."isInMemoryGraph",
    temp."createdAt",
    temp."updatedAt"
FROM "TemporaryActor" temp
LEFT JOIN "NPC" npc ON npc."id" = temp."promotedNpcId"
ON CONFLICT ("id") DO NOTHING;

-- Backfill actor rows for named NPCs that are not already embodied by a promoted temporary actor.
INSERT INTO "Actor" (
    "id",
    "campaignId",
    "profileNpcId",
    "isAnonymous",
    "displayLabel",
    "currentLocationId",
    "state",
    "threatLevel",
    "interactionCount",
    "firstSeenAtTurn",
    "lastSeenAtTurn",
    "lastSeenAtTime",
    "recentTopics",
    "lastSummary",
    "holdsInventory",
    "affectedWorldState",
    "isInMemoryGraph",
    "createdAt",
    "updatedAt"
)
SELECT
    CONCAT('actor_', npc."id"),
    npc."campaignId",
    npc."id",
    false,
    npc."name",
    npc."currentLocationId",
    npc."state",
    npc."threatLevel",
    0,
    0,
    0,
    0,
    ARRAY[]::TEXT[],
    npc."summary",
    false,
    false,
    false,
    npc."createdAt",
    npc."updatedAt"
FROM "NPC" npc
WHERE NOT EXISTS (
    SELECT 1
    FROM "Actor" actor
    WHERE actor."campaignId" = npc."campaignId"
      AND actor."profileNpcId" = npc."id"
);

-- Repoint embodied holders to actorId while keeping legacy npcId and temporaryActorId columns for compatibility.
UPDATE "CharacterCommodityStack" stack
SET "actorId" = temp_actor."id"
FROM "Actor" temp_actor
WHERE stack."actorId" IS NULL
  AND stack."temporaryActorId" IS NOT NULL
  AND temp_actor."id" = stack."temporaryActorId";

UPDATE "CharacterCommodityStack" stack
SET "actorId" = npc_actor."id"
FROM "Actor" npc_actor
WHERE stack."actorId" IS NULL
  AND stack."npcId" IS NOT NULL
  AND npc_actor."campaignId" = (
    SELECT commodity."campaignId"
    FROM "Commodity" commodity
    WHERE commodity."id" = stack."commodityId"
  )
  AND npc_actor."profileNpcId" = stack."npcId";

UPDATE "ItemInstance" item
SET "actorId" = temp_actor."id"
FROM "Actor" temp_actor
WHERE item."actorId" IS NULL
  AND item."temporaryActorId" IS NOT NULL
  AND temp_actor."id" = item."temporaryActorId";

UPDATE "ItemInstance" item
SET "actorId" = npc_actor."id"
FROM "Actor" npc_actor, "ItemTemplate" template
WHERE item."actorId" IS NULL
  AND item."npcId" IS NOT NULL
  AND template."id" = item."templateId"
  AND npc_actor."campaignId" = template."campaignId"
  AND npc_actor."profileNpcId" = item."npcId";

UPDATE "WorldObject" object
SET "actorId" = temp_actor."id"
FROM "Actor" temp_actor
WHERE object."actorId" IS NULL
  AND object."temporaryActorId" IS NOT NULL
  AND temp_actor."id" = object."temporaryActorId";

UPDATE "WorldObject" object
SET "actorId" = npc_actor."id"
FROM "Actor" npc_actor
WHERE object."actorId" IS NULL
  AND object."npcId" IS NOT NULL
  AND npc_actor."campaignId" = object."campaignId"
  AND npc_actor."profileNpcId" = object."npcId";

-- Refresh actor inventory mirrors after holder repointing.
UPDATE "Actor" actor
SET "holdsInventory" = EXISTS (
    SELECT 1
    FROM "ItemInstance" item
    WHERE item."actorId" = actor."id"
)
OR EXISTS (
    SELECT 1
    FROM "CharacterCommodityStack" stack
    WHERE stack."actorId" = actor."id"
)
OR EXISTS (
    SELECT 1
    FROM "WorldObject" object
    WHERE object."actorId" = actor."id"
);

-- Rewrite old temporary_actor memory links to actor and duplicate named NPC profile links onto the embodied actor.
UPDATE "MemoryEntityLink"
SET "entityType" = 'actor'
WHERE "entityType" = 'temporary_actor';

INSERT INTO "MemoryEntityLink" ("id", "memoryId", "campaignId", "entityType", "entityId", "isPrimary", "createdAt")
SELECT
    CONCAT('mel_actor_', md5(link."id" || ':' || actor."id" || ':' || link."memoryId")),
    link."memoryId",
    link."campaignId",
    'actor',
    actor."id",
    false,
    link."createdAt"
FROM "MemoryEntityLink" link
JOIN "Actor" actor
  ON actor."campaignId" = link."campaignId"
 AND actor."profileNpcId" = link."entityId"
WHERE link."entityType" = 'npc'
  AND NOT EXISTS (
    SELECT 1
    FROM "MemoryEntityLink" existing
    WHERE existing."memoryId" = link."memoryId"
      AND existing."campaignId" = link."campaignId"
      AND existing."entityType" = 'actor'
      AND existing."entityId" = actor."id"
  );

CREATE OR REPLACE FUNCTION migration_actor_id_for_profile(campaign_id TEXT, npc_id TEXT)
RETURNS TEXT
LANGUAGE SQL
STABLE
AS $$
  SELECT actor."id"
  FROM "Actor" actor
  WHERE actor."campaignId" = campaign_id
    AND actor."profileNpcId" = npc_id
  ORDER BY actor."createdAt" ASC, actor."id" ASC
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION rewrite_embodied_actor_json(input JSONB, campaign_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  result JSONB;
  entry JSONB;
  entry_key TEXT;
  actor_id TEXT;
  actor_ref TEXT;
BEGIN
  IF input IS NULL THEN
    RETURN NULL;
  END IF;

  CASE jsonb_typeof(input)
    WHEN 'array' THEN
      result := '[]'::jsonb;
      FOR entry IN SELECT value FROM jsonb_array_elements(input)
      LOOP
        result := result || jsonb_build_array(rewrite_embodied_actor_json(entry, campaign_id));
      END LOOP;
      RETURN result;
    WHEN 'object' THEN
      IF input->>'type' = 'npc_state' AND input ? 'npcId' THEN
        actor_id := migration_actor_id_for_profile(campaign_id, input->>'npcId');
        IF actor_id IS NOT NULL THEN
          RETURN jsonb_build_object(
            'type', 'actor_state',
            'actorId', actor_id,
            'state', input->'state'
          );
        END IF;
      ELSIF input->>'type' = 'change_npc_state' AND input ? 'npcId' THEN
        actor_id := migration_actor_id_for_profile(campaign_id, input->>'npcId');
        IF actor_id IS NOT NULL THEN
          RETURN jsonb_build_object(
            'type', 'change_actor_state',
            'actorId', actor_id,
            'newState', input->'newState'
          );
        END IF;
      ELSIF input->>'type' = 'change_npc_location' AND input ? 'npcId' THEN
        actor_id := migration_actor_id_for_profile(campaign_id, input->>'npcId');
        IF actor_id IS NOT NULL THEN
          RETURN jsonb_build_object(
            'type', 'change_actor_location',
            'actorId', actor_id,
            'newLocationId', input->'newLocationId'
          );
        END IF;
      END IF;

      result := '{}'::jsonb;
      FOR entry_key, entry IN SELECT key, value FROM jsonb_each(input)
      LOOP
        IF entry_key = 'actorRef' AND jsonb_typeof(entry) = 'string' THEN
          actor_ref := trim(BOTH '"' FROM entry::TEXT);
          IF actor_ref LIKE 'npc:%' THEN
            actor_id := migration_actor_id_for_profile(campaign_id, substr(actor_ref, 5));
            IF actor_id IS NOT NULL THEN
              result := result || jsonb_build_object(entry_key, CONCAT('actor:', actor_id));
              CONTINUE;
            END IF;
          ELSIF actor_ref LIKE 'temp:%' THEN
            result := result || jsonb_build_object(entry_key, CONCAT('actor:', substr(actor_ref, 6)));
            CONTINUE;
          END IF;
        END IF;

        result := result || jsonb_build_object(entry_key, rewrite_embodied_actor_json(entry, campaign_id));
      END LOOP;
      RETURN result;
    ELSE
      RETURN input;
  END CASE;
END;
$$;

-- Rewrite active routine JSON and pending event/move JSON only where the refs are embodied mechanics targets.
UPDATE "NpcRoutine"
SET "triggerCondition" = rewrite_embodied_actor_json("triggerCondition", "campaignId")
WHERE "triggerCondition" IS NOT NULL;

UPDATE "WorldEvent"
SET
  "triggerCondition" = rewrite_embodied_actor_json("triggerCondition", "campaignId"),
  "payload" = rewrite_embodied_actor_json("payload", "campaignId")
WHERE NOT "isProcessed"
  AND NOT "isCancelled"
  AND ("triggerCondition" IS NOT NULL OR "payload" IS NOT NULL);

UPDATE "FactionMove"
SET "payload" = rewrite_embodied_actor_json("payload", "campaignId")
WHERE NOT "isExecuted"
  AND NOT "isCancelled"
  AND "payload" IS NOT NULL;

DROP FUNCTION rewrite_embodied_actor_json(JSONB, TEXT);
DROP FUNCTION migration_actor_id_for_profile(TEXT, TEXT);
