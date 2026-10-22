import type {
  KeyValueStore,
  TokenTransfer,
  WalletBalances,
} from "@linky-fit/linkshu";
import type {
  InboxCursorStore,
  NostrTransport,
  OutboxStore,
} from "@linky-fit/linkstr";
import type { LinkyStore } from "@linky-fit/linksync";
import type { LiveSource } from "@linky-fit/linksync/react";
import {
  makeEsploraClient,
  onchainConfigDraft,
  type EsploraFetch,
} from "@linky-fit/onchain-transfer";
import { Effect, type Layer } from "effect";
import type { AppConfig } from "../config";
import { messageContent, type Chat } from "../domain/chat";
import {
  onchainConfigOf,
  type EditedProfile,
  type OperatorProfile,
} from "../domain/profile";
import type { OperatorTransfer } from "../domain/transfer";
import { shortNpub } from "../format";
import type { Account } from "../storage/account";
import { readChats } from "../storage/chat";
import { readProfile, saveProfile } from "../storage/profile";
import {
  makeRepositories,
  whenHydrated,
  type Repositories,
} from "../storage/repositories";
import { readTransfers } from "../storage/transfers";
import { uploadToBlossom, type ImageFile } from "./blossom";
import { createChats, type Chats } from "./chat";
import { createNostr, type Nostr } from "./nostr";
import { makeLinkshuRuntime, makeLinkstrRuntime } from "./runtimes";
import { createPeerProfiles, type PeerProfiles } from "./peerProfiles";
import { createWatcherAlerts } from "./watchers";
import { createTransfers, type Transfers } from "./transfers";
import { createWallet, type Wallet } from "./wallet";
import {
  createLightningPayments,
  type LightningPayments,
} from "./lightningPayments";

/** How often the deposit addresses of open on-chain receives are checked. */
const DEPOSIT_POLL_MS = 20_000;

export interface Profile {
  /** Saves the edited profile, keeping the picture, and publishes it as the on-chain config and the Nostr profile; `false` when either did not reach a relay. */
  readonly save: (profile: EditedProfile) => Promise<boolean>;
  /** Uploads the image as the profile picture, or removes it for `null`, then saves and publishes like `save`; rejects before the first save. */
  readonly setPicture: (image: ImageFile | null) => Promise<boolean>;
}

/** Live views for the React hooks; each is stable for the services' lifetime. */
export interface LiveSources {
  readonly transfers: LiveSource<readonly OperatorTransfer[]>;
  readonly chats: LiveSource<readonly Chat[]>;
  readonly profile: LiveSource<OperatorProfile | null>;
  readonly balances: LiveSource<WalletBalances>;
  readonly issuedTokens: LiveSource<readonly TokenTransfer[]>;
}

/** Everything a signed-in screen uses: one linkstr and one linkshu runtime per launch. */
export interface AppServices {
  readonly account: Account;
  readonly config: AppConfig;
  readonly store: LinkyStore;
  readonly repositories: Repositories;
  readonly nostr: Nostr;
  readonly wallet: Wallet;
  readonly lightning: LightningPayments;
  readonly chats: Chats;
  readonly transfers: Transfers;
  readonly profile: Profile;
  readonly peerProfiles: PeerProfiles;
  readonly live: LiveSources;
  /** Opens the inbox, republishes the on-chain config and Nostr profile, settles pending Lightning payments and starts watching deposits; once. */
  readonly start: () => void;
  readonly dispose: () => Promise<void>;
}

/** Device-local and network pieces the browser supplies; tests pass in-memory ones. */
export interface ServicePorts {
  readonly outboxStore: Layer.Layer<OutboxStore>;
  readonly inboxCursorStore?: Layer.Layer<InboxCursorStore> | undefined;
  readonly keyValueStore?: Layer.Layer<KeyValueStore> | undefined;
  readonly transport?: Layer.Layer<NostrTransport> | undefined;
  /** The `fetch` the Esplora client calls. */
  readonly esploraFetch: EsploraFetch;
  /** The `fetch` profile pictures are uploaded with. */
  readonly blossomFetch: typeof fetch;
  /** Subscribes to the window getting the focus back. */
  readonly onFocus?: ((listener: () => void) => () => void) | undefined;
}

