import type { StoredOperation, TokenText } from "@linky-fit/linkshu";
import { Button, Dialog, Divider, Row, Section, Stack } from "@linky-fit/ui";
import React from "react";
import {
  useCopyText,
  useDisplayAmounts,
  useTranslation,
} from "../app/hooks/shell";
import { useMintSettingsContext } from "../app/context/SystemSettingsContexts";
import { normalizeMintUrl } from "../utils/mint";
import { MintPendingPill } from "./MintPendingPill";

interface MintDeferredReceivesProps {
  mint: string;
}

/** Tokens waiting for this mint, with a way to keep their text and give up on them. */
export function MintDeferredReceives({
  mint,
}: MintDeferredReceivesProps): React.ReactElement | null {
  const { cashuDeferredReceives, discardCashuDeferredReceive } =
    useMintSettingsContext();
  const { t } = useTranslation();
  const { formatDisplayedAmountText } = useDisplayAmounts();
  const copyText = useCopyText();
  const [discarding, setDiscarding] = React.useState<StoredOperation | null>(
    null,
  );
  const [isDiscardBusy, setIsDiscardBusy] = React.useState(false);

  const deferrals = cashuDeferredReceives.filter(
    (deferral) => normalizeMintUrl(deferral.mint) === mint,
  );
  if (deferrals.length === 0) return null;

  const copyTokenButton = (tokenText: TokenText | null, inRow: boolean) =>
    tokenText === null ? null : (
      <Button
        variant="secondary"
        icon="Copy"
        flex={inRow ? 1 : undefined}
        disabled={isDiscardBusy}
        onPress={() => void copyText(tokenText)}
      >
        {t("cashuDeferredCopyToken")}
      </Button>
    );

  const closeWarning = () => {
    if (!isDiscardBusy) setDiscarding(null);
  };

  const confirmDiscard = async (deferral: StoredOperation) => {
    setIsDiscardBusy(true);
    try {
      await discardCashuDeferredReceive(deferral.id);
    } finally {
      setIsDiscardBusy(false);
      setDiscarding(null);
    }
  };

  return (
    <>
      <Divider />
      <Section title={t("mintPendingTitle")}>
        {deferrals.map((deferral) => (
          <Stack key={deferral.id} testID="mint-deferred-receive" gap="$sm">
            <MintPendingPill amount={deferral.amount} testID="mint-pending" />
            <Row gap="$sm">
              {copyTokenButton(deferral.tokenText, true)}
              <Button
                variant="secondary"
                flex={1}
                onPress={() => setDiscarding(deferral)}
              >
                {t("cashuDeferredDiscard")}
              </Button>
            </Row>
          </Stack>
        ))}
      </Section>
      {discarding !== null ? (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) closeWarning();
          }}
          title={t("cashuDeferredDiscardTitle")}
          description={t("cashuDeferredDiscardBody").replace(
            "{amount}",
            formatDisplayedAmountText(discarding.amount),
          )}
          actions={
            <>
              {copyTokenButton(discarding.tokenText, false)}
              <Button
                variant="danger"
                loading={isDiscardBusy}
                onPress={() => void confirmDiscard(discarding)}
              >
                {t("cashuDeferredDiscard")}
              </Button>
              <Button
                variant="secondary"
                disabled={isDiscardBusy}
                onPress={closeWarning}
              >
                {t("cancel")}
              </Button>
            </>
          }
        />
      ) : null}
    </>
  );
}
