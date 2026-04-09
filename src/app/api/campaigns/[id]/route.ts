import { NextResponse } from "next/server";
import {
  getCampaignRuntimeStatus,
  getCampaignSnapshot,
  issueSnapshotPromptContext,
  toPlayerCampaignSnapshot,
  deleteCampaignForUser,
  renameCampaignForUser,
} from "@/lib/game/repository";

export const runtime = "nodejs";

type Context = {
  params: Promise<{ id: string }>;
};

export async function GET(_: Request, context: Context) {
  const { id } = await context.params;
  const runtimeStatus = await getCampaignRuntimeStatus(id);

  if (!runtimeStatus) {
    return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
  }

  if (!runtimeStatus.playable) {
    const isDescentFailure = runtimeStatus.descentStatus === "descent_failed";
    return NextResponse.json(
      {
        error: isDescentFailure
          ? "This campaign's descent failed. Regenerate it before trying to enter play."
          : "This campaign has completed world-to-region descent but still needs settlement descent before it can enter play.",
        code: isDescentFailure
          ? "CAMPAIGN_DESCENT_FAILED"
          : "CAMPAIGN_AWAITING_SETTLEMENT_DESCENT",
        descentStatus: runtimeStatus.descentStatus,
      },
      { status: 409 },
    );
  }

  const snapshot = await getCampaignSnapshot(id);

  if (!snapshot) {
    return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
  }

  const hydratedSnapshot = await issueSnapshotPromptContext(snapshot);

  return NextResponse.json({
    snapshot: toPlayerCampaignSnapshot(hydratedSnapshot),
  });
}

export async function DELETE(_: Request, context: Context) {
  const { id } = await context.params;
  const result = await deleteCampaignForUser(id);

  if (!result) {
    return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
  }

  return NextResponse.json(result);
}

export async function PATCH(request: Request, context: Context) {
  const { id } = await context.params;
  const { title } = await request.json();

  if (!title || typeof title !== "string") {
    return NextResponse.json({ error: "Title is required and must be a string" }, { status: 400 });
  }

  const result = await renameCampaignForUser(id, title);

  if (!result) {
    return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
  }

  return NextResponse.json(result);
}
