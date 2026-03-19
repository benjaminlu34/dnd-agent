import type {
  ArcRecord,
  CampaignBlueprint,
  CampaignCharacter,
  CampaignState,
  CharacterTemplate,
  Clue,
  GeneratedCampaignSetup,
  Hook,
  NpcRecord,
  QuestRecord,
  SceneState,
} from "@/lib/game/types";
import { randomItem, slugify } from "@/lib/utils";

const archetypes = [
  {
    archetype: "Spellscarred Scout",
    name: "Mira Thorne",
    stats: {
      strength: 0,
      dexterity: 2,
      constitution: 0,
      intelligence: 1,
      wisdom: 1,
      charisma: 0,
    },
  },
  {
    archetype: "Ashen Knight",
    name: "Corin Vale",
    stats: {
      strength: 2,
      dexterity: 0,
      constitution: 2,
      intelligence: 0,
      wisdom: 0,
      charisma: 1,
    },
  },
  {
    archetype: "Moonlit Antiquarian",
    name: "Seren Hollow",
    stats: {
      strength: -1,
      dexterity: 0,
      constitution: 0,
      intelligence: 2,
      wisdom: 1,
      charisma: 1,
    },
  },
] as const;

const seededCharacterStats = {
  strength: 1,
  dexterity: 1,
  constitution: 1,
  intelligence: 1,
  wisdom: 1,
  charisma: 1,
} as const;

type StarterStateOverrides = {
  openingScene?: Omit<SceneState, "id" | "keyLocationName"> & {
    id?: string;
    keyLocationName?: string | null;
  };
  activeThreat?: string;
  discoveredSceneLocations?: string[];
  discoveredKeyLocationNames?: string[];
  villainClock?: number;
  tensionScore?: number;
  dangerLevel?: CampaignState["worldState"]["dangerLevel"];
};

export function createDefaultCharacterTemplate(): CharacterTemplate {
  return {
    id: "template_session_zero_wayfarer",
    name: "Rowan Vale",
    archetype: "Waymarked Wanderer",
    strength: seededCharacterStats.strength,
    dexterity: seededCharacterStats.dexterity,
    constitution: seededCharacterStats.constitution,
    intelligence: seededCharacterStats.intelligence,
    wisdom: seededCharacterStats.wisdom,
    charisma: seededCharacterStats.charisma,
    maxHealth: 12,
    backstory:
      "A road-worn wanderer who carries old maps, half-finished vows, and the habit of showing up where the dark is thickest.",
    starterItems: ["weathered map case", "camp knife"],
  };
}

export function createDefaultAdventureModuleSetup(): GeneratedCampaignSetup {
  return {
    publicSynopsis: {
      title: "Ashen Bell of Briar Glen",
      premise:
        "A pilgrim-town built around a shattered observatory is sliding toward an eclipse cult uprising.",
      tone: "Gothic adventure with hopeful heroism",
      setting: "The lantern-streaked valley of Briar Glen",
    },
    secretEngine: {
      villain: {
        name: "Abbess Veyra",
        motive: "Awaken the eclipse saint buried under the observatory",
        progressClock: 10,
      },
      hooks: [
        {
          text: "Find the stolen Silver Bell before the eclipse feast.",
        },
        {
          text: "Learn why the town blacksmith vanished after sealing the crypt gates.",
        },
      ],
      arcs: [
        {
          title: "The Bell Below",
          summary: "Track the stolen relic through catacombs and cult safehouses.",
          expectedTurns: 8,
        },
        {
          title: "Ash Before Dawn",
          summary: "Disrupt the eclipse rite before the valley becomes a shrine of hunger.",
          expectedTurns: 10,
        },
      ],
      reveals: [
        {
          title: "The Missing Blacksmith",
          truth:
            "The blacksmith hides beneath the observatory forge, forced to craft the eclipse saint's chains.",
          requiredClueTitles: [
            "Hammer marks on the market fountain match the blacksmith's sigil.",
            "Fresh cinders under locked forge doors prove someone works below ground at night.",
            "A folded prayer strip mentions chains forged for a saint beneath the observatory.",
          ],
          requiredArcTitles: ["The Bell Below"],
        },
      ],
      subplotSeeds: [
        {
          title: "Lark's Vow",
          hook: "Your companion Lark seeks the name of the saint who destroyed her family chapel.",
        },
      ],
      quests: [
        {
          title: "Recover the Silver Bell",
          summary: "Trace the thieves and return the relic before the eclipse feast.",
          maxStage: 2,
          rewardGold: 25,
          rewardItem: "moon-salt charm",
        },
      ],
      npcs: [
        {
          name: "Lark",
          role: "Companion",
          notes: "A quick-eyed scout who masks fear with dry humor.",
          isCompanion: true,
          approval: 1,
          personalHook: "Identify the saint tied to her ruined chapel.",
          status: "watchful",
        },
        {
          name: "Mother Ysilde",
          role: "Bell-warden",
          notes: "Caretaker of the Silver Bell and guardian of the square.",
          status: "harried",
        },
      ],
      clues: [
        {
          text: "Hammer marks on the market fountain match the blacksmith's sigil.",
          source: "Ash Market fountain",
          linkedRevealTitle: "The Missing Blacksmith",
        },
        {
          text: "Fresh cinders under locked forge doors prove someone works below ground at night.",
          source: "Old Smithy",
          linkedRevealTitle: "The Missing Blacksmith",
        },
        {
          text: "A folded prayer strip mentions chains forged for a saint beneath the observatory.",
          source: "Lantern Catacombs",
          linkedRevealTitle: "The Missing Blacksmith",
        },
      ],
      keyLocations: [
        {
          name: "Ash Market",
          role: "crowded town market and rumor hub",
          isPublic: true,
        },
        {
          name: "Old Smithy",
          role: "boarded forge tied to the missing blacksmith",
          isPublic: true,
        },
        {
          name: "Lantern Catacombs",
          role: "buried cult passages under the town",
          isPublic: false,
        },
        {
          name: "Shattered Observatory",
          role: "hilltop ruin where the eclipse rite points",
          isPublic: true,
        },
      ],
    },
  };
}

