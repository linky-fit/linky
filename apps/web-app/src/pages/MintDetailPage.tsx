import { parseMintUrl } from "@linky-fit/linkshu";
import { sqliteTrue } from "@linky-fit/linksync";
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
import { useDisplayAmounts, useTranslation } from "../app/hooks/shell";
import { useMintSettingsContext } from "../app/context/SystemSettingsContexts";
import { holdingOf, mintHoldings } from "../app/lib/mintHoldings";
import { MintBadge } from "../components/MintBadge";
import { MintDeferredReceives } from "../components/MintDeferredReceives";
import { MintFees } from "../components/MintFees";
import { MintIcon } from "../components/MintIcon";
import { MintMoveFundsForm } from "../components/MintMoveFundsForm";
import { navigateTo } from "../hooks/useRouting";
import { LOCAL_MINT_INFO_STORAGE_KEY_PREFIX } from "../utils/constants";
import { normalizeLocale } from "../utils/formatting";
import {
  formatMintLabel,
  isHiddenTestMint,
  MAIN_MINT_URL,
  mintKindBadge,
  normalizeMintUrl,
  PRESET_MINTS,
} from "../utils/mint";
import { safeLocalStorageSetJson } from "../utils/storage";

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
  const {
    allowTestMints,
    appOwnerIdRef,
    applyDefaultMintSelection,
    cashuIsBusy,
    cashuProofs,
    defaultMintUrl,
    estimateMintMove,
    getMintIconUrl,
    getMintRuntime,
    mintInfoByUrl,
    moveMintFunds,
    refreshMintInfo,
    setMintInfoAll,
    setStatus,
  } = useMintSettingsContext();
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
    const ownerId = appOwnerIdRef.current;
    if (ownerId) {
      setMintInfoAll((prev) => {
        const next = prev.map((mintInfoRow) =>
          normalizeMintUrl(mintInfoRow.url) === cleaned
            ? { ...mintInfoRow, isDeleted: sqliteTrue }
            : mintInfoRow,
        );
        safeLocalStorageSetJson(
          `${LOCAL_MINT_INFO_STORAGE_KEY_PREFIX}.${ownerId}`,
          next,
        );
        return next;
      });
    }
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
                  {new Date(lastCheckedAtSec * 1000).toLocaleString(
                    normalizeLocale(lang),
                  )}
                </Text>
              ) : null}
            </Stack>
          </Section>
        </>
      ) : null}
    </Stack>
  );
}
