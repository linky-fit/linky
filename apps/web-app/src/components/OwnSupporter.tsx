import { Avatar, type AvatarProps } from "@linky-fit/ui";
import React from "react";
import { useOwnSupporterBadge } from "../app/hooks/useOwnSupporterPerks";
import type { Translate } from "../i18n";
import { SupporterLine } from "./SupporterLine";

/** The user's own avatar with the supporter badge their contacts see. */
export function OwnAvatar(
  props: Omit<AvatarProps, "supporter">,
): React.ReactElement {
  return <Avatar {...props} supporter={useOwnSupporterBadge()} />;
}

export function OwnSupporterLine({
  t,
}: {
  t: Translate;
}): React.ReactElement | null {
  return <SupporterLine kind={useOwnSupporterBadge()} t={t} />;
}
