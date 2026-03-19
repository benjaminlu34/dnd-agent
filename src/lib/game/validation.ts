import type {
  ArcRecord,
  CampaignCharacter,
  CampaignBlueprint,
  CampaignState,
  CheckResult,
  Clue,
  NpcRecord,
  ProposedStateDelta,
  QuestRecord,
  ValidatedDelta,
} from "@/lib/game/types";
import { cloneInventory } from "@/lib/game/characters";
import { MAX_LOOT_DISCOVERIES, normalizeItemNameList } from "@/lib/game/item-utils";
import { toCanonicalKeyLocationName } from "@/lib/game/location-utils";
import { clamp } from "@/lib/utils";

type ValidationInput = {
  blueprint: CampaignBlueprint;
  state: CampaignState;
  character: CampaignCharacter;
  quests: QuestRecord[];
  arcs: ArcRecord[];
  clues: Clue[];
  npcs: NpcRecord[];
  isInvestigative: boolean;
  checkResult?: CheckResult;
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
  isInvestigative,
  checkResult,
  proposedDelta,
}: ValidationInput): ValidatedDelta {
  const warnings: string[] = [];
  const healthDelta = Number.isFinite(proposedDelta.healthDelta)
    ? Math.trunc(proposedDelta.healthDelta as number)
    : 0;
  const nextSceneLocation =
    typeof proposedDelta.sceneLocation === "string" && proposedDelta.sceneLocation.trim()
      ? proposedDelta.sceneLocation.trim()
      : state.sceneState.location;
  const sceneKeyLocationMatch =
    proposedDelta.sceneKeyLocation === null
      ? null
      : toCanonicalKeyLocationName(blueprint.keyLocations, proposedDelta.sceneKeyLocation);

  if (
    typeof proposedDelta.sceneKeyLocation === "string" &&
    proposedDelta.sceneKeyLocation.trim() &&
    !sceneKeyLocationMatch
  ) {
    warnings.push(`Rejected unknown scene key location ${proposedDelta.sceneKeyLocation.trim()}.`);
  }

  const acceptedKeyLocationDiscoveries = (proposedDelta.keyLocationDiscoveries ?? [])
    .map((location) => {
      const canonicalName = toCanonicalKeyLocationName(blueprint.keyLocations, location);

      if (!canonicalName) {
        warnings.push(`Rejected unknown key location discovery ${location}.`);
        return null;
      }

      return canonicalName;
    })
    .filter((location): location is string => Boolean(location));
  const nextDiscoveredSceneLocations = state.discoveredSceneLocations.includes(nextSceneLocation)
    ? state.discoveredSceneLocations
    : [...state.discoveredSceneLocations, nextSceneLocation];
  const nextDiscoveredKeyLocationNames = Array.from(
    new Set([
      ...state.discoveredKeyLocationNames,
      ...acceptedKeyLocationDiscoveries,
      ...(sceneKeyLocationMatch ? [sceneKeyLocationMatch] : []),
    ]),
  );
  const nextState: CampaignState = {
    ...state,
    sceneState: {
      ...state.sceneState,
      summary: proposedDelta.sceneSnapshot ?? state.sceneState.summary,
      title: proposedDelta.sceneTitle ?? state.sceneState.title,
      location: nextSceneLocation,
      keyLocationName:
        proposedDelta.sceneKeyLocation === null
          ? null
          : sceneKeyLocationMatch ?? state.sceneState.keyLocationName,
      atmosphere: proposedDelta.sceneAtmosphere ?? state.sceneState.atmosphere,
      suggestedActions:
        proposedDelta.suggestedActions?.slice(0, 4) ?? state.sceneState.suggestedActions,
    },
    discoveredSceneLocations: nextDiscoveredSceneLocations,
    discoveredKeyLocationNames: nextDiscoveredKeyLocationNames,
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
  const acceptedLootDiscoveries: ValidatedDelta["acceptedLootDiscoveries"] = [];
  const acceptedInventoryChanges: ValidatedDelta["acceptedInventoryChanges"] = {
    add: [],
    remove: [] as string[],
  };
  const questById = new Map(quests.map((quest) => [quest.id, quest]));
  const arcById = new Map(arcs.map((arc) => [arc.id, arc]));
  const npcById = new Map(npcs.map((npc) => [npc.id, npc]));
  const revealById = new Map(blueprint.hiddenReveals.map((reveal) => [reveal.id, reveal]));
  const arcIds = new Set(arcById.keys());
  const clueIds = new Set(clues.map((clue) => clue.id));
  const unlockedArcIds = new Set(
    arcs.filter((arc) => arc.status !== "locked").map((arc) => arc.id),
  );
  const seenQuestDiscoveries = new Set<string>();
  const seenNpcDiscoveries = new Set<string>();

  if (proposedDelta.activeArcId && !arcIds.has(proposedDelta.activeArcId)) {
    warnings.push(`Rejected active arc update for unknown arc ${proposedDelta.activeArcId}.`);
    nextState.activeArcId = state.activeArcId;
  }

  for (const update of proposedDelta.questAdvancements ?? []) {
    const quest = questById.get(update.questId);

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
        acceptedInventoryChanges.add.push({
          templateId: quest.rewardItem.templateId,
        });
      }
    }
  }

  for (const questId of proposedDelta.questDiscoveries ?? []) {
    if (seenQuestDiscoveries.has(questId)) {
      continue;
    }
    seenQuestDiscoveries.add(questId);

    const quest = questById.get(questId);

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

  if ("inventoryChanges" in proposedDelta && proposedDelta.inventoryChanges !== undefined) {
    warnings.push("Rejected direct inventory mutation. Inventory remains engine-controlled in v1.");
  }

  const normalizedLootDiscoveries = normalizeItemNameList(proposedDelta.lootDiscoveries ?? []);
  if (normalizedLootDiscoveries.length > MAX_LOOT_DISCOVERIES) {
    warnings.push(`Accepted only the first ${MAX_LOOT_DISCOVERIES} loot discoveries this turn.`);
  }

  if (normalizedLootDiscoveries.length > 0) {
    if (!proposedDelta.lootSource) {
      warnings.push("Rejected loot discoveries without a validated loot source.");
    } else if (proposedDelta.lootSource === "investigation") {
      if (!isInvestigative) {
        warnings.push("Rejected investigative loot on a non-investigative turn.");
      } else {
        for (const name of normalizedLootDiscoveries.slice(0, MAX_LOOT_DISCOVERIES)) {
          acceptedLootDiscoveries.push({ name });
        }
      }
    } else if (proposedDelta.lootSource === "defeat") {
      if (!checkResult) {
        warnings.push("Rejected defeat loot without a resolved check result.");
      } else if (checkResult.outcome !== "success") {
        warnings.push("Rejected defeat loot because the check outcome was not a success.");
      } else {
        for (const name of normalizedLootDiscoveries.slice(0, MAX_LOOT_DISCOVERIES)) {
          acceptedLootDiscoveries.push({ name });
        }
      }
    } else {
      warnings.push(`Rejected unknown loot source ${proposedDelta.lootSource}.`);
    }
  }

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
    const reveal = revealById.get(revealId);

    if (!reveal) {
      warnings.push(`Rejected unknown reveal ${revealId}.`);
      continue;
    }

    const allCluesFound = reveal.requiredClues.every((id) => discoveredClues.has(id));
    const arcsReady = reveal.requiredArcIds.every((arcId) => unlockedArcIds.has(arcId));

    if (!allCluesFound || !arcsReady) {
      warnings.push(`Rejected premature reveal ${reveal.title}.`);
      continue;
    }

    acceptedRevealTriggers.push(revealId);
  }

  for (const arcUpdate of proposedDelta.arcAdvancements ?? []) {
    const arc = arcById.get(arcUpdate.arcId);

    if (!arc) {
      warnings.push(`Rejected arc update for unknown arc ${arcUpdate.arcId}.`);
      continue;
    }

    acceptedArcAdvancements.push(arcUpdate);
  }

  const npcIds = new Set(npcById.keys());
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

    const npc = npcById.get(npcId);
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
      health: Math.max(0, Math.min(character.health + healthDelta, character.maxHealth)),
      gold: character.gold + awardedGold,
      inventory: cloneInventory(character.inventory),
    },
    healthDelta,
    warnings,
    acceptedQuestAdvancements,
    acceptedQuestDiscoveries,
    acceptedClueDiscoveries,
    acceptedRevealTriggers,
    acceptedArcAdvancements,
    acceptedNpcChanges,
    acceptedNpcDiscoveries,
    awardedGold,
    acceptedLootDiscoveries,
    acceptedInventoryChanges,
    memorySummary: proposedDelta.memorySummary,
  };
}
