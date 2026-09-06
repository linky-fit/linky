import {
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  FileText,
  ImagePlus,
  Landmark,
  Share2,
  X,
} from "lucide-react";
import React from "react";
import {
  getBankPaymentOfferStatusLabel,
  type LinkyBankPaymentOfferInfo,
  type LinkyBankPaymentOfferStatus,
  type LinkyBankPaymentOfferStaggerRecord,
} from "../app/lib/bankPaymentOffer";
import {
  isPrivatePdfPayload,
  type PrivateImageMessagePayload,
} from "../app/lib/privateImageMessage";
import type { ContactRowLike, LocalNostrMessage } from "../app/types/appTypes";
import { Avatar } from "../components/Avatar";
import { BankPaymentAmount } from "../components/BankPaymentAmount";
import { PrivateFileBubble } from "../components/PrivateFileBubble";
import { PrivateImageBubble } from "../components/PrivateImageBubble";
import type { Translate } from "../i18n";
import { getInitials } from "../utils/formatting";
import { normalizeNpubIdentifier } from "../utils/nostrNpub";

export interface BankPaymentOfferEntry {
  info: LinkyBankPaymentOfferInfo;
  message: LocalNostrMessage;
}

export interface BankPaymentFieldRow {
  key: string;
  label: string;
  value: string;
}

export interface BankPaymentConfirmation {
  message: LocalNostrMessage;
  payload: PrivateImageMessagePayload;
}

interface PaymentConfirmationProps {
  confirmation: BankPaymentConfirmation;
  t: Translate;
}

const PaymentConfirmation = ({ confirmation, t }: PaymentConfirmationProps) => {
  const rumorId = (confirmation.message.rumorId ?? "").trim() || null;
  return (
    <div className="bank-payment-offer-confirmation">
      <strong>{t("bankPaymentOfferConfirmation")}</strong>
      {isPrivatePdfPayload(confirmation.payload) ? (
        <PrivateFileBubble
          onBlobChange={() => undefined}
          payload={confirmation.payload}
          rumorId={rumorId}
          t={t}
        />
      ) : (
        <PrivateImageBubble
          onBlobChange={() => undefined}
          payload={confirmation.payload}
          rumorId={rumorId}
          t={t}
        />
      )}
    </div>
  );
};

export interface PendingConfirmation {
  fileName: string;
  imageUrl: string | null;
}

interface PendingPaymentConfirmationProps {
  pending: PendingConfirmation;
  t: Translate;
}

const PendingPaymentConfirmation = ({
  pending,
  t,
}: PendingPaymentConfirmationProps) => (
  <div className="bank-payment-offer-confirmation">
    <strong>{t("bankPaymentOfferConfirmation")}</strong>
    {pending.imageUrl ? (
      <img
        className="chat-private-image"
        src={pending.imageUrl}
        alt={t("bankPaymentOfferConfirmation")}
      />
    ) : (
      <span className="chat-private-file">
        <span className="chat-private-file-icon" aria-hidden="true">
          <FileText size={28} />
        </span>
        <span className="chat-private-file-name">{pending.fileName}</span>
      </span>
    )}
  </div>
);

interface RecipientProgressProps {
  status: LinkyBankPaymentOfferStatus;
  t: Translate;
}

const RecipientProgress = ({ status, t }: RecipientProgressProps) => {
  const hasAccepted =
    status === "accepted" ||
    status === "bank_details_sent" ||
    status === "bank_paid" ||
    status === "settled";
  const hasPaidFiat = status === "bank_paid" || status === "settled";
  const steps = [
    {
      // The offer exists, so the first phase is always done — this makes the
      // bar read as progress instead of an empty checklist.
      isComplete: true,
      key: "offered",
      label: t("bankPaymentOfferProgressOffered"),
    },
    {
      isComplete: hasAccepted,
      key: "accepted",
      label: t("bankPaymentOfferProgressAccept"),
    },
    {
      isComplete: hasPaidFiat,
      key: "fiat",
      label: t("bankPaymentOfferProgressBankPayment"),
    },
    {
      isComplete: status === "settled",
      key: "bitcoin",
      label: t("bankPaymentOfferProgressSats"),
    },
  ];
  const completedCount = steps.filter((step) => step.isComplete).length;

  return (
    <div
      className="bank-payment-offer-progress"
      aria-label={t("bankPaymentOfferProgressTitle")}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={steps.length}
      aria-valuenow={completedCount}
    >
      {steps.map((step) => (
        <div
          className={`bank-payment-offer-progress-step${step.isComplete ? " is-complete" : ""}`}
          key={step.key}
        >
          <span
            className="bank-payment-offer-progress-segment"
            aria-hidden="true"
          />
          <span>{step.label}</span>
        </div>
      ))}
    </div>
  );
};

