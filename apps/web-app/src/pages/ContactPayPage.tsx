import { Bean, Zap } from "lucide-react";
import { useEffect, type FC } from "react";
import { useAppShellCore } from "../app/context/AppShellContexts";
import { Avatar } from "../components/Avatar";
import { RequestIcon } from "../components/icons";
import { LnurlPayPreviewNotices } from "../components/LnurlPayPreviewNotices";
import { PaymentAmountPanel } from "../components/PaymentAmountPanel";
import type { ContactId } from "../evolu";
import {
  getLnurlPayAmountRangeError,
  useLnurlPayPreview,
} from "../hooks/useLnurlPayPreview";
import { getInitials } from "../utils/formatting";
import { normalizeNpubIdentifier } from "../utils/nostrNpub";

interface Contact {
  id: ContactId;
  name?: string | null;
  lnAddress?: string | null;
  npub?: string | null;
}

interface ContactPayPageProps {
  cashuBalance: number;
  cashuBalanceAfterMelt: number;
  cashuIsBusy: boolean;
  contactPaymentIntent: "pay" | "request";
  contactPayMethod: "lightning" | "cashu" | null;
  displayUnit: string;
  nostrPictureByNpub: Record<string, string | null>;
  payAmount: string;
  paySelectedContact: () => Promise<void>;
  payWithCashuEnabled: boolean;
  requestSelectedContact: () => Promise<void>;
  selectedContact: Contact | null;
  setContactPayMethod: React.Dispatch<
    React.SetStateAction<"lightning" | "cashu" | null>
  >;
  setPayAmount: (value: string | ((prev: string) => string)) => void;
}

