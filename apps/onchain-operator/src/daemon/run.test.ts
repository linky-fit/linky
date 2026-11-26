import { createId, OnchainTransferId } from "@linky-fit/domain";
import {
  encodeNostrPaymentRequest,
  PaymentRequestId,
} from "@linky-fit/linkshu";
import {
  ClientId,
  encodeNprofile,
  encodeNpub,
  InboxCursorStore,
  linkstrServices,
  MessageText,
  NostrTransport,
  Outbox,
  OutboxRef,
  OutboxStore,
  RelayPublishResult,
  RelayUrl,
  TextMessageDraft,
  UnixSeconds,
  WrapInbox,
  type WrapInboxEvent,
} from "@linky-fit/linkstr";
import { makeIdentity } from "@linky-fit/linkstr/testing";
import {
  deriveDepositAddress,
  onchainTransferChannel,
  parseDepositXpub,
  type OnchainTransferUpdate,
} from "@linky-fit/onchain-transfer";
import { Effect, Layer, ManagedRuntime, Option, Stream } from "effect";
import { describe, expect, it } from "vitest";
import { saveProfile } from "../storage/profile";
import { startOperatorDaemon } from "./run";

// Dev fixture recovery seed and tpub from README.md (regtest only).
const DEV_SEED =
  "hand pregnant academic academic curious twin literary criminal teaspoon academic lying empty pipeline infant axle failure repair exotic frequent march";
const DEV_TPUB =
  "tpubDDfvzhdVV4unsoKt5aE6dcsNsfeWbTgmLZPi8LQDYU2xixrYemMfWJ3BaVneH3u7DBQePdTwhpybaKRU95pi6PMUtLPBJLVQRpzEnjfjZzX";
const RELAY = RelayUrl.make("wss://relay.test");
const MINT_URL = "http://localhost:3338";

interface RoutedEvent {
  readonly id: string;
  readonly pubkey: string;
  readonly created_at: number;
  readonly kind: number;
  readonly tags: string[][];
  readonly content: string;
  readonly sig: string;
}

/** Minimal in-memory Nostr relay storing published wraps and routing them to matching subscribers. */
const makeMemoryTransport = (): Layer.Layer<NostrTransport> => {
  const stored: RoutedEvent[] = [];
  const subscribers = new Set<{
    readonly recipients: ReadonlySet<string> | null;
    readonly onEvent: (event: RoutedEvent) => void;
  }>();

  const matches = (
    recipients: ReadonlySet<string> | null,
    event: RoutedEvent,
  ): boolean => {
    if (recipients === null) return true;
    const pTag = event.tags.find((tag) => tag[0] === "p")?.[1] ?? null;
    return pTag !== null && recipients.has(pTag);
  };

  return Layer.succeed(NostrTransport, {
    publish: (relays, event) =>
      Effect.sync(() => {
        const raw: RoutedEvent = {
          id: event.id,
          pubkey: event.pubkey,
          created_at: event.created_at,
          kind: event.kind,
          tags: event.tags.map((tag) => [...tag]),
          content: event.content,
          sig: event.sig,
        };
        stored.push(raw);
        for (const sub of subscribers) {
          if (matches(sub.recipients, raw)) sub.onEvent(raw);
        }
        return relays.map(
          (relay) =>
            new RelayPublishResult({ relay, accepted: true, detail: null }),
        );
      }),
    subscribe: (_relay, filters, onEvent, options) =>
      Effect.callback<string>(() => {
        const recipientsList = filters.flatMap((filter) => filter["#p"] ?? []);
        const entry = {
          recipients:
            recipientsList.length > 0 ? new Set(recipientsList) : null,
          onEvent,
        };
        subscribers.add(entry);
        queueMicrotask(() => {
          for (const event of stored) {
            if (matches(entry.recipients, event)) onEvent(event);
          }
          options?.onEose?.();
        });
        return Effect.sync(() => {
          subscribers.delete(entry);
        });
      }),
    fetch: () => Effect.succeed([]),
  });
};

