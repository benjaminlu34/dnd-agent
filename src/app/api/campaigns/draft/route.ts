import { NextResponse } from "next/server";
import { dmClient } from "@/lib/ai/provider";
import { campaignDraftRequestSchema } from "@/lib/game/session-zero";
import {
  completeDraftGenerationProgress,
  createDraftGenerationProgress,
  failDraftGenerationProgress,
  getDraftGenerationProgress,
  markDraftGenerationStage,
} from "@/lib/game/world-generation-progress";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const payload = campaignDraftRequestSchema.safeParse(await request.json().catch(() => null));

  if (!payload.success) {
    return NextResponse.json(
      {
        error: "Invalid draft request.",
        details: payload.error.flatten(),
      },
      { status: 400 },
    );
  }

  try {
    if (payload.data.progressId) {
      createDraftGenerationProgress(payload.data.progressId);
    }

    const result = await dmClient.generateWorldModule({
      prompt: payload.data.prompt,
      scaleTier: payload.data.scaleTier,
      previousDraft: payload.data.previousDraft,
      onProgress: payload.data.progressId
        ? (update) => {
            markDraftGenerationStage(payload.data.progressId!, update);
          }
        : undefined,
    });

    if (payload.data.progressId) {
      completeDraftGenerationProgress(payload.data.progressId);
    }

    return NextResponse.json(result);
  } catch (error) {
    if (payload.data.progressId) {
      failDraftGenerationProgress(
        payload.data.progressId,
        error instanceof Error ? error.message : "Failed to generate campaign draft.",
      );
    }

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to generate campaign draft.",
      },
      { status: 500 },
    );
  }
}
