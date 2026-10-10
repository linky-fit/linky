import {
  BankOfferDraft,
  BankOfferId,
  ClientId,
  MessageText,
  NostrTransport,
  OutboxRef,
  OutboxStore,
  ProfileMetadata,
  SeenReceiptDraft,
  StoredOutboxJob,
  TextMessageDraft,
  UnixSeconds,
} from "@linky-fit/linkstr";
import { recipientOf, stubStorage } from "@linky-fit/linkstr/testing";
import type { StubStorage } from "@linky-fit/linkstr/testing";
import { Deferred, Effect, Exit, Layer, Schema } from "effect";
import { linkstrCommands } from "./commands";
import { linkstrConfigAtom } from "./config";
import { AtomRegistry } from "./index";
import { relayHealthAtom } from "./relayHealth";
import { configWith, fakeTransport, makeIdentity, relayB } from "./testing";
import type { PublishedEvent } from "./testing";

const alice = makeIdentity();
const bob = makeIdentity();
const carol = makeIdentity();

const storageKey = "test.outbox";

const decodeStoredJobs = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Array(StoredOutboxJob)),
);

const storedJobs = (storage: StubStorage) =>
  decodeStoredJobs(storage.map.get(storageKey) ?? "[]");

/** Accepts every publish, but only once `gate` has been opened. */
const gatedTransport = (
  published: Array<PublishedEvent>,
  gate: Deferred.Deferred<void>,
) => {
  const base = fakeTransport(published, []);
  return Layer.succeed(NostrTransport, {
    ...base,
    publish: (relays, event) =>
      Effect.andThen(Deferred.await(gate), base.publish(relays, event)),
  });
};

const textInput = (ref: string) => ({
  op: {
    _tag: "chat.text" as const,
    draft: new TextMessageDraft({
      to: bob.pubkey,
      content: MessageText.make("hello"),
      clientId: ClientId.make(`client-${ref}`),
    }),
  },
  ref: OutboxRef.make(ref),
});

const bankOffer = (offerId: string) =>
  new BankOfferDraft({
    to: bob.pubkey,
    offerId: BankOfferId.make(offerId),
    offerer: alice.pubkey,
    status: "offered",
    amountText: "250 Kč",
    text: "Pay this for me?",
    clientId: ClientId.make(`client-${offerId}`),
  });

/** Lets a rebuilt runtime run anything it would re-run on its own. */
const settleRebuild = async (registry: AtomRegistry.AtomRegistry) => {
  await linkstrCommands(registry).fetchOwnMuteList();
  await new Promise((resolve) => setTimeout(resolve, 50));
};

describe("linkstrCommands", () => {
  it("does not repeat an enqueue or a publish when the config changes", async () => {
    const registry = AtomRegistry.make();
    const storage = stubStorage();
    const published: Array<PublishedEvent> = [];
    const config = configWith(
      alice,
      Layer.succeed(NostrTransport, fakeTransport(published, [])),
      { outboxStore: OutboxStore.fromStringStorage(storage, storageKey) },
    );
    registry.set(linkstrConfigAtom, config);
    const commands = linkstrCommands(registry);

    assert(Exit.isSuccess(await commands.enqueueOutbox(textInput("row-1"))));
    assert(
      Exit.isSuccess(
        await commands.publishProfile(new ProfileMetadata({ name: "alice" })),
      ),
    );
    await expect
      .poll(() => storedJobs(storage).map((job) => job.state._tag))
      .toEqual(["awaiting-ack"]);
    const publishedBefore = published.length;

    registry.set(linkstrConfigAtom, { ...config, inspector: true });
    registry.set(linkstrConfigAtom, { ...config, writeRelays: [relayB] });
    await settleRebuild(registry);

    expect(storedJobs(storage)).toHaveLength(1);
    expect(published).toHaveLength(publishedBefore);
    expect(published.filter((event) => event.kind === 0)).toHaveLength(1);
  });

  it("sends nothing under a new key after an identity switch", async () => {
    const registry = AtomRegistry.make();
    const published: Array<PublishedEvent> = [];
    const transport = Layer.succeed(
      NostrTransport,
      fakeTransport(published, []),
    );
    registry.set(linkstrConfigAtom, configWith(alice, transport));
    const commands = linkstrCommands(registry);

    await commands.publishProfile(new ProfileMetadata({ name: "alice" }));
    await commands.publishMuteList([carol.pubkey]);
    await commands.sendSeenReceipt(
      new SeenReceiptDraft({
        to: carol.pubkey,
        sinceSec: UnixSeconds.make(1_754_000_000),
        seenUpToSec: UnixSeconds.make(1_754_000_060),
        clientId: ClientId.make("client-seen"),
      }),
    );
    expect(published.map(recipientOf)).toContain(alice.pubkey);

    registry.set(linkstrConfigAtom, configWith(bob, transport));
    await settleRebuild(registry);

    expect(published.filter((event) => event.pubkey === bob.pubkey)).toEqual(
      [],
    );
    expect(published.map(recipientOf)).not.toContain(bob.pubkey);
  });

  it("interrupts a run in flight when the runtime is rebuilt, without re-sending it", async () => {
    const registry = AtomRegistry.make();
    const published: Array<PublishedEvent> = [];
    const gate = Deferred.makeUnsafe<void>();
    const transport = gatedTransport(published, gate);
    registry.set(linkstrConfigAtom, configWith(alice, transport));

    const pending = linkstrCommands(registry).publishProfile(
      new ProfileMetadata({ name: "alice" }),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    registry.set(linkstrConfigAtom, configWith(bob, transport));
    const exit = await pending;
    Deferred.doneUnsafe(gate, Exit.void);
    await settleRebuild(registry);

    expect(Exit.hasInterrupts(exit)).toBe(true);
    expect(published).toEqual([]);
  });

  it("runs concurrent calls separately, each resolving with its own receipt", async () => {
    const registry = AtomRegistry.make();
    const published: Array<PublishedEvent> = [];
    const gate = Deferred.makeUnsafe<void>();
    registry.set(
      linkstrConfigAtom,
      configWith(alice, gatedTransport(published, gate)),
    );
    const commands = linkstrCommands(registry);

    const first = commands.sendBankOffer(bankOffer("offer-1"));
    const second = commands.sendBankOffer(bankOffer("offer-2"));
    Deferred.doneUnsafe(gate, Exit.void);
    const [firstExit, secondExit] = await Promise.all([first, second]);

    assert(Exit.isSuccess(firstExit) && Exit.isSuccess(secondExit));
    expect(firstExit.value.offerId).toBe("offer-1");
    expect(secondExit.value.offerId).toBe("offer-2");
    expect(firstExit.value.rumorId).not.toBe(secondExit.value.rumorId);
    // Peer and self copy of each offer.
    expect(published).toHaveLength(4);
  });

  it("completes a run after the last subscriber of the runtime unmounts", async () => {
    const registry = AtomRegistry.make();
    const published: Array<PublishedEvent> = [];
    const gate = Deferred.makeUnsafe<void>();
    registry.set(
      linkstrConfigAtom,
      configWith(alice, gatedTransport(published, gate)),
    );
    const unmount = registry.mount(relayHealthAtom);

    const pending = linkstrCommands(registry).sendBankOffer(
      bankOffer("offer-1"),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    unmount();
    await new Promise((resolve) => setTimeout(resolve, 20));
    Deferred.doneUnsafe(gate, Exit.void);
    const exit = await pending;

    assert(Exit.isSuccess(exit));
    expect(exit.value.offerId).toBe("offer-1");
    expect(published).toHaveLength(2);
  });
});
