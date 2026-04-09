import assert from "node:assert/strict";
import test from "node:test";
import type {
  DescendedRegionBundle,
  DescendedRegionManifest,
  DescendedWorldTravelBundle,
  GeneratedWorldModule,
} from "./types";
import {
  assertManifestCoverage,
  assertWorldRegionGraphConsistency,
  buildRegionSelectionOptions,
  buildWorldRegionCandidates,
  toInterRegionCorridorSemanticKey,
  toRegionSemanticKey,
} from "./world-descent";

function createWorldModule(): GeneratedWorldModule {
  return {
    title: "Vethara Basin",
    premise: "A river basin under toll, convoy, and imperial pressure.",
    tone: "Pressed and watchful",
    setting: "A contested basin world",
    locations: [
      {
        id: "loc_vethmark",
        name: "Vethmark Basin",
        type: "region",
        summary: "The toll-heavy basin heartland.",
        description: "The basin heartland anchored by Vethmark's bridge economy.",
        state: "active",
        locationKind: "spine",
        parentLocationId: null,
        discoveryState: "revealed",
        controllingFactionId: null,
        tags: ["trade"],
      },
      {
        id: "loc_cinderpass",
        name: "Cinderpass Approach",
        type: "region",
        summary: "The eastern convoy road and pass approaches.",
        description: "The eastern convoy road and garrisoned mountain approach.",
        state: "active",
        locationKind: "spine",
        parentLocationId: null,
        discoveryState: "revealed",
        controllingFactionId: null,
        tags: ["road"],
      },
      {
        id: "loc_marshend",
        name: "Marshend Reaches",
        type: "region",
        summary: "The western marsh territory.",
        description: "The western marshes where tide records and pilot routes matter.",
        state: "active",
        locationKind: "spine",
        parentLocationId: null,
        discoveryState: "revealed",
        controllingFactionId: null,
        tags: ["marsh"],
      },
    ],
    edges: [
      {
        id: "edge_1",
        sourceId: "loc_vethmark",
        targetId: "loc_cinderpass",
        travelTimeMinutes: 120,
        dangerLevel: 3,
        currentStatus: "open",
        visibility: "public",
        accessRequirementText: null,
        description: "The main convoy road east.",
      },
      {
        id: "edge_2",
        sourceId: "loc_vethmark",
        targetId: "loc_marshend",
        travelTimeMinutes: 150,
        dangerLevel: 2,
        currentStatus: "open",
        visibility: "public",
        accessRequirementText: null,
        description: "The river route west toward the marshes.",
      },
    ],
    factions: [],
    factionRelations: [],
    npcs: [],
    information: [],
    informationLinks: [],
    commodities: [],
    marketPrices: [],
    entryPoints: [],
  };
}

test("buildWorldRegionCandidates derives stable semantic keys and adjacency from world locations", () => {
  const candidates = buildWorldRegionCandidates(createWorldModule());

  assert.deepEqual(
    candidates.map((candidate) => candidate.semanticKey),
    [
      "region:loc_vethmark",
      "region:loc_cinderpass",
      "region:loc_marshend",
    ],
  );
  assert.deepEqual(
    candidates.find((candidate) => candidate.semanticKey === "region:loc_vethmark")?.adjacentRegionSemanticKeys,
    ["region:loc_cinderpass", "region:loc_marshend"],
  );
});

test("buildRegionSelectionOptions exposes region summaries without launch-entry data", () => {
  const options = buildRegionSelectionOptions(createWorldModule());

  assert.deepEqual(options, [
    {
      semanticKey: "region:loc_vethmark",
      name: "Vethmark Basin",
      summary: "The toll-heavy basin heartland.",
    },
    {
      semanticKey: "region:loc_cinderpass",
      name: "Cinderpass Approach",
      summary: "The eastern convoy road and pass approaches.",
    },
    {
      semanticKey: "region:loc_marshend",
      name: "Marshend Reaches",
      summary: "The western marsh territory.",
    },
  ]);
});

