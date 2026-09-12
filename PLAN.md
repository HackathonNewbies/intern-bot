# Intern Bot — product and team plan

## Product

Keep an individual informed about their commitments, deadlines, dependencies, and unresolved discussions across selected Slack threads. Connect related evidence across threads and link back to messages. Say “no resolution found” when the evidence is incomplete.

- Private onboarding: role, up to three goals, selected threads.
- Automatically track explicit personal commitments and notify the user; clarify ambiguity.
- Morning and on-demand briefings: coming up, waiting/unresolved, priorities, backlog, changes, and freshness.
- Proposed Singapore weekday defaults: 08:30 briefing; checks at 09:00, 13:00, 17:00.
- Update from explicit completion/resolution messages; allow corrections, completion, and undo.
- Keep the user informed; do not chase colleagues or plan their day automatically.
- Calendar blocks only when requested and approved. Provider undecided.
- No email, transcription, team assignment, Exa research, or Ambiguous integration in this scope.

## Three-person split

| Person | Owns | Independent first result |
|---|---|---|
| A: Slack | Selected-thread access, private onboarding/cards, action routing, app wiring | Fixture briefing rendered privately |
| B: Work memory | Extraction, commitments, unresolved dependencies, cross-thread evidence, persistence, corrections | Two-thread fixture produces accurate work state |
| C: Briefings and follow-up | Summary content, change notices, periodic jobs, supporting calendar | Fixture state becomes a briefing and resolution update |

Use separate branches and owned modules under apps/channel/src/intern/ when implementation starts. A coordinates shared interfaces, entry points, and dependency edits. Each person writes adjacent tests and uses mock interfaces for the other modules.

## Build order

1. Agree on small shared interfaces and a two-thread fixture. Separate commitments from unresolved items; retain evidence, deadline precision, owner identity, and source freshness.
2. A verifies background reads/private delivery and builds UI; B builds evidence-backed state; C builds briefings with a fake clock.
3. Integrate selected threads → work state → private briefing early.
4. Add later resolution → updated dependency → private follow-up, without completing the dependent task.
5. Verify periodic/on-demand overlap, no duplicate notices, failed reads, persistence, corrections, and undo.
6. Add request → calendar proposal → approval → verified event; decline creates nothing.
7. Run npm run typecheck and npm run verify, demonstrate live behavior, and record submission evidence.

## Core demo

In one thread, Alex commits to a Friday proposal. Another says the same proposal's pricing needs approval. The briefing highlights that dependency with both sources. Later approval resolves the dependency and triggers a private update; the proposal stays open.

Include another person's unrelated task and undated backlog. Ambiguous links require clarification rather than guesswork.

## Open decisions and constraints

- Installed Channels types state proactive subscribed delivery is not wired. Verify a supported background access/delivery path before claiming morning DMs work.
- Calendar provider/account remains undecided.
- Track unresolved items connected to the user's commitments; standalone unanswered requests remain undecided.
- Preserve the pinned Channels/runtime pair, shared client override, and inherited run adapter.
- Offline tests and accelerated clock demos are not live integration evidence.
- This is a provisional product plan, not authorization to implement or publish.
