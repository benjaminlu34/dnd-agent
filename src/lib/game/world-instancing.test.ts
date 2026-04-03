import assert from "node:assert/strict";
import test from "node:test";
import type { GeneratedWorldModule, ResolvedLaunchEntry } from "./types";
import { instanceWorldForCampaign } from "./world-instancing";

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
    ],
    edges: [],
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
        factionId: "fac_watch",
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
      {
        id: "com_oil",
        name: "Lamp Oil",
        baseValue: 4,
        tags: ["fuel"],
      },
    ],
    marketPrices: [
      {
        id: "price_oil_gate",
        commodityId: "com_oil",
        locationId: "loc_gate",
        vendorNpcId: "npc_guide",
        factionId: "fac_watch",
        modifier: 1,
        stock: 3,
        legalStatus: "legal",
      },
    ],
    entryPoints: [
      {
        id: "entry_gate",
        title: "At the Gate",
        summary: "Begin under watchful eyes.",
        startLocationId: "loc_gate",
        presentNpcIds: ["npc_guide"],
        initialInformationIds: ["info_watch"],
      },
    ],
  };
}

test("instanceWorldForCampaign namespaces ids and preserves references", () => {
  const world = createWorld();
  world.locations[0] = {
    ...world.locations[0]!,
    locationKind: "minor",
    parentLocationId: "loc_parent",
    discoveryState: "rumored",
    justificationForNode: "A hidden gatehouse sits behind a controlled checkpoint and must be reached through guarded access.",
  };
  const stockEntryPoint: ResolvedLaunchEntry = {
    ...world.entryPoints[0]!,
    immediatePressure: "The gate inspection line is tightening by the minute.",
    publicLead: "A local guide is already trying to wave travelers through.",
    localContactNpcId: "npc_guide",
    localContactTemporaryActorLabel: null,
    temporaryLocalActors: [],
    mundaneActionPath: "Join the queue and stay in character.",
    evidenceWorldAlreadyMoving: "The checkpoint is already busy before the player arrives.",
    isCustom: false,
    customRequestPrompt: null,
  };
  const { world: instancedWorld, entryPoint } = instanceWorldForCampaign("camp_123", world, stockEntryPoint);

  assert.equal(instancedWorld.locations[0]?.id, "camp_123:location:loc_gate");
  assert.equal(instancedWorld.locations[0]?.controllingFactionId, "camp_123:faction:fac_watch");
  assert.equal(instancedWorld.npcs[0]?.id, "camp_123:npc:npc_guide");
  assert.equal(instancedWorld.npcs[0]?.currentLocationId, "camp_123:location:loc_gate");
  assert.equal(instancedWorld.information[0]?.sourceNpcId, "camp_123:npc:npc_guide");
  assert.equal(instancedWorld.marketPrices[0]?.factionId, "camp_123:faction:fac_watch");
  assert.equal("justificationForNode" in (instancedWorld.locations[0] ?? {}), false);
  assert.equal(entryPoint.startLocationId, "camp_123:location:loc_gate");
  assert.deepEqual(entryPoint.presentNpcIds, ["camp_123:npc:npc_guide"]);
  assert.deepEqual(entryPoint.initialInformationIds, ["camp_123:information:info_watch"]);
});

test("instanceWorldForCampaign appends custom resolved entries without mutating stock entry count", () => {
  const world = createWorld();
  const customEntryPoint: ResolvedLaunchEntry = {
    id: "custom_entry_1",
    title: "Quiet Arrival",
    summary: "Slip through the checkpoint under borrowed papers.",
    startLocationId: "loc_gate",
    presentNpcIds: ["npc_guide"],
    initialInformationIds: ["info_watch"],
    immediatePressure: "Inspectors are beginning a surprise review.",
    publicLead: "The guide is already signaling for a quick word.",
    localContactNpcId: "npc_guide",
    localContactTemporaryActorLabel: null,
    temporaryLocalActors: [],
    mundaneActionPath: "Blend into the line and speak with the guide.",
    evidenceWorldAlreadyMoving: "The gate district is already in motion.",
    isCustom: true,
    customRequestPrompt: "I want to slip in as a courier.",
  };

  const { world: instancedWorld, entryPoint } = instanceWorldForCampaign(
    "camp_custom",
    world,
    customEntryPoint,
  );

  assert.equal(world.entryPoints.length, 1);
  assert.equal(instancedWorld.entryPoints.length, 2);
  assert.equal(instancedWorld.entryPoints[1]?.id, "custom_entry_1");
  assert.equal(entryPoint.localContactNpcId, "camp_custom:npc:npc_guide");
});
