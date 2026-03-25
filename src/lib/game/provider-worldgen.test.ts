import assert from "node:assert/strict";
import test from "node:test";
import { aiProviderTestUtils } from "../ai/provider";
import { generatedSocialLayerInputSchema } from "./session-zero";

test("normalizeSocialCastInput dedupes and clamps social ties so schema-sized overflows recover", () => {
  const normalized = aiProviderTestUtils.normalizeSocialCastInput(
    {
      npcs: [
        {
          name: "Thalos Stormrider",
          role: "Wild Magic Scholar",
          summary: "A mage obsessed with studying chaotic ruins.",
          description: "He camps in a shattered observatory and records every surge.",
          factionId: "fac_red_wizards_of_thay",
          currentLocationId: "loc_blackmoor_ruins_of_power",
          approval: 0,
          isCompanion: false,
          currentConcern: "Another surge is about to tear through his camp.",
          playerCrossPath: "He needs porters and witnesses before the next collapse.",
          ties: {
            locationIds: [
              "loc_blackmoor_ruins_of_power",
              "loc_blackmoor_ruins_of_power",
              "loc_icewind_dale_icewind_pass",
            ],
            factionIds: [
              "fac_red_wizards_of_thay",
              "fac_red_wizards_of_thay",
              "fac_harper_network",
            ],
            economyHooks: "wild magic research; artifact salvage; artifact salvage",
            informationHooks:
              "ancient magic; wild magic surges; Blackmoor ruins; wild magic surges",
          },
          importance: "local",
          bridgeLocationIds:
            "loc_cormanthyr_whispering_woods, loc_icewind_dale_icewind_pass, loc_cormanthyr_whispering_woods",
          bridgeFactionIds: [
            "fac_red_wizards_of_thay",
            "fac_red_wizards_of_thay",
            "fac_harper_network",
          ],
        },
      ],
    },
    1,
  );

  const parsed = generatedSocialLayerInputSchema.safeParse(normalized);
  assert.equal(parsed.success, true);

  if (!parsed.success) {
    return;
  }

  assert.deepEqual(parsed.data.npcs[0].ties.locationIds, [
    "loc_blackmoor_ruins_of_power",
    "loc_icewind_dale_icewind_pass",
  ]);
  assert.deepEqual(parsed.data.npcs[0].ties.factionIds, [
    "fac_red_wizards_of_thay",
    "fac_harper_network",
  ]);
  assert.deepEqual(parsed.data.npcs[0].ties.economyHooks, [
    "wild magic research",
    "artifact salvage",
  ]);
  assert.deepEqual(parsed.data.npcs[0].ties.informationHooks, [
    "ancient magic",
    "wild magic surges",
  ]);
  assert.deepEqual(parsed.data.npcs[0].bridgeLocationIds, [
    "loc_cormanthyr_whispering_woods",
    "loc_icewind_dale_icewind_pass",
  ]);
  assert.deepEqual(parsed.data.npcs[0].bridgeFactionIds, [
    "fac_red_wizards_of_thay",
    "fac_harper_network",
  ]);
});

test("normalizeSchedulePayloadIds upgrades bare payload ids to campaign-scoped ids", () => {
  const normalized = aiProviderTestUtils.normalizeSchedulePayloadIds(
    {
      faction: "fac_waterdeep_authorities",
      targetNpcId: "npc_captain_thorne_waterdeep",
      informationId: "info_waterdeep_guild_rivalries",
      nested: {
        locationId: "loc_waterdeep",
      },
      untouched: "market_day",
    },
    {
      locations: new Map([["loc_waterdeep", "camp_123:location:loc_waterdeep"]]),
      factions: new Map([["fac_waterdeep_authorities", "camp_123:faction:fac_waterdeep_authorities"]]),
      npcs: new Map([["npc_captain_thorne_waterdeep", "camp_123:npc:npc_captain_thorne_waterdeep"]]),
      information: new Map([["info_waterdeep_guild_rivalries", "camp_123:information:info_waterdeep_guild_rivalries"]]),
    },
  ) as Record<string, unknown>;

  assert.deepEqual(normalized, {
    faction: "camp_123:faction:fac_waterdeep_authorities",
    targetNpcId: "camp_123:npc:npc_captain_thorne_waterdeep",
    informationId: "camp_123:information:info_waterdeep_guild_rivalries",
    nested: {
      locationId: "camp_123:location:loc_waterdeep",
    },
    untouched: "market_day",
  });
});
