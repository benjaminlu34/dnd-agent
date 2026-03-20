import { NextResponse } from "next/server";
import { createAdventureModule } from "@/lib/game/repository";
import { moduleCreateRequestSchema } from "@/lib/game/session-zero";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const payload = moduleCreateRequestSchema.safeParse(await request.json().catch(() => null));

  if (!payload.success) {
    return NextResponse.json(
      {
        error: "Invalid module creation request.",
        details: payload.error.flatten(),
      },
      { status: 400 },
    );
  }

  try {
    const adventureModule = await createAdventureModule({
      draft: payload.data.draft,
      artifacts: payload.data.artifacts,
    });
    return NextResponse.json({ moduleId: adventureModule.id, module: adventureModule });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to create adventure module.",
      },
      { status: 500 },
    );
  }
}
