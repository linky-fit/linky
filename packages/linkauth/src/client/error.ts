export type LinkauthErrorCode =
  /** `cancel()` or the abort signal ended the attempt. */
  | "cancelled"
  /** The signer did not connect, or did not reply, in time. */
  | "timeout"
  /** No relay accepted the subscription or the sign request. */
  | "relays-unreachable"
  /** The signer answered with an error or with a different event. */
  | "refused";

/** Why a relay login did not produce an assertion. Start a new attempt with a fresh nonce. */
export class LinkauthError extends Error {
  readonly code: LinkauthErrorCode;

  constructor(code: LinkauthErrorCode, message: string) {
    super(message);
    this.name = "LinkauthError";
    this.code = code;
  }
}
