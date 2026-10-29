import { Stack, ListRow } from "@linky-fit/ui";
import React from "react";
import { useTranslation } from "../app/hooks/shell";
import { useLinkshuCommands } from "../app/hooks/composition/useLinkshuComposition";
import {
  useMintInfoByUrl,
  useRefreshMintInfo,
} from "../app/hooks/mint/useMintInfo";
import { getMintFeePpk } from "../app/hooks/mint/mintInfoHelpers";
import { useLightningFeeProbe } from "../app/hooks/mint/useLightningFeeProbe";
import { normalizeMintUrl } from "../utils/mint";
import { formatDisplayAmountText } from "../utils/displayAmounts";
import { nowSeconds } from "../utils/time";

// Rough proof count of a typical Cashu payment, used to express ppk in sats.
const TYPICAL_PAYMENT_PROOF_COUNT = 6;

const FEE_INFO_RETRY_SEC = 60;

// Fees are a few sats, which a fiat display unit would round to zero.
const formatSat = (amountSat: number, lang: string) =>
  formatDisplayAmountText(amountSat, {
    displayCurrency: "sat",
    fiatRates: null,
    lang,
  });

const formatCashuFee = (ppk: number, lang: string): string => {
  const sats = Math.ceil((ppk * TYPICAL_PAYMENT_PROOF_COUNT) / 1000);
  return sats === 0 ? formatSat(0, lang) : `~${formatSat(sats, lang)}`;
};

const formatPercent = (percent: number): string =>
  `~${percent.toFixed(1).replace(/\.0$/, "")} %`;

/** Fetches the mint's info once its keyset fee is unknown, at most once a minute. */
const useKeysetFeePpk = (mintUrl: string): number | null => {
  const mintInfoByUrl = useMintInfoByUrl();
  const refreshMintInfo = useRefreshMintInfo();
  const row = mintInfoByUrl.get(mintUrl);
  const ppk = getMintFeePpk(row?.feesJson);
  const checkedAtSec = row?.lastCheckedAtSec ?? 0;

  React.useEffect(() => {
    if (ppk !== null) return;
    if (nowSeconds() - checkedAtSec < FEE_INFO_RETRY_SEC) return;
    void refreshMintInfo(mintUrl);
  }, [checkedAtSec, mintUrl, ppk, refreshMintInfo]);

  return ppk;
};

interface MintFeesProps {
  mint: string;
}

export function MintFees({ mint }: MintFeesProps) {
  const probeLightningFee = useLinkshuCommands()?.probeLightningFee ?? null;
  const { lang, t } = useTranslation();
  const mintUrl = normalizeMintUrl(mint);
  const ppk = useKeysetFeePpk(mintUrl);
  const lightningFee = useLightningFeeProbe(probeLightningFee, mintUrl);

  return (
    <Stack testID="mint-fees" gap="$xs">
      <ListRow
        title={t("mintFeeCashuPayments")}
        value={ppk !== null ? formatCashuFee(ppk, lang) : t("unknown")}
      />
      <ListRow title={t("mintFeeLightningTopup")} value={formatSat(0, lang)} />
      <ListRow
        title={t("mintFeeLightningPayments")}
        value={
          lightningFee === "pending"
            ? "…"
            : lightningFee === "failed"
              ? t("unknown")
              : formatPercent(lightningFee.percent)
        }
      />
    </Stack>
  );
}
