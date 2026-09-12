# Personal work memory — Task 2

First slice: persist a personal commitment → link an unresolved blocker → resolve the blocker from later evidence, leaving the commitment open. Provides CopilotKit Channels tools; the root Slack app is not automatically rewired.

## Use from the Slack integration

```ts
import { PersonalMemory } from './intern/memory/store';
import { createMemoryTools, PERSONAL_MEMORY_INSTRUCTIONS } from './intern/memory/tools';

const memory = new PersonalMemory('.data/personal-memory.json');
const { tools } = createMemoryTools(memory, resolveAuthorizedPrivateScope);
// Add tools to createChannel({ tools }) or thread.runAgent({ tools }).
// Add PERSONAL_MEMORY_INSTRUCTIONS to the personal agent's prompt/context.
// Use the inherited fresh-run agent adapter, maxSteps > 1, workplace:false.
```

`resolveAuthorizedPrivateScope(ctx)` is implemented by Person 1. It must verify the authenticated workspace/user, ensure a private destination, and return `{ owner: { workspaceId, userId }, sources }` from selected threads only. Tool arguments never supply the owner or raw source messages. The tool also checks the Slack actor matches the resolved owner. The scope resolver is required: these tools must not expose personal data in shared channels.

Use `SourceMessage` and `Observation` from model.ts as the small module-local contract. No shared root interfaces or teammate files were changed.

## Briefing integration

`await memory.view(owner)` returns commitments, blockers, clarification questions, and unacknowledged changes. Each item includes original evidence/URLs; resolved blockers also include resolution evidence. The model/tool return says whether a mutation actually changed state.

After the briefing worker durably accepts change IDs into its outbox, call `memory.acknowledge(owner, ids)`. Repeated ingestion does not requeue acknowledged changes. This module does not deliver notifications or run timers.

Resolving a blocker leaves its linked commitment open. For an unresolved list, filter `view.blockers` by `status === 'open'`; resolved blockers retain their history so the briefing worker can explain changes.

## Verify

```bash
node --import tsx --test apps/channel/src/intern/memory/*.test.tsx
npm run verify
```

Tests use fictional source messages and real disk persistence/tool handlers. A scripted AG-UI agent also exercises the real Channels run/tool loop through the inherited managed-gateway fixture, including private-scope denial. Coverage includes the complete three-step memory interaction, restart, duplicate/reordered evidence, replayed resolutions, ownership, and invalid evidence. These tests do not prove live model extraction accuracy, the eventual Slack scope resolver's authorization, or live Slack delivery.

## Deliberate limits of this slice

- Local JSON with atomic replacement and file sync; one process only. Calls to the same absolute path serialize within that process. Use one canonical path, not symlink aliases. No multi-process database guarantees or encrypted storage.
- Model interprets intent and semantic relationships; code verifies schema, source identity, quote presence, task ownership, and evidence chronology. A valid quote is not proof that the model understood it correctly. Ambiguous interpretation should be recorded as a clarification; live labeled evaluation is still required.
- One observation of a given kind per evidence set/target. Multiple commitments within one message, alternative evidence subsets, source edits/retractions, and semantic duplicate merging need the next ingestion iteration.
- Existing records are not automatically updated from edited source text. This first slice is append-only except blocker resolution and notice acknowledgments.
- Manual task completion, undo, answering/dismissing clarification questions, profile/goals, priority scoring, refresh freshness, and correction commands remain future Task 2 work. Date-only deadlines are preserved rather than assigned an invented time.
- No schema migration or cross-process locking yet. Invalid stored data fails visibly rather than being replaced with empty state.
- CopilotKit's optional hosted Memory is not enabled; these tools use the explicit local work-state store.

Keep the data file under ignored .data/. Integrators own permission checks, source freshness, private rendering, scheduling, and notice delivery.
