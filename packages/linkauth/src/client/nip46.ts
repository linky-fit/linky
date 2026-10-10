import { SimplePool } from "nostr-tools/pool";
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
} from "nostr-tools/pure";
import type { Event, Filter } from "nostr-tools";
import { decrypt, encrypt, getConversationKey } from "nostr-tools/nip44";
import { bytesToHex } from "nostr-tools/utils";
import { normalizeAudience } from "../audience.js";
import { timingSafeEqual } from "../encoding.js";
import { isNonce } from "../nonce.js";
import { hasValidSignature } from "../signature.js";
import {
  authTemplate,
  LINKAUTH_PERMISSION,
  sameTemplate,
} from "../template.js";
import { isLinkauthAssertion, isRecord } from "../types.js";
import type { LinkauthAssertion } from "../types.js";
import { LinkauthError } from "./error.js";
import type { LinkauthErrorCode } from "./error.js";

/** NIP-46 request and response kind. */
const NOSTR_CONNECT_KIND = 24133;
/** The longest `ready` waits for relays to accept the subscription. */
const SUBSCRIBE_WAIT_MS = 5000;
const DEFAULT_CONNECT_TIMEOUT_MS = 5 * 60_000;
const DEFAULT_REPLY_TIMEOUT_MS = 60_000;

/**
 * The slice of nostr-tools' `SimplePool` the client uses. Pass your own
 * pool to share relay connections, or a fake in tests.
 */
export interface LinkauthRelayPool {
  subscribeMany(
    relays: string[],
    filter: Filter,
    params: {
      onevent: (event: Event) => void;
      /** Every relay either accepted the subscription or gave up on it. */
      oneose?: () => void;
      onclose?: (reasons: { url: string; reason: string }[]) => void;
    },
  ): { close: (reason?: string) => void };
  publish(relays: string[], event: Event): Promise<string>[];
}

export interface Nip46LoginOptions {
  /** Your site's origin; the assertion is bound to it, and the signer sees it as claimed by your page. */
  audience: string;
  /** From `createNonce`, stored by your server. */
  nonce: string;
  /** Claimed to the signer in `uri`, which cannot verify it. */
  name: string;
  /** Claimed next to `name` in `uri`; same caveat. */
  image?: string;
  /** Relays the signer answers on. */
  relays: readonly [string, ...string[]];
  /** How long to wait for the user to scan and approve; 5 minutes by default. */
  connectTimeoutMs?: number;
  /** How long the signer may take to answer the sign request; 60 s by default. */
  replyTimeoutMs?: number;
  /** Relay pool to use; a private nostr-tools `SimplePool` per login by default. */
  pool?: LinkauthRelayPool;
  /** Aborting it is the same as `cancel()`. */
  signal?: AbortSignal;
}

/** One NIP-46 login attempt over relays. */
export interface Nip46Login {
  /**
   * `nostrconnect://` link for Nostr signers, whose view of your site is the
   * unverified `name` and audience in the link. Carries the pairing secret:
   * keep it out of logs and requests.
   */
  uri: string;
  /**
   * Resolves once the relays are listening (at most 5 seconds), so a signer
   * that answers now is heard: show `uri` after it. Rejects with
   * `LinkauthError` when no relay opened or the attempt ended first.
   */
  ready: Promise<void>;
  /** Resolves with the signed login event when a signer answers, and rejects with `LinkauthError` otherwise. */
  assertion: Promise<LinkauthAssertion>;
  /** Ends the session; `assertion` rejects with code `cancelled`. Safe to call twice. */
  cancel: () => void;
}

interface Reply {
  id: string;
  result?: string;
  error?: string;
}

const parseReply = (plaintext: string): Reply | null => {
  try {
    const value: unknown = JSON.parse(plaintext);
    if (!isRecord(value)) return null;
    const { id, result, error } = value;
    if (typeof id !== "string") return null;
    return {
      id,
      ...(typeof result === "string" ? { result } : {}),
      ...(typeof error === "string" ? { error } : {}),
    };
  } catch {
    return null;
  }
};

/** The `nostrconnect://` link (NIP-46); it carries the pairing secret. */
const pairingUri = (
  clientPubkey: string,
  secret: string,
  link: {
    relays: readonly string[];
    name: string;
    audience: string;
    image: string | undefined;
  },
): string => {
  const params = new URLSearchParams();
  for (const relay of link.relays) params.append("relay", relay);
  params.set("secret", secret);
  params.set("perms", LINKAUTH_PERMISSION);
  params.set("name", link.name);
  params.set("url", link.audience);
  if (link.image !== undefined) params.set("image", link.image);
  return `nostrconnect://${clientPubkey}?${params.toString()}`;
};

const acquirePool = (
  given: LinkauthRelayPool | undefined,
): { pool: LinkauthRelayPool; release: () => void } => {
  if (given !== undefined) return { pool: given, release: () => undefined };
  const own = new SimplePool();
  return { pool: own, release: () => own.destroy() };
};

const nowSeconds = (): number => Math.floor(Date.now() / 1000);

/**
 * Starts a NIP-46 login for Nostr signers that do not know Linky, under a
 * throwaway client key: waits for the signer to answer with the pairing
 * secret, asks it to sign the login and resolves with the event once it is
 * validly signed and exactly that login. Opens relay subscriptions until it
 * ends, so call it only when the user asks for another signer. Throws
 * `TypeError` for invalid options.
 */