const subscribeAll =
  (...sources: ReadonlyArray<(listener: () => void) => () => void>) =>
  (listener: () => void) => {
    const stops = sources.map((subscribe) => subscribe(listener));
    return () => {
      for (const stop of stops) stop();
    };
  };

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
  const wallet = createWallet(linkshu, account.secretKey);
  const lightning = createLightningPayments({ wallet });
  const loadProfile = () =>
    Effect.runPromise(readProfile(repositories.settings));
  const peerProfiles = createPeerProfiles(nostr.fetchProfiles);
  const alertWatchers = createWatcherAlerts({
    nostr,
    loadProfile,
    nameOf: (pubkey) => peerProfiles.get(pubkey)?.name ?? shortNpub(pubkey),
  });
  const chats = createChats({
    conversations: repositories.conversations,
    nostr,
    whenHydrated: hydrated,
    // Ecash is never quoted: whoever reads a token can spend it.
    onNewIncoming: (message) => {
      if (messageContent(message.text)._tag === "text")
        void alertWatchers({
          _tag: "message",
          from: message.peer,
          text: message.text,
        });
    },
  });
  const transfers = createTransfers({
    transfers: repositories.transfers,
    nostr,
    wallet,
    esplora: makeEsploraClient({
      baseUrl: config.esploraUrl,
      fetch: ports.esploraFetch,
    }),
    config,
    loadProfile,
    alertWatchers,
    whenHydrated: hydrated,
  });
  const publishProfile = async (profile: OperatorProfile) => {
    const published = await Promise.all([
      nostr.publishAppData(
        onchainConfigDraft(onchainConfigOf(profile, config)),
      ),
      nostr.publishProfile(profile),
    ]);
    return published.every(Boolean);
  };
  const saveAndPublish = async (profile: OperatorProfile) => {
    await Effect.runPromise(saveProfile(repositories.settings, profile));
    return publishProfile(profile);
  };

  let started = false;
  const stops: (() => void)[] = [];

  return {
    account,
    config,
    store,
    repositories,
    nostr,
    wallet,
    lightning,
    chats,
    transfers,
    peerProfiles,
    profile: {
      save: async (edited) =>
        saveAndPublish({
          ...edited,
          picture: (await loadProfile())?.picture ?? null,
        }),
      setPicture: async (image) => {
        const picture =
          image === null
            ? null
            : await uploadToBlossom(
                image,
                account.secretKey,
                ports.blossomFetch,
              );
        const saved = await loadProfile();
        if (saved === null) throw new Error("no profile saved yet");
        return saveAndPublish({ ...saved, picture });
      },
    },
    live: {
      transfers: {
        all: readTransfers(repositories.transfers),
        subscribe: repositories.transfers.subscribe,
      },
      chats: {
        all: Effect.flatMap(readTransfers(repositories.transfers), (list) =>
          readChats(
            repositories.conversations,
            list.map((transfer) => transfer.user),
          ),
        ),
        subscribe: subscribeAll(
          repositories.transfers.subscribe,
          repositories.conversations.subscribe,
        ),
      },
      profile: {
        all: readProfile(repositories.settings),
        subscribe: repositories.settings.subscribe,
      },
      balances: {
        all: Effect.promise(wallet.balances),
        subscribe: repositories.wallet.subscribe,
      },
      issuedTokens: {
        all: Effect.promise(wallet.issuedTokens),
        subscribe: repositories.wallet.subscribe,
      },
    },
    start: () => {
      if (started) return;
      started = true;
      nostr.start();
      void hydrated().then(async () => {
        // The relays this launch uses may not hold the config and profile yet.
        const profile = await loadProfile();
        if (profile !== null) void publishProfile(profile);
        await lightning.resume();
      });
      const check = () => void transfers.checkDeposits();
      check();
      const timer = setInterval(check, DEPOSIT_POLL_MS);
      stops.push(() => clearInterval(timer));
      const focus = ports.onFocus?.(check);
      if (focus) stops.push(focus);
    },
    dispose: async () => {
      for (const stop of stops.splice(0)) stop();
      await Promise.all([linkstr.dispose(), linkshu.dispose()]);
    },
  };
};
