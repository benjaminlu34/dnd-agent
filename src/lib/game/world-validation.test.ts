import assert from "node:assert/strict";
import test from "node:test";
import type { GeneratedKnowledgeEconomy, GeneratedWorldBible, GeneratedWorldModule } from "./types";
import {
  validateEntryContexts,
  validateFactionFootprints,
  validateKnowledgeEconomy,
  validateRegionalLife,
  validateSocialLayer,
  validateWorldBible,
  validateWorldModuleCoherence,
  validateWorldModuleImmersion,
  validateWorldModulePlayability,
  validateWorldSpine,
} from "./world-validation";

function createWorld(): GeneratedWorldModule {
  return {
    title: "Harbor of Knives",
    premise: "A harbor city where rival powers are preparing to move.",
    tone: "Tense and investigative",
    setting: "A rain-dark trade port",
    locations: [
      {
        id: "loc_gate",
        name: "Gate",
        type: "district",
        summary: "Arrival district.",
        description: "A guarded gate district.",
        state: "active",
        controllingFactionId: "fac_watch",
        tags: [],
      },
      {
        id: "loc_market",
        name: "Market",
        type: "market",
        summary: "Crowded market.",
        description: "A noisy exchange quarter.",
        state: "active",
        controllingFactionId: "fac_guild",
        tags: [],
      },
      {
        id: "loc_docks",
        name: "Docks",
        type: "docks",
        summary: "Harbor front.",
        description: "Wet piers and hidden cargo.",
        state: "contested",
        controllingFactionId: "fac_smugglers",
        tags: [],
      },
      {
        id: "loc_keep",
        name: "Keep",
        type: "stronghold",
        summary: "Watch command.",
        description: "A hard stone keep.",
        state: "active",
        controllingFactionId: "fac_watch",
        tags: [],
      },
    ],
    edges: [
      {
        id: "edge_1",
        sourceId: "loc_gate",
        targetId: "loc_market",
        travelTimeMinutes: 10,
        dangerLevel: 1,
        currentStatus: "open",
        description: null,
      },
      {
        id: "edge_2",
        sourceId: "loc_market",
        targetId: "loc_docks",
        travelTimeMinutes: 15,
        dangerLevel: 2,
        currentStatus: "open",
        description: null,
      },
      {
        id: "edge_3",
        sourceId: "loc_market",
        targetId: "loc_keep",
        travelTimeMinutes: 12,
        dangerLevel: 1,
        currentStatus: "open",
        description: null,
      },
      {
        id: "edge_4",
        sourceId: "loc_docks",
        targetId: "loc_keep",
        travelTimeMinutes: 18,
        dangerLevel: 3,
        currentStatus: "contested",
        description: null,
      },
    ],
    factions: [
      {
        id: "fac_watch",
        name: "Watch",
        type: "military",
        summary: "City watch.",
        agenda: "Hold the city.",
        resources: { gold: 5, military: 8, influence: 6, information: 4 },
        pressureClock: 3,
      },
      {
        id: "fac_guild",
        name: "Guild",
        type: "mercantile",
        summary: "Trade power.",
        agenda: "Keep profits moving.",
        resources: { gold: 9, military: 2, influence: 8, information: 5 },
        pressureClock: 2,
      },
      {
        id: "fac_smugglers",
        name: "Smugglers",
        type: "criminal",
        summary: "Dockside operators.",
        agenda: "Expand the harbor grip.",
        resources: { gold: 7, military: 5, influence: 4, information: 8 },
        pressureClock: 4,
      },
    ],
    factionRelations: [
      {
        id: "rel_1",
        factionAId: "fac_watch",
        factionBId: "fac_guild",
        stance: "neutral",
      },
      {
        id: "rel_2",
        factionAId: "fac_watch",
        factionBId: "fac_smugglers",
        stance: "war",
      },
    ],
    npcs: [
      {
        id: "npc_1",
        name: "Captain Voss",
        role: "commander",
        summary: "Strained officer.",
        description: "A strained officer.",
        factionId: "fac_watch",
        currentLocationId: "loc_keep",
        approval: 0,
        isCompanion: false,
      },
      {
        id: "npc_2",
        name: "Sela Thorn",
        role: "broker",
        summary: "Market fixer.",
        description: "A market fixer.",
        factionId: "fac_guild",
        currentLocationId: "loc_market",
        approval: 0,
        isCompanion: false,
      },
      {
        id: "npc_3",
        name: "Nox Ferran",
        role: "pilot",
        summary: "Smuggler pilot.",
        description: "A smuggler pilot.",
        factionId: "fac_smugglers",
        currentLocationId: "loc_docks",
        approval: 0,
        isCompanion: false,
      },
      {
        id: "npc_4",
        name: "Tarin Ash",
        role: "guide",
        summary: "Local guide.",
        description: "A local guide.",
        factionId: null,
        currentLocationId: "loc_gate",
        approval: 2,
        isCompanion: true,
      },
    ],
    information: [
      {
        id: "info_1",
        title: "Cargo is moving off-ledger",
        summary: "Harbor cargo is being hidden.",
        content: "Harbor cargo is being hidden.",
        truthfulness: "true",
        accessibility: "public",
        locationId: "loc_docks",
        factionId: "fac_smugglers",
        sourceNpcId: "npc_3",
      },
      {
        id: "info_2",
        title: "The watch is stretched thin",
        summary: "The watch is reacting, not leading.",
        content: "The watch is reacting, not leading.",
        truthfulness: "true",
        accessibility: "public",
        locationId: "loc_gate",
        factionId: "fac_watch",
        sourceNpcId: "npc_1",
      },
      {
        id: "info_3",
        title: "Bribes are hitting the market",
        summary: "Inspectors are being bought.",
        content: "Inspectors are being bought.",
        truthfulness: "partial",
        accessibility: "guarded",
        locationId: "loc_market",
        factionId: "fac_guild",
        sourceNpcId: "npc_2",
      },
      {
        id: "info_4",
        title: "An oath binds shrine and harbor",
        summary: "A broken promise sits under the unrest.",
        content: "A broken promise sits under the unrest.",
        truthfulness: "true",
        accessibility: "secret",
        locationId: null,
        factionId: null,
        sourceNpcId: null,
      },
    ],
    informationLinks: [
      {
        id: "link_1",
        sourceId: "info_1",
        targetId: "info_3",
        linkType: "supports",
      },
      {
        id: "link_2",
        sourceId: "info_3",
        targetId: "info_2",
        linkType: "extends",
      },
    ],
    commodities: [
      { id: "com_1", name: "Lamp Oil", baseValue: 4, tags: ["fuel"] },
      { id: "com_2", name: "Salt Fish", baseValue: 3, tags: ["food"] },
    ],
    marketPrices: [
      {
        id: "price_1",
        commodityId: "com_1",
        locationId: "loc_market",
        vendorNpcId: "npc_2",
        factionId: "fac_guild",
        modifier: 1,
        stock: 8,
        legalStatus: "legal",
      },
      {
        id: "price_2",
        commodityId: "com_2",
        locationId: "loc_docks",
        vendorNpcId: "npc_3",
        factionId: "fac_smugglers",
        modifier: 1,
        stock: 8,
        legalStatus: "legal",
      },
    ],
    entryPoints: [
      {
        id: "entry_1",
        title: "Ash Gate",
        summary: "Arrive under watch.",
        startLocationId: "loc_gate",
        presentNpcIds: ["npc_4"],
        initialInformationIds: ["info_2"],
      },
      {
        id: "entry_2",
        title: "Harbor Arrival",
        summary: "Step into the docks.",
        startLocationId: "loc_docks",
        presentNpcIds: ["npc_3"],
        initialInformationIds: ["info_1"],
      },
    ],
  };
}