const makePeerClient = (transport: Layer.Layer<NostrTransport>) => {
  const identity = makeIdentity();
  const runtime = ManagedRuntime.make(
    linkstrServices({
      secretKey: identity.secretKey,
      readRelays: [RELAY],
      writeRelays: [RELAY],
      transport,
      outboxStore: OutboxStore.inMemory,
      inboxCursorStore: InboxCursorStore.inMemory,
    }),
  );
  const received: WrapInboxEvent[] = [];
  const listeners = new Set<() => void>();
  const since = UnixSeconds.make(Math.floor(Date.now() / 1000) - 60);
  runtime.runFork(
    Effect.scoped(
      Effect.gen(function* () {
        const inbox = yield* WrapInbox;
        const feed = yield* inbox.open({ since });
        yield* Stream.runForEach(feed.events, ({ event, ack }) =>
          Effect.sync(() => {
            received.push(event);
            for (const notify of listeners) notify();
          }).pipe(Effect.flatMap(() => ack)),
        );
      }),
    ),
  );

  const waitFor = <T>(
    predicate: (events: readonly WrapInboxEvent[]) => T | undefined,
    timeoutMs = 5_000,
  ): Promise<T> =>
    new Promise((resolve, reject) => {
      const existing = predicate(received);
      if (existing !== undefined) {
        resolve(existing);
        return;
      }
      const timer = setTimeout(() => {
        listeners.delete(check);
        reject(new Error("Timed out waiting for peer inbox event"));
      }, timeoutMs);
      const check = () => {
        const found = predicate(received);
        if (found !== undefined) {
          clearTimeout(timer);
          listeners.delete(check);
          resolve(found);
        }
      };
      listeners.add(check);
    });

  return {
    identity,
    runtime,
    waitFor,
    sendAppMessage: (
      draft: ReturnType<typeof onchainTransferChannel.draft>,
      ref: string,
    ) =>
      runtime.runPromise(
        Effect.flatMap(Outbox, (outbox) =>
          outbox.enqueue({ _tag: "appMessage", draft }, OutboxRef.make(ref)),
        ),
      ),
    sendText: (to: typeof identity.pubkey, text: string) =>
      runtime.runPromise(
        Effect.flatMap(Outbox, (outbox) =>
          outbox.enqueue(
            {
              _tag: "chat.text",
              draft: new TextMessageDraft({
                to,
                content: MessageText.make(text),
                clientId: ClientId.make(createId()),
              }),
            },
            OutboxRef.make(`text:${createId()}`),
          ),
        ),
      ),
    dispose: () => runtime.dispose(),
  };
};

