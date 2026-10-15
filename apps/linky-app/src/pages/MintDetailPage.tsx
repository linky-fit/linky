import { parseMintUrl } from "@linky-fit/linkshu";
import {
  Button,
  Divider,
  EmptyState,
  Row,
  Section,
  Stack,
  Text,
  ListRow,
} from "@linky-fit/ui";
import { useArmedAction } from "../hooks/useArmedAction";
import {
  useDisplayAmounts,
  useSetStatus,
  useTranslation,
} from "../app/hooks/shell";
import { useMoveMintFunds } from "../app/hooks/mint/useMoveMintFunds";
import {
  useDeleteMint,
  useMintIcons,
  useMintInfoByUrl,
  useMintRuntime,
  useRefreshMintInfo,
} from "../app/hooks/mint/useMintInfo";
import { useAllowTestMints } from "../app/hooks/useAllowTestMints";
import { useDefaultMintUrl } from "../app/hooks/wallet/useDefaultMint";
import { useApplyDefaultMint } from "../app/hooks/wallet/useNpubCash";
import { useWalletInventory } from "../app/hooks/wallet/useWalletInventory";
import { useWalletOps } from "../app/hooks/wallet/useWalletOps";
import { holdingOf, mintHoldings } from "../app/lib/mintHoldings";
import { MintBadge } from "../components/MintBadge";
import { MintDeferredReceives } from "../components/MintDeferredReceives";
import { MintFees } from "../components/MintFees";
import { MintIcon } from "../components/MintIcon";
import { MintMoveFundsForm } from "../components/MintMoveFundsForm";
import { navigateTo } from "../hooks/useRouting";
import { formatTimeAgo } from "../utils/formatting";
import {
  formatMintLabel,
  isHiddenTestMint,
  MAIN_MINT_URL,
  mintKindBadge,
  normalizeMintUrl,
  PRESET_MINTS,
} from "../utils/mint";

/** Other mints funds can move to: the default first, then funded mints and presets. */
const moveTargets = (
  sourceMint: string,
  defaultMint: string,
  fundedMints: readonly string[],
  allowTestMints: boolean,
): string[] =>
  [defaultMint, ...fundedMints, ...PRESET_MINTS]
    .map(normalizeMintUrl)
    .filter(
      (mint, index, all) =>
        all.indexOf(mint) === index &&
        mint !== sourceMint &&
        !isHiddenTestMint(mint, allowTestMints),
    );

interface MintDetailPageProps {
  mintUrl: string;
}

export function MintDetailPage({ mintUrl }: MintDetailPageProps) {
  const { allowTestMints } = useAllowTestMints();
  const applyDefaultMintSelection = useApplyDefaultMint();
  const { walletOpRunning: cashuIsBusy } = useWalletOps();
  const { proofs: cashuProofs } = useWalletInventory();
  const defaultMintUrl = useDefaultMintUrl();
  const { estimateMintMove, moveMintFunds } = useMoveMintFunds();
  const { getMintIconUrl } = useMintIcons();
  const getMintRuntime = useMintRuntime();
  const mintInfoByUrl = useMintInfoByUrl();
  const refreshMintInfo = useRefreshMintInfo();
  const deleteMintInfo = useDeleteMint();
  const setStatus = useSetStatus();
  const { lang, t } = useTranslation();
  const { formatDisplayedAmountText } = useDisplayAmounts();
  const deleteAction = useArmedAction(() => setStatus(t("deleteArmedHint")));

  const cleaned = normalizeMintUrl(mintUrl);
  const row = mintInfoByUrl.get(cleaned) ?? null;
  const holdings = mintHoldings(cashuProofs);
  const holding = holdingOf(holdings, cleaned);
  const defaultMint = normalizeMintUrl(defaultMintUrl ?? MAIN_MINT_URL);
  const isDefault = cleaned === defaultMint;

  if (
    parseMintUrl(cleaned) === null ||
    isHiddenTestMint(cleaned, allowTestMints)
  ) {
    return <EmptyState title={t("mintNotFound")} />;
  }

  const fundedMints = [...holdings]
    .filter(([, mintHolding]) => mintHolding.balance > 0)
    .map(([mint]) => mint);

  const runtime = getMintRuntime(cleaned);
  const lastCheckedAtSec = runtime?.lastCheckedAtSec ?? 0;
  const latencyMs = runtime?.latencyMs ?? null;
  const kindBadge = mintKindBadge(cleaned);

  const deleteMint = () => {
    deleteMintInfo(cleaned);
    navigateTo({ route: "mints" });
  };

  return (
    <Stack gap="$lg">
      <Stack gap="$md">
        <Row gap="$sm" paddingBottom="$sm">
          <MintIcon getMintIconUrl={getMintIconUrl} mint={cleaned} size="sm" />
          <Text
            variant="title"
            testID="mint-detail-name"
            numberOfLines={1}
            flexShrink={1}
          >
            {formatMintLabel(cleaned)}
          </Text>
          <Row testID="mint-detail-badges" gap="$sm">
            {isDefault ? <MintBadge kind="default" /> : null}
            {kindBadge !== null ? <MintBadge kind={kindBadge} /> : null}
          </Row>
        </Row>
        {isDefault ? null : (
          <Button
            variant="secondary"
            disabled={cashuIsBusy}
            onPress={() => void applyDefaultMintSelection(cleaned)}
          >
            {t("mintSetAsDefault")}
          </Button>
        )}
      </Stack>

      <Divider />

      <Section title={t("mintFundsTitle")}>
        <ListRow
          icon="Wallet"
          title={t("mintBalance")}
          value={formatDisplayedAmountText(holding.balance)}
        />
      </Section>

      <MintDeferredReceives mint={cleaned} />

      {holding.balance > 0 ? (
        <>
          <Divider />
          <Section title={t("mintMoveTitle")}>
            <MintMoveFundsForm
              key={cleaned}
              available={holding.balance}
              busy={cashuIsBusy}
              estimateMintMove={estimateMintMove}
              getMintIconUrl={getMintIconUrl}
              moveMintFunds={moveMintFunds}
              sourceMint={cleaned}
              targets={moveTargets(
                cleaned,
                defaultMint,
                fundedMints,
                allowTestMints,
              )}
            />
          </Section>
        </>
      ) : null}

      <Divider />

      <Section title={t("mintFees")}>
        <MintFees mint={cleaned} />
      </Section>

      {row !== null ? (
        <>
          <Divider />
          <Section title={t("mintInfoTitle")}>
            <Stack gap="$lg">
              <ListRow
                icon="Gauge"
                title={t("mintLatency")}
                value={latencyMs !== null ? `${latencyMs} ms` : t("unknown")}
              />
              <Button
                variant="secondary"
                size="sm"
                alignSelf="flex-start"
                onPress={() => void refreshMintInfo(cleaned)}
              >
                {t("mintRefresh")}
              </Button>
              <Button
                variant={deleteAction.armed ? "danger" : "secondary"}
                onPress={() => deleteAction.confirm(deleteMint)}
              >
                {t("mintDelete")}
              </Button>
              {lastCheckedAtSec ? (
                <Text variant="caption" color="$colorMuted">
                  {t("mintLastChecked")}:{" "}
                  {formatTimeAgo(lastCheckedAtSec, lang)}
                </Text>
              ) : null}
            </Stack>
          </Section>
        </>
      ) : null}
    </Stack>
  );
}
