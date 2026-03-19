export const STATS = [
  "strength",
  "dexterity",
  "constitution",
  "intelligence",
  "wisdom",
  "charisma",
] as const;

export type Stat = (typeof STATS)[number];
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

export type CheckMode = "normal" | "advantage" | "disadvantage";
export type CheckOutcome = "success" | "partial" | "failure";
export type QuestStatus = "active" | "completed" | "failed";
export type ArcStatus = "active" | "complete" | "locked";
export type ClueStatus = "hidden" | "discovered" | "resolved";

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
};

export type CharacterTemplate = CharacterTemplateDraft & {
  id: string;
};

export type CharacterInstance = {
  id: string;
  templateId: string;
  health: number;
  gold: number;
  inventory: string[];
};

export type CampaignCharacter = CharacterTemplate & {
  instanceId: string;
  templateId: string;
  stats: Record<Stat, number>;
  health: number;
  gold: number;
  inventory: string[];
};

export type CharacterTemplateSummary = CharacterTemplate & {
  createdAt: string;
  updatedAt: string;
};

export type Hook = {
  id: string;
  text: string;
  status: "open" | "resolved";
};

export type Reveal = {
  id: string;
  title: string;
  truth: string;
  requiredClues: string[];
  requiredArcIds: string[];
  triggered: boolean;
};

export type Clue = {
  id: string;
  text: string;
  source: string;
  linkedRevealId: string;
  status: ClueStatus;
  discoveredAtTurn: number | null;
};

export type Subplot = {
  id: string;
  title: string;
  hook: string;
};

export type CampaignArcBlueprint = {
  id: string;
  title: string;
  summary: string;
  expectedTurns: number;
};

export type CampaignBlueprint = {
  premise: string;
  tone: string;
  setting: string;
  keyLocations: KeyLocation[];
  villain: {
    name: string;
    motive: string;
    progressClock: number;
  };
  arcs: CampaignArcBlueprint[];
  hiddenReveals: Reveal[];
  subplotSeeds: Subplot[];
  initialHooks: Hook[];
};

export type KeyLocation = {
  name: string;
  role: string;
  isPublic: boolean;
};

export type GeneratedCampaignSetup = {
  publicSynopsis: {
    title: string;
    premise: string;
    tone: string;
    setting: string;
  };
  secretEngine: {
    villain: {
      name: string;
      motive: string;
      progressClock: number;
    };
    hooks: {
      text: string;
    }[];
    arcs: {
      title: string;
      summary: string;
      expectedTurns: number;
    }[];
    reveals: {
      title: string;
      truth: string;
      requiredClueTitles: string[];
      requiredArcTitles: string[];
    }[];
    subplotSeeds: {
      title: string;
      hook: string;
    }[];
    quests: {
      title: string;
      summary: string;
      maxStage: number;
      rewardGold: number;
      rewardItem?: string | null;
    }[];
    npcs: {
      name: string;
      role: string;
      notes: string;
      isCompanion?: boolean;
      approval?: number;
      personalHook?: string | null;
      status?: string;
    }[];
    clues: {
      text: string;
      source: string;
      linkedRevealTitle: string;
    }[];
    keyLocations: KeyLocation[];
  };
};

export type GeneratedCampaignOpening = {
  narration: string;
  activeThreat: string;
  scene: {
    title: string;
    summary: string;
    location: string;
    keyLocationName?: string | null;
    atmosphere: string;
    suggestedActions: string[];
  };
};

export type AdventureModuleSummary = {
  id: string;
  title: string;
  premise: string;
  tone: string;
  setting: string;
  campaignCount: number;
  createdAt: string;
  updatedAt: string;
};

export type SceneState = {
  id: string;
  title: string;
  summary: string;
  location: string;
  keyLocationName: string | null;
  atmosphere: string;
  suggestedActions: string[];
};

export type CampaignState = {
  turnCount: number;
  activeArcId: string;
  worldState: {
    dangerLevel: "low" | "rising" | "high";
    activeThreat: string;
  };
  sceneState: SceneState;
  discoveredSceneLocations: string[];
  discoveredKeyLocationNames: string[];
  hooks: Hook[];
  villainClock: number;
  tensionScore: number;
  activeRevealIds: string[];
  pendingTurnId: string | null;
};

export type QuestRecord = {
  id: string;
  title: string;
  summary: string;
  stage: number;
  maxStage: number;
  status: QuestStatus;
  rewardGold: number;
  rewardItem: string | null;
  discoveredAtTurn: number | null;
};

export type ArcRecord = {
  id: string;
  title: string;
  summary: string;
  status: ArcStatus;
  expectedTurns: number;
  currentTurn: number;
  orderIndex: number;
};

export type NpcRecord = {
  id: string;
  name: string;
  role: string;
  status: string;
  isCompanion: boolean;
  approval: number;
  personalHook: string | null;
  notes: string;
  discoveredAtTurn: number | null;
};

export type MemoryRecord = {
  id: string;
  type: string;
  summary: string;
  createdAt: string;
};

export type RecentResolvedTurn = {
  id: string;
  playerAction: string;
  resultJson: unknown;
};

export type CampaignSnapshot = {
  campaignId: string;
  sessionId: string;
  title: string;
  premise: string;
  tone: string;
  setting: string;
  blueprint: CampaignBlueprint;
  state: CampaignState;
  character: CampaignCharacter;
  quests: QuestRecord[];
  arcs: ArcRecord[];
  npcs: NpcRecord[];
  clues: Clue[];
  memories: MemoryRecord[];
  recentMessages: StoryMessage[];
  recentResolvedTurns: RecentResolvedTurn[];
  previouslyOn: string | null;
  latestResolvedTurnId: string | null;
  canRetryLatestTurn: boolean;
};

