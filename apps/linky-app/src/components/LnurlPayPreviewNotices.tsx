import { LoadingState, Notice, Text } from "@linky-fit/ui";
import type { FC } from "react";
import type { LnurlPayPreview } from "../lnurlPay";
import type { Translate } from "../i18n";

interface LnurlPayPreviewNoticesProps {
  error: string | null;
  loading: boolean;
  preview: LnurlPayPreview | null;
  t: Translate;
}

/** Loading/error state of an LNURL-pay target, and the description of a fixed-amount one. */
export const LnurlPayPreviewNotices: FC<LnurlPayPreviewNoticesProps> = ({
  error,
  loading,
  preview,
  t,
}) => {
  if (loading) {
    return <LoadingState label={t("lnurlPayLoading")} />;
  }
  if (error) {
    return (
      <Notice
        tone="danger"
        title={t("lnurlPayLoadFailed")}
        description={error}
      />
    );
  }
  // An open-amount target's description is a generic "pay to <user>"; a fixed amount's names what is bought.
  if (!preview?.description) return null;
  if (preview.minSendableSat !== preview.maxSendableSat) return null;
  return (
    <Text color="$colorMuted" textAlign="center" numberOfLines={2}>
      {preview.description}
    </Text>
  );
};
