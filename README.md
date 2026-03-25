## AI Solo RPG Engine

An AI-first solo fantasy RPG engine built with Next.js + Prisma + PostgreSQL.

The app uses a structured world model and deterministic state commits. The DM model generates world content, adjudication plans, and narration, while server-side validation and persistence keep campaign state authoritative.

## Current Product Flow

1. **Session Zero** (`/campaigns/new`)
   - Generate an open-world module draft from a prompt (`/api/campaigns/draft`), with live progress over SSE (`/api/campaigns/draft/progress`).
   - Save the draft as a reusable module (`/api/modules/create`).
   - Pick an existing character template or create one.
2. **Campaign Launch** (`/campaigns/create`)
   - Choose a stock entry point or resolve a custom entry (`/api/campaigns/custom-entry`).
   - Generate a campaign opening draft (`/api/campaigns/opening-draft`).
   - Create the campaign (`/api/campaigns/create`).
3. **Play Loop** (`/play/[campaignId]`)
   - Submit turns via NDJSON streaming (`/api/turns`).
   - Refresh latest snapshot via `/api/campaigns/[id]`.
   - Optional turn retry endpoint exists behind `ENABLE_TURN_UNDO=true` (`/api/turns/[id]/retry`).

## Tech Stack

- Next.js 16 (App Router) + React 19 + TypeScript
- Tailwind CSS v4
- Prisma ORM + PostgreSQL
- OpenRouter-compatible OpenAI SDK client (`openai` package)
- Streaming APIs:
  - NDJSON for turn events
  - SSE for world-generation progress

## Local Setup

```bash
npm install
cp .env.example .env
npm run prisma:generate
npm run prisma:push
npm run prisma:seed
npm run dev
```

Open `http://localhost:3000`.

## Environment Variables

Required at runtime:

- `DATABASE_URL`

Commonly used:

- `DIRECT_URL` (Prisma schema operations)
- `APP_URL` (defaults to `http://localhost:3000`)
- `ENABLE_TURN_UNDO` (`true` enables `/api/turns/[id]/retry`)
- `OPENROUTER_API_KEY`
- `OPENROUTER_API_KEY_2`
- `OPENROUTER_API_KEY_3`
- `OPENROUTER_MODEL`
- `OPENROUTER_PLANNER_MODEL`
- `OPENROUTER_BACKUP_RENDERER_MODEL`
- `OPENROUTER_COMPRESSION_MODEL`
- `OPENROUTER_SITE_NAME`

## API Surface (Current)

Main collections:

- `GET /api/campaigns`
- `GET /api/characters`
- `GET /api/modules`

Campaigns:

- `GET|PATCH|DELETE /api/campaigns/[id]`
- `POST /api/campaigns/create`
- `POST /api/campaigns/draft`
- `GET /api/campaigns/draft/progress`
- `POST /api/campaigns/custom-entry`
- `POST /api/campaigns/opening-draft`

Characters:

- `GET|PATCH|DELETE /api/characters/[id]`
- `POST /api/characters/create`
- `POST /api/characters/generate`

Modules:

- `GET|DELETE /api/modules/[id]`
- `POST /api/modules/create`

Turns and sessions:

- `POST /api/turns` (NDJSON stream)
- `DELETE /api/turns/lock`
- `POST /api/sessions/[id]/summarize`
- `POST /api/turns/[id]/retry` (when enabled)

Legacy per-turn endpoints that now return `410` in the spatial loop:

- `POST /api/turns/[id]/check`
- `POST /api/turns/[id]/edit`
- `POST /api/turns/[id]/cancel`

## Scripts

```bash
npm run dev
npm run build
npm run start
npm run test
npm run lint
npm run prisma:generate
npm run prisma:push
npm run prisma:seed
npm run backfill-scene-summaries
npm run contract-harness
npm run narration-harness
npm run prompt-context-harness
```

## Verification Snapshot (March 25, 2026)

- `npm test`: pass (76/76)
- `npm run build`: pass
- `npm run lint`: pass with warnings (unused vars)

