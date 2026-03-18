import type {
  ArcRecord,
  CampaignCharacter,
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
  character: CampaignCharacter;
  quests: QuestRecord[];
  arcs: ArcRecord[];
  clues: Clue[];
  npcs: NpcRecord[];
  proposedDelta: ProposedStateDelta;
};

export function validateDelta({
  blueprint,
  state,
  character,
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
    activeArcId: proposedDelta.activeArcId ?? state.activeArcId,
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
  const acceptedQuestDiscoveries: string[] = [];
  const acceptedClueDiscoveries: string[] = [];
  const acceptedRevealTriggers: string[] = [];
  const acceptedArcAdvancements: NonNullable<ValidatedDelta["acceptedArcAdvancements"]> = [];
  const acceptedNpcChanges: NonNullable<ValidatedDelta["acceptedNpcChanges"]> = [];
  const acceptedNpcDiscoveries: string[] = [];
  const acceptedInventoryChanges = {
    add: [] as string[],
    remove: [] as string[],
  };
  const arcIds = new Set(arcs.map((arc) => arc.id));
  const seenQuestDiscoveries = new Set<string>();
  const seenNpcDiscoveries = new Set<string>();

  if (proposedDelta.activeArcId && !arcIds.has(proposedDelta.activeArcId)) {
    warnings.push(`Rejected active arc update for unknown arc ${proposedDelta.activeArcId}.`);
    nextState.activeArcId = state.activeArcId;
  }

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

  for (const questId of proposedDelta.questDiscoveries ?? []) {
    if (seenQuestDiscoveries.has(questId)) {
      continue;
    }
    seenQuestDiscoveries.add(questId);

    const quest = quests.find((entry) => entry.id === questId);

    if (!quest) {
      warnings.push(`Rejected unknown quest discovery ${questId}.`);
      continue;
    }

    if (quest.discoveredAtTurn !== null) {
      continue;
    }

    acceptedQuestDiscoveries.push(questId);
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

  for (const npcId of proposedDelta.npcDiscoveries ?? []) {
    if (seenNpcDiscoveries.has(npcId)) {
      continue;
    }
    seenNpcDiscoveries.add(npcId);

    if (!npcIds.has(npcId)) {
      warnings.push(`Rejected unknown NPC discovery ${npcId}.`);
      continue;
    }

    const npc = npcs.find((entry) => entry.id === npcId);
    if (!npc || npc.discoveredAtTurn !== null) {
      continue;
    }

    acceptedNpcDiscoveries.push(npcId);
  }

  nextState.activeRevealIds = Array.from(
    new Set([...state.activeRevealIds, ...acceptedRevealTriggers]),
  );

  return {
    nextState,
    nextCharacter: {
      health: character.health,
      gold: character.gold + awardedGold,
      inventory: [...character.inventory, ...acceptedInventoryChanges.add],
    },
    warnings,
    acceptedQuestAdvancements,
    acceptedQuestDiscoveries,
    acceptedClueDiscoveries,
    acceptedRevealTriggers,
    acceptedArcAdvancements,
    acceptedNpcChanges,
    acceptedNpcDiscoveries,
    awardedGold,
    acceptedInventoryChanges,
    memorySummary: proposedDelta.memorySummary,
  };
}
