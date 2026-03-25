import assert from "node:assert/strict";
import test from "node:test";
import {
  campaignCreateRequestSchema,
  campaignOpeningDraftRequestSchema,
  customResolvedLaunchEntryDraftSchema,
  generatedWorldModuleSchema,
  validateResolvedLaunchEntryAgainstWorld,
} from "./session-zero";
import type { GeneratedWorldModule } from "./types";

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
    ],
    factionRelations: [
      {
        id: "rel_1",
        factionAId: "fac_watch",
        factionBId: "fac_guild",
        stance: "neutral",
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
        factionId: null,
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
        factionId: null,
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
        presentNpcIds: ["npc_4"],
        initialInformationIds: ["info_2"],
      },
      {
        id: "entry_2",
        title: "At the Market",
        summary: "Begin in the city crush.",
        startLocationId: "loc_market",
        presentNpcIds: ["npc_2"],
        initialInformationIds: ["info_3"],
      },
    ],
  };
}

test("generatedWorldModuleSchema rejects market prices with unknown factionId", () => {
  const world = createWorld();
  world.marketPrices[0] = {
    ...world.marketPrices[0]!,
    factionId: "fac_missing",
  };

  const parsed = generatedWorldModuleSchema.safeParse(world);

  assert.equal(parsed.success, false);
  assert.match(JSON.stringify(parsed.error?.flatten()), /factionId/);
});

test("campaign launch request schemas enforce strict XOR for entry selection", () => {
  const openingPayload = {
    moduleId: "mod_1",
    templateId: "tpl_1",
    opening: {
      narration: "Rain glistens across the checkpoint.",
      activeThreat: "The line is about to be searched.",
      entryPointId: "entry_1",
      locationNodeId: "loc_gate",
      presentNpcIds: ["npc_4"],
      citedInformationIds: ["info_2"],
      scene: {
        title: "At the Gate",
        summary: "The checkpoint tightens as you arrive.",
        location: "Gate",
        atmosphere: "Wet stone and restless guards.",
        suggestedActions: ["Join the line"],
      },
    },
  };

  assert.equal(
    campaignOpeningDraftRequestSchema.safeParse({
      moduleId: "mod_1",
      templateId: "tpl_1",
      entryPointId: "entry_1",
      customEntryPoint: {
        id: "custom_entry_1",
        title: "Courier at Dawn",
        summary: "Slip through the gate under borrowed authority.",
        startLocationId: "loc_gate",
        presentNpcIds: ["npc_4"],
        initialInformationIds: ["info_2"],
        immediatePressure: "Inspections are tightening.",
        publicLead: "The guide is already scanning the line.",
        localContactNpcId: "npc_4",
        localContactTemporaryActorLabel: null,
        temporaryLocalActors: [],
        mundaneActionPath: "Join the queue and stay in character.",
        evidenceWorldAlreadyMoving: "The district is already tense.",
        isCustom: true,
        customRequestPrompt: "I want to arrive as a courier.",
      },
    }).success,
    false,
  );
  assert.equal(
    campaignCreateRequestSchema.safeParse(openingPayload).success,
    false,
  );
  assert.equal(
    campaignCreateRequestSchema.safeParse({
      ...openingPayload,
      entryPointId: "entry_1",
    }).success,
    true,
  );
});

test("campaign create request schema accepts a prepared launch bundle without an opening draft", () => {
  const parsed = campaignCreateRequestSchema.safeParse({
    moduleId: "mod_1",
    templateId: "tpl_1",
    entryPointId: "entry_1",
    preparedLaunch: {
      previewCampaignId: "preview_launch_1",
      entryPoint: {
        id: "entry_1",
        title: "At the Gate",
        summary: "Begin under watchful eyes.",
        startLocationId: "preview_launch_1:location:loc_gate",
        presentNpcIds: ["preview_launch_1:npc:npc_4"],
        initialInformationIds: ["preview_launch_1:information:info_2"],
        immediatePressure: "The line is about to be searched.",
        publicLead: "The guide is already scanning the line.",
        localContactNpcId: "preview_launch_1:npc:npc_4",
        localContactTemporaryActorLabel: null,
        temporaryLocalActors: [],
        mundaneActionPath: "Join the queue and play your role.",
        evidenceWorldAlreadyMoving: "The checkpoint is already active.",
        isCustom: false,
        customRequestPrompt: null,
      },
      startingLocals: [
        {
          id: "preview_launch_1:npc:npc_local_1",
          name: "Bryn Stoutheart",
          role: "market guard",
          summary: "A guard checking permits near the gate.",
          description: "A watch patrol already pacing the bottleneck.",
          factionId: "preview_launch_1:faction:fac_watch",
          currentLocationId: "preview_launch_1:location:loc_gate",
          approval: 0,
          isCompanion: false,
        },
      ],
      opening: {
        narration: "Rain glistens across the checkpoint.",
        activeThreat: "The line is about to be searched.",
        entryPointId: "entry_1",
        locationNodeId: "preview_launch_1:location:loc_gate",
        presentNpcIds: [
          "preview_launch_1:npc:npc_4",
          "preview_launch_1:npc:npc_local_1",
        ],
        citedInformationIds: ["preview_launch_1:information:info_2"],
        scene: {
          title: "At the Gate",
          summary: "The checkpoint tightens as you arrive.",
          location: "Gate",
          atmosphere: "Wet stone and restless guards.",
          suggestedActions: ["Join the line"],
        },
      },
    },
  });

  assert.equal(parsed.success, true);
});

