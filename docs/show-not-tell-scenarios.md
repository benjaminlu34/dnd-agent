# Show-Not-Tell Scenario Matrix

## Baseline Scenarios
| Scenario | What to capture | Pass condition |
| --- | --- | --- |
| Fresh campaign, before first action | Session Zero preview, opening narration, campaign API payload, play screen tabs | Only opening fiction and player-safe pitch details are visible |
| First 1-3 turns, no clue discovery | Narration, suggested actions, `People`/`Quests`/`Clues`, turn payloads | No hidden dossiers, quest scaffolds, or unrevealed clue text appear |
| First 1-3 turns, committed action | Narration, suggested actions, turn payloads | Declared actions resolve or request checks; narration does not reset the scene into setup |
| First explicit NPC or clue discovery | Narration, updated payload, journal tabs | Only the discovered NPC/clue becomes visible |
| First quest-signaling moment | Narration, journal state, recap state | Quest entry appears only if the fiction has named or logged it |
| First reveal-eligible turn | Narration and recap outputs | Hidden reveal truth remains concealed until dramatically surfaced in fiction |
| Resume stale campaign | `Previously on`, journal, payload | Recap uses established facts only |
| Retry/cancel turn path | Before/after payloads and journal state | No hidden state becomes visible through rollback or retry plumbing |
| Session Zero regeneration | Public pitch vs advanced panel | Public preview stays high-level even after revisions |

## Player Knowledge Ledger Template
Use this ledger when auditing a scenario:

- What the player has directly seen in narration
- What the player has read in discovered clues or written documents
- Which names have been spoken or shown in play
- Which objectives have been explicitly named in play
- Which recap statements are grounded in prior messages
- Which UI controls are present only for usability, not lore delivery
- Whether the DM narrated any player psychology rather than external action or concrete sensation
- Whether the scene ended on a concrete pressure point instead of a thematic slogan

If a payload field or UI element falls outside that ledger, treat it as a likely violation.

## Baseline Walkthrough: Corrupt Merchant City / Slow Opening
### What the player should know at campaign start
- The city is corrupt and merchant-ruled.
- The opening takes place in a familiar tavern or neighborhood.
- Something small and strange is beginning to feel wrong.
- The player has not yet earned knowledge of villain identity, conspiracy structure, secret personal hooks, or hidden quest scaffolding.

### What must stay hidden
- Secret villain status or motive
- NPC dossier notes and personal threads
- Hidden clue text not yet discovered
- Arc titles and reveal structure
- DM-only starting hook phrasing unless it has entered the fiction

### Acceptance check
- The pitch reads like campaign copy, not DM setup.
- The opening feed reads like fiction, not a design summary.
- The journal tabs remain sparse until names, clues, or objectives are introduced in play.
