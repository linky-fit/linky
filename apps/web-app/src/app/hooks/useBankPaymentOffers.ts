import {
  BankOfferDraft,
  BankOfferId,
  ClientId,
  decodeNpub,
  identityFromNsec,
  Pubkey,
  UnixSeconds,
} from "@linky/linkstr";
import { sendBankOfferAtom, useAtomSet } from "@linky/linkstr-react";
import { Exit, Schema } from "effect";
import React, { useState } from "react";
import { reportInspectorRows } from "../../devtools/inspector/reportInspectorRows";
import { getInspectorEmissionEnabled } from "../../devtools/inspector/inspectorEnabled";
import type { useRouting } from "../../hooks/useRouting";
import type { Translate } from "../../i18n";
import { normalizeNpubIdentifier } from "../../utils/nostrNpub";
import {
  getInitialBankPaymentOfferRecipientCount,
  getInitialBankPaymentOfferStaggerDelaySec,
  withLocalStorageLeaseLock,
} from "../../utils/storage";
import { nowSeconds } from "../../utils/time";
import { getUnknownErrorMessage } from "../../utils/unknown";
import { makeLocalId } from "../../utils/validation";
import type { useContactsDomain } from "./useContactsDomain";
import type { ContactRowLike, LocalNostrMessage } from "../types/appTypes";
import { getBankPaymentOfferMessageKeys } from "../lib/bankPaymentOfferMessageKeys";
import {
  forgetLinkyBankPaymentOfferSpdPayload,
  getLinkyBankPaymentOfferExpiresAtSec,
  getLinkyBankPaymentOfferInfo,
  getLinkyBankPaymentOfferMessageText,
  getLinkyBankPaymentOfferStatusRank,
  isLinkyBankPaymentOfferExpired,
  isLinkyBankPaymentOfferTerminalStatus,
  isLinkyBankPaymentOfferWholeOfferTerminalStatus,
  forgetLinkyBankPaymentOfferStaggerQueue,
  LINKY_BANK_PAYMENT_OFFER_DEFAULT_RECIPIENT_COUNT,
  LINKY_BANK_PAYMENT_OFFER_DEFAULT_STAGGER_DELAY_SEC,
  LINKY_BANK_PAYMENT_OFFER_DETAILS_LOCK_KEY_PREFIX,
  LINKY_BANK_PAYMENT_OFFER_MAX_RECIPIENT_COUNT,
  LINKY_BANK_PAYMENT_OFFER_MAX_STAGGER_DELAY_SEC,
  LINKY_BANK_PAYMENT_OFFER_MIN_RECIPIENT_COUNT,
  LINKY_BANK_PAYMENT_OFFER_MIN_STAGGER_DELAY_SEC,
  LINKY_BANK_PAYMENT_OFFER_PHASE_TTL_SEC,
  LINKY_BANK_PAYMENT_OFFER_STAGGER_LOCK_KEY_PREFIX,
  markLinkyBankPaymentOfferBankDetailsSent,
  readLinkyBankPaymentOfferSpdRecord,
  readLinkyBankPaymentOfferStaggerRecords,
  rememberLinkyBankPaymentOfferSpdPayload,
  rememberLinkyBankPaymentOfferStaggerQueue,
  removeLinkyBankPaymentOfferStaggerRecipients,
  type LinkyBankPaymentOfferStatus,
} from "../lib/bankPaymentOffer";

const isPubkey = Schema.is(Pubkey);
const isBankOfferId = Schema.is(BankOfferId);
const isNonEmptyTrimmedString = Schema.is(Schema.NonEmptyTrimmedString);
const isPositiveInt = Schema.is(Schema.Int.pipe(Schema.positive()));
const isUnixSeconds = Schema.is(UnixSeconds);

const positiveInt = (value: unknown): number | undefined => {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  const integer = Math.trunc(value);
  return isPositiveInt(integer) ? integer : undefined;
};

const positiveUnixSeconds = (value: unknown): UnixSeconds | undefined => {
  const integer = positiveInt(value);
  return integer !== undefined && isUnixSeconds(integer) ? integer : undefined;
};

const BANK_PAYMENT_OFFER_RESPONDER_RETRY_MS = 30_000;

const hasPendingBankPaymentOfferResponderWork = (
  messages: readonly LocalNostrMessage[],
  offererPubkeyHex: string,
  nowSec: number,
): boolean => {
  const entriesByOfferId = new Map<
    string,
    { hasPendingAccepted: boolean; wholeOfferTerminal: boolean }
  >();
  for (const message of messages) {
    const info = getLinkyBankPaymentOfferInfo(message.content);
    if (!info || (info.offererPublicKey ?? "").trim() !== offererPubkeyHex) {
      continue;
    }

    const entry = entriesByOfferId.get(info.offerId) ?? {
      hasPendingAccepted: false,
      wholeOfferTerminal: false,
    };
    if (isLinkyBankPaymentOfferWholeOfferTerminalStatus(info.status)) {
      entry.wholeOfferTerminal = true;
    } else if (
      info.status === "accepted" &&
      !isLinkyBankPaymentOfferExpired(info, message.createdAtSec, nowSec)
    ) {
      entry.hasPendingAccepted = true;
    }
    entriesByOfferId.set(info.offerId, entry);
  }

  return Array.from(entriesByOfferId.values()).some(
    (entry) => entry.hasPendingAccepted && !entry.wholeOfferTerminal,
  );
};

