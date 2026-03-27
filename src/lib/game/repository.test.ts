import assert from "node:assert/strict";
import test from "node:test";
import { repositoryTestUtils } from "./repository";
import type {
  CampaignRuntimeState,
  CharacterInstance,
  GeneratedCampaignOpening,
  GeneratedWorldModule,
  OpenWorldGenerationArtifacts,
  PreparedCampaignLaunch,
  ResolvedLaunchEntry,
} from "./types";

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
    ],
    factionRelations: [],
    npcs: [
      {
        id: "npc_guide",
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
        id: "info_watch",
        title: "The watch is stretched thin",
        summary: "The watch is reacting, not leading.",
        content: "The watch is reacting, not leading.",
        truthfulness: "true",
        accessibility: "public",
        locationId: "loc_gate",
        factionId: "fac_watch",
        sourceNpcId: "npc_guide",
      },
    ],
    informationLinks: [],
    commodities: [
      { id: "com_1", name: "Lamp Oil", baseValue: 4, tags: ["fuel"] },
      { id: "com_2", name: "Salt Fish", baseValue: 3, tags: ["food"] },
    ],
    marketPrices: [
      {
        id: "price_1",
        commodityId: "com_1",
        locationId: "loc_market",
        vendorNpcId: null,
        factionId: "fac_watch",
        modifier: 1,
        stock: 8,
        legalStatus: "legal",
      },
      {
        id: "price_2",
        commodityId: "com_2",
        locationId: "loc_gate",
        vendorNpcId: "npc_guide",
        factionId: null,
        modifier: 1.1,
        stock: 5,
        legalStatus: "legal",
      },
    ],
    entryPoints: [
      {
        id: "entry_1",
        title: "At the Gate",
        summary: "Begin under watchful eyes.",
        startLocationId: "loc_gate",
        presentNpcIds: ["npc_guide"],
        initialInformationIds: ["info_watch"],
      },
    ],
  };
}

function createArtifacts(): OpenWorldGenerationArtifacts {
  return {
    entryContexts: {
      entryPoints: [
        {
          id: "entry_1",
          title: "At the Gate",
          summary: "Begin under watchful eyes.",
          startLocationId: "loc_gate",
          presentNpcIds: ["npc_guide"],
          initialInformationIds: ["info_watch"],
          immediatePressure: "The gate line is tightening.",
          publicLead: "The guide is already watching for a signal.",
          localContactNpcId: "npc_guide",
          localContactTemporaryActorLabel: null,
          temporaryLocalActors: [],
          mundaneActionPath: "Join the queue and play your role.",
          evidenceWorldAlreadyMoving: "The checkpoint is already active.",
        },
      ],
    },
  } as unknown as OpenWorldGenerationArtifacts;
}

test("resolveStockLaunchEntry prefers artifact-backed entry context and marks it non-custom", () => {
  const resolved = repositoryTestUtils.resolveStockLaunchEntry({
    world: createWorld(),
    artifacts: createArtifacts(),
    entryPointId: "entry_1",
  });

  assert.equal(resolved.id, "entry_1");
  assert.equal(resolved.isCustom, false);
  assert.equal(resolved.customRequestPrompt, null);
  assert.equal(resolved.localContactNpcId, "npc_guide");
});

test("toRouterInventorySummary aggregates quantity and omits removed inventory entries", () => {
  const inventory = repositoryTestUtils.toRouterInventorySummary({
    id: "inst_1",
    templateId: "char_1",
    health: 12,
    gold: 3,
    commodityStacks: [],
    inventory: [
      {
        id: "iteminst_1",
        characterInstanceId: "inst_1",
        templateId: "item_rope",
        template: {
          id: "item_rope",
          campaignId: "camp_1",
          name: "Rope",
          description: "A coil of hemp rope.",
          value: 1,
          weight: 1,
          rarity: "common",
          tags: [],
        },
        isIdentified: true,
        charges: null,
        properties: null,
      },
      {
        id: "iteminst_2",
        characterInstanceId: "inst_1",
        templateId: "item_rope",
        template: {
          id: "item_rope",
          campaignId: "camp_1",
          name: "Rope",
          description: "A coil of hemp rope.",
          value: 1,
          weight: 1,
          rarity: "common",
          tags: [],
        },
        isIdentified: true,
        charges: null,
        properties: null,
      },
      {
        id: "iteminst_3",
        characterInstanceId: "inst_1",
        templateId: "item_hook",
        template: {
          id: "item_hook",
          campaignId: "camp_1",
          name: "Grappling Hook",
          description: "A four-pronged iron hook.",
          value: 2,
          weight: 1,
          rarity: "common",
          tags: [],
        },
        isIdentified: true,
        charges: null,
        properties: { removedFromInventory: true },
      },
    ],
  } satisfies CharacterInstance);

  assert.deepEqual(inventory, [
    {
      templateId: "item_rope",
      name: "Rope",
      quantity: 2,
    },
  ]);
});