interface RequesterIntroProps {
  amountText: string;
  canCycleAmount: boolean;
  requesterName: string;
  status: LinkyBankPaymentOfferStatus;
  t: Translate;
}

const RequesterIntro = ({
  amountText,
  canCycleAmount,
  requesterName,
  status,
  t,
}: RequesterIntroProps) => (
  <div className="bank-payment-offer-requester-intro">
    <strong>
      {t("bankPaymentOfferRequestedBy").replace("{name}", requesterName)}
    </strong>
    <BankPaymentAmount canCycle={canCycleAmount} text={amountText} />
    <RecipientProgress status={status} t={t} />
  </div>
);

interface ExpiredOfferViewProps {
  t: Translate;
  closeOffer: () => void;
}

export function ExpiredOfferView({ t, closeOffer }: ExpiredOfferViewProps) {
  return (
    <section className="panel panel-plain bank-payment-offer-state-page">
      <div className="bank-payment-offer-state-copy">
        <h2>{t("bankPaymentOfferExpiredTitle")}</h2>
        <p className="muted">{t("bankPaymentOfferExpiredDescription")}</p>
      </div>
      <button type="button" className="btn-wide" onClick={closeOffer}>
        {t("close")}
      </button>
    </section>
  );
}

interface OwnerOfferViewProps {
  activeEntry: BankPaymentOfferEntry;
  activeAmountText: string;
  t: Translate;
  remainingSec: number | null;
  timerWithExtension: (
    offerEntry: BankPaymentOfferEntry,
    remainingSec: number,
  ) => React.ReactElement;
  acceptedInfoText: string | null;
  offerEntries: BankPaymentOfferEntry[];
  contacts: readonly ContactRowLike[];
  nostrPictureByNpub: Record<string, string | null>;
  queuedRecipients: LinkyBankPaymentOfferStaggerRecord["pending"];
  confirmation: BankPaymentConfirmation | null;
  canSettle: boolean;
  isSettling: boolean;
  settleOffer: () => Promise<void>;
  canCancel: boolean;
  responseStatus: "accepted" | "canceled" | "declined" | null;
  cancelOffer: () => Promise<void>;
}

