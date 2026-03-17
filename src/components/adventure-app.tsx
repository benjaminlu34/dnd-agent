"use client";

import clsx from "clsx";
import { startTransition, useEffect, useRef, useState } from "react";
import type {
  CampaignListItem,
  CampaignSnapshot,
  CheckResult,
  PendingCheck,
  StoryMessage,
} from "@/lib/game/types";

type TurnStreamEvent =
  | { type: "narration"; chunk: string }
  | { type: "check_required"; turnId: string; check: PendingCheck }
  | { type: "check_result"; result: CheckResult }
  | { type: "actions"; actions: string[] }
  | { type: "state"; snapshot: CampaignSnapshot }
  | { type: "warning"; message: string }
  | { type: "error"; message: string }
  | { type: "done" };

type JournalTab = "quests" | "people" | "journal" | "clues";

const STORAGE_KEY = "dnd-agent:last-campaign-id";

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

function usePrefersReducedMotion() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setPrefersReducedMotion(mediaQuery.matches);
    update();
    mediaQuery.addEventListener("change", update);
    return () => mediaQuery.removeEventListener("change", update);
  }, []);

  return prefersReducedMotion;
}

function inferSceneMoments(snapshot: CampaignSnapshot) {
  const text = `${snapshot.state.sceneState.title} ${snapshot.state.sceneState.summary}`.toLowerCase();

  let time = "";
  let weather = "";

  if (/(dawn|morning)/.test(text)) time = "Morning";
  else if (/(noon|afternoon)/.test(text)) time = "Afternoon";
  else if (/(dusk|evening|sunset)/.test(text)) time = "Evening";
  else if (/(night|midnight)/.test(text)) time = "Night";

  if (/(rain|storm)/.test(text)) weather = "Rain gathers over the rooftops";
  else if (/(fog|mist)/.test(text)) weather = "Mist hangs low over the streets";
  else if (/(wind|gale)/.test(text)) weather = "A restless wind moves through the district";
  else if (/(snow|frost|ice)/.test(text)) weather = "Cold bites at every exposed surface";

  return { time, weather };
}

function toNarrativeAction(action: string) {
  const trimmed = action.trim();

  if (!trimmed) {
    return trimmed;
  }

  if (/^(inspect|question|follow|press|regroup|push|ask|call|slip|study|search|speak|watch|approach|listen|enter|open|take|leave|head|wait)\b/i.test(trimmed)) {
    return trimmed;
  }

  return `Try to ${trimmed.charAt(0).toLowerCase()}${trimmed.slice(1)}`;
}

function formatCampaignDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}

function formatRelativeLabel(message: StoryMessage) {
  if (message.kind === "action") return "You";
  if (message.kind === "check") return "The dice";
  if (message.kind === "summary") return "Journal";
  if (message.kind === "warning") return "System";
  return "Dungeon Master";
}

function burstLength(text: string, start: number) {
  const slice = text.slice(start, start + 36);
  const punctuationIndex = slice.search(/[.,!?;:]/);

  if (punctuationIndex >= 0) {
    return punctuationIndex + 1;
  }

  const spaceIndex = slice.lastIndexOf(" ");
  if (spaceIndex > 8) {
    return spaceIndex + 1;
  }

  return Math.min(14, text.length - start);
}

