import { Either } from "effect";
import {
  isClientId,
  isPubkey,
  isRumorId,
  isUnixSeconds,
} from "../domain/primitives";
import type { ClientId, Pubkey, UnixSeconds } from "../domain/primitives";
import type { DropReason } from "../inbox/events";
import {
  firstTagValue,
  Rumor,
  rumorWithHash,
  tagValues,
} from "../internal/nostrEvent";
import { OwnSeenReceiptConfirmed, SeenReceiptReceived } from "./events";
import type { SeenReceiptInboxEvent } from "./events";
import type { SeenReceiptDraft } from "./domain";

export const SEEN_RECEIPT_KIND = 24136;
export const SEEN_RECEIPT_VALUE = "seen_receipt";

export const encodeSeenReceiptRumor = (
  draft: SeenReceiptDraft,
  author: Pubkey,
  sentAt: UnixSeconds,
  clientId: ClientId,
): Rumor =>
  rumorWithHash({
    pubkey: author,
    created_at: sentAt,
    kind: SEEN_RECEIPT_KIND,
    tags: [
      ["p", draft.to],
      ["p", author],
      ["client", clientId],
      ["linky", SEEN_RECEIPT_VALUE],
      ["since", String(draft.sinceSec)],
    ],
    content: String(draft.seenUpToSec),
  });

const decodeSeconds = (value: string | null): UnixSeconds | null => {
  if (value === null || !/^[1-9][0-9]{0,10}$/.test(value)) return null;
  const parsed = Number(value);
  return isUnixSeconds(parsed) ? parsed : null;
};

export const decodeSeenReceiptRumor = (
  rumor: Rumor,
  me: Pubkey,
): Either.Either<SeenReceiptInboxEvent, DropReason> => {
  if (rumor.kind !== SEEN_RECEIPT_KIND) return Either.left("unsupported-kind");
  const receiptId = rumor.id;
  if (
    !rumor.tags.some(
      (tag) => tag[0] === "linky" && tag[1] === SEEN_RECEIPT_VALUE,
    ) ||
    !isRumorId(receiptId)
  ) {
    return Either.left("invalid-seen-receipt");
  }
  const seenUpToSec = decodeSeconds(rumor.content.trim());
  const sinceSec = decodeSeconds(firstTagValue(rumor.tags, "since"));
  if (seenUpToSec === null || sinceSec === null || sinceSec >= seenUpToSec) {
    return Either.left("invalid-seen-receipt");
  }

  if (rumor.pubkey === me) {
    const to = tagValues(rumor.tags, "p").find(
      (value): value is Pubkey => value !== me && isPubkey(value),
    );
    if (to === undefined) return Either.left("invalid-seen-receipt");
    const clientTag = firstTagValue(rumor.tags, "client");
    return Either.right(
      new OwnSeenReceiptConfirmed({
        receiptId,
        to,
        sinceSec,
        seenUpToSec,
        clientId:
          clientTag !== null && isClientId(clientTag) ? clientTag : null,
        sentAt: rumor.created_at,
      }),
    );
  }

  if (!tagValues(rumor.tags, "p").includes(me)) {
    return Either.left("not-addressed-to-me");
  }
  return Either.right(
    new SeenReceiptReceived({
      receiptId,
      from: rumor.pubkey,
      sinceSec,
      seenUpToSec,
      sentAt: rumor.created_at,
    }),
  );
};
