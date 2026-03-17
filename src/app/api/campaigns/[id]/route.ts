import { NextResponse } from "next/server";
import { getCampaignSnapshot } from "@/lib/game/repository";
import { maybeGeneratePreviouslyOn } from "@/lib/game/engine";

export const runtime = "nodejs";

type Context = {
  params: Promise<{ id: string }>;
};

export async function GET(_: Request, context: Context) {
  const { id } = await context.params;
  const previouslyOn = await maybeGeneratePreviouslyOn(id);
  const snapshot = await getCampaignSnapshot(id, previouslyOn);

  if (!snapshot) {
    return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
  }

  return NextResponse.json({ snapshot });
}