test("toRouterSceneAspectSummaries emits compact duration-aware aspect records", () => {
  const aspects = repositoryTestUtils.toRouterSceneAspectSummaries({
    currentLocationId: "loc_gate",
    globalTime: 480,
    pendingTurnId: null,
    lastActionSummary: null,
    customTitle: null,
    sceneAspects: {
      forge_smoke: {
        label: "forge smoke",
        state: "hanging in the rafters",
        duration: "scene",
      },
      guild_notice: {
        label: "guild notice",
        state: "nailed by the door",
        duration: "permanent",
      },
    },
  } satisfies CampaignRuntimeState);

  assert.deepEqual(aspects, [
    {
      key: "forge_smoke",
      label: "forge smoke",
      state: "hanging in the rafters",
      duration: "scene",
    },
    {
      key: "guild_notice",
      label: "guild notice",
      state: "nailed by the door",
      duration: "permanent",
    },
  ]);
});

test("prunePromptContextForRouter ranks resolved refs and trims unrelated heavy surfaces", () => {
  const pruned = repositoryTestUtils.prunePromptContextForRouter({
    profile: "local",
    routerDecision: {
      profile: "local",
      confidence: "high",
      authorizedVectors: ["economy_light"],
      requiredPrerequisites: [],
      reason: "Simple named-NPC purchase.",
      clarification: {
        needed: false,
        blocker: null,
        question: null,
        options: [],
      },
      attention: {
        primaryIntent: "Buy bread from the baker.",
        resolvedReferents: [
          {
            phrase: "Mira Brightstone",
            targetRef: "npc:npc_mira",
            targetKind: "scene_actor",
            confidence: "high",
          },
        ],
        unresolvedReferents: [],
        mustCheck: ["sceneActors", "gold"],
      },
    },
    promptContext: {
      currentLocation: {
        id: "loc_market",
        name: "Lantern Market",
        type: "district",
        summary: "Rain-dark awnings and crowded stalls.",
        state: "busy",
      },
      adjacentRoutes: [
        {
          id: "edge_market_dock",
          targetLocationId: "loc_dock",
          targetLocationName: "Dock Ward",
          travelTimeMinutes: 10,
          dangerLevel: 1,
          currentStatus: "open",
          description: null,
        },
      ],
      sceneActors: [
        {
          actorRef: "temp:temp_runner",
          kind: "temporary_actor",
          displayLabel: "runner",
          role: "runner",
          detailFetchHint: null,
          lastSummary: "A courier darts through the lane.",
        },
        {
          actorRef: "npc:npc_mira",
          kind: "npc",
          displayLabel: "Mira Brightstone",
          role: "baker",
          detailFetchHint: null,
          lastSummary: "She keeps bread warm under cloth.",
        },
        {
          actorRef: "temp:temp_guard",
          kind: "temporary_actor",
          displayLabel: "guard",
          role: "guard",
          detailFetchHint: null,
          lastSummary: "A watchman scans the crowd.",
        },
      ],
      recentLocalEvents: [],
      recentTurnLedger: ["[You] I set out the stall."],
      discoveredInformation: [],
      activePressures: [],
      recentWorldShifts: [],
      activeThreads: [],
      inventory: [
        {
          kind: "item",
          id: "item_rope",
          name: "Rope",
          description: "A coil of rope.",
          quantity: 2,
        },
        {
          kind: "item",
          id: "item_lantern",
          name: "Lantern",
          description: "A hooded lantern.",
          quantity: 0,
        },
      ],
      sceneAspects: {
        crowd_noise: {
          label: "crowd noise",
          state: "The market is already loud.",
          duration: "scene",
        },
      },
      localTexture: null,
      globalTime: 540,
      timeOfDay: "morning",
      dayCount: 1,
    },
  });

  assert.equal(pruned.sceneActors[0]?.actorRef, "npc:npc_mira");
  assert.deepEqual(pruned.adjacentRoutes, []);
  assert.deepEqual(
    pruned.inventory.map((entry) => [entry.id, entry.quantity]),
    [["item_rope", 2]],
  );
});

