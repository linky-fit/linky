import {
  BankOfferId,
  identityFromNsec,
  type BankOfferDraft,
  type BankOfferInboxEvent,
  type Pubkey,
} from "@linky-fit/linkstr";
import {
  RegistryContext,
  useAtomSet,
  useAtomValue,
  useLinkstrCommands,
} from "@linky-fit/linkstr-react";
import {
  activeBankPaymentOffers,
  applyBankPaymentOfferReceipt,
  applyBankPaymentOfferSnapshot,
  bankPaymentOfferDetailsRecipient,
  bankPaymentOfferedDraft,
  bankPaymentOfferGroupResponses,
  bankPaymentOffersOf,
  bankPaymentOfferResponderSteps,
  bankPaymentOfferResponseDraft,
  bankPaymentOfferStaggerDue,
  bankPaymentOfferStaggerQueue,
  clampBankPaymentOfferRecipientCount,
  clampBankPaymentOfferStaggerDelaySec,
  decodeBankPaymentOffer,
  emptyBankPaymentOfferState,
  findBankPaymentOffer,
  hasPendingBankPaymentOfferResponderWork,
  isBankPaymentOfferCanceled,
  isBankPaymentOfferStaggerQueueOpen,
  ownBankPaymentOfferExpiries,
  readBankPaymentOfferCurrency,
  recentBankPaymentOfferOutcomesByPeer,
  type AppliedBankPaymentOfferSnapshot,
  type BankPaymentOfferCurrency,
  type BankPaymentOfferOutcome,
  type BankOfferStatus,
  type BankPaymentOffer,
  type BankPaymentOfferResponseOptions,
  type BankPaymentOfferState,
} from "@linky-fit/proxy-payment";
import { Exit } from "effect";
import React from "react";
import { reportInspectorRows } from "../../devtools/inspector/reportInspectorRows";
import { getInspectorEmissionEnabled } from "../../devtools/inspector/inspectorEnabled";
import type { Translate } from "../../i18n";
import {
  canLockAcrossTabs,
  withLocalStorageLeaseLock,
} from "../../utils/storage";
import { nowSeconds } from "../../utils/time";
import { getUnknownErrorMessage } from "../../utils/unknown";
import { makeLocalId } from "../../utils/validation";
import {
  BANK_PAYMENT_OFFER_DETAILS_LOCK_KEY_PREFIX,
  BANK_PAYMENT_OFFER_STAGGER_LOCK_KEY_PREFIX,
  forgetBankPaymentOfferSpdPayloads,
  forgetBankPaymentOfferStaggerQueue,
  markBankPaymentOfferBankDetailsDelivered,
  readBankPaymentOfferIdsForSpdPayload,
  readBankPaymentOfferSpdRecord,
  readBankPaymentOfferStaggerRecords,
  rememberBankPaymentOfferSpdPayload,
  reserveBankPaymentOfferBankDetails,
  rememberBankPaymentOfferStaggerQueue,
  removeBankPaymentOfferStaggerRecipients,
} from "../lib/bankPaymentOfferStorage";
import {
  bankOfferCommandsAtom,
  bankOfferDefaultsAtom,
  bankPaymentOfferStateAtom,
  contactPubkeysAtom,
  type BankPaymentOfferRequest,
  type RequestedBankPaymentOffer,
} from "../state/messages/bankOffers";
import { currentPubkeyAtom } from "../state/session/session";
import { useProvideOwnerCommands } from "./shell/ownerCommands";
import type { LocalNostrMessage } from "../types/appTypes";

const RESPONDER_RETRY_MS = 30_000;
// Three dots say how a contact has been doing lately; more would be noise.
const RECENT_OFFER_OUTCOMES = 3;
const STAGGER_RETRY_MS = 5_000;

/**
 * Runs `pass` for `owner` one at a time: a kick during a pass runs it once
 * more right after it, instead of starting a second pass that would find
 * this tab's own lease locks taken. A pass resolves to the delay before it
 * should run again, or null.
 */
