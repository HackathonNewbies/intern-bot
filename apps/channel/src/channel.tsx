import { createChannel } from "@copilotkit/channels";
import { isSearchConfigured, isWorkplaceConfigured, WORKPLACE_CONTEXT } from "agent-core";
import { makeChannelAgent } from "./agent";
import { required } from "./env";
import { GreetingCard, IncidentCard, Timeline, welcomeMessage } from "./components";
import { proposeAction, readThread, searchTheWeb } from "./tools";
import { proposeCalendarInvite } from "./intern/calendar/tool";

// Tools are registered only when their credential is present, so the agent is
// never handed a tool that will fail when it calls it.
const tools = [
  readThread,
  proposeCalendarInvite,
  proposeAction,
  ...(isSearchConfigured() ? [searchTheWeb] : []),
];

export const channel = createChannel({
  // Must equal the Channel Code in Intelligence, character for character. A
  // mismatch leaves the Channel at "Waiting for runtime" and is validated at
  // startup, not here.
  name: required("CHANNEL_CODE"),

  // Required. "platform" derives the canonical user from provider + workspace +
  // platform user id. Do NOT move this onto CopilotRuntime — that one is for
  // web requests and must be absent on a Channels-only runtime.
  identifyUser: "platform",

  agent: makeChannelAgent,
  tools,
  components: [GreetingCard, IncidentCard, Timeline],

  // Injected into the agent's prompt on every run.
  context: [
    {
      description: "Identity and greetings",
      value:
        "Your name is Intern Bot. When asked to say hello to everybody, call greeting_card with a brief friendly introduction in the current thread. A greeting needs no incident details or research. Do not use @channel or @everyone for a greeting.",
    },
    {
      description: "Rendering",
      value:
        "You can draw native UI by calling incident_card or timeline. Prefer them over prose whenever the answer has structure.",
    },
    ...(isWorkplaceConfigured()
      ? [{ description: "Workplace", value: WORKPLACE_CONTEXT }]
      : []),
    {
      description: "Surface",
      value:
        "This is a chat thread in a channel people are actively working in. Assume others are reading and that some joined late.",
    },
  ],

});

// A mention subscribes the conversation, so the agent then follows along instead
// of needing to be @-mentioned every single turn.
const currentTimeContext = () => [{ description: "Current date and time", value: `${new Date().toISOString()}. Default scheduling timezone: Asia/Singapore.` }];

channel.onMention(async ({ thread }) => {
  await thread.subscribe();
  await thread.runAgent({ context: currentTimeContext() });
});

// Non-mentioned turns only ever reach onMessage — gate them on the flag or the
// agent will answer every message in every channel it has been invited to.
channel.onMessage(async ({ thread }) => {
  if (await thread.isSubscribed()) {
    await thread.runAgent({ context: currentTimeContext() });
  }
});

channel.onWelcome(async ({ thread, platform }) => {
  await thread.post(welcomeMessage(platform));
});
