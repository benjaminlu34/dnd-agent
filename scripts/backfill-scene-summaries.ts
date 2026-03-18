import { backfillLegacySceneSummary } from "../src/lib/game/repository";
import { prisma } from "../src/lib/prisma";

async function main() {
  const campaigns = await prisma.campaign.findMany({
    select: {
      id: true,
    },
    orderBy: {
      updatedAt: "desc",
    },
  });

  let updated = 0;

  for (const campaign of campaigns) {
    const changed = await backfillLegacySceneSummary(campaign.id);
    if (changed) {
      updated += 1;
    }
  }

  console.log(
    JSON.stringify(
      {
        campaigns: campaigns.length,
        updated,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  await prisma.$disconnect();
});
