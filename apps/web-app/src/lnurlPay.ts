import * as lnurl from "@linky/linkshu";
import { isNativePlatform } from "./platform/runtime";
export {
  LnurlTagMismatchError,
  getLnurlPayDisplayText,
  inferLightningAddressFromLnurlTarget,
  isLightningAddress,
  isLnurlPayTarget,
  isLnurlWithdrawTarget,
  resolveLnurlPayRequestUrl,
} from "@linky/linkshu";
export type {
  LnurlPaySuccessAction,
  LnurlPayInvoiceResult,
  LnurlWithdrawPreview,
  LnurlPayPreview,
} from "@linky/linkshu";
const fallback: lnurl.LnurlFallback = async (url) => {
  if (typeof window === "undefined") throw new Error("LNURL request failed");
  const origin = isNativePlatform() ? "https://app.linky.fit" : "";
  const response = await fetch(
    `${origin}/api/lnurlp?url=${encodeURIComponent(url)}`,
    { headers: { Accept: "application/json" } },
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response;
};
export const fetchLnurlPayPreview = (target: string) =>
  lnurl.fetchLnurlPayPreview(target, fallback);
export const fetchLnurlInvoiceForTarget = (
  target: string,
  amount: number,
  comment?: string,
) => lnurl.fetchLnurlInvoiceForTarget(target, amount, comment, fallback);
export const fetchLnurlWithdrawPreview = (target: string) =>
  lnurl.fetchLnurlWithdrawPreview(target, fallback);
export const redeemLnurlWithdraw = (
  args: Parameters<typeof lnurl.redeemLnurlWithdraw>[0],
) => lnurl.redeemLnurlWithdraw(args, fallback);
