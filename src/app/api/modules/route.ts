import { NextResponse } from "next/server";
import { listAdventureModules } from "@/lib/game/repository";

export const runtime = "nodejs";

export async function GET() {
  const modules = await listAdventureModules();
  return NextResponse.json({ modules });
}