export function createStarterCharacter(): CampaignCharacter {
  const choice = randomItem([...archetypes]);
  return {
    id: `template_${slugify(choice.name)}`,
    instanceId: `instance_${slugify(choice.name)}`,
    templateId: `template_${slugify(choice.name)}`,
    name: choice.name,
    archetype: choice.archetype,
    strength: choice.stats.strength,
    dexterity: choice.stats.dexterity,
    constitution: choice.stats.constitution,
    intelligence: choice.stats.intelligence,
    wisdom: choice.stats.wisdom,
    charisma: choice.stats.charisma,
    stats: choice.stats,
    maxHealth: 12,
    health: 12,
    gold: 0,
    inventory: [],
    backstory: `${choice.name} has spent too long following rumors that should have stayed buried.`,
    starterItems: [],
  };
}

export function createStarterBlueprint(): CampaignBlueprint {
  const hooks: Hook[] = [
    {
      id: "hook_silver_bell",
      text: "Find the stolen Silver Bell before the eclipse feast.",
      status: "open",
    },
    {
      id: "hook_missing_blacksmith",
      text: "Learn why the town blacksmith vanished after sealing the crypt gates.",
      status: "open",
    },
  ];

  return {
    premise:
      "A pilgrim-town built around a shattered observatory is sliding toward an eclipse cult uprising.",
    tone: "Gothic adventure with hopeful heroism",
    setting: "The lantern-streaked valley of Briar Glen",
    keyLocations: createDefaultAdventureModuleSetup().secretEngine.keyLocations,
    villain: {
      name: "Abbess Veyra",
      motive: "Awaken the eclipse saint buried under the observatory",
      progressClock: 10,
    },
    arcs: [
      {
        id: "arc_bell",
        title: "The Bell Below",
        summary: "Track the stolen relic through catacombs and cult safehouses.",
        expectedTurns: 8,
      },
      {
        id: "arc_eclipse",
        title: "Ash Before Dawn",
        summary: "Disrupt the eclipse rite before the valley becomes a shrine of hunger.",
        expectedTurns: 10,
      },
    ],
    hiddenReveals: [
      {
        id: "reveal_blacksmith",
        title: "The Missing Blacksmith",
        truth:
          "The blacksmith hides beneath the observatory forge, forced to craft the eclipse saint's chains.",
        requiredClues: [
          "clue_hammer_marks",
          "clue_warm_cinders",
          "clue_forged_prayer",
        ],
        requiredArcIds: ["arc_bell"],
        triggered: false,
      },
    ],
    subplotSeeds: [
      {
        id: "subplot_companion",
        title: "Lark's Vow",
        hook: "Your companion Lark seeks the name of the saint who destroyed her family chapel.",
      },
    ],
    initialHooks: hooks,
  };
}