function TypewriterText({
  text,
  active,
}: {
  text: string;
  active: boolean;
}) {
  const prefersReducedMotion = usePrefersReducedMotion();
  const [revealedLength, setRevealedLength] = useState(
    active && !prefersReducedMotion ? 0 : text.length,
  );
  const [skipped, setSkipped] = useState(false);

  useEffect(() => {
    if (!active || skipped || prefersReducedMotion || revealedLength >= text.length) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setRevealedLength((current) => Math.min(text.length, current + burstLength(text, current)));
    }, 34);

    return () => window.clearTimeout(timeout);
  }, [active, prefersReducedMotion, revealedLength, skipped, text]);

  useEffect(() => {
    if (!active || prefersReducedMotion) {
      return;
    }

    const skip = () => {
      setSkipped(true);
      setRevealedLength(text.length);
    };

    window.addEventListener("keydown", skip, { once: true });
    return () => window.removeEventListener("keydown", skip);
  }, [active, prefersReducedMotion, text.length]);

  const effectiveRevealedLength =
    active && !prefersReducedMotion && !skipped ? revealedLength : text.length;
  const visible = text.slice(0, effectiveRevealedLength);

  return (
    <div
      className={clsx("cursor-text", active && !prefersReducedMotion && "story-typewriter")}
      onClick={() => {
        if (active && !prefersReducedMotion) {
          setSkipped(true);
          setRevealedLength(text.length);
        }
      }}
      role={active ? "button" : undefined}
      tabIndex={active ? 0 : -1}
      onKeyDown={(event) => {
        if (active && !prefersReducedMotion && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          setSkipped(true);
          setRevealedLength(text.length);
        }
      }}
    >
      <span className="whitespace-pre-wrap">{visible}</span>
      {active && !prefersReducedMotion && effectiveRevealedLength < text.length ? (
        <span className="type-cursor" aria-hidden="true">
          |
        </span>
      ) : null}
    </div>
  );
}

function MessageBlock({
  message,
  active,
}: {
  message: StoryMessage;
  active: boolean;
}) {
  if (message.role === "assistant") {
    return (
      <article className="story-entry animate-fade-in">
        <p className="story-kicker">{formatRelativeLabel(message)}</p>
        <div className="story-prose">
          <TypewriterText text={message.content} active={active} />
        </div>
      </article>
    );
  }

  if (message.role === "user") {
    return (
      <article className="ml-auto max-w-2xl rounded-[1.4rem] border border-[var(--panel-border)]/70 bg-[rgba(44,31,18,0.62)] px-4 py-3 text-[0.97rem] leading-7 text-[#f5e7c4] shadow-lg">
        <p className="story-kicker">{formatRelativeLabel(message)}</p>
        <p className="whitespace-pre-wrap">{message.content}</p>
      </article>
    );
  }

  return (
    <article
      className={clsx(
        "max-w-2xl rounded-[1.3rem] border px-4 py-3 text-[0.95rem] leading-7",
        message.kind === "warning"
          ? "border-[var(--danger)]/40 bg-[var(--danger)]/10 text-[#ffd8c8]"
          : "border-white/8 bg-white/4 text-[var(--muted)]",
      )}
    >
      <p className="story-kicker">{formatRelativeLabel(message)}</p>
      <p className="whitespace-pre-wrap">{message.content}</p>
    </article>
  );
}

function EmptyJournalCopy({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-[1.25rem] border border-dashed border-white/10 bg-black/10 px-4 py-5 text-sm leading-7 text-[var(--muted)]">
      {children}
    </div>
  );
}

