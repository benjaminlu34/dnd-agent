import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  buildArcRecordsFromBlueprint,
  buildCampaignBlueprintFromSetup,
  buildCampaignStateFromSetup,
  buildClueRecordsFromSetup,
  buildNpcRecordsFromSetup,
  buildQuestRecordsFromSetup,
} from "@/lib/game/campaign-setup";
import { campaignCreateRequestSchema } from "@/lib/game/session-zero";
import { ensureDefaultCharacter, ensureLocalUser } from "@/lib/game/repository";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const payload = campaignCreateRequestSchema.safeParse(await request.json().catch(() => null));

  if (!payload.success) {
    return NextResponse.json(
      {
        error: "Invalid campaign creation request.",
        details: payload.error.flatten(),
      },
      { status: 400 },
    );
  }

  try {
    const [user, character] = await Promise.all([ensureLocalUser(), ensureDefaultCharacter()]);
    const blueprint = buildCampaignBlueprintFromSetup(payload.data.draft);
    const state = buildCampaignStateFromSetup(payload.data.draft, blueprint);
    const quests = buildQuestRecordsFromSetup(payload.data.draft);
    const arcs = buildArcRecordsFromBlueprint(blueprint);
    const npcs = buildNpcRecordsFromSetup(payload.data.draft);
    const clues = buildClueRecordsFromSetup(payload.data.draft, blueprint);
    const openingScene = payload.data.draft.publicSynopsis.openingScene;

    const campaign = await prisma.campaign.create({
      data: {
        userId: user.id,
        characterId: character.id,
        title: payload.data.draft.publicSynopsis.title,
        premise: blueprint.premise,
        tone: blueprint.tone,
        setting: blueprint.setting,
        blueprint,
        stateJson: state,
        sessions: {
          create: {
            title: "Session 1",
            status: "active",
            messages: {
              create: {
                role: "assistant",
                kind: "narration",
                content: openingScene.summary,
              },
            },
          },
        },
        ...(quests.length
          ? {
              quests: {
                createMany: {
                  data: quests.map((quest) => ({
                    id: quest.id,
                    title: quest.title,
                    summary: quest.summary,
                    stage: quest.stage,
                    maxStage: quest.maxStage,
                    status: quest.status,
                    rewardGold: quest.rewardGold,
                    rewardItem: quest.rewardItem,
                  })),
                },
              },
            }
          : {}),
        ...(arcs.length
          ? {
              arcs: {
                createMany: {
                  data: arcs.map((arc) => ({
                    id: arc.id,
                    title: arc.title,
                    summary: arc.summary,
                    status: arc.status,
                    expectedTurns: arc.expectedTurns,
                    currentTurn: arc.currentTurn,
                    orderIndex: arc.orderIndex,
                  })),
                },
              },
            }
          : {}),
        ...(npcs.length
          ? {
              npcs: {
                createMany: {
                  data: npcs.map((npc) => ({
                    id: npc.id,
                    name: npc.name,
                    role: npc.role,
                    status: npc.status,
                    isCompanion: npc.isCompanion,
                    approval: npc.approval,
                    personalHook: npc.personalHook,
                    notes: npc.notes,
                  })),
                },
              },
            }
          : {}),
        ...(clues.length
          ? {
              clues: {
                createMany: {
                  data: clues.map((clue) => ({
                    id: clue.id,
                    linkedRevealId: clue.linkedRevealId,
                    text: clue.text,
                    source: clue.source,
                    status: clue.status,
                    discoveredAtTurn: clue.discoveredAtTurn,
                  })),
                },
              },
            }
          : {}),
      },
      select: { id: true },
    });

    return NextResponse.json({ campaignId: campaign.id });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to create campaign.",
      },
      { status: 500 },
    );
  }
}
