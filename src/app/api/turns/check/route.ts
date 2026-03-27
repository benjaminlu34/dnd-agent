import { NextResponse } from "next/server";
import { resolvePendingCheck } from "@/lib/game/engine";
import { getTurnSnapshot, toPlayerCampaignSnapshot } from "@/lib/game/repository";
import { createNdjsonStream } from "@/lib/http/ndjson";
import { TurnLockedError } from "@/lib/game/errors";
import type { ResolvePendingCheckRequest } from "@/lib/game/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = (await request.json()) as Partial<ResolvePendingCheckRequest>;

  if (
    !body.campaignId
    || !body.sessionId
    || !body.requestId
    || !body.pendingTurnId
    || !Array.isArray(body.rolls)
    || body.rolls.length !== 2
  ) {
    return NextResponse.json(
      { error: "campaignId, sessionId, requestId, pendingTurnId, and two rolls are required." },
      { status: 400 },
    );
  }

  const first = Number(body.rolls[0]);
  const second = Number(body.rolls[1]);
  if (!Number.isInteger(first) || !Number.isInteger(second)) {
    return NextResponse.json(
      { error: "rolls must be integer 2d6 totals." },
      { status: 400 },
    );
  }

  try {
    const stream = createNdjsonStream(async (send) => {
      try {
        const result = await resolvePendingCheck({
          campaignId: body.campaignId!,
          sessionId: body.sessionId!,
          requestId: body.requestId!,
          pendingTurnId: body.pendingTurnId!,
          rolls: [first, second],
          stream: {
            narration: (chunk) => send({ type: "narration", chunk }),
            warning: (message) => send({ type: "warning", message }),
            checkResult: (checkResult) => send({ type: "check_result", result: checkResult }),
          },
        });

        if (result.type === "check_required") {
          for (const warning of result.warnings) {
            send({ type: "warning", message: warning });
          }
          send({
            type: "check_required",
            turnId: result.turnId,
            check: result.check,
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

        send({
          type: "actions",
          actions: result.suggestedActions,
        });

        const snapshot = await getTurnSnapshot(body.campaignId!, body.sessionId!);
        if (snapshot) {
          send({
            type: "state",
            snapshot: toPlayerCampaignSnapshot(snapshot),
          });
        }
      } catch (error) {
        if (error instanceof TurnLockedError) {
          send({ type: "error", message: error.message });
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
      { error: error instanceof Error ? error.message : "Pending check resolution failed." },
      { status: 500 },
    );
  }
}
