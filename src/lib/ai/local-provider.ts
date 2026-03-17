import { toCampaignSeedCharacter } from "@/lib/game/characters";
import { createDefaultCharacterTemplate } from "@/lib/game/starter-data";
import type {
  CampaignBlueprint,
  CharacterTemplateDraft,
  CharacterSheet,
  CheckOutcome,
  CheckResult,
  GeneratedCampaignSetup,
  PromptContext,
  ProposedStateDelta,
  QuestRecord,
  ResolveDecision,
  Stat,
  TriageDecision,
} from "@/lib/game/types";
import { clamp, slugify } from "@/lib/utils";

type CampaignSetupGenerationInput = {
  prompt?: string;
  previousDraft?: GeneratedCampaignSetup;
};

type StreamCallbacks = {
  onNarration?: (chunk: string) => void;
};

type TurnAIPayload = {
  blueprint: CampaignBlueprint;
  promptContext: PromptContext;
  playerAction: string;
};

type ThemeProfile = {
  id: string;
  keywords: RegExp;
  tone: string[];
  titlePrefixes: string[];
  titleFocuses: string[];
  placeRoots: string[];
  placeSuffixes: string[];
  settingDescriptors: string[];
  settlements: string[];
  landmarks: string[];
  atmospheres: string[];
  villainTitles: string[];
  villainNames: string[];
  conspiracies: string[];
  motives: string[];
  threats: string[];
  relics: string[];
  companionNames: string[];
  companionRoles: string[];
  authorityRoles: string[];
  suspectRoles: string[];
  sideRoles: string[];
  locationTraits: string[];
};

type ActionIntent = {
  kind:
    | "inspect"
    | "social"
    | "stealth"
    | "force"
    | "travel"
    | "ritual"
    | "support"
    | "rest";
  stat: Stat;
  requiresCheck: boolean;
  mode: "normal" | "advantage" | "disadvantage";
};

