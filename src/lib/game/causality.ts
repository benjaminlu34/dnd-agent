import type { TurnCausalityCode } from "@/lib/game/types";

function entityLabel(input: TurnCausalityCode) {
  return input.metadata?.label && typeof input.metadata.label === "string"
    ? input.metadata.label
    : input.targetId ?? input.entityType;
}

const changeRenderers: Record<string, (code: TurnCausalityCode) => string> = {
  LOCATION_CHANGED: (code) => `You moved to ${entityLabel(code)}.`,
  TIME_ADVANCED: (code) => `${code.minutes ?? 0} minutes passed.`,
  NPC_APPROVAL_CHANGED: (code) =>
    `${entityLabel(code)}'s attitude shifted by ${code.delta ?? 0}.`,
  INFORMATION_DISCOVERED: (code) => `You uncovered ${entityLabel(code)}.`,
  INFORMATION_ADDED: (code) => `${entityLabel(code)} entered the world.`,
  INFORMATION_EXPIRED: (code) => `${entityLabel(code)} became outdated.`,
  SCENE_OBJECT_STATE_CHANGED: (code) => `${entityLabel(code)} changed state.`,
  NPC_STATE_CHANGED: (code) => `${entityLabel(code)} changed state.`,
  NPC_LOCATION_CHANGED: (code) => `${entityLabel(code)} moved.`,
  CHARACTER_HEALTH_CHANGED: (code) => `Your health changed by ${code.delta ?? 0}.`,
  ROUTE_STATUS_CHANGED: (code) => `${entityLabel(code)} changed.`,
  LOCATION_STATE_CHANGED: (code) => `${entityLabel(code)} changed.`,
  LOCATION_CONTROL_CHANGED: (code) => `Control shifted at ${entityLabel(code)}.`,
  FACTION_RESOURCES_CHANGED: (code) => `${entityLabel(code)} adjusted its resources.`,
  WORLD_EVENT_SPAWNED: (code) => `${entityLabel(code)} was added to the world schedule.`,
  WORLD_EVENT_CANCELLED: (code) => `${entityLabel(code)} was cancelled.`,
  WORLD_EVENT_PROCESSED: (code) => `${entityLabel(code)} took effect.`,
  FACTION_MOVE_CANCELLED: (code) => `${entityLabel(code)} was cancelled.`,
  FACTION_MOVE_EXECUTED: (code) => `${entityLabel(code)} took effect.`,
  MARKET_PRICE_CHANGED: (code) => `${entityLabel(code)} changed.`,
  MARKET_RESTOCKED: (code) => `${entityLabel(code)} was restocked.`,
  MEMORY_RECORDED: (code) => `A new memory was recorded about ${entityLabel(code)}.`,
  SCHEDULE_JOB_ENQUEUED: (code) => `Future schedule generation was queued for ${entityLabel(code)}.`,
  SIMULATION_TICK: (code) => `The world shifted around ${entityLabel(code)}.`,
};

const reasonRenderers: Record<string, (code: TurnCausalityCode) => string> = {
  PLAYER_ACTION: () => "Because of your chosen action.",
  PLAYER_TRAVEL: () => "Because you chose to travel.",
  PLAYER_WAIT: () => "Because you let time pass.",
  PLAYER_REST: () => "Because you rested.",
  PLAYER_TRADE: () => "Because you traded.",
  PLAYER_COMBAT: () => "Because you initiated violence.",
  PLAYER_CONVERSATION: () => "Because you pressed the conversation.",
  PLAYER_SCENE_INTERACTION: () => "Because you approached and engaged with the scene.",
  PLAYER_INVESTIGATION: () => "Because you investigated further.",
  PLAYER_OBSERVATION: () => "Because you watched and listened.",
  MODEL_DISCOVERY_INTENT: () => "Because the scene supported a discovery.",
  RELATIONSHIP_SHIFT: () => "Because the relationship changed in play.",
  SIMULATION_TICK: () => "Because the wider world kept moving.",
  HORIZON_CAP: () => "Because time could only advance inside the committed schedule window.",
  SCHEDULE_BUFFER_ROLLED: () => "Because the rolling world buffer had to be extended.",
  INVALIDATED_EVENT: () => "Because the original trigger was no longer valid.",
};

function renderCodes(
  codes: TurnCausalityCode[],
  renderers: Record<string, (code: TurnCausalityCode) => string>,
) {
  return codes.map((code) => renderers[code.code]?.(code) ?? `${code.code} (${entityLabel(code)})`);
}

export function renderWhatChanged(changeCodes: TurnCausalityCode[]) {
  return renderCodes(changeCodes, changeRenderers);
}

export function renderWhy(reasonCodes: TurnCausalityCode[]) {
  return renderCodes(reasonCodes, reasonRenderers);
}