export function OwnerOfferView({
  activeEntry,
  activeAmountText,
  t,
  remainingSec,
  timerWithExtension,
  acceptedInfoText,
  offerEntries,
  contacts,
  nostrPictureByNpub,
  queuedRecipients,
  confirmation,
  canSettle,
  isSettling,
  settleOffer,
  canCancel,
  responseStatus,
  cancelOffer,
}: OwnerOfferViewProps) {
  return (
    <section className="panel panel-plain bank-payment-offer-owner-page">
      <div className="bank-payment-offer-owner-summary">
        <BankPaymentAmount
          canCycle={Boolean(activeEntry.info.amountSat)}
          text={activeAmountText}
        />
        <RecipientProgress status={activeEntry.info.status} t={t} />
        {remainingSec !== null
          ? timerWithExtension(activeEntry, remainingSec)
          : null}
        {acceptedInfoText ? <p className="muted">{acceptedInfoText}</p> : null}
      </div>

      <div className="bank-payment-offer-recipient-list">
        {offerEntries.map((offerEntry) => {
          const contactId = offerEntry.message.contactId.trim();
          const contact = contacts.find(
            (candidate) => (candidate.id ?? "").trim() === contactId,
          );
          const name = (contact?.name ?? "").trim() || t("unknownContactTitle");
          const npub = normalizeNpubIdentifier(contact?.npub ?? "");
          const pictureUrl = npub ? (nostrPictureByNpub[npub] ?? null) : null;
          return (
            <OfferRecipientRow
              key={contactId}
              name={name}
              pictureUrl={pictureUrl}
              status={offerEntry.info.status}
              label={getBankPaymentOfferStatusLabel(
                offerEntry.info.status,
                false,
                t,
              )}
            />
          );
        })}
        {queuedRecipients.map((recipient) => {
          const contact = contacts.find(
            (candidate) => (candidate.id ?? "").trim() === recipient.contactId,
          );
          const name = (contact?.name ?? "").trim() || t("unknownContactTitle");
          const npub = normalizeNpubIdentifier(contact?.npub ?? "");
          const pictureUrl = npub ? (nostrPictureByNpub[npub] ?? null) : null;
          return (
            <OfferRecipientRow
              key={recipient.contactId}
              name={name}
              pictureUrl={pictureUrl}
              status={"queued"}
              label={t("bankPaymentOfferStatusQueued")}
            />
          );
        })}
      </div>

      {confirmation ? (
        <PaymentConfirmation confirmation={confirmation} t={t} />
      ) : null}

      {canSettle ? (
        <button
          type="button"
          className="btn-wide"
          disabled={isSettling}
          onClick={() => void settleOffer()}
        >
          <span className="btn-label-with-icon">
            <span className="btn-label-icon" aria-hidden="true">
              {isSettling ? <span className="btn-spinner" /> : <Check />}
            </span>
            <span>
              {isSettling ? t("chatPendingShort") : t("bankPaymentOfferSettle")}
            </span>
          </span>
        </button>
      ) : null}
      {canCancel ? (
        <button
          type="button"
          className="btn-wide secondary"
          disabled={responseStatus !== null}
          onClick={() => void cancelOffer()}
        >
          <span className="btn-label-with-icon">
            <X size={18} />
            <span>
              {t(
                canSettle
                  ? "bankPaymentOfferNotPaid"
                  : "bankPaymentOfferCancel",
              )}
            </span>
          </span>
        </button>
      ) : null}
    </section>
  );
}

interface RejectedOfferViewProps {
  t: Translate;
  entry: BankPaymentOfferEntry;
  amountText: string;
  requesterName: string;
  closeOffer: () => void;
}

export function RejectedOfferView({
  t,
  entry,
  amountText,
  requesterName,
  closeOffer,
}: RejectedOfferViewProps) {
  return (
    <section className="panel panel-plain bank-payment-offer-state-page">
      <div className="bank-payment-offer-state-copy">
        <h2>{t("bankPaymentOfferRejectedTitle")}</h2>
        <BankPaymentAmount
          canCycle={Boolean(entry.info.amountSat)}
          text={amountText}
        />
        <p className="muted">
          {t("bankPaymentOfferRejectedDescription").replace(
            "{name}",
            requesterName,
          )}
        </p>
      </div>
      <button type="button" className="btn-wide" onClick={closeOffer}>
        {t("chatImageBackToChat")}
      </button>
    </section>
  );
}

interface AcceptedByOtherOfferViewProps {
  t: Translate;
  closeOffer: () => void;
}

export function AcceptedByOtherOfferView({
  t,
  closeOffer,
}: AcceptedByOtherOfferViewProps) {
  return (
    <section className="panel panel-plain bank-payment-offer-state-page">
      <div className="bank-payment-offer-state-copy">
        <h2>{t("bankPaymentOfferStatusAcceptedByOther")}</h2>
        <p className="muted">{t("bankPaymentOfferAcceptedByOther")}</p>
      </div>
      <button type="button" className="btn-wide" onClick={closeOffer}>
        {t("close")}
      </button>
    </section>
  );
}

