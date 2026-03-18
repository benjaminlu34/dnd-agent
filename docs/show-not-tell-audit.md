# Show-Not-Tell Audit

## Rubric
Player-visible content passes this audit only if it meets all of the following:

- Knowledge boundary: the player can only see content that was narrated in-fiction, explicitly discovered, or is required to operate the UI.
- Show over tell: prefer concrete scene detail, dialogue, physical evidence, and discovered artifacts over summaries, labels, or explanations.
- No backstage leakage: hidden arcs, villain motives, reveal structure, secret roles, dossier notes, seeded personal hooks, and unrevealed clues must not appear in player-facing payloads or UI.
- Agency discipline: player-facing setup can invite action, but it must not preload consequences or present DM-side branching logic as summary copy.
- Recap discipline: `Previously on`, journal summaries, and memory entries must restate established fiction only.

## DM Narration Rubric
Turn-by-turn DM prose should also meet these narration-specific rules:

- No player interiority: do not tell the player what they feel, believe, realize, or intend unless they explicitly said it.
- Physical sensation is allowed: lines like "you feel the cold through your coat" are acceptable because they describe concrete sensory contact, not psychology.
- No opening recap blocks: openings should begin in immediate external scene pressure, not backstory summary or thematic framing.
- No MacGuffin fixation: do not keep reintroducing the key item unless the current beat directly handles, threatens, or reveals it.
- No editorial closers: end on a concrete image, threat, dialogue beat, or new opening, not a thematic slogan.
- Resolve declared actions cleanly: if the player commits to an action, either resolve it or request a check instead of turning it back into suspense setup.

## DM Narration Examples
- Fail, player interiority: "You feel confident knowing you've handled worse."
- Pass, physical sensation: "You feel the cold through your coat when the harbor wind cuts across the roofline."
- Fail, opening recap: "You've been running for three days now, ever since the ledger changed everything."
- Pass, immediate opening: "A customs whistle cuts across the quay just as two enforcers shoulder through the fog toward your bridge."
- Fail, editorial closer: "The night is always watching."
- Pass, concrete closer: "Below you, one of the enforcers stops at the blood on the tiles and calls for backup."
- Fail, action deferral: "You shadow the guard and wait for the perfect moment."
- Pass, action resolution: "You shadow the guard through the blind corner, catch his collar, and drive him into the stacked crates before he can shout."

## Surface Inventory
| Surface | Audience | Upstream source | Audit expectation |
| --- | --- | --- | --- |
| Session Zero pitch | Player | `publicSynopsis` | High-level premise, setting, tone, opening overview only |
| Session Zero advanced panel | DM/player opt-in | `secretEngine` | Spoilers allowed because the panel is explicitly advanced |
| Campaign snapshot API | Player/browser | repository aggregate | Must be sanitized before leaving the server |
| Play screen main feed | Player | assistant narration + user actions | Pure in-fiction delivery |
| Play screen sidebar | Player | scene state | Scene texture only, no hidden threat/arc metadata |
| `People` tab | Player | visible NPC records | Only encountered people, no dossier notes/hooks by default |
| `Quests` tab | Player | visible quest records | Only surfaced objectives, no backstage summaries by default |
| `Clues` tab | Player | discovered clues | Only discovered clues |
| Session summaries / `Previously on` | Player | recap generation | Only established fiction, no inferred secrets |
| Turn prompt context | Internal model | authoritative snapshot | Can contain hidden state, but instructions must prevent premature exposure |

## Findings
### P0
- Resolved: player API responses exposed raw `CampaignSnapshot` data, including hidden blueprint content, arcs, NPC dossiers, hidden clues, and internal state fields.
- Resolved: `Previously on` was built from all unresolved clues, which included hidden clues as well as discovered ones.
- Resolved: the play UI rendered seeded NPC roles, notes, and personal hooks as soon as the tab was opened.
- Resolved: Session Zero public preview previously displayed actionable opening-scene setup instead of a pitch-safe overview.

### P1
- Mitigated: recap generation prompts were too permissive and could drift into inferred motives or backstage structure.
- Mitigated: DM narration prompts did not explicitly forbid hidden quest scaffolding or dossier-style introductions.
- Mitigated: prompt context could treat the companion as known before the fiction introduced them.
- Open: visible quest handling is still title-driven rather than backed by explicit discovery state, so quest surfacing remains conservative and somewhat brittle.

### P2
- Open: player journal content is still summary-shaped rather than fully diegetic.
- Open: scene summaries in state are useful but can still read as recap text instead of pure present-tense scene texture.

## Remediation Map
### Generation contract
- Keep `publicSynopsis` player-safe and `secretEngine` DM-only.
- Continue tightening prompt language around non-actionable previews and show-don't-tell introductions.

### Snapshot filtering
- Keep raw campaign snapshots server-internal.
- Maintain a separate player-safe snapshot serializer for API responses.
- Treat API payloads as player-visible surfaces, not implementation detail.

### Prompt-context filtering
- Prevent unseen companions from appearing in prompt context as established participants.
- Continue reviewing which hidden structures are necessary for orchestration versus likely to leak into narration.
- Sanitize legacy `sceneState.summary` before using it in turn prompts or opening generation; prompt context should consume factual tactical snapshots, not stored purple prose.
- `OPENROUTER_COMPRESSION_MODEL` is recommended for this sanitization path. If it is unset, compression falls back to `OPENROUTER_MODEL`, which is simpler operationally but can add noticeable latency when loading or resuming older campaigns.

### Recap and journal policy
- Summaries and recaps must only use established facts.
- Discovered-clue references are allowed in recaps; hidden clue references are not.

### Play UI rendering
- `People` and `Quests` should default to thin, discovery-safe renderers.
- Rich dossier-style entries should only appear once an explicit discovery/logging system exists.

## Implemented Fixes In This Pass
- Added a player-safe snapshot contract and serializer for campaign and turn APIs.
- Removed hidden-state data from browser payloads by default.
- Suppressed opening-turn suggested actions in player payloads so DM-seeded action hints do not leak unrevealed scene details at campaign start.
- Restricted `People`, `Quests`, and `Clues` to sanitized server-provided records.
- Removed sidebar threat leakage and kept the player journal focused on scene-visible state.
- Hardened recap prompts and `Previously on` clue selection.
- Prevented unseen companions from being assumed present in prompt context.
- Replaced raw recent narration in turn prompts with a mechanical turn ledger and added runtime scene-summary sanitization for poisoned legacy saves.

## Recommended Next Step
Implement explicit discovery state for NPCs and quests. The current payload sanitization is safe, but a first-class discovery model would let the engine decide what becomes journaled, named, and summarized without relying on conservative filters.
