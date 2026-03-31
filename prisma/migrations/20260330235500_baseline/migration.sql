-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdventureModule" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "premise" TEXT NOT NULL,
    "tone" TEXT NOT NULL,
    "setting" TEXT NOT NULL,
    "generationMode" TEXT NOT NULL DEFAULT 'open_world',
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "openWorldTemplateJson" JSONB NOT NULL,
    "openWorldGenerationArtifactsJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdventureModule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CharacterTemplate" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "archetype" TEXT NOT NULL,
    "strength" INTEGER NOT NULL,
    "dexterity" INTEGER NOT NULL,
    "constitution" INTEGER NOT NULL,
    "intelligence" INTEGER NOT NULL,
    "wisdom" INTEGER NOT NULL,
    "charisma" INTEGER NOT NULL,
    "maxHealth" INTEGER NOT NULL,
    "backstory" TEXT,
    "starterItems" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CharacterTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "moduleSchemaVersion" INTEGER NOT NULL DEFAULT 1,
    "selectedEntryPointId" TEXT NOT NULL,
    "customEntryPointJson" JSONB,
    "turnLockRequestId" TEXT,
    "turnLockSessionId" TEXT,
    "turnLockExpiresAt" TIMESTAMP(3),
    "stateVersion" INTEGER NOT NULL DEFAULT 0,
    "generatedThroughDay" INTEGER NOT NULL DEFAULT 0,
    "infrastructureFailureCode" TEXT,
    "degradedAt" TIMESTAMP(3),
    "stateJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CharacterInstance" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "health" INTEGER NOT NULL,
    "currencyCp" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CharacterInstance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CharacterCommodityStack" (
    "id" TEXT NOT NULL,
    "characterInstanceId" TEXT,
    "npcId" TEXT,
    "worldObjectId" TEXT,
    "sceneLocationId" TEXT,
    "sceneFocusKey" TEXT,
    "commodityId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CharacterCommodityStack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemTemplate" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "value" INTEGER NOT NULL DEFAULT 0,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "rarity" TEXT NOT NULL DEFAULT 'common',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ItemTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemInstance" (
    "id" TEXT NOT NULL,
    "characterInstanceId" TEXT,
    "npcId" TEXT,
    "worldObjectId" TEXT,
    "sceneLocationId" TEXT,
    "sceneFocusKey" TEXT,
    "templateId" TEXT NOT NULL,
    "isIdentified" BOOLEAN NOT NULL DEFAULT true,
    "charges" INTEGER,
    "properties" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ItemInstance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "turnCount" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "summary" TEXT,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Turn" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL DEFAULT '',
    "playerAction" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "toolCallJson" JSONB,
    "resultJson" JSONB,
    "stateVersionAfter" INTEGER,
    "infrastructureFailureCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Turn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemoryEntry" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "sessionId" TEXT,
    "turnId" TEXT,
    "type" TEXT NOT NULL,
    "memoryKind" TEXT NOT NULL DEFAULT 'world_change',
    "isLongArcCandidate" BOOLEAN NOT NULL DEFAULT false,
    "summary" TEXT NOT NULL,
    "summarySource" TEXT NOT NULL DEFAULT 'model',
    "narrativeNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemoryEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LocationNode" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "description" TEXT,
    "localTextureJson" JSONB,
    "state" TEXT NOT NULL DEFAULT 'active',
    "controllingFactionId" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LocationNode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LocationEdge" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "travelTimeMinutes" INTEGER NOT NULL,
    "dangerLevel" INTEGER NOT NULL DEFAULT 1,
    "currentStatus" TEXT NOT NULL DEFAULT 'open',
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LocationEdge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Faction" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "agenda" TEXT NOT NULL,
    "resources" JSONB NOT NULL,
    "pressureClock" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Faction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FactionRelation" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "factionAId" TEXT NOT NULL,
    "factionBId" TEXT NOT NULL,
    "stance" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FactionRelation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NPC" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "socialLayer" TEXT NOT NULL DEFAULT 'anchor',
    "isNarrativelyHydrated" BOOLEAN NOT NULL DEFAULT true,
    "hydrationClaimRequestId" TEXT,
    "hydrationClaimExpiresAt" TIMESTAMP(3),
    "factionId" TEXT,
    "currentLocationId" TEXT,
    "approval" INTEGER NOT NULL DEFAULT 0,
    "isCompanion" BOOLEAN NOT NULL DEFAULT false,
    "state" TEXT NOT NULL DEFAULT 'active',
    "threatLevel" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NPC_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Information" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "truthfulness" TEXT NOT NULL DEFAULT 'true',
    "accessibility" TEXT NOT NULL DEFAULT 'public',
    "locationId" TEXT,
    "factionId" TEXT,
    "sourceNpcId" TEXT,
    "isDiscovered" BOOLEAN NOT NULL DEFAULT false,
    "discoveredAtTurn" INTEGER,
    "expiresAtTime" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Information_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NpcKnowledge" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "npcId" TEXT NOT NULL,
    "informationId" TEXT NOT NULL,
    "shareability" TEXT NOT NULL DEFAULT 'private',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NpcKnowledge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FactionKnowledge" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "factionId" TEXT NOT NULL,
    "informationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FactionKnowledge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LocationKnowledge" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "informationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LocationKnowledge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InformationLink" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "linkType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InformationLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Commodity" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "baseValue" INTEGER NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Commodity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketPrice" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "commodityId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "vendorNpcId" TEXT,
    "factionId" TEXT,
    "modifier" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "stock" INTEGER NOT NULL DEFAULT -1,
    "restockTime" INTEGER,
    "legalStatus" TEXT NOT NULL DEFAULT 'legal',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketPrice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NpcRoutine" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "npcId" TEXT NOT NULL,
    "triggerTimeMinutes" INTEGER NOT NULL,
    "triggerCondition" JSONB,
    "targetLocationId" TEXT NOT NULL,
    "activity" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NpcRoutine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FactionMove" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "factionId" TEXT NOT NULL,
    "scheduledAtTime" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "isExecuted" BOOLEAN NOT NULL DEFAULT false,
    "isCancelled" BOOLEAN NOT NULL DEFAULT false,
    "cancellationReason" TEXT,
    "cascadeDepth" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FactionMove_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorldEvent" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "locationId" TEXT,
    "triggerTime" INTEGER NOT NULL,
    "triggerCondition" JSONB,
    "description" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "isProcessed" BOOLEAN NOT NULL DEFAULT false,
    "isCancelled" BOOLEAN NOT NULL DEFAULT false,
    "cancellationReason" TEXT,
    "cascadesFrom" TEXT,
    "cascadeDepth" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorldEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TemporaryActor" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "currentLocationId" TEXT,
    "interactionCount" INTEGER NOT NULL DEFAULT 1,
    "firstSeenAtTurn" INTEGER NOT NULL,
    "lastSeenAtTurn" INTEGER NOT NULL,
    "lastSeenAtTime" INTEGER NOT NULL,
    "recentTopics" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastSummary" TEXT,
    "holdsInventory" BOOLEAN NOT NULL DEFAULT false,
    "affectedWorldState" BOOLEAN NOT NULL DEFAULT false,
    "isInMemoryGraph" BOOLEAN NOT NULL DEFAULT false,
    "promotedNpcId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TemporaryActor_pkey" PRIMARY KEY ("id")
);

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
    "storedCurrencyCp" INTEGER NOT NULL DEFAULT 0,
    "storageCapacity" INTEGER,
    "securityIsLocked" BOOLEAN NOT NULL DEFAULT false,
    "securityKeyItemTemplateId" TEXT,
    "concealmentIsHidden" BOOLEAN NOT NULL DEFAULT false,
    "vehicleIsHitched" BOOLEAN NOT NULL DEFAULT false,
    "propertiesJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorldObject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleGenerationJob" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "queuedByTurnId" TEXT,
    "dayNumber" INTEGER NOT NULL,
    "dayStartTime" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "leaseOwnerId" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "lastError" TEXT,
    "infrastructureFailureCode" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduleGenerationJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemoryEntityLink" (
    "id" TEXT NOT NULL,
    "memoryId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemoryEntityLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "CharacterInstance_campaignId_key" ON "CharacterInstance"("campaignId");

