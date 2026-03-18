import { NextResponse } from "next/server";
import { retryLastTurn } from "@/lib/game/engine";
import { toPlayerCampaignSnapshot } from "@/lib/game/repository";

export const runtime = "nodejs";

type Context = {
  params: Promise<{ id: string }>;
};

export async function GET(_: Request, context: Context) {
  const { id } = await context.params;

  return NextResponse.json({
    ok: true,
    message: `Turn ${id} can be retried with POST if it is the latest resolved turn.`,
  });
}

export async function POST(_: Request, context: Context) {
  const { id } = await context.params;
  const snapshot = await retryLastTurn(id);

  if (!snapshot) {
    return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
  }

  return NextResponse.json({ snapshot: toPlayerCampaignSnapshot(snapshot) });
}