export function createStarterState(
  blueprint: CampaignBlueprint,
  overrides: StarterStateOverrides = {},
): CampaignState {
  const defaultScene: SceneState = {
    id: "scene_ash_market",
    title: "Ash Market at Dusk",
    summary:
      "Wind rattles brass prayer bells while the market square clears around a blood-red eclipse notice nailed to the fountain.",
    location: "Ash Market fountain",
    keyLocationName: "Ash Market",
    atmosphere: "Uneasy, crowded, and one spark away from panic",
    suggestedActions: [
      "Inspect the eclipse notice",
      "Question the bell-warden",
      "Follow the fresh soot trail toward the smithy",
    ],
  };
  const sceneState = overrides.openingScene
    ? {
        ...defaultScene,
        ...overrides.openingScene,
        id:
          overrides.openingScene.id ??
          `scene_${slugify(overrides.openingScene.title || defaultScene.title) || "opening"}`,
      }
    : defaultScene;

  return {
    turnCount: 0,
    activeArcId: blueprint.arcs[0]?.id ?? "arc_bell",
    worldState: {
      dangerLevel: overrides.dangerLevel ?? "rising",
      activeThreat: overrides.activeThreat ?? "Cult lantern-bearers are searching the old quarter.",
    },
    sceneState,
    discoveredSceneLocations: overrides.discoveredSceneLocations ?? [sceneState.location],
    discoveredKeyLocationNames:
      overrides.discoveredKeyLocationNames ?? (sceneState.keyLocationName ? [sceneState.keyLocationName] : []),
    hooks: blueprint.initialHooks,
    villainClock: overrides.villainClock ?? 2,
    tensionScore: overrides.tensionScore ?? 28,
    activeRevealIds: [],
    pendingTurnId: null,
  };
}

export function createStarterQuests(): QuestRecord[] {
  return [
    {
      id: "quest_silver_bell",
      title: "Recover the Silver Bell",
      summary: "Trace the thieves and return the relic before the eclipse feast.",
      stage: 0,
      maxStage: 2,
      status: "active",
      rewardGold: 25,
      rewardItem: {
        templateId: "item_template_moon_salt_charm",
        name: "moon-salt charm",
      },
      discoveredAtTurn: null,
    },
  ];
}

export function createStarterArcs(): ArcRecord[] {
  return [
    {
      id: "arc_bell",
      title: "The Bell Below",
      summary: "Track the stolen relic through the first layer of the conspiracy.",
      status: "active",
      expectedTurns: 8,
      currentTurn: 0,
      orderIndex: 0,
    },
    {
      id: "arc_eclipse",
      title: "Ash Before Dawn",
      summary: "Confront the rite once the town knows where the threat truly lies.",
      status: "locked",
      expectedTurns: 10,
      currentTurn: 0,
      orderIndex: 1,
    },
  ];
}

export function createStarterNpcs(): NpcRecord[] {
  return [
    {
      id: "npc_lark",
      name: "Lark",
      role: "Companion",
      status: "watchful",
      isCompanion: true,
      approval: 1,
      personalHook: "Identify the saint tied to her ruined chapel.",
      notes: "A quick-eyed scout who masks fear with dry humor.",
      discoveredAtTurn: null,
    },
    {
      id: "npc_bellwarden",
      name: "Mother Ysilde",
      role: "Bell-warden",
      status: "harried",
      isCompanion: false,
      approval: 0,
      personalHook: null,
      notes: "Caretaker of the Silver Bell and guardian of the square.",
      discoveredAtTurn: null,
    },
  ];
}

export function createStarterClues(): Clue[] {
  return [
    {
      id: "clue_hammer_marks",
      text: "Hammer marks on the market fountain match the blacksmith's sigil.",
      source: "Ash Market fountain",
      linkedRevealId: "reveal_blacksmith",
      status: "hidden",
      discoveredAtTurn: null,
    },
    {
      id: "clue_warm_cinders",
      text: "Fresh cinders under locked forge doors prove someone works below ground at night.",
      source: "Old Smithy",
      linkedRevealId: "reveal_blacksmith",
      status: "hidden",
      discoveredAtTurn: null,
    },
    {
      id: "clue_forged_prayer",
      text: "A folded prayer strip mentions chains forged for a saint beneath the observatory.",
      source: "Lantern Catacombs",
      linkedRevealId: "reveal_blacksmith",
      status: "hidden",
      discoveredAtTurn: null,
    },
  ];
}
