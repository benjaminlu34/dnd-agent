import OpenAI from "openai";
import { env } from "@/lib/env";
import { characterTemplateDraftSchema } from "@/lib/game/characters";
import { generatedCampaignOpeningSchema, generatedWorldModuleSchema } from "@/lib/game/session-zero";
import type {
  CampaignCharacter,
  CharacterTemplate,
  CharacterTemplateDraft,
  ExecuteConverseToolCall,
  ExecuteFreeformToolCall,
  ExecuteInvestigateToolCall,
  ExecuteObserveToolCall,
  ExecuteTravelToolCall,
  ExecuteWaitToolCall,
  GeneratedCampaignOpening,
  GeneratedWorldModule,
  OpenWorldEntryPoint,
  SpatialPromptContext,
  Stat,
  TurnActionToolCall,
} from "@/lib/game/types";
import { slugify } from "@/lib/utils";
import {
  validateWorldModuleCoherence,
  validateWorldModulePlayability,
} from "@/lib/game/world-validation";

type CampaignOpeningInput = {
  module: GeneratedWorldModule;
  character: CharacterTemplate;
  entryPoint: OpenWorldEntryPoint;
  prompt?: string;
  previousDraft?: GeneratedCampaignOpening;
};

type TurnInput = {
  promptContext: SpatialPromptContext;
  character: CampaignCharacter;
  playerAction: string;
};

function toFunctionTool(tool: {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}) {
  return {
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema,
    },
  };
}

function safeParseJson(value: unknown): unknown {
  if (typeof value !== "string") {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    const firstBrace = value.indexOf("{");
    const lastBrace = value.lastIndexOf("}");

    if (firstBrace >= 0 && lastBrace > firstBrace) {
      try {
        return JSON.parse(value.slice(firstBrace, lastBrace + 1));
      } catch {
        return null;
      }
    }
  }

  return null;
}

function createClient() {
  if (!env.openRouterApiKey) {
    return null;
  }

  return new OpenAI({
    apiKey: env.openRouterApiKey,
    baseURL: "https://openrouter.ai/api/v1",
    defaultHeaders: {
      "HTTP-Referer": env.appUrl,
      "X-Title": env.openRouterSiteName,
    },
  });
}

function inferStatFromText(action: string): Stat {
  const text = action.toLowerCase();
  if (/(convince|persuade|bluff|charm|threaten|negotiate|talk)/.test(text)) return "charisma";
  if (/(study|analyze|decipher|research|deduce|investigate)/.test(text)) return "intelligence";
  if (/(listen|watch|observe|sense|notice|track|spot)/.test(text)) return "wisdom";
  if (/(sneak|slip|climb|dodge|pick|steal|balance)/.test(text)) return "dexterity";
  if (/(endure|brace|march|push through|withstand)/.test(text)) return "constitution";
  return "strength";
}

function summarizeWorld(module: GeneratedWorldModule) {
  return {
    title: module.title,
    premise: module.premise,
    tone: module.tone,
    setting: module.setting,
    locations: module.locations.map((location) => ({
      id: location.id,
      name: location.name,
      type: location.type,
      state: location.state,
      summary: location.summary,
    })),
    factions: module.factions.map((faction) => ({
      id: faction.id,
      name: faction.name,
      type: faction.type,
      agenda: faction.agenda,
    })),
    entryPoints: module.entryPoints,
  };
}