const THEME_LIBRARY: ThemeProfile[] = [
  {
    id: "gothic",
    keywords: /\b(gothic|grave|crypt|cathedral|eclipse|blood|saint|funeral|bell)\b/i,
    tone: ["Gothic mystery with stubborn hope", "Haunted pilgrimage with flashes of courage"],
    titlePrefixes: ["Ashen", "Hollow", "Red", "Veiled", "Bellwrought"],
    titleFocuses: ["Lantern", "Crown", "Bell", "Reliquary", "Vigil"],
    placeRoots: ["Briar", "Gloam", "Mourn", "Ash", "Vesper"],
    placeSuffixes: ["Glen", "Hollow", "Reach", "Ward", "Vale"],
    settingDescriptors: ["a lantern-streaked", "a grave-crowned", "a chapel-shadowed"],
    settlements: ["pilgrim-town", "cathedral ward", "valley hamlet"],
    landmarks: ["the ash market", "the reliquary stairs", "the bell crypt", "the old observatory"],
    atmospheres: ["wind-torn and watchful", "crowded with dread", "full of low bells and held breath"],
    villainTitles: ["Abbess", "Bell Warden", "Grave Canon", "Reliquary Keeper"],
    villainNames: ["Sevrin", "Ilyra", "Veyra", "Maraud", "Thess"],
    conspiracies: [
      "a saint-cult gathering teeth in the dark",
      "a reliquary conspiracy hidden under public ritual",
      "a funeral procession masking recruitment and theft",
    ],
    motives: [
      "wake the buried saint before the town remembers how to refuse",
      "bind the valley to a miracle that feeds on fear",
      "open the crypt roads and let the old choir walk again",
    ],
    threats: [
      "hooded lantern-bearers",
      "grave acolytes with soot on their cuffs",
      "bell-rope scouts moving through side streets",
    ],
    relics: ["saint's bell", "sepulchral key", "glass censer", "black prayer chain"],
    companionNames: ["Lark", "Sable", "Mira", "Ruin"],
    companionRoles: ["chapel scout", "grave-runner", "lantern guide"],
    authorityRoles: ["bell-warden", "funeral cantor", "ward steward"],
    suspectRoles: ["crypt porter", "ink-fingered sexton", "night sacristan"],
    sideRoles: ["market apothecary", "mourning smith", "shrine keeper"],
    locationTraits: ["chalk sigils", "cold candle wax", "fresh soot", "torn prayer paper"],
  },
  {
    id: "maritime",
    keywords: /\b(sea|ship|storm|harbor|pirate|port|tide|captain|reef)\b/i,
    tone: ["Salt-bitten adventure with knife-edge suspense", "Seafaring intrigue under gathering weather"],
    titlePrefixes: ["Storm", "Salt", "Black", "Leeward", "Breaker"],
    titleFocuses: ["Harbor", "Compass", "Tide", "Lantern", "Keel"],
    placeRoots: ["Brine", "Gull", "Tern", "Wreck", "Cinder"],
    placeSuffixes: ["Harbor", "Reach", "Quay", "Hook", "Mouth"],
    settingDescriptors: ["a storm-battered", "a cliff-bound", "a tide-cut"],
    settlements: ["port town", "reef harbor", "customs enclave"],
    landmarks: ["the fishmarket piers", "the ropewalk", "the drowned chapel", "the customs tower"],
    atmospheres: ["slick with rain and rumor", "alive with gulls and low threats", "tense under a bruised sky"],
    villainTitles: ["Harbormaster", "Reef Captain", "Tidemother", "Salt Magistrate"],
    villainNames: ["Avel", "Corren", "Neris", "Dain", "Vale"],
    conspiracies: [
      "a smuggling ring moving cursed cargo through the harbor watch",
      "a drowned shrine bargain reshaping the tides",
      "a customs ledger being used to hide disappearances at sea",
    ],
    motives: [
      "claim the harbor by turning every debt into leverage",
      "feed the reef spirit until the old lighthouse answers only to them",
      "pull a vanished fleet back through a blood-marked channel",
    ],
    threats: ["dock bruisers in oilskins", "reef scouts on the rooftops", "customs enforcers with forged warrants"],
    relics: ["stormglass compass", "reef key", "captain's ledger", "bone tide idol"],
    companionNames: ["Tamsin", "Pike", "Nell", "Rook"],
    companionRoles: ["deck scout", "former smuggler", "harbor runner"],
    authorityRoles: ["pier marshal", "lighthouse keeper", "tally clerk"],
    suspectRoles: ["net-mender", "reef diver", "customs sergeant"],
    sideRoles: ["dock physician", "bait seller", "rigging master"],
    locationTraits: ["salt-slick planks", "storm rope fibers", "lantern soot", "brine-stained ledgers"],
  },
  {
    id: "winter",
    keywords: /\b(winter|snow|frost|ice|glacier|aurora|blizzard)\b/i,
    tone: ["Bleak survival fantasy with warm human bonds", "Frostbound mystery under quiet pressure"],
    titlePrefixes: ["Frost", "White", "Rime", "Snowblind", "Pale"],
    titleFocuses: ["Beacon", "Gate", "Watch", "Cairn", "Oath"],
    placeRoots: ["Rime", "Snow", "Kestrel", "Ice", "Pine"],
    placeSuffixes: ["Hollow", "Keep", "Spur", "Cross", "Rest"],
    settingDescriptors: ["a snow-buried", "a wind-carved", "an aurora-lit"],
    settlements: ["mountain hold", "pass settlement", "icebound outpost"],
    landmarks: ["the thaw square", "the watch fires", "the buried hall", "the glacier stairs"],
    atmospheres: ["knife-cold and brittle", "quiet enough to hear fear travel", "lit by thin blue fire"],
    villainTitles: ["White Speaker", "Warden", "Ice Prior", "Avalanche Keeper"],
    villainNames: ["Hedra", "Skell", "Varin", "Elsa", "Tor"],
    conspiracies: [
      "a ration conspiracy hidden inside the winter watch",
      "a frozen oath being enforced through staged disappearances",
      "a buried shrine bargain thawing at the wrong time",
    ],
    motives: [
      "bind the settlement to obedience before the last stores run thin",
      "wake the glacier oracle and monopolize its warnings",
      "turn a desperate truce into permanent rule",
    ],
    threats: ["fur-cloaked enforcers", "snow trackers with seal-oil lamps", "watchers moving ridge to ridge"],
    relics: ["aurora shard", "winter seal", "icebound charter", "bone-fire horn"],
    companionNames: ["Edda", "Fen", "Kori", "Vika"],
    companionRoles: ["pass guide", "watch deserter", "sled runner"],
    authorityRoles: ["storehouse steward", "watch captain", "hearth priest"],
    suspectRoles: ["ice fisher", "lamp tender", "trail cutter"],
    sideRoles: ["furrier", "scribe of stores", "brew keeper"],
    locationTraits: ["rime on hinges", "boot grooves in packed snow", "ash from indoor braziers", "frozen prayer knots"],
  },
  {
    id: "desert",
    keywords: /\b(desert|sand|dune|sun|oasis|mirage|caravan)\b/i,
    tone: ["Sun-struck intrigue with ancient pressure", "Desert adventure shaped by bargains and memory"],
    titlePrefixes: ["Sunscorched", "Amber", "Dust", "Mirage", "Saffron"],
    titleFocuses: ["Archive", "Gate", "Caravan", "Spire", "Oasis"],
    placeRoots: ["Ember", "Saffra", "Khep", "Dune", "Aster"],
    placeSuffixes: ["Reach", "Basin", "Spire", "Mouth", "Crossing"],
    settingDescriptors: ["a heat-shimmered", "a caravan-bound", "an oasis-ringed"],
    settlements: ["desert city", "trade crossing", "sandstone enclave"],
    landmarks: ["the water court", "the caravan terraces", "the buried archive", "the sun gate"],
    atmospheres: ["bright enough to hide danger in plain sight", "dry, crowded, and waiting for a spark", "full of heat-haze and watchful silence"],
    villainTitles: ["Archivist", "Sun Vizier", "Caravan Judge", "Oasis Regent"],
    villainNames: ["Kasim", "Selket", "Nahara", "Ibris", "Tarek"],
    conspiracies: [
      "an archive theft hidden inside a trade dispute",
      "a caravan protection racket dressed up as law",
      "an oasis cult using lost maps to steer whole families into dependency",
    ],
    motives: [
      "control the routes before the next moon-market arrives",
      "raise an old sun engine and make water obedience's price",
      "erase the records that would break their claim to rule",
    ],
    threats: ["veil-wrapped outriders", "market blades working as escorts", "silent watchers above the awnings"],
    relics: ["sun dial key", "salt charter", "sand-sealed coffer", "mirror shard"],
    companionNames: ["Tariq", "Nima", "Sori", "Kessa"],
    companionRoles: ["caravan scout", "map runner", "water-smuggler"],
    authorityRoles: ["well keeper", "market judge", "archive warden"],
    suspectRoles: ["camel master", "glass worker", "courier"],
    sideRoles: ["tea seller", "stone mason", "scribe"],
    locationTraits: ["chalked route marks", "wind-cut seals", "dry perfume", "fresh sand where there should be shade"],
  },
  {
    id: "wildwood",
    keywords: /\b(forest|wood|grove|fae|thorn|hunter|wild)\b/i,
    tone: ["Folkloric danger with bright, lived-in courage", "Wildwood intrigue where every path remembers"],
    titlePrefixes: ["Thorn", "Green", "Moonlit", "Rootbound", "Briar"],
    titleFocuses: ["Grove", "Cairn", "Path", "Crown", "Hearth"],
    placeRoots: ["Briar", "Oak", "Moss", "Rowan", "Thorn"],
    placeSuffixes: ["Hollow", "Run", "Watch", "Grove", "Den"],
    settingDescriptors: ["a moss-walled", "a lantern-strung", "a bramble-ringed"],
    settlements: ["forest hamlet", "border village", "woodland refuge"],
    landmarks: ["the green commons", "the antler bridge", "the root cellar hall", "the standing stones"],
    atmospheres: ["alive with insects and listening leaves", "soft with moss and sharpened nerves", "warm at the edges and strange in the middle"],
    villainTitles: ["Green Speaker", "Huntmaster", "Hearth Witch", "Thorn Regent"],
    villainNames: ["Ysra", "Cael", "Morren", "Iven", "Talan"],
    conspiracies: [
      "a hunting compact rewritten in secret",
      "a fae bargain being fed through missing offerings",
      "a border feud kept alive by someone profiting from fear",
    ],
    motives: [
      "turn the village into a gate no one can leave without tribute",
      "wake the thorn court before the old terms can be mended",
      "bind the hunters to a false oath and rule through scarcity",
    ],
    threats: ["mask-wearing riders", "hunters with green ribbon tokens", "thorn scouts slipping between fences"],
    relics: ["antler key", "moonwell bowl", "thorn crown", "warden's oath ribbon"],
    companionNames: ["Juniper", "Ash", "Cairn", "Mira"],
    companionRoles: ["pathfinder", "trapper", "village outrider"],
    authorityRoles: ["hearth elder", "gate reeve", "mill keeper"],
    suspectRoles: ["herbalist", "fletcher", "hound handler"],
    sideRoles: ["beekeeper", "woodcarver", "miller"],
    locationTraits: ["moss on thresholds", "fresh bark cuts", "feather charms", "mud tracked where no path runs"],
  },
  {
    id: "arcane",
    keywords: /\b(arcane|mage|wizard|rune|clockwork|library|scholar|spell)\b/i,
    tone: ["Arcane intrigue with practical stakes", "Scholar-adventure under mounting magical strain"],
    titlePrefixes: ["Runebound", "Glass", "Cinder", "Clockwork", "Aether"],
    titleFocuses: ["Archive", "Sigil", "Engine", "Tower", "Ledger"],
    placeRoots: ["Aster", "Cipher", "Glass", "Rune", "Cinder"],
    placeSuffixes: ["Spire", "Ward", "Cross", "Reach", "Hall"],
    settingDescriptors: ["a lecture-crowded", "a rune-lit", "a clockwork-threaded"],
    settlements: ["scholar quarter", "mage city", "charter enclave"],
    landmarks: ["the index court", "the lecture vault", "the sealed observatory", "the lower foundry"],
    atmospheres: ["charged with static and ambition", "precise on the surface and frantic underneath", "full of ink, ozone, and bad timing"],
    villainTitles: ["Provost", "Rector", "Rune Broker", "Engine Curator"],
    villainNames: ["Oris", "Talven", "Sera", "Quill", "Meren"],
    conspiracies: [
      "a charter fraud protected by magical silence",
      "an engine test being hidden inside a public demonstration",
      "a sealed archive being emptied under the academy's nose",
    ],
    motives: [
      "lock the city into dependence on one dangerous device",
      "rewrite the charter before anyone can prove the fraud",
      "pull knowledge out of quarantine and sell it as salvation",
    ],
    threats: ["robe-clad enforcers", "sigil wardens with brass tags", "students paid to look the other way"],
    relics: ["glass cipher", "sigil spindle", "charter seal", "engine key"],
    companionNames: ["Pell", "Iris", "Dane", "Vesper"],
    companionRoles: ["apprentice courier", "disgraced scholar", "foundry runner"],
    authorityRoles: ["archive steward", "dean", "ward inspector"],
    suspectRoles: ["junior lecturer", "sigil mechanic", "charter clerk"],
    sideRoles: ["tea-house scribe", "ink seller", "copyist"],
    locationTraits: ["chalk formulae", "burned vellum", "brass filings", "waxed seals broken and reset"],
  },
];

