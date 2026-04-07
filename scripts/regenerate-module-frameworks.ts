import "./load-env";
import { dmClient } from "../src/lib/ai/provider";
import { prisma } from "../src/lib/prisma";
import { generatedWorldModuleSchema } from "../src/lib/game/session-zero";

function readFlag(flag: string) {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return null;
  }

  return process.argv[index + 1] ?? null;
}

function isLegacyFrameworkVersion(value: unknown) {
  return typeof value === "string" && value.startsWith("legacy-2d6-");
}

async function main() {
  const onlyTitle = readFlag("--module");
  const guidance = readFlag("--guidance");

  const modules = await prisma.adventureModule.findMany({
    select: {
      id: true,
      title: true,
      openWorldTemplateJson: true,
      characterFrameworkJson: true,
    },
    orderBy: { title: "asc" },
  });

  const targets = modules.filter((module) => {
    if (onlyTitle && module.title !== onlyTitle) {
      return false;
    }

    if (onlyTitle) {
      return true;
    }

    return isLegacyFrameworkVersion((module.characterFrameworkJson as { frameworkVersion?: unknown } | null)?.frameworkVersion);
  });

  if (targets.length === 0) {
    console.log("No legacy module frameworks found.");
    return;
  }

  console.log(`Regenerating character frameworks for ${targets.length} module(s).`);

  for (const module of targets) {
    console.log(`\n[${module.title}] generating framework...`);
    const parsedWorld = generatedWorldModuleSchema.parse(module.openWorldTemplateJson);
    const result = await dmClient.generateCharacterFrameworkForModule({
      module: parsedWorld,
      guidance,
    });

    await prisma.adventureModule.update({
      where: { id: module.id },
      data: {
        characterFrameworkJson: result.framework,
      },
    });

    console.log(
      `[${module.title}] saved framework ${result.framework.frameworkVersion} with approaches: ${result.framework.approaches.map((approach) => approach.label).join(", ")}`,
    );
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