interface IncomingOfferViewProps {
  amountText: string;
  entry: BankPaymentOfferEntry;
  requesterName: string;
  t: Translate;
  timerWithExtension: (
    offerEntry: BankPaymentOfferEntry,
    remainingSec: number,
  ) => React.ReactElement;
  remainingSec: number;
  errorText: string | null;
  responseStatus: "accepted" | "canceled" | "declined" | null;
  respond: (nextStatus: "accepted" | "declined") => Promise<void>;
}

export function IncomingOfferView({
  amountText,
  entry,
  requesterName,
  t,
  timerWithExtension,
  remainingSec,
  errorText,
  responseStatus,
  respond,
}: IncomingOfferViewProps) {
  return (
    <section className="panel panel-plain bank-payment-offer-state-page">
      <div className="bank-payment-offer-state-copy">
        <RequesterIntro
          amountText={amountText}
          canCycleAmount={Boolean(entry.info.amountSat)}
          requesterName={requesterName}
          status={entry.info.status}
          t={t}
        />
        {timerWithExtension(entry, remainingSec)}
      </div>

      {errorText ? <p className="error-text">{errorText}</p> : null}

      <div className="bank-payment-offer-decision-actions">
        <button
          type="button"
          className="btn-wide"
          disabled={responseStatus !== null}
          onClick={() => {
            void respond("accepted");
          }}
        >
          {responseStatus === "accepted"
            ? t("chatPendingShort")
            : t("bankPaymentOfferAccept")}
        </button>
        <button
          type="button"
          className="btn-wide secondary"
          disabled={responseStatus !== null}
          onClick={() => {
            void respond("declined");
          }}
        >
          {responseStatus === "declined" ? t("chatPendingShort") : t("decline")}
        </button>
      </div>
    </section>
  );
}

interface InvalidOfferViewProps {
  t: Translate;
}

export function InvalidOfferView({ t }: InvalidOfferViewProps) {
  return (
    <section className="panel panel-plain bank-payment-page">
      <p className="muted bank-payment-hint">{t("spdPaymentInvalid")}</p>
    </section>
  );
}

interface WaitingForSatsOfferViewProps {
  t: Translate;
  entry: BankPaymentOfferEntry;
  amountText: string;
  confirmation: BankPaymentConfirmation | null;
  pendingConfirmation: PendingConfirmation | null;
  confirmationInputRef: React.RefObject<HTMLInputElement | null>;
  attachConfirmation: (file: File) => Promise<void>;
  isAttachingConfirmation: boolean;
  requesterName: string;
  remainingSec: number | null;
  timerWithExtension: (
    offerEntry: BankPaymentOfferEntry,
    remainingSec: number,
  ) => React.ReactElement;
  errorText: string | null;
}

export function WaitingForSatsOfferView({
  t,
  entry,
  amountText,
  confirmation,
  pendingConfirmation,
  confirmationInputRef,
  attachConfirmation,
  isAttachingConfirmation,
  requesterName,
  remainingSec,
  timerWithExtension,
  errorText,
}: WaitingForSatsOfferViewProps) {
  return (
    <section className="panel panel-plain bank-payment-offer-state-page">
      <div className="bank-payment-offer-state-copy">
        <h2>{t("bankPaymentOfferWaitingForSatsTitle")}</h2>
        <BankPaymentAmount
          canCycle={Boolean(entry.info.amountSat)}
          text={amountText}
        />
        <RecipientProgress status={entry.info.status} t={t} />
      </div>

      {confirmation ? (
        <PaymentConfirmation confirmation={confirmation} t={t} />
      ) : pendingConfirmation ? (
        <PendingPaymentConfirmation pending={pendingConfirmation} t={t} />
      ) : (
        <>
          <input
            ref={confirmationInputRef}
            className="chat-image-input"
            type="file"
            accept="image/*,application/pdf,.pdf"
            onChange={(event) => {
              const file = event.target.files?.[0] ?? null;
              event.currentTarget.value = "";
              if (!file) return;
              void attachConfirmation(file);
            }}
            tabIndex={-1}
          />
          <button
            type="button"
            className="btn-wide"
            disabled={isAttachingConfirmation}
            onClick={() => confirmationInputRef.current?.click()}
          >
            <span className="btn-label-with-icon">
              <span className="btn-label-icon" aria-hidden="true">
                {isAttachingConfirmation ? (
                  <span className="btn-spinner" />
                ) : (
                  <ImagePlus />
                )}
              </span>
              <span>
                {isAttachingConfirmation
                  ? t("chatPendingShort")
                  : t("bankPaymentOfferAttachConfirmation")}
              </span>
            </span>
          </button>
        </>
      )}

      <div className="bank-payment-offer-state-copy">
        <p className="muted">
          {t("bankPaymentOfferWaitingForSatsDescription").replace(
            "{name}",
            requesterName,
          )}
        </p>
        {remainingSec !== null ? timerWithExtension(entry, remainingSec) : null}
      </div>
      {errorText ? <p className="bank-payment-error">{errorText}</p> : null}
    </section>
  );
}

