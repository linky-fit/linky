import { PaymentNotices } from "@linky-fit/linkstr";
import type { PaymentNoticeDraft } from "@linky-fit/linkstr";
import { Effect } from "effect";
import { linkstrRuntimeAtom } from "./runtime";

export const sendPaymentNoticeAtom =
  linkstrRuntimeAtom.fn<PaymentNoticeDraft>()((draft) =>
    Effect.flatMap(PaymentNotices, (paymentNotices) =>
      paymentNotices.send(draft),
    ),
  );
