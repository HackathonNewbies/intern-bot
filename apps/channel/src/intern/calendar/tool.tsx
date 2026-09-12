import { defineChannelTool, Message, Header, Section, Fields, Field, Context, Actions, Button, channelDeliveryErrorDetails, isChannelDeliveryTerminatedError } from "@copilotkit/channels";
import type { InteractionContext } from "@copilotkit/channels";
import { CalendarApproval } from "./approval";
import { CalendarError, calendarId, createCalendarInvite, getCalendarInfo, googleAccessToken, inviteSchema, isCalendarConfigured, validateInvite } from "./google";

export function calendarInviteTool(deps = {
  configured: isCalendarConfigured,
  target: async () => {
    const id = calendarId();
    return getCalendarInfo(id, await googleAccessToken());
  },
  create: createCalendarInvite,
}) {
return defineChannelTool({
  name: "propose_calendar_invite",
  description: "Prepare a Google Calendar invitation on the shared team calendar and show a review card. Requires title, exact start/end with timezone, and actual guest emails. This tool creates nothing: only the requester clicking Create & send invites can create the event. Ask for missing or ambiguous details first.",
  parameters: inviteSchema,
  async handler(args, ctx) {
    console.info("[calendar] preparing review");
    if (!deps.configured()) return "Shared Google Calendar is not connected yet. The operator must finish npm run calendar:connect and configure GOOGLE_CALENDAR_ID in .env. No event was created.";
    try {
      const invite = validateInvite(args);
      // Verify the target before asking a person to approve it.
      const target = await deps.target();
      console.info("[calendar] verified calendar access");
      const id = target.id;
      const requester = `${ctx.platform}:${ctx.actor.id}`;
      const approval = new CalendarApproval(requester, invite, (details, eventId) => deps.create(details, eventId, { id }));
      const decide = async (approved: boolean, click: InteractionContext<string>) => {
        try {
          const result = await approval.decide(`${click.platform}:${click.actor.id}`, approved);
          if (result.state === "cancelled") {
            await click.thread.update(click.message.ref, "Calendar invitation cancelled. No event was created and no invitations were sent.");
          } else {
            await click.thread.update(click.message.ref,
              <Message accent="#2E7D5B">
                <Header>Calendar invitation created</Header>
                <Section>{invite.title}</Section>
                <Context>{`Created on ${result.event.calendar}. Google was asked to notify all ${invite.attendees.length} guest(s).`}</Context>
                <Actions><Button url={result.event.url}>Open Google Calendar event</Button></Actions>
              </Message>,
            );
          }
        } catch (error) {
          if (isChannelDeliveryTerminatedError(error)) throw error;
          await click.thread.post(error instanceof CalendarError ? error.message : "Could not verify the calendar invitation. Retry the same review card after checking the connection; do not submit a duplicate request.");
        }
      };
      await ctx.thread.post(
        <Message accent="#4285F4">
          <Header>Review calendar invitation</Header>
          <Section>{invite.title}</Section>
          <Fields>
            <Field label="Calendar">{target.summary}</Field>
            <Field label="Start">{invite.start}</Field>
            <Field label="End">{invite.end}</Field>
            <Field label="Timezone">{invite.timeZone}</Field>
            <Field label="Guests">{invite.attendees.join(", ")}</Field>
          </Fields>
          {invite.location ? <Section>{`Location: ${invite.location}`}</Section> : null}
          {invite.description ? <Section>{invite.description}</Section> : null}
          <Context>Creating this event sends invitations to every listed guest. Only the requester can approve. This review expires in 20 minutes or when the bot restarts.</Context>
          <Actions>
            <Button value={`${approval.eventId}:create`} style="primary" onClick={async click => { await decide(true, click); }}>Create &amp; send invites</Button>
            <Button value={`${approval.eventId}:cancel`} onClick={async click => { await decide(false, click); }}>Cancel</Button>
          </Actions>
          <Context>{`Request ${approval.eventId}`}</Context>
        </Message>,
      );
      console.info("[calendar] review posted");
      return "Calendar review posted; approval is pending. No event or invitation has been created. Do not claim success, create another proposal for this request, or use another tool to bypass the review.";
    } catch (error) {
      console.error("[calendar] review failed", error instanceof Error ? error.message : "Unknown error");
      if (isChannelDeliveryTerminatedError(error)) {
        console.error("[calendar] provider diagnostics", channelDeliveryErrorDetails(error));
        throw error;
      }
      return error instanceof CalendarError ? error.message : "Could not prepare the calendar review. Check the event details and Google connection. No event was created.";
    }
  },
});
}

export const proposeCalendarInvite = calendarInviteTool();
