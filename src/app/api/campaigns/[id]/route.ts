import { NextResponse } from "next/server";
import {
  getCampaignSnapshot,
  toPlayerCampaignSnapshot,
  deleteCampaignForUser,
  renameCampaignForUser,
} from "@/lib/game/repository";

export const runtime = "nodejs";

type Context = {
  params: Promise<{ id: string }>;
};

export async function GET(_: Request, context: Context) {
  const { id } = await context.params;
  const snapshot = await getCampaignSnapshot(id);

  if (!snapshot) {
    return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
  }

  return NextResponse.json({
    snapshot: toPlayerCampaignSnapshot(snapshot),
  });
}

export async function DELETE(_: Request, context: Context) {
  const { id } = await context.params;
  const result = await deleteCampaignForUser(id);

  if (!result) {
    return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
  }

  return NextResponse.json(result);
}

export async function PATCH(request: Request, context: Context) {
  const { id } = await context.params;
  const { title } = await request.json();

  if (!title || typeof title !== "string") {
    return NextResponse.json({ error: "Title is required and must be a string" }, { status: 400 });
  }

  const result = await renameCampaignForUser(id, title);

  if (!result) {
    return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
  }

  return NextResponse.json(result);
}
