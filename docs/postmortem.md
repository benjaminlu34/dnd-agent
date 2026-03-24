# 1. Executive Premortem
The most likely reason this project fails is not "the AI was too flaky" in the abstract. It is that the repo treats schema-valid, citation-valid model output as if that were close to trustworthy gameplay, while the real product risk lives in state authority, temporal consistency, and player trust.

Verified in code: the model is still allowed to choose consequential mechanics such as `approvalDelta`, `discoverInformationIds`, `timeElapsed`, and freeform `statToCheck` / `dc` / `intendedMechanicalOutcome` ([src/lib/ai/provider.ts](../src/lib/ai/provider.ts) `actionTools`, [src/lib/game/validation.ts](../src/lib/game/validation.ts) `validateTurnCommand`, [src/lib/game/engine.ts](../src/lib/game/engine.ts) `applyPlayerActionEffects`). At the same time, the server has no real turn serialization or session/campaign consistency guard, campaign memory is mostly unstructured text, the "thin context" turn path still loads a full campaign snapshot every turn, and the streaming UX is not actually incremental.

Six months later, the failure is likely to look like this: the game can still generate rich worlds and produce coherent prose, but sustained play feels slow, arbitrary, forgetful, and occasionally corrupt. The repo is optimized harder for producing a dense world graph than for delivering repeatably legible, fair, low-latency play inside a live campaign.

# 2. Top 10 Failure Modes
## 1. Turn State Corruption Under Duplicate or Stale Submission
- Why it’s likely: server-side turn processing trusts the client-supplied `sessionId`, loads a campaign snapshot before creating the turn, and never locks or version-checks the campaign before commit.
- What code suggests it: `triageTurn()` reads `getCampaignSnapshot(input.campaignId)`, then creates a `Turn` with `campaignId: snapshot.campaignId` and `sessionId: input.sessionId`, then commits against `sessionId` directly ([src/lib/game/engine.ts](../src/lib/game/engine.ts):1512-1577). Prisma stores `Turn.campaignId` and `Turn.sessionId` separately with no composite invariant that the session belongs to the same campaign ([prisma/schema.prisma](../prisma/schema.prisma):173-187). There is also no idempotency key, no lock record, and no optimistic version on `Campaign.stateJson`.
- What users would experience: duplicate turns after retries or multi-tab play, time advancing twice, messages landing in the wrong session, or "the world jumped somewhere weird after I hit submit."
- Severity (1-5): 5
- Confidence (1-5): 5

## 2. The Model Is Still the Arbiter of Fairness
- Why it’s likely: the AI is not just narrating. It is choosing which facts become discovered, which NPC approval changes happen, how much time an action consumes, and, for freeform actions, which stat and DC govern success.
- What code suggests it: the action tool schemas expose `approvalDelta`, `discoverInformationIds`, `memorySummary`, `timeElapsed`, and freeform `statToCheck`, `dc`, and `intendedMechanicalOutcome` ([src/lib/ai/provider.ts](../src/lib/ai/provider.ts):2090-2325). `validateTurnCommand()` mostly checks entity membership, cited IDs, time bounds, and a few trade/combat invariants; it does not judge whether the chosen approval swing, discovered clue set, or freeform DC is fair ([src/lib/game/validation.ts](../src/lib/game/validation.ts):278-568). `applyPlayerActionEffects()` then applies those model-selected deltas directly ([src/lib/game/engine.ts](../src/lib/game/engine.ts):978-1058).
- What users would experience: "Sometimes talking to someone helps, sometimes it hurts, and I can’t tell why," or "the game decided that was a hard check because the model felt like it."
- Severity (1-5): 5
- Confidence (1-5): 5

## 3. Long-Term Memory and Relationship Continuity Decay Fast
- Why it’s likely: persistent memory is stored as plain text with no structured entity references, but relationship retrieval assumes those summaries contain raw NPC IDs.
- What code suggests it: `MemoryEntry` only stores `type` and `summary` ([prisma/schema.prisma](../prisma/schema.prisma):202-212). Turn commit saves `command.memorySummary.trim()` verbatim with no entity link ([src/lib/game/engine.ts](../src/lib/game/engine.ts):1371-1379). Later, `fetchNpcDetail()` and `fetchRelationshipHistory()` search memories via `summary contains npcId` ([src/lib/game/repository.ts](../src/lib/game/repository.ts):1275-1284, 1487-1500). Session summarization is also weak: `dmClient.summarizeSession()` just returns the last 8 lines joined together ([src/lib/ai/provider.ts](../src/lib/ai/provider.ts):4976-4982), and `maybeGeneratePreviouslyOn()` is a stub returning `null` ([src/lib/game/engine.ts](../src/lib/game/engine.ts):1634-1635).
- What users would experience: empty or nonsensical relationship history, repetitive recaps, NPCs who seem not to remember important prior interactions, and a campaign that forgets what made it emotionally distinct.
- Severity (1-5): 5
- Confidence (1-5): 5