const GENERIC_SURNAMES = [
  "Vale",
  "Morrow",
  "Thorne",
  "Hale",
  "Marrow",
  "Quill",
  "Rook",
  "Voss",
  "Sable",
  "Reeve",
];

function stableHash(value: string) {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function createRng(seed: string) {
  let state = stableHash(seed) || 1;

  return () => {
    state = Math.imul(state ^ (state >>> 15), state | 1);
    state ^= state + Math.imul(state ^ (state >>> 7), state | 61);
    return ((state ^ (state >>> 14)) >>> 0) / 4294967296;
  };
}

function pickOne<T>(items: T[], rng: () => number, used = new Set<number>()) {
  if (items.length === 0) {
    throw new Error("Cannot pick from an empty list.");
  }

  if (used.size >= items.length) {
    used.clear();
  }

  let index = Math.floor(rng() * items.length);

  while (used.has(index)) {
    index = (index + 1) % items.length;
  }

  used.add(index);
  return items[index]!;
}

function fitCount<T>(items: T[], target: number, createExtra: (index: number) => T) {
  const safeTarget = Math.max(1, target);
  const fitted = items.slice(0, safeTarget);

  while (fitted.length < safeTarget) {
    fitted.push(createExtra(fitted.length));
  }

  return fitted;
}

function clampCount(value: number | undefined, min: number, max: number, fallback: number) {
  return clamp(value ?? fallback, min, max);
}

function lowerFirst(value: string) {
  return value ? value.charAt(0).toLowerCase() + value.slice(1) : value;
}

function summarizeText(value: string, maxLength = 180) {
  const normalized = value.replace(/\s+/g, " ").trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1).trimEnd()}...`;
}

function stripRolePrefix(value: string) {
  return value.replace(/^(assistant|user|system)\s*:\s*/i, "").trim();
}

function cleanPrompt(prompt?: string) {
  return prompt?.trim().replace(/\s+/g, " ") ?? "";
}

function shouldRetitle(prompt: string) {
  return /\b(rename|retitle|different title|new title)\b/i.test(prompt);
}

function selectTheme(seedText: string) {
  const matched = THEME_LIBRARY.find((theme) => theme.keywords.test(seedText));

  if (matched) {
    return matched;
  }

  return THEME_LIBRARY[stableHash(seedText || "default") % THEME_LIBRARY.length]!;
}

function buildPlaceName(theme: ThemeProfile, rng: () => number) {
  return `${pickOne(theme.placeRoots, rng)} ${pickOne(theme.placeSuffixes, rng)}`;
}

function buildVillain(theme: ThemeProfile, rng: () => number) {
  return {
    title: pickOne(theme.villainTitles, rng),
    name: `${pickOne(theme.villainNames, rng)} ${pickOne(GENERIC_SURNAMES, rng)}`,
    motive: pickOne(theme.motives, rng),
  };
}

function buildThemeSeed(character: CharacterSheet, prompt: string, previousDraft?: GeneratedCampaignSetup) {
  return [
    character.name,
    character.archetype,
    prompt,
    previousDraft?.publicSynopsis.title,
    previousDraft?.publicSynopsis.setting,
  ]
    .filter(Boolean)
    .join("|");
}

function buildCampaignPremise(input: {
  character: CharacterSheet;
  setting: string;
  conspiracy: string;
  villainTitle: string;
  villainName: string;
  relic: string;
}) {
  return `${input.character.name}, a ${lowerFirst(input.character.archetype)}, is drawn into ${input.conspiracy} in ${input.setting}, where ${lowerFirst(input.villainTitle)} ${input.villainName} is closing in on the ${input.relic}.`;
}

function buildOpeningSuggestions(input: {
  clueSource: string;
  authorityRole: string;
  companionName: string;
}) {
  return [
    `Inspect ${input.clueSource.toLowerCase()} for what the crowd missed`,
    `Question the ${input.authorityRole} before they regain control`,
    `Have ${input.companionName} cover the exits while you press forward`,
  ];
}

function inferActionIntent(playerAction: string, companion: PromptContext["companion"]): ActionIntent {
  const action = playerAction.toLowerCase();
  const gentleSocial = /(ask|question|talk|parley|speak|negotiate|appeal|listen)/.test(action);
  const inspect = /(inspect|study|search|investigate|examine|read|decode|track|follow|observe|listen)/.test(
    action,
  );
  const stealth = /(sneak|slip|hide|shadow|stealth|prowl|pickpocket|steal|tail)/.test(action);
  const force = /(attack|strike|fight|break|force|smash|kick|rush|wrestle|threaten|confront)/.test(
    action,
  );
  const ritual = /(ritual|spell|channel|ward|rune|pray|invoke|attune|dispel)/.test(action);
  const travel = /(go to|head to|cross|travel|move to|follow|climb|descend|enter|approach)/.test(
    action,
  );
  const support = companion ? new RegExp(`\\b(help|assist|cover|signal|protect|ask ${companion.name.toLowerCase()}|have ${companion.name.toLowerCase()})\\b`).test(action) : /(help|assist|cover|protect|signal)/.test(action);
  const rest = /(rest|wait|pause|hide out|catch breath|tend wounds)/.test(action);

  if (force) {
    return { kind: "force", stat: "strength", requiresCheck: true, mode: "normal" };
  }

  if (stealth) {
    return { kind: "stealth", stat: "agility", requiresCheck: true, mode: "normal" };
  }

  if (ritual) {
    return { kind: "ritual", stat: "intellect", requiresCheck: true, mode: "normal" };
  }

  if (gentleSocial) {
    return {
      kind: "social",
      stat: "charisma",
      requiresCheck: /(bluff|lie|deceive|intimidate|demand)/.test(action),
      mode: support ? "advantage" : "normal",
    };
  }

  if (inspect) {
    return {
      kind: "inspect",
      stat: "intellect",
      requiresCheck: /(vault|sealed|dangerous|under fire|while hidden)/.test(action),
      mode: "normal",
    };
  }

  if (support) {
    return {
      kind: "support",
      stat: companion ? "charisma" : "vitality",
      requiresCheck: /(under attack|while arrows|amid|during)/.test(action),
      mode: companion ? "advantage" : "normal",
    };
  }

  if (travel) {
    return {
      kind: "travel",
      stat: /(climb|leap|balance|dart)/.test(action) ? "agility" : "vitality",
      requiresCheck: /(climb|leap|barred|guarded|window|roof|across|through fire)/.test(action),
      mode: "normal",
    };
  }

  if (rest) {
    return { kind: "rest", stat: "vitality", requiresCheck: false, mode: "normal" };
  }

  return {
    kind: "inspect",
    stat: /(convince|persuade)/.test(action)
      ? "charisma"
      : /(sneak|slip)/.test(action)
        ? "agility"
        : /(brace|endure)/.test(action)
          ? "vitality"
          : "strength",
    requiresCheck: /(convince|persuade|jump|rush|grab)/.test(action),
    mode: "normal",
  };
}

function chooseHiddenClue(promptContext: PromptContext, intent: ActionIntent) {
  if (!["inspect", "social", "travel", "ritual"].includes(intent.kind)) {
    return null;
  }

  return promptContext.relevantClues.find((clue) => clue.status === "hidden") ?? null;
}

function chooseReveal(promptContext: PromptContext, intent: ActionIntent, checkOutcome?: CheckOutcome) {
  if (!promptContext.eligibleRevealIds.length) {
    return null;
  }

  if (checkOutcome === "success") {
    return promptContext.eligibleRevealIds[0]!;
  }

  if (checkOutcome === "partial") {
    return ["inspect", "social", "ritual"].includes(intent.kind)
      ? promptContext.eligibleRevealIds[0]!
      : null;
  }

  if (!checkOutcome) {
    return ["inspect", "social", "ritual"].includes(intent.kind)
      ? promptContext.eligibleRevealIds[0]!
      : null;
  }

  return null;
}

function buildQuestProgress(
  activeQuests: QuestRecord[],
  options: {
    discoveredClue: boolean;
    revealTriggered: boolean;
    outcome?: CheckOutcome;
  },
) {
  const quest = activeQuests[0];

  if (!quest) {
    return {
      questAdvancements: [] as NonNullable<ProposedStateDelta["questAdvancements"]>,
      rewardQuestId: null as string | null,
    };
  }

  const shouldAdvance =
    options.revealTriggered ||
    options.discoveredClue ||
    options.outcome === "success" ||
    options.outcome === "partial";

  if (!shouldAdvance || quest.stage >= quest.maxStage) {
    return {
      questAdvancements: [],
      rewardQuestId: null,
    };
  }

  const nextStage = Math.min(quest.stage + 1, quest.maxStage);
  const completed = nextStage >= quest.maxStage && (options.revealTriggered || options.outcome === "success");

  return {
    questAdvancements: [
      {
        questId: quest.id,
        nextStage,
        status: completed ? "completed" : quest.status,
      },
    ],
    rewardQuestId: completed ? quest.id : null,
  };
}

function buildArcProgress(blueprint: CampaignBlueprint, promptContext: PromptContext, steps = 1) {
  const activeArc = promptContext.activeArc;

  if (!activeArc || steps <= 0) {
    return {
      arcAdvancements: [] as NonNullable<ProposedStateDelta["arcAdvancements"]>,
      activeArcId: undefined as string | undefined,
    };
  }

  const nextTurn = activeArc.currentTurn + steps;
  const arcAdvancements: NonNullable<ProposedStateDelta["arcAdvancements"]> = [
    {
      arcId: activeArc.id,
      currentTurnDelta: steps,
      status: nextTurn >= activeArc.expectedTurns ? "complete" : activeArc.status,
    },
  ];

  if (nextTurn < activeArc.expectedTurns) {
    return {
      arcAdvancements,
      activeArcId: activeArc.id,
    };
  }

  const arcIndex = blueprint.arcs.findIndex((arc) => arc.id === activeArc.id);
  const nextBlueprintArc = arcIndex >= 0 ? blueprint.arcs[arcIndex + 1] : null;

  if (!nextBlueprintArc) {
    return {
      arcAdvancements,
      activeArcId: activeArc.id,
    };
  }

  arcAdvancements.push({
    arcId: nextBlueprintArc.id,
    currentTurnDelta: 0,
    status: "active",
  });

  return {
    arcAdvancements,
    activeArcId: nextBlueprintArc.id,
  };
}

function buildSuggestedActions(input: {
  promptContext: PromptContext;
  playerAction: string;
  intent: ActionIntent;
  discoveredClueText?: string | null;
  revealText?: string | null;
  outcome?: CheckOutcome;
}) {
  const companionAction = input.promptContext.companion
    ? `Ask ${input.promptContext.companion.name} what they make of it`
    : "Question the nearest witness";
  const sceneLead =
    input.promptContext.scene.suggestedActions[0] ?? "Press the nearest lead before it cools";
  const clueAction = input.discoveredClueText
    ? `Follow up on ${lowerFirst(input.discoveredClueText)}`
    : "Search for the missing angle in the scene";
  const revealAction = input.revealText
    ? "Act before the newly exposed truth can spread"
    : "Test the pressure point you just found";

  const options = [
    clueAction,
    revealAction,
    companionAction,
    sceneLead,
  ]
    .map((action) => action.trim())
    .filter(Boolean)
    .filter((action) => action.toLowerCase() !== input.playerAction.trim().toLowerCase());

  if (input.outcome === "failure") {
    return [
      "Regain your footing before the opposition presses harder",
      companionAction,
      "Look for a safer route through the scene",
      clueAction,
    ];
  }

  if (input.intent.kind === "social") {
    return [
      "Press the conversation before the witness shuts down",
      clueAction,
      companionAction,
      revealAction,
    ].filter((action) => action.toLowerCase() !== input.playerAction.trim().toLowerCase());
  }

  return options.slice(0, 4);
}

function buildMemorySummary(input: {
  sceneTitle: string;
  playerAction: string;
  discoveredClueText?: string | null;
  revealText?: string | null;
  outcome?: CheckOutcome;
}) {
  const consequence = input.revealText
    ? `They exposed ${lowerFirst(input.revealText)}.`
    : input.discoveredClueText
      ? `They uncovered ${lowerFirst(input.discoveredClueText)}.`
      : input.outcome === "failure"
        ? "The move backfired and the pressure rose."
        : input.outcome === "partial"
          ? "They made progress at a cost."
          : "They pushed the scene forward.";

  return `${input.sceneTitle}: the player chose to ${lowerFirst(
    input.playerAction.replace(/[.?!]+$/, ""),
  )}. ${consequence}`;
}

function buildNoCheckNarration(input: {
  promptContext: PromptContext;
  playerAction: string;
  discoveredClueText?: string | null;
  revealText?: string | null;
}) {
  const scene = input.promptContext.scene;
  const lead = `In ${scene.title}, ${lowerFirst(input.playerAction.replace(/[.?!]+$/, ""))}.`;
  const clueBeat = input.discoveredClueText
    ? `That draws a concrete detail into the open: ${input.discoveredClueText}.`
    : `The move changes the rhythm of the scene before anyone can settle back into it.`;
  const revealBeat = input.revealText
    ? `The implication lands hard: ${input.revealText}.`
    : `The air in ${scene.location} stays ${lowerFirst(scene.atmosphere)}, but now it has a direction.`;

  return [lead, clueBeat, revealBeat].join(" ");
}

function buildResolutionNarration(input: {
  promptContext: PromptContext;
  playerAction: string;
  outcome: CheckOutcome;
  discoveredClueText?: string | null;
  revealText?: string | null;
}) {
  const companionBeat = input.promptContext.companion
    ? `${input.promptContext.companion.name} clocks it instantly and adjusts with you.`
    : "";

  if (input.outcome === "success") {
    return [
      `You follow through on ${lowerFirst(input.playerAction.replace(/[.?!]+$/, ""))}, and the moment breaks your way.`,
      input.discoveredClueText
        ? `The payoff is immediate: ${input.discoveredClueText}.`
        : `The pressure in ${input.promptContext.scene.location} shifts before the opposition can recover.`,
      input.revealText ? `The larger truth snaps into focus: ${input.revealText}.` : companionBeat,
    ]
      .filter(Boolean)
      .join(" ");
  }

  if (input.outcome === "partial") {
    return [
      `You make ${lowerFirst(input.playerAction.replace(/[.?!]+$/, ""))} work, but not cleanly.`,
      input.discoveredClueText
        ? `You still pull something useful out of the mess: ${input.discoveredClueText}.`
        : `The scene gives ground, then bites back.`,
      input.revealText
        ? `Even through the mess, one truth shows itself: ${input.revealText}.`
        : companionBeat || "Someone nearby now knows how close you came.",
    ]
      .filter(Boolean)
      .join(" ");
  }

  return [
    `You commit to ${lowerFirst(input.playerAction.replace(/[.?!]+$/, ""))}, and the scene turns against you.`,
    `The opening narrows, the pressure spikes, and ${input.promptContext.scene.location} suddenly feels smaller than it did a breath ago.`,
    companionBeat || "Whoever was waiting for a mistake has one now.",
  ].join(" ");
}

function emitNarration(callbacks: StreamCallbacks | undefined, narration: string) {
  if (narration.trim()) {
    callbacks?.onNarration?.(narration);
  }
}

function buildCampaignSetup(
  character: CharacterSheet,
  input: CampaignSetupGenerationInput,
): GeneratedCampaignSetup {
  const prompt = cleanPrompt(input.prompt);
  const theme = selectTheme(`${prompt} ${input.previousDraft?.publicSynopsis.setting ?? ""}`);
  const rng = createRng(buildThemeSeed(character, prompt, input.previousDraft));
  const previous = input.previousDraft;

  const counts = {
    hooks: clampCount(previous?.secretEngine.hooks.length, 2, 3, 2),
    arcs: clampCount(previous?.secretEngine.arcs.length, 2, 2, 2),
    reveals: clampCount(previous?.secretEngine.reveals.length, 1, 2, 2),
    subplotSeeds: clampCount(previous?.secretEngine.subplotSeeds.length, 1, 2, 1),
    quests: clampCount(previous?.secretEngine.quests.length, 1, 2, 2),
    npcs: clampCount(previous?.secretEngine.npcs.length, 2, 4, 3),
    clues: clampCount(previous?.secretEngine.clues.length, 3, 5, 4),
    locations: clampCount(previous?.secretEngine.locations.length, 3, 5, 4),
  };

  const landmarkUsed = new Set<number>();
  const localNameUsed = new Set<number>();
  const placeName = previous?.publicSynopsis.openingScene.location || buildPlaceName(theme, rng);
  const setting =
    previous && !/\b(desert|forest|sea|winter|city|scholar|gothic|pirate|fae|arcane)\b/i.test(prompt)
      ? previous.publicSynopsis.setting
      : `${pickOne(theme.settingDescriptors, rng)} ${pickOne(theme.settlements, rng)} of ${placeName}`;
  const villain = buildVillain(theme, rng);
  const relic = pickOne(theme.relics, rng);
  const conspiracy = pickOne(theme.conspiracies, rng);
  const authorityRole = pickOne(theme.authorityRoles, rng);
  const suspectRole = pickOne(theme.suspectRoles, rng);
  const sideRole = pickOne(theme.sideRoles, rng);
  const landmarkOne = pickOne(theme.landmarks, rng, landmarkUsed);
  const landmarkTwo = pickOne(theme.landmarks, rng, landmarkUsed);
  const climaxLandmark = pickOne(theme.landmarks, rng, landmarkUsed);
  const companionName = pickOne(theme.companionNames, rng, localNameUsed);
  const companionRole = pickOne(theme.companionRoles, rng);
  const tone = previous?.publicSynopsis.tone && !prompt
    ? previous.publicSynopsis.tone
    : pickOne(theme.tone, rng);
  const title =
    previous?.publicSynopsis.title && !shouldRetitle(prompt)
      ? previous.publicSynopsis.title
      : `${pickOne(theme.titlePrefixes, rng)} ${pickOne(theme.titleFocuses, rng)} of ${placeName}`;
  const premise = buildCampaignPremise({
    character,
    setting,
    conspiracy,
    villainTitle: villain.title,
    villainName: villain.name,
    relic,
  });
  const openingSceneTitle = `${landmarkOne.replace(/^the /i, "").replace(/\b\w/g, (letter) => letter.toUpperCase())} at Dusk`;
  const activeThreat = `${villain.title} ${villain.name}'s ${pickOne(theme.threats, rng)} are already sweeping the edges of ${placeName} for the ${relic}.`;

  const arcOne = {
    title: `The Trail of the ${relic.replace(/\b\w/g, (letter) => letter.toUpperCase())}`,
    summary: `Trace the missing ${relic} through ${landmarkOne} and ${landmarkTwo} before ${villain.title} ${villain.name} locks down the district.`,
    expectedTurns: 6,
  };
  const arcTwo = {
    title: `The Night ${placeName} Refuses`,
    summary: `Break ${villain.title} ${villain.name}'s hold at ${climaxLandmark} before ${lowerFirst(villain.motive)}.`,
    expectedTurns: 8,
  };

  const revealTitles = fitCount(
    [
      "The Inside Hand",
      `What the ${relic.replace(/\b\w/g, (letter) => letter.toUpperCase())} Was Meant to Open`,
    ],
    counts.reveals,
    (index) => `Hidden Truth ${index + 1}`,
  );

  const revealTruths = fitCount(
    [
      `The local ${authorityRole} has been buying time for ${villain.title} ${villain.name}, steering scrutiny away from the real operation.`,
      `The ${relic} is not a prize at all. It is the final key needed to ${lowerFirst(villain.motive)}.`,
    ],
    counts.reveals,
    () => `A deeper layer of the conspiracy surfaces around ${placeName}.`,
  );

  const clueTemplates = [
    {
      text: `${theme.locationTraits[0]} on a public threshold match work done near ${landmarkTwo}.`,
      source: landmarkOne,
    },
    {
      text: `A witness places the missing ${relic} with someone tied to the ${authorityRole}, not the usual thieves.`,
      source: `${authorityRole}'s office`,
    },
    {
      text: `A marked note names ${climaxLandmark} as the place where the ${relic} must be delivered before dawn.`,
      source: landmarkTwo,
    },
    {
      text: `Fresh signs of movement show a hidden route linking ${landmarkOne} to ${climaxLandmark}.`,
      source: placeName,
    },
    {
      text: `Someone scrubbed records naming ${villain.title} ${villain.name}, but not well enough to erase the pattern.`,
      source: `${sideRole}'s shop`,
    },
  ];

  const clueGroupSize = Math.ceil(counts.clues / revealTitles.length);
  const clues = fitCount(clueTemplates, counts.clues, (index) => ({
    text: `A small but telling inconsistency around ${placeName} points toward ${climaxLandmark}.`,
    source: `${sideRole}'s stall ${index + 1}`,
  })).map((clue, index) => ({
    ...clue,
    linkedRevealTitle:
      revealTitles[Math.min(Math.floor(index / clueGroupSize), revealTitles.length - 1)] ??
      revealTitles[0]!,
  }));

  const hooks = fitCount(
    [
      { text: `Recover the ${relic} before it disappears into ${climaxLandmark}.` },
      { text: `Learn which ${authorityRole} is buying time for ${villain.title} ${villain.name}.` },
      { text: `Find out why the ${suspectRole} vanished right before the district locked down.` },
    ],
    counts.hooks,
    () => ({
      text: `Turn the latest rumor in ${placeName} into a usable lead before the trail goes cold.`,
    }),
  );

  const arcs = fitCount([arcOne, arcTwo], counts.arcs, (index) => ({
    title: `Pressure Point ${index + 1}`,
    summary: `Keep unraveling the conspiracy around ${placeName}.`,
    expectedTurns: 6 + index,
  }));

  const reveals = revealTitles.map((title, index) => ({
    title,
    truth: revealTruths[index]!,
    requiredClueTitles: clues
      .filter((_, clueIndex) =>
        index === revealTitles.length - 1
          ? clueIndex >= Math.floor((counts.clues / revealTitles.length) * index)
          : clueIndex >= Math.floor((counts.clues / revealTitles.length) * index) &&
            clueIndex < Math.floor((counts.clues / revealTitles.length) * (index + 1)),
      )
      .map((clue) => clue.text),
    requiredArcTitles: [arcs[Math.min(index, arcs.length - 1)]!.title],
  }));

  const subplotSeeds = fitCount(
    [
      {
        title: `${companionName}'s Debt`,
        hook: `${companionName} has a personal reason to want the ${relic} found before the city guard touches it.`,
      },
      {
        title: `The Missing Ledger`,
        hook: `Someone in ${placeName} is terrified of whatever disappeared from the public records alongside the ${relic}.`,
      },
    ],
    counts.subplotSeeds,
    (index) => ({
      title: `Quiet Trouble ${index + 1}`,
      hook: `A side pressure in ${placeName} keeps tangling with the main conspiracy.`,
    }),
  );

  const quests = fitCount(
    [
      {
        title: `Recover the ${relic.replace(/\b\w/g, (letter) => letter.toUpperCase())}`,
        summary: `Stay ahead of ${villain.title} ${villain.name}'s people and secure the ${relic}.`,
        maxStage: 2,
        rewardGold: 30,
        rewardItem: `warded ${slugify(relic).replace(/-/g, " ")}`,
      },
      {
        title: `Protect the Witness`,
        summary: `Keep the missing ${suspectRole} alive long enough to speak plainly.`,
        maxStage: 2,
        rewardGold: 18,
        rewardItem: null,
      },
    ],
    counts.quests,
    (index) => ({
      title: `Side Contract ${index + 1}`,
      summary: `A smaller job tied to the same web of pressure in ${placeName}.`,
      maxStage: 2,
      rewardGold: 12 + index * 4,
      rewardItem: null,
    }),
  );

  const npcs = fitCount(
    [
      {
        name: companionName,
        role: companionRole,
        notes: `A capable ${companionRole} who reads danger quickly and hates being managed.`,
        isCompanion: true,
        approval: 1,
        personalHook: `They need the truth about the ${relic} before someone else rewrites it.`,
        status: "watchful",
      },
      {
        name: `${pickOne(theme.villainNames, rng, localNameUsed)} ${pickOne(GENERIC_SURNAMES, rng)}`,
        role: authorityRole,
        notes: `Publicly overworked, privately too eager to redirect questions.`,
        isCompanion: false,
        approval: 0,
        personalHook: null,
        status: "strained",
      },
      {
        name: `${pickOne(theme.villainNames, rng, localNameUsed)} ${pickOne(GENERIC_SURNAMES, rng)}`,
        role: suspectRole,
        notes: `A nervous ${suspectRole} who knows one dangerous piece of the route.`,
        isCompanion: false,
        approval: 0,
        personalHook: null,
        status: "missing",
      },
      {
        name: `${pickOne(theme.villainNames, rng, localNameUsed)} ${pickOne(GENERIC_SURNAMES, rng)}`,
        role: sideRole,
        notes: `A practical ${sideRole} with better instincts than they admit.`,
        isCompanion: false,
        approval: 0,
        personalHook: null,
        status: "present",
      },
    ],
    counts.npcs,
    (index) => ({
      name: `${pickOne(theme.villainNames, rng, localNameUsed)} ${pickOne(GENERIC_SURNAMES, rng)}`,
      role: `${sideRole} ${index + 1}`,
      notes: `A local face who keeps ending up near the wrong people at the wrong time.`,
      isCompanion: false,
      approval: 0,
      personalHook: null,
      status: "present",
    }),
  );

  const locations = fitCount(
    [placeName, landmarkOne, landmarkTwo, climaxLandmark],
    counts.locations,
    (index) => `${placeName} Annex ${index + 1}`,
  );

  const openingSceneSummary = `Crowds break unevenly around ${landmarkOne}, where word of the missing ${relic} has already reached the wrong ears. ${activeThreat}`;

  return {
    publicSynopsis: {
      title,
      premise,
      tone,
      setting,
      openingScene: {
        title: openingSceneTitle,
        summary: openingSceneSummary,
        location: placeName,
        atmosphere: pickOne(theme.atmospheres, rng),
        activeThreat,
        suggestedActions: buildOpeningSuggestions({
          clueSource: landmarkOne,
          authorityRole,
          companionName,
        }),
      },
    },
    secretEngine: {
      villain: {
        name: `${villain.title} ${villain.name}`,
        motive: villain.motive,
        progressClock: 10,
      },
      hooks,
      arcs,
      reveals,
      subplotSeeds,
      quests,
      npcs,
      clues,
      locations,
    },
  };
}

