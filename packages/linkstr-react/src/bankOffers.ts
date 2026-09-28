import { BankOffers } from "@linky-fit/linkstr";
import type { BankOfferDraft } from "@linky-fit/linkstr";
import { Effect } from "effect";
import { linkstrRuntimeAtom } from "./runtime";

export const sendBankOfferAtom = linkstrRuntimeAtom.fn<BankOfferDraft>()(
  (draft) => Effect.flatMap(BankOffers, (bankOffers) => bankOffers.send(draft)),
);