## 4. Turn Latency Is Too High, and the "Streaming" Story Is Mostly False
- Why it’s likely: each turn still builds a full campaign snapshot, then builds prompt context from it, then the server buffers narration until resolution, then the client ignores narration events anyway.
- What code suggests it: `triageTurn()` calls `getCampaignSnapshot()` before `getPromptContext()` ([src/lib/game/engine.ts](../src/lib/game/engine.ts):1518-1524). `getCampaignSnapshot()` eagerly loads nearly the whole campaign graph: all locations, edges, factions, relations, NPCs, information, links, recent messages, events, and temporary actors ([src/lib/game/repository.ts](../src/lib/game/repository.ts):1520-1591). The turn route buffers narration in `bufferedNarration` and only sends it after the turn resolves ([src/app/api/turns/route.ts](../src/app/api/turns/route.ts):26-70). The client `consumeNdjson()` callback does not even handle `narration` events; it waits for final state/actions/checks instead ([src/components/adventure-app.tsx](../src/components/adventure-app.tsx):261-289).
- What users would experience: long "Resolving..." pauses, no feeling of live narration, and poor retention because each move feels heavier than the payoff.
- Severity (1-5): 5
- Confidence (1-5): 5

## 5. Background Simulation and Turn Resolution Drift Apart
- Why it’s likely: the engine applies player action effects first and only then runs temporal simulation across the elapsed time window. That means long actions interact with start-of-turn state, not with the world as it would have evolved during those minutes.
- What code suggests it: `commitResolvedTurn()` runs `applyPlayerActionEffects()` before `runTemporalSimulation()` ([src/lib/game/engine.ts](../src/lib/game/engine.ts):1288-1304). The model can assign long durations to many non-travel actions via `timeElapsed` ([src/lib/ai/provider.ts](../src/lib/ai/provider.ts):2145-2325), bounded but still broad enough for meaningful drift ([src/lib/game/validation.ts](../src/lib/game/validation.ts):213-258).
- What users would experience: "I spent four hours bargaining with someone who should have left," or "the game let me finish a long action and only afterward remembered the world was moving."
- Severity (1-5): 4
- Confidence (1-5): 4

## 6. Read-Only Fetch Tools Quietly Mutate Persistent World State
- Why it’s likely: `fetch_npc_detail` is not actually read-only. Fetching promoted NPC detail can permanently hydrate an NPC and create new information outside the turn commit transaction.
- What code suggests it: `executeFetchTool()` calls `hydratePromotedNpcRecord()` when a promoted local is not yet hydrated ([src/lib/game/engine.ts](../src/lib/game/engine.ts):1399-1462). `hydratePromotedNpcRecord()` updates the NPC and can `createMany` information records in its own transaction ([src/lib/game/engine.ts](../src/lib/game/engine.ts):266-507). Those writes are not part of `commitResolvedTurn()` rollback metadata.
- What users would experience: merely inspecting or targeting an NPC changes the world; retries or clarifications can leave permanent side effects; debugging becomes miserable because "read" and "write" paths are no longer separable.
- Severity (1-5): 4
- Confidence (1-5): 5

## 7. Rollback Gives a False Sense of Safety
- Why it’s likely: rollback data lives inside `Turn.resultJson`, undo only works on the latest resolved turn, and docs explicitly admit the coverage gap is still open.
- What code suggests it: rollback metadata is stored in `Turn.resultJson.rollback` during commit ([src/lib/game/engine.ts](../src/lib/game/engine.ts):1383-1393). Undo reconstructs state from that blob only for the latest resolved turn ([src/lib/game/engine.ts](../src/lib/game/engine.ts):1650-1751). The plan still lists "Exhaustive simulation/undo integration coverage" as deferred, along with hard-disablement of player-accessible undo outside QA ([docs/open-world-simulation-plan.md](./open-world-simulation-plan.md):37-43). The implementation brief promised engine transaction and simulation tests that are not present ([docs/implementation-temp.md](./implementation-temp.md):123-145).
- What users would experience: undo works in demos but fails under weird live states, leaving support with nothing better than "please reset the campaign."
- Severity (1-5): 4
- Confidence (1-5): 4

## 8. Simulation Becomes Busy but Shallow
- Why it’s likely: the repo has a lot of simulation structure, but the actual autonomous reactions are partly AI-authored, partly generic, and often only validated for shape, not strategic quality.
- What code suggests it: daily schedules are generated by the model from campaign state ([src/lib/game/engine.ts](../src/lib/game/engine.ts):1083-1223). Unknown routine or event conditions are only `console.warn`ed and skipped ([src/lib/game/simulation.ts](../src/lib/game/simulation.ts):660-668, 722-727). Faction reactions cancel all pending moves for an affected faction and replace them with a generic "quietly reorganizes" move that just adds `information: 1` ([src/lib/game/simulation.ts](../src/lib/game/simulation.ts):812-861). Combat still uses a testing move helper ([src/lib/game/engine.ts](../src/lib/game/engine.ts):530-557, 932-939).
- What users would experience: a world that looks active on paper but behaves repetitively, produces opaque chain reactions, and lacks the feeling of a principled simulation.
- Severity (1-5): 4
- Confidence (1-5): 4

