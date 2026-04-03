import { NextResponse } from "next/server";
import { resolvePendingCheck } from "@/lib/game/engine";
import { getTurnSnapshot, issueSnapshotPromptContext, toPlayerCampaignSnapshot } from "@/lib/game/repository";
import { createNdjsonStream } from "@/lib/http/ndjson";
import { StalePromptContextError, TurnLockedError } from "@/lib/game/errors";
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
          const latestSnapshot = await getTurnSnapshot(body.campaignId!, body.sessionId!);
          const hydratedSnapshot = latestSnapshot ? await issueSnapshotPromptContext(latestSnapshot) : null;
          send({
            type: "state_conflict",
            latestSnapshot: hydratedSnapshot ? toPlayerCampaignSnapshot(hydratedSnapshot) : result.payload.latestSnapshot,
            latestStateVersion: result.payload.latestStateVersion,
            missedTurnDigests: result.payload.missedTurnDigests,
          });
          return;
        }

        send({
          type: "actions",
          actions: result.suggestedActions,
        });

        const snapshot = await getTurnSnapshot(body.campaignId!, body.sessionId!);
        if (snapshot) {
          const hydratedSnapshot = await issueSnapshotPromptContext(snapshot);
          send({
            type: "state",
            snapshot: toPlayerCampaignSnapshot(hydratedSnapshot),
          });
        }
      } catch (error) {
        if (error instanceof TurnLockedError) {
          send({ type: "error", message: error.message });
          return;
        }
        if (error instanceof StalePromptContextError) {
          const snapshot = await getTurnSnapshot(body.campaignId!, body.sessionId!);
          const hydratedSnapshot = snapshot ? await issueSnapshotPromptContext(snapshot) : null;
          if (hydratedSnapshot) {
            send({
              type: "stale_prompt_context",
              error: "stale_prompt_context",
              latestSnapshot: toPlayerCampaignSnapshot(hydratedSnapshot),
              message: "stale_prompt_context",
            });
            return;
          }
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
