import {
  type ListingsUpdated,
  type Pubkey,
  type RelayUrl,
} from "@linky-fit/linkstr";
import {
  linkstrConfigAtom,
  listingsWatchAtom,
  listingsWatchHandlerAtom,
  useAtomMount,
  useAtomSet,
  useAtomSuspense,
  useAtomValue,
  useLinkstrCommands,
  watchedListingsAtom,
} from "@linky-fit/linkstr-react";
import {
  normalizePeerListings,
  type PeerListingsRepository,
} from "@linky-fit/linksync";
import { useRepositoryRows } from "@linky-fit/linksync/react";
import { Effect } from "effect";
import React from "react";
import { reportAppLog } from "../devtools/inspector/appLog";
import { useCashIntent } from "./hooks/useCashIntent";
import { usePublishWhenChanged } from "./hooks/usePublishWhenChanged";
import {
  useAccountHydrated,
  useContactRows,
  useListingRecords,
  useSetting,
  useSettingsRepository,
} from "./hooks/useLinksync";
import { ownProxyPaymentCurrencies } from "./hooks/profile/useProxyPaymentCurrencies";
import { runWrite } from "./lib/storeWrite";
import { useProxyPaymentCurrenciesMigration } from "./migrations/useProxyPaymentCurrenciesMigration";
import {
  buildListingsDraft,
  listingsRecipients,
  type ListingsRecipient,
} from "./lib/listingAudience";
import { usePassOnListings } from "./hooks/usePassOnListings";
import { blockListAtom } from "./state/contacts/blockList";
import { useHiddenListingKeys } from "./hooks/useListingMarks";
import {
  forgetLegacyPeerListings,
  loadLegacyPeerListings,
  peerListingsAtom,
  peerListingsOfRecords,
  peerListingsToStore,
  withNewerPeerListings,
} from "./state/contacts/listings";
import { myProfileAtom } from "./state/contacts/profiles";
import { platformAtom } from "./state/platform";
import { currentPubkeyAtom } from "./state/session/session";
import { peerListingsRepositoryAtom } from "./state/session/store";

const PUBLISHED_STORAGE_PREFIX = "linky.listings.published.v1.";
const noRelays: ReadonlyArray<RelayUrl> = [];

const useRecipients = (
  ownPubkey: Pubkey | null,
): ReadonlyArray<ListingsRecipient> => {
  const rows = useContactRows();
  const blockList = useAtomValue(blockListAtom);
  return React.useMemo(
    () => listingsRecipients(rows, blockList, ownPubkey),
    [blockList, ownPubkey, rows],
  );
};

const usePeerListingsRepository = (): PeerListingsRepository =>
  useAtomSuspense(peerListingsRepositoryAtom).value;

/**
 * Keeps the contacts' documents in the synced `peerListings` table, so every
 * device shows the last one any of them read while relays do not: stored
 * documents seed the atom and documents newer than their stored copy are
 * written once the account is hydrated.
 */
const usePeerListingsStore = (ownPubkey: Pubkey): void => {
  const kv = useAtomValue(platformAtom).kv;
  const repository = usePeerListingsRepository();
  const rows = useRepositoryRows(repository);
  const records = React.useMemo(
    () =>
      rows.flatMap((row) => {
        const record = normalizePeerListings(row);
        return record === null ? [] : [record];
      }),
    [rows],
  );
  const hydrated = useAccountHydrated();
  const peerListings = useAtomValue(peerListingsAtom);
  const setPeerListings = useAtomSet(peerListingsAtom);

  React.useEffect(() => {
    setPeerListings(loadLegacyPeerListings(kv, ownPubkey) ?? {});
    return () => setPeerListings({});
  }, [kv, ownPubkey, setPeerListings]);

  React.useEffect(() => {
    setPeerListings((current) =>
      withNewerPeerListings(
        current,
        peerListingsOfRecords(records, ownPubkey),
        {
          takeEqual: false,
        },
      ),
    );
  }, [ownPubkey, records, setPeerListings]);

  const writingRef = React.useRef(false);
  React.useEffect(() => {
    // Before hydration the stored rows are not the account's yet.
    if (!hydrated || writingRef.current) return;
    const writes = peerListingsToStore(peerListings, records, ownPubkey);
    if (writes.length === 0) {
      // Migration bridge; removal gate in app/migrations/AGENTS.md
      forgetLegacyPeerListings(kv, ownPubkey);
      return;
    }
    writingRef.current = true;
    void runWrite(
      Effect.forEach(writes, repository.record, { discard: true }),
    ).then((outcome) => {
      writingRef.current = false;
      if (outcome.ok) return;
      reportAppLog({
        tag: "listings.storeFailed",
        summary: `Storing contacts' listings failed: ${outcome.error}`,
        payload: { authors: writes.map(({ author }) => author) },
      });
    });
  }, [hydrated, kv, ownPubkey, peerListings, records, repository]);
};