function createValidWorldBible(): GeneratedWorldBible {
  return {
    title: "Beneath the Rain",
    premise: "The rain never stops, and every working pier hides a new dependency.",
    tone: "Melancholic and pressured",
    setting: "A drowned trade frontier",
    groundLevelReality:
      "People survive on floating settlements, inland levy roads, and far-traveled port chains held together by pumps, bells, ferries, and old debts. A traveler crossing the world learns quickly that every region pays for the same collapsing systems in a different currency. The rain, the tariffs, and the salvaged machines tie distant coasts together more tightly than any king does. Even the holiest routes smell of rust, wet rope, ration paper, and old quarrels.",
    widespreadBurdens: [
      "The Harbor Court rations dry berths each dawn, and late barges pay triple fees or sleep in storm water.",
      "Bell Reef pilots control the safest channels, so villages without pilot scrip lose cargo to rocks, tolls, and delay.",
      "Lamp oil imports arrive under guard, and whole neighborhoods spend nights in rationed dark when a convoy misses tide.",
      "Every salvage crew owes a cut to the Tide Unions, so independent divers work with sabotaged winches or false charges.",
      "Signal towers quarantine suspicious sails for days, and perishable cargo rots before the clerks finish their inspections.",
      "Across the inland floodplains, bridge wardens collect emergency plank levies, and grain caravans choose between washed roads or private ferries with armed escorts.",
      "Shrine ports on the outer islands demand tithe fuel for every beacon fire, so distant fishing towns trade winter stores just to keep their reefs visible.",
    ],
    presentScars: [
      "The Deluge drowned the old causeways, and every rebuilt dock still rests on scavenged piles that groan in hard weather.",
      "The Vault Wars emptied three harbor districts, and their sealed warehouses still anchor feuds over keys, salvage rights, and missing ledgers.",
      "The Leviathan Treaties ended open naval war, but every customs jetty still keeps treaty guns pointed at the wrong islands.",
      "The Harbor Schism split the signal clergy, and rival bell towers still issue contradictory storm calls during blackwater squalls.",
      "The Lantern Famine killed winter trade for a generation, and families still hide private wick stores behind shrine walls and false floors.",
      "The Salt March burned the inland reed cities, and cracked levy stones still force caravans to zigzag through disputed toll ground.",
      "The Emperor's Drowning left half-finished storm canals across the southern coast, and every monsoon season turns them back into grave trenches and smuggler roads.",
    ],
    sharedRealities: [
      "Tar-black rain capes hanging over public queues",
      "Signal bells arguing across the shoals at dusk",
      "The cracked municipal desalinator everyone walks past and nobody trusts",
      "Hull chalk tally marks layered beside ration notices",
      "Dock shrines wrapped in greasy lamp cloth",
      "Winch crews shouting over rusted pulley teeth",
    ],
    explanationThreads: [
      {
        key: "myth_1",
        phenomenon: "The unending rain",
        prevailingTheories: [
          "Signal clergy teach that the rain is a warning left for oath-breakers.",
          "Dockworkers say the clouds follow broken harbor promises more than prayer.",
          "A banned chart-room theory claims the storms answer old machinery below the shoals.",
        ],
        actionableSecret: "A retired bell-keeper knows which drowned relay station still changes the storm wall when its gears are fed current.",
      },
      {
        key: "myth_2",
        phenomenon: "The speaking shoals",
        prevailingTheories: [
          "Harbor courts call the voices wave echo and contraband superstition.",
          "Pilot families insist the shoals repeat the names of ships that broke treaty waters.",
          "Smugglers whisper that the voices are trapped crew memories leaking from sealed vault vents.",
        ],
        actionableSecret: "A customs diver recovered a speaking brass tube that matches markings on a forbidden shoal map kept in the archive loft.",
      },
      {
        key: "myth_3",
        phenomenon: "Blackwater lantern failures",
        prevailingTheories: [
          "Quartermasters blame spoiled oil and wet wick stock.",
          "Shrine keepers say rival bells foul the light when storm rites are skipped.",
          "A disgraced lampwright claims someone has been swapping condenser parts across the harbor.",
        ],
        actionableSecret: "Invoices from three lamp houses point to the same repair broker, who quietly stores stripped condenser cages under the flood stairs.",
      },
    ],
    everydayLife: {
      survival: "People queue before dawn for dry berth slips, filtered water, and whatever lamp oil has not already been promised upward.",
      institutions: ["Harbor Court", "Tide Unions", "Signal Clergy", "Lamp House Wardens"],
      fears: ["Hull breach", "Quota seizures", "False quarantine"],
      wants: ["Dry storage", "Pilot favors", "Reliable lamp oil"],
      trade: ["Kelp cloth", "Whale oil", "Pilot scrip", "Salvage permits"],
      gossip: [
        "Two dock workers swear the Quartermaster's scales came up light again on the east quay grain unload.",
        "People say Sister Vale rang the storm bell early because a treaty cutter was hiding contraband under prayer cloth.",
        "A pilot's boy claims someone has been repainting old vault markers near the shoal ladders after midnight.",
      ],
    },
  };
}

