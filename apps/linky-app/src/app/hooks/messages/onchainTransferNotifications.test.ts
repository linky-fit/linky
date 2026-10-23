// @vitest-environment jsdom
import { createId, NonEmptyString100, PositiveInt } from "@linky-fit/linksync";
import type { OperatorTransferStatus } from "@linky-fit/onchain-transfer";
import { describe, expect, it, vi } from "vitest";
import type { PushToastOptions } from "../../../hooks/useToasts";
import { onchainTransferUpdateFixture } from "../../../testUtils/onchainTransfers";
import type { Route } from "../../../types/route";
import {
  notifyOnchainTransferUpdate,
  onchainTransferNotice,
} from "./onchainTransferNotifications";

const t = (key: string) => `${key} {total} {amount}`;
const amountText = (amountSat: number) => `${amountSat} sat`;

describe("onchainTransferNotice", () => {
  const notice = (
    status: OperatorTransferStatus,
    direction: "send" | "receive",
  ) =>
    onchainTransferNotice(
      onchainTransferUpdateFixture(createId<"OnchainTransfer">(), {
        status,
        sendAmount: 101_000,
      }),
      direction,
      100_000,
      t,
      amountText,
    );

  it("tells what to pay or send apart from what arrives once the details are ready", () => {
    expect(notice("accepted", "send")).toBe(
      "onchainSendReadyNotification 101000 sat 100000 sat",
    );
    expect(notice("accepted", "receive")).toBe(
      "onchainReceiveReadyNotification 101000 sat 100000 sat",
    );
  });

  it("tells completions, declines and refunds, and keeps quiet in between", () => {
    expect(notice("completed", "send")).toBe(
      "onchainSendCompletedNotification {total} 100000 sat",
    );
    expect(notice("completed", "receive")).toBeNull();
    expect(notice("denied", "send")).toBe(
      "onchainTransferDeniedNotification {total} {amount}",
    );
    expect(notice("refunded", "receive")).toBe(
      "onchainTransferRefundedNotification {total} {amount}",
    );
    for (const status of ["fundsSeen", "fundsReceived", "cancelled"] as const)
      expect(notice(status, "receive")).toBeNull();
  });
});

describe("notifyOnchainTransferUpdate", () => {
  const notify = (route: Route) => {
    const id = createId<"OnchainTransfer">();
    const pushToast =
      vi.fn<(message: string, options?: PushToastOptions) => void>();
    const maybeShowPwaNotification = vi.fn(async () => {});
    notifyOnchainTransferUpdate(
      onchainTransferUpdateFixture(id, { status: "completed" }),
      {
        direction: NonEmptyString100.orThrow("send"),
        amount: PositiveInt.orThrow(100_000),
      },
      {
        formatDisplayedAmountText: amountText,
        maybeShowPwaNotification,
        pushToast,
        route: route.kind === "onchainTransfer" ? { ...route, id } : route,
        t: (key) => key,
      },
    );
    return { id, maybeShowPwaNotification, pushToast };
  };

  it("shows a toast that opens the transfer and a PWA notification", () => {
    const { id, maybeShowPwaNotification, pushToast } = notify({
      kind: "wallet",
    });
    expect(pushToast).toHaveBeenCalledOnce();
    pushToast.mock.calls[0]?.[1]?.onClick?.();
    expect(window.location.hash).toBe(`#wallet/onchain/${id}`);
    expect(maybeShowPwaNotification).toHaveBeenCalledWith(
      "appTitle",
      "onchainSendCompletedNotification",
      `onchain_${id}`,
    );
  });

  it("stays quiet while the transfer is open", () => {
    const { maybeShowPwaNotification, pushToast } = notify({
      kind: "onchainTransfer",
      id: createId<"OnchainTransfer">(),
    });
    expect(pushToast).not.toHaveBeenCalled();
    expect(maybeShowPwaNotification).not.toHaveBeenCalled();
  });
});
