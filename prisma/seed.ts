import { PrismaClient } from "@prisma/client";
import { createDefaultCharacterTemplate } from "../src/lib/game/starter-data";

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

  const defaultCharacter = createDefaultCharacterTemplate();
  const existingCharacter = await prisma.character.findFirst({
    where: {
      userId: user.id,
      name: defaultCharacter.name,
      archetype: defaultCharacter.archetype,
    },
  });

  if (!existingCharacter) {
    await prisma.character.create({
      data: {
        userId: user.id,
        name: defaultCharacter.name,
        archetype: defaultCharacter.archetype,
        strength: defaultCharacter.stats.strength,
        agility: defaultCharacter.stats.agility,
        intellect: defaultCharacter.stats.intellect,
        charisma: defaultCharacter.stats.charisma,
        vitality: defaultCharacter.stats.vitality,
        maxHealth: defaultCharacter.maxHealth,
        health: defaultCharacter.health,
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
