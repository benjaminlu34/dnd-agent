import { NextResponse } from "next/server";
import { getMissedTurnDigests, getTurnSnapshot, toPlayerCampaignSnapshot } from "@/lib/game/repository";
import { triageTurn } from "@/lib/game/engine";
import { createNdjsonStream } from "@/lib/http/ndjson";
import { InvalidExpectedStateVersionError, StateConflictError, TurnLockedError } from "@/lib/game/errors";
import type { TurnSubmissionRequest } from "@/lib/game/types";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    ok: true,
    message: "Turn submission is a POST endpoint. Open / to use the app UI.",
  });
}

export async function POST(request: Request) {
  const body = (await request.json()) as Partial<TurnSubmissionRequest>;

  if (
    !body.campaignId
    || !body.sessionId
    || !body.requestId
    || typeof body.expectedStateVersion !== "number"
    || !body.action?.trim()
  ) {
    return NextResponse.json(
      { error: "campaignId, sessionId, requestId, expectedStateVersion, and action are required." },
      { status: 400 },
    );
  }

  const campaignId = body.campaignId;
  const sessionId = body.sessionId;
  const requestId = body.requestId;
  const expectedStateVersion = body.expectedStateVersion;
  const action = body.action.trim();

  try {
    const bufferedNarration: string[] = [];
    const result = await triageTurn({
      campaignId,
      sessionId,
      requestId,
      expectedStateVersion,
      action,
      stream: {
        narration: (chunk) => bufferedNarration.push(chunk),
      },
    });

    if (result.type === "state_conflict") {
      return NextResponse.json(result.payload, { status: 409 });
    }

    if (result.type === "retry_required") {
      return NextResponse.json(result.payload, { status: 409 });
    }

    const stream = createNdjsonStream(async (send) => {
      if (result.type === "clarification") {
        for (const warning of result.warnings) {
          send({ type: "warning", message: warning });
        }
        send({
          type: "clarification",
          question: result.question,
          options: result.options,
        });
        return;
      }

      for (const chunk of bufferedNarration) {
        send({ type: "narration", chunk });
      }

      send({
        type: "actions",
        actions: result.suggestedActions,
      });

      if (result.checkResult) {
        send({
          type: "check_result",
          result: result.checkResult,
        });
      }

      const snapshot = await getTurnSnapshot(campaignId, sessionId);
      if (snapshot) {
        send({
          type: "state",
          snapshot: toPlayerCampaignSnapshot(snapshot),
        });
      }
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof TurnLockedError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof StateConflictError) {
      const snapshot = await getTurnSnapshot(campaignId, sessionId);
      return NextResponse.json(
        {
          error: "state_conflict",
          latestSnapshot: snapshot ? toPlayerCampaignSnapshot(snapshot) : null,
          latestStateVersion: snapshot?.stateVersion ?? expectedStateVersion,
          missedTurnDigests: await getMissedTurnDigests(campaignId, expectedStateVersion),
        },
        { status: 409 },
      );
    }
    if (error instanceof InvalidExpectedStateVersionError) {
      const snapshot = await getTurnSnapshot(campaignId, sessionId);
      return NextResponse.json(
        {
          error: "invalid_expected_state_version",
          latestSnapshot: snapshot ? toPlayerCampaignSnapshot(snapshot) : null,
          latestStateVersion: error.latestStateVersion,
          message: error.message,
        },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Turn submission failed.",
      },
      { status: 500 },
    );
  }
}