export const ContactPayPage: FC<ContactPayPageProps> = ({
  cashuBalance,
  cashuBalanceAfterMelt,
  cashuIsBusy,
  contactPaymentIntent,
  contactPayMethod,
  displayUnit,
  nostrPictureByNpub,
  payAmount,
  paySelectedContact,
  payWithCashuEnabled,
  requestSelectedContact,
  selectedContact,
  setContactPayMethod,
  setPayAmount,
}) => {
  const { formatDisplayedAmountText, t } = useAppShellCore();

  const ln = (selectedContact?.lnAddress ?? "").trim();
  const npub = normalizeNpubIdentifier(selectedContact?.npub ?? "");
  const url = npub ? nostrPictureByNpub[npub] : null;
  const isRequestFlow = contactPaymentIntent === "request";
  const canUseCashu = payWithCashuEnabled && Boolean(npub);
  const canUseLightning = Boolean(ln);
  const showToggle = !isRequestFlow && canUseCashu && canUseLightning;
  const method = isRequestFlow
    ? "cashu"
    : contactPayMethod === "lightning" || contactPayMethod === "cashu"
      ? contactPayMethod
      : canUseCashu
        ? "cashu"
        : "lightning";

  // Load the LNURL-pay request up front so a fixed amount is prefilled and
  // min/max limits are shown before the user tries to submit.
  const lightningActive = !isRequestFlow && method === "lightning" && ln !== "";
  const lnurlPreview = useLnurlPayPreview(lightningActive ? ln : "");
  const { fixedAmountSat } = lnurlPreview;

  useEffect(() => {
    if (fixedAmountSat === null) return;
    const next = String(fixedAmountSat);
    setPayAmount((current) => (current === next ? current : next));
  }, [fixedAmountSat, setPayAmount]);

  if (!selectedContact) {
    return (
      <section className="panel">
        <p className="muted">{t("contactNotFound")}</p>
      </section>
    );
  }

  const methodIcon = isRequestFlow ? (
    <RequestIcon size={18} />
  ) : method === "lightning" ? (
    <Zap size={18} />
  ) : (
    <Bean size={18} />
  );

  const amountSat = Number.parseInt(payAmount.trim(), 10);
  const validAmount =
    Number.isFinite(amountSat) && amountSat > 0 ? amountSat : 0;
  const canCoverAnything = cashuBalance > 0;
  const availableAmountText = `${t("availablePrefix")} ${formatDisplayedAmountText(
    cashuBalance,
  )}`;
  const lnurlRangeError = lightningActive
    ? getLnurlPayAmountRangeError(lnurlPreview.preview, amountSat, t)
    : null;
  const invalid = isRequestFlow
    ? !npub || !Number.isFinite(amountSat) || amountSat <= 0
    : (method === "lightning" ? !ln : !canUseCashu) ||
      !Number.isFinite(amountSat) ||
      amountSat <= 0 ||
      validAmount > cashuBalanceAfterMelt ||
      (lightningActive &&
        (lnurlPreview.loading ||
          lnurlPreview.error !== null ||
          lnurlRangeError !== null));

  return (
    <PaymentAmountPanel
      amount={payAmount}
      cashuIsBusy={cashuIsBusy}
      displayUnit={displayUnit}
      header={
        <div className="contact-header">
          <div className="contact-avatar is-large" aria-hidden="true">
            <Avatar
              pictureUrl={url}
              fallback={getInitials(selectedContact.name ?? "")}
              fallbackClassName="contact-avatar-fallback"
              loading="lazy"
            />
          </div>
          <div className="contact-header-text">
            {selectedContact.name && (
              <div className="contact-pay-heading-row">
                <h3 className="unspaced">{selectedContact.name}</h3>
                <button
                  type="button"
                  className={
                    showToggle
                      ? "pay-method-toggle"
                      : "pay-method-toggle is-disabled"
                  }
                  onClick={() => {
                    if (!showToggle) return;
                    setContactPayMethod((prev) =>
                      prev === "lightning" ? "cashu" : "lightning",
                    );
                  }}
                  aria-label={method === "lightning" ? "Lightning" : "Cashu"}
                  title={
                    showToggle
                      ? method === "lightning"
                        ? "Lightning"
                        : "Cashu"
                      : undefined
                  }
                >
                  {methodIcon}
                </button>
              </div>
            )}
            <p className="muted">
              {isRequestFlow ? (
                t("requestPaymentHint")
              ) : (
                <button
                  type="button"
                  className="copyable available-amount-button muted"
                  disabled={!canCoverAnything}
                  onClick={() => {
                    if (!canCoverAnything) return;
                    setPayAmount(String(cashuBalance));
                  }}
                >
                  {availableAmountText}
                </button>
              )}
            </p>
          </div>
        </div>
      }
      notices={
        <>
          {!isRequestFlow && method === "cashu" && !payWithCashuEnabled && (
            <p className="muted">{t("payWithCashuDisabled")}</p>
          )}

          {method === "cashu" && !npub && (
            <p className="muted">{t("chatMissingContactNpub")}</p>
          )}

          {method === "lightning" && !ln && (
            <p className="muted">{t("payMissingLn")}</p>
          )}

          {lightningActive && (
            <LnurlPayPreviewNotices
              error={lnurlPreview.error}
              loading={lnurlPreview.loading}
              preview={lnurlPreview.preview}
              t={t}
            />
          )}
        </>
      }
      onAmountChange={setPayAmount}
      onSubmit={() => {
        if (isRequestFlow) {
          void requestSelectedContact();
          return;
        }
        void paySelectedContact();
      }}
      sendGuideId={isRequestFlow ? "request-send" : "pay-send"}
      stepGuideId="pay-step3"
      submitBusy={!isRequestFlow && cashuIsBusy}
      submitDisabled={invalid}
      submitIcon={isRequestFlow ? <RequestIcon size={18} /> : undefined}
      submitLabel={isRequestFlow ? t("requestPaymentSend") : undefined}
      submitTitle={
        !isRequestFlow &&
        method === "lightning" &&
        validAmount > cashuBalanceAfterMelt
          ? t("payInsufficient")
          : (lnurlRangeError ?? undefined)
      }
      t={t}
    />
  );
};
