import type { TransactionId } from "@linky-fit/domain";
import type { Pubkey } from "@linky-fit/linkstr";
import type { CzechIban } from "./czechAccount";
import type { CzkAmount, Sats } from "./money";
import type { PaymentMethod, PaymentStatus } from "./payment";
import type { VariableSymbol } from "./variableSymbol";

/** The shop this account takes payments for. */
export interface ShopProfile {
  /** `null` until the merchant names the shop; payments then carry no recipient name. */
  readonly name: string | null;
  /** Without one the terminal offers Bitcoin only. */
  readonly iban: CzechIban | null;
  /** An https image URL; wallets show it as the shop's Nostr profile picture. */
  readonly picture: string | null;
}

/** A payment's Bitcoin leg: its price in sats, the Lightning quote and the Cashu request. */
export interface BitcoinLeg {
  readonly sats: Sats;
  readonly czkPerBtc: number;
  readonly mintUrl: string;
  /** The NUT-18 request; it stays payable after the Lightning quote expired. */
  readonly paymentRequest: string;
  /** `null` once the quote expired, so the payment screen asks for a fresh leg. */
  readonly quoteId: string | null;
  readonly invoice: string | null;
}

/** One amount the terminal asked a customer for. */
export interface Payment {
  readonly id: TransactionId;
  /** What the customer is charged, the tip included. */
  readonly amountCzk: CzkAmount;
  /** The tip within `amountCzk`; `null` without one. */
  readonly tipCzk: CzkAmount | null;
  readonly vs: VariableSymbol;
  readonly status: PaymentStatus;
  /** How it was paid; `null` while nobody paid it. */
  readonly method: PaymentMethod | null;
  readonly createdAtSec: number;
  readonly paidAtSec: number | null;
  readonly bitcoin: BitcoinLeg | null;
  /** The Cashu receive that paid it and the sats it put into the wallet, net of the mint's fee. */
  readonly cashuReceive: {
    readonly operationId: string;
    readonly sats: number;
  } | null;
  /** Who sent the Cashu token that paid it; `null` for other payments. */
  readonly payerPubkey: Pubkey | null;
  /** When the merchant hid it from the history; `null` while it shows. */
  readonly hiddenAtSec: number | null;
}

/**
 * Sats that reached the wallet outside a payment's own settlement: a token
 * that matched no payment, or a second payment of a paid one.
 */
export interface Receipt {
  readonly id: TransactionId;
  readonly method: "cashu" | "lightning";
  /** Net of the mint's input fee. */
  readonly sats: number;
  readonly receivedAtSec: number;
  readonly operationId: string;
  /** The payment the sats paid again; `null` when they matched none. */
  readonly paymentId: TransactionId | null;
}

/**
 * Sats someone sent the shop without a payment to pay, such as a Linky user
 * paying the shop from its chat: a token that matched no open request.
 */
export interface DirectTransfer {
  readonly id: TransactionId;
  /** Net of the mint's input fee. */
  readonly sats: number;
  /** The rate when the sats arrived; `null` when it was unavailable, which leaves the transfer without a CZK value. */
  readonly czkPerBtc: number | null;
  readonly receivedAtSec: number;
  readonly operationId: string;
  /** The mint the token came from; a direct transfer stays there. */
  readonly mintUrl: string;
  readonly payerPubkey: Pubkey;
  /** The sender's note, sanitized to plain text. */
  readonly note: string | null;
  /** When the merchant hid it from the history; `null` while it shows. */
  readonly hiddenAtSec: number | null;
}

/** Where a withdrawal sends the sats; the transaction `method` it is stored under. */
export type WithdrawalKind =
  | "lightning_invoice"
  | "lightning_address"
  | "cashu_chat";

export type WithdrawalStatus = "pending" | "done" | "failed";

/** Sats sent out of the wallet. */
export interface Withdrawal {
  readonly id: TransactionId;
  readonly kind: WithdrawalKind;
  readonly status: WithdrawalStatus;
  /** The invoice, Lightning address or npub as the merchant gave it. */
  readonly target: string;
  readonly amountSats: number;
  /** Every fee on top of `amountSats`; `null` while unknown. */
  readonly feeSats: number | null;
  readonly createdAtSec: number;
  readonly mintUrl: string;
  readonly quoteId: string | null;
  readonly invoice: string | null;
  /** The linkshu send holding a Linky withdrawal's token. */
  readonly operationId: string | null;
  readonly error: string | null;
}
