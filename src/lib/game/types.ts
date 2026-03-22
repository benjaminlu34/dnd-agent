export const STATS = [
  "strength",
  "dexterity",
  "constitution",
  "intelligence",
  "wisdom",
  "charisma",
] as const;

export type Stat = (typeof STATS)[number];
export type CheckMode = "normal" | "advantage" | "disadvantage";
export type CheckOutcome = "success" | "partial" | "failure";
export type TimeMode = "combat" | "exploration" | "travel" | "rest" | "downtime";

export const STAT_LABELS: Record<Stat, string> = {
  strength: "Strength",
  dexterity: "Dexterity",
  constitution: "Constitution",
  intelligence: "Intelligence",
  wisdom: "Wisdom",
  charisma: "Charisma",
};

export const STAT_ABBREVIATIONS: Record<Stat, string> = {
  strength: "STR",
  dexterity: "DEX",
  constitution: "CON",
  intelligence: "INT",
  wisdom: "WIS",
  charisma: "CHA",
};

export function isStat(value: unknown): value is Stat {
  return typeof value === "string" && STATS.includes(value as Stat);
}

export type CharacterTemplateDraft = {
  name: string;
  archetype: string;
  strength: number;
  dexterity: number;
  constitution: number;
  intelligence: number;
  wisdom: number;
  charisma: number;
  maxHealth: number;
  backstory: string | null;
  starterItems: string[];
};

export type CharacterTemplate = CharacterTemplateDraft & {
  id: string;
};

export type CharacterTemplateSummary = Omit<CharacterTemplate, "starterItems"> & {
  createdAt: string;
  updatedAt: string;
};

export type ItemTemplate = {
  id: string;
  campaignId: string;
  name: string;
  description: string | null;
  value: number;
  weight: number;
  rarity: string;
  tags: string[];
};

export type ItemInstance = {
  id: string;
  characterInstanceId: string;
  templateId: string;
  template: ItemTemplate;
  isIdentified: boolean;
  charges: number | null;
  properties: Record<string, unknown> | null;
};

export type CharacterInstance = {
  id: string;
  templateId: string;
  health: number;
  gold: number;
  inventory: ItemInstance[];
};

export type CampaignCharacter = CharacterTemplate & {
  instanceId: string;
  templateId: string;
  stats: Record<Stat, number>;
  health: number;
  gold: number;
  inventory: ItemInstance[];
};

export type AdventureModuleSummary = {
  id: string;
  title: string;
  premise: string;
  tone: string;
  setting: string;
  generationMode: "open_world";
  entryPointCount: number;
  campaignCount: number;
  createdAt: string;
  updatedAt: string;
};

export type ModuleEntryPointSummary = {
  id: string;
  title: string;
  summary: string;
  locationName: string;
};

export type AdventureModuleDetail = {
  id: string;
  title: string;
  premise: string;
  tone: string;
  setting: string;
  generationMode: "open_world";
  schemaVersion: number;
  entryPoints: ModuleEntryPointSummary[];
  createdAt: string;
  updatedAt: string;
};

export type FactionResourcePool = {
  gold: number;
  military: number;
  influence: number;
  information: number;
};

export type GeneratedLocationNode = {
  id: string;
  name: string;
  type: string;
  summary: string;
  description: string;
  state: string;
  controllingFactionId: string | null;
  tags: string[];
};

export type GeneratedLocationEdge = {
  id: string;
  sourceId: string;
  targetId: string;
  travelTimeMinutes: number;
  dangerLevel: number;
  currentStatus: string;
  description: string | null;
};

export type GeneratedFaction = {
  id: string;
  name: string;
  type: string;
  summary: string;
  agenda: string;
  resources: FactionResourcePool;
  pressureClock: number;
};

export type GeneratedFactionRelation = {
  id: string;
  factionAId: string;
  factionBId: string;
  stance: "allied" | "neutral" | "rival" | "war";
};