export class LocalDungeonMaster {
  async generateCampaignSetup(
    character: CharacterSheet,
    input: CampaignSetupGenerationInput = {},
  ) {
    return buildCampaignSetup(
      character ?? toCampaignSeedCharacter(createDefaultCharacterTemplate()),
      input,
    );
  }

  async generateCharacter(prompt: string): Promise<CharacterTemplateDraft> {
    const base = createDefaultCharacterTemplate();
    const cleaned = cleanPrompt(prompt);
    const seed = cleaned || `${base.name}|${base.archetype}`;
    const theme = selectTheme(seed);
    const archetypeFocus = cleaned.split(/\s+/).slice(0, 6).join(" ").trim();
    const titlePrefix = pickOne(theme.titlePrefixes, createRng(seed));
    const archetype = archetypeFocus
      ? `${titlePrefix} ${archetypeFocus.replace(/^[a-z]/, (char) => char.toUpperCase())}`
      : base.archetype;
    const nameSeed = stableHash(`${seed}|name`);
    const statShift = (offset: number) => ((nameSeed >> offset) % 3) - 1;

    return {
      name: base.name,
      archetype,
      strength: clamp(base.strength + statShift(0), -2, 4),
      agility: clamp(base.agility + statShift(2), -2, 4),
      intellect: clamp(base.intellect + statShift(4), -2, 4),
      charisma: clamp(base.charisma + statShift(6), -2, 4),
      vitality: clamp(base.vitality + statShift(8), -2, 4),
      maxHealth: clamp(base.maxHealth + statShift(10), 8, 18),
      backstory: cleaned
        ? `${base.name} is known as a ${lowerFirst(archetype)}. ${base.name} carries a reputation shaped by ${cleaned.toLowerCase()}. They are looking for the next road that will finally make sense of it.`
        : base.backstory,
    };
  }

