/** Evidence-backed work shown in a person's private briefing. */
export type CommitmentStatus = "open" | "waiting" | "completed";

export interface Evidence {
  thread: string;
  message: string;
  freshness: string;
}

export interface Commitment {
  id: string;
  title: string;
  due: string;
  status: CommitmentStatus;
  dependency?: string;
  evidence: Evidence[];
}

export interface Briefing {
  owner: string;
  generatedAt: string;
  commitments: Commitment[];
  selectedThreads: string[];
}

export type BriefingAction = "complete" | "correct" | "calendar";
