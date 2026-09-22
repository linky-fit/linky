import React from "react";
import { useAppShellCore } from "../app/context/AppShellContexts";
import { formatRemainingTime } from "../app/lib/bankPaymentOfferLabels";
import {
  BANK_PAYMENT_OFFER_EXTENSION_SEC,
  bankPaymentOfferExpiresAtSec,
  bankPaymentOfferStatusRank,
  decodeBankPaymentOffer,
  hasBankPaymentOfferTimedPhase,
  isBankPaymentOfferExpired,
  isTerminalBankPaymentOfferStatus,
  tryParseBankPayment,
  type BankOfferStatus,
  type BankPayment,
} from "@linky/proxy-payment";
import {
  readBankPaymentOfferStaggerRecords,
  setBankPaymentOfferMinimized,
} from "../app/lib/bankPaymentOfferStorage";
import {
  openSpdPaymentInBank,
  shareSpdPaymentQrJpeg,
} from "../utils/spdPayment";
import {
  getChatAttachmentRejection,
  parsePrivateImageMessage,
} from "../app/lib/privateImageMessage";
import type { ContactRowLike, LocalNostrMessage } from "../app/types/appTypes";
import { decodeNpub } from "@linky/linkstr";
import { readUnknownContactIdPubkey } from "../app/hooks/messages/contactIdentity";
import { navigateTo, returnFromBankPaymentOffer } from "../hooks/useRouting";
import { normalizeNpubIdentifier } from "../utils/nostrNpub";
import type { Translate } from "../i18n";
import { nowSeconds } from "../utils/time";
import {
  AcceptedByOtherOfferView,
  AwaitingBankDetailsOfferView,
  BankDetailsOfferView,
  ExpiredOfferView,
  IncomingOfferView,
  InvalidOfferView,
  OwnerOfferView,
  RejectedOfferView,
  WaitingForSatsOfferView,
  type BankPaymentConfirmation,
  type BankPaymentFieldRow,
  type BankPaymentOfferEntry,
  type PendingConfirmation,
} from "./BankPaymentOfferViews";

interface BankPaymentOfferDetailPageProps {
  bankPaymentOfferMessages: LocalNostrMessage[];
  chatId: string;
  chatMessages: LocalNostrMessage[];
  chatOwnPubkeyHex: string | null;
  contacts: readonly ContactRowLike[];
  offerId: string;
  onCopyText: (text: string) => void;
  onRespondBankPaymentOffer: (
    message: LocalNostrMessage,
    nextStatus: BankOfferStatus,
    options?: {
      expiresAtSec?: number | null;
      extensionSec?: number | null;
      withPush?: boolean;
    },
  ) => Promise<boolean>;
  onSendChatImage: (
    file: File,
    replyToMessage?: LocalNostrMessage,
  ) => Promise<boolean>;
  onSettleBankPaymentOffer: (message: LocalNostrMessage) => Promise<void>;
}

const getSpdField = (payment: BankPayment, key: string): string =>
  (payment.fields[key] ?? "").trim();

const getEntryTime = (entry: BankPaymentOfferEntry): number =>
  entry.info.statusUpdatedAtSec || entry.message.createdAtSec || 0;

const compareEntries = (
  left: BankPaymentOfferEntry,
  right: BankPaymentOfferEntry,
): number => {
  const rankDelta =
    bankPaymentOfferStatusRank(left.info.status) -
    bankPaymentOfferStatusRank(right.info.status);
  if (rankDelta !== 0) return rankDelta;

  return getEntryTime(left) - getEntryTime(right);
};

// Offer rows are unique per contact and offer, so the thread is a plain lookup.
const findOfferEntries = (
  messages: readonly LocalNostrMessage[],
  offerId: string,
): BankPaymentOfferEntry[] =>
  messages.flatMap((message) => {
    const info = decodeBankPaymentOffer(message.content);
    return info?.offerId === offerId.trim() && message.contactId.trim()
      ? [{ info, message }]
      : [];
  });

