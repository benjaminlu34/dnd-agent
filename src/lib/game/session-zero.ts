import { z } from "zod";

const factionResourcesSchema = z.object({
  gold: z.number().int().min(0),
  military: z.number().int().min(0),
  influence: z.number().int().min(0),
  information: z.number().int().min(0),
});

const locationSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  type: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  description: z.string().trim().min(1),
  state: z.string().trim().min(1),
  controllingFactionId: z.string().trim().min(1).nullable(),
  tags: z.array(z.string().trim().min(1)),
});

const edgeSchema = z.object({
  id: z.string().trim().min(1),
  sourceId: z.string().trim().min(1),
  targetId: z.string().trim().min(1),
  travelTimeMinutes: z.number().int().min(1),
  dangerLevel: z.number().int().min(0).max(10),
  currentStatus: z.string().trim().min(1),
  description: z.string().trim().min(1).nullable(),
});

const factionSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  type: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  agenda: z.string().trim().min(1),
  resources: factionResourcesSchema,
  pressureClock: z.number().int().min(0).max(20),
});

const factionRelationSchema = z.object({
  id: z.string().trim().min(1),
  factionAId: z.string().trim().min(1),
  factionBId: z.string().trim().min(1),
  stance: z.enum(["allied", "neutral", "rival", "war"]),
});

const npcSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  role: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  description: z.string().trim().min(1),
  factionId: z.string().trim().min(1).nullable(),
  currentLocationId: z.string().trim().min(1),
  approval: z.number().int().min(-10).max(10),
  isCompanion: z.boolean(),
});

const informationSchema = z.object({
  id: z.string().trim().min(1),
  title: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  content: z.string().trim().min(1),
  truthfulness: z.enum(["true", "partial", "false", "outdated"]),
  accessibility: z.enum(["public", "guarded", "secret"]),
  locationId: z.string().trim().min(1).nullable(),
  factionId: z.string().trim().min(1).nullable(),
  sourceNpcId: z.string().trim().min(1).nullable(),
});

const informationLinkSchema = z.object({
  id: z.string().trim().min(1),
  sourceId: z.string().trim().min(1),
  targetId: z.string().trim().min(1),
  linkType: z.enum(["supports", "contradicts", "extends", "unlocks"]),
});

const commoditySchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  baseValue: z.number().int().min(0),
  tags: z.array(z.string().trim().min(1)),
});

const marketPriceSchema = z.object({
  id: z.string().trim().min(1),
  commodityId: z.string().trim().min(1),
  locationId: z.string().trim().min(1),
  vendorNpcId: z.string().trim().min(1).nullable(),
  factionId: z.string().trim().min(1).nullable(),
  modifier: z.number().positive(),
  stock: z.number().int().min(-1),
  legalStatus: z.enum(["legal", "restricted", "contraband"]),
});

const entryPointSchema = z.object({
  id: z.string().trim().min(1),
  title: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  startLocationId: z.string().trim().min(1),
  presentNpcIds: z.array(z.string().trim().min(1)),
  initialInformationIds: z.array(z.string().trim().min(1)),
});

