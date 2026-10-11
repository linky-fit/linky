import { useAtomSet, useAtomValue } from "@linky-fit/linkstr-react";
import { Option } from "effect";
import { AsyncResult } from "effect/reactivity";
import React from "react";
import type { Translate } from "../../../i18n";
import type { DisplayAmountParts } from "../../../utils/displayAmounts";
import { contactsOnboardingHasPaidAtom } from "../../state/contacts/onboarding";
import type { FundsCheck } from "../../state/wallet/payments";
import { paymentsCommandsAtom } from "../../state/wallet/payments";

/** A paid/queued copy template with its `{amount}`, `{unit}` and `{name}` filled in. */
export const paymentCopy = (
  template: string,
  amount: DisplayAmountParts,
  name = "",
): string =>
  template
    .replace("{amount}", `${amount.approxPrefix}${amount.amountText}`)
    .replace("{unit}", amount.unitLabel)
    .replace("{name}", name);

/** The payment commands, null until the linkshu runtime is up. */
export const usePaymentsCommands = () =>
  Option.getOrNull(AsyncResult.value(useAtomValue(paymentsCommandsAtom)));

/** Remembers that the user paid once, which ends the contacts onboarding. */
export const useRememberFirstPayment = () => {
  const setHasPaid = useAtomSet(contactsOnboardingHasPaidAtom);
  return React.useCallback(() => setHasPaid(true), [setHasPaid]);
};

export type Shortfall = Exclude<FundsCheck, { readonly _tag: "Covered" }>;

interface UsePaymentMintMoveParams {
  meltToDefaultMint: () => Promise<void>;
  setStatus: React.Dispatch<React.SetStateAction<string | null>>;
  t: Translate;
  walletOpRunning: boolean;
}

/**
 * A payment no single mint covers: either the move into the default mint
 * the user confirms first, or the insufficient-funds status.
 */
export const usePaymentMintMove = ({
  meltToDefaultMint,
  setStatus,
  t,
  walletOpRunning,
}: UsePaymentMintMoveParams) => {
  const [
    pendingPaymentMintMeltConfirmation,
    setPendingPaymentMintMeltConfirmation,
  ] = React.useState<{ fromMint: string; toMint: string } | null>(null);

  const reportShortfall = React.useCallback(
    (shortfall: Shortfall) => {
      if (shortfall._tag === "Insufficient") {
        setStatus(t("payInsufficient"));
        return;
      }
      setPendingPaymentMintMeltConfirmation({
        fromMint: shortfall.fromMint,
        toMint: shortfall.toMint,
      });
    },
    [setStatus, t],
  );

  const closePaymentMintMeltConfirmation = React.useCallback(() => {
    if (walletOpRunning) return;
    setPendingPaymentMintMeltConfirmation(null);
  }, [walletOpRunning]);

  const confirmPaymentMintMelt = React.useCallback(async () => {
    if (walletOpRunning) return;
    setPendingPaymentMintMeltConfirmation(null);
    await meltToDefaultMint();
  }, [meltToDefaultMint, walletOpRunning]);

  return {
    closePaymentMintMeltConfirmation,
    confirmPaymentMintMelt,
    pendingPaymentMintMeltConfirmation,
    reportShortfall,
  };
};
