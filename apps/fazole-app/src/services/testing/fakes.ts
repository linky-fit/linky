import { createAppOwner, OwnerSecret } from "@evolu/common";
import {
  Bip39Seed,
  type ReceiveError,
  type ReceiveReceipt,
} from "@linky-fit/linkshu";
import { encodeNpub, OutboxStore } from "@linky-fit/linkstr";
import { makeIdentity, stubStorage } from "@linky-fit/linkstr/testing";
import {
  createLinkyStore,
  linkyTableColumns,
  makeInMemoryShardDb,
  type LinkyDbSchema,
} from "@linky-fit/linksync";
import type { KeyValueStorage } from "@linky-fit/linksync/evolu";
import type { Result } from "effect";
import type { AppConfig } from "../../config";
import type { Account } from "../../storage/account";
import { makeLedger } from "../../storage/ledger";
import { makeRepositories } from "../../storage/repositories";
import type { InboxHandler, Nostr, OutboxResultHandler } from "../nostr";
import { makeLinkshuRuntime } from "../runtimes";
import { createWallet, type Wallet } from "../wallet";

export const testMint = "http://localhost:3338";

export const testConfig: AppConfig = {
  nostrRelays: [],
  evoluRelayDefaults: [],
  recommendedEvoluRelays: [],
  mintUrl: testMint,
  allowInsecureLocalhostRelays: false,
};

/** An account with throwaway keys; nothing derives from its recovery seed. */
export const testAccount = (): Account => {
  const { secretKey, pubkey } = makeIdentity();
  return {
    recoverySeed: "test recovery seed",
    secretKey,
    pubkey,
    npub: encodeNpub(pubkey),
    appMnemonic: "",
    cashuSeed: Bip39Seed.make(crypto.getRandomValues(new Uint8Array(64))),
  };
};

/** A store over an in-memory database, where every owner counts as synced. */
export const testStore = () =>
  createLinkyStore(
    makeInMemoryShardDb<LinkyDbSchema>(linkyTableColumns),
    createAppOwner(
      OwnerSecret.orThrow(crypto.getRandomValues(new Uint8Array(32))),
    ),
  );

export const memoryKv = (): KeyValueStorage & {
  readonly entries: Map<string, string>;
} => {
  const entries = new Map<string, string>();
  return {
    entries,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => void entries.set(key, value),
    removeItem: (key) => void entries.delete(key),
  };
};

/** An outbox store whose jobs the test and the runtime share. */
export const sharedOutboxStore = () =>
  OutboxStore.fromStringStorage(stubStorage(), "outbox");

/** The account's ledger and a real wallet over in-memory stores; nothing reaches a network unless a test drives it. */
export const setup = () => {
  const account = testAccount();
  const store = testStore();
  const repositories = makeRepositories(store);
  const ledger = makeLedger(repositories.transactions);
  const wallet = createWallet(
    makeLinkshuRuntime({
      cashuSeed: account.cashuSeed,
      wallet: repositories.wallet,
    }),
    account.secretKey,
  );
  return { account, store, repositories, ledger, wallet };
};

/** A `Nostr` that only records handlers; tests call them directly. */
export const fakeNostr = (overrides: Partial<Nostr> = {}) => {
  const inbox: InboxHandler[] = [];
  const outbox: { refPrefix: string; handler: OutboxResultHandler }[] = [];
  const pubkey = makeIdentity().pubkey;
  const nostr: Nostr = {
    pubkey,
    nprofile: "nprofile1test",
    sendToken: () => Promise.reject(new Error("fake nostr")),
    sendText: () => Promise.reject(new Error("fake nostr")),
    sendPaymentNotice: () => Promise.resolve(),
    queuedRefs: () => Promise.resolve(new Set()),
    publishProfile: () => Promise.resolve(),
    fetchProfile: () => Promise.resolve(null),
    onInboxEvent: (handler) => {
      inbox.push(handler);
      return () => {};
    },
    onOutboxResult: (refPrefix, handler) => {
      outbox.push({ refPrefix, handler });
      return () => {};
    },
    start: () => {},
    ...overrides,
  };
  return { nostr, inbox, outbox };
};

/** Wraps a wallet so `receive` answers from `answer` and records its calls. */
export const scriptedReceive = (
  wallet: Wallet,
  answer: (text: string) => Result.Result<ReceiveReceipt, ReceiveError>,
  overrides: Partial<Wallet> = {},
) => {
  const calls: string[] = [];
  const scripted: Wallet = {
    ...wallet,
    ...overrides,
    receive: async (text) => {
      calls.push(text);
      return answer(text);
    },
  };
  return { wallet: scripted, calls };
};
