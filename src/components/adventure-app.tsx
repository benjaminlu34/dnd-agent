"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BookOpen,
  ChevronRight,
  Compass,
  Package,
  Shield,
  X,
} from "lucide-react";
import { formatCurrencyCompact } from "@/lib/game/currency";
import type { StreamEvent } from "@/lib/http/ndjson";
import type {
  CampaignListItem,
  CheckResult,
  PendingCheck,
  PlayerCampaignSnapshot,
  ResolvePendingCheckRequest,
  StoryMessage,
  TurnSubmissionRequest,
  TurnDigest,
} from "@/lib/game/types";

type InventoryItem = PlayerCampaignSnapshot["character"]["inventory"][number];

async function consumeNdjson(
  response: Response,
  onEvent: (event: StreamEvent) => void,
) {
  if (!response.body) {
    throw new Error("Streaming response body was empty.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }

      onEvent(JSON.parse(line) as StreamEvent);
    }
  }

  if (buffer.trim()) {
    onEvent(JSON.parse(buffer) as StreamEvent);
  }
}

function formatMessageKicker(message: StoryMessage) {
  if (message.role === "user" && message.payload?.turnMode === "observe") return "Observe";
  if (message.role === "user") return "You";
  if (message.role === "system") return "System";
  return "Dungeon Master";
}

