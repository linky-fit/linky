import * as lnurl from "@linky-fit/linkshu";
import { apiUrl } from "./platform/runtime";
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
const fallback: lnurl.LnurlFallback = async (url) => {
  const response = await fetch(
    apiUrl(`/api/lnurlp?url=${encodeURIComponent(url)}`),
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