export const connectNip46 = (options: Nip46LoginOptions): Nip46Login => {
  const audience = normalizeAudience(options.audience);
  if (audience === null) throw new TypeError("linkauth: invalid audience");
  if (!isNonce(options.nonce)) throw new TypeError("linkauth: invalid nonce");
  const name = options.name.trim();
  if (name === "") throw new TypeError("linkauth: name is required");
  const relays = [...options.relays];
  const template = authTemplate({ audience, nonce: options.nonce });
  const { pool, release } = acquirePool(options.pool);
  const clientKey = generateSecretKey();
  const clientPubkey = getPublicKey(clientKey);
  const secret = bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
  let cancel = (): void => undefined;
  let markReady = (): void => undefined;
  let failReady: (error: LinkauthError) => void = () => undefined;
  const ready = new Promise<void>((resolve, reject) => {
    markReady = resolve;
    failReady = reject;
  });
  // A caller that cancels need not await this.
  ready.catch(() => undefined);

  const assertion = new Promise<LinkauthAssertion>((resolve, reject) => {
    let done = false;
    let signer: string | null = null;
    let requestId = "";
    let timer: ReturnType<typeof setTimeout> | undefined;
    let readyTimer: ReturnType<typeof setTimeout> | undefined;
    let subscription: { close: (reason?: string) => void } | undefined;

    const end = (settle: () => void): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearTimeout(readyTimer);
      options.signal?.removeEventListener("abort", cancel);
      subscription?.close("linkauth done");
      clientKey.fill(0);
      release();
      settle();
    };
    const fail = (code: LinkauthErrorCode, message: string): void => {
      const error = new LinkauthError(code, message);
      failReady(error);
      end(() => reject(error));
    };
    const arm = (
      ms: number,
      code: LinkauthErrorCode,
      message: string,
    ): void => {
      clearTimeout(timer);
      timer = setTimeout(() => fail(code, message), ms);
    };
    cancel = () => fail("cancelled", "login cancelled");

    const requestSignature = (remote: string): void => {
      requestId = bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
      const createdAt = nowSeconds();
      const request = finalizeEvent(
        {
          kind: NOSTR_CONNECT_KIND,
          created_at: createdAt,
          tags: [["p", remote]],
          content: encrypt(
            JSON.stringify({
              id: requestId,
              method: "sign_event",
              params: [JSON.stringify({ ...template, created_at: createdAt })],
            }),
            getConversationKey(clientKey, remote),
          ),
        },
        clientKey,
      );
      arm(
        options.replyTimeoutMs ?? DEFAULT_REPLY_TIMEOUT_MS,
        "timeout",
        "the signer did not reply in time",
      );
      Promise.any(pool.publish(relays, request)).catch(() =>
        fail("relays-unreachable", "no relay accepted the sign request"),
      );
    };

    const onSignature = (result: string): void => {
      let event: unknown;
      try {
        event = JSON.parse(result);
      } catch {
        event = null;
      }
      if (
        isLinkauthAssertion(event) &&
        hasValidSignature(event) &&
        sameTemplate(event, template)
      ) {
        end(() => resolve(event));
      } else {
        fail("refused", "the signer returned a different event");
      }
    };

    const onevent = (event: Event): void => {
      if (
        done ||
        event.kind !== NOSTR_CONNECT_KIND ||
        !hasValidSignature(event)
      )
        return;
      if (signer !== null && event.pubkey !== signer) return;
      let reply: Reply | null;
      try {
        reply = parseReply(
          decrypt(event.content, getConversationKey(clientKey, event.pubkey)),
        );
      } catch {
        return;
      }
      if (reply === null) return;
      if (signer === null) {
        if (
          reply.result === undefined ||
          !timingSafeEqual(reply.result, secret)
        ) {
          // No request id exists before the pairing, so a decline is an error without the secret.
          if (reply.error !== undefined) fail("refused", reply.error);
          return;
        }
        signer = event.pubkey;
        requestSignature(signer);
        return;
      }
      if (reply.id !== requestId) return;
      if (reply.result === undefined) {
        fail("refused", reply.error ?? "the signer refused");
      } else {
        onSignature(reply.result);
      }
    };

    if (options.signal?.aborted === true) return cancel();
    options.signal?.addEventListener("abort", cancel, { once: true });
    arm(
      options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
      "timeout",
      "the signer did not connect in time",
    );
    try {
      subscription = pool.subscribeMany(
        relays,
        {
          kinds: [NOSTR_CONNECT_KIND],
          "#p": [clientPubkey],
        },
        {
          onevent,
          // SimplePool reports eose before close when no relay opened; let the close fail `ready`.
          oneose: () =>
            queueMicrotask(() => {
              if (!done) markReady();
            }),
          onclose: () =>
            fail("relays-unreachable", "every relay closed the subscription"),
        },
      );
      if (!done) readyTimer = setTimeout(markReady, SUBSCRIBE_WAIT_MS);
    } catch {
      fail("relays-unreachable", "could not subscribe to the relays");
    }
  });
  // A caller that cancels need not await this.
  assertion.catch(() => undefined);
  return {
    uri: pairingUri(clientPubkey, secret, {
      relays,
      name,
      audience,
      image: options.image,
    }),
    ready,
    assertion,
    cancel: () => cancel(),
  };
};
