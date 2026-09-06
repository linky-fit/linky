import { Schema } from "effect";
import React from "react";
import { JsonValue } from "../../types/json";
import { normalizeMintUrl } from "../../utils/mint";
import {
  isNpubCashDisabled,
  NPUB_CASH_SERVER_BASE_URL,
} from "../../utils/npubCashServer";
import { optimizeCaseInsensitiveQrPayload } from "../../utils/qrPayload";
import { asRecord } from "../../utils/validation";

interface UseProfileNpubCashEffectsParams {
  claimNpubCashOnce: () => Promise<void>;
  claimNpubCashOnceLatestRef: React.MutableRefObject<() => Promise<void>>;
  currentNpub: string | null;
  currentNsec: string | null;
  hasMintOverrideRef: React.MutableRefObject<boolean>;
  makeNip98AuthHeader: (url: string, method: "GET" | "POST") => Promise<string>;
  networkEnabled?: boolean;
  npubCashInfoInFlightRef: React.MutableRefObject<boolean>;
  npubCashInfoLoadedAtMsRef: React.MutableRefObject<number>;
  npubCashInfoLoadedForNpubRef: React.MutableRefObject<string | null>;
  routeKind: string;
  setDefaultMintUrl: React.Dispatch<React.SetStateAction<string | null>>;
  setDefaultMintUrlDraft: React.Dispatch<React.SetStateAction<string>>;
  setIsProfileEditing: React.Dispatch<React.SetStateAction<boolean>>;
  setMyProfileQr: React.Dispatch<React.SetStateAction<string | null>>;
}

export const useProfileNpubCashEffects = ({
  claimNpubCashOnce,
  claimNpubCashOnceLatestRef,
  currentNpub,
  currentNsec,
  hasMintOverrideRef,
  makeNip98AuthHeader,
  networkEnabled = true,
  npubCashInfoInFlightRef,
  npubCashInfoLoadedAtMsRef,
  npubCashInfoLoadedForNpubRef,
  routeKind,
  setDefaultMintUrl,
  setDefaultMintUrlDraft,
  setIsProfileEditing,
  setMyProfileQr,
}: UseProfileNpubCashEffectsParams) => {
  React.useEffect(() => {
    // Leave edit mode unless the dedicated edit route is active.
    if (routeKind !== "profileEdit") {
      setIsProfileEditing(false);
    }
  }, [routeKind, setIsProfileEditing]);

  const showProfileQr = routeKind === "profile";

  React.useEffect(() => {
    // Generate QR code for the current npub when profile QR is visible.
    if (!showProfileQr) {
      setMyProfileQr(null);
      return;
    }
    if (!currentNpub) {
      setMyProfileQr(null);
      return;
    }

    let cancelled = false;

    const run = async () => {
      try {
        const QRCode = await import("qrcode");
        const size = 240;
        const canvas = document.createElement("canvas");

        await QRCode.toCanvas(
          canvas,
          optimizeCaseInsensitiveQrPayload(currentNpub),
          {
            errorCorrectionLevel: "H",
            margin: 1,
            width: size,
            color: {
              dark: "#0f172a",
              light: "#ffffff",
            },
          },
        );

        const context = canvas.getContext("2d");
        if (!context) {
          throw new Error("Missing QR canvas context");
        }

        const cutoutSize = Math.round(size * 0.23);
        const cutoutRadius = cutoutSize / 2;
        const cutoutCenterX = size / 2;
        const cutoutCenterY = size / 2;

        context.save();
        context.fillStyle = "#ffffff";
        context.beginPath();
        context.arc(cutoutCenterX, cutoutCenterY, cutoutRadius, 0, Math.PI * 2);
        context.fill();
        context.restore();

        const url = canvas.toDataURL();
        if (cancelled) return;
        setMyProfileQr(url);
      } catch {
        if (cancelled) return;
        setMyProfileQr(null);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [showProfileQr, currentNpub, setMyProfileQr]);

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
        if (mintUrl && !hasMintOverrideRef.current) {
          const cleaned = normalizeMintUrl(mintUrl);
          if (cleaned) {
            setDefaultMintUrl(cleaned);
            setDefaultMintUrlDraft(cleaned);
          }
        }

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
    hasMintOverrideRef,
    makeNip98AuthHeader,
    networkEnabled,
    npubCashInfoInFlightRef,
    npubCashInfoLoadedAtMsRef,
    npubCashInfoLoadedForNpubRef,
    setDefaultMintUrl,
    setDefaultMintUrlDraft,
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
