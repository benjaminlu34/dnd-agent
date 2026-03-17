import type {
  ArcRecord,
  CampaignBlueprint,
  CampaignState,
  Clue,
  NpcRecord,
  ProposedStateDelta,
  QuestRecord,
  ValidatedDelta,
} from "@/lib/game/types";
import { clamp } from "@/lib/utils";

type ValidationInput = {
  blueprint: CampaignBlueprint;
  state: CampaignState;
  quests: QuestRecord[];
  arcs: ArcRecord[];
  clues: Clue[];
  npcs: NpcRecord[];
  proposedDelta: ProposedStateDelta;
};

export function validateDelta({
  blueprint,
  state,
  quests,
  arcs,
  clues,
  npcs,
  proposedDelta,
}: ValidationInput): ValidatedDelta {
  const warnings: string[] = [];
  const nextState: CampaignState = {
    ...state,
    sceneState: {
      ...state.sceneState,
      summary: proposedDelta.sceneSummary ?? state.sceneState.summary,
      title: proposedDelta.sceneTitle ?? state.sceneState.title,
      atmosphere: proposedDelta.sceneAtmosphere ?? state.sceneState.atmosphere,
      suggestedActions:
        proposedDelta.suggestedActions?.slice(0, 4) ?? state.sceneState.suggestedActions,
    },
    villainClock: clamp(
      state.villainClock + (proposedDelta.villainClockDelta ?? 0),
      0,
      blueprint.villain.progressClock,
    ),
    tensionScore: clamp(state.tensionScore + (proposedDelta.tensionDelta ?? 0), 0, 100),
    turnCount: state.turnCount + 1,
    pendingTurnId: null,
  };

  let awardedGold = 0;
  const acceptedQuestAdvancements: NonNullable<ValidatedDelta["acceptedQuestAdvancements"]> = [];
  const acceptedClueDiscoveries: string[] = [];
  const acceptedRevealTriggers: string[] = [];
  const acceptedArcAdvancements: NonNullable<ValidatedDelta["acceptedArcAdvancements"]> = [];
  const acceptedNpcChanges: NonNullable<ValidatedDelta["acceptedNpcChanges"]> = [];
  const acceptedInventoryChanges = {
    add: [] as string[],
    remove: [] as string[],
  };

  for (const update of proposedDelta.questAdvancements ?? []) {
    const quest = quests.find((entry) => entry.id === update.questId);

    if (!quest) {
      warnings.push(`Rejected quest advancement for unknown quest ${update.questId}.`);
      continue;
    }

    if (update.nextStage < quest.stage || update.nextStage > quest.stage + 1) {
      warnings.push(`Rejected invalid quest stage jump for ${quest.title}.`);
      continue;
    }

    acceptedQuestAdvancements.push(update);

    if ((update.status ?? quest.status) === "completed" && proposedDelta.rewardQuestId === quest.id) {
      awardedGold += quest.rewardGold;
      if (quest.rewardItem) {
        acceptedInventoryChanges.add.push(quest.rewardItem);
      }
    }
  }

  if ((proposedDelta.goldChange ?? 0) > 0 && !proposedDelta.rewardQuestId) {
    warnings.push("Rejected gold gain without a validated quest reward source.");
  }

  if (proposedDelta.inventoryChanges?.add?.length || proposedDelta.inventoryChanges?.remove?.length) {
    warnings.push("Rejected direct inventory mutation. Inventory remains engine-controlled in v1.");
  }

  const clueIds = new Set(clues.map((clue) => clue.id));
  for (const clueId of proposedDelta.clueDiscoveries ?? []) {
    if (!clueIds.has(clueId)) {
      warnings.push(`Rejected unknown clue discovery ${clueId}.`);
      continue;
    }

    acceptedClueDiscoveries.push(clueId);
  }

  const discoveredClues = new Set(
    clues
      .filter((clue) => clue.status === "discovered")
      .map((clue) => clue.id)
      .concat(acceptedClueDiscoveries),
  );

  for (const revealId of proposedDelta.revealTriggers ?? []) {
    const reveal = blueprint.hiddenReveals.find((entry) => entry.id === revealId);

    if (!reveal) {
      warnings.push(`Rejected unknown reveal ${revealId}.`);
      continue;
    }

    const allCluesFound = reveal.requiredClues.every((id) => discoveredClues.has(id));
    const arcsReady = reveal.requiredArcIds.every((arcId) =>
      arcs.some((arc) => arc.id === arcId && arc.status !== "locked"),
    );

    if (!allCluesFound || !arcsReady) {
      warnings.push(`Rejected premature reveal ${reveal.title}.`);
      continue;
    }

    acceptedRevealTriggers.push(revealId);
  }

  for (const arcUpdate of proposedDelta.arcAdvancements ?? []) {
    const arc = arcs.find((entry) => entry.id === arcUpdate.arcId);

    if (!arc) {
      warnings.push(`Rejected arc update for unknown arc ${arcUpdate.arcId}.`);
      continue;
    }

    acceptedArcAdvancements.push(arcUpdate);
  }

  const npcIds = new Set(npcs.map((npc) => npc.id));
  for (const npcChange of proposedDelta.npcApprovalChanges ?? []) {
    if (!npcIds.has(npcChange.npcId)) {
      warnings.push(`Rejected NPC approval change for ${npcChange.npcId}.`);
      continue;
    }

    acceptedNpcChanges.push(npcChange);
  }

  nextState.gold += awardedGold;
  nextState.inventory = [...state.inventory, ...acceptedInventoryChanges.add];
  nextState.activeRevealIds = Array.from(
    new Set([...state.activeRevealIds, ...acceptedRevealTriggers]),
  );

  return {
    nextState,
    warnings,
    acceptedQuestAdvancements,
    acceptedClueDiscoveries,
    acceptedRevealTriggers,
    acceptedArcAdvancements,
    acceptedNpcChanges,
    awardedGold,
    acceptedInventoryChanges,
    memorySummary: proposedDelta.memorySummary,
  };
}
