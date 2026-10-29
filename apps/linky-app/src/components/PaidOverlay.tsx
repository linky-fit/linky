import { useAtomValue } from "@linky-fit/linkstr-react";
import { PaymentBanner } from "@linky-fit/ui";
import React from "react";
import { useNostrPictureByNpub } from "../app/hooks/contacts/useProfileCache";
import { useDisplayAmounts } from "../app/hooks/shell";
import type {
  PaidOverlayDetails,
  PaidOverlayPhase,
} from "../app/lib/paidOverlay";
import { contactsAtom } from "../app/state/contacts/readModel";
import { paidOverlayCommandsAtom } from "../app/state/shell/paidOverlay";
import { deriveDefaultProfile } from "../derivedProfile";
import type { Translate } from "../i18n";

interface PaidOverlayProps {
  details: PaidOverlayDetails | null;
  paidOverlayTitle: string | null;
  phase: PaidOverlayPhase;
  t: Translate;
}

/**
 * A payment's progress and the confirmation it ends on, sent or received,
 * as a banner at the top of the screen that leaves the rest usable.
 */
export function PaidOverlay({
  details,
  paidOverlayTitle,
  phase,
  t,
}: PaidOverlayProps): React.ReactElement {
  const { formatDisplayedAmountParts } = useDisplayAmounts();
  const { dismissPaid } = useAtomValue(paidOverlayCommandsAtom);
  const nostrPictureByNpub = useNostrPictureByNpub();
  const contacts = useAtomValue(contactsAtom);
  const contact = details?.contact ?? null;
  const npub = contact?.npub ?? null;
  // The saved contact's name follows its profile, which can arrive after the payment started.
  const name =
    (npub ? contacts.find((saved) => saved.npub === npub)?.name : null) ??
    contact?.name;
  const pictureUrl = npub
    ? nostrPictureByNpub[npub] || deriveDefaultProfile(npub).pictureUrl
    : null;
  const direction = details?.direction ?? null;
  const amount =
    details?.amountSat != null && details.amountSat > 0
      ? formatDisplayedAmountParts(details.amountSat)
      : null;
  const isSending = phase === "sending";
  const headline = isSending
    ? t("paidHeadlineSending")
    : direction === null
      ? (paidOverlayTitle ?? t("paid"))
      : direction === "out"
        ? t("paidHeadlineSent")
        : t("paidHeadlineReceived");

  return (
    <PaymentBanner
      title={headline}
      amount={amount ? `${amount.approxPrefix}${amount.amountText}` : undefined}
      unit={amount?.unitLabel}
      avatar={
        contact ? { name: name ?? "", uri: pictureUrl ?? undefined } : undefined
      }
      direction={direction ?? undefined}
      pending={isSending}
      onDismiss={dismissPaid}
    />
  );
}
