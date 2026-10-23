import {
  decodeNpub,
  type AppMessageReceived,
  type Pubkey,
} from "@linky-fit/linkstr";
import {
  onchainTransferChannel,
  type OnchainTransferUpdate,
} from "@linky-fit/onchain-transfer";
import { Option } from "effect";
import { envOnchainOperatorNpub } from "../../platform/buildEnv";
import { normalizeNpubIdentifier } from "../../utils/nostrNpub";
import { paymentRequestIdOfPayment } from "./paymentRequestMessage";

export interface OnchainOperator {
  readonly npub: string;
  readonly pubkey: Pubkey;
}

const parseOnchainOperator = (
  value: string | undefined,
): OnchainOperator | null => {
  const npub = normalizeNpubIdentifier(value ?? "");
  const pubkey = npub ? decodeNpub(npub) : null;
  return npub && pubkey ? { npub, pubkey } : null;
};

/** The on-chain operator this build knows; null hides on-chain transfers. */
export const onchainOperator: OnchainOperator | null = parseOnchainOperator(
  envOnchainOperatorNpub,
);

/** The update an app message from the on-chain operator carries; null for anything else, from anyone else. */
export const operatorTransferUpdate = (
  event: AppMessageReceived,
  operator: Pubkey | null,
): OnchainTransferUpdate | null => {
  if (operator === null || event.from !== operator) return null;
  const message = onchainTransferChannel.decode(event);
  return Option.isSome(message) && message.value.type === "update"
    ? message.value
    : null;
};

/**
 * Whether chat content from or to the operator is the Cashu of an on-chain
 * transfer: every one travels as a NUT-18 payment, which the transfer shows
 * instead of the chat.
 */
export const isOnchainTransferPaymentContent = (content: string): boolean =>
  paymentRequestIdOfPayment(content) !== null;
