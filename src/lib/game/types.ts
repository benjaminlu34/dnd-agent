export const STATS = [
  "strength",
  "agility",
  "intellect",
  "charisma",
  "vitality",
] as const;

export type Stat = (typeof STATS)[number];
export type CheckMode = "normal" | "advantage" | "disadvantage";
export type CheckOutcome = "success" | "partial" | "failure";
export type QuestStatus = "active" | "completed" | "failed";
export type ArcStatus = "active" | "complete" | "locked";
export type ClueStatus = "hidden" | "discovered" | "resolved";

export type CharacterTemplateDraft = {
  name: string;
  archetype: string;
  strength: number;
  agility: number;
  intellect: number;
  charisma: number;
  vitality: number;
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

export type GeneratedCampaignSetup = {
  publicSynopsis: {
    title: string;
    premise: string;
    tone: string;
    setting: string;
    openingScene: {
      title: string;
      summary: string;
      location: string;
      atmosphere: string;
      activeThreat: string;
      suggestedActions: string[];
    };
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
    locations: string[];
  };
};

export type SceneState = {
  id: string;
  title: string;
  summary: string;
  location: string;
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
  locations: string[];
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
  sceneSummary?: string;
  sceneTitle?: string;
  sceneAtmosphere?: string;
  activeArcId?: string;
  suggestedActions?: string[];
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
  memorySummary?: string;
  actionIntents?: StructuredActionIntent[];
};

export type ValidatedDelta = {
  nextState: CampaignState;
  nextCharacter: Pick<CampaignCharacter, "health" | "gold" | "inventory">;
  warnings: string[];
  acceptedQuestAdvancements: ProposedStateDelta["questAdvancements"];
  acceptedClueDiscoveries: string[];
  acceptedRevealTriggers: string[];
  acceptedArcAdvancements: ProposedStateDelta["arcAdvancements"];
  acceptedNpcChanges: ProposedStateDelta["npcApprovalChanges"];
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
  check?: {
    stat: Stat;
    mode: CheckMode;
    reason: string;
  };
  suggestedActions: string[];
  proposedDelta: ProposedStateDelta;
};

export type ResolveDecision = {
  suggestedActions: string[];
  proposedDelta: ProposedStateDelta;
};

export type PromptContext = {
  scene: SceneState;
  activeArc: ArcRecord | undefined;
  activeQuests: QuestRecord[];
  unresolvedHooks: Hook[];
  recentCanon: string[];
  relevantClues: Clue[];
  staleClues: Clue[];
  eligibleRevealIds: string[];
  eligibleRevealTexts: string[];
  companion: NpcRecord | null;
  villainClock: number;
  tensionScore: number;
  arcPacingHint: string | null;
};

export type PendingCheck = {
  stat: Stat;
  mode: CheckMode;
  reason: string;
};