test("world descent semantic key helpers preserve source ids in a deterministic way", () => {
  assert.equal(toRegionSemanticKey("loc_vethmark"), "region:loc_vethmark");
  assert.equal(
    toInterRegionCorridorSemanticKey("edge_1"),
    "inter_region_corridor:edge_1",
  );
});

function createLaunchManifest(): DescendedRegionManifest {
  return {
    regionSemanticKey: "region:loc_vethmark",
    canonicalWorldLocationId: "loc_vethmark",
    name: "Vethmark Basin",
    summary: "The basin heartland.",
    description: "A tightly managed basin full of toll stations.",
    inheritedWorldReferences: ["bridge tariffs", "convoy watch"],
    preloadEligible: true,
    settlementManifests: [
      {
        settlementSemanticKey: "settlement:veth_bridge",
        parentRegionSemanticKey: "region:loc_vethmark",
        name: "Veth Bridge",
        type: "city",
        summary: "A bridge city under tariff pressure.",
        description: "A bridge city where toll booths set the public rhythm.",
        arrivalCorridorSemanticKeys: ["corridor:road_to_bridge"],
        egressCorridorSemanticKeys: ["corridor:road_to_bridge", "corridor:bridge_to_reed"],
        downstreamShellPrerequisites: ["market square", "south gate"],
        preloadPriority: "critical",
      },
      {
        settlementSemanticKey: "settlement:reed_market",
        parentRegionSemanticKey: "region:loc_vethmark",
        name: "Reed Market",
        type: "town",
        summary: "A river-market town on the basin edge.",
        description: "A river-market town where pilots and ferrymen swap news.",
        arrivalCorridorSemanticKeys: ["corridor:bridge_to_reed"],
        egressCorridorSemanticKeys: ["corridor:bridge_to_reed"],
        downstreamShellPrerequisites: ["canal dock"],
        preloadPriority: "nearby",
      },
    ],
    hiddenDestinationManifests: [
      {
        destinationSemanticKey: "destination:toll_archive",
        parentRegionSemanticKey: "region:loc_vethmark",
        name: "Toll Archive",
        type: "archive",
        summary: "A sealed archive of tariff ledgers.",
        description: "A sealed archive where missing ledgers can rewrite who owes what.",
        hidden: true,
        discoverabilityHooks: ["ledger rumor"],
      },
    ],
    intraRegionCorridorIndex: [
      {
        corridorSemanticKey: "corridor:road_to_bridge",
        sourceSemanticKey: "region:loc_vethmark",
        targetSemanticKey: "settlement:veth_bridge",
        baseClass: "routine_route",
        modifiers: [],
      },
      {
        corridorSemanticKey: "corridor:bridge_to_reed",
        sourceSemanticKey: "settlement:veth_bridge",
        targetSemanticKey: "settlement:reed_market",
        baseClass: "routine_route",
        modifiers: [],
      },
    ],
  };
}

function createLaunchBundle(): DescendedRegionBundle {
  const manifest = createLaunchManifest();
  return {
    ...manifest,
    worldPressureSummary: "Tariffs tighten as convoy inspections intensify.",
    regionalDiscoverabilityHooks: ["missing ledger", "delayed convoy"],
    corridorPacks: [
      {
        corridorSemanticKey: "corridor:road_to_bridge",
        sourceSemanticKey: "region:loc_vethmark",
        targetSemanticKey: "settlement:veth_bridge",
        sourceLabel: "Basin Road",
        targetLabel: "Veth Bridge",
        baseClass: "routine_route",
        modifiers: [],
        travelTimeMinutes: 45,
        dangerLevel: 2,
        currentStatus: "open",
        description: "A patrolled road into the bridge city.",
        pressureSummary: "Inspectors stop suspicious carts.",
        interruptionCandidates: ["tariff checkpoint"],
        refugeSummaries: ["an empty ferry shed"],
        hiddenOpportunitySummaries: ["an overlooked scribe shift"],
        nextAnchorSemanticKey: "settlement:veth_bridge",
        fallbackAnchorSemanticKey: "region:loc_vethmark",
      },
      {
        corridorSemanticKey: "corridor:bridge_to_reed",
        sourceSemanticKey: "settlement:veth_bridge",
        targetSemanticKey: "settlement:reed_market",
        sourceLabel: "Bridge Gate",
        targetLabel: "Reed Market",
        baseClass: "routine_route",
        modifiers: [],
        travelTimeMinutes: 30,
        dangerLevel: 1,
        currentStatus: "open",
        description: "A towpath lined with market traffic.",
        pressureSummary: "Pilots gossip about late convoys.",
        interruptionCandidates: ["towpath dispute"],
        refugeSummaries: ["an abandoned warehouse"],
        hiddenOpportunitySummaries: ["a ferryman shortcut"],
        nextAnchorSemanticKey: "settlement:reed_market",
        fallbackAnchorSemanticKey: "settlement:veth_bridge",
      },
    ],
    downstreamLaunchability: {
      settlementManifestCount: manifest.settlementManifests.length,
      corridorPackCount: 2,
      hiddenDestinationCount: manifest.hiddenDestinationManifests.length,
      readyForSettlementDescent: true,
    },
  };
}

