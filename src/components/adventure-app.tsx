"use client";

import clsx from "clsx";
import { useRouter } from "next/navigation";
import { startTransition, useEffect, useEffectEvent, useRef, useState } from "react";
import type {
  CampaignListItem,
  CheckResult,
  PendingCheck,
  PlayerCampaignSnapshot,
  StoryMessage,
} from "@/lib/game/types";

type TurnStreamEvent =
  | { type: "narration"; chunk: string }
  | { type: "check_required"; turnId: string; check: PendingCheck }
  | { type: "check_result"; result: CheckResult }
  | { type: "actions"; actions: string[] }
  | { type: "state"; snapshot: PlayerCampaignSnapshot }
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

function inferSceneMoments(snapshot: PlayerCampaignSnapshot) {
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

function toPendingCheckDraft(check: PendingCheck) {
  const reason = check.reason.replace(/^Resolving:\s*/i, "").trim();

  if (reason) {
    return reason;
  }

  return `${check.stat} ${check.mode} check`;
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
  const paragraphs = visible.split(/\n{2,}/).filter(Boolean);

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
      {paragraphs.length ? (
        paragraphs.map((paragraph, index) => {
          const isLast = index === paragraphs.length - 1;
          return (
            <p key={`${index}-${paragraph.slice(0, 16)}`} className="mb-4 whitespace-pre-wrap last:mb-0">
              {paragraph}
              {isLast && active && !prefersReducedMotion && effectiveRevealedLength < text.length ? (
                <span className="type-cursor" aria-hidden="true">
                  |
                </span>
              ) : null}
            </p>
          );
        })
      ) : (
        <>
          <span className="whitespace-pre-wrap">{visible}</span>
          {active && !prefersReducedMotion && effectiveRevealedLength < text.length ? (
            <span className="type-cursor" aria-hidden="true">
              |
            </span>
          ) : null}
        </>
      )}
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
      <article className="ml-auto max-w-2xl rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-[0.96rem] leading-7 text-zinc-100">
        <p className="story-kicker">{formatRelativeLabel(message)}</p>
        <p className="whitespace-pre-wrap">{message.content}</p>
      </article>
    );
  }

  return (
    <article
      className={clsx(
        "max-w-2xl rounded-2xl border px-4 py-3 text-[0.94rem] leading-7",
        message.kind === "warning"
          ? "border-red-500/30 bg-red-500/10 text-red-100"
          : "border-zinc-800 bg-transparent text-zinc-300",
      )}
    >
      <p className="story-kicker">{formatRelativeLabel(message)}</p>
      <p className="whitespace-pre-wrap">{message.content}</p>
    </article>
  );
}

function DiceIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      className="h-4 w-4"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M7 3.5h10l3.5 3.5v10L17 20.5H7L3.5 17V7z" />
      <circle cx="9" cy="9" r="1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="15" r="1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="9" r="1" fill="currentColor" stroke="none" />
      <circle cx="9" cy="15" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function EmptyJournalCopy({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-zinc-800 bg-black px-4 py-5 text-sm leading-7 text-zinc-500">
      {children}
    </div>
  );
}

