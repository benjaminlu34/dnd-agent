"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<Array<{ id: string; name: string; description?: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  if (loading) {
    return (
      <main className="min-h-screen bg-black flex flex-col items-center justify-center p-6 text-zinc-100">
        <p className="text-zinc-400">Loading campaigns...</p>
      </main>
    );
  }

  if (error) {
    return (
      <main className="min-h-screen bg-black flex flex-col items-center justify-center p-6 text-zinc-100">
        <p className="text-red-400">Error: {error}</p>
        <Link href="/" className="mt-4 rounded-full border border-zinc-800 px-4 py-2 text-sm font-semibold text-zinc-300 transition-colors hover:bg-zinc-900 hover:text-white">
          Return Home
        </Link>
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

        {campaigns.length === 0 ? (
          <p className="text-zinc-400">No campaigns available. <Link href="/campaigns/new" className="underline">Create one</Link> to get started.</p>
        ) : (
          <div className="space-y-4 w-full max-w-2xl">
            {campaigns.map((campaign) => (
              <Link
                key={campaign.id}
                href={`/play/${campaign.id}`}
                className="block rounded-xl border border-zinc-800 bg-zinc-950/50 p-4 hover:bg-zinc-900 transition-colors"
              >
                <div className="flex flex-col">
                  <h2 className="mb-2 text-xl font-medium tracking-tight text-zinc-100">
                    {campaign.name || "Unnamed Campaign"}
                  </h2>
                  {campaign.description && (
                    <p className="text-sm text-zinc-400 line-clamp-2">{campaign.description}</p>
                  )}
                </div>
              </Link>
            ))}
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
