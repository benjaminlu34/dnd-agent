import { NextResponse } from "next/server";
import { dmClient } from "@/lib/ai/provider";
import { characterGenerateRequestSchema } from "@/lib/game/characters";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const payload = characterGenerateRequestSchema.safeParse(await request.json().catch(() => null));

  if (!payload.success) {
    return NextResponse.json(
      {
        error: "Invalid character generation request.",
        details: payload.error.flatten(),
      },
      { status: 400 },
    );
  }

  try {
    const character = await dmClient.generateCharacter(payload.data.prompt);
    return NextResponse.json({ character });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to generate character.",
      },
      { status: 500 },
    );
  }
}