## 9. Rich State Turns Into Dark Matter Because the UI Barely Explains It
- Why it’s likely: the data model tracks far more than the player can actually see or reason about during play.
- What code suggests it: the schema has `FactionRelation`, `NpcRoutine`, `WorldEvent`, `TemporaryActor`, `InformationLink`, `MarketPrice`, and more ([prisma/schema.prisma](../prisma/schema.prisma):215-490). But `PlayerCampaignSnapshot` drops `factionRelations` and `connectedLeads` entirely ([src/lib/game/types.ts](../src/lib/game/types.ts):683-712), and the play UI renders a narrow slice: recent messages, routes, present NPCs, known factions, discovered information, inventory, and a free-text box ([src/components/adventure-app.tsx](../src/components/adventure-app.tsx):423-620).
- What users would experience: "The world clearly tracks more than I can see, so outcomes feel like backstage DM rulings instead of understandable game state."
- Severity (1-5): 4
- Confidence (1-5): 5

## 10. Saved Campaign Compatibility Is Fragile, and the Repo Knows It
- Why it’s likely: critical state is in JSON blobs, campaign state is cast rather than parsed, there are no Prisma migrations in the repo, and the docs explicitly defer real versioning.
- What code suggests it: `Campaign.stateJson`, `Turn.toolCallJson`, `Turn.resultJson`, `Faction.resources`, `NpcRoutine.triggerCondition`, `FactionMove.payload`, and `WorldEvent.payload` are all JSON-backed ([prisma/schema.prisma](../prisma/schema.prisma):61-92, 173-212, 262-283, 414-470). `getCampaignSnapshot()` trusts `campaign.stateJson as CampaignRuntimeState` and simply returns `null` if the referenced current location no longer exists ([src/lib/game/repository.ts](../src/lib/game/repository.ts):1597-1604). The repo uses `prisma db push`, not migrations ([package.json](../package.json):9-13), and the plan explicitly says module-version migration is still deferred ([docs/open-world-simulation-plan.md](./open-world-simulation-plan.md):39-42; [docs/implementation-temp.md](./implementation-temp.md):54-60, 147-154).
- What users would experience: old saves suddenly failing to load, campaign snapshots becoming unrecoverable after schema or prompt changes, and no principled migration story.
- Severity (1-5): 4
- Confidence (1-5): 5

# 3. False Assumptions
## A1. "Schema-valid AI output is close to good gameplay."
- Assumption: once the tool payload validates and cites known entities, the resulting play is probably acceptable.
- Why it is probably false: the validators mainly check membership, shape, and a few local invariants. They do not judge whether the action was satisfying, fair, strategically meaningful, or temporally coherent.
- Evidence from repo: `validateTurnCommand()` checks targets, time, citations, and some trade/combat facts, but not approval fairness, discovery appropriateness, or freeform DC quality ([src/lib/game/validation.ts](../src/lib/game/validation.ts):278-568).
- How to test whether it is false: record 50 real turns, then manually score whether approval changes, discoveries, freeform DCs, and action durations felt fair and legible. I would expect many "valid but bad" turns.

## A2. "The AI only narrates; the engine owns mechanics."
- Assumption: the engine is authoritative enough that model weirdness cannot materially change fairness.
- Why it is probably false: the engine owns storage, but the model still decides the inputs to many authoritative mutations.
- Evidence from repo: `approvalDelta`, `discoverInformationIds`, `timeElapsed`, and freeform `statToCheck` / `dc` / `intendedMechanicalOutcome` are model-supplied ([src/lib/ai/provider.ts](../src/lib/ai/provider.ts):2145-2325), and then applied directly ([src/lib/game/engine.ts](../src/lib/game/engine.ts):695-739, 988-1018).
- How to test whether it is false: replay the same player prompt 20 times with different model seeds and compare approval shifts, discovered clues, and freeform check choices.

## A3. "Thin prompt context solved the context/latency problem."
- Assumption: the project already moved to a genuinely thin, lazy-loaded turn context.
- Why it is probably false: the turn path still loads a full snapshot before building the thin prompt object.
- Evidence from repo: `triageTurn()` calls `getCampaignSnapshot()` first ([src/lib/game/engine.ts](../src/lib/game/engine.ts):1518-1524), and the plan still lists full prompt-context optimization as deferred ([docs/open-world-simulation-plan.md](./open-world-simulation-plan.md):37-40).
- How to test whether it is false: benchmark turn latency on a seeded 15-location, multi-day campaign and compare `getCampaignSnapshot()` time against `getPromptContext()` time.

## A4. "Free-text memory summaries are enough for continuity."
- Assumption: one short memory sentence per turn is sufficient, and future retrieval can reconstruct relationship history from it.
- Why it is probably false: retrieval depends on raw NPC IDs appearing inside human-written memory text, which is not a stable contract.
- Evidence from repo: `MemoryEntry.summary` is unstructured ([prisma/schema.prisma](../prisma/schema.prisma):202-212); retrieval uses `summary contains npcId` ([src/lib/game/repository.ts](../src/lib/game/repository.ts):1275-1284, 1487-1500).
- How to test whether it is false: inspect 100 stored `turn_memory` rows after normal play and count how many contain machine IDs versus normal prose.

## A5. "Fetch tools are safe because they are read-only context helpers."
- Assumption: tool fetches can be retried, cancelled, or clarification-looped without side effects.
- Why it is probably false: promoted NPC detail fetch can mutate the world before the turn is committed.
- Evidence from repo: `fetch_npc_detail` may call `hydratePromotedNpcRecord()`, which updates NPCs and creates information ([src/lib/game/engine.ts](../src/lib/game/engine.ts):1399-1462, 266-507).
- How to test whether it is false: fetch a promoted NPC, then abort before commit and diff the campaign tables.

