import { Registry } from "./index";
import {
  ClientId,
  MessageText,
  OutboxRef,
  OutboxStore,
  StoredOutboxJob,
  TextMessageDraft,
} from "@linky/linkstr";
import type { OutboxResult } from "@linky/linkstr";
import { stubStorage, stubWrapTransport } from "@linky/linkstr/testing";
import type { SignedWrapEvent } from "@linky/linkstr/testing";
import type { StubStorage } from "@linky/linkstr/testing";
import { Exit, Schema } from "effect";
import { linkstrConfigAtom } from "./config";
import {
  enqueueOutboxAtom,
  outboxResultsAtom,
  outboxResultsHandlerAtom,
} from "./outbox";
import { configWith, makeIdentity, settle } from "./testing";

const alice = makeIdentity();
const bob = makeIdentity();

const storageKey = "test.outbox";

const configOver = (published: Array<SignedWrapEvent>, storage: StubStorage) =>
  configWith(alice, stubWrapTransport(published), {
    outboxStore: OutboxStore.fromStringStorage(storage, storageKey),
  });

const decodeStoredJobs = Schema.decodeUnknownSync(
  Schema.parseJson(Schema.Array(StoredOutboxJob)),
);

const textInput = (ref: string) => ({
  op: {
    _tag: "chat.text" as const,
    draft: new TextMessageDraft({
      to: bob.pubkey,
      content: MessageText.make("hello"),
      clientId: ClientId.make("client-react"),
    }),
  },
  ref: OutboxRef.make(ref),
});

describe("outbox atoms", () => {
  it("enqueues, delivers, and acks only after the handler resolves", async () => {
    const storage = stubStorage();
    const registry = Registry.make();
    const published: Array<SignedWrapEvent> = [];
    registry.set(linkstrConfigAtom, configOver(published, storage));

    const handled: Array<OutboxResult> = [];
    registry.set(outboxResultsHandlerAtom, {
      onResult: async (result) => {
        handled.push(result);
      },
    });
    const unmount = registry.mount(outboxResultsAtom);

    registry.set(enqueueOutboxAtom, textInput("row-1"));
    const exit = await settle(registry, enqueueOutboxAtom);

    assert(Exit.isSuccess(exit));
    expect(exit.value.ref).toBe("row-1");
    expect(exit.value.rumorId).toMatch(/^[0-9a-f]{64}$/);
    expect(exit.value.clientId).toBe("client-react");

    await expect.poll(() => handled.length).toBe(1);
    expect(handled[0]).toEqual(
      expect.objectContaining({
        _tag: "OutboxJobSucceeded",
        jobId: exit.value.jobId,
        ref: "row-1",
      }),
    );
    expect(published).toHaveLength(2);

    // Acked after the handler resolved: the durable job list is empty again.
    await expect
      .poll(() => decodeStoredJobs(storage.map.get(storageKey) ?? "[]"))
      .toEqual([]);
    unmount();
  });

  it("does not ack when the handler rejects", async () => {
    const storage = stubStorage();
    const registry = Registry.make();
    registry.set(linkstrConfigAtom, configOver([], storage));

    let calls = 0;
    registry.set(outboxResultsHandlerAtom, {
      onResult: () => {
        calls += 1;
        return Promise.reject(new Error("persist failed"));
      },
    });
    const unmount = registry.mount(outboxResultsAtom);

    registry.set(enqueueOutboxAtom, textInput("row-1"));
    const exit = await settle(registry, enqueueOutboxAtom);
    expect(Exit.isSuccess(exit)).toBe(true);

    await expect.poll(() => calls).toBe(1);
    const jobs = decodeStoredJobs(storage.map.get(storageKey) ?? "[]");
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.state._tag).toBe("awaiting-ack");
    unmount();
  });
});
