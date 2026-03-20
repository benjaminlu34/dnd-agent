import assert from "node:assert/strict";
import test from "node:test";
import type { GeneratedWorldModule } from "./types";
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
  const { world, entryPoint } = instanceWorldForCampaign("camp_123", createWorld(), "entry_gate");

  assert.equal(world.locations[0]?.id, "camp_123:location:loc_gate");
  assert.equal(world.locations[0]?.controllingFactionId, "camp_123:faction:fac_watch");
  assert.equal(world.npcs[0]?.id, "camp_123:npc:npc_guide");
  assert.equal(world.npcs[0]?.currentLocationId, "camp_123:location:loc_gate");
  assert.equal(world.information[0]?.sourceNpcId, "camp_123:npc:npc_guide");
  assert.equal(world.marketPrices[0]?.factionId, "camp_123:faction:fac_watch");
  assert.equal(entryPoint.startLocationId, "camp_123:location:loc_gate");
  assert.deepEqual(entryPoint.presentNpcIds, ["camp_123:npc:npc_guide"]);
  assert.deepEqual(entryPoint.initialInformationIds, ["camp_123:information:info_watch"]);
});