export const generatedWorldModuleSchema = z
  .object({
    title: z.string().trim().min(1),
    premise: z.string().trim().min(1),
    tone: z.string().trim().min(1),
    setting: z.string().trim().min(1),
    locations: z.array(locationSchema).min(4),
    edges: z.array(edgeSchema).min(4),
    factions: z.array(factionSchema).min(2),
    factionRelations: z.array(factionRelationSchema).min(1),
    npcs: z.array(npcSchema).min(4),
    information: z.array(informationSchema).min(4),
    informationLinks: z.array(informationLinkSchema).min(1),
    commodities: z.array(commoditySchema).min(2),
    marketPrices: z.array(marketPriceSchema).min(2),
    entryPoints: z.array(entryPointSchema).min(2).max(5),
  })
  .superRefine((draft, ctx) => {
    const locationIds = new Set(draft.locations.map((location) => location.id));
    const factionIds = new Set(draft.factions.map((faction) => faction.id));
    const npcIds = new Set(draft.npcs.map((npc) => npc.id));
    const informationIds = new Set(draft.information.map((information) => information.id));
    const commodityIds = new Set(draft.commodities.map((commodity) => commodity.id));

    draft.edges.forEach((edge, index) => {
      if (!locationIds.has(edge.sourceId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["edges", index, "sourceId"],
          message: "Edge source must reference a known location.",
        });
      }

      if (!locationIds.has(edge.targetId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["edges", index, "targetId"],
          message: "Edge target must reference a known location.",
        });
      }
    });

    draft.locations.forEach((location, index) => {
      if (location.controllingFactionId && !factionIds.has(location.controllingFactionId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["locations", index, "controllingFactionId"],
          message: "Location controller must reference a known faction.",
        });
      }
    });

    draft.factionRelations.forEach((relation, index) => {
      if (!factionIds.has(relation.factionAId) || !factionIds.has(relation.factionBId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["factionRelations", index],
          message: "Faction relations must reference known factions.",
        });
      }
    });

    draft.npcs.forEach((npc, index) => {
      if (!locationIds.has(npc.currentLocationId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["npcs", index, "currentLocationId"],
          message: "NPC currentLocationId must reference a known location.",
        });
      }

      if (npc.factionId && !factionIds.has(npc.factionId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["npcs", index, "factionId"],
          message: "NPC factionId must reference a known faction.",
        });
      }
    });

    draft.information.forEach((information, index) => {
      if (information.locationId && !locationIds.has(information.locationId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["information", index, "locationId"],
          message: "Information locationId must reference a known location.",
        });
      }

      if (information.factionId && !factionIds.has(information.factionId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["information", index, "factionId"],
          message: "Information factionId must reference a known faction.",
        });
      }

      if (information.sourceNpcId && !npcIds.has(information.sourceNpcId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["information", index, "sourceNpcId"],
          message: "Information sourceNpcId must reference a known NPC.",
        });
      }
    });

    draft.informationLinks.forEach((link, index) => {
      if (!informationIds.has(link.sourceId) || !informationIds.has(link.targetId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["informationLinks", index],
          message: "Information links must reference known information nodes.",
        });
      }
    });

    draft.marketPrices.forEach((price, index) => {
      if (!commodityIds.has(price.commodityId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["marketPrices", index, "commodityId"],
          message: "Market price commodityId must reference a known commodity.",
        });
      }

      if (!locationIds.has(price.locationId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["marketPrices", index, "locationId"],
          message: "Market price locationId must reference a known location.",
        });
      }

      if (price.vendorNpcId && !npcIds.has(price.vendorNpcId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["marketPrices", index, "vendorNpcId"],
          message: "Market price vendorNpcId must reference a known NPC.",
        });
      }

      if (price.factionId && !factionIds.has(price.factionId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["marketPrices", index, "factionId"],
          message: "Market price factionId must reference a known faction.",
        });
      }
    });

    draft.entryPoints.forEach((entryPoint, index) => {
      if (!locationIds.has(entryPoint.startLocationId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["entryPoints", index, "startLocationId"],
          message: "Entry point startLocationId must reference a known location.",
        });
      }

      entryPoint.presentNpcIds.forEach((npcId, npcIndex) => {
        if (!npcIds.has(npcId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["entryPoints", index, "presentNpcIds", npcIndex],
            message: "Entry point presentNpcIds must reference known NPCs.",
          });
        }
      });

      entryPoint.initialInformationIds.forEach((informationId, infoIndex) => {
        if (!informationIds.has(informationId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["entryPoints", index, "initialInformationIds", infoIndex],
            message: "Entry point initialInformationIds must reference known information nodes.",
          });
        }
      });
    });
  });

export const generatedCampaignOpeningSchema = z.object({
  narration: z.string().trim().min(1),
  activeThreat: z.string().trim().min(1),
  entryPointId: z.string().trim().min(1),
  locationNodeId: z.string().trim().min(1),
  presentNpcIds: z.array(z.string().trim().min(1)),
  citedInformationIds: z.array(z.string().trim().min(1)),
  scene: z.object({
    title: z.string().trim().min(1),
    summary: z.string().trim().min(1),
    location: z.string().trim().min(1),
    atmosphere: z.string().trim().min(1),
    suggestedActions: z.array(z.string().trim().min(1)).min(1).max(4),
  }),
});

export const campaignDraftRequestSchema = z.object({
  prompt: z.string().trim().min(1, "Prompt is required."),
  previousDraft: generatedWorldModuleSchema.optional(),
});

export const campaignOpeningDraftRequestSchema = z.object({
  moduleId: z.string().trim().min(1, "Module selection is required."),
  templateId: z.string().trim().min(1, "Template selection is required."),
  entryPointId: z.string().trim().min(1, "Entry point selection is required."),
  prompt: z.string().trim().optional(),
  previousDraft: generatedCampaignOpeningSchema.optional(),
});

export const campaignCreateRequestSchema = z.object({
  moduleId: z.string().trim().min(1, "Module selection is required."),
  templateId: z.string().trim().min(1, "Template selection is required."),
  entryPointId: z.string().trim().min(1, "Entry point selection is required."),
  opening: generatedCampaignOpeningSchema,
});

export const moduleCreateRequestSchema = z.object({
  draft: generatedWorldModuleSchema,
});
