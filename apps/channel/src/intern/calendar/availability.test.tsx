import { it } from "node:test";
import assert from "node:assert/strict";
import { createChannel } from "@copilotkit/channels";
import { startChannelsWithGatewayControl } from "@copilotkit/channels-intelligence";
import { ManagedGateway, preparedDelivery, concreteThread } from "../../testing/managed-gateway";
import { availabilitySchema, earliestSlot, findAvailableSlot, readBusy, assertStillAvailable } from "./availability";
import { availableCalendarInviteTool } from "./available-tool";
import { CalendarApproval } from "./approval";
import type { Invite } from "./google";

const at = (time: string) => Date.parse(`2030-09-15T${time}:00+08:00`);
const args = availabilitySchema.parse({ date: "2030-09-15", attendees: ["guest@example.com"] });
const details: Invite = { title: "Discussion", start: "2030-09-15T15:00:00+08:00", end: "2030-09-15T15:30:00+08:00", timeZone: "Asia/Singapore", attendees: args.attendees, location: "", description: "" };
const event = { id: "abcde12345", url: "https://calendar.google.com/calendar/event?eid=test", calendar: "Team" };

it("finds a future slot across overlapping, unsorted busy intervals with inclusive starts and exclusive ends", () => {
  assert.deepEqual(earliestSlot(at("09:00"), at("18:00"), 30, [
    { start: at("10:00"), end: at("11:00") }, { start: at("08:00"), end: at("09:45") },
    { start: at("09:30"), end: at("10:15") }, { start: at("11:30"), end: at("12:00") },
  ]), { start: at("11:00"), end: at("11:30") });
  assert.equal(earliestSlot(at("17:45"), at("18:00"), 30, []), null);
});

it("checks all guest calendars and the fixed destination, applies lead time, and never rolls an exhausted day forward", async () => {
  let calls = 0;
  const busy = async (ids: string[]) => { calls++; assert.deepEqual(ids, ["guest@example.com", "shared"]); return []; };
  const slot = await findAvailableSlot(args, "shared", { now: at("15:02"), busy });
  assert.equal(slot?.start, "2030-09-15T15:15:00+08:00");
  assert.equal(slot?.end, "2030-09-15T15:45:00+08:00");
  assert.equal(await findAvailableSlot(args, "shared", { now: at("17:45"), busy }), null);
  assert.equal(calls, 1);
  assert.equal(await findAvailableSlot(args, "shared", { now: at("08:00"), busy: async () => [{ start: at("09:00"), end: at("18:00") }] }), null);
});

it("resolves local dates in a DST timezone and rejects invalid zones/windows", async () => {
  const slot = await findAvailableSlot({ ...args, date: "2030-03-10", timeZone: "America/New_York" }, "shared", { now: Date.parse("2030-03-09T00:00:00Z"), busy: async () => [] });
  assert.equal(slot?.start, "2030-03-10T09:00:00-04:00");
  for (const input of [{ ...args, timeZone: "not-a-zone" }, { ...args, windowEnd: "08:00" }, { ...args, date: "2030-03-10", timeZone: "America/New_York", windowStart: "02:30" }]) {
    await assert.rejects(findAvailableSlot(input, "shared", { now: 0, busy: async () => [] }));
  }
});

it("uses freeBusy without requesting event details and fails closed on per-calendar errors, missing data, or scope denial", async () => {
  const request: typeof fetch = async (url, init) => {
    assert.equal(String(url), "https://www.googleapis.com/calendar/v3/freeBusy");
    const body = JSON.parse(String(init?.body));
    assert.deepEqual(body.items, [{ id: "guest@example.com" }]);
    return Response.json({ timeMin: body.timeMin, timeMax: body.timeMax, calendars: { "guest@example.com": { busy: [] } } });
  };
  assert.deepEqual(await readBusy(args.attendees, at("09:00"), at("18:00"), { token: async () => "test", request }), []);
  for (const calendars of [{}, { "guest@example.com": { busy: [], errors: [{ reason: "notFound" }] } }, { "guest@example.com": {} }]) {
    await assert.rejects(readBusy(args.attendees, at("09:00"), at("18:00"), {
      token: async () => "test", request: async () => Response.json({ timeMin: new Date(at("09:00")).toISOString(), timeMax: new Date(at("18:00")).toISOString(), calendars }),
    }), /Cannot verify availability/);
  }
  await assert.rejects(readBusy(args.attendees, at("09:00"), at("18:00"), { token: async () => "test", request: async () => new Response(null, { status: 403 }) }), /calendar:connect/);
});

