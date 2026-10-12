import {
  Avatar,
  Button,
  EmptyState,
  FileAttachment,
  ImageAttachment,
  ListRow,
  Notice,
  Progress,
  QRCode,
  Row,
  Stack,
  Text,
  type Tone,
  Pill,
} from "@linky-fit/ui";
import React from "react";
import {
  bankPaymentOfferStatusTones,
  getBankPaymentOfferStatusLabel,
} from "../app/lib/bankPaymentOfferLabels";
import type {
  BankOfferStatus,
  BankPaymentOfferCurrency,
  BankPaymentOfferInfo,
} from "@linky-fit/proxy-payment";
import {
  isPrivatePdfPayload,
  type PrivateImageMessagePayload,
} from "../app/lib/privateImageMessage";
import type { ContactRowLike, LocalNostrMessage } from "../app/types/appTypes";
import { DisplayAmount } from "../components/DisplayAmount";
import { PrivateFileBubble } from "../components/PrivateFileBubble";
import { PrivateImageBubble } from "../components/PrivateImageBubble";
import type { Translate } from "../i18n";
import { normalizeNpubIdentifier } from "../utils/nostrNpub";
import { pickFile } from "../utils/pickFile";

export interface BankPaymentOfferEntry {
  info: BankPaymentOfferInfo;
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

type TimerWithExtension = (
  offerEntry: BankPaymentOfferEntry,
  remainingSec: number,
) => React.ReactElement;

interface BankPaymentScreenProps {
  children: React.ReactNode;
  /** Fills the screen height and spreads the content to its edges. */
  fill?: boolean;
}

/** Page root of the bank payment and offer screens. */
export const BankPaymentScreen = ({
  children,
  fill = false,
}: BankPaymentScreenProps) => (
  <Stack
    gap="$lg"
    paddingBottom="$xxl"
    $compact={{ marginTop: "$lg" }}
    flexGrow={fill ? 1 : 0}
    minHeight={fill ? "100%" : undefined}
    justifyContent={fill ? "space-between" : undefined}
  >
    {children}
  </Stack>
);

const StateCopy = ({ children }: { children: React.ReactNode }) => (
  <Stack flex={1} alignItems="center" justifyContent="center" gap="$md">
    {children}
  </Stack>
);

const StateTitle = ({ children }: { children: string }) => (
  <Text variant="heading" role="heading" textAlign="center">
    {children}
  </Text>
);

const MutedCopy = ({ children }: { children: string }) => (
  <Text color="$colorMuted" textAlign="center">
    {children}
  </Text>
);

interface PaymentConfirmationProps {
  confirmation: BankPaymentConfirmation;
  t: Translate;
}

const PaymentConfirmation = ({ confirmation, t }: PaymentConfirmationProps) => {
  const rumorId = (confirmation.message.rumorId ?? "").trim() || null;
  return (
    <Stack alignItems="center" gap="$sm" width="100%">
      <Text bold>{t("bankPaymentOfferConfirmation")}</Text>
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
    </Stack>
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
  <Stack alignItems="center" gap="$sm" width="100%">
    <Text bold>{t("bankPaymentOfferConfirmation")}</Text>
    {pending.imageUrl ? (
      <ImageAttachment
        uri={pending.imageUrl}
        accessibilityLabel={t("bankPaymentOfferConfirmation")}
        errorLabel={t("chatImageLoadFailed")}
      />
    ) : (
      <FileAttachment name={pending.fileName} />
    )}
  </Stack>
);

interface RecipientProgressProps {
  status: BankOfferStatus;
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
    <Stack gap="$xs" width="100%" maxWidth="$sheetWidth" alignSelf="center">
      <Progress
        accessibilityLabel={t("bankPaymentOfferProgressTitle")}
        segments={steps.length}
        value={completedCount}
        max={steps.length}
      />
      <Row gap="$xs" alignItems="flex-start">
        {steps.map((step) => (
          <Text
            key={step.key}
            flex={1}
            variant="caption"
            bold
            textAlign="center"
            color={step.isComplete ? "$colorSubtle" : "$colorMuted"}
          >
            {step.label}
          </Text>
        ))}
      </Row>
    </Stack>
  );
};

interface OfferAmountProps {
  amount: number | string;
  /** The bank transfer's currency; the amount stays in the display unit. */
  currency: BankPaymentOfferCurrency | null;
}

const OfferAmount = ({ amount, currency }: OfferAmountProps) => (
  <Stack alignItems="center" gap="$xs">
    <DisplayAmount amount={amount} testID="bank-payment-amount" />
    {currency !== null ? (
      <Pill size="sm" label={currency} testID="bank-payment-currency" />
    ) : null}
  </Stack>
);

interface RequesterIntroProps extends OfferAmountProps {
  requesterName: string;
  status: BankOfferStatus;
  t: Translate;
}

const RequesterIntro = ({
  amount,
  currency,
  requesterName,
  status,
  t,
}: RequesterIntroProps) => (
  <Stack
    alignItems="center"
    gap="$sm"
    width="100%"
    maxWidth="$sheetWidth"
    alignSelf="center"
  >
    <Text variant="title" textAlign="center">
      {t("bankPaymentOfferRequestedBy").replace("{name}", requesterName)}
    </Text>
    <OfferAmount amount={amount} currency={currency} />
    <RecipientProgress status={status} t={t} />
  </Stack>
);

interface ClosedOfferStateProps {
  actionLabel: string;
  amount?: React.ReactNode;
  closeOffer: () => void;
  description: string;
  title: string;
}

const ClosedOfferState = ({
  actionLabel,
  amount,
  closeOffer,
  description,
  title,
}: ClosedOfferStateProps) => (
  <BankPaymentScreen fill>
    <StateCopy>
      <StateTitle>{title}</StateTitle>
      {amount}
      <MutedCopy>{description}</MutedCopy>
    </StateCopy>
    <Button onPress={closeOffer}>{actionLabel}</Button>
  </BankPaymentScreen>
);

interface ExpiredOfferViewProps {
  t: Translate;
  closeOffer: () => void;
}

export function ExpiredOfferView({ t, closeOffer }: ExpiredOfferViewProps) {
  return (
    <ClosedOfferState
      actionLabel={t("close")}
      closeOffer={closeOffer}
      description={t("bankPaymentOfferExpiredDescription")}
      title={t("bankPaymentOfferExpiredTitle")}
    />
  );
}

interface CanceledOfferViewProps {
  t: Translate;
  requesterName: string;
  closeOffer: () => void;
}

export function CanceledOfferView({
  t,
  requesterName,
  closeOffer,
}: CanceledOfferViewProps) {
  return (
    <ClosedOfferState
      actionLabel={t("close")}
      closeOffer={closeOffer}
      description={t("bankPaymentOfferCanceledDescription").replace(
        "{name}",
        requesterName,
      )}
      title={t("bankPaymentOfferCanceledTitle")}
    />
  );
}

const STATUS_TONES: Record<BankOfferStatus | "queued", Tone> = {
  ...bankPaymentOfferStatusTones,
  queued: "neutral",
};

interface OwnerOfferViewProps {
  activeEntry: BankPaymentOfferEntry;
  activeAmountText: string;
  t: Translate;
  remainingSec: number | null;
  timerWithExtension: TimerWithExtension;
  acceptedInfoText: string | null;
  offerEntries: BankPaymentOfferEntry[];
  contacts: readonly ContactRowLike[];
  nostrPictureByNpub: Record<string, string | null>;
  queuedRecipients: readonly { contact: ContactRowLike | null; peer: string }[];
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
  const recipient = (contact: ContactRowLike | null | undefined) => {
    const npub = normalizeNpubIdentifier(contact?.npub ?? "");
    return {
      name: (contact?.name ?? "").trim() || t("unknownContactTitle"),
      pictureUrl: npub ? (nostrPictureByNpub[npub] ?? null) : null,
    };
  };
  return (
    <BankPaymentScreen>
      <Stack alignItems="center" gap="$sm">
        <OfferAmount
          amount={activeEntry.info.amountSat ?? activeAmountText}
          currency={activeEntry.info.currency}
        />
        <RecipientProgress status={activeEntry.info.status} t={t} />
        {remainingSec !== null
          ? timerWithExtension(activeEntry, remainingSec)
          : null}
        {acceptedInfoText ? <MutedCopy>{acceptedInfoText}</MutedCopy> : null}
      </Stack>

      <Stack gap="$xs">
        {offerEntries.map((offerEntry) => {
          const contactId = offerEntry.message.contactId.trim();
          const contact = contacts.find(
            (candidate) => (candidate.id ?? "").trim() === contactId,
          );
          return (
            <OfferRecipientRow
              key={contactId}
              {...recipient(contact)}
              status={offerEntry.info.status}
              label={getBankPaymentOfferStatusLabel(
                offerEntry.info.status,
                false,
                t,
              )}
            />
          );
        })}
        {queuedRecipients.map(({ contact, peer }) => (
          <OfferRecipientRow
            key={peer}
            {...recipient(contact)}
            status="queued"
            label={t("bankPaymentOfferStatusQueued")}
          />
        ))}
      </Stack>

      {confirmation ? (
        <PaymentConfirmation confirmation={confirmation} t={t} />
      ) : null}

      {canSettle ? (
        <Button
          icon="Check"
          loading={isSettling}
          onPress={() => void settleOffer()}
        >
          {t("bankPaymentOfferSettle")}
        </Button>
      ) : null}
      {canCancel ? (
        <Button
          variant="secondary"
          icon="X"
          disabled={responseStatus !== null}
          onPress={() => void cancelOffer()}
        >
          {t(canSettle ? "bankPaymentOfferNotPaid" : "bankPaymentOfferCancel")}
        </Button>
      ) : null}
    </BankPaymentScreen>
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
    <ClosedOfferState
      actionLabel={t("chatImageBackToChat")}
      amount={
        <OfferAmount
          amount={entry.info.amountSat ?? amountText}
          currency={entry.info.currency}
        />
      }
      closeOffer={closeOffer}
      description={t("bankPaymentOfferRejectedDescription").replace(
        "{name}",
        requesterName,
      )}
      title={t("bankPaymentOfferRejectedTitle")}
    />
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
    <ClosedOfferState
      actionLabel={t("close")}
      closeOffer={closeOffer}
      description={t("bankPaymentOfferAcceptedByOther")}
      title={t("bankPaymentOfferStatusAcceptedByOther")}
    />
  );
}

interface IncomingOfferViewProps {
  amountText: string;
  entry: BankPaymentOfferEntry;
  requesterName: string;
  t: Translate;
  timerWithExtension: TimerWithExtension;
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
    <BankPaymentScreen fill>
      <StateCopy>
        <RequesterIntro
          amount={entry.info.amountSat ?? amountText}
          currency={entry.info.currency}
          requesterName={requesterName}
          status={entry.info.status}
          t={t}
        />
        {timerWithExtension(entry, remainingSec)}
      </StateCopy>

