# Personal work memory — Task 2

Persist commitments and linked blockers, resolve blockers from evidence, and explicitly complete/correct tasks or undo the last completion/correction. Provides CopilotKit Channels tools; the root Slack app is not automatically rewired.

## Manual Slack test

Stop any existing runtime using this Channel first (Ctrl+C in its terminal). From the repo root:

```bash
node --env-file=.env --import tsx apps/channel/src/intern/memory/slack-test.ts
```

This separate launcher uses the saved model, CHANNEL_CODE and CPK_INTELLIGENCE_API_KEY (legacy name supported). It listens on MEMORY_TEST_PORT or 3001. It leaves channel.tsx unchanged and stores test records under .data/memory-slack-test.json.

Open a one-to-one DM with the bot. Send each message after the bot replies:

1. “I'll send the Acme proposal Friday.”
2. “The Acme proposal is waiting for pricing approval.”
3. “Pricing for the Acme proposal was approved.”
4. “What's still outstanding?”

Expected: proposal remains open; approval blocker is resolved. This launcher tests only the current DM plus already saved evidence, not periodic tracking across selected work threads. Provider metadata must identify a one-to-one Slack DM; unrecognized/private-group/shared-channel metadata fails closed. Source links open the DM rather than an exact message. When provider timestamps are absent, inbound evidence uses receipt time. Actual model interpretation and Slack delivery must be verified by this manual sequence.

### Isolated paired test bot

For our `intern-memory-test` app, `.env.memory-test` holds its project key and channel code. The following explicitly overrides inherited shell variables without changing the team's `.env`:

```bash
node --env-file=.env --import tsx --input-type=module -e 'import {readFileSync} from "node:fs";import {parseEnv} from "node:util";Object.assign(process.env,parseEnv(readFileSync(".env.memory-test","utf8")));if(process.env.CHANNEL_CODE!=="intern-memory-test")throw new Error("Wrong test channel");await import("./apps/channel/src/intern/memory/slack-test.ts")'
```

The live managed gateway omitted workspace/DM metadata. The local-only workaround pins verified Slack users and opaque conversations to their workspaces and DMs in ignored `.data/memory-test-pairing.json`. The file accepts an array of pairings; the original single-object format remains supported. The allowlist applies only to `intern-memory-test`; all unlisted users/conversations are rejected while configured. Use the same message surface as the successful pairing message: **our current pairing is the main DM composer (bottom-left), not nested reply threads on the right**. A probe only creates a candidate, never grants access: an operator must verify the actual Slack DM and user before approving its mapping locally. Do not commit pairing, credential, or memory files. This is not production DM authorization.

### Multiple teammates on one test bot

Run **one** instance of the launcher above on one person's computer. Everyone messages that same bot in their own one-to-one DM. Keep that computer running; teammates do not start another backend with the same `CHANNEL_CODE`. Memory uses workspace ID plus user ID, and concurrent writes serialize in this single process. Each person sees only their own saved work.

To enroll a teammate when gateway identity metadata is missing:

1. Set `MEMORY_PAIRING_PROBE` to a chosen discovery phrase in `.env.memory-test`, then restart the single backend with the command above.
2. Have the teammate send that exact phrase in the bot's main DM composer. The runtime saves their actor and conversation IDs to `.data/memory-test-candidates/<hash>.json`. Existing pairings keep working; retries do not overwrite another candidate. A candidate does not authorize access.
3. The operator verifies the sender and one-to-one DM in Slack, including the workspace `T…`, user `U…`, and DM `D…` IDs. Keep the opaque `conversationId` from that person's candidate. Never infer these mappings from the phrase alone or approve a shared/group conversation.
4. Change `.data/memory-test-pairing.json` to an array, preserving the existing entry and appending the verified teammate. For example, with fictional IDs:

   ```json
   [
     { "channelCode": "intern-memory-test", "workspaceId": "T123", "userId": "U123", "channelId": "D123", "conversationId": "verified-conversation-one" },
     { "channelCode": "intern-memory-test", "workspaceId": "T123", "userId": "U456", "channelId": "D456", "conversationId": "verified-conversation-two" }
   ]
   ```

5. Restart the backend to load the updated list. Remove `MEMORY_PAIRING_PROBE` when enrollment is finished. Removing a pairing and restarting revokes access without deleting that person's memory. An empty array denies everyone; deleting the file reverts to provider-verified DM identity only.

