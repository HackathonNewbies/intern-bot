/** A minimal, provider-neutral message shape passed from Slack access to memory. */
export interface SelectedThreadMessage {
  threadId: string;
  messageId: string;
  author: string;
  text: string;
  sentAt: string;
}

/** Implement this in the work-memory module when durable storage is ready. */
export interface WorkMemoryStore {
  saveMessage(message: SelectedThreadMessage): Promise<void>;
}

/**
 * The only entry point for storing a message obtained from a selected thread.
 * Callers must enforce the selected-thread access check before calling this.
 */
export async function ingestSelectedThreadMessage(
  message: SelectedThreadMessage,
  store: WorkMemoryStore,
): Promise<void> {
  if (!message.threadId || !message.messageId || !message.text.trim()) {
    throw new Error("A stored message needs a thread ID, message ID, and text.");
  }
  await store.saveMessage(message);
}

/** Local-only adapter for fixtures and tests; it does not persist across restart. */
export function createInMemoryWorkMemoryStore(): WorkMemoryStore & {
  messages: SelectedThreadMessage[];
} {
  const messages: SelectedThreadMessage[] = [];
  return {
    messages,
    async saveMessage(message) {
      const index = messages.findIndex((saved) => saved.messageId === message.messageId);
      if (index >= 0) messages[index] = message;
      else messages.push(message);
    },
  };
}
