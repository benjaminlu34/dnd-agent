import { NextResponse } from "next/server";
import { retryLastTurn } from "@/lib/game/engine";
import { env } from "@/lib/env";

export const runtime = "nodejs";

type Context = {
  params: Promise<{ id: string }>;
};

export async function POST(_: Request, context: Context) {
  const { id } = await context.params;

  if (!env.enableTurnUndo) {
    return NextResponse.json(
      {
        error: "Turn undo is disabled.",
      },
      { status: 403 },
    );
  }

  try {
    await retryLastTurn(id);

    return NextResponse.json({
      ok: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Turn undo failed.";
    const status = /latest resolved turn/i.test(message) ? 409 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