export type GeneratedNpc = {
  id: string;
  name: string;
  role: string;
  summary: string;
  description: string;
  factionId: string | null;
  currentLocationId: string;
  approval: number;
  isCompanion: boolean;
};

export type InformationAccessibility = "public" | "guarded" | "secret";

export type GeneratedInformation = {
  id: string;
  title: string;
  summary: string;
  content: string;
  truthfulness: "true" | "partial" | "false" | "outdated";
  accessibility: InformationAccessibility;
  locationId: string | null;
  factionId: string | null;
  sourceNpcId: string | null;
};

export type GeneratedInformationLink = {
  id: string;
  sourceId: string;
  targetId: string;
  linkType: "supports" | "contradicts" | "extends" | "unlocks";
};

export type GeneratedCommodity = {
  id: string;
  name: string;
  baseValue: number;
  tags: string[];
};

export type GeneratedMarketPrice = {
  id: string;
  commodityId: string;
  locationId: string;
  vendorNpcId: string | null;
  factionId: string | null;
  modifier: number;
  stock: number;
  legalStatus: "legal" | "restricted" | "contraband";
};

export type OpenWorldEntryPoint = {
  id: string;
  title: string;
  summary: string;
  startLocationId: string;
  presentNpcIds: string[];
  initialInformationIds: string[];
};

export type WorldGenerationStageName =
  | "world_bible"
  | "world_spine"
  | "regional_life"
  | "social_cast"
  | "knowledge_web"
  | "knowledge_threads"
  | "economy_material_life"
  | "entry_contexts"
  | "final_world";

export type GeneratedExplanationThread = {
  key: string;
  phenomenon: string;
  prevailingTheories: string[];
  actionableSecret: string;
};

export type GeneratedWorldBible = {
  title: string;
  premise: string;
  tone: string;
  setting: string;
  worldOverview: string;
  systemicPressures: string[];
  historicalFractures: string[];
  immersionAnchors: string[];
  explanationThreads: GeneratedExplanationThread[];
  everydayLife: {
    survival: string;
    institutions: string[];
    fears: string[];
    wants: string[];
    trade: string[];
    gossip: string[];
  };
};

export type GeneratedWorldSpineLocation = {
  key: string;
  name: string;
  type: string;
  summary: string;
  description: string;
  state: string;
  controlStatus: "controlled" | "contested" | "independent";
  controllingFactionKey: string | null;
  tags: string[];
  localIdentity: string;
};

export type GeneratedWorldSpineEdge = {
  key: string;
  sourceKey: string;
  targetKey: string;
  travelTimeMinutes: number;
  dangerLevel: number;
  currentStatus: string;
  description: string | null;
};

export type GeneratedWorldSpineFaction = {
  key: string;
  name: string;
  type: string;
  summary: string;
  agenda: string;
  resources: FactionResourcePool;
  pressureClock: number;
  publicFootprint: string;
};

export type GeneratedWorldSpineRelation = {
  key: string;
  factionAKey: string;
  factionBKey: string;
  stance: "allied" | "neutral" | "rival" | "war";
  summary: string;
};

export type GeneratedWorldSpine = {
  locations: GeneratedWorldSpineLocation[];
  edges: GeneratedWorldSpineEdge[];
  factions: GeneratedWorldSpineFaction[];
  factionRelations: GeneratedWorldSpineRelation[];
};

export type GeneratedRegionalLifeSummary = {
  locationId: string;
  publicActivity: string;
  dominantActivities: string[];
  localPressure: string;
  classTexture: string;
  everydayTexture: string;
  publicHazards: string[];
  ordinaryKnowledge: string[];
  institutions: string[];
  gossip: string[];
  reasonsToLinger: string[];
  routineSeeds: string[];
  eventSeeds: string[];
};

export type GeneratedRegionalLife = {
  locations: GeneratedRegionalLifeSummary[];
};

