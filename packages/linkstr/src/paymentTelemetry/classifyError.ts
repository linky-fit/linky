export const classifyPaymentErrorCode = (
  value: string | null | undefined,
): string | null => {
  const text = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!text) return null;
  if (
    text.includes("short keyset id v2") ||
    text.includes("got no keysets to map it to") ||
    text.includes("couldn't map short keyset id")
  ) {
    return "short_keyset_id_unmapped";
  }
  if (text.includes("offline")) return "offline";
  if (text.includes("timeout") || text.includes("timed out")) return "timeout";
  if (text.includes("insufficient")) return "insufficient";
  if (text.includes("duplicate")) return "duplicate";
  if (text.includes("already signed")) return "outputs_already_signed";
  if (text.includes("publish")) return "publish_failed";
  if (text.includes("invoice")) return "invoice_failed";
  if (text.includes("mint")) return "mint_failed";
  if (text.includes("lnurl")) return "lnurl_failed";
  if (text.includes("network") || text.includes("fetch")) return "network";
  if (text.includes("invalid npub")) return "invalid_npub";
  if (text.includes("invalid nsec")) return "invalid_nsec";
  if (text.includes("invalid amount")) return "invalid_amount";
  return "unknown";
};
