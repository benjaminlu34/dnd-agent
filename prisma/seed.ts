import { PrismaClient } from "@prisma/client";
import {
  createDefaultAdventureModuleSetup,
  createDefaultCharacterTemplate,
} from "../src/lib/game/starter-data";

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
  const existingCharacter = await prisma.characterTemplate.findFirst({
    where: {
      userId: user.id,
      name: defaultCharacter.name,
      archetype: defaultCharacter.archetype,
    },
  });

  if (!existingCharacter) {
    await prisma.characterTemplate.create({
      data: {
        userId: user.id,
        name: defaultCharacter.name,
        archetype: defaultCharacter.archetype,
        strength: defaultCharacter.strength,
        agility: defaultCharacter.agility,
        intellect: defaultCharacter.intellect,
        charisma: defaultCharacter.charisma,
        vitality: defaultCharacter.vitality,
        maxHealth: defaultCharacter.maxHealth,
        backstory: defaultCharacter.backstory ?? null,
      },
    });
  }

  const defaultModule = createDefaultAdventureModuleSetup();
  const existingModule = await prisma.adventureModule.findFirst({
    where: {
      userId: user.id,
      title: defaultModule.publicSynopsis.title,
    },
  });

  if (!existingModule) {
    await prisma.adventureModule.create({
      data: {
        userId: user.id,
        title: defaultModule.publicSynopsis.title,
        publicSynopsis: defaultModule.publicSynopsis,
        secretEngine: defaultModule.secretEngine,
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
