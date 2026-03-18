import { NextResponse } from "next/server";
import {
  deleteAdventureModuleForUser,
  getAdventureModuleForUser,
} from "@/lib/game/repository";

export const runtime = "nodejs";

type Context = {
  params: Promise<{ id: string }>;
};

export async function GET(_: Request, context: Context) {
  const { id } = await context.params;

  try {
    const adventureModule = await getAdventureModuleForUser(id);

    if (!adventureModule) {
      return NextResponse.json(
        { error: "Adventure module not found." },
        { status: 404 },
      );
    }

    return NextResponse.json({
      module: {
        id: adventureModule.id,
        title: adventureModule.setup.publicSynopsis.title,
        premise: adventureModule.setup.publicSynopsis.premise,
        tone: adventureModule.setup.publicSynopsis.tone,
        setting: adventureModule.setup.publicSynopsis.setting,
        createdAt: adventureModule.createdAt,
        updatedAt: adventureModule.updatedAt,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to load adventure module.",
      },
      { status: 500 },
    );
  }
}

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