test("world module coherence accepts a connected valid graph", () => {
  const report = validateWorldModuleCoherence(createWorld());
  assert.equal(report.ok, true);
  assert.deepEqual(report.issues, []);
});

test("world module coherence rejects over-dense minor sibling locations", () => {
  const world = createWorld();

  world.locations[0] = {
    ...world.locations[0]!,
    locationKind: "spine",
    parentLocationId: null,
    discoveryState: "revealed",
  };

  for (let index = 1; index <= 6; index += 1) {
    const minorId = `loc_minor_${index}`;
    world.locations.push({
      id: minorId,
      name: `Minor ${index}`,
      type: "minor_site",
      locationKind: "minor",
      parentLocationId: "loc_gate",
      discoveryState: "rumored",
      justificationForNode: "Reaching it requires crossing guarded access points away from the main district.",
      summary: "A gated sub-location.",
      description: "A sub-location that is isolated from the parent district.",
      state: "active",
      controllingFactionId: null,
      tags: [],
    });
    world.edges.push({
      id: `edge_minor_${index}`,
      sourceId: "loc_gate",
      targetId: minorId,
      travelTimeMinutes: 8,
      dangerLevel: 1,
      currentStatus: "open",
      description: null,
    });
  }

  const report = validateWorldModuleCoherence(world);

  assert.equal(report.ok, false);
  assert.match(report.issues.join("\n"), /minor locations attached/);
});

