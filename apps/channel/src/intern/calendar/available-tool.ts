import { defineChannelTool, isChannelDeliveryTerminatedError } from "@copilotkit/channels";
import { availabilitySchema, assertStillAvailable, findAvailableSlot } from "./availability";
import { CalendarError, calendarId, createCalendarInvite, getCalendarInfo, googleAccessToken, inviteSchema, isCalendarConfigured } from "./google";
import { calendarInviteTool } from "./tool";

export function availableCalendarInviteTool(deps = {
  configured: isCalendarConfigured,
  target: async () => getCalendarInfo(calendarId(), await googleAccessToken()),
  find: findAvailableSlot,
  recheck: assertStillAvailable,
  create: createCalendarInvite,
}) {
  return defineChannelTool({
    name: "propose_available_calendar_invite",
    description: "Find the earliest free slot for all named guests on a requested date and post a calendar review. Use when asked to schedule whenever someone is free. Checks guests' primary calendars and the shared destination, subject to Google access. Defaults: 30 minutes, 09:00–18:00 Asia/Singapore, at least 5 minutes from now, quarter-hour starts. Only a requester click creates anything. Never substitute guessed times if lookup fails.",
    parameters: availabilitySchema.extend({
      title: inviteSchema.shape.title,
      description: inviteSchema.shape.description,
      location: inviteSchema.shape.location,
    }),
    async handler(args, ctx) {
      try {
        if (!deps.configured()) throw new CalendarError("Connect the shared Google Calendar with npm run calendar:connect first. No invitation was created.");
        const target = await deps.target();
        const slot = await deps.find(args, target.id);
        if (!slot) return `No ${args.durationMinutes}-minute free slot remains on ${args.date} between ${args.windowStart} and ${args.windowEnd} (${args.timeZone}). No review or invitation was created. Ask for another window or date; do not silently schedule another day.`;
        const review = calendarInviteTool({
          configured: deps.configured, target: async () => target, create: deps.create,
          beforeCreate: invite => deps.recheck(slot.calendarIds, invite.start, invite.end),
          reviewNote: `Availability search: ${args.durationMinutes} minutes, ${args.date}, ${args.windowStart}–${args.windowEnd} ${args.timeZone}. Checked guests' primary calendars and this shared calendar. Other calendars are not checked. Availability will be rechecked before the first creation attempt; this is not a reservation.`,
        });
        return await review.handler({ title: args.title, start: slot.start, end: slot.end, timeZone: args.timeZone, attendees: args.attendees, description: args.description, location: args.location }, ctx);
      } catch (error) {
        if (isChannelDeliveryTerminatedError(error)) throw error;
        return error instanceof CalendarError ? error.message : "Availability lookup failed. No invitation was created. Try again; do not assume the guest is free.";
      }
    },
  });
}
export const proposeAvailableCalendarInvite = availableCalendarInviteTool();
