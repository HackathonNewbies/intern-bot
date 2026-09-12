import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CalendarApproval } from "./approval";
import { CalendarError, createCalendarInvite, validateInvite, type Invite } from "./google";
import { createChannel, ChannelDeliveryTerminatedError } from "@copilotkit/channels";
import { startChannelsWithGatewayControl } from "@copilotkit/channels-intelligence";
import { ManagedGateway, preparedDelivery, concreteThread } from "../../testing/managed-gateway";
import { calendarInviteTool } from "./tool";
import { z } from "zod";

const invite: Invite = {
  title: "Demo review", start: "2030-09-15T15:00:00+08:00", end: "2030-09-15T15:30:00+08:00",
  timeZone: "Asia/Singapore", attendees: ["guest@example.com"], description: "Review the demo", location: "Team room",
};
const created = { id: "abcde12345", url: "https://calendar.google.com/calendar/event?eid=test", calendar: "Team" };

describe("calendar request validation", () => {
  it("rejects missing guests, reversed dates, past dates and conflicting timezone offsets", () => {
    for (const invalid of [
      { ...invite, attendees: [] }, { ...invite, end: invite.start },
      { ...invite, start: "2000-09-15T15:00:00+08:00" },
      { ...invite, timeZone: "America/New_York" },
      { ...invite, timeZone: "not-a-timezone" },
      { ...invite, attendees: ["@slack-user"] },
    ]) assert.throws(() => validateInvite(invalid));
    assert.deepEqual(validateInvite({ ...invite, attendees: ["Guest@example.com", "guest@example.com"] }).attendees, ["guest@example.com"]);
  });
});

describe("calendar approvals", () => {
  it("creates nothing on proposal, rejects another user and creates nothing on cancel", async () => {
    let writes = 0;
    const approval = new CalendarApproval("slack:requester", invite, async () => { writes++; return created; });
    assert.equal(writes, 0);
    await assert.rejects(approval.decide("slack:someone-else", true), /Only the person/);
    assert.deepEqual(await approval.decide("slack:requester", false), { state: "cancelled" });
    assert.deepEqual(await approval.decide("slack:requester", true), { state: "cancelled" });
    assert.equal(writes, 0);
  });

  it("serializes double clicks, keeps the result and does not cancel an already created event", async () => {
    let writes = 0;
    const approval = new CalendarApproval("slack:requester", invite, async () => { writes++; return created; });
    const results = await Promise.all([approval.decide("slack:requester", true), approval.decide("slack:requester", true)]);
    assert.equal(writes, 1);
    assert.deepEqual(results[0], results[1]);
    assert.equal((await approval.decide("slack:requester", false)).state, "created");
  });

  it("retries an uncertain write with the same event ID and refuses to falsely report cancellation", async () => {
    const ids: string[] = [];
    const approval = new CalendarApproval("u1", invite, async (_, id) => {
      ids.push(id);
      if (ids.length === 1) throw new Error("Response lost");
      return created;
    });
    await assert.rejects(approval.decide("u1", true), /Response lost/);
    await assert.rejects(approval.decide("u1", false), /already reached Google/);
    assert.equal((await approval.decide("u1", true)).state, "created");
    assert.equal(ids.length, 2);
    assert.equal(ids[0], ids[1]);
  });

  it("expires a pending proposal without writing", async () => {
    const approval = new CalendarApproval("u1", invite, async () => { assert.fail("must not write"); }, 10);
    await assert.rejects(approval.decide("u1", true, 11), /expired/);
  });
});

describe("Google Calendar writes", () => {
  for (const insertStatus of [200, 409]) {
    it(`sends attendee notifications and reads back the exact event after HTTP ${insertStatus}`, async () => {
      const calls: { url: string; init?: RequestInit }[] = [];
      let body: Record<string, unknown> = {};
      const request: typeof fetch = async (url, init) => {
        calls.push({ url: String(url), init });
        if (calls.length === 1) return Response.json({ id: "shared@example.com", summary: "Team", accessRole: "writer" });
        if (init?.method === "POST") {
          body = JSON.parse(String(init.body));
          return Response.json({}, { status: insertStatus });
        }
        return Response.json({ ...body, status: "confirmed", htmlLink: created.url });
      };
      assert.deepEqual(await createCalendarInvite(invite, created.id, { request, token: async () => "token", id: "shared@example.com" }), created);
      assert.match(calls[1].url, /shared%40example.com\/events\?sendUpdates=all$/);
      assert.deepEqual(body.attendees, [{ email: "guest@example.com" }]);
      assert.match(calls[2].url, /events\/abcde12345$/);
    });
  }

  it("refuses to write to a primary or read-only calendar", async () => {
    for (const info of [{ primary: true, accessRole: "owner" }, { accessRole: "reader" }]) {
      let calls = 0;
      await assert.rejects(createCalendarInvite(invite, created.id, {
        token: async () => "token", id: "shared@example.com",
        request: async () => { calls++; return Response.json({ id: "shared@example.com", summary: "Calendar", ...info }); },
      }), CalendarError);
      assert.equal(calls, 1);
    }
  });

  it("never reports creation when Google rejects the insert", async () => {
    let calls = 0;
    await assert.rejects(createCalendarInvite(invite, created.id, {
      token: async () => "token", id: "shared@example.com",
      request: async () => ++calls === 1
        ? Response.json({ id: "shared@example.com", summary: "Team", accessRole: "writer" })
        : Response.json({ error: { message: "untrusted provider text" } }, { status: 403 }),
    }), /HTTP 403/);
    assert.equal(calls, 2);
  });

  it("does not accept an unrelated event on a duplicate ID", async () => {
    let calls = 0;
    await assert.rejects(createCalendarInvite(invite, created.id, {
      token: async () => "token", id: "shared@example.com",
      request: async () => {
        calls++;
        if (calls === 1) return Response.json({ id: "shared@example.com", summary: "Team", accessRole: "writer" });
        if (calls === 2) return Response.json({}, { status: 409 });
        return Response.json({ id: created.id, htmlLink: created.url, status: "confirmed", summary: "Different event", start: { dateTime: invite.start }, end: { dateTime: invite.end }, attendees: [{ email: "guest@example.com" }], extendedProperties: { private: { internBotRequest: "wrong" } } });
      },
    }), /does not match/);
  });
});