export function AdventureApp({ initialCampaignId }: { initialCampaignId?: string }) {
  const router = useRouter();
  const [view, setView] = useState<"home" | "campaign">("home");
  const [snapshot, setSnapshot] = useState<PlayerCampaignSnapshot | null>(null);
  const [campaigns, setCampaigns] = useState<CampaignListItem[]>([]);
  const [messages, setMessages] = useState<StoryMessage[]>([]);
  const [suggestedActions, setSuggestedActions] = useState<string[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [pendingCheck, setPendingCheck] = useState<(PendingCheck & { turnId: string }) | null>(null);
  const [lastCheckResult, setLastCheckResult] = useState<CheckResult | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "streaming">("idle");
  const [campaignsLoading, setCampaignsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loadingCampaignId, setLoadingCampaignId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [journalTab, setJournalTab] = useState<JournalTab>("journal");
  const feedRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const streamingMessageIdRef = useRef<string | null>(null);
  const [activeNarrationId, setActiveNarrationId] = useState<string | null>(null);
  const [lastCampaignId, setLastCampaignId] = useState<string | null>(null);
  const [pendingActionDraft, setPendingActionDraft] = useState("");
  const [editingPendingCheck, setEditingPendingCheck] = useState(false);
  const refreshCampaignsEvent = useEffectEvent(() => {
    void refreshCampaigns();
  });
  const loadCampaignEvent = useEffectEvent((campaignId: string) => {
    void loadCampaign(campaignId);
  });

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
    const campaignId = initialCampaignId ?? window.localStorage.getItem(STORAGE_KEY);
    setLastCampaignId(campaignId);
    refreshCampaignsEvent();
    if (initialCampaignId) {
      loadCampaignEvent(initialCampaignId);
    }
  }, [initialCampaignId]);

  useEffect(() => {
    feedRef.current?.scrollTo({
      top: feedRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, pendingCheck, activeNarrationId]);

  useEffect(() => {
    const textarea = inputRef.current;

    if (!textarea) {
      return;
    }

    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 240)}px`;
  }, [inputValue]);

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
    if (status !== "idle" || loadingCampaignId === campaignId) {
      return;
    }

    setStatus("loading");
    setError(null);
    setNotice(null);
    setLoadingCampaignId(campaignId);

    try {
      const response = await fetch(`/api/campaigns/${campaignId}`, {
        cache: "no-store",
      });

      if (!response.ok) {
        window.localStorage.removeItem(STORAGE_KEY);
        throw new Error("Unable to load that campaign.");
      }

      const data = (await response.json()) as { snapshot: PlayerCampaignSnapshot };
      applySnapshot(data.snapshot);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load campaign.");
    } finally {
      setStatus("idle");
      setLoadingCampaignId(null);
    }
  }

  function applySnapshot(nextSnapshot: PlayerCampaignSnapshot) {
    window.localStorage.setItem(STORAGE_KEY, nextSnapshot.campaignId);
    setLastCampaignId(nextSnapshot.campaignId);

    startTransition(() => {
      setView("campaign");
      setSnapshot(nextSnapshot);
      setMessages(nextSnapshot.recentMessages);
      setSuggestedActions(nextSnapshot.state.sceneState.suggestedActions);
      setPendingCheck(null);
      setPendingActionDraft("");
      streamingMessageIdRef.current = null;
      setActiveNarrationId(null);
    });
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
        setPendingActionDraft(toPendingCheckDraft(event.check));
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

  async function runActionSubmission(action: string) {
    if (!snapshot || !action.trim()) {
      return;
    }

    setStatus("streaming");
    setError(null);
    setNotice(null);
    setLastCheckResult(null);
    setNotice(null);
    setPendingActionDraft(action.trim());
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

  async function submitAction(action: string) {
    if (pendingCheck) {
      return;
    }

    await runActionSubmission(action);
  }

  async function resolveCheck() {
    if (!pendingCheck) {
      return;
    }

    setStatus("streaming");
    setError(null);
    setNotice(null);

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
    setNotice(null);

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

  async function editPendingAction() {
    if (!pendingCheck || status !== "idle") {
      return;
    }

    setError(null);
    setNotice(null);
    setEditingPendingCheck(true);
  }

  async function savePendingActionEdit() {
    if (!pendingCheck || !pendingActionDraft.trim()) {
      return;
    }

    setStatus("loading");
    setError(null);
    setNotice(null);

    const editedAction = pendingActionDraft.trim();

    try {
      const response = await fetch(`/api/turns/${pendingCheck.turnId}/edit`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: editedAction,
        }),
      });

      if (!response.ok) {
        throw new Error("Could not update that check.");
      }

      const data = (await response.json()) as { check: PendingCheck };
      setPendingCheck({
        ...data.check,
        turnId: pendingCheck.turnId,
      });
      setPendingActionDraft(toPendingCheckDraft(data.check));
      setEditingPendingCheck(false);
      setNotice("Check updated.");
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : "Could not update check.");
    } finally {
      setEditingPendingCheck(false);
      setStatus("idle");
    }
  }

  async function retryLatestTurn() {
    if (!snapshot?.latestResolvedTurnId || !snapshot.canRetryLatestTurn || status !== "idle") {
      return;
    }

    setStatus("loading");
    setError(null);
    setNotice(null);

    try {
      const response = await fetch(`/api/turns/${snapshot.latestResolvedTurnId}/retry`, {
        method: "POST",
      });

      if (!response.ok) {
        throw new Error("Could not retry the latest turn.");
      }

      const data = (await response.json()) as { snapshot: PlayerCampaignSnapshot };
      setLastCheckResult(null);
      applySnapshot(data.snapshot);
      setNotice("Rewound 1 turn.");
      window.requestAnimationFrame(() => {
        feedRef.current?.scrollTo({
          top: feedRef.current.scrollHeight,
          behavior: "auto",
        });
      });
    } catch (retryError) {
      setError(retryError instanceof Error ? retryError.message : "Could not retry latest turn.");
    } finally {
      setStatus("idle");
    }
  }

  function returnHome() {
    if (status !== "idle") {
      return;
    }

    removeStreamingNarration();
    setPendingCheck(null);
    setEditingPendingCheck(false);
    setNotice(null);
    setSidebarOpen(false);
    setActiveNarrationId(null);
    setView("home");
    void refreshCampaigns();
  }

  if (view === "home" || !snapshot) {
    const featuredCampaign =
      (lastCampaignId && campaigns.find((campaign) => campaign.id === lastCampaignId)) ?? campaigns[0] ?? null;

    return (
      <main className="h-screen w-screen overflow-y-auto bg-black text-zinc-50">
        <div className="mx-auto flex min-h-full w-full max-w-6xl flex-col px-4">
          <section className="flex min-h-[70vh] flex-col items-center justify-center px-4 text-center">
            <div className="w-full max-w-3xl">
              <div className="space-y-4">
                <p className="text-sm uppercase tracking-[0.35em] text-zinc-400">
                  Campaign Library
                </p>
                <h1 className="mb-4 text-5xl font-semibold tracking-tight text-zinc-50 md:text-6xl">
                  AI Solo RPG Engine
                </h1>
                <p className="mx-auto mb-8 max-w-xl text-lg text-zinc-400">
                  A simple AI-powered story engine.
                </p>
              </div>

              <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
                <button
                  className="button-press rounded-full bg-white px-6 py-3 text-sm font-semibold tracking-wide text-black hover:bg-zinc-200"
                  onClick={() => router.push("/campaigns/new")}
                  disabled={status !== "idle"}
                >
                  Start Session Zero
                </button>
                <button
                  className="button-press rounded-full border border-zinc-800 px-6 py-3 text-sm font-semibold text-zinc-100 hover:bg-zinc-900"
                  onClick={() => {
                    if (featuredCampaign) {
                      void loadCampaign(featuredCampaign.id);
                    }
                  }}
                  disabled={status !== "idle" || !featuredCampaign}
                >
                  {featuredCampaign ? "Resume Latest Chronicle" : "No Campaign Yet"}
                </button>
                <button
                  className="button-press rounded-full border border-zinc-800 px-6 py-3 text-sm font-semibold text-zinc-100 hover:bg-zinc-900"
                  onClick={() => router.push("/characters")}
                  disabled={status !== "idle"}
                >
                  Character Library
                </button>
              </div>
              {status === "loading" ? (
                <p className="mt-4 text-sm text-zinc-400">
                  Opening campaign...
                </p>
              ) : null}
              {error ? <p className="mt-4 text-sm text-red-400">{error}</p> : null}
            </div>
          </section>

          <section className="mx-auto w-full max-w-4xl px-6 pb-24">
            <div className="mb-6 flex items-start justify-between gap-3">
              <p className="text-sm uppercase tracking-widest text-zinc-400">Your Chronicles</p>
              <button
                className="button-press rounded-full border border-zinc-800 px-3 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-zinc-300 hover:bg-zinc-900"
                onClick={() => void refreshCampaigns()}
                disabled={campaignsLoading}
              >
                Refresh
              </button>
            </div>

            {campaignsLoading ? (
              <p className="text-sm leading-7 text-zinc-400">Loading the library...</p>
            ) : campaigns.length ? (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {campaigns.map((campaign) => (
                  <button
                    key={campaign.id}
                    className={clsx(
                      "group button-press cursor-pointer rounded-lg border bg-zinc-950/50 p-6 text-left transition-colors",
                      campaign.id === lastCampaignId
                        ? "border-zinc-700"
                        : "border-zinc-800 hover:border-zinc-700",
                      loadingCampaignId === campaign.id && "border-zinc-600 bg-zinc-900/70",
                    )}
                    onClick={() => void loadCampaign(campaign.id)}
                    disabled={status !== "idle"}
                    aria-busy={loadingCampaignId === campaign.id}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h2 className="text-lg text-zinc-100 group-hover:text-white">{campaign.title}</h2>
                        {loadingCampaignId === campaign.id ? (
                          <p className="mt-1 text-xs uppercase tracking-[0.18em] text-zinc-500">
                            Opening...
                          </p>
                        ) : null}
                      </div>
                      <span className="text-xs text-zinc-400">
                        {campaign.id === lastCampaignId ? "Latest" : formatCampaignDate(campaign.updatedAt)}
                      </span>
                    </div>
                    <p className="mt-2 text-xs uppercase tracking-[0.18em] text-zinc-400">
                      {campaign.characterName} • {campaign.characterArchetype}
                    </p>
                    <p className="mt-2 line-clamp-2 text-sm text-zinc-400">{campaign.premise}</p>
                  </button>
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-6 text-sm leading-7 text-zinc-400">
                No campaigns yet. Start a new adventure and your first chronicle will appear here.
              </div>
            )}
          </section>
        </div>
      </main>
    );
  }

  const discoveredClues = snapshot.clues;
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
  const sceneMoments = inferSceneMoments(snapshot);
  const companion = knownPeople.find((npc) => npc.isCompanion) ?? null;

  return (
    <main className="h-screen w-screen overflow-hidden bg-black text-zinc-50">
      <div className="flex h-full w-full">
        <aside className="hidden h-full w-72 shrink-0 flex-col overflow-y-auto border-r border-zinc-800 bg-zinc-950 lg:flex">
          <div className="border-b border-zinc-800 p-6">
            <p className="text-[0.68rem] uppercase tracking-[0.24em] text-zinc-400">
              Campaign
            </p>
            <h1 className="mt-3 text-2xl font-semibold tracking-tight text-zinc-50">
              {snapshot.title}
            </h1>
            <p className="mt-2 text-sm leading-6 text-zinc-400">{snapshot.setting}</p>
            <div className="mt-5 flex flex-col gap-2">
              <button
                className="button-press rounded-full border border-zinc-800 px-4 py-2 text-xs font-medium uppercase tracking-[0.18em] text-zinc-300 hover:bg-zinc-900"
                onClick={returnHome}
                disabled={status !== "idle"}
              >
                Campaign Library
              </button>
              <button
                className="button-press rounded-full border border-zinc-800 px-4 py-2 text-xs font-medium uppercase tracking-[0.18em] text-zinc-300 hover:bg-zinc-900"
                onClick={summarizeCurrentSession}
              >
                Write Journal Entry
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-6 p-6">
            <section className="rounded-2xl border border-zinc-800 bg-black p-4">
              <p className="story-kicker">Character</p>
              <h2 className="text-xl font-semibold text-zinc-50">{snapshot.character.name}</h2>
              <p className="mt-1 text-sm text-zinc-400">{snapshot.character.archetype}</p>
              <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                {Object.entries(snapshot.character.stats).map(([stat, value]) => (
                  <div key={stat} className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-3">
                    <p className="text-[0.65rem] uppercase tracking-[0.18em] text-zinc-400">{stat}</p>
                    <p className="mt-1 text-lg font-medium text-zinc-100">{value >= 0 ? `+${value}` : value}</p>
                  </div>
                ))}
              </div>
              <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-3">
                <p className="text-[0.65rem] uppercase tracking-[0.18em] text-zinc-400">Health</p>
                <p className="mt-1 text-lg font-medium text-zinc-100">
                  {snapshot.character.health}/{snapshot.character.maxHealth}
                </p>
              </div>
            </section>

            {companion ? (
              <section className="rounded-2xl border border-zinc-800 bg-black p-4">
                <p className="story-kicker">Companion</p>
                <h2 className="text-lg font-semibold text-zinc-50">{companion.name}</h2>
                {companion.role ? (
                  <p className="mt-1 text-sm text-zinc-400">{companion.role}</p>
                ) : null}
                {companion.notes ? (
                  <p className="mt-3 text-sm leading-7 text-zinc-300">{companion.notes}</p>
                ) : null}
              </section>
            ) : null}

            {lastCheckResult ? (
              <section className="rounded-2xl border border-zinc-800 bg-black p-4">
                <p className="story-kicker">Last Check</p>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-3xl font-semibold text-zinc-50">{lastCheckResult.total}</span>
                  <span className="rounded-full border border-zinc-800 px-3 py-1 text-[0.68rem] uppercase tracking-[0.18em] text-zinc-300">
                    {lastCheckResult.outcome}
                  </span>
                </div>
                <p className="mt-3 text-sm leading-7 text-zinc-400">
                  {lastCheckResult.stat} {lastCheckResult.mode} | {lastCheckResult.rolls.join(" / ")}
                </p>
              </section>
            ) : null}
          </div>
        </aside>

        <section className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
          <header className="flex items-center justify-between gap-4 border-b border-zinc-800 px-6 py-4 sm:px-8">
            <div className="min-w-0">
              <p className="text-[0.68rem] uppercase tracking-[0.24em] text-zinc-400">{snapshot.setting}</p>
              <h1 className="mt-1 truncate text-xl font-semibold tracking-tight text-zinc-50 sm:text-2xl">
                {snapshot.title}
              </h1>
            </div>
            <div className="flex items-center gap-2">
              <button
                className="button-press rounded-full border border-zinc-800 px-4 py-2 text-xs font-medium uppercase tracking-[0.18em] text-zinc-300 hover:bg-zinc-900 lg:hidden"
                onClick={returnHome}
                disabled={status !== "idle"}
              >
                Library
              </button>
              <button
                className="button-press rounded-full border border-zinc-800 px-4 py-2 text-xs font-medium uppercase tracking-[0.18em] text-zinc-300 hover:bg-zinc-900 xl:hidden"
                onClick={() => setSidebarOpen((open) => !open)}
              >
                {sidebarOpen ? "Close Context" : "Open Context"}
              </button>
            </div>
          </header>

          <div ref={feedRef} className="story-feed flex-1 overflow-y-auto p-8">
            <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 pb-12">
              {messages.map((message) => (
                <MessageBlock
                  key={message.id}
                  message={message}
                  active={message.id === activeNarrationId}
                />
              ))}
            </div>
          </div>

          <div className="px-4 pb-4 sm:px-8 sm:pb-8">
            <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
              {error ? (
                <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">
                  {error}
                </div>
              ) : null}

              {notice ? (
                <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
                  {notice}
                </div>
              ) : null}

              {pendingCheck ? (
                <section className="flex flex-col gap-4 rounded-xl border border-zinc-800 border-l-2 border-l-white bg-zinc-950/80 p-6">
                  <div className="flex items-start justify-between gap-4">
                    <h2 className="text-lg font-semibold capitalize text-zinc-100">
                      {pendingCheck.stat} Check
                    </h2>
                    <span className="inline-flex items-center rounded-sm border border-zinc-700 bg-zinc-900 px-2 py-1 text-[10px] uppercase tracking-wider text-zinc-400">
                      {pendingCheck.mode} check
                    </span>
                  </div>
                  {editingPendingCheck ? (
                    <>
                      <textarea
                        value={pendingActionDraft}
                        onChange={(event) => setPendingActionDraft(event.target.value)}
                        rows={3}
                        className="min-h-24 w-full resize-y rounded-2xl border border-zinc-800 bg-black px-4 py-4 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-zinc-600"
                        placeholder="Adjust the action behind this check"
                        disabled={status !== "idle"}
                      />
                      <div className="flex justify-between gap-3">
                        <button
                          className="button-press inline-flex items-center rounded-md border border-zinc-700 px-4 py-2.5 text-sm font-medium text-zinc-200 hover:bg-zinc-900"
                          onClick={() => {
                            setEditingPendingCheck(false);
                            setPendingActionDraft(toPendingCheckDraft(pendingCheck));
                          }}
                          disabled={status !== "idle"}
                        >
                          Keep Original
                        </button>
                        <button
                          className="button-press inline-flex items-center rounded-md bg-white px-6 py-2.5 text-sm font-medium text-black shadow-sm transition-colors hover:bg-zinc-200"
                          onClick={savePendingActionEdit}
                          disabled={status !== "idle" || !pendingActionDraft.trim()}
                        >
                          Update Check
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <p className="max-w-lg text-sm leading-relaxed text-zinc-400">
                        {pendingCheck.reason}
                      </p>
                      <div className="flex justify-between gap-3">
                        <button
                          className="button-press inline-flex items-center rounded-md border border-zinc-700 px-4 py-2.5 text-sm font-medium text-zinc-200 hover:bg-zinc-900"
                          onClick={editPendingAction}
                          disabled={status !== "idle"}
                        >
                          Edit Action
                        </button>
                        <button
                          className="button-press inline-flex items-center gap-2 rounded-md bg-white px-6 py-2.5 text-sm font-medium text-black shadow-sm transition-colors hover:bg-zinc-200"
                          onClick={resolveCheck}
                          disabled={status !== "idle"}
                        >
                          <DiceIcon />
                          <span>Roll Dice</span>
                        </button>
                      </div>
                    </>
                  )}
                </section>
              ) : null}

              {lastCheckResult ? (
                <section className="rounded-lg border border-zinc-800 bg-transparent px-5 py-4 text-sm">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-3xl font-semibold text-zinc-50">{lastCheckResult.total}</span>
                    <span className="rounded-full border border-zinc-800 px-3 py-1 text-[0.68rem] uppercase tracking-[0.18em] text-zinc-300">
                      {lastCheckResult.outcome}
                    </span>
                    <span className="text-zinc-300">
                      {lastCheckResult.stat} {lastCheckResult.mode} | rolls {lastCheckResult.rolls.join(" / ")} | mod{" "}
                      {lastCheckResult.modifier >= 0 ? `+${lastCheckResult.modifier}` : lastCheckResult.modifier}
                    </span>
                  </div>
                  {lastCheckResult.consequences?.length ? (
                    <p className="mt-3 leading-7 text-zinc-300">{lastCheckResult.consequences.join(" ")}</p>
                  ) : null}
                </section>
              ) : null}

              {!pendingCheck && snapshot.canRetryLatestTurn && snapshot.latestResolvedTurnId ? (
                <div className="flex justify-end">
                  <button
                    className="button-press inline-flex items-center rounded-md border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-900"
                    onClick={retryLatestTurn}
                    disabled={status !== "idle"}
                  >
                    Retry Last Turn
                  </button>
                </div>
              ) : null}

              {!pendingCheck && suggestedActions.length ? (
                <div className="flex flex-wrap gap-2">
                  {suggestedActions.map((action) => (
                    <button
                      key={action}
                      className="button-press rounded-full border border-zinc-700 px-4 py-1.5 text-sm text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white disabled:opacity-50"
                      onClick={() => void submitAction(action)}
                      disabled={status !== "idle" || Boolean(pendingCheck)}
                    >
                      {toNarrativeAction(action)}
                    </button>
                  ))}
                </div>
              ) : null}

              {!pendingCheck ? (
                <form
                  className="rounded-[1.75rem] border border-zinc-800 bg-zinc-950 p-3 shadow-2xl shadow-black/50 backdrop-blur"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void submitAction(inputValue);
                  }}
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                    <textarea
                      ref={inputRef}
                      value={inputValue}
                      onChange={(event) => setInputValue(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && !event.shiftKey) {
                          event.preventDefault();
                          if (inputValue.trim() && status === "idle" && !pendingCheck) {
                            void submitAction(inputValue);
                          }
                        }
                      }}
                      placeholder="What do you do next?"
                      rows={1}
                      className="min-h-14 max-h-60 flex-1 resize-none overflow-y-auto rounded-2xl border border-zinc-800 bg-black px-4 py-4 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-zinc-600"
                      disabled={status !== "idle" || Boolean(pendingCheck)}
                    />
                    <button
                      className="button-press min-h-14 rounded-2xl bg-white px-5 py-3 text-sm font-medium text-black hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={status !== "idle" || Boolean(pendingCheck) || !inputValue.trim()}
                    >
                      {status === "streaming" ? "The world responds..." : "Take Action"}
                    </button>
                  </div>
                </form>
              ) : null}
            </div>
          </div>
        </section>

        <aside
          className={clsx(
            "fixed inset-y-0 right-0 z-20 flex w-[min(90vw,20rem)] flex-col overflow-y-auto border-l border-zinc-800 bg-zinc-950 p-6 transition-transform xl:static xl:w-80 xl:translate-x-0",
            sidebarOpen ? "translate-x-0" : "translate-x-full xl:translate-x-0",
          )}
        >
          <div className="mb-6 border-b border-zinc-800 pb-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[0.68rem] uppercase tracking-[0.24em] text-zinc-400">Scene</p>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-50">
                  {snapshot.state.sceneState.title}
                </h2>
              </div>
              <button
                className="button-press rounded-full border border-zinc-800 px-3 py-2 text-xs font-medium uppercase tracking-[0.18em] text-zinc-300 hover:bg-zinc-900 xl:hidden"
                onClick={() => setSidebarOpen(false)}
              >
                Close
              </button>
            </div>
            <p className="mt-3 text-sm leading-7 text-zinc-400">{snapshot.state.sceneState.summary}</p>

            <dl className="mt-5 grid gap-4 text-sm leading-6 text-zinc-400">
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
            </dl>
          </div>

          <div className="mb-4 flex flex-wrap gap-2">
            {(["quests", "people", "journal", "clues"] as JournalTab[]).map((tab) => (
              <button
                key={tab}
                className={clsx(
                  "button-press rounded-full px-3 py-2 text-xs font-medium uppercase tracking-[0.18em]",
                  journalTab === tab
                    ? "bg-white text-black"
                    : "border border-zinc-800 text-zinc-300 hover:bg-zinc-900",
                )}
                onClick={() => setJournalTab(tab)}
              >
                {tab}
              </button>
            ))}
          </div>

          <div className="space-y-4 pb-8">
              {journalTab === "quests" ? (
                visibleQuests.length ? (
                  visibleQuests.map((quest) => (
                    <div key={quest.id} className="rounded-2xl border border-zinc-800 bg-black px-4 py-4">
                      <p className="story-kicker">{quest.status === "completed" ? "Completed quest" : "Active quest"}</p>
                      <h3 className="text-lg font-semibold text-zinc-50">{quest.title}</h3>
                      {quest.summary ? (
                        <p className="mt-2 text-sm leading-7 text-zinc-400">{quest.summary}</p>
                      ) : (
                        <p className="mt-2 text-sm leading-7 text-zinc-500">The objective is still taking shape in the journal.</p>
                      )}
                      <p className="mt-3 text-xs uppercase tracking-[0.2em] text-zinc-500">
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
                    <div key={npc.id} className="rounded-2xl border border-zinc-800 bg-black px-4 py-4">
                      <p className="story-kicker">{npc.role ?? "Identity Unknown"}</p>
                      <h3 className="text-lg font-semibold text-zinc-50">{npc.name}</h3>
                      {npc.notes ? (
                        <p className="mt-2 text-sm leading-7 text-zinc-400">{npc.notes}</p>
                      ) : (
                        <p className="mt-2 text-sm leading-7 text-zinc-500">This figure has entered the story, but their place in it is still unclear.</p>
                      )}
                    </div>
                  ))
                ) : (
                  <EmptyJournalCopy>No one has left a strong enough impression to enter the journal yet.</EmptyJournalCopy>
                )
              ) : null}

              {journalTab === "journal" ? (
                <div className="space-y-4">
                  <div className="rounded-2xl border border-zinc-800 bg-black px-4 py-4">
                    <p className="story-kicker">Current chapter</p>
                    <h3 className="text-lg font-semibold text-zinc-50">
                      {snapshot.state.sceneState.title}
                    </h3>
                    <p className="mt-2 text-sm leading-7 text-zinc-400">
                      {snapshot.state.sceneState.summary}
                    </p>
                  </div>

                  {journalEntries.length ? (
                    journalEntries.map((entry) => (
                      <div key={entry.id} className="rounded-2xl border border-zinc-800 bg-black px-4 py-4">
                        <p className="story-kicker">{entry.title}</p>
                        <p className="mt-2 text-sm leading-7 text-zinc-400">{entry.content}</p>
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
                    <div key={clue.id} className="rounded-2xl border border-zinc-800 bg-black px-4 py-4">
                      <p className="story-kicker">Discovered clue</p>
                      <p className="text-sm leading-7 text-zinc-200">{clue.text}</p>
                      <p className="mt-2 text-xs uppercase tracking-[0.2em] text-zinc-500">
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
    </main>
  );
}
