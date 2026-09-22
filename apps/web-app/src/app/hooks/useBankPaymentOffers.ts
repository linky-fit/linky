import {
  BankOfferId,
  decodeNpub,
  identityFromNsec,
  type BankOfferDraft,
  type BankOfferInboxEvent,
  type Pubkey,
} from "@linky/linkstr";
import { sendBankOfferAtom, useAtomSet } from "@linky/linkstr-react";
import {
  activeBankPaymentOffers,
  applyBankPaymentOfferReceipt,
  applyBankPaymentOfferSnapshot,
  bankPaymentOfferedDraft,
  bankPaymentOfferGroupResponses,
  bankPaymentOfferResponderSteps,
  bankPaymentOfferResponseDraft,
  bankPaymentOfferStaggerDue,
  bankPaymentOfferStaggerQueue,
  BANK_PAYMENT_OFFER_DEFAULT_RECIPIENT_COUNT,
  BANK_PAYMENT_OFFER_DEFAULT_STAGGER_DELAY_SEC,
  clampBankPaymentOfferRecipientCount,
  clampBankPaymentOfferStaggerDelaySec,
  decodeBankPaymentOffer,
  emptyBankPaymentOfferState,
  findBankPaymentOffer,
  hasPendingBankPaymentOfferResponderWork,
  isBankPaymentOfferCanceled,
  isBankPaymentOfferStaggerQueueOpen,
  lastBankPaymentOfferResponseSecByPeer,
  ownBankPaymentOfferExpiries,
  type AppliedBankPaymentOfferSnapshot,
  type BankOfferStatus,
  type BankPaymentOffer,
  type BankPaymentOfferResponseOptions,
  type BankPaymentOfferState,
} from "@linky/proxy-payment";
import { Exit } from "effect";
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
import {
  bankPaymentOfferMessageRow,
  compareBankPaymentOfferRows,
  mergeBankPaymentOffersIntoChatMessages,
} from "../lib/bankPaymentOfferRows";
import {
  BANK_PAYMENT_OFFER_DETAILS_LOCK_KEY_PREFIX,
  BANK_PAYMENT_OFFER_STAGGER_LOCK_KEY_PREFIX,
  forgetBankPaymentOfferSpdPayload,
  forgetBankPaymentOfferStaggerQueue,
  markBankPaymentOfferBankDetailsSent,
  readBankPaymentOfferSpdRecord,
  readBankPaymentOfferStaggerRecords,
  rememberBankPaymentOfferSpdPayload,
  rememberBankPaymentOfferStaggerQueue,
  removeBankPaymentOfferStaggerRecipients,
} from "../lib/bankPaymentOfferStorage";
import type { ContactRowLike, LocalNostrMessage } from "../types/appTypes";
import {
  buildUnknownContactId,
  readUnknownContactIdPubkey,
} from "./messages/contactIdentity";

const RESPONDER_RETRY_MS = 30_000;
const STAGGER_RETRY_MS = 5_000;

interface UseBankPaymentOffersParams {
  chatMessages: LocalNostrMessage[];
  contacts: readonly ContactRowLike[];
  currentNsec: string | null;
  route: ReturnType<typeof useRouting>;
  setStatus: React.Dispatch<React.SetStateAction<string | null>>;
  t: Translate;
}

// Offers are keyed by peer pubkey; the contact id is a display concern, so an
// unknown peer saved as a contact moves its offers without any bookkeeping.
const useContactPubkeys = (contacts: readonly ContactRowLike[]) =>
  React.useMemo(() => {
    const contactIdByPubkey = new Map<Pubkey, string>();
    const pubkeyByContactId = new Map<string, Pubkey>();
    for (const contact of contacts) {
      const id = (contact.id ?? "").trim();
      const npub = normalizeNpubIdentifier(contact.npub ?? "");
      const pubkey = npub ? decodeNpub(npub) : null;
      if (!id || !pubkey) continue;
      if (!contactIdByPubkey.has(pubkey)) contactIdByPubkey.set(pubkey, id);
      pubkeyByContactId.set(id, pubkey);
    }
    return {
      contactIdFor: (pubkey: Pubkey): string | null =>
        contactIdByPubkey.get(pubkey) ?? buildUnknownContactId(pubkey),
      pubkeyFor: (contactId: string): Pubkey | null =>
        pubkeyByContactId.get(contactId.trim()) ??
        readUnknownContactIdPubkey(contactId),
    };
  }, [contacts]);