      {errorText ? <Notice tone="danger" title={errorText} /> : null}

      <Stack gap="$sm" marginBottom="$huge">
        <Button
          loading={responseStatus === "accepted"}
          disabled={responseStatus !== null}
          onPress={() => {
            void respond("accepted");
          }}
        >
          {t("bankPaymentOfferAccept")}
        </Button>
        <Button
          variant="secondary"
          loading={responseStatus === "declined"}
          disabled={responseStatus !== null}
          onPress={() => {
            void respond("declined");
          }}
        >
          {t("decline")}
        </Button>
      </Stack>
    </BankPaymentScreen>
  );
}

interface InvalidOfferViewProps {
  t: Translate;
}

export function InvalidOfferView({ t }: InvalidOfferViewProps) {
  return (
    <BankPaymentScreen>
      <EmptyState title={t("spdPaymentInvalid")} />
    </BankPaymentScreen>
  );
}

const CONFIRMATION_FILE_TYPES = "image/*,application/pdf,.pdf";

interface WaitingForSatsOfferViewProps {
  t: Translate;
  entry: BankPaymentOfferEntry;
  amountText: string;
  confirmation: BankPaymentConfirmation | null;
  pendingConfirmation: PendingConfirmation | null;
  attachConfirmation: (file: File) => Promise<void>;
  isAttachingConfirmation: boolean;
  requesterName: string;
  remainingSec: number | null;
  timerWithExtension: TimerWithExtension;
  errorText: string | null;
}

