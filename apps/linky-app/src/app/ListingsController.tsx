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
  useAtomValue,
  useLinkstrCommands,
  watchedListingsAtom,
} from "@linky-fit/linkstr-react";
import React from "react";
import { reportAppLog } from "../devtools/inspector/appLog";
import { getUnknownErrorMessage } from "../utils/unknown";
import { useCashIntent } from "./hooks/useCashIntent";
import { usePublishWhenChanged } from "./hooks/usePublishWhenChanged";
import {
  useAccountHydrated,
  useContactRows,
  useListingRecords,
} from "./hooks/useLinksync";
import {
  buildListingsDraft,
  listingsRecipients,
  type ListingsRecipient,
} from "./lib/listingAudience";
import { usePassOnListings } from "./hooks/usePassOnListings";
import { blockListAtom } from "./state/contacts/blockList";
import { useHiddenListingKeys } from "./hooks/useHiddenListings";
import {
  loadPeerListings,
  peerListingsAtom,
  savePeerListings,
} from "./state/contacts/listings";
import { platformAtom } from "./state/platform";
import { currentPubkeyAtom } from "./state/session/session";

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

/** Follows the recipients' listings events and keeps the per-identity cache. */
const useListingsWatch = (
  ownPubkey: Pubkey,
  recipients: ReadonlyArray<ListingsRecipient>,
): void => {
  const kv = useAtomValue(platformAtom).kv;
  const setPeerListings = useAtomSet(peerListingsAtom);
  const setWatched = useAtomSet(watchedListingsAtom);
  const setHandler = useAtomSet(listingsWatchHandlerAtom);
  useAtomMount(listingsWatchAtom);

  React.useEffect(() => {
    setPeerListings(loadPeerListings(kv, ownPubkey));
    return () => setPeerListings({});
  }, [kv, ownPubkey, setPeerListings]);

  React.useEffect(() => {
    const onEvent = (fact: ListingsUpdated) => {
      setPeerListings((current) => {
        const known = current[fact.pubkey];
        // An equal time is taken too: a cache an older release wrote may hold less of the same event.
        if (known && known.updatedAt > fact.updatedAt) return current;
        const next = {
          ...current,
          [fact.pubkey]: {
            document: fact.document,
            updatedAt: fact.updatedAt,
          },
        };
        // A full or blocked storage must not take the watch stream down with it.
        try {
          savePeerListings(kv, ownPubkey, next);
        } catch (error) {
          reportAppLog({
            tag: "listings.cacheFailed",
            summary: `Listings cache write failed: ${getUnknownErrorMessage(error, "unknown")}`,
            payload: { pubkey: fact.pubkey },
          });
        }
        return next;
      });
      reportAppLog({
        tag: "listings.received",
        summary: `Listings from ${fact.pubkey.slice(0, 8)}: ${fact.document.listings.length}, cash ${fact.document.cash ?? "none"}`,
        payload: {
          pubkey: fact.pubkey,
          cash: fact.document.cash,
          listings: fact.document.listings.length,
          updatedAt: fact.updatedAt,
        },
      });
    };
    setHandler({ onEvent });
    return () => setHandler(null);
  }, [kv, ownPubkey, setHandler, setPeerListings]);

  const watched = React.useMemo(
    () => recipients.map(({ pubkey }) => pubkey),
    [recipients],
  );
  React.useEffect(() => {
    setWatched(watched);
    return () => setWatched([]);
  }, [watched, setWatched]);
};

const useListingsPublisher = (
  ownPubkey: Pubkey,
  recipients: ReadonlyArray<ListingsRecipient>,
): void => {
  const records = useListingRecords();
  const { cashIntent } = useCashIntent();
  const peerDocuments = useAtomValue(peerListingsAtom);
  const { passOnListings } = usePassOnListings();
  const hidden = useHiddenListingKeys();
  const draft = React.useMemo(
    () =>
      buildListingsDraft({
        records,
        cash: cashIntent,
        recipients,
        peerDocuments,
        passOn: passOnListings,
        hidden,
      }),
    [cashIntent, hidden, passOnListings, peerDocuments, recipients, records],
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
  useListingsWatch(ownPubkey, recipients);
  useListingsPublisher(ownPubkey, recipients);
  return null;
};

/** Mounted once in the authenticated shell: watches contacts' listings and publishes the own ones, with the contacts' network listings passed on. */
export const ListingsController = () => {
  const ownPubkey = useAtomValue(currentPubkeyAtom);
  return ownPubkey ? <ListingsSync ownPubkey={ownPubkey} /> : null;
};
