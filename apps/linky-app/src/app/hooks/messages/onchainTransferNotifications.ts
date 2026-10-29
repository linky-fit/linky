import type { OnchainTransferRow } from "@linky-fit/linksync";
import {
  OnchainTransferDirection,
  type OnchainTransferUpdate,
} from "@linky-fit/onchain-transfer";
import { Schema } from "effect";
import { navigateTo } from "../../../hooks/useRouting";
import type { Translate } from "../../../i18n";
import type { Route } from "../../../types/route";
import {
  showVisibleToast,
  type InboxNotificationsContext,
} from "./inboxNotifications";

export type OnchainTransferNotificationsContext = Pick<
  InboxNotificationsContext,
  "formatDisplayedAmountText" | "maybeShowPwaNotification" | "pushToast" | "t"
> & { readonly route: Route };

/** What an update means for the user: ready (what to pay or send, apart from what arrives), a send completed, declined or refunded; null for the steps in between and a receive the operator calls completed, which only its own ecash completes. */
export const onchainTransferNotice = (
  update: OnchainTransferUpdate,
  direction: OnchainTransferDirection,
  amount: number,
  t: Translate,
  amountText: (amountSat: number) => string,
): string | null => {
  const send = direction === "send";
  switch (update.status) {
    case "accepted":
      return t(
        send
          ? "onchainSendReadyNotification"
          : "onchainReceiveReadyNotification",
      )
        .replace("{total}", amountText(update.sendAmount))
        .replace("{amount}", amountText(amount));
    case "completed":
      return send
        ? t("onchainSendCompletedNotification").replace(
            "{amount}",
            amountText(amount),
          )
        : null;
    case "denied":
      return t("onchainTransferDeniedNotification");
    case "refunded":
      return t("onchainTransferRefundedNotification");
    default:
      return null;
  }
};

const isDirection = Schema.is(OnchainTransferDirection);

/** Tells the user about a live update with a toast and a PWA notification, unless the transfer is open; an acceptance of a send the user already paid is no news. */
export const notifyOnchainTransferUpdate = (
  update: OnchainTransferUpdate,
  transfer: Pick<OnchainTransferRow, "amount" | "direction" | "sentAtSec">,
  ctx: OnchainTransferNotificationsContext,
): void => {
  const { route } = ctx;
  if (route.kind === "onchainTransfer" && route.id === update.transferId) {
    return;
  }
  if (!isDirection(transfer.direction) || transfer.amount === null) return;
  if (
    update.status === "accepted" &&
    transfer.direction === "send" &&
    transfer.sentAtSec !== null
  )
    return;
  const text = onchainTransferNotice(
    update,
    transfer.direction,
    transfer.amount,
    ctx.t,
    ctx.formatDisplayedAmountText,
  );
  if (text === null) return;
  showVisibleToast(ctx, text, {
    onClick: () =>
      navigateTo({ route: "onchainTransfer", id: update.transferId }),
  });
  void ctx.maybeShowPwaNotification(
    ctx.t("appTitle"),
    text,
    `onchain_${update.transferId}`,
  );
};
