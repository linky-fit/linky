import type { TransactionId } from "@linky-fit/domain";
import type {
  FiatRates,
  KeyValueStore,
  WalletBalances,
} from "@linky-fit/linkshu";
import type {
  InboxCursorStore,
  NostrTransport,
  OutboxStore,
  Pubkey,
} from "@linky-fit/linkstr";
import type { LinkyStore } from "@linky-fit/linksync";
import type { LiveSource } from "@linky-fit/linksync/react";
import { Effect, type Layer } from "effect";
import type { AppConfig } from "../config";
import type { CzkAmount, Payment, ShopProfile } from "../domain";
import type { Account } from "../storage/account";
import { makeLedger, type Ledger } from "../storage/ledger";
import {
  makeRepositories,
  whenHydrated,
  type Repositories,
} from "../storage/repositories";
import { readShop, saveShop } from "../storage/shop";
import { readOfferTips, saveOfferTips } from "../storage/tipSetting";
import {
  readLightningOnlyQr,
  saveLightningOnlyQr,
} from "../storage/bitcoinQrSetting";
import { readFazoleRecords, type FazoleRecords } from "../storage/transactions";
import {
  createBitcoinPayments,
  type BitcoinRequestFailure,
} from "./bitcoinPayments";
import { createNostr, type Nostr, type PayerProfile } from "./nostr";
import { uploadToBlossom, type ImageFile } from "./blossom";
import { createRates, type Rates } from "./rates";
import { createSupportChat, type SupportChat } from "./supportChat";
import { makeLinkshuRuntime, makeLinkstrRuntime } from "./runtimes";
import { createWallet, type Wallet } from "./wallet";
import { createWithdrawals, type Withdrawals } from "./withdrawals";

/** The terminal's payments: created by the merchant, settled by the bank leg or the Bitcoin leg. */
export interface Payments {
  /** A new pending payment of `amountCzk`, the tip included; its id is the `#pay/<id>` route. */
  readonly create: (
    amountCzk: CzkAmount,
    tipCzk?: CzkAmount | null,
  ) => Promise<Payment>;
  /**
   * Gives the payment its Bitcoin leg (Lightning invoice and Cashu request)
   * unless it has a live one; `null` once it has.
   */
  readonly requestBitcoin: (
    paymentId: string,
  ) => Promise<BitcoinRequestFailure | null>;
  /** The merchant saw the bank transfer arrive; `false` when the payment can no longer be paid. */
  readonly markPaid: (paymentId: string) => Promise<boolean>;
  /** A cancelled Bitcoin request can still be paid by a late customer. */
  readonly cancel: (paymentId: string) => Promise<boolean>;
}

/** The merchant's view of payments and direct transfers. */
export interface History {
  /** Hides the entry from the history and its day total; the wallet still counts its sats. */
  readonly hide: (id: TransactionId) => Promise<boolean>;
}

export interface Shop {
  readonly load: () => Promise<ShopProfile | null>;
  /** Saves the profile and publishes its name and picture as the account's Nostr profile. */
  readonly save: (shop: ShopProfile) => Promise<void>;
  /** Uploads the image as the shop's picture, or removes the picture on `null`; rejects when the upload fails. */
  readonly setPicture: (image: ImageFile | null) => Promise<void>;
}

/** Who paid with a Cashu token, as their Nostr profile names them. */
export interface Payers {
  /** Fetched once per launch; `null` when they have no profile or no relay answered in time. */
  readonly profile: (pubkey: Pubkey) => Promise<PayerProfile | null>;
}

/** Live views for the React hooks; each is stable for the services' lifetime. */
export interface LiveSources {
  readonly shop: LiveSource<ShopProfile | null>;
  /** Whether the terminal offers a tip before the payment. */
  readonly offerTips: LiveSource<boolean>;
  /** Whether the Bitcoin QR carries the Lightning invoice alone, without Cashu. */
  readonly lightningOnlyQr: LiveSource<boolean>;
  readonly records: LiveSource<FazoleRecords>;
  readonly balances: LiveSource<WalletBalances>;
}

/** Everything a signed-in screen uses: one linkstr and one linkshu runtime per launch. */
export interface AppServices {
  readonly account: Account;
  readonly config: AppConfig;
  readonly store: LinkyStore;
  readonly repositories: Repositories;
  readonly ledger: Ledger;
  readonly nostr: Nostr;
  readonly wallet: Wallet;
  readonly rates: Rates;
  readonly shop: Shop;
  readonly saveOfferTips: (offer: boolean) => Promise<void>;
  readonly saveLightningOnlyQr: (lightningOnly: boolean) => Promise<void>;
  readonly payments: Payments;
  readonly history: History;
  readonly payers: Payers;
  readonly withdrawals: Withdrawals;
  readonly supportChat: SupportChat;
  readonly live: LiveSources;
  /** Opens the inbox and, once the store is hydrated, resumes interrupted payments and withdrawals; once. */
  readonly start: () => void;
  readonly dispose: () => Promise<void>;
}

