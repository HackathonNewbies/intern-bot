# Slack thread agent

Shared Google Calendar invitations are available through `propose_calendar_invite`.
Requests to schedule when guests are free use `propose_available_calendar_invite`
to check availability before showing the same approval card. Reconnect Google
once to grant free/busy access; see the setup guide for defaults and access limits.
See [Google Calendar setup](../../dev-docs/google-calendar.md) to connect the team
calendar, authorize Google, and test a reviewed invitation from Slack.

## Intern Bot setup

This directory is linked to the hosted `intern-bot` project and managed Slack
Channel declared in `.copilotkit/channels.json`. The test location is
HackathonNewbies → `#new-channel`.

Set `OPENAI_API_KEY` in root `.env`. `copilotkit project select` provisions
`CPK_INTELLIGENCE_API_KEY`; the runtime accepts that name, with
`INTELLIGENCE_API_KEY` as a legacy fallback. Keep `CHANNEL_CODE=intern-bot`.

Run `npm run dev:slack` from the repository root. Keep only one listener for this
Channel running, including listeners in other checkouts: competing runtimes can
answer with stale behavior. A root `.env` change requires restarting the process.

In Slack, invite with `/invite @intern-bot`, then send
`@intern-bot say hello to everybody`. The model should render the greeting card.
Reply in the same thread without mentioning the bot to test follow-up handling;
an unrelated, unmentioned top-level message should receive no reply.

CLI 4.9.60's source scanner recognizes literal Channel names only, so
`channels status --json` can warn `channel_not_declared_in_source` for this
template's environment-based name. Check the runtime's logged Channel lifecycle
and a real Slack reply to establish connection.

**OpenAI + CopilotKit Channels + Exa**

Build an agent that reads an existing conversation, researches what matters, and replies in the same Slack thread with native cards and source links. Try a team research discussion, support handoff, project decision, or incident review. The included incident scenario shows how the infrastructure fits together; replace it with your own workflow.

[![Slack thread agent demo](../../assets/demos/slack.gif)](../../assets/demos/slack.mp4)

_Scroll through a completed Slack thread: incident context, Exa source cards, and the final answer. The preview is sped up; click it for the full MP4._

## Get started

Complete the [root clone/install steps](../../README.md#get-started), then configure `.env` with [OpenAI](../../using-sponsor-tools.md#openai), [CopilotKit Intelligence](../../using-sponsor-tools.md#copilotkit), and [Exa](../../using-sponsor-tools.md#exa):

```dotenv
MODEL_PROVIDER=openai
OPENAI_API_KEY=your-key
MODEL=gpt-5.6-sol
CHANNEL_CODE=your-channel-code
CPK_INTELLIGENCE_API_KEY=your-project-key
EXA_API_KEY=your-key
EXA_SEARCH_TYPE=fast
```

Choose an OpenAI model available to your account. Create the managed Channel using `npm run channel:setup`; the [setup guide](../../dev-docs/setup.md) and [screenshot walkthrough](../../dev-docs/channels-sdk-walkthrough/README.md) cover the Slack installation.

```bash
npm run dev:slack
```

Invite the bot to a Slack channel and mention it in a populated thread. CopilotKit Intelligence manages the Slack connection; this listener needs no public tunnel or Slack app token on the managed path.

## Try the flow

1. Add two or three facts to a Slack thread before mentioning the agent.
2. Ask it to catch up using the thread and render a card. Verify facts came from earlier messages rather than your last prompt.
3. Ask it to research a related question with Exa. `search_web` posts native **Search sources** cards when sources are returned; open the links and separate published evidence from facts in your thread.
4. Ask a follow-up that relies on the discussion. Check the answer and card remain in the same thread.

Use [demo prompts](../../dev-docs/demo-prompts.md#slack-context-sources-card-follow-up) for exact incident inputs. If you add an external write, enforce approval in code before that write. The included proposal card records a decision without executing a production action.

## Customize these files

| Piece | File |
|---|---|
| Agent and model | [Shared agent factory](../../packages/agent-core/src/agent.ts), using CopilotKit's built-in agent |
| Channel lifecycle | [src/channel.tsx](src/channel.tsx): mention, subscribe, respond to subscribed messages |
| Channel-only run adapter | [src/agent.ts](src/agent.ts): keeps outer transcript/state while using fresh inner agent runs |
| Thread context and research | [src/tools.tsx](src/tools.tsx) and [src/search.tsx](src/search.tsx): `read_thread` and Exa-backed `search_web` |
| Native cards | [src/components.tsx](src/components.tsx): incident card and timeline via Channels JSX |
| Prompt | [Shared prompt](../../packages/agent-core/src/prompt.ts) |

OpenRouter can be used as the model gateway through the shared provider settings in [using-sponsor-tools.md](../../using-sponsor-tools.md#openrouter). Teams or another messaging platform can reuse the Channels pattern, but this starter app is wired for managed Slack.

## Give this to your coding agent

```text
Read the root hackathon overview, rules, sponsor guide, and AGENTS.md.
Read .agents/skills/build-channels-agent/SKILL.md before changing Slack code.
Adapt apps/channel to our project's user and conversation. Preserve
read_thread, use Exa when research helps, and render results with Channels JSX.
Replace incident-specific schemas, tools, and prompts with our own workflow.
Demonstrate that earlier messages change the answer and return source links.
Run npm run verify and document the live Slack checks separately.
```

## Verify and limits

Run `npm run verify` for root/channel typechecks and offline tests. Live Slack delivery, Exa search, and model responses require your own accounts and should be documented separately from local tests.

Keep the pinned Channels/runtime pair and the `@ag-ui/client` override. The [Channels skill](../../.agents/skills/build-channels-agent/SKILL.md) supplies the verified API vocabulary. [Channels guide](https://copilotkit.ai/channels-guide.md) · [OpenTag reference app](https://github.com/CopilotKit/OpenTag)

## Task A private work assistant

The app entry point now uses the private Intern workflow. Open a verified one-to-one DM and send `start`, then `demo` for the fictional briefing. See [private workflow setup and tests](src/intern/slack/README.md) for selected-thread OAuth access, verified DM metadata, commands, and optional scheduled delivery. Calendar invitations remain approval-gated through the integrated calendar tool.
