import * as lnurl from "@linky-fit/linkshu";
import { isNativePlatform } from "./platform/runtime";
export {
  LnurlTagMismatchError,
  getLnurlPayDisplayText,
  inferLightningAddressFromLnurlTarget,
  isLightningAddress,
  isLnurlPayTarget,
  isLnurlWithdrawTarget,
  resolveLnurlPayRequestUrl,
} from "@linky-fit/linkshu";
export type {
  LnurlPaySuccessAction,
  LnurlPayInvoiceResult,
  LnurlWithdrawPreview,
  LnurlPayPreview,
} from "@linky-fit/linkshu";
// Throws only when the proxy itself cannot be reached; linkshu reads the
// proxied status and body so an upstream error keeps its reason.
const fallback: lnurl.LnurlFallback = async (url) => {
  if (typeof window === "undefined") throw new Error("LNURL request failed");
  const origin = isNativePlatform() ? "https://app.linky.fit" : "";
  return fetch(`${origin}/api/lnurlp?url=${encodeURIComponent(url)}`, {
    headers: { Accept: "application/json" },
  });
};
export const fetchLnurlPayPreview = (target: string) =>
  lnurl.fetchLnurlPayPreview(target, fallback);
export const fetchLnurlInvoiceForTarget = (
  target: string,
  amount: number,
  comment?: string,
  preview?: lnurl.LnurlPayPreview | null,
) =>
  lnurl.fetchLnurlInvoiceForTarget(
    target,
    amount,
    comment,
    fallback,
    preview ?? undefined,
  );
export const fetchLnurlWithdrawPreview = (target: string) =>
  lnurl.fetchLnurlWithdrawPreview(target, fallback);
export const redeemLnurlWithdraw = (
  args: Parameters<typeof lnurl.redeemLnurlWithdraw>[0],
) => lnurl.redeemLnurlWithdraw(args, fallback);