function buildFallbackWorldModule(prompt: string): GeneratedWorldModule {
  const topic = prompt.trim() || "Shifting Frontiers";
  const slug = slugify(topic).slice(0, 24) || "shifting-frontiers";
  const title = topic.split(/[.!?]/)[0]?.trim().slice(0, 64) || "Shifting Frontiers";

  const locations = [
    {
      id: `loc_${slug}_gate`,
      name: "Ash Gate",
      type: "district",
      summary: "The wind-beaten outer gate where strangers arrive under watch.",
      description: "A black-stone gate district where guards, pilgrims, and brokers size up every arrival.",
      state: "active",
      controllingFactionId: `fac_${slug}_watch`,
      tags: ["arrival", "watch", "trade"],
    },
    {
      id: `loc_${slug}_market`,
      name: "Lantern Market",
      type: "market",
      summary: "A crowded night market where rumors trade hands as often as goods.",
      description: "Strings of oil lamps throw gold across stalls loaded with contraband, spices, and false papers.",
      state: "active",
      controllingFactionId: `fac_${slug}_guild`,
      tags: ["commerce", "rumors", "crowds"],
    },
    {
      id: `loc_${slug}_shrine`,
      name: "Salt Shrine",
      type: "shrine",
      summary: "A hushed sanctuary where oaths and secrets are both expensive.",
      description: "A tide-worn shrine wrapped in braziers and whispered vows, watched by hard-eyed attendants.",
      state: "active",
      controllingFactionId: null,
      tags: ["faith", "oaths", "secrets"],
    },
    {
      id: `loc_${slug}_docks`,
      name: "Blackwater Docks",
      type: "docks",
      summary: "Smugglers, ferrymen, and inspectors collide along rotten piers.",
      description: "Tar, gulls, and brine fill a dockside maze where cargo moves faster than paperwork.",
      state: "contested",
      controllingFactionId: `fac_${slug}_smugglers`,
      tags: ["travel", "smuggling", "violence"],
    },
    {
      id: `loc_${slug}_keep`,
      name: "Cinder Keep",
      type: "stronghold",
      summary: "The seat of brittle order, looking down on a city slipping loose.",
      description: "A severe keep of black basalt where commanders argue over threats they no longer fully control.",
      state: "active",
      controllingFactionId: `fac_${slug}_watch`,
      tags: ["power", "military", "command"],
    },
  ];

  const edges = [
    {
      id: `edge_${slug}_gate_market`,
      sourceId: locations[0].id,
      targetId: locations[1].id,
      travelTimeMinutes: 15,
      dangerLevel: 2,
      currentStatus: "open",
      description: "A busy road patrolled by anxious watchmen.",
    },
    {
      id: `edge_${slug}_market_shrine`,
      sourceId: locations[1].id,
      targetId: locations[2].id,
      travelTimeMinutes: 10,
      dangerLevel: 1,
      currentStatus: "open",
      description: "A cramped lane lit by prayer lamps.",
    },
    {
      id: `edge_${slug}_market_docks`,
      sourceId: locations[1].id,
      targetId: locations[3].id,
      travelTimeMinutes: 20,
      dangerLevel: 3,
      currentStatus: "contested",
      description: "A canal-side route stalked by thieves and inspectors.",
    },
    {
      id: `edge_${slug}_gate_keep`,
      sourceId: locations[0].id,
      targetId: locations[4].id,
      travelTimeMinutes: 18,
      dangerLevel: 2,
      currentStatus: "open",
      description: "A steep rise lined with signal braziers.",
    },
    {
      id: `edge_${slug}_keep_market`,
      sourceId: locations[4].id,
      targetId: locations[1].id,
      travelTimeMinutes: 12,
      dangerLevel: 1,
      currentStatus: "open",
      description: "A broad stair descending into the city center.",
    },
    {
      id: `edge_${slug}_shrine_docks`,
      sourceId: locations[2].id,
      targetId: locations[3].id,
      travelTimeMinutes: 14,
      dangerLevel: 2,
      currentStatus: "open",
      description: "A salt-slick alley running down toward the harbor.",
    },
  ];

  const factions = [
    {
      id: `fac_${slug}_watch`,
      name: "Cinder Watch",
      type: "military",
      summary: "A strained city watch clinging to authority.",
      agenda: "Hold the city together long enough to identify who is undermining the defenses.",
      resources: { gold: 6, military: 8, influence: 7, information: 4 },
      pressureClock: 4,
    },
    {
      id: `fac_${slug}_guild`,
      name: "Lantern Guild",
      type: "mercantile",
      summary: "A trade consortium that treats stability as a negotiable commodity.",
      agenda: "Keep routes open and profit from whichever side can still pay.",
      resources: { gold: 9, military: 2, influence: 8, information: 6 },
      pressureClock: 3,
    },
    {
      id: `fac_${slug}_smugglers`,
      name: "Blackwake Syndicate",
      type: "criminal",
      summary: "Dockside operators turning civic weakness into leverage.",
      agenda: "Expand control of harbor traffic before the watch can regroup.",
      resources: { gold: 7, military: 5, influence: 5, information: 8 },
      pressureClock: 5,
    },
  ];

  const factionRelations = [
    {
      id: `rel_${slug}_watch_guild`,
      factionAId: factions[0].id,
      factionBId: factions[1].id,
      stance: "neutral" as const,
    },
    {
      id: `rel_${slug}_watch_smugglers`,
      factionAId: factions[0].id,
      factionBId: factions[2].id,
      stance: "war" as const,
    },
    {
      id: `rel_${slug}_guild_smugglers`,
      factionAId: factions[1].id,
      factionBId: factions[2].id,
      stance: "rival" as const,
    },
  ];

  const npcs = [
    {
      id: `npc_${slug}_captain`,
      name: "Captain Mirel Voss",
      role: "watch commander",
      summary: "A disciplined officer short on sleep and allies.",
      description: "Mirel carries authority like armor, but exhaustion shows in every clipped order.",
      factionId: factions[0].id,
      currentLocationId: locations[4].id,
      approval: 0,
      isCompanion: false,
    },
    {
      id: `npc_${slug}_broker`,
      name: "Sela Thorn",
      role: "market broker",
      summary: "A smooth fixer who always knows who is buying fear.",
      description: "Sela smiles easily, but the smile never reaches her careful eyes.",
      factionId: factions[1].id,
      currentLocationId: locations[1].id,
      approval: 1,
      isCompanion: false,
    },
    {
      id: `npc_${slug}_pilot`,
      name: "Nox Ferran",
      role: "smuggler pilot",
      summary: "A river pilot with friends on every forbidden route.",
      description: "Nox speaks like every sentence is an offer that could turn into a threat.",
      factionId: factions[2].id,
      currentLocationId: locations[3].id,
      approval: -1,
      isCompanion: false,
    },
    {
      id: `npc_${slug}_keeper`,
      name: "Sister Halve",
      role: "shrine keeper",
      summary: "A calm witness who hears more vows than confessions.",
      description: "Halve has the stillness of someone who already knows the worst version of every story.",
      factionId: null,
      currentLocationId: locations[2].id,
      approval: 0,
      isCompanion: false,
    },
    {
      id: `npc_${slug}_guide`,
      name: "Tarin Ash",
      role: "local guide",
      summary: "A quick-footed operator who can get strangers moving before the city closes around them.",
      description: "Tarin reads street tension like a sailor reads weather and talks just fast enough to stay useful.",
      factionId: null,
      currentLocationId: locations[0].id,
      approval: 2,
      isCompanion: true,
    },
  ];

  const information = [
    {
      id: `info_${slug}_cargo`,
      title: "Unlogged cargo is moving through Blackwater Docks",
      summary: "The harbor is moving sealed cargo beyond the watch ledger.",
      content: "Crates marked as lamp oil are leaving the docks under false seals and disappearing before dawn.",
      truthfulness: "true" as const,
      accessibility: "public" as const,
      locationId: locations[3].id,
      factionId: factions[2].id,
      sourceNpcId: npcs[2].id,
    },
    {
      id: `info_${slug}_watch`,
      title: "The Cinder Watch is stretched thin",
      summary: "The watch is reacting instead of controlling events.",
      content: "Half the watch is tied to perimeter duty and the rest are chasing rumors they cannot verify fast enough.",
      truthfulness: "true" as const,
      accessibility: "public" as const,
      locationId: locations[0].id,
      factionId: factions[0].id,
      sourceNpcId: npcs[0].id,
    },
    {
      id: `info_${slug}_bribe`,
      title: "Someone inside the market is bribing inspectors",
      summary: "A merchant-side operator is shielding contraband routes.",
      content: "Inspection logs are being altered before they ever reach the keep, and the pattern traces back toward Lantern Market.",
      truthfulness: "partial" as const,
      accessibility: "guarded" as const,
      locationId: locations[1].id,
      factionId: factions[1].id,
      sourceNpcId: npcs[1].id,
    },
    {
      id: `info_${slug}_oath`,
      title: "A broken oath ties the shrine to the harbor unrest",
      summary: "The shrine is sitting on a promise that now threatens the whole district.",
      content: "A dockside patron swore sanctuary terms at the shrine and broke them within the week, setting off a hidden feud.",
      truthfulness: "true" as const,
      accessibility: "secret" as const,
      locationId: locations[2].id,
      factionId: null,
      sourceNpcId: npcs[3].id,
    },
    {
      id: `info_${slug}_gate`,
      title: "Arrivals are being profiled at Ash Gate",
      summary: "The gate district is screening newcomers for specific symbols and names.",
      content: "Orders at Ash Gate prioritize travelers connected to river traffic, missing manifests, and old harbor debts.",
      truthfulness: "true" as const,
      accessibility: "public" as const,
      locationId: locations[0].id,
      factionId: factions[0].id,
      sourceNpcId: npcs[4].id,
    },
  ];

  const informationLinks = [
    {
      id: `link_${slug}_cargo_bribe`,
      sourceId: information[0].id,
      targetId: information[2].id,
      linkType: "supports" as const,
    },
    {
      id: `link_${slug}_bribe_watch`,
      sourceId: information[2].id,
      targetId: information[1].id,
      linkType: "extends" as const,
    },
    {
      id: `link_${slug}_oath_cargo`,
      sourceId: information[3].id,
      targetId: information[0].id,
      linkType: "extends" as const,
    },
    {
      id: `link_${slug}_gate_watch`,
      sourceId: information[4].id,
      targetId: information[1].id,
      linkType: "supports" as const,
    },
  ];

  const commodities = [
    {
      id: `cmd_${slug}_oil`,
      name: "Lamp Oil",
      baseValue: 4,
      tags: ["fuel", "trade"],
    },
    {
      id: `cmd_${slug}_salt`,
      name: "Salt Fish",
      baseValue: 3,
      tags: ["food", "trade"],
    },
    {
      id: `cmd_${slug}_papers`,
      name: "False Papers",
      baseValue: 14,
      tags: ["contraband", "documents"],
    },
  ];

  const marketPrices = [
    {
      id: `price_${slug}_oil_market`,
      commodityId: commodities[0].id,
      locationId: locations[1].id,
      vendorNpcId: npcs[1].id,
      factionId: factions[1].id,
      modifier: 1,
      stock: 12,
      legalStatus: "legal" as const,
    },
    {
      id: `price_${slug}_salt_docks`,
      commodityId: commodities[1].id,
      locationId: locations[3].id,
      vendorNpcId: npcs[2].id,
      factionId: factions[2].id,
      modifier: 0.9,
      stock: 18,
      legalStatus: "legal" as const,
    },
    {
      id: `price_${slug}_papers_market`,
      commodityId: commodities[2].id,
      locationId: locations[1].id,
      vendorNpcId: npcs[1].id,
      factionId: factions[1].id,
      modifier: 1.3,
      stock: 3,
      legalStatus: "contraband" as const,
    },
  ];

  const entryPoints = [
    {
      id: `entry_${slug}_gate`,
      title: "Under the Ash Gate",
      summary: "Arrive with the watch already looking for the wrong person and deciding whether that might be you.",
      startLocationId: locations[0].id,
      presentNpcIds: [npcs[4].id],
      initialInformationIds: [information[1].id, information[4].id],
    },
    {
      id: `entry_${slug}_market`,
      title: "Lanterns and Ledgers",
      summary: "Step into the market just as someone starts paying to make records disappear.",
      startLocationId: locations[1].id,
      presentNpcIds: [npcs[1].id],
      initialInformationIds: [information[2].id],
    },
    {
      id: `entry_${slug}_docks`,
      title: "Blackwater Arrival",
      summary: "Reach the harbor with contraband shifting under tarps and everyone pretending not to notice.",
      startLocationId: locations[3].id,
      presentNpcIds: [npcs[2].id],
      initialInformationIds: [information[0].id],
    },
  ];

  return {
    title,
    premise: `A pressure-cooker city where rivals, smugglers, and officials all want the next move to belong to them first. Prompt seed: ${topic}`,
    tone: "Tense, investigative, and street-level",
    setting: "A storm-battered trade city balancing law, commerce, and river crime",
    locations,
    edges,
    factions,
    factionRelations,
    npcs,
    information,
    informationLinks,
    commodities,
    marketPrices,
    entryPoints,
  };
}