test("world module coherence rejects topology edges that are too short", () => {
  const world = createWorld();
  world.edges[0] = {
    ...world.edges[0]!,
    travelTimeMinutes: 4,
  };

  const report = validateWorldModuleCoherence(world);

  assert.equal(report.ok, false);
  assert.match(report.issues.join("\n"), /Intra-location movement should stay narrative/);
});

test("world module playability rejects over-concentrated NPC placement", () => {
  const world = createWorld();
  world.npcs = world.npcs.map((npc) => ({
    ...npc,
    currentLocationId: "loc_market",
  }));

  const report = validateWorldModulePlayability(world);
  assert.equal(report.ok, false);
  assert.match(report.issues.join("\n"), /40%/);
});

test("world bible validation allows zero explanation threads by default", () => {
  const worldBible = createValidWorldBible();
  worldBible.explanationThreads = [];
  const report = validateWorldBible(worldBible);

  assert.equal(report.ok, true);
  assert.deepEqual(report.issues, []);
});

test("world bible validation can still require explanation threads when explicitly requested", () => {
  const report = validateWorldBible(
    {
      ...createValidWorldBible(),
      explanationThreads: [],
    },
    { minimumExplanationThreads: 2 },
  );

  assert.equal(report.ok, false);
  assert.match(report.issues.join("\n"), /at least 2 competing explanation threads/);
});

