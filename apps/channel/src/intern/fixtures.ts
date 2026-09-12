import type { Briefing } from "./types";

/**
 * Deliberately local demo data. The work-memory owner will replace this module
 * with its evidence-backed state reader without changing the Slack card.
 */
export const fixtureBriefing: Briefing = {
  owner: "Alex",
  generatedAt: "Today, 08:30 SGT",
  selectedThreads: ["#client-proposal", "#pricing-review"],
  commitments: [
    {
      id: "proposal-friday",
      title: "Send the client proposal",
      due: "Friday",
      status: "waiting",
      dependency: "Pricing approval is still pending",
      evidence: [
        {
          thread: "#client-proposal",
          message: "Alex: I will send the proposal by Friday.",
          freshness: "Yesterday, 16:10",
        },
        {
          thread: "#pricing-review",
          message: "Pricing needs approval before the proposal can go out.",
          freshness: "Today, 08:05",
        },
      ],
    },
    {
      id: "design-notes",
      title: "Share design-review notes",
      due: "No date stated",
      status: "open",
      evidence: [
        {
          thread: "#client-proposal",
          message: "Alex: I will share the design notes after the review.",
          freshness: "Yesterday, 16:22",
        },
      ],
    },
  ],
};
