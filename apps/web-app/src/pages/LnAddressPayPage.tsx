import { useEffect, type FC } from "react";
import { useAppShellCore } from "../app/context/AppShellContexts";
import { Avatar } from "../components/Avatar";
import { LnurlPayPreviewNotices } from "../components/LnurlPayPreviewNotices";
import { PaymentAmountPanel } from "../components/PaymentAmountPanel";
import {
  getLnurlPayAmountRangeError,
  useLnurlPayPreview,
} from "../hooks/useLnurlPayPreview";
import {
  getLnurlPayDisplayText,
  inferLightningAddressFromLnurlTarget,
} from "../lnurlPay";
import { formatMiddleDots, getInitials } from "../utils/formatting";

interface LnAddressPayKnownContact {
  lnAddress?: string | null;
  name?: string | null;
}

interface LnAddressPayPageProps {
  canPayWithCashu: boolean;
  cashuBalance: number;
  cashuBalanceAfterMelt: number;
  cashuIsBusy: boolean;
  displayUnit: string;
  knownContact: LnAddressPayKnownContact | null;
  knownContactPictureUrl: string | null;
  lnAddress: string;
  lnAddressPayAmount: string;
  payLightningAddressWithCashu: (
    lnAddress: string,
    amountSat: number,
  ) => Promise<void>;
  setLnAddressPayAmount: (value: string | ((prev: string) => string)) => void;
}

export const LnAddressPayPage: FC<LnAddressPayPageProps> = ({
  canPayWithCashu,
  cashuBalance,
  cashuBalanceAfterMelt,
  cashuIsBusy,
  displayUnit,
  knownContact,
  knownContactPictureUrl,
  lnAddress,
  lnAddressPayAmount,
  payLightningAddressWithCashu,
  setLnAddressPayAmount,
}) => {
  const { formatDisplayedAmountText, t } = useAppShellCore();
  const {
    error: previewError,
    fixedAmountSat,
    loading: previewLoading,
    preview,
  } = useLnurlPayPreview(lnAddress);

  useEffect(() => {
    if (fixedAmountSat === null) return;
    const next = String(fixedAmountSat);
    setLnAddressPayAmount((current) => (current === next ? current : next));
  }, [fixedAmountSat, setLnAddressPayAmount]);

  const amountSat = Number.parseInt(lnAddressPayAmount.trim(), 10);
  const displayTarget = formatMiddleDots(getLnurlPayDisplayText(lnAddress), 36);
  const inferredLightningAddress =
    inferLightningAddressFromLnurlTarget(lnAddress);
  const displayAddress = formatMiddleDots(
    knownContact?.lnAddress ??
      preview?.lightningAddress ??
      inferredLightningAddress ??
      displayTarget,
    36,
  );
  const canCoverAnything = cashuBalance > 0;
  const availableAmountText = `${t("availablePrefix")} ${formatDisplayedAmountText(
    cashuBalance,
  )}`;

  const rangeError = getLnurlPayAmountRangeError(preview, amountSat, t);

  const invalid =
    !canPayWithCashu ||
    !Number.isFinite(amountSat) ||
    amountSat <= 0 ||
    amountSat > cashuBalanceAfterMelt ||
    previewLoading ||
    previewError !== null ||
    rangeError !== null;

  let submitTitle: string | undefined;
  if (amountSat > cashuBalanceAfterMelt) {
    submitTitle = t("payInsufficient");
  } else if (rangeError !== null) {
    submitTitle = rangeError;
  }

  return (
    <PaymentAmountPanel
      amount={lnAddressPayAmount}
      cashuIsBusy={cashuIsBusy || previewLoading}
      displayUnit={displayUnit}
      header={
        <div className="contact-header">
          {knownContact ? (
            <div className="contact-avatar is-large" aria-hidden="true">
              <Avatar
                pictureUrl={knownContactPictureUrl}
                fallback={getInitials(knownContact.name ?? "")}
                fallbackClassName="contact-avatar-fallback"
                loading="lazy"
              />
            </div>
          ) : null}
          <div className="contact-header-text">
            {knownContact?.name ? <h3>{knownContact.name}</h3> : null}
            <p className="muted">{displayAddress}</p>
            <p className="muted">
              <button
                type="button"
                className="copyable available-amount-button muted"
                disabled={!canCoverAnything}
                onClick={() => {
                  if (!canCoverAnything) return;
                  setLnAddressPayAmount(String(cashuBalance));
                }}
              >
                {availableAmountText}
              </button>
            </p>
          </div>
        </div>
      }
      notices={
        <LnurlPayPreviewNotices
          error={previewError}
          loading={previewLoading}
          preview={preview}
          t={t}
        />
      }
      onAmountChange={setLnAddressPayAmount}
      onSubmit={() => {
        if (invalid) return;
        void payLightningAddressWithCashu(lnAddress, amountSat);
      }}
      submitBusy={cashuIsBusy}
      submitDisabled={invalid}
      submitTitle={submitTitle}
      t={t}
    />
  );
};
