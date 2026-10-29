import { Divider, Progress, Row, Stack, Text } from "@linky-fit/ui";
import { useDisplayAmounts, useTranslation } from "../app/hooks/shell";
import { useMintIcons } from "../app/hooks/mint/useMintInfo";
import { useAllowTestMints } from "../app/hooks/useAllowTestMints";
import { useDefaultMintUrl } from "../app/hooks/wallet/useDefaultMint";
import { useWalletInventory } from "../app/hooks/wallet/useWalletInventory";
import { holdingOf, mintHoldings } from "../app/lib/mintHoldings";
import {
  FloatingActionButton,
  floatingActionButtonClearance,
} from "../components/FloatingActionButton";
import { MintButton } from "../components/MintButton";
import { MintFees } from "../components/MintFees";
import { MintPendingPill } from "../components/MintPendingPill";
import { navigateTo } from "../hooks/useRouting";
import {
  formatMintLabel,
  isHiddenTestMint,
  isTestMintUrl,
  MAIN_MINT_URL,
  mintKindBadge,
  normalizeMintUrl,
  PRESET_MINTS,
} from "../utils/mint";

export function MintsPage() {
  const { allowTestMints } = useAllowTestMints();
  const { deferredReceives: cashuDeferredReceives, proofs: cashuProofs } =
    useWalletInventory();
  const defaultMintUrl = useDefaultMintUrl();
  const { getMintIconUrl } = useMintIcons();
  const { t } = useTranslation();
  const { formatDisplayedAmountText } = useDisplayAmounts();
  const selectedMint =
    normalizeMintUrl(defaultMintUrl ?? MAIN_MINT_URL) || MAIN_MINT_URL;

  const holdings = mintHoldings(cashuProofs, cashuDeferredReceives);
  const buttonMints = (() => {
    const set = new Set<string>(PRESET_MINTS.map(normalizeMintUrl));
    if (selectedMint) set.add(selectedMint);
    for (const [mint, holding] of holdings) {
      if (holding.balance > 0 || holding.pending > 0) set.add(mint);
    }
    return Array.from(set.values()).filter(
      (mint) => !isHiddenTestMint(mint, allowTestMints),
    );
  })();
  const standardMints = buttonMints.filter((mint) => !isTestMintUrl(mint));
  const testMints = buttonMints.filter((mint) => isTestMintUrl(mint));
  const listedBalance = buttonMints.reduce(
    (sum, mint) => sum + holdingOf(holdings, mint).balance,
    0,
  );

  const renderHolding = (mint: string) => {
    const { balance, pending } = holdingOf(holdings, mint);
    if (balance <= 0 && pending <= 0) return null;
    const amountText = formatDisplayedAmountText(balance);
    return (
      <Stack testID="mint-holding" gap="$sm">
        <Row flexWrap="wrap" gap="$md">
          {balance > 0 ? (
            <Text variant="caption" color="$colorMuted">
              {amountText}
            </Text>
          ) : null}
          {pending > 0 ? (
            <MintPendingPill amount={pending} size="sm" testID="mint-pending" />
          ) : null}
        </Row>
        {balance > 0 ? (
          <Progress
            value={balance}
            max={listedBalance}
            accessibilityLabel={amountText}
          />
        ) : null}
      </Stack>
    );
  };

  const renderMintButton = (mint: string) => {
    const normalized = normalizeMintUrl(mint);
    const isSelected = normalized === selectedMint;
    const holding = renderHolding(normalized);

    return (
      <Stack key={mint} testID="mint-choice" gap="$sm" paddingBottom="$sm">
        <MintButton
          mint={mint}
          getMintIconUrl={getMintIconUrl}
          isSelected={isSelected}
          label={formatMintLabel(mint)}
          badge={mintKindBadge(mint)}
          onPress={() => navigateTo({ route: "mint", mintUrl: normalized })}
        />
        {holding}
        {isSelected ? <MintFees mint={normalized} /> : null}
      </Stack>
    );
  };

  return (
    <>
      <Stack gap="$sm" paddingBottom={floatingActionButtonClearance}>
        {standardMints.map((mint) => renderMintButton(mint))}
        {testMints.length > 0 ? (
          <Stack testID="mint-test-group" gap="$sm">
            {standardMints.length > 0 ? <Divider /> : null}
            {testMints.map((mint) => renderMintButton(mint))}
          </Stack>
        ) : null}
      </Stack>
      <FloatingActionButton
        icon="CirclePlus"
        label={t("mintAdd")}
        onPress={() => navigateTo({ route: "mintNew" })}
      />
    </>
  );
}
