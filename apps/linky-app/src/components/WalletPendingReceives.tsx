import type React from "react";
import { useWalletInventory } from "../app/hooks/wallet/useWalletInventory";
import { navigateTo } from "../hooks/useRouting";
import { normalizeMintUrl } from "../utils/mint";
import { MintPendingPill } from "./MintPendingPill";

/** Tokens waiting for their mint; they are not part of the balance above. */
export const WalletPendingReceives = (): React.ReactElement | null => {
  const { deferredReceives: cashuDeferredReceives } = useWalletInventory();
  if (cashuDeferredReceives.length === 0) return null;

  const total = cashuDeferredReceives.reduce(
    (sum, deferral) => sum + deferral.amount,
    0,
  );
  const mints = [
    ...new Set(
      cashuDeferredReceives.map((deferral) => normalizeMintUrl(deferral.mint)),
    ),
  ];
  const openPending = () =>
    navigateTo(
      mints.length === 1 && mints[0] !== undefined
        ? { route: "mint", mintUrl: mints[0] }
        : { route: "mints" },
    );

  return (
    <MintPendingPill
      amount={total}
      testID="wallet-pending"
      onPress={openPending}
    />
  );
};