interface AwaitingBankDetailsOfferViewProps {
  amountText: string;
  entry: BankPaymentOfferEntry;
  requesterName: string;
  t: Translate;
  remainingSec: number | null;
  timerWithExtension: (
    offerEntry: BankPaymentOfferEntry,
    remainingSec: number,
  ) => React.ReactElement;
}

export function AwaitingBankDetailsOfferView({
  amountText,
  entry,
  requesterName,
  t,
  remainingSec,
  timerWithExtension,
}: AwaitingBankDetailsOfferViewProps) {
  return (
    <section className="panel panel-plain bank-payment-offer-state-page">
      <div className="bank-payment-offer-state-copy">
        <RequesterIntro
          amountText={amountText}
          canCycleAmount={Boolean(entry.info.amountSat)}
          requesterName={requesterName}
          status={entry.info.status}
          t={t}
        />
        <p className="muted">
          {t("bankPaymentOfferDescriptionAcceptedIncoming").replace(
            "{amount}",
            amountText,
          )}
        </p>
        {remainingSec !== null ? timerWithExtension(entry, remainingSec) : null}
      </div>
    </section>
  );
}

interface BankDetailsOfferViewProps {
  amountText: string;
  entry: BankPaymentOfferEntry;
  requesterName: string;
  t: Translate;
  remainingSec: number | null;
  timerWithExtension: (
    offerEntry: BankPaymentOfferEntry,
    remainingSec: number,
  ) => React.ReactElement;
  qrDataUrl: string | null;
  canConfirmPaid: boolean;
  isConfirmingPaid: boolean;
  confirmPaid: () => Promise<void>;
  showPaymentRows: boolean;
  setShowPaymentRows: React.Dispatch<React.SetStateAction<boolean>>;
  rows: BankPaymentFieldRow[];
  onCopyText: (text: string) => void;
  isOpening: boolean;
  openInBank: () => Promise<void>;
  isSharingJpeg: boolean;
  openWithJpeg: () => Promise<void>;
  errorText: string | null;
}