## A6. "Rollback makes experimentation safe."
- Assumption: because inverse writes are tracked, undo meaningfully de-risks shipping.
- Why it is probably false: undo is latest-turn only, stored in mutable JSON, and not backed by the integration coverage the docs themselves called for.
- Evidence from repo: latest-only undo ([src/lib/game/engine.ts](../src/lib/game/engine.ts):1670-1681); rollback blob in `Turn.resultJson` ([src/lib/game/engine.ts](../src/lib/game/engine.ts):1387-1393); deferred coverage in docs ([docs/open-world-simulation-plan.md](./open-world-simulation-plan.md):39-41).
- How to test whether it is false: run fuzz turns with trade, combat, discovery, temporary actor promotion, day crossing, and undo in random order. Compare full table snapshots before and after.

## A7. "World richness will naturally turn into satisfying play."
- Assumption: a denser world graph, more factions, more knowledge threads, and more local texture will produce a better game loop.
- Why it is probably false: the generation pipeline is elaborate, but the moment-to-moment player surface remains a thin text box plus sidebars, with limited causal explanation.
- Evidence from repo: multi-stage world generation dominates provider complexity ([src/lib/ai/provider.ts](../src/lib/ai/provider.ts):2730-4440), while the play UI is a minimal free-text loop ([src/components/adventure-app.tsx](../src/components/adventure-app.tsx):423-620).
- How to test whether it is false: compare retention and turn count between a rich generated world and a deliberately simpler world with stronger affordances and explicit next-step clarity.

## A8. "Campaign compatibility can wait."
- Assumption: versioning and migration are future concerns.
- Why it is probably false: persistent campaigns are a core product claim. Once players invest, "nuke it" stops being acceptable.
- Evidence from repo: docs explicitly defer module-version migration ([docs/open-world-simulation-plan.md](./open-world-simulation-plan.md):39-42), and the repo has no migration history, only `prisma db push` ([package.json](../package.json):9-13).
- How to test whether it is false: evolve the schema or world-generation contract twice, then try loading campaigns created before those changes.

# 4. Missed Edge Cases
## Turn Processing / Concurrency
- Two tabs submit turns against the same campaign from the same stale snapshot. Both turns can commit because there is no turn lock, no campaign version check, and no idempotency key.
- The browser sends a stale or mismatched `sessionId`. The server never verifies that the supplied session belongs to the supplied campaign before incrementing the session and appending messages.
- A network retry replays the same POST. The server has no dedupe mechanism and will happily create another `Turn`.
- A clarification turn creates a `Turn` row but no state commit. Repeated clarification loops can leave many semi-authoritative records without moving the world.

## AI / Gameplay
- A freeform action takes hours, but the player still gets to act on the start-of-turn NPC/world state because action effects happen before simulation.
- The model chooses a discovery set or approval delta that is technically allowed but tonally absurd.
- The 3-fetch budget is exhausted during a reasonable complex scene; the engine responds with clarification instead of supporting the action.
- `fetch_npc_detail` is supposed to read context but can permanently create new information.

## Simulation / Scheduling
- A world event or routine condition becomes invalid after schema evolution. The tick silently skips it with `console.warn`, so the world just "forgets" that system.
- A faction gets touched by many actions in one tick; the engine cancels all pending moves and replaces them with a generic reaction, flattening faction behavior.
- An event or move hits the cascade limit and is just skipped, producing simulation gaps without repair.
- A turn crosses multiple days and generates schedule chunks sequentially, but any bad generated payload aborts the whole commit.

## Memory / Narrative Continuity
- The model writes a good `memorySummary` in natural language without machine IDs. Relationship history for that NPC becomes effectively unqueryable.
- Session summary noise compounds because summaries are just the last 8 lines concatenated, not compressed into stable facts.
- A recurring unnamed local is promoted to an NPC, but their earlier interactions live in `TemporaryActor` fields and free-text memories rather than a stable social graph.

## Persistence / Compatibility
- `Campaign.stateJson.currentLocationId` points at a deleted or renamed location. `getCampaignSnapshot()` returns `null`, effectively bricking the campaign.
- A JSON field shape changes between versions. Code casts `stateJson` or `resultJson` to expected types instead of parsing, so incompatibility shows up late and inconsistently.
- Undo relies on `Turn.resultJson.rollback`; any older turns or altered payload shapes become non-undoable.

## UI / Product
- The server emits narration events, but the client does not render them live, so the user waits through a "stream" that behaves like a blocking RPC.
- The snapshot contains `localInformation`, `memories`, and temporary-actor context, but the play UI mostly ignores them, leaving the player to infer priority from raw prose.
- A promoted local is not yet hydrated, so the user gets "That person's details are still loading into the world" instead of a crisp in-fiction answer.

# 5. Weak Integration Boundaries
## AI Output ↔ Engine Authority
- Implicit contract: the model proposes actions, but the engine keeps them fair.
- How it can fail: the model supplies authoritative mechanics that the engine barely critiques, especially `approvalDelta`, clue discovery, action duration, and freeform difficulty.
- Likely symptoms: arbitrary approval swings, clue unlocks that feel unearned, and freeform checks that feel like hidden GM fiat.

