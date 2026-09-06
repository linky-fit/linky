const FULL_BALANCE_PAYMENT_RETRY_FEE_RESERVES = [0, 1, 2, 3, 5, 8, 13, 21];

const getPositiveInteger = (value: string | undefined): number | null => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.trunc(parsed);
};

export const getPaymentAmountShortage = (
  errorMessage: string,
): number | null => {
  const normalizedMessage = errorMessage.trim();

  const providedNeededMatch = normalizedMessage.match(
    /provided:\s*(\d+)\s*,\s*needed:\s*(\d+)/i,
  );
  if (providedNeededMatch) {
    const provided = getPositiveInteger(providedNeededMatch[1]);
    const needed = getPositiveInteger(providedNeededMatch[2]);
    if (provided !== null && needed !== null && needed > provided) {
      return needed - provided;
    }
  }

  const needHaveMatch = normalizedMessage.match(
    /need\s*(\d+)\s*,\s*have\s*(\d+)/i,
  );
  if (needHaveMatch) {
    const needed = getPositiveInteger(needHaveMatch[1]);
    const have = getPositiveInteger(needHaveMatch[2]);
    if (needed !== null && have !== null && needed > have) {
      return needed - have;
    }
  }

  const feeMatch = normalizedMessage.match(/fee\s*:\s*(\d+)/i);
  if (feeMatch) {
    return getPositiveInteger(feeMatch[1]);
  }

  return null;
};

export const buildPaymentAmountAttempts = (
  requestedAmountSat: number,
  availableBalanceSat: number,
): number[] => {
  const normalizedRequestedAmount = Math.trunc(requestedAmountSat);
  const normalizedAvailableBalance = Math.trunc(availableBalanceSat);

  if (
    !Number.isFinite(normalizedRequestedAmount) ||
    normalizedRequestedAmount <= 0
  ) {
    return [];
  }

  if (normalizedRequestedAmount !== normalizedAvailableBalance) {
    return [normalizedRequestedAmount];
  }

  const attempts: number[] = [];
  for (const feeReserveSat of FULL_BALANCE_PAYMENT_RETRY_FEE_RESERVES) {
    const candidateAmount = normalizedRequestedAmount - feeReserveSat;
    if (candidateAmount <= 0 || attempts.includes(candidateAmount)) continue;
    attempts.push(candidateAmount);
  }

  return attempts;
};

export const isRetryablePaymentAmountFailure = (
  errorMessage: string,
): boolean => {
  const normalizedMessage = errorMessage.trim().toLowerCase();
  return (
    normalizedMessage.includes("insufficient funds") ||
    normalizedMessage.includes("not enough funds") ||
    normalizedMessage.includes("not enough balance") ||
    normalizedMessage.includes("amount out of lnurl range") ||
    normalizedMessage.includes("not enough inputs provided for melt")
  );
};

export const buildPaymentFailureAmountAttempts = (
  requestedAmountSat: number,
  errorMessage: string,
): number[] => {
  const normalizedRequestedAmount = Math.trunc(requestedAmountSat);
  if (
    !Number.isFinite(normalizedRequestedAmount) ||
    normalizedRequestedAmount <= 1 ||
    !isRetryablePaymentAmountFailure(errorMessage)
  ) {
    return [];
  }

  const attempts: number[] = [];
  const pushAttempt = (candidateAmountSat: number) => {
    const normalizedCandidate = Math.trunc(candidateAmountSat);
    if (
      !Number.isFinite(normalizedCandidate) ||
      normalizedCandidate <= 0 ||
      normalizedCandidate >= normalizedRequestedAmount ||
      attempts.includes(normalizedCandidate)
    ) {
      return;
    }
    attempts.push(normalizedCandidate);
  };

  const shortage = getPaymentAmountShortage(errorMessage);
  if (shortage !== null) {
    pushAttempt(normalizedRequestedAmount - shortage);
    pushAttempt(normalizedRequestedAmount - shortage - 1);
  }

  for (const feeReserveSat of FULL_BALANCE_PAYMENT_RETRY_FEE_RESERVES) {
    if (feeReserveSat <= 0) continue;
    pushAttempt(normalizedRequestedAmount - feeReserveSat);
  }

  return attempts;
};