export type GeneratedSocialNpc = Omit<GeneratedNpc, "id"> & {
  currentConcern: string;
  playerCrossPath: string;
  ties: {
    locationIds: string[];
    factionIds: string[];
    economyHooks: string[];
    informationHooks: string[];
  };
  importance: "pillar" | "connector" | "local";
  bridgeLocationIds: string[];
  bridgeFactionIds: string[];
};

export type GeneratedSocialGravity = {
  npcId: string;
  importance: "pillar" | "connector" | "local";
  bridgeLocationIds: string[];
  bridgeFactionIds: string[];
};

export type GeneratedSocialLayer = {
  npcs: GeneratedNpc[];
  socialGravity: GeneratedSocialGravity[];
};

export type GeneratedKnowledgeNode = Omit<GeneratedInformation, "id"> & {
  key: string;
  actionLead: string;
  knowledgeThread: string | null;
  discoverHow: string;
};

export type GeneratedKnowledgeLink = {
  key: string;
  sourceKey: string;
  targetKey: string;
  linkType: "supports" | "contradicts" | "extends" | "unlocks";
};

export type GeneratedKnowledgeNetwork = {
  theme: string;
  publicBeliefs: string[];
  hiddenTruth: string;
  linkedInformationIds: string[];
  contradictionThemes: string[];
};

export type GeneratedPressureSeed = {
  subjectType: "location" | "faction";
  subjectId: string;
  pressure: string;
};

export type GeneratedKnowledgeEconomy = {
  information: GeneratedInformation[];
  informationLinks: GeneratedInformationLink[];
  knowledgeNetworks: GeneratedKnowledgeNetwork[];
  pressureSeeds: GeneratedPressureSeed[];
  commodities: GeneratedCommodity[];
  marketPrices: GeneratedMarketPrice[];
  locationTradeIdentity: Array<{
    locationId: string;
    signatureGoods: string[];
    scarcityNotes: string;
    streetLevelEconomy: string;
  }>;
};

export type GeneratedEntryContext = OpenWorldEntryPoint & {
  immediatePressure: string;
  publicLead: string;
  localContactNpcId: string;
  mundaneActionPath: string;
  evidenceWorldAlreadyMoving: string;
};

export type GeneratedEntryContexts = {
  entryPoints: GeneratedEntryContext[];
};

export type OpenWorldGenerationIdMap = {
  factions: Record<string, string>;
  locations: Record<string, string>;
  edges: Record<string, string>;
  factionRelations: Record<string, string>;
  npcs: Record<string, string>;
  information: Record<string, string>;
  commodities: Record<string, string>;
};

export type WorldGenerationValidationReport = {
  stage: WorldGenerationStageName;
  attempt: number;
  ok: boolean;
  category: "schema" | "coherence" | "playability" | "immersion";
  issues: string[];
};

export type WorldGenerationAttempt = {
  stage: WorldGenerationStageName;
  attempt: number;
  correctionNotes: string | null;
  completedAt: string;
};

export type OpenWorldGenerationArtifacts = {
  prompt: string;
  model: string;
  createdAt: string;
  worldBible: GeneratedWorldBible;
  worldSpine: GeneratedWorldSpine;
  regionalLife: GeneratedRegionalLife;
  socialLayer: GeneratedSocialLayer;
  knowledgeEconomy: GeneratedKnowledgeEconomy;
  entryContexts: GeneratedEntryContexts;
  attempts: WorldGenerationAttempt[];
  validationReports: WorldGenerationValidationReport[];
  idMaps: OpenWorldGenerationIdMap;
  stageSummaries: Partial<Record<WorldGenerationStageName, string>>;
};

export type GeneratedWorldModule = {
  title: string;
  premise: string;
  tone: string;
  setting: string;
  locations: GeneratedLocationNode[];
  edges: GeneratedLocationEdge[];
  factions: GeneratedFaction[];
  factionRelations: GeneratedFactionRelation[];
  npcs: GeneratedNpc[];
  information: GeneratedInformation[];
  informationLinks: GeneratedInformationLink[];
  commodities: GeneratedCommodity[];
  marketPrices: GeneratedMarketPrice[];
  entryPoints: OpenWorldEntryPoint[];
};