const characterTool = {
  name: "generate_character_template",
  description: "Generate one grounded but vivid solo RPG protagonist.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      name: { type: "string" },
      archetype: { type: "string" },
      strength: { type: "number" },
      dexterity: { type: "number" },
      constitution: { type: "number" },
      intelligence: { type: "number" },
      wisdom: { type: "number" },
      charisma: { type: "number" },
      maxHealth: { type: "number" },
      backstory: { type: "string" },
      starterItems: {
        type: "array",
        items: { type: "string" },
      },
    },
    required: [
      "name",
      "archetype",
      "strength",
      "dexterity",
      "constitution",
      "intelligence",
      "wisdom",
      "charisma",
      "maxHealth",
      "backstory",
      "starterItems",
    ],
  },
};

const moduleTool = {
  name: "generate_open_world_module",
  description: "Generate an open-world module for a solo fantasy campaign.",
  input_schema: {
    type: "object",
    additionalProperties: true,
    properties: {},
  },
};

const openingTool = {
  name: "generate_campaign_opening",
  description: "Generate the opening scene for a chosen entry point.",
  input_schema: {
    type: "object",
    additionalProperties: true,
    properties: {},
  },
};

const actionTools = [
  {
    name: "execute_travel",
    description: "Travel along a known adjacent route.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        routeEdgeId: { type: "string" },
        targetLocationId: { type: "string" },
        narration: { type: "string" },
        suggestedActions: { type: "array", items: { type: "string" } },
        timeMode: { type: "string", enum: ["travel"] },
        timeElapsed: { type: "number" },
        citedEntities: {
          type: "object",
          additionalProperties: false,
          properties: {
            npcIds: { type: "array", items: { type: "string" } },
            locationIds: { type: "array", items: { type: "string" } },
            factionIds: { type: "array", items: { type: "string" } },
            commodityIds: { type: "array", items: { type: "string" } },
            informationIds: { type: "array", items: { type: "string" } },
          },
          required: ["npcIds", "locationIds", "factionIds", "commodityIds", "informationIds"],
        },
      },
      required: [
        "routeEdgeId",
        "targetLocationId",
        "narration",
        "suggestedActions",
        "timeMode",
        "timeElapsed",
        "citedEntities",
      ],
    },
  },
  {
    name: "execute_converse",
    description: "Speak with a present NPC about a specific topic.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        npcId: { type: "string" },
        topic: { type: "string" },
        approvalDelta: { type: "number" },
        discoverInformationIds: { type: "array", items: { type: "string" } },
        memorySummary: { type: "string" },
        narration: { type: "string" },
        suggestedActions: { type: "array", items: { type: "string" } },
        timeMode: { type: "string", enum: ["exploration", "downtime", "combat"] },
        timeElapsed: { type: "number" },
        citedEntities: {
          type: "object",
          additionalProperties: false,
          properties: {
            npcIds: { type: "array", items: { type: "string" } },
            locationIds: { type: "array", items: { type: "string" } },
            factionIds: { type: "array", items: { type: "string" } },
            commodityIds: { type: "array", items: { type: "string" } },
            informationIds: { type: "array", items: { type: "string" } },
          },
          required: ["npcIds", "locationIds", "factionIds", "commodityIds", "informationIds"],
        },
      },
      required: ["npcId", "topic", "narration", "suggestedActions", "timeMode", "timeElapsed", "citedEntities"],
    },
  },
  {
    name: "execute_investigate",
    description: "Investigate a location, NPC, route, or information lead.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        targetType: { type: "string", enum: ["location", "npc", "route", "information"] },
        targetId: { type: "string" },
        method: { type: "string" },
        discoverInformationIds: { type: "array", items: { type: "string" } },
        memorySummary: { type: "string" },
        narration: { type: "string" },
        suggestedActions: { type: "array", items: { type: "string" } },
        timeMode: { type: "string", enum: ["exploration", "downtime", "combat"] },
        timeElapsed: { type: "number" },
        citedEntities: {
          type: "object",
          additionalProperties: false,
          properties: {
            npcIds: { type: "array", items: { type: "string" } },
            locationIds: { type: "array", items: { type: "string" } },
            factionIds: { type: "array", items: { type: "string" } },
            commodityIds: { type: "array", items: { type: "string" } },
            informationIds: { type: "array", items: { type: "string" } },
          },
          required: ["npcIds", "locationIds", "factionIds", "commodityIds", "informationIds"],
        },
      },
      required: [
        "targetType",
        "targetId",
        "method",
        "narration",
        "suggestedActions",
        "timeMode",
        "timeElapsed",
        "citedEntities",
      ],
    },
  },
  {
    name: "execute_observe",
    description: "Observe a place, route, faction presence, or NPC.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        targetType: { type: "string", enum: ["location", "npc", "route", "faction"] },
        targetId: { type: "string" },
        discoverInformationIds: { type: "array", items: { type: "string" } },
        memorySummary: { type: "string" },
        narration: { type: "string" },
        suggestedActions: { type: "array", items: { type: "string" } },
        timeMode: { type: "string", enum: ["exploration", "downtime", "combat"] },
        timeElapsed: { type: "number" },
        citedEntities: {
          type: "object",
          additionalProperties: false,
          properties: {
            npcIds: { type: "array", items: { type: "string" } },
            locationIds: { type: "array", items: { type: "string" } },
            factionIds: { type: "array", items: { type: "string" } },
            commodityIds: { type: "array", items: { type: "string" } },
            informationIds: { type: "array", items: { type: "string" } },
          },
          required: ["npcIds", "locationIds", "factionIds", "commodityIds", "informationIds"],
        },
      },
      required: [
        "targetType",
        "targetId",
        "narration",
        "suggestedActions",
        "timeMode",
        "timeElapsed",
        "citedEntities",
      ],
    },
  },
  {
    name: "execute_wait",
    description: "Wait and let time pass.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        durationMinutes: { type: "number" },
        memorySummary: { type: "string" },
        narration: { type: "string" },
        suggestedActions: { type: "array", items: { type: "string" } },
        timeMode: { type: "string", enum: ["exploration", "downtime"] },
        timeElapsed: { type: "number" },
        citedEntities: {
          type: "object",
          additionalProperties: false,
          properties: {
            npcIds: { type: "array", items: { type: "string" } },
            locationIds: { type: "array", items: { type: "string" } },
            factionIds: { type: "array", items: { type: "string" } },
            commodityIds: { type: "array", items: { type: "string" } },
            informationIds: { type: "array", items: { type: "string" } },
          },
          required: ["npcIds", "locationIds", "factionIds", "commodityIds", "informationIds"],
        },
      },
      required: [
        "durationMinutes",
        "narration",
        "suggestedActions",
        "timeMode",
        "timeElapsed",
        "citedEntities",
      ],
    },
  },
  {
    name: "execute_freeform",
    description: "Handle a creative action outside the standard typed tools.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        actionDescription: { type: "string" },
        statToCheck: {
          type: "string",
          enum: ["strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma"],
        },
        timeMode: { type: "string", enum: ["combat", "exploration", "downtime"] },
        estimatedTimeElapsedMinutes: { type: "number" },
        timeElapsed: { type: "number" },
        intendedMechanicalOutcome: { type: "string" },
        dc: { type: "number" },
        failureConsequence: { type: "string" },
        memorySummary: { type: "string" },
        narration: { type: "string" },
        suggestedActions: { type: "array", items: { type: "string" } },
        citedEntities: {
          type: "object",
          additionalProperties: false,
          properties: {
            npcIds: { type: "array", items: { type: "string" } },
            locationIds: { type: "array", items: { type: "string" } },
            factionIds: { type: "array", items: { type: "string" } },
            commodityIds: { type: "array", items: { type: "string" } },
            informationIds: { type: "array", items: { type: "string" } },
          },
          required: ["npcIds", "locationIds", "factionIds", "commodityIds", "informationIds"],
        },
      },
      required: [
        "actionDescription",
        "statToCheck",
        "timeMode",
        "estimatedTimeElapsedMinutes",
        "timeElapsed",
        "intendedMechanicalOutcome",
        "narration",
        "suggestedActions",
        "citedEntities",
      ],
    },
  },
  {
    name: "request_clarification",
    description: "Ask for clarification when the player's intent cannot be safely mapped.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        question: { type: "string" },
        options: {
          type: "array",
          items: { type: "string" },
        },
      },
      required: ["question", "options"],
    },
  },
];