const clampBankPaymentOfferRecipientCount = (value: number): number => {
  if (!Number.isFinite(value)) {
    return LINKY_BANK_PAYMENT_OFFER_DEFAULT_RECIPIENT_COUNT;
  }

  return Math.min(
    LINKY_BANK_PAYMENT_OFFER_MAX_RECIPIENT_COUNT,
    Math.max(LINKY_BANK_PAYMENT_OFFER_MIN_RECIPIENT_COUNT, Math.round(value)),
  );
};

const clampBankPaymentOfferStaggerDelaySec = (value: number): number => {
  if (!Number.isFinite(value)) {
    return LINKY_BANK_PAYMENT_OFFER_DEFAULT_STAGGER_DELAY_SEC;
  }

  return Math.min(
    LINKY_BANK_PAYMENT_OFFER_MAX_STAGGER_DELAY_SEC,
    Math.max(LINKY_BANK_PAYMENT_OFFER_MIN_STAGGER_DELAY_SEC, Math.round(value)),
  );
};

const BANK_PAYMENT_OFFER_STAGGER_RETRY_MS = 5_000;

// Statuses that keep the offer open for more recipients: anything else means a
// winner exists or the whole offer ended, so extending it would be pointless.
const bankPaymentOfferStaggerQueueStillWanted = (
  status: LinkyBankPaymentOfferStatus,
): boolean => status === "offered" || status === "declined";

interface UseBankPaymentOffersParams {
  chatMessages: LocalNostrMessage[];
  contacts: ReturnType<typeof useContactsDomain>["contacts"];
  currentNpub: string | null;
  currentNsec: string | null;
  route: ReturnType<typeof useRouting>;
  setStatus: React.Dispatch<React.SetStateAction<string | null>>;
  t: Translate;
}

