import {
  type ArcRecord,
  type CampaignBlueprint,
  type CampaignState,
  type Clue,
  type GeneratedCampaignSetup,
  type Hook,
  type NpcRecord,
  type QuestRecord,
} from "@/lib/game/types";
import { slugify } from "@/lib/utils";

function makeId(prefix: string, value: string, fallback: string) {
  const slug = slugify(value);
  return `${prefix}_${slug || fallback}`;
}

export function buildCampaignBlueprintFromSetup(
  setup: GeneratedCampaignSetup,
): CampaignBlueprint {
  const hooks: Hook[] = setup.hooks.map((hook, index) => ({
    id: makeId("hook", hook.text, `hook_${index + 1}`),
    text: hook.text,
    status: "open",
  }));

  const revealTitleToId = new Map(
    setup.reveals.map((reveal, index) => [
      reveal.title,
      makeId("reveal", reveal.title, `reveal_${index + 1}`),
    ]),
  );
  const clueTextToId = new Map(
    setup.clues.map((clue, index) => [clue.text, makeId("clue", clue.text, `clue_${index + 1}`)]),
  );
  const arcTitleToId = new Map(
    setup.arcs.map((arc, index) => [arc.title, makeId("arc", arc.title, `arc_${index + 1}`)]),
  );

  return {
    premise: setup.premise,
    tone: setup.tone,
    setting: setup.setting,
    villain: {
      name: setup.villain.name,
      motive: setup.villain.motive,
      progressClock: Math.max(6, Math.min(12, setup.villain.progressClock || 10)),
    },
    arcs: setup.arcs.map((arc, index) => ({
      id: arcTitleToId.get(arc.title) ?? makeId("arc", arc.title, `arc_${index + 1}`),
      title: arc.title,
      summary: arc.summary,
      expectedTurns: Math.max(4, Math.min(14, arc.expectedTurns || 8)),
    })),
    hiddenReveals: setup.reveals.map((reveal, index) => ({
      id: revealTitleToId.get(reveal.title) ?? makeId("reveal", reveal.title, `reveal_${index + 1}`),
      title: reveal.title,
      truth: reveal.truth,
      requiredClues: reveal.requiredClueTitles
        .map((title) => clueTextToId.get(title))
        .filter((value): value is string => Boolean(value)),
      requiredArcIds: reveal.requiredArcTitles
        .map((title) => arcTitleToId.get(title))
        .filter((value): value is string => Boolean(value)),
      triggered: false,
    })),
    subplotSeeds: setup.subplotSeeds.map((seed, index) => ({
      id: makeId("subplot", seed.title, `subplot_${index + 1}`),
      title: seed.title,
      hook: seed.hook,
    })),
    initialHooks: hooks,
  };
}

export function buildCampaignStateFromSetup(
  setup: GeneratedCampaignSetup,
  blueprint: CampaignBlueprint,
): CampaignState {
  const firstArcId = blueprint.arcs[0]?.id ?? "arc_1";

  return {
    turnCount: 0,
    activeArcId: firstArcId,
    worldState: {
      dangerLevel: "rising",
      activeThreat: setup.openingScene.activeThreat,
    },
    sceneState: {
      id: makeId("scene", setup.openingScene.title, "opening"),
      title: setup.openingScene.title,
      summary: setup.openingScene.summary,
      location: setup.openingScene.location,
      atmosphere: setup.openingScene.atmosphere,
      suggestedActions: setup.openingScene.suggestedActions.slice(0, 4),
    },
    locations: setup.locations,
    hooks: blueprint.initialHooks,
    villainClock: 1,
    tensionScore: 25,
    inventory: [],
    gold: 0,
    activeRevealIds: [],
    pendingTurnId: null,
  };
}

export function buildQuestRecordsFromSetup(setup: GeneratedCampaignSetup): QuestRecord[] {
  return setup.quests.map((quest, index) => ({
    id: makeId("quest", quest.title, `quest_${index + 1}`),
    title: quest.title,
    summary: quest.summary,
    stage: 0,
    maxStage: Math.max(1, quest.maxStage),
    status: "active",
    rewardGold: Math.max(0, quest.rewardGold),
    rewardItem: quest.rewardItem ?? null,
  }));
}

export function buildArcRecordsFromBlueprint(blueprint: CampaignBlueprint): ArcRecord[] {
  return blueprint.arcs.map((arc, index) => ({
    id: arc.id,
    title: arc.title,
    summary: arc.summary,
    status: index === 0 ? "active" : "locked",
    expectedTurns: arc.expectedTurns,
    currentTurn: 0,
    orderIndex: index,
  }));
}

export function buildNpcRecordsFromSetup(setup: GeneratedCampaignSetup): NpcRecord[] {
  return setup.npcs.slice(0, 4).map((npc, index) => ({
    id: makeId("npc", npc.name, `npc_${index + 1}`),
    name: npc.name,
    role: npc.role,
    status: npc.status ?? "present",
    isCompanion: Boolean(npc.isCompanion) && index === 0
      ? true
      : Boolean(npc.isCompanion && !setup.npcs.slice(0, index).some((entry) => entry.isCompanion)),
    approval: npc.approval ?? 0,
    personalHook: npc.personalHook ?? null,
    notes: npc.notes,
  }));
}

export function buildClueRecordsFromSetup(
  setup: GeneratedCampaignSetup,
  blueprint: CampaignBlueprint,
): Clue[] {
  const revealTitleToId = new Map(blueprint.hiddenReveals.map((reveal) => [reveal.title, reveal.id]));

  return setup.clues.map((clue, index) => ({
    id: makeId("clue", clue.text, `clue_${index + 1}`),
    text: clue.text,
    source: clue.source,
    linkedRevealId:
      revealTitleToId.get(clue.linkedRevealTitle) ?? blueprint.hiddenReveals[0]?.id ?? "reveal_1",
    status: "hidden",
    discoveredAtTurn: null,
  }));
}
