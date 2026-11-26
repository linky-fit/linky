import { encodeNpub, type Pubkey } from "@linky-fit/linkstr";
import { makeIdentity } from "@linky-fit/linkstr/testing";
import { describe, expect, it } from "vitest";
import type { OperatorProfile } from "../domain/profile";
import { enqueueReceipt } from "./testing/fakes";
import { createWatcherAlerts } from "./watchers";

const profileWith = (watchers: readonly Pubkey[]): OperatorProfile => ({
  name: "On-chain operator",
  xpub: "tpub",
  sendFeeBasisPoints: 100,
  receiveFeeBasisPoints: 100,
  paused: false,
  description: "",
  amounts: [100_000],
  maxReceiveAmount: 1_000_000,
  minReceiveAmount: 100_000,
  minClientVersion: null,
  watchers,
  picture: null,
});

describe("createWatcherAlerts", () => {
  it("messages every watcher", async () => {
    const [user, first, second] = [
      makeIdentity().pubkey,
      makeIdentity().pubkey,
      makeIdentity().pubkey,
    ];
    const sent: { to: Pubkey; text: string; ref: string }[] = [];
    const alert = createWatcherAlerts({
      nostr: {
        sendText: async (to, text, _clientId, ref) => {
          sent.push({ to, text, ref });
          return enqueueReceipt(sent.length, ref);
        },
      },
      loadProfile: async () => profileWith([first, second]),
    });

    await alert({ _tag: "message", from: user, text: "Hi" });

    expect(sent.map(({ to }) => to)).toEqual([first, second]);
    expect(sent[0]?.text).toBe(`${encodeNpub(user)} wrote: "Hi"`);
    expect(sent.every(({ ref }) => ref.startsWith("watcher:"))).toBe(true);
  });

  it("passes on no message a watcher wrote", async () => {
    const [watcher, other] = [makeIdentity().pubkey, makeIdentity().pubkey];
    const sent: Pubkey[] = [];
    await createWatcherAlerts({
      nostr: {
        sendText: async (to, _text, _clientId, ref) => {
          sent.push(to);
          return enqueueReceipt(sent.length, ref);
        },
      },
      loadProfile: async () => profileWith([watcher, other]),
    })({ _tag: "message", from: watcher, text: "On it." });
    expect(sent).toEqual([]);
  });

  it("sends nothing without a saved profile or watchers", async () => {
    let sends = 0;
    const nostr = {
      sendText: async () => {
        sends += 1;
        throw new Error("unexpected");
      },
    };
    const user = makeIdentity().pubkey;
    await createWatcherAlerts({
      nostr,
      loadProfile: async () => null,
    })({ _tag: "message", from: user, text: "Hi" });
    await createWatcherAlerts({
      nostr,
      loadProfile: async () => profileWith([]),
    })({ _tag: "message", from: user, text: "Hi" });
    expect(sends).toBe(0);
  });

  it("merges and deduplicates extraWatchers with profile watchers, even without a saved profile", async () => {
    const [user, synced, extra] = [
      makeIdentity().pubkey,
      makeIdentity().pubkey,
      makeIdentity().pubkey,
    ];
    const sent: Pubkey[] = [];
    const sendText = async (
      to: Pubkey,
      _text: string,
      _clientId: string,
      ref: string,
    ) => {
      sent.push(to);
      return enqueueReceipt(sent.length, ref);
    };

    await createWatcherAlerts({
      nostr: { sendText },
      loadProfile: async () => null,
      extraWatchers: [extra],
    })({ _tag: "message", from: user, text: "Hello" });
    expect(sent).toEqual([extra]);

    sent.length = 0;
    await createWatcherAlerts({
      nostr: { sendText },
      loadProfile: async () => profileWith([synced, extra]),
      extraWatchers: [extra],
    })({ _tag: "message", from: user, text: "Hello again" });
    expect(sent).toEqual([synced, extra]);

    sent.length = 0;
    await createWatcherAlerts({
      nostr: { sendText },
      loadProfile: async () => profileWith([synced]),
      extraWatchers: [extra],
    })({ _tag: "message", from: extra, text: "From watcher" });
    expect(sent).toEqual([]);
  });
});
