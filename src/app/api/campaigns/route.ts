import { NextResponse } from "next/server";
import { listCampaigns } from "@/lib/game/repository";

export const runtime = "nodejs";

export async function GET() {
  const campaigns = await listCampaigns();
  return NextResponse.json({ campaigns });
}