export function WaitingForSatsOfferView({
  t,
  entry,
  amountText,
  confirmation,
  pendingConfirmation,
  attachConfirmation,
  isAttachingConfirmation,
  requesterName,
  remainingSec,
  timerWithExtension,
  errorText,
}: WaitingForSatsOfferViewProps) {
  return (
    <BankPaymentScreen fill>
      <StateCopy>
        <StateTitle>{t("bankPaymentOfferWaitingForSatsTitle")}</StateTitle>
        <OfferAmount
          amount={entry.info.amountSat ?? amountText}
          currency={entry.info.currency}
        />
        <RecipientProgress status={entry.info.status} t={t} />
      </StateCopy>

      {confirmation ? (
        <PaymentConfirmation confirmation={confirmation} t={t} />
      ) : pendingConfirmation ? (
        <PendingPaymentConfirmation pending={pendingConfirmation} t={t} />
      ) : (
        <Button
          icon="ImagePlus"
          loading={isAttachingConfirmation}
          onPress={() => {
            void pickFile(CONFIRMATION_FILE_TYPES).then((file) =>
              file ? attachConfirmation(file) : undefined,
            );
          }}
        >
          {t("bankPaymentOfferAttachConfirmation")}
        </Button>
      )}

      <StateCopy>
        <MutedCopy>
          {t("bankPaymentOfferWaitingForSatsDescription").replace(
            "{name}",
            requesterName,
          )}
        </MutedCopy>
        {remainingSec !== null ? timerWithExtension(entry, remainingSec) : null}
      </StateCopy>
      {errorText ? <Notice tone="danger" title={errorText} /> : null}
    </BankPaymentScreen>
  );
}