  async triageTurn(input: TurnAIPayload, callbacks?: StreamCallbacks): Promise<TriageDecision> {
    const intent = inferActionIntent(input.playerAction, input.promptContext.companion);

    if (intent.requiresCheck) {
      return {
        requiresCheck: true,
        check: {
          stat: intent.stat,
          mode: intent.mode,
          reason: `Resolving: ${input.playerAction}`,
        },
        suggestedActions: buildSuggestedActions({
          promptContext: input.promptContext,
          playerAction: input.playerAction,
          intent,
        }),
        proposedDelta: {},
      };
    }

    const clue = chooseHiddenClue(input.promptContext, intent);
    const revealId = chooseReveal(input.promptContext, intent);
    const revealText = revealId
      ? input.blueprint.hiddenReveals.find((reveal) => reveal.id === revealId)?.truth ?? null
      : null;
    const questProgress = buildQuestProgress(input.promptContext.activeQuests, {
      discoveredClue: Boolean(clue),
      revealTriggered: Boolean(revealId),
    });
    const arcProgress = buildArcProgress(input.blueprint, input.promptContext, 1);
    const narration = buildNoCheckNarration({
      promptContext: input.promptContext,
      playerAction: input.playerAction,
      discoveredClueText: clue?.text ?? null,
      revealText,
    });
    const suggestedActions = buildSuggestedActions({
      promptContext: input.promptContext,
      playerAction: input.playerAction,
      intent,
      discoveredClueText: clue?.text ?? null,
      revealText,
    });

    emitNarration(callbacks, narration);

    return {
      requiresCheck: false,
      suggestedActions,
      proposedDelta: {
        sceneSummary: narration,
        sceneAtmosphere:
          intent.kind === "rest"
            ? "briefly steadier, but not safe"
            : input.promptContext.scene.atmosphere,
        clueDiscoveries: clue ? [clue.id] : [],
        revealTriggers: revealId ? [revealId] : [],
        villainClockDelta: intent.kind === "rest" ? 1 : revealId ? 0 : 1,
        tensionDelta: intent.kind === "rest" ? -2 : clue ? 2 : 3,
        questAdvancements: questProgress.questAdvancements,
        rewardQuestId: questProgress.rewardQuestId,
        arcAdvancements: arcProgress.arcAdvancements,
        activeArcId: arcProgress.activeArcId,
        suggestedActions,
        npcApprovalChanges:
          input.promptContext.companion && intent.kind === "support"
            ? [
                {
                  npcId: input.promptContext.companion.id,
                  approvalDelta: 1,
                  reason: "You made room for them to matter in the moment.",
                },
              ]
            : [],
        memorySummary: buildMemorySummary({
          sceneTitle: input.promptContext.scene.title,
          playerAction: input.playerAction,
          discoveredClueText: clue?.text ?? null,
          revealText,
        }),
      },
    };
  }

