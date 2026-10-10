import { verifyEvent } from "nostr-tools/pure";
import type { Event } from "nostr-tools";

/**
 * Checks the event id and signature on a clean copy: nostr-tools trusts a
 * cached `verified` marker that an object can carry over from elsewhere.
 */
export const hasValidSignature = (event: Event): boolean =>
  verifyEvent({
    id: event.id,
    pubkey: event.pubkey,
    created_at: event.created_at,
    kind: event.kind,
    tags: event.tags,
    content: event.content,
    sig: event.sig,
  });