Duplicate conversation mappings, conflicting DM owners, and malformed entries fail closed. This remains a local team-test setup: A still owns production identity, selected-thread permissions, and integration into the main `channel.tsx` runtime.

For the live two-person check, each person records a differently named task, asks what is outstanding, then completes their own task. Confirm neither sees or changes the other's work, including after a backend restart. Automated tests cover identity mismatch rejection, simultaneous candidate capture, and concurrent memory isolation across users/workspaces; they do not replace this live check.

After recording a task, try these in the paired conversation, waiting for each reply:

1. “Change the Acme proposal deadline to September 18, 2026.”
2. “I sent the Acme proposal; mark it done.”
3. “Undo that completion.”
4. “What tasks am I tracking?”

Expected: the same task ID remains; it returns to open with its corrected deadline. Undo is limited to the latest eligible explicit completion/correction, not task creation, blocker resolution, or already delivered messages.

Live check, September 12, 2026: the isolated bot recorded the fictional “Send the memory demo note” task for September 18, corrected its deadline to September 21, completed it, and undid completion. Slack confirmed each step; persisted state retained one task ID, open status, the September 21 deadline, and commitment/correct/complete/undo notices. The labeled demo task remains in local test memory. This verifies that sequence, not general extraction accuracy or production channel authorization.

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

For `complete`, `correct`, and `undo`, the trusted resolver must additionally return `currentSource: {threadId, messageId}` for the current owner-authored inbound message. Every supplied mutation evidence reference must be owner-authored and include that source. Do not populate it from model arguments or an arbitrary older message. These mutations fail closed if omitted; existing ingestion callers remain compatible. Read `view.mutations` to select the exact latest non-undone change ID for undo. Persisted mutation evidence and notices survive restart; an undo queues a compensating notice.

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

`evidence-boundaries.test.tsx` adds transport identity, atomic rejection, and clarification replay checks. `evidence-fixtures.ts` contains labeled semantic cases for future model evaluation; those labels are not executed accuracy tests. Lifecycle tests cover trusted current-source authorization, completion/correction/undo, retries, owner isolation, stale undo, and legacy file compatibility.

## Deliberate limits of this slice

Task matching safeguards: with multiple tasks, completion/correction must identify the target in the current message by exact ID, uniquely matching full title, or a distinguishing title word. Vague or conflicting selection is rejected before writing; the bot should show task choices and ask for a fresh, specific request. This conservative lexical check is not a semantic intent classifier and may ask for an ID even when a human would understand the reference.

New commitments, renames and undo cannot collide with another owned task's normalized title (case, whitespace, punctuation and Unicode compatibility normalized). A collision asks for clarification rather than merging dates or creating another record. Completed tasks also count: recurring/separate work needs a genuinely distinct name supplied by the user. Same-source retries still deduplicate. Paraphrased titles and semantic duplicates are **not** fully detected, and existing duplicate records are not automatically merged. These guards have offline regression coverage; the earlier live lifecycle demo predates them.

- Local JSON with atomic replacement and file sync; one process only. Calls to the same absolute path serialize within that process. Use one canonical path, not symlink aliases. No multi-process database guarantees or encrypted storage.
- Model interprets intent and semantic relationships; code verifies schema, source identity, quote presence, task ownership, and evidence chronology. A valid quote is not proof that the model understood it correctly. Ambiguous interpretation should be recorded as a clarification; live labeled evaluation is still required.
- One observation of a given kind per evidence set/target. Multiple commitments within one message, alternative evidence subsets, source edits/retractions, and semantic duplicate merging need the next ingestion iteration.
- Existing records are not automatically updated from edited source text. This first slice is append-only except blocker resolution and notice acknowledgments.
- Answering/dismissing clarification questions, profile/goals, priority scoring, and refresh freshness remain future Task 2 work. Date-only deadlines are preserved rather than assigned an invented time.
- No schema migration or cross-process locking yet. Invalid stored data fails visibly rather than being replaced with empty state.
- CopilotKit's optional hosted Memory is not enabled; these tools use the explicit local work-state store.

Keep the data file under ignored .data/. Integrators own permission checks, source freshness, private rendering, scheduling, and notice delivery.