it("rechecks availability before writing, permits cancellation after a conflict, and recovers uncertain writes without self-conflict", async () => {
  let writes = 0, checks = 0;
  const blocked = new CalendarApproval("user", details, async () => { writes++; return event; }, undefined, async invite => {
    checks++;
    await assertStillAvailable(args.attendees, invite.start, invite.end, async () => [{ start: at("15:15"), end: at("16:00") }]);
  });
  await assert.rejects(blocked.decide("user", true), /now busy/);
  assert.equal(writes, 0);
  assert.equal((await blocked.decide("user", false)).state, "cancelled");
  const retry = new CalendarApproval("user", details, async () => { if (++writes === 1) throw new Error("Lost response"); return event; }, undefined, async () => { checks++; });
  await assert.rejects(retry.decide("user", true), /Lost response/);
  assert.equal((await retry.decide("user", true)).state, "created");
  assert.equal(checks, 2);
});

it("posts the selected free slot as a real managed approval card and rechecks only on the requester click", async () => {
  const gateway = new ManagedGateway();
  const channel = createChannel({ name: "support", identifyUser: "platform" });
  let writes = 0, checks = 0;
  const proposal = preparedDelivery("available_calendar", "slack", { kind: "text", text: "Schedule when guest is free" });
  const tool = availableCalendarInviteTool({
    configured: () => true, target: async () => ({ id: "shared", summary: "Team", accessRole: "writer" }),
    find: async () => ({ start: details.start, end: details.end, calendarIds: ["guest@example.com", "shared"] }),
    recheck: async ids => { assert.deepEqual(ids, ["guest@example.com", "shared"]); checks++; },
    create: async () => { writes++; return event; },
  });
  channel.onMessage(async ({ thread }) => {
    const result = await tool.handler({ ...args, title: details.title, description: "", location: "" }, {
      thread: concreteThread(thread), user: { id: "requester", name: "Ada" }, actor: { id: proposal.turn.actor!.externalUserId, kind: "human" }, platform: "slack",
    });
    assert.match(String(result), /approval is pending/);
  });
  const handle = await startChannelsWithGatewayControl([channel], { session: gateway, scope: { projectId: 1, channelName: "support" }, runtimeInstanceId: "rti_availability", loadHistory: async () => [], runCanonical: async args => args.execute({}) });
  try {
    await gateway.deliver(proposal);
    assert.equal(writes, 0); assert.equal(checks, 0);
    const card = gateway.packets.map(packet => packet.payload).find(payload => payload.kind === "slack.message.create");
    assert.ok(card); assert.match(JSON.stringify(card), /Availability search: 30 minutes/);
    // Parse only the SDK-rendered action fields used to deliver the real click.
    const { z } = await import("zod");
    const blocks = z.array(z.object({ type: z.string(), elements: z.array(z.unknown()).optional() })).parse(card.blocks);
    const button = blocks.filter(block => block.type === "actions").flatMap(block => block.elements ?? [])
      .map(element => z.object({ action_id: z.string(), text: z.object({ text: z.string() }) }).parse(element)).find(element => element.text.text.includes("Create"));
    assert.ok(button);
    const click = preparedDelivery("available_click", "slack", { kind: "interaction", actionId: button.action_id, messageRef: { id: "pref_v1_available_message_123" } });
    await gateway.deliver({ ...proposal, deliveryId: click.deliveryId, turn: { ...click.turn, actor: proposal.turn.actor } });
    assert.equal(writes, 1); assert.equal(checks, 1);
  } finally { await handle.stop(); }
});