test("normalizeLaunchEntrySelection returns provided custom entry unchanged", () => {
  const customEntryPoint: ResolvedLaunchEntry = {
    id: "custom_entry_1",
    title: "Courier at Dawn",
    summary: "Slip through the gate under borrowed authority.",
    startLocationId: "loc_gate",
    presentNpcIds: ["npc_guide"],
    initialInformationIds: ["info_watch"],
    immediatePressure: "Inspections are tightening.",
    publicLead: "The guide is already scanning the line.",
    localContactNpcId: "npc_guide",
    localContactTemporaryActorLabel: null,
    temporaryLocalActors: [],
    mundaneActionPath: "Join the queue and stay in character.",
    evidenceWorldAlreadyMoving: "The district is already tense.",
    isCustom: true,
    customRequestPrompt: "I want to arrive as a courier.",
  };

  const resolved = repositoryTestUtils.normalizeLaunchEntrySelection({
    world: createWorld(),
    artifacts: createArtifacts(),
    customEntryPoint,
  });

  assert.deepEqual(resolved, customEntryPoint);
});

test("assignStartingLocalNpcIds is deterministic for preview-to-launch rescoping", () => {
  const assigned = repositoryTestUtils.assignStartingLocalNpcIds("preview_launch_1", [
    {
      name: "Kael Windwhisper",
      role: "street performer",
      summary: "A bard gathering morning trade with a lute and a grin.",
      description: "A half-elf performer tuning up beside the opening stall.",
      factionId: null,
      currentLocationId: "preview_launch_1:location:loc_market",
      approval: 0,
      isCompanion: false,
    },
    {
      name: "Bryn Stoutheart",
      role: "market guard",
      summary: "A watch patrol checking permits along the lane.",
      description: "A city guard walking the stalls before the rush hits.",
      factionId: "preview_launch_1:faction:fac_watch",
      currentLocationId: "preview_launch_1:location:loc_market",
      approval: 0,
      isCompanion: false,
    },
  ]);

  assert.deepEqual(
    assigned.map((npc) => npc.id),
    [
      "preview_launch_1:npc:npc_local_1",
      "preview_launch_1:npc:npc_local_2",
    ],
  );
});