## Fetch Tools ↔ Persistence
- Implicit contract: fetches are read-only context retrieval.
- How it can fail: `fetch_npc_detail` hydrates promoted NPCs and can create information before the turn commits.
- Likely symptoms: inspecting or targeting someone changes the world; retries and clarifications leave permanent residue.

## Turn Submission ↔ Session Integrity
- Implicit contract: the client’s `campaignId` and `sessionId` refer to the same live campaign state.
- How it can fail: the server never checks that, and Prisma does not enforce it at the `Turn` level.
- Likely symptoms: messages in the wrong session, session turn counts drifting from campaign state, and corruption that only appears after stale-tab play.

## Turn Resolution ↔ Temporal Simulation
- Implicit contract: a long action resolves inside a living world.
- How it can fail: player-side effects apply before simulation advances the elapsed time window.
- Likely symptoms: NPCs stay interactable far longer than they should; time-based routines fire only after the player already exploited stale presence.

## Persistence ↔ Runtime Types
- Implicit contract: JSON-backed runtime state always matches the current TypeScript expectations.
- How it can fail: `stateJson`, `toolCallJson`, `resultJson`, and simulation payload JSON are cast, not consistently parsed.
- Likely symptoms: campaigns that suddenly fail to load, undo blobs that become unreadable, and weird live-state bugs that only appear after schema/prompt evolution.

## Persistence ↔ Player Snapshot
- Implicit contract: the snapshot exposes the state the player needs to understand the world.
- How it can fail: the repo tracks much more state than the UI explains, and some graph structures are dropped before reaching the player surface.
- Likely symptoms: "the game knows why this happened, but I don’t."

## Streaming ↔ Committed State
- Implicit contract: streaming gives the player useful partial progress before commit.
- How it can fail: the route buffers narration until after resolution, then the client ignores narration events anyway.
- Likely symptoms: long dead air, then a bulk refresh.

## Temporary Actors ↔ Persistent NPCs
- Implicit contract: recurring locals graduate smoothly from lightweight scene extras to stable world actors.
- How it can fail: promotion is keyed by label/location heuristics, hydration is delayed, and history lives across `TemporaryActor`, `NPC`, and free-text memory summaries.
- Likely symptoms: recurring locals changing shape, losing relationship continuity, or hitting "still synchronizing" clarification loops.

## Rollback ↔ Turn Commit
- Implicit contract: every meaningful mutation that matters to a turn is invertible.
- How it can fail: fetch-triggered hydration writes live outside turn commit rollback, and docs admit undo coverage is incomplete.
- Likely symptoms: undo that appears to work but leaves the world subtly changed.

## Campaign Memory ↔ Prompt Context
- Implicit contract: the prompt gets the right memory to maintain narrative continuity.
- How it can fail: prompt context uses recent messages and discovered information, but memory retrieval is weak and entity linkage is not durable.
- Likely symptoms: coherent short-term prose with long-term continuity decay.

# 6. What Users Would Hate
- "Everything takes too long." Evidence: each turn loads a full campaign snapshot, world generation is multi-stage and batched, and the streaming UX is not actually live ([src/lib/game/repository.ts](../src/lib/game/repository.ts):1520-1591, [src/lib/ai/provider.ts](../src/lib/ai/provider.ts):1552-1718, 2730-4440, [src/app/api/turns/route.ts](../src/app/api/turns/route.ts):26-70, [src/components/adventure-app.tsx](../src/components/adventure-app.tsx):261-289).
- "It feels like the game decides outcomes randomly." Evidence: the model chooses approval changes, clue discovery, action duration, and freeform stat/DC inputs that the engine mostly accepts if they are structurally valid ([src/lib/ai/provider.ts](../src/lib/ai/provider.ts):2145-2325, [src/lib/game/validation.ts](../src/lib/game/validation.ts):492-568, [src/lib/game/engine.ts](../src/lib/game/engine.ts):978-1018).
- "The world forgets what it told me." Evidence: memory is plain text with no stable entity refs, relationship history depends on `summary contains npcId`, and session summaries are last-8-line concatenations ([prisma/schema.prisma](../prisma/schema.prisma):202-212, [src/lib/game/engine.ts](../src/lib/game/engine.ts):1371-1379, 1589-1635, [src/lib/game/repository.ts](../src/lib/game/repository.ts):1275-1284, 1487-1500, [src/lib/ai/provider.ts](../src/lib/ai/provider.ts):4976-4982).
- "I can do anything, but nothing feels crisp." Evidence: the UI is a generic text box plus suggested actions, while most of the game’s real state and causality stay backstage ([src/components/adventure-app.tsx](../src/components/adventure-app.tsx):423-620).
- "I never know what matters right now." Evidence: the UI does not surface connected leads or faction relations, and even local information is not used prominently despite existing in the snapshot ([src/lib/game/types.ts](../src/lib/game/types.ts):683-712, [src/lib/game/repository.ts](../src/lib/game/repository.ts):1748-1769, [src/components/adventure-app.tsx](../src/components/adventure-app.tsx):423-620).
- "The world is rich, but strategically empty." Evidence: generation and validation spend enormous effort on world richness, while simulation reactions are partly generic and the play loop itself is minimal ([src/lib/ai/provider.ts](../src/lib/ai/provider.ts):2730-4440, [src/lib/game/simulation.ts](../src/lib/game/simulation.ts):812-861).
- "That person’s details are still loading into the world" is not an acceptable in-fiction excuse. Evidence: promoted NPC hydration races surface directly to the user as clarification text ([src/lib/game/engine.ts](../src/lib/game/engine.ts):1409-1459, [src/lib/ai/provider.ts](../src/lib/ai/provider.ts):4890-4911).
- "Undo worked yesterday, then today it didn’t." Evidence: rollback is latest-turn-only, JSON-backed, and explicitly under-covered in docs ([src/lib/game/engine.ts](../src/lib/game/engine.ts):1650-1751, [docs/open-world-simulation-plan.md](./open-world-simulation-plan.md):37-43).

