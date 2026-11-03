import {
  isEmptyListingsDocument,
  ListingsDraft,
  type ListingsDocument,
  type Pubkey,
} from "@linky-fit/linkstr";
import { Cause, Exit } from "effect";
import React from "react";
import { reportAppLog } from "../../devtools/inspector/appLog";
import type { KeyValuePort } from "../../platform/ports";
import { listingsPublishFingerprint } from "../lib/listings";

/** Edits settle before the relays hear about them. */
const PUBLISH_DEBOUNCE_MS = 1_500;
/** A publish no relay accepted is tried again after this. */
const PUBLISH_RETRY_MS = 60_000;

interface PublishWhenChangedInput {
  readonly kv: KeyValuePort;
  readonly storageKey: string;
  readonly hydrated: boolean;
  readonly document: ListingsDocument;
  readonly recipients: ReadonlyArray<Pubkey>;
  readonly publish: (
    draft: ListingsDraft,
  ) => Promise<Exit.Exit<unknown, unknown>>;
}

/**
 * Publishes `document` whenever it or the recipient set differs from the last
 * accepted publish, whose fingerprint is kept under `storageKey`, so a
 * restart republishes nothing the relays already hold.
 */
export const usePublishWhenChanged = ({
  kv,
  storageKey,
  hydrated,
  document,
  recipients,
  publish,
}: PublishWhenChangedInput): void => {
  const fingerprint = React.useMemo(
    () => listingsPublishFingerprint(document, recipients),
    [document, recipients],
  );
  const inFlight = React.useRef(false);
  // Bumped when a superseded publish settles, so the newest state is compared with what it left on the relays.
  const [settled, setSettled] = React.useState(0);

  React.useEffect(() => {
    // Before hydration the rows are empty, which must not look like a withdrawal.
    if (!hydrated || inFlight.current) return;
    const published = kv.getItem(storageKey);
    if (published === fingerprint) return;
    // Nothing to share and nothing shared before: stay silent on the relays.
    if (published === null && isEmptyListingsDocument(document)) return;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    const attempt = async () => {
      timeout = null;
      inFlight.current = true;
      const exit = await publish(new ListingsDraft({ document, recipients }));
      inFlight.current = false;
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
      } else {
        reportAppLog({
          tag: "listings.publishFailed",
          summary: `Listings publish failed: ${Cause.pretty(exit.cause)}`,
          payload: { recipients: recipients.length },
        });
      }
      if (cancelled) setSettled((count) => count + 1);
      else if (Exit.isFailure(exit)) {
        timeout = setTimeout(() => void attempt(), PUBLISH_RETRY_MS);
      }
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
    publish,
    recipients,
    settled,
    storageKey,
  ]);
};