const contactPubkey = (contact: ContactRowLike): string | null => {
  const npub = normalizeNpubIdentifier(contact.npub ?? "");
  return (
    (npub ? decodeNpub(npub) : null) ?? readUnknownContactIdPubkey(contact.id)
  );
};

const findPaymentConfirmation = (
  offerMessages: readonly LocalNostrMessage[],
  chatMessages: readonly LocalNostrMessage[],
  chatId: string,
  offerId: string,
): BankPaymentConfirmation | null => {
  const paymentMessageIds = new Set<string>();
  for (const message of offerMessages) {
    if (message.contactId.trim() !== chatId.trim()) continue;
    const info = decodeBankPaymentOffer(message.content);
    if (
      !info ||
      info.offerId !== offerId.trim() ||
      (info.status !== "bank_paid" && info.status !== "settled")
    ) {
      continue;
    }
    const rumorId = (message.rumorId ?? "").trim();
    if (rumorId) paymentMessageIds.add(rumorId);
  }

  let confirmation: BankPaymentConfirmation | null = null;
  for (const message of chatMessages) {
    if (message.contactId.trim() !== chatId.trim()) continue;
    const replyToId = (message.replyToId ?? "").trim();
    const rootMessageId = (message.rootMessageId ?? "").trim();
    if (
      !paymentMessageIds.has(replyToId) &&
      !paymentMessageIds.has(rootMessageId)
    ) {
      continue;
    }
    const payload = parsePrivateImageMessage(message.content);
    if (!payload) continue;
    if (
      !confirmation ||
      message.createdAtSec >= confirmation.message.createdAtSec
    ) {
      confirmation = { message, payload };
    }
  }
  return confirmation;
};

const buildPaymentRows = (
  payment: BankPayment,
  t: Translate,
): BankPaymentFieldRow[] => {
  const rows: BankPaymentFieldRow[] = [];
  const amount = getSpdField(payment, "AM");
  const currency = getSpdField(payment, "CC");
  const amountText = [amount, currency].filter(Boolean).join(" ");
  if (amountText) {
    rows.push({
      key: "AM",
      label: t("spdPaymentAmount"),
      value: amountText,
    });
  }

  const addRow = (key: string, label: string) => {
    const value = getSpdField(payment, key);
    if (!value) return;
    rows.push({ key, label, value });
  };

  addRow("RN", t("spdPaymentRecipient"));
  addRow("ACC", t("spdPaymentAccount"));
  addRow("BIC", t("spdPaymentBic"));
  addRow("RF", t("spdPaymentReference"));
  addRow("X-VS", t("spdPaymentVariableSymbol"));
  addRow("X-SS", t("spdPaymentSpecificSymbol"));
  addRow("X-KS", t("spdPaymentConstantSymbol"));
  addRow("MSG", t("spdPaymentMessage"));
  addRow("DT", t("spdPaymentDueDate"));

  return rows;
};

const getOpenErrorText = (error: unknown, t: Translate) => {
  if (error instanceof Error && error.name === "AbortError") {
    return null;
  }

  const message = error instanceof Error ? error.message : "";
  if (message === "spd-share-unavailable") {
    return t("spdPaymentShareUnavailable");
  }
  if (message === "spd-service-worker-unavailable") {
    return t("spdPaymentServiceWorkerUnavailable");
  }
  return t("spdPaymentOpenFailed");
};

export const BankPaymentOfferDetailPage: React.FC<
  BankPaymentOfferDetailPageProps