-- CreateIndex
CREATE INDEX "CharacterCommodityStack_characterInstanceId_idx" ON "CharacterCommodityStack"("characterInstanceId");

-- CreateIndex
CREATE INDEX "CharacterCommodityStack_npcId_idx" ON "CharacterCommodityStack"("npcId");

-- CreateIndex
CREATE INDEX "CharacterCommodityStack_worldObjectId_idx" ON "CharacterCommodityStack"("worldObjectId");

-- CreateIndex
CREATE INDEX "CharacterCommodityStack_sceneLocationId_idx" ON "CharacterCommodityStack"("sceneLocationId");

-- CreateIndex
CREATE INDEX "CharacterCommodityStack_commodityId_idx" ON "CharacterCommodityStack"("commodityId");

-- CreateIndex
CREATE INDEX "ItemTemplate_campaignId_idx" ON "ItemTemplate"("campaignId");

-- CreateIndex
CREATE INDEX "ItemInstance_characterInstanceId_idx" ON "ItemInstance"("characterInstanceId");

-- CreateIndex
CREATE INDEX "ItemInstance_npcId_idx" ON "ItemInstance"("npcId");

-- CreateIndex
CREATE INDEX "ItemInstance_worldObjectId_idx" ON "ItemInstance"("worldObjectId");