describe("managed calendar review card", () => {
  it("routes a later requester click to exactly one Google write and replaces the card with a link", async () => {
    const gateway = new ManagedGateway();
    const channel = createChannel({ name: "support", identifyUser: "platform" });
    const proposal = preparedDelivery("calendar_proposal", "slack", { kind: "text", text: "Invite the team" });
    const actor = proposal.turn.actor;
    assert.ok(actor);
    let writes = 0;
    const tool = calendarInviteTool({
      configured: () => true,
      target: async () => ({ id: "shared@example.com", summary: "Team", accessRole: "writer" }),
      create: async () => { writes++; return created; },
    });
    channel.onMessage(async ({ thread }) => {
      const result = await tool.handler({ ...invite, location: "", description: "" }, {
        thread: concreteThread(thread), user: { id: "requester", name: "Ada" }, platform: "slack",
        actor: { id: actor.externalUserId, kind: "human" },
      });
      assert.match(String(result), /approval is pending/);
    });
    const handle = await startChannelsWithGatewayControl([channel], {
      session: gateway, scope: { projectId: 1, channelName: "support" }, runtimeInstanceId: "rti_calendar",
      loadHistory: async () => [], runCanonical: async args => args.execute({}),
    });
    try {
      await gateway.deliver(proposal);
      assert.equal(writes, 0);
      const card = gateway.packets.map(packet => packet.payload).find(payload => payload.kind === "slack.message.create");
      assert.ok(card);
      const blocks = z.array(z.object({ type: z.string(), text: z.object({ text: z.string().min(1) }).optional(), elements: z.array(z.unknown()).optional() })).parse(card.blocks);
      const button = blocks.filter(block => block.type === "actions").flatMap(block => block.elements ?? [])
        .map(element => z.object({ text: z.object({ text: z.string() }), action_id: z.string() }).parse(element))
        .find(element => element.text.text.includes("Create"));
      assert.ok(button);
      assert.match(JSON.stringify(card), /guest@example.com/);
      const click = preparedDelivery("calendar_click", "slack", { kind: "interaction", actionId: button.action_id, messageRef: { id: "pref_v1_calendar_message_123" } });
      // A different human cannot use the requester's approval.
      await gateway.deliver({ ...proposal, deliveryId: click.deliveryId, turn: { ...click.turn, actor: { ...actor, externalUserId: "someone_else" } } });
      assert.equal(writes, 0);
      await gateway.deliver({ ...proposal, deliveryId: "dlv_calendar_correct_click", turn: { ...click.turn, actor: proposal.turn.actor } });
      assert.equal(writes, 1);
      assert.ok(gateway.packets.some(packet => packet.payload.kind === "slack.message.replace" && JSON.stringify(packet.payload).includes(created.url)));
      await gateway.deliver({ ...proposal, deliveryId: "dlv_calendar_repeated_click", turn: { ...click.turn, actor: proposal.turn.actor } });
      assert.equal(writes, 1);
    } finally { await handle.stop(); }
  });

  it("propagates terminated provider delivery instead of continuing the agent on a closed connection", async () => {
    const gateway = new ManagedGateway();
    const channel = createChannel({ name: "support", identifyUser: "platform" });
    const failure = new ChannelDeliveryTerminatedError("Provider rejected the card");
    const tool = calendarInviteTool({
      configured: () => true,
      target: async () => { throw failure; },
      create: async () => { assert.fail("must not write"); },
    });
    let checked = false;
    channel.onMessage(async ({ thread }) => {
      await assert.rejects(async () => tool.handler(invite, {
        thread: concreteThread(thread), user: null, platform: "slack", actor: { id: "requester", kind: "human" },
      }), error => error === failure);
      checked = true;
    });
    const handle = await startChannelsWithGatewayControl([channel], {
      session: gateway, scope: { projectId: 1, channelName: "support" }, runtimeInstanceId: "rti_calendar_error",
      loadHistory: async () => [], runCanonical: async args => args.execute({}),
    });
    try {
      await gateway.deliver(preparedDelivery("calendar_error", "slack", { kind: "text", text: "Invite the team" }));
      assert.equal(checked, true);
    } finally { await handle.stop(); }
  });
});
