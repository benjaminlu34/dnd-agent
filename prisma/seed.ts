import { PrismaClient } from "@prisma/client";
import { createSeededDummyCharacter } from "../src/lib/game/starter-data";

const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.upsert({
    where: { email: "solo@adventure.local" },
    update: {},
    create: {
      email: "solo@adventure.local",
      name: "Solo Adventurer",
    },
  });

  const seeded = createSeededDummyCharacter();
  const existingCharacter = await prisma.character.findFirst({
    where: {
      userId: user.id,
      name: seeded.name,
      archetype: seeded.archetype,
    },
  });

  if (!existingCharacter) {
    await prisma.character.create({
      data: {
        userId: user.id,
        name: seeded.name,
        archetype: seeded.archetype,
        strength: seeded.stats.strength,
        agility: seeded.stats.agility,
        intellect: seeded.stats.intellect,
        charisma: seeded.stats.charisma,
        vitality: seeded.stats.vitality,
        maxHealth: seeded.maxHealth,
        health: seeded.health,
      },
    });
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