-- CreateIndex
CREATE INDEX "ItemInstance_sceneLocationId_idx" ON "ItemInstance"("sceneLocationId");

-- CreateIndex
CREATE INDEX "ItemInstance_templateId_idx" ON "ItemInstance"("templateId");

-- CreateIndex
CREATE INDEX "Turn_campaignId_createdAt_idx" ON "Turn"("campaignId", "createdAt");

-- CreateIndex
CREATE INDEX "Turn_campaignId_stateVersionAfter_idx" ON "Turn"("campaignId", "stateVersionAfter");

-- CreateIndex
CREATE UNIQUE INDEX "Turn_campaignId_requestId_key" ON "Turn"("campaignId", "requestId");

-- CreateIndex
CREATE INDEX "Message_sessionId_createdAt_idx" ON "Message"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "MemoryEntry_campaignId_createdAt_idx" ON "MemoryEntry"("campaignId", "createdAt");

-- CreateIndex
CREATE INDEX "LocationNode_campaignId_idx" ON "LocationNode"("campaignId");

-- CreateIndex
CREATE INDEX "LocationNode_campaignId_controllingFactionId_idx" ON "LocationNode"("campaignId", "controllingFactionId");

-- CreateIndex
CREATE INDEX "LocationEdge_campaignId_sourceId_idx" ON "LocationEdge"("campaignId", "sourceId");

-- CreateIndex
CREATE INDEX "LocationEdge_campaignId_targetId_idx" ON "LocationEdge"("campaignId", "targetId");

-- CreateIndex
CREATE INDEX "Faction_campaignId_idx" ON "Faction"("campaignId");

