import { Copy } from "lucide-react";
import React from "react";
import { useAppShellCore } from "../app/context/AppShellContexts";
import { isCashuTokenIssuedState } from "../app/lib/cashuTokenState";
import { extractCashuTokenMeta } from "../app/lib/tokenText";
import type { CashuTokenId, CashuTokenRow } from "../evolu";
import { useLatest } from "../hooks/useLatest";
import { navigateTo } from "../hooks/useRouting";
import { ONBOARDING_GIFT_SAT } from "../utils/constants";
import { buildOnboardingUrl } from "../utils/onboardingLink";

interface OnboardPageProps {
  cashuTokensAll: readonly CashuTokenRow[];
  checkSingleIssuedCashuTokenIsClaimed: (id: CashuTokenId) => Promise<boolean>;
  copyText: (text: string) => Promise<void>;
  giftTokenId: CashuTokenId | null;
  showPaidOverlay: (title?: string) => void;
}

const GIFT_ROW_LOAD_GRACE_MS = 750;
const GIFT_CLAIM_POLL_MS = 10_000;

export function OnboardPage({
  cashuTokensAll,
  checkSingleIssuedCashuTokenIsClaimed,
  copyText,
  giftTokenId,
  showPaidOverlay,
}: OnboardPageProps): React.ReactElement | null {
  const { formatDisplayedAmountText, t } = useAppShellCore();
  const [qrDataUrl, setQrDataUrl] = React.useState<string | null>(null);

  const giftRow = giftTokenId
    ? cashuTokensAll.find((row) => row.id === giftTokenId && !row.isDeleted)
    : undefined;
  const giftTokenText = giftRow
    ? extractCashuTokenMeta(giftRow).tokenText || null
    : null;
  const waitingForGiftRow = giftTokenId !== null && !giftRow;
  const onboardingUrl = waitingForGiftRow
    ? null
    : buildOnboardingUrl(giftTokenText);

  // cashuTokensAll hydrates asynchronously, so a missing gift row right after
  // navigation is normal; only a row that stays missing means it was claimed
  // or deleted while the page was away.
  React.useEffect(() => {
    if (!waitingForGiftRow) return;
    const timeoutId = window.setTimeout(() => {
      navigateTo({ route: "profile" });
    }, GIFT_ROW_LOAD_GRACE_MS);
    return () => window.clearTimeout(timeoutId);
  }, [waitingForGiftRow]);

  const checkClaimedRef = useLatest(checkSingleIssuedCashuTokenIsClaimed);
  const giftIsIssued = isCashuTokenIssuedState(giftRow?.state);
  React.useEffect(() => {
    if (!giftTokenId || !giftIsIssued) return;

    let cancelled = false;
    let inFlight = false;
    const tick = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      try {
        const claimed = await checkClaimedRef.current(giftTokenId);
        if (claimed && !cancelled) {
          showPaidOverlay(t("onboardGiftClaimed"));
          navigateTo({ route: "profile" });
        }
      } finally {
        inFlight = false;
      }
    };
    void tick();
    const intervalId = window.setInterval(
      () => void tick(),
      GIFT_CLAIM_POLL_MS,
    );
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [checkClaimedRef, giftIsIssued, giftTokenId, showPaidOverlay, t]);

  React.useEffect(() => {
    if (!onboardingUrl) {
      setQrDataUrl(null);
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const QRCode = await import("qrcode");
        const options = { margin: 1, scale: 8, width: 512 };
        let nextQrDataUrl: string;
        try {
          nextQrDataUrl = await QRCode.toDataURL(onboardingUrl, {
            ...options,
            errorCorrectionLevel: "M",
          });
        } catch {
          nextQrDataUrl = await QRCode.toDataURL(onboardingUrl, {
            ...options,
            errorCorrectionLevel: "L",
          });
        }
        if (!cancelled) setQrDataUrl(nextQrDataUrl);
      } catch {
        if (!cancelled) setQrDataUrl(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [onboardingUrl]);

  if (!onboardingUrl) return null;

  const giftAmountText = formatDisplayedAmountText(ONBOARDING_GIFT_SAT);

  return (
    <section className="panel topup-invoice-panel">
      <div className="topup-invoice-head">
        <div className="topup-invoice-balance">
          <h3>{t("onboard")}</h3>
          <p className="muted">{t("onboardScanHint")}</p>
        </div>
      </div>

      <div className="topup-invoice-qr-shell">
        {qrDataUrl ? (
          <button
            type="button"
            className="topup-invoice-qr-button"
            onClick={() => void copyText(onboardingUrl)}
            title={t("copy")}
          >
            <img
              className="qr topup-invoice-qr"
              src={qrDataUrl}
              alt={t("onboard")}
            />
          </button>
        ) : (
          <p className="muted topup-invoice-loading">{t("loading")}</p>
        )}

        <p className="muted section-note">
          {giftTokenText
            ? t("onboardGiftIncluded").replace("{amount}", giftAmountText)
            : t("onboardGiftSkipped").replace("{amount}", giftAmountText)}
        </p>

        <button
          type="button"
          className="btn-wide secondary topup-invoice-copy"
          onClick={() => void copyText(onboardingUrl)}
        >
          <span className="btn-label-with-icon">
            <span className="btn-label-icon" aria-hidden="true">
              <Copy size={16} />
            </span>
            <span>{t("copyLink")}</span>
          </span>
        </button>
      </div>
    </section>
  );
}
