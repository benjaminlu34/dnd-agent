import { NextResponse } from "next/server";
import { summarizeSession } from "@/lib/game/engine";

export const runtime = "nodejs";

type Context = {
  params: Promise<{ id: string }>;
};

export async function POST(_: Request, context: Context) {
  const { id } = await context.params;
  const summary = await summarizeSession(id);
  return NextResponse.json({ summary });
}
