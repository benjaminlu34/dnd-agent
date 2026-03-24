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

test("custom resolved launch entry draft schema requires presentNpcIds and localContactNpcId", () => {
  const parsed = customResolvedLaunchEntryDraftSchema.safeParse({
    title: "Courier at Dawn",
    summary: "Slip through the gate under borrowed authority.",
    startLocationId: "loc_gate",
    initialInformationIds: ["info_2"],
    immediatePressure: "Inspections are tightening.",
    publicLead: "The guide is already scanning the line.",
    mundaneActionPath: "Join the queue and stay in character.",
    evidenceWorldAlreadyMoving: "The district is already tense.",
  });

  assert.equal(parsed.success, false);
  assert.match(JSON.stringify(parsed.error?.flatten()), /presentNpcIds|localContactNpcId/);
});

test("validateResolvedLaunchEntryAgainstWorld rejects NPC/location mismatch and secret starting information", () => {
  const world = createWorld();
  const issues = validateResolvedLaunchEntryAgainstWorld(
    {
      id: "custom_entry_1",
      title: "Wrong Place, Wrong Secrets",
      summary: "A forced opening that should fail validation.",
      startLocationId: "loc_gate",
      presentNpcIds: ["npc_3"],
      initialInformationIds: ["info_4"],
      immediatePressure: "The search line is collapsing.",
      publicLead: "Someone nearby is motioning you over.",
      localContactNpcId: "npc_3",
      localContactTemporaryActorLabel: null,
      temporaryLocalActors: [],
      mundaneActionPath: "Join the line and keep walking.",
      evidenceWorldAlreadyMoving: "The checkpoint is already active.",
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
      title: "Kitchen Shift",
      summary: "You begin halfway through a dawn tavern shift before the city fully wakes.",
      startLocationId: "loc_gate",
      presentNpcIds: [],
      initialInformationIds: ["info_2"],
      immediatePressure: "A patrol is about to stop in for a surprise count.",
      publicLead: "The cellar runner heard the watch arguing nearby.",
      localContactNpcId: null,
      localContactTemporaryActorLabel: "cellar runner",
      temporaryLocalActors: [
        {
          label: "cellar runner",
          summary: "A breathless tavern worker moving crates before the rush.",
        },
      ],
      mundaneActionPath: "Stay on task, listen, and decide whether to keep your head down.",
      evidenceWorldAlreadyMoving: "The district is already awake and tense before the player acts.",
    },
    world,
  );

  assert.deepEqual(issues, []);
});