function fallbackCharacter(prompt: string): CharacterTemplateDraft {
  const words = prompt.trim().split(/\s+/).filter(Boolean);
  const name = words.slice(0, 2).join(" ") || "Unnamed Wanderer";
  return {
    name,
    archetype: "Scout",
    strength: 1,
    dexterity: 2,
    constitution: 1,
    intelligence: 0,
    wisdom: 2,
    charisma: 0,
    maxHealth: 12,
    backstory: prompt.trim() || "A traveler with reasons to keep moving.",
    starterItems: ["Travel cloak", "Flint kit", "Short blade"],
  };
}

function fallbackOpening(input: CampaignOpeningInput): GeneratedCampaignOpening {
  const location =
    input.module.locations.find((entry) => entry.id === input.entryPoint.startLocationId) ??
    input.module.locations[0]!;
  const presentNpcs = input.module.npcs.filter((npc) =>
    input.entryPoint.presentNpcIds.includes(npc.id),
  );
  const informationIds = input.entryPoint.initialInformationIds;

  return {
    narration: `${input.character.name} arrives at ${location.name} with the pressure already in motion. ${input.entryPoint.summary} ${presentNpcs[0] ? `${presentNpcs[0].name} is close enough to matter immediately.` : ""}`.trim(),
    activeThreat: input.module.premise,
    entryPointId: input.entryPoint.id,
    locationNodeId: location.id,
    presentNpcIds: presentNpcs.map((npc) => npc.id),
    citedInformationIds: informationIds,
    scene: {
      title: `${location.name} on Edge`,
      summary: location.summary,
      location: location.name,
      atmosphere: location.description,
      suggestedActions: [
        presentNpcs[0] ? `Speak with ${presentNpcs[0].name}` : "Survey the area",
        "Follow the freshest lead in sight",
        "Check who controls this district",
      ],
    },
  };
}