# 7. Code Smells That Become Product Failures
- JSON-heavy critical state. This is not just a maintainability smell. It turns version drift into save corruption risk because campaign runtime state, turn rollback, faction resources, and simulation payloads all live in semi-structured blobs.
- Model-owned mechanics. This is not just "AI integration." It means fairness, pacing, and reward signaling can drift turn by turn because the model still chooses consequential mechanics.
- A god transaction inside `commitResolvedTurn()`. This is not just orchestration complexity. It means many unrelated product behaviors fail together and are hard to reason about under concurrency.
- Read paths with hidden writes. This is not just layering impurity. It means user-visible inspection can mutate world canon and invalidate rollback assumptions.
- Oversized snapshot assembly. This is not just inefficiency. It directly raises turn latency and makes sustained play feel worse as campaigns age.
- Stringly memory. This is not just a missing relation table. It undermines the product’s core promise of persistent campaign continuity.
- Generic reaction payloads in simulation. This is not just placeholder logic. It makes a supposedly alive world feel repetitive and strategically thin.
- Rich world state with low player salience. This is not just an information architecture issue. It produces the feeling that the game is operating under hidden rules the player cannot learn.
- Half-removed pending-turn architecture. `pendingTurnId` still exists in runtime state, but edit/check/cancel routes are dead 410 stubs ([src/lib/game/types.ts](../src/lib/game/types.ts):525-529, [src/app/api/turns/[id]/check/route.ts](../src/app/api/turns/[id]/check/route.ts):1-12, [src/app/api/turns/[id]/edit/route.ts](../src/app/api/turns/[id]/edit/route.ts):13-24, [src/app/api/turns/[id]/cancel/route.ts](../src/app/api/turns/[id]/cancel/route.ts):25-36). That is a sign of churn around turn state that never fully stabilized.