function createWorldTravelBundles(): DescendedWorldTravelBundle[] {
  return [
    {
      corridorSemanticKey: "inter_region_corridor:edge_1",
      sourceRegionSemanticKey: "region:loc_vethmark",
      targetRegionSemanticKey: "region:loc_cinderpass",
      baseClass: "journey_route",
      modifiers: [],
      travelTimeMinutes: 120,
      dangerLevel: 3,
      currentStatus: "open",
      description: "The main convoy road east.",
      macroJourneyPressure: "Convoys are being searched at random.",
      interruptionCandidates: ["imperial search"],
      refugeSummaries: ["a dry watchtower"],
      nextAnchorSemanticKey: "region:loc_cinderpass",
      fallbackAnchorSemanticKey: "region:loc_vethmark",
    },
    {
      corridorSemanticKey: "inter_region_corridor:edge_2",
      sourceRegionSemanticKey: "region:loc_vethmark",
      targetRegionSemanticKey: "region:loc_marshend",
      baseClass: "journey_route",
      modifiers: ["seasonal"],
      travelTimeMinutes: 150,
      dangerLevel: 2,
      currentStatus: "open",
      description: "The river route west toward the marshes.",
      macroJourneyPressure: "Water levels are shifting daily.",
      interruptionCandidates: ["washed-out ford"],
      refugeSummaries: ["a pilot shelter"],
      nextAnchorSemanticKey: "region:loc_marshend",
      fallbackAnchorSemanticKey: "region:loc_vethmark",
    },
  ];
}

function createWorldTravelSkeleton() {
  return [
    {
      corridorSemanticKey: "inter_region_corridor:edge_1",
      edgeId: "edge_1",
      sourceRegionSemanticKey: "region:loc_vethmark",
      targetRegionSemanticKey: "region:loc_cinderpass",
      sourceRegionName: "Vethmark Basin",
      targetRegionName: "Cinderpass Approach",
      travelTimeMinutes: 120,
      dangerLevel: 3,
      currentStatus: "open",
      description: "The main convoy road east.",
    },
    {
      corridorSemanticKey: "inter_region_corridor:edge_2",
      edgeId: "edge_2",
      sourceRegionSemanticKey: "region:loc_vethmark",
      targetRegionSemanticKey: "region:loc_marshend",
      sourceRegionName: "Vethmark Basin",
      targetRegionName: "Marshend Reaches",
      travelTimeMinutes: 150,
      dangerLevel: 2,
      currentStatus: "open",
      description: "The river route west toward the marshes.",
    },
  ];
}

test("assertWorldRegionGraphConsistency rejects launch bundles that leak child ownership into another region", () => {
  const world = createWorldModule();
  const worldRegions = buildWorldRegionCandidates(world);
  const launchRegion = worldRegions[0];
  const launchManifest = createLaunchManifest();
  const launchBundle = createLaunchBundle();
  launchBundle.settlementManifests[0] = {
    ...launchBundle.settlementManifests[0],
    parentRegionSemanticKey: "region:loc_cinderpass",
  };

  assert.throws(
    () =>
      assertWorldRegionGraphConsistency({
        launchRegion,
        launchManifest,
        launchBundle,
        worldTravelSkeleton: createWorldTravelSkeleton(),
        worldTravelBundles: createWorldTravelBundles(),
      }),
    /must belong to launch region/,
  );
});

