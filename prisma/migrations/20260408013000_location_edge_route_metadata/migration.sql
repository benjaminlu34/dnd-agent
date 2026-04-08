-- The baseline migration created LocationEdge without route metadata fields that
-- later became part of the Prisma schema. Existing dev/prod databases created
-- from migrations can drift and cause runtime errors when instancing worlds.

ALTER TABLE "LocationEdge"
  ADD COLUMN IF NOT EXISTS "visibility" TEXT NOT NULL DEFAULT 'public',
  ADD COLUMN IF NOT EXISTS "accessRequirementText" TEXT;

-- Earlier schema changes also introduced route-discovery and journey tables,
-- but the corresponding migration was never checked in. Fold them into this
-- repair migration so migrated databases match the current Prisma schema.

ALTER TABLE "CharacterInstance"
  ALTER COLUMN "frameworkValues" DROP DEFAULT;

CREATE TABLE IF NOT EXISTS "InformationRevealsEdge" (
  "id" TEXT NOT NULL,
  "informationId" TEXT NOT NULL,
  "edgeId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InformationRevealsEdge_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "InformationRevealsLocation" (
  "id" TEXT NOT NULL,
  "informationId" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InformationRevealsLocation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CampaignKnownRoute" (
  "id" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "edgeId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CampaignKnownRoute_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ActiveJourney" (
  "id" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "edgeId" TEXT NOT NULL,
  "originLocationId" TEXT NOT NULL,
  "destinationLocationId" TEXT NOT NULL,
  "elapsedMinutes" INTEGER NOT NULL DEFAULT 0,
  "totalDurationMinutes" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ActiveJourney_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "JourneyNpc" (
  "id" TEXT NOT NULL,
  "journeyId" TEXT NOT NULL,
  "npcId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "JourneyNpc_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "JourneyActor" (
  "id" TEXT NOT NULL,
  "journeyId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "JourneyActor_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "JourneyTemporaryActor" (
  "id" TEXT NOT NULL,
  "journeyId" TEXT NOT NULL,
  "temporaryActorId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "JourneyTemporaryActor_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "JourneyWorldObject" (
  "id" TEXT NOT NULL,
  "journeyId" TEXT NOT NULL,
  "worldObjectId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "JourneyWorldObject_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CampaignPromptCache" (
  "campaignId" TEXT NOT NULL,
  "promptRequestId" TEXT NOT NULL,
  "discoveryHooksJson" JSONB NOT NULL,
  "latentTargetsJson" JSONB NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CampaignPromptCache_pkey" PRIMARY KEY ("campaignId")
);

CREATE INDEX IF NOT EXISTS "InformationRevealsEdge_edgeId_idx"
  ON "InformationRevealsEdge"("edgeId");

CREATE UNIQUE INDEX IF NOT EXISTS "InformationRevealsEdge_informationId_edgeId_key"
  ON "InformationRevealsEdge"("informationId", "edgeId");

CREATE INDEX IF NOT EXISTS "InformationRevealsLocation_locationId_idx"
  ON "InformationRevealsLocation"("locationId");

CREATE UNIQUE INDEX IF NOT EXISTS "InformationRevealsLocation_informationId_locationId_key"
  ON "InformationRevealsLocation"("informationId", "locationId");

CREATE INDEX IF NOT EXISTS "CampaignKnownRoute_edgeId_idx"
  ON "CampaignKnownRoute"("edgeId");

CREATE UNIQUE INDEX IF NOT EXISTS "CampaignKnownRoute_campaignId_edgeId_key"
  ON "CampaignKnownRoute"("campaignId", "edgeId");

CREATE UNIQUE INDEX IF NOT EXISTS "ActiveJourney_campaignId_key"
  ON "ActiveJourney"("campaignId");

CREATE INDEX IF NOT EXISTS "ActiveJourney_edgeId_idx"
  ON "ActiveJourney"("edgeId");

CREATE INDEX IF NOT EXISTS "ActiveJourney_originLocationId_idx"
  ON "ActiveJourney"("originLocationId");

CREATE INDEX IF NOT EXISTS "ActiveJourney_destinationLocationId_idx"
  ON "ActiveJourney"("destinationLocationId");

CREATE INDEX IF NOT EXISTS "JourneyNpc_npcId_idx"
  ON "JourneyNpc"("npcId");

CREATE UNIQUE INDEX IF NOT EXISTS "JourneyNpc_journeyId_npcId_key"
  ON "JourneyNpc"("journeyId", "npcId");

CREATE INDEX IF NOT EXISTS "JourneyActor_actorId_idx"
  ON "JourneyActor"("actorId");

CREATE UNIQUE INDEX IF NOT EXISTS "JourneyActor_journeyId_actorId_key"
  ON "JourneyActor"("journeyId", "actorId");

CREATE INDEX IF NOT EXISTS "JourneyTemporaryActor_temporaryActorId_idx"
  ON "JourneyTemporaryActor"("temporaryActorId");

CREATE UNIQUE INDEX IF NOT EXISTS "JourneyTemporaryActor_journeyId_temporaryActorId_key"
  ON "JourneyTemporaryActor"("journeyId", "temporaryActorId");

CREATE INDEX IF NOT EXISTS "JourneyWorldObject_worldObjectId_idx"
  ON "JourneyWorldObject"("worldObjectId");

CREATE UNIQUE INDEX IF NOT EXISTS "JourneyWorldObject_journeyId_worldObjectId_key"
  ON "JourneyWorldObject"("journeyId", "worldObjectId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'InformationRevealsEdge_informationId_fkey'
  ) THEN
    ALTER TABLE "InformationRevealsEdge"
      ADD CONSTRAINT "InformationRevealsEdge_informationId_fkey"
      FOREIGN KEY ("informationId") REFERENCES "Information"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'InformationRevealsEdge_edgeId_fkey'
  ) THEN
    ALTER TABLE "InformationRevealsEdge"
      ADD CONSTRAINT "InformationRevealsEdge_edgeId_fkey"
      FOREIGN KEY ("edgeId") REFERENCES "LocationEdge"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'InformationRevealsLocation_informationId_fkey'
  ) THEN
    ALTER TABLE "InformationRevealsLocation"
      ADD CONSTRAINT "InformationRevealsLocation_informationId_fkey"
      FOREIGN KEY ("informationId") REFERENCES "Information"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'InformationRevealsLocation_locationId_fkey'
  ) THEN
    ALTER TABLE "InformationRevealsLocation"
      ADD CONSTRAINT "InformationRevealsLocation_locationId_fkey"
      FOREIGN KEY ("locationId") REFERENCES "LocationNode"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CampaignKnownRoute_campaignId_fkey'
  ) THEN
    ALTER TABLE "CampaignKnownRoute"
      ADD CONSTRAINT "CampaignKnownRoute_campaignId_fkey"
      FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CampaignKnownRoute_edgeId_fkey'
  ) THEN
    ALTER TABLE "CampaignKnownRoute"
      ADD CONSTRAINT "CampaignKnownRoute_edgeId_fkey"
      FOREIGN KEY ("edgeId") REFERENCES "LocationEdge"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ActiveJourney_campaignId_fkey'
  ) THEN
    ALTER TABLE "ActiveJourney"
      ADD CONSTRAINT "ActiveJourney_campaignId_fkey"
      FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ActiveJourney_edgeId_fkey'
  ) THEN
    ALTER TABLE "ActiveJourney"
      ADD CONSTRAINT "ActiveJourney_edgeId_fkey"
      FOREIGN KEY ("edgeId") REFERENCES "LocationEdge"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ActiveJourney_originLocationId_fkey'
  ) THEN
    ALTER TABLE "ActiveJourney"
      ADD CONSTRAINT "ActiveJourney_originLocationId_fkey"
      FOREIGN KEY ("originLocationId") REFERENCES "LocationNode"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ActiveJourney_destinationLocationId_fkey'
  ) THEN
    ALTER TABLE "ActiveJourney"
      ADD CONSTRAINT "ActiveJourney_destinationLocationId_fkey"
      FOREIGN KEY ("destinationLocationId") REFERENCES "LocationNode"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'JourneyNpc_journeyId_fkey'
  ) THEN
    ALTER TABLE "JourneyNpc"
      ADD CONSTRAINT "JourneyNpc_journeyId_fkey"
      FOREIGN KEY ("journeyId") REFERENCES "ActiveJourney"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'JourneyNpc_npcId_fkey'
  ) THEN
    ALTER TABLE "JourneyNpc"
      ADD CONSTRAINT "JourneyNpc_npcId_fkey"
      FOREIGN KEY ("npcId") REFERENCES "NPC"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'JourneyActor_journeyId_fkey'
  ) THEN
    ALTER TABLE "JourneyActor"
      ADD CONSTRAINT "JourneyActor_journeyId_fkey"
      FOREIGN KEY ("journeyId") REFERENCES "ActiveJourney"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'JourneyActor_actorId_fkey'
  ) THEN
    ALTER TABLE "JourneyActor"
      ADD CONSTRAINT "JourneyActor_actorId_fkey"
      FOREIGN KEY ("actorId") REFERENCES "Actor"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'JourneyTemporaryActor_journeyId_fkey'
  ) THEN
    ALTER TABLE "JourneyTemporaryActor"
      ADD CONSTRAINT "JourneyTemporaryActor_journeyId_fkey"
      FOREIGN KEY ("journeyId") REFERENCES "ActiveJourney"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'JourneyTemporaryActor_temporaryActorId_fkey'
  ) THEN
    ALTER TABLE "JourneyTemporaryActor"
      ADD CONSTRAINT "JourneyTemporaryActor_temporaryActorId_fkey"
      FOREIGN KEY ("temporaryActorId") REFERENCES "TemporaryActor"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'JourneyWorldObject_journeyId_fkey'
  ) THEN
    ALTER TABLE "JourneyWorldObject"
      ADD CONSTRAINT "JourneyWorldObject_journeyId_fkey"
      FOREIGN KEY ("journeyId") REFERENCES "ActiveJourney"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'JourneyWorldObject_worldObjectId_fkey'
  ) THEN
    ALTER TABLE "JourneyWorldObject"
      ADD CONSTRAINT "JourneyWorldObject_worldObjectId_fkey"
      FOREIGN KEY ("worldObjectId") REFERENCES "WorldObject"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CampaignPromptCache_campaignId_fkey'
  ) THEN
    ALTER TABLE "CampaignPromptCache"
      ADD CONSTRAINT "CampaignPromptCache_campaignId_fkey"
      FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
