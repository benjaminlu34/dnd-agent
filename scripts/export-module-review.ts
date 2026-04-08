import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";

type SavedModuleRow = {
  id: string;
  title: string;
  premise: string;
  tone: string;
  setting: string;
  openWorldTemplateJson: any;
  openWorldGenerationArtifactsJson: any;
  createdAt: Date;
  updatedAt: Date;
};

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function requireInput() {
  const requested = process.argv.slice(2).join(" ").trim();
  if (!requested) {
    throw new Error("Usage: node --import tsx scripts/export-module-review.ts <module id or title>");
  }
  return requested;
}

async function resolveModule(client: PrismaClient, input: string): Promise<SavedModuleRow | null> {
  const exactId = await client.adventureModule.findUnique({
    where: { id: input },
    select: {
      id: true,
      title: true,
      premise: true,
      tone: true,
      setting: true,
      openWorldTemplateJson: true,
      openWorldGenerationArtifactsJson: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  if (exactId) {
    return exactId;
  }

  const exactTitle = await client.adventureModule.findFirst({
    where: { title: { equals: input, mode: "insensitive" } },
    orderBy: [{ updatedAt: "desc" }],
    select: {
      id: true,
      title: true,
      premise: true,
      tone: true,
      setting: true,
      openWorldTemplateJson: true,
      openWorldGenerationArtifactsJson: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  if (exactTitle) {
    return exactTitle;
  }

  return client.adventureModule.findFirst({
    where: { title: { contains: input, mode: "insensitive" } },
    orderBy: [{ updatedAt: "desc" }],
    select: {
      id: true,
      title: true,
      premise: true,
      tone: true,
      setting: true,
      openWorldTemplateJson: true,
      openWorldGenerationArtifactsJson: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}

async function main() {
  const requested = requireInput();
  const client = new PrismaClient({
    datasourceUrl: process.env.DATABASE_URL,
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

  try {
    const moduleRecord = await resolveModule(client, requested);
    if (!moduleRecord) {
      throw new Error(`No saved module found for "${requested}".`);
    }

    const world = moduleRecord.openWorldTemplateJson;
    const artifacts = moduleRecord.openWorldGenerationArtifactsJson ?? null;
    const promptIntent = artifacts && typeof artifacts === "object" ? artifacts.promptIntentProfile ?? null : null;
    const stageSummaries = artifacts && typeof artifacts === "object" ? artifacts.stageSummaries ?? null : null;
    const scaleTier = artifacts && typeof artifacts === "object" ? artifacts.scaleTier ?? null : null;

    const lines: string[] = [];
    const add = (line = "") => lines.push(line);

    add(`# ${world.title}`);
    add();
    add(`Source module ID: ${moduleRecord.id}`);
    add(`Exported: ${new Date().toISOString()}`);
    add(`Created: ${new Date(moduleRecord.createdAt).toISOString()}`);
    add(`Updated: ${new Date(moduleRecord.updatedAt).toISOString()}`);
    add();

    add("## Core Summary");
    add();
    add(`- Premise: ${world.premise}`);
    add(`- Tone: ${world.tone}`);
    add(`- Setting: ${world.setting}`);
    add(`- Scale tier: ${scaleTier ?? "unknown"}`);
    add(`- Locations: ${world.locations.length}`);
    add(`- Factions: ${world.factions.length}`);
    add(`- Faction relations: ${world.factionRelations.length}`);
    add(`- NPCs: ${world.npcs.length}`);
    add(`- Information nodes: ${world.information.length}`);
    add(`- Information links: ${world.informationLinks.length}`);
    add(`- Commodities: ${world.commodities.length}`);
    add(`- Market prices: ${world.marketPrices.length}`);
    add(`- Entry points: ${world.entryPoints.length}`);
    add();

    if (promptIntent) {
      add("## Prompt Intent Profile");
      add();
      add(`- Primary texture modes: ${(promptIntent.primaryTextureModes ?? []).join(", ")}`);
      add(`- Primary causal logic: ${promptIntent.primaryCausalLogic ?? ""}`);
      add(`- Magic integration: ${promptIntent.magicIntegration ?? ""}`);
      add(`- Social emphasis: ${promptIntent.socialEmphasis ?? ""}`);
      add(`- Confidence: ${promptIntent.confidence ?? ""}`);
      add();
    }

    if (stageSummaries && typeof stageSummaries === "object") {
      add("## Stage Summaries");
      add();
      for (const [stage, summary] of Object.entries(stageSummaries)) {
        add(`- ${stage}: ${summary}`);
      }
      add();
    }

    if (world.characterFramework) {
      add("## Character Framework");
      add();
      add(`- Framework version: ${world.characterFramework.frameworkVersion}`);
      add(`- Base vitality: ${world.characterFramework.baseVitality}`);
      add(`- Vitality label: ${world.characterFramework.vitalityLabel}`);
      add(
        `- Currency: ${world.characterFramework.currencyProfile.unitLabel} (${world.characterFramework.currencyProfile.shortLabel})`,
      );
      add();
      add("### Fields");
      add();
      for (const field of world.characterFramework.fields) {
        const range = "min" in field ? `${field.min}..${field.max}` : "n/a";
        const defaultValue = "defaultValue" in field ? `${field.defaultValue ?? "none"}` : "none";
        add(`- ${field.label} [${field.id}] | type=${field.type} | range=${range} | default=${defaultValue}`);
      }
      add();
    }

    add("## Locations");
    add();
    for (const location of world.locations) {
      add(`### ${location.name}`);
      add();
      add(`- ID: ${location.id}`);
      add(`- Type: ${location.type}`);
      add(`- State: ${location.state}`);
      add(`- Controlling faction ID: ${location.controllingFactionId ?? "independent/none"}`);
      add(`- Tags: ${location.tags.join(", ")}`);
      add(`- Summary: ${location.summary}`);
      add(`- Description: ${location.description}`);
      add();
    }

    add("## Edges");
    add();
    for (const edge of world.edges) {
      add(
        `- ${edge.id}: ${edge.sourceId} -> ${edge.targetId} | ${edge.travelTimeMinutes} min | danger ${edge.dangerLevel} | ${edge.currentStatus} | visibility=${edge.visibility}${edge.accessRequirementText ? ` | access=${edge.accessRequirementText}` : ""}${edge.description ? ` | ${edge.description}` : ""}`,
      );
    }
    add();

    add("## Factions");
    add();
    for (const faction of world.factions) {
      add(`### ${faction.name}`);
      add();
      add(`- ID: ${faction.id}`);
      add(`- Type: ${faction.type}`);
      add(`- Summary: ${faction.summary}`);
      add(`- Agenda: ${faction.agenda}`);
      add(
        `- Resources: gold ${faction.resources.gold}, military ${faction.resources.military}, influence ${faction.resources.influence}, information ${faction.resources.information}`,
      );
      add(`- Pressure clock: ${faction.pressureClock}`);
      add();
    }

    add("## Faction Relations");
    add();
    for (const relation of world.factionRelations) {
      add(`- ${relation.id}: ${relation.factionAId} <-> ${relation.factionBId} | ${relation.stance}`);
    }
    add();

    add("## NPCs");
    add();
    for (const npc of world.npcs) {
      add(`### ${npc.name}`);
      add();
      add(`- ID: ${npc.id}`);
      add(`- Role: ${npc.role}`);
      add(`- Faction ID: ${npc.factionId ?? "none"}`);
      add(`- Current location ID: ${npc.currentLocationId}`);
      add(`- Approval: ${npc.approval}`);
      add(`- Companion: ${npc.isCompanion ? "yes" : "no"}`);
      add(`- Summary: ${npc.summary}`);
      add(`- Description: ${npc.description}`);
      add();
    }

    add("## Information Nodes");
    add();
    for (const info of world.information) {
      add(`### ${info.title}`);
      add();
      add(`- ID: ${info.id}`);
      add(`- Truthfulness: ${info.truthfulness}`);
      add(`- Accessibility: ${info.accessibility}`);
      add(`- Location ID: ${info.locationId ?? "none"}`);
      add(`- Faction ID: ${info.factionId ?? "none"}`);
      add(`- Source NPC ID: ${info.sourceNpcId ?? "none"}`);
      add(`- Summary: ${info.summary}`);
      add(`- Content: ${info.content}`);
      add(`- Reveals edge IDs: ${info.revealsEdgeIds.length ? info.revealsEdgeIds.join(", ") : "none"}`);
      add(
        `- Reveals location IDs: ${info.revealsLocationIds.length ? info.revealsLocationIds.join(", ") : "none"}`,
      );
      add();
    }

    add("## Information Links");
    add();
    for (const link of world.informationLinks) {
      add(`- ${link.id}: ${link.sourceId} -> ${link.targetId} | ${link.linkType}`);
    }
    add();

    add("## Commodities");
    add();
    for (const commodity of world.commodities) {
      add(`### ${commodity.name}`);
      add();
      add(`- ID: ${commodity.id}`);
      add(`- Base value: ${commodity.baseValue}`);
      add(`- Tags: ${commodity.tags.join(" | ")}`);
      add();
    }

    add("## Market Prices");
    add();
    for (const price of world.marketPrices) {
      add(
        `- ${price.id}: commodity=${price.commodityId} | location=${price.locationId} | vendor=${price.vendorNpcId ?? "none"} | faction=${price.factionId ?? "none"} | modifier=${price.modifier} | stock=${price.stock} | legal=${price.legalStatus}`,
      );
    }
    add();

    add("## Entry Points");
    add();
    if (world.entryPoints.length === 0) {
      add("- None generated.");
    } else {
      for (const entry of world.entryPoints) {
        add(`### ${entry.title}`);
        add();
        add(`- ID: ${entry.id}`);
        add(`- Start location ID: ${entry.startLocationId}`);
        add(`- Present NPC IDs: ${entry.presentNpcIds.join(", ")}`);
        add(`- Initial information IDs: ${entry.initialInformationIds.join(", ")}`);
        add(`- Summary: ${entry.summary}`);
        add();
      }
    }

    await mkdir("docs/module-exports", { recursive: true });
    const outputPath = `docs/module-exports/${slugify(world.title)}-review.md`;
    await writeFile(outputPath, lines.join("\n"));
    console.log(outputPath);
  } finally {
    await client.$disconnect();
  }
}

void main();
