import { NextResponse } from "next/server";
import { cancelTurnRequest } from "@/lib/game/engine";
import type { TurnLockCancelRequest } from "@/lib/game/types";

export const runtime = "nodejs";

export async function DELETE(request: Request) {
  const body = (await request.json().catch(() => null)) as Partial<TurnLockCancelRequest> | null;

  if (!body?.campaignId || !body.sessionId || !body.requestId) {
    return NextResponse.json(
      { error: "campaignId, sessionId, and requestId are required." },
      { status: 400 },
    );
  }

  try {
    await cancelTurnRequest({
      campaignId: body.campaignId,
      sessionId: body.sessionId,
      requestId: body.requestId,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to cancel the turn request.",
      },
      { status: 500 },
    );
  }
}