function fallbackTurn(input: TurnInput): TurnActionToolCall {
  const action = input.playerAction.trim();
  const lowered = action.toLowerCase();
  const currentLocation = input.promptContext.currentLocation;
  const travelRoute = input.promptContext.adjacentRoutes.find((route) =>
    lowered.includes(route.targetLocationName.toLowerCase()),
  );

  if (travelRoute) {
    const result: ExecuteTravelToolCall = {
      type: "execute_travel",
      routeEdgeId: travelRoute.id,
      targetLocationId: travelRoute.targetLocationId,
      narration: `You make for ${travelRoute.targetLocationName}, taking the route while the district keeps moving around you.`,
      suggestedActions: [
        `Observe ${travelRoute.targetLocationName}`,
        "Ask who controls this area",
        "Follow the strongest local lead",
      ],
      timeMode: "travel",
      timeElapsed: travelRoute.travelTimeMinutes,
      citedEntities: {
        npcIds: [],
        locationIds: [currentLocation.id, travelRoute.targetLocationId],
        factionIds: [],
        commodityIds: [],
        informationIds: [],
      },
    };
    return result;
  }

  const presentNpc = input.promptContext.presentNpcs.find((npc) =>
    lowered.includes(npc.name.toLowerCase().split(" ")[0] ?? npc.name.toLowerCase()),
  );

  if (presentNpc || /(talk|ask|speak|question|interrogate|bargain)/.test(lowered)) {
    const npc = presentNpc ?? input.promptContext.presentNpcs[0];
    if (npc) {
      const result: ExecuteConverseToolCall = {
        type: "execute_converse",
        npcId: npc.id,
        topic: action,
        approvalDelta: 1,
        discoverInformationIds: [],
        memorySummary: `You pressed ${npc.name} for a clearer read on the situation.`,
        narration: `You draw ${npc.name} into a tense exchange and try to pull something useful from the conversation.`,
        suggestedActions: [
          `Investigate ${npc.name}'s lead`,
          "Observe the crowd reaction",
          "Move before the situation cools",
        ],
        timeMode: "exploration",
        timeElapsed: 10,
        citedEntities: {
          npcIds: [npc.id],
          locationIds: [currentLocation.id],
          factionIds: npc.factionId ? [npc.factionId] : [],
          commodityIds: [],
          informationIds: [],
        },
      };
      return result;
    }
  }

  if (/(observe|watch|listen|survey|scan|read the room)/.test(lowered)) {
    const result: ExecuteObserveToolCall = {
      type: "execute_observe",
      targetType: "location",
      targetId: currentLocation.id,
      discoverInformationIds: [],
      memorySummary: `You slowed down and studied ${currentLocation.name}.`,
      narration: `You hold position long enough to let the shape of ${currentLocation.name} reveal itself.`,
      suggestedActions: ["Investigate the strongest anomaly", "Talk to someone nearby", "Move along a route that stands out"],
      timeMode: "exploration",
      timeElapsed: 5,
      citedEntities: {
        npcIds: [],
        locationIds: [currentLocation.id],
        factionIds: currentLocation.controllingFactionId ? [currentLocation.controllingFactionId] : [],
        commodityIds: [],
        informationIds: [],
      },
    };
    return result;
  }

  if (/(wait|linger|hold position)/.test(lowered)) {
    const result: ExecuteWaitToolCall = {
      type: "execute_wait",
      durationMinutes: 15,
      memorySummary: `You waited to see what would break the stillness first.`,
      narration: "You let a pocket of time pass and watch what shifts around you.",
      suggestedActions: ["Observe the nearest pressure point", "Question whoever moves first", "Change locations before the trail cools"],
      timeMode: "exploration",
      timeElapsed: 15,
      citedEntities: {
        npcIds: [],
        locationIds: [currentLocation.id],
        factionIds: [],
        commodityIds: [],
        informationIds: [],
      },
    };
    return result;
  }

  if (/(investigate|search|examine|inspect|follow|track)/.test(lowered)) {
    const targetInfo = input.promptContext.localInformation[0] ?? input.promptContext.connectedLeads[0]?.information;
    const result: ExecuteInvestigateToolCall = {
      type: "execute_investigate",
      targetType: targetInfo ? "information" : "location",
      targetId: targetInfo?.id ?? currentLocation.id,
      method: action,
      discoverInformationIds: targetInfo ? [targetInfo.id] : [],
      memorySummary: `You pushed deeper into the evidence around ${currentLocation.name}.`,
      narration: `You work the scene with intent, trying to turn scraps and patterns into something actionable.`,
      suggestedActions: ["Press the freshest lead", "Talk to someone tied to the clue", "Relocate before the trail goes cold"],
      timeMode: "exploration",
      timeElapsed: 15,
      citedEntities: {
        npcIds: [],
        locationIds: [currentLocation.id],
        factionIds: [],
        commodityIds: [],
        informationIds: targetInfo ? [targetInfo.id] : [],
      },
    };
    return result;
  }

  const result: ExecuteFreeformToolCall = {
    type: "execute_freeform",
    actionDescription: action,
    statToCheck: inferStatFromText(action),
    timeMode: "exploration",
    estimatedTimeElapsedMinutes: 10,
    timeElapsed: 10,
    intendedMechanicalOutcome: action,
    dc: 8,
    failureConsequence: "The attempt costs time and exposes a new complication.",
    memorySummary: `You attempted: ${action}.`,
    narration: `You commit to the move and force the world to answer it directly.`,
    suggestedActions: ["Capitalize on any opening", "Regroup and reassess", "Probe for the next pressure point"],
    citedEntities: {
      npcIds: [],
      locationIds: [currentLocation.id],
      factionIds: [],
      commodityIds: [],
      informationIds: [],
    },
  };
  return result;
}