test("world spine validation rejects disconnected geography", () => {
  const report = validateWorldSpine({
    locations: [
      {
        key: "harbor",
        name: "Harbor",
        type: "city",
        summary: "A wet trade hub.",
        description: "A barge-city under endless rain.",
        state: "stable",
        controlStatus: "controlled",
        controllingFactionKey: "guild",
        tags: ["trade"],
        localIdentity: "Everyone smells like salt and lamp smoke.",
      },
      {
        key: "vault",
        name: "Sunken Vault",
        type: "ruin",
        summary: "A drowned archive.",
        description: "Dry chambers under black water.",
        state: "perilous",
        controlStatus: "independent",
        controllingFactionKey: null,
        tags: ["ruin"],
        localIdentity: "Divers pray before each descent.",
      },
      {
        key: "reef",
        name: "Bell Reef",
        type: "reef",
        summary: "Storm bells and razor coral.",
        description: "A reef used to warn caravans.",
        state: "fraying",
        controlStatus: "contested",
        controllingFactionKey: null,
        tags: ["hazard"],
        localIdentity: "Children learn currents before letters.",
      },
      {
        key: "spire",
        name: "Storm Spire",
        type: "tower",
        summary: "Weather watchers.",
        description: "A lonely tower in the rain wall.",
        state: "isolated",
        controlStatus: "controlled",
        controllingFactionKey: "guild",
        tags: ["signal"],
        localIdentity: "Every meal tastes of lightning and tin.",
      },
    ],
    edges: [
      {
        key: "edge_1",
        sourceKey: "harbor",
        targetKey: "vault",
        travelTimeMinutes: 30,
        dangerLevel: 4,
        currentStatus: "open",
        description: null,
      },
      {
        key: "edge_2",
        sourceKey: "vault",
        targetKey: "reef",
        travelTimeMinutes: 25,
        dangerLevel: 5,
        currentStatus: "open",
        description: null,
      },
      {
        key: "edge_3",
        sourceKey: "reef",
        targetKey: "harbor",
        travelTimeMinutes: 20,
        dangerLevel: 3,
        currentStatus: "open",
        description: null,
      },
      {
        key: "edge_4",
        sourceKey: "spire",
        targetKey: "spire",
        travelTimeMinutes: 5,
        dangerLevel: 1,
        currentStatus: "open",
        description: null,
      },
    ],
    factions: [
      {
        key: "guild",
        name: "Lantern Guild",
        type: "mercantile",
        summary: "Rain traders.",
        agenda: "Control salvage lanes.",
        resources: { gold: 8, military: 2, influence: 7, information: 4 },
        pressureClock: 3,
        publicFootprint: "Guild lanterns mark every dock tax point.",
      },
      {
        key: "divers",
        name: "Vault Divers",
        type: "explorers",
        summary: "Dry-vault hunters.",
        agenda: "Reach the old continents first.",
        resources: { gold: 3, military: 3, influence: 4, information: 8 },
        pressureClock: 5,
        publicFootprint: "Dive bells and patched pressure suits crowd the piers.",
      },
    ],
    factionRelations: [
      {
        key: "rel_1",
        factionAKey: "guild",
        factionBKey: "divers",
        stance: "rival",
        summary: "They need each other and resent it.",
      },
    ],
  });

  assert.equal(report.ok, false);
  assert.match(report.issues.join("\n"), /disconnected/);
});

test("world immersion validation rejects empty locations", () => {
  const world = createWorld();
  world.marketPrices = [];

  const report = validateWorldModuleImmersion(world);

  assert.equal(report.ok, false);
  assert.match(report.issues.join("\n"), /economic identity/);
});

test("world immersion validation accepts textual economic identity without market prices", () => {
  const world = createWorld();
  world.marketPrices = [];
  world.locations[1] = {
    ...world.locations[1],
    description: `${world.locations[1].description} Trade identity: lamp oil, brine fish. Scarcity: fuel boats are arriving late. Street economy: dock crews barter for lamp time after dark.`,
  };

  const report = validateWorldModuleImmersion(world);

  assert.doesNotMatch(report.issues.join("\n"), /Location Market needs an economic identity/);
});

test("world immersion validation accepts a textual faction footprint", () => {
  const world = createWorld();
  world.factions.push({
    id: "fac_whimsical",
    name: "Whimsical Creature Clans",
    type: "social",
    summary: "Clan networks in the canopy.",
    agenda: "Protect creature territories.",
    resources: { gold: 2, military: 1, influence: 5, information: 4 },
    pressureClock: 2,
  });
  world.locations[1] = {
    ...world.locations[1],
    summary: `${world.locations[1].summary} Whimsical creatures gather here to barter favors.`,
    description: `${world.locations[1].description} Clan elders keep a perch above the stalls.`,
  };

  const report = validateWorldModuleImmersion(world);

  assert.doesNotMatch(report.issues.join("\n"), /Whimsical Creature Clans needs a visible mark on the world/);
});

