import {
  clearCallback,
  connectNip46,
  LinkauthError,
  readCallback,
  type LinkauthAssertion,
} from "@linky-fit/linkauth/client";
import { useCallback, useEffect, useState } from "react";
import {
  announceLogin,
  clearPubkey,
  DemoNotConfiguredError,
  fetchNonce,
  loadPubkey,
  onLoginElsewhere,
  receiveLogin,
  savePubkey,
  verifyAssertion,
} from "./api";
import { relays } from "./config";

export type DemoAuthState =
  | { status: "starting" }
  | {
      status: "waiting";
      nonce: string;
      /** The NIP-46 link for other signers, once the relays listen. */
      uri: string | null;
      /** Opens the NIP-46 session; only the first call does anything. */
      connectOtherSigner: () => void;
    }
  | { status: "verifying" }
  | { status: "loggedIn"; pubkey: string }
  | { status: "notConfigured" | "denied" | "timeout" | "error" };

const RECEIVE_POLL_MS = 2000;
// The nonce cookie lives 300 s; stop earlier so expiry reads as a timeout.
const RECEIVE_DEADLINE_MS = 290_000;

// A poll can fail just before the tab that finished the login announces it.
const LOGIN_ELSEWHERE_GRACE_MS = 1000;

const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        resolve();
      },
      { once: true },
    );
  });

const verify = async (assertion: LinkauthAssertion): Promise<DemoAuthState> => {
  const pubkey = await verifyAssertion(assertion).catch(() => null);
  if (pubkey === null) return { status: "error" };
  savePubkey(pubkey);
  announceLogin(pubkey);
  return { status: "loggedIn", pubkey };
};

/**
 * What the signer sent back to this page load. Settled once at import so a
 * re-mounted component neither verifies the assertion twice nor loses it:
 * the nonce cookie is single use and the fragment is cleared right away.
 */
const returnedLogin = ((): Promise<DemoAuthState> | null => {
  const callback = readCallback(location.hash);
  if (callback === null) return null;
  clearCallback();
  if ("assertion" in callback) return verify(callback.assertion);
  return Promise.resolve({
    status: callback.error === "denied" ? "denied" : "error",
  });
})();

const initialState = (): DemoAuthState => {
  const pubkey = loadPubkey();
  if (pubkey !== null) return { status: "loggedIn", pubkey };
  return { status: returnedLogin ? "verifying" : "starting" };
};

export const useDemoAuth = () => {
  const [state, setState] = useState<DemoAuthState>(initialState);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (loadPubkey() !== null) return;
    const mounted = new AbortController();
    // Aborted when one channel (callback, QR poll, NIP-46) wins, and on unmount.
    const channels = new AbortController();
    const settle = (next: DemoAuthState) => {
      if (!mounted.signal.aborted) setState(next);
    };
    const win = (): boolean => {
      if (channels.signal.aborted) return false;
      channels.abort();
      return true;
    };
    const stopListening = onLoginElsewhere((pubkey) => {
      if (!win()) return;
      savePubkey(pubkey);
      settle({ status: "loggedIn", pubkey });
    });
    const cleanup = () => {
      stopListening();
      mounted.abort();
      channels.abort();
    };

    if (attempt === 0 && returnedLogin) {
      returnedLogin.then(settle);
      return cleanup;
    }

    const pollReceive = async () => {
      const deadline = Date.now() + RECEIVE_DEADLINE_MS;
      while (!channels.signal.aborted && Date.now() < deadline) {
        const result = await receiveLogin(channels.signal);
        if (result.status === "done" && win()) {
          savePubkey(result.pubkey);
          announceLogin(result.pubkey);
          return settle({ status: "loggedIn", pubkey: result.pubkey });
        }
        if (result.status === "failed") {
          await wait(LOGIN_ELSEWHERE_GRACE_MS, channels.signal);
          if (win()) settle({ status: "error" });
          return;
        }
        await wait(RECEIVE_POLL_MS, channels.signal);
      }
      if (win()) settle({ status: "timeout" });
    };

    const start = async () => {
      const audience = location.origin;
      const nonce = await fetchNonce(channels.signal);
      let otherSignerConnected = false;
      const connectOtherSigner = () => {
        if (otherSignerConnected || channels.signal.aborted) return;
        otherSignerConnected = true;
        const login = connectNip46({
          audience,
          nonce,
          name: "Linky login demo",
          relays,
          signal: channels.signal,
        });
        login.ready.then(
          () => {
            if (!channels.signal.aborted) settle(waiting(login.uri));
          },
          () => undefined,
        );
        login.assertion.then(
          async (assertion) => {
            if (!win()) return;
            settle({ status: "verifying" });
            settle(await verify(assertion));
          },
          // The QR poll covers timeouts and unreachable relays; only a refusal ends the attempt here.
          (error: unknown) => {
            if (
              error instanceof LinkauthError &&
              error.code === "refused" &&
              win()
            ) {
              settle({ status: "error" });
            }
          },
        );
      };
      const waiting = (uri: string | null): DemoAuthState => ({
        status: "waiting",
        nonce,
        uri,
        connectOtherSigner,
      });
      settle(waiting(null));
      await pollReceive();
    };
    start().catch((error: unknown) => {
      if (channels.signal.aborted) return;
      settle({
        status:
          error instanceof DemoNotConfiguredError ? "notConfigured" : "error",
      });
    });
    return cleanup;
  }, [attempt]);

  const restart = useCallback(() => {
    setState({ status: "starting" });
    setAttempt((current) => current + 1);
  }, []);

  const logOut = useCallback(() => {
    clearPubkey();
    restart();
  }, [restart]);

  return { state, retry: restart, logOut };
};
