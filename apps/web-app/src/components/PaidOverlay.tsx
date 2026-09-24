import { ArrowDown, ArrowUp } from "lucide-react";
import React from "react";
import { useAppShellCore } from "../app/context/AppShellContexts";
import type { PaidOverlayDetails } from "../app/lib/paidOverlay";
import { deriveDefaultProfile } from "../derivedProfile";
import type { Translate } from "../i18n";
import { getInitials } from "../utils/formatting";
import { Avatar } from "./Avatar";

interface PaidOverlayProps {
  details: PaidOverlayDetails | null;
  paidOverlayTitle: string | null;
  t: Translate;
}

/**
 * The confirmation a settled payment ends on, in the same sheet as the
 * payment confirm dialog. Sent and received look alike: the other party's
 * face (or a check mark) with an animated arrow that says which way the money
 * went, their name in small print, then "Sent" or "Received" and the amount in
 * large print. Without a direction the caller's title is all there is.
 */
export function PaidOverlay({
  details,
  paidOverlayTitle,
  t,
}: PaidOverlayProps): React.ReactElement {
  const { formatDisplayedAmountParts, nostrPictureByNpub } = useAppShellCore();
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
  const headline =
    direction === null
      ? (paidOverlayTitle ?? t("paid"))
      : direction === "out"
        ? t("paidHeadlineSent")
        : t("paidHeadlineReceived");
  const figureClassName = [
    "paid-figure",
    direction === null ? "" : `is-${direction}`,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className="paid-overlay"
      role="status"
      aria-live="assertive"
      aria-label={paidOverlayTitle ?? headline}
    >
      <div className="modal-sheet lightning-invoice-confirm-sheet paid-sheet">
        <div className={figureClassName} aria-hidden="true">
          {contact ? (
            <div className="contact-avatar is-xl paid-avatar">
              <Avatar
                pictureUrl={pictureUrl}
                fallback={getInitials(contact.name ?? "")}
                fallbackClassName="contact-avatar-fallback"
                loading="eager"
              />
            </div>
          ) : (
            <div className="paid-check">✓</div>
          )}
          {direction !== null ? (
            <span className="paid-direction-badge">
              {direction === "out" ? (
                <ArrowUp size={22} strokeWidth={3} />
              ) : (
                <ArrowDown size={22} strokeWidth={3} />
              )}
            </span>
          ) : null}
        </div>
        {contact?.name ? (
          <div className="paid-contact-name recurring-truncate">
            {contact.name}
          </div>
        ) : null}
        <div className="paid-title">{headline}</div>
        {amount !== null ? (
          <div className="paid-amount">
            {amount.approxPrefix}
            {amount.amountText}
            <span className="paid-amount-unit">{amount.unitLabel}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
