import type {
  ProofState,
  ProofStateSnapshot,
  StoredProof,
} from "@linky-fit/linkshu";
import {
  Button,
  DataTable,
  EmptyState,
  LoadingState,
  Row,
  Stack,
  Text,
} from "@linky-fit/ui";
import type { FC, ReactNode } from "react";
import { useEffect, useMemo, useRef } from "react";
import type { InspectCashuProofStates } from "../app/hooks/composition/useLinkshuComposition";
import { useMoveMintFunds } from "../app/hooks/mint/useMoveMintFunds";
import { useDisplayAmounts, useTranslation } from "../app/hooks/shell";
import {
  useWalletBalance,
  useWalletInventory,
} from "../app/hooks/wallet/useWalletInventory";
import {
  useInspectCashuProofStates,
  useWalletTokens,
} from "../app/hooks/wallet/useWalletTokens";
import { getMintDisplay } from "../app/lib/tokenMessageInfo";
import { useTokenProofStates } from "../hooks/useTokenProofStates";
import type { I18nKey } from "../i18n";
import { useCanRestoreTokens } from "../app/hooks/settings/useIdentitySettings";
import { useWalletCommands } from "../app/hooks/wallet/useWalletCommands";

interface CashuProofsPageProps {
  inspectCashuProofStates: InspectCashuProofStates | null;
  canRestoreTokens: boolean;
  cashuBulkCheckIsBusy: boolean;
  cashuIsBusy: boolean;
  cashuMeltToMainMintButtonLabel: string | null;
  /** The whole inventory, every state. */
  cashuProofs: readonly StoredProof[];
  checkAllCashuTokensAndDeleteInvalid: () => Promise<void>;
  checkIssuedCashuTokensAndDeleteClaimed: () => Promise<{
    claimed: ReadonlyArray<{ amount: number; id: string }>;
  }>;
  meltLargestForeignMintToMainMint: () => Promise<void>;
  restoreMissingTokens: () => Promise<void>;
  reclaimHandedOutTokens: () => Promise<void>;
  restoreAndReclaimAllTokens: () => Promise<void>;
  tokensRestoreIsBusy: boolean;
}

const MINT_STATE_KEY: Record<ProofStateSnapshot["state"], I18nKey> = {
  unspent: "cashuMintStateUnspent",
  pending: "cashuMintStatePending",
  spent: "cashuMintStateSpent",
  unknown: "cashuMintStateUnknown",
};

const sum = (proofs: readonly StoredProof[]) =>
  proofs.reduce((total, proof) => total + proof.amount, 0);

interface ProofSectionProps {
  label: string;
  total: string;
  actions?: ReactNode;
  children: ReactNode;
}

const ProofSection = ({
  label,
  total,
  actions,
  children,
}: ProofSectionProps) => (
  <Stack aria-label={label} gap="$md">
    <Row justifyContent="space-between" flexWrap="wrap">
      <Text testID="proof-section-title">
        {label} · {total}
      </Text>
      {actions ? <Row gap="$sm">{actions}</Row> : null}
    </Row>
    {children}
  </Stack>
);