test("faction footprint validation rejects factions with no visible presence", () => {
  const world = createWorld();
  world.factions.push({
    id: "fac_ghost",
    name: "Quiet Ledger Circle",
    type: "mercantile",
    summary: "An off-book accounting ring.",
    agenda: "Hide debt trails.",
    resources: { gold: 3, military: 0, influence: 4, information: 6 },
    pressureClock: 3,
  });

  const report = validateFactionFootprints(world);

  assert.equal(report.ok, false);
  assert.match(report.issues.join("\n"), /Quiet Ledger Circle needs a visible mark on the world/);
});

test("regional life validation requires coverage for every location", () => {
  const report = validateRegionalLife(
    {
      locations: [
        {
          locationId: "loc_gate",
          publicActivity: "Customs inspections",
          dominantActivities: ["queueing", "bribery"],
          localPressure: "The watch cannot inspect fast enough.",
          classTexture: "Porters sleep in shifts beside officials.",
          everydayTexture: "Wet cloaks steam beside brazier lines.",
          publicHazards: ["pickpockets"],
          ordinaryKnowledge: ["The watch is stretched thin", "Merchants hide cargo ledgers"],
          institutions: ["Customs office"],
          gossip: ["A captain vanished"],
          reasonsToLinger: ["Cheap guides"],
          routineSeeds: ["Shift changes jam the gates"],
          eventSeeds: ["A seized crate breaks open"],
        },
      ],
    },
    ["loc_gate", "loc_market"],
  );

  assert.equal(report.ok, false);
  assert.match(report.issues.join("\n"), /missing location loc_market/);
});

test("regional life validation rejects duplicate or mismatched location coverage", () => {
  const report = validateRegionalLife(
    {
      locations: [
        {
          locationId: "loc_gate",
          publicActivity: "Customs inspections",
          dominantActivities: ["queueing", "bribery"],
          localPressure: "The watch cannot inspect fast enough.",
          classTexture: "Porters sleep in shifts beside officials.",
          everydayTexture: "Wet cloaks steam beside brazier lines.",
          publicHazards: ["pickpockets"],
          ordinaryKnowledge: ["The watch is stretched thin", "Merchants hide cargo ledgers"],
          institutions: ["Customs office"],
          gossip: ["A captain vanished"],
          reasonsToLinger: ["Cheap guides"],
          routineSeeds: ["Shift changes jam the gates"],
          eventSeeds: ["A seized crate breaks open"],
        },
        {
          locationId: "loc_gate",
          publicActivity: "Inspectors bark over the rain.",
          dominantActivities: ["inspections", "cargo tallying"],
          localPressure: "The line never shortens.",
          classTexture: "Officials stay dry while laborers soak.",
          everydayTexture: "Ink runs on manifests and tempers run shorter.",
          publicHazards: ["stampedes"],
          ordinaryKnowledge: ["Bribes move faster than paper", "Dock gangs watch the queue"],
          institutions: ["Customs office"],
          gossip: ["Someone important crossed under false papers"],
          reasonsToLinger: ["Work can be found nearby"],
          routineSeeds: ["A clerk demands a second inspection"],
          eventSeeds: ["A bell rings for a sealed carriage"],
        },
        {
          locationId: "loc_docks",
          publicActivity: "Crews unload storm-damaged cargo.",
          dominantActivities: ["unloading", "haggling"],
          localPressure: "Half the berths are unsafe after last tide.",
          classTexture: "Stevedores shoulder risk while captains keep accounts.",
          everydayTexture: "Tar, salt, and river mud cling to everything.",
          publicHazards: ["slick planks"],
          ordinaryKnowledge: ["A foreman is skimming stock", "Night crews see unlisted boats"],
          institutions: ["Harbor office"],
          gossip: ["A diver came up babbling about bells"],
          reasonsToLinger: ["Day labor is plentiful"],
          routineSeeds: ["A cargo crane jams mid-lift"],
          eventSeeds: ["A wrecked cutter limps into berth"],
        },
      ],
    },
    ["loc_gate", "loc_market"],
  );

  assert.equal(report.ok, false);
  assert.match(report.issues.join("\n"), /exactly 2 locations/);
  assert.match(report.issues.join("\n"), /duplicates location loc_gate/);
});

