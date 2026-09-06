import { stripLightningPrefix } from "@linky/linkshu";
import {
  decodeFiatRates,
  fetchFiatRates as fetchSiteFiatRates,
  isFiatRatesStale as areSiteFiatRatesStale,
  FIAT_RATES_CACHE_STORAGE_KEY as fiatRatesStorageKey,
  FIAT_RATES_TTL_MS as fiatRatesTtlMs,
} from "@linky/linkshu";
import type { FiatRates as SiteFiatRates } from "@linky/linkshu";
import { copy } from "./copy";
import { GENERIC_MINT_ICON_DATA_URL, isLightningAddress } from "@linky/linkshu";
import {
  getErrorMessage,
  inspectToken,
  redeemToken,
  RedeemError,
} from "./wallet";
import type { TokenSnapshot } from "./wallet";
import type { FormEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  getInitialSiteDisplayCurrency,
  getInitialSiteLocale,
  siteDisplayCurrencies,
  siteDisplayCurrencyStorageKey,
  siteLocaleStorageKey,
  type SiteDisplayCurrency,
  type SiteLocale,
} from "../sitePreferences";
import { forwardCashuTokenPrivately } from "./paymentTelemetry";
import {
  flushPaymentTelemetryQueue,
  PAYMENT_ANALYTICS_RECIPIENT_NPUB,
  queuePaymentTelemetry,
} from "./paymentTelemetry";

interface TokenInspectionError {
  code: "invalid" | "unknown";
  detail: string | null;
}

interface RedeemSuccessState {
  lightningAddress: string;
}

type FiatDisplayCurrency = Exclude<SiteDisplayCurrency, "btc" | "sat">;

const satsPerBtc = 100_000_000;
const linkyWebAppUrl = "https://app.linky.fit";
const nativeLaunchFallbackDelayMs = 700;
const pwaLaunchFallbackDelayMs = 1600;

const fiatDisplay: Record<
  FiatDisplayCurrency,
  { label: string; rate: Exclude<keyof SiteFiatRates, "fetchedAtMs"> }
> = {
  chf: { label: "CHF", rate: "chfPerBtc" },
  czk: { label: "Kč", rate: "czkPerBtc" },
  eur: { label: "EUR", rate: "eurPerBtc" },
  usd: { label: "USD", rate: "usdPerBtc" },
};

const readStoredSiteFiatRates = (): SiteFiatRates | null => {
  try {
    return decodeFiatRates(localStorage.getItem(fiatRatesStorageKey));
  } catch {
    return null;
  }
};
const storeSiteFiatRates = (rates: SiteFiatRates) => {
  try {
    localStorage.setItem(fiatRatesStorageKey, JSON.stringify(rates));
  } catch {
    /* Cached rates are optional. */
  }
};

const normalizeLocale = (lang: SiteLocale): string => {
  if (lang === "cs") return "cs-CZ";
  if (lang === "de") return "de-DE";
  return "en-US";
};

const formatInteger = (value: number, lang: SiteLocale): string => {
  return new Intl.NumberFormat(normalizeLocale(lang)).format(
    Number.isFinite(value) ? Math.trunc(value) : 0,
  );
};

const formatCashuDisplayAmount = (
  amountSat: number,
  displayCurrency: SiteDisplayCurrency,
  fiatRates: SiteFiatRates | null,
  lang: SiteLocale,
): string => {
  const normalizedAmount = Number.isFinite(amountSat)
    ? Math.max(0, Math.trunc(amountSat))
    : 0;

  if (displayCurrency === "btc") {
    return `${formatInteger(normalizedAmount, lang)} ₿`;
  }

  if (displayCurrency !== "sat" && fiatRates) {
    const { label, rate } = fiatDisplay[displayCurrency];
    const fiatValue = Math.round(
      (normalizedAmount / satsPerBtc) * fiatRates[rate],
    );
    const approxPrefix = normalizedAmount > 0 ? "~" : "";
    return `${approxPrefix}${formatInteger(fiatValue, lang)} ${label}`;
  }

  return `${formatInteger(normalizedAmount, lang)} sat`;
};

const copyTextToClipboard = async (value: string): Promise<boolean> => {
  const trimmed = value.trim();
  if (!trimmed) return false;

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(trimmed);
      return true;
    } catch {
      // Fall through to the textarea fallback below.
    }
  }

  if (typeof document === "undefined") return false;

  const textarea = document.createElement("textarea");
  textarea.value = trimmed;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "absolute";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  textarea.style.left = "-9999px";
  document.body.append(textarea);
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);

  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
};

