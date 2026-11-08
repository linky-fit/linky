import {
  isEmptyListingsDocument,
  type ListingsDraft,
  type RelayUrl,
} from "@linky-fit/linkstr";
import { Cause, Exit } from "effect";
import React from "react";
import { reportAppLog } from "../../devtools/inspector/appLog";
import type { KeyValuePort } from "../../platform/ports";
import { nowSeconds } from "../../utils/time";
import { listingsPublishFingerprint } from "../lib/listings";

/** Edits settle before the relays hear about them. */
const PUBLISH_DEBOUNCE_MS = 1_500;
/** A publish no relay accepted is tried again after this. */
const PUBLISH_RETRY_MS = 60_000;
/** An unchanged document is published again this often, in case a relay dropped it. */
const REFRESH_SECONDS = 7 * 24 * 60 * 60;
/** Stored while a publish is unsettled: a failed one may still have replaced some chunks, so no state matches it. */
const UNSETTLED = "unsettled";

interface PublishWhenChangedInput {
  readonly kv: KeyValuePort;
  readonly storageKey: string;
  readonly hydrated: boolean;
  readonly draft: ListingsDraft;
  readonly relays: ReadonlyArray<RelayUrl>;
  readonly publish: (
    draft: ListingsDraft,
  ) => Promise<Exit.Exit<unknown, unknown>>;
}

/**
 * Publishes `draft` whenever it or the write relays
 * differ from the last accepted publish, whose fingerprint is kept under
 * `storageKey`, and once a week even when nothing changed.
 */
export const usePublishWhenChanged = ({
  kv,
  storageKey,
  hydrated,
  draft,
  relays,
  publish,
}: PublishWhenChangedInput): void => {
  const inFlight = React.useRef(false);
  // Bumped when a superseded publish settles, so the newest state is compared with what it left on the relays.
  const [settled, setSettled] = React.useState(0);

  React.useEffect(() => {
    // Before hydration the rows are empty, which must not look like a withdrawal.
    if (!hydrated || inFlight.current) return;
    const fingerprint = listingsPublishFingerprint({
      draft,
      relays,
      refreshPeriod: Math.floor(nowSeconds() / REFRESH_SECONDS),
    });
    const published = kv.getItem(storageKey);
    if (published === fingerprint) return;
    // Nothing to share and nothing shared before: stay silent on the relays.
    if (
      published === null &&
      isEmptyListingsDocument(draft.document) &&
      draft.audiences.length === 0
    ) {
      return;
    }
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    const attempt = async () => {
      timeout = null;
      inFlight.current = true;
      kv.setItem(storageKey, UNSETTLED);
      const exit = await publish(draft);
      inFlight.current = false;
      if (Exit.isSuccess(exit)) {
        kv.setItem(storageKey, fingerprint);
        reportAppLog({
          tag: "listings.published",
          summary: `Listings published to ${draft.recipients.length} contacts`,
          payload: {
            cash: draft.document.cash,
            listings: draft.document.listings.length,
            passedOn: draft.document.passedOn?.length ?? 0,
            audiences: draft.audiences.length,
            recipients: draft.recipients.length,
          },
        });
      } else {
        reportAppLog({
          tag: "listings.publishFailed",
          summary: `Listings publish failed: ${Cause.pretty(exit.cause)}`,
          payload: { recipients: draft.recipients.length },
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
  }, [draft, hydrated, kv, publish, relays, settled, storageKey]);
};
