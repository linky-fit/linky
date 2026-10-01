export interface CashuMessagePaymentSendBatch {
  amount: number;
  mint: string;
  token: string;
  unit: string | null;
}

interface CashuMessagePaymentPublishError {
  clientId: string;
  error: string;
  token: string;
}

export interface CashuMessagePaymentPublishingOutcome {
  hasPendingMessages: boolean;
  paymentNoticeError: string | null;
  publishErrors: CashuMessagePaymentPublishError[];
  publishedTokenTexts: string[];
  unpublishedTokenTexts: string[];
}

export interface CashuMessagePaymentHookResult {
  error?: string;
  ok: boolean;
  queued: boolean;
  /** The attempt stopped before any token was created, so it can run again. */
  retryable?: true;
}
