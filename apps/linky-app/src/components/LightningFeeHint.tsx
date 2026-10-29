import { planSendMint } from "@linky-fit/linkshu";
import { useAtomValue } from "@linky-fit/linkstr-react";
import { Text } from "@linky-fit/ui";
import React from "react";
import { useLinkshuCommands } from "../app/hooks/composition/useLinkshuComposition";
import { useLightningFeeProbe } from "../app/hooks/mint/useLightningFeeProbe";
import { useTranslation } from "../app/hooks/shell";
import { useWalletInventory } from "../app/hooks/wallet/useWalletInventory";
import { isSpellingOf } from "../app/lib/mintSpelling";
import { defaultMintAtom } from "../app/state/wallet/defaultMint";
import { formatDisplayAmountText } from "../utils/displayAmounts";

interface LightningFeeHintProps {
  amountSat: number;
}

/**
 * What a Lightning payment of `amountSat` is likely to cost in fees, from the
 * probed fee of the mint that would pay it; nothing until that fee is known.
 */
export function LightningFeeHint({
  amountSat,
}: LightningFeeHintProps): React.ReactElement | null {
  const { lang, t } = useTranslation();
  const probeLightningFee = useLinkshuCommands()?.probeLightningFee ?? null;
  const { balances } = useWalletInventory();
  const defaultMint = useAtomValue(defaultMintAtom);
  const mint = planSendMint({
    balances: balances.perMint,
    amount: amountSat,
    isPreferredMint: isSpellingOf(defaultMint),
  });
  const lightningFee = useLightningFeeProbe(probeLightningFee, mint);
  if (typeof lightningFee === "string") return null;
  // Fees are a few sats, which a fiat display unit would round to zero.
  const feeText = formatDisplayAmountText(
    Math.ceil((amountSat * lightningFee.percent) / 100),
    { displayCurrency: "sat", fiatRates: null, lang },
  );
  return (
    <Text variant="caption" color="$colorMuted" testID="lightning-fee-hint">
      {t("payLightningFeeHint").replace("{fee}", feeText)}
    </Text>
  );
}
