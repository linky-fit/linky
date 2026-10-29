/** The service fee in sats, rounded up, which the user pays on top of `amount`. */
export const serviceFee = (amount: number, feeBasisPoints: number): number =>
  Math.ceil((amount * feeBasisPoints) / 10_000);

/** What the user sends to get `amount`: the transfer amount plus the service fee. */
export const amountWithServiceFee = (
  amount: number,
  feeBasisPoints: number,
): number => amount + serviceFee(amount, feeBasisPoints);

/** The most the user gets for `sent` sats with the service fee inside: the largest amount whose amount with the fee fits. */
export const amountFromSent = (
  sent: number,
  feeBasisPoints: number,
): number => {
  let amount = Math.max(
    0,
    Math.floor((sent * 10_000) / (10_000 + feeBasisPoints)),
  );
  while (amountWithServiceFee(amount + 1, feeBasisPoints) <= sent) amount += 1;
  while (amount > 0 && amountWithServiceFee(amount, feeBasisPoints) > sent)
    amount -= 1;
  return amount;
};

/** The terms of an on-chain receive of any amount, as its deposit set them. */
export interface DepositTerms {
  /** Sats the user gets. */
  readonly amount: number;
  readonly fee: number;
  /** The amount plus the fee: the deposit, or what the maximum takes of it. */
  readonly sendAmount: number;
}

/**
 * What a deposit of `received` sats buys on an on-chain receive of any amount:
 * the most the deposit pays for, up to the maximum, with the rest of the
 * deposit as the fee; capped at the maximum, the fee is the service fee and
 * whatever the deposit exceeds `sendAmount` by is the operator's to settle.
 * `null` while the deposit is short of the minimum with its fee.
 */
export const depositTerms = ({
  received,
  feeBasisPoints,
  minReceiveAmount,
  maxReceiveAmount,
}: {
  readonly received: number;
  readonly feeBasisPoints: number;
  readonly minReceiveAmount: number;
  readonly maxReceiveAmount: number;
}): DepositTerms | null => {
  if (received < amountWithServiceFee(minReceiveAmount, feeBasisPoints))
    return null;
  const uncapped = amountFromSent(received, feeBasisPoints);
  if (uncapped >= maxReceiveAmount) {
    const fee = serviceFee(maxReceiveAmount, feeBasisPoints);
    return {
      amount: maxReceiveAmount,
      fee,
      sendAmount: maxReceiveAmount + fee,
    };
  }
  return { amount: uncapped, fee: received - uncapped, sendAmount: received };
};
