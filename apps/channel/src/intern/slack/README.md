# Task A — Slack integration

Implemented on `codex/task-a-slack-backup`. Managed Channels remains the ingress; personal tools run only in a verified one-to-one Slack DM. The incident agent is no longer wired into the app.

Both calendar tools are integrated into verified DM runs: explicit-time requests
use `propose_calendar_invite`, and requests to schedule when guests are free use
`propose_available_calendar_invite`. Both retain requester approval and the fixed
shared calendar. Availability setup and defaults are in
[the calendar guide](../../../../../dev-docs/google-calendar.md).

## Run and demo

From the repository root, configure `.env` as before and run `npm run dev:slack`. Do not run two listeners with the same CHANNEL_CODE. This branch's runtime uses `apps/channel` as its working directory; optional relative paths below are relative to that directory.

Open a one-to-one DM with the bot, then send:

1. `start` — private home card.
2. `profile Account lead | Send Acme proposal; Clear pricing blockers` — role and up to three goals.
3. `demo` — two-thread fictional briefing, with no writes to real work memory.
4. `track https://YOUR-WORKSPACE.slack.com/archives/CHANNEL/pTIMESTAMP` — select a real thread. Repeat for the pricing thread.
5. `brief` — refresh selected evidence, run Task B extraction, and render the current work with source links and freshness.
6. Add a pricing approval in the selected pricing thread, then `refresh`. The blocker resolves while the proposal stays open.
7. `threads` or `untrack <thread URL>` — manage selected sources.
8. `schedule on` / `schedule off` — opt in/out of weekday Singapore DMs. Morning briefing: 08:30. Change checks: 09:00, 13:00, 17:00.

Native buttons and private inputs provide the same controls. If an old card's bindings expired after restart, send `start` for a fresh card. Ordinary DM questions use the existing fresh-inner-run agent adapter plus a private request boundary that excludes prior-turn source-bearing history. The user should name ambiguous work again; current work is read from the authorized memory tools.

## Slack access configuration

Optional root `.env` settings:

```dotenv
INTERN_SLACK_USER_TOKEN=  # owner-bound user OAuth token, never a bot token
INTERN_SLACK_BOT_TOKEN=   # same-workspace bot OAuth token for scheduled DMs
# INTERN_DATA_DIR=../../.data/intern
# INTERN_VERIFIED_DM_BINDINGS=../../.data/intern-dm-bindings.json
```

The user token must belong to the person requesting the briefing. This is a single-connected-owner implementation; do not share an administrator's user token across users. Other users can configure their profile or view the fictional demo, but cannot read that owner's threads. Production multi-user OAuth credential storage is a separate deployment concern.

User token scopes: `channels:history`, `groups:history`, `channels:read`, `groups:read` as appropriate. Bot scopes: `chat:write`, `im:write`, `im:read`. Slack's [conversations.replies documentation](https://docs.slack.dev/reference/methods/conversations.replies/) requires user tokens for channel thread history. Reads verify `auth.test`, workspace hostname, current membership and every page. Slack Connect threads are rejected. DMs open through [conversations.open](https://docs.slack.dev/reference/methods/conversations.open/) and are verified with `conversations.info` before [chat.postMessage](https://docs.slack.dev/reference/methods/chat.postMessage/).

Without the optional user token, private onboarding and the fictional demo work, but selecting/refreshing actual work threads reports that access is unavailable. Without both tokens, scheduling controls stay off. Managed Channels' ephemeral delivery only works within the current turn; it is not a background DM mechanism.

## Managed metadata and verified DM bindings

If managed ingress omits workspace/channel facts, private access fails closed. An operator may explicitly map a DM that they have independently verified in Slack. Store this in the ignored path selected by INTERN_VERIFIED_DM_BINDINGS:

```json
{
  "channelCode": "YOUR-EXACT-CHANNEL-CODE",
  "bindings": [
    { "workspaceId": "T...", "userId": "U...", "channelId": "D...", "conversationId": "EXACT-MANAGED-CONVERSATION-ID" }
  ]
}
```

A binding matches the exact ingress actor and conversation and rejects conflicting known provider metadata. A user's message text or pasted URL never establishes this mapping. Do not infer a mapping from an unverified probe, reuse it for another bot, or commit real mappings. Nested DM threads may have a different managed conversation ID.

## Team integration and checks

Task A owns this directory and the `channel.tsx` / `server.ts` wiring. Task B's memory modules are used unchanged. `WorkService`, `IngestWork`, `WorkSnapshot`, and `DeliverBriefing` are the small integration ports for Task C to replace content/scheduling. `PrivateRunAgent` extends, rather than replaces, the inherited fresh-inner-run adapter.

Run `npm run verify`. For just this slice from the root:

```sh
TSX_TSCONFIG_PATH=apps/channel/tsconfig.json COPILOTKIT_TELEMETRY_DISABLED=true node --import tsx --test 'apps/channel/src/intern/slack/*.test.tsx'
```

Coverage includes actual managed Slack card rendering and click dispatch, public-channel denial, owner isolation, selected-thread pagination/failures, edited/revoked source withholding, private model-history isolation, persistent profiles, schedule overlap/restarts, and failed refresh/delivery retries. These are offline tests; live Slack credentials, OAuth scopes, model extraction and delivery remain account-dependent checks. No live messages were sent by this implementation session. The managed SDK card/click test and completion/undo integration test run without external accounts.

The merged Task B tools support explicit completion/correction/undo in the private DM, using the current authenticated message as mutation evidence. The current message is timestamped at receipt when native timestamps are unavailable; its source link opens the DM. Background extraction cannot perform these explicit actions. Task C's calendar proposal tool is also available in verified DMs; only the requester's approval creates the shared-calendar event and sends invitations. The memory store is append-only for source edits: changed-source items are withheld pending reconciliation, not silently rewritten. Existing Slack messages already delivered cannot be retracted by untracking.

Storage uses atomic local JSON, one process only. Completed schedule slots and sent warnings persist across restarts. Failed refreshes retry every two minutes without repeated warnings. Successful private delivery precedes notice acknowledgment. A process crash between delivery and saving its acknowledgment remains an at-least-once delivery window; stable Slack client message IDs reduce duplicates but are not a transactional exactly-once guarantee. Start only one runtime per data directory.
