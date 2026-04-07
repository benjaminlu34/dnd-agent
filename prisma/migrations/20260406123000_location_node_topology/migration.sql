ALTER TABLE "LocationNode"
  ADD COLUMN IF NOT EXISTS "locationKind" TEXT NOT NULL DEFAULT 'spine',
  ADD COLUMN IF NOT EXISTS "parentLocationId" TEXT,
  ADD COLUMN IF NOT EXISTS "discoveryState" TEXT NOT NULL DEFAULT 'revealed';

CREATE INDEX IF NOT EXISTS "LocationNode_campaignId_parentLocationId_idx"
  ON "LocationNode"("campaignId", "parentLocationId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'LocationNode_parentLocationId_fkey'
  ) THEN
    ALTER TABLE "LocationNode"
      ADD CONSTRAINT "LocationNode_parentLocationId_fkey"
      FOREIGN KEY ("parentLocationId") REFERENCES "LocationNode"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
