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
  const mode = body.mode;
  const intent = body.intent;

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

  if (
    intent !== undefined
    && (
      intent.type !== "travel_route"
      || !intent.routeEdgeId?.trim()
      || !intent.targetLocationId?.trim()
    )
  ) {
    return NextResponse.json(
      { error: "intent must be omitted or be a valid travel_route payload." },
      { status: 400 },
    );
  }

  if (mode !== undefined && mode !== "observe") {
    return NextResponse.json(
      { error: "mode must be omitted or set to 'observe'." },
      { status: 400 },
    );
  }

  if (mode === "observe" && intent) {
    return NextResponse.json(
      { error: "observe mode cannot be combined with a structured intent." },
      { status: 400 },
    );
  }

  const campaignId = body.campaignId;
  const sessionId = body.sessionId;
  const requestId = body.requestId;
  const expectedStateVersion = body.expectedStateVersion;
  const action = body.action.trim();

  try {
    const stream = createNdjsonStream(async (send) => {
      try {
        const result = await triageTurn({
          campaignId,
          sessionId,
          requestId,
          expectedStateVersion,
          action,
          intent,
          mode,
          stream: {
            narration: (chunk) => send({ type: "narration", chunk }),
            warning: (message) => send({ type: "warning", message }),
            checkResult: (result) => send({ type: "check_result", result }),
          },
        });

        if (result.type === "state_conflict") {
          send({
            type: "state_conflict",
            latestSnapshot: result.payload.latestSnapshot,
            latestStateVersion: result.payload.latestStateVersion,
            missedTurnDigests: result.payload.missedTurnDigests,
          });
          return;
        }

        if (result.type === "retry_required") {
          send({
            type: "retry_required",
            turnId: result.payload.turnId,
            previousStatus: result.payload.previousStatus,
            result: result.payload.result,
          });
          return;
        }

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

        send({
          type: "actions",
          actions: result.suggestedActions,
        });

        try {
          const snapshot = await getTurnSnapshot(campaignId, sessionId);
          if (snapshot) {
            send({
              type: "state",
              snapshot: toPlayerCampaignSnapshot(snapshot),
            });
          } else {
            send({
              type: "warning",
              message: "Turn resolved, but the latest campaign state was unavailable for refresh.",
            });
          }
        } catch (error) {
          send({
            type: "warning",
            message:
              error instanceof Error
                ? `Turn resolved, but refreshing the latest campaign state failed: ${error.message}`
                : "Turn resolved, but refreshing the latest campaign state failed.",
          });
        }
      } catch (error) {
        if (error instanceof TurnLockedError) {
          send({ type: "error", message: error.message });
          return;
        }
        if (error instanceof StateConflictError) {
          const snapshot = await getTurnSnapshot(campaignId, sessionId);
          send({
            type: "state_conflict",
            latestSnapshot: snapshot ? toPlayerCampaignSnapshot(snapshot) : null,
            latestStateVersion: snapshot?.stateVersion ?? expectedStateVersion,
            missedTurnDigests: snapshot ? await getMissedTurnDigests(campaignId, expectedStateVersion) : [],
          });
          return;
        }
        if (error instanceof InvalidExpectedStateVersionError) {
          const snapshot = await getTurnSnapshot(campaignId, sessionId);
          send({
            type: "invalid_expected_state_version",
            latestSnapshot: snapshot ? toPlayerCampaignSnapshot(snapshot) : null,
            latestStateVersion: error.latestStateVersion,
            message: error.message,
          });
          return;
        }

        throw error;
      }
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Turn submission failed.",
      },
      { status: 500 },
    );
  }
}