export const CashuProofsPage: FC<CashuProofsPageProps> = ({
  canRestoreTokens,
  inspectCashuProofStates,
  cashuBulkCheckIsBusy,
  cashuIsBusy,
  cashuMeltToMainMintButtonLabel,
  cashuProofs,
  checkAllCashuTokensAndDeleteInvalid,
  checkIssuedCashuTokensAndDeleteClaimed,
  meltLargestForeignMintToMainMint,
  restoreMissingTokens,
  reclaimHandedOutTokens,
  restoreAndReclaimAllTokens,
  tokensRestoreIsBusy,
}) => {
  const { t } = useTranslation();
  const { formatDisplayedAmountText } = useDisplayAmounts();

  const unspentProofs = useMemo(
    () => cashuProofs.filter((proof) => proof.state !== "spent"),
    [cashuProofs],
  );
  const {
    reports,
    loading: checkingProofs,
    refresh,
  } = useTokenProofStates(unspentProofs, inspectCashuProofStates);
  const mintStateById = useMemo(
    () => new Map(reports.map((report) => [report.proofId, report.state])),
    [reports],
  );

  const byState = (state: ProofState) =>
    unspentProofs
      .filter((proof) => proof.state === state)
      .sort((a, b) => b.amount - a.amount);
  const available = byState("available");
  const held = byState("held");
  const handedOut = [...byState("handedOut"), ...byState("externalized")];
  const spentCount = cashuProofs.length - unspentProofs.length;

  const checkAll = async () => {
    await checkAllCashuTokensAndDeleteInvalid();
    refresh();
  };

  // Handed-out proofs stay on record after their transfer closes (a
  // delivered messenger send) until the mint reports them spent, so the
  // claim check is offered whenever any are left, not only for issued ones.
  const hasHandedOut = handedOut.length > 0;
  const autoCheckedRef = useRef(false);
  useEffect(() => {
    if (!hasHandedOut) return;
    if (autoCheckedRef.current) return;
    autoCheckedRef.current = true;
    void checkIssuedCashuTokensAndDeleteClaimed().then(refresh);
  }, [checkIssuedCashuTokensAndDeleteClaimed, hasHandedOut, refresh]);

  const renderProofTable = (proofs: readonly StoredProof[]) => {
    if (proofs.length === 0) {
      return <EmptyState title={t("cashuNoProofs")} />;
    }
    return (
      <DataTable
        fill
        accessibilityLabel={t("cashuProofsTable")}
        columns={[
          { key: "amount", label: t("cashuProofsColumnAmount") },
          { key: "mint", label: t("cashuProofsColumnMint") },
          { key: "state", label: t("cashuProofsColumnMintState") },
        ]}
        rows={proofs.map((proof) => {
          const mintState = checkingProofs
            ? null
            : (mintStateById.get(proof.id) ?? "unknown");
          return {
            key: proof.id,
            cells: [
              formatDisplayedAmountText(proof.amount),
              getMintDisplay(proof.mint),
              mintState === null ? (
                <Text variant="caption" color="$colorMuted">
                  …
                </Text>
              ) : (
                t(MINT_STATE_KEY[mintState])
              ),
            ],
          };
        })}
      />
    );
  };

  const note = (text: string) => <Text color="$colorMuted">{text}</Text>;

  return (
    <Stack gap="$xxl">
      {checkingProofs ? (
        <LoadingState label={t("cashuCheckingProofs")} />
      ) : (
        <Text color="$colorMuted">{t("cashuInventoryHint")}</Text>
      )}

      <ProofSection
        label={t("cashuProofStateAvailable")}
        total={formatDisplayedAmountText(sum(available))}
        actions={
          <>
            <Button
              variant="secondary"
              size="sm"
              onPress={refresh}
              disabled={
                checkingProofs ||
                cashuIsBusy ||
                inspectCashuProofStates === null
              }
            >
              {t("cashuRefreshProofs")}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onPress={() => void checkAll()}
              disabled={
                cashuIsBusy ||
                cashuBulkCheckIsBusy ||
                checkingProofs ||
                unspentProofs.length === 0
              }
            >
              {t("cashuCheckAllTokens")}
            </Button>
          </>
        }
      >
        {renderProofTable(available)}
        {spentCount > 0
          ? note(
              t("cashuSpentProofsKept").replace("{count}", String(spentCount)),
            )
          : null}
        {cashuMeltToMainMintButtonLabel ? (
          <Button
            variant="secondary"
            onPress={() => void meltLargestForeignMintToMainMint()}
            disabled={cashuIsBusy || cashuBulkCheckIsBusy}
          >
            {cashuMeltToMainMintButtonLabel}
          </Button>
        ) : null}
        <Button
          variant="secondary"
          loading={tokensRestoreIsBusy}
          onPress={() => void restoreMissingTokens()}
          disabled={!canRestoreTokens || cashuIsBusy}
        >
          {t("restoreTokens")}
        </Button>
      </ProofSection>

      {held.length > 0 ? (
        <ProofSection
          label={t("cashuProofStateHeld")}
          total={formatDisplayedAmountText(sum(held))}
        >
          {note(
            held.some((proof) => proof.operationId === null)
              ? t("cashuHeldUnknownHint")
              : t("cashuHeldProofsHint"),
          )}
          {renderProofTable(held)}
        </ProofSection>
      ) : null}

      {handedOut.length > 0 ? (
        <ProofSection
          label={t("cashuProofStateHandedOut")}
          total={formatDisplayedAmountText(sum(handedOut))}
        >
          {renderProofTable(handedOut)}
          {note(t("cashuReclaimHint"))}
          <Button
            variant="secondary"
            onPress={() => void reclaimHandedOutTokens().then(refresh)}
            disabled={
              cashuIsBusy || cashuBulkCheckIsBusy || tokensRestoreIsBusy
            }
          >
            {t("cashuReclaimHandedOut")}
          </Button>
        </ProofSection>
      ) : null}

      <Stack gap="$md">
        {note(t("cashuRestoreAndReclaimHint"))}
        <Button
          variant="secondary"
          onPress={() => void restoreAndReclaimAllTokens().then(refresh)}
          disabled={
            !canRestoreTokens ||
            cashuIsBusy ||
            cashuBulkCheckIsBusy ||
            tokensRestoreIsBusy
          }
        >
          {t("cashuRestoreAndReclaimAll")}
        </Button>
      </Stack>
    </Stack>
  );
};

export const CashuProofsRoute: FC = () => {
  const canRestoreTokens = useCanRestoreTokens();
  const {
    reclaimHandedOutTokens,
    restoreAndReclaimAllTokens,
    restoreMissingTokens,
  } = useWalletCommands();
  const { proofs } = useWalletInventory();
  const { cashuIsBusy, cashuMeltToMainMintButtonLabel } = useWalletBalance();
  const tokens = useWalletTokens();
  const { meltToDefaultMint } = useMoveMintFunds();
  const inspectCashuProofStates = useInspectCashuProofStates();
  return (
    <CashuProofsPage
      canRestoreTokens={canRestoreTokens}
      cashuBulkCheckIsBusy={tokens.cashuBulkCheckIsBusy}
      cashuIsBusy={cashuIsBusy}
      cashuMeltToMainMintButtonLabel={cashuMeltToMainMintButtonLabel}
      cashuProofs={proofs}
      checkAllCashuTokensAndDeleteInvalid={
        tokens.checkAllCashuTokensAndDeleteInvalid
      }
      checkIssuedCashuTokensAndDeleteClaimed={
        tokens.checkIssuedCashuTokensAndDeleteClaimed
      }
      inspectCashuProofStates={inspectCashuProofStates}
      meltLargestForeignMintToMainMint={meltToDefaultMint}
      reclaimHandedOutTokens={reclaimHandedOutTokens}
      restoreAndReclaimAllTokens={restoreAndReclaimAllTokens}
      restoreMissingTokens={restoreMissingTokens}
      tokensRestoreIsBusy={tokens.tokensRestoreIsBusy}
    />
  );
};