export type GeneratedWorldModuleDraft = {
  draft: GeneratedWorldModule;
  artifacts: OpenWorldGenerationArtifacts;
};

export type GeneratedCampaignOpening = {
  narration: string;
  activeThreat: string;
  entryPointId: string;
  locationNodeId: string;
  presentNpcIds: string[];
  citedInformationIds: string[];
  scene: {
    title: string;
    summary: string;
    location: string;
    atmosphere: string;
    suggestedActions: string[];
  };
};

export type CampaignRuntimeState = {
  currentLocationId: string;
  globalTime: number;
  pendingTurnId: string | null;
  lastActionSummary: string | null;
};

export type LocationSummary = {
  id: string;
  name: string;
  type: string;
  summary: string;
  description: string | null;
  state: string;
  controllingFactionId: string | null;
  controllingFactionName: string | null;
  tags: string[];
};

export type RouteSummary = {
  id: string;
  targetLocationId: string;
  targetLocationName: string;
  travelTimeMinutes: number;
  dangerLevel: number;
  currentStatus: string;
  description: string | null;
};

export type FactionSummary = {
  id: string;
  name: string;
  type: string;
  summary: string;
  agenda: string;
  pressureClock: number;
};

export type FactionRelationSummary = {
  factionAId: string;
  factionAName: string;
  factionBId: string;
  factionBName: string;
  stance: string;
};

export type NpcSummary = {
  id: string;
  name: string;
  role: string;
  summary: string;
  description: string;
  factionId: string | null;
  factionName: string | null;
  currentLocationId: string | null;
  approval: number;
  isCompanion: boolean;
};

export type InformationSummary = {
  id: string;
  title: string;
  summary: string;
  accessibility: InformationAccessibility;
  truthfulness: string;
  locationId: string | null;
  locationName: string | null;
  factionId: string | null;
  factionName: string | null;
  sourceNpcId: string | null;
  sourceNpcName: string | null;
  isDiscovered: boolean;
};

export type CrossLocationLead = {
  information: InformationSummary;
  depth: 1 | 2;
  viaInformationIds: string[];
};

export type StoryMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  kind: "action" | "narration" | "warning" | "summary";
  content: string;
  createdAt: string;
  payload?: Record<string, unknown> | null;
};

export type MemoryRecord = {
  id: string;
  type: string;
  summary: string;
  createdAt: string;
};

export type CampaignSnapshot = {
  campaignId: string;
  sessionId: string;
  sessionTurnCount: number;
  moduleId: string;
  selectedEntryPointId: string;
  title: string;
  premise: string;
  tone: string;
  setting: string;
  state: CampaignRuntimeState;
  character: CampaignCharacter;
  currentLocation: LocationSummary;
  adjacentRoutes: RouteSummary[];
  presentNpcs: NpcSummary[];
  knownFactions: FactionSummary[];
  factionRelations: FactionRelationSummary[];
  localInformation: InformationSummary[];
  discoveredInformation: InformationSummary[];
  connectedLeads: CrossLocationLead[];
  memories: MemoryRecord[];
  recentMessages: StoryMessage[];
  canRetryLatestTurn: boolean;
};

export type PlayerCampaignSnapshot = Omit<
  CampaignSnapshot,
  "sessionTurnCount" | "factionRelations" | "connectedLeads"
>;

export type CampaignListItem = {
  id: string;
  title: string;
  premise: string;
  setting: string;
  tone: string;
  characterName: string;
  characterArchetype: string;
  currentLocationName: string;
  updatedAt: string;
  createdAt: string;
};

export type PromptInventoryItem = {
  name: string;
  description: string | null;
};