# 8. Evidence Map
| Claim | Files / symbols involved | Why the evidence matters | Open question / uncertainty |
| --- | --- | --- | --- |
| [Verified] Server-side turn processing has no real serialization or idempotency. | [src/lib/game/engine.ts](../src/lib/game/engine.ts) `triageTurn`, `commitResolvedTurn`; [prisma/schema.prisma](../prisma/schema.prisma) `Turn`, `Campaign` | This is the root of duplicate-submission and stale-session corruption risk. | Exact transaction isolation level of the production DB is not visible here. |
| [Verified] `sessionId` is trusted from the client and not matched back to `campaignId`. | [src/app/api/turns/route.ts](../src/app/api/turns/route.ts):15-31; [src/lib/game/engine.ts](../src/lib/game/engine.ts):1525-1529, 1313-1329; [prisma/schema.prisma](../prisma/schema.prisma):156-187 | This is a concrete integrity hole, not a theoretical one. | If the UI is the only caller and always fresh, it may appear stable until multi-tab or stale client scenarios. |
| [Verified] The model supplies authoritative mechanics. | [src/lib/ai/provider.ts](../src/lib/ai/provider.ts):2090-2325, 4768-4951; [src/lib/game/engine.ts](../src/lib/game/engine.ts):695-739, 978-1018; [src/lib/game/validation.ts](../src/lib/game/validation.ts):492-568 | Confirms that "engine-owned mechanics" is only partially true. | Real-world prompt quality could reduce the frequency of bad outputs, but not eliminate the structural risk. |
| [Verified] Freeform fairness is model-owned. | [src/lib/ai/provider.ts](../src/lib/ai/provider.ts):2308-2325; [src/lib/game/validation.ts](../src/lib/game/validation.ts):385-400, 546-561 | The engine rolls against model-chosen stat/DC unless the payload is obviously malformed. | Need gameplay traces to measure how often this feels bad in practice. |
| [Verified] Fetching NPC detail can mutate persistent world state outside turn commit. | [src/lib/game/engine.ts](../src/lib/game/engine.ts):266-507, 1399-1462 | This breaks the expected read/write boundary and weakens rollback guarantees. | Need to inspect whether this mutation path appears frequently in real sessions. |
| [Verified] Long-term relationship history lookup is structurally weak. | [prisma/schema.prisma](../prisma/schema.prisma):202-212; [src/lib/game/engine.ts](../src/lib/game/engine.ts):1371-1379; [src/lib/game/repository.ts](../src/lib/game/repository.ts):1275-1284, 1487-1500 | Explains why persistent memory will degrade even if prose remains coherent turn to turn. | Could be partially mitigated if prompts routinely include IDs inside summaries, but the code does not enforce that. |
| [Verified] Session summaries are not real summarization. | [src/lib/game/engine.ts](../src/lib/game/engine.ts):1589-1632; [src/lib/ai/provider.ts](../src/lib/ai/provider.ts):4976-4982 | This means the repo has almost no true memory compression path for long campaigns. | Need to inspect whether any external summarization scripts are used manually. |
| [Verified] "Thin context" still begins from a full snapshot load. | [src/lib/game/engine.ts](../src/lib/game/engine.ts):1518-1524; [src/lib/game/repository.ts](../src/lib/game/repository.ts):1520-1591, 1792-1860; [docs/open-world-simulation-plan.md](./open-world-simulation-plan.md):37-40 | This is a direct contradiction between the intended architecture and the current hot path. | Actual latency numbers would strengthen the case further. |
| [Verified] Turn streaming is not meaningfully incremental. | [src/app/api/turns/route.ts](../src/app/api/turns/route.ts):26-70; [src/components/adventure-app.tsx](../src/components/adventure-app.tsx):261-289 | Confirms that the user does not get the benefit the architecture implies. | None; this is visible in code. |
| [Verified] Background simulation runs after player effects, not interleaved with elapsed time. | [src/lib/game/engine.ts](../src/lib/game/engine.ts):1288-1304 | This is the main source of turn/simulation drift for long actions. | Whether players will notice depends on how often the model emits long non-travel actions. |
| [Verified] Simulation uses generic reactions and silent skips. | [src/lib/game/simulation.ts](../src/lib/game/simulation.ts):660-668, 716-727, 812-861; [src/lib/game/engine.ts](../src/lib/game/engine.ts):530-557, 1083-1223 | Confirms that the world can look systematic while behaving repetitively or invisibly failing. | Play traces would help quantify repetition frequency. |
| [Verified] Saved-campaign compatibility is explicitly deferred. | [docs/open-world-simulation-plan.md](./open-world-simulation-plan.md):39-42, 111-118; [docs/implementation-temp.md](./implementation-temp.md):54-60, 147-154; [package.json](../package.json):9-13 | This shows the repo already knows the compatibility risk and has not solved it. | If the product truly stays single-user/local/disposable, this matters less; if persistence is a feature, it matters a lot. |
| [Verified] Tests do not cover the highest-risk paths. | [package.json](../package.json):5-17; [src/lib/game/validation.test.ts](../src/lib/game/validation.test.ts); [src/lib/game/provider-turn-parsing.test.ts](../src/lib/game/provider-turn-parsing.test.ts); [src/lib/game/world-validation.test.ts](../src/lib/game/world-validation.test.ts); [src/lib/game/world-instancing.test.ts](../src/lib/game/world-instancing.test.ts); [src/lib/game/characters.test.ts](../src/lib/game/characters.test.ts); [src/lib/game/session-zero.test.ts](../src/lib/game/session-zero.test.ts); [src/lib/game/engine.test.ts](../src/lib/game/engine.test.ts); [docs/implementation-temp.md](./implementation-temp.md):123-145; local run `npm test` (38 passing) | The checked-in safety net is concentrated on schema validation, parsing, and a few helper functions. `engine.test.ts` only covers temporary-actor naming helpers, while there is still no direct coverage for `commitResolvedTurn`, concurrent turn submission, rollback after simulation, fetch-triggered hydration, API routes, or streaming behavior. | A hidden CI suite outside the repo could reduce this concern, but none is present here. |
| [Strong inference] The repo is more optimized for world richness than repeatably satisfying play. | [src/lib/ai/provider.ts](../src/lib/ai/provider.ts):2730-4440; [src/components/adventure-app.tsx](../src/components/adventure-app.tsx):423-620 | The generation pipeline is one of the largest surfaces in the repo; the live play surface is comparatively thin and opaque. | Actual retention/playtest data would confirm how much this hurts. |
| [Strong inference] The world may remain coherent while becoming boring, repetitive, or strategically empty. | [src/lib/game/world-validation.ts](../src/lib/game/world-validation.ts):420-707; [src/lib/game/simulation.ts](../src/lib/game/simulation.ts):812-861 | Validation is largely structural; simulation reactions are partially generic. That is a classic recipe for "valid but dull." | Needs real campaign transcripts to measure boredom rather than mere coherence. |

# 9. Recommended Changes by Leverage
## Highest leverage / do first
- Enforce server-side turn serialization and campaign/session consistency.
  Failure modes addressed: 1, 5, 7, 10.
  Type: reliability / architectural.
  Why it reduces real risk: this closes the most concrete corruption path. Add a composite invariant tying session to campaign, a turn idempotency key, and a compare-and-swap or lock on campaign state before commit.
- Move consequential mechanics out of model payloads.
  Failure modes addressed: 2, 5, 8.
  Type: architectural / product.
  Why it reduces real risk: the model should propose intent and narration, not approval deltas, discovery sets, freeform DCs, or elapsed time. Engine-owned rules are the fastest path to reducing arbitrariness.
- Make fetch tools actually read-only.
  Failure modes addressed: 6, 7.
  Type: architectural / reliability.
  Why it reduces real risk: separating hydration from fetches restores clean reasoning about retries, clarifications, and rollback.
- Replace string-only memory with structured event memory.
  Failure modes addressed: 3, 8.
  Type: product / architectural.
  Why it reduces real risk: add entity refs, event type, location, faction, and optional human summary. This directly improves continuity instead of polishing prose around broken retrieval.
