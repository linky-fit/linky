import type { SupporterBadgeKind } from "@linky-fit/ui";
import React from "react";
import { useEveryMinute } from "../../hooks/useEveryMinute";
import {
  getContactSupporterAwards,
  subscribeContactSupporterAwards,
} from "../lib/contactSupporterAwards";
import { supporterValiditySeconds } from "../lib/supporter";
import { shownSupporterBadge } from "../lib/supporterPerks";

/** The badge a contact shows on their avatar, verified against Linky Bot; awards lapse without a reload. */
export const useContactSupporterBadge = (
  npub: string | null,
): SupporterBadgeKind | undefined => {
  const awards = React.useSyncExternalStore(
    subscribeContactSupporterAwards,
    () => (npub ? getContactSupporterAwards(npub) : null),
  );
  return useEveryMinute(
    (nowSec) =>
      (awards &&
        shownSupporterBadge(awards, nowSec, supporterValiditySeconds)) ??
      undefined,
  );
};
