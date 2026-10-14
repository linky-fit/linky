/**
 * A NUT-18 `post` transport target must use https: the payload carries
 * bearer proofs, and any observer of a plain-http request can redeem them.
 * `allowHttp` admits `http:` for local development.
 */
export const isAllowedPaymentRequestPostUrl = (
  url: string,
  options: { readonly allowHttp: boolean },
): boolean => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol === "https:") return true;
  return parsed.protocol === "http:" && options.allowHttp;
};

/** The NUT-18 payment payload a payer sends to a request's transport. */
export interface PaymentRequestPayload {
  /** The `id` of the request it pays. */
  readonly id?: string | null | undefined;
  readonly memo?: string | null | undefined;
  readonly mint: string;
  readonly unit: string;
  /** `SendReceipt.proofs`; they keep full keyset ids, which the payee needs. */
  readonly proofs: ReadonlyArray<{
    readonly id: string;
    readonly amount: number;
    readonly secret: string;
    readonly C: string;
  }>;
}

/**
 * The payload as the JSON text a transport carries: the `post` body, or the
 * content of the NIP-17 message a `nostr` transport delivers. An empty `id` or
 * `memo` is left out.
 */
export const encodePaymentRequestPayload = (
  payload: PaymentRequestPayload,
): string =>
  JSON.stringify({
    mint: payload.mint,
    unit: payload.unit,
    proofs: payload.proofs,
    ...(payload.id ? { id: payload.id } : {}),
    ...(payload.memo ? { memo: payload.memo } : {}),
  });

export interface PostPaymentRequestPayloadArgs {
  /** The `post` transport target (`PaymentRequestTransport.target`). */
  readonly url: string;
  readonly payload: PaymentRequestPayload;
  /** Admits an `http:` url; see `isAllowedPaymentRequestPostUrl`. */
  readonly allowHttp?: boolean;
  /** Defaults to the global `fetch`. */
  readonly fetch?: typeof globalThis.fetch;
}

export type PostPaymentRequestPayloadOutcome =
  | { readonly _tag: "Delivered" }
  /** The url does not parse or is not https; nothing was sent. */
  | { readonly _tag: "InsecureUrl" }
  /** The payee answered with a non-2xx status. */
  | { readonly _tag: "HttpError"; readonly status: number }
  /** The request did not complete (offline, DNS, CORS). */
  | { readonly _tag: "NetworkError"; readonly detail: string };

/**
 * POSTs the payment payload as JSON to a NUT-18 `post` transport. Resolves,
 * never rejects. Anything but `Delivered` may still have reached the payee,
 * so take the send back with `Tokens.returnToWallet`; on `Delivered` close
 * it with `Tokens.forget`.
 */
export const postPaymentRequestPayload = async ({
  url,
  payload,
  allowHttp = false,
  fetch: send = globalThis.fetch,
}: PostPaymentRequestPayloadArgs): Promise<PostPaymentRequestPayloadOutcome> => {
  if (!isAllowedPaymentRequestPostUrl(url, { allowHttp })) {
    return { _tag: "InsecureUrl" };
  }
  try {
    const response = await send(new URL(url).toString(), {
      method: "POST",
      cache: "no-store",
      credentials: "omit",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      mode: "cors",
      body: encodePaymentRequestPayload(payload),
    });
    return response.ok
      ? { _tag: "Delivered" }
      : { _tag: "HttpError", status: response.status };
  } catch (error) {
    return {
      _tag: "NetworkError",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
};