function extractToolInput(response: OpenAI.Chat.Completions.ChatCompletion) {
  const toolCall = response.choices[0]?.message?.tool_calls?.[0];

  if (toolCall?.type === "function") {
    return {
      name: toolCall.function.name,
      input: safeParseJson(toolCall.function.arguments),
    };
  }

  return {
    name: null,
    input: safeParseJson(response.choices[0]?.message?.content ?? ""),
  };
}

async function runCompletion(options: {
  system: string;
  user: string;
  tools?: Array<{ name: string; description: string; input_schema: Record<string, unknown> }>;
}) {
  const client = createClient();

  if (!client) {
    return null;
  }

  const response = await client.chat.completions.create({
    model: env.openRouterModel,
    temperature: 0.7,
    messages: [
      { role: "system", content: options.system },
      { role: "user", content: options.user },
    ],
    tools: options.tools?.map(toFunctionTool),
    tool_choice: options.tools?.length ? "auto" : undefined,
  });

  return extractToolInput(response);
}

export function getTurnQualityMeta() {
  return null;
}

class DungeonMasterClient {
  async generateCharacter(prompt: string): Promise<{ character: CharacterTemplateDraft; source: "openrouter"; warning?: string }> {
    const fallback = fallbackCharacter(prompt);

    try {
      const response = await runCompletion({
        system: [
          "You create grounded but vivid solo fantasy protagonists.",
          "Return exactly one playable character template.",
          "Stats are modifiers in the range -2 to +3, maxHealth is usually 8 to 18, and starter gear should feel specific and mundane.",
        ].join("\n"),
        user: prompt,
        tools: [characterTool],
      });

      const parsed = characterTemplateDraftSchema.safeParse(response?.input);
      if (parsed.success) {
        return { character: parsed.data, source: "openrouter" };
      }
    } catch {
      // Fall back below.
    }

    return { character: fallback, source: "openrouter", warning: "Used fallback character generation." };
  }