/** Device-local and network pieces the browser supplies; tests pass in-memory ones. */
export interface ServicePorts {
  readonly outboxStore: Layer.Layer<OutboxStore>;
  readonly inboxCursorStore?: Layer.Layer<InboxCursorStore> | undefined;
  readonly keyValueStore?: Layer.Layer<KeyValueStore> | undefined;
  readonly transport?: Layer.Layer<NostrTransport> | undefined;
  readonly fetchRates?:
    | ((signal: AbortSignal) => Promise<FiatRates | null>)
    | undefined;
  /** Subscribes to the browser coming back online. */
  readonly onOnline?: ((listener: () => void) => () => void) | undefined;
  /** Holds a new release's reload back until the wallet operation settles. */
  readonly deferUpdateWhile?: (<A>(work: Promise<A>) => Promise<A>) | undefined;
}

export const createAppServices = ({
  account,
  store,
  config,
  ports,
}: {
  readonly account: Account;
  readonly store: LinkyStore;
  readonly config: AppConfig;
  readonly ports: ServicePorts;
}): AppServices => {
  const repositories = makeRepositories(store);
  const ledger = makeLedger(repositories.transactions);
  const hydrated = () => whenHydrated(store);
  const linkstr = makeLinkstrRuntime({
    secretKey: account.secretKey,
    relays: config.nostrRelays,
    allowInsecureLocalhostRelays: config.allowInsecureLocalhostRelays,
    transport: ports.transport,
    outboxStore: ports.outboxStore,
    inboxCursorStore: ports.inboxCursorStore,
  });
  const linkshu = makeLinkshuRuntime({
    cashuSeed: account.cashuSeed,
    wallet: repositories.wallet,
    keyValueStore: ports.keyValueStore,
  });
  const nostr = createNostr({
    runtime: linkstr,
    pubkey: account.pubkey,
    relays: config.nostrRelays,
    outboxStore: ports.outboxStore,
  });
  const wallet = createWallet(
    linkshu,
    account.secretKey,
    ports.deferUpdateWhile,
  );
  const rates = createRates(ports.fetchRates);
  const loadShop = () => Effect.runPromise(readShop(repositories.settings));
  const bitcoinPayments = createBitcoinPayments({
    ledger,
    nostr,
    wallet,
    czkPerBtc: rates.czkPerBtc,
    mintUrl: config.mintUrl,
    shopName: async () => (await loadShop())?.name ?? null,
    whenHydrated: hydrated,
  });
  const withdrawals = createWithdrawals({ ledger, nostr, wallet });
  const supportChat = createSupportChat({
    conversations: repositories.conversations,
    nostr,
    whenHydrated: hydrated,
  });

  const settle = async (
    paymentId: string,
    change: (payment: Payment) => Promise<boolean>,
  ) => {
    const payment = await ledger.payment(paymentId);
    return payment === null ? false : change(payment);
  };

  const saveShopProfile = async (shop: ShopProfile) => {
    await Effect.runPromise(saveShop(repositories.settings, shop));
    void nostr.publishProfile(shop);
  };

  const payerProfiles = new Map<Pubkey, Promise<PayerProfile | null>>();

  let started = false;
  let stopOnline: (() => void) | null = null;

  return {
    account,
    config,
    store,
    repositories,
    ledger,
    nostr,
    wallet,
    rates,
    shop: {
      load: loadShop,
      save: saveShopProfile,
      setPicture: async (image) => {
        const picture =
          image === null
            ? null
            : await uploadToBlossom(image, account.secretKey);
        const shop = await loadShop();
        if (shop === null) throw new Error("the account has no shop");
        await saveShopProfile({ ...shop, picture });
      },
    },
    saveOfferTips: (offer) =>
      Effect.runPromise(saveOfferTips(repositories.settings, offer)),
    saveLightningOnlyQr: (lightningOnly) =>
      Effect.runPromise(
        saveLightningOnlyQr(repositories.settings, lightningOnly),
      ),
    payments: {
      create: ledger.createPayment,
      requestBitcoin: bitcoinPayments.request,
      markPaid: (id) =>
        settle(id, (payment) => ledger.completePayment(payment, "bank")),
      cancel: (id) => settle(id, ledger.cancelPayment),
    },
    history: { hide: ledger.hideFromHistory },
    payers: {
      profile: (pubkey) => {
        const cached = payerProfiles.get(pubkey);
        if (cached) return cached;
        const fetched = nostr.fetchProfile(pubkey);
        payerProfiles.set(pubkey, fetched);
        // A miss is retried on the next look rather than remembered.
        void fetched.then((profile) => {
          if (profile === null) payerProfiles.delete(pubkey);
        });
        return fetched;
      },
    },
    withdrawals,
    supportChat,
    live: {
      shop: {
        all: readShop(repositories.settings),
        subscribe: repositories.settings.subscribe,
      },
      offerTips: {
        all: readOfferTips(repositories.settings),
        subscribe: repositories.settings.subscribe,
      },
      lightningOnlyQr: {
        all: readLightningOnlyQr(repositories.settings),
        subscribe: repositories.settings.subscribe,
      },
      records: {
        all: readFazoleRecords(repositories.transactions),
        subscribe: repositories.transactions.subscribe,
      },
      balances: {
        all: Effect.promise(wallet.balances),
        subscribe: repositories.wallet.subscribe,
      },
    },
    start: () => {
      if (started) return;
      started = true;
      nostr.start();
      void hydrated().then(() => {
        void bitcoinPayments.resume();
        void withdrawals.resume();
        stopOnline =
          ports.onOnline?.(() => void bitcoinPayments.resume()) ?? null;
      });
    },
    dispose: async () => {
      stopOnline?.();
      await bitcoinPayments.stop();
      await Promise.all([linkstr.dispose(), linkshu.dispose()]);
    },
  };
};
