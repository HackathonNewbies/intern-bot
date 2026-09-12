import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createInMemoryWorkMemoryStore,
  ingestSelectedThreadMessage,
} from "./message-ingest";

const message = {
  threadId: "pricing-review",
  messageId: "msg-123",
  author: "Alex",
  text: "I will send the proposal by Friday.",
  sentAt: "2026-09-12T08:05:00+08:00",
};

describe("ingestSelectedThreadMessage", () => {
  it("passes a selected-thread message to the configured store", async () => {
    const store = createInMemoryWorkMemoryStore();
    await ingestSelectedThreadMessage(message, store);
    assert.deepEqual(store.messages, [message]);
  });

  it("updates a repeated message ID instead of creating a duplicate", async () => {
    const store = createInMemoryWorkMemoryStore();
    await ingestSelectedThreadMessage(message, store);
    await ingestSelectedThreadMessage({ ...message, text: "Friday EOD." }, store);
    assert.equal(store.messages.length, 1);
    assert.equal(store.messages[0]?.text, "Friday EOD.");
  });

  it("refuses an incomplete message before it reaches storage", async () => {
    const store = createInMemoryWorkMemoryStore();
    await assert.rejects(
      () => ingestSelectedThreadMessage({ ...message, text: "  " }, store),
      /needs a thread ID, message ID, and text/,
    );
  });
});
