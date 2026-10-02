import { Avatar } from "@linky-fit/ui";
import type { AvatarSize } from "@linky-fit/ui";
import type { FC } from "react";
import { useAppShellCore } from "../app/context/AppShellContexts";
import type { RecurringContactSummary } from "../app/hooks/payments/useRecurringPaymentOrders";
import { deriveDefaultProfile } from "../derivedProfile";

interface RecurringContactAvatarProps {
  contact: RecurringContactSummary | undefined;
  size?: AvatarSize | undefined;
}

/** Contact picture, generated avatar, or a lightning glyph for LN-only contacts. */
export const RecurringContactAvatar: FC<RecurringContactAvatarProps> = ({
  contact,
  size,
}) => {
  const { nostrPictureByNpub } = useAppShellCore();
  const npub = contact?.npub ?? null;
  const pictureUrl = npub
    ? nostrPictureByNpub[npub] || deriveDefaultProfile(npub).pictureUrl
    : null;
  return (
    <Avatar
      name={contact?.name ?? ""}
      uri={pictureUrl ?? undefined}
      fallback={npub ? undefined : "⚡️"}
      size={size}
    />
  );
};
