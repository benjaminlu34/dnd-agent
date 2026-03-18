import { PrismaClient } from "@prisma/client";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

const datasourceUrl = process.env.DIRECT_URL?.trim() || process.env.DATABASE_URL?.trim();

if (!datasourceUrl) {
  throw new Error("Missing DIRECT_URL or DATABASE_URL for Prisma seed.");
}

const prisma = new PrismaClient({
  datasourceUrl,
});

async function main() {
  await prisma.user.upsert({
    where: { email: "solo@adventure.local" },
    update: {},
    create: {
      email: "solo@adventure.local",
      name: "Solo Adventurer",
    },
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
