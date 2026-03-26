-- DropForeignKey
ALTER TABLE "TemporaryActor" DROP CONSTRAINT "TemporaryActor_currentLocationId_fkey";

-- AlterTable
ALTER TABLE "TemporaryActor" ALTER COLUMN "currentLocationId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "TemporaryActor" ADD CONSTRAINT "TemporaryActor_currentLocationId_fkey"
FOREIGN KEY ("currentLocationId") REFERENCES "LocationNode"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;
