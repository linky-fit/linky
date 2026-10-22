/** The service fee in sats, rounded up, which the user pays on top of `amount`. */
export const serviceFee = (amount: number, feeBasisPoints: number): number =>
  Math.ceil((amount * feeBasisPoints) / 10_000);

/** What the user sends to get `amount`: the transfer amount plus the service fee. */
export const amountWithServiceFee = (
  amount: number,
  feeBasisPoints: number,
): number => amount + serviceFee(amount, feeBasisPoints);