> = ({
  bankPaymentOfferMessages,
  chatId,
  chatMessages,
  chatOwnPubkeyHex,
  contacts,
  offerId,
  onCopyText,
  onRespondBankPaymentOffer,
  onSendChatImage,
  onSettleBankPaymentOffer,
}) => {
  const { formatDisplayedAmountText, nostrPictureByNpub, t } =
    useAppShellCore();
  const confirmationInputRef = React.useRef<HTMLInputElement | null>(null);
  const [qrDataUrl, setQrDataUrl] = React.useState<string | null>(null);
  const [isAttachingConfirmation, setIsAttachingConfirmation] =
    React.useState(false);
  const [isOpening, setIsOpening] = React.useState(false);
  const [isSharingJpeg, setIsSharingJpeg] = React.useState(false);
  const [isConfirmingPaid, setIsConfirmingPaid] = React.useState(false);
  const [isSettling, setIsSettling] = React.useState(false);
  const [pendingConfirmation, setPendingConfirmation] =
    React.useState<PendingConfirmation | null>(null);
  const [isExtending, setIsExtending] = React.useState(false);
  const [responseStatus, setResponseStatus] = React.useState<
    "accepted" | "canceled" | "declined" | null
  >(null);
  const [errorText, setErrorText] = React.useState<string | null>(null);
  const [nowMs, setNowMs] = React.useState(() => Date.now());
  const offerEntries = React.useMemo(
    () => findOfferEntries(bankPaymentOfferMessages, offerId),
    [bankPaymentOfferMessages, offerId],
  );
  const entry =
    offerEntries.find(
      ({ message }) => message.contactId.trim() === chatId.trim(),
    ) ?? null;
  const [showPaymentRows, setShowPaymentRows] = React.useState(false);
  // Recipients still waiting for their staggered send; the queue drains via
  // state updates, so offerEntries changing keeps this list current.
  const queuedRecipients = React.useMemo(() => {
    const ownerPubkey = (chatOwnPubkeyHex ?? "").trim();
    if (!ownerPubkey) return [];

    const record = readBankPaymentOfferStaggerRecords(ownerPubkey).find(
      (candidate) => candidate.offerId === offerId.trim(),
    );
    if (!record) return [];

    const contactByPubkey = new Map(
      contacts.flatMap((contact) => {
        const pubkey = contactPubkey(contact);
        return pubkey ? [[pubkey, contact] as const] : [];
      }),
    );
    const offeredContactIds = new Set(
      offerEntries.map((offerEntry) => offerEntry.message.contactId.trim()),
    );
    return record.pending.flatMap((recipient) => {
      const contact = contactByPubkey.get(recipient.peer) ?? null;
      return contact && offeredContactIds.has((contact.id ?? "").trim())
        ? []
        : [{ contact, peer: recipient.peer }];
    });
  }, [chatOwnPubkeyHex, contacts, offerEntries, offerId]);
  const confirmation = React.useMemo(
    () =>
      findPaymentConfirmation(
        bankPaymentOfferMessages,
        chatMessages,
        chatId,
        offerId,
      ),
    [bankPaymentOfferMessages, chatId, chatMessages, offerId],
  );
  React.useEffect(() => {
    if (confirmation) setPendingConfirmation(null);
  }, [confirmation]);
  React.useEffect(
    () => () => {
      if (pendingConfirmation?.imageUrl) {
        URL.revokeObjectURL(pendingConfirmation.imageUrl);
      }
    },
    [pendingConfirmation],
  );
  const payment = React.useMemo(
    () =>
      entry?.info.spdPayload
        ? tryParseBankPayment(entry.info.spdPayload)
        : null,
    [entry],
  );

  React.useEffect(() => {
    let cancelled = false;
    setQrDataUrl(null);

    const payload = (entry?.info.spdPayload ?? "").trim();
    if (!payload) return;

    void (async () => {
      try {
        const QRCode = await import("qrcode");
        const qr = await QRCode.toDataURL(payload, {
          errorCorrectionLevel: "M",
          margin: 2,
          width: 512,
        });
        if (!cancelled) setQrDataUrl(qr);
      } catch {
        if (!cancelled) setQrDataUrl(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [entry]);

  // The displayed countdown may belong to another recipient's entry (the
  // offerer sees the accepting contact's phase), so tick unless the offer as
  // a whole has ended.
  const offerHasEnded =
    entry === null ||
    entry.info.status === "settled" ||
    entry.info.status === "canceled";
  React.useEffect(() => {
    if (offerHasEnded) return;
    const intervalId = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1_000);

    return () => window.clearInterval(intervalId);
  }, [offerHasEnded]);

  const isCreatedByMe =
    entry !== null &&
    ((entry.info.offererPublicKey ?? "").trim() ===
      (chatOwnPubkeyHex ?? "").trim() ||
      entry.message.direction === "out");

  React.useEffect(() => {
    if (!entry || entry.info.status !== "settled" || isCreatedByMe) return;

    setBankPaymentOfferMinimized(chatId, offerId, true);
    returnFromBankPaymentOffer(chatId);
  }, [chatId, entry, isCreatedByMe, offerId]);

  const closeOffer = () => {
    setBankPaymentOfferMinimized(chatId, offerId, true);
    returnFromBankPaymentOffer(chatId);
  };

  const isExpired = entry
    ? isBankPaymentOfferExpired(
        entry.info,
        entry.message.createdAtSec,
        Math.floor(nowMs / 1_000),
      )
    : true;

  if (!entry || isExpired) {
    return <ExpiredOfferView t={t} closeOffer={closeOffer} />;
  }

  const amountText = entry.info.amountSat
    ? formatDisplayedAmountText(entry.info.amountSat)
    : entry.info.amountText;
  const requesterContact = contacts.find(
    (contact) => (contact.id ?? "").trim() === entry.message.contactId.trim(),
  );
  const requesterName =
    (requesterContact?.name ?? "").trim() || t("unknownContactTitle");

  const extendTime = async (offerEntry: BankPaymentOfferEntry) => {
    if (isExtending || !hasBankPaymentOfferTimedPhase(offerEntry.info.status))
      return;
    const currentExpiresAtSec = bankPaymentOfferExpiresAtSec(
      offerEntry.info,
      offerEntry.message.createdAtSec,
    );
    if (currentExpiresAtSec === null) return;

    setIsExtending(true);
    setErrorText(null);
    try {
      const sent = await onRespondBankPaymentOffer(
        offerEntry.message,
        offerEntry.info.status,
        {
          expiresAtSec:
            Math.max(currentExpiresAtSec, nowSeconds()) +
            BANK_PAYMENT_OFFER_EXTENSION_SEC,
          extensionSec: BANK_PAYMENT_OFFER_EXTENSION_SEC,
          withPush: true,
        },
      );
      if (!sent) setErrorText(t("spdPaymentOfferFailed"));
    } finally {
      setIsExtending(false);
    }
  };

  const timerWithExtension = (
    offerEntry: BankPaymentOfferEntry,
    remainingSec: number,
  ) => (
    <div className="bank-payment-offer-timer-row">
      <span className="bank-payment-offer-timer">
        {formatRemainingTime(remainingSec, t)}
      </span>
      <button
        type="button"
        className="bank-payment-offer-extend"
        disabled={isExtending || remainingSec <= 0}
        onClick={() => void extendTime(offerEntry)}
        aria-label={t("bankPaymentOfferNeedMoreTime")}
        title={t("bankPaymentOfferNeedMoreTime")}
      >
        {isExtending ? (
          <span className="btn-spinner" aria-hidden="true" />
        ) : (
          t("bankPaymentOfferExtendOneMinute")
        )}
      </button>
    </div>
  );

  if (isCreatedByMe) {
    const activeEntry =
      offerEntries
        .filter(({ info }) => !isTerminalBankPaymentOfferStatus(info.status))
        .sort(compareEntries)
        .at(-1) ??
      [...offerEntries].sort(compareEntries).at(-1) ??
      entry;
    const activeAmountText = activeEntry.info.amountSat
      ? formatDisplayedAmountText(activeEntry.info.amountSat)
      : activeEntry.info.amountText;
    const activeExpiresAtSec = bankPaymentOfferExpiresAtSec(
      activeEntry.info,
      activeEntry.message.createdAtSec,
    );
    const remainingSec = activeExpiresAtSec
      ? activeExpiresAtSec - Math.floor(nowMs / 1_000)
      : null;
    const canSettle = activeEntry.info.status === "bank_paid";
    const canCancel =
      activeEntry.info.status !== "settled" &&
      activeEntry.info.status !== "canceled";

    const cancelOffer = async () => {
      if (responseStatus) return;
      setResponseStatus("canceled");
      try {
        await onRespondBankPaymentOffer(activeEntry.message, "canceled");
      } finally {
        setResponseStatus(null);
      }
    };
    const settleOffer = async () => {
      if (!canSettle || isSettling) return;
      setIsSettling(true);
      try {
        await onSettleBankPaymentOffer(activeEntry.message);
      } finally {
        setIsSettling(false);
      }
    };

    const acceptingEntry = offerEntries.find(
      ({ info }) =>
        info.status === "accepted" ||
        info.status === "bank_details_sent" ||
        info.status === "bank_paid",
    );
    const acceptingContactName = acceptingEntry
      ? (
          contacts.find(
            (candidate) =>
              (candidate.id ?? "").trim() ===
              acceptingEntry.message.contactId.trim(),
          )?.name ?? ""
        ).trim()
      : "";
    const acceptedInfoText = acceptingEntry
      ? acceptingContactName
        ? t("bankPaymentOfferProgressAcceptedByName").replace(
            "{name}",
            acceptingContactName,
          )
        : t("bankPaymentOfferProgressAcceptedInfo")
      : null;

    return (
      <OwnerOfferView
        activeEntry={activeEntry}
        activeAmountText={activeAmountText}
        t={t}
        remainingSec={remainingSec}
        timerWithExtension={timerWithExtension}
        acceptedInfoText={acceptedInfoText}
        offerEntries={offerEntries}
        contacts={contacts}
        nostrPictureByNpub={nostrPictureByNpub}
        queuedRecipients={queuedRecipients}
        confirmation={confirmation}
        canSettle={canSettle}
        isSettling={isSettling}
        settleOffer={settleOffer}
        canCancel={canCancel}
        responseStatus={responseStatus}
        cancelOffer={cancelOffer}
      />
    );
  }

  const wasRejectedAfterPaying =
    !isCreatedByMe &&
    entry.info.status === "canceled" &&
    (entry.info.bankPaidAtSec ?? 0) > 0;
  if (wasRejectedAfterPaying) {
    return (
      <RejectedOfferView
        t={t}
        entry={entry}
        amountText={amountText}
        requesterName={requesterName}
        closeOffer={closeOffer}
      />
    );
  }

  if (entry.info.status === "accepted_by_other") {
    return <AcceptedByOtherOfferView t={t} closeOffer={closeOffer} />;
  }

  if (entry.info.status === "offered" && entry.message.direction === "in") {
    const respond = async (nextStatus: "accepted" | "declined") => {
      if (responseStatus) return;

      setResponseStatus(nextStatus);
      setErrorText(null);
      try {
        const sent = await onRespondBankPaymentOffer(entry.message, nextStatus);
        if (sent) {
          if (nextStatus === "declined") {
            navigateTo({ route: "chat", id: chatId });
          }
          return;
        }
        setErrorText(t("spdPaymentOfferFailed"));
      } finally {
        setResponseStatus(null);
      }
    };

    const remainingSec =
      (bankPaymentOfferExpiresAtSec(entry.info, entry.message.createdAtSec) ??
        Math.floor(nowMs / 1_000)) - Math.floor(nowMs / 1_000);

    return (
      <IncomingOfferView
        amountText={amountText}
        entry={entry}
        requesterName={requesterName}
        t={t}
        timerWithExtension={timerWithExtension}
        remainingSec={remainingSec}
        errorText={errorText}
        responseStatus={responseStatus}
        respond={respond}
      />
    );
  }

  if (
    !payment &&
    entry.info.status !== "accepted" &&
    entry.info.status !== "bank_paid"
  ) {
    return <InvalidOfferView t={t} />;
  }

  const expiresAtSec = bankPaymentOfferExpiresAtSec(
    entry.info,
    entry.message.createdAtSec,
  );
  const remainingSec = expiresAtSec
    ? expiresAtSec - Math.floor(nowMs / 1_000)
    : null;

  if (entry.info.status === "bank_paid") {
    const attachConfirmation = async (file: File) => {
      if (isAttachingConfirmation) return;

      const rejectionKey = getChatAttachmentRejection(file);
      if (rejectionKey) {
        setErrorText(t(rejectionKey));
        return;
      }
      setErrorText(null);
      setPendingConfirmation({
        fileName: file.name,
        imageUrl: file.type.startsWith("image/")
          ? URL.createObjectURL(file)
          : null,
      });
      setIsAttachingConfirmation(true);
      try {
        await onSendChatImage(file, entry.message);
      } finally {
        setIsAttachingConfirmation(false);
      }
    };

    return (
      <WaitingForSatsOfferView
        t={t}
        entry={entry}
        amountText={amountText}
        confirmation={confirmation}
        pendingConfirmation={pendingConfirmation}
        confirmationInputRef={confirmationInputRef}
        attachConfirmation={attachConfirmation}
        isAttachingConfirmation={isAttachingConfirmation}
        requesterName={requesterName}
        remainingSec={remainingSec}
        timerWithExtension={timerWithExtension}
        errorText={errorText}
      />
    );
  }

  if (!payment) {
    return (
      <AwaitingBankDetailsOfferView
        amountText={amountText}
        entry={entry}
        requesterName={requesterName}
        t={t}
        remainingSec={remainingSec}
        timerWithExtension={timerWithExtension}
      />
    );
  }

  const rows = buildPaymentRows(payment, t);
  const canConfirmPaid =
    entry.info.status === "bank_details_sent" &&
    entry.message.direction === "in";

  const openInBank = async () => {
    if (isOpening) return;

    setIsOpening(true);
    setErrorText(null);
    try {
      await openSpdPaymentInBank(payment.payload);
    } catch (error) {
      setErrorText(getOpenErrorText(error, t));
    } finally {
      setIsOpening(false);
    }
  };

  const openWithJpeg = async () => {
    if (isSharingJpeg) return;

    setIsSharingJpeg(true);
    setErrorText(null);
    try {
      await shareSpdPaymentQrJpeg(payment.payload);
    } catch (error) {
      setErrorText(getOpenErrorText(error, t));
    } finally {
      setIsSharingJpeg(false);
    }
  };

  const confirmPaid = async () => {
    if (!canConfirmPaid || isConfirmingPaid) return;

    setIsConfirmingPaid(true);
    setErrorText(null);
    try {
      const sent = await onRespondBankPaymentOffer(entry.message, "bank_paid");
      if (sent) return;
      setErrorText(t("spdPaymentOfferFailed"));
    } finally {
      setIsConfirmingPaid(false);
    }
  };

  return (
    <BankDetailsOfferView
      amountText={amountText}
      entry={entry}
      requesterName={requesterName}
      t={t}
      remainingSec={remainingSec}
      timerWithExtension={timerWithExtension}
      qrDataUrl={qrDataUrl}
      canConfirmPaid={canConfirmPaid}
      isConfirmingPaid={isConfirmingPaid}
      confirmPaid={confirmPaid}
      showPaymentRows={showPaymentRows}
      setShowPaymentRows={setShowPaymentRows}
      rows={rows}
      onCopyText={onCopyText}
      isOpening={isOpening}
      openInBank={openInBank}
      isSharingJpeg={isSharingJpeg}
      openWithJpeg={openWithJpeg}
      errorText={errorText}
    />
  );
};
