import assert from "node:assert/strict";
import test from "node:test";
import type { GeneratedWorldModule } from "./types";
import {
  validateWorldModuleCoherence,
  validateWorldModulePlayability,
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

test("world module coherence accepts a connected valid graph", () => {
  const report = validateWorldModuleCoherence(createWorld());
  assert.equal(report.ok, true);
  assert.deepEqual(report.issues, []);
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
