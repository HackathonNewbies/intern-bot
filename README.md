# Intern Bot

Your personal intern remembers the loose ends and keeps you in the loop.

Planned: follow selected Slack threads, track your commitments and unresolved dependencies, and send concise private briefings each morning or on request. Calendar booking is a supporting action requiring your request and approval.

**Status:** product discussion. The code is an inherited Slack incident demo, not an implemented Intern Bot. Shared interfaces will be agreed when implementation starts.

## Development

Node.js 22+:

```bash
npm ci
npm run verify
cp .env.example .env
npm run dev:slack
```

Configure model and managed Slack credentials before running the demo. See [Slack setup](apps/channel/README.md). Use one designated live Slack runtime; others develop with offline tests.

## Team plan

See [PLAN.md](PLAN.md) for scope, the three-person split, and integration order. Use separate branches in this repository; coordinate shared interfaces and dependency changes before editing them.

## Attribution and submission

Inherited from the MIT-licensed [CopilotKit starter kit](https://github.com/CopilotKit/agents-everywhere-starter-kit): Slack runtime, incident example, shared agent code, tests, and setup guidance. Web/mobile demos were removed from this working copy.

Read [AGENTS.md](AGENTS.md), [hackathon overview](hackathon-overview.md), [rules](hackathon-rules.md), and [sponsor guidance](using-sponsor-tools.md). These inherited guides include references to other starter surfaces that are no longer included. Track actual event work and evidence in [SUBMISSION.md](SUBMISSION.md).
