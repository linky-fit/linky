import type { TransactionId } from "@linky-fit/domain";
import type {
  FiatRates,
  KeyValueStore,
  WalletBalances,
} from "@linky-fit/linkshu";
import { ClientId, MessageText } from "@linky-fit/linkstr";
import type {
  InboxCursorStore,
  NostrTransport,
  OutboxStore,
  Pubkey,
} from "@linky-fit/linkstr";
import { createId, type LinkyStore } from "@linky-fit/linksync";
import type { KeyValueStorage } from "@linky-fit/linksync/evolu";
import type { LiveSource } from "@linky-fit/linksync/react";
import { Effect, type Layer } from "effect";
import type { AppConfig } from "../config";
import type { CzkAmount, Payment, Pledge, ShopProfile } from "../domain";
import type { Account } from "../storage/account";
import { makeLedger, type Ledger } from "../storage/ledger";
import {
  makeRepositories,
  whenHydrated,
  type Repositories,
} from "../storage/repositories";
import { readPledge } from "../storage/pledgeSetting";
import {
  readMonetaConnection,
  saveMonetaConnection,
  type MonetaConnection,
} from "../storage/monetaSetting";
import {
  readShop,
  readShopEditedAt,
  saveShop,
  shopFieldsFromProfile,
} from "../storage/shop";
import { readOfferTips, saveOfferTips } from "../storage/tipSetting";
import {
  readBitcoinQrMode,
  saveBitcoinQrMode,
  type BitcoinQrMode,
} from "../storage/bitcoinQrSetting";
import { readMintUrl, saveMintUrl } from "../storage/mintSetting";
import { readFazoleRecords, type FazoleRecords } from "../storage/transactions";
import { createBankPayments, type BankPayments } from "./bankPayments";
import {
  createBitcoinPayments,
  type BitcoinRequestFailure,
} from "./bitcoinPayments";
import { createMonetaApi } from "./monetaApi";
import { createNostr, type Nostr, type PayerProfile } from "./nostr";
import { createPledges, type Pledges } from "./pledges";
import { uploadToBlossom, type ImageFile } from "./blossom";
import { createRates, type Rates } from "./rates";
import {
  createSupportChat,
  supportPubkey,
  type SupportChat,
} from "./supportChat";
import { makeLinkshuRuntime, makeLinkstrRuntime } from "./runtimes";
import { createDevices, type DevicePorts, type Devices } from "./devices";
import { createWallet, type Wallet } from "./wallet";
import { createWithdrawals, type Withdrawals } from "./withdrawals";
import { nowSeconds } from "../utils/time";

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

/** Asking someone for a cash payout of the wallet. */
export interface CashRequests {
  /** Sends the request as a chat message; one to support lands in the support chat. */
  readonly send: (to: Pubkey, text: string) => Promise<void>;
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
  readonly bitcoinQrMode: LiveSource<BitcoinQrMode>;
  /** The MONETA connection; `null` while the shop has none. */
  readonly moneta: LiveSource<MonetaConnection | null>;
  /** The mint new payments are minted at. */
  readonly mintUrl: LiveSource<string>;
  readonly records: LiveSource<FazoleRecords>;
  readonly balances: LiveSource<WalletBalances>;
  /** The open pledge; `null` while the merchant owes nobody. */
  readonly pledge: LiveSource<Pledge | null>;
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
  readonly saveBitcoinQrMode: (mode: BitcoinQrMode) => Promise<void>;
  /** Picks the mint new payments are minted at; sats already held elsewhere stay there. */
  readonly saveMintUrl: (mintUrl: string) => Promise<void>;
  readonly payments: Payments;
  /** Confirms bank QR payments through MONETA's API. */
  readonly bankPayments: BankPayments;
  readonly history: History;
  readonly payers: Payers;
  readonly withdrawals: Withdrawals;
  readonly pledges: Pledges;
  readonly supportChat: SupportChat;
  readonly cashRequests: CashRequests;
  /** The devices of the recovery seed in every app. */
  readonly devices: Devices;
  readonly live: LiveSources;
  /** Opens the inbox and, once the store is hydrated, resumes interrupted payments and withdrawals; once. */
  readonly start: () => void;
  readonly dispose: () => Promise<void>;
}

