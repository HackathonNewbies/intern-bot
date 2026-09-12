import { randomBytes } from "node:crypto";
import { CalendarError, type CreatedEvent, type Invite } from "./google";

export class CalendarApproval {
  readonly eventId = randomBytes(16).toString("hex");
  private state: "pending" | "cancelled" | "created" = "pending";
  private result?: CreatedEvent;
  private queue = Promise.resolve<unknown>(undefined);
  private attempted = false;

  constructor(
    readonly requester: string,
    readonly invite: Invite,
    private readonly create: (invite: Invite, id: string) => Promise<CreatedEvent>,
    private readonly expiresAt = Date.now() + 20 * 60_000,
  ) {}

  decide(requester: string, approve: boolean, now = Date.now()) {
    const decision = this.queue.then(async () => {
      if (requester !== this.requester) throw new CalendarError("Only the person who requested this invitation can approve or cancel it.");
      if (this.state === "created") return { state: this.state, event: this.result! } as const;
      if (this.state === "cancelled") return { state: this.state } as const;
      if (now > this.expiresAt) throw new CalendarError("This review expired. Check the calendar if you already attempted creation, then request a fresh review.");
      if (!approve) {
        if (this.attempted) throw new CalendarError("A creation attempt already reached Google. Retry Create to verify its outcome; this button cannot cancel a possibly created event.");
        this.state = "cancelled";
        return { state: this.state } as const;
      }
      this.attempted = true;
      this.result = await this.create(this.invite, this.eventId);
      this.state = "created";
      return { state: this.state, event: this.result } as const;
    });
    this.queue = decision.catch(() => undefined);
    return decision;
  }
}
