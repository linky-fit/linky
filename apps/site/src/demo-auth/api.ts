import { Option, Schema } from "effect";
import type { LinkauthAssertion } from "@linky-fit/linkauth";

const Challenge = Schema.parseJson(Schema.Struct({ nonce: Schema.String }));
const Verified = Schema.parseJson(Schema.Struct({ pubkey: Schema.String }));
const PubkeyHex = Schema.String.pipe(Schema.pattern(/^[0-9a-f]{64}$/u));

// A demo has no server session: the verified key lives in this tab only.
const pubkeyStorageKey = "linky.demo_auth.pubkey";

/** The server has no receiving key (LINKY_DEMO_AUTH_SECRET_KEY). */
export class DemoNotConfiguredError extends Error {}

export const fetchNonce = async (signal: AbortSignal): Promise<string> => {
  const response = await fetch("/api/demo-auth/challenge", { signal });
  if (response.status === 503) throw new DemoNotConfiguredError();
  if (!response.ok) throw new Error(`Challenge failed: ${response.status}`);
  return Schema.decodeUnknownSync(Challenge)(await response.text()).nonce;
};

/** The verified public key (hex), or `null` when the server rejected the assertion. */
export const verifyAssertion = async (
  assertion: LinkauthAssertion,
): Promise<string | null> => {
  const response = await fetch("/api/demo-auth/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ assertion }),
  });
  if (!response.ok) return null;
  return Schema.decodeUnknownSync(Verified)(await response.text()).pubkey;
};

export type ReceiveResult =
  | { status: "pending" }
  | { status: "failed" }
  | { status: "done"; pubkey: string };

/** Asks the server whether the QR login arrived; a transport hiccup counts as not yet. */
export const receiveLogin = async (
  signal: AbortSignal,
): Promise<ReceiveResult> => {
  const response = await fetch("/api/demo-auth/receive", {
    method: "POST",
    signal,
  }).catch((error: unknown) => {
    if (signal.aborted) throw error;
    return null;
  });
  if (response?.status === 401) return { status: "failed" };
  if (response?.status !== 200) return { status: "pending" };
  const { pubkey } = Schema.decodeUnknownSync(Verified)(await response.text());
  return { status: "done", pubkey };
};

export const loadPubkey = (): string | null =>
  Option.getOrNull(
    Schema.decodeUnknownOption(PubkeyHex)(
      sessionStorage.getItem(pubkeyStorageKey),
    ),
  );

export const savePubkey = (pubkey: string): void =>
  sessionStorage.setItem(pubkeyStorageKey, pubkey);

export const clearPubkey = (): void =>
  sessionStorage.removeItem(pubkeyStorageKey);

// A same-device login can finish in another tab, which consumes the nonce cookie this tab polls with.
const loginChannelName = "linky.demo_auth.login";

/** Tells this origin's other tabs that a login finished, so they stop waiting for it. */
export const announceLogin = (pubkey: string): void => {
  const channel = new BroadcastChannel(loginChannelName);
  channel.postMessage(pubkey);
  channel.close();
};

/** Calls `listener` with the key of a login finished in another tab; returns the unsubscribe. */
export const onLoginElsewhere = (
  listener: (pubkey: string) => void,
): (() => void) => {
  const channel = new BroadcastChannel(loginChannelName);
  channel.onmessage = ({ data }: MessageEvent<unknown>) => {
    const pubkey = Schema.decodeUnknownOption(PubkeyHex)(data);
    if (Option.isSome(pubkey)) listener(pubkey.value);
  };
  return () => channel.close();
};