export function BankDetailsOfferView({
  amountText,
  entry,
  requesterName,
  t,
  remainingSec,
  timerWithExtension,
  qrDataUrl,
  canConfirmPaid,
  isConfirmingPaid,
  confirmPaid,
  showPaymentRows,
  setShowPaymentRows,
  rows,
  onCopyText,
  isOpening,
  openInBank,
  isSharingJpeg,
  openWithJpeg,
  errorText,
}: BankDetailsOfferViewProps) {
  return (
    <section className="panel panel-plain bank-payment-page bank-payment-offer-detail-page">
      <div className="bank-payment-summary bank-payment-offer-requester-summary">
        <RequesterIntro
          amountText={amountText}
          canCycleAmount={Boolean(entry.info.amountSat)}
          requesterName={requesterName}
          status={entry.info.status}
          t={t}
        />
        {remainingSec !== null ? timerWithExtension(entry, remainingSec) : null}
      </div>

      <div className="bank-payment-offer-qr-wrap">
        {qrDataUrl ? (
          <img className="qr bank-payment-offer-qr" src={qrDataUrl} alt="" />
        ) : (
          <div className="bank-payment-offer-qr-placeholder" aria-hidden="true">
            QR
          </div>
        )}
      </div>

      {/* Confirming the payment must stay reachable without scrolling past
          the QR, so the field rows hide behind a toggle below. */}
      <button
        type="button"
        className="btn-wide bank-payment-request"
        disabled={!canConfirmPaid || isConfirmingPaid}
        onClick={() => {
          void confirmPaid();
        }}
      >
        <span className="btn-label-with-icon">
          <span className="btn-label-icon" aria-hidden="true">
            {isConfirmingPaid ? <span className="btn-spinner" /> : <Check />}
          </span>
          <span>
            {isConfirmingPaid
              ? t("chatPendingShort")
              : t("bankPaymentOfferMarkPaid")}
          </span>
        </span>
      </button>

      <button
        type="button"
        className="btn-wide secondary bank-payment-offer-details-toggle"
        aria-expanded={showPaymentRows}
        onClick={() => setShowPaymentRows((current) => !current)}
      >
        <span className="btn-label-with-icon">
          <span className="btn-label-icon" aria-hidden="true">
            {showPaymentRows ? <ChevronUp /> : <ChevronDown />}
          </span>
          <span>{t("bankPaymentOfferDetails")}</span>
        </span>
      </button>

      {showPaymentRows ? (
        <div className="bank-payment-fields">
          {rows.map((row) => (
            <div className="settings-row bank-payment-row" key={row.key}>
              <div>
                <strong>{row.label}</strong>
                <button
                  type="button"
                  className="copyable transaction-detail-copy bank-payment-copy"
                  onClick={() => onCopyText(row.value)}
                  aria-label={t("copy")}
                  title={t("copy")}
                >
                  <span className="transaction-detail-copyText">
                    {row.value}
                  </span>
                  <span
                    className="transaction-detail-copyIcon"
                    aria-hidden="true"
                  >
                    <Copy size={14} />
                  </span>
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="bank-payment-open-actions">
        <button
          type="button"
          className="btn-wide secondary bank-payment-open"
          disabled={isOpening}
          onClick={() => {
            void openInBank();
          }}
        >
          <span className="btn-label-with-icon">
            <span className="btn-label-icon" aria-hidden="true">
              {isOpening ? <span className="btn-spinner" /> : <Landmark />}
            </span>
            <span>
              {isOpening ? t("spdPaymentOpening") : t("spdPaymentOpenInBank")}
            </span>
          </span>
        </button>

        <button
          type="button"
          className="btn-wide secondary bank-payment-open"
          disabled={isSharingJpeg}
          onClick={() => {
            void openWithJpeg();
          }}
        >
          <span className="btn-label-with-icon">
            <span className="btn-label-icon" aria-hidden="true">
              {isSharingJpeg ? <span className="btn-spinner" /> : <Share2 />}
            </span>
            <span>
              {isSharingJpeg
                ? t("spdPaymentOpening")
                : t("spdPaymentOpenWithJpg")}
            </span>
          </span>
        </button>
      </div>

      {errorText ? <p className="bank-payment-error">{errorText}</p> : null}
    </section>
  );
}

interface OfferRecipientRowProps {
  name: string;
  pictureUrl: string | null;
  status: LinkyBankPaymentOfferStatus | "queued";
  label: string;
}
function OfferRecipientRow({
  name,
  pictureUrl,
  status,
  label,
}: OfferRecipientRowProps) {
  return (
    <div className="bank-payment-offer-recipient">
      <span className="bank-payment-offer-recipient-identity">
        <span
          className="bank-payment-offer-recipient-avatar"
          aria-hidden="true"
        >
          <Avatar
            pictureUrl={pictureUrl}
            fallback={getInitials(name)}
            fallbackClassName=""
          />
        </span>
        <span>{name}</span>
      </span>
      <span className={`chat-payment-request-status is-${status}`}>
        {label}
      </span>
    </div>
  );
}
