"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  CampaignListItem,
  CheckResult,
  PlayerCampaignSnapshot,
  StoryMessage,
  TurnSubmissionRequest,
  TurnDigest,
} from "@/lib/game/types";

type TurnStreamEvent =
  | { type: "narration"; chunk: string }
  | { type: "clarification"; question: string; options: string[] }
  | { type: "actions"; actions: string[] }
  | { type: "state"; snapshot: PlayerCampaignSnapshot }
  | { type: "warning"; message: string }
  | { type: "error"; message: string }
  | { type: "check_result"; result: CheckResult }
  | { type: "done" };

type InventoryItem = PlayerCampaignSnapshot["character"]["inventory"][number];

async function consumeNdjson(
  response: Response,
  onEvent: (event: TurnStreamEvent) => void,
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

      onEvent(JSON.parse(line) as TurnStreamEvent);
    }
  }

  if (buffer.trim()) {
    onEvent(JSON.parse(buffer) as TurnStreamEvent);
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

function isEquipmentItem(item: InventoryItem) {
  const haystack = `${item.template.name} ${item.template.tags.join(" ")}`.toLowerCase();
  return EQUIPMENT_KEYWORDS.some((keyword) => haystack.includes(keyword));
}

export function AdventureApp({
  initialCampaignId = null,
}: {
  initialCampaignId?: string | null;
}) {
  const router = useRouter();
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
  const [submitting, setSubmitting] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [latestCheck, setLatestCheck] = useState<CheckResult | null>(null);
  const [suggestedActions, setSuggestedActions] = useState<string[]>([]);
  const [missedTurnDigests, setMissedTurnDigests] = useState<TurnDigest[]>([]);

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

  async function submitTurn(nextAction: string, mode?: TurnSubmissionRequest["mode"]) {
    if (!campaignId || !sessionId || !nextAction.trim() || submitting) {
      return;
    }

    setSubmitting(true);
    setTurnError(null);
    setClarification(null);
    setWarnings([]);
    setLatestCheck(null);

    try {
      const body: TurnSubmissionRequest = {
        campaignId,
        sessionId,
        requestId: crypto.randomUUID(),
        expectedStateVersion: snapshot?.stateVersion ?? 0,
        action: nextAction.trim(),
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
        const data = (await response.json().catch(() => null)) as
          | {
              error?: string;
              latestSnapshot?: PlayerCampaignSnapshot;
              latestStateVersion?: number;
              missedTurnDigests?: TurnDigest[];
              retryWithNewRequestId?: boolean;
              message?: string;
              result?: {
                error?: {
                  message?: string;
                } | null;
              } | null;
            }
          | null;

        if (response.status === 409 && data?.error === "state_conflict" && data.latestSnapshot) {
          setSnapshot(data.latestSnapshot);
          setMissedTurnDigests(data.missedTurnDigests ?? []);
          setSuggestedActions(extractSuggestedActions(data.latestSnapshot));
          setAction("");
          setTurnError("The world advanced before this action could commit. Review the missed outcome and choose a new action.");
          return;
        }

        if (response.status === 409 && data?.error === "retry_with_new_request_id") {
          setTurnError(
            data.result?.error?.message
            ?? "That request already ended in a retryable failure state. Submit the action again to create a fresh attempt.",
          );
          return;
        }

        if (response.status === 400 && data?.error === "invalid_expected_state_version") {
          if (data.latestSnapshot) {
            setSnapshot(data.latestSnapshot);
            setSuggestedActions(extractSuggestedActions(data.latestSnapshot));
          }
          setTurnError(
            data.message
            ?? "The client state version was ahead of the campaign. Review the current state and choose a fresh action.",
          );
          return;
        }

        throw new Error(data?.error ?? "Turn submission failed.");
      }

      const nextWarnings: string[] = [];
      let nextSnapshot: PlayerCampaignSnapshot | null = null;
      let nextActions: string[] = [];
      await consumeNdjson(response, (event) => {
        if (event.type === "warning") {
          nextWarnings.push(event.message);
        } else if (event.type === "clarification") {
          setClarification({
            question: event.question,
            options: event.options,
          });
        } else if (event.type === "state") {
          nextSnapshot = event.snapshot;
        } else if (event.type === "actions") {
          nextActions = event.actions;
        } else if (event.type === "error") {
          setTurnError(event.message);
        } else if (event.type === "check_result") {
          setLatestCheck(event.result);
        }
      });

      if (nextSnapshot) {
        setSnapshot(nextSnapshot);
      }

      setWarnings(nextWarnings);
      setSuggestedActions(nextActions);
      setMissedTurnDigests([]);
      setAction("");
    } catch (error) {
      setTurnError(error instanceof Error ? error.message : "Turn submission failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="app-shell relative overflow-hidden bg-zinc-950 text-zinc-300">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[radial-gradient(circle_at_top,_rgba(245,158,11,0.16),_transparent_52%),linear-gradient(180deg,_rgba(24,24,27,0.1),_rgba(9,9,11,0))]" />
      <div className="app-frame relative grid max-w-7xl gap-6 xl:grid-cols-[280px_minmax(0,1fr)_320px]">
        <aside className="space-y-6">
          <section className="rounded-[1.75rem] border border-zinc-800 bg-zinc-950/95 p-6 shadow-2xl shadow-black/20 backdrop-blur">
            <p className="text-[0.68rem] uppercase tracking-[0.22em] text-zinc-500">Campaigns</p>
            <div className="mt-4 space-y-3">
              <button
                type="button"
                className="button-press w-full rounded-2xl border border-zinc-700 bg-zinc-100 px-4 py-3 text-sm font-semibold text-zinc-950 transition hover:bg-white"
                onClick={() => router.push("/")}
              >
                Home
              </button>
              <button
                type="button"
                className="button-press w-full rounded-2xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm font-semibold text-zinc-100 transition hover:border-zinc-500 hover:bg-zinc-800"
                onClick={() => router.push("/campaigns")}
              >
                View All Campaigns
              </button>
              <button
                type="button"
                className="button-press w-full rounded-2xl border border-zinc-700 bg-zinc-100 px-4 py-3 text-sm font-semibold text-zinc-950 transition hover:bg-white"
                onClick={() => router.push("/campaigns/new")}
              >
                New Campaign
              </button>
              <button
                type="button"
                className="button-press w-full rounded-2xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm font-semibold text-zinc-100 transition hover:border-zinc-500 hover:bg-zinc-800"
                onClick={() => router.push("/characters")}
              >
                Character Library
              </button>
            </div>
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
                      router.push(`/play/${campaign.id}`);
                    }}
                    className={[
                      "w-full rounded-3xl border p-4 text-left transition",
                      campaignId === campaign.id
                        ? "border-amber-500/50 bg-zinc-900 text-zinc-100 shadow-lg shadow-amber-950/20"
                        : "border-zinc-800 bg-zinc-900/80 text-zinc-200 hover:border-zinc-600 hover:bg-zinc-900",
                    ].join(" ")}
                  >
                    <h2 className="font-serif text-base font-semibold text-zinc-100">{campaign.title}</h2>
                    <p className="mt-2 text-xs leading-relaxed text-zinc-400">{campaign.currentLocationName}</p>
                  </button>
                ))}
              </div>
            )}
          </section>

          {snapshot ? (
            <section className="overflow-hidden rounded-[1.75rem] border border-zinc-800 bg-zinc-950/95 shadow-2xl shadow-black/20 backdrop-blur">
              <div className="divide-y divide-zinc-800">
                <section className="p-6">
                  <p className="text-[0.68rem] uppercase tracking-[0.22em] text-zinc-500">Character</p>
                  <h2 className="mt-3 font-serif text-2xl font-semibold text-zinc-100">
                    {snapshot.character.name}
                  </h2>
                  <p className="mt-1 text-sm text-zinc-400">{snapshot.character.archetype}</p>
                  <p className="mt-4 text-xs uppercase tracking-[0.18em] text-zinc-500">
                    HP {snapshot.character.health} · Gold {snapshot.character.gold}
                  </p>
                </section>

                <section className="p-6">
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

                <section className="p-6">
                  <p className="text-[0.68rem] uppercase tracking-[0.22em] text-zinc-500">Inventory</p>
                  <div className="mt-4 space-y-3">
                    {inventory.length ? (
                      inventory.map((item) => (
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
                      <p className="text-sm text-zinc-500">Nothing else rattling around in the pack.</p>
                    )}
                  </div>
                </section>
              </div>
            </section>
          ) : null}
        </aside>

        <section className="rounded-[2rem] border border-zinc-800 bg-zinc-900/95 p-6 shadow-2xl shadow-black/25 backdrop-blur md:p-8">
          {loadingSnapshot ? (
            <p className="text-sm text-zinc-400">Loading campaign state...</p>
          ) : snapshot ? (
            <>
              <div className="mx-auto max-w-3xl">
                <header className="border-b border-zinc-800 pb-8">
                  <p className="text-[0.68rem] uppercase tracking-[0.22em] text-zinc-500">Current Chapter</p>
                  <h1 className="mt-3 font-serif text-4xl font-semibold tracking-tight text-zinc-100 md:text-5xl">
                    {snapshot.currentLocation.name}
                  </h1>
                  <p className="mt-3 font-serif text-lg text-zinc-300">{snapshot.title}</p>
                  <p className="mt-4 text-sm leading-relaxed text-zinc-300">{snapshot.currentLocation.summary}</p>
                  <p className="mt-4 text-sm leading-relaxed text-zinc-400">{snapshot.premise}</p>
                  <p className="mt-5 text-xs uppercase tracking-[0.18em] text-zinc-500">
                    {snapshot.currentLocation.type} · {snapshot.currentLocation.state} · {snapshot.tone}
                  </p>
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
                </div>
              </div>

              <div className="sticky bottom-4 z-10 mt-10">
                <div className="mx-auto max-w-3xl rounded-[1.75rem] border border-zinc-800 bg-zinc-950/95 p-5 shadow-2xl shadow-black/30 backdrop-blur">
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
                      disabled={!action.trim() || submitting}
                    >
                      {submitting ? "Resolving..." : "Submit turn"}
                    </button>
                    <button
                      type="button"
                      className="button-press rounded-2xl border border-zinc-700 bg-zinc-900 px-5 py-3 text-sm font-semibold text-zinc-100 transition hover:border-zinc-500 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
                      onClick={() => void submitTurn("Observe", "observe")}
                      disabled={submitting || !snapshot || Boolean(action.trim())}
                    >
                      Observe
                    </button>
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

        <aside className="space-y-6">
          {snapshot ? (
            <>
              <section className="rounded-[1.75rem] border border-zinc-800 bg-zinc-950/95 p-6 shadow-2xl shadow-black/20 backdrop-blur">
                <p className="text-[0.68rem] uppercase tracking-[0.22em] text-zinc-500">Routes</p>
                <div className="mt-4 space-y-3">
                  {snapshot.adjacentRoutes.map((route) => (
                    <div key={route.id} className="rounded-3xl border border-zinc-800 bg-zinc-900/70 p-4">
                      <h3 className="font-serif text-lg font-semibold text-zinc-100">
                        {route.targetLocationName}
                      </h3>
                      <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                        {route.travelTimeMinutes} min · danger {route.dangerLevel} · {route.currentStatus}
                      </p>
                    </div>
                  ))}
                </div>
              </section>

              <section className="rounded-[1.75rem] border border-zinc-800 bg-zinc-950/95 p-6 shadow-2xl shadow-black/20 backdrop-blur">
                <p className="text-[0.68rem] uppercase tracking-[0.22em] text-zinc-500">Present NPCs</p>
                <div className="mt-4 space-y-3">
                  {snapshot.presentNpcs.map((npc) => (
                    <div key={npc.id} className="rounded-3xl border border-zinc-800 bg-zinc-900/70 p-4">
                      <h3 className="font-serif text-lg font-semibold text-zinc-100">{npc.name}</h3>
                      <p className="mt-1 text-xs uppercase tracking-[0.16em] text-zinc-500">{npc.role}</p>
                      <p className="mt-2 text-sm leading-relaxed text-zinc-400">{npc.summary}</p>
                    </div>
                  ))}
                </div>
              </section>

              <section className="rounded-[1.75rem] border border-zinc-800 bg-zinc-950/95 p-6 shadow-2xl shadow-black/20 backdrop-blur">
                <p className="text-[0.68rem] uppercase tracking-[0.22em] text-zinc-500">Known Factions</p>
                <div className="mt-4 space-y-3">
                  {snapshot.knownFactions.map((faction) => (
                    <div key={faction.id} className="rounded-3xl border border-zinc-800 bg-zinc-900/70 p-4">
                      <h3 className="font-serif text-lg font-semibold text-zinc-100">{faction.name}</h3>
                      <p className="mt-2 text-sm leading-relaxed text-zinc-400">{faction.summary}</p>
                    </div>
                  ))}
                </div>
              </section>

              <section className="rounded-[1.75rem] border border-zinc-800 bg-zinc-950/95 p-6 shadow-2xl shadow-black/20 backdrop-blur">
                <p className="text-[0.68rem] uppercase tracking-[0.22em] text-zinc-500">
                  Discovered Information
                </p>
                <div className="mt-4 space-y-3">
                  {snapshot.discoveredInformation.map((information) => (
                    <div key={information.id} className="rounded-3xl border border-zinc-800 bg-zinc-900/70 p-4">
                      <h3 className="font-serif text-lg font-semibold text-zinc-100">
                        {information.title}
                      </h3>
                      <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                        {information.summary}
                      </p>
                    </div>
                  ))}
                </div>
              </section>
            </>
          ) : null}
        </aside>
      </div>
    </main>
  );
}
