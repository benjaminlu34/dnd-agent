import { z } from "zod";

export const openingSceneSchema = z.object({
  title: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  location: z.string().trim().min(1),
  atmosphere: z.string().trim().min(1),
  activeThreat: z.string().trim().min(1),
  suggestedActions: z.array(z.string().trim().min(1)).min(1).max(4),
});

export const generatedCampaignSetupSchema = z.object({
  publicSynopsis: z.object({
    title: z.string().trim().min(1),
    premise: z.string().trim().min(1),
    tone: z.string().trim().min(1),
    setting: z.string().trim().min(1),
    openingScene: openingSceneSchema,
  }),
  secretEngine: z.object({
    villain: z.object({
      name: z.string().trim().min(1),
      motive: z.string().trim().min(1),
      progressClock: z.number().int().min(0),
    }),
    hooks: z.array(
      z.object({
        text: z.string().trim().min(1),
      }),
    ),
    arcs: z.array(
      z.object({
        title: z.string().trim().min(1),
        summary: z.string().trim().min(1),
        expectedTurns: z.number().int().min(1),
      }),
    ),
    reveals: z.array(
      z.object({
        title: z.string().trim().min(1),
        truth: z.string().trim().min(1),
        requiredClueTitles: z.array(z.string().trim().min(1)),
        requiredArcTitles: z.array(z.string().trim().min(1)),
      }),
    ),
    subplotSeeds: z.array(
      z.object({
        title: z.string().trim().min(1),
        hook: z.string().trim().min(1),
      }),
    ),
    quests: z.array(
      z.object({
        title: z.string().trim().min(1),
        summary: z.string().trim().min(1),
        maxStage: z.number().int().min(1),
        rewardGold: z.number().int().min(0),
        rewardItem: z.string().trim().min(1).nullable().optional(),
      }),
    ),
    npcs: z.array(
      z.object({
        name: z.string().trim().min(1),
        role: z.string().trim().min(1),
        notes: z.string().trim().min(1),
        isCompanion: z.boolean().optional(),
        approval: z.number().int().optional(),
        personalHook: z.string().trim().min(1).nullable().optional(),
        status: z.string().trim().min(1).optional(),
      }),
    ),
    clues: z.array(
      z.object({
        text: z.string().trim().min(1),
        source: z.string().trim().min(1),
        linkedRevealTitle: z.string().trim().min(1),
      }),
    ),
    locations: z.array(z.string().trim().min(1)),
  }),
});

export const campaignDraftRequestSchema = z.object({
  prompt: z.string().trim().min(1, "Prompt is required."),
  previousDraft: generatedCampaignSetupSchema.optional(),
});

export const campaignCreateRequestSchema = z.object({
  draft: generatedCampaignSetupSchema,
});

export type CampaignDraftRequest = z.infer<typeof campaignDraftRequestSchema>;
export type CampaignCreateRequest = z.infer<typeof campaignCreateRequestSchema>;
