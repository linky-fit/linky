import type { MintBalance } from "@linky-fit/linkshu";
import { useAtomValue } from "@linky-fit/linkstr-react";
import React from "react";
import type { Route } from "../../../types/route";
import type { WarmCashuMint } from "../../state/linkshu/commands";
import { platformAtom } from "../../state/platform";
import { useScanIsOpen } from "../shell/scan";

const PAYMENT_INTENT_ROUTES = new Set<Route["kind"]>([
  "manualPay",
  "contactPay",
  "lnAddressPay",
  "lnInvoicePay",
  "cashuTokenEmit",
]);

export const isPaymentIntentActive = (
  routeKind: Route["kind"],
  scanIsOpen: boolean,
): boolean => scanIsOpen || PAYMENT_INTENT_ROUTES.has(routeKind);

interface UsePaymentMintWarmupParams {
  readonly mintBalances: ReadonlyArray<MintBalance>;
  readonly routeKind: Route["kind"];
  readonly warmCashuMint: WarmCashuMint | null;
}

/**
 * Preloads wallet instances for funded mints once the user shows payment
 * intent (opening the QR scanner or entering a payment route).
 */
export const usePaymentMintWarmup = ({
  mintBalances,
  routeKind,
  warmCashuMint,
}: UsePaymentMintWarmupParams): void => {
  const scanIsOpen = useScanIsOpen();
  const { lifecycle } = useAtomValue(platformAtom);
  const active = isPaymentIntentActive(routeKind, scanIsOpen);

  React.useEffect(() => {
    if (!active || warmCashuMint === null || !lifecycle.isOnline()) return;
    for (const { mint, amount } of mintBalances) {
      if (amount > 0) void warmCashuMint(mint).catch(() => {});
    }
  }, [active, lifecycle, mintBalances, warmCashuMint]);
};