interface LinkyWalletImportTargets {
  browserUrl: string;
  nativeUrl: string;
  pwaUrl: string;
}

const buildLinkyWalletImportTargets = (
  token: string,
): LinkyWalletImportTargets | null => {
  const trimmed = token.trim();
  if (!trimmed) return null;
  const encodedToken = encodeURIComponent(trimmed);
  return {
    browserUrl: `${linkyWebAppUrl}/#wallet?cashu=${encodedToken}`,
    nativeUrl: `cashu://receive?token=${encodedToken}`,
    pwaUrl: `web+cashu://receive?token=${encodedToken}`,
  };
};

const openLinkyWalletImport = (token: string): void => {
  const targets = buildLinkyWalletImportTargets(token);
  if (!targets || typeof window === "undefined") return;

  let finished = false;
  const cleanupCallbacks: Array<() => void> = [];
  const timeoutIds: number[] = [];

  const cleanup = () => {
    while (timeoutIds.length > 0) {
      const timeoutId = timeoutIds.pop();
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }
    }

    while (cleanupCallbacks.length > 0) {
      const callback = cleanupCallbacks.pop();
      callback?.();
    }
  };

  const finish = () => {
    if (finished) return;
    finished = true;
    cleanup();
  };

  const isDocumentVisible = () =>
    typeof document === "undefined" || document.visibilityState === "visible";

  const tryNavigate = (url: string) => {
    if (finished || !isDocumentVisible()) {
      finish();
      return;
    }

    window.location.assign(url);
  };

  if (typeof document !== "undefined") {
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") {
        finish();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    cleanupCallbacks.push(() => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    });
  }

  const handlePageHide = () => {
    finish();
  };

  window.addEventListener("pagehide", handlePageHide);
  cleanupCallbacks.push(() => {
    window.removeEventListener("pagehide", handlePageHide);
  });

  timeoutIds.push(
    window.setTimeout(() => {
      tryNavigate(targets.pwaUrl);
    }, nativeLaunchFallbackDelayMs),
  );

  timeoutIds.push(
    window.setTimeout(() => {
      finish();
      window.location.assign(targets.browserUrl);
    }, pwaLaunchFallbackDelayMs),
  );

  tryNavigate(targets.nativeUrl);
};

const parseTokenFromSearch = (search: string): string | null => {
  if (!search.startsWith("?")) return null;

  const raw = search.slice(1).trim();
  if (!raw) return null;

  const searchParams = new URLSearchParams(raw);
  const namedToken =
    searchParams.get("token") ??
    searchParams.get("cashu") ??
    searchParams.get("cashutoken");
  const namedValue = (namedToken ?? "").trim();
  if (namedValue.startsWith("cashu")) {
    return namedValue;
  }

  if (raw.startsWith("cashu")) {
    return decodeURIComponent(raw);
  }

  return null;
};

const parseTokenFromHash = (hash: string): string | null => {
  if (!hash.startsWith("#")) return null;

  const raw = hash.slice(1).trim();
  if (!raw) return null;

  const decoded = decodeURIComponent(raw);
  if (decoded.startsWith("cashu")) {
    return decoded;
  }

  const params = new URLSearchParams(raw);
  const namedToken =
    params.get("token") ?? params.get("cashu") ?? params.get("cashutoken");
  const namedValue = (namedToken ?? "").trim();
  return namedValue.startsWith("cashu") ? namedValue : null;
};

const getTokenFromUrl = (): {
  source: "hash" | "search" | null;
  token: string;
} => {
  const hashToken = parseTokenFromHash(window.location.hash);
  if (hashToken) return { source: "hash", token: hashToken };

  const searchToken = parseTokenFromSearch(window.location.search);
  if (searchToken) return { source: "search", token: searchToken };

  return { source: null, token: "" };
};