test("buildOpeningWorldWithStartingLocals removes duplicated temporary locals and upgrades the contact", () => {
  const entryPoint: ResolvedLaunchEntry = {
    id: "custom_entry_market",
    title: "Morning Market Setup",
    summary: "Open the stall before the rush hits.",
    startLocationId: "preview_launch_1:location:loc_market",
    presentNpcIds: [],
    initialInformationIds: ["preview_launch_1:information:info_watch"],
    immediatePressure: "The lane is filling before the bolts are out.",
    publicLead: "A street performer is already drawing eyes down the row.",
    localContactNpcId: null,
    localContactTemporaryActorLabel: "street performer",
    temporaryLocalActors: [
      {
        label: "street performer",
        summary: "A half-elf bard tuning a lute and practicing juggling tricks to attract attention",
      },
      {
        label: "early shopper",
        summary: "A merchant's wife comparing cloth and price across nearby stalls.",
      },
    ],
    mundaneActionPath: "Finish laying out the fabrics and decide how to greet the crowd.",
    evidenceWorldAlreadyMoving: "Bread carts and shouted prices are already rolling through the lane.",
    isCustom: true,
    customRequestPrompt: "I start the day as a fabric vendor in the market.",
  };
  const startingLocals = repositoryTestUtils.assignStartingLocalNpcIds("preview_launch_1", [
    {
      name: "Kael Windwhisper",
      role: "street performer",
      summary: "A half-elf bard tuning a lute and practicing juggling tricks.",
      description: "A colorful performer setting up near the stall to draw a crowd.",
      factionId: null,
      currentLocationId: "preview_launch_1:location:loc_market",
      approval: 0,
      isCompanion: false,
    },
    {
      name: "Bryn Stoutheart",
      role: "market guard",
      summary: "A City Watch officer checking permits and watching the lane.",
      description: "A familiar guard pacing the market edge before the morning rush.",
      factionId: "preview_launch_1:faction:fac_watch",
      currentLocationId: "preview_launch_1:location:loc_market",
      approval: 0,
      isCompanion: false,
    },
  ]);

  const built = repositoryTestUtils.buildOpeningWorldWithStartingLocals({
    module: {
      title: "Preview Market",
      premise: "A quiet lane before the morning rush.",
      tone: "Grounded",
      setting: "A trade market",
      locations: [
        {
          id: "preview_launch_1:location:loc_market",
          name: "Lantern Market",
          type: "market",
          summary: "A busy market lane.",
          description: "A lane lined with stalls and awnings.",
          state: "active",
          controllingFactionId: "preview_launch_1:faction:fac_watch",
          tags: [],
        },
      ],
      edges: [],
      factions: [
        {
          id: "preview_launch_1:faction:fac_watch",
          name: "Watch",
          type: "civic",
          summary: "Market patrols.",
          agenda: "Keep order in the market.",
          resources: { gold: 4, military: 5, influence: 5, information: 3 },
          pressureClock: 2,
        },
      ],
      factionRelations: [],
      npcs: [],
      information: [],
      informationLinks: [],
      commodities: [],
      marketPrices: [],
      entryPoints: [],
    },
    entryPoint,
    startingLocals,
  });

  assert.equal(built.entryPoint.localContactTemporaryActorLabel, null);
  assert.equal(built.entryPoint.localContactNpcId, "preview_launch_1:npc:npc_local_1");
  assert.deepEqual(built.entryPoint.temporaryLocalActors, [
    {
      label: "early shopper",
      summary: "A merchant's wife comparing cloth and price across nearby stalls.",
    },
  ]);
});

test("buildOpeningWorldWithStartingLocals strips generic role prefixes when reconciling launch locals", () => {
  const built = repositoryTestUtils.buildOpeningWorldWithStartingLocals({
    module: {
      title: "Preview Market",
      premise: "A quiet lane before the morning rush.",
      tone: "Grounded",
      setting: "A trade market",
      locations: [
        {
          id: "preview_launch_1:location:loc_market",
          name: "Lantern Market",
          type: "market",
          summary: "A busy market lane.",
          description: "A lane lined with stalls and awnings.",
          state: "active",
          controllingFactionId: null,
          tags: [],
        },
      ],
      edges: [],
      factions: [],
      factionRelations: [],
      npcs: [],
      information: [],
      informationLinks: [],
      commodities: [],
      marketPrices: [],
      entryPoints: [],
    },
    entryPoint: {
      id: "custom_entry_apprentice",
      title: "Quiet Prep",
      summary: "Open the shutters before the market wakes.",
      startLocationId: "preview_launch_1:location:loc_market",
      presentNpcIds: [],
      initialInformationIds: [],
      immediatePressure: "You only have a few quiet minutes before the lane fills.",
      publicLead: "A local apprentice is already hovering near the stall with ink-stained hands.",
      localContactNpcId: null,
      localContactTemporaryActorLabel: "local apprentice",
      temporaryLocalActors: [
        {
          label: "local apprentice",
          summary: "An ink-stained apprentice hovers nearby waiting for the ledger runner.",
        },
      ],
      mundaneActionPath: "Set out the ledgers and assign the first morning errands.",
      evidenceWorldAlreadyMoving: "Sweepers and bakers are already moving through the lane.",
      isCustom: true,
      customRequestPrompt: "I want to start by opening a clerk's stall in the market.",
    },
    startingLocals: repositoryTestUtils.assignStartingLocalNpcIds("preview_launch_1", [
      {
        name: "Mira Dain",
        role: "apprentice",
        summary: "An ink-stained apprentice waits with the morning ledger under one arm.",
        description: "She looks ready to sprint the first message across the market.",
        factionId: null,
        currentLocationId: "preview_launch_1:location:loc_market",
        approval: 0,
        isCompanion: false,
      },
    ]),
  });

  assert.equal(built.entryPoint.localContactNpcId, "preview_launch_1:npc:npc_local_1");
  assert.equal(built.entryPoint.localContactTemporaryActorLabel, null);
  assert.deepEqual(built.entryPoint.temporaryLocalActors, []);
});