export type PlayerCampaignState = {
  turnCount: number;
  sceneState: SceneState;
};

export type PlayerVisibleQuestRecord = {
  id: string;
  title: string;
  summary: string | null;
  stage: number;
  maxStage: number;
  status: QuestStatus;
};

export type PlayerVisibleNpcRecord = {
  id: string;
  name: string;
  role: string | null;
  notes: string | null;
  isCompanion: boolean;
};

export type PlayerVisibleClue = {
  id: string;
  text: string;
  source: string;
  status: ClueStatus;
  discoveredAtTurn: number | null;
};

export type PlayerVisibleKeyLocation = {
  name: string;
  role: string;
};

export type PlayerCampaignSnapshot = {
  campaignId: string;
  sessionId: string;
  title: string;
  premise: string;
  tone: string;
  setting: string;
  knownKeyLocations: PlayerVisibleKeyLocation[];
  knownSceneLocations: string[];
  state: PlayerCampaignState;
  character: CampaignCharacter;
  quests: PlayerVisibleQuestRecord[];
  npcs: PlayerVisibleNpcRecord[];
  clues: PlayerVisibleClue[];
  memories: MemoryRecord[];
  recentMessages: StoryMessage[];
  previouslyOn: string | null;
  latestResolvedTurnId: string | null;
  canRetryLatestTurn: boolean;
};

export type CampaignListItem = {
  id: string;
  title: string;
  premise: string;
  setting: string;
  tone: string;
  characterName: string;
  characterArchetype: string;
  sessionTitle: string | null;
  turnCount: number;
  updatedAt: string;
  createdAt: string;
};

export type StoryMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  kind: "action" | "narration" | "check" | "summary" | "warning";
  content: string;
  createdAt: string;
  payload?: Record<string, unknown> | null;
};

export type StructuredActionIntent =
  | { type: "gain_reward"; questId: string }
  | { type: "advance_quest"; questId: string; nextStage: number }
  | { type: "discover_clue"; clueId: string }
  | { type: "trigger_reveal"; revealId: string }
  | { type: "use_item"; itemId: string }
  | { type: "adjust_companion"; npcId: string; approvalDelta: number; reason: string };

export type ProposedStateDelta = {
  sceneSnapshot?: string;
  sceneTitle?: string;
  sceneLocation?: string;
  sceneKeyLocation?: string | null;
  sceneAtmosphere?: string;
  activeArcId?: string;
  suggestedActions?: string[];
  healthDelta?: number;
  goldChange?: number;
  rewardQuestId?: string | null;
  inventoryChanges?: {
    add?: string[];
    remove?: string[];
  };
  questAdvancements?: {
    questId: string;
    nextStage: number;
    status?: QuestStatus;
  }[];
  questDiscoveries?: string[];
  keyLocationDiscoveries?: string[];
  clueDiscoveries?: string[];
  revealTriggers?: string[];
  villainClockDelta?: number;
  tensionDelta?: number;
  arcAdvancements?: {
    arcId: string;
    currentTurnDelta?: number;
    status?: ArcStatus;
  }[];
  npcApprovalChanges?: {
    npcId: string;
    approvalDelta: number;
    reason: string;
  }[];
  npcDiscoveries?: string[];
  memorySummary?: string;
  actionIntents?: StructuredActionIntent[];
};

export type TurnFacts = {
  action: string;
  roll?: string;
  healthDelta: number;
  discoveries: string[];
  sceneChanged: boolean;
};

export type ValidatedDelta = {
  nextState: CampaignState;
  nextCharacter: Pick<CampaignCharacter, "health" | "gold" | "inventory">;
  healthDelta?: number;
  warnings: string[];
  acceptedQuestAdvancements: ProposedStateDelta["questAdvancements"];
  acceptedQuestDiscoveries: string[];
  acceptedClueDiscoveries: string[];
  acceptedRevealTriggers: string[];
  acceptedArcAdvancements: ProposedStateDelta["arcAdvancements"];
  acceptedNpcChanges: ProposedStateDelta["npcApprovalChanges"];
  acceptedNpcDiscoveries: string[];
  awardedGold: number;
  acceptedInventoryChanges: NonNullable<ProposedStateDelta["inventoryChanges"]>;
  memorySummary?: string;
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

export type TriageDecision = {
  requiresCheck: boolean;
  narration: string | null;
  isInvestigative: boolean;
  check?: {
    stat: Stat;
    mode: CheckMode;
    reason: string;
  };
  suggestedActions: string[];
  proposedDelta: ProposedStateDelta;
};

export type ResolveDecision = {
  narration: string;
  suggestedActions: string[];
  proposedDelta: ProposedStateDelta;
};

export type PromptContext = {
  scene: SceneState;
  keyLocations: KeyLocation[];
  discoveredKeyLocations: KeyLocation[];
  recentSceneTrail: string[];
  promptSceneSummary: string;
  activeArc: ArcRecord | undefined;
  activeQuests: QuestRecord[];
  hiddenQuests: QuestRecord[];
  recentTurnLedger: string[];
  narrativeSummary: string | null;
  relevantClues: Clue[];
  staleClues: Clue[];
  eligibleRevealIds: string[];
  discoveredClues: Clue[];
  companion: NpcRecord | null;
  hiddenNpcs: NpcRecord[];
  discoveryCandidates: {
    quests: {
      id: string;
      title: string;
    }[];
    npcs: {
      id: string;
      name: string;
      role: string;
    }[];
  };
  villainClock: number;
  tensionScore: number;
  arcPacingHint: string | null;
};

export type PendingCheck = {
  stat: Stat;
  mode: CheckMode;
  reason: string;
  isInvestigative: boolean;
};
