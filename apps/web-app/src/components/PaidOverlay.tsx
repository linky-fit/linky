import { SuccessOverlay } from "@linky-fit/ui";
import React from "react";
import { useNostrPictureByNpub } from "../app/hooks/contacts/useProfileCache";
import { useDisplayAmounts } from "../app/hooks/shell";
import type {
  PaidOverlayDetails,
  PaidOverlayPhase,
} from "../app/lib/paidOverlay";
import { deriveDefaultProfile } from "../derivedProfile";
import type { Translate } from "../i18n";

interface PaidOverlayProps {
  details: PaidOverlayDetails | null;
  paidOverlayTitle: string | null;
  phase: PaidOverlayPhase;
  t: Translate;
}

/** The confirmation a settled payment ends on, sent or received. */
export function PaidOverlay({
  details,
  paidOverlayTitle,
  phase,
  t,
}: PaidOverlayProps): React.ReactElement {
  const { formatDisplayedAmountParts } = useDisplayAmounts();
  const nostrPictureByNpub = useNostrPictureByNpub();
  const contact = details?.contact ?? null;
  const npub = contact?.npub ?? null;
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
    <SuccessOverlay
      title={headline}
      amount={amount ? `${amount.approxPrefix}${amount.amountText}` : undefined}
      unit={amount?.unitLabel}
      avatar={
        contact
          ? { name: contact.name ?? "", uri: pictureUrl ?? undefined }
          : undefined
      }
      direction={direction ?? undefined}
      pending={isSending}
    />
  );
}