test("rescopeOpeningToCampaign remaps preview ids to final campaign ids", () => {
  const opening: GeneratedCampaignOpening = {
    narration: "Morning light spills across the lane as you raise the awning.",
    activeThreat: "The first buyers are already close enough to see what is still unpacked.",
    entryPointId: "custom_entry_market",
    locationNodeId: "preview_launch_1:location:loc_market",
    presentNpcIds: [
      "preview_launch_1:npc:npc_local_1",
      "preview_launch_1:npc:npc_local_2",
    ],
    citedInformationIds: ["preview_launch_1:information:info_watch"],
    scene: {
      title: "Morning Market Setup",
      summary: "Open the stall before the lane clogs.",
      location: "Lantern Market",
      atmosphere: "Carts, bread steam, and wet cobbles.",
      suggestedActions: ["Finish unpacking"],
    },
  };

  const rescoped = repositoryTestUtils.rescopeOpeningToCampaign(opening, "camp_final_1");

  assert.equal(rescoped.locationNodeId, "camp_final_1:location:loc_market");
  assert.deepEqual(rescoped.presentNpcIds, [
    "camp_final_1:npc:npc_local_1",
    "camp_final_1:npc:npc_local_2",
  ]);
  assert.deepEqual(rescoped.citedInformationIds, [
    "camp_final_1:information:info_watch",
  ]);
});

test("preparedLaunchMatchesSelection rejects stale bundles from a different launch selection", () => {
  const preparedLaunch: PreparedCampaignLaunch = {
    previewCampaignId: "preview_launch_1",
    entryPoint: {
      id: "custom_entry_market",
      title: "Morning Market Setup",
      summary: "Open the stall before the lane clogs.",
      startLocationId: "preview_launch_1:location:loc_market",
      presentNpcIds: ["preview_launch_1:npc:npc_local_1"],
      initialInformationIds: ["preview_launch_1:information:info_watch"],
      immediatePressure: "You need to get set before the buyers arrive.",
      publicLead: "A performer is already gathering a crowd.",
      localContactNpcId: "preview_launch_1:npc:npc_local_1",
      localContactTemporaryActorLabel: null,
      temporaryLocalActors: [],
      mundaneActionPath: "Lay out the fabrics and take the first sale.",
      evidenceWorldAlreadyMoving: "Bakers and porters are already moving through the lane.",
      isCustom: true,
      customRequestPrompt: "I start as a cloth seller in the market.",
    },
    startingLocals: [],
    opening: {
      narration: "You finish lifting the awning into place.",
      activeThreat: "The lane is filling fast.",
      entryPointId: "custom_entry_market",
      locationNodeId: "preview_launch_1:location:loc_market",
      presentNpcIds: ["preview_launch_1:npc:npc_local_1"],
      citedInformationIds: ["preview_launch_1:information:info_watch"],
      scene: {
        title: "Morning Market Setup",
        summary: "The market is waking around you.",
        location: "Lantern Market",
        atmosphere: "Crowded, damp, and busy.",
        suggestedActions: ["Open the stall"],
      },
    },
  };
  const mismatchedSelection: ResolvedLaunchEntry = {
    ...preparedLaunch.entryPoint,
    startLocationId: "loc_gate",
    initialInformationIds: ["info_watch", "info_extra"],
  };

  assert.equal(
    repositoryTestUtils.preparedLaunchMatchesSelection({
      preparedLaunch,
      normalizedEntryPoint: mismatchedSelection,
    }),
    false,
  );
});

