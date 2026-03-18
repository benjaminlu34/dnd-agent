import { NextResponse } from "next/server";
import { getCampaignSnapshot, toPlayerCampaignSnapshot } from "@/lib/game/repository";
import { maybeGeneratePreviouslyOn } from "@/lib/game/engine";

export const runtime = "nodejs";

type Context = {
  params: Promise<{ id: string }>;
};

export async function GET(_: Request, context: Context) {
  const { id } = await context.params;
  const snapshot = await getCampaignSnapshot(id);

  if (!snapshot) {
    return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
  }

  const previouslyOn = await maybeGeneratePreviouslyOn(snapshot);

  return NextResponse.json({
    snapshot: toPlayerCampaignSnapshot(snapshot, previouslyOn),
  });
}
