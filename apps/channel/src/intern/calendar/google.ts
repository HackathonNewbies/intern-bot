import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

export const projectRoot = fileURLToPath(new URL("../../../../../", import.meta.url));
export const calendarTokenFile = () => resolve(projectRoot, ".data/google-calendar-token.json");
export const oauthClientFile = () => resolve(projectRoot, process.env.GOOGLE_OAUTH_CLIENT_FILE || ".data/google-oauth-client.json");
export const scopes = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  "https://www.googleapis.com/auth/calendar.events.freebusy",
];

export class CalendarError extends Error {}

export function readOAuthClient() {
  const schema = z.object({ installed: z.object({ client_id: z.string().min(1), client_secret: z.string().min(1) }) });
  try {
    return schema.parse(JSON.parse(readFileSync(oauthClientFile(), "utf8"))).installed;
  } catch {
    throw new CalendarError("Save the downloaded Google Desktop OAuth client JSON to .data/google-oauth-client.json, then run npm run calendar:connect.");
  }
}

export const inviteSchema = z.object({
  title: z.string().trim().min(1).max(200),
  start: z.iso.datetime({ offset: true }).describe("Exact start, including UTC offset, e.g. 2026-09-14T15:00:00+08:00."),
  end: z.iso.datetime({ offset: true }).describe("Exact end including UTC offset."),
  timeZone: z.string().min(1).describe("IANA timezone, e.g. Asia/Singapore. Ask if it is not known."),
  attendees: z.array(z.email()).min(1).max(50).describe("Explicit guest email addresses. Never invent an email from a Slack name."),
  description: z.string().max(5000).default(""),
  location: z.string().max(500).default(""),
});
export type Invite = z.infer<typeof inviteSchema>;

export function validateInvite(input: Invite, now = Date.now()): Invite {
  const parsed = inviteSchema.parse(input);
  if (Date.parse(parsed.start) <= now) throw new CalendarError("Choose a start time in the future.");
  if (Date.parse(parsed.end) <= Date.parse(parsed.start)) throw new CalendarError("The end time must be after the start time.");
  try {
    // Ensure the supplied offset and IANA zone describe the same wall-clock time.
    const format = new Intl.DateTimeFormat("sv-SE", {
      timeZone: parsed.timeZone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    });
    for (const value of [parsed.start, parsed.end]) {
      if (format.format(new Date(value)).replace(" ", "T") !== value.slice(0, 19)) {
        throw new CalendarError("The date/time offset does not match the timezone. Clarify the intended time.");
      }
    }
  } catch (error) {
    if (error instanceof CalendarError) throw error;
    throw new CalendarError("Use a valid IANA timezone, such as Asia/Singapore.");
  }
  return { ...parsed, attendees: [...new Set(parsed.attendees.map(email => email.toLowerCase()))] };
}

export function isCalendarConfigured() {
  return Boolean(process.env.GOOGLE_CALENDAR_ID && existsSync(oauthClientFile()) && existsSync(calendarTokenFile()));
}

export function calendarId() {
  const id = process.env.GOOGLE_CALENDAR_ID?.trim();
  if (!id || id === "primary") throw new CalendarError("Set GOOGLE_CALENDAR_ID to the shared calendar ID in .env. Personal primary calendars are not used by this integration.");
  return id;
}

type Fetch = typeof fetch;
export async function googleAccessToken(request: Fetch = fetch) {
  const client = readOAuthClient();
  let refreshToken: string;
  try {
    refreshToken = z.object({ refresh_token: z.string().min(1) })
      .parse(JSON.parse(readFileSync(calendarTokenFile(), "utf8"))).refresh_token;
  } catch {
    throw new CalendarError("Google Calendar is not connected. Run npm run calendar:connect.");
  }
  const response = await request("https://oauth2.googleapis.com/token", {
    method: "POST", signal: AbortSignal.timeout(15_000),
    body: new URLSearchParams({ ...client, refresh_token: refreshToken, grant_type: "refresh_token" }),
  });
  if (!response.ok) throw new CalendarError("Google authorization failed. Run npm run calendar:connect again.");
  return z.object({ access_token: z.string() }).parse(await response.json()).access_token;
}