test("findSimilarStockEntry flags custom entries that collapse into an authored stock hook", () => {
  const world = createWorld();
  const similarCustomEntry: ResolvedLaunchEntry = {
    id: "custom_entry_gate_1",
    title: "Gate Trouble",
    summary: "You arrive under watchful eyes as the checkpoint tightens around you.",
    startLocationId: "loc_gate",
    presentNpcIds: ["npc_guide"],
    initialInformationIds: ["info_watch"],
    immediatePressure: "The gate line is tightening and the guide is already looking for your signal.",
    publicLead: "The guide says the checkpoint is about to search the line.",
    localContactNpcId: "npc_guide",
    localContactTemporaryActorLabel: null,
    temporaryLocalActors: [],
    mundaneActionPath: "Join the queue and play your role.",
    evidenceWorldAlreadyMoving: "Guards are already questioning arrivals at the gate.",
    isCustom: true,
    customRequestPrompt: "I want to start at the gate with a tense checkpoint scene.",
  };

  const match = repositoryTestUtils.findSimilarStockEntry({
    customEntryPoint: similarCustomEntry,
    world,
  });

  assert.equal(match?.entryPoint.id, "entry_1");
});

test("findSimilarStockEntry allows routine custom entries in the same place when the hook is materially different", () => {
  const world = createWorld();
  const distinctCustomEntry: ResolvedLaunchEntry = {
    id: "custom_entry_gate_2",
    title: "Before the Stall Opens",
    summary: "You are sweeping grit away from your little awning before the first customers arrive.",
    startLocationId: "loc_gate",
    presentNpcIds: [],
    initialInformationIds: [],
    immediatePressure: "A gust keeps lifting the canvas while you try to tie it down properly.",
    publicLead: "Nearby porters and cart-drivers are beginning their morning rounds.",
    localContactNpcId: null,
    localContactTemporaryActorLabel: null,
    temporaryLocalActors: [],
    mundaneActionPath: "Secure the awning, lay out your tools, and decide what job to tackle first.",
    evidenceWorldAlreadyMoving: "Morning traffic is starting to build beyond the gate.",
    isCustom: true,
    customRequestPrompt: "I want an ordinary workday opening near the gate.",
  };

  const match = repositoryTestUtils.findSimilarStockEntry({
    customEntryPoint: distinctCustomEntry,
    world,
  });

  assert.equal(match, null);
});

test("toPlayerCampaignSnapshot preserves latest retryable turn metadata", () => {
  const playerSnapshot = repositoryTestUtils.toPlayerCampaignSnapshot({
    campaignId: "camp_1",
    sessionId: "sess_1",
    sessionTurnCount: 4,
    stateVersion: 7,
    generatedThroughDay: 1,
    moduleId: "mod_1",
    selectedEntryPointId: "entry_1",
    title: "Harbor of Knives",
    premise: "A harbor city where rival powers are preparing to move.",
    tone: "Tense and investigative",
    setting: "A rain-dark trade port",
    state: {
      currentLocationId: "loc_gate",
      globalTime: 480,
      pendingTurnId: null,
      lastActionSummary: null,
      sceneAspects: {},
    },
    character: {} as never,
    currentLocation: {} as never,
    adjacentRoutes: [],
    presentNpcs: [],
    knownNpcLocationIds: {},
    knownFactions: [],
    factionRelations: [],
    localInformation: [],
    discoveredInformation: [],
    connectedLeads: [],
    temporaryActors: [],
    memories: [],
    activePressures: [],
    recentWorldShifts: [],
    activeThreads: [],
    recentMessages: [],
    canRetryLatestTurn: true,
    latestRetryableTurnId: "turn_latest",
  });

  assert.equal(playerSnapshot.canRetryLatestTurn, true);
  assert.equal(playerSnapshot.latestRetryableTurnId, "turn_latest");
});
