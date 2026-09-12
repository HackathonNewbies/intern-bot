import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToIR } from "@copilotkit/channels";
import { fixtureBriefing } from "./fixtures";
import { onboardingMessage, personalBriefing } from "./briefing";

async function render(node: unknown): Promise<string> {
  return JSON.stringify(renderToIR((await node) as never));
}

describe("personal briefing", () => {
  it("limits the fixture to selected threads and preserves both evidence sources", async () => {
    const out = await render(personalBriefing(fixtureBriefing));
    assert.ok(out.includes("#client-proposal"));
    assert.ok(out.includes("#pricing-review"));
    assert.ok(out.includes("Pricing approval is still pending"));
  });

  it("offers safe fake-service actions for every commitment", async () => {
    const out = await render(personalBriefing(fixtureBriefing));
    assert.equal((out.match(/Mark complete/g) ?? []).length, 2);
    assert.equal((out.match(/Correct/g) ?? []).length, 2);
    assert.equal((out.match(/Propose calendar block/g) ?? []).length, 2);
    assert.ok(out.includes("make no external changes"));
  });

  it("explains the private briefing entry point", async () => {
    const out = await render(onboardingMessage());
    assert.ok(out.includes("/briefing"));
  });
});
