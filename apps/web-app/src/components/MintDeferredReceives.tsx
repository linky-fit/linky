import type { StoredOperation, TokenText } from "@linky-fit/linkshu";
import { Clock } from "lucide-react";
import React from "react";
import {
  useAppShellActions,
  useAppShellCore,
} from "../app/context/AppShellContexts";
import { useMintSettingsContext } from "../app/context/SystemSettingsContexts";
import { normalizeMintUrl } from "../utils/mint";
import { ModalSheet } from "./ModalSheet";

interface MintDeferredReceivesProps {
  mint: string;
}

/** Tokens waiting for this mint, with a way to keep their text and give up on them. */
export function MintDeferredReceives({
  mint,
}: MintDeferredReceivesProps): React.ReactElement | null {
  const { cashuDeferredReceives, discardCashuDeferredReceive } =
    useMintSettingsContext();
  const { formatDisplayedAmountText, t } = useAppShellCore();
  const { copyText } = useAppShellActions();
  const [discarding, setDiscarding] = React.useState<StoredOperation | null>(
    null,
  );
  const [isDiscardBusy, setIsDiscardBusy] = React.useState(false);

  const deferrals = cashuDeferredReceives.filter(
    (deferral) => normalizeMintUrl(deferral.mint) === mint,
  );
  if (deferrals.length === 0) return null;

  const pendingAmount = (deferral: StoredOperation) =>
    t("mintPendingAmount").replace(
      "{amount}",
      formatDisplayedAmountText(deferral.amount),
    );

  const copyTokenButton = (tokenText: TokenText | null) =>
    tokenText === null ? null : (
      <button
        type="button"
        className="btn-wide secondary"
        disabled={isDiscardBusy}
        onClick={() => void copyText(tokenText)}
      >
        {t("cashuDeferredCopyToken")}
      </button>
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
    <div className="settings-section">
      <h2 className="settings-section-title">{t("mintPendingTitle")}</h2>
      {deferrals.map((deferral) => (
        <div key={deferral.id} className="mint-deferred-receive">
          <span className="mint-choice-pending">
            <Clock aria-hidden="true" />
            {pendingAmount(deferral)}
          </span>
          <div className="mint-deferred-receive-actions">
            {copyTokenButton(deferral.tokenText)}
            <button
              type="button"
              className="btn-wide secondary"
              onClick={() => setDiscarding(deferral)}
            >
              {t("cashuDeferredDiscard")}
            </button>
          </div>
        </div>
      ))}
      {discarding !== null ? (
        <ModalSheet
          aria-label={t("cashuDeferredDiscardTitle")}
          onClick={closeWarning}
        >
          <div className="modal-title">{t("cashuDeferredDiscardTitle")}</div>
          <div className="modal-body">
            {t("cashuDeferredDiscardBody").replace(
              "{amount}",
              formatDisplayedAmountText(discarding.amount),
            )}
          </div>
          <div className="modal-actions">
            {copyTokenButton(discarding.tokenText)}
            <button
              type="button"
              className="btn-wide danger"
              disabled={isDiscardBusy}
              onClick={() => void confirmDiscard(discarding)}
            >
              {t("cashuDeferredDiscard")}
            </button>
            <button
              type="button"
              className="btn-wide secondary"
              disabled={isDiscardBusy}
              onClick={closeWarning}
            >
              {t("cancel")}
            </button>
          </div>
        </ModalSheet>
      ) : null}
    </div>
  );
}