describe("startOperatorDaemon", () => {
  it("fails cleanly on an invalid recovery seed without echoing it", async () => {
    const badSeed = "not a real secret seed phrase";
    const error = await startOperatorDaemon(
      {
        recoverySeed: badSeed,
        dataDir: ":memory:",
        extraWatchers: [],
        appConfig: {
          nostrRelays: [RELAY],
          evoluRelayDefaults: [],
          recommendedEvoluRelays: [],
          mintUrl: MINT_URL,
          allowInsecureLocalhostRelays: false,
          blossomServerUrl: "http://blossom.test",
          network: "regtest",
          esploraUrl: "http://esplora.test",
          explorerUrl: "http://explorer.test",
        },
      },
      { inMemory: true, logger: { info: () => {}, warn: () => {} } },
    ).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(Error);
    if (error instanceof Error) {
      expect(error.message).toMatch(/Invalid recovery seed/u);
      expect(error.message).not.toContain(badSeed);
    }
  });

  it("replies with deposit address for receives, payment request for sends, and alerts watchers on activity", async () => {
    const transport = makeMemoryTransport();
    const user = makePeerClient(transport);
    const extraWatcher = makePeerClient(transport);
    const syncedWatcher = makePeerClient(transport);

    const daemon = await startOperatorDaemon(
      {
        recoverySeed: DEV_SEED,
        dataDir: ":memory:",
        extraWatchers: [extraWatcher.identity.pubkey],
        appConfig: {
          nostrRelays: [RELAY],
          evoluRelayDefaults: [],
          recommendedEvoluRelays: [],
          mintUrl: MINT_URL,
          allowInsecureLocalhostRelays: false,
          blossomServerUrl: "http://blossom.test",
          network: "regtest",
          esploraUrl: "http://esplora.test",
          explorerUrl: "http://explorer.test",
        },
      },
      {
        inMemory: true,
        transport,
        // Empty tx history so deposit address #0 is unused.
        esploraFetch: async () =>
          new Response(JSON.stringify([]), { status: 200 }),
        logger: { info: () => {}, warn: () => {} },
      },
    );

    try {
      await Effect.runPromise(
        saveProfile(daemon.services.repositories.settings, {
          name: "Test operator",
          xpub: DEV_TPUB,
          sendFeeBasisPoints: 100,
          receiveFeeBasisPoints: 100,
          paused: false,
          description: "",
          amounts: [100_000],
          maxReceiveAmount: 1_000_000,
          minReceiveAmount: 50_000,
          minClientVersion: null,
          watchers: [syncedWatcher.identity.pubkey],
          picture: null,
        }),
      );

      // 1. On-chain receive: daemon replies with deposit address #0.
      const receiveId = createId<"OnchainTransfer">();
      const userPaymentRequest = encodeNostrPaymentRequest({
        amount: 100_000,
        mintUrls: [MINT_URL],
        recipientNprofile: encodeNprofile(user.identity.pubkey, [RELAY]),
        requestId: PaymentRequestId.make(receiveId),
      });
      await user.sendAppMessage(
        onchainTransferChannel.draft(daemon.account.pubkey, {
          v: 1,
          type: "request",
          transferId: receiveId,
          direction: "receive",
          amount: 100_000,
          feeBasisPoints: 100,
          refund: { to: "sender" },
          paymentRequest: userPaymentRequest,
        }),
        `req:${receiveId}`,
      );

      const receiveUpdate = await user.waitFor(
        (events): OnchainTransferUpdate | undefined => {
          for (const event of events) {
            if (event._tag !== "AppMessageReceived") continue;
            const decoded = Option.getOrNull(
              onchainTransferChannel.decode(event),
            );
            if (
              decoded?.type === "update" &&
              decoded.transferId === receiveId
            ) {
              return decoded;
            }
          }
          return undefined;
        },
      );
      const parsedTpub = parseDepositXpub(DEV_TPUB, "regtest");
      expect(parsedTpub).not.toBeNull();
      const expectedAddress0 =
        parsedTpub === null
          ? ""
          : deriveDepositAddress({
              xpub: parsedTpub,
              index: 0,
              network: "regtest",
            });
      expect(receiveUpdate.status).toBe("accepted");
      expect(receiveUpdate.depositAddress).toBe(expectedAddress0);

      // 2. On-chain send: daemon replies with accepted + NUT-18 payment request.
      const sendId = createId<"OnchainTransfer">();
      await user.sendAppMessage(
        onchainTransferChannel.draft(daemon.account.pubkey, {
          v: 1,
          type: "request",
          transferId: sendId,
          direction: "send",
          amount: 100_000,
          feeBasisPoints: 100,
          payoutAddress: expectedAddress0,
        }),
        `req:${sendId}`,
      );

      const sendUpdate = await user.waitFor(
        (events): OnchainTransferUpdate | undefined => {
          for (const event of events) {
            if (event._tag !== "AppMessageReceived") continue;
            const decoded = Option.getOrNull(
              onchainTransferChannel.decode(event),
            );
            if (decoded?.type === "update" && decoded.transferId === sendId) {
              return decoded;
            }
          }
          return undefined;
        },
      );
      expect(sendUpdate.status).toBe("accepted");
      expect(sendUpdate.paymentRequest).toMatch(/^creqA/u);
      expect(OnchainTransferId.is(sendUpdate.transferId)).toBe(true);

      // 3. Incoming user message alerts both synced watchers and OPERATOR_WATCHERS.
      await user.sendText(daemon.account.pubkey, "Hello operator!");
      const expectedAlert = `${encodeNpub(user.identity.pubkey)} wrote: "Hello operator!"`;
      const extractText = (events: readonly WrapInboxEvent[]) => {
        for (const event of events) {
          if (
            event._tag === "ChatMessageReceived" &&
            event.body._tag === "TextBody" &&
            event.body.text === expectedAlert
          ) {
            return event.body.text;
          }
        }
        return undefined;
      };
      expect(await extraWatcher.waitFor(extractText)).toBe(expectedAlert);
      expect(await syncedWatcher.waitFor(extractText)).toBe(expectedAlert);
    } finally {
      await daemon.stop();
      await Promise.all([
        user.dispose(),
        extraWatcher.dispose(),
        syncedWatcher.dispose(),
      ]);
    }
  });
});
