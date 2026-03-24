Executive Premortem

Six months from now, this project fails because it built a rich world simulation around an untrusted core interaction loop.

The system can generate impressive worlds and produce coherent prose, but sustained play degrades into four user-visible failures:

arbitrary outcomes because the model still controls too many consequential mechanics,
slow turns because the hot path loads too much state and leans on retries and generation work at the wrong times,
weak continuity because long-term memory and entity history are structurally under-modeled,
state trust erosion because turn processing, streaming, fetches, simulation, and persistence do not have strong enough invariants.

The project overestimates the value of:

schema-valid AI output,
world richness,
rollback,
and broad simulation depth,

and underestimates the value of:

deterministic authority,
explicit state contracts,
player-legible causality,
and operational measurement.

If this fails, it will not be because “the AI was flaky.” It will be because the repo allowed too much ambiguity about who decides what is true, when world changes become authoritative, and how the player is supposed to understand why anything happened.

The real failure hierarchy
Tier 1: Trust collapse

These are the highest-risk failures because they directly destroy the player’s belief that the game is fair and coherent.

Model-owned mechanics
The model is not just narrating. It is still selecting or heavily influencing approval shifts, discovery outcomes, timing, and freeform check structure. That means fairness is partly a model behavior problem rather than a rules problem.
Weak turn/session/campaign invariants
The turn path appears underprotected against duplicate submission, stale session state, and weak campaign/session consistency. Once players see doubled turns, unexpected time jumps, or mismatched state, trust is hard to recover.
Read paths with hidden writes
If nominal fetches can hydrate or mutate persistent world state, then retries, clarifications, and inspection all become dangerous. This is both a debugging problem and a player-trust problem.
Rollback that looks stronger than it is
Undo/rollback helps psychologically, but if coverage is partial, version-fragile, or latest-turn-only, it becomes a false promise.
Tier 2: Core loop dissatisfaction

These are the failures that kill retention even if corruption never occurs.

World richness over player legibility
The system appears to track much more than the player can actually understand. That creates hidden-rule gameplay: the world “knows” why something happened, but the player does not.
Weak continuity memory
Free-text summaries and short recent-message windows are not enough for persistent relationships, recurring motives, unresolved promises, and campaign-level arcs. The prose may stay locally coherent while the campaign becomes emotionally forgetful.
Simulation drift versus turn resolution
If long actions resolve against stale assumptions and only then advance the world, users will experience time as fake. They will not necessarily phrase it that way, but they will feel it.
Fake flexibility
“You can do anything” is not the same as “the game supports strong agency.” If the player cannot infer consistent rules from repeated play, freeform input becomes ambiguity tax.
Tier 3: Scale and operations failure

These make the above worse and harder to diagnose.

Hot-path snapshot bloat and latency cliffs
Full or near-full campaign loading on the turn path, plus AI retries, plus schedule/worldgen-style work, can make each turn feel heavier over time. This is real and should be measured aggressively.
JSON-heavy persistent state with weak versioning
Once players invest in campaigns, informal compatibility is no longer acceptable. Runtime JSON, rollback payloads, and semi-structured simulation state become save-compatibility liabilities unless versioned and migrated explicitly.
Insufficient observability
Without timing breakdowns, retry metrics, turn conflict metrics, memory quality checks, and campaign-health diagnostics, the team will argue from vibes while the real problems stay hidden.
False assumptions to correct now
1. “If the AI output validates, the turn is probably good.”

Wrong. Validation catches malformed structure and some local invariants. It does not guarantee fairness, strategic meaning, pacing, or satisfying consequence.

2. “The engine owns mechanics.”

Only partially true. If the model selects meaningful mechanical inputs, the engine is still downstream of model judgment.

3. “More world state means more perceived depth.”

Wrong. Most hidden state becomes backstage DM logic unless surfaced as legible pressure, consequence, or choice.

4. “Rollback means we can move faster.”

Wrong unless coverage is exhaustive and versioned. Otherwise rollback becomes an attractive lie.

5. “Thin context has been solved.”

Probably false unless the hot path truly stopped loading broad campaign state and unless long-arc memory is structured, not just recent-text based.

6. “Latency is a polish issue.”

Wrong. In this kind of game, latency is part of the design. Slow turns make consequences feel less crisp and less trustworthy.

7. “Persistence/versioning can wait.”

Wrong if long-running campaigns are part of the product promise.

