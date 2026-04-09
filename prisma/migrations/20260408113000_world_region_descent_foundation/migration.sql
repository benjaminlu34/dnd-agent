-- Existing campaign runtime state is disposable test data in this workspace.
-- Reset campaign-derived rows so world->region descent can establish clean
-- required semantic/materialization invariants without compatibility shims.
DELETE FROM "Campaign";

ALTER TABLE "Campaign"
  ALTER COLUMN "selectedEntryPointId" DROP NOT NULL,
  ADD COLUMN "descentStatus" TEXT NOT NULL,
  ADD COLUMN "descentDataJson" JSONB;

ALTER TABLE "LocationNode"
  ADD COLUMN "semanticKey" TEXT NOT NULL,
  ADD COLUMN "materializationLevel" TEXT NOT NULL,
  ADD COLUMN "descentDataJson" JSONB;

ALTER TABLE "LocationEdge"
  ADD COLUMN "semanticKey" TEXT NOT NULL,
  ADD COLUMN "materializationLevel" TEXT NOT NULL,
  ADD COLUMN "corridorClass" TEXT,
  ADD COLUMN "modifiers" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "travelBundleJson" JSONB;

CREATE INDEX "Campaign_descentStatus_idx" ON "Campaign"("descentStatus");
CREATE UNIQUE INDEX "LocationNode_campaignId_semanticKey_key"
  ON "LocationNode"("campaignId", "semanticKey");
CREATE UNIQUE INDEX "LocationEdge_campaignId_semanticKey_key"
  ON "LocationEdge"("campaignId", "semanticKey");
