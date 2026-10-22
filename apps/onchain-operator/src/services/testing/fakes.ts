import { createAppOwner, OwnerSecret } from "@evolu/common";
import {
  DecodedToken,
  encodeToken,
  OperationId,
  ReceiveReceipt,
  SendReceipt,
  type ReceiveError,
} from "@linky-fit/linkshu";
import {
  AppMessageReceived,
  ChatMessageReceived,
  ClientId,
  EnqueueReceipt,
  OutboxJobId,
  OutboxRef,
  RumorId,
  TextBody,
  UnixSeconds,
  type AppMessageDraft,
  type Pubkey,
  type RelayUrl,
} from "@linky-fit/linkstr";
import { makeIdentity } from "@linky-fit/linkstr/testing";
import {
  createLinkyStore,
  linkyTableColumns,
  makeInMemoryShardDb,
  type LinkyDbSchema,
} from "@linky-fit/linksync";
import {
  EsploraError,
  onchainTransferChannel,
  type EsploraClient,
  type EsploraTransaction,
  type OnchainTransferMessage,
} from "@linky-fit/onchain-transfer";
import { Effect, Option, Result, Schema } from "effect";
import type { InboxHandler, Nostr, OutboxResultHandler } from "../nostr";
import type { Wallet } from "../wallet";

export const testMint = "http://localhost:3338";

/** A store over an in-memory database, where every owner counts as synced. */
export const testStore = () =>
  createLinkyStore(
    makeInMemoryShardDb<LinkyDbSchema>(linkyTableColumns),
    createAppOwner(
      OwnerSecret.orThrow(crypto.getRandomValues(new Uint8Array(32))),
    ),
  );

export const enqueueReceipt = (index: number, ref: string): EnqueueReceipt =>
  new EnqueueReceipt({
    jobId: OutboxJobId.make(`job-${index}`),
    ref: OutboxRef.make(ref),
    rumorId: RumorId.make(index.toString(16).padStart(64, "0")),
    clientId: ClientId.make(`client-${index}`),
    sentAt: UnixSeconds.make(1_700_000_000 + index),
  });

export interface SentToken {
  readonly to: Pubkey;
  readonly token: string;
  readonly ref: string;
  readonly relays: readonly RelayUrl[];
}

/** A `Nostr` that records what it was asked to send; tests call the handlers directly. */
export const fakeNostr = () => {
  const inbox: InboxHandler[] = [];
  const outbox: { refPrefix: string; handler: OutboxResultHandler }[] = [];
  const appMessages: { draft: AppMessageDraft; ref: string }[] = [];
  const tokens: SentToken[] = [];
  const notices: Pubkey[] = [];
  const queued = new Set<string>();
  let sends = 0;
  const nostr: Nostr = {
    pubkey: makeIdentity().pubkey,
    nprofile: "nprofile1test",
    sendToken: async (to, token, ref, relays = []) => {
      tokens.push({ to, token, ref, relays });
      queued.add(ref);
      return enqueueReceipt((sends += 1), ref);
    },
    sendText: () => Promise.reject(new Error("fake nostr")),
    sendAppMessage: async (draft, ref) => {
      appMessages.push({ draft, ref });
      return enqueueReceipt((sends += 1), ref);
    },
    publishProfile: () => Promise.resolve(true),
    fetchProfiles: () => Promise.resolve(new Map()),
    publishAppData: () => Promise.resolve(true),
    sendPaymentNotice: async (to) => {
      notices.push(to);
    },
    queuedRefs: () => Promise.resolve(new Set(queued)),
    onInboxEvent: (handler) => {
      inbox.push(handler);
      return () => {};
    },
    onOutboxResult: (refPrefix, handler) => {
      outbox.push({ refPrefix, handler });
      return () => {};
    },
    start: () => {},
  };
  /** The transfer messages sent, decoded, oldest first. */
  const transferMessages = (): OnchainTransferMessage[] =>
    appMessages.map(({ draft }) =>
      Option.getOrThrow(
        onchainTransferChannel.decode(
          new AppMessageReceived({
            messageId: RumorId.make("ff".repeat(32)),
            from: nostr.pubkey,
            app: draft.app,
            content: draft.content,
            clientId: null,
            sentAt: UnixSeconds.make(1_700_000_000),
          }),
        ),
      ),
    );
  return {
    nostr,
    inbox,
    outbox,
    appMessages,
    transferMessages,
    tokens,
    notices,
    queued,
  };
};

let messageCount = 0;
const nextRumorId = () =>
  RumorId.make((messageCount += 1).toString(16).padStart(64, "a"));

/** A transfer message from `from` as the inbox delivers it. */
export const transferMessageFrom = (
  from: Pubkey,
  message: OnchainTransferMessage,
  sentAt = 1_700_000_100,
) => {
  const draft = onchainTransferChannel.draft(makeIdentity().pubkey, message);
  return new AppMessageReceived({
    messageId: nextRumorId(),
    from,
    app: draft.app,
    content: draft.content,
    clientId: null,
    sentAt: UnixSeconds.make(sentAt),
  });
};

