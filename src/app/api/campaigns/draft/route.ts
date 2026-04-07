import { NextResponse } from "next/server";
import { dmClient, isWorldGenerationStoppedError } from "@/lib/ai/provider";
import { campaignDraftRequestSchema } from "@/lib/game/session-zero";
import {
  completeDraftGenerationProgress,
  beginDraftGenerationProgress,
  failDraftGenerationProgress,
  getDraftGenerationCheckpoint,
  getWorldGenerationStageLabel,
  isDraftGenerationStopRequested,
  markDraftGenerationStage,
  stopDraftGenerationProgress,
  setDraftGenerationCheckpoint,
  updateDraftGenerationProgress,
} from "@/lib/game/world-generation-progress";

export const runtime = "nodejs";

const MAX_AUTOMATIC_DRAFT_GENERATION_RUNS = 5;

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

  const progressId = payload.data.progressId ?? null;

  if (progressId) {
    beginDraftGenerationProgress(progressId);
  }

  const maxRuns = progressId ? MAX_AUTOMATIC_DRAFT_GENERATION_RUNS : 1;
  let lastError: unknown = null;

  for (let run = 1; run <= maxRuns; run += 1) {
    if (progressId && isDraftGenerationStopRequested(progressId)) {
      stopDraftGenerationProgress(progressId);
      return NextResponse.json({ stopped: true, progressId });
    }

    if (progressId && run > 1) {
      const checkpoint = getDraftGenerationCheckpoint(progressId);
      const failedStage = checkpoint?.failedStage ?? null;
      const failedStageLabel = failedStage ? getWorldGenerationStageLabel(failedStage) : "latest stage";
      updateDraftGenerationProgress(progressId, {
        status: "running",
        stage: failedStage,
        label: failedStage ? `Retrying ${failedStageLabel}` : "Retrying From Checkpoint",
        message: `Continuing automatically from ${failedStageLabel}. Attempt ${run} of ${maxRuns}.`,
        completedAt: null,
        error: null,
        stopRequested: false,
      });
    }

    try {
      const result = await dmClient.generateWorldModule({
        prompt: payload.data.prompt,
        scaleTier: payload.data.scaleTier,
        previousDraft: payload.data.previousDraft,
        resumeCheckpoint: progressId
          ? getDraftGenerationCheckpoint(progressId)
          : null,
        onCheckpoint: progressId
          ? (checkpoint) => {
              setDraftGenerationCheckpoint(progressId, checkpoint);
            }
          : undefined,
        onProgress: progressId
          ? (update) => {
              markDraftGenerationStage(progressId, update);
            }
          : undefined,
        shouldStop: progressId
          ? () => isDraftGenerationStopRequested(progressId)
          : undefined,
      });

      if (progressId) {
        completeDraftGenerationProgress(progressId);
      }

      return NextResponse.json(result);
    } catch (error) {
      lastError = error;

      if (progressId && isWorldGenerationStoppedError(error)) {
        stopDraftGenerationProgress(progressId);
        return NextResponse.json({ stopped: true, progressId });
      }

      const message =
        error instanceof Error ? error.message : "Failed to generate campaign draft.";
      const checkpoint = progressId ? getDraftGenerationCheckpoint(progressId) : null;
      const canRetry =
        Boolean(
          progressId
          && run < maxRuns
          && checkpoint
          && checkpoint.generationStatus === "failed",
        );

      if (canRetry) {
        continue;
      }

      if (progressId) {
        failDraftGenerationProgress(progressId, message);
      }

      return NextResponse.json(
        {
          error: message,
        },
        { status: 500 },
      );
    }
  }

  const message =
    lastError instanceof Error ? lastError.message : "Failed to generate campaign draft.";

  if (progressId) {
    failDraftGenerationProgress(progressId, message);
  }

  return NextResponse.json(
    {
      error: message,
    },
    { status: 500 },
  );
}
