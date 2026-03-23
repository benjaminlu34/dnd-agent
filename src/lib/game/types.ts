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
export type NpcState = "active" | "wounded" | "incapacitated" | "dead";
export type CombatApproach = "attack" | "subdue" | "assassinate";
export type TradeAction = "buy" | "sell";
export type RestType = "light" | "full";

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

export type CommoditySummary = {
  id: string;
  campaignId: string;
  name: string;
  baseValue: number;
  tags: string[];
};

export type CharacterCommodityStack = {
  id: string;
  characterInstanceId: string;
  commodityId: string;
  quantity: number;
  commodity: CommoditySummary;
};

export type CharacterInstance = {
  id: string;
  templateId: string;
  health: number;
  gold: number;
  inventory: ItemInstance[];
  commodityStacks: CharacterCommodityStack[];
};

export type CampaignCharacter = CharacterTemplate & {
  instanceId: string;
  templateId: string;
  stats: Record<Stat, number>;
  health: number;
  gold: number;
  inventory: ItemInstance[];
  commodityStacks: CharacterCommodityStack[];
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

export type LocalTextureSummary = {
  dominantActivities: string[];
  classTexture: string;
  publicHazards: string[];
};

export type LocationSummary = {
  id: string;
  name: string;
  type: string;
  summary: string;
  description: string | null;
  localTexture: LocalTextureSummary | null;
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
  socialLayer: "anchor" | "starting_local" | "promoted_local";
  isNarrativelyHydrated: boolean;
  factionId: string | null;
  factionName: string | null;
  currentLocationId: string | null;
  approval: number;
  isCompanion: boolean;
  state: NpcState;
  threatLevel: number;
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
  expiresAtTime: number | null;
};

export type CrossLocationLead = {
  information: InformationSummary;
  depth: 1 | 2;
  viaInformationIds: string[];
};

export type TemporaryActorSummary = {
  id: string;
  label: string;
  currentLocationId: string;
  interactionCount: number;
  firstSeenAtTurn: number;
  lastSeenAtTurn: number;
  lastSeenAtTime: number;
  recentTopics: string[];
  lastSummary: string | null;
  holdsInventory: boolean;
  affectedWorldState: boolean;
  isInMemoryGraph: boolean;
  promotedNpcId: string | null;
};

export type RecentLocalEventSummary = {
  id: string;
  description: string;
  locationId: string | null;
  triggerTime: number;
  minutesAgo: number;
};

export type RecentUnnamedLocalSummary = {
  label: string;
  interactionCount: number;
  lastSummary: string | null;
  lastSeenAtTurn: number;
};

export type PromptNpcSummary = {
  id: string;
  name: string;
  role: string;
  requiresDetailFetch: boolean;
};

export type PromptInformationSummary = Pick<
  InformationSummary,
  "id" | "title" | "summary" | "truthfulness"
>;

export type CharacterRelationshipSummary = {
  npcId: string;
  npcName: string;
  approval: number;
  approvalLevel: "hostile" | "cold" | "neutral" | "warm" | "trusted";
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
  temporaryActors: TemporaryActorSummary[];
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
  kind: "item" | "commodity";
  id: string;
  name: string;
  description: string | null;
  quantity?: number;
};

export type SpatialPromptContext = {
  currentLocation: Pick<LocationSummary, "id" | "name" | "type" | "summary" | "state">;
  adjacentRoutes: RouteSummary[];
  presentNpcs: PromptNpcSummary[];
  recentUnnamedLocals: RecentUnnamedLocalSummary[];
  recentLocalEvents: RecentLocalEventSummary[];
  recentTurnLedger: string[];
  discoveredInformation: PromptInformationSummary[];
  inventory: PromptInventoryItem[];
  localTexture: LocalTextureSummary | null;
  globalTime: number;
  timeOfDay: string;
  dayCount: number;
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
  dc?: number;
  outcome: CheckOutcome;
  consequences?: string[];
};

export type MarketPriceDetail = {
  marketPriceId: string;
  commodityId: string;
  commodityName: string;
  baseValue: number;
  modifier: number;
  price: number;
  stock: number;
  legalStatus: string;
  vendorNpcId: string | null;
  vendorNpcName: string | null;
  locationId: string;
  locationName: string;
  restockTime: number | null;
};

export type FactionMoveSummary = {
  id: string;
  description: string;
  scheduledAtTime: number;
  isExecuted: boolean;
  isCancelled: boolean;
  cancellationReason: string | null;
};

export type FactionIntel = FactionSummary & {
  relations: FactionRelationSummary[];
  visibleMoves: FactionMoveSummary[];
  controlledLocationIds: string[];
};

export type InformationDetail = InformationSummary & {
  content: string;
};

export type RelationshipHistory = {
  npcId: string;
  npcName: string;
  memories: MemoryRecord[];
};

export type NpcDetail = NpcSummary & {
  knownInformation: InformationSummary[];
  relationshipHistory: MemoryRecord[];
  temporaryActorId: string | null;
};

export type PromotedNpcHydrationDraft = {
  summary: string;
  description: string;
  factionId: string | null;
  information: Array<{
    title: string;
    summary: string;
    content: string;
    truthfulness: InformationSummary["truthfulness"];
    accessibility: InformationAccessibility;
    locationId: string | null;
    factionId: string | null;
  }>;
};

export type RequestClarificationToolCall = {
  type: "request_clarification";
  question: string;
  options: string[];
};

export type FetchNpcDetailToolCall = {
  type: "fetch_npc_detail";
  npcId: string;
};

export type FetchMarketPricesToolCall = {
  type: "fetch_market_prices";
  locationId: string;
};

export type FetchFactionIntelToolCall = {
  type: "fetch_faction_intel";
  factionId: string;
};

export type FetchInformationDetailToolCall = {
  type: "fetch_information_detail";
  informationId: string;
};

export type FetchInformationConnectionsToolCall = {
  type: "fetch_information_connections";
  informationIds: string[];
};

export type FetchRelationshipHistoryToolCall = {
  type: "fetch_relationship_history";
  npcId: string;
};

export type TurnFetchToolCall =
  | FetchNpcDetailToolCall
  | FetchMarketPricesToolCall
  | FetchFactionIntelToolCall
  | FetchInformationDetailToolCall
  | FetchInformationConnectionsToolCall
  | FetchRelationshipHistoryToolCall;

export type TurnFetchToolResult =
  | {
      type: "fetch_npc_detail";
      result: NpcDetail;
    }
  | {
      type: "fetch_market_prices";
      result: MarketPriceDetail[];
    }
  | {
      type: "fetch_faction_intel";
      result: FactionIntel;
    }
  | {
      type: "fetch_information_detail";
      result: InformationDetail;
    }
  | {
      type: "fetch_information_connections";
      result: CrossLocationLead[];
    }
  | {
      type: "fetch_relationship_history";
      result: RelationshipHistory;
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

export type ExecuteCombatToolCall = {
  type: "execute_combat";
  targetNpcId: string;
  approach: CombatApproach;
  narration: string;
  suggestedActions: string[];
  timeMode: "combat" | "exploration";
  timeElapsed: number;
  citedEntities: CitedEntities;
  memorySummary?: string;
};

export type ExecuteConverseToolCall = {
  type: "execute_converse";
  interlocutor: string;
  npcId?: string;
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

export type ExecuteTradeToolCall = {
  type: "execute_trade";
  action: TradeAction;
  marketPriceId: string;
  commodityId: string;
  quantity: number;
  narration: string;
  suggestedActions: string[];
  timeMode: "exploration" | "downtime";
  timeElapsed: number;
  citedEntities: CitedEntities;
  memorySummary?: string;
};

export type ExecuteRestToolCall = {
  type: "execute_rest";
  restType: RestType;
  narration: string;
  suggestedActions: string[];
  timeMode: "rest";
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
  | ExecuteCombatToolCall
  | ExecuteConverseToolCall
  | ExecuteInvestigateToolCall
  | ExecuteObserveToolCall
  | ExecuteTradeToolCall
  | ExecuteRestToolCall
  | ExecuteWaitToolCall
  | ExecuteFreeformToolCall;

export type TurnModelToolCall = TurnFetchToolCall | TurnActionToolCall;

export type TurnResolution = {
  command: TurnActionToolCall;
  fetchedFacts: TurnFetchToolResult[];
};

export type ValidatedTurnCommand =
  | RequestClarificationToolCall
  | (Exclude<TurnActionToolCall, RequestClarificationToolCall> & {
      warnings: string[];
      checkResult?: CheckResult;
    });

export type NpcRoutineCondition =
  | { type: "location_state"; locationId: string; state: string }
  | { type: "faction_at_war"; factionId: string }
  | { type: "npc_state"; npcId: string; state: NpcState }
  | { type: "time_range"; minMinutes: number; maxMinutes: number }
  | { type: "player_in_location"; locationId: string }
  | { type: "and"; conditions: NpcRoutineCondition[] }
  | { type: "or"; conditions: NpcRoutineCondition[] };

export type SimulationPayload =
  | { type: "change_location_state"; locationId: string; newState: string }
  | { type: "change_faction_control"; locationId: string; factionId: string | null }
  | { type: "change_npc_state"; npcId: string; newState: NpcState }
  | { type: "change_faction_resources"; factionId: string; delta: Partial<FactionResourcePool> }
  | {
      type: "spawn_world_event";
      event: {
        locationId: string | null;
        triggerTime: number;
        description: string;
        triggerCondition?: NpcRoutineCondition | null;
        payload: Exclude<SimulationPayload, { type: "spawn_world_event" }>;
      };
    }
  | {
      type: "spawn_information";
      information: {
        title: string;
        summary: string;
        content: string;
        truthfulness: "true" | "partial" | "false" | "outdated";
        accessibility: InformationAccessibility;
        locationId: string | null;
        factionId: string | null;
        sourceNpcId: string | null;
        expiresAtTime?: number | null;
      };
    }
  | { type: "cancel_faction_move"; factionMoveId: string; reason: string }
  | { type: "change_route_status"; edgeId: string; newStatus: string }
  | { type: "change_market_price"; marketPriceId: string; newModifier: number }
  | {
      type: "transfer_location_control";
      locationId: string;
      fromFactionId: string | null;
      toFactionId: string | null;
    }
  | { type: "change_npc_location"; npcId: string; newLocationId: string };

export type GeneratedDailySchedule = {
  worldEvents: Array<{
    locationId: string | null;
    triggerTime: number;
    description: string;
    triggerCondition?: NpcRoutineCondition | null;
    payload: SimulationPayload;
    cascadeDepth?: number;
  }>;
  factionMoves: Array<{
    factionId: string;
    scheduledAtTime: number;
    description: string;
    payload: SimulationPayload;
    cascadeDepth?: number;
  }>;
};

export type WorldFidelityIssue = {
  code:
    | "hallucinated_entity"
    | "uncited_mechanical_entity"
    | "invented_price"
    | "invented_fact"
    | "temporal_inconsistency"
    | "spatial_inconsistency";
  severity: "warn" | "block";
  evidence: string;
};

export type SimulationInverse = {
  table: string;
  id: string;
  field: string;
  previousValue: unknown;
  operation: "update" | "delete_created";
};

export type TurnRollbackData = {
  previousState: CampaignRuntimeState;
  previousSessionTurnCount: number;
  createdMessageIds: string[];
  createdMemoryIds: string[];
  discoveredInformation: Array<{
    id: string;
    previousIsDiscovered: boolean;
    previousDiscoveredAtTurn: number | null;
  }>;
  simulationInverses: SimulationInverse[];
  processedEventIds: string[];
  cancelledMoveIds: string[];
  createdWorldEventIds: string[];
  createdFactionMoveIds: string[];
  createdTemporaryActorIds: string[];
  createdCommodityStackIds: string[];
};