export const useBankPaymentOffers = ({
  chatMessages,
  contacts,
  currentNsec,
  route,
  setStatus,
  t,
}: UseBankPaymentOffersParams) => {
  const sendBankOffer = useAtomSet(sendBankOfferAtom, { mode: "promiseExit" });
  const myPubHex = React.useMemo(
    () =>
      currentNsec ? (identityFromNsec(currentNsec)?.pubkey ?? null) : null,
    [currentNsec],
  );
  const { contactIdFor, pubkeyFor } = useContactPubkeys(contacts);

  const [recipientCount, setRecipientCountState] = useState(() =>
    clampBankPaymentOfferRecipientCount(
      getInitialBankPaymentOfferRecipientCount(
        BANK_PAYMENT_OFFER_DEFAULT_RECIPIENT_COUNT,
      ),
    ),
  );
  const [staggerDelaySec, setStaggerDelaySecState] = useState(() =>
    clampBankPaymentOfferStaggerDelaySec(
      getInitialBankPaymentOfferStaggerDelaySec(
        BANK_PAYMENT_OFFER_DEFAULT_STAGGER_DELAY_SEC,
      ),
    ),
  );

  // The inbox applies snapshots synchronously against the newest state, so
  // the ref is the source of truth and the React state mirrors it for renders.
  const stateRef = React.useRef<BankPaymentOfferState>(
    emptyBankPaymentOfferState,
  );
  const [state, setState] = useState(emptyBankPaymentOfferState);
  const update = React.useCallback((next: BankPaymentOfferState) => {
    stateRef.current = next;
    setState(next);
  }, []);
  React.useEffect(() => {
    update(emptyBankPaymentOfferState);
  }, [myPubHex, update]);
  const offers = state.offers;

  const applySnapshot = React.useCallback(
    (event: BankOfferInboxEvent): AppliedBankPaymentOfferSnapshot[] => {
      if (!myPubHex) return [];
      const result = applyBankPaymentOfferSnapshot(
        stateRef.current,
        event,
        myPubHex,
        nowSeconds(),
      );
      if (result.state !== stateRef.current) update(result.state);
      return [...result.accepted];
    },
    [myPubHex, update],
  );

  const publish = React.useCallback(
    async (
      peer: Pubkey,
      draft: BankOfferDraft,
    ): Promise<BankPaymentOffer | null> => {
      const exit = await sendBankOffer(draft);
      if (!Exit.isSuccess(exit)) return null;
      const result = applyBankPaymentOfferReceipt(
        stateRef.current,
        peer,
        exit.value,
      );
      update(result.state);
      return result.offer;
    },
    [sendBankOffer, update],
  );

  const resolveOffer = React.useCallback(
    (message: LocalNostrMessage): BankPaymentOffer | null => {
      const offerId = decodeBankPaymentOffer(message.content)?.offerId;
      const peer = pubkeyFor(message.contactId);
      return offerId && peer
        ? findBankPaymentOffer(stateRef.current.offers, peer, offerId)
        : null;
    },
    [pubkeyFor],
  );

  const respondToOffer = React.useCallback(
    async (
      offer: BankPaymentOffer,
      nextStatus: BankOfferStatus,
      options?: BankPaymentOfferResponseOptions,
    ): Promise<boolean> => {
      const draft = myPubHex
        ? bankPaymentOfferResponseDraft(offer, nextStatus, myPubHex, options)
        : null;
      if (!draft) {
        setStatus(t(myPubHex ? "spdPaymentOfferFailed" : "profileMissingNpub"));
        return false;
      }
      try {
        if (await publish(offer.peer, draft)) return true;
        setStatus(t("spdPaymentOfferFailed"));
      } catch (error) {
        setStatus(
          `${t("errorPrefix")}: ${getUnknownErrorMessage(error, "publish failed")}`,
        );
      }
      return false;
    },
    [myPubHex, publish, setStatus, t],
  );

  // UI rows only name the thread; every field comes from the authenticated state.
  const respondToBankPaymentOffer = React.useCallback(
    async (
      message: LocalNostrMessage,
      nextStatus: BankOfferStatus,
      options?: BankPaymentOfferResponseOptions,
    ): Promise<boolean> => {
      const offer = resolveOffer(message);
      if (offer) return respondToOffer(offer, nextStatus, options);
      setStatus(t("spdPaymentOfferFailed"));
      return false;
    },
    [resolveOffer, respondToOffer, setStatus, t],
  );

  const respondToBankPaymentOfferWithGroupState = React.useCallback(
    async (
      message: LocalNostrMessage,
      nextStatus: BankOfferStatus,
      options?: BankPaymentOfferResponseOptions,
    ): Promise<boolean> => {
      if (nextStatus !== "canceled" && nextStatus !== "settled") {
        return respondToBankPaymentOffer(message, nextStatus, options);
      }
      const offer = resolveOffer(message);
      if (!offer) {
        setStatus(t("spdPaymentOfferFailed"));
        return false;
      }
      const { alreadyDone, targets } = bankPaymentOfferGroupResponses(
        stateRef.current.offers,
        offer.offerId,
        nextStatus,
      );
      let sentAny = alreadyDone;
      for (const target of targets) {
        const sent = await respondToOffer(target.offer, nextStatus, {
          ...(options?.spdPayload === undefined
            ? {}
            : { spdPayload: options.spdPayload }),
          withPush: target.withPush,
        });
        sentAny = sentAny || sent;
      }
      return sentAny;
    },
    [resolveOffer, respondToBankPaymentOffer, respondToOffer, setStatus, t],
  );

  const getBankPaymentOfferForSettlement = React.useCallback(
    (message: LocalNostrMessage): BankPaymentOffer | null => {
      const offer = resolveOffer(message);
      return offer &&
        myPubHex &&
        offer.offererPublicKey === myPubHex &&
        offer.status === "bank_paid"
        ? offer
        : null;
    },
    [myPubHex, resolveOffer],
  );

  const sendOffered = React.useCallback(
    async (args: {
      amountSat: number | null;
      amountText: string;
      expiresAtSec?: number;
      offerId: BankOfferId;
      offerer: Pubkey;
      to: Pubkey;
    }): Promise<BankPaymentOffer | null> => {
      const draft = bankPaymentOfferedDraft(args);
      return draft ? publish(args.to, draft) : null;
    },
    [publish],
  );

  const [staggerTick, setStaggerTick] = useState(0);

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
      const delaySec = clampBankPaymentOfferStaggerDelaySec(
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
      if (!myPubHex) {
        setStatus(t("profileMissingNpub"));
        return null;
      }

      try {
        const recipients = args.contacts.flatMap((contact) => {
          const contactId = (contact.id ?? "").trim();
          const peer = contactId ? pubkeyFor(contactId) : null;
          return contactId && peer ? [{ contactId, peer }] : [];
        });
        if (recipients.length === 0) {
          setStatus(t("chatMissingContactNpub"));
          return null;
        }

        const offerId = BankOfferId.make(makeLocalId());
        if (spdPayload) {
          // Persisted so the offer survives an app reload: the auto-responder
          // needs this payload when a recipient's acceptance arrives later.
          rememberBankPaymentOfferSpdPayload({
            offerId,
            ownerPubkey: myPubHex,
            spdPayload,
          });
        }

        let first: { contactId: string; sentAtSec: number } | null = null;
        const queued: Pubkey[] = [];
        for (const recipient of recipients) {
          // With a stagger delay only the first reachable recipient gets the
          // offer now; the rest wait in the persisted queue.
          if (delaySec > 0 && first) {
            queued.push(recipient.peer);
            continue;
          }
          const sent = await sendOffered({
            amountSat,
            amountText,
            offerId,
            offerer: myPubHex,
            to: recipient.peer,
          });
          if (sent && !first) {
            first = {
              contactId: recipient.contactId,
              sentAtSec: sent.createdAtSec,
            };
          }
        }
        if (!first) {
          setStatus(t("spdPaymentOfferFailed"));
          return null;
        }

        const queue = bankPaymentOfferStaggerQueue({
          amountSat,
          amountText,
          delaySec,
          firstSentAtSec: first.sentAtSec,
          offerId,
          ownerPubkey: myPubHex,
          peers: queued,
        });
        if (queue) {
          rememberBankPaymentOfferStaggerQueue(queue);
          setStaggerTick((tick) => tick + 1);
        }

        setRecipientCountState(
          clampBankPaymentOfferRecipientCount(args.contacts.length),
        );
        setStaggerDelaySecState(delaySec);
        return { chatId: first.contactId, offerId };
      } catch (error) {
        setStatus(
          `${t("errorPrefix")}: ${getUnknownErrorMessage(error, "publish failed")}`,
        );
        return null;
      }
    },
    [myPubHex, pubkeyFor, sendOffered, setStatus, t],
  );

  // The offerer's auto-responder: bank details go to exactly one winner,
  // guarded by a per-offer lease lock across tabs, and everyone else who is
  // still offered or accepted learns that someone else won.
  React.useEffect(() => {
    if (!myPubHex || offers.length === 0) return;

    let cancelled = false;
    let retryTimeoutId: number | undefined;

    const run = async () => {
      try {
        for (const step of bankPaymentOfferResponderSteps(offers, myPubHex)) {
          if (cancelled) return;
          if (step.ended) {
            forgetBankPaymentOfferSpdPayload(step.offerId);
            continue;
          }
          const lockKey = `${BANK_PAYMENT_OFFER_DETAILS_LOCK_KEY_PREFIX}.${step.offerId}`;
          const closeLosers = async () => {
            for (const loser of step.losers) {
              await respondToOffer(loser, "accepted_by_other");
            }
          };
          if (step.winner) {
            try {
              await withLocalStorageLeaseLock({
                key: lockKey,
                timeoutMs: 0,
                fn: closeLosers,
              });
            } catch {
              // Another tab is already closing the non-winning candidates.
            }
            continue;
          }
          const candidate = step.candidate;
          if (!candidate) continue;
          const record = readBankPaymentOfferSpdRecord({
            offerId: step.offerId,
            ownerPubkey: myPubHex,
          });
          // Any recorded send blocks the offer: a per-candidate check would
          // let a tab with a lagging view send the details to a second recipient.
          if (!record || record.sentCandidateKeys.length > 0) continue;

          try {
            await withLocalStorageLeaseLock({
              key: lockKey,
              timeoutMs: 0,
              fn: async () => {
                // Re-read under the lock: another tab may have just sent.
                const locked = readBankPaymentOfferSpdRecord({
                  offerId: step.offerId,
                  ownerPubkey: myPubHex,
                });
                if (!locked || locked.sentCandidateKeys.length > 0) return;
                const sent = await respondToOffer(
                  candidate,
                  "bank_details_sent",
                  {
                    spdPayload: locked.spdPayload,
                  },
                );
                // Marked only after a successful publish so an interrupted
                // send retries; the lease lock covers the concurrent window.
                if (!sent) return;
                markBankPaymentOfferBankDetailsSent({
                  candidateKey: `${step.offerId}:${candidate.peer}`,
                  offerId: step.offerId,
                });
                await closeLosers();
              },
            });
          } catch {
            // Another tab holds the send lock for this offer; let it finish.
          }
        }

        if (cancelled) return;
        // A failed publish or a skipped lease lock leaves the state unchanged,
        // so nothing re-runs this effect; keep retrying while an accepted
        // entry of my own offer is still waiting for bank details.
        if (
          hasPendingBankPaymentOfferResponderWork(
            offers,
            myPubHex,
            nowSeconds(),
          )
        ) {
          retryTimeoutId = window.setTimeout(
            () => void run(),
            RESPONDER_RETRY_MS,
          );
        }
      } catch {
        // Best effort; the sender can retry when the accepted event reappears.
      }
    };

    void run();
    return () => {
      cancelled = true;
      window.clearTimeout(retryTimeoutId);
    };
  }, [myPubHex, offers, respondToOffer]);

  // Staggered offers: queued recipients (persisted by requestBankPaymentOffer)
  // receive the offer once their delay elapses, unless the offer meanwhile
  // found a winner or ended.
  React.useEffect(() => {
    if (!myPubHex) return;
    const records = readBankPaymentOfferStaggerRecords(myPubHex);
    if (records.length === 0) return;

    let cancelled = false;
    let timeoutId: number | undefined;
    const bumpTick = () => setStaggerTick((tick) => tick + 1);
    const nowSec = nowSeconds();
    const dueRecords: typeof records = [];
    let nextDueAtSec: number | null = null;

    for (const record of records) {
      if (!isBankPaymentOfferStaggerQueueOpen(record, offers)) {
        forgetBankPaymentOfferStaggerQueue(record.offerId);
        if (getInspectorEmissionEnabled()) {
          reportInspectorRows([
            {
              at: Date.now(),
              channel: "nostr.operation",
              tag: "bankOffer.staggerDropped",
              summary: `proxy payment offer is no longer open — dropped ${record.pending.length} queued recipients`,
              links: {
                offer: record.offerId,
                pubkey: record.pending.map((recipient) => recipient.peer),
              },
              payload: { offerId: record.offerId },
            },
          ]);
        }
        continue;
      }
      const due = bankPaymentOfferStaggerDue(record, offers, nowSec);
      if (due.send.length > 0 || due.alreadyOffered.length > 0) {
        dueRecords.push(record);
      } else if (due.nextDueAtSec !== null) {
        nextDueAtSec =
          nextDueAtSec === null
            ? due.nextDueAtSec
            : Math.min(nextDueAtSec, due.nextDueAtSec);
      }
    }

    const dispatchDue = async () => {
      let progressed = false;
      for (const record of dueRecords) {
        if (cancelled) return;
        try {
          await withLocalStorageLeaseLock({
            key: `${BANK_PAYMENT_OFFER_STAGGER_LOCK_KEY_PREFIX}.${record.offerId}`,
            timeoutMs: 0,
            fn: async () => {
              // Re-read under the lock: another tab may have just sent.
              const locked = readBankPaymentOfferStaggerRecords(myPubHex).find(
                (candidate) => candidate.offerId === record.offerId,
              );
              if (!locked) {
                progressed = true;
                return;
              }
              const due = bankPaymentOfferStaggerDue(
                locked,
                offers,
                nowSeconds(),
              );
              const dequeue = [...due.alreadyOffered];
              for (const peer of due.send) {
                if (cancelled) return;
                const sent = await sendOffered({
                  amountSat: locked.amountSat,
                  amountText: locked.amountText,
                  expiresAtSec: locked.expiresAtSec,
                  offerId: locked.offerId,
                  offerer: myPubHex,
                  to: peer,
                });
                if (!sent) continue;
                dequeue.push(peer);
                if (getInspectorEmissionEnabled()) {
                  reportInspectorRows([
                    {
                      at: Date.now(),
                      channel: "nostr.operation",
                      tag: "bankOffer.staggerExtended",
                      summary:
                        "proxy payment offer extended to the next queued recipient",
                      links: { offer: locked.offerId, pubkey: peer },
                      payload: {
                        offerId: locked.offerId,
                        sentAtSec: sent.createdAtSec,
                      },
                    },
                  ]);
                }
              }
              if (dequeue.length > 0) {
                removeBankPaymentOfferStaggerRecipients(
                  record.offerId,
                  dequeue,
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
      // Successful sends re-run this effect through the state update; the tick
      // covers dequeues that left the state untouched, and a failed publish
      // changes nothing at all, so it needs a nudge.
      if (progressed) bumpTick();
      else timeoutId = window.setTimeout(bumpTick, STAGGER_RETRY_MS);
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
      window.clearTimeout(timeoutId);
    };
  }, [myPubHex, offers, sendOffered, staggerTick]);

  const expiryGroups = React.useMemo(
    () =>
      myPubHex
        ? ownBankPaymentOfferExpiries(offers, myPubHex, nowSeconds())
        : [],
    [myPubHex, offers],
  );
  const expiryInFlightRef = React.useRef(false);

  React.useEffect(() => {
    const nextExpiryAtSec = Math.min(
      ...expiryGroups.map((group) => group.expiresAtSec),
    );
    if (!Number.isFinite(nextExpiryAtSec)) return;

    let cancelled = false;
    let timeoutId = 0;
    const expireDueGroups = () => {
      if (cancelled) return;
      if (expiryInFlightRef.current) {
        timeoutId = window.setTimeout(expireDueGroups, 100);
        return;
      }
      expiryInFlightRef.current = true;
      void (async () => {
        try {
          const nowSec = nowSeconds();
          for (const group of expiryGroups) {
            if (group.expiresAtSec > nowSec) continue;
            for (const offer of group.offers) {
              if (cancelled) return;
              await respondToOffer(offer, "canceled");
            }
          }
        } finally {
          expiryInFlightRef.current = false;
        }
      })();
    };
    timeoutId = window.setTimeout(
      expireDueGroups,
      Math.max(0, nextExpiryAtSec * 1000 - Date.now()),
    );
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [expiryGroups, respondToOffer]);

  const bankPaymentOfferMessages = React.useMemo(
    () =>
      myPubHex
        ? offers
            .flatMap((offer) => {
              const contactId = contactIdFor(offer.peer);
              return contactId
                ? [bankPaymentOfferMessageRow(offer, contactId, myPubHex)]
                : [];
            })
            .sort(compareBankPaymentOfferRows)
        : [],
    [contactIdFor, myPubHex, offers],
  );

  const chatMessagesWithBankPaymentOffers = React.useMemo(() => {
    if (route.kind !== "chat") return chatMessages;
    const activeContactId = route.id.trim();
    const offerMessages = bankPaymentOfferMessages.filter(
      (message) => message.contactId === activeContactId,
    );
    return offerMessages.length === 0
      ? chatMessages
      : mergeBankPaymentOffersIntoChatMessages(chatMessages, offerMessages);
  }, [bankPaymentOfferMessages, chatMessages, route]);

  const activeBankPaymentOfferContacts = React.useCallback(
    (nowSec: number) => {
      const active = activeBankPaymentOffers(offers, nowSec);
      const contactIds = new Set<string>();
      for (const peer of active.peers) {
        const contactId = contactIdFor(peer);
        if (contactId) contactIds.add(contactId);
      }
      return { contactIds, nextExpiryAtSec: active.nextExpiryAtSec };
    },
    [contactIdFor, offers],
  );

  const lastBankPaymentOfferResponseSecByContactId = React.useMemo(() => {
    const byContactId = new Map<string, number>();
    if (!myPubHex) return byContactId;
    for (const [peer, sec] of lastBankPaymentOfferResponseSecByPeer(
      offers,
      myPubHex,
    )) {
      const contactId = contactIdFor(peer);
      if (contactId) byContactId.set(contactId, sec);
    }
    return byContactId;
  }, [contactIdFor, myPubHex, offers]);

  return {
    activeBankPaymentOfferContacts,
    applyBankPaymentOfferSnapshot: applySnapshot,
    bankPaymentOfferMessages,
    bankPaymentOfferRecipientCount: recipientCount,
    bankPaymentOfferStaggerDelaySec: staggerDelaySec,
    chatMessagesWithBankPaymentOffers,
    getBankPaymentOfferForSettlement,
    isBankPaymentOfferCanceled: React.useCallback(
      (offerId: BankOfferId) => isBankPaymentOfferCanceled(offers, offerId),
      [offers],
    ),
    lastBankPaymentOfferResponseSecByContactId,
    requestBankPaymentOffer,
    respondToBankPaymentOfferWithGroupState,
  };
};
