import { NextResponse } from "next/server";
import { generateCampaignOpeningDraftForUser } from "@/lib/game/repository";
import { campaignOpeningDraftRequestSchema } from "@/lib/game/session-zero";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const payload = campaignOpeningDraftRequestSchema.safeParse(
    await request.json().catch(() => null),
  );

  if (!payload.success) {
    return NextResponse.json(
      {
        error: "Invalid campaign opening draft request.",
        details: payload.error.flatten(),
      },
      { status: 400 },
    );
  }

  try {
    const result = await generateCampaignOpeningDraftForUser(payload.data);

    if ("error" in result) {
      return NextResponse.json(
        {
          error:
            result.error === "module_not_found"
              ? "Selected adventure module was not found."
              : "Selected character template was not found.",
        },
        { status: 404 },
      );
    }

    return NextResponse.json({ draft: result.draft });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to generate campaign opening draft.",
      },
      { status: 500 },
    );
  }
}
