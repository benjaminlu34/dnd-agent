import { NextResponse } from "next/server";
import { revisePendingTurn } from "@/lib/game/engine";

export const runtime = "nodejs";

type Context = {
  params: Promise<{ id: string }>;
};

export async function GET(_: Request, context: Context) {
  const { id } = await context.params;

  return NextResponse.json({
    ok: true,
    message: `Pending turn ${id} can be revised with POST while it awaits a check.`,
  });
}

export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as { action?: string } | null;

  if (!body?.action?.trim()) {
    return NextResponse.json({ error: "Edited action is required." }, { status: 400 });
  }

  const check = await revisePendingTurn({
    turnId: id,
    playerAction: body.action.trim(),
  });

  return NextResponse.json({ check });
}