-- CreateIndex
CREATE INDEX "FactionRelation_campaignId_idx" ON "FactionRelation"("campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "FactionRelation_campaignId_factionAId_factionBId_key" ON "FactionRelation"("campaignId", "factionAId", "factionBId");

-- CreateIndex
CREATE INDEX "NPC_campaignId_idx" ON "NPC"("campaignId");

-- CreateIndex
CREATE INDEX "NPC_campaignId_currentLocationId_idx" ON "NPC"("campaignId", "currentLocationId");

-- CreateIndex
CREATE INDEX "Information_campaignId_idx" ON "Information"("campaignId");

-- CreateIndex
CREATE INDEX "Information_campaignId_locationId_isDiscovered_idx" ON "Information"("campaignId", "locationId", "isDiscovered");

-- CreateIndex
CREATE INDEX "Information_campaignId_expiresAtTime_idx" ON "Information"("campaignId", "expiresAtTime");

-- CreateIndex
CREATE INDEX "NpcKnowledge_campaignId_npcId_idx" ON "NpcKnowledge"("campaignId", "npcId");

-- CreateIndex
CREATE INDEX "NpcKnowledge_campaignId_informationId_idx" ON "NpcKnowledge"("campaignId", "informationId");

-- CreateIndex
CREATE UNIQUE INDEX "NpcKnowledge_campaignId_npcId_informationId_key" ON "NpcKnowledge"("campaignId", "npcId", "informationId");

-- CreateIndex
CREATE INDEX "FactionKnowledge_campaignId_factionId_idx" ON "FactionKnowledge"("campaignId", "factionId");

-- CreateIndex
CREATE INDEX "FactionKnowledge_campaignId_informationId_idx" ON "FactionKnowledge"("campaignId", "informationId");

-- CreateIndex
CREATE UNIQUE INDEX "FactionKnowledge_campaignId_factionId_informationId_key" ON "FactionKnowledge"("campaignId", "factionId", "informationId");

-- CreateIndex
CREATE INDEX "LocationKnowledge_campaignId_locationId_idx" ON "LocationKnowledge"("campaignId", "locationId");

-- CreateIndex
CREATE INDEX "LocationKnowledge_campaignId_informationId_idx" ON "LocationKnowledge"("campaignId", "informationId");

-- CreateIndex
CREATE UNIQUE INDEX "LocationKnowledge_campaignId_locationId_informationId_key" ON "LocationKnowledge"("campaignId", "locationId", "informationId");

-- CreateIndex
CREATE INDEX "InformationLink_campaignId_idx" ON "InformationLink"("campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "InformationLink_campaignId_sourceId_targetId_key" ON "InformationLink"("campaignId", "sourceId", "targetId");

-- CreateIndex
CREATE INDEX "Commodity_campaignId_idx" ON "Commodity"("campaignId");

-- CreateIndex
CREATE INDEX "MarketPrice_campaignId_locationId_idx" ON "MarketPrice"("campaignId", "locationId");

-- CreateIndex
CREATE INDEX "MarketPrice_campaignId_restockTime_idx" ON "MarketPrice"("campaignId", "restockTime");

-- CreateIndex
CREATE UNIQUE INDEX "MarketPrice_campaignId_commodityId_locationId_vendorNpcId_key" ON "MarketPrice"("campaignId", "commodityId", "locationId", "vendorNpcId");

-- CreateIndex
CREATE INDEX "NpcRoutine_campaignId_npcId_idx" ON "NpcRoutine"("campaignId", "npcId");

-- CreateIndex
CREATE INDEX "NpcRoutine_campaignId_triggerTimeMinutes_idx" ON "NpcRoutine"("campaignId", "triggerTimeMinutes");

-- CreateIndex
CREATE INDEX "FactionMove_campaignId_scheduledAtTime_isExecuted_isCancell_idx" ON "FactionMove"("campaignId", "scheduledAtTime", "isExecuted", "isCancelled");

-- CreateIndex
CREATE INDEX "WorldEvent_campaignId_triggerTime_isProcessed_isCancelled_idx" ON "WorldEvent"("campaignId", "triggerTime", "isProcessed", "isCancelled");

-- CreateIndex
CREATE INDEX "TemporaryActor_campaignId_currentLocationId_idx" ON "TemporaryActor"("campaignId", "currentLocationId");

-- CreateIndex
CREATE INDEX "TemporaryActor_campaignId_lastSeenAtTurn_idx" ON "TemporaryActor"("campaignId", "lastSeenAtTurn");

-- CreateIndex
CREATE UNIQUE INDEX "TemporaryActor_campaignId_currentLocationId_label_key" ON "TemporaryActor"("campaignId", "currentLocationId", "label");

-- CreateIndex
CREATE INDEX "WorldObject_campaignId_idx" ON "WorldObject"("campaignId");

-- CreateIndex
CREATE INDEX "WorldObject_characterInstanceId_idx" ON "WorldObject"("characterInstanceId");

-- CreateIndex
CREATE INDEX "WorldObject_npcId_idx" ON "WorldObject"("npcId");

-- CreateIndex
CREATE INDEX "WorldObject_parentWorldObjectId_idx" ON "WorldObject"("parentWorldObjectId");

-- CreateIndex
CREATE INDEX "WorldObject_sceneLocationId_idx" ON "WorldObject"("sceneLocationId");

-- CreateIndex
CREATE INDEX "ScheduleGenerationJob_campaignId_status_idx" ON "ScheduleGenerationJob"("campaignId", "status");

-- CreateIndex
CREATE INDEX "ScheduleGenerationJob_status_leaseExpiresAt_idx" ON "ScheduleGenerationJob"("status", "leaseExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleGenerationJob_campaignId_dayNumber_key" ON "ScheduleGenerationJob"("campaignId", "dayNumber");

-- CreateIndex
CREATE INDEX "MemoryEntityLink_campaignId_entityType_entityId_idx" ON "MemoryEntityLink"("campaignId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "MemoryEntityLink_memoryId_idx" ON "MemoryEntityLink"("memoryId");

-- AddForeignKey
ALTER TABLE "AdventureModule" ADD CONSTRAINT "AdventureModule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CharacterTemplate" ADD CONSTRAINT "CharacterTemplate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "AdventureModule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "CharacterTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CharacterInstance" ADD CONSTRAINT "CharacterInstance_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CharacterInstance" ADD CONSTRAINT "CharacterInstance_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "CharacterTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CharacterCommodityStack" ADD CONSTRAINT "CharacterCommodityStack_characterInstanceId_fkey" FOREIGN KEY ("characterInstanceId") REFERENCES "CharacterInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CharacterCommodityStack" ADD CONSTRAINT "CharacterCommodityStack_npcId_fkey" FOREIGN KEY ("npcId") REFERENCES "NPC"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CharacterCommodityStack" ADD CONSTRAINT "CharacterCommodityStack_worldObjectId_fkey" FOREIGN KEY ("worldObjectId") REFERENCES "WorldObject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CharacterCommodityStack" ADD CONSTRAINT "CharacterCommodityStack_sceneLocationId_fkey" FOREIGN KEY ("sceneLocationId") REFERENCES "LocationNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CharacterCommodityStack" ADD CONSTRAINT "CharacterCommodityStack_commodityId_fkey" FOREIGN KEY ("commodityId") REFERENCES "Commodity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemTemplate" ADD CONSTRAINT "ItemTemplate_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemInstance" ADD CONSTRAINT "ItemInstance_characterInstanceId_fkey" FOREIGN KEY ("characterInstanceId") REFERENCES "CharacterInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemInstance" ADD CONSTRAINT "ItemInstance_npcId_fkey" FOREIGN KEY ("npcId") REFERENCES "NPC"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemInstance" ADD CONSTRAINT "ItemInstance_worldObjectId_fkey" FOREIGN KEY ("worldObjectId") REFERENCES "WorldObject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemInstance" ADD CONSTRAINT "ItemInstance_sceneLocationId_fkey" FOREIGN KEY ("sceneLocationId") REFERENCES "LocationNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemInstance" ADD CONSTRAINT "ItemInstance_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ItemTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Turn" ADD CONSTRAINT "Turn_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Turn" ADD CONSTRAINT "Turn_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemoryEntry" ADD CONSTRAINT "MemoryEntry_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemoryEntry" ADD CONSTRAINT "MemoryEntry_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemoryEntry" ADD CONSTRAINT "MemoryEntry_turnId_fkey" FOREIGN KEY ("turnId") REFERENCES "Turn"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationNode" ADD CONSTRAINT "LocationNode_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationNode" ADD CONSTRAINT "LocationNode_controllingFactionId_fkey" FOREIGN KEY ("controllingFactionId") REFERENCES "Faction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationEdge" ADD CONSTRAINT "LocationEdge_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationEdge" ADD CONSTRAINT "LocationEdge_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "LocationNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationEdge" ADD CONSTRAINT "LocationEdge_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "LocationNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Faction" ADD CONSTRAINT "Faction_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FactionRelation" ADD CONSTRAINT "FactionRelation_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FactionRelation" ADD CONSTRAINT "FactionRelation_factionAId_fkey" FOREIGN KEY ("factionAId") REFERENCES "Faction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FactionRelation" ADD CONSTRAINT "FactionRelation_factionBId_fkey" FOREIGN KEY ("factionBId") REFERENCES "Faction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NPC" ADD CONSTRAINT "NPC_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NPC" ADD CONSTRAINT "NPC_factionId_fkey" FOREIGN KEY ("factionId") REFERENCES "Faction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NPC" ADD CONSTRAINT "NPC_currentLocationId_fkey" FOREIGN KEY ("currentLocationId") REFERENCES "LocationNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Information" ADD CONSTRAINT "Information_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Information" ADD CONSTRAINT "Information_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "LocationNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Information" ADD CONSTRAINT "Information_factionId_fkey" FOREIGN KEY ("factionId") REFERENCES "Faction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Information" ADD CONSTRAINT "Information_sourceNpcId_fkey" FOREIGN KEY ("sourceNpcId") REFERENCES "NPC"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NpcKnowledge" ADD CONSTRAINT "NpcKnowledge_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NpcKnowledge" ADD CONSTRAINT "NpcKnowledge_npcId_fkey" FOREIGN KEY ("npcId") REFERENCES "NPC"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NpcKnowledge" ADD CONSTRAINT "NpcKnowledge_informationId_fkey" FOREIGN KEY ("informationId") REFERENCES "Information"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FactionKnowledge" ADD CONSTRAINT "FactionKnowledge_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FactionKnowledge" ADD CONSTRAINT "FactionKnowledge_factionId_fkey" FOREIGN KEY ("factionId") REFERENCES "Faction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FactionKnowledge" ADD CONSTRAINT "FactionKnowledge_informationId_fkey" FOREIGN KEY ("informationId") REFERENCES "Information"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationKnowledge" ADD CONSTRAINT "LocationKnowledge_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationKnowledge" ADD CONSTRAINT "LocationKnowledge_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "LocationNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationKnowledge" ADD CONSTRAINT "LocationKnowledge_informationId_fkey" FOREIGN KEY ("informationId") REFERENCES "Information"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InformationLink" ADD CONSTRAINT "InformationLink_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InformationLink" ADD CONSTRAINT "InformationLink_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Information"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InformationLink" ADD CONSTRAINT "InformationLink_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "Information"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Commodity" ADD CONSTRAINT "Commodity_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketPrice" ADD CONSTRAINT "MarketPrice_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketPrice" ADD CONSTRAINT "MarketPrice_commodityId_fkey" FOREIGN KEY ("commodityId") REFERENCES "Commodity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketPrice" ADD CONSTRAINT "MarketPrice_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "LocationNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketPrice" ADD CONSTRAINT "MarketPrice_vendorNpcId_fkey" FOREIGN KEY ("vendorNpcId") REFERENCES "NPC"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketPrice" ADD CONSTRAINT "MarketPrice_factionId_fkey" FOREIGN KEY ("factionId") REFERENCES "Faction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NpcRoutine" ADD CONSTRAINT "NpcRoutine_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NpcRoutine" ADD CONSTRAINT "NpcRoutine_npcId_fkey" FOREIGN KEY ("npcId") REFERENCES "NPC"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NpcRoutine" ADD CONSTRAINT "NpcRoutine_targetLocationId_fkey" FOREIGN KEY ("targetLocationId") REFERENCES "LocationNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FactionMove" ADD CONSTRAINT "FactionMove_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FactionMove" ADD CONSTRAINT "FactionMove_factionId_fkey" FOREIGN KEY ("factionId") REFERENCES "Faction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorldEvent" ADD CONSTRAINT "WorldEvent_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorldEvent" ADD CONSTRAINT "WorldEvent_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "LocationNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemporaryActor" ADD CONSTRAINT "TemporaryActor_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemporaryActor" ADD CONSTRAINT "TemporaryActor_currentLocationId_fkey" FOREIGN KEY ("currentLocationId") REFERENCES "LocationNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemporaryActor" ADD CONSTRAINT "TemporaryActor_promotedNpcId_fkey" FOREIGN KEY ("promotedNpcId") REFERENCES "NPC"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorldObject" ADD CONSTRAINT "WorldObject_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorldObject" ADD CONSTRAINT "WorldObject_characterInstanceId_fkey" FOREIGN KEY ("characterInstanceId") REFERENCES "CharacterInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorldObject" ADD CONSTRAINT "WorldObject_npcId_fkey" FOREIGN KEY ("npcId") REFERENCES "NPC"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorldObject" ADD CONSTRAINT "WorldObject_parentWorldObjectId_fkey" FOREIGN KEY ("parentWorldObjectId") REFERENCES "WorldObject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorldObject" ADD CONSTRAINT "WorldObject_sceneLocationId_fkey" FOREIGN KEY ("sceneLocationId") REFERENCES "LocationNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorldObject" ADD CONSTRAINT "WorldObject_securityKeyItemTemplateId_fkey" FOREIGN KEY ("securityKeyItemTemplateId") REFERENCES "ItemTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleGenerationJob" ADD CONSTRAINT "ScheduleGenerationJob_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleGenerationJob" ADD CONSTRAINT "ScheduleGenerationJob_queuedByTurnId_fkey" FOREIGN KEY ("queuedByTurnId") REFERENCES "Turn"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemoryEntityLink" ADD CONSTRAINT "MemoryEntityLink_memoryId_fkey" FOREIGN KEY ("memoryId") REFERENCES "MemoryEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemoryEntityLink" ADD CONSTRAINT "MemoryEntityLink_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

