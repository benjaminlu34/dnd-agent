import { NextResponse } from "next/server";
import { getCampaignSnapshot, toPlayerCampaignSnapshot } from "@/lib/game/repository";
import { triageTurn } from "@/lib/game/engine";
import { createNdjsonStream } from "@/lib/http/ndjson";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    ok: true,
    message: "Turn submission is a POST endpoint. Open / to use the app UI.",
  });
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    campaignId?: string;
    sessionId?: string;
    action?: string;
  };

  if (!body.campaignId || !body.sessionId || !body.action?.trim()) {
    return NextResponse.json({ error: "campaignId, sessionId, and action are required." }, { status: 400 });
  }

  const stream = createNdjsonStream(async (send) => {
    const bufferedNarration: string[] = [];
    const result = await triageTurn({
      campaignId: body.campaignId!,
      sessionId: body.sessionId!,
      playerAction: body.action!.trim(),
      stream: {
        narration: (chunk) => bufferedNarration.push(chunk),
      },
    });

    if (result.type === "clarification") {
      for (const warning of result.warnings) {
        send({ type: "warning", message: warning });
      }
      send({
        type: "error",
        message: `${result.question} Options: ${result.options.join(" / ")}`,
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

    const snapshot = await getCampaignSnapshot(body.campaignId!);
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
}
