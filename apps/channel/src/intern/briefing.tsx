import {
  Actions,
  Button,
  Context,
  Divider,
  Field,
  Fields,
  Header,
  Markdown,
  Message,
  Section,
} from "@copilotkit/channels";
import { fakeInternServices, type FakeInternServices } from "./fake-services";
import type { Briefing, BriefingAction, Commitment } from "./types";

const STATUS_LABEL = {
  open: "Open",
  waiting: "Waiting on someone else",
  completed: "Completed",
} as const;

async function routeAction(
  action: BriefingAction,
  commitment: Commitment,
  service: FakeInternServices,
  thread: { update(ref: unknown, node: unknown): Promise<unknown> },
  messageRef: unknown,
) {
  const result = await service.route(action, commitment);
  await thread.update(
    messageRef,
    <Message accent="#2E7D5B">
      <Header>Action routed</Header>
      <Section><Markdown>{result}</Markdown></Section>
    </Message>,
  );
}

function commitmentCard(commitment: Commitment, service: FakeInternServices) {
  const evidence = commitment.evidence
    .map((item) => `• ${item.thread}: ${item.message} (${item.freshness})`)
    .join("\n");

  return (
    <Message accent={commitment.status === "waiting" ? "#C47F00" : "#2E7D5B"}>
      <Header>{commitment.title}</Header>
      <Fields>
        <Field label="Status">{STATUS_LABEL[commitment.status]}</Field>
        <Field label="Due">{commitment.due}</Field>
      </Fields>
      {commitment.dependency && (
        <Section><Markdown>{`**Blocked by:** ${commitment.dependency}`}</Markdown></Section>
      )}
      <Section><Markdown>{`**Evidence**\n${evidence}`}</Markdown></Section>
      <Actions>
        <Button value={commitment.id} style="primary" onClick={async ({ thread, message }) => {
          await routeAction("complete", commitment, service, thread, message.ref);
        }}>Mark complete</Button>
        <Button value={commitment.id} onClick={async ({ thread, message }) => {
          await routeAction("correct", commitment, service, thread, message.ref);
        }}>Correct</Button>
        <Button value={commitment.id} onClick={async ({ thread, message }) => {
          await routeAction("calendar", commitment, service, thread, message.ref);
        }}>Propose calendar block</Button>
      </Actions>
    </Message>
  );
}

/** Rendered only in a person's assistant conversation for this fixture slice. */
export function personalBriefing(
  briefing: Briefing,
  service: FakeInternServices = fakeInternServices,
) {
  return (
    <>
      <Message accent="#4A6CF7">
        <Header>{`${briefing.owner}'s work briefing`}</Header>
        <Section><Markdown>{`Generated ${briefing.generatedAt}. This fixture reads only: ${briefing.selectedThreads.join(", ")}.`}</Markdown></Section>
        <Context>Fixture data only — actions route to fake services and make no external changes.</Context>
      </Message>
      {briefing.commitments.map((commitment) => commitmentCard(commitment, service))}
      <Divider />
    </>
  );
}

export function onboardingMessage() {
  return (
    <Message accent="#4A6CF7">
      <Header>Your private work briefing</Header>
      <Section><Markdown>Use `/briefing` to see the fixture briefing. In the full app, you will choose up to three threads for the assistant to read.</Markdown></Section>
      <Context>This first slice uses no unselected thread data.</Context>
    </Message>
  );
}