export const calendarInfoSchema = z.object({
  id: z.string(), summary: z.string(), timeZone: z.string().optional(),
  primary: z.boolean().optional(), accessRole: z.string(),
});

export async function getCalendarInfo(id: string, token: string, request: Fetch = fetch) {
  const response = await request(`https://www.googleapis.com/calendar/v3/users/me/calendarList/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new CalendarError(`Cannot access the configured calendar (HTTP ${response.status}). Add it to the connected Google account and grant permission to make changes to events.`);
  const info = calendarInfoSchema.parse(await response.json());
  if (info.primary || !["writer", "owner"].includes(info.accessRole)) {
    throw new CalendarError("Choose a secondary/shared calendar where the connected Google account can edit events.");
  }
  return info;
}

const eventSchema = z.object({
  id: z.string(), htmlLink: z.url(), status: z.string(), summary: z.string(),
  start: z.object({ dateTime: z.string() }), end: z.object({ dateTime: z.string() }),
  attendees: z.array(z.object({ email: z.string() })),
  extendedProperties: z.object({ private: z.object({ internBotRequest: z.string() }) }),
});
export type CreatedEvent = { id: string; url: string; calendar: string };

export async function createCalendarInvite(
  invite: Invite, eventId: string,
  deps: { request?: Fetch; token?: () => Promise<string>; id?: string; now?: number } = {},
): Promise<CreatedEvent> {
  const details = validateInvite(invite, deps.now);
  const id = deps.id ?? calendarId();
  if (!/^[0-9a-v]{5,1024}$/.test(eventId)) throw new CalendarError("Invalid event request ID.");
  const request = deps.request ?? fetch;
  const token = await (deps.token ?? googleAccessToken)();
  const calendar = await getCalendarInfo(id, token, request);
  const fingerprint = createHash("sha256").update(JSON.stringify(details)).digest("hex");
  const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(id)}/events`;
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const response = await request(`${base}?sendUpdates=all`, {
    method: "POST", headers, signal: AbortSignal.timeout(15_000),
    body: JSON.stringify({
      id: eventId, summary: details.title, description: details.description, location: details.location,
      start: { dateTime: details.start, timeZone: details.timeZone },
      end: { dateTime: details.end, timeZone: details.timeZone },
      attendees: details.attendees.map(email => ({ email })),
      extendedProperties: { private: { internBotRequest: fingerprint } },
    }),
  });
  if (!response.ok && response.status !== 409) {
    throw new CalendarError(`Google Calendar could not confirm creation (HTTP ${response.status}). Retry this same card; do not submit a new request.`);
  }
  // A read-back also recovers an insert whose response was lost on a prior attempt.
  const verified = await request(`${base}/${eventId}`, { headers, signal: AbortSignal.timeout(15_000) });
  if (!verified.ok) throw new CalendarError("Event creation is not yet verified. Retry this same card to check it without making a duplicate.");
  const event = eventSchema.parse(await verified.json());
  const link = new URL(event.htmlLink);
  if (event.id !== eventId || event.status === "cancelled" || event.summary !== details.title ||
      Date.parse(event.start.dateTime) !== Date.parse(details.start) || Date.parse(event.end.dateTime) !== Date.parse(details.end) ||
      event.extendedProperties.private.internBotRequest !== fingerprint ||
      !details.attendees.every(email => event.attendees.some(guest => guest.email.toLowerCase() === email)) ||
      link.protocol !== "https:" || !["www.google.com", "calendar.google.com"].includes(link.hostname)) {
    throw new CalendarError("Google returned an event that does not match this request. Check the calendar before submitting another request.");
  }
  return { id: event.id, url: event.htmlLink, calendar: calendar.summary };
}
