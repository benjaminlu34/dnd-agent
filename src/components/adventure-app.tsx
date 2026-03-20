"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  CampaignListItem,
  CheckResult,
  PlayerCampaignSnapshot,
  StoryMessage,
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
  if (message.role === "user") return "You";
  if (message.role === "system") return "System";
  return "Dungeon Master";
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
        setSuggestedActions(data.snapshot.recentMessages.at(-1)?.payload?.suggestedActions as string[] ?? []);
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

  async function submitTurn(nextAction: string) {
    if (!campaignId || !sessionId || !nextAction.trim() || submitting) {
      return;
    }

    setSubmitting(true);
    setTurnError(null);
    setClarification(null);
    setWarnings([]);
    setLatestCheck(null);

    try {
      const response = await fetch("/api/turns", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          campaignId,
          sessionId,
          action: nextAction.trim(),
        }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
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
      setAction("");
    } catch (error) {
      setTurnError(error instanceof Error ? error.message : "Turn submission failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="app-shell">
      <div className="app-frame grid max-w-7xl gap-8 xl:grid-cols-[280px_1fr_320px]">
        <aside className="space-y-6">
          <section className="app-section p-6">
            <p className="text-[0.68rem] uppercase tracking-[0.22em] text-zinc-500">Campaigns</p>
            <div className="mt-4 space-y-3">
              <button
                type="button"
                className="button-press w-full rounded-full bg-white px-4 py-3 text-sm font-semibold text-black"
                onClick={() => router.push("/campaigns/new")}
              >
                New Campaign
              </button>
              <button
                type="button"
                className="button-press w-full rounded-full border border-zinc-700 px-4 py-3 text-sm font-semibold text-zinc-200"
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
                      "w-full rounded-2xl border p-4 text-left transition-colors",
                      campaignId === campaign.id
                        ? "border-zinc-500 bg-black"
                        : "border-zinc-800 bg-black hover:border-zinc-700",
                    ].join(" ")}
                  >
                    <h2 className="text-sm font-semibold text-white">{campaign.title}</h2>
                    <p className="mt-2 text-xs leading-6 text-zinc-400">{campaign.currentLocationName}</p>
                  </button>
                ))}
              </div>
            )}
          </section>

          {snapshot ? (
            <section className="app-section p-6">
              <p className="text-[0.68rem] uppercase tracking-[0.22em] text-zinc-500">Character</p>
              <h2 className="mt-3 text-xl font-semibold text-white">{snapshot.character.name}</h2>
              <p className="mt-1 text-sm text-zinc-400">{snapshot.character.archetype}</p>
              <p className="mt-4 text-xs uppercase tracking-[0.18em] text-zinc-500">
                HP {snapshot.character.health} · Gold {snapshot.character.gold}
              </p>
            </section>
          ) : null}
        </aside>

        <section className="app-section p-6">
          {loadingSnapshot ? (
            <p className="text-sm text-zinc-400">Loading campaign state...</p>
          ) : snapshot ? (
            <>
              <header className="border-b border-white/10 pb-6">
                <p className="text-[0.68rem] uppercase tracking-[0.22em] text-zinc-500">Local Area</p>
                <h1 className="font-display mt-3 text-4xl font-semibold tracking-tight text-white md:text-5xl">
                  {snapshot.currentLocation.name}
                </h1>
                <p className="mt-3 max-w-3xl text-sm leading-7 text-zinc-400">
                  {snapshot.currentLocation.summary}
                </p>
                <p className="mt-4 text-xs uppercase tracking-[0.18em] text-zinc-500">
                  {snapshot.currentLocation.type} · {snapshot.currentLocation.state} · {snapshot.tone}
                </p>
              </header>

              <div className="mt-8 space-y-6">
                {recentMessages.map((message) => (
                  <article key={message.id} className="rounded-2xl border border-zinc-800 bg-black p-5">
                    <p className="text-[0.68rem] uppercase tracking-[0.22em] text-zinc-500">
                      {formatMessageKicker(message)}
                    </p>
                    <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-zinc-200">
                      {message.content}
                    </p>
                  </article>
                ))}
              </div>

              <div className="mt-8 rounded-2xl border border-zinc-800 bg-black p-5">
                <textarea
                  className="min-h-28 w-full resize-y bg-transparent text-sm leading-7 text-zinc-100 outline-none placeholder:text-zinc-600"
                  value={action}
                  onChange={(event) => setAction(event.target.value)}
                  placeholder="Describe what you do next..."
                />
                <div className="mt-4 flex flex-wrap gap-2">
                  {suggestedActions.map((suggestedAction) => (
                    <button
                      key={suggestedAction}
                      type="button"
                      className="button-press rounded-full border border-zinc-700 px-3 py-2 text-xs text-zinc-200"
                      onClick={() => setAction(suggestedAction)}
                    >
                      {suggestedAction}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="button-press mt-4 rounded-full bg-white px-5 py-3 text-sm font-semibold text-black disabled:opacity-60"
                  onClick={() => void submitTurn(action)}
                  disabled={!action.trim() || submitting}
                >
                  {submitting ? "Resolving..." : "Take Action"}
                </button>
                {clarification ? (
                  <div className="mt-4 rounded-2xl border border-zinc-700 bg-zinc-950 p-4">
                    <p className="text-sm text-zinc-100">{clarification.question}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {clarification.options.map((option) => (
                        <button
                          key={option}
                          type="button"
                          className="button-press rounded-full border border-zinc-700 px-3 py-2 text-xs text-zinc-100"
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
                      <p key={warning} className="text-sm text-zinc-300">
                        {warning}
                      </p>
                    ))}
                  </div>
                ) : null}
                {latestCheck ? (
                  <p className="mt-4 text-sm text-zinc-300">
                    Check: {latestCheck.stat.toUpperCase()} {latestCheck.outcome} ({latestCheck.total})
                  </p>
                ) : null}
              </div>
            </>
          ) : (
            <div className="flex min-h-[420px] flex-col items-center justify-center text-center">
              <p className="text-[0.68rem] uppercase tracking-[0.22em] text-zinc-500">No Active Campaign</p>
              <h2 className="font-display mt-4 text-3xl text-white">Start with a world worth stepping into.</h2>
              <p className="mt-3 max-w-lg text-sm leading-7 text-zinc-400">
                Create a module, choose a protagonist, and come back here once a campaign is ready to play.
              </p>
              <div className="mt-6 flex flex-wrap justify-center gap-3">
                <button
                  type="button"
                  className="button-press rounded-full bg-white px-5 py-3 text-sm font-semibold text-black"
                  onClick={() => router.push("/campaigns/new")}
                >
                  Create Campaign
                </button>
                <button
                  type="button"
                  className="button-press rounded-full border border-zinc-700 px-5 py-3 text-sm font-semibold text-zinc-100"
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
              <section className="app-section p-6">
                <p className="text-[0.68rem] uppercase tracking-[0.22em] text-zinc-500">Routes</p>
                <div className="mt-4 space-y-3">
                  {snapshot.adjacentRoutes.map((route) => (
                    <div key={route.id} className="rounded-2xl border border-zinc-800 p-4">
                      <h3 className="text-sm font-semibold text-white">{route.targetLocationName}</h3>
                      <p className="mt-2 text-xs leading-6 text-zinc-400">
                        {route.travelTimeMinutes} min · danger {route.dangerLevel} · {route.currentStatus}
                      </p>
                    </div>
                  ))}
                </div>
              </section>

              <section className="app-section p-6">
                <p className="text-[0.68rem] uppercase tracking-[0.22em] text-zinc-500">Present NPCs</p>
                <div className="mt-4 space-y-3">
                  {snapshot.presentNpcs.map((npc) => (
                    <div key={npc.id} className="rounded-2xl border border-zinc-800 p-4">
                      <h3 className="text-sm font-semibold text-white">{npc.name}</h3>
                      <p className="mt-1 text-xs uppercase tracking-[0.16em] text-zinc-500">{npc.role}</p>
                      <p className="mt-2 text-xs leading-6 text-zinc-400">{npc.summary}</p>
                    </div>
                  ))}
                </div>
              </section>

              <section className="app-section p-6">
                <p className="text-[0.68rem] uppercase tracking-[0.22em] text-zinc-500">Known Factions</p>
                <div className="mt-4 space-y-3">
                  {snapshot.knownFactions.map((faction) => (
                    <div key={faction.id} className="rounded-2xl border border-zinc-800 p-4">
                      <h3 className="text-sm font-semibold text-white">{faction.name}</h3>
                      <p className="mt-2 text-xs leading-6 text-zinc-400">{faction.summary}</p>
                    </div>
                  ))}
                </div>
              </section>

              <section className="app-section p-6">
                <p className="text-[0.68rem] uppercase tracking-[0.22em] text-zinc-500">Discovered Information</p>
                <div className="mt-4 space-y-3">
                  {snapshot.discoveredInformation.map((information) => (
                    <div key={information.id} className="rounded-2xl border border-zinc-800 p-4">
                      <h3 className="text-sm font-semibold text-white">{information.title}</h3>
                      <p className="mt-2 text-xs leading-6 text-zinc-400">{information.summary}</p>
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