test("social layer validation requires anchored NPC coverage for every location", () => {
  const report = validateSocialLayer(
    {
      npcs: [
        {
          id: "npc_1",
          name: "Captain Voss",
          role: "commander",
          summary: "Strained officer.",
          description: "A strained officer.",
          factionId: "fac_watch",
          currentLocationId: "loc_keep",
          approval: 0,
          isCompanion: false,
        },
        {
          id: "npc_2",
          name: "Sela Thorn",
          role: "broker",
          summary: "Market fixer.",
          description: "A market fixer.",
          factionId: "fac_guild",
          currentLocationId: "loc_market",
          approval: 0,
          isCompanion: false,
        },
      ],
      socialGravity: [
        {
          npcId: "npc_1",
          importance: "pillar",
          bridgeLocationIds: [],
          bridgeFactionIds: [],
        },
        {
          npcId: "npc_2",
          importance: "connector",
          bridgeLocationIds: [],
          bridgeFactionIds: [],
        },
      ],
    },
    ["loc_keep", "loc_market", "loc_docks"],
  );

  assert.equal(report.ok, false);
  assert.match(report.issues.join("\n"), /missing an anchored NPC for location loc_docks/);
});

test("social layer validation rejects duplicate NPC names", () => {
  const report = validateSocialLayer(
    {
      npcs: [
        {
          id: "npc_1",
          name: "Captain Voss",
          role: "commander",
          summary: "Strained officer.",
          description: "A strained officer.",
          factionId: "fac_watch",
          currentLocationId: "loc_keep",
          approval: 0,
          isCompanion: false,
        },
        {
          id: "npc_2",
          name: "Captain Voss",
          role: "broker",
          summary: "Market fixer.",
          description: "A market fixer.",
          factionId: "fac_guild",
          currentLocationId: "loc_market",
          approval: 0,
          isCompanion: false,
        },
      ],
      socialGravity: [],
    },
    ["loc_keep", "loc_market"],
  );

  assert.equal(report.ok, false);
  assert.match(report.issues.join("\n"), /NPC names must be unique/);
});

test("social layer validation rejects duplicate NPC first names", () => {
  const report = validateSocialLayer(
    {
      npcs: [
        {
          id: "npc_1",
          name: "Captain Voss",
          role: "commander",
          summary: "Strained officer.",
          description: "A strained officer.",
          factionId: "fac_watch",
          currentLocationId: "loc_keep",
          approval: 0,
          isCompanion: false,
        },
        {
          id: "npc_2",
          name: "Captain Thorn",
          role: "broker",
          summary: "Market fixer.",
          description: "A market fixer.",
          factionId: "fac_guild",
          currentLocationId: "loc_market",
          approval: 0,
          isCompanion: false,
        },
      ],
      socialGravity: [],
    },
    ["loc_keep", "loc_market"],
  );

  assert.equal(report.ok, false);
  assert.match(report.issues.join("\n"), /NPC first names must be unique/);
});

