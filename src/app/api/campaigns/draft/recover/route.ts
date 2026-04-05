import { NextResponse } from "next/server";
import type {
  OpenWorldGenerationArtifacts,
  OpenWorldGenerationCheckpoint,
  GeneratedKnowledgeNetworkStage,
} from "@/lib/game/types";
import { findRecoverableDraftGenerationCheckpoint } from "@/lib/game/world-generation-progress";

export const runtime = "nodejs";

function buildArtifactsFromCheckpoint(
  checkpoint: OpenWorldGenerationCheckpoint,
): OpenWorldGenerationArtifacts | null {
  const worldBible = checkpoint.stageArtifacts.world_bible;
  const worldSpine = checkpoint.stageArtifacts.world_spine;
  const regionalLife = checkpoint.stageArtifacts.regional_life;
  const socialLayer = checkpoint.stageArtifacts.social_cast;
  const knowledgeWeb = checkpoint.stageArtifacts.knowledge_web;
  const knowledgeThreads = checkpoint.stageArtifacts.knowledge_threads;
  const economyMaterialLife = checkpoint.stageArtifacts.economy_material_life;
  const draft = checkpoint.stageArtifacts.final_world;

  if (
    !worldBible
    || !worldSpine
    || !regionalLife
    || !socialLayer
    || !knowledgeWeb
    || !knowledgeThreads
    || !economyMaterialLife
    || !draft
  ) {
    return null;
  }

  return {
    prompt: checkpoint.prompt,
    model: checkpoint.model,
    createdAt: checkpoint.createdAt,
    scaleTier: checkpoint.scaleTier,
    scalePlan: checkpoint.scalePlan,
    worldBible,
    worldSpine,
    regionalLife,
    socialLayer,
    knowledgeEconomy: {
      information: draft.information,
      informationLinks: draft.informationLinks,
      knowledgeNetworks: knowledgeThreads.knowledgeNetworks.map((network: GeneratedKnowledgeNetworkStage) => ({
        theme: network.theme,
        publicBeliefs: network.publicBeliefs,
        hiddenTruth: network.hiddenTruth,
        linkedInformationIds: network.linkedInformationKeys
          .map((informationKey: string) => checkpoint.idMaps.information[informationKey])
          .filter((id): id is string => typeof id === "string" && id.length > 0),
        contradictionThemes: network.contradictionThemes,
      })),
      pressureSeeds: knowledgeThreads.pressureSeeds,
      commodities: draft.commodities,
      marketPrices: draft.marketPrices,
      locationTradeIdentity: economyMaterialLife.locationTradeIdentity,
    },
    attempts: checkpoint.attempts,
    validationReports: checkpoint.validationReports,
    idMaps: checkpoint.idMaps,
    stageSummaries: checkpoint.stageSummaries,
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const progressId = searchParams.get("progressId");
  const recovered = findRecoverableDraftGenerationCheckpoint(progressId);

  if (!recovered) {
    return NextResponse.json(
      {
        error: progressId
          ? `No recoverable completed draft found for progressId ${progressId}.`
          : "No recoverable completed draft found.",
      },
      { status: 404 },
    );
  }

  const artifacts = buildArtifactsFromCheckpoint(recovered.checkpoint);
  if (!artifacts || !recovered.checkpoint.stageArtifacts.final_world) {
    return NextResponse.json(
      {
        error: "Recovered checkpoint is missing required stage artifacts.",
      },
      { status: 409 },
    );
  }

  return NextResponse.json({
    progressId: recovered.id,
    draft: recovered.checkpoint.stageArtifacts.final_world,
    artifacts,
  });
}