/** Follows the recipients' listings events into the atom, newest per author. */
const useListingsWatch = (
  recipients: ReadonlyArray<ListingsRecipient>,
): void => {
  const setPeerListings = useAtomSet(peerListingsAtom);
  const setWatched = useAtomSet(watchedListingsAtom);
  const setHandler = useAtomSet(listingsWatchHandlerAtom);
  useAtomMount(listingsWatchAtom);

  React.useEffect(() => {
    const onEvent = (fact: ListingsUpdated) => {
      setPeerListings((current) =>
        withNewerPeerListings(
          current,
          {
            [fact.pubkey]: {
              document: fact.document,
              updatedAt: fact.updatedAt,
              reachesReader: fact.reachesReader,
            },
          },
          { takeEqual: true },
        ),
      );
      reportAppLog({
        tag: "listings.received",
        summary: `Listings from ${fact.pubkey.slice(0, 8)}: ${fact.document.listings.length}, cash ${fact.document.cash ?? "none"}`,
        payload: {
          pubkey: fact.pubkey,
          cash: fact.document.cash,
          listings: fact.document.listings.length,
          proxyPaymentCurrencies: fact.document.proxyPaymentCurrencies ?? null,
          updatedAt: fact.updatedAt,
          reachesReader: fact.reachesReader,
        },
      });
    };
    setHandler({ onEvent });
    return () => setHandler(null);
  }, [setHandler, setPeerListings]);

  const watched = React.useMemo(
    () => recipients.map(({ pubkey }) => pubkey),
    [recipients],
  );
  React.useEffect(() => {
    setWatched(watched);
    return () => setWatched([]);
  }, [watched, setWatched]);
};

/** The own proxy payment currencies as the document names them: none until the setting is set or carried over from the status. */
const useDocumentProxyPaymentCurrencies = () => {
  const setting = useSetting("proxyPaymentCurrencies");
  const settingsRepository = useSettingsRepository();
  useProxyPaymentCurrenciesMigration({
    setting,
    status: useAtomValue(myProfileAtom, (my) => my.status),
    settingsRepository,
    hydrated: useAccountHydrated(),
  });
  return React.useMemo(
    () => (setting === null ? null : ownProxyPaymentCurrencies(setting, null)),
    [setting],
  );
};

const useListingsPublisher = (
  ownPubkey: Pubkey,
  recipients: ReadonlyArray<ListingsRecipient>,
): void => {
  const records = useListingRecords();
  const { cashIntent } = useCashIntent();
  const proxyPaymentCurrencies = useDocumentProxyPaymentCurrencies();
  const peerDocuments = useAtomValue(peerListingsAtom);
  const { passOnListings } = usePassOnListings();
  const hidden = useHiddenListingKeys();
  const draft = React.useMemo(
    () =>
      buildListingsDraft({
        records,
        cash: cashIntent,
        proxyPaymentCurrencies,
        recipients,
        peerDocuments,
        passOn: passOnListings,
        hidden,
      }),
    [
      cashIntent,
      hidden,
      passOnListings,
      peerDocuments,
      proxyPaymentCurrencies,
      recipients,
      records,
    ],
  );
  usePublishWhenChanged({
    kv: useAtomValue(platformAtom).kv,
    storageKey: PUBLISHED_STORAGE_PREFIX + ownPubkey,
    hydrated: useAccountHydrated(),
    draft,
    relays: useAtomValue(linkstrConfigAtom)?.writeRelays ?? noRelays,
    publish: useLinkstrCommands().publishListings,
  });
};

const ListingsSync = ({ ownPubkey }: { ownPubkey: Pubkey }): null => {
  const recipients = useRecipients(ownPubkey);
  usePeerListingsStore(ownPubkey);
  useListingsWatch(recipients);
  useListingsPublisher(ownPubkey, recipients);
  return null;
};

/** Mounted once in the authenticated shell: watches contacts' listings and publishes the own ones, with the contacts' network listings passed on. */
export const ListingsController = () => {
  const ownPubkey = useAtomValue(currentPubkeyAtom);
  return ownPubkey ? <ListingsSync ownPubkey={ownPubkey} /> : null;
};
