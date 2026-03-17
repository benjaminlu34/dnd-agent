import { NextResponse } from "next/server";
import { cancelPendingTurn } from "@/lib/game/engine";

export const runtime = "nodejs";

type Context = {
  params: Promise<{ id: string }>;
};

export async function GET(_: Request, context: Context) {
  const { id } = await context.params;

  return NextResponse.json({
    ok: true,
    message: `Pending turn ${id} can be cancelled with POST. Open / to use the app UI.`,
  });
}

export async function POST(_: Request, context: Context) {
  const { id } = await context.params;
  await cancelPendingTurn(id);
  return NextResponse.json({ ok: true });
}
