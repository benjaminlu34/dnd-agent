import type {
  ArcRecord,
  CampaignBlueprint,
  CampaignState,
  CharacterSheet,
  Clue,
  Hook,
  NpcRecord,
  QuestRecord,
} from "@/lib/game/types";
import { randomItem, slugify } from "@/lib/utils";

const archetypes = [
  {
    archetype: "Spellscarred Scout",
    name: "Mira Thorne",
    stats: {
      strength: 0,
      agility: 2,
      intellect: 1,
      charisma: 0,
      vitality: 1,
    },
  },
  {
    archetype: "Ashen Knight",
    name: "Corin Vale",
    stats: {
      strength: 2,
      agility: 0,
      intellect: 0,
      charisma: 1,
      vitality: 1,
    },
  },
  {
    archetype: "Moonlit Antiquarian",
    name: "Seren Hollow",
    stats: {
      strength: -1,
      agility: 0,
      intellect: 2,
      charisma: 1,
      vitality: 1,
    },
  },
] as const;

export function createStarterCharacter(): CharacterSheet {
  const choice = randomItem([...archetypes]);
  return {
    id: `char_${slugify(choice.name)}`,
    name: choice.name,
    archetype: choice.archetype,
    stats: choice.stats,
    maxHealth: 12,
    health: 12,
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

export function createStarterState(blueprint: CampaignBlueprint): CampaignState {
  return {
    turnCount: 0,
    activeArcId: blueprint.arcs[0]?.id ?? "arc_bell",
    worldState: {
      dangerLevel: "rising",
      activeThreat: "Cult lantern-bearers are searching the old quarter.",
    },
    sceneState: {
      id: "scene_ash_market",
      title: "Ash Market at Dusk",
      summary:
        "Wind rattles brass prayer bells while the market square clears around a blood-red eclipse notice nailed to the fountain.",
      location: "Briar Glen",
      atmosphere: "Uneasy, crowded, and one spark away from panic",
      suggestedActions: [
        "Inspect the eclipse notice",
        "Question the bell-warden",
        "Follow the fresh soot trail toward the smithy",
      ],
    },
    locations: ["Ash Market", "Old Smithy", "Lantern Catacombs"],
    hooks: blueprint.initialHooks,
    villainClock: 2,
    tensionScore: 28,
    inventory: [],
    gold: 0,
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
      rewardItem: "moon-salt charm",
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
