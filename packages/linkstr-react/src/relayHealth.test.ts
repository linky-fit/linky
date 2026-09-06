import { ClientId, RetractionDraft, RumorId } from "@linky/linkstr";
import type { RelayHealthState } from "@linky/linkstr";
import { stubWrapTransport } from "@linky/linkstr/testing";
import { Exit } from "effect";
import { linkstrConfigAtom } from "./config";
import { Registry, Result } from "./index";
import { retractReactionAtom } from "./reactions";
import { relayHealthAtom } from "./relayHealth";
import { configWith, makeIdentity, relayA, settle } from "./testing";

const alice = makeIdentity();
const bob = makeIdentity();

const draft = new RetractionDraft({
  to: bob.pubkey,
  reactionIds: [RumorId.make("ab".repeat(32))],
  clientId: ClientId.make("client-relay-health"),
});

const healthOf = (
  registry: Registry.Registry,
  relay: string,
): RelayHealthState | undefined => {
  const result = registry.get(relayHealthAtom);
  return Result.isSuccess(result) ? result.value.get(relay) : undefined;
};

describe("relayHealthAtom", () => {
  it("reflects traffic-derived relay health after a publish", async () => {
    const registry = Registry.make();
    registry.set(linkstrConfigAtom, configWith(alice, stubWrapTransport([])));
    const unmount = registry.mount(relayHealthAtom);

    await expect
      .poll(() => Result.isSuccess(registry.get(relayHealthAtom)))
      .toBe(true);
    expect(healthOf(registry, relayA)).toBeUndefined();

    registry.set(retractReactionAtom, draft);
    const exit = await settle(registry, retractReactionAtom);
    assert(Exit.isSuccess(exit));

    await expect
      .poll(() => healthOf(registry, relayA)?.state)
      .toBe("connected");
    expect(healthOf(registry, relayA)).toEqual(
      expect.objectContaining({
        state: "connected",
        detail: null,
        lastPublish: expect.objectContaining({ accepted: true, detail: null }),
      }),
    );

    unmount();
    registry.dispose();
  });
});
