import type { BriefingAction, Commitment } from "./types";

export interface FakeInternServices {
  route(action: BriefingAction, commitment: Commitment): Promise<string>;
}

/**
 * Safe integration seam for the first vertical slice. It records no state and
 * makes no external write; later owners can substitute persistence/calendar
 * adapters behind this small interface.
 */
export const fakeInternServices: FakeInternServices = {
  async route(action, commitment) {
    switch (action) {
      case "complete":
        return `Fake service: marked “${commitment.title}” complete. No real record changed.`;
      case "correct":
        return `Fake service: opened a correction for “${commitment.title}”. No real record changed.`;
      case "calendar":
        return `Fake service: drafted a calendar-block proposal for “${commitment.title}”. No calendar event was created.`;
    }
  },
};