const useSerialPasses = <Owner>(
  owner: Owner | null,
  pass: (owner: Owner, isCancelled: () => boolean) => Promise<number | null>,
): (() => void) => {
  const passRef = React.useRef(pass);
  React.useEffect(() => {
    passRef.current = pass;
  });
  const kickRef = React.useRef<() => void>(() => {});
  React.useEffect(() => {
    if (owner === null) return;
    let cancelled = false;
    let running = false;
    let again = false;
    let timeoutId: number | undefined;
    const isCancelled = () => cancelled;
    const kick = () => {
      if (cancelled) return;
      if (running) {
        again = true;
        return;
      }
      running = true;
      clearTimeout(timeoutId);
      void (async () => {
        let delayMs: number | null = null;
        try {
          do {
            again = false;
            delayMs = await passRef.current(owner, isCancelled);
          } while (again && !cancelled);
        } finally {
          running = false;
        }
        if (!cancelled && delayMs !== null) {
          timeoutId = setTimeout(kick, delayMs);
        }
      })();
    };
    kickRef.current = kick;
    kick();
    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [owner]);
  return React.useCallback(() => kickRef.current(), []);
};

interface UseBankPaymentOffersParams {
  currentNsec: string | null;
  setStatus: React.Dispatch<React.SetStateAction<string | null>>;
  t: Translate;
}

export const useBankPaymentOffers = ({
  currentNsec,
  setStatus,
  t,
}: UseBankPaymentOffersParams) => {
  const { sendBankOffer } = useLinkstrCommands();
  const myPubHex = React.useMemo(
    () =>
      currentNsec ? (identityFromNsec(currentNsec)?.pubkey ?? null) : null,
    [currentNsec],
  );
  const { contactIdFor, pubkeyFor } = useAtomValue(contactPubkeysAtom);

  const setOfferDefaults = useAtomSet(bankOfferDefaultsAtom);

  // The inbox applies snapshots synchronously against the newest state, so
  // every write and every check reads the atom at call time.
  const registry = React.useContext(RegistryContext);
  const readState = React.useCallback(
    () => registry.get(bankPaymentOfferStateAtom),
    [registry],
  );
  const update = React.useCallback(
    (next: BankPaymentOfferState) =>
      registry.set(bankPaymentOfferStateAtom, next),
    [registry],
  );
  React.useEffect(() => {
    update(emptyBankPaymentOfferState);
  }, [myPubHex, update]);
  const offers = useAtomValue(
    bankPaymentOfferStateAtom,
    (state) => state.offers,
  );

  const applySnapshot = React.useCallback(
    (event: BankOfferInboxEvent): AppliedBankPaymentOfferSnapshot[] => {
      if (!myPubHex) return [];
      const current = readState();
      const result = applyBankPaymentOfferSnapshot(
        current,
        event,
        myPubHex,
        nowSeconds(),
      );
      if (result.state !== current) update(result.state);
      return [...result.accepted];
    },
    [myPubHex, readState, update],
  );

  const publish = React.useCallback(
    async (
      peer: Pubkey,
      draft: BankOfferDraft,
    ): Promise<BankPaymentOffer | null> => {
      const exit = await sendBankOffer(draft);
      if (!Exit.isSuccess(exit)) return null;
      const result = applyBankPaymentOfferReceipt(
        readState(),
        peer,
        exit.value,
      );
      update(result.state);
      return result.offer;
    },
    [readState, sendBankOffer, update],
  );

  const resolveOffer = React.useCallback(
    (message: LocalNostrMessage): BankPaymentOffer | null => {
      const offerId = decodeBankPaymentOffer(message.content)?.offerId;
      const peer = pubkeyFor(message.contactId);
      return offerId && peer
        ? findBankPaymentOffer(readState().offers, peer, offerId)
        : null;
    },
    [pubkeyFor, readState],
  );

  const respondToOffer = React.useCallback(
    async (
      offer: BankPaymentOffer,
      nextStatus: BankOfferStatus,
      options?: BankPaymentOfferResponseOptions,
    ): Promise<boolean> => {
      const draft = myPubHex
        ? bankPaymentOfferResponseDraft(
            offer,
            nextStatus,
            myPubHex,
            nowSeconds(),
            options,
          )
        : null;
      if (!draft) {
        setStatus(t(myPubHex ? "spdPaymentOfferFailed" : "profileMissingNpub"));
        return false;
      }
      try {
        if (nextStatus === "bank_details_sent") {
          const reserved = await reserveBankPaymentOfferBankDetails({
            offerId: offer.offerId,
            ownerPubkey: myPubHex ?? "",
            peer: offer.peer,
          });
          if (!reserved) {
            setStatus(t("spdPaymentOfferFailed"));
            return false;
          }
          if (getInspectorEmissionEnabled()) {
            reportInspectorRows([
              {
                at: Date.now(),
                channel: "nostr.operation",
                tag: "bankOffer.recipientPinned",
                summary:
                  "proxy payment bank details are pinned to one recipient",
                links: {
                  offer: offer.offerId,
                  pubkey: offer.peer,
                  client: draft.clientId ?? "",
                },
                payload: {
                  crossTabLock: canLockAcrossTabs(),
                  offerId: offer.offerId,
                  peer: offer.peer,
                },
              },
            ]);
          }
        }
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
        readState().offers,
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
    [
      readState,
      resolveOffer,
      respondToBankPaymentOffer,
      respondToOffer,
      setStatus,
      t,
    ],
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
      currency: BankPaymentOfferCurrency | null;
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

  // Staggered offers: queued recipients (persisted by requestBankPaymentOffer)
  // receive the offer once their delay elapses, unless the offer meanwhile
  // found a winner or ended.
  const kickStaggeredOffers = useSerialPasses(
    myPubHex,
    async (me, isCancelled): Promise<number | null> => {
      const records = readBankPaymentOfferStaggerRecords(me);
      if (records.length === 0) return null;

      const offers = readState().offers;
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

      if (dueRecords.length === 0) {
        return nextDueAtSec === null
          ? null
          : Math.max(0, nextDueAtSec * 1000 - Date.now());
      }

      let progressed = false;
      for (const record of dueRecords) {
        if (isCancelled()) return null;
        try {
          await withLocalStorageLeaseLock({
            key: `${BANK_PAYMENT_OFFER_STAGGER_LOCK_KEY_PREFIX}.${record.offerId}`,
            timeoutMs: 0,
            fn: async () => {
              // Re-read under the lock: another tab may have just sent.
              const locked = readBankPaymentOfferStaggerRecords(me).find(
                (candidate) => candidate.offerId === record.offerId,
              );
              if (!locked) {
                progressed = true;
                return;
              }
              const due = bankPaymentOfferStaggerDue(
                locked,
                readState().offers,
                nowSeconds(),
              );
              const dequeue = [...due.alreadyOffered];
              for (const peer of due.send) {
                if (isCancelled()) return;
                const sent = await sendOffered({
                  amountSat: locked.amountSat,
                  amountText: locked.amountText,
                  currency: locked.currency ?? null,
                  expiresAtSec: locked.expiresAtSec,
                  offerId: locked.offerId,
                  offerer: me,
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

      if (isCancelled()) return null;
      // A dequeue may leave the state untouched and a failed publish changes
      // nothing at all, so the next pass is scheduled here.
      return progressed ? 0 : STAGGER_RETRY_MS;
    },
  );

  // Each offer pins its own payer, so a second live offer for one bank QR
  // would hand the bank details to two payers.
  const findLiveOfferForSpdPayload = React.useCallback(
    async (spdPayload: string): Promise<RequestedBankPaymentOffer | null> => {
      if (!myPubHex || !spdPayload) return null;
      const offerIds = await readBankPaymentOfferIdsForSpdPayload({
        ownerPubkey: myPubHex,
        spdPayload,
      });
      const nowSec = nowSeconds();
      const staggerRecords = readBankPaymentOfferStaggerRecords(myPubHex);
      for (const offerId of offerIds) {
        const threads = bankPaymentOffersOf(readState().offers, offerId);
        const [livePeer] = activeBankPaymentOffers(threads, nowSec).peers;
        const hasQueuedPeers = staggerRecords.some(
          (record) =>
            record.offerId === offerId &&
            isBankPaymentOfferStaggerQueueOpen(record, threads),
        );
        const peer = livePeer ?? (hasQueuedPeers ? threads[0]?.peer : null);
        const chatId = peer ? contactIdFor(peer) : null;
        if (chatId) return { chatId, offerId };
      }
      return null;
    },
    [contactIdFor, myPubHex, readState],
  );

  const sendNewBankPaymentOffer = React.useCallback(
    async (
      args: BankPaymentOfferRequest,
      spdPayload: string,
    ): Promise<RequestedBankPaymentOffer | null> => {
      const amountSatRaw = Number(args.amountSat ?? 0);
      const amountSat =
        Number.isFinite(amountSatRaw) && amountSatRaw > 0
          ? Math.round(amountSatRaw)
          : null;
      const amountText = args.amountText.trim();
      const currency = readBankPaymentOfferCurrency(args.currency);
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
          await rememberBankPaymentOfferSpdPayload({
            offerId,
            ownerPubkey: myPubHex,
            singleTabRiskAccepted: args.singleTabRiskAccepted === true,
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
            currency,
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
          currency,
          delaySec,
          firstSentAtSec: first.sentAtSec,
          offerId,
          ownerPubkey: myPubHex,
          peers: queued,
        });
        if (queue) {
          rememberBankPaymentOfferStaggerQueue(queue);
          kickStaggeredOffers();
        }

        setOfferDefaults({
          recipientCount: clampBankPaymentOfferRecipientCount(
            args.contacts.length,
          ),
          staggerDelaySec: delaySec,
        });
        return { chatId: first.contactId, offerId };
      } catch (error) {
        setStatus(
          `${t("errorPrefix")}: ${getUnknownErrorMessage(error, "publish failed")}`,
        );
        return null;
      }
    },
    [
      kickStaggeredOffers,
      myPubHex,
      pubkeyFor,
      sendOffered,
      setStatus,
      t,
      setOfferDefaults,
    ],
  );

  const requestsInFlightRef = React.useRef(
    new Map<string, Promise<RequestedBankPaymentOffer | null>>(),
  );

  const openLiveOrSendNewBankPaymentOffer = React.useCallback(
    async (
      args: BankPaymentOfferRequest,
      spdPayload: string,
    ): Promise<RequestedBankPaymentOffer | null> => {
      const live = await findLiveOfferForSpdPayload(spdPayload);
      if (!live) return sendNewBankPaymentOffer(args, spdPayload);
      if (getInspectorEmissionEnabled()) {
        reportInspectorRows([
          {
            at: Date.now(),
            channel: "nostr.operation",
            tag: "bankOffer.liveOfferReopened",
            summary:
              "proxy payment for this bank QR is still live — opened it instead of offering it again",
            links: { offer: live.offerId },
            payload: { offerId: live.offerId },
          },
        ]);
      }
      return live;
    },
    [findLiveOfferForSpdPayload, sendNewBankPaymentOffer],
  );

  // A repeated tap while the request is in flight joins it.
  const requestBankPaymentOffer = React.useCallback(
    (
      args: BankPaymentOfferRequest,
    ): Promise<RequestedBankPaymentOffer | null> => {
      const spdPayload = String(args.spdPayload ?? "").trim();
      const inFlight = requestsInFlightRef.current.get(spdPayload);
      if (inFlight) return inFlight;

      const request = openLiveOrSendNewBankPaymentOffer(args, spdPayload)
        .catch((error: unknown) => {
          setStatus(
            `${t("errorPrefix")}: ${getUnknownErrorMessage(error, "storage failed")}`,
          );
          return null;
        })
        .finally(() => requestsInFlightRef.current.delete(spdPayload));
      requestsInFlightRef.current.set(spdPayload, request);
      return request;
    },
    [openLiveOrSendNewBankPaymentOffer, setStatus, t],
  );

  // The offerer's auto-responder: bank details go to exactly one payer, pinned
  // in storage that survives a crash before they leave, under a per-offer
  // lease lock across tabs; everyone else who is still offered or accepted
  // learns that someone else won.
  const kickResponder = useSerialPasses(
    myPubHex,
    async (me, isCancelled): Promise<number | null> => {
      if (readState().offers.length === 0) return null;

      const closeLosers = async (offerId: BankOfferId) => {
        const step = bankPaymentOfferResponderSteps(
          readState().offers,
          me,
        ).find((current) => current.offerId === offerId);
        for (const loser of step?.winner ? step.losers : []) {
          await respondToOffer(loser, "accepted_by_other");
        }
      };

      // Resolves true when a send failed and the pinned payer still waits.
      const sendBankDetails = async (
        offerId: BankOfferId,
      ): Promise<boolean> => {
        const record = await readBankPaymentOfferSpdRecord({
          offerId,
          ownerPubkey: me,
        });
        const step = bankPaymentOfferResponderSteps(
          readState().offers,
          me,
        ).find((current) => current.offerId === offerId);
        const recipient =
          record && step
            ? bankPaymentOfferDetailsRecipient(step, record.pin ?? null)
            : null;
        if (!record || !recipient) return false;
        const sent = await respondToOffer(recipient, "bank_details_sent", {
          spdPayload: record.spdPayload,
        });
        if (!sent) return true;
        await markBankPaymentOfferBankDetailsDelivered({
          offerId,
          peer: recipient.peer,
        });
        return false;
      };

      let owed = false;
      try {
        const steps = bankPaymentOfferResponderSteps(readState().offers, me);
        await forgetBankPaymentOfferSpdPayloads(
          steps.flatMap((step) => (step.ended ? [step.offerId] : [])),
        );
        for (const step of steps) {
          if (isCancelled()) return null;
          if (step.ended || (!step.winner && !step.candidate)) continue;
          try {
            await withLocalStorageLeaseLock({
              key: `${BANK_PAYMENT_OFFER_DETAILS_LOCK_KEY_PREFIX}.${step.offerId}`,
              timeoutMs: 0,
              fn: async () => {
                if (await sendBankDetails(step.offerId)) owed = true;
                await closeLosers(step.offerId);
              },
            });
          } catch {
            // Another tab holds the send lock for this offer, or storage failed.
          }
        }
      } catch {
        // Best effort; the next state change or retry runs it again.
      }

      if (isCancelled()) return null;
      // A failed publish or a skipped lease lock leaves the state unchanged,
      // so nothing kicks another pass; keep retrying while an accepted entry
      // of my own offer or a pinned payer still waits for bank details.
      return owed ||
        hasPendingBankPaymentOfferResponderWork(
          readState().offers,
          me,
          nowSeconds(),
        )
        ? RESPONDER_RETRY_MS
        : null;
    },
  );

  React.useEffect(() => {
    kickResponder();
    kickStaggeredOffers();
  }, [kickResponder, kickStaggeredOffers, offers]);

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
        timeoutId = setTimeout(expireDueGroups, 100);
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
    timeoutId = setTimeout(
      expireDueGroups,
      Math.max(0, nextExpiryAtSec * 1000 - Date.now()),
    );
    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [expiryGroups, respondToOffer]);

  useProvideOwnerCommands(bankOfferCommandsAtom, {
    requestBankPaymentOffer,
    respondToBankPaymentOffer: respondToBankPaymentOfferWithGroupState,
  });

  return {
    applyBankPaymentOfferSnapshot: applySnapshot,
    getBankPaymentOfferForSettlement,
    isBankPaymentOfferCanceled: React.useCallback(
      (offerId: BankOfferId) => isBankPaymentOfferCanceled(offers, offerId),
      [offers],
    ),
    requestBankPaymentOffer,
    respondToBankPaymentOfferWithGroupState,
  };
};

/** Which contacts have a live offer at `nowSec`, and when the next one expires. */
export const useActiveBankPaymentOfferContacts = () => {
  const offers = useAtomValue(
    bankPaymentOfferStateAtom,
    (state) => state.offers,
  );
  const { contactIdFor } = useAtomValue(contactPubkeysAtom);
  return React.useCallback(
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
};

/** How each contact's recent offers ended, oldest first. */
export const useRecentBankPaymentOfferOutcomes = () => {
  const offers = useAtomValue(
    bankPaymentOfferStateAtom,
    (state) => state.offers,
  );
  const { contactIdFor } = useAtomValue(contactPubkeysAtom);
  const myPubHex = useAtomValue(currentPubkeyAtom);
  return React.useMemo(() => {
    const byContactId = new Map<string, readonly BankPaymentOfferOutcome[]>();
    if (!myPubHex) return byContactId;
    for (const [peer, outcomes] of recentBankPaymentOfferOutcomesByPeer(
      offers,
      myPubHex,
      nowSeconds(),
      RECENT_OFFER_OUTCOMES,
    )) {
      const contactId = contactIdFor(peer);
      if (contactId) byContactId.set(contactId, outcomes);
    }
    return byContactId;
  }, [contactIdFor, myPubHex, offers]);
};

/** Proxy offer sends from any screen; the offer watchers run them. */
export const useBankOfferCommands = () => {
  const commands = useAtomValue(bankOfferCommandsAtom);
  return React.useMemo(
    () => ({
      requestBankPaymentOffer: async (request: BankPaymentOfferRequest) =>
        (await commands?.read().requestBankPaymentOffer(request)) ?? null,
      respondToBankPaymentOffer: async (
        message: LocalNostrMessage,
        nextStatus: BankOfferStatus,
        options?: BankPaymentOfferResponseOptions,
      ) =>
        (await commands
          ?.read()
          .respondToBankPaymentOffer(message, nextStatus, options)) ?? false,
    }),
    [commands],
  );
};