interface AwaitingBankDetailsOfferViewProps {
  amountText: string;
  entry: BankPaymentOfferEntry;
  requesterName: string;
  t: Translate;
  remainingSec: number | null;
  timerWithExtension: TimerWithExtension;
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
    <BankPaymentScreen fill>
      <StateCopy>
        <RequesterIntro
          amount={entry.info.amountSat ?? amountText}
          currency={entry.info.currency}
          requesterName={requesterName}
          status={entry.info.status}
          t={t}
        />
        <MutedCopy>
          {t("bankPaymentOfferDescriptionAcceptedIncoming").replace(
            "{amount}",
            amountText,
          )}
        </MutedCopy>
        {remainingSec !== null ? timerWithExtension(entry, remainingSec) : null}
      </StateCopy>
    </BankPaymentScreen>
  );
}

interface BankDetailsOfferViewProps {
  amountText: string;
  entry: BankPaymentOfferEntry;
  requesterName: string;
  t: Translate;
  remainingSec: number | null;
  timerWithExtension: TimerWithExtension;
  qrPayload: string;
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
  qrPayload,
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
    <BankPaymentScreen>
      <Stack alignItems="center" gap="$xs">
        <RequesterIntro
          amount={entry.info.amountSat ?? amountText}
          currency={entry.info.currency}
          requesterName={requesterName}
          status={entry.info.status}
          t={t}
        />
        {remainingSec !== null ? timerWithExtension(entry, remainingSec) : null}
      </Stack>

      <QRCode value={qrPayload} accessibilityLabel={t("bankPaymentOfferQr")} />

      {/* Confirming the payment must stay reachable without scrolling past
          the QR, so the field rows hide behind a toggle below. */}
      <Button
        icon="Check"
        loading={isConfirmingPaid}
        disabled={!canConfirmPaid}
        onPress={() => {
          void confirmPaid();
        }}
      >
        {t("bankPaymentOfferMarkPaid")}
      </Button>

      <Button
        variant="secondary"
        icon={showPaymentRows ? "ChevronUp" : "ChevronDown"}
        aria-expanded={showPaymentRows}
        onPress={() => setShowPaymentRows((current) => !current)}
      >
        {t("bankPaymentOfferDetails")}
      </Button>

      {showPaymentRows ? (
        <Stack gap="$xs" testID="bank-payment-fields">
          {rows.map((row) => (
            <ListRow
              key={row.key}
              testID="bank-payment-row"
              title={row.label}
              trailing={
                <Button
                  variant="ghost"
                  size="sm"
                  icon="Copy"
                  tooltip={t("copy")}
                  onPress={() => onCopyText(row.value)}
                >
                  {row.value}
                </Button>
              }
            />
          ))}
        </Stack>
      ) : null}

      <Row gap="$sm">
        <Button
          flex={1}
          variant="secondary"
          icon="Landmark"
          loading={isOpening}
          onPress={() => {
            void openInBank();
          }}
        >
          {t("spdPaymentOpenInBank")}
        </Button>
        <Button
          flex={1}
          variant="secondary"
          icon="Share2"
          loading={isSharingJpeg}
          onPress={() => {
            void openWithJpeg();
          }}
        >
          {t("spdPaymentOpenWithJpg")}
        </Button>
      </Row>

      {errorText ? <Notice tone="danger" title={errorText} /> : null}
    </BankPaymentScreen>
  );
}

interface OfferRecipientRowProps {
  name: string;
  pictureUrl: string | null;
  status: BankOfferStatus | "queued";
  label: string;
}

function OfferRecipientRow({
  name,
  pictureUrl,
  status,
  label,
}: OfferRecipientRowProps) {
  return (
    <ListRow
      testID={`bank-payment-offer-recipient-${status}`}
      leading={<Avatar name={name} uri={pictureUrl ?? undefined} />}
      title={name}
      trailing={
        // Badge aligns to the top of a row; the column centers it.
        <Stack>
          <Pill size="sm" label={label} tone={STATUS_TONES[status]} />
        </Stack>
      }
    />
  );
}