- Stop loading full snapshots on the hot turn path, and make streaming real end to end.
  Failure modes addressed: 4, 9.
  Type: reliability / UX.
  Why it reduces real risk: this attacks the highest-probability retention killer: sluggish turns with fake incremental feedback.

## Medium leverage
- Add transaction/integration tests for concurrent turn submission, rollback after multi-step simulation, fetch-triggered hydration, and long-duration actions.
  Failure modes addressed: 1, 5, 6, 7, 10.
  Type: reliability.
  Why it reduces real risk: these are the real breakpoints, and they are currently under-tested despite being explicitly named in docs.
- Make simulation reactions less generic and more inspectable.
  Failure modes addressed: 5, 8, 9.
  Type: product / UX.
  Why it reduces real risk: if the world is going to simulate off-screen, players need to see why. Surface source event, affected factions, and replaced moves.
- Add explicit save compatibility/versioning before calling campaigns "persistent."
  Failure modes addressed: 10.
  Type: architectural / product.
  Why it reduces real risk: if persistence is real, versioning is not optional. If persistence is not real, the product should say so clearly and reset aggressively.
- Tighten the UI around priority and causality instead of just surfacing more state.
  Failure modes addressed: 8, 9.
  Type: UX / product.
  Why it reduces real risk: surfacing everything is not enough. The player needs "what changed," "why," and "what matters next."

## Nice to have
- Persist world-generation progress outside `globalThis`.
  Failure modes addressed: setup trust / operational polish.
  Type: reliability.
  Why it reduces real risk: it removes a fragile demo-only layer from campaign creation.
- Clean up dead pending-turn architecture and unused fields/routes.
  Failure modes addressed: maintenance drag and false affordances.
  Type: architectural.
  Why it reduces real risk: it reduces the chance that future changes accidentally rely on abandoned semantics like `pendingTurnId`.
- Add real observability per campaign and per turn.
  Failure modes addressed: 1, 5, 7, 8.
  Type: observability.
  Why it reduces real risk: console warnings and local debug logs are not enough to diagnose live campaign weirdness.

# 10. What I Would Inspect Next
- Real turn latency on a seeded large campaign: `getCampaignSnapshot`, `getPromptContext`, model call time, commit time, and end-to-end user-visible wait.
- Whether production ever allows more than one session per campaign. The current model allows it, but the UI and turn path behave as if there is effectively one active session.
- A corpus of actual stored `MemoryEntry.summary` values to confirm how often relationship retrieval is already failing in practice.
- A diff of DB state before and after `fetch_npc_detail` on a promoted local to quantify the exact write surface of a nominal fetch.
- Transaction behavior under concurrent `/api/turns` POSTs from two tabs against the same campaign.
- Long-run simulation transcripts over 50-100 turns to see whether faction reactions collapse into the same generic move patterns.
- Whether any hidden CI, staging scripts, or external harnesses cover engine transaction/rollback behavior beyond the checked-in test suite.
- Build-time and runtime behavior after a schema change with an existing campaign database, since the repo uses `prisma db push` and no migration history.

## Appendix: One End-to-End Failure Story
The player has a 20-turn campaign open in two tabs. In Tab A, they ask a recurring unnamed dock worker about missing cargo. That local has been promoted to a `promoted_local`, so the model is forced to fetch NPC detail before acting. The fetch triggers promoted-NPC hydration, which silently updates the NPC and creates new information records before the turn has committed ([src/lib/game/engine.ts](../src/lib/game/engine.ts):266-507, 1399-1462).

At the same time, Tab B still has an older snapshot with the same `campaignId` and `sessionId`. The player submits "wait until sunset" there. There is no server-side turn lock or campaign version check, so both turn submissions proceed from stale snapshots ([src/lib/game/engine.ts](../src/lib/game/engine.ts):1518-1577). The server buffers narration instead of streaming it, and the client ignores narration events anyway, so the player just sees two long "Resolving..." spinners ([src/app/api/turns/route.ts](../src/app/api/turns/route.ts):26-70, [src/components/adventure-app.tsx](../src/components/adventure-app.tsx):261-289).

One turn commits a conversation with an NPC whose detail fetch already mutated the world. The other turn commits a time skip from an older snapshot. Because action effects apply before temporal simulation, each turn resolves against stale start-of-turn assumptions, then advances time afterward ([src/lib/game/engine.ts](../src/lib/game/engine.ts):1288-1304). The session turn count increments twice. The player reloads and sees the world in a surprising later state, with messages that do not cleanly explain why some facts changed.

They ask for relationship history with that NPC. The repo tries to find memories where `summary contains npcId`, but the stored memory summary was just normal prose, so the history is sparse or empty ([src/lib/game/engine.ts](../src/lib/game/engine.ts):1371-1379, [src/lib/game/repository.ts](../src/lib/game/repository.ts):1487-1500). The player concludes the game is making things up, even though most individual subsystems are "working as designed."

If I had to bet on one failure path, it would be trust collapse from arbitrary-feeling play amplified by weak state boundaries, because the repo gives the model too much consequential authority while also under-protecting persistence and turn serialization.

If I had to make only three changes, they would be: 1. enforce server-side turn/session/campaign invariants and idempotency, 2. take approval/discovery/freeform difficulty/time ownership away from the model, 3. replace free-text memory with structured memory tied to entities and events.