  async resolveTurn(
    input: TurnAIPayload & { checkResult: CheckResult },
    callbacks?: StreamCallbacks,
  ): Promise<ResolveDecision> {
    const intent = inferActionIntent(input.playerAction, input.promptContext.companion);
    const clue =
      input.checkResult.outcome === "failure" ? null : chooseHiddenClue(input.promptContext, intent);
    const revealId = chooseReveal(input.promptContext, intent, input.checkResult.outcome);
    const revealText = revealId
      ? input.blueprint.hiddenReveals.find((reveal) => reveal.id === revealId)?.truth ?? null
      : null;
    const questProgress = buildQuestProgress(input.promptContext.activeQuests, {
      discoveredClue: Boolean(clue),
      revealTriggered: Boolean(revealId),
      outcome: input.checkResult.outcome,
    });
    const arcProgress = buildArcProgress(
      input.blueprint,
      input.promptContext,
      input.checkResult.outcome === "failure" ? 0 : 1,
    );
    const narration = buildResolutionNarration({
      promptContext: input.promptContext,
      playerAction: input.playerAction,
      outcome: input.checkResult.outcome,
      discoveredClueText: clue?.text ?? null,
      revealText,
    });
    const suggestedActions = buildSuggestedActions({
      promptContext: input.promptContext,
      playerAction: input.playerAction,
      intent,
      discoveredClueText: clue?.text ?? null,
      revealText,
      outcome: input.checkResult.outcome,
    });

    emitNarration(callbacks, narration);

    return {
      suggestedActions,
      proposedDelta: {
        sceneSummary: narration,
        sceneAtmosphere:
          input.checkResult.outcome === "success"
            ? "charged and briefly in your favor"
            : input.checkResult.outcome === "partial"
              ? "shifting and unstable"
              : "tight with threat and attention",
        clueDiscoveries: clue ? [clue.id] : [],
        revealTriggers: revealId ? [revealId] : [],
        villainClockDelta:
          input.checkResult.outcome === "failure"
            ? 1
            : input.checkResult.outcome === "partial"
              ? 1
              : 0,
        tensionDelta:
          input.checkResult.outcome === "success"
            ? 3
            : input.checkResult.outcome === "partial"
              ? 6
              : 10,
        questAdvancements: questProgress.questAdvancements,
        rewardQuestId: questProgress.rewardQuestId,
        arcAdvancements: arcProgress.arcAdvancements,
        activeArcId: arcProgress.activeArcId,
        suggestedActions,
        npcApprovalChanges:
          input.promptContext.companion && input.checkResult.outcome !== "failure"
            ? [
                {
                  npcId: input.promptContext.companion.id,
                  approvalDelta: 1,
                  reason: "They saw you carry the moment through.",
                },
              ]
            : input.promptContext.companion && input.checkResult.outcome === "failure"
              ? [
                  {
                    npcId: input.promptContext.companion.id,
                    approvalDelta: -1,
                    reason: "The fallout caught them in it too.",
                  },
                ]
              : [],
        memorySummary: buildMemorySummary({
          sceneTitle: input.promptContext.scene.title,
          playerAction: input.playerAction,
          discoveredClueText: clue?.text ?? null,
          revealText,
          outcome: input.checkResult.outcome,
        }),
      },
    };
  }

  async summarizeSession(messages: string[]) {
    const cleaned = messages.map(stripRolePrefix).filter(Boolean);
    const opening = cleaned[0] ? summarizeText(cleaned[0], 120) : "The session began under pressure.";
    const midpoint = cleaned[Math.max(0, cleaned.length - 3)]
      ? summarizeText(cleaned[Math.max(0, cleaned.length - 3)]!, 120)
      : "The player kept pressing the strongest available lead.";
    const ending = cleaned.at(-1)
      ? summarizeText(cleaned.at(-1)!, 120)
      : "The situation remains unresolved.";

    return `${opening} ${midpoint} By the end of the session, ${lowerFirst(ending)}.`;
  }

  async generatePreviouslyOn(summary: string, scene: string, clueText: string[]) {
    const summaryText = summarizeText(summary.replace(/^Previously on:\s*/i, ""), 180);
    const unresolved =
      clueText.length > 0
        ? `Two threads still hang in the air: ${clueText.slice(0, 2).map(lowerFirst).join(" and ")}.`
        : "The last trouble never settled cleanly.";

    return `Previously on: ${summaryText} The story resumes in ${scene}, where ${unresolved}`;
  }
}