export function AdventureApp() {
  const [view, setView] = useState<"home" | "campaign">("home");
  const [snapshot, setSnapshot] = useState<CampaignSnapshot | null>(null);
  const [campaigns, setCampaigns] = useState<CampaignListItem[]>([]);
  const [messages, setMessages] = useState<StoryMessage[]>([]);
  const [suggestedActions, setSuggestedActions] = useState<string[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [pendingCheck, setPendingCheck] = useState<(PendingCheck & { turnId: string }) | null>(null);
  const [lastCheckResult, setLastCheckResult] = useState<CheckResult | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "streaming">("idle");
  const [campaignsLoading, setCampaignsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [journalTab, setJournalTab] = useState<JournalTab>("quests");
  const feedRef = useRef<HTMLDivElement | null>(null);
  const streamingMessageIdRef = useRef<string | null>(null);
  const [activeNarrationId, setActiveNarrationId] = useState<string | null>(null);
  const [lastCampaignId, setLastCampaignId] = useState<string | null>(null);

  function removeStreamingNarration() {
    const currentStreamId = streamingMessageIdRef.current;

    if (!currentStreamId) {
      return;
    }

    setMessages((current) => current.filter((message) => message.id !== currentStreamId));
    streamingMessageIdRef.current = null;
    setActiveNarrationId(null);
  }

  useEffect(() => {
    const campaignId = window.localStorage.getItem(STORAGE_KEY);
    setLastCampaignId(campaignId);
    void refreshCampaigns();
  }, []);

  useEffect(() => {
    feedRef.current?.scrollTo({
      top: feedRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, pendingCheck, activeNarrationId]);

  async function refreshCampaigns() {
    setCampaignsLoading(true);

    try {
      const response = await fetch("/api/campaigns", {
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error("Unable to load your campaigns.");
      }

      const data = (await response.json()) as { campaigns: CampaignListItem[] };
      setCampaigns(data.campaigns);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load campaigns.");
    } finally {
      setCampaignsLoading(false);
    }
  }

  async function loadCampaign(campaignId: string) {
    setStatus("loading");
    setError(null);

    try {
      const response = await fetch(`/api/campaigns/${campaignId}`, {
        cache: "no-store",
      });

      if (!response.ok) {
        window.localStorage.removeItem(STORAGE_KEY);
        throw new Error("Unable to load that campaign.");
      }

      const data = (await response.json()) as { snapshot: CampaignSnapshot };
      applySnapshot(data.snapshot);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load campaign.");
    } finally {
      setStatus("idle");
    }
  }

  function applySnapshot(nextSnapshot: CampaignSnapshot) {
    window.localStorage.setItem(STORAGE_KEY, nextSnapshot.campaignId);
    setLastCampaignId(nextSnapshot.campaignId);

    startTransition(() => {
      setView("campaign");
      setSnapshot(nextSnapshot);
      setMessages(nextSnapshot.recentMessages);
      setSuggestedActions(nextSnapshot.state.sceneState.suggestedActions);
      setPendingCheck(null);
      streamingMessageIdRef.current = null;
      setActiveNarrationId(null);
    });
  }

  async function startAdventure() {
    setStatus("loading");
    setError(null);

    try {
      const response = await fetch("/api/adventure/start", {
        method: "POST",
      });

      if (!response.ok) {
        throw new Error("Failed to create the adventure.");
      }

      const data = (await response.json()) as { snapshot: CampaignSnapshot };
      applySnapshot(data.snapshot);
      await refreshCampaigns();
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : "Failed to create adventure.");
    } finally {
      setStatus("idle");
    }
  }

  function appendStreamingNarration(chunk: string) {
    const streamId = streamingMessageIdRef.current ?? `stream_${Date.now()}`;

    if (!streamingMessageIdRef.current) {
      streamingMessageIdRef.current = streamId;
      setActiveNarrationId(streamId);
      setMessages((current) => [
        ...current,
        {
          id: streamId,
          role: "assistant",
          kind: "narration",
          content: chunk,
          createdAt: new Date().toISOString(),
        },
      ]);
      return;
    }

    setMessages((current) =>
      current.map((message) =>
        message.id === streamId
          ? {
              ...message,
              content: `${message.content}${chunk}`,
            }
          : message,
      ),
    );
  }

  async function streamTurn(response: Response) {
    await consumeNdjson(response, (event) => {
      if (event.type === "narration") {
        appendStreamingNarration(event.chunk);
      }

      if (event.type === "check_required") {
        removeStreamingNarration();
        setPendingCheck({
          ...event.check,
          turnId: event.turnId,
        });
      }

      if (event.type === "check_result") {
        setLastCheckResult(event.result);
        streamingMessageIdRef.current = null;
      }

      if (event.type === "actions") {
        setSuggestedActions(event.actions);
      }

      if (event.type === "state") {
        applySnapshot(event.snapshot);
      }

      if (event.type === "warning" || event.type === "error") {
        setError(event.message);
      }

      if (event.type === "done") {
        setStatus("idle");
        streamingMessageIdRef.current = null;
        setActiveNarrationId(null);
      }
    });
  }

  async function submitAction(action: string) {
    if (!snapshot || !action.trim() || pendingCheck) {
      return;
    }

    setStatus("streaming");
    setError(null);
    setLastCheckResult(null);
    setMessages((current) => [
      ...current,
      {
        id: `user_${Date.now()}`,
        role: "user",
        kind: "action",
        content: action.trim(),
        createdAt: new Date().toISOString(),
      },
    ]);
    setInputValue("");

    try {
      const response = await fetch("/api/turns", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          campaignId: snapshot.campaignId,
          sessionId: snapshot.sessionId,
          action,
        }),
      });

      if (!response.ok) {
        throw new Error("Turn request failed.");
      }

      await streamTurn(response);
    } catch (turnError) {
      setStatus("idle");
      setError(turnError instanceof Error ? turnError.message : "Turn request failed.");
    }
  }

  async function resolveCheck() {
    if (!pendingCheck) {
      return;
    }

    setStatus("streaming");
    setError(null);

    try {
      const response = await fetch(`/api/turns/${pendingCheck.turnId}/check`, {
        method: "POST",
      });

      if (!response.ok) {
        throw new Error("Check resolution failed.");
      }

      await streamTurn(response);
    } catch (checkError) {
      setStatus("idle");
      setError(checkError instanceof Error ? checkError.message : "Check resolution failed.");
    }
  }

  async function summarizeCurrentSession() {
    if (!snapshot?.sessionId) {
      return;
    }

    setError(null);

    try {
      const response = await fetch(`/api/sessions/${snapshot.sessionId}/summarize`, {
        method: "POST",
      });

      if (!response.ok) {
        throw new Error("Session summary failed.");
      }

      const data = (await response.json()) as { summary: string };
      setMessages((current) => [
        ...current,
        {
          id: `summary_${Date.now()}`,
          role: "system",
          kind: "summary",
          content: data.summary,
          createdAt: new Date().toISOString(),
        },
      ]);
      setJournalTab("journal");
    } catch (summaryError) {
      setError(summaryError instanceof Error ? summaryError.message : "Summary failed.");
    }
  }

  function returnHome() {
    if (status !== "idle") {
      return;
    }

    removeStreamingNarration();
    setPendingCheck(null);
    setSidebarOpen(false);
    setActiveNarrationId(null);
    setView("home");
    void refreshCampaigns();
  }

  if (view === "home" || !snapshot) {
    const featuredCampaign =
      (lastCampaignId && campaigns.find((campaign) => campaign.id === lastCampaignId)) ?? campaigns[0] ?? null;

    return (
      <main className="relative flex min-h-screen items-center justify-center px-6 py-12">
        <section className="panel gold-glow w-full max-w-5xl overflow-hidden rounded-[2rem]">
          <div className="grid gap-10 px-8 py-10 lg:grid-cols-[1.08fr_0.92fr] lg:px-12 lg:py-14">
            <div className="space-y-8">
              <div className="space-y-4">
                <p className="text-sm uppercase tracking-[0.35em] text-[var(--accent-soft)]">
                  Campaign Library
                </p>
                <h1 className="font-display text-6xl leading-none text-[var(--foreground)] sm:text-7xl">
                  AI Solo RPG Engine
                </h1>
                <p className="max-w-2xl text-lg leading-8 text-[var(--muted)]">
                  A solo storybook adventure where the fiction stays center stage and the rules move
                  quietly beneath the page.
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                {[
                  "Streaming narration and in-world prompts",
                  "Hidden structure for clues, reveals, and campaign arcs",
                  "Explicit rolls only when risk and consequence matter",
                ].map((point) => (
                  <div
                    key={point}
                    className="rounded-3xl border border-white/10 bg-white/5 px-4 py-5 text-sm leading-6 text-[var(--muted)]"
                  >
                    {point}
                  </div>
                ))}
              </div>

              <div className="flex flex-col gap-4 sm:flex-row">
                <button
                  className="button-press rounded-full bg-[var(--accent)] px-6 py-3 text-sm font-semibold tracking-wide text-[#26190d] hover:-translate-y-0.5 hover:bg-[#e7b65c]"
                  onClick={startAdventure}
                  disabled={status !== "idle"}
                >
                  {status === "loading" ? "Preparing the valley..." : "Start Adventure"}
                </button>
                <button
                  className="button-press rounded-full border border-[var(--panel-border)] px-6 py-3 text-sm font-semibold text-[var(--foreground)] hover:bg-white/5"
                  onClick={() => {
                    if (featuredCampaign) {
                      void loadCampaign(featuredCampaign.id);
                    }
                  }}
                  disabled={status !== "idle" || !featuredCampaign}
                >
                  {featuredCampaign ? "Resume Latest Chronicle" : "No Campaign Yet"}
                </button>
              </div>
              {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
            </div>

            <div className="rounded-[1.75rem] border border-[var(--panel-border)] bg-black/20 p-6">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.28em] text-[var(--accent-soft)]">
                    Your Campaigns
                  </p>
                  <p className="mt-2 text-sm leading-7 text-[var(--muted)]">
                    Return to an old chronicle or begin a fresh one.
                  </p>
                </div>
                <button
                  className="button-press rounded-full border border-[var(--panel-border)] px-3 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)] hover:bg-white/5"
                  onClick={() => void refreshCampaigns()}
                  disabled={campaignsLoading}
                >
                  Refresh
                </button>
              </div>

              <div className="mt-5 space-y-3">
                {campaignsLoading ? (
                  <p className="text-sm leading-7 text-[var(--muted)]">Loading the library...</p>
                ) : campaigns.length ? (
                  campaigns.map((campaign) => (
                    <button
                      key={campaign.id}
                      className={clsx(
                        "button-press block w-full rounded-[1.45rem] border px-4 py-4 text-left transition",
                        campaign.id === lastCampaignId
                          ? "border-[var(--accent)]/45 bg-[rgba(214,164,73,0.08)]"
                          : "border-white/10 bg-white/4 hover:bg-white/6",
                      )}
                      onClick={() => void loadCampaign(campaign.id)}
                      disabled={status !== "idle"}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="story-kicker">{campaign.setting}</p>
                          <h2 className="font-display text-2xl text-[var(--foreground)]">
                            {campaign.title}
                          </h2>
                        </div>
                        <span className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
                          {campaign.id === lastCampaignId ? "Latest" : formatCampaignDate(campaign.updatedAt)}
                        </span>
                      </div>
                      <p className="mt-2 text-sm leading-7 text-[var(--muted)]">{campaign.premise}</p>
                      <p className="mt-3 text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
                        {campaign.characterName} • {campaign.characterArchetype} • {campaign.turnCount} turns
                      </p>
                    </button>
                  ))
                ) : (
                  <ol className="space-y-4 text-sm leading-7 text-[var(--muted)]">
                    <li>One click creates a character, campaign, journal, clues, and opening scene.</li>
                    <li>Most turns read like prose and stream immediately.</li>
                    <li>Risky moments pause cleanly for a visible roll before the story resumes.</li>
                    <li>Hidden truths stay hidden until the engine says they are earned.</li>
                  </ol>
                )}
              </div>
            </div>
          </div>
        </section>
      </main>
    );
  }

  const discoveredClues = snapshot.clues.filter((clue) => clue.status === "discovered");
  const visibleQuests = snapshot.quests.filter((quest) => quest.status !== "failed");
  const knownPeople = snapshot.npcs;
  const journalEntries = [
    ...(snapshot.previouslyOn
      ? [
          {
            id: "previously_on",
            title: "Previously on",
            content: snapshot.previouslyOn,
          },
        ]
      : []),
    ...snapshot.memories.map((entry) => ({
      id: entry.id,
      title: entry.type === "session_summary" ? "Session summary" : "Journal note",
      content: entry.summary,
    })),
  ];
  const activeArc = snapshot.arcs.find((arc) => arc.status === "active");
  const sceneMoments = inferSceneMoments(snapshot);

  return (
    <main className="min-h-screen px-4 py-4 sm:px-6 sm:py-6">
      <div className="mx-auto max-w-[1480px]">
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
          <section className="panel story-shell rounded-[2.2rem] px-4 py-5 sm:px-8 sm:py-8">
            <header className="mb-8 flex flex-col gap-5 border-b border-white/8 pb-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-3">
                  <p className="text-xs uppercase tracking-[0.34em] text-[var(--accent-soft)]">
                    {snapshot.setting}
                  </p>
                  <div>
                    <h1 className="font-display text-4xl text-[var(--foreground)] sm:text-5xl">
                      {snapshot.title}
                    </h1>
                    <p className="mt-2 max-w-3xl text-sm leading-7 text-[var(--muted)]">
                      {snapshot.premise}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    className="button-press rounded-full border border-[var(--panel-border)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-[var(--muted)] hover:bg-white/5"
                    onClick={returnHome}
                    disabled={status !== "idle"}
                  >
                    Campaign Library
                  </button>
                  <button
                    className="button-press rounded-full border border-[var(--panel-border)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-[var(--muted)] hover:bg-white/5 xl:hidden"
                    onClick={() => setSidebarOpen((open) => !open)}
                  >
                    {sidebarOpen ? "Close Journal" : "Open Journal"}
                  </button>
                  <button
                    className="button-press rounded-full border border-[var(--panel-border)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-[var(--muted)] hover:bg-white/5"
                    onClick={summarizeCurrentSession}
                  >
                    Write Journal Entry
                  </button>
                </div>
              </div>

              <section className="scene-card rounded-[1.8rem] px-5 py-5 sm:px-6">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="max-w-3xl">
                    <p className="text-xs uppercase tracking-[0.28em] text-[var(--accent-soft)]">
                      Current Scene
                    </p>
                    <h2 className="mt-2 font-display text-3xl text-[var(--foreground)] sm:text-4xl">
                      {snapshot.state.sceneState.title}
                    </h2>
                    <p className="mt-3 text-base leading-8 text-[var(--foreground)]/92">
                      {snapshot.state.sceneState.summary}
                    </p>
                  </div>

                  <dl className="grid gap-3 text-sm leading-6 text-[var(--muted)] sm:grid-cols-2 lg:w-[320px] lg:grid-cols-1">
                    <div>
                      <dt className="scene-meta-label">Location</dt>
                      <dd>{snapshot.state.sceneState.location}</dd>
                    </div>
                    {sceneMoments.time ? (
                      <div>
                        <dt className="scene-meta-label">Time</dt>
                        <dd>{sceneMoments.time}</dd>
                      </div>
                    ) : null}
                    <div>
                      <dt className="scene-meta-label">Mood</dt>
                      <dd>{snapshot.state.sceneState.atmosphere}</dd>
                    </div>
                    {sceneMoments.weather ? (
                      <div>
                        <dt className="scene-meta-label">In the air</dt>
                        <dd>{sceneMoments.weather}</dd>
                      </div>
                    ) : null}
                    <div>
                      <dt className="scene-meta-label">Rumor</dt>
                      <dd>{snapshot.state.worldState.activeThreat}</dd>
                    </div>
                  </dl>
                </div>
              </section>
            </header>

            {error ? (
              <div className="mb-5 rounded-2xl border border-[var(--danger)]/40 bg-[var(--danger)]/10 px-4 py-3 text-sm text-[#ffd8c8]">
                {error}
              </div>
            ) : null}

            <div
              ref={feedRef}
              className="story-feed pr-1"
              style={{ maxHeight: "56vh", overflowY: "auto" }}
            >
              <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
                {messages.map((message) => (
                  <MessageBlock
                    key={message.id}
                    message={message}
                    active={message.id === activeNarrationId}
                  />
                ))}
              </div>
            </div>

            {pendingCheck ? (
              <section className="mt-8 rounded-[1.75rem] border border-[var(--accent)]/25 bg-[rgba(214,164,73,0.08)] p-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="max-w-2xl">
                    <p className="text-xs uppercase tracking-[0.25em] text-[var(--accent-soft)]">
                      A roll decides what happens next
                    </p>
                    <h2 className="mt-2 font-display text-3xl capitalize">{pendingCheck.stat}</h2>
                    <p className="mt-2 text-sm leading-7 text-[var(--muted)]">{pendingCheck.reason}</p>
                    <p className="mt-2 text-xs uppercase tracking-[0.24em] text-[var(--muted)]">
                      {pendingCheck.mode} check
                    </p>
                  </div>
                  <button
                    className="button-press rounded-full bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-[#26190d] hover:-translate-y-0.5 hover:bg-[#e7b65c]"
                    onClick={resolveCheck}
                    disabled={status !== "idle"}
                  >
                    Roll the Dice
                  </button>
                </div>
              </section>
            ) : null}

            {lastCheckResult ? (
              <section className="mt-5 rounded-[1.6rem] border border-white/8 bg-[#132029] px-5 py-4">
                <div className="flex flex-wrap items-center gap-4 text-sm">
                  <span className="font-display text-4xl">{lastCheckResult.total}</span>
                  <span className="rounded-full bg-white/6 px-3 py-1 uppercase tracking-[0.2em] text-[var(--accent-soft)]">
                    {lastCheckResult.outcome}
                  </span>
                  <span className="text-[var(--muted)]">
                    {lastCheckResult.stat} {lastCheckResult.mode} | rolls {lastCheckResult.rolls.join(" / ")} | mod{" "}
                    {lastCheckResult.modifier >= 0 ? `+${lastCheckResult.modifier}` : lastCheckResult.modifier}
                  </span>
                </div>
                {lastCheckResult.consequences?.length ? (
                  <p className="mt-3 text-sm leading-7 text-[var(--muted)]">
                    {lastCheckResult.consequences.join(" ")}
                  </p>
                ) : null}
              </section>
            ) : null}

            <section className="mt-8 rounded-[1.85rem] border border-white/8 bg-[var(--surface-strong)] p-4 sm:p-5">
              <div className="mb-4">
                <p className="text-xs uppercase tracking-[0.28em] text-[var(--accent-soft)]">
                  Possible next moves
                </p>
                <p className="mt-2 text-sm leading-7 text-[var(--muted)]">
                  The story is pressing in around you. Pick a path or write your own.
                </p>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                {suggestedActions.map((action) => (
                  <button
                    key={action}
                    className="story-choice button-press rounded-[1.35rem] border border-[var(--panel-border)] px-4 py-4 text-left text-sm leading-7 text-[var(--foreground)] hover:border-[var(--accent)]/35 hover:bg-white/6 disabled:opacity-60"
                    onClick={() => void submitAction(action)}
                    disabled={status !== "idle" || Boolean(pendingCheck)}
                  >
                    <span className="story-choice-label">You could</span>
                    <span className="mt-1 block">{toNarrativeAction(action)}</span>
                  </button>
                ))}
              </div>

              <form
                className="mt-4 flex flex-col gap-3 sm:flex-row"
                onSubmit={(event) => {
                  event.preventDefault();
                  void submitAction(inputValue);
                }}
              >
                <input
                  value={inputValue}
                  onChange={(event) => setInputValue(event.target.value)}
                  placeholder="What do you do next?"
                  className="min-h-14 flex-1 rounded-[1.25rem] border border-white/8 bg-black/20 px-4 py-3 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--accent)]/40"
                  disabled={status !== "idle" || Boolean(pendingCheck)}
                />
                <button
                  className="button-press rounded-[1.25rem] bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-[#26190d] hover:-translate-y-0.5 hover:bg-[#e7b65c] disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={status !== "idle" || Boolean(pendingCheck) || !inputValue.trim()}
                >
                  {status === "streaming" ? "The world responds..." : "Take Action"}
                </button>
              </form>
            </section>
          </section>

          <aside
            className={clsx(
              "panel fixed inset-y-4 right-4 z-20 w-[min(88vw,360px)] rounded-[1.9rem] p-4 shadow-2xl transition-transform xl:sticky xl:top-6 xl:block xl:h-fit xl:w-auto xl:translate-x-0",
              sidebarOpen ? "translate-x-0" : "translate-x-[120%] xl:translate-x-0",
            )}
          >
            <div className="mb-4 flex items-center justify-between gap-3 border-b border-white/8 pb-4">
              <div>
                <p className="text-xs uppercase tracking-[0.28em] text-[var(--accent-soft)]">
                  Journal
                </p>
                <h2 className="mt-1 font-display text-3xl">{snapshot.character.name}</h2>
                <p className="text-sm text-[var(--muted)]">{snapshot.character.archetype}</p>
              </div>
              <button
                className="button-press rounded-full border border-[var(--panel-border)] px-3 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)] hover:bg-white/5 xl:hidden"
                onClick={() => setSidebarOpen(false)}
              >
                Close
              </button>
            </div>

            <div className="mb-4 flex flex-wrap gap-2">
              {(["quests", "people", "journal", "clues"] as JournalTab[]).map((tab) => (
                <button
                  key={tab}
                  className={clsx(
                    "button-press rounded-full px-3 py-2 text-xs font-semibold uppercase tracking-[0.22em]",
                    journalTab === tab
                      ? "bg-[var(--accent)] text-[#26190d]"
                      : "border border-[var(--panel-border)] text-[var(--muted)] hover:bg-white/5",
                  )}
                  onClick={() => setJournalTab(tab)}
                >
                  {tab}
                </button>
              ))}
            </div>

            <div className="space-y-4">
              {journalTab === "quests" ? (
                visibleQuests.length ? (
                  visibleQuests.map((quest) => (
                    <div key={quest.id} className="rounded-[1.4rem] border border-white/8 bg-white/4 px-4 py-4">
                      <p className="story-kicker">{quest.status === "completed" ? "Completed quest" : "Active quest"}</p>
                      <h3 className="font-display text-2xl">{quest.title}</h3>
                      <p className="mt-2 text-sm leading-7 text-[var(--muted)]">{quest.summary}</p>
                      <p className="mt-3 text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
                        {quest.status === "completed"
                          ? "Finished"
                          : `Progress: stage ${quest.stage + 1} of ${quest.maxStage + 1}`}
                      </p>
                    </div>
                  ))
                ) : (
                  <EmptyJournalCopy>No pressing quests are written in the journal yet.</EmptyJournalCopy>
                )
              ) : null}

              {journalTab === "people" ? (
                knownPeople.length ? (
                  knownPeople.map((npc) => (
                    <div key={npc.id} className="rounded-[1.4rem] border border-white/8 bg-white/4 px-4 py-4">
                      <p className="story-kicker">{npc.role}</p>
                      <h3 className="font-display text-2xl">{npc.name}</h3>
                      <p className="mt-2 text-sm leading-7 text-[var(--muted)]">{npc.notes}</p>
                      {npc.personalHook ? (
                        <p className="mt-3 text-sm leading-7 text-[var(--foreground)]/85">
                          Personal thread: {npc.personalHook}
                        </p>
                      ) : null}
                    </div>
                  ))
                ) : (
                  <EmptyJournalCopy>No one has left a strong enough impression to enter the journal yet.</EmptyJournalCopy>
                )
              ) : null}

              {journalTab === "journal" ? (
                <div className="space-y-4">
                  <div className="rounded-[1.4rem] border border-white/8 bg-white/4 px-4 py-4">
                    <p className="story-kicker">Current chapter</p>
                    <h3 className="font-display text-2xl">
                      {activeArc?.title ?? snapshot.state.sceneState.title}
                    </h3>
                    <p className="mt-2 text-sm leading-7 text-[var(--muted)]">
                      {activeArc?.summary ?? snapshot.state.sceneState.summary}
                    </p>
                  </div>

                  {journalEntries.length ? (
                    journalEntries.map((entry) => (
                      <div key={entry.id} className="rounded-[1.4rem] border border-white/8 bg-black/18 px-4 py-4">
                        <p className="story-kicker">{entry.title}</p>
                        <p className="mt-2 text-sm leading-7 text-[var(--muted)]">{entry.content}</p>
                      </div>
                    ))
                  ) : (
                    <EmptyJournalCopy>
                      The journal is still sparse. Write a journal entry after a few turns to capture what matters.
                    </EmptyJournalCopy>
                  )}
                </div>
              ) : null}

              {journalTab === "clues" ? (
                discoveredClues.length ? (
                  discoveredClues.map((clue) => (
                    <div key={clue.id} className="rounded-[1.4rem] border border-white/8 bg-black/18 px-4 py-4">
                      <p className="story-kicker">Discovered clue</p>
                      <p className="text-sm leading-7 text-[var(--foreground)]">{clue.text}</p>
                      <p className="mt-2 text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
                        Source: {clue.source}
                      </p>
                    </div>
                  ))
                ) : (
                  <EmptyJournalCopy>No hard clues have been uncovered yet.</EmptyJournalCopy>
                )
              ) : null}
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}
