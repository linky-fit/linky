import {
  verifyBoltCardTap,
  type BoltCard,
  type BoltCardTap,
  type BridgeCallback,
  type BridgeWithdraw,
  type CardMessage,
} from "@linky-fit/bolt-card";
import {
  getPayableLightningInvoice,
  type PayableLightningInvoice,
} from "@linky-fit/linkshu";

// Reasons travel to the POS as LNURL error text, so they stay fixed English.
export const BoltCardRejection = {
  alreadyPaying: "A payment from this card is already in progress",
  unknownTap: "Unknown card tap, tap the card again",
  invalidCard: "Invalid card data",
  insufficientBalance: "Insufficient balance",
  unknownK1: "Unknown withdraw request, tap the card again",
  invalidInvoice: "The invoice must carry a fixed amount",
  expiredInvoice: "The invoice has expired",
  overLimit: "The invoice exceeds the card limit",
} as const;

const MSAT_PER_SAT = 1_000;

/**
 * Mints reserve about 1 % (at least 2 sat) of a Lightning payment for routing
 * fees, so offering the whole spendable balance would let a POS ask for more
 * than a melt can cover.
 */
export const estimateMaxWithdrawableSat = (spendableSat: number): number => {
  if (!Number.isFinite(spendableSat) || spendableSat <= 0) return 0;
  const spendable = Math.floor(spendableSat);
  return Math.max(0, spendable - Math.max(2, Math.ceil(spendable * 0.01)));
};

interface Offer {
  readonly p: string;
  readonly k1: string;
  readonly maxWithdrawableSat: number;
}

export interface WithdrawAnswer {
  readonly reply: CardMessage;
  /** The tap's counter when the card data verified. */
  readonly counter: number | null;
}

export interface CallbackAnswer {
  readonly reply: CardMessage;
  /** Set only when the card took the invoice and must now pay it. */
  readonly invoice: PayableLightningInvoice | null;
}

/**
 * The card's side of one NFC session: it answers only taps it issued in this
 * session, each once, and takes at most one invoice.
 */
export class BoltCardTapSession {
  private readonly card: BoltCard;
  private readonly issued = new Map<string, number>();
  private readonly used = new Set<string>();
  private offer: Offer | null = null;
  private invoiceTaken = false;

  constructor(card: BoltCard) {
    this.card = card;
  }

  get hasInvoice(): boolean {
    return this.invoiceTaken;
  }

  issue(tap: BoltCardTap): void {
    this.issued.set(tap.p.toUpperCase(), tap.counter);
  }

  answerWithdraw(
    request: BridgeWithdraw,
    maxWithdrawableSat: number,
    k1: string,
  ): WithdrawAnswer {
    const reject = (reason: string, counter: number | null = null) => ({
      reply: { _tag: "rejected", id: request.id, reason } as const,
      counter,
    });
    if (this.invoiceTaken) return reject(BoltCardRejection.alreadyPaying);

    const p = request.p.toUpperCase();
    const issuedCounter = this.issued.get(p);
    if (issuedCounter === undefined)
      return reject(BoltCardRejection.unknownTap);
    const sun = verifyBoltCardTap(this.card, p, request.c);
    if (sun === null || sun.counter !== issuedCounter) {
      return reject(BoltCardRejection.invalidCard);
    }

    // A POS that repeats the request for the same read gets the same offer.
    const repeated = this.offer?.p === p ? this.offer : null;
    if (repeated === null && this.used.has(p)) {
      return reject(BoltCardRejection.unknownTap, sun.counter);
    }
    const offer = repeated ?? {
      p,
      k1,
      maxWithdrawableSat: Math.floor(maxWithdrawableSat),
    };
    if (offer.maxWithdrawableSat < 1) {
      return reject(BoltCardRejection.insufficientBalance, sun.counter);
    }

    this.used.add(p);
    this.offer = offer;
    return {
      reply: {
        _tag: "offer",
        id: request.id,
        k1: offer.k1,
        minWithdrawable: MSAT_PER_SAT,
        maxWithdrawable: offer.maxWithdrawableSat * MSAT_PER_SAT,
        defaultDescription: "Linky",
      },
      counter: sun.counter,
    };
  }

  answerCallback(request: BridgeCallback, nowSec: number): CallbackAnswer {
    const reject = (reason: string) => ({
      reply: { _tag: "rejected", id: request.id, reason } as const,
      invoice: null,
    });
    if (this.invoiceTaken) return reject(BoltCardRejection.alreadyPaying);
    if (
      this.offer === null ||
      this.offer.k1.toLowerCase() !== request.k1.toLowerCase()
    ) {
      return reject(BoltCardRejection.unknownK1);
    }

    const invoice = getPayableLightningInvoice(request.pr);
    if (invoice === null) return reject(BoltCardRejection.invalidInvoice);
    if (invoice.expiresAtSec <= nowSec) {
      return reject(BoltCardRejection.expiredInvoice);
    }
    if (invoice.amountSat > this.offer.maxWithdrawableSat) {
      return reject(BoltCardRejection.overLimit);
    }

    this.invoiceTaken = true;
    return { reply: { _tag: "accepted", id: request.id }, invoice };
  }
}
