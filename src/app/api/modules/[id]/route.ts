import { NextResponse } from "next/server";
import { deleteAdventureModuleForUser } from "@/lib/game/repository";

export const runtime = "nodejs";

type Context = {
  params: Promise<{ id: string }>;
};

export async function DELETE(_: Request, context: Context) {
  const { id } = await context.params;

  try {
    const deleted = await deleteAdventureModuleForUser(id);

    if (!deleted) {
      return NextResponse.json(
        { error: "Adventure module not found." },
        { status: 404 },
      );
    }

    return NextResponse.json(deleted);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to delete adventure module.",
      },
      { status: 500 },
    );
  }
}
