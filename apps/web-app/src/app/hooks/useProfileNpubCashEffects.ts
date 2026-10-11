import { Schema } from "effect";
import React from "react";
import { JsonValue } from "../../types/json";
import {
  isNpubCashDisabled,
  NPUB_CASH_SERVER_BASE_URL,
} from "../../utils/npubCashServer";
import { asRecord } from "../../utils/validation";

interface UseProfileNpubCashEffectsParams {
  claimNpubCashOnce: () => Promise<void>;
  claimNpubCashOnceLatestRef: React.MutableRefObject<() => Promise<void>>;
  currentNpub: string | null;
  currentNsec: string | null;
  makeNip98AuthHeader: (url: string, method: "GET" | "POST") => Promise<string>;
  networkEnabled?: boolean;
  npubCashInfoInFlightRef: React.MutableRefObject<boolean>;
  npubCashInfoLoadedAtMsRef: React.MutableRefObject<number>;
  npubCashInfoLoadedForNpubRef: React.MutableRefObject<string | null>;
  routeKind: string;
  /** Offers npub.cash's mint as the default while the user chose none. */
  suggestDefaultMint: (mint: string) => void;
  setIsProfileEditing: React.Dispatch<React.SetStateAction<boolean>>;
}

export const useProfileNpubCashEffects = ({
  claimNpubCashOnce,
  claimNpubCashOnceLatestRef,
  currentNpub,
  currentNsec,
  makeNip98AuthHeader,
  networkEnabled = true,
  npubCashInfoInFlightRef,
  npubCashInfoLoadedAtMsRef,
  npubCashInfoLoadedForNpubRef,
  routeKind,
  setIsProfileEditing,
  suggestDefaultMint,
}: UseProfileNpubCashEffectsParams) => {
  React.useEffect(() => {
    // Leave edit mode unless the dedicated edit route is active.
    if (routeKind !== "profileEdit") {
      setIsProfileEditing(false);
    }
  }, [routeKind, setIsProfileEditing]);

  React.useEffect(() => {
    // Hosted npub.cash-compatible integration:
    // - read default mint (preferred mint) for the user
    // - auto-claim pending payments and store them as Cashu tokens
    if (isNpubCashDisabled()) return;
    if (!networkEnabled) return;
    if (!currentNpub) return;
    if (!currentNsec) return;

    let cancelled = false;
    const infoController = new AbortController();

    const loadInfo = async () => {
      if (npubCashInfoInFlightRef.current) return;
      const nowMs = Date.now();
      if (
        npubCashInfoLoadedForNpubRef.current === currentNpub &&
        nowMs - npubCashInfoLoadedAtMsRef.current < 10 * 60_000
      ) {
        return;
      }

      npubCashInfoInFlightRef.current = true;
      try {
        const url = `${NPUB_CASH_SERVER_BASE_URL}/api/v1/info`;
        const auth = await makeNip98AuthHeader(url, "GET");
        const res = await fetch(url, {
          method: "GET",
          headers: { Authorization: auth },
          signal: infoController.signal,
        });
        if (!res.ok) return;
        const data = Schema.decodeUnknownSync(JsonValue)(await res.json());
        const mintUrl = (() => {
          const root = asRecord(data);
          if (!root) return "";

          const direct = String(root.mintUrl ?? "").trim();
          if (direct) return direct;

          const wrapped = asRecord(root.data);
          if (!wrapped) return "";
          return String(wrapped.mintUrl ?? wrapped.mintURL ?? "").trim();
        })();
        if (cancelled) return;
        if (mintUrl) suggestDefaultMint(mintUrl);

        npubCashInfoLoadedForNpubRef.current = currentNpub;
        npubCashInfoLoadedAtMsRef.current = Date.now();
      } catch {
        // ignore
      } finally {
        npubCashInfoInFlightRef.current = false;
      }
    };

    const claimOnce = async () => {
      if (cancelled) return;
      await claimNpubCashOnceLatestRef.current();
    };

    void loadInfo();
    void claimOnce();

    const intervalId = window.setInterval(() => {
      void claimOnce();
    }, 30_000);

    return () => {
      cancelled = true;
      infoController.abort();
      window.clearInterval(intervalId);
    };
  }, [
    claimNpubCashOnceLatestRef,
    currentNpub,
    currentNsec,
    makeNip98AuthHeader,
    networkEnabled,
    npubCashInfoInFlightRef,
    npubCashInfoLoadedAtMsRef,
    npubCashInfoLoadedForNpubRef,
    suggestDefaultMint,
  ]);

  React.useEffect(() => {
    // While user is looking at the top-up invoice, poll more frequently so we
    // detect the paid invoice quickly.
    if (!networkEnabled) return;
    if (routeKind !== "topupInvoice") return;

    void claimNpubCashOnce();
    const intervalId = window.setInterval(() => {
      void claimNpubCashOnce();
    }, 5_000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [claimNpubCashOnce, networkEnabled, routeKind]);
};
