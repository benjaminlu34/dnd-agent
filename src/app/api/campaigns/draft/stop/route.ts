import { NextResponse } from "next/server";
import { z } from "zod";
import {
  getDraftGenerationProgress,
  requestDraftGenerationStop,
} from "@/lib/game/world-generation-progress";

export const runtime = "nodejs";

const stopDraftGenerationRequestSchema = z.object({
  progressId: z.string().trim().min(1, "progressId is required."),
});

export async function POST(request: Request) {
  const payload = stopDraftGenerationRequestSchema.safeParse(await request.json().catch(() => null));

  if (!payload.success) {
    return NextResponse.json(
      {
        error: "Invalid stop request.",
        details: payload.error.flatten(),
      },
      { status: 400 },
    );
  }

  const existing = getDraftGenerationProgress(payload.data.progressId);
  if (!existing) {
    return NextResponse.json(
      {
        error: `No active draft generation found for progressId ${payload.data.progressId}.`,
      },
      { status: 404 },
    );
  }

  const progress = requestDraftGenerationStop(payload.data.progressId) ?? existing;
  return NextResponse.json({
    ok: true,
    progress,
  });
}
