import { NextResponse } from "next/server";
import { dmClient } from "@/lib/ai/provider";
import { campaignDraftRequestSchema } from "@/lib/game/session-zero";
import {
  completeDraftGenerationProgress,
  beginDraftGenerationProgress,
  failDraftGenerationProgress,
  getDraftGenerationCheckpoint,
  getDraftGenerationProgress,
  markDraftGenerationStage,
  setDraftGenerationCheckpoint,
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
      beginDraftGenerationProgress(payload.data.progressId);
    }

    const result = await dmClient.generateWorldModule({
      prompt: payload.data.prompt,
      scaleTier: payload.data.scaleTier,
      previousDraft: payload.data.previousDraft,
      resumeCheckpoint: payload.data.progressId
        ? getDraftGenerationCheckpoint(payload.data.progressId)
        : null,
      onCheckpoint: payload.data.progressId
        ? (checkpoint) => {
            setDraftGenerationCheckpoint(payload.data.progressId!, checkpoint);
          }
        : undefined,
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
