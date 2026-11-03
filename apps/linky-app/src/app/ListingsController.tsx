import {
  parsePubkey,
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
import { isDeletedContact } from "../utils/contactName";
import { normalizeNpubIdentifier } from "../utils/nostrNpub";
import { useCashIntent } from "./hooks/useCashIntent";
import { usePublishWhenChanged } from "./hooks/usePublishWhenChanged";
import {
  useAccountHydrated,
  useContactRows,
  useListingRecords,
} from "./hooks/useLinksync";
import { buildListingsDocument } from "./lib/listings";
import { blockListAtom } from "./state/contacts/blockList";
import {
  loadPeerListings,
  peerListingsAtom,
  savePeerListings,
} from "./state/contacts/listings";
import { platformAtom } from "./state/platform";
import { currentPubkeyAtom } from "./state/session/session";

const PUBLISHED_STORAGE_PREFIX = "linky.listings.published.v1.";
const noRelays: ReadonlyArray<RelayUrl> = [];

/** The contacts who get a key slot: saved, not blocked, with a pubkey. */
const useRecipients = (ownPubkey: Pubkey | null): ReadonlyArray<Pubkey> => {
  const rows = useContactRows();
  const blockList = useAtomValue(blockListAtom);
  return React.useMemo(() => {
    const hidden = new Set<string>(blockList);
    if (ownPubkey) hidden.add(ownPubkey);
    const recipients = new Set<Pubkey>();
    for (const row of rows) {
      if (isDeletedContact(row)) continue;
      const npub = normalizeNpubIdentifier(row.npub ?? "");
      const pubkey = npub ? parsePubkey(npub) : null;
      if (pubkey && !hidden.has(pubkey)) recipients.add(pubkey);
    }
    return [...recipients].sort();
  }, [blockList, ownPubkey, rows]);
};

/** Follows the recipients' listings events and keeps the per-identity cache. */
const useListingsWatch = (
  ownPubkey: Pubkey,
  recipients: ReadonlyArray<Pubkey>,
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
        if (known && known.updatedAt >= fact.updatedAt) return current;
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

  React.useEffect(() => {
    setWatched(recipients);
    return () => setWatched([]);
  }, [recipients, setWatched]);
};

const useListingsPublisher = (
  ownPubkey: Pubkey,
  recipients: ReadonlyArray<Pubkey>,
): void => {
  const records = useListingRecords();
  const { cashIntent } = useCashIntent();
  const document = React.useMemo(
    () => buildListingsDocument(records, cashIntent),
    [cashIntent, records],
  );
  usePublishWhenChanged({
    kv: useAtomValue(platformAtom).kv,
    storageKey: PUBLISHED_STORAGE_PREFIX + ownPubkey,
    hydrated: useAccountHydrated(),
    document,
    recipients,
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

/** Mounted once in the authenticated shell: watches contacts' listings and publishes the own ones. */
export const ListingsController = () => {
  const ownPubkey = useAtomValue(currentPubkeyAtom);
  return ownPubkey ? <ListingsSync ownPubkey={ownPubkey} /> : null;
};