test("knowledge economy validation does not require public leads at every location", () => {
  const knowledgeEconomy: GeneratedKnowledgeEconomy = {
    information: [
      {
        id: "info_public",
        title: "Dock prices rise before storm week",
        summary: "Everyone knows fuel is running short.",
        content: "Everyone knows fuel is running short.",
        truthfulness: "true",
        accessibility: "public",
        locationId: "loc_market",
        factionId: null,
        sourceNpcId: null,
      },
      {
        id: "info_guarded",
        title: "The archive clerk sells night access",
        summary: "A clerk quietly trades access for favors.",
        content: "A clerk quietly trades access for favors.",
        truthfulness: "true",
        accessibility: "guarded",
        locationId: "loc_archive",
        factionId: null,
        sourceNpcId: null,
      },
      {
        id: "info_secret",
        title: "A reef cache sits under patrol markers",
        summary: "Only smugglers know the marker pattern.",
        content: "Only smugglers know the marker pattern.",
        truthfulness: "partial",
        accessibility: "secret",
        locationId: "loc_reef",
        factionId: null,
        sourceNpcId: null,
      },
    ],
    informationLinks: [
      {
        id: "link_1",
        sourceId: "info_public",
        targetId: "info_guarded",
        linkType: "extends",
      },
    ],
    knowledgeNetworks: [
      {
        theme: "Storm Debt",
        publicBeliefs: ["The storm chooses who pays."],
        hiddenTruth: "Harbor rationing is driving the panic.",
        linkedInformationIds: ["info_public"],
        contradictionThemes: [],
      },
    ],
    pressureSeeds: [
      {
        subjectType: "location",
        subjectId: "loc_market",
        pressure: "Fuel rationing will trigger fights by week's end.",
      },
    ],
    commodities: [
      {
        id: "com_1",
        name: "Lamp Oil",
        baseValue: 4,
        tags: ["fuel"],
      },
    ],
    marketPrices: [
      {
        id: "price_1",
        commodityId: "com_1",
        locationId: "loc_market",
        vendorNpcId: null,
        factionId: null,
        modifier: 2,
        stock: 5,
        legalStatus: "legal",
      },
    ],
    locationTradeIdentity: [
      {
        locationId: "loc_market",
        signatureGoods: ["lamp oil"],
        scarcityNotes: "Fuel boats are arriving late.",
        streetLevelEconomy: "Dock crews barter for lamp time after dark.",
      },
      {
        locationId: "loc_archive",
        signatureGoods: ["sealed records"],
        scarcityNotes: "Dry storage is more valuable than coin.",
        streetLevelEconomy: "Copyists trade access, favors, and dry shelf space.",
      },
      {
        locationId: "loc_reef",
        signatureGoods: ["smuggled salt fish"],
        scarcityNotes: "Patrol sweeps keep trade irregular.",
        streetLevelEconomy: "Small crews trade fast and vanish before inspection.",
      },
    ],
  };

  const report = validateKnowledgeEconomy(knowledgeEconomy, [
    "loc_market",
    "loc_archive",
    "loc_reef",
  ]);

  assert.equal(report.ok, true);
  assert.deepEqual(report.issues, []);
});

test("entry contexts allow connected worlds with longer overall travel diameter", () => {
  const longWorld = createWorld();
  longWorld.locations.push(
    {
      id: "loc_outer_1",
      name: "Outer 1",
      type: "shoals",
      summary: "Outer shoals.",
      description: "A distant shoal.",
      state: "active",
      controllingFactionId: null,
      tags: [],
    },
    {
      id: "loc_outer_2",
      name: "Outer 2",
      type: "reef",
      summary: "Far reef.",
      description: "A far reef.",
      state: "active",
      controllingFactionId: null,
      tags: [],
    },
    {
      id: "loc_outer_3",
      name: "Outer 3",
      type: "wreck",
      summary: "Distant wreck.",
      description: "A distant wreck.",
      state: "active",
      controllingFactionId: null,
      tags: [],
    },
  );
  longWorld.edges.push(
    {
      id: "edge_5",
      sourceId: "loc_keep",
      targetId: "loc_outer_1",
      travelTimeMinutes: 20,
      dangerLevel: 2,
      currentStatus: "open",
      description: null,
    },
    {
      id: "edge_6",
      sourceId: "loc_outer_1",
      targetId: "loc_outer_2",
      travelTimeMinutes: 20,
      dangerLevel: 2,
      currentStatus: "open",
      description: null,
    },
    {
      id: "edge_7",
      sourceId: "loc_outer_2",
      targetId: "loc_outer_3",
      travelTimeMinutes: 20,
      dangerLevel: 2,
      currentStatus: "open",
      description: null,
    },
  );

  const report = validateEntryContexts(
    {
      entryPoints: [
        {
          id: "entry_1",
          title: "Gate Arrival",
          summary: "Arrive under watch.",
          startLocationId: "loc_gate",
          presentNpcIds: ["npc_4"],
          initialInformationIds: ["info_2"],
          immediatePressure: "The queue is backing up and tempers are rising.",
          publicLead: "A local guide is already offering work nearby.",
          localContactNpcId: "npc_4",
          mundaneActionPath: "Help a merchant clear customs for fast coin.",
          evidenceWorldAlreadyMoving: "Inspectors are waving through sealed carts ahead of you.",
        },
      ],
    },
    longWorld,
  );

  assert.equal(report.ok, true);
  assert.deepEqual(report.issues, []);
});