/** A NIP-17 chat text from `from`, e.g. a NUT-18 payload. */
export const chatTextFrom = (
  from: Pubkey,
  text: string,
  sentAt = 1_700_000_200,
) =>
  new ChatMessageReceived({
    messageId: nextRumorId(),
    from,
    body: new TextBody({ text }),
    replyTo: null,
    root: null,
    editOf: null,
    clientId: null,
    sentAt: UnixSeconds.make(sentAt),
  });

/** Delivers an inbox event to every handler, as the inbox does. */
export const deliver = async (
  handlers: readonly InboxHandler[],
  event: Parameters<InboxHandler>[0],
) => {
  for (const handler of handlers) await handler(event, "live");
};

const proof = (amount: number) => ({
  id: "00ad268c4d1f5826",
  amount,
  secret: `secret-${amount}`,
  C: "02".padEnd(66, "a"),
});

export const tokenOf = (amount: number) =>
  encodeToken(
    Schema.decodeUnknownSync(DecodedToken)({
      mint: testMint,
      unit: "sat",
      memo: null,
      proofs: [proof(amount)],
    }),
  );

/** The NUT-18 payload a wallet sends for the request `id`. */
export const nut18Payload = (id: string, amount: number, mint = testMint) =>
  JSON.stringify({ id, mint, unit: "sat", proofs: [proof(amount)] });

export const receiveReceipt = (
  amount: number,
  operationId = "receive-1",
  mint = testMint,
) =>
  Schema.decodeUnknownSync(ReceiveReceipt)({
    operationId,
    tokenText: tokenOf(amount),
    mint,
    unit: "sat",
    amount,
  });

const sendReceipt = (amount: number, operationId: string) =>
  Schema.decodeUnknownSync(SendReceipt)({
    operationId,
    tokenText: tokenOf(amount),
    proofs: [proof(amount)],
    mint: testMint,
    unit: "sat",
    amount,
    lockTo: null,
    changeAmount: 0,
    feePaid: 0,
  });

/** A wallet whose receives answer from `answer` and whose sends always succeed; it records every call. */
export const fakeWallet = (
  answer: (text: string) => Result.Result<ReceiveReceipt, ReceiveError> = (
    text,
  ) => Result.succeed(receiveReceipt(text.length)),
) => {
  const received: string[] = [];
  const sent: { amount: number; forRequest: boolean }[] = [];
  const forgotten: string[] = [];
  const returned: string[] = [];
  const done = new Set<string>();
  const wallet: Wallet = {
    receive: async (text) => {
      received.push(text);
      const result = answer(text);
      if (Result.isSuccess(result)) done.add(result.success.operationId);
      return result;
    },
    isReceived: async (operationId) => done.has(operationId),
    send: async (_mint, amount, forRequest) => {
      sent.push({ amount, forRequest });
      return Result.succeed(sendReceipt(amount, `send-${sent.length}`));
    },
    returnSend: async (operationId) => {
      returned.push(operationId);
      return true;
    },
    forgetSend: async (operationId) => {
      forgotten.push(operationId);
    },
    balances: () => Promise.reject(new Error("fake wallet")),
    issueToken: () => Promise.reject(new Error("fake wallet")),
    issuedTokens: () => Promise.reject(new Error("fake wallet")),
    checkClaims: () => Promise.reject(new Error("fake wallet")),
    takeBack: () => Promise.reject(new Error("fake wallet")),
    priceMelt: () => Promise.reject(new Error("fake wallet")),
    melt: () => Promise.reject(new Error("fake wallet")),
    resumeMelts: () => Promise.reject(new Error("fake wallet")),
  };
  return { wallet, received, sent, forgotten, returned, done };
};

export const operationId = (value: string) => OperationId.make(value);

/** An Esplora server whose transactions and tip the test sets. */
export const fakeEsplora = () => {
  const state = {
    tipHeight: 100,
    /** Address lookups fail while set. */
    offline: false,
    byAddress: new Map<string, EsploraTransaction[]>(),
    byTxid: new Map<string, EsploraTransaction>(),
  };
  const missing = (url: string) =>
    Effect.fail(new EsploraError({ url, status: 404, message: "not found" }));
  const esplora: EsploraClient = {
    addressTransactions: (address) =>
      state.offline
        ? Effect.fail(
            new EsploraError({
              url: `/address/${address}`,
              message: "offline",
            }),
          )
        : Effect.succeed(state.byAddress.get(address) ?? []),
    tipHeight: () => Effect.sync(() => state.tipHeight),
    transaction: (txid) => {
      const tx = state.byTxid.get(txid);
      return tx === undefined ? missing(`/tx/${txid}`) : Effect.succeed(tx);
    },
  };
  return { esplora, state };
};

/** A transaction paying `sats` to `address`, confirmed at `height` or unconfirmed. */
export const txPaying = (
  txid: string,
  address: string,
  sats: number,
  height: number | null = null,
): EsploraTransaction => ({
  txid,
  vout: [{ scriptpubkey_address: address, value: sats }],
  status:
    height === null
      ? { confirmed: false }
      : { confirmed: true, block_height: height },
});
