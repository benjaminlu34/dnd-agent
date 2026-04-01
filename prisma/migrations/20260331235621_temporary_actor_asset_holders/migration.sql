-- AlterTable
ALTER TABLE "CharacterCommodityStack" ADD COLUMN     "temporaryActorId" TEXT;

-- AlterTable
ALTER TABLE "ItemInstance" ADD COLUMN     "temporaryActorId" TEXT;

-- AlterTable
ALTER TABLE "WorldObject" ADD COLUMN     "temporaryActorId" TEXT;

-- CreateIndex
CREATE INDEX "CharacterCommodityStack_temporaryActorId_idx" ON "CharacterCommodityStack"("temporaryActorId");

-- CreateIndex
CREATE INDEX "ItemInstance_temporaryActorId_idx" ON "ItemInstance"("temporaryActorId");

-- CreateIndex
CREATE INDEX "WorldObject_temporaryActorId_idx" ON "WorldObject"("temporaryActorId");

-- AddForeignKey
ALTER TABLE "CharacterCommodityStack" ADD CONSTRAINT "CharacterCommodityStack_temporaryActorId_fkey" FOREIGN KEY ("temporaryActorId") REFERENCES "TemporaryActor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemInstance" ADD CONSTRAINT "ItemInstance_temporaryActorId_fkey" FOREIGN KEY ("temporaryActorId") REFERENCES "TemporaryActor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorldObject" ADD CONSTRAINT "WorldObject_temporaryActorId_fkey" FOREIGN KEY ("temporaryActorId") REFERENCES "TemporaryActor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
