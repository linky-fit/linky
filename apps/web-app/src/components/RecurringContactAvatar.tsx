import type { FC } from "react";
import { useAppShellCore } from "../app/context/AppShellContexts";
import type { RecurringContactSummary } from "../app/hooks/payments/useRecurringPaymentOrders";
import { deriveDefaultProfile } from "../derivedProfile";
import { getInitials } from "../utils/formatting";
import { Avatar } from "./Avatar";

interface RecurringContactAvatarProps {
  className: string;
  contact: RecurringContactSummary | undefined;
}

/** Contact picture, generated avatar, or a lightning glyph for LN-only contacts. */
export const RecurringContactAvatar: FC<RecurringContactAvatarProps> = ({
  className,
  contact,
}) => {
  const { nostrPictureByNpub } = useAppShellCore();
  const npub = contact?.npub ?? null;
  const pictureUrl = npub
    ? nostrPictureByNpub[npub] || deriveDefaultProfile(npub).pictureUrl
    : null;
  return (
    <div className={className} aria-hidden="true">
      {npub ? (
        <Avatar
          pictureUrl={pictureUrl}
          fallback={getInitials(contact?.name ?? "")}
          fallbackClassName="contact-avatar-fallback"
          loading="lazy"
        />
      ) : (
        <span className="contact-avatar-fallback transaction-icon-fallback">
          ⚡️
        </span>
      )}
    </div>
  );
};