const replaceHashToken = (token: string): void => {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = token ? encodeURIComponent(token) : "";
  window.history.replaceState(null, "", url.toString());
};
export function useCashuPage() {
  const [locale, setLocale] = useState<SiteLocale>(getInitialSiteLocale);
  const [displayCurrency, setDisplayCurrency] = useState<SiteDisplayCurrency>(
    getInitialSiteDisplayCurrency,
  );
  const [fiatRates, setFiatRates] = useState<SiteFiatRates | null>(() =>
    readStoredSiteFiatRates(),
  );
  const [tokenInput, setTokenInput] = useState("");
  const [activeToken, setActiveToken] = useState("");
  const [tokenState, setTokenState] = useState<TokenSnapshot | null>(null);
  const [tokenError, setTokenError] = useState<TokenInspectionError | null>(
    null,
  );
  const [lightningAddress, setLightningAddress] = useState("");
  const [redeemError, setRedeemError] = useState<string | null>(null);
  const [redeemSuccess, setRedeemSuccess] = useState<RedeemSuccessState | null>(
    null,
  );
  const [isInspecting, setIsInspecting] = useState(false);
  const [isRedeeming, setIsRedeeming] = useState(false);
  const [isAdditionalOptionsVisible, setIsAdditionalOptionsVisible] =
    useState(false);
  const [mintIconSrc, setMintIconSrc] = useState(GENERIC_MINT_ICON_DATA_URL);
  const [tokenQr, setTokenQr] = useState<string | null>(null);
  const redeemSubmitLockedRef = useRef(false);
  const activeCopy = useMemo(() => copy[locale], [locale]);
  const tokenErrorMessage =
    tokenError?.detail ??
    (tokenError?.code === "invalid"
      ? activeCopy.invalidToken
      : tokenError?.code === "unknown"
        ? activeCopy.validUnknown
        : null);
  const displayedTokenAmount = tokenState?.isValid
    ? (tokenState.amount ?? 0)
    : (tokenState?.totalAmount ?? 0);
  const displayedTokenAmountText = useMemo(
    () =>
      formatCashuDisplayAmount(
        displayedTokenAmount,
        displayCurrency,
        fiatRates,
        locale,
      ),
    [displayCurrency, displayedTokenAmount, fiatRates, locale],
  );
  const cycleDisplayCurrency = () => {
    const currentIndex = siteDisplayCurrencies.indexOf(displayCurrency);
    const nextIndex = (currentIndex + 1) % siteDisplayCurrencies.length;
    setDisplayCurrency(siteDisplayCurrencies[nextIndex] ?? "sat");
  };

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  useEffect(() => {
    window.localStorage.setItem(siteLocaleStorageKey, locale);
  }, [locale]);

  useEffect(() => {
    window.localStorage.setItem(siteDisplayCurrencyStorageKey, displayCurrency);
  }, [displayCurrency]);

  useEffect(() => {
    let cancelled = false;
    let activeController: AbortController | null = null;

    const syncRates = async () => {
      const cached = readStoredSiteFiatRates();
      if (!cancelled) setFiatRates(cached);
      if (!areSiteFiatRatesStale(cached)) return;

      const controller = new AbortController();
      activeController = controller;

      try {
        const next = await fetchSiteFiatRates(controller.signal);
        if (!next || cancelled) return;
        storeSiteFiatRates(next);
        setFiatRates(next);
      } catch {
        // Ignore exchange-rate fetch errors and keep last cached value.
      } finally {
        if (activeController === controller) {
          activeController = null;
        }
      }
    };

    void syncRates();
    const intervalId = window.setInterval(() => {
      void syncRates();
    }, fiatRatesTtlMs);

    return () => {
      cancelled = true;
      if (activeController) activeController.abort();
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    void flushPaymentTelemetryQueue();

    const handleOnline = () => {
      void flushPaymentTelemetryQueue();
    };

    const interval = window.setInterval(handleOnline, 30_000);
    window.addEventListener("online", handleOnline);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("online", handleOnline);
    };
  }, []);

  useEffect(() => {
    const syncFromUrl = () => {
      const next = getTokenFromUrl();
      setTokenInput(next.token);
      setActiveToken(next.token);
      setIsAdditionalOptionsVisible(false);
      setRedeemSuccess(null);
      setRedeemError(null);
      setTokenQr(null);
      redeemSubmitLockedRef.current = false;

      if (next.source === "search" && next.token) {
        replaceHashToken(next.token);
      }
    };

    syncFromUrl();
    window.addEventListener("hashchange", syncFromUrl);

    return () => {
      window.removeEventListener("hashchange", syncFromUrl);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const generateQr = async () => {
      if (!activeToken.trim() || !isAdditionalOptionsVisible) {
        setTokenQr(null);
        return;
      }

      try {
        const QRCode = await import("qrcode");
        const qr = await QRCode.toDataURL(activeToken, {
          errorCorrectionLevel: "M",
          margin: 1,
          width: 420,
        });

        if (!cancelled) {
          setTokenQr(qr);
        }
      } catch {
        if (!cancelled) {
          setTokenQr(null);
        }
      }
    };

    void generateQr();

    return () => {
      cancelled = true;
    };
  }, [activeToken, isAdditionalOptionsVisible]);

  useEffect(() => {
    const trimmedToken = activeToken.trim();
    if (!trimmedToken) {
      setTokenState(null);
      setTokenError(null);
      setMintIconSrc(GENERIC_MINT_ICON_DATA_URL);
      return;
    }

    let cancelled = false;

    setIsInspecting(true);
    setTokenError(null);

    void inspectToken(trimmedToken)
      .then((snapshot) => {
        if (cancelled) return;
        setTokenState(snapshot);
        setMintIconSrc(snapshot.iconUrl);
        if (!snapshot.isValid) {
          setTokenError({ code: "invalid", detail: null });
          return;
        }

        setTokenError(null);
      })
      .catch(() => {
        if (cancelled) return;
        setTokenState(null);
        setMintIconSrc(GENERIC_MINT_ICON_DATA_URL);
        setTokenError({
          code: "unknown",
          detail: null,
        });
      })
      .finally(() => {
        if (cancelled) return;
        setIsInspecting(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeToken]);

  const handleInspectSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedToken = tokenInput.trim();
    replaceHashToken(trimmedToken);
    setActiveToken(trimmedToken);
    setRedeemSuccess(null);
    setRedeemError(null);
    redeemSubmitLockedRef.current = false;
  };

  const handleRedeemSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (redeemSubmitLockedRef.current) {
      return;
    }

    const trimmedToken = activeToken.trim();
    const trimmedAddress = stripLightningPrefix(lightningAddress)
      .trim()
      .toLowerCase();
    if (!trimmedToken || !isLightningAddress(trimmedAddress)) return;

    setRedeemError(null);
    redeemSubmitLockedRef.current = true;
    setIsRedeeming(true);

    try {
      const result = await redeemToken(
        trimmedToken,
        trimmedAddress,
        activeCopy.redeemLnurlComment,
      );
      const nextToken = result.changeToken?.trim() ?? "";

      if (nextToken && result.changeAmount > 0) {
        try {
          await forwardCashuTokenPrivately({
            recipientNpub: PAYMENT_ANALYTICS_RECIPIENT_NPUB,
            token: nextToken,
          });
        } catch {
          redeemSubmitLockedRef.current = false;
          replaceHashToken(nextToken);
          setTokenInput(nextToken);
          setActiveToken(nextToken);
          return;
        }
      }

      queuePaymentTelemetry({
        amount: result.amountSent,
        direction: "out",
        fee: result.feePaid,
        method: "lightning_address",
        mint: result.mint,
        phase: "complete",
        status: "ok",
      });
      void flushPaymentTelemetryQueue();

      replaceHashToken("");
      setTokenInput("");
      setActiveToken("");
      setTokenState(null);
      setRedeemError(null);
      setRedeemSuccess({
        lightningAddress: result.lightningAddress,
      });
    } catch (error) {
      const phase = error instanceof RedeemError ? error.phase : "melt";
      const message = getErrorMessage(error, activeCopy.redeemFailed);
      setRedeemError(message);
      queuePaymentTelemetry({
        amount: tokenState?.amount ?? null,
        direction: "out",
        error: message,
        fee: null,
        method: "lightning_address",
        mint: tokenState?.mint ?? null,
        phase,
        status: "error",
      });
      void flushPaymentTelemetryQueue();
      redeemSubmitLockedRef.current = false;
    } finally {
      setIsRedeeming(false);
    }
  };

  const handleCopyToken = async () => {
    await copyTextToClipboard(activeToken);
  };

  const handleOpenInWallet = () => {
    openLinkyWalletImport(activeToken);
  };
  return {
    locale,
    setLocale,
    tokenInput,
    setTokenInput,
    activeToken,
    tokenState,
    lightningAddress,
    setLightningAddress,
    redeemError,
    setRedeemError,
    redeemSuccess,
    isInspecting,
    isRedeeming,
    isAdditionalOptionsVisible,
    setIsAdditionalOptionsVisible,
    mintIconSrc,
    setMintIconSrc,
    tokenQr,
    activeCopy,
    tokenErrorMessage,
    displayedTokenAmountText,
    cycleDisplayCurrency,
    handleInspectSubmit,
    handleRedeemSubmit,
    handleCopyToken,
    handleOpenInWallet,
  };
}