/** Device-local and network pieces the browser supplies; tests pass in-memory ones. */
export interface ServicePorts {
  /** Device-local storage that never syncs. */
  readonly kv: KeyValueStorage;
  readonly outboxStore: Layer.Layer<OutboxStore>;
  readonly inboxCursorStore?: Layer.Layer<InboxCursorStore> | undefined;
  readonly keyValueStore?: Layer.Layer<KeyValueStore> | undefined;
  readonly transport?: Layer.Layer<NostrTransport> | undefined;
  readonly fetchRates?:
    | ((signal: AbortSignal) => Promise<FiatRates | null>)
    | undefined;
  /** Reaches the app's own origin, e.g. the bank relay; the browser's `fetch` unless a test supplies one. */
  readonly fetch?: typeof fetch | undefined;
  /** Subscribes to the browser coming back online. */
  readonly onOnline?: ((listener: () => void) => () => void) | undefined;
  /** Holds a new release's reload back until the wallet operation settles. */
  readonly deferUpdateWhile?: (<A>(work: Promise<A>) => Promise<A>) | undefined;
  /** This device's place in the devices list; without it the device does not register. */
  readonly devices?: DevicePorts | undefined;
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
  const ledger = makeLedger(repositories.transactions, ports.kv);
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
  const mintUrl = readMintUrl(repositories.settings, config.mintUrl);
  const bitcoinPayments = createBitcoinPayments({
    ledger,
    nostr,
    wallet,
    czkPerBtc: rates.czkPerBtc,
    mintUrl: () => Effect.runPromise(mintUrl),
    shopName: async () => (await loadShop())?.name ?? null,
    whenHydrated: hydrated,
  });
  const withdrawals = createWithdrawals({ ledger, nostr, wallet });
  const monetaConnection = readMonetaConnection(repositories.settings);
  const bankPayments = createBankPayments({
    ledger,
    api: createMonetaApi(ports.fetch),
    connection: () => Effect.runPromise(monetaConnection),
    saveConnection: (connection) =>
      Effect.runPromise(
        saveMonetaConnection(repositories.settings, connection),
      ),
    shopIban: async () => (await loadShop())?.iban ?? null,
  });
  const pledges = createPledges({
    ledger,
    settings: repositories.settings,
    nostr,
    withdrawals,
    czkPerBtc: rates.czkPerBtc,
    whenHydrated: hydrated,
  });
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
    await Effect.runPromise(
      saveShop(repositories.settings, shop, nowSeconds()),
    );
    void nostr.publishProfile(shop);
  };

  const devices = createDevices({
    repository: repositories.devices,
    whenUploaded: store.whenUploaded,
    recoverySeed: account.recoverySeed,
    ports: ports.devices,
  });

  /**
   * The shop's name and picture are the account's Nostr profile, which Linky
   * edits too: the newer of the profile on the relays and the merchant's last
   * edit wins. Without a profile, the shop goes out as one, so the pledger
   * and support see who sends. An account without a shop is set up from the
   * profile instead.
   */
  const syncShopWithProfile = async () => {
    const shop = await loadShop();
    if (shop === null) return;
    const fetched = await nostr.fetchOwnProfile();
    if (fetched === null) return;
    const { profile } = fetched;
    const editedAt = await Effect.runPromise(
      readShopEditedAt(repositories.settings),
    );
    if (profile === null || (editedAt ?? 0) > profile.updatedAt) {
      if (shop.name !== null || shop.picture !== null)
        await nostr.publishProfile(shop);
      return;
    }
    const fromProfile = shopFieldsFromProfile(profile);
    if (fromProfile.name === shop.name && fromProfile.picture === shop.picture)
      return;
    await Effect.runPromise(
      saveShop(repositories.settings, { ...shop, ...fromProfile }, null),
    );
  };

  const payerProfiles = new Map<Pubkey, Promise<PayerProfile | null>>();

  let started = false;
  const stops: (() => void)[] = [];

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
            : await uploadToBlossom(
                image,
                account.secretKey,
                config.blossomServerUrl,
              );
        const shop = await loadShop();
        if (shop === null) throw new Error("the account has no shop");
        await saveShopProfile({ ...shop, picture });
      },
    },
    saveOfferTips: (offer) =>
      Effect.runPromise(saveOfferTips(repositories.settings, offer)),
    saveBitcoinQrMode: (mode) =>
      Effect.runPromise(saveBitcoinQrMode(repositories.settings, mode)),
    saveMintUrl: (url) =>
      Effect.runPromise(saveMintUrl(repositories.settings, url)),
    payments: {
      create: ledger.createPayment,
      requestBitcoin: bitcoinPayments.request,
      markPaid: (id) =>
        settle(id, (payment) => ledger.completePayment(payment, "bank")),
      cancel: (id) => settle(id, ledger.cancelPayment),
    },
    bankPayments,
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
    pledges,
    supportChat,
    cashRequests: {
      send: async (to, text) => {
        if (to === supportPubkey) {
          await supportChat.send(text);
          return;
        }
        const clientId = ClientId.make(createId());
        await nostr.sendText(
          to,
          MessageText.make(text.trim()),
          clientId,
          `fazole.cash-request:${clientId}`,
        );
      },
    },
    devices,
    live: {
      shop: {
        all: readShop(repositories.settings),
        subscribe: repositories.settings.subscribe,
      },
      offerTips: {
        all: readOfferTips(repositories.settings),
        subscribe: repositories.settings.subscribe,
      },
      bitcoinQrMode: {
        all: readBitcoinQrMode(repositories.settings),
        subscribe: repositories.settings.subscribe,
      },
      moneta: {
        all: monetaConnection,
        subscribe: repositories.settings.subscribe,
      },
      mintUrl: { all: mintUrl, subscribe: repositories.settings.subscribe },
      records: {
        all: readFazoleRecords(repositories.transactions),
        subscribe: repositories.transactions.subscribe,
      },
      balances: {
        all: Effect.promise(wallet.balances),
        subscribe: repositories.wallet.subscribe,
      },
      pledge: {
        all: readPledge(repositories.settings),
        subscribe: repositories.settings.subscribe,
      },
    },
    start: () => {
      if (started) return;
      started = true;
      nostr.start();
      void hydrated().then(() => {
        void syncShopWithProfile();
        stops.push(devices.start());
        void bitcoinPayments.resume();
        void withdrawals.resume();
        // Inflows, settled withdrawals and a pledge opened on another device all ask for a forward.
        const reconcile = () => void pledges.reconcile();
        reconcile();
        stops.push(
          repositories.transactions.subscribe(reconcile),
          repositories.settings.subscribe(reconcile),
        );
        const online = ports.onOnline?.(() => {
          void syncShopWithProfile();
          void bitcoinPayments.resume();
          reconcile();
        });
        if (online) stops.push(online);
      });
    },
    dispose: async () => {
      for (const stop of stops.splice(0)) stop();
      pledges.stop();
      bankPayments.stop();
      await bitcoinPayments.stop();
      await Promise.all([linkstr.dispose(), linkshu.dispose()]);
    },
  };
};
