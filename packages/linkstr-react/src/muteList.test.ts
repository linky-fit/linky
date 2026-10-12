import { AtomRegistry } from "./index";
import type { FetchedMuteList } from "@linky-fit/linkstr";
import { finalizeEvent } from "nostr-tools";
import { linkstrConfigAtom } from "./config";
import { muteListWatchAtom, muteListWatchHandlerAtom } from "./muteList";
import { configWith, fakeTransportLayer, makeIdentity } from "./testing";
import type { FakeSubscription } from "./testing";

const alice = makeIdentity();
const bob = makeIdentity();

describe("muteListWatchAtom", () => {
  it("feeds the identity's newer mute lists through the handler", async () => {
    const registry = AtomRegistry.make();
    const subscriptions: Array<FakeSubscription> = [];
    const handled: Array<FetchedMuteList> = [];

    registry.set(
      linkstrConfigAtom,
      configWith(alice, fakeTransportLayer([], subscriptions)),
    );
    registry.set(muteListWatchHandlerAtom, {
      onList: (list) => {
        handled.push(list);
      },
    });
    const unmount = registry.mount(muteListWatchAtom);

    await expect.poll(() => subscriptions.length).toBe(1);
    expect(subscriptions[0]?.filter).toEqual({
      kinds: [10000],
      authors: [alice.pubkey],
    });

    subscriptions[0]?.onEvent(
      finalizeEvent(
        {
          kind: 10000,
          tags: [["p", bob.pubkey]],
          content: "",
          created_at: 1_754_000_000,
        },
        alice.secretKey,
      ),
    );
    await expect.poll(() => handled.length).toBe(1);
    expect(handled[0]?.pubkeys).toEqual([bob.pubkey]);
    unmount();
  });
});