  async generateWorldModule(input: {
    prompt: string;
    previousDraft?: GeneratedWorldModule;
  }): Promise<GeneratedWorldModule> {
    const fallback = buildFallbackWorldModule(input.prompt);

    try {
      const response = await runCompletion({
        system: [
          "Generate a reusable open-world solo fantasy campaign module.",
          "Return a coherent graph with locations, edges, factions, relations, NPCs, information, commodities, market prices, and entry points.",
          "Do not write any timeline, world events, or simulation tick output.",
        ].join("\n"),
        user: [
          `Prompt: ${input.prompt}`,
          input.previousDraft ? `Previous draft to revise: ${JSON.stringify(summarizeWorld(input.previousDraft))}` : "",
        ]
          .filter(Boolean)
          .join("\n\n"),
        tools: [moduleTool],
      });

      const parsed = generatedWorldModuleSchema.safeParse(response?.input);
      if (parsed.success) {
        const coherence = validateWorldModuleCoherence(parsed.data);
        const playability = validateWorldModulePlayability(parsed.data);

        if (!coherence.ok) {
          throw new Error(`World coherence failed: ${coherence.issues.join("; ")}`);
        }

        if (!playability.ok) {
          throw new Error(`World playability failed: ${playability.issues.join("; ")}`);
        }

        return parsed.data;
      }
    } catch (error) {
      console.error("runTurn fell back to local resolution", error);
    }

    return fallback;
  }

