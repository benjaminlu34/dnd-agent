"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export default function CampaignsPage() {
  const router = useRouter();
  const [campaigns, setCampaigns] = useState<Array<{
    id: string;
    title: string;
    description?: string;
    playable?: boolean;
    descentStatus?: string;
    currentLocationName?: string;
  }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [editingCampaign, setEditingCampaign] = useState<{ id: string; title: string } | null>(null);
  const [renamingCampaignId, setRenamingCampaignId] = useState<string | null>(null);
  const [deletingCampaignId, setDeletingCampaignId] = useState<string | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const previousEditingCampaignIdRef = useRef<string | null>(null);

  useEffect(() => {
    async function fetchCampaigns() {
      try {
        const res = await fetch("/api/campaigns");
        if (!res.ok) {
          throw new Error(`Failed to fetch: ${res.statusText}`);
        }
      const data = await res.json();
      setCampaigns(data.campaigns || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    }

    fetchCampaigns();
  }, []);

  useEffect(() => {
    if (editingCampaign && previousEditingCampaignIdRef.current !== editingCampaign.id) {
      renameInputRef.current?.focus();
    }

    previousEditingCampaignIdRef.current = editingCampaign?.id ?? null;
  }, [editingCampaign]);

  const handleDelete = async (id: string) => {
    setDeletingCampaignId(id);
    try {
      const res = await fetch(`/api/campaigns/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        throw new Error(`Failed to delete: ${res.statusText}`);
      }
      setCampaigns(prev => prev.filter(campaign => campaign.id !== id));
      setError(null);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      return false;
    } finally {
      setDeletingCampaignId(null);
    }
  };

  const handleRename = async (id: string, title: string) => {
    const trimmedTitle = title.trim();

    if (!trimmedTitle) {
      setError("Campaign name cannot be empty.");
      return false;
    }

    setRenamingCampaignId(id);
    try {
      const res = await fetch(`/api/campaigns/${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ title: trimmedTitle }),
      });
      if (!res.ok) {
        throw new Error(`Failed to rename: ${res.statusText}`);
      }
      const data = await res.json();
      setCampaigns(prev =>
        prev.map(campaign =>
          campaign.id === id ? { ...campaign, title: data.title } : campaign
        ),
      );
      setError(null);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      return false;
    } finally {
      setRenamingCampaignId(null);
    }
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-black flex flex-col items-center justify-center p-6 text-zinc-100">
        <p className="text-zinc-400">Loading campaigns...</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-black flex flex-col items-center justify-center p-6 relative overflow-hidden text-zinc-100">
      <div className="absolute top-0 inset-x-0 h-[500px] bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-zinc-900/40 via-black to-black pointer-events-none" />

      <div className="relative z-10 flex w-full max-w-5xl flex-col items-center">
        <span className="mb-6 rounded-full border border-zinc-800 px-3 py-1 text-[10px] font-medium uppercase tracking-widest text-zinc-400">
          Campaigns Archive
        </span>

        <h1 className="mb-6 bg-gradient-to-b from-white to-zinc-500 bg-clip-text text-center text-5xl font-medium tracking-tighter text-transparent md:text-7xl">
          Available Campaigns
        </h1>

        {error ? (
          <div className="mb-6 w-full max-w-2xl rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        ) : null}

        {campaigns.length === 0 ? (
          <p className="text-zinc-400">No campaigns available. <Link href="/campaigns/new" className="underline">Create one</Link> to get started.</p>
        ) : (
          <div className="space-y-4 w-full max-w-2xl">
            {campaigns.map((campaign) => (
              <div key={campaign.id} className="block rounded-xl border border-zinc-800 bg-zinc-950/50 p-4 hover:bg-zinc-900 transition-colors relative">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div
                    className={`min-w-0 flex-1 ${campaign.playable === false ? "cursor-default" : "cursor-pointer"}`}
                    onClick={() => {
                      if (campaign.playable === false) {
                        return;
                      }
                      router.push(`/play/${campaign.id}`);
                    }}
                  >
                    {editingCampaign?.id === campaign.id ? (
                      <div>
                        <label htmlFor={`campaign-name-${campaign.id}`} className="mb-2 block text-[10px] font-medium uppercase tracking-widest text-zinc-500">
                          Campaign Name
                        </label>
                        <input
                          ref={renameInputRef}
                          id={`campaign-name-${campaign.id}`}
                          type="text"
                          value={editingCampaign.title}
                          onChange={(event) =>
                            setEditingCampaign((prev) => (prev ? { ...prev, title: event.target.value } : null))
                          }
                          disabled={renamingCampaignId === campaign.id}
                          className="w-full rounded-lg border border-zinc-700 bg-black/60 px-3 py-2 text-base font-medium tracking-tight text-zinc-100 outline-none transition focus:border-zinc-500"
                          onKeyDown={async (event) => {
                            if (event.key === "Escape") {
                              setEditingCampaign(null);
                              return;
                            }

                            if (event.key === "Enter") {
                              event.preventDefault();
                              const didRename = await handleRename(campaign.id, editingCampaign.title);
                              if (didRename) {
                                setEditingCampaign(null);
                              }
                            }
                          }}
                        />
                      </div>
                    ) : (
                      <h2 className="mb-2 text-xl font-medium tracking-tight text-zinc-100">
                        {campaign.title || "Unnamed Campaign"}
                      </h2>
                    )}
                    {campaign.description && (
                      <p className="text-sm text-zinc-400 line-clamp-2">{campaign.description}</p>
                    )}
                    {campaign.playable === false ? (
                      <p
                        className={[
                          "mt-3 text-[11px] uppercase tracking-[0.18em]",
                          campaign.descentStatus === "descent_failed"
                            ? "text-red-300"
                            : "text-amber-300",
                        ].join(" ")}
                      >
                        {campaign.descentStatus === "descent_failed"
                          ? "Descent Failed"
                          : "Awaiting Settlement Descent"}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 gap-2 self-start" onClick={(e) => e.preventDefault()}>
                    {editingCampaign?.id === campaign.id ? (
                      <>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setError(null);
                            setEditingCampaign(null);
                          }}
                          disabled={renamingCampaignId === campaign.id}
                          className="rounded border border-zinc-700 px-2 py-1 text-xs font-semibold text-zinc-300 hover:bg-zinc-800 transition-colors disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={async (e) => {
                            e.stopPropagation();
                            const didRename = await handleRename(campaign.id, editingCampaign.title);
                            if (didRename) {
                              setEditingCampaign(null);
                            }
                          }}
                          disabled={renamingCampaignId === campaign.id}
                          className="rounded border border-zinc-700 bg-white px-2 py-1 text-xs font-semibold text-black hover:bg-zinc-200 transition-colors disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {renamingCampaignId === campaign.id ? "Saving..." : "Save"}
                        </button>
                      </>
                    ) : !deleteConfirmId ? (
                      <>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setError(null);
                            setEditingCampaign({ id: campaign.id, title: campaign.title || "" });
                          }}
                          className="rounded border border-zinc-700 px-2 py-1 text-xs font-semibold text-zinc-300 hover:bg-zinc-800 transition-colors"
                        >
                          Rename
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteConfirmId(campaign.id);
                          }}
                          className="rounded border border-red-600 px-2 py-1 text-xs font-semibold text-red-300 hover:bg-red-800/20 transition-colors"
                        >
                          Delete
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {deleteConfirmId && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-6 backdrop-blur-sm">
            <div className="w-full max-w-md rounded-[1.75rem] border border-zinc-800 bg-zinc-950/95 p-6 shadow-2xl shadow-black/30 backdrop-blur">
              <p className="text-[10px] font-medium uppercase tracking-widest text-zinc-500">
                Campaign Archive
              </p>
              <h3 className="mt-3 text-2xl font-medium tracking-tight text-zinc-100">Delete Campaign</h3>
              <p className="mt-3 text-sm leading-relaxed text-zinc-400">
                Are you sure you want to delete this campaign? This action cannot be undone.
              </p>
              <div className="mt-6 flex justify-end gap-3">
                <button
                  onClick={() => setDeleteConfirmId(null)}
                  disabled={Boolean(deletingCampaignId)}
                  className="rounded-md border border-zinc-800 px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-900 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  onClick={async () => {
                    const didDelete = await handleDelete(deleteConfirmId);
                    if (didDelete) {
                      setDeleteConfirmId(null);
                    }
                  }}
                  disabled={Boolean(deletingCampaignId)}
                  className="rounded-md border border-zinc-700 bg-zinc-100 px-4 py-2 text-sm font-medium text-black transition-colors hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {deletingCampaignId ? "Deleting..." : "Delete"}
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row">
          <Link
            href="/"
            className="rounded-full border border-zinc-800 px-6 py-3 text-sm font-semibold text-zinc-300 transition-colors hover:bg-zinc-900 hover:text-white"
          >
            Home
          </Link>
          <Link
            href="/campaigns/new"
            className="rounded-full bg-white px-6 py-3 text-sm font-semibold text-black transition-colors hover:bg-zinc-200"
          >
            Create New Campaign
          </Link>
        </div>
      </div>
    </main>
  );
}
