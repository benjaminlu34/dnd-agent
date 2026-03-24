import assert from "node:assert/strict";
import test from "node:test";
import { repositoryTestUtils } from "./repository";
import type { GeneratedWorldModule, OpenWorldGenerationArtifacts, ResolvedLaunchEntry } from "./types";

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
  } as OpenWorldGenerationArtifacts;
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