test("assertWorldRegionGraphConsistency rejects launch bundles that leave a settlement without its corridor pack", () => {
  const world = createWorldModule();
  const launchRegion = buildWorldRegionCandidates(world)[0];
  const launchManifest = createLaunchManifest();
  const launchBundle = createLaunchBundle();
  launchBundle.corridorPacks = launchBundle.corridorPacks.slice(1);
  launchBundle.downstreamLaunchability.corridorPackCount = 1;

  assert.throws(
    () =>
      assertWorldRegionGraphConsistency({
        launchRegion,
        launchManifest,
        launchBundle,
        worldTravelSkeleton: createWorldTravelSkeleton(),
        worldTravelBundles: createWorldTravelBundles(),
      }),
    /corridor keys mismatch|missing arrival corridor bundle/,
  );
});

test("assertWorldRegionGraphConsistency rejects duplicate corridor semantic keys before persistence", () => {
  const world = createWorldModule();
  const launchRegion = buildWorldRegionCandidates(world)[0];
  const launchManifest = createLaunchManifest();
  const launchBundle = createLaunchBundle();
  launchBundle.corridorPacks[1] = {
    ...launchBundle.corridorPacks[1],
    corridorSemanticKey: "corridor:road_to_bridge",
  };

  assert.throws(
    () =>
      assertWorldRegionGraphConsistency({
        launchRegion,
        launchManifest,
        launchBundle,
        worldTravelSkeleton: createWorldTravelSkeleton(),
        worldTravelBundles: createWorldTravelBundles(),
      }),
    /duplicate semantic keys|corridor keys mismatch/,
  );
});

test("assertWorldRegionGraphConsistency rejects location semantic key collisions across child namespaces", () => {
  const world = createWorldModule();
  const worldRegions = buildWorldRegionCandidates(world);
  const launchRegion = worldRegions[0];
  const launchManifest = createLaunchManifest();
  launchManifest.hiddenDestinationManifests[0] = {
    ...launchManifest.hiddenDestinationManifests[0],
    destinationSemanticKey: "region:loc_cinderpass",
  };
  const launchBundle = createLaunchBundle();
  launchBundle.hiddenDestinationManifests[0] = {
    ...launchBundle.hiddenDestinationManifests[0],
    destinationSemanticKey: "region:loc_cinderpass",
  };

  assert.throws(
    () =>
      assertWorldRegionGraphConsistency({
        launchRegion,
        launchManifest,
        launchBundle,
        worldTravelSkeleton: createWorldTravelSkeleton(),
        worldTravelBundles: createWorldTravelBundles(),
        allWorldRegionSemanticKeys: worldRegions.map((region) => region.semanticKey),
      }),
    /Persisted location semantic keys contained duplicate semantic keys/,
  );
});

test("assertWorldRegionGraphConsistency rejects edge semantic key collisions across world and regional corridors", () => {
  const world = createWorldModule();
  const launchRegion = buildWorldRegionCandidates(world)[0];
  const launchManifest = createLaunchManifest();
  launchManifest.intraRegionCorridorIndex[0] = {
    ...launchManifest.intraRegionCorridorIndex[0],
    corridorSemanticKey: "inter_region_corridor:edge_remote",
  };
  launchManifest.settlementManifests[0] = {
    ...launchManifest.settlementManifests[0],
    arrivalCorridorSemanticKeys: ["inter_region_corridor:edge_remote"],
    egressCorridorSemanticKeys: ["inter_region_corridor:edge_remote", "corridor:bridge_to_reed"],
  };
  const launchBundle = createLaunchBundle();
  launchBundle.settlementManifests[0] = {
    ...launchBundle.settlementManifests[0],
    arrivalCorridorSemanticKeys: ["inter_region_corridor:edge_remote"],
    egressCorridorSemanticKeys: ["inter_region_corridor:edge_remote", "corridor:bridge_to_reed"],
  };
  launchBundle.corridorPacks[0] = {
    ...launchBundle.corridorPacks[0],
    corridorSemanticKey: "inter_region_corridor:edge_remote",
  };

  assert.throws(
    () =>
      assertWorldRegionGraphConsistency({
        launchRegion,
        launchManifest,
        launchBundle,
        worldTravelSkeleton: createWorldTravelSkeleton(),
        worldTravelBundles: createWorldTravelBundles(),
        allWorldEdgeSemanticKeys: [
          "inter_region_corridor:edge_1",
          "inter_region_corridor:edge_2",
          "inter_region_corridor:edge_remote",
        ],
      }),
    /Persisted world-region edges contained duplicate semantic keys/,
  );
});