What users would actually hate
“I never know what matters.”
“The world forgets things it previously told me.”
“The game decides outcomes randomly.”
“Turns take too long.”
“I can type anything, but I still don’t know what the rules are.”
“Sometimes just inspecting things seems to change the world.”
“Undo works until it really matters.”
“The world is detailed, but not actually readable.”
“Resting or waiting makes the world jump in weird ways.”
“The story sounds good sentence to sentence, but the campaign doesn’t hold together.”
The corrected strategy
A. Reassign authority

This is the highest-leverage change.

The model should primarily own:

phrasing,
local flavor,
dialogue texture,
ambiguity interpretation,
optional narrative framing.

The engine should own:

time advancement,
approval/relationship deltas,
discovery unlock rules,
difficulty and consequence determination,
persistent entity lifecycle,
state transitions.

That does not mean removing AI. It means removing AI from the role of hidden rules arbiter.

B. Make state contracts explicit and enforceable

You need hard invariants for:

turn serialization,
idempotency,
session-to-campaign consistency,
read-versus-write boundaries,
versioned persistent payloads,
save compatibility,
rollback scope.

This is not a refactor for cleanliness. It is how you stop weirdness from becoming canon.

C. Redesign the player-facing loop around causality

Every turn result should clearly answer:

what happened,
why it happened,
what changed,
what matters now,
what you can do next.

That means more than improved prose. It means exposing the game’s logic in digestible form.

D. Reduce hot-path cost before chasing more richness

Turn resolution should not depend on loading or recomputing broad campaign state when only a small subset is needed. Separate:

authoritative play state,
deferred lore/state panels,
background generation/simulation work,
admin/debug state.

Also make streaming real, not nominal.

E. Replace text-only memory with structured campaign memory

Persist long-arc facts as linked records:

entities involved,
event type,
relationship impact,
unresolved thread,
location,
time,
optional human summary.

Then feed those forward deliberately. Do not rely on vague prose retrieval to preserve continuity.

F. Instrument the failure modes that matter

Measure:

end-to-end turn latency,
snapshot load time,
model retry rate,
failed parse/repair rate,
clarification frequency,
duplicate/conflicting turn submissions,
memory retrieval quality,
undo usage and undo failure rate,
campaign load failures by version,
percentage of turns with meaningful state change,
drop-off by turn count.

Without this, you will optimize the wrong layer.

Priority order for actual work
Do first
Turn integrity
Add real server-side serialization, idempotency, and campaign/session invariants.
Authority shift
Move consequential mechanics and pacing decisions out of model payloads and into deterministic engine rules.
Read/write separation
Eliminate hidden writes from fetch-style tools and context assembly paths.
Structured memory
Replace free-text-only long-term memory with entity-linked event memory.
Latency instrumentation
Break down turn time by snapshot, context, AI, validation, commit, and stream delivery.
Do next
Hot-path snapshot slimming
Split play-critical state from optional world detail.
Version persistent JSON and rollback formats
Add explicit schema versions and migration paths.
Expose causality in the UI
Make “why” and “what changed” first-class.
Simulation sanity checks
Add post-tick consistency validation and campaign-health diagnostics.
Do after that
Improve simulation quality
Make off-screen world behavior more principled and less generic.
Improve real streaming
Send useful partial progress that the client actually renders.
Reduce worldgen centrality
Treat generation as bootstrap infrastructure, not the main product advantage.
What not to overinvest in yet

Do not spend the next months primarily on:

richer world generation,
more factions/NPC systems,
more sidebar information,
more AI output repair heuristics,
more undo UX,
more flavor polish.

Those are downstream improvements. They will not save a loop that feels arbitrary, slow, and forgetful.

Blunt final conclusion

If I had to bet on one failure path, it would be:

trust collapse caused by model-owned consequences running through weak state boundaries, amplified by rising latency and weak continuity.

That is more dangerous than any single performance issue and more central than any single simulation flaw.

If I had to make only three changes, they would be:

Enforce turn/session/campaign integrity with real serialization and idempotency.
Move consequential mechanics out of the model and into deterministic engine rules.
Replace text-only memory with structured long-arc campaign memory.

Those three changes do the most to protect fairness, continuity, and trust—the actual conditions for this project to survive.

If you want, I’ll turn this revised hybrid into a clean markdown document you can hand directly to the repo agent or your team.