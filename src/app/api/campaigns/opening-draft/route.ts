import { NextResponse } from "next/server";
import { generateCampaignOpeningDraftForUser } from "@/lib/game/repository";
import { campaignOpeningDraftRequestSchema } from "@/lib/game/session-zero";

export const runtime = "nodejs";

function moduleRequiresDescentMessage(launchBlockReason: string) {
  if (launchBlockReason === "requires_region_materialization") {
    return "This module requires region-to-settlement descent before it can launch.";
  }

  return "This module requires world-to-region descent before it can launch.";
}

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
      if (result.error === "module_requires_descent") {
        return NextResponse.json(
          {
            error: moduleRequiresDescentMessage(result.launchBlockReason),
            code: "MODULE_REQUIRES_DESCENT",
          },
          { status: 409 },
        );
      }

      return NextResponse.json(
        {
          error:
            result.error === "module_not_found"
              ? "Selected adventure module was not found."
              : result.error === "template_incompatible"
                ? "Selected character template is not compatible with that module."
                : "Selected character template was not found.",
        },
        { status: result.error === "template_incompatible" ? 409 : 404 },
      );
    }

    return NextResponse.json({
      draft: result.draft,
      preparedLaunch: result.preparedLaunch,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to generate campaign opening draft.",
      },
      { status: 500 },
    );
  }
}
