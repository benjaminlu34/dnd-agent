## AI Solo RPG Engine

A personal-use solo fantasy RPG built with Next.js, Prisma, PostgreSQL, and a deterministic game engine. The database owns state, the engine validates mutations, and the AI DM only narrates and proposes structured intents.

## Stack

- Next.js App Router + TypeScript
- Tailwind CSS v4
- Prisma + PostgreSQL
- OpenRouter with a built-in mock fallback
- NDJSON streaming for turn events

## Setup

1. Install dependencies.
2. Copy `.env.example` to `.env`.
3. Point `DATABASE_URL` at your pooled/runtime PostgreSQL connection.
4. Point `DIRECT_URL` at your direct PostgreSQL connection for Prisma schema operations.
5. Optionally set `OPENROUTER_API_KEY` to use a real model instead of the mock DM.
6. Generate the Prisma client and push the schema.

```bash
npm install
cp .env.example .env
npm run prisma:generate
npm run prisma:push
npm run prisma:seed
npm run dev
```

Open `http://localhost:3000`.

## Key Flows

- `POST /api/adventure/start`
  Creates a local user if needed, generates a character, blueprint, campaign state, arcs, clues, NPCs, and the first session.
- `POST /api/turns`
  Streams a normal turn. No-check turns narrate immediately and commit validated state. Check turns return `check_required`.
- `POST /api/turns/:id/check`
  Rolls authoritatively, streams the resolved narration, validates the delta, and commits the turn.
- `GET /api/campaigns/:id`
  Reloads the latest authoritative campaign snapshot and may attach a "Previously on..." recap for stale sessions.
- `POST /api/sessions/:id/summarize`
  Writes a manual session summary into `MemoryEntry`.

## Validation Guardrails

- The LLM is never the source of truth.
- Gold only comes from validated quest rewards.
- Direct inventory mutation is rejected in v1.
- Quest stages cannot jump forward arbitrarily.
- Reveals only trigger when clue and arc conditions are satisfied.
- Malformed or invalid payloads fail gracefully without committing bad state.

## Verification

```bash
npm run lint
npm run build
npm run contract-harness
```

The contract harness runs 30 turns against the configured DM provider and reports malformed payloads plus check frequency. Without `OPENROUTER_API_KEY`, it uses the mock provider so the repo still works locally.

## Notes

- The UI optimizes for quick start first and real auth later.
- The normal loop stays single-call for no-check turns.
- Check turns intentionally use two AI calls to keep narration aligned with deterministic mechanics.
- For Supabase, `DATABASE_URL` should usually be the pooler URL and `DIRECT_URL` should be the direct connection URL.
