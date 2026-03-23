import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen bg-black flex flex-col items-center justify-center p-6 relative overflow-hidden text-zinc-100">
      <div className="absolute top-0 inset-x-0 h-[500px] bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-zinc-900/40 via-black to-black pointer-events-none" />

      <div className="relative z-10 flex w-full max-w-5xl flex-col items-center">
        <span className="mb-6 rounded-full border border-zinc-800 px-3 py-1 text-[10px] font-medium uppercase tracking-widest text-zinc-400">
          v1.0 Engine Live
        </span>

        <h1 className="mb-6 bg-gradient-to-b from-white to-zinc-500 bg-clip-text text-center text-5xl font-medium tracking-tighter text-transparent md:text-7xl">
          Solo Fantasy. Deterministic Engine.
        </h1>

        <p className="mb-10 max-w-2xl text-center text-lg leading-relaxed text-zinc-400 md:text-xl">
          Build replayable worlds, generate a protagonist, and launch an AI-guided solo campaign
          from a clean, controlled archive.
        </p>

        <div className="flex flex-col items-center gap-3 sm:flex-row">
          <Link
            href="/campaigns/new"
            className="rounded-full bg-white px-6 py-3 text-sm font-semibold text-black transition-colors hover:bg-zinc-200"
          >
            Enter the Archive
          </Link>
          <Link
            href="/characters"
            className="rounded-full border border-zinc-800 px-6 py-3 text-sm font-semibold text-zinc-300 transition-colors hover:bg-zinc-900 hover:text-white"
          >
            Manage Characters
          </Link>
          <Link
            href="/campaigns"
            className="rounded-full border border-zinc-800 px-6 py-3 text-sm font-semibold text-zinc-300 transition-colors hover:bg-zinc-900 hover:text-white"
          >
            View Campaigns
          </Link>
        </div>

        <div className="mt-24 grid w-full max-w-5xl grid-cols-1 gap-6 md:grid-cols-3">
          <section className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-6">
            <p className="text-[10px] font-medium uppercase tracking-widest text-zinc-500">
              Feature 1
            </p>
            <h2 className="mt-3 text-xl font-medium tracking-tight text-zinc-100">
              Strict State Management
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-zinc-400">
              Campaign state is explicit, typed, and easy to inspect instead of being hidden in a
              vague story loop.
            </p>
          </section>

          <section className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-6">
            <p className="text-[10px] font-medium uppercase tracking-widest text-zinc-500">
              Feature 2
            </p>
            <h2 className="mt-3 text-xl font-medium tracking-tight text-zinc-100">
              Explicit Discovery
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-zinc-400">
              Information moves into the player view only when it is earned, keeping the archive
              clean and the fiction honest.
            </p>
          </section>

          <section className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-6">
            <p className="text-[10px] font-medium uppercase tracking-widest text-zinc-500">
              Feature 3
            </p>
            <h2 className="mt-3 text-xl font-medium tracking-tight text-zinc-100">
              Replayable Worlds
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-zinc-400">
              Save a generated module once, then launch multiple campaigns from different entry
              points without losing reuse.
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
