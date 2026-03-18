import { getCampaignSnapshot, toPlayerCampaignSnapshot } from "@/lib/game/repository";
import { resolvePendingCheck } from "@/lib/game/engine";
import { createNdjsonStream } from "@/lib/http/ndjson";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type Context = {
  params: Promise<{ id: string }>;
};

export async function GET(_: Request, context: Context) {
  const { id } = await context.params;

  return Response.json({
    ok: true,
    message: `Check resolution for turn ${id} is a POST endpoint. Open / to use the app UI.`,
  });
}

export async function POST(_: Request, context: Context) {
  const { id } = await context.params;

  const stream = createNdjsonStream(async (send) => {
    const turn = await prisma.turn.findUnique({
      where: { id },
      select: { campaignId: true },
    });

    const result = await resolvePendingCheck({
      turnId: id,
      stream: {
        checkResult: (result) =>
          send({
            type: "check_result",
            result: result as unknown as Record<string, unknown>,
          }),
        narration: (chunk) => send({ type: "narration", chunk }),
      },
    });

    for (const warning of result.warnings) {
      send({ type: "warning", message: warning });
    }

    send({
      type: "actions",
      actions: result.suggestedActions,
    });

    const snapshot = turn ? await getCampaignSnapshot(turn.campaignId) : null;

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
