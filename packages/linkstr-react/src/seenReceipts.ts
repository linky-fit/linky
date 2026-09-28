import { SeenReceipts } from "@linky-fit/linkstr";
import type { SeenReceiptDraft } from "@linky-fit/linkstr";
import { Effect } from "effect";
import { linkstrRuntimeAtom } from "./runtime";

export const sendSeenReceiptAtom = linkstrRuntimeAtom.fn<SeenReceiptDraft>()(
  (draft) => Effect.flatMap(SeenReceipts, (receipts) => receipts.send(draft)),
);