export const useBankPaymentOffers = ({
  chatMessages,
  contacts,
  currentNpub,
  currentNsec,
  route,
  setStatus,
  t,
}: UseBankPaymentOffersParams) => {
  const sendBankOffer = useAtomSet(sendBankOfferAtom, {
    mode: "promiseExit",
  });
  const [
    bankPaymentOfferRecipientCount,
    setBankPaymentOfferRecipientCountState,
  ] = useState<number>(() =>
    clampBankPaymentOfferRecipientCount(
      getInitialBankPaymentOfferRecipientCount(
        LINKY_BANK_PAYMENT_OFFER_DEFAULT_RECIPIENT_COUNT,
      ),
    ),
  );

  const setBankPaymentOfferRecipientCount = React.useCallback(
    (value: number) => {
      setBankPaymentOfferRecipientCountState(
        clampBankPaymentOfferRecipientCount(value),
      );
    },
    [],
  );

  const [
    bankPaymentOfferStaggerDelaySec,
    setBankPaymentOfferStaggerDelaySecState,
  ] = useState<number>(() =>
    clampBankPaymentOfferStaggerDelaySec(
      getInitialBankPaymentOfferStaggerDelaySec(
        LINKY_BANK_PAYMENT_OFFER_DEFAULT_STAGGER_DELAY_SEC,
      ),
    ),
  );

  const setBankPaymentOfferStaggerDelaySec = React.useCallback(
    (value: number) => {
      setBankPaymentOfferStaggerDelaySecState(
        clampBankPaymentOfferStaggerDelaySec(value),
      );
    },
    [],
  );

  const [bankPaymentOfferMessages, setBankPaymentOfferMessages] = useState<
    LocalNostrMessage[]
  >([]);

  const bankPaymentOfferExpiryInFlightRef = React.useRef(false);

  const upsertBankPaymentOfferMessage = React.useCallback(
    (message: LocalNostrMessage) => {
      const messageContactId = message.contactId.trim();
      const messageKeys = new Set(getBankPaymentOfferMessageKeys(message));
      const messageOfferId =
        getLinkyBankPaymentOfferInfo(message.content)?.offerId ?? "";
      const messageOfferKey =
        messageOfferId && messageContactId
          ? `${messageContactId}:${messageOfferId}`
          : "";

      setBankPaymentOfferMessages((prev) => {
        const existingOfferMessage = messageOfferKey
          ? (prev.find((existing) => {
              const existingContactId = existing.contactId.trim();
              const existingOfferId = getLinkyBankPaymentOfferInfo(
                existing.content,
              )?.offerId;
              return (
                `${existingContactId}:${existingOfferId ?? ""}` ===
                messageOfferKey
              );
            }) ?? null)
          : null;
        const next = prev.filter(
          (existing) =>
            !getBankPaymentOfferMessageKeys(existing).some((key) =>
              messageKeys.has(key),
            ),
        );

        const mergedMessage = existingOfferMessage
          ? (() => {
              const existingInfo = getLinkyBankPaymentOfferInfo(
                existingOfferMessage.content,
              );
              const messageInfo = getLinkyBankPaymentOfferInfo(message.content);
              const existingCreatedAt = existingOfferMessage.createdAtSec || 0;
              const messageCreatedAt = message.createdAtSec || 0;
              const existingUpdatedAt =
                existingInfo?.statusUpdatedAtSec ?? existingCreatedAt;
              const messageUpdatedAt =
                messageInfo?.statusUpdatedAtSec ?? messageCreatedAt;
              const latest =
                messageUpdatedAt > existingUpdatedAt
                  ? message
                  : messageUpdatedAt < existingUpdatedAt
                    ? existingOfferMessage
                    : messageInfo && existingInfo
                      ? getLinkyBankPaymentOfferStatusRank(
                          messageInfo.status,
                        ) >=
                        getLinkyBankPaymentOfferStatusRank(existingInfo.status)
                        ? message
                        : existingOfferMessage
                      : messageCreatedAt >= existingCreatedAt
                        ? message
                        : existingOfferMessage;

              return {
                ...existingOfferMessage,
                ...latest,
                contactId: existingOfferMessage.contactId,
                createdAtSec:
                  existingCreatedAt && messageCreatedAt
                    ? Math.min(existingCreatedAt, messageCreatedAt)
                    : existingCreatedAt || messageCreatedAt,
                direction: existingOfferMessage.direction,
                id: messageOfferKey
                  ? `bank-payment-offer:${messageOfferKey}`
                  : latest.id,
              };
            })()
          : messageOfferKey
            ? {
                ...message,
                id: `bank-payment-offer:${messageOfferKey}`,
              }
            : message;

        next.push(mergedMessage);
        next.sort((a, b) => {
          const createdA = a.createdAtSec;
          const createdB = b.createdAtSec;
          return createdA - createdB;
        });
        return next;
      });
    },
    [],
  );

  const reassignBankPaymentOfferMessages = React.useCallback(
    (normalizedFrom: string, normalizedTo: string) => {
      setBankPaymentOfferMessages((previous) => {
        let changed = false;
        const next = previous.map((message) => {
          if (message.contactId.trim() !== normalizedFrom) {
            return message;
          }
          changed = true;
          return { ...message, contactId: normalizedTo };
        });
        return changed ? next : previous;
      });
    },
    [],
  );

  const sendBankPaymentOfferedMessage = React.useCallback(
    async (args: {
      amountSat: number | null;
      amountText: string;
      contactId: string;
      contactPubHex: string;
      expiresAtSec?: number;
      myPubHex: string;
      offerId: string;
    }): Promise<number | null> => {
      const { amountSat, amountText, contactId, contactPubHex, myPubHex } =
        args;
      const offerId = args.offerId;
      if (
        !isPubkey(contactPubHex) ||
        !isPubkey(myPubHex) ||
        !isBankOfferId(offerId) ||
        !isNonEmptyTrimmedString(amountText)
      ) {
        return null;
      }

      const text = getLinkyBankPaymentOfferMessageText(amountText, "offered");
      if (!isNonEmptyTrimmedString(text)) return null;

      const clientId = ClientId.make(makeLocalId());
      const expiresAtSec = positiveUnixSeconds(args.expiresAtSec);
      const exit = await sendBankOffer(
        new BankOfferDraft({
          to: contactPubHex,
          offerId,
          offerer: myPubHex,
          status: "offered",
          amountText,
          text,
          ...(amountSat !== null && isPositiveInt(amountSat)
            ? { amountSat }
            : {}),
          ...(expiresAtSec === undefined ? {} : { expiresAtSec }),
        }),
      );
      if (!Exit.isSuccess(exit)) return null;

      upsertBankPaymentOfferMessage({
        clientId,
        contactId,
        content: exit.value.content,
        createdAtSec: exit.value.sentAt,
        direction: "out",
        id: `bank-payment-offer:${contactId}:${offerId}`,
        localOnly: true,
        pubkey: myPubHex,
        rumorId: exit.value.rumorId,
        status: "sent",
        wrapId: exit.value.selfCopy.wrapId,
      });
      return exit.value.sentAt;
    },
    [sendBankOffer, upsertBankPaymentOfferMessage],
  );

  const [bankPaymentOfferStaggerTick, setBankPaymentOfferStaggerTick] =
    useState(0);

  const requestBankPaymentOffer = React.useCallback(
    async (args: {
      amountSat?: unknown;
      amountText: string;
      contacts: readonly ContactRowLike[];
      spdPayload?: unknown;
      staggerDelaySec?: unknown;
    }): Promise<{ chatId: string; offerId: string } | null> => {
      const amountSatRaw = Number(args.amountSat ?? 0);
      const amountSat =
        Number.isFinite(amountSatRaw) && amountSatRaw > 0
          ? Math.round(amountSatRaw)
          : null;
      const amountText = args.amountText.trim();
      const spdPayload = String(args.spdPayload ?? "").trim();
      const staggerDelaySec = clampBankPaymentOfferStaggerDelaySec(
        Number(args.staggerDelaySec ?? 0),
      );
      if (!amountText) {
        setStatus(t("spdPaymentOfferMissingAmount"));
        return null;
      }
      if (args.contacts.length === 0) {
        setStatus(t("spdPaymentOfferFailed"));
        return null;
      }
      if (!currentNsec) {
        setStatus(t("profileMissingNpub"));
        return null;
      }

      try {
        const identity = identityFromNsec(currentNsec);
        if (!identity) throw new Error("invalid nsec");
        const myPubHex = identity.pubkey;

        const recipients: {
          contactId: string;
          contactPubHex: string;
        }[] = [];
        for (const contact of args.contacts) {
          const contactId = (contact.id ?? "").trim();
          const contactNpub = normalizeNpubIdentifier(contact.npub ?? "");
          if (!contactId || !contactNpub) continue;

          const contactPubHex = decodeNpub(contactNpub);
          if (!contactPubHex) continue;
          recipients.push({ contactId, contactPubHex });
        }

        if (recipients.length === 0) {
          setStatus(t("chatMissingContactNpub"));
          return null;
        }

        const offerId = makeLocalId();
        if (!isBankOfferId(offerId)) {
          setStatus(t("spdPaymentOfferFailed"));
          return null;
        }
        if (spdPayload) {
          // Persisted so the offer survives an app reload: the auto-responder
          // needs this payload when a recipient's acceptance arrives later.
          rememberLinkyBankPaymentOfferSpdPayload({
            offerId,
            ownerPubkey: myPubHex,
            spdPayload,
          });
        }

        let sentCount = 0;
        let firstSentContactId = "";
        let firstSentAtSec: number | null = null;
        const queuedRecipients: { contactId: string; contactPubHex: string }[] =
          [];

        for (const recipient of recipients) {
          // With a stagger delay only the first reachable recipient gets the
          // offer now; the rest wait in the persisted queue.
          if (staggerDelaySec > 0 && firstSentAtSec !== null) {
            queuedRecipients.push(recipient);
            continue;
          }

          const sentAtSec = await sendBankPaymentOfferedMessage({
            amountSat,
            amountText,
            contactId: recipient.contactId,
            contactPubHex: recipient.contactPubHex,
            myPubHex,
            offerId,
          });
          if (sentAtSec === null) continue;

          sentCount += 1;
          if (firstSentAtSec === null) {
            firstSentAtSec = sentAtSec;
            firstSentContactId = recipient.contactId;
          }
        }

        if (sentCount === 0 || firstSentAtSec === null) {
          setStatus(t("spdPaymentOfferFailed"));
          return null;
        }

        if (queuedRecipients.length > 0) {
          // Delayed recipients share the first send's expiry, so extending
          // the offer never extends its total lifetime.
          const staggerBaseSec = firstSentAtSec;
          rememberLinkyBankPaymentOfferStaggerQueue({
            amountSat,
            amountText,
            createdAtSec: staggerBaseSec,
            expiresAtSec:
              staggerBaseSec + LINKY_BANK_PAYMENT_OFFER_PHASE_TTL_SEC,
            offerId,
            ownerPubkey: myPubHex,
            pending: queuedRecipients.map((recipient, index) => ({
              contactId: recipient.contactId,
              contactPubHex: recipient.contactPubHex,
              dueAtSec: staggerBaseSec + (index + 1) * staggerDelaySec,
            })),
          });
          setBankPaymentOfferStaggerTick((tick) => tick + 1);
        }

        setBankPaymentOfferRecipientCount(args.contacts.length);
        setBankPaymentOfferStaggerDelaySec(staggerDelaySec);
        return { chatId: firstSentContactId, offerId };
      } catch (error) {
        setStatus(
          `${t("errorPrefix")}: ${getUnknownErrorMessage(error, "publish failed")}`,
        );
        return null;
      }
    },
    [
      currentNsec,
      sendBankPaymentOfferedMessage,
      setBankPaymentOfferRecipientCount,
      setBankPaymentOfferStaggerDelaySec,
      setStatus,
      t,
    ],
  );

  const respondToBankPaymentOffer = React.useCallback(
    async (
      message: LocalNostrMessage,
      nextStatus: LinkyBankPaymentOfferStatus,
      options?: {
        expiresAtSec?: number | null;
        extensionSec?: number | null;
        spdPayload?: string | null;
        withPush?: boolean;
      },
    ): Promise<boolean> => {
      const offerInfo = getLinkyBankPaymentOfferInfo(message.content);
      if (!offerInfo) {
        setStatus(t("spdPaymentOfferFailed"));
        return false;
      }
      if (!currentNsec) {
        setStatus(t("profileMissingNpub"));
        return false;
      }

      try {
        const identity = identityFromNsec(currentNsec);
        if (!identity) throw new Error("invalid nsec");
        const myPubHex = identity.pubkey;
        const messageDirection = message.direction.trim();
        const offererPublicKey =
          (offerInfo.offererPublicKey ?? "").trim() ||
          (messageDirection === "out" ? myPubHex : message.pubkey.trim());

        if (!isPubkey(offererPublicKey)) {
          setStatus(t("spdPaymentOfferFailed"));
          return false;
        }

        const messageContactId = message.contactId.trim();
        const messageContact =
          contacts.find((contact) => contact.id.trim() === messageContactId) ??
          null;
        const contactNpub = normalizeNpubIdentifier(messageContact?.npub ?? "");
        let contactPubkey: string | null = null;
        if (contactNpub) {
          contactPubkey = decodeNpub(contactNpub);
        }

        const messagePubkey = message.pubkey.trim();
        const recipientPublicKey =
          offererPublicKey === myPubHex
            ? (contactPubkey ??
              (messagePubkey !== myPubHex ? messagePubkey : ""))
            : offererPublicKey;
        if (!isPubkey(recipientPublicKey) || recipientPublicKey === myPubHex) {
          setStatus(t("spdPaymentOfferFailed"));
          return false;
        }

        const offerId = offerInfo.offerId;
        const amountText = offerInfo.amountText;
        if (!isBankOfferId(offerId) || !isNonEmptyTrimmedString(amountText)) {
          setStatus(t("spdPaymentOfferFailed"));
          return false;
        }

        const clientId = ClientId.make(makeLocalId());
        const initiatedAtSec = positiveUnixSeconds(
          offerInfo.initiatedAtSec ?? message.createdAtSec,
        );
        const bankPaidAtSec = positiveUnixSeconds(
          offerInfo.bankPaidAtSec ??
            (offerInfo.status === "bank_paid"
              ? offerInfo.statusUpdatedAtSec
              : null),
        );
        const expiresAtSec = positiveUnixSeconds(options?.expiresAtSec);
        const extensionSec = positiveInt(options?.extensionSec);
        const amountSat = positiveInt(offerInfo.amountSat);
        const spdPayload = (
          options?.spdPayload ??
          offerInfo.spdPayload ??
          ""
        ).trim();
        const text = getLinkyBankPaymentOfferMessageText(
          amountText,
          nextStatus,
          extensionSec,
        );
        if (!isNonEmptyTrimmedString(text)) {
          setStatus(t("spdPaymentOfferFailed"));
          return false;
        }

        const exit = await sendBankOffer(
          new BankOfferDraft({
            to: recipientPublicKey,
            offerId,
            offerer: offererPublicKey,
            status: nextStatus,
            amountText,
            text,
            ...(amountSat === undefined ? {} : { amountSat }),
            ...(initiatedAtSec === undefined ? {} : { initiatedAtSec }),
            ...(bankPaidAtSec === undefined ? {} : { bankPaidAtSec }),
            ...(expiresAtSec === undefined ? {} : { expiresAtSec }),
            ...(extensionSec === undefined ? {} : { extensionSec }),
            ...(isNonEmptyTrimmedString(spdPayload) ? { spdPayload } : {}),
            ...(options?.withPush === undefined
              ? {}
              : { pushMark: options.withPush }),
            clientId,
          }),
        );
        if (!Exit.isSuccess(exit)) {
          setStatus(t("spdPaymentOfferFailed"));
          return false;
        }

        upsertBankPaymentOfferMessage({
          clientId,
          contactId: message.contactId.trim(),
          content: exit.value.content,
          createdAtSec: exit.value.sentAt,
          direction: offererPublicKey === myPubHex ? "out" : "in",
          id: `bank-payment-offer:${offerInfo.offerId}`,
          localOnly: true,
          pubkey: offererPublicKey === myPubHex ? myPubHex : offererPublicKey,
          rumorId: exit.value.rumorId,
          status: "sent",
          wrapId: exit.value.selfCopy.wrapId,
        });

        return true;
      } catch (error) {
        setStatus(
          `${t("errorPrefix")}: ${getUnknownErrorMessage(error, "publish failed")}`,
        );
        return false;
      }
    },
    [
      currentNsec,
      contacts,
      sendBankOffer,
      setStatus,
      t,
      upsertBankPaymentOfferMessage,
    ],
  );

  const getBankPaymentOfferGroupMessages = React.useCallback(
    (message: LocalNostrMessage): LocalNostrMessage[] => {
      const offerInfo = getLinkyBankPaymentOfferInfo(message.content);
      if (!offerInfo) return [message];

      const group = bankPaymentOfferMessages.filter((candidate) => {
        const candidateInfo = getLinkyBankPaymentOfferInfo(candidate.content);
        return candidateInfo?.offerId === offerInfo.offerId;
      });

      if (
        !group.some(
          (candidate) =>
            candidate.contactId.trim() === message.contactId.trim(),
        )
      ) {
        group.push(message);
      }

      return group;
    },
    [bankPaymentOfferMessages],
  );

  const isBankPaymentOfferCanceled = React.useCallback(
    (offerId: string): boolean => {
      const normalizedOfferId = offerId.trim();
      if (!normalizedOfferId) return false;

      return bankPaymentOfferMessages.some((message) => {
        const info = getLinkyBankPaymentOfferInfo(message.content);
        return (
          info?.offerId === normalizedOfferId && info.status === "canceled"
        );
      });
    },
    [bankPaymentOfferMessages],
  );

  const respondToBankPaymentOfferWithGroupState = React.useCallback(
    async (
      message: LocalNostrMessage,
      nextStatus: LinkyBankPaymentOfferStatus,
      options?: {
        expiresAtSec?: number | null;
        extensionSec?: number | null;
        spdPayload?: string | null;
        withPush?: boolean;
      },
    ): Promise<boolean> => {
      if (nextStatus !== "canceled" && nextStatus !== "settled") {
        return await respondToBankPaymentOffer(message, nextStatus, options);
      }

      const group = getBankPaymentOfferGroupMessages(message);
      const cancellationPushContactId =
        nextStatus === "canceled"
          ? (group
              .filter((candidate) => {
                const info = getLinkyBankPaymentOfferInfo(candidate.content);
                return (
                  info?.status === "accepted" ||
                  info?.status === "bank_details_sent" ||
                  info?.status === "bank_paid"
                );
              })
              .sort((left, right) => {
                const leftInfo = getLinkyBankPaymentOfferInfo(left.content);
                const rightInfo = getLinkyBankPaymentOfferInfo(right.content);
                const rank = (status: LinkyBankPaymentOfferStatus): number =>
                  status === "bank_paid"
                    ? 0
                    : status === "bank_details_sent"
                      ? 1
                      : 2;
                const rankDifference =
                  rank(leftInfo?.status ?? "accepted") -
                  rank(rightInfo?.status ?? "accepted");
                if (rankDifference !== 0) return rankDifference;
                return (
                  (leftInfo?.statusUpdatedAtSec ?? left.createdAtSec) -
                  (rightInfo?.statusUpdatedAtSec ?? right.createdAtSec)
                );
              })[0]?.contactId ?? null)
          : null;
      let sentAny = false;

      for (const groupMessage of group) {
        const info = getLinkyBankPaymentOfferInfo(groupMessage.content);
        if (!info) continue;
        if (info.status === nextStatus) {
          sentAny = true;
          continue;
        }
        if (nextStatus === "canceled" && info.status === "settled") continue;

        const sent = await respondToBankPaymentOffer(groupMessage, nextStatus, {
          ...(options?.spdPayload !== undefined
            ? { spdPayload: options.spdPayload }
            : {}),
          withPush:
            nextStatus === "canceled" &&
            groupMessage.contactId.trim() ===
              (cancellationPushContactId ?? "").trim(),
        });
        sentAny = sentAny || sent;
      }

      return sentAny;
    },
    [getBankPaymentOfferGroupMessages, respondToBankPaymentOffer],
  );

  React.useEffect(() => {
    if (!currentNsec) return;
    if (bankPaymentOfferMessages.length === 0) return;

    let cancelled = false;
    let retryTimeoutHandle: number | undefined;

    const run = async () => {
      try {
        const identity = identityFromNsec(currentNsec);
        if (!identity) return;
        const myPubHex = identity.pubkey;
        const groups = new Map<
          string,
          {
            info: ReturnType<typeof getLinkyBankPaymentOfferInfo>;
            message: LocalNostrMessage;
          }[]
        >();

        for (const message of bankPaymentOfferMessages) {
          const info = getLinkyBankPaymentOfferInfo(message.content);
          if (!info) continue;
          if ((info.offererPublicKey ?? "").trim() !== myPubHex) {
            continue;
          }

          const group = groups.get(info.offerId) ?? [];
          group.push({ info, message });
          groups.set(info.offerId, group);
        }

        for (const [offerId, group] of groups) {
          if (cancelled) return;

          if (
            group.some(
              (entry) =>
                entry.info &&
                isLinkyBankPaymentOfferWholeOfferTerminalStatus(
                  entry.info.status,
                ),
            )
          ) {
            forgetLinkyBankPaymentOfferSpdPayload(offerId);
            continue;
          }

          const notifyNonWinningCandidates = async (
            winner: LocalNostrMessage,
          ): Promise<void> => {
            const winnerContactId = winner.contactId.trim();
            for (const entry of group) {
              const contactId = entry.message.contactId.trim();
              if (!contactId || contactId === winnerContactId) continue;
              if (
                entry.info?.status !== "offered" &&
                entry.info?.status !== "accepted"
              ) {
                continue;
              }

              await respondToBankPaymentOffer(
                entry.message,
                "accepted_by_other",
              );
            }
          };

          const activeBankDetails = group
            .filter(
              (entry) =>
                entry.info?.status === "bank_details_sent" ||
                entry.info?.status === "bank_paid",
            )
            .sort((left, right) => {
              const leftSec =
                left.info?.statusUpdatedAtSec ?? left.message.createdAtSec;
              const rightSec =
                right.info?.statusUpdatedAtSec ?? right.message.createdAtSec;
              return leftSec - rightSec;
            })[0];
          if (activeBankDetails) {
            try {
              await withLocalStorageLeaseLock({
                key: `${LINKY_BANK_PAYMENT_OFFER_DETAILS_LOCK_KEY_PREFIX}.${offerId}`,
                timeoutMs: 0,
                fn: async () => {
                  await notifyNonWinningCandidates(activeBankDetails.message);
                },
              });
            } catch {
              // Another tab is already closing the non-winning candidates.
            }
            continue;
          }

          const accepted = group
            .filter((entry) => entry.info?.status === "accepted")
            .sort((a, b) => {
              const aSec = a.info?.statusUpdatedAtSec ?? a.message.createdAtSec;
              const bSec = b.info?.statusUpdatedAtSec ?? b.message.createdAtSec;
              if (aSec !== bSec) return aSec - bSec;
              return a.message.contactId.localeCompare(b.message.contactId);
            });

          const candidate = accepted[0] ?? null;
          if (!candidate?.info) continue;

          const candidateKey = `${offerId}:${candidate.message.contactId.trim()}`;
          const record = readLinkyBankPaymentOfferSpdRecord({
            offerId,
            ownerPubkey: myPubHex,
          });
          // Details go to exactly one winner, so any recorded send blocks the
          // offer — a per-candidate check would let a tab with a lagging
          // message view send the same bank details to a second recipient.
          if (!record || record.sentCandidateKeys.length > 0) {
            continue;
          }

          try {
            await withLocalStorageLeaseLock({
              key: `${LINKY_BANK_PAYMENT_OFFER_DETAILS_LOCK_KEY_PREFIX}.${offerId}`,
              timeoutMs: 0,
              fn: async () => {
                // Re-read under the lock: another tab may have just sent.
                const lockedRecord = readLinkyBankPaymentOfferSpdRecord({
                  offerId,
                  ownerPubkey: myPubHex,
                });
                if (!lockedRecord) return;
                if (lockedRecord.sentCandidateKeys.length > 0) return;

                const sent = await respondToBankPaymentOffer(
                  candidate.message,
                  "bank_details_sent",
                  {
                    spdPayload: lockedRecord.spdPayload,
                  },
                );
                // Marked only after a successful publish so an interrupted
                // send retries; the lease lock covers the concurrent window.
                if (sent) {
                  markLinkyBankPaymentOfferBankDetailsSent({
                    candidateKey,
                    offerId,
                  });
                  await notifyNonWinningCandidates(candidate.message);
                }
              },
            });
          } catch {
            // Another tab holds the send lock for this offer; let it finish.
          }
        }

        if (cancelled) return;
        // A failed publish or a skipped lease lock leaves the message state
        // unchanged, so nothing re-runs this effect; keep retrying while an
        // accepted entry of my own offer is still waiting for bank details.
        if (
          hasPendingBankPaymentOfferResponderWork(
            bankPaymentOfferMessages,
            myPubHex,
            nowSeconds(),
          )
        ) {
          retryTimeoutHandle = window.setTimeout(() => {
            void run();
          }, BANK_PAYMENT_OFFER_RESPONDER_RETRY_MS);
        }
      } catch {
        // Best effort; the sender can retry when the accepted event reappears.
      }
    };

    void run();

    return () => {
      cancelled = true;
      if (retryTimeoutHandle !== undefined) {
        window.clearTimeout(retryTimeoutHandle);
      }
    };
  }, [bankPaymentOfferMessages, currentNsec, respondToBankPaymentOffer]);

  // Staggered proxy payment offers: queued recipients (persisted by
  // requestBankPaymentOffer) receive the offer once their delay elapses,
  // unless the offer meanwhile found a winner or ended.
  React.useEffect(() => {
    if (!currentNsec) return;
    const identity = identityFromNsec(currentNsec);
    if (!identity) return;
    const myPubHex = identity.pubkey;

    const records = readLinkyBankPaymentOfferStaggerRecords(myPubHex);
    if (records.length === 0) return;

    const closedOfferIds = new Set<string>();
    const offeredContactIdsByOfferId = new Map<string, Set<string>>();
    for (const message of bankPaymentOfferMessages) {
      const info = getLinkyBankPaymentOfferInfo(message.content);
      if (!info) continue;
      if (!bankPaymentOfferStaggerQueueStillWanted(info.status)) {
        closedOfferIds.add(info.offerId);
      }
      const contactId = message.contactId.trim();
      if (contactId) {
        const contactIds =
          offeredContactIdsByOfferId.get(info.offerId) ?? new Set<string>();
        contactIds.add(contactId);
        offeredContactIdsByOfferId.set(info.offerId, contactIds);
      }
    }

    let cancelled = false;
    let timeoutId: number | undefined;
    const bumpTick = () => setBankPaymentOfferStaggerTick((tick) => tick + 1);

    const nowSec = nowSeconds();
    const dueRecords: typeof records = [];
    let nextDueAtSec: number | null = null;
    for (const record of records) {
      if (closedOfferIds.has(record.offerId)) {
        forgetLinkyBankPaymentOfferStaggerQueue(record.offerId);
        if (getInspectorEmissionEnabled()) {
          reportInspectorRows([
            {
              at: Date.now(),
              channel: "nostr.operation",
              tag: "bankOffer.staggerDropped",
              summary: `proxy payment offer is no longer open — dropped ${record.pending.length} queued recipients`,
              links: {
                contact: record.pending.map((recipient) => recipient.contactId),
                offer: record.offerId,
              },
              payload: {
                offerId: record.offerId,
                pendingContactIds: record.pending.map(
                  (recipient) => recipient.contactId,
                ),
              },
            },
          ]);
        }
        continue;
      }

      const dueAtSec = Math.min(
        ...record.pending.map((recipient) => recipient.dueAtSec),
      );
      if (dueAtSec <= nowSec) {
        dueRecords.push(record);
      } else {
        nextDueAtSec =
          nextDueAtSec === null ? dueAtSec : Math.min(nextDueAtSec, dueAtSec);
      }
    }

    const dispatchDue = async () => {
      let progressed = false;
      for (const record of dueRecords) {
        if (cancelled) return;
        try {
          await withLocalStorageLeaseLock({
            key: `${LINKY_BANK_PAYMENT_OFFER_STAGGER_LOCK_KEY_PREFIX}.${record.offerId}`,
            timeoutMs: 0,
            fn: async () => {
              // Re-read under the lock: another tab may have just sent.
              const lockedRecord = readLinkyBankPaymentOfferStaggerRecords(
                myPubHex,
              ).find((candidate) => candidate.offerId === record.offerId);
              if (!lockedRecord) {
                progressed = true;
                return;
              }

              const dueNowSec = nowSeconds();
              const sentContactIds: string[] = [];
              for (const recipient of lockedRecord.pending) {
                if (cancelled) return;
                if (recipient.dueAtSec > dueNowSec) continue;
                if (
                  offeredContactIdsByOfferId
                    .get(record.offerId)
                    ?.has(recipient.contactId)
                ) {
                  // Already offered (e.g. by another tab); just dequeue.
                  sentContactIds.push(recipient.contactId);
                  continue;
                }

                const sentAtSec = await sendBankPaymentOfferedMessage({
                  amountSat: lockedRecord.amountSat,
                  amountText: lockedRecord.amountText,
                  contactId: recipient.contactId,
                  contactPubHex: recipient.contactPubHex,
                  expiresAtSec: lockedRecord.expiresAtSec,
                  myPubHex,
                  offerId: lockedRecord.offerId,
                });
                if (sentAtSec === null) continue;

                sentContactIds.push(recipient.contactId);
                if (getInspectorEmissionEnabled()) {
                  reportInspectorRows([
                    {
                      at: Date.now(),
                      channel: "nostr.operation",
                      tag: "bankOffer.staggerExtended",
                      summary:
                        "proxy payment offer extended to the next queued recipient",
                      links: {
                        contact: recipient.contactId,
                        offer: lockedRecord.offerId,
                      },
                      payload: {
                        contactId: recipient.contactId,
                        dueAtSec: recipient.dueAtSec,
                        offerId: lockedRecord.offerId,
                        sentAtSec,
                      },
                    },
                  ]);
                }
              }

              if (sentContactIds.length > 0) {
                removeLinkyBankPaymentOfferStaggerRecipients(
                  record.offerId,
                  sentContactIds,
                );
                progressed = true;
              }
            },
          });
        } catch {
          // Another tab holds the stagger lock for this offer; let it finish.
        }
      }

      if (cancelled) return;
      if (progressed) {
        // Successful sends also re-run this effect via the message upsert;
        // the tick covers dequeues that left the messages untouched.
        bumpTick();
      } else {
        // A failed publish leaves both queue and messages unchanged, so
        // nothing re-runs this effect on its own; nudge a retry.
        timeoutId = window.setTimeout(
          bumpTick,
          BANK_PAYMENT_OFFER_STAGGER_RETRY_MS,
        );
      }
    };

    if (dueRecords.length > 0) {
      void dispatchDue();
    } else if (nextDueAtSec !== null) {
      timeoutId = window.setTimeout(
        bumpTick,
        Math.max(0, nextDueAtSec * 1000 - Date.now()),
      );
    }

    return () => {
      cancelled = true;
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [
    bankPaymentOfferMessages,
    bankPaymentOfferStaggerTick,
    currentNsec,
    sendBankPaymentOfferedMessage,
  ]);

  const bankPaymentOfferExpiryGroups = React.useMemo(() => {
    if (!currentNpub || bankPaymentOfferMessages.length === 0) return [];

    const myPubHex = decodeNpub(currentNpub);
    if (!myPubHex) return [];

    const groups = new Map<
      string,
      {
        info: NonNullable<ReturnType<typeof getLinkyBankPaymentOfferInfo>>;
        message: LocalNostrMessage;
      }[]
    >();
    for (const message of bankPaymentOfferMessages) {
      const info = getLinkyBankPaymentOfferInfo(message.content);
      if (
        !info ||
        (info.offererPublicKey ?? "").trim() !== myPubHex ||
        isLinkyBankPaymentOfferTerminalStatus(info.status)
      ) {
        continue;
      }
      const group = groups.get(info.offerId) ?? [];
      group.push({ info, message });
      groups.set(info.offerId, group);
    }

    const nowSec = nowSeconds();
    const statusPriority: LinkyBankPaymentOfferStatus[] = [
      "bank_paid",
      "bank_details_sent",
      "accepted",
      "offered",
    ];
    return Array.from(groups.values()).flatMap((group) => {
      const activeStatus = statusPriority.find((status) =>
        group.some((entry) => entry.info.status === status),
      );
      if (!activeStatus) return [];

      const expiresAtSec = Math.max(
        ...group
          .filter((entry) => entry.info.status === activeStatus)
          .map(
            (entry) =>
              getLinkyBankPaymentOfferExpiresAtSec(
                entry.info,
                entry.message.createdAtSec,
              ) ?? nowSec,
          ),
      );
      return [
        {
          expiresAtMs: expiresAtSec * 1_000,
          messages: group.map((entry) => entry.message),
        },
      ];
    });
  }, [bankPaymentOfferMessages, currentNpub]);

  React.useEffect(() => {
    const nextExpiryMs = Math.min(
      ...bankPaymentOfferExpiryGroups.map((group) => group.expiresAtMs),
    );
    if (!Number.isFinite(nextExpiryMs)) return;

    let cancelled = false;
    let timeoutId = 0;
    const expireDueGroups = () => {
      if (cancelled) return;
      if (bankPaymentOfferExpiryInFlightRef.current) {
        timeoutId = window.setTimeout(expireDueGroups, 100);
        return;
      }

      bankPaymentOfferExpiryInFlightRef.current = true;
      void (async () => {
        try {
          const nowMs = Date.now();
          for (const group of bankPaymentOfferExpiryGroups) {
            if (group.expiresAtMs > nowMs) continue;
            for (const message of group.messages) {
              if (cancelled) return;
              await respondToBankPaymentOffer(message, "canceled");
            }
          }
        } finally {
          bankPaymentOfferExpiryInFlightRef.current = false;
        }
      })();
    };
    timeoutId = window.setTimeout(
      expireDueGroups,
      Math.max(0, nextExpiryMs - Date.now()),
    );

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [bankPaymentOfferExpiryGroups, respondToBankPaymentOffer]);

  const chatMessagesWithBankPaymentOffers = React.useMemo(() => {
    if (route.kind !== "chat") return chatMessages;

    const activeContactId = route.id.trim();
    if (!activeContactId) return chatMessages;

    const offerMessages = bankPaymentOfferMessages.filter(
      (message) => message.contactId.trim() === activeContactId,
    );
    if (offerMessages.length === 0) return chatMessages;

    const seenKeys = new Set(
      chatMessages.flatMap(getBankPaymentOfferMessageKeys),
    );
    const merged = [...chatMessages];
    for (const message of offerMessages) {
      const keys = getBankPaymentOfferMessageKeys(message);
      if (keys.some((key) => seenKeys.has(key))) continue;
      merged.push(message);
      for (const key of keys) seenKeys.add(key);
    }

    merged.sort((a, b) => {
      const createdA = a.createdAtSec;
      const createdB = b.createdAtSec;
      if (createdA !== createdB) return createdA - createdB;
      return a.id.localeCompare(b.id);
    });

    return merged;
  }, [bankPaymentOfferMessages, chatMessages, route]);

  return {
    bankPaymentOfferMessages,
    bankPaymentOfferRecipientCount,
    bankPaymentOfferStaggerDelaySec,
    chatMessagesWithBankPaymentOffers,
    isBankPaymentOfferCanceled,
    reassignBankPaymentOfferMessages,
    requestBankPaymentOffer,
    respondToBankPaymentOfferWithGroupState,
    upsertBankPaymentOfferMessage,
  };
};