test("assertWorldRegionGraphConsistency rejects corridor packs omitted from settlement metadata", () => {
  const world = createWorldModule();
  const launchRegion = buildWorldRegionCandidates(world)[0];
  const launchManifest = createLaunchManifest();
  const launchBundle = createLaunchBundle();
  launchBundle.settlementManifests[1] = {
    ...launchBundle.settlementManifests[1],
    arrivalCorridorSemanticKeys: [],
  };

  assert.throws(
    () =>
      assertWorldRegionGraphConsistency({
        launchRegion,
        launchManifest,
        launchBundle,
        worldTravelSkeleton: createWorldTravelSkeleton(),
        worldTravelBundles: createWorldTravelBundles(),
      }),
    /did not list arrival corridor/,
  );
});

test("assertWorldRegionGraphConsistency rejects world travel bundles that drift from canonical edge data", () => {
  const world = createWorldModule();
  const launchRegion = buildWorldRegionCandidates(world)[0];
  const launchManifest = createLaunchManifest();
  const launchBundle = createLaunchBundle();
  const worldTravelBundles = createWorldTravelBundles();
  worldTravelBundles[0] = {
    ...worldTravelBundles[0],
    travelTimeMinutes: 999,
  };

  assert.throws(
    () =>
      assertWorldRegionGraphConsistency({
        launchRegion,
        launchManifest,
        launchBundle,
        worldTravelSkeleton: createWorldTravelSkeleton(),
        worldTravelBundles,
      }),
    /drifted from canonical world-edge travel data/,
  );
});

test("assertWorldRegionGraphConsistency rejects launch bundle corridors that drift from the manifest corridor index", () => {
  const world = createWorldModule();
  const launchRegion = buildWorldRegionCandidates(world)[0];
  const launchManifest = createLaunchManifest();
  const launchBundle = createLaunchBundle();
  launchBundle.corridorPacks[0] = {
    ...launchBundle.corridorPacks[0],
    targetSemanticKey: "settlement:reed_market",
  };

  assert.throws(
    () =>
      assertWorldRegionGraphConsistency({
        launchRegion,
        launchManifest,
        launchBundle,
        worldTravelSkeleton: createWorldTravelSkeleton(),
        worldTravelBundles: createWorldTravelBundles(),
      }),
    /did not match the launch manifest corridor index/,
  );
});

test("assertManifestCoverage rejects manifests whose canonical world location drifts from the selected region", () => {
  const world = createWorldModule();
  const worldRegions = buildWorldRegionCandidates(world);
  const launchManifest = createLaunchManifest();
  launchManifest.canonicalWorldLocationId = "loc_cinderpass";
  const siblingManifests: DescendedRegionManifest[] = [
    {
      ...createLaunchManifest(),
      regionSemanticKey: "region:loc_cinderpass",
      canonicalWorldLocationId: "loc_cinderpass",
      name: "Cinderpass Approach",
    },
    {
      ...createLaunchManifest(),
      regionSemanticKey: "region:loc_marshend",
      canonicalWorldLocationId: "loc_marshend",
      name: "Marshend Reaches",
    },
  ];

  assert.throws(
    () => assertManifestCoverage(worldRegions, [launchManifest, ...siblingManifests], "region:loc_vethmark"),
    /canonical world location/,
  );
});
