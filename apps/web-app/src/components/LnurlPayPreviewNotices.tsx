import type { FC } from "react";
import type { LnurlPayPreview } from "../lnurlPay";
import type { Translate } from "../i18n";

interface LnurlPayPreviewNoticesProps {
  error: string | null;
  loading: boolean;
  preview: LnurlPayPreview | null;
  t: Translate;
}

/** Loading/error state and amount constraints of an LNURL-pay target. */
export const LnurlPayPreviewNotices: FC<LnurlPayPreviewNoticesProps> = ({
  error,
  loading,
  preview,
  t,
}) => {
  if (loading) {
    return <p className="muted">{t("lnurlPayLoading")}</p>;
  }
  if (error) {
    return (
      <p className="muted">
        {t("lnurlPayLoadFailed")}: {error}
      </p>
    );
  }
  if (!preview) return null;

  const isFixedAmount = preview.minSendableSat === preview.maxSendableSat;

  return (
    <>
      {preview.description ? (
        <p className="muted">{preview.description}</p>
      ) : null}
      <p className="muted">
        {isFixedAmount
          ? t("lnurlPayFixedHint").replace(
              "{amount}",
              String(preview.minSendableSat),
            )
          : t("lnurlPayRangeHint")
              .replace("{min}", String(preview.minSendableSat))
              .replace("{max}", String(preview.maxSendableSat))}
      </p>
    </>
  );
};