  async generateCampaignOpening(input: CampaignOpeningInput): Promise<GeneratedCampaignOpening> {
    const fallback = fallbackOpening(input);
    const location = input.module.locations.find((entry) => entry.id === input.entryPoint.startLocationId);
    const presentNpcs = input.module.npcs.filter((npc) => input.entryPoint.presentNpcIds.includes(npc.id));
    const seededInformation = input.module.information.filter((info) =>
      input.entryPoint.initialInformationIds.includes(info.id),
    );

    try {
      const response = await runCompletion({
        system: [
          "Write the opening scene for a chosen entry point in an open-world solo RPG.",
          "Stay inside the selected entry-point bubble and do not invent off-screen mechanical facts.",
          "Return narration, an active threat, a scene summary, and exact ids for the starting location, present NPCs, and cited information.",
        ].join("\n"),
        user: JSON.stringify({
          module: summarizeWorld(input.module),
          entryPoint: input.entryPoint,
          startLocation: location,
          presentNpcs,
          seededInformation: seededInformation.map((entry) => ({
            id: entry.id,
            title: entry.title,
            summary: entry.summary,
          })),
          character: {
            name: input.character.name,
            archetype: input.character.archetype,
            backstory: input.character.backstory,
          },
          prompt: input.prompt ?? null,
          previousDraft: input.previousDraft ?? null,
        }),
        tools: [openingTool],
      });

      const parsed = generatedCampaignOpeningSchema.safeParse(response?.input);
      if (parsed.success) {
        return parsed.data;
      }
    } catch {
      // Fall back below.
    }

    return fallback;
  }

  async runTurn(input: TurnInput): Promise<TurnActionToolCall> {
    const fallback = fallbackTurn(input);

    try {
      const response = await runCompletion({
        system: [
          "You are the player's senses in a simulated world.",
          "Use exactly one tool.",
          "Do not invent named mechanical entities outside the provided context.",
          "Every executable tool call must include timeMode, timeElapsed, narration, suggestedActions, and citedEntities.",
          "Use request_clarification if the action is too ambiguous to map safely.",
        ].join("\n"),
        user: JSON.stringify({
          action: input.playerAction,
          context: input.promptContext,
          character: {
            name: input.character.name,
            archetype: input.character.archetype,
            stats: input.character.stats,
          },
        }),
        tools: actionTools,
      });

      const toolName = response?.name;
      const inputPayload = response?.input;

      if (toolName && inputPayload && typeof inputPayload === "object") {
        return {
          type: toolName,
          ...(inputPayload as Record<string, unknown>),
        } as TurnActionToolCall;
      }
    } catch {
      // Fall back below.
    }

    return fallback;
  }

  async summarizeSession(lines: string[]) {
    if (!lines.length) {
      return "No memorable events were recorded this session.";
    }

    return lines.slice(-8).join("\n");
  }
}

export const dmClient = new DungeonMasterClient();
