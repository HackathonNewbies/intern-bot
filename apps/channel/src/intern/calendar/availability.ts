import { z } from "zod";
import { CalendarError, googleAccessToken } from "./google";

const clockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const availabilitySchema = z.object({
  date: z.iso.date().describe("Requested local date. Resolve today using the current turn timestamp; never move to another day automatically."),
  timeZone: z.string().default("Asia/Singapore"),
  durationMinutes: z.number().int().min(5).max(480).default(30),
  windowStart: clockTime.default("09:00"),
  windowEnd: clockTime.default("18:00"),
  attendees: z.array(z.email()).min(1).max(49),
});
export type AvailabilityRequest = z.infer<typeof availabilitySchema>;
type Interval = { start: number; end: number };
const minute = 60_000;

function localTime(timestamp: number, timeZone: string) {
  return new Intl.DateTimeFormat("sv-SE", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(timestamp).replace(" ", "T");
}
export function zonedISO(timestamp: number, timeZone: string) {
  const local = localTime(timestamp, timeZone);
  const offset = Math.round((Date.parse(`${local}Z`) - timestamp) / minute);
  const abs = Math.abs(offset);
  return `${local}${offset < 0 ? "-" : "+"}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}
function localInstant(date: string, time: string, zone: string) {
  const desired = `${date}T${time}:00`;
  const base = Date.parse(`${desired}Z`);
  let instant = base;
  try {
    for (let i = 0; i < 4; i++) instant += base - Date.parse(`${localTime(instant, zone)}Z`);
    if (localTime(instant, zone) !== desired) throw new Error("Nonexistent time");
  } catch { throw new CalendarError("Use a valid timezone and a search window whose local times exist on that date."); }
  return instant;
}

/** Only busy intervals are read; titles, descriptions and other event details are never requested. */
export async function readBusy(calendarIds: string[], start: number, end: number, deps: { request?: typeof fetch; token?: () => Promise<string> } = {}): Promise<Interval[]> {
  const request = deps.request ?? fetch;
  const token = await (deps.token ?? googleAccessToken)();
  const response = await request("https://www.googleapis.com/calendar/v3/freeBusy", {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, signal: AbortSignal.timeout(15_000),
    body: JSON.stringify({ timeMin: new Date(start).toISOString(), timeMax: new Date(end).toISOString(), items: calendarIds.map(id => ({ id })), calendarExpansionMax: 50 }),
  });
  if (!response.ok) throw new CalendarError(response.status === 403
    ? "Google availability access was denied. Run npm run calendar:connect and grant the free/busy permission; also check that the guest shares availability with the connected Google account. No invitation was created."
    : `Could not check Google availability (HTTP ${response.status}). No invitation was created.`);
  const intervalSchema = z.object({ start: z.iso.datetime({ offset: true }), end: z.iso.datetime({ offset: true }) });
  const result = z.object({ timeMin: z.iso.datetime({ offset: true }), timeMax: z.iso.datetime({ offset: true }), calendars: z.record(z.string(), z.object({ errors: z.array(z.unknown()).optional(), busy: z.array(intervalSchema).optional() })) }).safeParse(await response.json());
  if (!result.success || Date.parse(result.data.timeMin) !== start || Date.parse(result.data.timeMax) !== end) throw new CalendarError("Google returned incomplete availability. No invitation was created; try again.");
  const intervals: Interval[] = [];
  for (const id of calendarIds) {
    const calendar = result.data.calendars[id];
    if (!calendar || calendar.errors?.length || !calendar.busy) throw new CalendarError(`Cannot verify availability for ${id}. The calendar must share free/busy access with the connected Google account. An email address alone does not grant access. No invitation was created.`);
    for (const item of calendar.busy) {
      const interval = { start: Date.parse(item.start), end: Date.parse(item.end) };
      if (interval.end <= interval.start) throw new CalendarError("Google returned invalid availability. No invitation was created.");
      intervals.push(interval);
    }
  }
  return intervals;
}

export function earliestSlot(start: number, end: number, durationMinutes: number, busy: Interval[]) {
  const step = 15 * minute;
  let candidate = Math.ceil(start / step) * step;
  for (const block of [...busy].sort((a, b) => a.start - b.start)) {
    if (candidate + durationMinutes * minute <= block.start) break;
    if (candidate < block.end) candidate = Math.ceil(block.end / step) * step;
  }
  return candidate + durationMinutes * minute <= end ? { start: candidate, end: candidate + durationMinutes * minute } : null;
}

export async function findAvailableSlot(input: AvailabilityRequest, sharedId: string, deps: { now?: number; busy?: typeof readBusy } = {}) {
  const args = availabilitySchema.parse(input);
  const start = localInstant(args.date, args.windowStart, args.timeZone);
  const end = localInstant(args.date, args.windowEnd, args.timeZone);
  if (end <= start) throw new CalendarError("The search window must end after it starts on the same day.");
  const earliest = Math.max(start, (deps.now ?? Date.now()) + 5 * minute);
  if (earliest + args.durationMinutes * minute > end) return null;
  const ids = [...new Set([...args.attendees.map(email => email.toLowerCase()), sharedId])];
  const busy = await (deps.busy ?? readBusy)(ids, earliest, end);
  const slot = earliestSlot(earliest, end, args.durationMinutes, busy);
  return slot ? { start: zonedISO(slot.start, args.timeZone), end: zonedISO(slot.end, args.timeZone), calendarIds: ids } : null;
}

export async function assertStillAvailable(ids: string[], start: string, end: string, busy = readBusy) {
  const from = Date.parse(start), to = Date.parse(end);
  if (from <= Date.now()) throw new CalendarError("This proposed time has passed. Request a new availability search.");
  const intervals = await busy(ids, from, to);
  if (intervals.some(interval => interval.start < to && interval.end > from)) throw new CalendarError("This slot is now busy. No event was created. Cancel this review and request a new availability search.");
}
