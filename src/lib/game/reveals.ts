import type {
  ArcRecord,
  CampaignBlueprint,
  Clue,
} from "@/lib/game/types";

export function getEligibleRevealIds(
  blueprint: CampaignBlueprint,
  clues: Clue[],
  arcs: ArcRecord[],
) {
  const discovered = new Set(
    clues.filter((clue) => clue.status === "discovered").map((clue) => clue.id),
  );

  return blueprint.hiddenReveals
    .filter((reveal) => {
      const allCluesFound = reveal.requiredClues.every((id) => discovered.has(id));
      const arcsReady = reveal.requiredArcIds.every((id) =>
        arcs.some((arc) => arc.id === id && arc.status !== "locked"),
      );
      return allCluesFound && arcsReady && !reveal.triggered;
    })
    .map((reveal) => reveal.id);
}

export function getRevealText(blueprint: CampaignBlueprint, revealId: string) {
  return blueprint.hiddenReveals.find((reveal) => reveal.id === revealId)?.truth;
}

export function getStaleClues(clues: Clue[], turnCount: number) {
  return clues.filter(
    (clue) =>
      clue.status === "discovered" &&
      clue.discoveredAtTurn !== null &&
      turnCount - clue.discoveredAtTurn >= 10,
  );
}

export function getArcPacingHint(arcs: ArcRecord[]) {
  const activeArc = arcs.find((arc) => arc.status === "active");

  if (!activeArc) {
    return null;
  }

  if (activeArc.expectedTurns === 0) {
    return null;
  }

  const ratio = activeArc.currentTurn / activeArc.expectedTurns;

  if (ratio >= 0.8) {
    return `ARC ENDING SOON: ${activeArc.title} should conclude within the next 2-3 turns.`;
  }

  return null;
}
