import type { Prisma } from "@prisma/client";
import type { GeneratedInformation } from "@/lib/game/types";

export function buildInformationRevealRows(input: {
  campaignId: string;
  information: GeneratedInformation[];
}) {
  const edgeRows: Prisma.InformationRevealsEdgeCreateManyInput[] = [];
  const locationRows: Prisma.InformationRevealsLocationCreateManyInput[] = [];

  for (const information of input.information) {
    for (const edgeId of new Set(information.revealsEdgeIds ?? [])) {
      edgeRows.push({
        informationId: information.id,
        edgeId,
      });
    }

    for (const locationId of new Set(information.revealsLocationIds ?? [])) {
      locationRows.push({
        informationId: information.id,
        locationId,
      });
    }
  }

  return {
    informationRevealsEdge: edgeRows,
    informationRevealsLocation: locationRows,
  };
}
