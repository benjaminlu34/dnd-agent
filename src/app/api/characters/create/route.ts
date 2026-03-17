import { NextResponse } from "next/server";
import { characterTemplateDraftSchema } from "@/lib/game/characters";
import { createCharacterTemplate } from "@/lib/game/repository";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const payload = characterTemplateDraftSchema.safeParse(await request.json().catch(() => null));

  if (!payload.success) {
    return NextResponse.json(
      {
        error: "Invalid character creation request.",
        details: payload.error.flatten(),
      },
      { status: 400 },
    );
  }

  try {
    const template = await createCharacterTemplate(payload.data);
    return NextResponse.json({ templateId: template.id });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to save character.",
      },
      { status: 500 },
    );
  }
}