test("custom resolved launch entry draft schema allows solitary openings without local contacts", () => {
  const parsed = customResolvedLaunchEntryDraftSchema.safeParse({
    title: "At Home Before Dawn",
    summary: "Wake, dress, and prepare for another ordinary day before anyone else is up.",
    startLocationId: "loc_market",
    presentNpcIds: [],
    initialInformationIds: ["info_2"],
    immediatePressure: "Rain is starting and the shutters need securing before you leave.",
    publicLead: "Vendors are already rolling carts into the square below.",
    localContactNpcId: null,
    localContactTemporaryActorLabel: null,
    temporaryLocalActors: [],
    mundaneActionPath: "Dress, pack the stall cloth, and decide how quickly to head downstairs.",
    evidenceWorldAlreadyMoving: "Wheel-rattle and shouted prices are already carrying up from the street.",
  });

  assert.equal(parsed.success, true);
});

test("custom resolved launch entry draft schema allows present named NPCs without a designated contact", () => {
  const parsed = customResolvedLaunchEntryDraftSchema.safeParse({
    title: "Shutters Up in the Market",
    summary: "Open the stall while familiar faces filter into the lane around you.",
    startLocationId: "loc_market",
    presentNpcIds: ["npc_4"],
    initialInformationIds: ["info_2"],
    immediatePressure: "The first customers are arriving before all your stock is unpacked.",
    publicLead: "The watch guide is already crossing the square toward the checkpoint.",
    localContactNpcId: null,
    localContactTemporaryActorLabel: null,
    temporaryLocalActors: [],
    mundaneActionPath: "Finish opening the stall and decide whether to keep working or step away.",
    evidenceWorldAlreadyMoving: "Carts are already clogging the lane and traders are shouting over one another.",
  });

  assert.equal(parsed.success, true);
});

test("custom resolved launch entry draft schema allows ambient unnamed locals without a designated contact", () => {
  const parsed = customResolvedLaunchEntryDraftSchema.safeParse({
    title: "Morning Rush",
    summary: "The market is already filling as workers and neighbors press past your doorway.",
    startLocationId: "loc_market",
    presentNpcIds: [],
    initialInformationIds: ["info_2"],
    immediatePressure: "Your awning needs to be secured before the lane fully clogs.",
    publicLead: "Porters are already warning each other about a jam near the square.",
    localContactNpcId: null,
    localContactTemporaryActorLabel: null,
    temporaryLocalActors: [
      {
        label: "porter",
        summary: "A laborer hauling bundled goods through the morning crowd.",
      },
      {
        label: "neighboring vendor",
        summary: "A nearby seller already laying out wares and complaining about the crush.",
      },
    ],
    mundaneActionPath: "Handle your setup before deciding whether to join the flow or stay tucked in.",
    evidenceWorldAlreadyMoving: "Foot traffic is already thick enough that people have to angle sideways between carts.",
  });

  assert.equal(parsed.success, true);
});

test("custom resolved launch entry draft schema rejects simultaneous named and temporary contacts", () => {
  const parsed = customResolvedLaunchEntryDraftSchema.safeParse({
    title: "Busy Market Morning",
    summary: "Open the stall while the market swells around you.",
    startLocationId: "loc_market",
    presentNpcIds: ["npc_4"],
    initialInformationIds: ["info_2"],
    immediatePressure: "A surprise inspection is working its way down the lane.",
    publicLead: "A runner nearby is already whispering about which booths to avoid.",
    localContactNpcId: "npc_4",
    localContactTemporaryActorLabel: "runner",
    temporaryLocalActors: [
      {
        label: "runner",
        summary: "A quick-footed local errand runner weaving between stalls.",
      },
    ],
    mundaneActionPath: "Unpack the morning stock and keep your head down.",
    evidenceWorldAlreadyMoving: "Tarps are snapping overhead while merchants argue over space.",
  });

  assert.equal(parsed.success, false);
  assert.match(JSON.stringify(parsed.error?.flatten()), /named and temporary local contact anchors/);
});

test("validateResolvedLaunchEntryAgainstWorld rejects NPC/location mismatch and secret starting information", () => {
  const world = createWorld();
  const issues = validateResolvedLaunchEntryAgainstWorld(
    {
      id: "custom_entry_1",
      startLocationId: "loc_gate",
      presentNpcIds: ["npc_3"],
      initialInformationIds: ["info_4"],
      localContactNpcId: "npc_3",
      localContactTemporaryActorLabel: null,
      temporaryLocalActors: [],
    },
    world,
  );

  assert.match(JSON.stringify(issues), /presentNpcIds/);
  assert.match(JSON.stringify(issues), /secret information/);
});

test("validateResolvedLaunchEntryAgainstWorld allows unnamed-local openings without present named NPCs", () => {
  const world = createWorld();
  const issues = validateResolvedLaunchEntryAgainstWorld(
    {
      id: "custom_entry_2",
      startLocationId: "loc_gate",
      presentNpcIds: [],
      initialInformationIds: ["info_2"],
      localContactNpcId: null,
      localContactTemporaryActorLabel: "cellar runner",
      temporaryLocalActors: [
        {
          label: "cellar runner",
          summary: "A breathless tavern worker moving crates before the rush.",
        },
      ],
    },
    world,
  );

  assert.deepEqual(issues, []);
});
