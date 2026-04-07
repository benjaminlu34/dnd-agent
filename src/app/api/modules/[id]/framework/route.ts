import { NextResponse } from "next/server";
import { z } from "zod";
import { dmClient } from "@/lib/ai/provider";
import {
  getAdventureModuleWorldForUser,
  updateAdventureModuleFrameworkForUser,
} from "@/lib/game/repository";

export const runtime = "nodejs";

const regenerateModuleFrameworkRequestSchema = z.object({
  prompt: z.string().trim().min(1).max(4000),
});

type Context = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  const payload = regenerateModuleFrameworkRequestSchema.safeParse(await request.json().catch(() => null));

  if (!payload.success) {
    return NextResponse.json(
      {
        error: "Invalid framework regeneration request.",
        details: payload.error.flatten(),
      },
      { status: 400 },
    );
  }

  try {
    const module = await getAdventureModuleWorldForUser(id);
    if (!module) {
      return NextResponse.json(
        { error: "Adventure module not found." },
        { status: 404 },
      );
    }

    const result = await dmClient.generateCharacterFrameworkForModule({
      module,
      guidance: payload.data.prompt,
    });

    const updatedModule = await updateAdventureModuleFrameworkForUser(id, result.framework);
    if (!updatedModule) {
      return NextResponse.json(
        { error: "Adventure module not found." },
        { status: 404 },
      );
    }

    return NextResponse.json({
      module: updatedModule,
      source: result.source,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to regenerate module framework.",
      },
      { status: 500 },
    );
  }
}
