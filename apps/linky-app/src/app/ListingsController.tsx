import {
  ListingsDraft,
  parsePubkey,
  type ListingsUpdated,
  type Pubkey,
} from "@linky-fit/linkstr";
import {
  listingsWatchAtom,
  listingsWatchHandlerAtom,
  useAtomMount,
  useAtomSet,
  useAtomValue,
  useLinkstrCommands,
  watchedListingsAtom,
} from "@linky-fit/linkstr-react";
import { Cause, Exit } from "effect";
import React from "react";
import { reportAppLog } from "../devtools/inspector/appLog";
import { getUnknownErrorMessage } from "../utils/unknown";
import { isDeletedContact } from "../utils/contactName";
import { normalizeNpubIdentifier } from "../utils/nostrNpub";
import { useCashIntent } from "./hooks/useCashIntent";
import {
  useAccountHydrated,
  useContactRows,
  useListingRecords,
} from "./hooks/useLinksync";
import {
  buildListingsDocument,
  listingsPublishFingerprint,
} from "./lib/listings";
import { blockListAtom } from "./state/contacts/blockList";
import {
  loadPeerListings,
  peerListingsAtom,
  savePeerListings,
} from "./state/contacts/listings";
import { platformAtom } from "./state/platform";
import { currentPubkeyAtom } from "./state/session/session";

/** Edits settle before the relays hear about them. */
const PUBLISH_DEBOUNCE_MS = 1_500;
/** A publish no relay accepted is tried again after this. */
const PUBLISH_RETRY_MS = 60_000;
const PUBLISHED_STORAGE_PREFIX = "linky.listings.published.v1.";

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

/**
 * Publishes the own document whenever it or the recipient set changes. The
 * fingerprint of the last accepted publish is kept per identity on the
 * device, so a restart republishes nothing the relays already hold.
 */
const useListingsPublisher = (
  ownPubkey: Pubkey,
  recipients: ReadonlyArray<Pubkey>,
): void => {
  const kv = useAtomValue(platformAtom).kv;
  const hydrated = useAccountHydrated();
  const records = useListingRecords();
  const { cashIntent } = useCashIntent();
  const { publishListings } = useLinkstrCommands();
  const storageKey = PUBLISHED_STORAGE_PREFIX + ownPubkey;

  const document = React.useMemo(
    () => buildListingsDocument(records, cashIntent),
    [cashIntent, records],
  );
  const fingerprint = React.useMemo(
    () => listingsPublishFingerprint(document, recipients),
    [document, recipients],
  );

  React.useEffect(() => {
    // Before hydration the rows are empty, which must not look like a withdrawal.
    if (!hydrated) return;
    const published = kv.getItem(storageKey);
    if (published === fingerprint) return;
    // Nothing to share and nothing shared before: stay silent on the relays.
    if (
      published === null &&
      document.cash === null &&
      document.listings.length === 0
    ) {
      return;
    }
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    const attempt = async () => {
      timeout = null;
      const exit = await publishListings(
        new ListingsDraft({ document, recipients }),
      );
      if (cancelled) return;
      if (Exit.isSuccess(exit)) {
        kv.setItem(storageKey, fingerprint);
        reportAppLog({
          tag: "listings.published",
          summary: `Listings published to ${recipients.length} contacts`,
          payload: {
            cash: document.cash,
            listings: document.listings.length,
            recipients: recipients.length,
          },
        });
        return;
      }
      reportAppLog({
        tag: "listings.publishFailed",
        summary: `Listings publish failed: ${Cause.pretty(exit.cause)}`,
        payload: { recipients: recipients.length },
      });
      timeout = setTimeout(() => void attempt(), PUBLISH_RETRY_MS);
    };
    timeout = setTimeout(() => void attempt(), PUBLISH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      if (timeout !== null) clearTimeout(timeout);
    };
  }, [
    document,
    fingerprint,
    hydrated,
    kv,
    publishListings,
    recipients,
    storageKey,
  ]);
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
