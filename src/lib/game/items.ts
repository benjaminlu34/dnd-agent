import { Prisma } from "@prisma/client";

export async function createAdHocCampaignInventoryItem(
  tx: Prisma.TransactionClient,
  input: {
    campaignId: string;
    characterInstanceId: string;
    name: string;
  },
) {
  const template = await tx.itemTemplate.create({
    data: {
      campaignId: input.campaignId,
      name: input.name,
      description: null,
      value: 0,
      weight: 0,
      rarity: "common",
      tags: [],
    },
    select: { id: true },
  });

  const itemInstance = await tx.itemInstance.create({
    data: {
      characterInstanceId: input.characterInstanceId,
      templateId: template.id,
      isIdentified: true,
      charges: null,
      properties: Prisma.JsonNull,
    },
    select: { id: true },
  });

  return {
    templateId: template.id,
    itemInstanceId: itemInstance.id,
  };
}