export type SpatialPromptContext = {
  currentLocation: LocationSummary;
  adjacentRoutes: RouteSummary[];
  presentNpcs: NpcSummary[];
  localInformation: InformationSummary[];
  connectedLeads: CrossLocationLead[];
  knownFactions: FactionSummary[];
  factionRelations: FactionRelationSummary[];
  inventory: PromptInventoryItem[];
  memories: MemoryRecord[];
  recentMessages: StoryMessage[];
  discoveredInformationIds: string[];
  globalTime: number;
  timeOfDay: string;
};

export type CitedEntities = {
  npcIds: string[];
  locationIds: string[];
  factionIds: string[];
  commodityIds: string[];
  informationIds: string[];
};

export type CheckResult = {
  stat: Stat;
  mode: CheckMode;
  reason: string;
  rolls: [number, number];
  modifier: number;
  total: number;
  outcome: CheckOutcome;
  consequences?: string[];
};

export type RequestClarificationToolCall = {
  type: "request_clarification";
  question: string;
  options: string[];
};

export type ExecuteTravelToolCall = {
  type: "execute_travel";
  routeEdgeId: string;
  targetLocationId: string;
  narration: string;
  suggestedActions: string[];
  timeMode: "travel";
  timeElapsed: number;
  citedEntities: CitedEntities;
};

export type ExecuteConverseToolCall = {
  type: "execute_converse";
  npcId: string;
  topic: string;
  narration: string;
  suggestedActions: string[];
  timeMode: Exclude<TimeMode, "travel" | "rest">;
  timeElapsed: number;
  citedEntities: CitedEntities;
  approvalDelta?: number;
  discoverInformationIds?: string[];
  memorySummary?: string;
};

export type ExecuteInvestigateToolCall = {
  type: "execute_investigate";
  targetType: "location" | "npc" | "route" | "information";
  targetId: string;
  method: string;
  narration: string;
  suggestedActions: string[];
  timeMode: Exclude<TimeMode, "travel" | "rest">;
  timeElapsed: number;
  citedEntities: CitedEntities;
  discoverInformationIds?: string[];
  memorySummary?: string;
};

export type ExecuteObserveToolCall = {
  type: "execute_observe";
  targetType: "location" | "npc" | "route" | "faction";
  targetId: string;
  narration: string;
  suggestedActions: string[];
  timeMode: Exclude<TimeMode, "travel" | "rest">;
  timeElapsed: number;
  citedEntities: CitedEntities;
  discoverInformationIds?: string[];
  memorySummary?: string;
};

export type ExecuteWaitToolCall = {
  type: "execute_wait";
  durationMinutes: number;
  narration: string;
  suggestedActions: string[];
  timeMode: "exploration" | "downtime";
  timeElapsed: number;
  citedEntities: CitedEntities;
  memorySummary?: string;
};

export type ExecuteFreeformToolCall = {
  type: "execute_freeform";
  actionDescription: string;
  statToCheck: Stat;
  timeMode: Exclude<TimeMode, "travel" | "rest">;
  estimatedTimeElapsedMinutes: number;
  timeElapsed: number;
  intendedMechanicalOutcome: string;
  dc?: number;
  failureConsequence?: string;
  narration: string;
  suggestedActions: string[];
  citedEntities: CitedEntities;
  memorySummary?: string;
};

export type TurnActionToolCall =
  | RequestClarificationToolCall
  | ExecuteTravelToolCall
  | ExecuteConverseToolCall
  | ExecuteInvestigateToolCall
  | ExecuteObserveToolCall
  | ExecuteWaitToolCall
  | ExecuteFreeformToolCall;

export type ValidatedTurnCommand =
  | RequestClarificationToolCall
  | (Exclude<TurnActionToolCall, RequestClarificationToolCall> & {
      warnings: string[];
      checkResult?: CheckResult;
    });

export type SimulationInverse = {
  table: string;
  id: string;
  field: string;
  previousValue: unknown;
  operation?: "update" | "delete_created";
};