function extractSuggestedActions(snapshot: PlayerCampaignSnapshot | null) {
  if (!snapshot) {
    return [];
  }

  const latestNarration = [...snapshot.recentMessages]
    .reverse()
    .find((entry) => entry.role === "assistant" && entry.kind === "narration");
  const value = latestNarration?.payload?.suggestedActions;
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function roll2d6Total() {
  return Math.ceil(Math.random() * 6) + Math.ceil(Math.random() * 6);
}

const EQUIPMENT_KEYWORDS = [
  "armor",
  "axe",
  "blade",
  "bow",
  "boots",
  "buckler",
  "cloak",
  "club",
  "crossbow",
  "dagger",
  "flail",
  "gauntlet",
  "glaive",
  "greaves",
  "halberd",
  "hammer",
  "helm",
  "helmet",
  "knife",
  "lance",
  "mail",
  "mace",
  "pack",
  "pike",
  "quiver",
  "rapier",
  "robe",
  "rope",
  "satchel",
  "shield",
  "sling",
  "spear",
  "staff",
  "sword",
  "tool",
  "torch",
  "wand",
] as const;

function isEquippedItem(item: InventoryItem) {
  return item.properties?.equipped === true;
}

function isEquipmentItem(item: InventoryItem) {
  const haystack = `${item.template.name} ${item.template.tags.join(" ")}`.toLowerCase();
  return isEquippedItem(item) || EQUIPMENT_KEYWORDS.some((keyword) => haystack.includes(keyword));
}

function describeWorldTime(globalTime: number) {
  const minuteOfDay = ((globalTime % 1440) + 1440) % 1440;
  const day = Math.floor(globalTime / 1440) + 1;
  const hours24 = Math.floor(minuteOfDay / 60);
  const minutes = minuteOfDay % 60;
  const meridiem = hours24 >= 12 ? "PM" : "AM";
  const hours12 = hours24 % 12 || 12;

  let timeOfDay = "Night";
  if (minuteOfDay >= 300 && minuteOfDay < 420) timeOfDay = "Pre-Dawn";
  else if (minuteOfDay >= 420 && minuteOfDay < 720) timeOfDay = "Morning";
  else if (minuteOfDay >= 720 && minuteOfDay < 1020) timeOfDay = "Afternoon";
  else if (minuteOfDay >= 1020 && minuteOfDay < 1200) timeOfDay = "Evening";

  return {
    dayLabel: `Day ${day}`,
    clockLabel: `${hours12}:${String(minutes).padStart(2, "0")} ${meridiem}`,
    timeOfDay,
  };
}

export function AdventureApp({
  initialCampaignId = null,
}: {
  initialCampaignId?: string | null;
}) {
  const router = useRouter();
  const [activeSidebarTab, setActiveSidebarTab] = useState<"character" | "inventory" | "journal">(
    "character",
  );
  const [locationsDrawerOpen, setLocationsDrawerOpen] = useState(false);
  const [campaigns, setCampaigns] = useState<CampaignListItem[]>([]);
  const [campaignId, setCampaignId] = useState<string | null>(initialCampaignId);
  const [snapshot, setSnapshot] = useState<PlayerCampaignSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingSnapshot, setLoadingSnapshot] = useState(false);
  const [action, setAction] = useState("");
  const [turnError, setTurnError] = useState<string | null>(null);
  const [clarification, setClarification] = useState<{
    question: string;
    options: string[];
  } | null>(null);
  const [pendingCheck, setPendingCheck] = useState<{
    turnId: string;
    check: PendingCheck;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [retryingTurn, setRetryingTurn] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [latestCheck, setLatestCheck] = useState<CheckResult | null>(null);
  const [streamedNarration, setStreamedNarration] = useState("");
  const [suggestedActions, setSuggestedActions] = useState<string[]>([]);
  const [missedTurnDigests, setMissedTurnDigests] = useState<TurnDigest[]>([]);
  const worldTime = snapshot ? describeWorldTime(snapshot.state.globalTime) : null;

  useEffect(() => {
    let active = true;

    async function loadCampaigns() {
      setLoading(true);

      try {
        const response = await fetch("/api/campaigns");
        const data = (await response.json()) as {
          campaigns?: CampaignListItem[];
          error?: string;
        };

        if (!response.ok) {
          throw new Error(data.error ?? "Failed to load campaigns.");
        }

        if (!active) {
          return;
        }

        const nextCampaigns = data.campaigns ?? [];
        setCampaigns(nextCampaigns);
        setCampaignId((current) => current ?? nextCampaigns[0]?.id ?? null);
      } catch (error) {
        if (active) {
          setTurnError(error instanceof Error ? error.message : "Failed to load campaigns.");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void loadCampaigns();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;

    async function loadSnapshot() {
      if (!campaignId) {
        return;
      }

      setLoadingSnapshot(true);

      try {
        const response = await fetch(`/api/campaigns/${campaignId}`);
        const data = (await response.json()) as {
          snapshot?: PlayerCampaignSnapshot;
          error?: string;
        };

        if (!response.ok || !data.snapshot) {
          throw new Error(data.error ?? "Failed to load campaign.");
        }

        if (!active) {
          return;
        }

        setSnapshot(data.snapshot);
        setSuggestedActions(extractSuggestedActions(data.snapshot));
        setMissedTurnDigests([]);
        setPendingCheck(null);
      } catch (error) {
        if (active) {
          setTurnError(error instanceof Error ? error.message : "Failed to load campaign.");
        }
      } finally {
        if (active) {
          setLoadingSnapshot(false);
        }
      }
    }

    void loadSnapshot();

    return () => {
      active = false;
    };
  }, [campaignId]);

  const sessionId = snapshot?.sessionId ?? null;
  const recentMessages = useMemo(() => snapshot?.recentMessages ?? [], [snapshot]);
  const equipment = useMemo(
    () => snapshot?.character.inventory.filter((item) => isEquipmentItem(item)) ?? [],
    [snapshot],
  );
  const inventory = useMemo(
    () => snapshot?.character.inventory.filter((item) => !isEquipmentItem(item)) ?? [],
    [snapshot],
  );
  const latestNarrationPayload = useMemo(() => {
    const message = [...recentMessages]
      .reverse()
      .find((entry) => entry.role === "assistant" && entry.kind === "narration");
    return message?.payload ?? null;
  }, [recentMessages]);
  const latestWhatChanged = useMemo(() => {
    const value = latestNarrationPayload?.whatChanged;
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
  }, [latestNarrationPayload]);
  const latestWhy = useMemo(() => {
    const value = latestNarrationPayload?.why;
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
  }, [latestNarrationPayload]);
  const latestRetryableTurnId = snapshot?.latestRetryableTurnId ?? null;
  const activeJourney = snapshot?.activeJourney ?? null;
  const primaryRoutes = useMemo(
    () => snapshot?.adjacentRoutes.filter((route) => !route.targetIsMinor) ?? [],
    [snapshot],
  );
  const localPointOfInterestRoutes = useMemo(
    () => snapshot?.adjacentRoutes.filter((route) => route.targetIsMinor) ?? [],
    [snapshot],
  );
  const locationLeads = snapshot?.locationLeads ?? [];
  const chapterTitle = snapshot?.currentLocation?.name
    ?? (activeJourney ? `On the Road to ${activeJourney.destinationLocationName}` : "Between Places");
  const chapterSummary = snapshot?.currentLocation?.summary
    ?? (
      activeJourney
        ? `Traveling from ${activeJourney.originLocationName} to ${activeJourney.destinationLocationName}. ${activeJourney.remainingMinutes} minutes remain on the journey.`
        : "The party is in transit and waiting for the next decisive move."
    );
  const chapterMeta = snapshot?.currentLocation
    ? `${snapshot.currentLocation.type} · ${snapshot.currentLocation.state} · ${snapshot.tone}`
    : activeJourney
      ? `Journey · ${activeJourney.remainingMinutes} minutes remaining · ${snapshot?.tone ?? ""}`.replace(/ · $/, "")
      : snapshot?.tone ?? "";

  async function refreshCurrentSnapshot(targetCampaignId: string, preserveAction = false) {
    const response = await fetch(`/api/campaigns/${targetCampaignId}`);
    const data = (await response.json()) as {
      snapshot?: PlayerCampaignSnapshot;
      error?: string;
    };

    if (!response.ok || !data.snapshot) {
      throw new Error(data.error ?? "Failed to load campaign.");
    }

    setSnapshot(data.snapshot);
    setSuggestedActions(extractSuggestedActions(data.snapshot));
    setMissedTurnDigests([]);
    setStreamedNarration("");
    setLatestCheck(null);
    setPendingCheck(null);
    if (!preserveAction) {
      setAction("");
    }
  }

  async function undoLatestTurn() {
    if (!campaignId || !latestRetryableTurnId || retryingTurn || submitting) {
      return;
    }

    setRetryingTurn(true);
    setTurnError(null);
    setWarnings([]);
    setClarification(null);
    setPendingCheck(null);
    setLatestCheck(null);
    setStreamedNarration("");

    try {
      const response = await fetch(`/api/turns/${latestRetryableTurnId}/retry`, {
        method: "POST",
      });
      const data = (await response.json()) as {
        ok?: boolean;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(data.error ?? "Turn undo failed.");
      }

      await refreshCurrentSnapshot(campaignId);
    } catch (error) {
      setTurnError(error instanceof Error ? error.message : "Turn undo failed.");
    } finally {
      setRetryingTurn(false);
    }
  }

  async function submitTurn(nextAction: string, mode?: TurnSubmissionRequest["mode"]) {
    return submitTurnWithIntent(nextAction, mode);
  }

  async function submitPendingCheck(rolls?: [number, number]) {
    if (!campaignId || !sessionId || !pendingCheck || submitting) {
      return;
    }

    setSubmitting(true);
    setTurnError(null);
    setWarnings([]);
    setLatestCheck(null);
    setStreamedNarration("");

    try {
      const generatedRolls: [number, number] =
        rolls
        ?? (
          pendingCheck.check.mode === "normal"
            ? [roll2d6Total(), roll2d6Total()]
            : [roll2d6Total(), roll2d6Total()]
        );
      const body: ResolvePendingCheckRequest = {
        campaignId,
        sessionId,
        requestId: crypto.randomUUID(),
        pendingTurnId: pendingCheck.turnId,
        rolls: pendingCheck.check.mode === "normal"
          ? [generatedRolls[0], generatedRolls[0]]
          : generatedRolls,
      };

      const response = await fetch("/api/turns/check", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        throw new Error("Check resolution failed.");
      }

      const nextWarnings: string[] = [];
      let nextSnapshot: PlayerCampaignSnapshot | null = null;
      let nextActions: string[] = [];
      let nextMissedTurnDigests: TurnDigest[] = [];
      let streamErrorMessage: string | null = null;
      let preserveDraftOnRefresh = false;

      await consumeNdjson(response, (event) => {
        if (event.type === "warning") {
          nextWarnings.push(event.message);
        } else if (event.type === "narration") {
          setStreamedNarration((current) => `${current}${event.chunk}`);
        } else if (event.type === "state") {
          nextSnapshot = event.snapshot;
        } else if (event.type === "actions") {
          nextActions = event.actions;
        } else if (event.type === "error") {
          streamErrorMessage = event.message;
          setTurnError(event.message);
        } else if (event.type === "check_result") {
          setLatestCheck(event.result);
        } else if (event.type === "check_required") {
          setPendingCheck({
            turnId: event.turnId,
            check: event.check,
          });
        } else if (event.type === "state_conflict") {
          streamErrorMessage = "state_conflict";
          if (event.latestSnapshot) {
            nextSnapshot = event.latestSnapshot;
            nextMissedTurnDigests = event.missedTurnDigests;
            nextActions = extractSuggestedActions(event.latestSnapshot);
          }
          setTurnError("The world advanced before this roll could commit. Review the missed outcome and choose a new action.");
        } else if (event.type === "retry_required") {
          streamErrorMessage = "retry_required";
          setTurnError(
            event.result.error?.message
            ?? "That request already ended in a retryable failure state. Submit the action again to create a fresh attempt.",
          );
        } else if (event.type === "stale_prompt_context") {
          streamErrorMessage = "stale_prompt_context";
          nextSnapshot = event.latestSnapshot;
          nextActions = extractSuggestedActions(event.latestSnapshot);
          preserveDraftOnRefresh = true;
          setTurnError("The world view refreshed before that action could resolve. Your draft is still here, and you can retry immediately.");
        }
      });

      if (nextSnapshot) {
        setSnapshot(nextSnapshot);
        setMissedTurnDigests(nextMissedTurnDigests);
        setSuggestedActions(nextActions.length ? nextActions : extractSuggestedActions(nextSnapshot));
        setPendingCheck(null);
        if (!preserveDraftOnRefresh) {
          setAction("");
        }
        setStreamedNarration("");
      } else if (!streamErrorMessage) {
        setWarnings(nextWarnings);
      }
      setWarnings(nextWarnings);
    } catch (error) {
      setTurnError(error instanceof Error ? error.message : "Check resolution failed.");
    } finally {
      setSubmitting(false);
    }
  }

  async function submitTurnWithIntent(
    nextAction: string,
    mode?: TurnSubmissionRequest["mode"],
    intent?: TurnSubmissionRequest["intent"],
  ) {
    if (!campaignId || !sessionId || !nextAction.trim() || submitting || pendingCheck) {
      return;
    }

    setSubmitting(true);
    setTurnError(null);
    setClarification(null);
    setPendingCheck(null);
    setWarnings([]);
    setLatestCheck(null);
    setStreamedNarration("");

    try {
      const body: TurnSubmissionRequest = {
        campaignId,
        sessionId,
        requestId: crypto.randomUUID(),
        expectedStateVersion: snapshot?.stateVersion ?? 0,
        promptRequestId: snapshot?.promptRequestId ?? null,
        action: nextAction.trim(),
        ...(intent ? { intent } : {}),
        ...(mode ? { mode } : {}),
      };

      const response = await fetch("/api/turns", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        throw new Error("Turn submission failed.");
      }

      const nextWarnings: string[] = [];
      let nextSnapshot: PlayerCampaignSnapshot | null = null;
      let nextActions: string[] = [];
      let nextMissedTurnDigests: TurnDigest[] = [];
      let receivedClarification = false;
      let streamErrorMessage: string | null = null;
      let preserveDraftOnRefresh = false;
      await consumeNdjson(response, (event) => {
        if (event.type === "warning") {
          nextWarnings.push(event.message);
        } else if (event.type === "narration") {
          setStreamedNarration((current) => `${current}${event.chunk}`);
        } else if (event.type === "clarification") {
          receivedClarification = true;
          setClarification({
            question: event.question,
            options: event.options,
          });
        } else if (event.type === "check_required") {
          setPendingCheck({
            turnId: event.turnId,
            check: event.check,
          });
        } else if (event.type === "state") {
          nextSnapshot = event.snapshot;
        } else if (event.type === "actions") {
          nextActions = event.actions;
        } else if (event.type === "error") {
          streamErrorMessage = event.message;
          setTurnError(event.message);
        } else if (event.type === "check_result") {
          setLatestCheck(event.result);
        } else if (event.type === "state_conflict") {
          streamErrorMessage = "state_conflict";
          if (event.latestSnapshot) {
            nextSnapshot = event.latestSnapshot;
            nextMissedTurnDigests = event.missedTurnDigests;
            nextActions = extractSuggestedActions(event.latestSnapshot);
          }
          setAction("");
          setTurnError("The world advanced before this action could commit. Review the missed outcome and choose a new action.");
        } else if (event.type === "retry_required") {
          streamErrorMessage = "retry_required";
          setTurnError(
            event.result.error?.message
            ?? "That request already ended in a retryable failure state. Submit the action again to create a fresh attempt.",
          );
        } else if (event.type === "invalid_expected_state_version") {
          streamErrorMessage = "invalid_expected_state_version";
          if (event.latestSnapshot) {
            nextSnapshot = event.latestSnapshot;
            nextActions = extractSuggestedActions(event.latestSnapshot);
          }
          setTurnError(
            event.message
            ?? "The client state version was ahead of the campaign. Review the current state and choose a fresh action.",
          );
        } else if (event.type === "stale_prompt_context") {
          streamErrorMessage = "stale_prompt_context";
          nextSnapshot = event.latestSnapshot;
          nextActions = extractSuggestedActions(event.latestSnapshot);
          preserveDraftOnRefresh = true;
          setTurnError("The world view refreshed before that action could resolve. Your draft is still here, and you can retry immediately.");
        }
      });

      if (!nextSnapshot && !receivedClarification && !streamErrorMessage) {
        try {
          const snapshotResponse = await fetch(`/api/campaigns/${campaignId}`);
          const snapshotData = (await snapshotResponse.json()) as {
            snapshot?: PlayerCampaignSnapshot;
            error?: string;
          };

          if (snapshotResponse.ok && snapshotData.snapshot) {
            nextSnapshot = snapshotData.snapshot;
          } else if (!streamErrorMessage) {
            setTurnError(snapshotData.error ?? "Turn resolved, but refreshing the campaign failed.");
          }
        } catch (error) {
          if (!streamErrorMessage) {
            setTurnError(error instanceof Error ? error.message : "Turn resolved, but refreshing the campaign failed.");
          }
        }
      }

      if (nextSnapshot) {
        setSnapshot(nextSnapshot);
        setMissedTurnDigests(nextMissedTurnDigests);
        if (!preserveDraftOnRefresh) {
          setAction("");
        }
        setStreamedNarration("");
      } else if (receivedClarification) {
        setAction("");
        setStreamedNarration("");
      }

      setWarnings(nextWarnings);
      if (nextSnapshot) {
        setSuggestedActions(nextActions.length ? nextActions : extractSuggestedActions(nextSnapshot));
      } else {
        setSuggestedActions(nextActions);
      }
    } catch (error) {
      setTurnError(error instanceof Error ? error.message : "Turn submission failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="app-shell relative overflow-hidden bg-zinc-950 text-zinc-300">
      {locationsDrawerOpen ? (
        <button
          type="button"
          aria-label="Close world drawer"
          className="fixed inset-0 z-30 bg-black/50 backdrop-blur-sm xl:hidden"
          onClick={() => setLocationsDrawerOpen(false)}
        />
      ) : null}
      <div className="app-frame relative grid max-w-7xl gap-6 xl:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="xl:sticky xl:top-6 xl:self-start">
          {snapshot ? (
            <section className="overflow-hidden rounded-[1.75rem] border border-zinc-800 bg-zinc-950/95 shadow-2xl shadow-black/20 backdrop-blur">
              <div className="border-b border-zinc-800 p-3">
                <div className="grid grid-cols-3 gap-2 rounded-2xl bg-zinc-900/80 p-1">
                  {[
                    { id: "character", label: "Character", icon: Shield },
                    { id: "inventory", label: "Inventory", icon: Package },
                    { id: "journal", label: "Journal", icon: BookOpen },
                  ].map((tab) => {
                    const Icon = tab.icon;
                    const isActive = activeSidebarTab === tab.id;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        className={[
                          "button-press flex h-11 items-center justify-center gap-2 rounded-xl px-2.5 text-[0.72rem] font-semibold leading-none transition",
                          isActive
                            ? "bg-zinc-100 text-zinc-950"
                            : "text-zinc-400 hover:bg-zinc-800/80 hover:text-zinc-100",
                        ].join(" ")}
                        onClick={() =>
                          setActiveSidebarTab(tab.id as "character" | "inventory" | "journal")
                        }
                      >
                        <Icon className="h-4 w-4" />
                        <span className="translate-y-px">{tab.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="max-h-[calc(100vh-10rem)] overflow-y-auto p-6">
                {activeSidebarTab === "character" ? (
                  <div className="space-y-5">
                    <section>
                      <p className="text-[0.68rem] uppercase tracking-[0.22em] text-zinc-500">Character</p>
                      <h2 className="mt-3 font-serif text-2xl font-semibold text-zinc-100">
                        {snapshot.character.name}
                      </h2>
                      <p className="mt-1 text-sm text-zinc-400">{snapshot.character.archetype}</p>
                    </section>

                    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-4">
                        <p className="text-[0.68rem] uppercase tracking-[0.18em] text-zinc-500">Health</p>
                        <p className="mt-2 font-serif text-2xl text-zinc-100">{snapshot.character.health}</p>
                      </div>
                      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-4">
                        <p className="text-[0.68rem] uppercase tracking-[0.18em] text-zinc-500">Currency</p>
                        <p className="mt-2 font-serif text-2xl text-zinc-100">
                          {formatCurrencyCompact(snapshot.character.currencyCp)}
                        </p>
                      </div>
                    </section>

                    <section>
                      <p className="text-[0.68rem] uppercase tracking-[0.22em] text-zinc-500">Equipment</p>
                      <div className="mt-4 space-y-3">
                        {equipment.length ? (
                          equipment.map((item) => (
                            <div key={item.id} className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-4">
                              <h3 className="font-serif text-base font-semibold text-zinc-100">
                                {item.template.name}
                              </h3>
                              {item.template.description ? (
                                <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                                  {item.template.description}
                                </p>
                              ) : null}
                            </div>
                          ))
                        ) : (
                          <p className="text-sm text-zinc-500">No notable equipment on hand.</p>
                        )}
                      </div>
                    </section>
                  </div>
                ) : null}

                {activeSidebarTab === "inventory" ? (
                  <div className="space-y-5">
                    <section className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-4">
                      <p className="text-[0.68rem] uppercase tracking-[0.22em] text-zinc-500">Pack Summary</p>
                      <p className="mt-2 text-sm leading-relaxed text-zinc-300">
                        {inventory.length
                          ? `${inventory.length} carried item${inventory.length === 1 ? "" : "s"} ready to use or trade.`
                          : "Traveling light at the moment."}
                      </p>
                    </section>

                    <section>
                      <p className="text-[0.68rem] uppercase tracking-[0.22em] text-zinc-500">Inventory</p>
                      <div className="mt-4 space-y-3">
                        {inventory.length ? (
                          inventory.map((item) => (
                            <div key={item.id} className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-4">
                              <div className="flex items-start justify-between gap-3">
                                <h3 className="font-serif text-base font-semibold text-zinc-100">
                                  {item.template.name}
                                </h3>
                              </div>
                              {item.template.description ? (
                                <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                                  {item.template.description}
                                </p>
                              ) : null}
                            </div>
                          ))
                        ) : (
                          <p className="text-sm text-zinc-500">Nothing else rattling around in the pack.</p>
                        )}
                      </div>
                    </section>
                  </div>
                ) : null}

                {activeSidebarTab === "journal" ? (
                  <div className="space-y-5">
                    <section>
                      <p className="text-[0.68rem] uppercase tracking-[0.22em] text-zinc-500">Active Threads</p>
                      <div className="mt-4 space-y-3">
                        {snapshot.activeThreads.length ? (
                          snapshot.activeThreads.map((thread) => (
                            <div key={thread.memoryId} className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-4">
                              <p className="text-sm leading-relaxed text-zinc-200">{thread.summary}</p>
                            </div>
                          ))
                        ) : (
                          <p className="text-sm text-zinc-500">No long-arc threads have surfaced yet.</p>
                        )}
                      </div>
                    </section>

                    <section>
                      <p className="text-[0.68rem] uppercase tracking-[0.22em] text-zinc-500">Pressures</p>
                      <div className="mt-4 space-y-3">
                        {snapshot.activePressures.length ? (
                          snapshot.activePressures.map((pressure) => (
                            <div
                              key={`${pressure.entityType}-${pressure.entityId}`}
                              className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-4"
                            >
                              <h3 className="font-serif text-base font-semibold text-zinc-100">{pressure.label}</h3>
                              <p className="mt-2 text-sm leading-relaxed text-zinc-400">{pressure.summary}</p>
                            </div>
                          ))
                        ) : (
                          <p className="text-sm text-zinc-500">No urgent pressures are crowding the scene.</p>
                        )}
                      </div>
                    </section>

                    <section>
                      <p className="text-[0.68rem] uppercase tracking-[0.22em] text-zinc-500">Recent World Shifts</p>
                      <div className="mt-4 space-y-3">
                        {snapshot.recentWorldShifts.length ? (
                          snapshot.recentWorldShifts.map((shift) => (
                            <div key={shift.turnId} className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-4">
                              <p className="text-sm leading-relaxed text-zinc-300">{shift.summary}</p>
                            </div>
                          ))
                        ) : (
                          <p className="text-sm text-zinc-500">The wider world has been relatively quiet.</p>
                        )}
                      </div>
                    </section>
                  </div>
                ) : null}
              </div>
            </section>
          ) : (
            <section className="rounded-[1.75rem] border border-zinc-800 bg-zinc-950/95 p-6 shadow-2xl shadow-black/20 backdrop-blur">
              <p className="text-sm text-zinc-400">Choose a campaign to start playing.</p>
            </section>
          )}
        </aside>

        <section className="relative rounded-[2rem] border border-zinc-800 bg-zinc-900/95 p-6 shadow-2xl shadow-black/25 backdrop-blur md:p-8">
          {loadingSnapshot ? (
            <p className="text-sm text-zinc-400">Loading campaign state...</p>
          ) : snapshot ? (
            <>
              <div className="pointer-events-none sticky top-4 z-30 mb-2 hidden justify-end lg:flex">
                <button
                  type="button"
                  className="button-press pointer-events-auto rounded-2xl border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-semibold text-zinc-100 transition hover:border-zinc-500 hover:bg-zinc-800"
                  onClick={() => setLocationsDrawerOpen(true)}
                >
                  <Compass className="mr-2 inline h-4 w-4" />
                  World
                </button>
              </div>
              <div className="mx-auto max-w-4xl">
                <div className="sticky top-0 z-20 -mx-2 mb-6 border-b border-zinc-800/80 bg-zinc-900/95 px-2 pb-5 pt-1 backdrop-blur">
                  <div className="mx-auto flex max-w-4xl flex-col gap-4">
                    <nav className="flex flex-wrap items-center text-sm text-zinc-400">
                      <button
                        type="button"
                        className="transition hover:text-zinc-100"
                        onClick={() => router.push("/campaigns")}
                      >
                        Campaigns
                      </button>
                      <ChevronRight className="mx-2 h-4 w-4" />
                      <button
                        type="button"
                        className="transition hover:text-zinc-100"
                        onClick={() => router.push("/")}
                      >
                        Home
                      </button>
                      <ChevronRight className="mx-2 h-4 w-4" />
                      <span className="font-medium text-zinc-100">{snapshot.title}</span>
                    </nav>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        className="button-press rounded-2xl border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-semibold text-zinc-100 transition hover:border-zinc-500 hover:bg-zinc-800"
                        onClick={() => router.push("/campaigns/new")}
                      >
                        New Campaign
                      </button>
                      <button
                        type="button"
                        className="button-press rounded-2xl border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-semibold text-zinc-100 transition hover:border-zinc-500 hover:bg-zinc-800 lg:hidden"
                        onClick={() => setLocationsDrawerOpen(true)}
                      >
                        <Compass className="mr-2 inline h-4 w-4" />
                        World
                      </button>
                    </div>
                  </div>
                </div>

                <header className="border-b border-zinc-800 pb-8">
                  <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <p className="text-[0.68rem] uppercase tracking-[0.22em] text-zinc-500">Current Chapter</p>
                      <h1 className="mt-3 font-serif text-4xl font-semibold tracking-tight text-zinc-100 md:text-5xl">
                        {chapterTitle}
                      </h1>
                      <p className="mt-3 font-serif text-lg text-zinc-300">{snapshot.title}</p>
                      <p className="mt-4 text-sm leading-relaxed text-zinc-300">{chapterSummary}</p>
                      <p className="mt-4 text-sm leading-relaxed text-zinc-400">{snapshot.premise}</p>
                      {chapterMeta ? (
                        <p className="mt-5 text-xs uppercase tracking-[0.18em] text-zinc-500">
                          {chapterMeta}
                        </p>
                      ) : null}
                    </div>

                    {worldTime ? (
                      <div className="w-full max-w-xs rounded-2xl border border-zinc-800 bg-zinc-950/70 px-5 py-4 lg:mt-2 lg:w-auto lg:min-w-52">
                        <p className="text-[0.68rem] uppercase tracking-[0.22em] text-zinc-500">Current Time</p>
                        <p className="mt-3 font-serif text-2xl font-semibold text-zinc-100">{worldTime.clockLabel}</p>
                        <p className="mt-1 text-sm text-zinc-300">{worldTime.timeOfDay}</p>
                        <p className="mt-2 text-xs uppercase tracking-[0.18em] text-zinc-500">{worldTime.dayLabel}</p>
                      </div>
                    ) : null}
                  </div>
                </header>

                <div className="mt-8 space-y-6">
                  {missedTurnDigests.length ? (
                    <section className="rounded-3xl border border-amber-700/40 bg-amber-950/20 p-6">
                      <p className="text-[0.68rem] uppercase tracking-[0.22em] text-amber-300/70">
                        Missed Outcome
                      </p>
                      <div className="mt-4 space-y-4">
                        {missedTurnDigests.map((digest) => (
                          <article key={digest.turnId} className="rounded-2xl border border-amber-900/50 bg-zinc-950/60 p-4">
                            {digest.whatChanged.length ? (
                              <p className="text-sm leading-relaxed text-zinc-200">
                                {digest.whatChanged.join(" ")}
                              </p>
                            ) : null}
                            {digest.why.length ? (
                              <p className="mt-2 text-xs leading-relaxed text-zinc-400">
                                {digest.why.join(" ")}
                              </p>
                            ) : null}
                          </article>
                        ))}
                      </div>
                    </section>
                  ) : null}

                  {latestWhatChanged.length || latestWhy.length ? (
                    <section className="rounded-3xl border border-zinc-800 bg-zinc-950/70 p-6">
                      <p className="text-[0.68rem] uppercase tracking-[0.22em] text-zinc-500">
                        Latest Outcome
                      </p>
                      {latestWhatChanged.length ? (
                        <div className="mt-4 space-y-2">
                          {latestWhatChanged.map((line) => (
                            <p key={line} className="text-sm leading-relaxed text-zinc-200">
                              {line}
                            </p>
                          ))}
                        </div>
                      ) : null}
                      {latestWhy.length ? (
                        <div className="mt-4 space-y-2 border-t border-zinc-800 pt-4">
                          {latestWhy.map((line) => (
                            <p key={line} className="text-xs leading-relaxed text-zinc-400">
                              {line}
                            </p>
                          ))}
                        </div>
                      ) : null}
                    </section>
                  ) : null}

                  {recentMessages.map((message) => (
                    <article
                      key={message.id}
                      className="rounded-3xl border border-zinc-800 bg-zinc-950/70 p-6 shadow-lg shadow-black/10"
                    >
                      <p className="text-[0.68rem] uppercase tracking-[0.22em] text-zinc-500">
                        {formatMessageKicker(message)}
                      </p>
                      <p className="mt-3 whitespace-pre-wrap text-base leading-relaxed text-zinc-300">
                        {message.content}
                      </p>
                    </article>
                  ))}
                  {streamedNarration ? (
                    <article className="rounded-3xl border border-amber-700/40 bg-amber-950/10 p-6 shadow-lg shadow-black/10">
                      <p className="text-[0.68rem] uppercase tracking-[0.22em] text-amber-300/70">
                        Dungeon Master
                      </p>
                      <p className="mt-3 whitespace-pre-wrap text-base leading-relaxed text-zinc-100">
                        {streamedNarration}
                      </p>
                    </article>
                  ) : null}
                </div>
              </div>

              <div className="sticky bottom-4 z-10 mt-10">
                <div className="mx-auto max-w-4xl rounded-[1.75rem] border border-zinc-800 bg-zinc-950/95 p-5 shadow-2xl shadow-black/30 backdrop-blur">
                  <div className="border-b border-zinc-800 pb-4">
                    <p className="text-[0.68rem] uppercase tracking-[0.22em] text-zinc-500">Your Turn</p>
                    <h2 className="mt-2 font-serif text-2xl font-semibold text-zinc-100">
                      Choose the next move.
                    </h2>
                  </div>

                  {suggestedActions.length ? (
                    <div className="mt-5 flex flex-wrap gap-2">
                      {suggestedActions.map((suggestedAction) => (
                        <button
                          key={suggestedAction}
                          type="button"
                          className="button-press rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-50 transition hover:border-amber-400/60 hover:bg-amber-400/15"
                          onClick={() => void submitTurn(suggestedAction)}
                          disabled={submitting}
                        >
                          {suggestedAction}
                        </button>
                      ))}
                    </div>
                  ) : null}

                  <textarea
                    className="mt-5 min-h-32 w-full resize-y rounded-2xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm leading-relaxed text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-amber-400/50 focus:ring-2 focus:ring-amber-400/20"
                    value={action}
                    onChange={(event) => setAction(event.target.value)}
                    placeholder="What do you do, say, or think next?"
                  />

                  <div className="mt-5 flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      className="button-press rounded-2xl bg-zinc-100 px-5 py-3 text-sm font-semibold text-zinc-950 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                      onClick={() => void submitTurn(action)}
                      disabled={!action.trim() || submitting || retryingTurn || Boolean(pendingCheck)}
                    >
                      {submitting ? "Resolving..." : pendingCheck ? "Resolve pending roll first" : "Submit turn"}
                    </button>
                    <button
                      type="button"
                      className="button-press rounded-2xl border border-zinc-700 bg-zinc-900 px-5 py-3 text-sm font-semibold text-zinc-100 transition hover:border-zinc-500 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
                      onClick={() => void submitTurn("Observe", "observe")}
                      disabled={submitting || retryingTurn || !snapshot || Boolean(action.trim()) || Boolean(pendingCheck)}
                    >
                      Observe
                    </button>
                    {snapshot?.canRetryLatestTurn && latestRetryableTurnId ? (
                      <button
                        type="button"
                        className="button-press rounded-2xl border border-amber-500/30 bg-amber-500/10 px-5 py-3 text-sm font-semibold text-amber-50 transition hover:border-amber-400/60 hover:bg-amber-400/15 disabled:cursor-not-allowed disabled:opacity-60"
                        onClick={() => void undoLatestTurn()}
                        disabled={submitting || retryingTurn}
                      >
                        {retryingTurn ? "Undoing..." : "Undo Last Turn"}
                      </button>
                    ) : null}
                  </div>

                  {clarification ? (
                    <div className="mt-5 rounded-3xl border border-zinc-800 bg-zinc-900/80 p-4">
                      <p className="text-sm leading-relaxed text-zinc-100">{clarification.question}</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {clarification.options.map((option) => (
                          <button
                            key={option}
                            type="button"
                            className="button-press rounded-full border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 transition hover:border-zinc-500 hover:bg-zinc-900"
                            onClick={() => {
                              setAction(option);
                              setClarification(null);
                            }}
                          >
                            {option}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {pendingCheck ? (
                    <div className="mt-5 rounded-3xl border border-amber-500/30 bg-amber-500/10 p-4">
                      <p className="text-[0.68rem] uppercase tracking-[0.22em] text-amber-200/70">Roll Required</p>
                      <p className="mt-2 text-sm leading-relaxed text-zinc-100">
                        Roll {pendingCheck.check.mode === "normal" ? "2d6" : "two 2d6 totals"}
                        {" "}for {pendingCheck.check.stat.toUpperCase()}.
                        {typeof pendingCheck.check.dc === "number" ? ` DC ${pendingCheck.check.dc}.` : null}
                      </p>
                      <p className="mt-2 text-sm leading-relaxed text-zinc-300">{pendingCheck.check.reason}</p>
                      <div className="mt-4 flex flex-wrap gap-3">
                        <button
                          type="button"
                          className="button-press rounded-2xl bg-amber-200 px-4 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
                          onClick={() => void submitPendingCheck()}
                          disabled={submitting}
                        >
                          {submitting ? "Rolling..." : pendingCheck.check.mode === "normal" ? "Roll 2d6" : "Roll Both"}
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {turnError ? <p className="mt-4 text-sm text-red-400">{turnError}</p> : null}

                  {warnings.length ? (
                    <div className="mt-4 space-y-2">
                      {warnings.map((warning) => (
                        <p key={warning} className="text-sm leading-relaxed text-zinc-300">
                          {warning}
                        </p>
                      ))}
                    </div>
                  ) : null}

                  {latestCheck ? (
                    <p className="mt-4 text-sm leading-relaxed text-zinc-300">
                      Check: {latestCheck.stat.toUpperCase()} {latestCheck.outcome} ({latestCheck.total})
                    </p>
                  ) : null}
                </div>
              </div>
            </>
          ) : (
            <div className="flex min-h-[420px] flex-col items-center justify-center text-center">
              <p className="text-[0.68rem] uppercase tracking-[0.22em] text-zinc-500">No Active Campaign</p>
              <h2 className="mt-4 font-serif text-3xl text-zinc-100">
                Start with a world worth stepping into.
              </h2>
              <p className="mt-3 max-w-lg text-sm leading-relaxed text-zinc-400">
                Create a module, choose a protagonist, and come back here once a campaign is ready to play.
              </p>
              <div className="mt-6 flex flex-wrap justify-center gap-3">
                <button
                  type="button"
                  className="button-press rounded-2xl border border-zinc-700 bg-zinc-100 px-5 py-3 text-sm font-semibold text-zinc-950 transition hover:bg-white"
                  onClick={() => router.push("/campaigns/new")}
                >
                  Create Campaign
                </button>
                <button
                  type="button"
                  className="button-press rounded-2xl border border-zinc-700 bg-zinc-900 px-5 py-3 text-sm font-semibold text-zinc-100 transition hover:border-zinc-500 hover:bg-zinc-800"
                  onClick={() => router.push("/characters")}
                >
                  View Characters
                </button>
              </div>
            </div>
          )}
        </section>
      </div>

      <aside
        className={[
          "fixed right-0 top-0 z-40 h-full w-full max-w-md border-l border-zinc-800 bg-zinc-950/98 p-6 shadow-2xl shadow-black/40 backdrop-blur transition-transform duration-300",
          locationsDrawerOpen ? "translate-x-0" : "translate-x-full",
        ].join(" ")}
      >
        <div className="flex h-full flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-zinc-800 pb-4">
            <div>
              <p className="text-[0.68rem] uppercase tracking-[0.22em] text-zinc-500">World Drawer</p>
              <h2 className="mt-2 font-serif text-2xl font-semibold text-zinc-100">Routes, locals, and leads</h2>
            </div>
            <button
              type="button"
              className="button-press rounded-2xl border border-zinc-700 bg-zinc-900 p-2 text-zinc-100 transition hover:border-zinc-500 hover:bg-zinc-800"
              onClick={() => setLocationsDrawerOpen(false)}
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-6 flex-1 space-y-6 overflow-y-auto pr-1">
            <section className="rounded-[1.5rem] border border-zinc-800 bg-zinc-900/70 p-5">
              <p className="text-[0.68rem] uppercase tracking-[0.22em] text-zinc-500">Campaign Switcher</p>
              {loading ? (
                <p className="mt-4 text-sm text-zinc-400">Loading campaigns...</p>
              ) : (
                <div className="mt-4 space-y-3">
                  {campaigns.map((campaign) => (
                    <button
                      key={campaign.id}
                      type="button"
                      onClick={() => {
                        setCampaignId(campaign.id);
                        setLocationsDrawerOpen(false);
                        router.push(`/play/${campaign.id}`);
                      }}
                      className={[
                        "w-full rounded-3xl border p-4 text-left transition",
                        campaignId === campaign.id
                          ? "border-amber-500/50 bg-zinc-950 text-zinc-100 shadow-lg shadow-amber-950/20"
                          : "border-zinc-800 bg-zinc-900/80 text-zinc-200 hover:border-zinc-600 hover:bg-zinc-900",
                      ].join(" ")}
                    >
                      <h3 className="font-serif text-base font-semibold text-zinc-100">{campaign.title}</h3>
                      <p className="mt-2 text-xs leading-relaxed text-zinc-400">{campaign.currentLocationName}</p>
                    </button>
                  ))}
                </div>
              )}
            </section>

            {snapshot ? (
              <>
                <section className="rounded-[1.5rem] border border-zinc-800 bg-zinc-900/70 p-5">
                  <p className="text-[0.68rem] uppercase tracking-[0.22em] text-zinc-500">
                    {activeJourney ? "Journey" : "Routes and Leads"}
                  </p>
                  <div className="mt-4 space-y-5">
                    {activeJourney ? (
                      <div className="rounded-3xl border border-amber-500/30 bg-amber-500/10 p-4">
                        <h3 className="font-serif text-lg font-semibold text-zinc-100">
                          {activeJourney.originLocationName} to {activeJourney.destinationLocationName}
                        </h3>
                        <p className="mt-2 text-sm leading-relaxed text-zinc-300">
                          {activeJourney.elapsedMinutes} of {activeJourney.totalDurationMinutes} minutes completed.
                        </p>
                        <p className="mt-1 text-sm leading-relaxed text-zinc-400">
                          {activeJourney.remainingMinutes} minutes remain before arrival.
                        </p>
                        <div className="mt-4 flex flex-wrap gap-3">
                          <button
                            type="button"
                            className="button-press rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm font-semibold text-amber-50 transition hover:border-amber-400/60 hover:bg-amber-400/15 disabled:cursor-not-allowed disabled:opacity-60"
                            onClick={() => {
                              setLocationsDrawerOpen(false);
                              setAction(`I continue toward ${activeJourney.destinationLocationName}.`);
                            }}
                            disabled={submitting}
                          >
                            Continue Journey
                          </button>
                          <button
                            type="button"
                            className="button-press rounded-2xl border border-zinc-700 bg-zinc-950/70 px-4 py-2 text-sm font-semibold text-zinc-100 transition hover:border-zinc-500 hover:bg-zinc-900 disabled:cursor-not-allowed disabled:opacity-60"
                            onClick={() => {
                              setLocationsDrawerOpen(false);
                              setAction(`I turn back toward ${activeJourney.originLocationName}.`);
                            }}
                            disabled={submitting}
                          >
                            Turn Back
                          </button>
                        </div>
                      </div>
                    ) : null}

                    {!activeJourney ? (
                      <>
                        <div>
                          <p className="text-[0.68rem] uppercase tracking-[0.22em] text-zinc-500">Routes</p>
                          <div className="mt-3 space-y-3">
                            {primaryRoutes.length ? (
                              primaryRoutes.map((route) => {
                                const routeIsOpen = route.currentStatus === "open";
                                const actionLabel = routeIsOpen ? "Set Out" : "Address Obstruction";
                                return (
                                  <div key={route.id} className="rounded-3xl border border-zinc-800 bg-zinc-950/70 p-4">
                                    <h3 className="font-serif text-lg font-semibold text-zinc-100">
                                      {route.targetLocationName}
                                    </h3>
                                    <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                                      {route.travelTimeMinutes} min · danger {route.dangerLevel} · {route.currentStatus}
                                    </p>
                                    {route.accessRequirementText ? (
                                      <p className="mt-2 text-sm leading-relaxed text-amber-200/80">
                                        {route.accessRequirementText}
                                      </p>
                                    ) : null}
                                    {route.description ? (
                                      <p className="mt-2 text-sm leading-relaxed text-zinc-500">{route.description}</p>
                                    ) : null}
                                    <button
                                      type="button"
                                      className="button-press mt-4 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm font-semibold text-amber-50 transition hover:border-amber-400/60 hover:bg-amber-400/15 disabled:cursor-not-allowed disabled:opacity-60"
                                      onClick={() => {
                                        setLocationsDrawerOpen(false);
                                        if (routeIsOpen) {
                                          void submitTurnWithIntent(
                                            `I set out for ${route.targetLocationName}.`,
                                            undefined,
                                            {
                                              type: "travel_route",
                                              edgeId: route.id,
                                              targetLocationId: route.targetLocationId,
                                            },
                                          );
                                          return;
                                        }
                                        setAction(
                                          route.accessRequirementText
                                            ? `I deal with what blocks the route to ${route.targetLocationName}: ${route.accessRequirementText}.`
                                            : `I figure out what is blocking the route to ${route.targetLocationName}.`,
                                        );
                                      }}
                                      disabled={submitting}
                                    >
                                      {actionLabel}
                                    </button>
                                  </div>
                                );
                              })
                            ) : (
                              <p className="text-sm text-zinc-500">No major routes are currently actionable here.</p>
                            )}
                          </div>
                        </div>

                        <div>
                          <p className="text-[0.68rem] uppercase tracking-[0.22em] text-zinc-500">
                            Local Points of Interest
                          </p>
                          <div className="mt-3 space-y-3">
                            {localPointOfInterestRoutes.length ? (
                              localPointOfInterestRoutes.map((route) => {
                                const routeIsOpen = route.currentStatus === "open";
                                return (
                                  <div key={route.id} className="rounded-3xl border border-zinc-800 bg-zinc-950/70 p-4">
                                    <h3 className="font-serif text-lg font-semibold text-zinc-100">
                                      {route.targetLocationName}
                                    </h3>
                                    <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                                      {route.travelTimeMinutes} min · danger {route.dangerLevel} · {route.currentStatus}
                                    </p>
                                    {route.accessRequirementText ? (
                                      <p className="mt-2 text-sm leading-relaxed text-amber-200/80">
                                        {route.accessRequirementText}
                                      </p>
                                    ) : null}
                                    {route.description ? (
                                      <p className="mt-2 text-sm leading-relaxed text-zinc-500">{route.description}</p>
                                    ) : null}
                                    <button
                                      type="button"
                                      className="button-press mt-4 rounded-2xl border border-zinc-700 bg-zinc-950/70 px-4 py-2 text-sm font-semibold text-zinc-100 transition hover:border-zinc-500 hover:bg-zinc-900 disabled:cursor-not-allowed disabled:opacity-60"
                                      onClick={() => {
                                        setLocationsDrawerOpen(false);
                                        if (routeIsOpen) {
                                          void submitTurnWithIntent(
                                            `I head for ${route.targetLocationName}.`,
                                            undefined,
                                            {
                                              type: "travel_route",
                                              edgeId: route.id,
                                              targetLocationId: route.targetLocationId,
                                            },
                                          );
                                          return;
                                        }
                                        setAction(
                                          route.accessRequirementText
                                            ? `I deal with what blocks the way to ${route.targetLocationName}: ${route.accessRequirementText}.`
                                            : `I investigate the obstacle keeping us from ${route.targetLocationName}.`,
                                        );
                                      }}
                                      disabled={submitting}
                                    >
                                      {routeIsOpen ? "Go There" : "Investigate Blockage"}
                                    </button>
                                  </div>
                                );
                              })
                            ) : (
                              <p className="text-sm text-zinc-500">No local points of interest are surfaced yet.</p>
                            )}
                          </div>
                        </div>
                      </>
                    ) : null}

                    <div>
                      <p className="text-[0.68rem] uppercase tracking-[0.22em] text-zinc-500">Leads</p>
                      <div className="mt-3 space-y-3">
                        {locationLeads.length ? (
                          locationLeads.map((lead) => (
                            <div key={lead.locationId} className="rounded-3xl border border-zinc-800 bg-zinc-950/70 p-4">
                              <h3 className="font-serif text-lg font-semibold text-zinc-100">{lead.name}</h3>
                              <p className="mt-1 text-xs uppercase tracking-[0.16em] text-zinc-500">
                                {lead.type} · {lead.discoveryState}
                              </p>
                              <p className="mt-2 text-sm leading-relaxed text-zinc-400">{lead.summary}</p>
                              <button
                                type="button"
                                className="button-press mt-4 rounded-2xl border border-zinc-700 bg-zinc-950/70 px-4 py-2 text-sm font-semibold text-zinc-100 transition hover:border-zinc-500 hover:bg-zinc-900 disabled:cursor-not-allowed disabled:opacity-60"
                                onClick={() => {
                                  setLocationsDrawerOpen(false);
                                  setAction(`I follow the lead about ${lead.name}.`);
                                }}
                                disabled={submitting}
                              >
                                Follow Lead
                              </button>
                            </div>
                          ))
                        ) : (
                          <p className="text-sm text-zinc-500">No extra leads are currently visible.</p>
                        )}
                      </div>
                    </div>
                  </div>
                </section>

                <section className="rounded-[1.5rem] border border-zinc-800 bg-zinc-900/70 p-5">
                  <p className="text-[0.68rem] uppercase tracking-[0.22em] text-zinc-500">Present NPCs</p>
                  <div className="mt-4 space-y-3">
                    {snapshot.presentNpcs.length ? (
                      snapshot.presentNpcs.map((npc) => (
                        <div key={npc.id} className="rounded-3xl border border-zinc-800 bg-zinc-950/70 p-4">
                          <h3 className="font-serif text-lg font-semibold text-zinc-100">{npc.name}</h3>
                          <p className="mt-1 text-xs uppercase tracking-[0.16em] text-zinc-500">{npc.role}</p>
                          <p className="mt-2 text-sm leading-relaxed text-zinc-400">{npc.summary}</p>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-zinc-500">No one notable is on the scene right now.</p>
                    )}
                  </div>
                </section>

                <section className="rounded-[1.5rem] border border-zinc-800 bg-zinc-900/70 p-5">
                  <p className="text-[0.68rem] uppercase tracking-[0.22em] text-zinc-500">Known Factions</p>
                  <div className="mt-4 space-y-3">
                    {snapshot.knownFactions.length ? (
                      snapshot.knownFactions.map((faction) => (
                        <div key={faction.id} className="rounded-3xl border border-zinc-800 bg-zinc-950/70 p-4">
                          <h3 className="font-serif text-lg font-semibold text-zinc-100">{faction.name}</h3>
                          <p className="mt-2 text-sm leading-relaxed text-zinc-400">{faction.summary}</p>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-zinc-500">No factions have been surfaced to the player yet.</p>
                    )}
                  </div>
                </section>

                <section className="rounded-[1.5rem] border border-zinc-800 bg-zinc-900/70 p-5">
                  <p className="text-[0.68rem] uppercase tracking-[0.22em] text-zinc-500">
                    Discovered Information
                  </p>
                  <div className="mt-4 space-y-3">
                    {snapshot.discoveredInformation.length ? (
                      snapshot.discoveredInformation.map((information) => (
                        <div key={information.id} className="rounded-3xl border border-zinc-800 bg-zinc-950/70 p-4">
                          <h3 className="font-serif text-lg font-semibold text-zinc-100">
                            {information.title}
                          </h3>
                          <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                            {information.summary}
                          </p>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-zinc-500">No notable leads have been written into the journal yet.</p>
                    )}
                  </div>
                </section>
              </>
            ) : null}
          </div>
        </div>
      </aside>
    </main>
  );
}
